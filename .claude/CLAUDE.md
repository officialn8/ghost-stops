# Ghost Stops - Claude AI Development Guide

A comprehensive guide for working with the Ghost Stops CTA ridership analytics platform.

## Project Overview

Ghost Stops is a data visualization platform that identifies Chicago CTA "ghost stations" - stations with unusually low ridership relative to their context. The platform combines ridership data, multi-factor analysis, and interactive visualizations to explain *why* certain stations are underutilized.

### Technology Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Go ETL pipeline
- **Database**: SQLite via Prisma ORM
- **Mapping**: Mapbox GL JS with custom layers
- **Animations**: Framer Motion, React Spring
- **Charts**: Recharts (main charts), Custom SVG (sparklines)

### Key Features

- **Ghost Score Ranking**: Multi-factor composite scoring to identify underutilized stations
- **Interactive Map**: Mapbox visualization with route segments colored by ridership
- **Station Comparisons**: System median, line median, and neighbor station comparisons
- **Sparklines**: 7-day trend visualization in station lists
- **Mobile Support**: Responsive design with bottom sheet navigation

---

## Architecture

### Frontend Structure (`src/`)

```
src/
├── app/
│   ├── api/chicago/stations/      # Station data API routes
│   │   ├── route.ts               # List all stations with sparklines
│   │   └── [id]/route.ts          # Station detail with comparisons
│   └── page.tsx                   # Main map page
├── components/
│   ├── station/
│   │   ├── StationRow.tsx         # Station list item with sparkline
│   │   ├── StationList.tsx        # Scrollable station list
│   │   ├── StationDetailPanel.tsx # Full station detail view
│   │   └── NeighborPills.tsx      # Prev/next station navigation
│   ├── charts/
│   │   ├── Sparkline.tsx          # SVG sparkline component
│   │   └── RidershipChart.tsx     # Full ridership chart
│   ├── comparison/
│   │   └── ComparisonBars.tsx     # Horizontal comparison bars
│   ├── ghost/
│   │   └── GhostScoreGauge.tsx    # Animated circular gauge
│   └── mobile/
│       ├── MobileStationCard.tsx  # Compact mobile card
│       └── MobileStationDetail.tsx # Mobile detail view
└── lib/
    ├── cta/
    │   ├── stationSequences.ts    # CTA line station order
    │   ├── normalizeStationLines.ts
    │   └── explodeAndStitchSegments.ts
    ├── motion/
    │   └── tokens.ts              # Animation configurations
    └── utils.ts                   # Utilities including ghost score colors
```

### Backend ETL (`go-etl/`)

```
go-etl/
├── cmd/etl/main.go                # CLI entry point
├── internal/
│   ├── compute/
│   │   └── ghost_score.go         # Multi-factor ghost score algorithm
│   ├── db/
│   │   └── client.go              # Database operations
│   └── ingest/
│       └── ridership.go           # CTA data ingestion
```

---

## Ghost Score Algorithm

The ghost score uses a **multi-factor composite scoring** system to identify underutilized stations:

### Score Components

| Factor | Weight | Description |
|--------|--------|-------------|
| **Ridership Percentile** | 40% | Station's 30-day average vs. all stations (inverted: low = high score) |
| **Trend Score** | 25% | 30-day vs. 90-day change (declining = higher score) |
| **Variability Score** | 15% | Coefficient of variation (erratic patterns = higher score) |
| **Context Adjustment** | 20% | Station type modifier (terminal/transfer/normal) |

### Station Context Types

- **Terminal** (score: 30): End-of-line stations naturally have lower ridership
- **Transfer** (score: 70): Multi-line hubs should have high ridership, so low is notable
- **Normal** (score: 50): Neutral baseline for regular stations

### Implementation

```go
// go-etl/internal/compute/ghost_score.go
compositeScore := (WeightRidership * ridershipScore) +
    (WeightTrend * trendScore) +
    (WeightVariability * variabilityScore) +
    (WeightContext * contextScore)
```

### Score Range

- **Maximum observed**: ~72 (practical ceiling due to weighted components)
- **Thresholds**: 65+ (critical), 50-65 (warning), 35-50 (moderate), <35 (healthy)

---

## Key Components

### Sparkline (`src/components/charts/Sparkline.tsx`)

Lightweight SVG-based sparkline for performance with 100+ stations:

```typescript
interface SparklineProps {
  data: number[];        // 7 values (last 7 days)
  width?: number;        // default 56px
  height?: number;       // default 28px
  color?: string;        // line color (uses primary CTA line color)
  showTrend?: boolean;   // up/down arrow indicator
}
```

**Design Decision**: Uses pure SVG instead of Recharts for performance in list views.

### Station Comparisons (`src/components/comparison/ComparisonBars.tsx`)

Horizontal bar visualization showing:
- Station vs. System Median
- Station vs. Line Median (primary line only for multi-line stations)
- Station vs. Neighbor Average

### Neighbor Navigation (`src/components/station/NeighborPills.tsx`)

Clickable pills showing adjacent stations on the line:
```
← Thorndale (72)  •  Bryn Mawr (65) →
```

### Ghost Score Gauge (`src/components/ghost/GhostScoreGauge.tsx`)

Animated circular gauge with:
- React Spring count-up animation
- Color gradient based on score
- Particle effects for scores > 65
- Pulsing ring for scores > 55

### Station Row (`src/components/station/StationRow.tsx`)

List item with:
- Rank badge (colored by primary line)
- Station name and line badges
- Daily average ridership
- 7-day sparkline
- Ghost score circular indicator
- Animated ghost icon (Framer Motion)

