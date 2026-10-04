# Chicago MVP Progress and Implementation Plan

## Overview
This document tracks the progress of pivoting the Ghost Stops app from Phoenix Light Rail to Chicago CTA Rail. The app identifies low-ridership "ghost" stations using official data sources.

## Architecture Overview

```
┌─────────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Go ETL CLI        │───▶│  SQLite/Postgres │◀──│  Next.js App     │
│  - GTFS ingestion  │    │  - Stations      │    │  - API Routes    │
│  - Ridership data  │    │  - Ridership     │    │  - React UI      │
│  - Ghost Score     │    │  - Metrics       │    │  - Mapbox GL     │
└─────────────────────┘    └──────────────────┘    └──────────────────┘
```

## Implementation Plan

### 1. Data Model Updates (Prisma Schema)

**Current Schema Issues:**
- Phoenix-specific (no multi-city support)
- No station mapping/alias support
- No daily ridership records
- No ghost score or metrics storage

**Proposed Schema Changes:**
```prisma
model City {
  id        String     @id @default(uuid())
  code      String     @unique // "chicago", "phoenix"
  name      String     // "Chicago CTA", "Phoenix Metro"
  stations  Station[]
}

model Station {
  id              String           @id @default(uuid())
  cityId          String
  externalId      String?          // GTFS stop_id or agency ID
  name            String
  latitude        Float
  longitude       Float
  lines           String[]         // ["Red", "Blue"] for multi-line stations

  city            City             @relation(fields: [cityId], references: [id])
  aliases         StationAlias[]
  ridershipDaily  RidershipDaily[]
  metrics         StationMetrics?

  @@index([cityId, name])
  @@unique([cityId, externalId])
}

model StationAlias {
  id              String   @id @default(uuid())
  stationId       String
  aliasName       String   // Alternative name from ridership data
  normalized      String   // Normalized version for matching

  station         Station  @relation(fields: [stationId], references: [id])

  @@index([normalized])
  @@unique([stationId, aliasName])
}

model RidershipDaily {
  id              String   @id @default(uuid())
  stationId       String
  serviceDate     DateTime
  entries         Int      // Total boardings for the day

  station         Station  @relation(fields: [stationId], references: [id])

  @@index([stationId, serviceDate])
  @@unique([stationId, serviceDate])
}

model StationMetrics {
  id              String   @id @default(uuid())
  stationId       String   @unique
  lastDayEntries  Int?     // Most recent day's ridership
  rolling30dAvg   Float?   // 30-day rolling average
  rolling90dAvg   Float?   // 90-day rolling average (optional)
  ghostScore      Int      // 0-100, higher = more "ghost"
  lastUpdated     DateTime
  serviceDateMax  DateTime // Latest data date

  station         Station  @relation(fields: [stationId], references: [id])
}
```

### 2. Go ETL Module Structure

```
/go-etl/
├── cmd/
│   └── go-etl/
│       └── main.go          # CLI entry point
├── internal/
│   ├── chicago/
│   │   ├── gtfs.go         # CTA GTFS parsing
│   │   ├── ridership.go    # Ridership data parsing
│   │   └── mapping.go      # Station name mapping logic
│   ├── db/
│   │   ├── client.go       # Database connection
│   │   └── models.go       # SQL queries
│   ├── compute/
│   │   └── ghost_score.go  # Ghost score calculation
│   └── utils/
│       └── normalize.go    # String normalization
├── go.mod
├── go.sum
└── README.md
```

**CLI Commands:**
1. `go-etl gtfs --city=chicago --source=<url/file>`
   - Download/parse CTA GTFS data
   - Extract rail stations only
   - Populate City and Station tables

2. `go-etl ridership --city=chicago --source=<url/file>`
   - Parse CTA ridership data (CSV/JSON)
   - Map station names to GTFS stations
   - Create RidershipDaily records
   - Generate unmatched stations report

3. `go-etl compute --city=chicago`
   - Calculate rolling averages
   - Compute ghost scores
   - Update StationMetrics table

4. `go-etl all --city=chicago --gtfs=<> --ridership=<>`
   - Run all steps in order

### 3. Station Name Mapping Strategy

**Normalization Rules:**
1. Convert to lowercase
2. Remove punctuation except hyphens
3. Replace "&" with "and"
4. Collapse multiple spaces to single space
5. Trim whitespace

**Matching Priority:**
1. Exact match on normalized name
2. Check StationAlias table
3. Fuzzy match (for manual review)

**Example Mappings:**
- "Clark/Lake" → "clark lake"
- "O'Hare" → "ohare"
- "Washington & Wabash" → "washington and wabash"

### 4. Ghost Score Algorithm (v1)

```
Ghost Score = 100 - (station_percentile * 100)

Where:
- station_percentile = rank of station by ridership / total stations
- Lower ridership = lower rank = higher ghost score
- Tie handling: stations with same ridership get same score
```

**Example:**
- Station with lowest ridership: Ghost Score = 100
- Station at 25th percentile: Ghost Score = 75
- Station at median: Ghost Score = 50
- Station with highest ridership: Ghost Score = 0

### 5. Next.js API Routes

**New/Updated Routes:**

