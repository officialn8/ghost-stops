# Ghost Stops

A map-based web application that identifies low-ridership "ghost" transit stations using official data sources. Currently featuring Chicago CTA rail stations.

![Ghost Stops Screenshot](docs/screenshot.png)

## Features

- Interactive map showing all CTA rail stations in Chicago
- Ghost Score (0-100) indicating how "ghostly" a station is based on ridership
- Color-coded stations: red for ghost stations, green for busy stations
- Top 25 ghost stations sidebar
- Station detail view with ridership trends
- Data-driven insights using official CTA ridership data

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Map**: Mapbox GL JS with react-map-gl
- **Database**: SQLite with Prisma ORM
- **ETL**: Go CLI for data ingestion and processing
- **UI Components**: Radix UI, shadcn/ui

## Prerequisites

- Node.js 18+
- Go 1.21+ (for ETL)
- Mapbox API token

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create a `.env` file:

```bash
# Database
DATABASE_URL="file:./prisma/dev.db"

# Mapbox (required for map display)
NEXT_PUBLIC_MAPBOX_TOKEN="your-mapbox-token-here"

# CTA API (optional, for real-time arrivals)
CTA_API_KEY="your-cta-api-key-here"
```

### 3. Database Setup

```bash
# Run migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate
```

### 4. Load Chicago Data

First, install Go dependencies:

```bash
cd go-etl
go mod download
cd ..
```

Then run the ETL to load Chicago CTA data:

```bash
# Set database URL
export DATABASE_URL="file:./prisma/dev.db"

# Run all ETL steps for initial setup
cd go-etl
go run ./cmd/go-etl all \
  --city=chicago \
  --gtfs=https://www.transitchicago.com/downloads/sch_data/google_transit.zip \
  --ridership=https://data.cityofchicago.org/api/views/5neh-572f/rows.csv
```

**Note:** The `all` command is intended for initial data loading. For ongoing daily updates, use the `sync-ridership` command as described in the "Hybrid Data Sync" section.

### 5. Start Development Server

```bash
npm run dev -- --turbo
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Data Sources

- **CTA GTFS**: https://www.transitchicago.com/developers/gtfs/
- **CTA Ridership**: https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f

## How Ghost Scores Work

The Ghost Score (0-100) is calculated based on ridership percentiles:

- **100**: Stations with the lowest ridership (most "ghostly")
- **50**: Median ridership stations
- **0**: Stations with the highest ridership (least "ghostly")

Scores are based on 30-day rolling averages to smooth out daily variations.

## API Endpoints

- `GET /api/chicago/stations` - List all stations with ghost scores
- `GET /api/chicago/stations/[id]` - Station details with 90-day ridership
- `GET /api/chicago/stations/[id]/arrivals` - Real-time arrivals (if configured)

## Development

### Database Management

```bash
# View database
npx prisma studio

# Reset database
npx prisma migrate reset
```

### ETL Commands

```bash
cd go-etl

# Load only GTFS data
go run ./cmd/go-etl gtfs --city=chicago --source=<file-or-url>

# Load only ridership data
go run ./cmd/go-etl ridership --city=chicago --source=<file-or-url>

# Compute ghost scores
go run ./cmd/go-etl compute --city=chicago
```

### Hybrid Data Sync

To keep the local ridership data up-to-date, you can use the `sync-ridership` command. This command fetches the latest data from the Socrata API, updates the local database, and prunes old records.

```bash
# Set environment variables
export DATABASE_URL="file:./prisma/dev.db"
export CHICAGO_DATA_APP_TOKEN="YOUR_APP_TOKEN"

cd go-etl

# Sync ridership data
go run ./cmd/go-etl sync-ridership

# Re-compute metrics after syncing
go run ./cmd/go-etl compute
```

For more details on the sync architecture, see [docs/hybrid-sync.md](./docs/hybrid-sync.md).

### Adding New Cities

1. Update the schema to support new city data
2. Add city-specific ETL in `go-etl/internal/<city>/`
3. Create API routes under `/api/<city>/`
4. Update UI to handle multiple cities

## Known Issues

- Some CTA station names may not match between GTFS and ridership data
- Check `docs/chicago-unmatched-stations.md` after ETL runs
- Real-time arrivals require CTA API key

## Future Enhancements

- Historical ghost score trends
- Peak vs off-peak analysis
- Multi-city support (NYC, SF, DC)
- Station accessibility information
- Demographic overlays

## License

MIT
