/**
 * The nightly write (R13; KTD7): one LiveDay row and one LiveStationDay row per roster station,
 * in one transaction, delete then insert, so a day is either wholly stored or not at all. The
 * write refuses to replace a row reduced under a newer reducer version, and refuses a station set
 * that does not cover every station the city has, so a half-built day never lands.
 *
 * The worker's gap filling uses the same write with a set-aside day and no station rows.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { toUtcDate } from "@/lib/sync/window";
import { REDUCER_VERSION, type LiveDayRow, type LiveStationDayRow } from "./reduce";
import { expectedPolls } from "./serviceDay";

export type WriteDayRefusal = "newer-reducer" | "station-count" | "unknown-station";

export class WriteDayRefused extends Error {
    override name = "WriteDayRefused";
    constructor(
        readonly reason: WriteDayRefusal,
        message: string,
    ) {
        super(message);
    }
}

export interface WriteDayResult {
    serviceDate: string;
    stations: number;
    /** A row for the day existed and was replaced. */
    replaced: boolean;
}

type Db = Pick<PrismaClient, "$transaction" | "city">;

/** The sync's transaction settings (src/lib/sync/run.ts): a handful of set-based statements, never Prisma's 5-second default. */
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

export async function writeDay(
    db: Db,
    day: LiveDayRow,
    stations: readonly LiveStationDayRow[] | null,
    options: { cityCode?: string } = {},
): Promise<WriteDayResult> {
    const city = await db.city.findUniqueOrThrow({ where: { code: options.cityCode ?? "chicago" }, select: { id: true } });
    const serviceDate = toUtcDate(day.serviceDate);
    return db.$transaction(async (tx) => {
        const existing = await tx.liveDay.findUnique({ where: { serviceDate }, select: { reducerVersion: true } });
        if (existing !== null && existing.reducerVersion > day.reducerVersion) {
            throw new WriteDayRefused("newer-reducer", `${day.serviceDate} is stored under reducer version ${existing.reducerVersion}, newer than ${day.reducerVersion}`);
        }

        let rows: { stationId: string; row: LiveStationDayRow }[] = [];
        if (stations !== null) {
            const known = await tx.station.findMany({ where: { cityId: city.id, ctaStationId: { not: null } }, select: { id: true, ctaStationId: true } });
            const idOf = new Map(known.map((s) => [s.ctaStationId as string, s.id]));
            const unknown = stations.filter((s) => !idOf.has(s.ctaStationId)).map((s) => s.ctaStationId);
            if (unknown.length > 0) throw new WriteDayRefused("unknown-station", `no station for CTA id ${unknown.sort().join(", ")}`);
            const distinct = new Set(stations.map((s) => s.ctaStationId));
            if (distinct.size !== known.length || distinct.size !== stations.length) {
                throw new WriteDayRefused("station-count", `${day.serviceDate} has ${distinct.size} station rows for ${known.length} stations`);
            }
            rows = stations.map((row) => ({ stationId: idOf.get(row.ctaStationId) as string, row }));
        }

        if (existing !== null) await tx.liveDay.delete({ where: { serviceDate } });
        await tx.liveDay.create({
            data: {
                serviceDate,
                verdict: day.verdict,
                cause: day.cause,
                pollsExpected: day.pollsExpected,
                pollsSucceeded: day.pollsSucceeded,
                coverage: day.coverage,
                faultLines: day.faultLines,
                scheduleVersion: day.scheduleVersion,
                reducerVersion: day.reducerVersion,
                reducedAt: day.reducedAt,
            },
        });
        if (rows.length > 0) {
            await tx.liveStationDay.createMany({
                data: rows.map(({ stationId, row }) => ({
                    stationId,
                    serviceDate,
                    scheduled: row.scheduled,
                    fulfilled: row.fulfilled,
                    cancelled: row.cancelled,
                    ghosts: row.ghosts,
                    unknown: row.unknown,
                    unobserved: row.unobserved,
                    unmapped: row.unmapped,
                    coverage: row.coverage,
                    counted: row.counted,
                    notCountedCause: row.notCountedCause,
                    observedGapMin: row.observedGapMin,
                    scheduledGapMin: row.scheduledGapMin,
                    // Plain numbers, strings, and nulls; Prisma's Json input type has no index signature for the interface.
                    byDirection: row.byDirection as unknown as Prisma.InputJsonValue,
                })),
            });
        }
        return { serviceDate: day.serviceDate, stations: rows.length, replaced: existing !== null };
    }, TRANSACTION_OPTIONS);
}

/** A set-aside site-gap day with no station rows: the record of a day the worker did not watch (KTD7). */
export function gapDay(serviceDate: string, reducedAt: Date): LiveDayRow {
    return {
        serviceDate,
        verdict: "SET_ASIDE",
        cause: "site-gap",
        pollsExpected: expectedPolls(serviceDate),
        pollsSucceeded: 0,
        coverage: 0,
        faultLines: [],
        scheduleVersion: null,
        reducerVersion: REDUCER_VERSION,
        reducedAt,
    };
}

/** Records the day's compacted raw object once compaction has run. */
export async function recordRawPath(db: Pick<PrismaClient, "liveDay">, serviceDate: string, rawPath: string, rawBytes: number): Promise<void> {
    await db.liveDay.update({ where: { serviceDate: toUtcDate(serviceDate) }, data: { rawPath, rawBytes } });
}
