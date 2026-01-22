package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Client struct {
	db *sql.DB
}

func NewClient(databaseURL string) (*Client, error) {
	// Handle Prisma-style SQLite URLs
	if strings.HasPrefix(databaseURL, "file:") {
		databaseURL = strings.TrimPrefix(databaseURL, "file:")
	}

	db, err := sql.Open("sqlite3", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Client{db: db}, nil
}

func (c *Client) Close() error {
	return c.db.Close()
}

// Query executes a query that returns rows.
func (c *Client) Query(query string, args ...interface{}) (*sql.Rows, error) {
	return c.db.Query(query, args...)
}

// GetCityID returns the city ID for a given city code, creating it if necessary
func (c *Client) GetCityID(code, name string) (string, error) {
	var id string

	// Try to find existing city
	err := c.db.QueryRow("SELECT id FROM City WHERE code = ?", code).Scan(&id)
	if err == nil {
		return id, nil
	}

	if err != sql.ErrNoRows {
		return "", fmt.Errorf("error querying city: %w", err)
	}

	// Create new city with UUID
	// SQLite doesn't have uuid() function, so we'll use a simple approach
	_, err = c.db.Exec(
		"INSERT INTO City (id, code, name) VALUES (lower(hex(randomblob(16))), ?, ?)",
		code, name,
	)
	if err != nil {
		return "", fmt.Errorf("failed to create city: %w", err)
	}

	// Get the created city's ID
	err = c.db.QueryRow("SELECT id FROM City WHERE code = ?", code).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("failed to get created city ID: %w", err)
	}

	return id, nil
}

