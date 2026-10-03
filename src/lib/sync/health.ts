/**
 * Sync health for /api/health (R13, KTD5). One signal drives the 503, the daily GitHub Actions
 * check that emails Nate, and later the UI's "last refresh" sentence: no successful run in 10
 * days. A run still marked running an hour after it started (killed mid-run) also fails health.
 * The report carries statuses and dates only, never a run's stored error text.
 */
import type { PrismaClient } from "@prisma/client";
import { latestCompletedRun, STALE_RUN_MS } from "./lease";
import { parseDriftMonths } from "./reconcile";
import { toDay } from "./window";

const STALE_AFTER_DAYS = 10;
const DRIFT_BACKLOG_WARNING_MONTHS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HealthInputs {
    lastSuccess: { finishedAt: Date | null; windowEnd: Date | null } | null;
    stuckSince: Date | null;
    latest: { unmatchedStationIds: unknown; driftMonths: unknown } | null;
}

export interface HealthReport {
    status: "ok" | "stale" | "stuck";
    lastSuccessfulRunAt: string | null;
    dataThrough: string | null;
    unmatchedStationIds: string[];
    driftBacklogMonths: number;
    warnings: string[];
}

export async function readHealthInputs(db: Pick<PrismaClient, "syncRun">, now: Date): Promise<HealthInputs> {
    const [lastSuccess, stuck, latest] = await Promise.all([
        db.syncRun.findFirst({
            where: { status: "OK" },
            orderBy: { finishedAt: "desc" },
            select: { finishedAt: true, windowEnd: true },
        }),
        db.syncRun.findFirst({
            where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
            orderBy: { startedAt: "asc" },
            select: { startedAt: true },
        }),
        latestCompletedRun(db),
    ]);
    return { lastSuccess, stuckSince: stuck?.startedAt ?? null, latest };
}

export function assessHealth(inputs: HealthInputs, now: Date): { httpStatus: 200 | 503; report: HealthReport } {
    const finishedAt = inputs.lastSuccess?.finishedAt ?? null;
    const stale = finishedAt === null || now.getTime() - finishedAt.getTime() > STALE_AFTER_DAYS * DAY_MS;
    const status = inputs.stuckSince !== null ? "stuck" : stale ? "stale" : "ok";

    const unmatched = Array.isArray(inputs.latest?.unmatchedStationIds)
        ? inputs.latest.unmatchedStationIds.filter((id): id is string => typeof id === "string")
        : [];
    const backlog = inputs.latest ? parseDriftMonths(inputs.latest.driftMonths).length : 0;
    const warnings: string[] = [];
    if (unmatched.length > 0) warnings.push(`Upstream station ids with no station: ${unmatched.join(", ")}`);
    if (backlog > DRIFT_BACKLOG_WARNING_MONTHS) warnings.push(`Drift backlog of ${backlog} months`);

    return {
        httpStatus: status === "ok" ? 200 : 503,
        report: {
            status,
            lastSuccessfulRunAt: finishedAt?.toISOString() ?? null,
            dataThrough: inputs.lastSuccess?.windowEnd ? toDay(inputs.lastSuccess.windowEnd) : null,
            unmatchedStationIds: unmatched,
            driftBacklogMonths: backlog,
            warnings,
        },
    };
}