```
GET /api/chicago/stations
Query params:
  - limit (default: 25)
  - sort (ghost_score_desc, ghost_score_asc, name, ridership)

Response:
{
  "stations": [
    {
      "id": "uuid",
      "name": "Thorndale",
      "latitude": 41.990,
      "longitude": -87.659,
      "lines": ["Red"],
      "ghostScore": 85,
      "rolling30dAvg": 1234,
      "lastDayEntries": 1100
    }
  ],
  "dataAsOf": "2024-01-15"
}

GET /api/chicago/stations/[id]

Response:
{
  "station": { /* same as above */ },
  "ridershipSeries": [
    {
      "date": "2024-01-15",
      "entries": 1100
    },
    // ... last 90 days
  ],
  "metrics": {
    "ghostScore": 85,
    "percentile": 15,
    "systemAverage": 5234,
    "explanation": "This station has 76% less ridership than the system average"
  }
}

GET /api/chicago/stations/[id]/arrivals (optional)

Response:
{
  "arrivals": [
    {
      "routeId": "Red",
      "destination": "Howard",
      "prediction": "2 min",
      "scheduled": "2024-01-15T14:30:00Z"
    }
  ]
}
```

### 6. UI Updates

**Map Component:**
- Center on Chicago: latitude: 41.8781, longitude: -87.6298
- Color code stations by ghost score:
  - 80-100: Deep red (very ghost)
  - 60-80: Orange
  - 40-60: Yellow
  - 20-40: Light green
  - 0-20: Green (high ridership)

**Left Sidebar:**
- "Top 25 Ghost Stations" ranked list
- Show ghost score badge and daily ridership
- Click to select on map

**Station Detail Modal:**
- Station name and lines served
- Ghost Score with visual indicator
- "Why is this a ghost stop?" explanation
- Last 90 days ridership chart (using recharts)
- Optional: Next arrivals if API key available

### 7. Data Sources

**CTA GTFS:**
- https://www.transitchicago.com/developers/gtfs/
- Updated daily
- Use stops.txt for rail stations only

**CTA Ridership:**
- https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f
- Daily station entries since 2001
- CSV format with station names needing mapping

### 8. Development Workflow

```bash
# Initial setup
npm install
go mod init github.com/username/ghost-stops/go-etl
cd go-etl && go mod tidy

# Update database schema
npx prisma migrate dev --name add-chicago-support

# Run ETL
go run ./go-etl/cmd/go-etl all \
  --city=chicago \
  --gtfs=./data/chicago-gtfs.zip \
  --ridership=./data/cta-ridership.csv

# Start dev server
npm run dev
```

### 9. Known Issues and Next Steps

**Current Issues:**
1. Station name mapping will require manual review
2. Multi-line stations need special handling
3. Some stations may have multiple entrances

**Future Enhancements:**
1. Real-time arrival integration
2. Historical trend analysis
3. Peak vs off-peak ghost scores
4. Station accessibility info
5. Neighborhood demographics overlay

## Progress Log

### 2024-01-20
- [x] Analyzed existing codebase structure
- [x] Created implementation plan
- [x] Updated Prisma schema with multi-city support
- [x] Created Go ETL module with all commands
- [x] Implemented GTFS and ridership data ingestion
- [x] Created ghost score computation logic
- [x] Updated API routes for Chicago data
- [x] Modified UI components with sidebar and station details
- [x] Updated README with setup instructions

## Implementation Summary

### What Was Built

1. **Database Schema**:
   - Added multi-city support with City model
   - Created StationAlias for name mapping
   - Added RidershipDaily for time-series data
   - Created StationMetrics for computed scores

2. **Go ETL Tool**:
   - Complete CLI with gtfs, ridership, compute, and all commands
   - Station name normalization and mapping
   - Idempotent data ingestion
   - Ghost score computation based on percentile ranking

3. **API Routes**:
   - `/api/chicago/stations` - List with sorting and filtering
   - `/api/chicago/stations/[id]` - Detailed view with metrics
   - `/api/chicago/stations/[id]/arrivals` - Placeholder for real-time data

4. **UI Updates**:
   - Chicago-centered map with color-coded ghost scores
   - Left sidebar showing top 25 ghost stations
   - Interactive station selection with detailed modal
   - CTA line colors and branding

### Next Steps for Production

1. **Data Pipeline**:
   - Set up automated daily ETL runs
   - Add error monitoring and alerting
   - Implement incremental updates

2. **Performance**:
   - Add database indexes for common queries
   - Implement API response caching
   - Consider CDN for static assets

3. **Features**:
   - Integrate real CTA Train Tracker API
   - Add ridership chart visualization
   - Implement station search/filtering
   - Add time-based ghost score analysis

## Commands Reference

```bash
# ETL Commands
go run ./go-etl/cmd/go-etl gtfs --city=chicago --source=https://www.transitchicago.com/downloads/sch_data/google_transit.zip
go run ./go-etl/cmd/go-etl ridership --city=chicago --source=./data/cta-ridership.csv
go run ./go-etl/cmd/go-etl compute --city=chicago
go run ./go-etl/cmd/go-etl all --city=chicago --gtfs=<url> --ridership=<url>

# Database
npx prisma migrate dev
npx prisma studio

# Development
npm run dev
```

## API Endpoints

- `GET /api/chicago/stations` - List all stations with ghost scores
- `GET /api/chicago/stations/[id]` - Station detail with ridership history
- `GET /api/chicago/stations/[id]/arrivals` - Real-time arrivals (optional)

## Unmatched Stations

See `/docs/chicago-unmatched-stations.md` for stations that couldn't be automatically mapped between GTFS and ridership data.