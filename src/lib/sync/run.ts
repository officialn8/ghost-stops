/**
 * One ridership sync, start to finish (R10 to R12; KTD4, KTD5, KTD10). The cron route and the
 * local runner (scripts/run-sync.ts) both call `runSync`.
 *
 * 1. Insert the SyncRun row holding the lease, or record a skipped run and stop.
 * 2. Re-fetch the trailing window (or the runner's --since range) month by month and upsert it.
 * 3. Daily: re-fetch up to three carried drift months. Weekly: reconcile and record drift months.
 * 4. Read the station statuses, the metric inputs, and the narrative inputs together; then compute
 *    score v2 and the narratives from the scores, outside any transaction, and write them in one,
 *    so a scoring failure leaves the previous run's metrics in place. A narrative failure, in its
 *    read or its generation, does not hold back the metrics (KTD11).
 * 5. Finalize the row as ok, partial (data changed before an error, or the narratives failed), or
 *    failed, and release the lease.
 */
import type { PrismaClient, SyncRunStatus } from "@prisma/client";
import { todayInChicago } from "@/lib/cta/closures";
import {
    generateNarratives,
    readNarrativeStations,
    writeStationNarratives,
    type NarrativeRow,
    type NarrativeStationInput,
    type NarrativeStationRecord,
} from "@/lib/narratives/generate";
import type { NeighborClosureReason } from "@/lib/scoring/availability";
import { summarizeWindow } from "@/lib/scoring/components";
import { scoreColumns, scoreStations, smallStationBadge, type StationScoreInput } from "@/lib/scoring/score";
import { readScoreWindows } from "@/lib/scoring/windows";
import type { NarrativeNearbyClosure } from "@/types/narrative";
import {
    computeBaseMetrics,
    isRanked,
    readBaseMetricInputs,
    storedMaxDate,
    writeStationMetrics,
    type StationMetricsRow,
} from "./baseMetrics";
import { acquireLease, finishRun, latestCompletedRun, type RunOutcome } from "./lease";
import { dedupeDays, matchStations } from "./match";
import { parseDriftMonths, planDriftFetches, reconcileMonths } from "./reconcile";
import type { RidershipSource } from "./socrata";
import { deriveStationStatuses, writeStationStatuses, type StationStatusRow } from "./status";
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
    /** Progress lines, one per fetched range, and one per rejected narrative naming its station. */
    log?: (message: string) => void;
    /** Stands in for score v2's computation; tests pass one that throws. */
    scoreStations?: typeof scoreStations;
    /** Stands in for narrative generation; tests pass one that throws or rejects. */
    generateNarratives?: typeof generateNarratives;
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
    /** Narratives written this run, and those refused for citing a fact their station lacks. */
    narrativesWritten: number;
    narrativesRejected: number;
    durationMs: number;
    error: string | null;
}

/**
 * A station's metrics row as scoring computed it, with one thing the row does not store: the
 * closure next door that set its year-over-year aside, if one did, which the narrative mentions.
 * The metrics write names its columns (`jsonb_to_recordset`), so it ignores the extra field.
 */
export type ComputedStationMetrics = StationMetricsRow & { yoyNeighborClosure: NeighborClosureReason | null };

/**
 * Every station's metrics row for `dataThrough`: base metrics and score v2, computed from reads
 * alone. Stations with no ridership at all get no row. `statuses` are this run's derived statuses,
 * which decide who is ranked; a run passes their pending read, so it overlaps the metric reads.
 */
export async function computeStationMetrics(
    db: Pick<PrismaClient, "$queryRaw" | "station">,
    cityId: string,
    dataThrough: string,
    statuses: readonly StationStatusRow[] | Promise<readonly StationStatusRow[]>,
    score: typeof scoreStations = scoreStations,
): Promise<ComputedStationMetrics[]> {
    const [inputs, windows, statusRows] = await Promise.all([
        readBaseMetricInputs(db, cityId, dataThrough),
        readScoreWindows(db, cityId, dataThrough),
        statuses,
    ]);
    const metrics = computeBaseMetrics(inputs);
    const statusById = new Map(statusRows.map((s) => [s.stationId, s.status]));
    const windowsById = new Map(windows.map((w) => [w.stationId, w]));
    const scoreInputs = metrics.map((m): StationScoreInput => {
        const w = windowsById.get(m.stationId);
        const status = statusById.get(m.stationId);
        if (!w || !status) throw new Error(`Station ${m.stationId} has metrics but no score inputs or status`);
        return {
            stationId: m.stationId,
            ctaStationId: w.ctaStationId,
            status,
            dataStatus: m.dataStatus,
            openedAt: w.openedAt,
            closures: w.closures,
            avg12m: m.avg12m,
            avg2019: w.avg2019,
            trailing: summarizeWindow(w.trailing),
            yearAgo: summarizeWindow(w.yearAgo),
        };
    });
    const scores = new Map(score(dataThrough, scoreInputs).map((s) => [s.stationId, s]));
    return metrics.map((m) => {
        const s = scores.get(m.stationId);
        if (!s) throw new Error(`Scoring returned no score for station ${m.stationId}`);
        const yoyReason = s.components.yoy.nullReason;
        return { ...m, ...scoreColumns(s), yoyNeighborClosure: yoyReason?.kind === "neighbor-closure" ? yoyReason : null };
    });
}