// UpsertStation creates or updates a station
func (c *Client) UpsertStation(cityID, externalID, name string, lat, lon float64, lines string) error {
	// Try to update existing station
	result, err := c.db.Exec(`
		UPDATE Station
		SET name = ?, latitude = ?, longitude = ?, lines = ?
		WHERE cityId = ? AND externalId = ?`,
		name, lat, lon, lines, cityID, externalID,
	)
	if err != nil {
		return fmt.Errorf("failed to update station: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected > 0 {
		return nil
	}

	// Insert new station
	_, err = c.db.Exec(`
		INSERT INTO Station (id, cityId, externalId, name, latitude, longitude, lines)
		VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)`,
		cityID, externalID, name, lat, lon, lines,
	)
	if err != nil {
		return fmt.Errorf("failed to insert station: %w", err)
	}

	return nil
}

// GetStationIDByExternalID finds a station's UUID by its external (GTFS) ID.
func (c *Client) GetStationIDByExternalID(cityID, externalID string) (string, error) {
	var id string
	err := c.db.QueryRow(`
		SELECT id
		FROM Station
		WHERE cityId = ? AND externalId = ?`,
		cityID, externalID,
	).Scan(&id)

	if err != nil {
		return "", fmt.Errorf("could not find station with external ID %s: %w", externalID, err)
	}

	return id, nil
}

// GetStationIDByCtaStationId finds a station's UUID by its CTA station ID.
func (c *Client) GetStationIDByCtaStationId(cityID, ctaStationId string) (string, error) {
	var id string
	err := c.db.QueryRow(`
		SELECT id
		FROM Station
		WHERE cityId = ? AND ctaStationId = ?`,
		cityID, ctaStationId,
	).Scan(&id)

	if err != nil {
		return "", fmt.Errorf("could not find station with CTA station ID %s: %w", ctaStationId, err)
	}

	return id, nil
}

// UpdateStationCtaStationId updates a station's CTA station ID.
func (c *Client) UpdateStationCtaStationId(stationID, ctaStationId string) error {
	_, err := c.db.Exec(`
		UPDATE Station
		SET ctaStationId = ?
		WHERE id = ?`,
		ctaStationId, stationID,
	)
	if err != nil {
		return fmt.Errorf("failed to update station CTA ID: %w", err)
	}
	return nil
}

// GetStationIDByName finds a station ID by city and normalized name
func (c *Client) GetStationIDByName(cityID, normalizedName string) (string, error) {
	var id string

	// First try exact match on normalized name in StationAlias
	err := c.db.QueryRow(`
		SELECT s.id
		FROM Station s
		JOIN StationAlias sa ON sa.stationId = s.id
		WHERE s.cityId = ? AND sa.normalized = ?
		LIMIT 1`,
		cityID, normalizedName,
	).Scan(&id)

	if err == nil {
		return id, nil
	}

	// If no alias found, try direct station name match
	// We'll need to normalize station names for comparison
	rows, err := c.db.Query(`
		SELECT id, name
		FROM Station
		WHERE cityId = ?`,
		cityID,
	)
	if err != nil {
		return "", fmt.Errorf("failed to query stations: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var stationID, stationName string
		if err := rows.Scan(&stationID, &stationName); err != nil {
			continue
		}

		// Normalize and compare
		if NormalizeStationName(stationName) == normalizedName {
			return stationID, nil
		}
	}

	return "", sql.ErrNoRows
}

// CreateStationAlias creates an alias for a station
func (c *Client) CreateStationAlias(stationID, aliasName, normalized string) error {
	_, err := c.db.Exec(`
		INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
		VALUES (lower(hex(randomblob(16))), ?, ?, ?)`,
		stationID, aliasName, normalized,
	)
	return err
}


// GetAllStationAliases retrieves all aliases for a given city
func (c *Client) GetAllStationAliases(cityID string) (map[string]string, error) {
	rows, err := c.db.Query(`
		SELECT sa.normalized, sa.stationId
		FROM StationAlias sa
		JOIN Station s ON s.id = sa.stationId
		WHERE s.cityId = ?`,
		cityID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query aliases: %w", err)
	}
	defer rows.Close()

	aliases := make(map[string]string)
	for rows.Next() {
		var normalized, stationID string
		if err := rows.Scan(&normalized, &stationID); err != nil {
			return nil, fmt.Errorf("failed to scan alias row: %w", err)
		}
		aliases[normalized] = stationID
	}

	return aliases, nil
}


// GetAllStationNames retrieves all station names for a given city
func (c *Client) GetAllStationNames(cityID string) ([]string, error) {
	rows, err := c.db.Query("SELECT name FROM Station WHERE cityId = ?", cityID)
	if err != nil {
		return nil, fmt.Errorf("failed to query station names: %w", err)
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("failed to scan station name: %w", err)
		}
		names = append(names, name)
	}

	return names, nil
}

// GetStationNamesAndIDs retrieves all station IDs and names for a given city
func (c *Client) GetStationNamesAndIDs(cityID string) (map[string]string, error) {
	rows, err := c.db.Query("SELECT id, name FROM Station WHERE cityId = ?", cityID)
	if err != nil {
		return nil, fmt.Errorf("failed to query stations: %w", err)
	}
	defer rows.Close()

	stations := make(map[string]string) // normalized name -> station ID
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("failed to scan station: %w", err)
		}
		normalized := NormalizeStationName(name)
		stations[normalized] = id
	}

	return stations, rows.Err()
}

// GetStationCountWithRidershipInWindow returns the number of stations with ridership data in the given window
func (c *Client) GetStationCountWithRidershipInWindow(cityID string, days int) (int, error) {
	query := `
		SELECT COUNT(DISTINCT s.id)
		FROM Station s
		WHERE s.cityId = ?
		AND EXISTS (
			SELECT 1
			FROM RidershipDaily rd
			WHERE rd.stationId = s.id
			AND rd.serviceDate >= date('now', '-' || ? || ' days')
		)`

	var count int
	err := c.db.QueryRow(query, cityID, days).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to get station count with ridership: %w", err)
	}
	return count, nil
}

// RidershipRecord represents a single entry for batch insertion
type RidershipRecord struct {
	StationID   string
	ServiceDate string
	Entries     int
}

