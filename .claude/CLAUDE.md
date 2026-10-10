# Ghost Stops

Ghost Stops ranks Chicago's 144 CTA "L" stations by how empty they are for their context, and explains each ranking in plain words. Live at https://ghost-stops.vercel.app.

The ranking is the **Ghost score**: a 0 to 100 percentile over the ranked stations, where 100 is the most ghost-like. Every station has a shareable page at `/station/[slug]` with its riders per day, its tier, a "why this score" card, a story, and the stations beside it on the line.

## Stack

- **App:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 3 with the theme replaced by design tokens.
- **Data:** Neon Postgres through Prisma 7 (`@prisma/adapter-pg` over one `pg` pool). The client is generated into `src/generated/prisma` and is not committed.
- **Map:** Mapbox GL JS through `react-map-gl`, with stations as circle and symbol layers.
- **Motion:** `motion` 14, imported from `motion/react`.
- **Hosting:** Vercel, with Fluid compute and two Vercel Cron schedules for the ridership sync. The live Ghost score worker runs on one Fly.io Machine (`Dockerfile`, `fly.toml`) with its raw record and checkpoint in a Cloudflare R2 bucket and a Healthchecks.io dead-man's switch.
- **Source data:** CTA daily station entries, Chicago Data Portal dataset `5neh-572f`, read over Socrata's SODA API. CTA Train Tracker (positions and arrivals, polled every minute by the worker) and CTA's static GTFS (the rail schedule) for the live Ghost score.

## Commands

```bash
npm install          # also runs `prisma generate` (postinstall)
npm run dev          # dev server on :3000; needs DATABASE_URL and NEXT_PUBLIC_MAPBOX_TOKEN
npm run build        # production build
npm run lint         # eslint ., including the server-only import rule
npx tsc --noEmit     # type check
npx tsc --noEmit -p tsconfig.scripts.json   # type check scripts/, which the root config excludes
npm test             # unit (node) and components (jsdom) projects; no database
npm run test:db      # database project; needs a local Postgres with migrations applied
npx tsx scripts/run-sync.ts [--since YYYY-MM-DD] [--station-id ID] [--reconcile]   # sync from a shell
npx tsx scripts/live-worker.ts [--once | --gtfs-check | --store-check]   # the live worker, or one of its checks
```

Prisma 7 does not read `.env`. Next reads `.env.local` and `.env.development.local` for the dev server, but the Prisma CLI, `scripts/*`, and `npm run test:db` need the variables exported in the shell. `.env.example` lists them all.

## Layout

```
src/
├── app/
│   ├── (shell)/                     route group: the persistent shell
│   │   ├── layout.tsx               Shell: top bar, ledger, map, drawer
│   │   ├── page.tsx                 "/" renders nothing; the shell is the page
│   │   └── station/[slug]/          the station page: data.ts, page.tsx, loading, error, not-found
│   ├── method/page.tsx              "/method": the ledger's figures explained from a live row, the score, the data, the API
│   ├── api/
│   │   ├── chicago/stations/route.ts          GET: every station for the map and ledger
│   │   ├── chicago/stations/[slug]/route.ts   GET: one station's detail
│   │   ├── cron/sync-ridership/route.ts       the sync, run by Vercel Cron
│   │   └── health/route.ts                    sync health, checked daily by GitHub Actions
│   ├── layout.tsx, globals.css      fonts, theme script, design tokens
│   ├── icon.svg                     the ghost tab icon
│   └── robots.ts, sitemap.ts
├── components/
│   ├── shell/       Shell, TopBar, Drawer, MobileSheet, HealthBanner, ShellContext, useStationList
│   ├── ledger/      the station list: header (sort, line filter, search), rows
│   ├── dossier/     the station page: SignHeader, WhyCard, Baselines, RidershipChart, AlongTheLine, Sources
│   ├── map/         MapView, layers, marks (rasterized presence marks), stationMap
│   ├── marks/       PresenceMark (tier marks), LineBars
│   ├── narrative/   StationStory, FactCard
│   ├── method/      the method page: MethodPage, MethodBar, RowKey (the pinned row and its key), AnnotatedRow (the real LedgerRow), key (list primitives)
│   ├── charts/      Sparkline (SVG)
│   └── theme/       ThemeProvider, ThemeToggle, THEME_SCRIPT
├── lib/
│   ├── cta/         roster (144 stations by CTA id), sequences (line topology), slug, slugAliases,
│   │                closures, explodeAndStitchSegments (track drawing), normalizeStationLines
│   ├── sync/        Socrata client, run, lease, upsert, reconcile, baseMetrics, status, health,
│   │                freshness, schedule, window
│   ├── live/        the live Ghost score (server-only): trainTracker (the CTA client), serviceDay,
│   │                gtfs, schedule, scheduleArchive, objectStore (R2), rawStore, tracker, loop,
│   │                healthchecks; __fixtures__/ holds the GTFS rail slice
│   ├── scoring/     score (v2), components, peers, availability, windows, percentile, whyCard
│   ├── narratives/  archetypes, generate (the narrative job), renderer, formatters
│   ├── stations/    list (the list payload), detail (the detail payload), ridership (series), metadata (page titles)
│   ├── prisma.ts    the one Prisma client
│   ├── utils.ts     tiers (getTier, tierStyle), CTA line colors, contrast helpers
│   ├── format.ts    shared number and date formatters
│   ├── staleness.ts the 10-day staleness rule shared by health and the UI
│   ├── site.ts, cacheTags.ts
├── types/           station.ts (API payloads), narrative.ts
├── test/            db guard, jsdom setup, Prisma mock, fixtures, repo-wide tests
└── generated/       Prisma client (gitignored)
prisma/              schema.prisma, migrations/ (Postgres)
scripts/             run-sync, seed-reference-data, export-history, sample-upstream,
                     extract-score-snapshot, reconcile-track-segments, ingest/ (facts), archive/,
                     live-worker (the Fly worker entry), sample-train-tracker, cut-gtfs-slice
Dockerfile, fly.toml the worker's image and Machine; tsconfig.scripts.json type-checks scripts/
docs/                plans/ (the revival plan), runbooks/history-load.md, audit-2026-10-02/, archive/
docs-private/        gitignored: plans, ideation, reviews, and new runbooks written by the planning tools
```

