# Facts + Narrative System

Transform Ghost Stops from a "what" tool into a "why" platform—journalism-grade storytelling backed by cited facts.

---

## Vision

Every ghost station has a story. The Facts + Narrative system explains *why* a station became underutilized through:

1. **Facts Layer**: Structured, source-linked data per station (historic ridership, population change, vehicle ownership, jobs change)
2. **Narrative Layer**: Templated archetypes that explain the story, NOT AI-generated—every claim traceable to a fact

---

## Phase 1: Quick Win (Top 25 Stations) ✅ COMPLETE

### What Was Built

#### Database Schema
Added 3 new Prisma models in `prisma/schema.prisma`:

```prisma
model DataSource {
  id             String        @id @default(uuid())
  code           String        @unique  // "cta_socrata", "census_acs_5yr", etc.
  name           String
  url            String        // Landing page URL
  apiUrl         String?       // API endpoint
  datasetId      String?
  license        String?
  lastFetched    DateTime?
  refreshCadence String?       // "daily", "annual", "static"
  facts          StationFact[]
}

model StationFact {
  id             String     @id @default(uuid())
  stationId      String
  factKey        String     // "ridership_2001_avg", "population_change"
  value          Float      // Percents as decimals: 0.52 = 52%
  valueType      String     // "number" | "percent" | "currency"
  unit           String
  geography      String     // "station", "walkshed_0.5mi", "region_il"
  timeframeStart Int?
  timeframeEnd   Int?
  methodology    String
  sourceId       String
  sourceNote     String?    // For multi-source facts
  computedAt     DateTime   @default(now())
  station        Station    @relation(...)
  source         DataSource @relation(...)
  @@unique([stationId, factKey])
}

model StationNarrative {
  id               String   @id @default(uuid())
  stationId        String   @unique
  archetypeKey     String   // "suburban_shift", "car_culture", etc.
  renderedStory    String   // Pre-rendered markdown
  evidenceFactKeys String   // JSON array (SQLite limitation)
  templateVersion  String   // "v1.0"
  confidence       Float    // 0-1
  lastComputed     DateTime @default(now())
  station          Station  @relation(...)
}
```

#### Core Libraries

| File | Purpose |
|------|---------|
| `src/types/narrative.ts` | TypeScript types for facts, narratives, archetypes |
| `src/lib/narratives/archetypes.ts` | 5 archetype definitions with scoring logic |
| `src/lib/narratives/formatters.ts` | Value formatters (number, percent, currency) |
| `src/lib/narratives/renderer.ts` | Handlebars-style template renderer |
| `src/lib/narratives/index.ts` | Barrel export |

#### Archetypes

| Archetype | Key | Triggers When |
|-----------|-----|---------------|
| The Suburban Shift | `suburban_shift` | Ridership ↓40%+, population stable/declining |
| Car Culture Won | `car_culture` | Vehicle ownership >50%, ridership ↓30%+ |
| The Jobs Moved Away | `jobs_exodus` | Jobs ↓20%+, ridership ↓30%+ |
| Service Erosion | `service_erosion` | Ridership ↓30%+ but demographics stable (fallback) |
| Against the Odds | `resilient_anomaly` | Ridership stable despite high car ownership |

#### Seed Data & Script

| File | Purpose |
|------|---------|
| `scripts/data/top25-facts.json` | Facts data for 25 stations + 5 data sources |
| `scripts/seed-narratives-phase1.ts` | Populates DataSource, StationFact, StationNarrative |

#### API Extension

`src/app/api/chicago/stations/[id]/route.ts` now returns:

```typescript
{
  // ... existing fields ...
  facts: {
    ridership_2001_avg: {
      value: 2450,
      displayValue: "2,450",
      valueType: "number",
      unit: "riders/day",
      methodology: "Daily average for calendar year 2001",
      source: { name: "CTA L Station Entries", url: "..." }
    },
    // ... more facts
  },
  narrative: {
    archetype: { key: "suburban_shift", title: "The Suburban Shift", emoji: "🏘️" },
    story: "Rendered markdown story...",
    evidenceFactKeys: ["ridership_2001_avg", "population_change"],
    confidence: 0.85
  },
  sources: [
    { code: "cta_socrata", name: "CTA L Station Entries", url: "...", license: "Public Domain" }
  ]
}
```

#### UI Components

| Component | Purpose |
|-----------|---------|
| `src/components/narrative/FactCard.tsx` | Displays individual fact with methodology tooltip |
| `src/components/narrative/SourcesCitation.tsx` | Collapsible sources accordion |
| `src/components/narrative/StationStory.tsx` | Main narrative container |
| `src/components/narrative/index.ts` | Barrel export |

#### Integration Points

- `src/components/station/StationDetailPanel.tsx` - Desktop panel shows StationStory after "How It Compares"
- `src/components/mobile/MobileStationDetail.tsx` - Mobile view shows StationStory
- `src/components/mobile/MobileLayout.tsx` - Passes narrative props to mobile detail

---

## Phase 1: What Remains

### 1. Curate Real Facts Data

The seed file `scripts/data/top25-facts.json` currently contains **placeholder data**. Real data needs to be researched and entered for each of the 25 stations:

**Facts to research per station:**

| Fact Key | Source | How to Get |
|----------|--------|------------|
| `ridership_2001_avg` | CTA Socrata | Query 2001 data from [CTA dataset](https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f) |
| `ridership_latest_avg` | Current DB | Already in `StationMetrics.rolling30dAvg` |
| `ridership_decline_pct` | Computed | `(2001 - latest) / 2001 × 100` |
| `population_change` | Census | Decennial 2010 SF1 P001001 → ACS 2020-2024, walkshed analysis |
| `vehicle_ownership_pct` | Census ACS | B08201: % HH with 2+ vehicles in walkshed |
| `jobs_walkshed_change` | LODES WAC | Total jobs (C000) change 2010→2023 in walkshed |
| `il_lane_miles_change` | FHWA HM-60 | IL total lane-miles change (regional, same for all) |

