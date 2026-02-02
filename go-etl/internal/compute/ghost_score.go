package compute

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"

	"github.com/nate/ghost-stops/go-etl/internal/db"
)

// Score weights for composite calculation
const (
	WeightRidership   = 0.40 // 40% - Current 30-day avg vs system
	WeightTrend       = 0.25 // 25% - 30-day vs 90-day change
	WeightVariability = 0.15 // 15% - Coefficient of variation
	WeightContext     = 0.20 // 20% - Station type adjustment
)

// Variability score constants
const (
	CVMeanFloor = 50.0 // Floor for mean to prevent CV explosion on low ridership stations
	CVMax       = 2.0  // Cap CV at 2.0 for gentler mapping to 0-100 scale
)

// Station context types for context adjustment
type StationContext int

const (
	ContextNormal   StationContext = iota // Regular station
	ContextTerminal                       // End of line station
	ContextTransfer                       // Multi-line transfer hub
)

// Terminal stations for CTA (first/last on each line)
var terminalStations = map[string]bool{
	// Red Line
	"Howard":        true,
	"95th/Dan Ryan": true,
	// Blue Line
	"O'Hare":      true,
	"Forest Park": true,
	// Brown Line
	"Kimball": true,
	// Green Line
	"Harlem/Lake":    true,
	"Cottage Grove":  true,
	"Ashland/63rd":   true,
	// Orange Line
	"Midway": true,
	// Purple Line
	"Linden": true,
	// Pink Line
	"54th/Cermak": true,
	// Yellow Line
	"Dempster-Skokie": true,
}

// ExtendedStationMetric includes additional data for composite scoring
type ExtendedStationMetric struct {
	db.StationMetric
	StdDev30d         float64        // Standard deviation of daily ridership (30-day)
	LineCount         int            // Number of lines serving the station
	StationType       StationContext // Terminal, transfer, or normal
	// Component scores for explainability (not persisted to DB)
	RidershipScore    float64
	TrendScore        float64
	VariabilityScore  float64
	ContextScore      float64
}

// ComputeGhostScores calculates multi-factor composite ghost scores for all stations
func ComputeGhostScores(dbClient *db.Client, cityCode string) error {
	// Get all station metrics with extended data
	metrics, err := getExtendedMetrics(dbClient, cityCode)
	if err != nil {
		return fmt.Errorf("failed to get station metrics: %w", err)
	}

	if len(metrics) == 0 {
		return fmt.Errorf("no stations found for city: %s", cityCode)
	}

	// Separate stations with data from those with missing data
	var stationsWithData []ExtendedStationMetric
	var stationsMissing []ExtendedStationMetric

	for _, m := range metrics {
		if m.DataStatus == "missing" {
			stationsMissing = append(stationsMissing, m)
		} else {
			stationsWithData = append(stationsWithData, m)
		}
	}

	// Calculate composite ghost scores
	if len(stationsWithData) > 0 {
		calculateCompositeScores(stationsWithData)
	}

	// Update database for stations with data
	for _, m := range stationsWithData {
		err = dbClient.UpdateStationMetrics(m.StationMetric)
		if err != nil {
			fmt.Printf("Warning: Failed to update metrics for station %s: %v\n", m.Name, err)
			continue
		}
	}

	// Set ghost score to -1 for stations with missing data
	for i := range stationsMissing {
		stationsMissing[i].GhostScore = -1
		err = dbClient.UpdateStationMetrics(stationsMissing[i].StationMetric)
		if err != nil {
			fmt.Printf("Warning: Failed to update metrics for station %s: %v\n",
				stationsMissing[i].Name, err)
			continue
		}
	}

	// Print summary
	printSummary(cityCode, stationsWithData, stationsMissing)

	return nil
}

