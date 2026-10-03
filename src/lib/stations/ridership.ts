/**
 * The daily rows the station routes read: every station's last week for the list's sparklines,
 * and one station's last 91 days for the detail's chart and its erraticness row. Both are range
 * scans on the RidershipDaily primary key (stationId, serviceDate), never a scan of the table.
 *
 * Server code: the routes call these with the Prisma client. Dates are YYYY-MM-DD (KTD17).
 */
import type { PrismaClient } from "@prisma/client";
import { addDays } from "@/lib/sync/window";
import type { StationSeries, StationSparkline } from "@/types/station";

type RawDb = Pick<PrismaClient, "$queryRaw">;

export const SPARKLINE_DAYS = 7;

/** The v1 chart's range: the station's last date and the 90 days before it. */
export const SERIES_DAYS_BEFORE_END = 90;

export interface SparklineRow {
    stationId: string;
    serviceDate: string;
    entries: number;
}

export interface StationDay {
    serviceDate: string;
    entries: number;
    dayType: string;
}

/**
 * Every station's rows in the seven days ending at its own last service date
 * (StationMetrics.serviceDateMax), so a station that stopped reporting still shows its last week.
 * One statement for the whole city; stations without a metrics row have no data and are skipped.
 */
export function readSparklineRows(db: RawDb, cityId: string): Promise<SparklineRow[]> {
    return db.$queryRaw<SparklineRow[]>`
        SELECT s.id AS "stationId", r."serviceDate"::text AS "serviceDate", r."entries" AS "entries"
        FROM "Station" s
        JOIN "StationMetrics" m ON m."stationId" = s.id
        CROSS JOIN LATERAL (
            SELECT d."serviceDate", d."entries" FROM "RidershipDaily" d
            WHERE d."stationId" = s.id
              AND d."serviceDate" BETWEEN m."serviceDateMax"::date - ${SPARKLINE_DAYS - 1}::int AND m."serviceDateMax"::date
        ) r
        WHERE s."cityId" = ${cityId}
        ORDER BY s.id, r."serviceDate"`;
}

/** The week ending at `end`, one value per day, null for a day with no row. */
export function sparklineFor(end: string, entriesByDate: ReadonlyMap<string, number>): StationSparkline {
    const start = addDays(end, -(SPARKLINE_DAYS - 1));
    const values = Array.from({ length: SPARKLINE_DAYS }, (_, i) => entriesByDate.get(addDays(start, i)) ?? null);
    return { start, end, values };
}

/**
 * One station's rows, oldest first, from 90 days before its last date, or from `alsoFrom` when
 * that is earlier: the score's trailing 90 days end at the city's data-through date, which can
 * trail a station's last row when a run stored rows and then failed before scoring them.
 */
export function readStationDays(db: RawDb, stationId: string, alsoFrom: string | null): Promise<StationDay[]> {
    return db.$queryRaw<StationDay[]>`
        SELECT r."serviceDate"::text AS "serviceDate", r."entries" AS "entries", r."dayType"::text AS "dayType"
        FROM "RidershipDaily" r
        WHERE r."stationId" = ${stationId}
          AND r."serviceDate" >= LEAST(
              (SELECT max(l."serviceDate") FROM "RidershipDaily" l WHERE l."stationId" = ${stationId})
                  - ${SERIES_DAYS_BEFORE_END}::int,
              ${alsoFrom}::date
          )
        ORDER BY r."serviceDate"`;
}

/** Every calendar day from `start` through `end`, with null entries for the days that have no row. */
export function seriesFor(start: string, end: string, days: readonly StationDay[]): StationSeries {
    const byDate = new Map(days.map((d) => [d.serviceDate, d]));
    const out: StationSeries["days"] = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
        const row = byDate.get(date);
        out.push({ date, entries: row?.entries ?? null, dayType: row?.dayType ?? null });
    }
    return { start, end, days: out };
}
