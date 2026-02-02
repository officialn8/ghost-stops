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
	"sort"
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

	// Build parent station lookup
	stopParent := make(map[string]string)
	for stopID, stop := range allStops {
		parentID := stopID
		if pID, ok := stop["parent_station"]; ok && pID != "" {
			parentID = pID
		}
		stopParent[stopID] = parentID
	}

	routeIdToLine, err := loadRouteLineMap(r)
	if err != nil {
		fmt.Printf("Warning: Failed to load routes.txt for line mapping: %v\n", err)
	}
	tripIdToLine, err := loadTripLineMap(r, routeIdToLine)
	if err != nil {
		fmt.Printf("Warning: Failed to load trips.txt for line mapping: %v\n", err)
	}
	stopLinesMap, err := loadStopLinesMap(r, tripIdToLine, stopParent)
	if err != nil {
		fmt.Printf("Warning: Failed to load stop_times.txt for line mapping: %v\n", err)
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

			// Prefer GTFS route/trip/stop_times mapping for line data
			if lineSet, ok := stopLinesMap[parentID]; ok && len(lineSet) > 0 {
				for lineName := range lineSet {
					station := railStations[parentID]
					station.Lines = appendUniqueLine(station.Lines, lineName)
					railStations[parentID] = station
				}
			} else if desc, ok := stop["stop_desc"]; ok {
				// Fallback: extract from stop_desc if mapping is unavailable
				for lineCode, lineName := range CTALines {
					if strings.Contains(desc, lineCode) || strings.Contains(desc, lineName) {
						station := railStations[parentID]
						station.Lines = appendUniqueLine(station.Lines, lineName)
						railStations[parentID] = station
					}
				}
			}
		}
	}

	// Insert stations into database
	insertCount := 0
	for stopID, station := range railStations {
		sort.Strings(station.Lines)
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

func appendUniqueLine(lines []string, lineName string) []string {
	for _, existing := range lines {
		if existing == lineName {
			return lines
		}
	}
	return append(lines, lineName)
}

func findZipFile(z *zip.ReadCloser, filename string) *zip.File {
	for _, f := range z.File {
		if f.Name == filename || strings.HasSuffix(f.Name, "/"+filename) {
			return f
		}
	}
	return nil
}

func loadRouteLineMap(z *zip.ReadCloser) (map[string]string, error) {
	routesFile := findZipFile(z, "routes.txt")
	if routesFile == nil {
		return nil, fmt.Errorf("routes.txt not found in GTFS zip")
	}

	rc, err := routesFile.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open routes.txt: %w", err)
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("failed to read routes header: %w", err)
	}

	colIndex := make(map[string]int)
	for i, col := range header {
		colIndex[col] = i
	}

	routeIDCol, okID := colIndex["route_id"]
	routeShortCol, okShort := colIndex["route_short_name"]
	routeLongCol, okLong := colIndex["route_long_name"]
	if !okID {
		return nil, fmt.Errorf("routes.txt missing route_id column")
	}

	routeIdToLine := make(map[string]string)
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("error reading routes.txt: %w", err)
		}

		routeID := record[routeIDCol]
		shortName := ""
		longName := ""
		if okShort {
			shortName = record[routeShortCol]
		}
		if okLong {
			longName = record[routeLongCol]
		}

		if lineName, ok := mapRouteToLine(routeID, shortName, longName); ok {
			routeIdToLine[routeID] = lineName
		}
	}

	return routeIdToLine, nil
}

func loadTripLineMap(z *zip.ReadCloser, routeIdToLine map[string]string) (map[string]string, error) {
	tripsFile := findZipFile(z, "trips.txt")
	if tripsFile == nil {
		return nil, fmt.Errorf("trips.txt not found in GTFS zip")
	}

	rc, err := tripsFile.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open trips.txt: %w", err)
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("failed to read trips header: %w", err)
	}

	colIndex := make(map[string]int)
	for i, col := range header {
		colIndex[col] = i
	}

	routeIDCol, okRoute := colIndex["route_id"]
	tripIDCol, okTrip := colIndex["trip_id"]
	if !okRoute || !okTrip {
		return nil, fmt.Errorf("trips.txt missing route_id or trip_id column")
	}

	tripIdToLine := make(map[string]string)
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("error reading trips.txt: %w", err)
		}

		routeID := record[routeIDCol]
		tripID := record[tripIDCol]
		if lineName, ok := routeIdToLine[routeID]; ok {
			tripIdToLine[tripID] = lineName
		}
	}

	return tripIdToLine, nil
}

func loadStopLinesMap(z *zip.ReadCloser, tripIdToLine map[string]string, stopParent map[string]string) (map[string]map[string]bool, error) {
	stopTimesFile := findZipFile(z, "stop_times.txt")
	if stopTimesFile == nil {
		return nil, fmt.Errorf("stop_times.txt not found in GTFS zip")
	}

	rc, err := stopTimesFile.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open stop_times.txt: %w", err)
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("failed to read stop_times header: %w", err)
	}

	colIndex := make(map[string]int)
	for i, col := range header {
		colIndex[col] = i
	}

	stopIDCol, okStop := colIndex["stop_id"]
	tripIDCol, okTrip := colIndex["trip_id"]
	if !okStop || !okTrip {
		return nil, fmt.Errorf("stop_times.txt missing stop_id or trip_id column")
	}

	stopLinesMap := make(map[string]map[string]bool)
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("error reading stop_times.txt: %w", err)
		}

		stopID := record[stopIDCol]
		tripID := record[tripIDCol]
		lineName, ok := tripIdToLine[tripID]
		if !ok {
			continue
		}

		parentID := stopParent[stopID]
		if parentID == "" {
			parentID = stopID
		}

		if _, exists := stopLinesMap[parentID]; !exists {
			stopLinesMap[parentID] = make(map[string]bool)
		}
		stopLinesMap[parentID][lineName] = true
	}

	return stopLinesMap, nil
}

func mapRouteToLine(routeID, shortName, longName string) (string, bool) {
	if line, ok := CTALines[routeID]; ok {
		return line, true
	}
	if shortName != "" {
		if line, ok := CTALines[shortName]; ok {
			return line, true
		}
	}
	if longName != "" {
		if line, ok := CTALines[longName]; ok {
			return line, true
		}
		normalized := strings.ToLower(longName)
		for _, line := range CTALines {
			if strings.Contains(normalized, strings.ToLower(line)) {
				return line, true
			}
		}
	}
	return "", false
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