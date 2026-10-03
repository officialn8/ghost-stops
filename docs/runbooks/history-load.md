# Runbook: schema v2 migration and history load

How production moves to the v2 schema and gets its ridership history back. The revival plan
(`docs/plans/2026-10-02-2208-feat-ghost-stops-revival-plan.md`, units U5 to U8, KTD2 and KTD3)
is the authority. This file records the commands, the expected results, and what the dry run measured.

The order is fixed: dry run on a branch first (section 4), then production (section 5).
Production steps run only after Nate confirms at that moment. Section 6 covers Phase 2 (U10):
the backfill from upstream that fills the gaps section 4.4 lists, and the sync's go-live.

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
`Station` backup from section 4.7, so every exported id is proven to exist in production.

```bash
npx tsx scripts/export-history.ts --sqlite prisma/dev.db \
  --station-ids exports/backups/2026-10-03-production/Station.csv \
  --out exports/ridership-history.csv --through 2025-11-30 \
  --keep-untwinned-station b160ec71aa06eb825b6e5bb466080e3a
```

The script keeps RFC3339-dated rows, drops each manual-format row that has an RFC3339 twin, drops
the 90 orphan rows, both Western stations, and Washington (Blue) before 2010 (section 4.4), derives
the day type from the calendar, and refuses to write a file if any check fails. `--keep-untwinned-station` names Jefferson Park: the Go ETL never
matched it, so its only rows are 366 manual-format rows (2024-11-30 to 2025-11-30) with no twin.
They equal production's rows for those days exactly, so keeping them changes nothing on the live site.

Expected summary: `ok: true`, `rowsWritten` 1,242,528, `misattributedRowsDropped` 3,286 (Washington),
`distinctStations` 141, dates 2001-01-02 to 2025-11-30, `twinDisagreements.exported` 0,
`stationIdsMissingFromProduction` empty.