---

## API Responses

### List Stations (`GET /api/chicago/stations`)

```typescript
{
  stations: [{
    id: string;
    name: string;
    lines: string[];
    ghostScore: number;
    rolling30dAvg: number;
    dataStatus: 'available' | 'missing' | 'zero';
    sparkline: number[];  // Last 7 days of ridership
    lat: number;
    lon: number;
  }]
}
```

### Station Detail (`GET /api/chicago/stations/[id]`)

```typescript
{
  station: { /* base station data */ },
  comparisons: {
    systemMedian: number;
    primaryLine: string;
    lineMedian: number;
    neighbors: {
      prev: { id, name, rolling30dAvg, ghostScore } | null;
      next: { id, name, rolling30dAvg, ghostScore } | null;
      neighborAvg: number;
    };
    vsSystemMedian: number;   // % difference
    vsLineMedian: number;
    vsNeighbors: number;
  },
  ridership: { /* historical data */ }
}
```

---

## CTA Station Sequences

Station order is hardcoded in `src/lib/cta/stationSequences.ts` for neighbor lookups:

```typescript
export const CTA_STATION_SEQUENCES: Record<string, string[]> = {
  Red: ['Howard', 'Jarvis', 'Morse', /* ... */, '95th/Dan Ryan'],
  Blue: ["O'Hare", 'Rosemont', /* ... */, 'Forest Park'],
  // ... all 8 lines
};
```

**Design Decision**: Hardcoded instead of GTFS parsing because CTA has 8 lines with stable station order.

### Utilities

```typescript
// Find adjacent stations
findNeighbors(stationName: string, stationLines: string[]): NeighborInfo[]

// Get primary line for multi-line stations (alphabetical first)
getPrimaryLine(lines: string[]): string | null
```

---

## Color Thresholds

### Ghost Score Colors (`src/lib/utils.ts`)

```typescript
export function getGhostScoreColor(score: number): string {
  if (score >= 65) return "#DC2626" // red-600 (critical ghost)
  if (score >= 50) return "#EA580C" // orange-600
  if (score >= 35) return "#F59E0B" // amber-500
  if (score >= 20) return "#84CC16" // lime-500
  return "#22C55E" // green-500
}
```

### CTA Line Colors

```typescript
export const ctaLineColors = {
  "Red": "#C60C30",
  "Blue": "#00A1DE",
  "Brown": "#62361B",
  "Green": "#009B3A",
  "Orange": "#F9461C",
  "Purple": "#522398",
  "Pink": "#E27EA6",
  "Yellow": "#F9E300"
}
```

---

## Animation Patterns

### Framer Motion (Infinite Animations)

```typescript
// Floating ghost icon in StationRow
<motion.div
  animate={{ y: [0, -2, 0] }}
  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
>
  <Ghost className="w-3 h-3" />
</motion.div>
```

### React Spring (Count-up, Progress)

```typescript
// GhostScoreGauge number animation
const { number } = useSpring({
  from: { number: 0 },
  to: { number: score },
  delay: 300,
  config: springConfigs.countUp,
});
```

---

## Database Schema

### Key Tables

- **Station**: CTA stations with `lines` (JSON array), coordinates
- **RidershipDaily**: Daily ridership entries per station
- **StationMetric**: Computed metrics (rolling averages, ghost score)

### Running ETL

```bash
cd go-etl
DATABASE_URL="file:../prisma/dev.db" go run cmd/etl/main.go ghost-scores chicago
```

---

## Common Tasks

### Adding a New Comparison Metric

1. Add calculation to `src/app/api/chicago/stations/[id]/route.ts`
2. Update `ComparisonBars.tsx` to display the new metric
3. Add to `StationDetailPanel.tsx` comparisons section

### Modifying Ghost Score Weights

1. Edit weights in `go-etl/internal/compute/ghost_score.go`
2. Re-run ETL: `go run cmd/etl/main.go ghost-scores chicago`
3. Update color thresholds if score range changes significantly

### Adding a New CTA Line

1. Add station sequence to `src/lib/cta/stationSequences.ts`
2. Add color to `src/lib/cta/explodeAndStitchSegments.ts` CTA_LINE_COLORS
3. Add color to `src/lib/utils.ts` ctaLineColors
4. Update terminal stations in `go-etl/internal/compute/ghost_score.go`

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLite database path (e.g., `file:./prisma/dev.db`) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox GL JS access token |

---

## Build & Development

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build

# Type checking
npm run lint

# Run ETL (from go-etl directory)
cd go-etl
DATABASE_URL="file:../prisma/dev.db" go run cmd/etl/main.go [command]
```

---

## Recent Changes (January 2025)

### Enhanced Comparisons & Sparklines
- Added `Sparkline.tsx` component for 7-day trend visualization
- Added `ComparisonBars.tsx` for station vs. system/line/neighbor comparisons
- Added `NeighborPills.tsx` for line-based station navigation
- Extended station detail API with comparison data

### Multi-Factor Ghost Score
- Refactored from simple percentile to composite scoring
- Added trend analysis (30d vs 90d)
- Added variability scoring (coefficient of variation)
- Added station context adjustment (terminal/transfer/normal)

### Animation Updates
- Updated thresholds for new score range (max ~72)
- Added animated ghost icon to StationRow
- Particle effects trigger at score > 65
- Pulsing ring triggers at score > 55

### Bug Fixes
- Fixed LaSalle station line assignment (Blue, not Red)
- Fixed type errors with CTA_LINE_COLORS indexing
- Fixed mobile layout GeoJSON type issues
