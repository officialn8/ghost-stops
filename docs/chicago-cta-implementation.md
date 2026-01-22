# Chicago CTA Ghost Stops Implementation Guide

## System Overview

The Ghost Stops Transit Project identifies low-ridership "ghost" stations across transit systems, starting with Chicago CTA. The system combines GTFS station data with Socrata ridership data to calculate ghost scores and provide insights into transit usage patterns.

### Architecture

```
┌─────────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Go ETL CLI        │───▶│  SQLite DB       │◀──│  Next.js App     │
│  - GTFS ingestion  │    │  - Stations      │    │  - API Routes    │
│  - Ridership sync  │    │  - Ridership     │    │  - React UI      │
│  - Ghost scoring   │    │  - Metrics       │    │  - Mapbox GL     │
└─────────────────────┘    └──────────────────┘    └──────────────────┘
         ▲                                                    │
         │                                                    ▼
    Socrata API                                         Web Browser
    (CTA data)                                         (User Interface)
```

### Key Components

1. **Go ETL (`/go-etl`)**: Handles data ingestion, station matching, and ghost score computation
2. **Database (SQLite)**: Stores stations, ridership data, and computed metrics
3. **Next.js Frontend**: Map-based UI showing ghost stations with real-time data
4. **Socrata Integration**: Syncs daily ridership data from Chicago's open data portal

## Recent Implementation Changes

### 1. Enhanced Station Matching System (January 2026)

**Problem**: Only 98 out of 143 CTA stations had ridership data due to naming mismatches between Socrata and GTFS datasets.

**Solution**: Implemented intelligent station matching in `go-etl/internal/chicago/matcher.go`:

- **CTA Station ID Persistence**: Added `ctaStationId` field to Station model for direct lookups
- **Name Parsing**: Splits Socrata names on `-` or `/` (e.g., "Addison-O'Hare" → base: "Addison", suffix: "O'Hare")
- **Line Inference**: Maps suffixes to CTA lines (e.g., "O'Hare" → Blue Line)
- **Special Case Handling**: Handles renamed/special stations (e.g., "Library" → "Harold Washington Library")
- **Improved Logging**: Detailed CSV output with match failure reasons

**Results**:
- Station coverage increased from 98 to 143 stations
- Match rate improved to 99.3%
- Only 2 unmatched stations remain (likely deprecated)

### 2. Data Quality Improvements

- Added `dataStatus` field to distinguish between missing data and true zero ridership
- Ghost score computation now excludes stations with no data (assigns score of -1)
- Enhanced diagnostics showing station coverage statistics

### 3. Database Schema Updates

```sql
-- Added to Station table
ctaStationId TEXT -- CTA station number from Socrata (e.g., "41240")

-- Added to StationMetrics table
dataStatus TEXT DEFAULT 'normal' -- 'normal' or 'missing'
```

## Launch Checklist

### Prerequisites

- [ ] Node.js 20+ and npm installed
- [ ] Go 1.21+ installed
- [ ] SQLite3 installed
- [ ] Mapbox API token (for frontend maps)
- [ ] Chicago Data Portal app token (optional but recommended)

### Step 1: Database Setup

```bash
# Navigate to project root
cd /path/to/ghost-stops

# Install dependencies
npm install

# Run database migrations
npx prisma migrate dev

# Apply CTA station ID migration (if not already applied)
sqlite3 prisma/dev.db < scripts/add_cta_station_id.sql
```

### Step 2: Initial Data Load

```bash
cd go-etl

# 1. Load GTFS station data
DATABASE_URL="file:../prisma/dev.db" go run cmd/go-etl/main.go gtfs \
  --city=chicago \
  --source=https://www.transitchicago.com/downloads/sch_data/google_transit.zip

# 2. Sync ridership data (last 365 days)
DATABASE_URL="file:../prisma/dev.db" \
CHICAGO_DATA_APP_TOKEN="your_token_here" \
go run cmd/go-etl/main.go sync-ridership \
  --city=chicago \
  --limit=10000 \
  --since=2024-01-01

# 3. Compute ghost scores
DATABASE_URL="file:../prisma/dev.db" go run cmd/go-etl/main.go compute --city=chicago
```

