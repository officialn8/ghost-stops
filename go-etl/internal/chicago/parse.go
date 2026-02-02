package chicago

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

var supportedDateLayouts = []string{
	time.RFC3339,
	"2006-01-02T15:04:05.000",
	"2006-01-02T15:04:05",
	"2006-01-02",
	"01/02/2006",
}

func parseServiceDate(value string) (time.Time, error) {
	clean := strings.TrimSpace(value)
	if clean == "" {
		return time.Time{}, fmt.Errorf("empty date value")
	}

	for _, layout := range supportedDateLayouts {
		if parsed, err := time.Parse(layout, clean); err == nil {
			return parsed, nil
		}
	}

	return time.Time{}, fmt.Errorf("unsupported date format: %s", clean)
}

func parseRides(value string) (int, error) {
	clean := strings.TrimSpace(value)
	if clean == "" {
		return 0, fmt.Errorf("empty rides value")
	}
	rides, err := strconv.Atoi(clean)
	if err != nil {
		return 0, fmt.Errorf("invalid rides value: %s", clean)
	}
	if rides < 0 {
		return 0, fmt.Errorf("negative rides value: %d", rides)
	}
	return rides, nil
}
