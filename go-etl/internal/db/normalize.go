package db

import (
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