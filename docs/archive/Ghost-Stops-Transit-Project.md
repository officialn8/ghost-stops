# Ghost Stops Transit Project

A map-first, data-driven product that surfaces the **most “ghostly” transit stops**—the places where ridership is surprisingly low—across major transit systems. Start with **Chicago (CTA L)**, then expand to other U.S. cities (and EU support later).

---

## What the app does

- **Find the ghostiest stops** (least used) and rank them with a clear **Ghost Score (0–100)**  
  - **High score** = “ghost stop” (low ridership)  
  - **Low score** = busy stop  
- **Explore stop ridership in a polished UI**  
  - Map view + ranked list + station detail panel  
  - Rolling averages, trends, and “data as of” timestamps  
- **Stay up to date automatically**  
  - Data updates on a schedule from reliable sources (CTA/Socrata now; more agencies later)

---

## Product principles

### 1) Data should be readable and valid
- Always show **“data as of”** and **coverage window**
- Distinguish:
  - **True 0 ridership** (valid data)
  - **Missing/unmapped data** (data-quality issue)
- Provide clear labels and neutral styling for missing data (don’t treat it as “ghost”)

### 2) Map-first, fast by default
- Never rely on external APIs at request-time for core UI
- Precompute heavy metrics (rolling averages, rankings, ghost scores)

### 3) Award-winning 2026 design
- **Light mode** first
- **Glass / soft UI**: rounded surfaces, tasteful blur, gentle shadows
- **Transit line colors** are the “jewelry”: correct, recognizable, and tastefully bright
- Subtle **ghost-like features** (premium, not Halloween)

---

## MVP: Chicago (CTA L)

### Data sources
- **GTFS**: Station metadata (names, lines, geometry)  
- **Ridership (source of truth)**: City of Chicago dataset (Socrata)  
  - *CTA Ridership L Station Entries – Daily Totals* (dataset `5neh-572f`)  

### Local database (cache)
We keep a small local cache so the UI stays fast and the system is resilient:

- `Station` (from GTFS)
- `RidershipDaily` (**rolling window: last 365 days**)
- `StationMetrics` (computed values: rolling averages, ghostScore, ranks, timestamps)

---

## Hybrid sync architecture

### Why hybrid?
- **Up to date** (Socrata is the source of truth)
- **Storage efficient** (only keep a recent window locally)
- **Fast UI** (no Socrata calls per page view)
- **Resilient** (works even if Socrata is slow/down)

### Sync flow
1. **Find last sync point**  
   - `MAX(serviceDate)` in `RidershipDaily`  
2. **Fetch new rows from Socrata** (incremental, paginated)
3. **Upsert** into `RidershipDaily` using unique key `(stationId, serviceDate)`
4. **Prune** rows older than 365 days **relative to dataAsOf**  
5. **Compute metrics** and refresh `StationMetrics`

### Important: station mapping
Socrata identifiers don’t always match GTFS stop IDs directly. The sync must map Socrata records to local stations via:

1. Direct ID match (only if valid)
2. **Normalized station name** match
3. **Alias table** for edge cases
4. Unmatched records are logged + exported (do not crash)

---

## ETL / CLI (Go)

The ETL lives in a Go CLI using **cobra**. Commands include:

- `gtfs` — load station metadata
- `sync-ridership` — incremental fetch + upsert + prune (hybrid)
- `compute` — compute rolling metrics + ghost score from local window
- `all` — run the full pipeline in the correct order
- `list-stations` — diagnostics / sanity checks

### Testing / verification checklist
After a sync + compute run, verify:

- Station count is correct (CTA L ≈ 143)
- `RidershipDaily` date range is within ~365 days of `MAX(serviceDate)`
- Nearly all stations have at least some ridership rows in the window
- Stations with **0 rows** are marked as **missing/unmapped**, not treated as “ghost”

---

## Ghost Score definition (Chicago MVP)

**Primary signal:** rolling 30-day average ridership per station.

- Compute `rolling30dAvg` and `rolling90dAvg` from local `RidershipDaily`
- Compute `ghostScore` as an **inverted percentile rank** of `rolling30dAvg`:
  - Lowest `rolling30dAvg` → ghostScore near 100
  - Highest `rolling30dAvg` → ghostScore near 0
- Handle ties deterministically

> Note: “ghost score” is a product abstraction, not a claim that a station is unnecessary. The app should encourage investigation and context.

---

## Frontend (Next.js)

### Stack (current)
- Next.js 15 + React 19 + TypeScript
- Tailwind + shadcn/ui + Radix
- React Query
- Mapbox (map-first UI)

### Core UI
- Top bar: search, filters, “data as of”
- Left rail: ranked “Ghostiest Stations”
- Right panel: station detail + chart
- Map layers:
  - stations: dot + halo intensity by ghost score
  - lines: CTA line colors (tastefully bright)

### Design requirements (2026 light-mode glass)
- Airy spacing, editorial hierarchy
- Rounded surfaces, soft shadows, minimal borders
- Glass blur used sparingly for legibility
- CTA line pills/badges must be correct and consistent across map + UI

### Ghost-like features (subtle, premium)
Implement at least 3:
- Spectral halo ring / shimmer on GhostScoreHero
- Ultra-subtle ghost watermark on a key card/panel
- Selected station pulse (slow, minimal)
- “Missing data” empty state with tasteful ghost mark

---

## Data quality & “missing data” rules

A station can be:
- **Valid (has rows)** → compute metrics normally
- **Missing (0 rows in window)** → set `dataStatus="missing"` and render neutrally  
  - Do **not** treat missing as 0 ridership
  - Keep a diagnostics list for unmatched station mappings

---

## Roadmap

### Phase 1 — Chicago polish (now)
- Fix station mapping coverage (name normalization + alias table)
- Ensure 365-day retention is enforced
- Validate compute metrics and UI coverage
- Ship portfolio-grade design

### Phase 2 — Multi-city architecture
- City config + adapters: `gtfs + ridership source + line colors + map bounds`
- Support other agencies where APIs exist (e.g., CTA API, MTA API, etc.)
- Standardize “ridership daily” schema and city-level sync schedules

### Phase 3 — Beyond rail
- Bus, BRT, light rail
- Agency-specific coverage notes and comparability warnings

### Phase 4 — EU support (later)
- Feasibility depends on data availability and standardization

---

## Non-goals (for MVP)
- Real-time arrivals / vehicle positions (nice-to-have later)
- Complex demand modeling beyond rolling averages
- “Hot takes” about service cuts—this is a discovery and transparency tool

---

## North Star
A user should be able to open the map and instantly think:

> “This is beautiful. This is trustworthy. And I can finally see where transit is underused—and *why*.”
