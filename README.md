# Ghost Stops

Ghost Stops finds Chicago's emptiest "L" stations and explains why each one ranks where it does. Every one of the CTA's 144 stations gets its own page with the numbers behind its standing. Each open station with recent riders also gets a Ghost score and a tier.

Live at **https://ghost-stops.vercel.app**.

## How the Ghost score works

The score compares each open station with the others, so it ranges from 0 to 100 whatever the season or the year. It combines four parts, each a percentile among the ranked stations:

| Part | Weight | Asks |
|---|---|---|
| Riders against peers | 45% | How many riders does it get next to the stations beside it on its line? |
| Change from last year | 25% | Is it down from the same 90 days a year ago? |
| Change since 2019 | 20% | How far is it below its pre-pandemic year? |
| Day-to-day swings | 10% | How erratic is its ridership? |

The weighted sum is ranked again, so 100 is the most ghost-like station and 0 the busiest for its context. Tiers follow from the score: **ghost** (90 and up), **fading** (75 to 89), **quiet** (50 to 74), and **healthy** (under 50). Closed stations, such as State/Lake since January 2026, and stations without recent riders are shown but not ranked.

Ridership comes from the CTA's daily station entries on the Chicago Data Portal. The CTA publishes them about two months after the fact, and the site checks for new data every day.

## Stack

Next.js 16 and React 19 on Vercel, Neon Postgres through Prisma 7, Mapbox GL for the map, Tailwind CSS with the project's own design tokens, and `motion` for animation. A TypeScript sync, run by Vercel Cron, keeps the data current. `.claude/CLAUDE.md` describes the architecture in detail.

## Run it locally

You need:

- Node 22 (`.nvmrc`) and npm.
- A Mapbox public token (`pk.…`) for the map.
- A Postgres database that already holds Ghost Stops data, for the dev server. The station list and coordinates come from that data, so an empty database shows no stations.
- Docker, for the database tests.

### 1. Install

```bash
git clone https://github.com/officialn8/ghost-stops.git
cd ghost-stops
npm install
```

`npm install` also generates the Prisma client into `src/generated/prisma`.

### 2. Configure

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

- `DATABASE_URL` and `DATABASE_URL_UNPOOLED`: the database from step 3.
- `NEXT_PUBLIC_MAPBOX_TOKEN`: your Mapbox token.
- `CHICAGO_DATA_APP_TOKEN` and `CRON_SECRET`: only needed to run the sync. Leave them empty otherwise.

Next reads `.env.local` for the dev server. The Prisma CLI, the scripts, and the database tests do not read env files, so export the variables in your shell for those.

### 3. Get a database

Either of these works:

- **A Neon branch (simplest, with access to the project).** In the Neon console, create a branch from `production`. Put its pooled URL (the host ending in `-pooler`) in `DATABASE_URL` and its direct URL in `DATABASE_URL_UNPOOLED`. Delete the branch when you are done.
- **A local copy.** Start Postgres in Docker and copy a Neon branch into it:

  ```bash
  docker run -d --name ghost-stops-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
  docker exec ghost-stops-pg createdb -U postgres ghost_stops_dev
  docker exec ghost-stops-pg sh -c 'pg_dump --no-owner --no-acl "$0" | psql -q -U postgres ghost_stops_dev' '<a Neon branch direct URL>'
  ```

  Then set both URLs to `postgresql://postgres:postgres@localhost:55432/ghost_stops_dev`.

Never point a local tool at production's URL for writing. The runbook (`docs/runbooks/history-load.md`) records how production is changed.

### 4. Start the dev server

```bash
npm run dev
```

Open http://localhost:3000.

## Tests

```bash
npx tsc --noEmit     # type check
npm run lint         # lint, including the rule that keeps server code out of components
npm test             # unit and component tests; no database needed
```

The database tests run against an empty local Postgres that they fill and clear themselves. They refuse any `DATABASE_URL` that is not local:

```bash
docker run -d --name ghost-stops-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ghost_stops_test -p 54329:5432 postgres:17
export DATABASE_URL=postgresql://postgres:postgres@localhost:54329/ghost_stops_test
export DATABASE_URL_UNPOOLED=$DATABASE_URL
npx prisma migrate deploy
npm run test:db
```

CI runs all of these, plus a gitleaks scan of the full history, on every push.

## Pages and API

- `/`: the map and the ranked list of every station, with sort, line filter, and search.
- `/station/[slug]`: one station's page, for example `/station/halsted-green`.
- `GET /api/chicago/stations`: every station with its tier, rank, riders per day, and last week of ridership.
- `GET /api/chicago/stations/{slug}`: one station's detail, the same data its page shows.
- `GET /api/health`: the state of the data sync.

## Documentation

- `.claude/CLAUDE.md`: architecture, conventions, and common tasks.
- `DEPLOYMENT.md`: Vercel, Neon, migrations, the sync, health checks, rollback.
- `docs/plans/2026-10-02-2208-feat-ghost-stops-revival-plan.md`: the October 2026 revival plan, whose requirement and decision IDs the code cites.
- `docs/runbooks/history-load.md`: the record of every production data change.
- `docs/audit-2026-10-02/`: the audit that started the revival.
- `docs/archive/`: documents from before the revival, kept as history.

## Data sources

- [CTA – Ridership – 'L' Station Entries – Daily Totals](https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f), Chicago Data Portal.
- [CTA – System Information – List of 'L' Stops](https://data.cityofchicago.org/Transportation/CTA-System-Information-List-of-L-Stops/8pix-ypme), for station ids.
- U.S. Census Bureau and LEHD (LODES) data for the neighborhood facts some station stories cite.

## License

MIT. See `LICENSE`.
