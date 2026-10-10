# Deploying Ghost Stops

Ghost Stops runs on Vercel (Next.js app, API routes, and the daily sync as a Vercel Cron job)
against a Neon Postgres database, plus one always-on worker on Fly.io that polls CTA Train
Tracker for the live Ghost score and keeps its raw record in a Cloudflare R2 bucket. The Go ETL
and its Railway service were retired on 2026-10-03 (revival plan U11).

```
Socrata (CTA ridership) ──> /api/cron/sync-ridership ──> Neon Postgres <── API routes <── browser
                              (Vercel Cron, daily)         (pooled host at runtime,
                                                            direct host for migrations)
CTA Train Tracker ──> worker on Fly.io (one Machine, every minute) ──> R2 bucket (raw polls, checkpoint)
                                       │                              └── /api/health reads the checkpoint's age
                                       └── nightly: LiveDay rows in Neon, then POST /api/internal/revalidate
```

Operational history, rehearsals, and go-live records live in
[`docs/runbooks/history-load.md`](docs/runbooks/history-load.md); the worker's runbook is private
(`docs-private/runbooks/live-worker.md`, gitignored).

## Vercel project

- **Build:** `vercel.json` runs `prisma generate && next build` (Next 16, Turbopack). `npm install`
  also generates the Prisma client through `postinstall`. The client is generated into
  `src/generated/prisma` and is not committed.
- **Runtime:** Node 22 (`engines` in `package.json`), with Fluid compute on (`"fluid": true`), which
  the cron route's 300-second limit depends on.
- **Previews:** every push to a branch deploys a preview. The Neon integration gives each preview
  its own database branch, copied from production, with branch-scoped `DATABASE_URL` and
  `DATABASE_URL_UNPOOLED`. Delete those Neon branches once the PR merges.

### Environment variables

| Name | Production | Preview | Used by |
|---|---|---|---|
| `DATABASE_URL` | Neon pooled host (`-pooler`), runtime role `ghost_stops_app` | set by the Neon integration per preview branch | the app's pg pool (`src/lib/prisma.ts`), the local runner, the seed |
| `DATABASE_URL_UNPOOLED` | Neon direct host, runtime role | set by the Neon integration per preview branch | the Prisma CLI through `prisma.config.ts` |
| `CRON_SECRET` | set (sensitive) | set (sensitive) | the bearer token Vercel Cron sends to the sync route |
| `CHICAGO_DATA_APP_TOKEN` | set (sensitive) | set (sensitive) | Socrata requests, sent only in the `X-App-Token` header |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | set | set | the map |
| `WORKER_REVALIDATE_SECRET` | set (sensitive) | not set | the bearer token the worker sends to `/api/internal/revalidate`; generated with the prefix `ghrv_`; never `CRON_SECRET` |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | set (sensitive), the read-only token | not set | `/api/health` reads the worker's checkpoint age from the bucket |

`.env.example` lists the same names. Prisma 7 does not read `.env`, so commands run from a shell
need the variables exported in that shell.

## Schema migrations

Migrations never run in the Vercel build. An operator runs them from their own machine as the
owner role, `neondb_owner`, over the direct host, because the runtime role cannot run DDL:

```bash
export DATABASE_URL_UNPOOLED='<neondb_owner direct URL>'   # never commit or paste this
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

The last command prints `No difference detected` when the database matches the schema. Take a
manual Neon snapshot before any migration that changes or drops data; the runbook names each one
taken so far.

Run a migration before the code that uses it deploys, and before that branch is pushed. Prisma's
`create` and `update` return every column the generated client knows, so new code fails against a
table without its column. A new nullable column does not affect the code already running. Pushing
first would also give the branch's preview a Neon branch copied from the unmigrated production.

## The daily sync

`vercel.json` schedules `/api/cron/sync-ridership` twice:

| Schedule (UTC) | Mode | Does |
|---|---|---|
| `0 10 * * *` | daily | refetches the trailing 60 days from Socrata plus up to three months the weekly run flagged as drifted, upserts changed rows, and recomputes scores and narratives |
| `0 14 * * 0` | weekly | refetches the trailing 60 days, then compares each month's counts and sums with Socrata and records the months that differ for the daily runs to refetch |

Vercel may start a run up to 59 minutes late. The route checks `CRON_SECRET`, records a `SyncRun`
row, and expires the `stations` cache tag after an OK or partial run, so the station list shows
the new data on the next request.

Each run also records when CTA last updated the dataset: the portal's `rowsUpdatedAt`, stored in
`SyncRun.upstreamUpdatedAt`. CTA publishes in roughly monthly batches with no announced schedule,
so the rows show its real cadence. The read gets one 10-second try; if it fails, the column stays
null and the run carries on.

## The live worker

`scripts/live-worker.ts` runs on one Fly.io Machine (`fly.toml`: shared-cpu-1x, 512 MB, region
`ord`, no services, restart policy always, 30 seconds to finish on SIGTERM), built from the
two-stage `Dockerfile` (the runtime stage carries the bundled entry and production dependencies
only, never an env file or a dev tool; CI builds it and checks). Deploy with `fly deploy --ha=false`
so exactly one Machine runs.

Each minute it polls Train Tracker positions once and every open station's arrivals four to a
call (37 calls; about 53,000 a day against the key's 100,000, with a hard stop at 90,000), keeps
the open day's slot tracker in memory, writes every call's raw line to a part file uploaded to
R2 hourly, checkpoints the day to R2 with a conditional put (the checkpoint doubles as the
single-instance lease), and pings Healthchecks.io after each wholly successful cycle. At 03:15
Chicago it closes the service day. Its nine secrets (`fly secrets set`): `DATABASE_URL` (the
`ghost_stops_worker` role, which can read `City`, `Station`, `StationClosure` and write only
`LiveDay` and `LiveStationDay`), `CTA_TRAIN_TRACKER_KEY`, the four `R2_*` variables (the
read-write token, scoped to the one bucket), `WORKER_REVALIDATE_SECRET`, `SITE_URL`, and
`HEALTHCHECKS_PING_URL`. The runbook (`docs-private/runbooks/live-worker.md`) has the account
setup, the migration and role step, the pre-deploy checks, the first-day signals, planned stops,
re-reducing a day, and secret rotation.

From an operator shell, `npx tsx scripts/live-worker.ts --once` runs one real tick,
`--gtfs-check` extracts the real static GTFS, and `--store-check` round-trips one object
against the bucket; each needs its variables exported in that shell.

New monthly spend (plan R14, against a $30 ceiling): Fly about $3.30 to $4, Neon compute about
$1 to $3 for the nightly write, R2 $0 within its free tier for about a year, Healthchecks.io $0;
about $5 to $7 in all.

## Health and alerting

`/api/health` answers 200 with the last successful run, the data-through date, and when CTA last
updated the dataset (`upstreamUpdatedAt`), or 503 when:

- no run has succeeded in 10 days (`stale`);
- a run has been marked running for over an hour (`stuck`);
- no weekly reconciliation has succeeded in 15 days (`reconcile-stale`).

The same body carries a `trains` object for the live worker (statuses, dates, and ages only):
`not-started` until the first `LiveDay` row exists, whatever the bucket holds, so the probe days
never fail the check; then `trains-stale` when the worker's checkpoint in R2 is older than 45
minutes or cannot be read (the route reads it with the read-only R2 token), `trains-unreduced`
when the latest `LiveDay` is more than two service days old, else `ok`. Either report failing
answers 503. The worker's own alert is faster: Healthchecks.io emails Nate when the check misses
its 15-minute grace.

`.github/workflows/health.yml` requests the route daily at 12:30 UTC and fails on anything but 200,
after one retry a minute later. GitHub then emails whoever last changed the workflow's schedule (Nate). To rehearse a failure,
run the workflow by hand with its `url` input pointed at a URL that answers non-200.

## Local runner

Wide backfills and per-station refetches run from an operator machine, never in the cron, because
they can take minutes:

```bash
export DATABASE_URL='<ghost_stops_app pooled URL>'
npx tsx scripts/run-sync.ts                                   # the daily window, as the cron runs it
npx tsx scripts/run-sync.ts --reconcile                       # the weekly reconciliation
npx tsx scripts/run-sync.ts --since 2001-01-01                # a wide backfill (about five minutes)
npx tsx scripts/run-sync.ts --since 2001-01-01 --station-id 40670 --station-id 40310
```

The runner refuses to start without `DATABASE_URL` and prints the run summary as JSON. It does not
expire the `stations` cache tag (only the cron route can), so after a local run invalidate the tag
in Vercel (Project, Settings, Caches, or the API's invalidate-by-tags with tag `stations`, target
production).

## Rollback

Durable state lives in two places: Neon, and the R2 bucket that holds the live worker's raw polls,
the schedule archive, and its checkpoint. A Neon restore does not touch R2.

To undo a bad deploy, promote the previous production deployment in Vercel (instant rollback). The
worker needs no stop for this, because older code ignores `LiveDay` and `LiveStationDay`.

To undo a bad data change, restore the Neon snapshot taken before it, with the worker stopped so
that no nightly write lands during the restore:

1. Stop the worker: `fly machine stop`. If the stop will run past 45 minutes, pause its
   Healthchecks check first (the runbook's "Planned stops and restarts" has the rules).
2. Restore the snapshot.
3. Start the worker: `fly machine start`.
4. Re-reduce each service day the restore lost, from its raw file in R2:
   `npx tsx scripts/live-rereduce.ts --date YYYY-MM-DD`. Like the worker's checks above, it needs
   its variables exported in that shell.
