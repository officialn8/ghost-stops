# Ghost Stops — Data & Pipeline Health Audit

Date: 2026-10-02 (repo idle since 2026-02-07, HEAD `84a9400`)
Scope: read-only. No files modified, no migrations, no DB writes, no commits. Secret values are never printed (names/hostnames/prefixes only).

Evidence files: `/private/tmp/claude-501/-Users-nate-ghost-stops/5d712b98-371c-4ce1-8023-6f7e220fa135/scratchpad/` (`stations.json`, `raw.json`, `detail.json`, `meta_5neh.json`, `meta_8pix.json`, `socrata_stations_all.json`, `cta_stops.txt`, `prod_stations.txt`, `local_stations.txt`, `sweep_full.json`, `home.html`, chunk_*).

---

## 0. Headline (ranked by severity)

| # | Severity | Finding |
|---|----------|---------|
| 1 | **Critical – security** | A live Neon Postgres URL **with password** is committed at HEAD in `scripts/fetch-all-2001.ts` (1 commit in history). The Socrata app token (`wFGo…`, 25 chars) is committed in 5 tracked files. Both must be rotated. |
| 2 | **Critical – pipeline** | The Go ETL **cannot write to Postgres at all**: `go-etl/internal/db/client.go` imports only `github.com/mattn/go-sqlite3` and `sql.Open("sqlite3", …)` for any URL. The Railway cron (`go-etl/railway.toml`, `0 6 * * *`) therefore could never have updated production. No sync has run since 2026-02-02. |
| 3 | **High – data staleness** | Production data ends **2025-11-30**; metrics computed **2026-02-01**. Upstream (Socrata `5neh-572f`) now has data through **2026-07-31** (last updated 2026-09-28). The site is 8 months behind what is available. |
| 4 | **High – data correctness** | Stored 2025 ridership values **no longer match upstream** for the same station/day (e.g. 95th/Dan Ryan 2025-03-03: stored 3,961 vs upstream 5,333; Clark/Lake 2025-11-03: 9,361 vs 9,961). CTA has restated the dataset. The sync's `date > MAX(serviceDate)` design can never pick up revisions — a full re-backfill of the retained window is required, not an incremental catch-up. |
| 5 | **High – prod reliability** | Station-detail API (`/api/chicago/stations/[id]`) returns **500 under modest concurrency**: 30/30 OK sequentially, 17/30 fail at 8 concurrent; full 143-station sweep at 8-way: 66 OK / 77 × 500 ("Failed to fetch station details"). Cause: per-route `new PrismaClient()` + `prisma.$disconnect()` in `finally` against the Neon pooler. |
| 6 | **Medium – roster** | Local/prod have 143 stations; official roster is 144. `State/Lake` (40260) was never ingested (and has been **closed since 2026-01-05 for a 3-year rebuild**, upstream now reports 0 rides). `Washington` carries the wrong `ctaStationId` (40500 = closed Washington/State; should be 40370). `Jefferson Park Transit Center` has NULL `ctaStationId`. Green Line sequence omits `Damen`. |
| 7 | **Medium – local snapshot** | `prisma/dev.db` (473 MB) has **32,388 duplicate (station, day) rows** from mixed `serviceDate` formats and **90 orphan rows** written by hand-rolled scripts with wrong station IDs; its `_prisma_migrations` history (6 SQLite migrations) does not match the repo's single Postgres migration. |
| 8 | **Medium – build** | `go build ./...` fails (`scripts/populate_station_aliases.go:140: undefined: strings`); `cmd` and `internal` build fine. Two 15 MB compiled binaries (`go-etl/etl`, `go-etl/go-etl`) are tracked in git. |
| 9 | **Low** | Sparklines are always empty in prod (window is `now()-7d`, not relative to `serviceDateMax`). `/api/test` and `/api/stations` are public debug endpoints dumping raw rows. `CLAUDE.md` paths for the ETL are wrong (`cmd/etl/main.go`, `internal/ingest/` → actual `cmd/go-etl/main.go`, `internal/chicago/`). |

