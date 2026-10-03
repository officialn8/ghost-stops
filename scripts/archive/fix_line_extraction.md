# Fix for Line Extraction in GTFS Import

## Problem
The `go-etl/internal/chicago/gtfs.go` file tries to extract line information from the `stop_desc` field (lines 173-191), but CTA's GTFS data has the line info in the `stop_name` field.

## Station Name Patterns in CTA GTFS
- "Austin-Blue" → Austin station on Blue Line
- "Harlem-Green" → Harlem station on Green Line
- "Jackson-Blue" → Jackson station on Blue Line
- etc.

## Required Fix
In `gtfs.go`, around line 172, replace the line extraction logic:

```go
// OLD: Try to extract line info from stop_desc
if desc, ok := stop["stop_desc"]; ok {
    // ... existing code ...
}

// NEW: Extract line info from stop_name
stopName := stop["stop_name"]
if strings.Contains(stopName, "-") {
    parts := strings.Split(stopName, "-")
    if len(parts) >= 2 {
        lineIdentifier := parts[len(parts)-1]

        // Map common identifiers to full line names
        lineMapping := map[string]string{
            "Red": "Red",
            "Blue": "Blue",
            "Brown": "Brown",
            "Green": "Green",
            "Orange": "Orange",
            "Purple": "Purple",
            "Pink": "Pink",
            "Yellow": "Yellow",
            "O'Hare": "Blue",  // Blue Line O'Hare branch
            "Forest Park": "Blue",  // Blue Line Forest Park branch
            "Dan Ryan": "Red",  // Red Line Dan Ryan branch
            // Add more mappings as needed
        }

        if lineName, ok := lineMapping[lineIdentifier]; ok {
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
```

## Alternative: Database Update Script
Since we already have the data imported, we could also create a SQL script to update the lines based on station names.