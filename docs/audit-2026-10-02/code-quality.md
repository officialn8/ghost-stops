# Ghost Stops - Code Quality, Dependency and Repo Hygiene Audit

**Repo:** `/Users/nate/ghost-stops` (branch `main`, clean, 26 commits, 2025-02-08 to 2026-02-07)
**Audit date:** 2026-10-02 (repo idle ~8 months)
**Mode:** read-only. No files modified, no packages installed, nothing committed.
**Toolchain observed:** Node v22.22.0, npm 10.9.4, Go 1.25.6 (darwin/arm64)

Secret values in this report are truncated to their first 4 characters.

---

## 0. Severity summary

| Sev | Finding |
|-----|---------|
| **CRITICAL** | A live Neon PostgreSQL connection string **with password** is committed at HEAD in `scripts/fetch-all-2001.ts` (added in `5ea7be9`, also in the deleted `scripts/fetch-missing-2001.ts` in history). Rotate the Neon password. |
| **CRITICAL** | Socrata `CHICAGO_DATA_APP_TOKEN` (`wFGo...`) is committed at HEAD in **5 tracked files** (`sync_chicago_data.sh`, `docs/debugging-summary.md`, `scripts/manual_sync_stations.sh`, `scripts/sync_missing_stations.py`, `scripts/sync_missing_stations.sh`), first in `b8067ac`. Rotate the token. |
| **HIGH** | `npm audit`: 86 vulnerabilities (3 critical, 65 high, 11 moderate, 7 low). Critical: `next` 15.5.9, `vitest` 4.0.17, `tar` (via sqlite3/node-gyp/@vercel/fun). Most of the "high" count comes from the `vercel` CLI being a **runtime dependency**. |
| **HIGH** | `go build ./...` and `go vet ./...` **fail** in `go-etl/` because `go-etl/scripts/populate_station_aliases.go:140` uses `strings` without importing it. Core packages (`./cmd/...`, `./internal/...`) build and vet clean. |
| **HIGH** | Two compiled Go binaries (`go-etl/etl` 15 MB, `go-etl/go-etl` 15 MB) and ~150 MB of census shapefiles/zips (`scripts/ingest/data/`) are tracked in git. Repo objects total 175 MB with zero packfiles. |
| **MEDIUM** | Dead code: the entire top-level `components/ui/` directory (17 shadcn files) is unreachable (`@/*` maps to `./src/*`, no relative imports exist). 13 `@radix-ui/*` packages, `class-variance-authority`, `shadcn-ui`, `claude`, `sqlite`, `sqlite3`, `apache-arrow`, `@tanstack/react-query`, `@radix-ui/react-icons`, `ts-node`, `mapshaper` have **no imports anywhere**. |
| **MEDIUM** | Three unused API routes (`/api/stations`, `/api/test`, `/api/chicago/stations` list) and two unused components (`GhostScoreHero.tsx`, `MobileViewListFAB.tsx`). `/api/test` exposes raw DB rows publicly. |
| **MEDIUM** | Docs drift: `.claude/CLAUDE.md` says Next 14 + SQLite and references 3 non-existent paths; `README.md` says SQLite; `prisma/schema.prisma` is PostgreSQL and the detail route uses Postgres-only SQL (`INTERVAL '90 days'`). The SQLite schema and Dockerfile (SQLite volume) are dead. |
| **LOW** | `tsc --noEmit`, `next lint`, and `vitest` all pass (23 tests, 1 file). `any` usage is only 5 occurrences across 3 files. |

---

## 1. Dependencies

### 1.1 Node / runtime

- No `engines` field in `package.json`; no `.nvmrc`. `next@15.5.9` requires `^18.18 || ^19.8 || >=20`. Root `Dockerfile` pins `node:20-bullseye`; `@types/node` is `^20`; locally Node 22 is installed. **Recommendation:** add `"engines": {"node": ">=20"}` and an `.nvmrc`.
- `/Users/nate/package-lock.json` exists in the home directory and Next.js warns it is choosing `/Users/nate` as the workspace root. Either delete that stray home-dir `package.json`/lockfile or set `outputFileTracingRoot` in `next.config.ts`.

### 1.2 Key framework versions (`npm outdated`, 2026-10-02)

| Package | Installed | Wanted (semver) | Latest | Gap |
|---|---|---|---|---|
| next | 15.5.9 | 15.5.27 | **16.3.8** | 1 major; current patch has a **critical** advisory |
| react / react-dom | 19.0.0 | 19.3.0 | 19.3.0 | minor |
| @prisma/client | 6.19.2 | 6.19.3 | **7.10.0** | 1 major |
| prisma (CLI) | 6.19.2 | 6.19.3 | 8.0.0-rc.19 | 1-2 majors; flagged high in audit |
| tailwindcss | **3.4.17 (v3)** | 3.4.19 | **4.3.3** | 1 major (v4 is a config-model rewrite) |
| mapbox-gl | 3.9.4 | 3.32.0 | 3.32.0 | 23 minors behind, same major |
| react-map-gl | 8.0.1 | 8.1.3 | 8.1.3 | minor |
| recharts | 3.7.0 | 3.10.1 | 3.10.1 | minor |
| framer-motion | 12.28.1 | 12.43.0 | **14.0.0** | 2 majors |
| eslint | 9.20.0 | 9.39.5 | **10.12.0** | 1 major; 9.20 has a ReDoS advisory in `@eslint/plugin-kit` |
| eslint-config-next | 15.1.6 (pinned) | 15.1.6 | 16.3.8 | pinned below `next` 15.5; flagged high |
| typescript | 5.7.3 | 5.9.3 | 7.0.2 | 2 majors (TS 7 = Go-based compiler; stay on 5.x for now) |
| vitest | 4.0.17 | 4.1.11 | 5.0.3 | **critical** advisory on installed range |
| @tanstack/react-query | 5.66.0 | 5.104.1 | 5.104.1 | **unused** - remove |
| @vercel/analytics | 1.6.1 | 1.6.1 | 2.0.1 | 1 major |
| lucide-react | 0.562.0 | 0.562.0 | 1.50.0 | 1 major |
| apache-arrow | 19.0.0 | 19.0.1 | 21.2.0 | **unused** - remove |
| vercel (CLI) | 50.9.6 | 50.44.0 | 62.2.0 | **should not be a dependency** |
| sqlite3 | 5.1.7 | 5.1.7 | 6.0.1 | **unused** - remove |

