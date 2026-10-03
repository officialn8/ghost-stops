/**
 * How fresh the data is, from the latest successful sync run (R13, KTD14): its window end is the
 * data-through date, its finish time the last successful fetch. The station list, the station
 * detail, and /api/health all read it here, so the three can never disagree.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { Freshness } from "@/types/station";
import { optionalDay } from "./window";

export interface LastSuccessfulRun {
    finishedAt: Date | null;
    windowEnd: Date | null;
}

/** The OK run that finished last; null before any run has succeeded. */
export function lastSuccessfulRun(db: Pick<PrismaClient, "syncRun">): Promise<LastSuccessfulRun | null> {
    return db.syncRun.findFirst({
        where: { status: "OK" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true, windowEnd: true },
    });
}

/** The data-through date as YYYY-MM-DD (KTD17) and the finish time as an ISO timestamp. */
export function freshnessOf(run: LastSuccessfulRun | null): Freshness {
    return {
        dataThrough: optionalDay(run?.windowEnd),
        lastSuccessfulFetch: run?.finishedAt?.toISOString() ?? null,
    };
}

export async function readFreshness(db: Pick<PrismaClient, "syncRun">): Promise<Freshness> {
    return freshnessOf(await lastSuccessfulRun(db));
}