---

## 1. Production status

**Finding the URL.** `npx vercel ls/inspect/env ls` all fail: `No existing credentials found` (CLI v50.9.6, not logged in). No URL is present anywhere in the repo. Probing `.vercel/project.json` name → **https://ghost-stops.vercel.app** answers HTTP 200 (`server: Vercel`, `x-matched-path: /`, `x-nextjs-prerender: 1`, `age: 550795` i.e. the HTML has been served from cache ~6.4 days).

**Site.** Title `Ghost Stops | Chicago CTA Rail Analytics`. Loaded in the browser pane: the Mapbox map **renders** (dark basemap, "© Mapbox © OpenStreetMap" attribution, 1,117 track-segment features, 143 station markers, "143 Stations · Live Data" header, panel "Updated: 11/29/2025"). Clicking Harlem opens the detail panel with gauge 67, 30-day avg 300, trend −12.8%. The only console error is a `500` from a station-detail request (see below). The `NEXT_PUBLIC_MAPBOX_TOKEN` is not in the 8 root-page chunks (map is a lazy chunk), but the map rendering proves the token is valid.

**APIs (live, 2026-10-03 UTC):**

| Route | Status | Key facts |
|---|---|---|
| `GET /api/chicago/stations` | 200, 5.4 KB, 4.2 s cold | `{stations:[25], dataAsOf:"2025-11-30T00:00:00.000Z"}`; every `sparkline: []` |
| `GET /api/chicago/stations-raw` | 200, 32 KB | **143 stations**, all `dataStatus:"available"`, `dataAsOf: 2025-11-30` |
| `GET /api/chicago/stations/088ea428…` (Harlem) | 200, 11.7 KB | `ridershipSeries` 91 pts **2025-09-01 → 2025-11-30**; `comparisons` (systemMedian 1481, lineMedian 1804, neighbors Cumberland / Jefferson Park Transit Center); `facts`, `narrative`, `sources` present |
| `GET /api/test` | 200 | Debug dump; shows `metrics.lastUpdated: 2026-02-01T17:14:58Z`, `serviceDateMax: 2025-11-30` |
| `GET /api/stations` | 200, 31.7 KB | Raw `Station` table dump (no auth) |

**Most recent ridership date in the API: 2025-11-30.** Metrics last computed **2026-02-01 17:14:58**.

**Concurrency failure.** Same 30 station-detail ids: sequential → `{"200":30}` in 22 s; 8-way → `{"200":13,"500":17}`. Full 143-id sweep at 8-way: 66 × 200, 77 × 500, body `{"error":"Failed to fetch station details"}` (the catch block hides the cause). The failing set changes run-to-run (Foster returned 200 alone, 500 in the sweep). Each route file creates a module-level `new PrismaClient()` and calls `$disconnect()` in `finally` (`src/app/api/chicago/stations/route.ts`, `[id]/route.ts`, `stations-raw/route.ts`), so parallel invocations thrash connections on the Neon pooler. The UI fetches detail on every row click, so users will hit this when several requests overlap.

---

## 2. Production database

**Where the URL lives.** `.env.local` contains only `VERCEL_OIDC_TOKEN` (no `DATABASE_URL`). `.env` has `DATABASE_URL` = `file:…/prisma/dev.db` (SQLite), `NEXT_PUBLIC_MAPBOX_TOKEN`, `CTA_API_KEY`. The production URL is **hard-coded with credentials** in tracked `scripts/fetch-all-2001.ts` (line 6).

**Provider.** Host `ep-purple-bread-ae5a0gwi-pooler.c-2.us-east-2.aws.neon.tech`, database `neondb` → **Neon** (pooled/PgBouncer endpoint, AWS us-east-2). Note: the pooler rejects `options` startup params (`statement_timeout`), so `PGOPTIONS` cannot be used; read-only was enforced with `SET default_transaction_read_only = on` per statement.