// getExtendedMetrics fetches station metrics with additional data for composite scoring
func getExtendedMetrics(dbClient *db.Client, cityCode string) ([]ExtendedStationMetric, error) {
	// Get basic metrics
	basicMetrics, err := dbClient.GetStationMetrics(cityCode)
	if err != nil {
		return nil, err
	}

	// Get variability data (standard deviation)
	variabilityMap, err := getVariabilityData(dbClient, cityCode)
	if err != nil {
		fmt.Printf("Warning: Could not get variability data: %v\n", err)
		variabilityMap = make(map[string]float64)
	}

	// Get station context data (lines, terminal status)
	contextMap, err := getStationContext(dbClient, cityCode)
	if err != nil {
		fmt.Printf("Warning: Could not get station context: %v\n", err)
		contextMap = make(map[string]stationContextData)
	}

	// Combine into extended metrics
	extendedMetrics := make([]ExtendedStationMetric, len(basicMetrics))
	for i, m := range basicMetrics {
		extendedMetrics[i] = ExtendedStationMetric{
			StationMetric: m,
			StdDev30d:     variabilityMap[m.StationID],
			LineCount:     contextMap[m.StationID].lineCount,
			StationType:   contextMap[m.StationID].stationType,
		}
	}

	return extendedMetrics, nil
}

type stationContextData struct {
	lineCount   int
	stationType StationContext
}

// getVariabilityData calculates standard deviation of daily ridership for each station
func getVariabilityData(dbClient *db.Client, cityCode string) (map[string]float64, error) {
	// SQLite doesn't have SQRT, so we'll calculate variance and take square root in Go
	query := `
		WITH MaxDate AS (
			SELECT MAX(serviceDate) as maxDate FROM RidershipDaily
		),
		WindowedData AS (
			SELECT
				rd.stationId,
				rd.entries
			FROM RidershipDaily rd
			JOIN Station s ON s.id = rd.stationId
			JOIN City c ON c.id = s.cityId
			WHERE c.code = ?
			AND rd.serviceDate >= date((SELECT maxDate FROM MaxDate), '-30 days')
		),
		StationAverages AS (
			SELECT stationId, AVG(entries) as avgEntries
			FROM WindowedData
			GROUP BY stationId
		)
		SELECT
			w.stationId,
			AVG((w.entries - a.avgEntries) * (w.entries - a.avgEntries)) as variance
		FROM WindowedData w
		JOIN StationAverages a ON a.stationId = w.stationId
		GROUP BY w.stationId
	`

	rows, err := dbClient.Query(query, cityCode)
	if err != nil {
		return nil, fmt.Errorf("failed to query variability: %w", err)
	}
	defer rows.Close()

	result := make(map[string]float64)
	for rows.Next() {
		var stationID string
		var variance float64
		if err := rows.Scan(&stationID, &variance); err != nil {
			continue
		}
		// Calculate standard deviation from variance
		if variance >= 0 {
			result[stationID] = math.Sqrt(variance)
		}
	}

	return result, nil
}

// getStationContext retrieves station type information (lines, terminal status)
func getStationContext(dbClient *db.Client, cityCode string) (map[string]stationContextData, error) {
	query := `
		SELECT s.id, s.name, s.lines
		FROM Station s
		JOIN City c ON c.id = s.cityId
		WHERE c.code = ?
	`

	rows, err := dbClient.Query(query, cityCode)
	if err != nil {
		return nil, fmt.Errorf("failed to query station context: %w", err)
	}
	defer rows.Close()

	result := make(map[string]stationContextData)
	for rows.Next() {
		var stationID, name, linesJSON string
		if err := rows.Scan(&stationID, &name, &linesJSON); err != nil {
			continue
		}

		// Parse lines JSON
		var lines []string
		if err := json.Unmarshal([]byte(linesJSON), &lines); err != nil {
			lines = []string{}
		}

		// Determine station type
		// Note: Some stations can be both terminal and transfer (e.g., Howard)
		// We prioritize the context that would make low ridership most notable
		stationType := ContextNormal
		isTerminal := terminalStations[name]
		isTransfer := len(lines) > 1

		if isTerminal && isTransfer {
			// Station is both terminal and transfer hub
			// Use neutral context since the effects balance out
			stationType = ContextNormal
		} else if isTerminal {
			stationType = ContextTerminal
		} else if isTransfer {
			stationType = ContextTransfer
		}

		result[stationID] = stationContextData{
			lineCount:   len(lines),
			stationType: stationType,
		}
	}

	return result, nil
}