## Data pipeline

`/api/cron/sync-ridership` runs `runSync` (`src/lib/sync/run.ts`) on two schedules from `vercel.json`. The route checks the `CRON_SECRET` bearer token.

| Schedule (UTC) | Mode | What it does |
|---|---|---|
| `0 10 * * *` | daily | refetches the trailing 60 days, plus up to three months the weekly run flagged as drifted, and upserts changed rows |
| `0 14 * * 0` | weekly | refetches the trailing 60 days, then compares every station-month's row count and ride sum with Socrata and records the months that differ |

Each run:

1. Inserts a `SyncRun` row holding a unique lease, so only one run writes at a time. A run still marked running after an hour is expired by the next one.
2. Reads CTA's portal metadata alongside the sync and stores when CTA last updated the dataset (`SyncRun.upstreamUpdatedAt`). The read gets one 10-second try and never fails a run.
3. Fetches month by month, deduplicates, matches CTA station ids to stations, and upserts `RidershipDaily`.
4. Recomputes station statuses from `StationClosure`, base metrics, score v2, and the narratives, outside any transaction. Then it writes metrics, narratives, and statuses in one short transaction of set-based statements.
5. Finalizes the row as `OK`, `PARTIAL`, or `FAILED`, and the route expires the `stations` cache tag after an OK or partial run.

CTA publishes in roughly monthly batches, about two months behind, with no announced schedule. Data through 2026-07-31 was current in October 2026.

`/api/health` answers 503 when no run has succeeded in 10 days (`stale`), a run has been running for over an hour (`stuck`), or no weekly reconciliation has succeeded in 15 days (`reconcile-stale`). `.github/workflows/health.yml` checks it daily at 12:30 UTC.

### The live worker

`scripts/live-worker.ts` (`src/lib/live/`) runs on one Fly.io Machine, deployed with `fly deploy --ha=false`. Every minute it polls Train Tracker positions once and every open station's arrivals four to a call (37 calls a tick), feeds the slot tracker (a slot per schedule-only prediction, a passage per live train that came), appends each call's raw line to an hourly part uploaded to R2 under `raw/v1/`, checkpoints the open day to `state/checkpoint.json.gz` with a conditional put (also the single-instance lease), and pings Healthchecks.io after a wholly successful cycle. It checks CTA's static GTFS daily and archives each version under `schedules/`. The service day runs 03:00 to 03:00 Chicago and closes at 03:15; a scheduled stop belongs to the day its instant falls in. The key, the R2 secrets, and the ping URL never appear in a log line, a URL in an error, or a fixture; `.gitleaks.toml` carries a rule for each shape. Setup and operation: `docs-private/runbooks/live-worker.md` (private); `DEPLOYMENT.md`, "The live worker".

## Ghost score v2

`src/lib/scoring/score.ts`. Four components, each a percentile over the ranked stations, oriented so higher is more ghost-like:

| Component | Weight | Sentence on the card |
|---|---|---|
| Riders against peers (residual) | 45% | "Gets X% of the riders its neighbors get" |
| Change from last year (trailing 90 days, weekday and weekend separated) | 25% | "Down X% from the same period last year" |
| Change since 2019 (12-month average) | 20% | "Carries X% fewer riders than in 2019" |
| Day-to-day swings (MAD over median, by day type) | 10% | "Ridership swings about X% day to day" |

