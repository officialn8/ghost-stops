# Ghost Stops audit, 2 October 2026

Four parallel read-only audits of the repo after eight idle months (last commit 7 Feb 2026). Nothing in `src/`, `go-etl/`, or the databases was changed. Full reports:

- [data-pipeline.md](data-pipeline.md): production status, Neon database, ETL, upstream Socrata, station roster, refresh plan
- [design.md](design.md): UI inventory, verdicts, three design directions, build order (screenshots in `screens/`)
- [code-quality.md](code-quality.md): dependencies, build health, dead code, secrets, architecture, docs drift, cleanup checklist
- [ghost-score.md](ghost-score.md): algorithm vs docs, statistical critique, neighbor sequences, data model, v2 scoring proposal

Reproduction script for the score analysis: the `analyze.py` referenced in ghost-score.md reproduces the stored score for all 143 stations exactly.

## State of the system in one paragraph

The site at ghost-stops.vercel.app is up and the map renders. The Neon Postgres behind it is reachable and holds ridership through 30 Nov 2025 with metrics computed 1 Feb 2026. Upstream CTA data at the Chicago Data Portal now runs through 31 Jul 2026 and was last updated 28 Sep 2026. The Go ETL has never fed production: it only speaks SQLite, the Railway service builds against a SQLite volume, and every Railway deployment from 2 Feb 2026 onward failed (checked via the Railway connector; build logs have since expired). The detail API returns 500 for about half of concurrent requests because each route creates and disconnects its own Prisma client against the Neon pooler. The January 2026 redesign shipped as a visual skin on an unchanged information architecture, and roughly half of the current UI is dead or broken.

## Findings ranked by severity

### Critical

1. **Live Neon connection string with password committed at HEAD** in `scripts/fetch-all-2001.ts` (since commit `5ea7be9`). Rotate the Neon role password and update Vercel's `DATABASE_URL`.
2. **Chicago Data Portal app token committed** in `sync_chicago_data.sh`, `scripts/manual_sync_stations.sh`, `scripts/sync_missing_stations.sh`, `scripts/sync_missing_stations.py`, `docs/debugging-summary.md`, and in the untracked `.claude/settings.local.json`. Rotate it. Mapbox tokens and `.env*` were never committed.
3. **ETL cannot write to production.** `go-etl/internal/db/client.go` opens every URL as SQLite. The Railway cron (`0 6 * * *`, `--days 90`) could never have run as written. No GitHub Actions or Vercel cron exists.

### High

4. **Data is ten months stale** (prod through 2025-11-30; upstream through 2026-07-31).
5. **Stored 2025 values no longer match upstream.** CTA restated the data; the `date > MAX(serviceDate)` sync can never absorb revisions. A windowed re-backfill is required.
6. **Prod detail API fails under concurrency** (77 of 143 stations returned 500 in a full sweep). Per-route `new PrismaClient()` plus `$disconnect()`.
7. **Local SQLite has 32,388 duplicate (station, day) rows** from mixed date formats across two writers, plus 90 orphan rows.
8. **Station identity errors**: Western (Blue) and Western (Orange) have swapped CTA ids; Washington (Blue) carries a closed station's id; State/Lake was never ingested and has been closed since 5 Jan 2026 (would rank as the top ghost if ingested unflagged); Jefferson Park has a null CTA id; four Loop stations wrongly list Green; Wilson omits Purple; Green sequence lacks Damen.
9. **`npm audit`: 86 vulnerabilities (3 critical).** Most come from unused runtime dependencies (`vercel` CLI, `sqlite3`, deprecated `shadcn-ui`, a stray `claude` package). Removing them and running `npm update` clears nearly all.
10. **`go build ./...` fails** on a missing `strings` import in `go-etl/scripts/populate_station_aliases.go`. Core packages build clean.

### Medium

11. **Ghost score is 98% correlated with raw ridership percentile.** Trend is pure seasonality (all 143 stations "declining" in Nov vs Sep–Nov; correlation with true year-over-year change is 0.02). Variability measures commuter-ness, not erraticness. Context adjustment only shifts scores, never ranks. Real range is 22 to 67, so the fixed color thresholds put 117 of 143 stations in amber.
12. **Design: color is structurally broken.** Three CTA line palettes (map and badges use a non-official remix), five disagreeing ghost-score scales, a traffic-light ramp colliding with Red, Orange, Yellow and Green lines.
13. **Dead and broken UI**: list sparklines never render (list fetches `stations-raw`, which has no sparkline field, and the window uses wall-clock time); detail route uses Postgres-only SQL; infinite skeleton on empty search and fetch failure; "Live Data" badge beside a November date; no station URLs so Share shares the homepage; unused `GhostScoreHero`, `MobileViewListFAB`, Fraunces font, most of `animations.css`.
14. **Accessibility**: station rows are `div onClick` with no keyboard path; white on Yellow chips at ~1.3:1; 9 to 12px tertiary text; zero reduced-motion handling; 18 infinite animations.
15. **Dead code**: top-level `components/ui/` (17 files) is unreachable and is the only consumer of 13 Radix packages; unused routes `/api/stations`, `/api/test` (public DB dump), `/api/chicago/stations` (UI uses `stations-raw`), `arrivals` (mock data); 18 of 25 top-level scripts referenced nowhere; two 15 MB Go binaries and ~150 MB of census shapefiles tracked in git.
16. **Docs drift**: `CLAUDE.md` says Next 14 and SQLite with a wrong ETL path; `README.md` says SQLite, Node 18, percentile-only score; 11 docs reference about 11 nonexistent scripts.