// InsertRidershipDailyBatch inserts multiple ridership records in a transaction
func (c *Client) InsertRidershipDailyBatch(records []RidershipRecord) error {
	tx, err := c.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	stmt, err := tx.Prepare(`
		INSERT INTO RidershipDaily (id, stationId, serviceDate, entries)
		VALUES (lower(hex(randomblob(16))), ?, ?, ?)
		ON CONFLICT(stationId, serviceDate) DO UPDATE SET
		entries = excluded.entries
	`)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, r := range records {
		_, err := stmt.Exec(r.StationID, r.ServiceDate, r.Entries)
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to execute statement for station %s on %s: %w", r.StationID, r.ServiceDate, err)
		}
	}

	return tx.Commit()
}

// PruneRidership deletes ridership data older than a given number of days relative to the max service date
func (c *Client) PruneRidership(cityCode string, retentionDays int) (int64, error) {
	// Safety check: ensure there's data to prune
	maxDate, err := c.GetMaxServiceDate(cityCode)
	if err != nil {
		return 0, fmt.Errorf("could not get max service date for pruning: %w", err)
	}
	if maxDate.IsZero() {
		return 0, nil // Nothing to prune
	}

	query := `
		DELETE FROM RidershipDaily
		WHERE date(serviceDate) < date(?, printf('-%d day', ?))
		AND stationId IN (
			SELECT s.id
			FROM Station s
			JOIN City c ON c.id = s.cityId
			WHERE c.code = ?
		)`

	result, err := c.db.Exec(query, maxDate, retentionDays, cityCode)
	if err != nil {
		return 0, fmt.Errorf("failed to prune ridership data: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get affected rows: %w", err)
	}

	return rowsAffected, nil
}

// GetRidershipDailyCount returns the total number of rows in RidershipDaily for a city
func (c *Client) GetRidershipDailyCount(cityCode string) (int, error) {
	var count int
	query := `
		SELECT COUNT(*)
		FROM RidershipDaily rd
		JOIN Station s ON s.id = rd.stationId
		JOIN City c ON c.id = s.cityId
		WHERE c.code = ?`

	err := c.db.QueryRow(query, cityCode).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to get ridership daily count: %w", err)
	}
	return count, nil
}

// GetRidershipDailyMinMaxDates returns the min and max service dates for a city
func (c *Client) GetRidershipDailyMinMaxDates(cityCode string) (time.Time, time.Time, error) {
	var minDateStr, maxDateStr sql.NullString
	query := `
		SELECT MIN(datetime(serviceDate)), MAX(datetime(serviceDate))
		FROM RidershipDaily rd
		JOIN Station s ON s.id = rd.stationId
		JOIN City c ON c.id = s.cityId
		WHERE c.code = ?`

	err := c.db.QueryRow(query, cityCode).Scan(&minDateStr, &maxDateStr)
	if err != nil {
		if err == sql.ErrNoRows {
			return time.Time{}, time.Time{}, nil
		}
		return time.Time{}, time.Time{}, fmt.Errorf("failed to query min/max service dates: %w", err)
	}

	var min, max time.Time
	if minDateStr.Valid && minDateStr.String != "" {
		parsedTime, err := time.Parse("2006-01-02 15:04:05", minDateStr.String)
		if err != nil {
			parsedTime, err = time.Parse(time.RFC3339, minDateStr.String)
			if err == nil {
				min = parsedTime
			}
		} else {
			min = parsedTime
		}
	}
	if maxDateStr.Valid && maxDateStr.String != "" {
		parsedTime, err := time.Parse("2006-01-02 15:04:05", maxDateStr.String)
		if err != nil {
			parsedTime, err = time.Parse(time.RFC3339, maxDateStr.String)
			if err == nil {
				max = parsedTime
			}
		} else {
			max = parsedTime
		}
	}

	return min, max, nil
}


