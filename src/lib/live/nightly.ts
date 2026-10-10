/**
 * What happens when a service day closes (KTD2, KTD6, KTD7, KTD8; U8): the day's schedule is the
 * version in force when it closed; the tracker and the schedule reduce to rows; the rows land in
 * one transaction; the site is asked to refresh its cache; the raw parts compact into the day
 * object and its path is recorded. A crash between the write and the compaction leaves the
 * checkpoint's reduction state half done, and `finishDay` completes it at the next start, as it
 * does a day whose last raw part was still on disk when it closed. A write the database refuses
 * (the roster and the station table disagree) lands no row: the fail URL is posted, the raw day
 * is still compacted, and the day waits for an operator's re-reduce. Gap days (service days with
 * no row between the last row and the latest closed day) get set-aside rows so the readers can
 * name them; a day the worker watched, whose tracker it serialized, is never a gap.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { closuresFor, deriveStatus } from "@/lib/cta/closures";
import { addDays, optionalDay, toUtcDate } from "@/lib/sync/window";
import type { Healthchecks } from "./healthchecks";
import { dayStateKey, type DayReduction } from "./loop";
import { GHOST_TOLERANCE_MINUTES } from "./matcher";
import type { ObjectStore } from "./objectStore";
import { compactDay } from "./rawStore";
import { reduceDay, type ReducedDay } from "./reduce";
import { postRevalidate, type RevalidateFetch } from "./revalidate";
import { scheduledStopsFor, type DaySchedule } from "./schedule";
import { loadSchedule, readScheduleIndex, versionInForce } from "./scheduleArchive";
import { dayCloseInstant, latestClosedServiceDay } from "./serviceDay";
import type { TrackerState } from "./tracker";
import { gapDay, recordRawPath, writeDay, WriteDayRefused } from "./writeDay";

export type NightlyDb = Pick<PrismaClient, "$transaction" | "city" | "liveDay">;

export interface NightlyDeps {
    db: NightlyDb;
    store: ObjectStore;
    /** Every roster station id; closures decide which are closed on the day. */
    stationIds: readonly string[];
    /** The site to revalidate; null skips the call (a local run). */
    site: { url: string; secret: string } | null;
    healthchecks?: Healthchecks | null;
    toleranceMinutes?: number;
    /** The city whose stations the rows are written for; "chicago" unless a test says otherwise. */
    cityCode?: string;
    now?: () => Date;
    log?: (message: string) => void;
    fetch?: RevalidateFetch;
    sleep?: (ms: number) => Promise<void>;
}

/** The schedule in force for a day: the newest version first seen before the day closed (KTD6). */
export async function scheduleInForce(store: ObjectStore, serviceDate: string, toleranceMinutes = GHOST_TOLERANCE_MINUTES, hash?: string | null): Promise<DaySchedule | null> {
    const chosen = hash ?? versionInForce(await readScheduleIndex(store), dayCloseInstant(serviceDate, toleranceMinutes))?.hash ?? null;
    if (chosen === null) return null;
    const schedule = await loadSchedule(store, chosen);
    return schedule === null ? null : scheduledStopsFor(schedule, serviceDate);
}

/** Whether a roster station is open on a calendar date, by the closure table (R18). */
export function isOpenOn(ctaStationId: string, date: string): boolean {
    return deriveStatus(closuresFor(ctaStationId), date).status === "ACTIVE";
}

export function closedStationsOn(stationIds: readonly string[], serviceDate: string): Set<string> {
    return new Set(stationIds.filter((id) => !isOpenOn(id, serviceDate)));
}

/** Reduces a closed day and writes it; returns the rows and whether the write landed. */
export async function reduceAndWrite(deps: NightlyDeps, tracker: TrackerState, options: { quotaStopped: boolean; scheduleHash?: string | null }): Promise<{ reduced: ReducedDay; written: boolean }> {
    const log = deps.log ?? (() => {});
    const now = deps.now ?? (() => new Date());
    const schedule = await scheduleInForce(deps.store, tracker.serviceDate, deps.toleranceMinutes, options.scheduleHash);
    const reduced = reduceDay({
        serviceDate: tracker.serviceDate,
        tracker,
        schedule,
        stationIds: deps.stationIds,
        closedStationIds: closedStationsOn(deps.stationIds, tracker.serviceDate),
        quotaStopped: options.quotaStopped,
        toleranceMinutes: deps.toleranceMinutes,
        reducedAt: now(),
    });
    const counted = reduced.stations.filter((s) => s.counted).length;
    const ghosts = reduced.stations.reduce((sum, s) => sum + s.ghosts, 0);
    try {
        const result = await writeDay(deps.db, reduced.day, reduced.stations, { cityCode: deps.cityCode });
        log(`${tracker.serviceDate} reduced: ${reduced.day.verdict}${reduced.day.cause ? ` (${reduced.day.cause})` : ""}, coverage ${Math.round(reduced.day.coverage * 100)}%, ${counted} of ${reduced.stations.length} stations counted, ${ghosts} ghosts${result.replaced ? ", replaced" : ""}`);
    } catch (error) {
        if (error instanceof WriteDayRefused) {
            if (error.reason === "newer-reducer") {
                log(`${tracker.serviceDate} not written: ${error.message}`);
            } else {
                // The roster and the station table disagree: no row lands, and the day waits for a re-reduce.
                log(`${tracker.serviceDate} not written: ${error.message}; once the roster and the database agree, run: npx tsx scripts/live-rereduce.ts --date ${tracker.serviceDate}`);
                await deps.healthchecks?.fail();
            }
            return { reduced, written: false };
        }
        throw error;
    }
    if (reduced.day.cause === "feed-shape") await deps.healthchecks?.fail();
    return { reduced, written: true };
}

