/**
 * Base metrics for every station with ridership: the 12-month, 90-day, and 30-day averages, the
 * latest day, and a data status, all as of the city's data-through date. Reads and computation run
 * outside any transaction; the write, which carries the score v2 columns too, is one set-based
 * statement whatever the station count (KTD10), so it fits inside the run's short transaction.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { MetricsDataStatus } from "@/lib/scoring/ranked";
import type { ScoreColumns } from "@/lib/scoring/score";

// The ranking rule and the stored data status live with scoring; existing importers keep this path.
export { isRanked, type MetricsDataStatus } from "@/lib/scoring/ranked";

export interface BaseMetricInputs {
    stationId: string;
    lastDate: string;
    lastEntries: number;
    avg12m: number | null;
    avg90d: number | null;
    avg30d: number | null;
    daysLast60: number;
}

export interface BaseMetrics {
    stationId: string;
    serviceDateMax: string;
    lastDayEntries: number;
    avg12m: number | null;
    avg30d: number | null;
    /**
     * The 30- and 90-day averages, 0 when there is no data. The dossier's baselines compare
     * rolling30dAvg; nothing reads rolling90dAvg since the v1 trend field went (U23).
     */
    rolling30dAvg: number;
    rolling90dAvg: number;
    dataStatus: MetricsDataStatus;
}

type RawDb = Pick<PrismaClient, "$queryRaw">;

/**
 * The latest service date stored for the city, or null before any data. One primary-key probe per
 * station: a plain max() over the join scans every row (452 ms against 1 ms on production's copy).
 */
export async function storedMaxDate(db: RawDb, cityId: string): Promise<string | null> {
    const [row] = await db.$queryRaw<{ max: string | null }[]>`
        SELECT max(latest."serviceDate")::text AS max
        FROM "Station" s
        CROSS JOIN LATERAL (
            SELECT r."serviceDate" FROM "RidershipDaily" r
            WHERE r."stationId" = s.id ORDER BY r."serviceDate" DESC LIMIT 1
        ) latest
        WHERE s."cityId" = ${cityId}`;
    return row?.max ?? null;
}

/** One row per station that has any ridership; stations with none get no metrics row. */
export async function readBaseMetricInputs(db: RawDb, cityId: string, asOf: string): Promise<BaseMetricInputs[]> {
    return db.$queryRaw<BaseMetricInputs[]>`
        SELECT s.id AS "stationId", latest."serviceDate"::text AS "lastDate", latest."entries" AS "lastEntries",
               w.avg12m AS "avg12m", w.avg90d AS "avg90d", w.avg30d AS "avg30d", w.days60 AS "daysLast60"
        FROM "Station" s
        CROSS JOIN LATERAL (
            SELECT r."serviceDate", r."entries" FROM "RidershipDaily" r
            WHERE r."stationId" = s.id ORDER BY r."serviceDate" DESC LIMIT 1
        ) latest
        CROSS JOIN LATERAL (
            SELECT avg(r."entries")::float8 AS avg12m,
                   (avg(r."entries") FILTER (WHERE r."serviceDate" > ${asOf}::date - 90))::float8 AS avg90d,
                   (avg(r."entries") FILTER (WHERE r."serviceDate" > ${asOf}::date - 30))::float8 AS avg30d,
                   (count(*) FILTER (WHERE r."serviceDate" > ${asOf}::date - 60))::int AS days60
            FROM "RidershipDaily" r
            WHERE r."stationId" = s.id
              AND r."serviceDate" > ${asOf}::date - interval '1 year'
              AND r."serviceDate" <= ${asOf}::date
        ) w
        WHERE s."cityId" = ${cityId}`;
}

export function dataStatusFor(input: Pick<BaseMetricInputs, "avg30d" | "daysLast60">): MetricsDataStatus {
    if (input.daysLast60 === 0) return "missing";
    if (input.avg30d === null || input.avg30d < 1) return "zero";
    return "normal";
}

export function computeBaseMetrics(inputs: readonly BaseMetricInputs[]): BaseMetrics[] {
    return inputs.map((input) => ({
        stationId: input.stationId,
        serviceDateMax: input.lastDate,
        lastDayEntries: input.lastEntries,
        avg12m: input.avg12m,
        avg30d: input.avg30d,
        rolling30dAvg: input.avg30d ?? 0,
        rolling90dAvg: input.avg90d ?? 0,
        dataStatus: dataStatusFor(input),
    }));
}