### 1.3 Suspicious / deprecated / misplaced dependencies

| Package | Problem |
|---|---|
| `claude@^0.1.1` | No imports anywhere. Unrelated npm package with a confusable name; remove. |
| `shadcn-ui@^0.9.4` | Deprecated package (superseded by `shadcn`). It is a CLI, not a runtime lib; no imports. Flagged **high** by audit. Remove. |
| `vercel@^50.9.6` | Deploy CLI listed as a **runtime** dependency. Pulls in `@vercel/*` (216 MB in node_modules) and is the source of ~30 of the "high" audit entries (undici, path-to-regexp, tar, ts-morph...). Remove; use `npx vercel` or a global install. |
| `sqlite` + `sqlite3` | Both unused; Prisma is the DB layer and the schema is PostgreSQL. `sqlite3` drags in `node-gyp`, `tar` (critical), `make-fetch-happen`. Remove both. |
| `apache-arrow` | Unused. Remove. |
| `@tanstack/react-query` | Unused (all data fetching is raw `fetch` in `useEffect`). Either adopt it or remove it. |
| `@radix-ui/*` (13 pkgs), `class-variance-authority` | Only imported by the dead top-level `components/ui/` dir. `@radix-ui/react-icons` has no imports at all. Remove with the dir, or move the dir into `src/` if you intend to use it. |
| `@types/mapbox-gl` | In `dependencies` with no imports; `mapbox-gl` v3 ships its own types. Remove. |
| `@types/react-map-gl` | react-map-gl v8 ships its own types; the DefinitelyTyped package targets v6. Remove. |
| `ts-node` | Unused; `tsx` is used for all scripts. Remove. |
| `mapshaper` (dev) | No imports; only plausible use is a CLI in `scripts/*.sh`. Flagged high via `adm-zip`. Pin or remove. |
| `autoprefixer` | Listed in `dependencies`, should be `devDependencies` (used by `postcss.config.js` only). |
| `shapefile`, `unzipper`, `@turf/turf` | Only used by `scripts/ingest/**`; move to `devDependencies`. |

### 1.4 npm audit (86 total: 3 critical, 65 high, 11 moderate, 7 low)

Direct dependencies with advisories:

| Direct dep | Severity | Fix |
|---|---|---|
| `next` 15.5.9 | **critical** | `npm update next` -> 15.5.27 (non-breaking) |
| `vitest` 4.0.17 | **critical** | `npm update vitest` -> 4.1.x (non-breaking) |
| `postcss` 8.5.6 | high | `npm update` (non-breaking) |
| `eslint` 9.20 | low | `npm update` (non-breaking) |
| `eslint-config-next` 15.1.6 | high | bump to `15.5.x` to match `next` (unpin `15.1.6`) |
| `prisma` 6.19.2 | high (via `@prisma/config` -> `effect`, `deepmerge-ts`) | audit's suggested fix is to downgrade; prefer upgrading to Prisma 7 |
| `tailwindcss` 3.4.17 | high (via `chokidar`/`micromatch`) | 3.4.19 or v4 migration |
| `sqlite3`, `vercel`, `shadcn-ui`, `mapshaper` | high | **remove** instead of fixing |

`npm audit fix` (no `--force`) would clear most of it; removing the five unused deps above clears nearly everything else.

### 1.5 Go modules (`go-etl/go.mod`)

- `go 1.21` directive; local toolchain is Go 1.25.6; Dockerfiles use `golang:1.23`. Bump directive to 1.23+.
- Updates available: `github.com/mattn/go-sqlite3` v1.14.19 -> **v1.14.52**, `github.com/spf13/cobra` v1.8.0 -> v1.10.2, `pflag` v1.0.5 -> v1.0.10. `go mod verify` passes.
- **Architecture mismatch:** the ETL still depends on `go-sqlite3` and uses SQLite SQL (`date(..., '-30 days')` in `ghost_score.go:183`) while the Prisma schema and Next.js API are PostgreSQL. Either the ETL writes to a SQLite file that is then migrated (`scripts/migrate-to-postgres.ts`), or the Railway deploy (`railway.toml`, `DATABASE_URL` postgres) never actually worked. This needs to be resolved before any ETL work.
- `gofmt -l` reports **all 9** Go files as unformatted.

### 1.6 Suggested upgrade order and risk

