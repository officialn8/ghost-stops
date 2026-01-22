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
	var minDate, maxDate sql.NullTime
	query := `
		SELECT MIN(serviceDate), MAX(serviceDate)
		FROM RidershipDaily rd
		JOIN Station s ON s.id = rd.stationId
		JOIN City c ON c.id = s.cityId
		WHERE c.code = ?`

	err := c.db.QueryRow(query, cityCode).Scan(&minDate, &maxDate)
	if err != nil {
		if err == sql.ErrNoRows {
			return time.Time{}, time.Time{}, nil
		}
		return time.Time{}, time.Time{}, fmt.Errorf("failed to query min/max service dates: %w", err)
	}

	var min, max time.Time
	if minDate.Valid {
		min = minDate.Time
	}
	if maxDate.Valid {
		max = maxDate.Time
	}

	return min, max, nil
}


// GetMaxServiceDate returns the most recent service date for a city
func (c *Client) GetMaxServiceDate(cityCode string) (time.Time, error) {
	var maxDate sql.NullTime
	query := `
		SELECT MAX(rd.serviceDate)
		FROM RidershipDaily rd
		JOIN Station s ON s.id = rd.stationId
		JOIN City c ON c.id = s.cityId
		WHERE c.code = ?`

	err := c.db.QueryRow(query, cityCode).Scan(&maxDate)
	if err != nil {
		if err == sql.ErrNoRows {
			return time.Time{}, nil // No records, return zero time
		}
		return time.Time{}, fmt.Errorf("failed to query max service date: %w", err)
	}

	if maxDate.Valid {
		return maxDate.Time, nil
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
			serviceDateMax
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
			ghostScore, lastUpdated, serviceDateMax
		) VALUES (
			COALESCE(
				(SELECT id FROM StationMetrics WHERE stationId = ?),
				lower(hex(randomblob(16)))
			),
			?, ?, ?, ?, ?, datetime('now'), ?
		)`,
		m.StationID,
		m.StationID, m.LastDayEntries, m.Rolling30dAvg, m.Rolling90dAvg,
		m.GhostScore, m.ServiceDateMax,
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
}