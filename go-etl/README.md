# Ghost Stops Go ETL

ETL tool for ingesting transit data and computing ghost scores.

## Prerequisites

- Go 1.21 or later
- SQLite database (configured via Prisma in parent project)
- Environment variable: `DATABASE_URL` (e.g., `file:../prisma/dev.db`)

## Installation

```bash
cd go-etl
go mod download
go build -o go-etl ./cmd/go-etl
```

## Usage

### Commands

#### 1. Ingest GTFS Data

```bash
go run ./cmd/go-etl gtfs --city=chicago --source=<url-or-file>

# Example with CTA GTFS
go run ./cmd/go-etl gtfs \
  --city=chicago \
  --source=https://www.transitchicago.com/downloads/sch_data/google_transit.zip
```

#### 2. Ingest Ridership Data

```bash
go run ./cmd/go-etl ridership --city=chicago --source=<url-or-file>

# Example with local CSV
go run ./cmd/go-etl ridership \
  --city=chicago \
  --source=./data/cta-ridership-2024.csv
```

#### 3. Compute Ghost Scores

```bash
go run ./cmd/go-etl compute --city=chicago
```

#### 4. Run All Steps

```bash
go run ./cmd/go-etl all \
  --city=chicago \
  --gtfs=<gtfs-source> \
  --ridership=<ridership-source>
```

## Data Sources

### Chicago CTA

- **GTFS**: https://www.transitchicago.com/developers/gtfs/
- **Ridership**: https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f

## How It Works

1. **GTFS Ingestion**:
   - Downloads/reads GTFS zip file
   - Extracts rail stations from stops.txt
   - Identifies CTA lines from stop descriptions
   - Creates City and Station records

2. **Ridership Ingestion**:
   - Parses CSV data with daily station entries
   - Normalizes station names for matching
   - Maps ridership data to GTFS stations
   - Creates RidershipDaily records
   - Generates unmatched stations report

3. **Ghost Score Computation**:
   - Calculates 30-day and 90-day rolling averages
   - Ranks stations by ridership
   - Assigns ghost scores (0-100, higher = less ridership)
   - Updates StationMetrics table

## Station Name Normalization

Station names are normalized using these rules:
- Convert to lowercase
- Replace "&" with "and"
- Remove punctuation (except hyphens)
- Collapse multiple spaces
- Trim whitespace

Examples:
- "Clark/Lake" → "clark lake"
- "O'Hare" → "ohare"
- "Washington & Wabash" → "washington and wabash"

## Database Schema

The ETL populates these tables:

- `City`: Transit agencies/cities
- `Station`: Rail stations with coordinates and lines
- `StationAlias`: Alternative names for matching
- `RidershipDaily`: Daily ridership entries
- `StationMetrics`: Computed metrics and ghost scores

## Development

```bash
# Run with local database
export DATABASE_URL="file:../prisma/dev.db"
go run ./cmd/go-etl/main.go [command]

# Run tests
go test ./...

# Build binary
go build -o go-etl ./cmd/go-etl
```

## Troubleshooting

1. **Database connection errors**: Ensure `DATABASE_URL` is set correctly
2. **Unmatched stations**: Check `docs/chicago-unmatched-stations.md`
3. **No data appearing**: Verify GTFS ingestion completed before ridership
4. **Ghost scores all 0**: Run compute command after ridership data is loaded