/**
 * The steps after the write, the cache refresh and the compaction, run side by side and recorded
 * on the result. With `compact: false` (a raw part of the day is still on disk) the compaction is
 * left for a later call and reported as not done. A day with no row (`reduced` false) is compacted
 * all the same; its path is recorded when the row arrives.
 */
export async function finishDay(deps: NightlyDeps, day: DayReduction, options: { compact?: boolean } = {}): Promise<DayReduction> {
    const log = deps.log ?? (() => {});
    const revalidate = async (): Promise<boolean> => {
        if (day.revalidated || deps.site === null) return true;
        const result = await postRevalidate({ siteUrl: deps.site.url, secret: deps.site.secret, fetch: deps.fetch, sleep: deps.sleep, log });
        return result.ok;
    };
    const compact = async (): Promise<boolean> => {
        if (day.compacted) return true;
        if (options.compact === false) return false;
        const result = await compactDay(deps.store, day.serviceDate);
        if (result.status === "no-parts") {
            log(`${day.serviceDate} has no raw parts to compact`);
        } else {
            if (day.reduced) await recordRawPath(deps.db, day.serviceDate, result.key, result.bytes);
            log(`${day.serviceDate} raw day ${result.status}: ${result.key}, ${result.bytes} bytes${day.reduced ? "" : " (no row to record it on)"}`);
        }
        return true;
    };
    const [revalidated, compacted] = await Promise.all([revalidate(), compact()]);
    return { ...day, revalidated, compacted };
}

/**
 * The whole close: reduce, write, revalidate, compact. The loop's `onDayClose`; `compact` is
 * false when the loop could not upload the day's last raw part, and the loop calls `finishDay`
 * once it has.
 */
export async function closeDay(deps: NightlyDeps, tracker: TrackerState, options: { quotaStopped: boolean; compact?: boolean }): Promise<DayReduction> {
    const { written } = await reduceAndWrite(deps, tracker, { quotaStopped: options.quotaStopped });
    const finish = { compact: options.compact };
    if (!written) return finishDay(deps, { serviceDate: tracker.serviceDate, reduced: false, revalidated: true, compacted: false }, finish);
    return finishDay(deps, { serviceDate: tracker.serviceDate, reduced: true, revalidated: false, compacted: false }, finish);
}

/**
 * Set-aside rows for every service day after the last row up to the latest closed day (KTD7). A
 * day whose serialized tracker is in the store was watched, so its missing row is a refused
 * write, not a gap: it is left for the re-reduce and said so.
 */
export async function fillGapDays(deps: NightlyDeps, nowEpochMs: number): Promise<string[]> {
    const log = deps.log ?? (() => {});
    const latest = await deps.db.liveDay.findFirst({ orderBy: { serviceDate: "desc" }, select: { serviceDate: true } });
    const last = optionalDay(latest?.serviceDate);
    if (last === null) return [];
    const through = latestClosedServiceDay(nowEpochMs, deps.toleranceMinutes ?? GHOST_TOLERANCE_MINUTES);
    const written: string[] = [];
    for (let date = addDays(last, 1); date <= through; date = addDays(date, 1)) {
        const existing = await deps.db.liveDay.findUnique({ where: { serviceDate: toUtcDate(date) }, select: { serviceDate: true } });
        if (existing !== null) continue;
        if ((await deps.store.head(dayStateKey(date))) !== null) {
            log(`${date} was watched but not written; no gap row: npx tsx scripts/live-rereduce.ts --date ${date}`);
            continue;
        }
        await writeDay(deps.db, gapDay(date, (deps.now ?? (() => new Date()))()), null, { cityCode: deps.cityCode });
        written.push(date);
    }
    if (written.length > 0) log(`gap days recorded as set aside: ${written.join(", ")}`);
    return written;
}