### Step 3: Frontend Setup

```bash
# Return to project root
cd ..

# Set environment variables
echo 'DATABASE_URL="file:/absolute/path/to/prisma/dev.db"' >> .env
echo 'NEXT_PUBLIC_MAPBOX_TOKEN="your_mapbox_token"' >> .env

# Start development server
npm run dev
```

The app should now be running at http://localhost:3000

### Step 4: Production Deployment

#### Environment Variables
```bash
DATABASE_URL=file:/path/to/production.db
NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx
CHICAGO_DATA_APP_TOKEN=xxx  # For ETL cron jobs
ENVIRONMENT=production      # Enables proper error handling
```

#### Daily Data Sync (Cron Job)
```bash
# Add to crontab (runs daily at 2 AM)
0 2 * * * cd /path/to/ghost-stops/go-etl && \
  DATABASE_URL="file:/path/to/production.db" \
  CHICAGO_DATA_APP_TOKEN="xxx" \
  go run cmd/go-etl/main.go sync-ridership --city=chicago --limit=50000 && \
  go run cmd/go-etl/main.go compute --city=chicago
```

#### Build for Production
```bash
# Build Next.js app
npm run build

# Start production server
npm start
```

## Monitoring & Maintenance

### Health Checks

The sync process provides detailed diagnostics:
```
Station match rate: 99.3%
Stations with ridership in last 365 days: 143
```

### Data Quality Monitoring

1. Check unmatched stations: `cat go-etl/docs/unmatched_socrata.csv`
2. Monitor station coverage after sync
3. Review stations with missing data in compute output

### Manual Station Alias Management

If new unmatched stations appear:

1. Add to `StationAlias` table:
```sql
INSERT INTO StationAlias (id, stationId, aliasName, normalized)
VALUES (
  lower(hex(randomblob(16))),
  'station_uuid_here',
  'New Station Name',
  'new station name'
);
```

2. Or update the special mappings in `matcher.go`

## API Endpoints

### Stations List
```
GET /api/chicago/stations
Query params:
  - limit (default: 25)
  - sort (ghost_score_desc, ghost_score_asc, name, ridership)
```

### Station Detail
```
GET /api/chicago/stations/[id]
Returns: station info, ridership series, metrics
```

### Station Arrivals (if CTA API key configured)
```
GET /api/chicago/stations/[id]/arrivals
Returns: real-time arrival predictions
```

## Troubleshooting

### Common Issues

1. **"Station not found" errors**
   - Run sync-ridership to update station mappings
   - Check unmatched_socrata.csv for new station names

2. **Missing ridership data**
   - Verify Socrata API is accessible
   - Check CHICAGO_DATA_APP_TOKEN is set
   - Review sync logs for API errors

3. **Zero ghost scores for all stations**
   - Run compute command after sync
   - Verify ridership data exists in database

### Debug Commands

```bash
# List all stations
go run cmd/go-etl/main.go list-stations --city=chicago

# Check database state
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM RidershipDaily"

# View recent ridership
sqlite3 prisma/dev.db "SELECT * FROM RidershipDaily ORDER BY serviceDate DESC LIMIT 10"
```

## Future Enhancements

1. **Multi-City Support**: Extend to NYC MTA, SF BART, etc.
2. **Real-Time Integration**: Add CTA Train Tracker API
3. **Historical Analysis**: Track ghost score trends over time
4. **Bus Integration**: Include CTA bus stops
5. **Predictive Analytics**: Forecast future ghost stations

## Resources

- [CTA GTFS Data](https://www.transitchicago.com/developers/gtfs/)
- [Chicago Data Portal](https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f)
- [Project Documentation](/docs/Ghost-Stops-Transit-Project.md)
- [Chicago MVP Progress](/docs/chicago-mvp-progress.md)