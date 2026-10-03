/**
 * The date windows score v2 reads (docs/audit-2026-10-02/ghost-score.md section 5.2), all inclusive
 * calendar days ending at the city's data-through date D, and the one query that reads them.
 *
 * - 12 months: after D minus one year, through D. The same window as the base metrics' avg12m,
 *   so the ledger's number is the residual's number (R25).
 * - Trailing 90 days: D - 89 through D, and the same calendar days one year earlier, for the
 *   year-over-year change and the erraticness.
 * - 2019: the pre-pandemic year the long-run change compares against.
 */
import type { PrismaClient } from "@prisma/client";
import { addDays, toDay, toUtcDate, type DateWindow } from "@/lib/sync/window";
import type { ClosureRange } from "./availability";
import type { DayRow } from "./components";

export type ComponentKey = "residual" | "yoy" | "longRun" | "erratic";
export const COMPONENT_KEYS: readonly ComponentKey[] = ["residual", "yoy", "longRun", "erratic"];

export interface ScoreWindowSet {
    twelveMonth: DateWindow;
    trailing90: DateWindow;
    yearAgo90: DateWindow;
    year2019: DateWindow;
}

const TRAILING_DAYS = 90;
export const YEAR_2019: DateWindow = { start: "2019-01-01", end: "2019-12-31" };

/**
 * Moves a date by whole years. 29 February becomes the 28th in a common year, which is what
 * Postgres does for `date - interval '1 year'`, the base metrics' 12-month window edge.
 */
export function addYears(date: string, years: number): string {
    const d = toUtcDate(date);
    const year = d.getUTCFullYear() + years;
    const month = d.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return toDay(new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay))));
}

export function scoreWindows(dataThrough: string): ScoreWindowSet {
    const trailingStart = addDays(dataThrough, -(TRAILING_DAYS - 1));
    return {
        twelveMonth: { start: addDays(addYears(dataThrough, -1), 1), end: dataThrough },
        trailing90: { start: trailingStart, end: dataThrough },
        yearAgo90: { start: addYears(trailingStart, -1), end: addYears(dataThrough, -1) },
        year2019: YEAR_2019,
    };
}

/** The windows a component reads; a closure or an opening inside any of them leaves it null. */
export function componentWindows(component: ComponentKey, dataThrough: string): DateWindow[] {
    const w = scoreWindows(dataThrough);
    switch (component) {
        case "residual":
            return [w.twelveMonth];
        case "yoy":
            return [w.trailing90, w.yearAgo90];
        case "longRun":
            return [w.twelveMonth, w.year2019];
        case "erratic":
            return [w.trailing90];
    }
}

/** What one station's score needs from the database, besides its base metrics. */
export interface StationWindowRows {
    stationId: string;
    ctaStationId: string | null;
    openedAt: string | null;
    closures: ClosureRange[];
    trailing: DayRow[];
    yearAgo: DayRow[];
    avg2019: number | null;
}

type ScoreDb = Pick<PrismaClient, "$queryRaw" | "station">;

/**
 * Reads every station's two 90-day windows as daily rows and its 2019 average, in one query whose
 * per-station subqueries are range scans on the (stationId, serviceDate) primary key, plus the
 * stations' opening dates and closures. About 180 rows a station; nothing is written.
 */
export async function readScoreWindows(db: ScoreDb, cityId: string, dataThrough: string): Promise<StationWindowRows[]> {
    const { trailing90, yearAgo90 } = scoreWindows(dataThrough);
    const [windows, stations] = await Promise.all([
        db.$queryRaw<{ stationId: string; days: [string, number, string][]; avg2019: number | null }[]>`
            SELECT s.id AS "stationId", d.days AS "days", y.avg2019 AS "avg2019"
            FROM "Station" s
            CROSS JOIN LATERAL (
                SELECT coalesce(
                    json_agg(json_build_array(r."serviceDate"::text, r."entries", r."dayType") ORDER BY r."serviceDate"),
                    '[]'::json
                ) AS days
                FROM "RidershipDaily" r
                WHERE r."stationId" = s.id
                  AND (r."serviceDate" BETWEEN ${yearAgo90.start}::date AND ${yearAgo90.end}::date
                    OR r."serviceDate" BETWEEN ${trailing90.start}::date AND ${trailing90.end}::date)
            ) d
            CROSS JOIN LATERAL (
                SELECT avg(r."entries")::float8 AS avg2019
                FROM "RidershipDaily" r
                WHERE r."stationId" = s.id
                  AND r."serviceDate" BETWEEN ${YEAR_2019.start}::date AND ${YEAR_2019.end}::date
            ) y
            WHERE s."cityId" = ${cityId}`,
        db.station.findMany({
            where: { cityId },
            select: { id: true, ctaStationId: true, openedAt: true, closures: { select: { startDate: true, endDate: true } } },
        }),
    ]);

    const byId = new Map(windows.map((w) => [w.stationId, w]));
    return stations.map((station) => {
        const w = byId.get(station.id);
        const days: DayRow[] = (w?.days ?? []).map(([serviceDate, entries, dayType]) => ({ serviceDate, entries, dayType }));
        return {
            stationId: station.id,
            ctaStationId: station.ctaStationId,
            openedAt: station.openedAt === null ? null : toDay(station.openedAt),
            closures: station.closures.map((c) => ({
                startDate: toDay(c.startDate),
                endDate: c.endDate === null ? null : toDay(c.endDate),
            })),
            trailing: days.filter((d) => d.serviceDate >= trailing90.start),
            yearAgo: days.filter((d) => d.serviceDate <= yearAgo90.end),
            avg2019: w?.avg2019 ?? null,
        };
    });
}