/**
 * The narrative job's input for every station with metrics: score v2's numbers handed over as
 * plain data, so neither scoring nor narratives imports the other (KTD21), with the station's
 * facts, its closures, this run's status, and the closure next door, named, that set its
 * year-over-year aside. A neighbor with no record (none in the city) leaves that unsaid.
 */
export function narrativeInputs(
    stations: readonly NarrativeStationRecord[],
    metrics: readonly ComputedStationMetrics[],
    statuses: readonly StationStatusRow[],
): NarrativeStationInput[] {
    const stationById = new Map(stations.map((s) => [s.stationId, s]));
    const statusById = new Map(statuses.map((s) => [s.stationId, s]));
    const nameByCtaId = new Map(stations.flatMap((s) => (s.ctaStationId === null ? [] : [[s.ctaStationId, s.name] as const])));
    const nearbyClosure = ({ yoyNeighborClosure: reason }: ComputedStationMetrics): NarrativeNearbyClosure | null => {
        const stationName = reason && nameByCtaId.get(reason.neighborCtaStationId);
        return reason && stationName ? { stationName, change: reason.change, date: reason.date } : null;
    };
    return metrics.map((m) => {
        const station = stationById.get(m.stationId);
        const status = statusById.get(m.stationId);
        if (!station || !status) throw new Error(`Station ${m.stationId} has metrics but no narrative inputs or status`);
        return {
            stationId: m.stationId,
            ctaStationId: station.ctaStationId,
            name: station.name,
            status: status.status,
            openedAt: station.openedAt,
            ranked: isRanked(status.status, m.dataStatus),
            tier: m.tier,
            badge: smallStationBadge(m),
            avg12m: m.avg12m,
            yoyChangePct: m.yoyChangePct,
            vs2019Pct: m.vs2019Pct,
            closure: status.closedAt === null ? null : (station.closures.find((c) => c.startDate === status.closedAt) ?? null),
            nearbyClosure: nearbyClosure(m),
            facts: station.facts,
        };
    });
}

/** KTD10: Prisma's 5-second default would fail; the writes are three set-based statements. */
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
        narrativesWritten: 0,
        narrativesRejected: 0,
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
        // The status, metric, and narrative reads are independent, so they run together; scoring and
        // narrative generation (CPU only) follow. A failed status or metric read aborts the run
        // before any write. A failed narrative read becomes the narrative error when awaited below;
        // it is marked handled now because it may fail while the metric reads are still running.
        const statusesRead = deriveStationStatuses(db, city.id, todayInChicago(now()));
        const narrativeStationsRead: Promise<NarrativeStationRecord[]> =
            dataThrough === null ? Promise.resolve([]) : readNarrativeStations(db, city.id);
        narrativeStationsRead.catch(() => {});
        const metrics =
            dataThrough === null
                ? []
                : await computeStationMetrics(db, city.id, dataThrough, statusesRead, options.scoreStations);
        const statuses = await statusesRead;

        // Narratives follow scoring and quote its numbers (KTD11). If reading their inputs or
        // generating them fails, the fresh metrics and statuses are still written and the run ends
        // partial; the detail route withholds any story whose data-through date no longer matches
        // the metrics (U14).
        let narratives: NarrativeRow[] = [];
        let narrativeError: unknown = null;
        if (dataThrough !== null) {
            try {
                const generate = options.generateNarratives ?? generateNarratives;
                const narrativeStations = await narrativeStationsRead;
                const generated = generate(narrativeInputs(narrativeStations, metrics, statuses), dataThrough);
                narratives = generated.rows;
                summary.narrativesRejected = generated.rejected.length;
                for (const r of generated.rejected) {
                    options.log?.(`narrative rejected for station ${r.stationId} (${r.archetypeKey}): missing ${r.missing.join(", ")}`);
                }
            } catch (error) {
                narratives = [];
                narrativeError = error;
            }
        }

        const writtenAt = now();
        await db.$transaction(async (tx) => {
            if (dataThrough !== null) {
                await writeStationMetrics(tx, metrics, dataThrough, writtenAt);
                if (narratives.length > 0) await writeStationNarratives(tx, narratives, dataThrough, writtenAt);
            }
            await writeStationStatuses(tx, statuses);
        }, TRANSACTION_OPTIONS);

        summary.dataThrough = dataThrough;
        summary.narrativesWritten = narratives.length;
        if (narrativeError === null) {
            status = "OK";
        } else {
            status = "PARTIAL";
            summary.error = errorText(narrativeError);
        }
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
