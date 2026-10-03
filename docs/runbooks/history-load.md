# Runbook: schema v2 migration and history load

How production moves to the v2 schema and gets its ridership history back. The revival plan
(`docs/plans/2026-10-02-2208-feat-ghost-stops-revival-plan.md`, units U5 to U8, KTD2 and KTD3)
is the authority. This file records the commands, the expected results, and what the dry run measured.

The order is fixed: dry run on a branch first (section 4), then production (section 5).
Production steps run only after Nate confirms at that moment.

## 1. Connections

Migrations, the seed, and the load run from an operator machine as the database owner role,
`neondb_owner`, over the **direct** host (the endpoint without `-pooler`).

- The runtime role `ghost_stops_app` can read and write every table but cannot run DDL.
  PostgreSQL 17 refused `GRANT neondb_owner TO ghost_stops_app` during the Phase 0 rotation,
  so `prisma migrate deploy` as the runtime role fails.
- Get the owner string from the Neon console or the Neon connector's `get_connection_string`
  with `role_name: neondb_owner` and the target branch. Never paste it into a file, a commit,
  or a chat; export it in the shell only.
- Set **both** variables. The schema's `directUrl` reads `DATABASE_URL_UNPOOLED`, and
  `prisma validate`, `migrate deploy`, and `migrate diff` fail without it.
- The repo's `.env` points `DATABASE_URL` at the local SQLite snapshot and Prisma loads it
  automatically, so always export both variables explicitly in the shell that runs a command.

```bash
export DATABASE_URL='<neondb_owner direct URL for the target branch>'
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
```

| Branch | Neon id | Endpoint |
|---|---|---|
| production | `br-floral-rain-aeynqoma` | `ep-purple-bread-ae5a0gwi` |
| dry run | created and deleted in section 4 | recorded there |

## 2. What the migration does

`prisma/migrations/20261003064611_revival_v2/migration.sql` is generated from
`prisma/schema.prisma` and hand-edited in two places:

1. `RidershipDaily` is dropped and recreated lean: `(stationId, serviceDate DATE, entries,
   dayType CHAR(1))`, primary key `(stationId, serviceDate)`, one index on `serviceDate`.
   **Every ridership row is deleted.** The history load in section 3 puts them back.
