package chicago

import (
	"archive/zip"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nate/ghost-stops/go-etl/internal/db"
)

// CTALines maps route colors to line names
var CTALines = map[string]string{
	"Red":    "Red",
	"Blue":   "Blue",
	"Brn":    "Brown",
	"G":      "Green",
	"Org":    "Orange",
	"P":      "Purple",
	"Pexp":   "Purple Express",
	"Pink":   "Pink",
	"Y":      "Yellow",
}

// IngestGTFS downloads and processes CTA GTFS data
func IngestGTFS(dbClient *db.Client, source string) error {
	// Get Chicago city ID
	cityID, err := dbClient.GetCityID("chicago", "Chicago CTA")
	if err != nil {
		return fmt.Errorf("failed to get city ID: %w", err)
	}

	// Determine if source is URL or file
	var zipPath string
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		// Download GTFS file
		zipPath, err = downloadFile(source, "chicago-gtfs.zip")
		if err != nil {
			return fmt.Errorf("failed to download GTFS: %w", err)
		}
		defer os.Remove(zipPath)
	} else {
		zipPath = source
	}

	// Open zip file
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("failed to open zip: %w", err)
	}
	defer r.Close()

	// Find stops.txt
	var stopsFile *zip.File
	for _, f := range r.File {
		if f.Name == "stops.txt" || strings.HasSuffix(f.Name, "/stops.txt") {
			stopsFile = f
			break
		}
	}

	if stopsFile == nil {
		return fmt.Errorf("stops.txt not found in GTFS zip")
	}

	// Process stops
	rc, err := stopsFile.Open()
	if err != nil {
		return fmt.Errorf("failed to open stops.txt: %w", err)
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return fmt.Errorf("failed to read header: %w", err)
	}

	// Create column index map
	colIndex := make(map[string]int)
	for i, col := range header {
		colIndex[col] = i
	}

	// Required columns
	requiredCols := []string{"stop_id", "stop_name", "stop_lat", "stop_lon"}
	for _, col := range requiredCols {
		if _, ok := colIndex[col]; !ok {
			return fmt.Errorf("missing required column: %s", col)
		}
	}

	// First pass: collect all stop names
	allStops := make(map[string]map[string]string)
	rc, err = stopsFile.Open()
	if err != nil {
		return fmt.Errorf("failed to reopen stops.txt for first pass: %w", err)
	}
	defer rc.Close()

	reader = csv.NewReader(rc)
	_, err = reader.Read() // Skip header
	if err != nil {
		return fmt.Errorf("failed to read header on first pass: %w", err)
	}

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("error reading record on first pass: %w", err)
		}

		stop := make(map[string]string)
		for i, h := range header {
			stop[h] = record[i]
		}
		allStops[stop["stop_id"]] = stop
	}

	// Second pass: collect rail stations and their lines
	railStations := make(map[string]struct {
		Name  string
		Lat   float64
		Lon   float64
		Lines []string
	})

	for _, stop := range allStops {
		stopID := stop["stop_id"]

		// CTA rail stations typically have numeric IDs starting with 4 or 3
		if len(stopID) >= 5 && (stopID[0] == '4' || stopID[0] == '3') {
			lat, _ := strconv.ParseFloat(stop["stop_lat"], 64)
			lon, _ := strconv.ParseFloat(stop["stop_lon"], 64)

			// Extract parent station ID if this is a platform
			parentID := stopID
			if pID, ok := stop["parent_station"]; ok && pID != "" {
				parentID = pID
			}

			// Initialize station if not exists
			if _, exists := railStations[parentID]; !exists {
				// Use parent's name if available, otherwise use stop's own name
				stationName := stop["stop_name"]
				if parentStop, ok := allStops[parentID]; ok {
					stationName = parentStop["stop_name"]
				}

				railStations[parentID] = struct {
					Name  string
					Lat   float64
					Lon   float64
					Lines []string
				}{
					Name:  stationName,
					Lat:   lat,
					Lon:   lon,
					Lines: []string{},
				}
			}

			// Try to extract line info from stop_desc
			if desc, ok := stop["stop_desc"]; ok {
				for lineCode, lineName := range CTALines {
					if strings.Contains(desc, lineCode) || strings.Contains(desc, lineName) {
						station := railStations[parentID]
						// Check if line already added
						found := false
						for _, l := range station.Lines {
							if l == lineName {
								found = true
								break
							}
						}
						if !found {
							station.Lines = append(station.Lines, lineName)
							railStations[parentID] = station
						}
					}
				}
			}
		}
	}

	// Insert stations into database
	insertCount := 0
	for stopID, station := range railStations {
		// Convert lines to JSON array
		linesJSON, _ := json.Marshal(station.Lines)

		err = dbClient.UpsertStation(
			cityID,
			stopID,
			station.Name,
			station.Lat,
			station.Lon,
			string(linesJSON),
		)
		if err != nil {
			fmt.Printf("Warning: Failed to insert station %s: %v\n", station.Name, err)
			continue
		}
		insertCount++

		// Get the station's UUID we just inserted/updated
		stationUUID, err := dbClient.GetStationIDByExternalID(cityID, stopID)
		if err != nil {
			fmt.Printf("Warning: Failed to get UUID for station %s: %v\n", station.Name, err)
			continue
		}

		// Create normalized alias for the station
		normalized := db.NormalizeStationName(station.Name)
		dbClient.CreateStationAlias(stationUUID, station.Name, normalized)
	}

	fmt.Printf("Processed %d rail stations\n", insertCount)
	return nil
}

// downloadFile downloads a file from URL and saves it locally
func downloadFile(url, filename string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// Create temp file
	tmpDir := os.TempDir()
	filepath := filepath.Join(tmpDir, filename)

	out, err := os.Create(filepath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return filepath, err
}