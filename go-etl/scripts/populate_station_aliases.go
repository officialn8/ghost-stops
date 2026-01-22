package main

import (
	"fmt"
	"log"
	"os"

	"github.com/nate/ghost-stops/go-etl/internal/db"
)

// Known station alias mappings based on the unmatched stations analysis
var chicagoAliases = []struct {
	socrataName string
	gtfsName    string
}{
	// Orange Line stations
	{"Kedzie-Midway", "Kedzie-Orange"},
	{"Midway Airport", "Midway"},

	// Blue Line - Forest Park branch
	{"Kedzie-Homan-Forest Park", "Kedzie-Homan"},
	{"Austin-Forest Park", "Austin (Blue)"},
	{"Oak Park-Forest Park", "Oak Park-Blue"},
	{"Cicero-Lake", "Cicero (Blue)"},
	{"Clinton-Forest Park", "Clinton-Blue"},
	{"Kedzie-Lake", "Kedzie-Homan"},
	{"Central-Lake", "Central Park"},
	{"Pulaski-Lake", "Pulaski (Blue)"},
	{"Austin-Lake", "Austin (Blue)"},
	{"California-Lake", "California (Blue)"},
	{"Harlem-Lake", "Harlem/Lake"},
	{"Oak Park-Lake", "Oak Park-Blue"},

	// Blue Line - O'Hare branch
	{"O'Hare Airport", "O'Hare"},
	{"Montrose-O'Hare", "Montrose-Blue"},
	{"Irving Park-O'Hare", "Irving Park-Blue"},
	{"Addison-O'Hare", "Addison-Blue"},
	{"Belmont-O'Hare", "Belmont-Blue"},

	// Red Line
	{"Belmont-North Main", "Belmont (Red/Brown/Purple)"},
	{"Addison-North Main", "Addison (Red)"},
	{"Wilson", "Wilson"},
	{"95th/Dan Ryan", "95th/Dan Ryan"},

	// Red/Green Line
	{"Roosevelt", "Roosevelt"},
	{"Sox-35th-Dan Ryan", "Sox-35th"},
	{"47th-Dan Ryan", "47th (Red)"},
	{"Garfield-Dan Ryan", "Garfield (Red)"},
	{"63rd-Dan Ryan", "63rd"},

	// Green Line
	{"Garfield-South Elevated", "Garfield (Green)"},
	{"47th-South Elevated", "47th (Green)"},
	{"Halsted/63rd", "Halsted (Green)"},

	// Purple Line
	{"Central-Evanston", "Central (Purple)"},

	// Loop stations
	{"Jackson/State", "Jackson (Red)"},
	{"State/Lake", "Lake (Subway)"},
	{"Lake/State", "Lake (Subway)"},
	{"Washington/State", "Washington"},
	{"Monroe/State", "Monroe (Red)"},
	{"Randolph/Wabash", "Washington/Wabash"},
	{"Madison/Wabash", "Washington/Wabash"},
	{"Washington/Dearborn", "Washington"},
	{"Monroe/Dearborn", "Monroe (Blue)"},
	{"Jackson/Dearborn", "Jackson (Blue)"},
	{"Quincy/Wells", "Quincy"},
	{"Clark/Lake", "Clark/Lake"},
	{"Chicago/Franklin", "Merchandise Mart (Brown/Purple)"},
	{"Library", "Harold Washington Library-State/Van Buren"},

	// Brown/Purple stations and other lines
	{"Damen-Lake", "Damen (Blue)"},
	{"Clinton-Lake", "Clinton (Green/Pink)"},
	{"Morgan-Lake", "Morgan (Green/Pink)"},
	{"Chicago/State", "Chicago (Red)"},
	{"Grand/State", "Grand (Red)"},
	{"Division/Milwaukee", "Division"},
	{"Chicago/Milwaukee", "Chicago (Blue)"},
	{"Grand/Milwaukee", "Grand (Blue)"},
	{"Damen/Milwaukee", "Damen (Blue)"},
	{"Western/Milwaukee", "Western (Blue - O'Hare Branch)"},
	{"California/Milwaukee", "California (Blue)"},

	// Pink Line
	{"Medical Center", "Illinois Medical District"},

	// Possible old station
	{"Homan", "Kedzie-Homan"},
	{"Skokie", "Dempster-Skokie"},
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run populate_station_aliases.go <database_path>")
		os.Exit(1)
	}

	dbPath := os.Args[1]

	// Initialize database client
	client, err := db.NewClient(dbPath)
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	defer client.Close()

	// Get Chicago city ID
	cityID, err := client.GetCityID("chicago", "")
	if err != nil {
		log.Fatal("Failed to get Chicago city ID:", err)
	}

	// Get all station names and IDs for Chicago
	stations, err := client.GetStationNamesAndIDs(cityID)
	if err != nil {
		log.Fatal("Failed to get station names:", err)
	}

	addedCount := 0
	notFoundCount := 0

	// Process each alias mapping
	for _, alias := range chicagoAliases {
		// Normalize the GTFS station name to find the station ID
		normalizedGTFS := db.NormalizeStationName(alias.gtfsName)
		stationID, found := stations[normalizedGTFS]

		if !found {
			// Try to find a station that starts with the normalized name
			// This handles cases like "Belmont" matching "Belmont (Red/Brown/Purple)"
			foundPartial := false
			for stationNorm, id := range stations {
				if strings.HasPrefix(stationNorm, normalizedGTFS+" ") || stationNorm == normalizedGTFS {
					stationID = id
					foundPartial = true
					log.Printf("Found partial match: '%s' matches station with normalized name '%s'",
						alias.gtfsName, stationNorm)
					break
				}
			}

			if !foundPartial {
				log.Printf("Warning: Station not found for GTFS name '%s' (normalized: '%s')",
					alias.gtfsName, normalizedGTFS)
				notFoundCount++
				continue
			}
		}

		// Normalize the Socrata name
		normalizedSocrata := db.NormalizeStationName(alias.socrataName)

		// Create the alias
		err := client.CreateStationAlias(stationID, alias.socrataName, normalizedSocrata)
		if err != nil {
			log.Printf("Failed to create alias for '%s' -> '%s': %v",
				alias.socrataName, alias.gtfsName, err)
		} else {
			log.Printf("Created alias: '%s' (normalized: '%s') -> Station ID %s",
				alias.socrataName, normalizedSocrata, stationID)
			addedCount++
		}
	}

	log.Printf("\n✅ Summary: Added %d aliases, %d stations not found", addedCount, notFoundCount)
}