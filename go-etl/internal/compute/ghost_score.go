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

	// Sort stations by 30-day rolling average (ascending)
	sort.Slice(metrics, func(i, j int) bool {
		return metrics[i].Rolling30dAvg < metrics[j].Rolling30dAvg
	})

	// Calculate ghost scores based on percentile rank
	totalStations := float64(len(metrics))
	for i := range metrics {
		// Calculate percentile (0-1)
		percentile := float64(i+1) / totalStations

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

		metrics[i].GhostScore = ghostScore

		// Update database
		err = dbClient.UpdateStationMetrics(metrics[i])
		if err != nil {
			fmt.Printf("Warning: Failed to update metrics for station %s: %v\n",
				metrics[i].Name, err)
			continue
		}
	}

	// Print summary
	fmt.Printf("\nGhost Score Summary for %s:\n", cityCode)
	fmt.Printf("Total stations: %d\n", len(metrics))
	fmt.Printf("\nTop 5 Ghost Stations (lowest ridership):\n")

	for i := 0; i < 5 && i < len(metrics); i++ {
		fmt.Printf("%d. %s - Ghost Score: %d (30-day avg: %.0f rides)\n",
			i+1,
			metrics[i].Name,
			metrics[i].GhostScore,
			metrics[i].Rolling30dAvg,
		)
	}

	fmt.Printf("\nTop 5 Busiest Stations:\n")
	for i := len(metrics) - 5; i < len(metrics) && i >= 0; i++ {
		fmt.Printf("%d. %s - Ghost Score: %d (30-day avg: %.0f rides)\n",
			len(metrics)-i,
			metrics[i].Name,
			metrics[i].GhostScore,
			metrics[i].Rolling30dAvg,
		)
	}

	return nil
}