**Connectivity: reachable, not suspended.** `PostgreSQL 17.11 (fcae950) aarch64`, `now() = 2026-10-03 01:55 UTC`, size **39 MB**.

| Table | Rows |
|---|---|
| City | 1 |
| Station | 143 |
| StationAlias | 278 |
| RidershipDaily | **39,142** |
| StationMetrics | 143 |
| StationFact | 625 |
| StationNarrative | 143 |
| DataSource | 6 |

- `RidershipDaily`: **2024-11-30 → 2025-11-30**, 143 distinct stations; no duplicate (station, day) rows; no orphan rows. 2025-06 and 2025-07 contain only **89** stations (partial months; 143 from 2025-08).
- `StationMetrics`: `MAX(lastUpdated)` = **2026-02-01 17:14:58**, all 143 rows `serviceDateMax = 2025-11-30`.
- `_prisma_migrations`: single `20260202155550_init_production` (2026-02-02).
- `DataSource.cta_socrata.lastFetched` = **2026-02-02 17:41:32** (last evidence of any pipeline activity).
- `Station.lines` is `text` (JSON string), matching `schema.prisma` (`String`), not the `Json` the comment implies.
- Prod station roster = local roster except 4 display names (`Western`/`Western (O'Hare)`/`Harlem`/`Harlem (O'Hare)` vs the local "Blue - Forest Park Branch / O'Hare Branch" variants).

---

## 3. ETL / scheduler

**Where it lives.** `go-etl/cmd/go-etl/main.go` (cobra: `gtfs`, `ridership`, `compute`, `all`, `list-stations`, `sync-ridership`, `backfill-ridership`), `internal/chicago/{sync,matcher,parse,gtfs,ridership}.go`, `internal/db/{client,normalize}.go`, `internal/compute/ghost_score.go`. (`CLAUDE.md` cites `cmd/etl/main.go` and `internal/ingest/` — both wrong.)

**Deployment artifacts present:** `go-etl/Dockerfile`, `go-etl/Dockerfile.railway`, `go-etl/railway.toml`:
```
startCommand = "./etl sync-ridership --city chicago --days 90 && ./etl compute --city chicago"
cron = "0 6 * * *"
```
Root `Dockerfile` (Node + Go, SQLite volume), `vercel.json` (build only; **no `crons`**), **no `.github/workflows`**. `railway whoami/status/list` → `Unauthorized` (not logged in), so whether a Railway service exists cannot be confirmed from here.

**It could not have worked anyway.** `go-etl/internal/db/client.go`:
```go
import _ "github.com/mattn/go-sqlite3"
…
db, err := sql.Open("sqlite3", databaseURL)
```
`grep -rn 'pgx|lib/pq|postgres' go-etl` → no matches. The ETL is SQLite-only; every SQL statement uses SQLite idioms (`?` placeholders, `lower(hex(randomblob(16)))`, `datetime()`, `date(…, '-30 days')`). With a Postgres `DATABASE_URL` the binary would open a local SQLite file named after the URL and fail on the first query. Also, `railway.toml`'s `--days 90` would **prune** production to a 90-day window if it ever did run.

**Evidence of runs since February: none.** Prod `MAX(serviceDate)` 2025-11-30, metrics 2026-02-01, `DataSource.lastFetched` 2026-02-02; Vercel HTML cached since late September with the same `dataAsOf`.

**Local logs.** `sync_output.log`: `unknown command "sync" for "go-etl"` (wrong subcommand). `sync_debug.log` (2026-01-21): one successful run, `Options: {Days:365 Since:2025-01-01 Limit:1000}`. `sync_chicago_data.sh` targets `DATABASE_URL="./prisma/dev.db"` (local SQLite), `--since=2025-12-20`, `--limit=5000`.

