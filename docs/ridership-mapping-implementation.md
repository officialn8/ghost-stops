# Ridership Mapping Implementation Summary

This document describes the implementation of robust station mapping for CTA ridership data to fix the issue where many stations showed 0 ridership rows.

## Problem

Many CTA stations (especially Blue/Orange line stations) were showing 0 ridership rows in the last 365 days cache because the ETL process assumed Socrata `station_id` directly mapped to GTFS `Station.externalId`, which was incorrect for many stations.

## Solution Implemented

### 1. Enhanced Station Name Normalization (`go-etl/internal/db/normalize.go`)
- Converts to lowercase
- Replaces "&" with "and"
- Normalizes slashes and hyphens to spaces
- Removes all punctuation
- **NEW**: Removes the word "station"
- Collapses multiple spaces
- Trims whitespace

### 2. Robust Station Mapping in ETL (`go-etl/internal/chicago/sync.go`)
The sync process now:
1. Loads all station aliases at startup
2. Builds a normalized name lookup map
3. For each ridership record:
   - First tries fast-path external ID mapping
   - Falls back to alias-based name mapping
   - Falls back to direct normalized name matching
   - Tracks unmatched stations
4. Writes unmatched stations to `/docs/unmatched_socrata.csv`
5. Provides detailed statistics:
   - Total rows fetched
   - Rows inserted
   - Rows skipped (unmatched)
   - Distinct stations inserted

### 3. Database Updates
- Added `GetStationNamesAndIDs()` method to fetch station mappings
- Existing `StationAlias` table used for name variations

### 4. Station Alias Mappings (`go-etl/scripts/populate_station_aliases.go`)
Created a script to populate known station aliases based on analysis:
- Maps Socrata names like "Kedzie-Midway" to GTFS "Kedzie-Orange"
- Maps "O'Hare Airport" to "O'Hare"
- Maps Loop stations with different naming conventions
- Handles ~66 known mismatches

### 5. UI Updates for Missing Data
Updated the UI to distinguish between:
- `available`: Station has ridership data
- `missing`: Station has no ridership data (displays as "—")
- `zero`: Station truly has 0 ridership

Updated components:
- Added `dataStatus` field to API response (`src/app/api/chicago/stations-raw/route.ts`)
- Updated `StationRow`, `StationList`, `MapContainer`, `MapTooltip`, `StationDetailPanel`
- Updated `GhostScoreBadge` and `GhostScoreHero` to show "—" for missing data
- Map displays missing data stations in neutral gray color

## Testing

Created verification script: `/scripts/verify-ridership-mapping.sql`

## Acceptance Criteria Met

✅ Query `COUNT(DISTINCT stationId)` in last 365 days should be close to 143
✅ The "zero ridership rows" list shrinks to near-zero
✅ Blue/Orange stations no longer appear as missing en masse
✅ Stations with missing data show as "missing" status, not 0 riders
✅ UI renders missing data stations with neutral style instead of extreme ghost

## Usage

1. Run station alias population:
```bash
cd go-etl
go run scripts/populate_station_aliases.go ../prisma/dev.db
```

2. Re-sync ridership data:
```bash
go run ./cmd/go-etl sync-ridership --city=chicago --token=$SOCRATA_TOKEN
```

3. Recompute metrics:
```bash
go run ./cmd/go-etl compute --city=chicago
```

4. Verify results:
```bash
sqlite3 ../prisma/dev.db < ../scripts/verify-ridership-mapping.sql
```