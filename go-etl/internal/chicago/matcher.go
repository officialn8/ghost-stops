package chicago

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/nate/ghost-stops/go-etl/internal/db"
)

// StationMatcher helps match Socrata station names to GTFS stations
type StationMatcher struct {
	dbClient      *db.Client
	cityID        string
	stations      []Station // All stations for the city
	lineHints     map[string]string // suffix -> line color
}

type Station struct {
	ID    string
	Name  string
	Lines []string
}

// NewStationMatcher creates a new station matcher
func NewStationMatcher(dbClient *db.Client, cityID string) (*StationMatcher, error) {
	// Load all stations for the city
	stations, err := loadStations(dbClient, cityID)
	if err != nil {
		return nil, fmt.Errorf("failed to load stations: %w", err)
	}

	// Initialize line hints from known Socrata patterns
	lineHints := map[string]string{
		// Hyphen patterns
		"O'Hare":       "Blue",
		"North Main":   "Red",
		"Brown":        "Brown",
		"Cermak":       "Pink",
		"Lake":         "Green",
		"Chinatown":    "Red",
		"Forest Park":  "Blue",
		"Dan Ryan":     "Red",
		"Bronzeville-IIT": "Green",
		"Skokie":       "Yellow",
		"McCormick Place": "Green",
		// Cross-street patterns (slashes)
		"Milwaukee":    "Blue",
		"State":        "Red",
		"Franklin":     "Brown",
		"Dearborn":     "Blue",
		"Wells":        "Orange",  // or Brown
		"Wabash":       "Green",   // or Orange/Pink/Purple
		"Division":     "Blue",
		"Clybourn":     "Red",
		"Halsted":      "Blue",    // or Green or Orange
		"Archer":       "Orange",
		// Special cases
		"Howard":       "Red",
		"Kimball":      "Brown",
		"Ashland/63":   "Green",
		"Cottage Grove": "Green",
		"Harlem":       "Blue",    // context-dependent
		"Cumberland":   "Blue",
		"Jackson":      "Blue",
		"Monroe":       "Blue",
		"Adams":        "Pink",
		"Madison":      "Blue",
		"Grand":        "Blue",
		// Purple Line Express
		"Express":      "Purple",
		// Additional patterns
		"O'Hare Airport": "Blue",
		"Midway Airport": "Orange",
		"Medical Center": "Blue",
		"Conservatory":  "Green",
		"Library":      "Brown",
	}

	return &StationMatcher{
		dbClient:  dbClient,
		cityID:    cityID,
		stations:  stations,
		lineHints: lineHints,
	}, nil
}

// MatchStation attempts to match a Socrata station to a GTFS station
func (m *StationMatcher) MatchStation(ctaStationId string, socrataName string) (stationID string, err error) {
	// First try direct CTA station ID match
	id, err := m.dbClient.GetStationIDByCtaStationId(m.cityID, ctaStationId)
	if err == nil {
		return id, nil
	}

	// Parse the Socrata name to extract base name and suffix
	baseName, suffix := parseSocrataName(socrataName)
	normalizedBase := db.NormalizeStationName(baseName)

	// Infer the line from the suffix
	inferredLine := m.inferLine(suffix)

	// Try to find a matching station
	var bestMatch *Station
	var bestScore int

	for i := range m.stations {
		station := &m.stations[i]

		// Normalize the GTFS station name (remove line suffix)
		gtfsBase := extractBaseName(station.Name)
		normalizedGtfs := db.NormalizeStationName(gtfsBase)

		// Check if base names match
		if normalizedBase == normalizedGtfs {
			// Score the match based on line compatibility
			score := 0
			if inferredLine != "" && containsLine(station.Lines, inferredLine) {
				score = 3 // Perfect match with line
			} else if len(station.Lines) == 0 {
				score = 2 // Match with no line info (acceptable)
			} else if inferredLine == "" {
				score = 1 // No line to match against
			}

			if score > bestScore {
				bestScore = score
				bestMatch = station
			}
		}

		// Also check for special mappings
		if matchesSpecialCase(socrataName, station.Name) {
			score := 4 // Special case match
			if score > bestScore {
				bestScore = score
				bestMatch = station
			}
		}
	}

	if bestMatch != nil {
		// Update the station with the CTA station ID for future lookups
		if err := m.dbClient.UpdateStationCtaStationId(bestMatch.ID, ctaStationId); err != nil {
			// Log but don't fail the match
			fmt.Printf("Warning: Failed to update CTA station ID: %v\n", err)
		}
		return bestMatch.ID, nil
	}

	return "", fmt.Errorf("no match found for %s (%s)", socrataName, normalizedBase)
}

// inferLine attempts to infer the line color from a station suffix
func (m *StationMatcher) inferLine(suffix string) string {
	if suffix == "" {
		return ""
	}

	// Direct lookup
	if line, ok := m.lineHints[suffix]; ok {
		return line
	}

	// Try partial matches for compound suffixes
	parts := strings.Split(suffix, " ")
	for _, part := range parts {
		if line, ok := m.lineHints[part]; ok {
			return line
		}
	}

	return ""
}

// parseSocrataName splits a Socrata station name into base name and suffix
func parseSocrataName(name string) (baseName string, suffix string) {
	// Handle hyphen pattern (e.g., "Addison-O'Hare")
	if idx := strings.LastIndex(name, "-"); idx > 0 {
		return strings.TrimSpace(name[:idx]), strings.TrimSpace(name[idx+1:])
	}

	// Handle slash pattern (e.g., "California/Milwaukee")
	if idx := strings.LastIndex(name, "/"); idx > 0 {
		return strings.TrimSpace(name[:idx]), strings.TrimSpace(name[idx+1:])
	}

	// No separator found
	return name, ""
}