1. **Remove unused deps** (`claude`, `shadcn-ui`, `vercel`, `sqlite`, `sqlite3`, `apache-arrow`, `ts-node`, `@types/mapbox-gl`, `@types/react-map-gl`, `@tanstack/react-query` unless adopted, 13 `@radix-ui/*` + `class-variance-authority` once `components/ui/` is deleted). Risk: **very low**; eliminates ~60 of 86 advisories.
2. **`npm update` within semver** (`next` 15.5.27, `react` 19.3, `vitest` 4.1, `postcss`, `eslint` 9.39, `mapbox-gl` 3.32, `react-map-gl` 8.1, `recharts` 3.10, `framer-motion` 12.43, `@prisma/client` 6.19.3). Unpin `eslint-config-next` to `^15.5`. Risk: **low**; re-run `tsc`, `lint`, `vitest`, and a `next build`. mapbox-gl 3.9 -> 3.32 is the one to smoke-test on the map.
3. **Migrate `next lint` -> ESLint CLI** (`npx @next/codemod@canary next-lint-to-eslint-cli .`). `next lint` is removed in Next 16. Risk: **low**.
4. **Prisma 6 -> 7.** Breaking changes to `prisma.config.ts`, generator output, and `$queryRaw` typing. Risk: **medium**; only 6 API files + scripts use the client.
5. **Next 15 -> 16** (+ `eslint-config-next` 16, `@vercel/analytics` 2). Turbopack default, async request APIs already in use (`params: Promise<...>` is already correct). Risk: **medium**.
6. **framer-motion 12 -> 14** (11 importing files; check `motion.div` props and `AnimatePresence` changes). Risk: **medium**.
7. **Tailwind 3 -> 4.** Config moves from `tailwind.config.ts` (195 lines of theme tokens) to CSS `@theme`; `darkMode: ["class"]` and the 1,492 lines of custom CSS need review. Risk: **high / largest effort**; do last and only if desired.
8. **eslint 9 -> 10** after Next 16 (eslint-config-next 16 supports it). Risk: low-medium.
9. **TypeScript 5.7 -> 5.9** now (low risk); defer TS 7.

---

## 2. Build health

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0, no output) |
| `npm run lint` (`next lint`) | **PASS** - "No ESLint warnings or errors". Two warnings printed: `next lint` is deprecated (removed in Next 16), and the multiple-lockfile workspace-root warning (see 1.1). |
| `npx vitest run` | **PASS** - 1 file, 23 tests (`src/lib/cta/normalizeStationLines.test.ts`). No `vitest.config.*`; no component or API tests. |
| `go build ./...` (go-etl) | **FAIL** - `scripts/populate_station_aliases.go:140:8: undefined: strings` |
| `go vet ./...` (go-etl) | **FAIL** - same error |
| `go build ./cmd/go-etl` + `go vet ./cmd/... ./internal/...` | **PASS** |
| `gofmt -l .` | 9/9 files unformatted |

Fix for the Go failure: add `"strings"` to the import block of `go-etl/scripts/populate_station_aliases.go` (or move that one-off script out of the module / behind a build tag).

`next build` was not run per instructions.

---

## 3. Dead code and drift

### 3.1 Directory structure vs `.claude/CLAUDE.md`

CLAUDE.md's tree omits or misstates:

- **`components/ui/` (top-level, 17 files)** - not in CLAUDE.md. `tsconfig.json` maps `@/*` -> `./src/*`, so `@/components/ui/button` resolves to `src/components/ui/`, which only contains `Skeleton.tsx` and `SmartTooltip.tsx`. Zero relative imports reference the root dir. **All 17 files are dead** (badge, button, card, collapsible, dialog, dropdown-menu, hover-card, label, menubar, progress, scroll-area, separator, sheet, table, tabs, toggle, tooltip). They are the only consumers of 13 `@radix-ui/*` packages and `class-variance-authority`. `tailwind.config.ts` still scans `./components/**` and `./app/**` and `./pages/**` (none exist except the dead one).
- **`src/components/charts/RidershipChart.tsx`** - CLAUDE.md path; actual file is `src/components/station/RidershipChart.tsx`.
- **`go-etl/cmd/etl/main.go`** - does not exist; actual is `go-etl/cmd/go-etl/main.go`. CLAUDE.md's ETL command `go run cmd/etl/main.go ghost-scores chicago` is wrong on both path and subcommand (real subcommands: `gtfs`, `ridership`, `compute`, `all`, `sync-ridership`, `backfill-ridership`, `list-stations`).
- **`go-etl/internal/ingest/ridership.go`** - does not exist; actual is `go-etl/internal/chicago/{gtfs,matcher,parse,ridership,sync}.go`. `go-etl/internal/utils/` is an empty directory.
- Not mentioned at all: `src/components/narrative/`, `src/components/theme/`, `src/components/layout/`, `src/components/map/`, `src/hooks/`, `src/lib/narratives/`, `src/styles/`, `src/types/`, `types/`, `scripts/`, `/api/chicago/stations-raw`, `/api/chicago/stations/[id]/arrivals`, `/api/stations`, `/api/test`.
- CLAUDE.md's "List Stations" response shape (`lat`, `lon`, `dataStatus`, `sparkline`) is a blend of two routes: `/api/chicago/stations` returns `latitude/longitude/trend/sparkline` (no `dataStatus`); `/api/chicago/stations-raw` returns `dataStatus/lastDayEntries` (no sparkline). The frontend only calls `stations-raw`.

### 3.2 Unused API routes

Client code references exactly two endpoints: `/api/chicago/stations-raw?sort=ghost_score_desc` (MapContainer) and `/api/chicago/stations/{id}` (MobileLayout, StationDetailPanel).

| Route | Status |
|---|---|
| `src/app/api/stations/route.ts` | Unused. Returns every `Station` row unfiltered. Pre-Chicago leftover. Delete. |
| `src/app/api/test/route.ts` | Unused **debug endpoint deployed to production**. Dumps `city`, 5 stations, 5 stations+metrics, and leaks `error.message` details. Delete. |
| `src/app/api/chicago/stations/route.ts` | Unused by the UI (superseded by `stations-raw`). 142 lines incl. sparkline computation that CLAUDE.md documents as the primary list endpoint. Either make the UI use it or delete it and rename `stations-raw` -> `stations`. |
| `src/app/api/chicago/stations/[id]/arrivals/route.ts` | Not called by any component. Contains a `TODO` and returns **hard-coded mock arrivals** ("2 min", "5 min") while the layout metadata advertises "real-time arrivals". Delete or implement. |

