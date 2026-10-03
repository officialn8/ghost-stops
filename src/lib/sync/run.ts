/**
 * One ridership sync, start to finish (R10 to R12; KTD4, KTD5, KTD10). The cron route and the
 * local runner (scripts/run-sync.ts) both call `runSync`.
 *
 * 1. Insert the SyncRun row holding the lease, or record a skipped run and stop.
 * 2. Re-fetch the trailing window (or the runner's --since range) month by month and upsert it.
 * 3. Daily: re-fetch up to three carried drift months. Weekly: reconcile and record drift months.
 * 4. Compute base metrics and station statuses outside any transaction, then write them in one.
 * 5. Finalize the row as ok, partial (data changed before an error), or failed, and release the lease.
 */
import type { PrismaClient, SyncRunStatus } from "@prisma/client";
import { todayInChicago } from "@/lib/cta/closures";
import { computeBaseMetrics, readBaseMetricInputs, storedMaxDate, writeBaseMetrics } from "./baseMetrics";
import { acquireLease, finishRun, latestCompletedRun, type RunOutcome } from "./lease";
import { dedupeDays, matchStations } from "./match";
import { parseDriftMonths, planDriftFetches, reconcileMonths } from "./reconcile";
import type { RidershipSource } from "./socrata";
import { deriveStationStatuses, writeStationStatuses } from "./status";
import { upsertRidership } from "./upsert";
import { monthChunks, monthRange, toUtcDate, trailingWindow, type DateWindow } from "./window";

export type SyncMode = "daily" | "weekly";

export interface SyncOptions {
    /** Recorded on the run: "cron-daily", "cron-weekly", or the local runner's command line. */
    trigger: string;
    mode: SyncMode;
    cityCode?: string;
    /** Local runner: fetch from this date to the anchor instead of the trailing window. */
    since?: string;
    /** Local runner: fetch only these CTA station ids. Drift months are neither fetched nor reconciled. */
    ctaStationIds?: readonly string[];
    /** Epoch ms after which no further drift month is fetched; the window always runs. */
    deadline?: number;
    now?: () => Date;
    /** Progress lines for the local runner, one per fetched range. */
    log?: (message: string) => void;
}

export interface SyncSummary {
    runId: string;
    status: SyncRunStatus;
    window: DateWindow | null;
    upstreamMaxDate: string | null;
    dataThrough: string | null;
    rowsFetched: number;
    rowsInserted: number;
    rowsRevised: number;
    unmatchedStationIds: string[];
    driftMonths: string[];
    durationMs: number;
    error: string | null;
}

/** KTD10: Prisma's 5-second default would fail; the writes are two set-based statements. */
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };
const MAX_ERROR_LENGTH = 2_000;

function errorText(error: unknown): string {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return text.slice(0, MAX_ERROR_LENGTH);
}

export async function runSync(db: PrismaClient, source: RidershipSource, options: SyncOptions): Promise<SyncSummary> {
    const now = options.now ?? (() => new Date());
    const startedAt = now();
    const lease = await acquireLease(db, options.trigger, startedAt);
    const summary: SyncSummary = {
        runId: lease.runId,
        status: "SKIPPED",
        window: null,
        upstreamMaxDate: null,
        dataThrough: null,
        rowsFetched: 0,
        rowsInserted: 0,
        rowsRevised: 0,
        unmatchedStationIds: [],
        driftMonths: [],
        durationMs: 0,
        error: null,
    };
    if (!lease.acquired) return summary;

    const ctaStationIds = options.ctaStationIds?.length ? options.ctaStationIds : undefined;
    const unmatched = new Set<string>();
    let status: RunOutcome["status"];
    try {
        const city = await db.city.findUniqueOrThrow({ where: { code: options.cityCode ?? "chicago" }, select: { id: true } });
        const [stations, previous, upstreamMax, storedMax] = await Promise.all([
            db.station.findMany({ where: { cityId: city.id, ctaStationId: { not: null } }, select: { id: true, ctaStationId: true } }),
            latestCompletedRun(db),
            source.maxDate(),
            storedMaxDate(db, city.id),
        ]);
        const stationIdByCtaId = new Map(stations.map((s) => [s.ctaStationId as string, s.id]));
        summary.driftMonths = previous ? parseDriftMonths(previous.driftMonths) : [];
        const trailing = trailingWindow(upstreamMax, storedMax);
        const window = options.since ? { start: options.since, end: trailing.end } : trailing;
        summary.window = window;
        summary.upstreamMaxDate = upstreamMax;
        await db.syncRun.update({
            where: { id: lease.runId },
            data: {
                windowStart: toUtcDate(window.start),
                windowEnd: toUtcDate(window.end),
                upstreamMaxDate: toUtcDate(upstreamMax),
                driftMonths: summary.driftMonths,
            },
        });

        const syncRange = async (range: DateWindow) => {
            const days = await source.fetchDays(range, ctaStationIds);
            summary.rowsFetched += days.length;
            const matched = matchStations(dedupeDays(days), stationIdByCtaId);
            for (const id of matched.unmatched) unmatched.add(id);
            const counts = await upsertRidership(db, matched.rows);
            summary.rowsInserted += counts.inserted;
            summary.rowsRevised += counts.revised;
            options.log?.(
                `${range.start}..${range.end}: fetched ${days.length}, inserted ${counts.inserted}, revised ${counts.revised}`,
            );
        };

        for (const chunk of monthChunks(window)) await syncRange(chunk);

        if (ctaStationIds === undefined) {
            if (options.mode === "weekly") {
                summary.driftMonths = await reconcileMonths(db, source, city.id, new Set(stationIdByCtaId.keys()));
            } else {
                const plan = planDriftFetches(summary.driftMonths, window);
                const carry = [...plan.carry];
                for (const [i, month] of plan.fetch.entries()) {
                    if (options.deadline !== undefined && now().getTime() > options.deadline) {
                        carry.push(...plan.fetch.slice(i));
                        break;
                    }
                    await syncRange(monthRange(month));
                }
                summary.driftMonths = carry.sort();
            }
        }

        const dataThrough = await storedMaxDate(db, city.id);
        const [inputs, statuses] = await Promise.all([
            dataThrough === null ? [] : readBaseMetricInputs(db, city.id, dataThrough),
            deriveStationStatuses(db, city.id, todayInChicago(now())),
        ]);
        const metrics = computeBaseMetrics(inputs);
        await db.$transaction(async (tx) => {
            if (dataThrough !== null) await writeBaseMetrics(tx, metrics, dataThrough, now());
            await writeStationStatuses(tx, statuses);
        }, TRANSACTION_OPTIONS);

        summary.dataThrough = dataThrough;
        status = "OK";
    } catch (error) {
        status = summary.rowsInserted + summary.rowsRevised > 0 ? "PARTIAL" : "FAILED";
        summary.error = errorText(error);
    }
    summary.status = status;

    summary.unmatchedStationIds = [...unmatched].sort();
    const finishedAt = now();
    summary.durationMs = finishedAt.getTime() - startedAt.getTime();
    await finishRun(db, lease.runId, {
        status,
        finishedAt,
        durationMs: summary.durationMs,
        rowsFetched: summary.rowsFetched,
        rowsInserted: summary.rowsInserted,
        rowsRevised: summary.rowsRevised,
        unmatchedStationIds: summary.unmatchedStationIds,
        driftMonths: summary.driftMonths,
        error: summary.error,
    });
    return summary;
}