2. Four CTA station ids are corrected before the unique index on `(cityId, ctaStationId)`
   is created. Each update is guarded on the known wrong value:

   | Station | `externalId` | `ctaStationId` before | after |
   |---|---|---|---|
   | Western (Blue, O'Hare branch) | 40670 | 40310 | 40670 |
   | Western (Orange) | 40310 | 40670 | 40310 |
   | Washington (Blue) | 40370 | 40500 | 40370 |
   | Jefferson Park Transit Center | 41280 | null | 41280 |

   The two Western ids swap in one statement. Production was checked on 2026-10-03: these four
   rows hold exactly the "before" values, and no other station holds any "after" value.

Everything else is additive: `Station` gains `slug` (nullable until the seed), `displayName`,
`status`, `openedAt`, `closedAt`; `StationMetrics` and `StationNarrative` gain nullable or
defaulted columns, so their rows survive; `StationClosure`, `StationLineSequence`, and `SyncRun`
are new.

### Behavior between the migration and the Phase 1 deploy

Production keeps running the old client until the Phase 1 PR merges.

- `/api/chicago/stations-raw` (the list the UI reads) and `/api/chicago/stations/[id]` keep
  working: they read no dropped or retyped column through the client, and the detail route's
  raw ridership query works against a `DATE` column.
- `/api/chicago/stations` returns 500 in this window: the old client selects the dropped
  `RidershipDaily.id`. No UI component calls this route.
- Ridership charts are empty from the migration until the load commits.
- The Phase 1 preview deployment fails on list and detail before the migration, because its
  Neon preview branch is a copy of the old schema. It is not evidence either way.

## 3. Steps

### 3.1 Apply the migration

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL_UNPOOLED" \
  --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: `migrate status` lists `20261003064611_revival_v2` as not yet applied; `migrate deploy`
applies it; `migrate diff` prints `No difference detected` and exits 0.

Verify:

```sql
SELECT migration_name, finished_at IS NOT NULL AS finished FROM _prisma_migrations ORDER BY started_at;
-- two rows: 20260202155550_init_production, 20261003064611_revival_v2; both finished

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'RidershipDaily' ORDER BY ordinal_position;
-- stationId text, serviceDate date, entries integer, dayType character

SELECT name, "externalId", "ctaStationId" FROM "Station"
WHERE "externalId" IN ('40670', '40310', '40370', '41280') ORDER BY "externalId";
-- ctaStationId equals externalId on all four rows

SELECT (SELECT count(*) FROM "StationFact") AS facts,
       (SELECT count(*) FROM "StationNarrative") AS narratives,
       (SELECT count(*) FROM "StationMetrics") AS metrics;
-- production before the load: 625, 143, 143
```

### 3.2 Seed reference data

`scripts/seed-reference-data.ts` writes the roster from `src/lib/cta/` onto the existing stations
in one transaction. It updates stations by id and never deletes or recreates one. It refuses to
run if any station holds a CTA id outside the roster, which is what an unmigrated database looks
like (Washington still on 40500).

```bash
npx tsx scripts/seed-reference-data.ts --dry-run   # computes the report, then rolls back
npx tsx scripts/seed-reference-data.ts
npx tsx scripts/seed-reference-data.ts             # second run must report "changes": 0
```

Expected first run on production:

| Report field | Value | Why |
|---|---|---|
| `stationsInserted` | `["40260"]` | State/Lake, CLOSED since 2026-01-05 |
| `stationUpdates` | 143 entries | every existing station gets a slug and display name; 8 get `lines`: five corrections (Green off Quincy, LaSalle/Van Buren, Washington/Wells, Library; Purple on Wilson) and three reorders into canonical CTA order (Clark/Lake, Adams/Wabash, Washington/Wabash) |
| `closures` | `created: 3` | Lawrence and Berwyn 2021-05-16 to 2025-07-20, State/Lake from 2026-01-05 |
| `sequenceRows` | `inserted: 191` | every branch of every line, the Loop ring once per line that circles it |
| `aliases` | `removed: 6, added: 1` | `State/Lake` off Lake (Red) and onto State/Lake; `Central-Lake`, `Kedzie-Lake`, `Oak Park-Lake` off the Pink and Blue stations; `Washington/State` (retired 40500) off both stations |
| `stationCount` | 144 | |
| `changes` | 345 | the sum of the rows above; the second run reports 0 |

Argyle and Bryn Mawr get no closure row. The plan listed them with Lawrence and Berwyn, but the
snapshot shows both stayed open through the rebuild (no day under 100 riders between 2021-05 and
2025-07), while Lawrence and Berwyn read zero from 2021-05-17 until 2025-07-20.

Verify:

```sql
SELECT count(*) AS stations, count(slug) AS slugged, count(*) FILTER (WHERE status = 'CLOSED') AS closed
FROM "Station";
-- 144, 144, 1

SELECT s.name, s.slug FROM "StationLineSequence" q JOIN "Station" s ON s.id = q."stationId"
WHERE q.line = 'Blue' AND q.seq BETWEEN 30 AND 32 ORDER BY q.seq;
-- Oak Park (Blue), Harlem, Forest Park
```

### 3.3 Load history

**Export** (local, read-only on the snapshot; about 8 seconds). `--station-ids` is the production
`Station` backup from section 4.6, so every exported id is proven to exist in production.

```bash
npx tsx scripts/export-history.ts --sqlite prisma/dev.db \
  --station-ids exports/backups/2026-10-03-production/Station.csv \
  --out exports/ridership-history.csv --through 2025-11-30 \
  --keep-untwinned-station b160ec71aa06eb825b6e5bb466080e3a
```

The script keeps RFC3339-dated rows, drops each manual-format row that has an RFC3339 twin, drops
the 90 orphan rows and both Western stations, derives the day type from the calendar, and refuses
to write a file if any check fails. `--keep-untwinned-station` names Jefferson Park: the Go ETL never
matched it, so its only rows are 366 manual-format rows (2024-11-30 to 2025-11-30) with no twin.
They equal production's rows for those days exactly, so keeping them changes nothing on the live site.

Expected summary: `ok: true`, `rowsWritten` 1,245,814, `distinctStations` 141, dates 2001-01-02 to
2025-11-30, `twinDisagreements.exported` 0, `stationIdsMissingFromProduction` empty.

**Upstream sample** (the plan's stop gate; any mismatch stops here):

```bash
npx tsx scripts/sample-upstream.ts --csv exports/ridership-history.csv --sqlite prisma/dev.db
```

Expected: `ok: true`, 60 sampled (30 from 2019, 30 from 2001, seed 20261003), 0 mismatches,
0 missing upstream. Day type differences are informational (holidays are U upstream).

**Load** (direct host, owner role, one transaction; about 30 seconds):

```bash
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
TRUNCATE "RidershipDaily";
\copy "RidershipDaily" ("stationId","serviceDate","entries","dayType") FROM 'exports/ridership-history.csv' WITH (FORMAT csv, HEADER true)
COMMIT;
ANALYZE "RidershipDaily";
SQL
```

Verify:

```sql
SELECT count(*), min("serviceDate"), max("serviceDate"), count(DISTINCT "stationId"),
       pg_size_pretty(pg_total_relation_size('"RidershipDaily"')), pg_size_pretty(pg_database_size('neondb'))
FROM "RidershipDaily";
-- 1245814, 2001-01-02, 2025-11-30, 141, about 173 MB, about 183 MB

SELECT to_char("serviceDate", 'YYYY-MM') AS month, count(*) FROM "RidershipDaily" GROUP BY 1 ORDER BY 1;
-- equals the per-month counts of the CSV (299 months)

SELECT count(*), md5(string_agg(id || '|' || "factKey" || '|' || value::text, ',' ORDER BY id)) FROM "StationFact";
-- 625, ea912a2122fd460cbf5a4fde9d9970e0 (production before the migration)

SELECT count(*), max("lastComputed") FROM "StationNarrative";
-- 143, 2026-02-02 19:50:52.465

SELECT (SELECT count(*) FROM "StationMetrics" m LEFT JOIN "Station" s ON s.id = m."stationId" WHERE s.id IS NULL)
     + (SELECT count(*) FROM "StationFact" f LEFT JOIN "Station" s ON s.id = f."stationId" WHERE s.id IS NULL)
     + (SELECT count(*) FROM "StationNarrative" n LEFT JOIN "Station" s ON s.id = n."stationId" WHERE s.id IS NULL);
-- 0
```

## 4. Dry run (2026-10-03)

Branch `dry-run/revival-v2`, created from production at 07:03 UTC (`br-cool-salad-aernu9vk`,
endpoint `ep-wild-band-aepmjnnz`). Every step ran exactly as written in section 3.

### 4.1 Migration

Applied in 2.5 seconds. `migrate diff` printed `No difference detected`. All four ids corrected;
facts 625 with the production checksum, narratives 143, metrics 143; `RidershipDaily` empty.

With the old production code (`origin/main` at `3a7e282`, its own generated client) against the
migrated branch: `stations-raw` 200 with 143 stations, the detail route 200 with an empty chart,
`/api/chicago/stations` 500 (`P2022`, `RidershipDaily.id` does not exist). This matches section 2.

### 4.2 Seed

The report matched section 3.2 exactly (345 changes) in 8 seconds; the second run reported 0.
With the Phase 1 code: all three routes 200, 144 stations (State/Lake listed with missing data),
and Harlem (Forest Park end) has neighbors Oak Park (Blue) and Forest Park. The old code gave it
Cumberland and Jefferson Park.

### 4.3 Size and timing

| Load | Rows | `RidershipDaily` total | Database | Time |
|---|---|---|---|---|
| 2019 only | 50,735 | 7.39 MB (146 bytes per row) | 17.9 MB | 2.5 s |
| Projection from 2019 | 1,245,814 | 181 MB | about 192 MB | |
| Full history, measured | 1,245,814 | 173 MB | 183 MB | 28 s |

Well under the 800 MB stop condition. The Neon project is on the Launch plan, not Free, so the
1 GB cap the plan sized against does not apply; the 800 MB gate is kept anyway.

After the full load every verification query in section 3.3 matched, and the Phase 1 detail route
served Harlem's 91-day chart ending 2025-11-30 (149 riders that day, as in production).

### 4.4 Upstream comparison

The 60-sample gate passed: 60 of 60 equal, across 54 stations; one day type differs (2019-01-01,
a holiday). A further check compared every station-year in the export with Socrata's yearly sums
(`5neh-572f`, one grouped query):

| Years | Result |
|---|---|
| 2010, 2012 to 2023 | every station-year equal |
| 2001 | every station short by one day: the snapshot starts 2001-01-02 |
| 2002 to 2009 | equal except Washington (Blue) |
| 2011 | Socrata holds two rows with different values for 618 station-days (July and August); the snapshot kept one of each |
| 2024 | equal except Jefferson Park (only 32 days, see section 3.3) |
| 2025 | every station differs: CTA restated 2025, which Phase 2 re-fetches as planned |

Washington (Blue) from 2001 to 2009 is a day-by-day mix of its own id (40370) and the retired
Washington/State (40500), the same fault as the Western stations: 2007 holds 1,086,484 riders
against 2,117,873 upstream, because the closed station's near-zero days overwrote about half the
year. From 2010 it matches exactly. **Open decision for Nate before U8:** leave Washington's rows
before 2010 out of the load and re-fetch them in Phase 2 (recommended), or load them and let
Phase 2 overwrite them.

Snapshot history that Phase 2 must re-fetch from Socrata, beyond the two Western stations the
plan already lists: Jefferson Park 2001 to 2024-11-29, State/Lake 2001 onward (never ingested),
Washington (Blue) 2001 to 2009, and 2001-01-01 for every station. Retired ids 40200, 40500, 40640,
and 41580 are not in the roster and are not loaded.

### 4.5 Restore rehearsal

Neon snapshots only root branches, so the rehearsal snapshotted production
(`pre-revival-v2-rehearsal-2026-10-03`, 07:10:47 UTC; production itself unchanged) and restored
that snapshot onto the dry-run branch with finalize, which is the same operation a production
rollback after six hours would be.

- The restore took about 10 seconds. The dry-run branch's existing connection string then served
  the pre-migration state: only the init migration, 143 stations, 39,142 ridership rows, 625 facts.
- The branch name and endpoint stayed; the branch id changed (now `br-dark-term-ae7dz48k`). The
  state it replaced was kept as a new branch, `dry-run/revival-v2 (old)`.
- For production this means the connection strings in Vercel keep working after a restore, but
  anything that refers to the production branch by id needs the new id.

Within six hours of the migration, Neon's point-in-time branch restore to a moment before
`migrate deploy` is the faster rollback and needs no snapshot.

### 4.6 Backups and artifacts (all under the gitignored `exports/`)

| File | Contents |
|---|---|
| `exports/backups/2026-10-03-production/*.csv` | every production table as of 06:59 UTC, before any change: City, Station, StationAlias, StationMetrics, StationFact, StationNarrative, DataSource, RidershipDaily (39,142 rows), `_prisma_migrations` |
| `exports/ridership-history.csv` | the load file, 1,245,814 rows, 63,194,706 bytes, SHA-256 `f9717202e03a29ce269ac20c50ed2166c930d4538894cc97751733f3d0fce5a7` |
| `exports/ridership-history.summary.json` | the export summary |
| `exports/upstream-sample.json` | the 60-sample comparison |

Production checksums taken with the backups: facts 625 rows, `ea912a2122fd460cbf5a4fde9d9970e0`;
narratives 143 rows, max `lastComputed` 2026-02-02 19:50:52.465.

## 5. Production run

Recorded by U8.
