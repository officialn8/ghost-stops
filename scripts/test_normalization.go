package main

import (
	"fmt"
	"regexp"
	"strings"
)

// NormalizeStationName normalizes a station name for matching
func NormalizeStationName(name string) string {
	// Convert to lowercase
	normalized := strings.ToLower(name)

	// Replace & with and
	normalized = strings.ReplaceAll(normalized, "&", "and")

	// Normalize slashes and hyphens to spaces
	normalized = strings.ReplaceAll(normalized, "/", " ")
	normalized = strings.ReplaceAll(normalized, "-", " ")

	// Remove all punctuation
	reg := regexp.MustCompile(`[^\w\s]`)
	normalized = reg.ReplaceAllString(normalized, "")

	// Remove the word "station"
	reg = regexp.MustCompile(`\bstation\b`)
	normalized = reg.ReplaceAllString(normalized, "")

	// Collapse multiple spaces to single space
	reg = regexp.MustCompile(`\s+`)
	normalized = reg.ReplaceAllString(normalized, " ")

	// Trim whitespace
	return strings.TrimSpace(normalized)
}

func main() {
	// Test problematic station names from Socrata
	testNames := []string{
		"O'Hare Airport",
		"Midway Airport",
		"Monroe/State",
		"Monroe/Dearborn",
		"95th/Dan Ryan",
		"Chicago/Milwaukee",
		"Belmont-O'Hare",
		"Irving Park-O'Hare",
	}

	fmt.Println("Testing station name normalization:")
	fmt.Println("==================================")
	for _, name := range testNames {
		normalized := NormalizeStationName(name)
		fmt.Printf("%-25s -> %s\n", name, normalized)
	}
}