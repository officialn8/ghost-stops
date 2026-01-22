# Hybrid Sync Architecture

This document outlines the hybrid data synchronization process for Ghost Stops, which combines a local database cache with an external source of truth (Socrata) to provide fast, up-to-date transit data.

## Overview

The core idea is to keep a small, recent window of ridership data locally while relying on the City of Chicago's Socrata dataset as the ultimate source of truth. This approach minimizes local storage requirements and ensures the API remains fast, as it doesn't need to query the Socrata API at request time.

- **Source of Truth:** [CTA Ridership L Station Entries – Daily Totals (Socrata Dataset 5neh-572f)](https://data.cityofchicago.org/resource/5neh-572f.json)
- **Local Cache:** A local SQLite database (`prisma/dev.db`) storing:
    - `Station` metadata (from GTFS)
    - `RidershipDaily` (a rolling window of the last 365 days)
    - `StationMetrics` (computed values like rolling averages and ghost scores)

## Sync Process

The sync process is handled by the `go-etl sync-ridership` command. It's designed to be idempotent and can be run safely multiple times.

The command performs the following steps:

1.  **Find Last Sync Point:** It queries the local `RidershipDaily` table to find the most recent `serviceDate`. This date is used as the starting point for the Socrata query, ensuring we only fetch new data.
2.  **Fetch from Socrata:** It pulls new ridership records from the Socrata API using a `$where` clause to filter for dates greater than the last sync point. It handles pagination automatically.
3.  **Upsert Data:** New records are inserted or updated into the local `RidershipDaily` table based on a unique key of `(stationId, serviceDate)`.
4.  **Prune Old Data:** To keep the local database small, the command deletes any `RidershipDaily` records older than 365 days.

After the sync, the `go-etl compute` command is run to re-calculate the `StationMetrics` based on the newly updated local data.

## Running the Sync

To run the sync manually, you need to set the `DATABASE_URL` and `CHICAGO_DATA_APP_TOKEN` environment variables.

```bash
export DATABASE_URL="file:../prisma/dev.db"
export CHICAGO_DATA_APP_TOKEN="YOUR_APP_TOKEN" # Get one from data.cityofchicago.org

cd go-etl
go run cmd/go-etl/main.go sync-ridership
go run cmd/go-etl/main.go compute
```

### Scheduling

For production, this script should be run daily via a cron job or a similar scheduler.

```cron
# Run every day at 3:00 AM
0 3 * * * /path/to/your/project/go-etl/run-sync.sh
```

Where `run-sync.sh` is a script that sets environment variables and runs the commands.

## Failure Handling

- **Socrata API Unavailability:** If the Socrata API is down or returns an error, the sync command will fail with a clear error message. The local database will remain untouched. The next successful run will catch up from the last successful sync point.
- **Invalid Data:** If a record from Socrata cannot be matched to a local station (e.g., due to a new or unrecognized `station_id`), a warning is logged, and the record is skipped.

## Query Examples

Here are some example SoQL queries that the sync command uses internally.

**Fetch data since a specific date:**

```
https://data.cityofchicago.org/resource/5neh-572f.json?$where=date > '2024-01-01T00:00:00.000'
```

**Pagination:**

```
https://data.cityofchicago.org/resource/5neh-572f.json?$where=date > '2024-01-01T00:00:00.000'&$limit=50000&$offset=50000
```