### 2. Re-run Seed Script

After updating `top25-facts.json` with real data:

```bash
npx ts-node --esm scripts/seed-narratives-phase1.ts
```

### 3. Verify Archetype Distribution

With real data, stations should distribute across archetypes based on their actual patterns. If all stations get the same archetype, adjust the scoring thresholds in `src/lib/narratives/archetypes.ts`.

---

## Phase 2: Automated Pipeline (Design Complete, Build Later)

### Planned Scripts

| Script | Purpose | Source |
|--------|---------|--------|
| `go-etl/internal/chicago/historical_ridership.go` | Ingest 2001 ridership | CTA Socrata API |
| `scripts/ingest-census-acs.ts` | Population + vehicles | Census API (B01003, B08201) |
| `scripts/ingest-lodes.ts` | Jobs in walkshed | LODES WAC files |
| `scripts/ingest-fhwa.ts` | IL lane-miles | FHWA HM-60 spreadsheet |
| `scripts/generate-narratives.ts` | Archetype matching | All facts → StationNarrative |

### Walkshed Analysis

For Census and LODES data, need to:
1. Buffer each station point by 0.5 miles
2. Intersect with Census block groups / LODES blocks
3. Area-weight the values for partial intersections

### Data Sources

| Source | Code | URL | Refresh |
|--------|------|-----|---------|
| CTA Socrata | `cta_socrata` | [Dataset](https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f) | Daily |
| Census Decennial 2010 | `census_decennial` | [data.census.gov](https://data.census.gov/) | Static |
| Census ACS 5yr | `census_acs_5yr` | [data.census.gov](https://data.census.gov/) | Annual |
| LEHD LODES | `lodes` | [LEHD](https://lehd.ces.census.gov/data/) | Annual |
| FHWA HM-60 | `fhwa` | [Highway Statistics](https://www.fhwa.dot.gov/policyinformation/statistics.cfm) | Annual |

---

## Technical Notes

### Percent Convention
- **Stored**: Decimals (0.52 = 52%)
- **Displayed**: Formatted as "52%" or "-23%"
- **Formatter**: `formatPercent()` in `src/lib/narratives/formatters.ts`

### Multi-Source Facts
For facts derived from multiple sources (e.g., ridership decline = 2001 vs current):
- Primary source in `sourceId`
- Secondary source note in `sourceNote` field

### Template Syntax
Templates use Handlebars-style syntax:
- Variables: `{{factKey|format}}` (format = number, percent, currency)
- Conditionals: `{{#if factKey}}...{{/if}}`

### SQLite Limitation
`evidenceFactKeys` is stored as a JSON string (not native array) because SQLite doesn't support `String[]`. The API parses it back to an array.

---

## Verification Checklist

### After Phase 1 Complete:
- [ ] Run `npx prisma studio` → verify StationFact, DataSource, StationNarrative tables populated
- [ ] Hit `GET /api/chicago/stations/{top-ghost-id}` → verify `facts`, `narrative`, `sources` in response
- [ ] Open UI → select top ghost station → verify Story section renders
- [ ] Click "Sources" → verify all sources have valid URLs
- [ ] Hover fact → verify methodology tooltip appears with unit and timeframe
- [ ] Test mobile view at 375px width
- [ ] Verify "Evidence" section shows facts listed in `evidenceFactKeys`

### Data Integrity Checks:
- [ ] All 25 stations have 6-7 facts each (including regional)
- [ ] All facts have non-null: methodology, unit, geography
- [ ] All facts have valid timeframeStart/timeframeEnd (or null for rolling)
- [ ] All facts link to valid DataSource
- [ ] No divide-by-zero in ridership_decline_pct (null if 2001=0)
- [ ] Archetypes distribute reasonably (not all same type)
- [ ] Rendered stories contain no `{{undefined}}` placeholders

---

## File Index

```
prisma/
  schema.prisma          # DataSource, StationFact, StationNarrative models

src/
  types/
    narrative.ts         # TypeScript types

  lib/
    narratives/
      index.ts           # Barrel export
      archetypes.ts      # 5 archetype definitions
      formatters.ts      # Number/percent/currency formatters
      renderer.ts        # Template renderer

  components/
    narrative/
      index.ts           # Barrel export
      FactCard.tsx       # Individual fact display
      SourcesCitation.tsx # Collapsible sources list
      StationStory.tsx   # Main narrative container

  app/
    api/
      chicago/
        stations/
          [id]/
            route.ts     # Extended with facts/narrative/sources

scripts/
  data/
    top25-facts.json     # Seed data (needs real facts)
  seed-narratives-phase1.ts  # Seed script

docs/
  facts-narrative-system.md  # This file
```

---

## Key Design Decisions

1. **Templated, not AI-generated** → Trust is paramount. Every claim traceable to a fact.
2. **Pre-rendered narratives** → Fast API responses, no runtime template processing.
3. **Full fact metadata** → `unit`, `geography`, `timeframeStart/End` enable accurate UI labels.
4. **Decennial baseline for population** → 2010 SF1 is cleaner than ACS for "then" comparisons.
5. **evidenceFactKeys tracks which facts** → UI knows exactly which FactCards to show.
6. **sourceNote for multi-source facts** → Primary source in `sourceId`, secondary in `sourceNote`.
7. **Percents stored as decimals** → Single convention enforced in formatters.
8. **templateVersion tracking** → Enables re-rendering when copy changes.
9. **Phase 1 = manual curation** → Ship fast, validate the UX, then automate.