// calculateCompositeScores computes the multi-factor ghost score for each station
func calculateCompositeScores(stations []ExtendedStationMetric) {
	n := len(stations)
	if n == 0 {
		return
	}

	// Pre-calculate system-wide statistics for normalization
	var rolling30dValues []float64

	for _, s := range stations {
		rolling30dValues = append(rolling30dValues, s.Rolling30dAvg)
	}

	// Sort for percentile calculations
	sort.Float64s(rolling30dValues)

	// Calculate composite score for each station
	for i := range stations {
		// 1. Ridership Percentile (40%)
		// Lower ridership = higher ghost score
		ridershipPercentile := calculatePercentile(stations[i].Rolling30dAvg, rolling30dValues)
		ridershipScore := (1.0 - ridershipPercentile) * 100 // Invert: low ridership = high score

		// 2. Trend Score (25%)
		// Declining ridership = higher ghost score
		var trendScore float64
		if stations[i].Rolling90dAvg > 0 {
			trend := (stations[i].Rolling30dAvg - stations[i].Rolling90dAvg) / stations[i].Rolling90dAvg
			// Map trend to 0-100 scale
			// -50% decline = 100, +50% growth = 0, 0% change = 50
			trendScore = clamp((0.5 - trend) * 100, 0, 100)
		} else {
			trendScore = 50 // Neutral if no 90-day data
		}

		// 3. Variability Score (15%)
		// High coefficient of variation (erratic) = higher ghost score
		var variabilityScore float64
		if stations[i].Rolling30dAvg > 0 && stations[i].StdDev30d > 0 {
			// Use floor to prevent CV explosion on very low ridership stations
			meanWithFloor := max(stations[i].Rolling30dAvg, CVMeanFloor)
			cv := stations[i].StdDev30d / meanWithFloor
			// Cap CV at CVMax for gentler mapping
			cvCapped := min(cv, CVMax)
			// Map to 0-100 scale: CV of 0 = 0, CV of CVMax = 100
			variabilityScore = (cvCapped / CVMax) * 100
		} else {
			variabilityScore = 50 // Neutral if no data
		}

		// 4. Context Adjustment (20%)
		// Context scoring logic:
		// - Terminal stations: Lower ghost score (30) - low ridership is expected
		// - Transfer hubs: Higher ghost score (70) - low ridership is more notable
		// - Normal stations: Neutral (50)
		// - Terminal+Transfer: Neutral (50) - effects balance out
		var contextScore float64
		switch stations[i].StationType {
		case ContextTerminal:
			// Terminals often have lower ridership - reduce ghost score
			contextScore = 30 // Lower contribution
		case ContextTransfer:
			// Transfer hubs usually have higher ridership
			// If low ridership at a transfer, it's more notable
			contextScore = 70 // Higher contribution
		default:
			contextScore = 50 // Neutral for normal stations (includes terminal+transfer)
		}

		// Store component scores for explainability
		stations[i].RidershipScore = ridershipScore
		stations[i].TrendScore = trendScore
		stations[i].VariabilityScore = variabilityScore
		stations[i].ContextScore = contextScore

		// Calculate composite score
		compositeScore := (WeightRidership * ridershipScore) +
			(WeightTrend * trendScore) +
			(WeightVariability * variabilityScore) +
			(WeightContext * contextScore)

		// Clamp to 0-100 range
		ghostScore := int(clamp(compositeScore, 0, 100))

		stations[i].GhostScore = ghostScore
	}

	// Sort by ghost score (descending) for reporting
	sort.Slice(stations, func(i, j int) bool {
		return stations[i].GhostScore > stations[j].GhostScore
	})
}

// calculatePercentile returns the percentile rank (0-1) of a value in a sorted slice
// Uses binary search for O(log n) performance
// Returns 0 for the minimum value, 1 for the maximum value
// For n=1, returns 0.5 (neutral - neither high nor low)
// Uses upper-bound rank for ties to ensure extremes hit endpoints
func calculatePercentile(value float64, sortedValues []float64) float64 {
	n := len(sortedValues)
	if n == 0 {
		return 0.5
	}
	if n == 1 {
		return 0.5 // Single value is neutral
	}

	// If value is less than the minimum, return 0
	if value < sortedValues[0] {
		return 0.0
	}

	// If value is greater than the maximum, return 1
	if value > sortedValues[n-1] {
		return 1.0
	}

	// Find the lower bound position (first occurrence)
	lowerBound := sort.SearchFloat64s(sortedValues, value)

	// Find the upper bound position (position after last occurrence)
	// This handles ties by finding where value+epsilon would go
	upperBound := lowerBound
	for upperBound < n && sortedValues[upperBound] == value {
		upperBound++
	}

	// Use upper-bound rank: count of values <= our value
	// Subtract 1 because we want rank starting from 0
	countLE := upperBound

	// Map to [0,1] range where min->0 and max->1
	// Using (countLE - 1) / (n - 1) ensures this property
	return float64(countLE-1) / float64(n-1)
}

