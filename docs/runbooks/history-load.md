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

Section added with the roster seed (U6).

### 3.3 Load history

Section added with the history export (U7).

## 4. Dry run

Recorded by U7: branch, measured size per year, projected total, the sixty-sample upstream
comparison, restore rehearsal, and the location of the backup CSVs.

## 5. Production run

Recorded by U8.