### 3.3 Unused components / lib

| File | Note |
|---|---|
| `src/components/ghost/GhostScoreHero.tsx` | No importers. |
| `src/components/mobile/MobileViewListFAB.tsx` | No importers. |
| `src/components/map/map.tsx` | 4-line re-export shim for `MapContainer`; only used by `page.tsx`'s dynamic import. Fold into a direct `import("@/components/map/MapContainer")`. |
| `src/lib/ctaLineColors.ts` | Defines a **second, different** `ctaLineColors` palette (`Red: #F25757` vs `#C60C30` in `src/lib/utils.ts`) plus a deprecated `getMockLinesForStation()` with an `eslint-disable`. Imported by exactly one file. Consolidate on `utils.ts` / `explodeSegments.ts` `CTA_LINE_COLORS`. |
| `src/lib/cta/explodeSegments.ts` | Legacy predecessor of `explodeAndStitchSegments.ts`; the latter re-exports it. `LineFilter.tsx` still imports constants from the old module directly. |
| `prisma/seed.ts` | Stub that prints "Seed file contains Phoenix test data". Does nothing. Delete or implement. |

### 3.4 Duplicated utilities

- **Line colors defined three times:** `src/lib/utils.ts` (`ctaLineColors`), `src/lib/ctaLineColors.ts` (different hex values), `src/lib/cta/explodeSegments.ts` (`CTA_LINE_COLORS`). CLAUDE.md step "Add color to both files" institutionalises the duplication.
- **`getGhostScoreColor`** defined in `src/lib/utils.ts` (returns string) and again privately in `src/components/map/StationMarker.tsx:29` (returns `{bg,text,glow}`) with its own thresholds.
- **Fact labels** duplicated: `factLabels` map inline in `api/chicago/stations/[id]/route.ts` vs `getFactLabel()` in `src/lib/narratives/formatters.ts` with different wording ("Ridership Average (2001)" vs "2001 Ridership").
- **Trend calculation** `(rolling30d - rolling90d) / rolling90d * 100` copy-pasted in both list routes and the detail route.
- **`JSON.parse(station.lines || '[]')` try/catch** repeated in 4 places; `safeJsonParse` already exists in `utils.ts` and is used by only one route.
- **`new PrismaClient()`** instantiated per route file (6 instances) instead of a shared `src/lib/prisma.ts` singleton.

### 3.5 Leftover debug / build artefacts

| Item | Tracked? | Action |
|---|---|---|
| `sync_debug.log`, `sync_output.log` | **Yes** | Delete; add `*.log` to `.gitignore` (only `npm-debug.log*` etc. are ignored). |
| `tsconfig.tsbuildinfo` (203 KB) | No (`*.tsbuildinfo` ignored) | OK. |
| `.next/` (269 MB), `next-env.d.ts` | No | OK. |
| `go-etl/etl` (15 MB), `go-etl/go-etl` (15 MB) | **Yes** - compiled binaries | Remove from git, add `go-etl/etl` and `go-etl/go-etl` to `.gitignore`. These are also what `sync_chicago_data.sh` and `scripts/*.sh` invoke. |
| `scripts/ingest/data/**` (shapefiles, zips, csv.gz) | **Yes** - ~150 MB, with `bg2010_il` duplicated under both `census/` and `lodes/` | Move to Git LFS, a release asset, or download-on-demand in `scripts/ingest/`. This is why the repo is 175 MB. |
| `.DS_Store` files (root, prisma, scripts, src, src/app, src/components, go-etl) | No (ignored) | OK, but 8 of them exist on disk. |
| `prisma/dev.db` (496 MB) and `prisma/prisma/dev.db` (86 KB) | **No** (ignored via `*.db`) | Good. The nested `prisma/prisma/dev.db` is a stray from running Prisma with the wrong cwd; delete locally. |
| `.env`, `.env.local` | No (ignored via `.env*`) | Good. `.env*` also ignores `.env.example` and `.env.production.example` **but they are not tracked either** - new clones get no template. Add `!.env.example` / `!.env.production.example` negations and commit them. |
| `.vercel/` | No | OK. |
| `.claude/launch.json` | Untracked (created today) | Decide whether to commit. |
| Git object store | 601 loose objects, **0 packfiles**, 175 MB | `git gc` would compress; the binaries/shapefiles remain the real problem. |

### 3.6 Config duplication

- **Two PostCSS configs:** `postcss.config.js` (tailwindcss + autoprefixer) and `postcss.config.mjs` (tailwindcss only). Next.js picks one and silently ignores the other; which one depends on resolution order. Keep `postcss.config.mjs` with both plugins and delete `.js`.
- **Three Prisma schemas:** `schema.prisma` and `schema.postgres.prisma` are **byte-identical** (provider `postgresql`). `schema.sqlite.prisma` differs only in provider and `lines Json`/`evidenceFactKeys Json` -> `String`. The code at HEAD is Postgres-only (`$queryRaw` with `INTERVAL '90 days'`, `migration_lock.toml` provider `postgresql`), so `schema.sqlite.prisma` is dead. `deploy-vercel.sh` still copies `schema.postgres.prisma` over `schema.prisma`. Delete both extras.
- **`deploy-vercel.sh`:** interactive wizard that `read`s a `DATABASE_URL` into a shell variable and never uses it; `command -v npx vercel` is a no-op check. `vercel.json` already defines the build. Delete; keep `DEPLOYMENT.md`.
- **Root `Dockerfile`:** builds Node+Go together, sets `DATABASE_URL="file:/app/prisma/dev.db"` (SQLite) and runs `prisma migrate deploy` against a Postgres schema -> would fail. Dead since the Vercel+Railway split. Delete or rewrite.
- **`go-etl/Dockerfile` vs `go-etl/Dockerfile.railway`:** two near-identical Dockerfiles; `railway.toml` uses only the latter. Delete `go-etl/Dockerfile`.
- `.vercelignore` ignores `go-etl`, `docs`, `*.db`, `*.log` - fine.

