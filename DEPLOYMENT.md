# Deploying Ghost Stops

Ghost Stops runs on Vercel (Next.js app, API routes, and the daily sync as a Vercel Cron job)
against a Neon Postgres database. Nothing else runs it: the Go ETL and its Railway service were
retired on 2026-10-03 (revival plan U11).

```
Socrata (CTA ridership) ──> /api/cron/sync-ridership ──> Neon Postgres <── API routes <── browser
                              (Vercel Cron, daily)         (pooled host at runtime,
                                                            direct host for migrations)
```

Operational history, rehearsals, and go-live records live in
[`docs/runbooks/history-load.md`](docs/runbooks/history-load.md).

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

## The daily sync

`vercel.json` schedules `/api/cron/sync-ridership` twice:

| Schedule (UTC) | Mode | Does |
|---|---|---|
| `0 10 * * *` | daily | refetches the trailing 60 days from Socrata plus up to three months the weekly run flagged as drifted, upserts changed rows, and recomputes scores and narratives |
| `0 14 * * 0` | weekly | refetches the trailing 60 days, then compares each month's counts and sums with Socrata and records the months that differ for the daily runs to refetch |

Vercel may start a run up to 59 minutes late. The route checks `CRON_SECRET`, records a `SyncRun`
row, and expires the `stations` cache tag after an OK or partial run, so the station list shows
the new data on the next request.

## Health and alerting

`/api/health` answers 200 with the last successful run and data-through date, or 503 when:

- no run has succeeded in 10 days (`stale`);
- a run has been marked running for over an hour (`stuck`);
- no weekly reconciliation has succeeded in 15 days (`reconcile-stale`).

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

The app keeps no state outside Neon. To undo a bad deploy, promote the previous production
deployment in Vercel (instant rollback). To undo a bad data change, restore the Neon snapshot taken
before it.
