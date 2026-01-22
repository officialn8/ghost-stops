package chicago

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
	"strconv"

	"github.com/nate/ghost-stops/go-etl/internal/db"
)

type SyncOpts struct {
	Days  int
	Since string
	Limit int
}

type SocrataRecord struct {
	StationID   string    `json:"station_id"`
	StationName string `json:"stationname"`
	Date        time.Time `json:"date"`
	Rides       string `json:"rides"`
}

func SyncRidership(dbClient *db.Client, token string, opts SyncOpts) error {
	log.Println("Starting ridership sync for Chicago...")

	// 1. Determine the start date for the sync
	sinceDate, err := getSinceDate(dbClient, opts.Since)
	if err != nil {
		return fmt.Errorf("could not determine sync start date: %w", err)
	}
	log.Printf("Fetching new ridership data since %s", sinceDate.Format("2006-01-02"))

	// 2. Fetch data from Socrata API
	records, err := fetchSocrataData(token, sinceDate, opts.Limit)
	if err != nil {
		return fmt.Errorf("failed to fetch socrata data: %w", err)
	}

	if len(records) == 0 {
		log.Println("No new ridership data found.")
		return nil
	}

	log.Printf("Fetched %d new ridership records", len(records))

	// 3. Get city ID and load station mapping data
	cityID, err := dbClient.GetCityID("chicago", "")
	if err != nil {
		return fmt.Errorf("could not get city id for chicago: %w", err)
	}

	// Load all station aliases for name-based matching
	aliases, err := dbClient.GetAllStationAliases(cityID)
	if err != nil {
		return fmt.Errorf("failed to get station aliases: %w", err)
	}
	log.Printf("Loaded %d station aliases", len(aliases))

	// Build normalized name lookup map for all stations
	normalizedNameMap, err := dbClient.GetStationNamesAndIDs(cityID)
	if err != nil {
		log.Printf("Warning: failed to build normalized name map: %v", err)
		normalizedNameMap = make(map[string]string)
	}
	log.Printf("Built normalized name map with %d entries", len(normalizedNameMap))

	// Tracking variables
	var dbRecords []db.RidershipRecord
	stationIDCache := make(map[string]string) // caches successful mappings
	unmatchedStations := make(map[string][]SocrataRecord) // track unmatched for CSV

	// Statistics
	totalRecords := len(records)
	insertedCount := 0
	skippedCount := 0
	stationIDsInserted := make(map[string]bool)

	for _, r := range records {
		// Check cache first
		stationID, ok := stationIDCache[r.StationID+"_"+r.StationName]
		if !ok {
			// Try fast path: external ID mapping
			id, err := dbClient.GetStationIDByExternalID(cityID, r.StationID)
			if err == nil {
				stationID = id
			} else {
				// Try name-based mapping: normalize the station name
				normalized := db.NormalizeStationName(r.StationName)

				// Check alias map first
				if aliasID, found := aliases[normalized]; found {
					stationID = aliasID
				} else if nameID, found := normalizedNameMap[normalized]; found {
					// Check direct normalized name match
					stationID = nameID
				} else {
					// No match found - track for CSV output
					unmatchedStations[r.StationID+"_"+r.StationName] = append(
						unmatchedStations[r.StationID+"_"+r.StationName], r)
					skippedCount++
					continue
				}
			}
			stationIDCache[r.StationID+"_"+r.StationName] = stationID
		}

		dbRecords = append(dbRecords, db.RidershipRecord{
			StationID:   stationID,
			ServiceDate: r.Date.Format(time.RFC3339),
			Entries:     parseRides(r.Rides),
		})
		stationIDsInserted[stationID] = true
		insertedCount++
	}

	// Write unmatched stations to CSV
	if len(unmatchedStations) > 0 {
		if err := writeUnmatchedStationsCSV(unmatchedStations); err != nil {
			log.Printf("Warning: failed to write unmatched stations CSV: %v", err)
		}
	}

	if len(dbRecords) > 0 {
		log.Printf("Upserting %d records into the database...", len(dbRecords))
		if err := dbClient.InsertRidershipDailyBatch(dbRecords); err != nil {
			return fmt.Errorf("failed to batch insert ridership data: %w", err)
		}
		log.Printf("✅ Successfully upserted %d records.", len(dbRecords))
	}

	// Log summary statistics
	log.Println("--- Sync Summary ---")
	log.Printf("Total rows fetched: %d", totalRecords)
	log.Printf("Rows inserted: %d", insertedCount)
	log.Printf("Rows skipped (unmatched): %d", skippedCount)
	log.Printf("Distinct stations inserted: %d", len(stationIDsInserted))
	if len(unmatchedStations) > 0 {
		log.Printf("Unmatched stations: %d (see /docs/unmatched_socrata.csv)", len(unmatchedStations))
	}

	// 4. Prune old data
	log.Println("--- Pruning Data ---")
	rowsBefore, err := dbClient.GetRidershipDailyCount("chicago")
	if err != nil {
		return fmt.Errorf("could not get row count before pruning: %w", err)
	}
	log.Printf("Rows before pruning: %d", rowsBefore)

	prunedCount, err := dbClient.PruneRidership("chicago", opts.Days)
	if err != nil {
		return fmt.Errorf("failed to prune old ridership data: %w", err)
	}
	log.Printf("Rows deleted: %d", prunedCount)

	rowsAfter, err := dbClient.GetRidershipDailyCount("chicago")
	if err != nil {
		return fmt.Errorf("could not get row count after pruning: %w", err)
	}
	log.Printf("Rows after pruning: %d", rowsAfter)

	minDate, maxDate, err := dbClient.GetRidershipDailyMinMaxDates("chicago")
	if err != nil {
		return fmt.Errorf("could not get min/max dates after pruning: %w", err)
	}
	log.Printf("New date range: %s to %s", minDate.Format("2006-01-02"), maxDate.Format("2006-01-02"))


	log.Println("✅ Ridership sync completed successfully.")
	return nil
}

