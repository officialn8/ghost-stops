/**
 * One sync at a time (R11, KTD5). A run inserts its SyncRun row as RUNNING holding the constant
 * lease value; `lease` is unique and nullable, so only one row can hold it while finished rows
 * hold null. A run that dies without finishing (the function is killed at 300 seconds) is
 * expired by the next run after an hour.
 */
import { Prisma, type PrismaClient, type SyncRunStatus } from "@/generated/prisma/client";

export const SYNC_LEASE = "ridership-sync";
export const STALE_RUN_MS = 60 * 60 * 1000;

export interface LeaseResult {
    acquired: boolean;
    runId: string;
}

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
    durationMs: number;
    rowsFetched: number;
    rowsInserted: number;
    rowsRevised: number;
    unmatchedStationIds: string[];
    driftMonths: string[];
    error: string | null;
}

/** Finalizes the run's row and releases the lease. */
export async function finishRun(db: Db, runId: string, outcome: RunOutcome): Promise<void> {
    await db.syncRun.update({ where: { id: runId }, data: { ...outcome, lease: null } });
}

/**
 * The latest run that got past its start: the source of the drift backlog a daily run carries and
 * of the health warnings. A failed run changed no data, so the state before it still stands.
 */
export async function latestCompletedRun(db: Db) {
    return db.syncRun.findFirst({
        where: { status: { in: ["OK", "PARTIAL"] } },
        orderBy: { startedAt: "desc" },
        select: { unmatchedStationIds: true, driftMonths: true },
    });
}