// clamp restricts a value to a given range
func clamp(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// printSummary outputs the ghost score calculation results
func printSummary(cityCode string, stationsWithData []ExtendedStationMetric, stationsMissing []ExtendedStationMetric) {
	fmt.Printf("\n=== Ghost Score Summary for %s ===\n", cityCode)
	fmt.Printf("Algorithm: Multi-Factor Composite Score\n")
	fmt.Printf("Weights: Ridership=%.0f%%, Trend=%.0f%%, Variability=%.0f%%, Context=%.0f%%\n\n",
		WeightRidership*100, WeightTrend*100, WeightVariability*100, WeightContext*100)

	total := len(stationsWithData) + len(stationsMissing)
	fmt.Printf("Total stations: %d\n", total)
	fmt.Printf("Stations with ridership data: %d\n", len(stationsWithData))
	fmt.Printf("Stations with MISSING data: %d\n", len(stationsMissing))

	zeroAvgCount := 0
	for _, s := range stationsWithData {
		if s.Rolling30dAvg <= 0 {
			zeroAvgCount++
		}
	}
	if zeroAvgCount > 0 {
		fmt.Printf("⚠️  WARNING: %d stations have zero/negative rolling30dAvg.\n", zeroAvgCount)
	}

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
		fmt.Printf("\n🔝 Top 10 Ghost Stations (highest composite score):\n")
		fmt.Printf("%-3s %-30s %6s %10s %8s %8s\n", "#", "Station", "Score", "30d Avg", "Trend", "Type")
		fmt.Printf("%s\n", "────────────────────────────────────────────────────────────────────────")

		for i := 0; i < 10 && i < len(stationsWithData); i++ {
			s := stationsWithData[i]
			typeLabel := "Normal"
			if s.StationType == ContextTerminal {
				typeLabel = "Terminal"
			} else if s.StationType == ContextTransfer {
				typeLabel = "Transfer"
			}

			// Calculate trend for display
			var trendStr string
			if s.Rolling90dAvg > 0 {
				trend := (s.Rolling30dAvg - s.Rolling90dAvg) / s.Rolling90dAvg * 100
				if trend < 0 {
					trendStr = fmt.Sprintf("%.1f%%", trend)
				} else {
					trendStr = fmt.Sprintf("+%.1f%%", trend)
				}
			} else {
				trendStr = "N/A"
			}

			fmt.Printf("%-3d %-30s %6d %10.0f %8s %8s\n",
				i+1, truncate(s.Name, 30), s.GhostScore, s.Rolling30dAvg, trendStr, typeLabel)
		}

		// Add component breakdown for explainability
		fmt.Printf("\n📊 Component Score Breakdown (Top 10):\n")
		fmt.Printf("%-3s %-30s %5s %5s %5s %7s %7s\n", "#", "Station", "Score", "Rider", "Trend", "Variab", "Context")
		fmt.Printf("%s\n", "────────────────────────────────────────────────────────────────────────────")

		for i := 0; i < 10 && i < len(stationsWithData); i++ {
			s := stationsWithData[i]
			fmt.Printf("%-3d %-30s %5d %5.0f %5.0f %7.0f %7.0f\n",
				i+1, truncate(s.Name, 30), s.GhostScore,
				s.RidershipScore, s.TrendScore, s.VariabilityScore, s.ContextScore)
		}

		fmt.Printf("\n📈 Top 5 Busiest Stations (lowest ghost score):\n")
		// Sort by ghost score ascending for busiest
		busiest := make([]ExtendedStationMetric, len(stationsWithData))
		copy(busiest, stationsWithData)
		sort.Slice(busiest, func(i, j int) bool {
			return busiest[i].GhostScore < busiest[j].GhostScore
		})

		for i := 0; i < 5 && i < len(busiest); i++ {
			s := busiest[i]
			fmt.Printf("%d. %s - Ghost Score: %d (30-day avg: %.0f rides)\n",
				i+1, s.Name, s.GhostScore, s.Rolling30dAvg)
		}
	}
}

// truncate shortens a string to maxLen characters
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// min returns the minimum of two float64 values
func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// max returns the maximum of two float64 values
func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
