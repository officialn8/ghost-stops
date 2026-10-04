/**
 * Sync health for /api/health (R13, KTD5). Three conditions answer 503, and so fail the daily
 * GitHub Actions check that emails Nate:
 * - stale: no successful run in 10 days. The UI's "last refresh" sentence keys on this same signal.
 * - stuck: a run still marked running an hour after it started (killed mid-run).
 * - reconcile-stale: no successful weekly reconciliation in 15 days (two weekly cycles plus Vercel's
 *   jitter). Daily runs keep succeeding while drift detection (R7) fails, so it needs its own
 *   signal (Nate's decision, 2026-10-03, review finding #5).
 * The report carries statuses and dates only, never a run's stored error text.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { freshnessOf, lastSuccessfulRun, type LastSuccessfulRun } from "./freshness";
import { latestCompletedRun, STALE_RUN_MS } from "./lease";
import { parseDriftMonths } from "./reconcile";
import { olderThanDays, STALE_AFTER_DAYS } from "../staleness";

const RECONCILE_STALE_AFTER_DAYS = 15;
const DRIFT_BACKLOG_WARNING_MONTHS = 12;

/**
 * Runs that reconcile drift: the weekly cron (trigger "cron-weekly", the cron route) and the local
 * runner's --reconcile (its trigger names the flag, scripts/run-sync.ts). SyncRun has no mode
 * column, so the trigger is the discriminator; both strings are pinned by their callers' tests.
 */
const RECONCILE_RUNS = [{ trigger: "cron-weekly" }, { trigger: { contains: "--reconcile" } }];

export interface HealthInputs {
    lastSuccess: LastSuccessfulRun | null;
    lastReconcile: { finishedAt: Date | null } | null;
    stuckSince: Date | null;
    latest: { unmatchedStationIds: unknown; driftMonths: unknown } | null;
    lastUpstreamUpdate: { upstreamUpdatedAt: Date | null } | null;
}

export interface HealthReport {
    status: "ok" | "stale" | "stuck" | "reconcile-stale";
    lastSuccessfulRunAt: string | null;
    lastReconciliationAt: string | null;
    dataThrough: string | null;
    unmatchedStationIds: string[];
    driftBacklogMonths: number;
    /** When CTA last updated the dataset, as the latest run that read the portal's metadata saw it. */
    upstreamUpdatedAt: string | null;
    warnings: string[];
}

export async function readHealthInputs(db: Pick<PrismaClient, "syncRun">, now: Date): Promise<HealthInputs> {
    const [lastSuccess, lastReconcile, stuck, latest, lastUpstreamUpdate] = await Promise.all([
        lastSuccessfulRun(db),
        db.syncRun.findFirst({
            where: { status: "OK", OR: RECONCILE_RUNS },
            orderBy: { finishedAt: "desc" },
            select: { finishedAt: true },
        }),
        db.syncRun.findFirst({
            where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
            orderBy: { startedAt: "asc" },
            select: { startedAt: true },
        }),
        latestCompletedRun(db),
        db.syncRun.findFirst({
            where: { upstreamUpdatedAt: { not: null } },
            orderBy: { startedAt: "desc" },
            select: { upstreamUpdatedAt: true },
        }),
    ]);
    return { lastSuccess, lastReconcile, stuckSince: stuck?.startedAt ?? null, latest, lastUpstreamUpdate };
}

export function assessHealth(inputs: HealthInputs, now: Date): { httpStatus: 200 | 503; report: HealthReport } {
    const olderThan = (date: Date | null, days: number) => olderThanDays(date?.getTime() ?? null, days, now.getTime());
    const finishedAt = inputs.lastSuccess?.finishedAt ?? null;
    const reconciledAt = inputs.lastReconcile?.finishedAt ?? null;
    let status: HealthReport["status"] = "ok";
    if (inputs.stuckSince !== null) status = "stuck";
    else if (olderThan(finishedAt, STALE_AFTER_DAYS)) status = "stale";
    else if (olderThan(reconciledAt, RECONCILE_STALE_AFTER_DAYS)) status = "reconcile-stale";

    const unmatched = Array.isArray(inputs.latest?.unmatchedStationIds)
        ? inputs.latest.unmatchedStationIds.filter((id): id is string => typeof id === "string")
        : [];
    const backlog = inputs.latest ? parseDriftMonths(inputs.latest.driftMonths).length : 0;
    // The same formatting the station routes use, so the three report one data-through date.
    const freshness = freshnessOf(inputs.lastSuccess);
    const warnings: string[] = [];
    if (unmatched.length > 0) warnings.push(`Upstream station ids with no station: ${unmatched.join(", ")}`);
    if (backlog > DRIFT_BACKLOG_WARNING_MONTHS) warnings.push(`Drift backlog of ${backlog} months`);

    return {
        httpStatus: status === "ok" ? 200 : 503,
        report: {
            status,
            lastSuccessfulRunAt: freshness.lastSuccessfulFetch,
            lastReconciliationAt: reconciledAt?.toISOString() ?? null,
            dataThrough: freshness.dataThrough,
            unmatchedStationIds: unmatched,
            driftBacklogMonths: backlog,
            upstreamUpdatedAt: inputs.lastUpstreamUpdate?.upstreamUpdatedAt?.toISOString() ?? null,
            warnings,
        },
    };
}