/** A station's full StationMetrics row: the base metrics and its score v2 columns. */
export type StationMetricsRow = BaseMetrics & ScoreColumns;

/**
 * Upserts every station's metrics, base and score v2 together, in one statement (KTD10), so the
 * ranking and the averages behind it always change in the same commit. `ghostScore` carries the
 * v2 score, or -1 for an unranked station, the Go ETL's marker for no score, which sorts it last.
 * The rows travel as one jsonb parameter: Prisma 6 rejects arrays holding nulls (Postgres 22P03),
 * which rules out `unnest` for the nullable columns.
 */
export async function writeStationMetrics(
    tx: Pick<Prisma.TransactionClient, "$executeRaw">,
    rows: readonly StationMetricsRow[],
    dataThrough: string,
    now: Date,
): Promise<number> {
    return tx.$executeRaw`
        INSERT INTO "StationMetrics" (
            "id", "stationId", "lastDayEntries", "rolling30dAvg", "rolling90dAvg", "ghostScore",
            "lastUpdated", "serviceDateMax", "dataStatus", "avg12m", "avg30d", "dataThrough",
            "scoreVersion", "tier", "rank", "rankedCount", "residualPct", "yoyPct", "longRunPct", "erraticPct",
            "baselineAvg", "peerStationIds", "yoyChangePct", "vs2019Pct", "weekdayAvg", "weekendAvg"
        )
        SELECT gen_random_uuid()::text, m."stationId", m."lastDayEntries", m."rolling30dAvg", m."rolling90dAvg", m."ghostScore",
               ${now}, m."serviceDateMax"::date, m."dataStatus", m."avg12m", m."avg30d", ${dataThrough}::date,
               m."scoreVersion", m."tier"::"ScoreTier", m."rank", m."rankedCount",
               m."residualPct", m."yoyPct", m."longRunPct", m."erraticPct",
               m."baselineAvg", m."peerStationIds", m."yoyChangePct", m."vs2019Pct", m."weekdayAvg", m."weekendAvg"
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS m(
            "stationId" text, "serviceDateMax" text, "lastDayEntries" int, "avg12m" float8, "avg30d" float8,
            "rolling30dAvg" float8, "rolling90dAvg" float8, "dataStatus" text, "ghostScore" int,
            "scoreVersion" int, "tier" text, "rank" int, "rankedCount" int,
            "residualPct" float8, "yoyPct" float8, "longRunPct" float8, "erraticPct" float8,
            "baselineAvg" float8, "peerStationIds" jsonb, "yoyChangePct" float8, "vs2019Pct" float8,
            "weekdayAvg" float8, "weekendAvg" float8
        )
        ON CONFLICT ("stationId") DO UPDATE SET
            "lastDayEntries" = EXCLUDED."lastDayEntries",
            "rolling30dAvg" = EXCLUDED."rolling30dAvg",
            "rolling90dAvg" = EXCLUDED."rolling90dAvg",
            "ghostScore" = EXCLUDED."ghostScore",
            "lastUpdated" = EXCLUDED."lastUpdated",
            "serviceDateMax" = EXCLUDED."serviceDateMax",
            "dataStatus" = EXCLUDED."dataStatus",
            "avg12m" = EXCLUDED."avg12m",
            "avg30d" = EXCLUDED."avg30d",
            "dataThrough" = EXCLUDED."dataThrough",
            "scoreVersion" = EXCLUDED."scoreVersion",
            "tier" = EXCLUDED."tier",
            "rank" = EXCLUDED."rank",
            "rankedCount" = EXCLUDED."rankedCount",
            "residualPct" = EXCLUDED."residualPct",
            "yoyPct" = EXCLUDED."yoyPct",
            "longRunPct" = EXCLUDED."longRunPct",
            "erraticPct" = EXCLUDED."erraticPct",
            "baselineAvg" = EXCLUDED."baselineAvg",
            "peerStationIds" = EXCLUDED."peerStationIds",
            "yoyChangePct" = EXCLUDED."yoyChangePct",
            "vs2019Pct" = EXCLUDED."vs2019Pct",
            "weekdayAvg" = EXCLUDED."weekdayAvg",
            "weekendAvg" = EXCLUDED."weekendAvg"`;
}