### 3.7 `scripts/` directory (63 tracked files)

18 of 25 top-level scripts are referenced by nothing (no package.json script, no doc): `check_corrupted_stations.sql`, `debug_station_matching.sql`, `fetch-all-2001.ts` (contains the Neon secret), `fix-station-aliases.sql`, `fix_empty_datetime_fields.sql`, `fix_line_extraction.md`, `fix_track_segments.py`, `fix_zero_float_values.sql`, `generate_cta_tracks.py`, `manual_sync_stations.sh`, `populate_all_station_lines.sql`, `regenerate_with_loop_snap.sh`, `run-etl-sync.sh`, `sync_missing_stations.py`, `sync_missing_stations.sh`, `test_normalization.go`, `test_prisma_query.js`, `test_stitching.py`. Most are one-off SQLite fix-ups from Jan 2026 that are moot after the Postgres migration. `tsconfig.json` excludes `scripts/` so they are never type-checked.

---

## 4. Secrets

### 4.1 Committed at HEAD (rotate both)

1. **Neon PostgreSQL URL with password** - `scripts/fetch-all-2001.ts` (line ~18, `url: 'postgresql://neondb_owner:****@ep-purple-bread-...neon.tech/neondb'`). Introduced in `5ea7be9` (2026-02-02) in both `fetch-all-2001.ts` and `fetch-missing-2001.ts`; the latter was deleted in `208936e` but the former remains. The host and database name are also exposed.
2. **Socrata app token** `wFGo...` - tracked in `sync_chicago_data.sh`, `docs/debugging-summary.md`, `scripts/manual_sync_stations.sh`, `scripts/sync_missing_stations.py`, `scripts/sync_missing_stations.sh`. First committed in `b8067ac` ("added support for CTA API"). Also present in the untracked `.claude/settings.local.json` permission allow-list.

Because the repo history is small (26 commits), a history rewrite (`git filter-repo`) is feasible, but rotation is the only real fix; the Socrata token is low-impact (rate-limit token), the Neon password is not.

### 4.2 Checked and clean

- Mapbox tokens (`pk.eyJ...`): **none** in history or tracked files. `NEXT_PUBLIC_MAPBOX_TOKEN` appears only as a variable name.
- `.env`, `.env.local`, `.env.production`: never tracked (`git log --diff-filter=A` empty).
- `CTA_API_KEY`: only referenced via `process.env`.
- `.env.local` contains a `VERCEL_OIDC_TOKEN` (pulled by `vercel env pull`); it is short-lived and gitignored.
- Only the placeholder `postgresql://user:****@host:5432/database` appears in `DEPLOYMENT.md`.

---

## 5. Architecture smells

### 5.1 Component size
- `src/lib/cta/explodeAndStitchSegments.ts` - 762 lines (plus 231 in the legacy `explodeSegments.ts` it wraps).
- `src/components/map/MapContainer.tsx` - 640 lines: owns station fetch, GeoJSON fetch, line filter state, hover/selection state, view state, desktop and mobile layout branching, and the detail panel. This is effectively the app.
- `src/components/mobile/MobileStationDetail.tsx` - 495, `src/app/api/chicago/stations/[id]/route.ts` - 423, `MobileLayout.tsx` - 362, `StationMarker.tsx` - 318, `StationDetailPanel.tsx` - 315.
- `src/app/page.tsx` is 39 lines and `"use client"`, so the entire tree is client-rendered; nothing is a server component. Metadata in `layout.tsx` is the only server code.

### 5.2 Client/server boundaries
- 10 component files use hooks / `framer-motion` / `onClick` without a `"use client"` directive: `MobileLayout.tsx`, `MobileStationDetail.tsx`, `MobileFilterScroll.tsx`, `MobileSearchBar.tsx`, `MobileStationCard.tsx`, `MobileViewListFAB.tsx`, `MapTooltip.tsx` (and 3 pure-presentational ones). They work only because every importer is already a client component; they will break the moment one is imported from a server component. Add the directive.
- `src/lib/narratives/*` is imported by both the API route and client components; fine, but `ARCHETYPE_EMOJIS` / titles are presentation data living in `lib`.

### 5.3 Data fetching
- No react-query / SWR despite `@tanstack/react-query` being installed. All fetching is `fetch()` inside `useEffect` with manual `loading` state: `MapContainer.tsx:82,108`, `StationDetailPanel.tsx:89`, `MobileLayout.tsx:121`.
- **No error state in the UI.** All three fetchers only `console.error` on failure (`MapContainer.tsx:96-101,120`, `StationDetailPanel.tsx:106`, `MobileLayout.tsx:129`); the user sees a permanent skeleton or an empty map. There is no `error.tsx` or `loading.tsx` in `src/app/`, and no `not-found.tsx`.
- Station detail is fetched by **both** `StationDetailPanel` and `MobileLayout` with separate code paths and no cache; selecting the same station twice refetches.
- `MapContainer.tsx:90,92,116` leave `console.log("API Response:", data)` debug logs in production code (24 `console.*` calls in `src/`).
- Track geometry (`/data/cta/chicago_track_segments.geojson`, 500 KB) is fetched client-side on every load with no caching header strategy and then processed through the 762-line stitching module in the browser; this is a precomputation that belongs in a build step or the ETL.