- The weighted sum is re-ranked, so the score is itself a percentile. An unknown component counts as 50.
- **Peers** (`peers.ts`) are the nearest eligible stations along the primary line. A Loop station's peers are the other Loop stations. Terminal, transfer, and Loop only choose peers; they never add points.
- **Availability** (`availability.ts`) nulls a component whose window overlaps a closure or predates the station's opening, and nulls year-over-year when a station next door closed or reopened across its windows. The card states the reason in place of the number.
- **Ranked** means open with recent riders. Closed stations (State/Lake since 2026-01-05) and stations with no recent data get no score, rank, or tier and stay out of every comparison.
- **Tiers** (`getTier` in `src/lib/utils.ts`, the one mapping): ghost 90 and up, fading 75 to 89, quiet 50 to 74, healthy under 50.
- `src/lib/scoring/snapshot.db.test.ts` is the acceptance oracle: it scores the 2025-11-30 snapshot fixture and checks the result.

## API

- `GET /api/chicago/stations`: every station (`StationListResponse` in `src/types/station.ts`), rank 1 first, then unranked stations by name, with tier, rank, 12-month and 30-day averages, a 7-day sparkline, and freshness. Cached with `unstable_cache` under the `stations` tag.
- `GET /api/chicago/stations/{slug}`: one station (`StationDetailResponse`): the station, a 91-day series with gaps, metrics, comparisons (system median, primary-line median, neighbor average, the line walk), the why card, facts, narrative, sources, and freshness. A retired slug answers 308 to the current one (`src/lib/cta/slugAliases.ts`). Anything else, a station id included, answers 404.

Both carry `dataThrough` (YYYY-MM-DD) and `lastSuccessfulFetch` from the latest OK sync run (`src/lib/sync/freshness.ts`), so the list, the detail, and health always report the same date.

## The UI

The shell (`src/components/shell/Shell.tsx`) lives in the `app/(shell)` route-group layout and stays mounted across station pages. The URL is the only selection state: opening a station pushes `/station/[slug]`, and closing always pushes `/`.

- **1100px and up:** the ledger column, the map, and the station drawer over the map's right edge.
- **768 to 1100px:** the drawer replaces the ledger while open.
- **Under 768px:** the map is full-bleed under a bottom sheet holding the ledger, and a station page shrinks the same map to 28vh with the dossier below. One Mapbox instance serves every layout.

The station page renders on the server from `readStationDetail`, cached under the `stations` tag for known slugs only (`app/(shell)/station/[slug]/data.ts`). The method page, `/method`, is the one page outside the shell: a reading page that renders `readStationList` (`src/lib/stations/list.ts`, the same cached reader the list API answers from) into a live example row, then the score, the data, and the API. The ledger's foot and every dossier's Sources link to it.

### Design rules (Direction A, "Wayfinding")

- **Tokens only.** `tailwind.config.ts` replaces Tailwind's theme. Colors: `surface`, `surface-2`, `ink`, `ink-2`, `ink-3`, `rule`, with values in `src/app/globals.css`. Text: `text-11` to `text-56`, nothing smaller. Radius: `rounded` (4px) for controls, `rounded-none` for panels, `rounded-full` for dots.
- **Type.** Archivo for words (`font-narrow` for station names), JetBrains Mono with `tabular` for every number.
- **Themes.** Dark by default. `data-theme` on `<html>`, set before hydration by `THEME_SCRIPT`. `src/test/contrast.test.ts` checks every text token on both surfaces against WCAG AA, which is why `ink-3` sits at 52% (dark) and 62% (light).
- **Hue belongs to the CTA lines.** The official colors live in one table, `ctaLineColors` in `src/lib/utils.ts`, and appear only on tracks, line bars, and line filters. Text on a line color uses `lineLabelInk`.
- **Ghostliness is ink, never hue.** `PresenceMark` draws healthy as a solid dot, quiet as a hollow ring, fading as a hollow ring at 72% ink, and ghost as a small static ghost glyph. Closed is a ring crossed by a bar, and no data a dotted ring. The tier is always also written in words.
- **The ghost theme.** The score is the "Ghost score". Headings follow the tier ("Why it's a ghost stop", "Why it's fading", "Why it's quiet", "Why it's healthy"). A healthy station is never called a ghost. The logo and tab icon are a ghost.
- **Motion.** Enter, count-once, draw-once, and fly-to only, under `MotionConfig reducedMotion="user"`. No infinite or looping animation (`src/test/retired-styles.test.ts`).

## Database

