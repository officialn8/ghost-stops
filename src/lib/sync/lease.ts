/**
 * One sync at a time (R11, KTD5). A run inserts its SyncRun row as RUNNING holding the constant
 * lease value; `lease` is unique and nullable, so only one row can hold it while finished rows
 * hold null. A run that dies without finishing (the function is killed at 300 seconds) is
 * expired by the next run after an hour.
 */
import { Prisma, type PrismaClient, type SyncRunStatus } from "@prisma/client";

export const SYNC_LEASE = "ridership-sync";
export const STALE_RUN_MS = 60 * 60 * 1000;

export type LeaseResult = { acquired: true; runId: string } | { acquired: false; runId: string };

type Db = Pick<PrismaClient, "syncRun">;

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Expires a stale running row, then inserts this run's row holding the lease. When another run
 * holds it, records a SKIPPED run instead and returns `acquired: false`.
 */
export async function acquireLease(db: Db, trigger: string, now: Date): Promise<LeaseResult> {
    await db.syncRun.updateMany({
        where: { lease: SYNC_LEASE, startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
        data: {
            lease: null,
            status: "FAILED",
            finishedAt: now,
            error: "Expired: still running an hour after it started",
        },
    });

    try {
        const run = await db.syncRun.create({
            data: { trigger, status: "RUNNING", lease: SYNC_LEASE, startedAt: now },
        });
        return { acquired: true, runId: run.id };
    } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const run = await db.syncRun.create({
            data: { trigger, status: "SKIPPED", startedAt: now, finishedAt: now, durationMs: 0 },
        });
        return { acquired: false, runId: run.id };
    }
}

export interface RunOutcome {
    status: Exclude<SyncRunStatus, "RUNNING" | "SKIPPED">;
    finishedAt: Date;
    rowsFetched: number;
    rowsInserted: number;
    rowsRevised: number;
    unmatchedStationIds: string[];
    driftMonths: string[];
    error: string | null;
}

/** Finalizes the run's row and releases the lease. */
export async function finishRun(db: Db, runId: string, outcome: RunOutcome): Promise<void> {
    const run = await db.syncRun.findUniqueOrThrow({ where: { id: runId }, select: { startedAt: true } });
    await db.syncRun.update({
        where: { id: runId },
        data: {
            ...outcome,
            lease: null,
            durationMs: outcome.finishedAt.getTime() - run.startedAt.getTime(),
        },
    });
}