### 5.4 API routes
- Each route does `const prisma = new PrismaClient()` at module scope **and** `await prisma.$disconnect()` in `finally`. On a warm serverless instance the next request reuses a disconnected client, forcing a reconnect per request. Use a `globalThis` singleton and drop `$disconnect()`.
- `[id]/route.ts` issues **~10 sequential queries** per request (station, raw 90-day series, aggregate, 2 counts, all metrics with station join, 2 neighbor lookups, facts, narrative). `findMany` of **all** `StationMetrics` + stations just to compute medians runs on every detail request; medians could be computed once in the ETL or cached.
- Neighbor lookup uses `name: { contains: "Western" }`-style fuzzy matching (`[id]/route.ts:148,168`), which will mis-resolve stations sharing a name fragment (Western, Pulaski, Kedzie, Cicero, Harlem, Clark/Lake vs Clark/Division...).
- `[id]/route.ts:274-290` hard-codes an **O'Hare narrative override** (story text, confidence 0.85, quality "MEDIUM") inside the route. This is content that belongs in the `StationNarrative` table / seed script.
- `[id]/route.ts:200-209` hard-codes `factLabels`, duplicating `getFactLabel()`.
- `/api/chicago/stations/route.ts` and `/api/chicago/stations-raw/route.ts` leak `error.message` to clients in the 500 body (`details`). `/api/test` leaks DB rows.
- No input validation: `parseInt(searchParams.get("limit") || "25")` accepts `NaN`/negatives; `sort` falls through a `switch` with a default (fine).
- No caching headers (`Cache-Control`, `revalidate`) on any route even though data changes once per day.
- `arrivals/route.ts` keeps a module-level `Map` cache - harmless but useless on serverless, and it caches mock data.

### 5.5 Hard-coded data that arguably belongs in the DB / ETL
- `src/lib/cta/stationSequences.ts` (308 lines) - station order per line; CLAUDE.md documents this as intentional. Acceptable, but GTFS `stop_sequence` is already ingested by `go-etl/internal/chicago/gtfs.go`.
- `go-etl/internal/compute/ghost_score.go:36` - `terminalStations` map (also hard-coded; derivable from `stationSequences` ends).
- O'Hare narrative override and fact labels in the API route (above).
- `scripts/data/top25-facts.json` seed data (fine as a seed).
- Default map `viewState` and the `activeLines` initial filter in `MapContainer`.

### 5.6 Type safety
- `any`: **5 occurrences in 3 files** - `types/shapefile.d.ts` (3, ambient module stubs for `shapefile`/`unzipper`), `src/lib/cta/explodeAndStitchSegments.ts` (1), `src/components/map/MapContainer.tsx` (1). No `@ts-ignore`/`@ts-expect-error`. One `eslint-disable` (`ctaLineColors.ts:21`). `strict: true` is on. Good.
- `scripts/` and `go-etl/` are excluded from `tsconfig.json`, so the TS scripts (`migrate-to-postgres.ts`, `seed-narratives-phase1.ts`, `scripts/ingest/**`) are never type-checked by `tsc`.