func getSinceDate(dbClient *db.Client, sinceOverride string) (time.Time, error) {
	if sinceOverride != "" {
		return time.Parse("2006-01-02", sinceOverride)
	}

	maxDate, err := dbClient.GetMaxServiceDate("chicago")
	if err != nil {
		return time.Time{}, fmt.Errorf("could not get max service date: %w", err)
	}

	if maxDate.IsZero() {
		// Fallback if the table is empty
		return time.Now().AddDate(0, 0, -7), nil
	}

	return maxDate, nil
}

func fetchSocrataData(token string, sinceDate time.Time, limit int) ([]SocrataRecord, error) {
	baseURL := "https://data.cityofchicago.org/resource/5neh-572f.json"
	var allRecords []SocrataRecord
	offset := 0
	totalFetched := 0

	for {
		// Construct the URL with pagination and filtering
		soqlQuery := fmt.Sprintf("$where=date > '%s'&$limit=%d&$offset=%d", sinceDate.Format("2006-01-02T15:04:05.000"), limit, offset)
		url := fmt.Sprintf("%s?%s", baseURL, soqlQuery)

		log.Printf("Fetching page: %s", url)

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("X-App-Token", token)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to execute request: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("Socrata API returned non-200 status: %d", resp.StatusCode)
		}

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("failed to read response body: %w", err)
		}

		var records []SocrataRecord
		if err := json.Unmarshal(body, &records); err != nil {
			return nil, fmt.Errorf("failed to unmarshal json: %w", err)
		}

		if len(records) == 0 {
			break // No more records
		}

		allRecords = append(allRecords, records...)
		pageFetched := len(records)
		totalFetched += pageFetched

		log.Printf("Fetched %d records on this page. Total fetched so far: %d", pageFetched, totalFetched)

		offset += limit
	}

	return allRecords, nil
}

func parseRides(ridesStr string) int {
	rides, err := strconv.Atoi(ridesStr)
	if err != nil {
		return 0 // Or handle error appropriately
	}
	return rides
}

// writeUnmatchedStationsCSV writes unmatched stations to a CSV file
func writeUnmatchedStationsCSV(unmatchedStations map[string][]SocrataRecord) error {
	// Ensure docs directory exists
	docsDir := "docs"
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		return fmt.Errorf("failed to create docs directory: %w", err)
	}

	// Create/open the CSV file
	csvPath := filepath.Join(docsDir, "unmatched_socrata.csv")
	file, err := os.Create(csvPath)
	if err != nil {
		return fmt.Errorf("failed to create CSV file: %w", err)
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Write header
	if err := writer.Write([]string{"station_id", "stationname", "date", "rides", "occurrences"}); err != nil {
		return fmt.Errorf("failed to write CSV header: %w", err)
	}

	// Write unmatched station records
	for _, records := range unmatchedStations {
		if len(records) == 0 {
			continue
		}
		// Use the first record as representative
		r := records[0]
		row := []string{
			r.StationID,
			r.StationName,
			r.Date.Format("2006-01-02"),
			r.Rides,
			strconv.Itoa(len(records)),
		}
		if err := writer.Write(row); err != nil {
			return fmt.Errorf("failed to write CSV row: %w", err)
		}
	}

	log.Printf("✅ Wrote %d unmatched stations to %s", len(unmatchedStations), csvPath)
	return nil
}
