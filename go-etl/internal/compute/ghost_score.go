package compute

import (
	"fmt"
	"sort"

	"github.com/nate/ghost-stops/go-etl/internal/db"
)

// ComputeGhostScores calculates ghost scores for all stations in a city
func ComputeGhostScores(dbClient *db.Client, cityCode string) error {
	// Get all station metrics
	metrics, err := dbClient.GetStationMetrics(cityCode)
	if err != nil {
		return fmt.Errorf("failed to get station metrics: %w", err)
	}

	if len(metrics) == 0 {
		return fmt.Errorf("no stations found for city: %s", cityCode)
	}

	// Separate stations with data from those with missing data
	var stationsWithData []db.StationMetric
	var stationsMissing []db.StationMetric

	for _, m := range metrics {
		if m.DataStatus == "missing" {
			stationsMissing = append(stationsMissing, m)
		} else {
			stationsWithData = append(stationsWithData, m)
		}
	}

	// Sort stations with data by 30-day rolling average (ascending)
	sort.Slice(stationsWithData, func(i, j int) bool {
		return stationsWithData[i].Rolling30dAvg < stationsWithData[j].Rolling30dAvg
	})

	// Calculate ghost scores based on percentile rank (only for stations with data)
	totalStationsWithData := float64(len(stationsWithData))
	for i := range stationsWithData {
		// Calculate percentile (0-1)
		percentile := float64(i+1) / totalStationsWithData

		// Invert percentile to get ghost score (0-100)
		// Lower ridership = higher ghost score
		ghostScore := int(100 - (percentile * 100))

		// Handle edge cases
		if ghostScore < 0 {
			ghostScore = 0
		}
		if ghostScore > 100 {
			ghostScore = 100
		}

		stationsWithData[i].GhostScore = ghostScore

		// Update database
		err = dbClient.UpdateStationMetrics(stationsWithData[i])
		if err != nil {
			fmt.Printf("Warning: Failed to update metrics for station %s: %v\n",
				stationsWithData[i].Name, err)
			continue
		}
	}

	// Set ghost score to -1 for stations with missing data (to indicate no score)
	for i := range stationsMissing {
		stationsMissing[i].GhostScore = -1
		err = dbClient.UpdateStationMetrics(stationsMissing[i])
		if err != nil {
			fmt.Printf("Warning: Failed to update metrics for station %s: %v\n",
				stationsMissing[i].Name, err)
			continue
		}
	}

	// Print summary
	fmt.Printf("\nGhost Score Summary for %s:\n", cityCode)
	fmt.Printf("Total stations: %d\n", len(metrics))
	fmt.Printf("Stations with ridership data: %d\n", len(stationsWithData))
	fmt.Printf("Stations with MISSING data: %d\n", len(stationsMissing))

	if len(stationsMissing) > 0 {
		fmt.Printf("\n⚠️  WARNING: %d stations have NO ridership data in the window!\n", len(stationsMissing))
		fmt.Printf("Missing stations:\n")
		for i := 0; i < 10 && i < len(stationsMissing); i++ {
			fmt.Printf("- %s\n", stationsMissing[i].Name)
		}
		if len(stationsMissing) > 10 {
			fmt.Printf("... and %d more\n", len(stationsMissing)-10)
		}
	}

	if len(stationsWithData) > 0 {
		fmt.Printf("\nTop 5 Ghost Stations (lowest ridership):\n")
		for i := 0; i < 5 && i < len(stationsWithData); i++ {
			fmt.Printf("%d. %s - Ghost Score: %d (30-day avg: %.0f rides)\n",
				i+1,
				stationsWithData[i].Name,
				stationsWithData[i].GhostScore,
				stationsWithData[i].Rolling30dAvg,
			)
		}

		fmt.Printf("\nTop 5 Busiest Stations:\n")
		for i := len(stationsWithData) - 5; i < len(stationsWithData) && i >= 0; i++ {
			fmt.Printf("%d. %s - Ghost Score: %d (30-day avg: %.0f rides)\n",
				len(stationsWithData)-i,
				stationsWithData[i].Name,
				stationsWithData[i].GhostScore,
				stationsWithData[i].Rolling30dAvg,
			)
		}
	}

	return nil
}