// GetMaxServiceDate returns the most recent service date for a city
func (c *Client) GetMaxServiceDate(cityCode string) (time.Time, error) {
	var maxDateStr sql.NullString
	query := `
		SELECT MAX(datetime(rd.serviceDate))
		FROM RidershipDaily rd
		JOIN Station s ON s.id = rd.stationId
		JOIN City c ON c.id = s.cityId
		WHERE c.code = ?`

	err := c.db.QueryRow(query, cityCode).Scan(&maxDateStr)
	if err != nil {
		if err == sql.ErrNoRows {
			return time.Time{}, nil // No records, return zero time
		}
		return time.Time{}, fmt.Errorf("failed to query max service date: %w", err)
	}

	if maxDateStr.Valid && maxDateStr.String != "" {
		// Parse the datetime string
		parsedTime, err := time.Parse("2006-01-02 15:04:05", maxDateStr.String)
		if err != nil {
			// Try RFC3339 format as fallback
			parsedTime, err = time.Parse(time.RFC3339, maxDateStr.String)
			if err != nil {
				return time.Time{}, fmt.Errorf("failed to parse max service date: %w", err)
			}
		}
		return parsedTime, nil
	}

	return time.Time{}, nil // No records, return zero time
}

// GetStationMetrics retrieves metrics for all stations in a city
func (c *Client) GetStationMetrics(cityCode string) ([]StationMetric, error) {
	query := `
		WITH MaxDate AS (
			SELECT MAX(serviceDate) as maxDate
			FROM RidershipDaily
		),
		RollingAverages AS (
			SELECT
				s.id as stationId,
				s.name,
				COUNT(rd.id) as ridershipCount,
				AVG(CASE
					WHEN rd.serviceDate >= date((SELECT maxDate FROM MaxDate), '-30 days')
					THEN rd.entries
				END) as rolling30dAvg,
				AVG(CASE
					WHEN rd.serviceDate >= date((SELECT maxDate FROM MaxDate), '-90 days')
					THEN rd.entries
				END) as rolling90dAvg,
				MAX(rd.entries) as lastDayEntries,
				MAX(rd.serviceDate) as serviceDateMax
			FROM Station s
			JOIN City c ON c.id = s.cityId
			LEFT JOIN RidershipDaily rd ON rd.stationId = s.id
			WHERE c.code = ?
			GROUP BY s.id, s.name
		)
		SELECT
			stationId,
			name,
			COALESCE(rolling30dAvg, 0) as rolling30dAvg,
			COALESCE(rolling90dAvg, 0) as rolling90dAvg,
			COALESCE(lastDayEntries, 0) as lastDayEntries,
			serviceDateMax,
			CASE
				WHEN ridershipCount = 0 THEN 'missing'
				ELSE 'normal'
			END as dataStatus
		FROM RollingAverages
		ORDER BY rolling30dAvg ASC`

	rows, err := c.db.Query(query, cityCode)
	if err != nil {
		return nil, fmt.Errorf("failed to query metrics: %w", err)
	}
	defer rows.Close()

	var metrics []StationMetric
	for rows.Next() {
		var m StationMetric
		var serviceDateMax sql.NullString

		err := rows.Scan(
			&m.StationID,
			&m.Name,
			&m.Rolling30dAvg,
			&m.Rolling90dAvg,
			&m.LastDayEntries,
			&serviceDateMax,
			&m.DataStatus,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		if serviceDateMax.Valid {
			m.ServiceDateMax = serviceDateMax.String
		}

		metrics = append(metrics, m)
	}

	return metrics, nil
}

// UpdateStationMetrics updates or inserts station metrics
func (c *Client) UpdateStationMetrics(m StationMetric) error {
	_, err := c.db.Exec(`
		INSERT OR REPLACE INTO StationMetrics (
			id, stationId, lastDayEntries, rolling30dAvg, rolling90dAvg,
			ghostScore, lastUpdated, serviceDateMax, dataStatus
		) VALUES (
			COALESCE(
				(SELECT id FROM StationMetrics WHERE stationId = ?),
				lower(hex(randomblob(16)))
			),
			?, ?, ?, ?, ?, datetime('now'), ?, ?
		)`,
		m.StationID,
		m.StationID, m.LastDayEntries, m.Rolling30dAvg, m.Rolling90dAvg,
		m.GhostScore, m.ServiceDateMax, m.DataStatus,
	)
	return err
}

// StationMetric represents station ridership metrics
type StationMetric struct {
	StationID      string
	Name           string
	LastDayEntries int
	Rolling30dAvg  float64
	Rolling90dAvg  float64
	GhostScore     int
	ServiceDateMax string
	DataStatus     string // "normal", "missing"
}