### 5.7 Accessibility (lint passes, but `next/core-web-vitals` barely checks a11y)
- Only **5 `aria-*` attributes** across the whole `src/` tree, **0 `role=`**, 18 `<button>` elements many of which are icon-only (theme toggle, close, filter chips, FAB) without `aria-label`.
- No `alt=` issues because no `<img>`/`<Image>` is used; the map is a canvas with no text alternative and no keyboard navigation for station markers (`StationMarker.tsx` relies on mouse hover/click).
- Infinite `framer-motion` animations (ghost float, pulsing ring, particles) with no `prefers-reduced-motion` guard found in `src/lib/motion/tokens.ts` or components (`grep` for `reduced-motion` returns only CSS in `animations.css`, worth confirming coverage).
- Consider adding `eslint-plugin-jsx-a11y` (it is not part of `next/core-web-vitals`'s strict set).

### 5.8 Styling
- 1,492 lines of hand-written CSS across `globals.css` + 4 files in `src/styles/` alongside a 195-line Tailwind theme; `tailwind.config.ts` scans non-existent `./pages`, `./app`, and the dead `./components` dirs.
- Two PostCSS configs (3.6).
- Four Google font families loaded (`Inter`, `Fraunces` marked "legacy", `Space_Grotesk`, `JetBrains_Mono`); `Fraunces` is likely removable.

---

## 6. Docs drift

### 6.1 Mismatches with code

| Doc | Claim | Reality |
|---|---|---|
| `.claude/CLAUDE.md:11` | "Next.js 14 (App Router)" | `next@^15.5.9` installed; README correctly says 15 |
| `.claude/CLAUDE.md:13,342` | "SQLite via Prisma ORM", `DATABASE_URL=file:./prisma/dev.db` | `prisma/schema.prisma` provider is `postgresql`; detail route uses Postgres `INTERVAL` |
| `.claude/CLAUDE.md` "Running ETL" | `go run cmd/etl/main.go ghost-scores chicago` | path is `cmd/go-etl/main.go`; command is `compute --city=chicago` |
| `.claude/CLAUDE.md` tree | `cmd/etl/main.go`, `internal/ingest/ridership.go`, `charts/RidershipChart.tsx` | none exist (see 3.1) |
| `.claude/CLAUDE.md` "Recent Changes (January 2025)" | dated 2025 | work was Jan-Feb **2026** |
| `.claude/CLAUDE.md` API shapes | list endpoint returns `lat/lon/dataStatus/sparkline` | see 3.1; frontend uses `stations-raw` |
| `.claude/CLAUDE.md` "Thresholds 65+ critical" | matches `utils.ts` | OK; but `StationMarker.tsx` has its own thresholds |
| `README.md:20` | "Database: SQLite with Prisma ORM" | PostgreSQL |
| `README.md:24` | "Node.js 18+" | Next 15.5 needs 18.18+; Dockerfile uses 20; recommend ">=20" |
| `README.md:5` | `![screenshot](docs/screenshot.png)` | file does not exist |
| `README.md` "Ghost Score ... based on ridership percentiles" (100/50/0) | superseded by the multi-factor composite in CLAUDE.md (max ~72) |
| `README.md` API list | `/api/chicago/stations` as "List all stations" | UI uses `/api/chicago/stations-raw`; `arrivals` returns mock data |
| `README.md:66` | `go run ./cmd/go-etl all --ridership=...rows.csv` | ETL still targets SQLite; with Postgres `DATABASE_URL` this path is unverified |
| `DEPLOYMENT.md` | `cp prisma/schema.postgres.prisma prisma/schema.prisma` | files are already identical; step is a no-op |
| `DEPLOYMENT.md` "Railway (Go ETL)" with Postgres `DATABASE_URL` | `go-etl` only links `go-sqlite3` and uses SQLite SQL | contradiction; see 1.5 |
| `docs/hybrid-sync.md`, `docs/chicago-cta-implementation.md`, `docs/facts-narrative-system.md:223` | SQLite DB, `sqlite3 prisma/dev.db ...`, "SQLite limitation" | Postgres at HEAD |
| `go-etl/README.md:8` | "SQLite database (configured via Prisma in parent project)" | parent is Postgres |
| Various docs | reference `scripts/ingest-census-acs.ts`, `scripts/ingest-lodes.ts`, `scripts/ingest-fhwa.ts`, `scripts/generate-narratives.ts`, `src/hooks/useMobileSheet.ts`, `src/hooks/useScreenHeight.ts`, `go-etl/run-sync.sh`, `go-etl/main.go`, `go-etl/internal/chicago/historical_ridership.go`, `scripts/fix_alias_normalization_standalone.go`, `scripts/populate_station_aliases.go` | none exist (ingest scripts live in `scripts/ingest/sources/*.ts`; `populate_station_aliases.go` is in `go-etl/scripts/`) |

### 6.2 Per-file verdict for `docs/` (11 files, 3,913 lines)

| File | Lines | Verdict |
|---|---|---|
| `Ghost-Stops-Transit-Project.md` | 190 | Original vision/PRD. **Keep** as `docs/VISION.md`; still accurate at the product level. |
| `chicago-cta-implementation.md` | 254 | Setup guide written for SQLite. **Stale**; merge the still-valid ETL bits into `go-etl/README.md`, delete. |
| `chicago-mvp-progress.md` | 386 | Phoenix->Chicago pivot progress log (Jan 2026). **Historical**; archive or delete. |
| `debugging-summary.md` | 69 | One-off Jan 2026 debugging notes; **contains the Socrata token**. Delete. |
| `hybrid-sync.md` | 71 | Describes SQLite local cache. Core idea still valid; **rewrite** for Postgres and fold into `go-etl/README.md`. |
| `ridership-mapping-implementation.md` | 91 | Explains alias/normalization matching in `go-etl/internal/db/normalize.go`. **Keep** (move next to the Go code or into go-etl/README). |
| `facts-narrative-system.md` | 302 | Design doc for facts/narratives; mostly accurate, mentions "SQLite limitation" and non-existent script names. **Keep, update**. |
| `design-overhaul.md` | 314 | Design-system description (Feb 7, last-touched file in the repo). **Keep** as the design reference. |
| `UI Overhaul Design Audit.md` | 1,231 | Opinionated critique that drove the redesign. Filename has spaces. **Archive** (`docs/archive/`) or delete; superseded by `design-overhaul.md`. |
| `ui-review-findings.md` | 789 | Feb 1 review with "Status: In Progress" bug list. **Stale** - convert open items to issues, delete. |
| `review-2026-02-01.md` | 216 | Point-in-time project review. **Archive**. |

Plus: `go-etl/docs/chicago-unmatched-stations.md` + `unmatched_socrata.csv` (ETL output artefacts; regenerate on demand rather than track), `scripts/fix_line_extraction.md` (one-off note, delete).

**Consolidation target:** `README.md` (accurate quickstart, Postgres), `DEPLOYMENT.md` (Vercel + Railway, fix the ETL/DB contradiction), `.claude/CLAUDE.md` (regenerated from the real tree), `go-etl/README.md` (ETL + sync + matching), `docs/VISION.md`, `docs/design-system.md`, `docs/facts-narrative-system.md`, `docs/archive/*`.

---

## 7. Prioritised cleanup checklist

### Quick wins (minutes each, no behaviour change)

- [ ] **Rotate the Neon database password** and the Socrata app token (external consoles).
- [ ] Remove the Neon URL from `scripts/fetch-all-2001.ts` (read `process.env.DATABASE_URL`); delete or scrub `sync_chicago_data.sh`, `docs/debugging-summary.md`, `scripts/manual_sync_stations.sh`, `scripts/sync_missing_stations.{py,sh}`. Optionally `git filter-repo` the history (26 commits).
- [ ] Remove the token from `.claude/settings.local.json`'s allow-list entry.
- [ ] Add `"strings"` import to `go-etl/scripts/populate_station_aliases.go` (unbreaks `go build ./...` / `go vet ./...`); run `gofmt -w .`.
- [ ] `git rm` `sync_debug.log`, `sync_output.log`, `go-etl/etl`, `go-etl/go-etl`; add `*.log`, `go-etl/etl`, `go-etl/go-etl`, `!.env.example`, `!.env.production.example` to `.gitignore`; commit the two example env files.
- [ ] Delete `postcss.config.js`; add `autoprefixer` to `postcss.config.mjs`.
- [ ] Delete `prisma/schema.sqlite.prisma`, `prisma/schema.postgres.prisma`, `deploy-vercel.sh`, root `Dockerfile`, `go-etl/Dockerfile`, `prisma/seed.ts` (or implement it), `prisma/prisma/dev.db` (local only).
- [ ] Delete `src/app/api/test/`, `src/app/api/stations/`, `src/components/ghost/GhostScoreHero.tsx`, `src/components/mobile/MobileViewListFAB.tsx`, `src/components/map/map.tsx` (import `MapContainer` directly).
- [ ] Delete top-level `components/ui/` (17 files); then `npm uninstall` the 13 `@radix-ui/*` packages, `class-variance-authority`, `claude`, `shadcn-ui`, `vercel`, `sqlite`, `sqlite3`, `apache-arrow`, `ts-node`, `@types/mapbox-gl`, `@types/react-map-gl`, and `@tanstack/react-query` (unless adopting it). Move `autoprefixer`, `shapefile`, `unzipper`, `@turf/turf` to devDependencies. Remove `./pages`, `./app`, `./components` from `tailwind.config.ts` `content`.
- [ ] `npm update` within semver + unpin `eslint-config-next` to `^15.5`; re-run `npm audit` (expect near-zero).
- [ ] Add `"engines": {"node": ">=20"}` and `.nvmrc`; set `outputFileTracingRoot` or remove `/Users/nate/package-lock.json`.
- [ ] Remove `console.log` debug lines in `MapContainer.tsx:90,92,116`.
- [ ] Add `"use client"` to the 7 interactive mobile/map components lacking it.
- [ ] Fix `.claude/CLAUDE.md`: Next 15, PostgreSQL, real paths (`cmd/go-etl`, `internal/chicago`, `station/RidershipChart.tsx`), real ETL command, "January 2026", API shapes. Fix `README.md` DB/Node/score/screenshot lines.
- [ ] Delete the 18 unreferenced `scripts/*` one-offs (or move to `scripts/archive/`), `scripts/fix_line_extraction.md`, `docs/debugging-summary.md`; move `UI Overhaul Design Audit.md`, `ui-review-findings.md`, `review-2026-02-01.md`, `chicago-mvp-progress.md` to `docs/archive/`.

### Medium (an hour or two each)

- [ ] Create `src/lib/prisma.ts` singleton; remove per-route `new PrismaClient()` and `$disconnect()`.
- [ ] Consolidate line colours into one module (`utils.ts` or `cta/explodeSegments.ts`); delete `src/lib/ctaLineColors.ts`; make `StationMarker.tsx` use `getGhostScoreColor` from `utils.ts`.
- [ ] Decide between `/api/chicago/stations` and `/api/chicago/stations-raw`; keep one, rename to `stations`, add `Cache-Control`/`revalidate`, stop leaking `error.message`.
- [ ] Delete or implement `arrivals` route (currently mock); drop "real-time arrivals" from `layout.tsx` metadata if deleted.
- [ ] Move O'Hare narrative override and `factLabels` out of the detail route into the narrative seed / `formatters.ts`.
- [ ] Add UI error states (`error.tsx`, `not-found.tsx`, inline error in `MapContainer`/`StationDetailPanel`/`MobileLayout`); add a shared `useStationDetail(id)` hook (react-query or SWR) so desktop and mobile share fetch + cache.
- [ ] Migrate `next lint` -> ESLint CLI (`npx @next/codemod@canary next-lint-to-eslint-cli .`); add `eslint-plugin-jsx-a11y`; add `aria-label` to icon-only buttons.
- [ ] Include `scripts/` in a secondary `tsconfig.scripts.json` so ingest/migration scripts are type-checked.
- [ ] Move `scripts/ingest/data/**` (~150 MB) out of git (LFS or fetch script); `git gc`.
- [ ] Resolve neighbour lookup to exact-match by `externalId`/sequence rather than `name contains`.
- [ ] Bump `go.mod` to `go 1.23`; update `go-sqlite3`, `cobra`, `pflag`.

### Larger refactors

- [ ] **Resolve the ETL database split.** Either port `go-etl` to PostgreSQL (`pgx`, rewrite `date(...,'-30 days')` -> `INTERVAL`) so the Railway cron actually feeds the production DB, or formalise SQLite->Postgres as a two-step pipeline with `scripts/migrate-to-postgres.ts` and document it. Today `DEPLOYMENT.md` promises something the code cannot do.
- [ ] Break up `MapContainer.tsx` (640 lines) into data hook + map layer + desktop shell + mobile shell; make `page.tsx` a server component that streams the station list.
- [ ] Precompute stitched track segments (`explodeAndStitchSegments.ts`, 762 lines) at build/ETL time and ship static GeoJSON per line instead of processing in the browser.
- [ ] Precompute system/line medians, percentiles, and neighbour references in the ETL (`StationMetrics`) so the detail route is 2-3 queries instead of ~10.
- [ ] Framework upgrades in order: Prisma 7 -> Next 16 (+ eslint-config-next 16, @vercel/analytics 2) -> framer-motion 14 -> eslint 10 -> (optional) Tailwind 4.
- [ ] Test coverage: today 1 test file covers `normalizeStationLines`. Add tests for `stationSequences.findNeighbors/getPrimaryLine`, `explodeAndStitchSegments`, `narratives/renderer`, and API route handlers (with a Prisma mock).