**Build.** `go version go1.25.6`; `go.mod` says `go 1.21`, Dockerfiles use `golang:1.23`.
- `go build ./...` → **fails**: `scripts/populate_station_aliases.go:140:8: undefined: strings` (missing import).
- `go build ./cmd/... ./internal/...` → OK; `go build -o /tmp/etl ./cmd/go-etl` → 15.4 MB binary, `--help` works.
- Tracked binaries: `go-etl/etl` (15.4 MB, Jan 28) and `go-etl/go-etl` (15.2 MB, Jan 20).

**Design gaps in `internal/chicago/sync.go`.**
- `getSinceDate` → `date > MAX(serviceDate)`: upstream revisions to already-stored days are never re-fetched (see §4). `backfill-ridership --since` + `ON CONFLICT … DO UPDATE` is the only path that refreshes values.
- `fetchSocrataData` loads every page into memory before upserting (fine at ~5k rows/month, 1.3 M for a full history).
- Matcher ignores `StationAlias`; it uses `ctaStationId`, parsed base-name + inferred line, and a hard-coded `matchesSpecialCase` map. `"State/Lake" → {"State/Lake","Lake (Red)"}` matches nothing in the DB (station is named `Lake (Subway)`), so State/Lake rows are skipped (confirmed by `go-etl/docs/unmatched_socrata.csv`: 40260 State/Lake, 9,104 occurrences). `"Washington/Dearborn" → {"Washington"}` matches and then calls `UpdateStationCtaStationId` — a re-sync will self-heal the wrong 40500 id.

**Committed secrets (flag).**
- Socrata app token `wFGo…` (25 chars; first 4 chars shown) — tracked in `sync_chicago_data.sh`, `scripts/sync_missing_stations.sh`, `scripts/sync_missing_stations.py`, `scripts/manual_sync_stations.sh`, `docs/debugging-summary.md`; also in untracked `.claude/settings.local.json`. 1 commit introduced it.
- Neon connection string with password — tracked in `scripts/fetch-all-2001.ts`.
- `.env*` are correctly git-ignored and untracked.

---

## 4. Upstream data source (Chicago Data Portal / Socrata)

**Dataset IDs in code:** only `5neh-572f` (9 references; `sync.go`, docs, `DataSource.datasetId`). Stations come from CTA GTFS (`gtfs.go`, `google_transit.zip`), not from a Socrata dataset. For roster comparison I used the official `8pix-ypme` ("CTA – System Information – List of 'L' Stops").