**Upstream sample** (the plan's stop gate; any mismatch stops here):

```bash
npx tsx scripts/sample-upstream.ts --csv exports/ridership-history.csv --sqlite prisma/dev.db
```

Expected: `ok: true`, 60 sampled (30 from 2019, 30 from 2001, seed 20261003), 0 mismatches,
0 missing upstream. Day type differences are informational (holidays are U upstream).

**Load** (direct host, owner role, one transaction; about 30 seconds). The migration leaves the
table empty, so the first load refuses to run on a non-empty table instead of truncating it:
`TRUNCATE` would hold an exclusive lock for the whole load and block every detail request, and
after Phase 2 starts syncing it would erase synced rows. A failed load rolls back to empty, so the
same block is also the retry.

```bash
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "RidershipDaily") THEN
    RAISE EXCEPTION 'RidershipDaily is not empty; this block is only for the first load';
  END IF;
END $$;
\copy "RidershipDaily" ("stationId","serviceDate","entries","dayType") FROM 'exports/ridership-history.csv' WITH (FORMAT csv, HEADER true)
COMMIT;
ANALYZE "RidershipDaily";
SQL
```

Only if a committed Phase 1 load must be redone before Phase 2 writes anything, replace the `DO`
block with `TRUNCATE "RidershipDaily";` after checking that `max("serviceDate")` is still
2025-11-30.

Verify:

```sql
SELECT count(*), min("serviceDate"), max("serviceDate"), count(DISTINCT "stationId"),
       pg_size_pretty(pg_total_relation_size('"RidershipDaily"')), pg_size_pretty(pg_database_size('neondb'))
FROM "RidershipDaily";
-- 1242528, 2001-01-02, 2025-11-30, 141, about 173 MB, about 183 MB

SELECT sum(entries)::bigint FROM "RidershipDaily";
-- 3550614440

SELECT "dayType", count(*) FROM "RidershipDaily" GROUP BY 1 ORDER BY 1;
-- A 177528, U 177520, W 887480

SELECT s.name FROM "Station" s
WHERE NOT EXISTS (SELECT 1 FROM "RidershipDaily" r WHERE r."stationId" = s.id) ORDER BY 1;
-- exactly State/Lake, Western (O'Hare), Western (Orange)
```

Per-month counts against the CSV (299 months, both files identical):

```bash
psql "$DATABASE_URL_UNPOOLED" -At -F, -c "SELECT to_char(\"serviceDate\", 'YYYY-MM'), count(*) FROM \"RidershipDaily\" GROUP BY 1" | sort > exports/verify-db-months.csv
tail -n +2 exports/ridership-history.csv | cut -d, -f2 | cut -c1-7 | sort | uniq -c | awk '{print $2","$1}' | sort > exports/verify-csv-months.csv
diff exports/verify-db-months.csv exports/verify-csv-months.csv && echo MONTHS_MATCH
```

```sql

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

These rows are from the first export, before Washington's pre-2010 rows were removed (section 4.6
has the final numbers; the difference is 3,286 rows). Well under the 800 MB stop condition, which
Nate has since lifted. The Neon project is on the Launch plan, not Free, so the
1 GB cap the plan sized against does not apply; the 800 MB gate is kept anyway.

After the full load every verification query in section 3.3 matched, and the Phase 1 detail route
served Harlem's 91-day chart ending 2025-11-30 (149 riders that day, as in production).

### 4.4 Upstream comparison

The 60-sample gate passed: 60 of 60 equal, across 54 stations; one day type differs (2019-01-01,
a holiday). The final sample (section 4.6) had four day-type differences, all holidays. A further check compared every station-year in the export with Socrata's yearly sums
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
year. From 2010 it matches exactly. Nate decided on 2026-10-03 to leave those rows out of the load
(`MISATTRIBUTED_BEFORE` in `scripts/export-history.ts`, 3,286 rows) and re-fetch them in Phase 2.

A station-by-month comparison of the final export with Socrata (42,642 upstream station-months
through 2025-11) confirmed the picture: every month from 2001 to 2024 is identical in days and
riders except the gaps listed below, and 2025 differs in riders only (CTA's restatement).

**Phase 2 re-fetch list** (approved by Nate on 2026-10-03; the plan's U10 lists only the two Western stations):

| Station or range | Missing from the load | Why |
|---|---|---|
| Western (Blue, O'Hare) 40670, Western (Orange) 40310 | 2001 onward | ids swapped in the snapshot (plan, KTD3) |
| State/Lake 40260 | 2001 onward | never ingested |
| Jefferson Park 41280 | 2001-01-01 to 2024-11-29 | the Go ETL never matched it |
| Washington (Blue) 40370 | 2001 to 2009 | mixed with retired 40500 |
| every station | 2001-01-01 | the snapshot starts 2001-01-02 |
| every station | 2025-01 onward | CTA restated 2025, and data after 2025-11-30 (plan, U10 backfill) |
| every station | day type, 2001 to 2024 | weekday holidays are stored as `W`; one `UPDATE` from a Socrata `(date, daytype)` query fixes them |

Socrata itself holds two rows with different rider counts for 618 station-days in July and August
2011. The load keeps the snapshot's one value per day. The Phase 2 sync must collapse duplicates
before an upsert (an `ON CONFLICT DO UPDATE` cannot touch one row twice in a statement); the
approved rule is to keep the row Socrata updated most recently. Retired ids 40200, 40500, 40640,
and 41580 are not in the roster and are not loaded.

**Exactness caveats of the Phase 1 load**, all known and accepted:

- Day types come from the calendar, so weekday holidays are stored as `W` where Socrata says `U`
  (about 8 days a year). Phase 2 overwrites only the rows it re-fetches, so it also needs a one-time
  day-type correction from a Socrata `(date, daytype)` query, added to the list above.
- July and August 2011 hold the snapshot's value where Socrata has two (see above).
- 2001-01-01 is missing for every station.
- 2025 holds the pre-restatement values, exactly as production does today.

Other tables: every existing station has facts, metrics, and a narrative. State/Lake has none,
because it is new; Phase 2 and Phase 3 compute metrics and narratives for every station.

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

### 4.6 Final rehearsal

With the final CSV (Washington before 2010 removed), on the restored branch, sections 3.1 to 3.3
ran in order in 42 seconds end to end: migration applied with no drift; the seed reported 345
changes and then 0; the load wrote 1,242,528 rows (173 MB table, 183 MB database); per-month
counts matched the CSV for all 299 months; facts, narratives, and orphan checks matched section 3.3;
the Phase 1 routes served 144 stations and Harlem's chart. The 60-sample gate on this CSV: 60 of 60
equal across 49 stations.

The dry-run branches and the stale Phase 0 preview branch were deleted afterwards with Nate's
approval. The production snapshot `pre-revival-v2-rehearsal-2026-10-03` remains.

### 4.8 Rehearsal at the merge commit

After the code review, the whole of section 5.2 steps 2 to 5 ran on a fresh branch from
production (`dry-run/revival-v2-final-head`, `br-jolly-queen-aei0jer5`) at commit `0c5d313`,
whose code is what merges (later commits on the branch change only this runbook):

- Step 2 guard: 143 stations and 39,142 ridership rows before; CSV SHA-256 as in section 4.7;
  migration SHA-256 `b1b054de8857661f...`, matched afterwards by `_prisma_migrations.checksum`.
- Migration applied, no drift. Seed: dry run 345 changes, real run 345 (same breakdown as
  section 3.2), second run 0.
- Load with the emptiness guard: 1,242,528 rows, `sum(entries)` 3,550,614,440, day types
  A 177,528 / U 177,520 / W 887,480, the three expected stations without rows, all 299 months equal
  to the CSV, facts and narratives unchanged, 144 stations with 144 slugs and 1 closed, 183 MB.
  The whole procedure took 56 seconds. A second run of the guard refused the non-empty table.
- Old code on the migrated, seeded, and loaded branch: `stations-raw` 200 with 144 stations but
  State/Lake listed first; the detail route 200 with Harlem's 91-day chart (and the old wrong
  neighbor, Cumberland); `/api/chicago/stations` 500 as section 2 says.
- Phase 1 code on the same branch: `stations-raw` 200 starting with Halsted (Green), Harlem's
  neighbors Oak Park (Blue) and Forest Park, chart ending 2025-11-30 at 149 riders, all routes 200.

### 4.7 Backups and artifacts (all under the gitignored `exports/`)

| File | Contents |
|---|---|
| `exports/backups/2026-10-03-production/*.csv` | every production table as of 06:59 UTC, before any change: City, Station, StationAlias, StationMetrics, StationFact, StationNarrative, DataSource, RidershipDaily (39,142 rows), `_prisma_migrations` |
| `exports/ridership-history.csv` | the load file, 1,242,528 rows, 63,028,242 bytes, SHA-256 `89d48ba4429a14b0015df6081f7d4bcc8e39a5174fc7403b2d680f283d311d79` |
| `exports/ridership-history.summary.json` | the export summary |
| `exports/upstream-sample.json` | the 60-sample comparison |

Production checksums taken with the backups: facts 625 rows, `ea912a2122fd460cbf5a4fde9d9970e0`;
narratives 143 rows, max `lastComputed` 2026-02-02 19:50:52.465.

## 5. Production run (U8)

The most dangerous step in the plan: `migrate deploy` drops `RidershipDaily` in production.
Run it in a quiet window, with Nate's go at that moment.

### 5.1 Gates (all required)

| Gate | Evidence |
|---|---|
| Restore rehearsed | section 4.5 |
| Upstream sample passed | sections 4.4 and 4.6 (60 of 60) |
| Facts, narratives, and every other table exported locally | section 4.7 |
| CSV passes the distinct-count and station-id checks | the export refuses to write otherwise (section 3.3) |
| Projected size acceptable | 183 MB measured (section 4.3); Nate lifted the 800 MB cap |
| Seed rehearsed at the commit that will merge | section 4.8 |
| Rollback window known | production keeps 6 hours of history (`history_retention_seconds` 21600 on the Launch plan, checked 2026-10-03) |
| Every production ridership row survives the reload | section 5.2 step 2: 38,654 identical, 0 different, 488 absent (all Western, excluded by design) |
| Nate acknowledges the Western interim | from step 5 until Phase 2, Western (O'Hare) and Western (Orange) show empty charts beside metrics and narratives built on the swapped history; production shows those swapped charts today |
| Phase 1 PR open, not merged, no auto-merge | the PR link |
| Nate confirms at that moment | his reply |

Railway autodeploy is off (2026-10-03). That only stops a failed-build email; nothing on Railway
writes to Neon.

### 5.2 Steps

Record the UTC time and result of each step in section 5.4. Steps 4 to 7 run without a pause: from
the seed until the Phase 1 deploy, the old code lists State/Lake first in the ranking (it has no
metrics yet, and Postgres sorts that first), which the Phase 1 code fixes.

1. Take a manual snapshot of the production branch; confirm it in the snapshot list and note its
   id and time. The rehearsal snapshot from section 4.5 is a fallback, not the plan.
2. Guard the target and the artifacts, in the shell that runs steps 3 to 5:

   ```bash
   git rev-parse HEAD                     # the commit that will merge
   git status --porcelain                 # only .claude/worktrees/ may appear
   npx prisma generate
   shasum -a 256 prisma/migrations/20261003064611_revival_v2/migration.sql   # note it
   shasum -a 256 exports/ridership-history.csv   # must equal section 4.7
   node -e 'const u=new URL(process.env.DATABASE_URL_UNPOOLED);console.log(u.host,u.username,u.pathname)'
   # must print ep-purple-bread-ae5a0gwi.<region host> (no -pooler) neondb_owner /neondb
   psql "$DATABASE_URL_UNPOOLED" -Atc 'SELECT (SELECT count(*) FROM "Station"), (SELECT count(*) FROM "RidershipDaily")'
   # 143|39142
   ```

   Then confirm production is unchanged since the backups (the fact and narrative checksums in
   section 4.7), and run the row-preservation check: every production ridership row must appear in
   the load file with the same value, apart from the excluded Western stations.

   ```bash
   python3 - <<'EOF'
   import csv, collections
   load = {}
   with open('exports/ridership-history.csv') as f:
       r = csv.reader(f); next(r)
       for s, d, e, t in r: load[(s, d)] = int(e)
   names = {r['id']: r['name'] for r in csv.DictReader(open('exports/backups/2026-10-03-production/Station.csv'))}
   same = diff = 0; absent = collections.Counter()
   for r in csv.DictReader(open('exports/backups/2026-10-03-production/RidershipDaily.csv')):
       k = (r['stationId'], r['serviceDate'][:10])
       if k not in load: absent[names[r['stationId']]] += 1
       elif load[k] == int(r['entries']): same += 1
       else: diff += 1
   print('identical', same, 'differ', diff, 'absent', dict(absent))
   EOF
   # identical 38654 differ 0 absent {'Western (Orange)': 366, "Western (O'Hare)": 122}
   ```

3. Section 3.1 against production's direct URL as `neondb_owner`. Afterwards the `revival_v2`
   row's `checksum` in `_prisma_migrations` equals the noted SHA-256. If `migrate deploy` fails,
   Prisma records a failed row: run
   `npx prisma migrate resolve --rolled-back 20261003064611_revival_v2` before any retry.
4. Section 3.2: `--dry-run`, then the real run (345 changes), then a second run (0 changes). Any
   other report is a stop.
5. Section 3.3: load, `ANALYZE`, and every verification query.
6. Check that production still serves with the old code: `GET /api/chicago/stations-raw` returns
   200 and 144 stations, and a station detail returns 200 with a chart ending 2025-11-30.
7. Merge the Phase 1 PR and wait for the production deployment.
8. Check the new deployment: list and detail return 200; the list does not start with State/Lake;
   Harlem (`/api/chicago/stations/088ea428fedd5ac895912b99bd633067`) names Oak Park (Blue) and
   Forest Park; 30 concurrent detail requests return no 500s; the site still shows November 2025
   data. If a detail request fails with `cached plan must not change result type` (an instance that
   prepared the query before the table was recreated), redeploy to recycle the instances.

### 5.3 Rollback

- **Before the merge, within six hours of step 3:** restore the production branch to a time
  before step 3 (Neon instant restore). Connection strings keep working; Neon keeps the replaced
  state as a separate branch.
- **Later:** restore the step 1 snapshot onto the production branch with finalize (rehearsed in
  section 4.5). The branch id changes, so anything that refers to the production branch by id,
  including the Neon-Vercel integration, needs the new one.
- **Partial:** a failed load rolls back to an empty table and is re-run as is (section 3.3). Facts
  and narratives can be reloaded from the section 4.7 CSVs. Those backups exist only on this
  machine; copy them somewhere else before step 3.
- **The deployment fails after the merge:** Vercel Instant Rollback to the previous deployment,
  then revert the merge commit. The old code serves the new schema (section 4.1), so no database
  rollback is needed for that.

### 5.4 Monitoring (first 24 hours)

Check at +1 hour, +4 hours, and +24 hours:

| Signal | Expected | Where |
|---|---|---|
| 5xx on `/api/chicago/*` | none | Vercel runtime logs |
| Detail latency | no worse than before the migration | Vercel logs |
| Prisma errors (`P2022`, `P2010`, key violations) | none | Vercel logs |
| Storage | steady near 183 MB | Neon console |
| Writes | none; `max("lastUpdated")` in `StationMetrics` unchanged | SQL |

### 5.5 Record (2026-10-03, run by the agent on Nate's go)

| Step | UTC | Result |
|---|---|---|
| 1. Snapshot | 08:39:22 | `pre-u8-migration-2026-10-03` (`snap-rapid-flower-aeyqzl0l`), listed; Neon allowed a second manual snapshot, so the rehearsal one stayed |
| 2. Guards | 08:39:39 | commit `56d5be1` (code identical to the rehearsed `0c5d313`); migration SHA-256 `b1b054de8857661f...`; CSV SHA-256 as in section 4.7; target production direct host as `neondb_owner`; 143 stations, 39,142 ridership rows; fact and narrative checksums as in section 4.7; row check identical 38,654, differ 0, absent 488 (Western); live site 30 of 30 detail requests 200 |
| 3. Migrate | 08:40:00 to 08:40:02 | applied, no drift, recorded checksum equals the noted SHA-256, four CTA ids corrected, facts 625, narratives 143, metrics 143 |
| 4. Seed | 08:40:15 to 08:40:33 | dry run 345, real run 345, second run 0; 144 stations, 144 slugs, 1 closed |
| 5. Load | 08:40:46 to 08:41:13 | `COPY 1242528`; dates 2001-01-02 to 2025-11-30; 141 stations; sum 3,550,614,440; day types A 177,528, U 177,520, W 887,480; the three expected stations without rows; facts, narratives, metrics, and station checksums unchanged; 299 months equal to the CSV; 183 MB |
| 6. Old code | 08:41:27 | `stations-raw` 200 with 144 stations (State/Lake first, as expected); detail requests **29 of 30 returned 500** (see below); fixed at 08:42:20, then 60 of 60 returned 200 |
| 7. Merge | 08:42:53 | officialn8/ghost-stops#2 merged as `94f0ed2`; production deployment `dpl_8djStH74PNLw8yCqkuNhhrVKQSkn` live at 08:44:28 |
| 8. New code | 08:44:35 | `stations-raw` 144 stations with State/Lake last; Harlem names Oak Park (Blue) and Forest Park with its chart to 2025-11-30; `/api/chicago/stations` 200; 60 of 60 concurrent detail requests 200; no runtime errors since the deploy; the page renders the list and map with November 2025 data |

**The detail-route outage in step 6.** After the migration, warm production instances failed the
detail route's raw ridership query with Prisma `P2010` ("Error in the underlying connector"). Fresh
connections worked, as in every rehearsal. The likely cause is statements prepared before
`RidershipDaily` was recreated (when `serviceDate` was a timestamp) still cached on Neon's pooler
connections; the review had flagged this hazard. Restarting the production compute endpoint
(`ep-purple-bread-ae5a0gwi`, 08:42:20) dropped those connections and cleared it, with no data
change. Whether a Vercel redeploy alone would have cleared it was not tested. Detail pages could
have failed from 08:40:02 to 08:42:20; the only errors logged were the 30 test requests.

**For the next schema change that retypes or recreates a table the app queries:** restart the
compute endpoint right after the migration, before checking the live site.

## 6. Phase 2: backfill and sync go-live (U10)

Phase 2 replaces the Go ETL with the TypeScript sync in `src/lib/sync/`. Vercel Cron runs it
daily and weekly through `/api/cron/sync-ridership`; operators run the same library with
`scripts/run-sync.ts`. There is no schema change: every table it writes arrived in Phase 1.

### 6.1 Connections

The sync writes ridership, metrics, station statuses, and run records, never schema, so the
runtime role over the **pooled** host is enough and matches what the cron uses:

```bash
export DATABASE_URL='<ghost_stops_app pooled URL for the target branch>'
```

`CHICAGO_DATA_APP_TOKEN` is optional on an operator machine; the rehearsal ran without it at
about one second a month.

### 6.2 One backfill replaces the re-fetch list

`--since 2001-01-01` re-fetches every month from upstream, and the upsert writes only rows whose
entries or day type differ, so one pass covers the whole approved list in section 4.4 and the
plan's U10 backfill:

| Gap (section 4.4) | Filled by |
|---|---|
| Both Western stations, State/Lake, Jefferson Park, Washington before 2010, 2001-01-01 | inserted |
| Day types of weekday holidays, 2001 to 2024 | revised |
| CTA's 2025 restatement, and December 2025 to July 2026 | revised and inserted |
| Socrata's 618 duplicate days in 2011 | one row each: the most recently updated, and on a tie (all 618 tie) the higher count |

Retired ids 40200, 40500, 40640, and 41580 have no station, so the run lists them in
`unmatchedStationIds`; that is expected for any range before 2018.

### 6.3 Gates

| Gate | Evidence |
|---|---|
| `CRON_SECRET` in Vercel Production and Preview | set 2026-10-03 as a sensitive variable |
| `CHICAGO_DATA_APP_TOKEN` in Vercel Production | set in Phase 0 |
| Fluid compute for the 300-second cron | `vercel.json` sets `"fluid": true`; `src/lib/sync/schedule.test.ts` checks it |
| Rehearsal on a production copy matched, at the commit that will merge | section 6.6; the commit is recorded there |
| Production unchanged since the rehearsal's copy | step 0 baseline below |
| A restore point newer than the v2 migration | step 0 snapshot below (the U8 snapshot predates the migration, so restoring it would undo Phase 1) |
| Phase 2 PR open, CI green, no auto-merge | the PR link |

### 6.4 Steps

Avoid 10:00 to 11:00 UTC for steps 2 and 3: the daily cron fires in that hour, and whichever run
starts second records SKIPPED (the runner then exits 1; run it again afterward). Finish before
12:30 UTC, when the health workflow runs: until step 2 completes, `/api/health` answers 503 and the
workflow emails Nate.

0. Baseline and restore point, against production's pooled URL as the runtime role:
   - Print the host only, never the password, and confirm it is production
     (`ep-purple-bread-ae5a0gwi-pooler`), not a rehearsal branch:
     `node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.host,u.username)'`.
   - The baseline must equal the rehearsal's starting state, or stop and rehearse again:

     ```sql
     SELECT count(*), min("serviceDate"), max("serviceDate"), count(DISTINCT "stationId"), sum(entries) FROM "RidershipDaily";
     -- 1242528 | 2001-01-02 | 2025-11-30 | 141 | 3550614440
     SELECT (SELECT count(*) FROM "StationMetrics") AS metrics, (SELECT count(*) FROM "SyncRun") AS runs;
     -- 143 | 0  (runs > 0 means a cron already fired: see the note under step 2)
     ```

     and upstream's `max(date)` is still 2026-07-31.
   - Take a manual Neon snapshot of the production branch (for example
     `pre-u10-backfill-<date>`) and note its id. If Neon refuses it, note `SELECT now()` and rely on
     the six-hour instant restore instead.
1. Merge the Phase 2 PR and wait for the production deployment. Then:
   - `curl -s -o /dev/null -w '%{http_code}' https://ghost-stops.vercel.app/api/cron/sync-ridership` prints 401.
   - `/api/health` answers 503 with `"status":"stale"`: no run has succeeded yet. Expected until step 2.
2. Backfill: `npx tsx scripts/run-sync.ts --since 2001-01-01`, about five minutes. Expect status
   OK, fetched 1,333,391, **inserted 74,446** and revised 65,115, and `unmatchedStationIds` exactly
   40200, 40500, 40640, 41580. Section 6.6's rehearsal ran a daily window first, so its backfill
   inserted 8,784 fewer rows; if a scheduled run already inserted the window on production, expect
   65,662 here. Either way the table ends at 1,316,974 rows.
   - If the runner is interrupted (Ctrl-C, sleep, lost network), its `SyncRun` row stays RUNNING and
     holds the lease: a re-run within the hour records SKIPPED and exits 1. Wait until the row is an
     hour old (the next run expires it), or have Nate approve clearing it as the owner role:
     `UPDATE "SyncRun" SET lease = NULL, status = 'FAILED', "finishedAt" = now() WHERE status = 'RUNNING';`
     Re-running is safe: every chunk upserts idempotently.
3. Reconcile: `npx tsx scripts/run-sync.ts --reconcile`. Expect `"driftMonths": []`. Until this
   succeeds, `/api/health` answers 503 with `"status":"reconcile-stale"`: health also requires a
   successful weekly reconciliation within 15 days (review finding #5, Nate's call), and this run
   is the first one.
4. Run the queries in section 6.5; each must match section 6.6.
5. `/api/health` answers 200 with `"dataThrough": "2026-07-31"` and a `lastReconciliationAt` from
   step 3. The site's charts end 2026-07-31.
6. Run the health workflow once: `gh workflow run health.yml`; it must pass. Then rehearse a
   failure: `gh workflow run health.yml -f url=https://ghost-stops.vercel.app/api/health-missing`;
   it must fail, and GitHub must email Nate.
7. The next day: the first scheduled run appears in `SyncRun` with trigger `cron-daily`, status
   OK, `startedAt` between 10:00 and 10:59 UTC, and `durationMs` under 300,000. The first Sunday
   run must record trigger `cron-weekly`; anything else means the `x-vercel-cron-schedule` header did
   not arrive as `vercel.json` spells it, and drift goes unreconciled.

For the first week, read `SyncRun` and the `dataThrough` on `/api/health` directly: a FAILED or
PARTIAL run turns health red only after 10 days without an OK run, and health does not notice
upstream stalling (every run is OK with nothing inserted).

### 6.5 Verification queries

Save these to a file and run `psql "$DATABASE_URL" -X -A -f <file>`. Section 6.6 has the
expected results.

```sql
\echo '-- totals'
SELECT count(*) AS rows, min("serviceDate") AS first, max("serviceDate") AS last, count(DISTINCT "stationId") AS stations, sum(entries) AS riders FROM "RidershipDaily";
\echo '-- day types'
SELECT "dayType", count(*) FROM "RidershipDaily" GROUP BY 1 ORDER BY 1;
\echo '-- AE8: Western pair on 2025-11-03 (expect 40670 3476, 40310 2617)'
SELECT s."ctaStationId", s.name, r.entries FROM "RidershipDaily" r JOIN "Station" s ON s.id = r."stationId" WHERE s."ctaStationId" IN ('40670','40310') AND r."serviceDate" = '2025-11-03' ORDER BY 1;
\echo '-- Western 2019 averages (expect O''Hare above Orange)'
SELECT s."ctaStationId", s.name, round(avg(r.entries)) AS avg2019, count(*) AS days FROM "RidershipDaily" r JOIN "Station" s ON s.id = r."stationId" WHERE s."ctaStationId" IN ('40670','40310') AND r."serviceDate" BETWEEN '2019-01-01' AND '2019-12-31' GROUP BY 1, 2 ORDER BY 1;
\echo '-- 95th/Dan Ryan 2025-03-03 (expect the restated 5333)'
SELECT r.entries FROM "RidershipDaily" r JOIN "Station" s ON s.id = r."stationId" WHERE s."ctaStationId" = '40450' AND r."serviceDate" = '2025-03-03';
\echo '-- first and last day per re-fetched station'
SELECT s."ctaStationId", s.name, min(r."serviceDate"), max(r."serviceDate"), count(*) FROM "RidershipDaily" r JOIN "Station" s ON s.id = r."stationId" WHERE s."ctaStationId" IN ('40670','40310','40260','41280','40370') GROUP BY 1, 2 ORDER BY 1;
\echo '-- every station has 2001-01-01 if it existed then'
SELECT count(*) AS stations_on_2001_01_01 FROM "RidershipDaily" WHERE "serviceDate" = '2001-01-01';
\echo '-- holidays stored as U (2019-07-04, 2019-12-25)'
SELECT "serviceDate", "dayType", count(*) FROM "RidershipDaily" WHERE "serviceDate" IN ('2019-07-04', '2019-12-25') GROUP BY 1, 2 ORDER BY 1;
\echo '-- metrics and statuses'
SELECT count(*) AS metrics, count(*) FILTER (WHERE "dataThrough" = '2026-07-31') AS through_jul31, array_agg(DISTINCT "dataStatus") AS statuses, count(*) FILTER (WHERE "ghostScore" = -1) AS no_v1_score FROM "StationMetrics";
SELECT status, count(*) FROM "Station" GROUP BY 1 ORDER BY 1;
\echo '-- untouched tables'
SELECT (SELECT count(*) FROM "StationFact") AS facts, (SELECT count(*) FROM "StationNarrative") AS narratives, (SELECT md5(string_agg(id || "factKey" || value::text, ',' ORDER BY id)) FROM "StationFact") AS fact_md5, (SELECT md5(string_agg(id || "renderedStory", ',' ORDER BY id)) FROM "StationNarrative") AS narrative_md5;
\echo '-- runs'
SELECT trigger, status, lease IS NULL AS released, "windowStart", "windowEnd", "rowsFetched", "rowsInserted", "rowsRevised", "unmatchedStationIds", jsonb_array_length("driftMonths") AS drift, "durationMs" FROM "SyncRun" ORDER BY "startedAt";
\echo '-- size'
SELECT pg_size_pretty(pg_database_size(current_database())) AS db, pg_size_pretty(pg_total_relation_size('"RidershipDaily"')) AS ridership;
```

### 6.6 Rehearsal (2026-10-03, branch `rehearsal-phase-2-sync`)

All on `rehearsal-phase-2-sync` (`br-spring-bonus-aejkv4yp`), a copy of production taken at
09:22 UTC after U8, as the runtime role over the pooled host. Production was only read.

| Step | Result |
|---|---|
| Daily run (window 2026-06-01 to 2026-07-31) | fetched 8,784, inserted 8,784, 6 s; a second run inserted 0 and revised 0; both rows OK with the lease released |
| Cron route while the backfill held the lease (local `next dev` on the branch) | no header 401, wrong secret 401, right secret: a SKIPPED run with no writes (AE5) |
| Backfill `--since 2001-01-01` | 297 s; fetched 1,333,391 (every upstream row), inserted 65,662, revised 65,115; unmatched 40200, 40500, 40640, 41580 |
| Weekly reconciliation through the cron route | 9 s; zero drift months: every station-month from 2001 to July 2026 equals upstream |
| Health route | 200, `dataThrough` 2026-07-31 |

Verification query results:

| Query | Result |
|---|---|
| Totals | 1,316,974 rows, 2001-01-01 to 2026-07-31, 144 stations, 3,820,929,857 riders |
| Day types | A 187,484, U 209,596, W 919,894 |
| AE8, 2025-11-03 | Western (O'Hare) 3,476, Western (Orange) 2,617 |
| Western, 2019 average | O'Hare 4,519, Orange 2,984 (O'Hare higher, as upstream) |
| 95th/Dan Ryan, 2025-03-03 | 5,333 (restated) |
| State/Lake, both Westerns, Jefferson Park, Washington | 9,343 days each, 2001-01-01 to 2026-07-31; upstream reports State/Lake at 0 riders since it closed |
| Stations on 2001-01-01 | 138 (the rest opened later) |
| 2019-07-04 and 2019-12-25 | `U` for all 143 stations open in 2019 |
| Metrics | 144 rows, all through 2026-07-31; State/Lake `zero` with score -1; the other 143 keep their v1 scores until U12 |
| Statuses | 143 ACTIVE, State/Lake CLOSED |
| Facts and narratives | 625 and 143, checksums equal to production |
| Size | database 199 MB, `RidershipDaily` 189 MB |

The live UI on the branch rendered July 2026 data with State/Lake last and no console errors;
Harlem kept Oak Park (Blue) and Forest Park as neighbors.

### 6.6b Final rehearsal at commit 8fa71b1 (2026-10-03)

After the review fixes, the whole of section 6.4 ran again on a fresh copy of production,
`rehearsal-phase-2-final` (`br-little-tooth-ae0eapnk`, copied at 10:24 UTC), as the runtime role over
the pooled host, at commit `8fa71b1`:

| Step | Result |
|---|---|
| 0. Baseline | 1,242,528 rows, 2001-01-02 to 2025-11-30, 141 stations, sum 3,550,614,440; 143 metrics rows; 0 runs; upstream max 2026-07-31; health 503 `stale` |
| 2. Backfill | 283 s; fetched 1,333,391, inserted 74,446, revised 65,115; unmatched 40200, 40500, 40640, 41580; health 503 `reconcile-stale` |
| 3. Reconcile | 8 s; zero drift months; health 200 with both dates |
| 4. Queries (6.5) | every result identical to section 6.6 |
| v1 scores | identical to production's for all 143 stations; State/Lake gains one row with -1 |

### 6.8 Go-live record (2026-10-03, run by the agent on Nate's "merge and go live")

All against production (`br-floral-rain-aeynqoma`) as the runtime role over the pooled host, from
the merged `main` (`9dbca56`).

| Step | UTC | Result |
|---|---|---|
| 0. Baseline and snapshot | 15:59:03 to 15:59:31 | 1,242,528 rows, 2001-01-02 to 2025-11-30, 141 stations, sum 3,550,614,440; 143 metrics rows; 0 runs; upstream max 2026-07-31. Snapshot `pre-u10-backfill-2026-10-03` (`snap-hidden-tooth-aeyf4rua`) listed |
| 1. Merge and deploy | 15:59:41 to 16:01:22 | officialn8/ghost-stops#3 merged as `9dbca56`; deployment `dpl_GacprerinjdaF8axWtD6vRopHN99` ready at 16:01:10; cron route 401 without the secret; health 503 `stale` |
| 2. Backfill | 16:01:33 to 16:06:28 | 295 s; fetched 1,333,391, inserted 74,446, revised 65,115; unmatched 40200, 40500, 40640, 41580; health 503 `reconcile-stale` |
| 3. Reconcile | 16:06:39 to 16:06:48 | zero drift months; health 200 with both dates |
| 4. Queries (6.5) | 16:06:50 | every result identical to section 6.6b, including the fact and narrative checksums; v1 scores unchanged for all 143 stations, State/Lake gains one row with -1 |
| 5. Live site | 16:07 | `/api/health` 200, `dataThrough` 2026-07-31; the list has 144 stations with data as of 2026-07-31 and State/Lake last in both score sorts; Harlem names Oak Park (Blue) and Forest Park with its chart ending 2026-07-31; State/Lake's detail is `ranked: false`; 30 of 30 concurrent detail requests 200; no runtime errors since the deploy |
| 6. Health workflow | 16:07:16 to 16:09 | run 37135678647 passed (HTTP 200); forced failure run 37135712388 failed with HTTP 404 twice, and Nate confirmed GitHub emailed him |
| 7. First scheduled runs | pending | daily `cron-daily` on 2026-10-04 between 10:00 and 10:59 UTC; weekly `cron-weekly` the same day between 14:00 and 14:59 UTC |

### 6.7 Rollback

- **Stop the cron:** remove the two `crons` entries from `vercel.json` and deploy, or replace
  `CRON_SECRET` so every call answers 401.
- **Data:** the sync only inserts rows and overwrites them with upstream's values. Pause the crons
  first, then restore the step 0 snapshot, or within six hours use Neon instant restore to a time
  before step 2. Either also discards the `SyncRun` history. Afterward upstream is the source of
  truth, and a re-run puts its values back.
- **Code only, after the backfill:** an Instant Rollback puts the Phase 1 routes in front of
  State/Lake's new metrics row (0 riders, score -1), which then leads the ascending sorts and appears
  as a 0-rider neighbor. Cosmetic; removing that row is an owner write that needs Nate's go.
- **A failed deploy:** Vercel Instant Rollback, then revert the merge. No schema changed.

## 7. Phase 3: score v2, narratives, API v2 (U12 to U14)

Phase 3 changes what the sync writes, not the schema: every run now fills the score v2 columns of
`StationMetrics` (`ghostScore` becomes a 0 to 100 percentile, -1 for unranked stations) and
regenerates every `StationNarrative` with `templateVersion` v2 and the run's `dataThrough`. The seed
gains `Station.openedAt` for the six stations opened since 2001. No migration.

Until the first v2 run after the deploy, the detail route withholds every narrative (none carries a
matching `dataThrough`) and returns `whyCard: null` (rows are still `scoreVersion` 1). Steps 2 and 3
close that window within minutes.

### 7.1 Steps

Same connection as section 6.1 (the runtime role over production's pooled host), and the same
10:00 to 11:00 UTC cron caveat as section 6.4.

0. Baseline: production still holds 1,316,974 `RidershipDaily` rows through 2026-07-31, 144
   `StationMetrics` rows all `scoreVersion` 1, and no `Station.openedAt`. Take a manual Neon snapshot
   (for example `pre-u12-score-v2-<date>`) and note its id.
1. Seed the opening dates from this branch before merging (the Phase 2 code ignores `openedAt`):
   `npx tsx scripts/seed-reference-data.ts --dry-run` must report exactly six `openedAt` updates and
   nothing else; then run it without `--dry-run`, and a second run reports 0 changes.
2. Merge the Phase 3 PR and wait for the production deployment.
3. Run the sync once: `npx tsx scripts/run-sync.ts`. Expect status OK, `narrativesWritten` 144,
   `narrativesRejected` 0. The local runner does not revalidate the `stations` cache tag (only the
   cron route does), so `/api/chicago/stations` keeps any payload cached before this run for up to
   an hour. Invalidate the tag in Vercel (Project, Settings, Caches, or the API's invalidate-by-tags
   with tag `stations`, target production), then request the route twice.
4. Verify against section 7.2: the tier counts, the top and bottom 15, all 144 narratives v2 with
   matching `dataThrough`, Logan Square's story reading as growth, and no em dash in any story.
5. Live site: `/api/chicago/stations` returns 144 stations with `dataThrough` "2026-07-31";
   `/api/chicago/stations/logan-square` and the same station by uuid return 200; the map's detail
   panel shows the v2 narrative.

### 7.2 Rehearsal (2026-10-03, branch `rehearsal-phase-3-score`)

On `rehearsal-phase-3-score` (`br-fragrant-water-aeef6q9n`), a copy of production taken at 19:48
UTC, as the runtime role over the pooled host, at commit `5a59384`. Production was only read.

| Step | Result |
|---|---|
| Baseline | 1,316,974 rows to 2026-07-31, 144 stations, 144 metrics rows all `scoreVersion` 1, no `openedAt` |
| Seed | six `openedAt` updates (Conservatory 2001-06-30, Oakton-Skokie 2012-04-30, Morgan 2012-05-18, Cermak-McCormick Place 2015-02-08, Washington/Wabash 2017-08-31, Damen (Green) 2024-08-05); a second run 0 changes |
| Daily run | OK in 4.1 s; fetched 8,784, inserted 0, revised 0; 144 narratives written, 0 rejected |
| Tiers | 143 ranked, scores 0 to 100: ghost 15, fading 22, quiet 35, healthy 71; State/Lake unranked at -1 with the closed story |
| Narratives | 144 of 144 v2 with `dataThrough` equal to the metrics; no em dash; Logan Square "has grown to 4,306, a +13% change" |
| Routes (local `next dev` on the branch) | list 200 with 144 stations, `dataThrough` "2026-07-31", sparkline 2026-07-25 to 2026-07-31; slug and uuid 200, unknown 404; Washington/Wabash keeps v1 `neighbors.prev` null and names State/Lake CLOSED in `lineNeighbors`; Lawrence's year-over-year row "reopened Jul 2025, year-over-year available from Oct 2026" |
| v1 UI | the map's list and detail panel render v2 scores and the v2 narrative through the renamed route by uuid; no console errors |

Hand review of the production ranking (component percentiles in the order residual, year-over-year,
long-run, erraticness). Every placement follows from its rows:

| Rank | Station | Score | Why |
|---|---|---|---|
| 1 | Oak Park (Green) | 100 | 703 a day against Harlem/Lake 1,935 and Ridgeland 673 (88); -10% year over year (97); -45% since 2019 (89) |
| 2 | Monroe (Red) | 99 | 3,723 against Lake 9,879 and Jackson 3,970 (89); -53% since 2019 (94) |
| 3 | Monroe (Blue) | 99 | 3,047 against Washington 7,402 and Jackson 3,794 (87); -5% (93); -51% since 2019 (92) |
| 4 | Chicago (Blue) | 98 | 1,920 against Division and Grand (81); -27% year over year (99) |
| 5 | 87th | 97 | 1,850 against 79th and 95th (94); -43% since 2019 (87) |
| 6 | Kostner | 96 | 242 against Cicero and Pulaski (Pink) (98); -39% since 2019 (78) |
| 7 | Racine | 96 | 643 against UIC-Halsted and Illinois Medical District (100); -62% since 2019 (98) |
| 8 | Montrose (Blue) | 95 | 1,436 against Jefferson Park and Irving Park (94); -4% (91) |
| 9 | Thorndale | 94 | 1,580 against Granville and Bryn Mawr (79); -5% (94); -38% since 2019 (76) |
| 10 | Harlem (Forest Park) | 94 | 330 against Oak Park (Blue) and Forest Park (95); -65% since 2019 (100) |
| 11 | Harrison | 93 | 2,302 against Jackson and Monroe (83); -4% (91); erratic (87) |
| 12 | Western (Forest Park) | 92 | 527 against Illinois Medical District and Kedzie-Homan (89); -61% since 2019 (97) |
| 13 | Harlem (O'Hare) | 92 | 1,367 against Cumberland and Jefferson Park (93); -41% since 2019 (83) |
| 14 | LaSalle/Van Buren | 91 | 1,565 against the Loop median 4,160 (97); growing +6%, so it carries "small but growing" |
| 15 | Austin (Green) | 90 | -9% year over year (96); -46% since 2019 (91) |
| 129 to 143 | Roosevelt, 95th/Dan Ryan, Garfield (Green), Addison (Red), Washington (Blue), Davis, Fullerton, Morgan, Clark/Lake, Belmont, Cermak-McCormick Place, Washington/Wabash, O'Hare, Cermak-Chinatown, 54th/Cermak | 10 to 0 | each carries two to five times its peers' riders (residual 0 to 17); hubs compare with their branch median; Washington/Wabash (+47%) and Clark/Lake (+25%) absorbed State/Lake's riders after it closed |

On production data the snapshot's ghosts shift: Kostner stays a ghost; King Drive (88) and Halsted
(Green) (83) are fading; Indiana (58) is quiet because it grew 19% year over year. Wilson is
healthy (27): it carries about twice its neighbors' riders, although its year-over-year decline
(-13%, percentile 98) is among the steepest, and its story opens "holding its own" because healthy
stations get growth or stability stories.

### 7.3 Rollback

- **Code:** Vercel Instant Rollback to the Phase 2 deployment. Its routes read `ghostScore`, which
  now holds the v2 percentile, so the v1 colors stay miscalibrated (as they are until U18), and its
  detail route shows the v2 narratives (it never checked `dataThrough`). Nothing breaks.
- **Data:** the Phase 2 sync leaves `ghostScore` and the narratives alone, so the v1 scores do not
  come back on their own. Restore the step 0 snapshot (or Neon instant restore within six hours) if
  they must.
- **Opening dates:** harmless to every version of the code; leave them.

### 7.4 Go-live record (2026-10-03, run by the agent on Nate's "merge and go live")

All against production (`br-floral-rain-aeynqoma`) as the runtime role over the pooled host.

| Step | UTC | Result |
|---|---|---|
| 0. Baseline and snapshot | 19:56 | 1,316,974 rows to 2026-07-31, 144 stations; 144 metrics rows all `scoreVersion` 1; no `openedAt`; 143 narratives without `dataThrough`. Snapshot `pre-u12-score-v2-2026-10-03` (`snap-silent-sun-ae789rxc`) |
| 1. Seed | 19:56 | dry run exactly six `openedAt` updates; applied; a second run 0 changes |
| 2. Merge and deploy | 19:56:58 to 19:58 | officialn8/ghost-stops#4 merged as `77d11da` with all five checks green; deployment `dpl_F5xVNsQfUcEjHH5SeQdQ2AdmZAcY` live by 19:58:33 |
| 3. Sync | 19:58:37 | OK in 3.4 s; fetched 8,784, inserted 0, revised 0; 144 narratives written, 0 rejected |
| 4. Verification | 19:59 | every station's rank, score, tier and component percentiles identical to the rehearsal (section 7.2); ghost 15, fading 22, quiet 35, healthy 71, State/Lake unranked; 144 of 144 narratives v2 with matching `dataThrough`; no em dash; Logan Square growth, State/Lake closed, O'Hare airport |
| 5. Live site | 20:00 | `/api/health` 200; the list served the payload cached by the deploy check (no tiers, last fetch 16:06) until the `stations` tag was invalidated, then 143 ranked stations led by Oak Park (Green); Logan Square by slug and uuid 200, unknown slug 404; Lawrence's year-over-year chip "available from Oct 2026"; Washington/Wabash keeps v1 `neighbors.prev` null with State/Lake CLOSED in `lineNeighbors`; 30 of 30 concurrent detail requests 200; `stations-raw` 200; the map's list and Oak Park's panel render v2 scores and the v2 narrative with no console errors |