### Passing

`tsc --noEmit` clean. `next lint` clean. Vitest 23/23 (one file). Only 5 `any` usages. Red-Purple Modernization stations (Lawrence, Argyle, Berwyn, Bryn Mawr) are present.

## What is worth keeping

The ghost concept and the idea of a multi-factor score. The narrative, evidence and sources system. The offset parallel-track map rendering (`explodeAndStitchSegments`). Line-sequence neighbor navigation. System, line and neighbor comparisons. The map-first mobile model with a bottom sheet. Facts data (prod holds the richer copy).

## Proposed plan

Phases are ordered so the data is trustworthy before the redesign shows it. Each phase is a reviewable PR.

### Phase 0: Stop the bleeding (about an hour)

- Rotate the Neon password and the Socrata token. Update Vercel and Railway variables.
- Remove both secrets from the six files; read from env instead. Decide whether to rewrite git history (26 commits touched) if the repo is or was public.
- `git rm` the two Go binaries and the two log files; extend `.gitignore`.
- Fix the `strings` import so `go build ./...` passes.

### Phase 1: Current, correct data in production (one to two days)

- Dedupe the local SQLite (drop non-RFC3339 twins and orphans). Normalize `serviceDate` in both writers.
- Fix station identities: Western swap, Washington id, Jefferson Park id, add State/Lake with a `status`/`closedAt` field (needs a small migration), fix `Station.lines` for the four Loop stations and Wilson, add Damen to the Green sequence, resolve the four alias collisions.
- Run `backfill-ridership --since 2024-10-01` locally (not `sync-ridership`, so revisions are overwritten), then `compute`.
- Load the window into Neon via CSV copy. Station ids match between databases. Leave facts and narratives in prod untouched.
- Add a Prisma client singleton; remove `$disconnect()` from routes. Sparkline window relative to `MAX(serviceDate)`.
- Verify `dataAsOf` becomes 2026-07-31 and the detail route survives a concurrent sweep.

### Phase 2: Make the refresh repeatable (one day)

Decision needed, see below. Either port the Go ETL to Postgres via pgx so the existing Railway cron works, or replace it with a TypeScript sync on Vercel Cron or GitHub Actions that re-fetches a trailing 60-day window. Either way, secrets live in the platform's secret store.

### Phase 3: Ghost score v2 (one day in the ETL, plus UI)

Percentile-ranked components, combined and re-ranked to 0–100:

| Component | Weight | What it measures |
|---|---|---|
| Residual vs same-branch neighbors | 45% | "Gets X% of the riders its neighbors get" |
| Year-over-year, weekday/weekend separated | 25% | "Down X% from the same period last year" |
| Long-run vs 2019 | 20% | "Carries X% fewer riders than in 2019" |
| Day-type-separated erraticness (MAD/median) | 10% | "Weekday ridership swings ±X% day to day" |

Drop the constant context term. Persist component percentiles and raw inputs with `scoreVersion = 2`. Tiers by quantile: ghost / fading / quiet / healthy. Expected effect: Halsted (Green), King Drive, Kostner, Indiana stay on top; growing Evanston Purple stations drop out; Loop stations leave "warning"; Wilson surfaces as "fading" despite high volume.

### Phase 4: Redesign (the main event)

Recommended direction: **"Wayfinding"** (Direction A in design.md), borrowing the `/station/[slug]` dossier page from Direction B.

- Concept: a CTA platform sign that happens to be interactive. Dark default with light mode. Map-first with a 360px anchored ledger of all stations and a 440px detail drawer that is also a real page.
- Color rule: official CTA line colors only, reserved for lines. Ghost score is never a hue. It is a presence ramp in the UI's own ink (solid, 72%, 44%) with hollow dashed marks for ghosts, bucketed by quantile. One interaction accent, and it is inversion.
- Type: Archivo (variable width) plus JetBrains Mono for numbers. Remove Inter, Fraunces, Space Grotesk.
- Motion: enter, exit, count-once, draw-once, fly-to. Zero loops. `useReducedMotion` everywhere. Drop react-spring and use-gesture.
- Map: custom style with POI and road labels hidden, stations as circle and symbol layers instead of DOM markers.
- "Why this score" card with four rows showing the v2 components with real numbers and peers used, a "small but steady" badge, and data-quality chips.
- Deletes about 1,400 lines of glass CSS, animation CSS, duplicate palettes and dead components.

Seven-step build order is in design.md section 5. Alternatives: Direction B "The Dossier" (editorial, light, list-first, news-interactive register) and Direction C "Ledger" (monochrome dense table, map as toggle, fastest to build).

### Phase 5: Cleanup and upgrades (ongoing, low risk first)

Quick wins from code-quality.md section 7, then: ESLint CLI migration, Prisma 7, Next 16, framer-motion 14, eslint 10, Tailwind 4 optional. Break up the 640-line `MapContainer`. Precompute stitched segments and medians in the ETL. Add tests for sequences, stitching, narratives, and API routes. Rewrite `CLAUDE.md` and `README.md`; archive five stale docs.

## Decisions needed before building

1. **Design direction**: A "Wayfinding" (recommended), B "The Dossier", or C "Ledger".
2. **Scheduler**: port the Go ETL to Postgres and keep Railway, or replace with a TypeScript sync on Vercel Cron / GitHub Actions and retire the Railway service.
3. **Git history**: rewrite to purge the two secrets (requires force-push and invalidates clones), or rotate only.
4. **History depth**: keep the 2001–2024 ridership history in production (enables the 2019 baseline and 2001 facts) or ship only the trailing window.