`prisma/schema.prisma`, Postgres:

- `City`, `Station`: slug, displayName, status, openedAt, closedAt, lines as a JSON array.
- `StationClosure`, `StationLineSequence`, `StationAlias`.
- `RidershipDaily`: `(stationId, serviceDate DATE)` primary key, entries, dayType W/A/U.
- `StationMetrics`: base metrics plus the score v2 columns, `dataThrough`, `scoreVersion`.
- `SyncRun`: one row per sync, holding the lease.
- `DataSource`, `StationFact`, `StationNarrative`: the facts and stories.

Migrations run only from an operator machine as `neondb_owner` over the direct host, never in the Vercel build (DEPLOYMENT.md). Code that reads a new column can deploy only after the migration: Prisma's `create` and `update` return every column.

## Conventions

- **Server-only modules.** Components never import `lib/sync`, `lib/live`, `lib/scoring`, `lib/narratives/generate`, `lib/prisma`, or `generated/prisma`; ESLint enforces it. UI gets data from the API routes or the server-rendered page.
- **One Prisma client.** Import `prisma` from `src/lib/prisma.ts`. Never construct another client or call `$disconnect()` in a route (`src/lib/prisma.test.ts` scans for both).
- **Dates are calendar strings.** `YYYY-MM-DD` end to end, formatted with `timeZone: 'UTC'` (`src/lib/format.ts`).
- **CTA station ids, never names.** The roster, sequences, closures, and Socrata matching all key on the five-digit CTA id.
- **Planning records stay local.** The repo is public. Plans, ideation, review output, and new runbooks go under `docs-private/` (gitignored; `.compound-engineering/config.yaml` points the planning tools there), never under `docs/`.
- **Secrets.** Never commit a connection string or token. `.env*` is gitignored except `.env.example`, and CI runs gitleaks over the full history with rules for the Neon, Socrata, Train Tracker, R2, Healthchecks, and revalidate-secret shapes; `src/test/fixtures/secret-shapes.txt` holds one fake sample of each, baselined, so CI fails if a rule stops matching. Recorded Train Tracker fixtures hold bodies only, with the key scrubbed.
- **Tests sit next to their code.** `*.test.ts` runs in the unit project, `*.test.tsx` in components, and `*.db.test.ts` in db. The db project refuses a non-local `DATABASE_URL` (`src/test/db-guard.ts`).
- **Retired dependencies stay retired.** `src/test/retired-deps.test.ts` keeps react-spring, use-gesture, recharts, and date-fns out.

## Common tasks

- **A station closes or reopens:** add or edit its row in `src/lib/cta/closures.ts` and run `scripts/seed-reference-data.ts` against production. The next sync recomputes its status and drops it from, or returns it to, the ranking.
- **A station is renamed:** change the roster entry, add the old slug to `SLUG_ALIASES` so old links redirect, and run the seed.
- **Score weights or rules change:** edit `src/lib/scoring/`, update the oracle in `snapshot.db.test.ts`, and bump `SCORE_VERSION` if stored scores change meaning. The next sync rewrites every station.
- **A schema change:** edit `prisma/schema.prisma`, write the migration under `prisma/migrations/`, test it with `npm run test:db`, and have the operator apply it to production before the code deploys.
- **A wide backfill or a per-station refetch:** `scripts/run-sync.ts` from a shell (DEPLOYMENT.md, "Local runner"). It does not expire the cache tag; only the cron route does.

## Known issues

- On a phone's map page, the bottom sheet (vaul 1.1.2) always runs as a modal dialog: it hides the top bar and map from screen readers and keeps focus inside the sheet. Station pages unmount it. Replacing vaul with a non-modal sheet is the fix.
- `/station/<unknown>` renders the not-found page with status 200 and `noindex`, because the route streams its loading state before `notFound()` runs.
- Some track paths cannot be stitched into one line and are drawn as separate segments, which logs a warning in the browser console.
- `npm audit` reports 15 high findings, all in build and dev tooling (`eslint-config-next`, `mapshaper`, Tailwind 3, the Prisma CLI's `mysql2` and `deepmerge-ts`). None runs when the app serves a request. Nate accepted them on 2026-10-04 (revival plan, Deferred / Open Questions); revisit when patched releases ship.

## Further reading

- `README.md`: setup from a fresh clone.
- `DEPLOYMENT.md`: Vercel, Neon, migrations, the sync, health, rollback.
- `docs/plans/2026-10-02-2208-feat-ghost-stops-revival-plan.md`: the requirements (R-IDs) and key decisions (KTD-IDs) the code cites.
- `docs/runbooks/history-load.md`: every production migration, backfill, and go-live, step by step.
- `docs/audit-2026-10-02/`: the October 2026 audit that started the revival.