**`5neh-572f` – CTA Ridership 'L' Station Entries Daily Totals** (`api/views/5neh-572f.json`):
- Exists, `publicationStage: published`, approved. **`rowsUpdatedAt: 2026-09-28T18:04:46Z`**.
- `SELECT max(date), min(date), count(*), count(distinct station_id)` → **max `2026-07-31`**, min 2001-01-01, **1,333,391 rows**, 148 station_ids all-time. Lag ≈ 2 months (consistent with CTA's normal cadence).
- Monthly rows Jun 2025 → Jul 2026: 4,032–4,464 rows/month, **144 stations/month** throughout.
- Columns: `station_id:number, stationname:text, date:calendar_date, daytype:text, rides:number` → **matches** `SocrataRecord{StationID "station_id", StationName "stationname", Date "date", Rides "rides"}` (all decoded as strings; `daytype` unused). `parseServiceDate` accepts the returned `2026-07-31T00:00:00.000` form.
- Retired ids (last date): 41580 Homan 2001-07-31, 40500 Washington/State 2009-01-31, 40640 Madison/Wabash 2018-01-01, 40200 Randolph/Wabash 2019-01-31. Rename: 40140 Skokie → Dempster-Skokie (2012). Newest: 41710 Damen-Lake (first 2024-07-01).
- **State/Lake 40260 after closure:** Nov 2025 207,231 rides; Dec 2025 178,990; Jan 2026 15,976; **Feb–Jul 2026: rows present with 0 rides.** If ever ingested, this station would rank as the #1 "ghost" unless flagged closed.

**Values have been restated upstream.** Same station/day, stored (local = prod) vs upstream today:

| Station | Date | Stored | Upstream now |
|---|---|---|---|
| 95th/Dan Ryan | 2025-03-03 | 3,961 | 5,333 |
| 95th/Dan Ryan | 2025-10-01 | 4,825 | 6,498 |
| Clark/Lake | 2025-03-03 | 7,089 | 7,545 |
| Clark/Lake | 2025-11-03 | 9,361 | 9,961 |
| Lake/State (41660) | 2025-11-03 | 9,391 | 9,683 |
| Washington/Dearborn | 2025-11-03 | 7,822 | 8,067 |
| Jefferson Park | 2025-11-03 | 4,473 | 4,552 |

Every sampled day across 2025 is lower in the stored copy by 2–26 %, station-dependent. Whatever the cause (CTA revision or a different source vintage at load time), the stored series is not the current series of record, and the incremental sync cannot repair it.

**`8pix-ypme` – List of 'L' Stops:** `rowsUpdatedAt 2025-11-19`; **144 parent stations** (distinct `map_id`); columns `stop_id, direction_id, stop_name, station_name, station_descriptive_name, map_id, ada, red, blue, g, brn, p, y, pnk, o, location`.

---

## 5. Station list freshness

**Current CTA facts (web, Oct 2026):**
- Red-Purple Modernization Phase 1: **Lawrence, Argyle, Berwyn, Bryn Mawr reopened 2025-07-20** — all four are in the DB with Nov-2025 data.
- **State/Lake closed 2026-01-05** for a ~3-year rebuild (reopen ≈ 2029); Brown/Green/Orange/Pink/Purple Exp no longer stop there; Lake (Red subway) stays open.
- Red Line Extension (103rd, 111th, Michigan, 130th): construction started 2026-04-24, opening ≈ 2030 — nothing to add yet.
- Damen (Green/Lake) opened 2024 — present as `Damen (Green)` (41710).

**Roster diff – official `8pix-ypme` (144) vs local/prod `Station.ctaStationId` (143 rows, 142 non-null):**

| Official map_id | Name | Local state |
|---|---|---|
| 40260 | State/Lake (Brn/G/Org/Pink/P) | **Missing entirely.** Never matched by the ETL. `StationAlias` wrongly maps "State/Lake" → `Lake (Subway)` 41660 (alias unused by matcher, so no data corruption). Now closed; should exist with a `closed` flag. |
| 40370 | Washington (Blue) | Present as `Washington` with `externalId 40370` but **`ctaStationId = 40500`** (Washington/State Red, closed 2006, last data 2009). Ridership is correct via name match; id is wrong. 40500 is the only local id absent from the official roster. |
| 41280 | Jefferson Park (Blue) | Present as `Jefferson Park Transit Center` with **NULL `ctaStationId`**; matched by name. |

Upstream ridership (`5neh-572f`) active roster (144) vs local: identical conclusion (missing 40260, 40370, 41280 by id; local 40500 not active upstream).

**`src/lib/cta/stationSequences.ts`:** 8 lines, 107 distinct names; `findNeighbors` does fuzzy/substring matching, so the 32 bare names (`Addison`, `Western`, …) resolve against suffixed DB names. Gaps: **Green sequence omits `Damen`** (should sit between California and Ashland) so Green-line neighbor lookups skip it; `State/Lake` is in Green/Brown/Orange/Pink/Purple sequences but has no DB row (neighbor pills silently drop it). No renamed stations detected upstream since 2012.

---

## 6. Local snapshot (`prisma/dev.db`, read-only)

- Size **496,570,368 bytes (473 MB)**; 121,233 × 4,096-byte pages, freelist 0; mtime 2026-02-01. Stray `prisma/prisma/dev.db` (86 KB, Jan 20).
- Tables: `City 1`, `Station 143`, `StationAlias 278`, `RidershipDaily 1,296,490`, `StationMetrics 143`, `StationFact 455`, `StationNarrative 25`, `DataSource 6`, `_prisma_migrations`.
- `RidershipDaily`: **2001-01-02 → 2025-11-30**; 146 distinct `stationId` = 143 real + **3 orphans** (90 rows, Nov 2025, ids `5d19a1c6…`, `b4e1fd1f…`, `c59b25a8…` hard-coded in `scripts/manual_sync_stations.sh`, which also mislabels Socrata ids: 41300 is Loyola not Jackson/State, 40320 is Division/Milwaukee not Clark/Division, 40370 is Washington/Dearborn not Chicago/State).
- **Duplicates: 32,388 (station, day) pairs have two rows** — one `2025-11-15T00:00:00Z` (ETL, RFC3339) and one `2025-11-15 00:00:00` (manual scripts), defeating the `(stationId, serviceDate)` unique key. Affects 2024-11 → 2025-11 (e.g. 2025-11: 7,200 rows, 4,380 unique). Any aggregate over raw rows (CSV export, `\copy` to Postgres per DEPLOYMENT.md) double-counts. The Go `GetMaxServiceDate` uses `datetime()` so both formats parse.
- Per-year coverage: 137 stations (2001) → 141 (2017–2023) → 143 (2024) → 146 incl. orphans (2025).
- `StationMetrics`: 143 rows, `MAX(lastUpdated) 2026-02-01 17:14:58`, `serviceDateMax 2025-11-30`, all `dataStatus = normal`.
- Local is **behind prod** on facts/narratives (455/25 vs 625/143) but **ahead** on ridership history (2001+ vs prod's 1-year window).

**Schema consistency vs `prisma/schema.sqlite.prisma`:** column sets match for all 8 models (`Station.ctaStationId` present; `StationFact.evidenceMeta`/`StationNarrative.evidenceMeta` as `JSONB`; enums stored as TEXT with defaults; indexes/uniques present). However:
- Local `_prisma_migrations` lists **6 SQLite migrations** (`20250208183804_init` … `20260201184004_add_narrative_quality`) while the repo's `prisma/migrations/` holds only `20260202155550_init_production` with `migration_lock.toml provider = "postgresql"`. `prisma migrate` against this file would report drift / unknown applied migrations.
- `prisma/schema.prisma` is byte-identical to `schema.postgres.prisma` (provider `postgresql`), while `.env` points `DATABASE_URL` at the SQLite file — the generated client cannot open the local DB without swapping schemas. `scripts/migrate-to-postgres.ts` imports both "clients" from the same `@prisma/client`, so it cannot talk SQLite and Postgres simultaneously with the current generated client.

---

## 7. Refresh plan — minimal concrete path

### Step 0 — Stop the bleeding (do first, ~30 min)
1. **Rotate the Neon role password** (Neon console → Roles) and update Vercel's `DATABASE_URL`; **rotate the Socrata app token**. Remove both from `scripts/fetch-all-2001.ts`, `sync_chicago_data.sh`, `scripts/sync_missing_stations.{sh,py}`, `scripts/manual_sync_stations.sh`, `docs/debugging-summary.md` (read env vars instead). Consider history rewrite if the repo is/was public.
2. `git rm --cached go-etl/etl go-etl/go-etl` and add `go-etl/etl` to `.gitignore`.

### Step 1 — Get current numbers into production (fastest path, no Go/Postgres port)
Because the Go ETL is SQLite-only and prod needs Postgres, the shortest route is **run the ETL locally against SQLite, then load Postgres via SQL**, not via `migrate-to-postgres.ts`.

1. Copy `prisma/dev.db` to a work file; **clean it**: delete `RidershipDaily` rows whose `serviceDate` lacks a `T` (the 32,388 manual-script duplicates — every one has an RFC3339 twin) and the 90 orphan rows (`stationId NOT IN (SELECT id FROM Station)`).
2. `DATABASE_URL=file:./work.db CHICAGO_DATA_APP_TOKEN=<new token> go run ./cmd/go-etl backfill-ridership --city chicago --since 2024-10-01` — backfill (not `sync-ridership`) so `--since` is honoured, prune is skipped, and `ON CONFLICT DO UPDATE` **overwrites the restated 2025 values**. Expect ~95 k rows; then `compute --city chicago`.
3. Export the window (`serviceDate >= 2024-11-30`, de-duplicated) and `StationMetrics` to CSV; in Neon run `TRUNCATE "RidershipDaily"` + `\copy`, and `UPDATE "StationMetrics"` from the CSV (or `TRUNCATE` + `\copy`). Station ids are identical in both DBs (verified), so no remapping is needed. Keep facts/narratives in prod untouched (prod is the richer copy).
4. Redeploy nothing — the API reads the DB; verify `dataAsOf` becomes `2026-07-31`.

Blockers / gotchas for this step: `getSinceDate` ignores revisions (hence `backfill`); matcher must still see `Washington/Dearborn` (it will, and will fix `ctaStationId`); State/Lake rows stay unmatched (fine for now); `migrate-to-postgres.ts` is unusable as written (single generated client); Neon pooler rejects startup `options`.

### Step 2 — Make it repeatable (the real fix)
Choose one:
- **(a) Port the Go ETL to Postgres** — add `pgx`, pick dialect from the URL, replace `?`→`$n`, `randomblob`→`gen_random_uuid()`, SQLite `datetime()/date(…,'-30 days')` in `client.go`/`ghost_score.go`. Then the existing `railway.toml` cron works (change `--days 90` → `--days 400`). Medium effort (~1 day), keeps one codebase.
- **(b) Replace with a TypeScript/Prisma sync** run by **Vercel Cron** or **GitHub Actions** daily: fetch `5neh-572f` where `date >= max - 60 days` (re-fetch a trailing window so revisions are absorbed), upsert, recompute metrics (port `ghost_score.go` maths). Small effort, no Railway.
Either way add a `CHICAGO_DATA_APP_TOKEN`/`DATABASE_URL` secret store (Railway/GitHub/Vercel), never files.

### Step 3 — Roster and correctness fixes (small, do alongside Step 1)
- Insert `State/Lake` (40260, lines Brn/G/Org/Pink/P, from `8pix-ypme`) with a **`closed`/`status` field** (needs a tiny migration) and exclude closed stations from ghost ranking; set `Washington.ctaStationId = 40370`, `Jefferson Park Transit Center.ctaStationId = 41280`; fix the `State/Lake` alias; add `Damen` to the Green sequence in `stationSequences.ts`; fix `matchesSpecialCase["State/Lake"]`.
- `go-etl/scripts/populate_station_aliases.go`: add `"strings"` import so `go build ./...` passes.

### Step 4 — Prod API hardening
- Single shared `PrismaClient` (`src/lib/prisma.ts` global singleton), remove `$disconnect()` in route `finally` blocks, and/or use Neon's pooled URL with `?pgbouncer=true&connection_limit=1` or the `@prisma/adapter-neon` driver → fixes the 50 % 500-rate under concurrency.
- Sparkline window relative to `serviceDateMax`, not `now()`.
- Remove or gate `/api/test` and `/api/stations`.
- Update `CLAUDE.md` ETL paths; align `go.mod` (1.21) with Dockerfiles (1.23).

### Step 5 — Local dev hygiene
- Regenerate local SQLite from Step 1's cleaned file, or drop the 2001–2024 history if not needed; reconcile `prisma/migrations` (keep SQLite migrations under a separate schema/migrations dir or stop using `migrate` for SQLite); delete `prisma/prisma/dev.db`.

**Ordering summary:** rotate secrets → clean local DB → backfill+compute locally → `\copy` into Neon → fix PrismaClient singleton → add State/Lake(closed)/ids/Damen → choose and ship a scheduler (Go+pgx on Railway, or TS on Vercel Cron/GitHub Actions).