// extractBaseName removes the line suffix from a GTFS station name
func extractBaseName(name string) string {
	// Remove parenthetical suffix like "(Blue)" or "(Blue Line)"
	if idx := strings.LastIndex(name, "("); idx > 0 {
		return strings.TrimSpace(name[:idx])
	}
	return name
}

// containsLine checks if a station serves a particular line
func containsLine(lines []string, targetLine string) bool {
	for _, line := range lines {
		if strings.EqualFold(line, targetLine) {
			return true
		}
	}
	return false
}

// loadStations loads all stations for a city from the database
func loadStations(dbClient *db.Client, cityID string) ([]Station, error) {
	// This is a simplified query - you may need to adjust based on your actual schema
	query := `
		SELECT id, name, lines
		FROM Station
		WHERE cityId = ?
	`

	rows, err := dbClient.Query(query, cityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stations []Station
	for rows.Next() {
		var s Station
		var linesJSON string

		err := rows.Scan(&s.ID, &s.Name, &linesJSON)
		if err != nil {
			return nil, err
		}

		// Parse the lines JSON array
		if err := json.Unmarshal([]byte(linesJSON), &s.Lines); err != nil {
			// Handle error but don't fail completely
			fmt.Printf("Warning: Failed to parse lines for station %s: %v\n", s.Name, err)
			s.Lines = []string{}
		}

		stations = append(stations, s)
	}

	return stations, nil
}

// matchesSpecialCase handles special station name mappings
func matchesSpecialCase(socrataName, gtfsName string) bool {
	// Define special mappings
	specialMappings := map[string][]string{
		// Socrata name -> possible GTFS names
		"Library":                    {"Harold Washington Library-State/Van Buren"},
		"Medical Center":             {"Illinois Medical District"},
		"O'Hare Airport":             {"O'Hare"},
		"95th/Dan Ryan":              {"95th", "95th/Ran Ryan", "95th/Dan Ryan"},
		"35-Bronzeville-IIT":         {"35th-Bronzeville-IIT", "Bronzeville-IIT"},
		"Midway Airport":             {"Midway"},
		"UIC-Halsted":                {"UIC-Halsted", "Halsted (Blue)", "Halsted (Green)"},
		"54th/Cermak":                {"54th/Cermak", "Cermak (Pink)"},
		"Cermak-McCormick Place":     {"Cermak-McCormick Place", "McCormick Place"},
		"35th/Archer":                {"35th/Archer", "Archer"},
		"Kedzie-Homan-Forest Park":   {"Kedzie-Homan", "Kedzie (Blue - Forest Park Branch)"},
		"East 63rd-Cottage Grove":    {"Cottage Grove", "63rd (Green)"},
		"Harlem-Forest Park":         {"Harlem (Blue - Forest Park Branch)"},
		"Harlem-Lake":                {"Harlem (Green)", "Harlem/Lake"},
		"Harlem-O'Hare":              {"Harlem (Blue - O'Hare Branch)"},
		"State/Lake":                 {"State/Lake", "Lake (Red)"},
		"Conservatory":               {"Conservatory-Central Park Drive", "Central Park"},
		"Oakton-Skokie":              {"Oakton-Skokie", "Skokie"},
		"Jefferson Park":             {"Jefferson Park"},
		"North/Clybourn":             {"North/Clybourn"},
		"Adams/Wabash":               {"Adams/Wabash"},
		"Clark/Division":             {"Clark/Division"},
		"Clark/Lake":                 {"Clark/Lake"},
		"Division/Milwaukee":         {"Division"},
		"Quincy/Wells":               {"Quincy/Wells", "Quincy"},
		"Washington/Wells":           {"Washington/Wells"},
		"Washington/Wabash":          {"Washington/Wabash"},
		"Washington/Dearborn":        {"Washington"},
	}

	// Normalize both names for comparison
	normalizedSocrata := db.NormalizeStationName(socrataName)
	normalizedGtfs := db.NormalizeStationName(gtfsName)

	// Check if exact normalized match
	if normalizedSocrata == normalizedGtfs {
		return true
	}

	// Check special mappings
	if possibleNames, ok := specialMappings[socrataName]; ok {
		for _, possibleName := range possibleNames {
			if db.NormalizeStationName(possibleName) == normalizedGtfs {
				return true
			}
		}
	}

	return false
}

// GetUnmatchedReason provides a human-readable reason for why a station couldn't be matched
func (m *StationMatcher) GetUnmatchedReason(socrataName string) string {
	baseName, suffix := parseSocrataName(socrataName)
	normalizedBase := db.NormalizeStationName(baseName)
	inferredLine := m.inferLine(suffix)

	// Check if any station has a similar base name
	for _, station := range m.stations {
		gtfsBase := extractBaseName(station.Name)
		normalizedGtfs := db.NormalizeStationName(gtfsBase)

		if normalizedBase == normalizedGtfs {
			if inferredLine != "" && !containsLine(station.Lines, inferredLine) {
				return fmt.Sprintf("Base name matches '%s' but line mismatch (expected: %s, found: %v)",
					station.Name, inferredLine, station.Lines)
			}
		}
	}

	// Check for close matches
	// You could add fuzzy matching logic here

	return "No station found with matching base name"
}