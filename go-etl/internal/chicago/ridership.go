package chicago

import (
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/nate/ghost-stops/go-etl/internal/db"
)

// IngestRidership processes CTA ridership data
func IngestRidership(dbClient *db.Client, source string) error {
	// Get Chicago city ID
	cityID, err := dbClient.GetCityID("chicago", "Chicago CTA")
	if err != nil {
		return fmt.Errorf("failed to get city ID: %w", err)
	}

	// Open data source
	var reader io.Reader
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		resp, err := http.Get(source)
		if err != nil {
			return fmt.Errorf("failed to download ridership data: %w", err)
		}
		defer resp.Body.Close()
		reader = resp.Body
	} else {
		file, err := os.Open(source)
		if err != nil {
			return fmt.Errorf("failed to open file: %w", err)
		}
		defer file.Close()
		reader = file
	}

	// Parse CSV
	csvReader := csv.NewReader(reader)
	header, err := csvReader.Read()
	if err != nil {
		return fmt.Errorf("failed to read header: %w", err)
	}

	// Create column index map
	colIndex := make(map[string]int)
	for i, col := range header {
		colIndex[col] = i
	}

	// Determine column names (they vary by dataset)
	stationNameCol := ""
	serviceDateCol := ""
	ridesCol := ""

	// Try common column names
	possibleStationCols := []string{"stationname", "station_name", "station"}
	possibleDateCols := []string{"service_date", "date"}
	possibleRidesCols := []string{"rides", "total_rides", "entries"}

	for _, col := range possibleStationCols {
		if _, ok := colIndex[col]; ok {
			stationNameCol = col
			break
		}
	}

	for _, col := range possibleDateCols {
		if _, ok := colIndex[col]; ok {
			serviceDateCol = col
			break
		}
	}

	for _, col := range possibleRidesCols {
		if _, ok := colIndex[col]; ok {
			ridesCol = col
			break
		}
	}

	if stationNameCol == "" || serviceDateCol == "" || ridesCol == "" {
		return fmt.Errorf("could not find required columns. Found: %v", header)
	}

	// Pre-load all station aliases for faster matching
	aliases, err := dbClient.GetAllStationAliases(cityID)
	if err != nil {
		return fmt.Errorf("failed to get station aliases: %w", err)
	}
	fmt.Printf("Loaded %d station aliases\n", len(aliases))

	// Track unmatched stations
	unmatchedStations := make(map[string]int) // station name -> count
	
	// Batch records for insertion
	var batch []db.RidershipRecord
	batchSize := 1000
	totalCount := 0

	// Process records
	for {
		record, err := csvReader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("error reading record: %w", err)
		}

		totalCount++
		stationName := record[colIndex[stationNameCol]]
		serviceDateStr := record[colIndex[serviceDateCol]]
		ridesStr := record[colIndex[ridesCol]]

		// Parse date (handle both MM/DD/YYYY and YYYY-MM-DD formats)
		var serviceDate time.Time
		if strings.Contains(serviceDateStr, "/") {
			parsedTime, err := time.Parse("01/02/2006", serviceDateStr)
			if err == nil {
				serviceDate = parsedTime
			}
		} else {
			parsedTime, err := time.Parse("2006-01-02", serviceDateStr)
			if err == nil {
				serviceDate = parsedTime
			}
		}
		if serviceDate.IsZero() {
			continue // Skip invalid dates
		}

		// Parse rides
		rides, err := strconv.Atoi(strings.TrimSpace(ridesStr))
		if err != nil {
			continue // Skip invalid ride counts
		}

		// Normalize station name for matching
		normalized := db.NormalizeStationName(stationName)

		// Try to find station in our alias cache
		stationID, ok := aliases[normalized]
		if !ok {
			unmatchedStations[stationName]++
			continue
		}

		// Add to batch
		batch = append(batch, db.RidershipRecord{
			StationID:   stationID,
			ServiceDate: serviceDate.Format("2006-01-02 15:04:05"),
			Entries:     rides,
		})

		// If batch is full, insert it
		if len(batch) >= batchSize {
			err = dbClient.InsertRidershipDailyBatch(batch)
			if err != nil {
				return fmt.Errorf("failed to insert batch: %w", err)
			}
			batch = nil // Clear the batch
		}
	}

	// Insert any remaining records
	if len(batch) > 0 {
		err = dbClient.InsertRidershipDailyBatch(batch)
		if err != nil {
			return fmt.Errorf("failed to insert final batch: %w", err)
		}
	}

	// Write unmatched stations report
	if len(unmatchedStations) > 0 {
		err = writeUnmatchedReport(unmatchedStations)
		if err != nil {
			fmt.Printf("Warning: Failed to write unmatched stations report: %v\n", err)
		}
	}

	fmt.Printf("Processed %d ridership records\n", totalCount)
	fmt.Printf("Found %d unique unmatched station names\n", len(unmatchedStations))

	return nil
}

// writeUnmatchedReport creates a markdown file with unmatched stations
func writeUnmatchedReport(unmatched map[string]int) error {
	// Create docs directory if it doesn't exist
	err := os.MkdirAll("docs", 0755)
	if err != nil {
		return err
	}

	file, err := os.Create("docs/chicago-unmatched-stations.md")
	if err != nil {
		return err
	}
	defer file.Close()

	fmt.Fprintln(file, "# Chicago Unmatched Stations Report")
	fmt.Fprintln(file)
	fmt.Fprintln(file, "The following station names from the ridership data could not be matched to GTFS stations:")
	fmt.Fprintln(file)
	fmt.Fprintln(file, "| Station Name | Occurrences |")
	fmt.Fprintln(file, "|--------------|-------------|")

	for station, count := range unmatched {
		fmt.Fprintf(file, "| %s | %d |\n", station, count)
	}

	fmt.Fprintln(file)
	fmt.Fprintln(file, "## Resolution Steps")
	fmt.Fprintln(file)
	fmt.Fprintln(file, "1. Check if these are old/renamed stations")
	fmt.Fprintln(file, "2. Add entries to the StationAlias table for known mappings")
	fmt.Fprintln(file, "3. Some may be bus terminals or non-rail stations")

	return nil
}