/**
 * The worker's always-on loop (R12, R13, R15; KTD2, KTD4, KTD5, KTD14, KTD16): a drift-free
 * one-minute tick that polls positions and sweeps every station's arrivals, feeds the slot
 * tracker, checkpoints the open day to the object store, pings the dead-man's switch, and closes
 * each service day at its close instant.
 *
 * Ticks are computed from a start epoch, never from the previous tick's end, so a slow tick does
 * not shift the schedule; a tick that would start late by a minute or more is skipped and the
 * minute stays without a ledger record, which is how the ledger says "missed". Ticks never
 * overlap: the sweep works to a budget inside the minute, marks the batches it could not make
 * as failed, and writes each of them a raw line of its own, so a replay sees the same miss.
 *
 * Startup follows KTD2: the checkpoint is loaded whenever any of its days is still open, whatever
 * its age, and the minutes since it was written stay missed; a day the checkpoint shows closed is
 * handed to the close hook first. The checkpoint is also the single-instance lease: an unreleased
 * one under three minutes old from another machine id makes this instance exit, the first
 * conditional put is made before any other work so two successors never both close a day, and a
 * lost conditional put later ends the instance the same way.
 *
 * Raw parts: a part that has closed (its hour or its day rolled) is uploaded on the next tick, and
 * one that failed to upload is retried hourly. At day close the day's last part goes up before the
 * close hook runs, so the compaction has every hour; when it cannot, the hook is told and the day
 * is finished later, once an upload pass has cleared it.
 *
 * Quota (KTD14): calls are counted per Chicago day in the checkpoint; at the hard stop, or on
 * CTA's error 102, calls stop until the day resets, the fail URL is posted once, and every later
 * minute stays missed. A service day outlives the midnight reset, so the stop is also marked on
 * every service day it touches and the day closes with the cause. A revoked key (101) is treated
 * the same way, so the alert reaches Nate.
 */
import { setTimeout as wait } from "node:timers/promises";
import { todayInChicago } from "@/lib/cta/closures";
import type { Healthchecks } from "./healthchecks";
import { GHOST_TOLERANCE_MINUTES } from "./matcher";
import { gzipJson, PreconditionFailedError, type ObjectStore } from "./objectStore";
import { getCheckpoint, isCheckpointHeld, putCheckpoint, type Checkpoint, type RawWriter } from "./rawStore";
import { dayCloseInstant, MINUTE_MS, serviceDateOf } from "./serviceDay";
import { applyTick, createDayTracker, createSweepState, type SweepState, type TickInput, type TrackerState } from "./tracker";
import {
    ARRIVALS_BATCH_SIZE,
    bodyBytes,
    STALE_STATION_ERROR_CODES,
    TrainTrackerError,
    TrainTrackerKeyError,
    TrainTrackerQuotaError,
    type ArrivalsResponse,
    type PositionsResponse,
    type RawCall,
    type TrainSource,
} from "./trainTracker";

/** Calls per Chicago day after which the worker stops calling until the reset (KTD14). */
export const QUOTA_HARD_STOP = 90_000;

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_JITTER_MS = 200;
export const DEFAULT_TICK_BUDGET_MS = 55_000;

/** Open live predictions unseen for this long are forgotten (a board that stopped answering). */
const OPEN_LIVE_TTL_MS = 2 * 60 * MINUTE_MS;

/** Raw parts left on disk by a failed upload are retried this often; a part that has just closed goes up at once. */
const UPLOAD_PASS_EVERY_TICKS = 60;

export type StopReason = "quota" | "key";

export interface Quota {
    /** The Chicago calendar date the count belongs to; CTA resets at midnight. */
    chicagoDate: string;
    calls: number;
    /** Set at the hard stop or on error 102 or 101; cleared when the date changes. */
    stopped: boolean;
    /** Why calls stopped, for the log and the day's record. */
    stopReason: StopReason | null;
}

/**
 * How far a closed day got (U8): `reduced` says its rows were written (false after a refused
 * write, which an operator re-reduces by hand); `revalidated` and `compacted` say the site was
 * refreshed and the raw day compacted. The day is done when those two hold.
 */
export interface DayReduction {
    serviceDate: string;
    reduced: boolean;
    revalidated: boolean;
    compacted: boolean;
}

/** What the checkpoint carries besides the envelope (KTD2). */
export interface WorkerState {
    version: 1;
    trackers: TrackerState[];
    sweep: SweepState;
    quota: Quota;
    /** Service days calls stopped during, by date, until each closes: the midnight reset does not clear them. */
    stoppedDays: Record<string, StopReason>;
    previousDay: DayReduction | null;
    ticks: number;
}

export interface LoopHooks {
    /**
     * A day has closed and its tracker is in the store: reduce, write, revalidate, compact (U8).
     * `stopReason` is set when calls stopped at any point of the day. `rawPending` says a raw part
     * of the day is still on disk, and the hook must then leave the compaction to `finishDay`,
     * which the loop calls once an upload pass has cleared the part. The default records nothing.
     */
    onDayClose(tracker: TrackerState, context: { closedAt: number; quota: Quota; stopReason: StopReason | null; rawPending: boolean }): Promise<DayReduction>;
    /** Finishes a day left not revalidated or not compacted: at startup, and after an upload pass clears its parts (U8). */
    finishDay(day: DayReduction): Promise<DayReduction>;
    /** At startup and after each close, write set-aside rows for days with no record (KTD7, U8). */
    fillGaps(nowEpochMs: number): Promise<void>;
}

/** Counts calls and writes their raw lines; the entry script wires it into the Train Tracker client. */
export interface CallSink {
    onCall(call: RawCall): void;
    /** Calls recorded since the last take, and their body bytes. */
    take(): { calls: number; bytes: number; failures: number };
}

export function createCallSink(rawWriter: RawWriter): CallSink {
    let calls = 0;
    let bytes = 0;
    let failures = 0;
    return {
        onCall(call) {
            rawWriter.append(call);
            calls += 1;
            bytes += bodyBytes(call);
            if (call.failure !== null) failures += 1;
        },
        take() {
            const taken = { calls, bytes, failures };
            calls = 0;
            bytes = 0;
            failures = 0;
            return taken;
        },
    };
}

export interface LoopOptions {
    source: TrainSource;
    sink: CallSink;
    store: ObjectStore;
    rawWriter: RawWriter;
    /** The CTA station ids to sweep, four to a call: the open stations, read at every tick. */
    stations: () => readonly string[];
    machineId: string;
    toleranceMinutes?: number;
    /** The feed's latest scheduled stop time, when known, which may push the close past 03:15; read at each close. */
    latestStopSeconds?: () => number | undefined;
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    /** Shutdown: aborts the sleep, finishes the tick, uploads the open part, releases the checkpoint. */
    signal: AbortSignal;
    healthchecks?: Healthchecks | null;
    hooks?: Partial<LoopHooks>;
    log?: (message: string) => void;
    concurrency?: number;
    jitterMs?: number;
    tickBudgetMs?: number;
    /** Stop after this many ticks (the --once smoke test and the tests). */
    maxTicks?: number;
    random?: () => number;
}

export interface LoopResult {
    ticks: number;
    exit: "stopped" | "held" | "lost-lease" | "max-ticks";
}

export const dayStateKey = (serviceDate: string) => `days/v1/${serviceDate}.json.gz`;

/** A closed day's tracker, serialized whole beside its raw record: the record of what the worker held. */
export async function serializeClosedDay(store: ObjectStore, tracker: TrackerState): Promise<void> {
    await store.put(dayStateKey(tracker.serviceDate), gzipJson(tracker), { contentType: "application/gzip" });
}

export function freshQuota(chicagoDate: string): Quota {
    return { chicagoDate, calls: 0, stopped: false, stopReason: null };
}

export function freshWorkerState(chicagoDate: string): WorkerState {
    return { version: 1, trackers: [], sweep: createSweepState(), quota: freshQuota(chicagoDate), stoppedDays: {}, previousDay: null, ticks: 0 };
}

/** A closed day needs nothing more once the site is refreshed and its raw day is compacted. */
const isDone = (day: DayReduction): boolean => day.revalidated && day.compacted;

function chunk<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
}

export async function runLoop(options: LoopOptions): Promise<LoopResult> {
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? defaultSleep;
    const log = options.log ?? (() => {});
    const tolerance = options.toleranceMinutes ?? GHOST_TOLERANCE_MINUTES;
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    const jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
    const tickBudgetMs = options.tickBudgetMs ?? DEFAULT_TICK_BUDGET_MS;
    const random = options.random ?? Math.random;
    const hooks: LoopHooks = {
        onDayClose: async (tracker) => ({ serviceDate: tracker.serviceDate, reduced: false, revalidated: false, compacted: false }),
        finishDay: async (day) => day,
        fillGaps: async () => {},
        ...options.hooks,
    };

    // Startup: the checkpoint and the lease, then the days the checkpoint left open or closed.
    let etag: string | null = null;
    let state: WorkerState;
    const read = await getCheckpoint<WorkerState>(options.store);
    if (read !== null && isCheckpointHeld(read.checkpoint, options.machineId, now())) {
        log(`checkpoint held by machine ${read.checkpoint.machineId}, written ${Math.round((now() - read.checkpoint.writtenAt) / 1000)} s ago; exiting`);
        return { ticks: 0, exit: "held" };
    }
    if (read !== null) {
        etag = read.etag;
        state = read.checkpoint.state;
        state.stoppedDays ??= {}; // a checkpoint written before the stop marker existed
        const age = Math.round((now() - read.checkpoint.writtenAt) / MINUTE_MS);
        log(`checkpoint from machine ${read.checkpoint.machineId} loaded, ${age} min old, ${state.trackers.length} open day(s)`);
    } else {
        state = freshWorkerState(todayInChicago(new Date(now())));
        log("no checkpoint; starting fresh");
    }
    const trackers = new Map(state.trackers.map((t) => [t.serviceDate, t]));
    const closeOf = (serviceDate: string) => dayCloseInstant(serviceDate, tolerance, options.latestStopSeconds?.());
    /** The day's tracker, created on first use; null once the day has closed. */
    const trackerFor = (serviceDate: string): TrackerState | null => {
        let tracker = trackers.get(serviceDate);
        if (tracker === undefined) {
            if (closeOf(serviceDate) <= now()) return null;
            tracker = createDayTracker(serviceDate);
            trackers.set(serviceDate, tracker);
        }
        return tracker;
    };
    /** Part files on disk after the last upload pass; a different count means a part has closed since. */
    let lastPending = 0;

    async function writeCheckpoint(released: boolean): Promise<boolean> {
        state.trackers = [...trackers.values()];
        const checkpoint: Checkpoint<WorkerState> = { version: 1, machineId: options.machineId, writtenAt: now(), released, state };
        try {
            const result = await putCheckpoint(options.store, checkpoint, etag === null ? { ifNoneMatch: "*" } : { ifMatch: etag });
            etag = result.etag;
            return true;
        } catch (error) {
            if (error instanceof PreconditionFailedError) {
                log("checkpoint changed under us: another instance holds the day; exiting");
                return false;
            }
            log(`checkpoint not written: ${error instanceof Error ? error.message : "error"}`);
            return true;
        }
    }

    /** Uploads the closed parts and, once none of the previous day's is left on disk, finishes that day. */
    async function uploadPass(): Promise<string[]> {
        const uploaded = await options.rawWriter.uploadPending();
        lastPending = options.rawWriter.pendingFiles().length;
        const day = state.previousDay;
        if (day !== null && !isDone(day) && options.rawWriter.pendingFiles(day.serviceDate).length === 0) {
            state.previousDay = await hooks.finishDay(day);
        }
        return uploaded;
    }

    async function closeDaysBefore(epochMs: number): Promise<void> {
        for (const [serviceDate, tracker] of [...trackers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
            if (closeOf(serviceDate) > epochMs) continue;
            trackers.delete(serviceDate);
            const stopReason = state.stoppedDays[serviceDate] ?? null;
            log(`service day ${serviceDate} closed: ${Object.keys(tracker.slots).length} slots, ${tracker.passages.length} passages, ${Object.keys(tracker.minutes).length} minutes${stopReason === null ? "" : `, calls stopped (${stopReason})`}`);
            // The day's last raw part goes up before the hook, so the compaction has every hour.
            options.rawWriter.closeOpenPart(serviceDate);
            await uploadPass();
            const rawPending = options.rawWriter.pendingFiles(serviceDate).length > 0;
            if (rawPending) log(`${serviceDate}: a raw part is still on disk; the day compacts once it is uploaded`);
            await serializeClosedDay(options.store, tracker);
            // The quota as it stood at the close, a copy: the midnight reset must not rewrite the record.
            state.previousDay = await hooks.onDayClose(tracker, { closedAt: epochMs, quota: { ...state.quota }, stopReason, rawPending });
            delete state.stoppedDays[serviceDate];
            await hooks.fillGaps(epochMs);
        }
    }

    // The lease first: nothing below runs until this instance holds the checkpoint.
    if (!(await writeCheckpoint(false))) return { ticks: 0, exit: "lost-lease" };
    const leftovers = await uploadPass();
    if (leftovers.length > 0) log(`uploaded ${leftovers.length} raw part(s) left on disk`);
    await closeDaysBefore(now());
    await hooks.fillGaps(now());

    // The tick schedule: whole minutes from the first tick.
    const start = now();
    let n = 0;
    let ticks = 0;
    for (;;) {
        if (options.signal.aborted) break;
        if (options.maxTicks !== undefined && ticks >= options.maxTicks) {
            await shutdown(true);
            return { ticks, exit: "max-ticks" };
        }
        const due = start + n * MINUTE_MS;
        const wait = due - now();
        if (wait > 0) {
            try {
                await sleep(wait, options.signal);
            } catch {
                break; // aborted
            }
            if (options.signal.aborted) break;
        } else if (-wait >= MINUTE_MS) {
            const skipped = Math.floor(-wait / MINUTE_MS);
            log(`behind by ${skipped} minute(s); skipping`);
            n += skipped;
            continue;
        }
        n += 1;

        const pollEpoch = now();
        await closeDaysBefore(pollEpoch);
        rolloverQuota(state.quota, todayInChicago(new Date(pollEpoch)));
        if (state.quota.stopped) {
            // No call and no ledger record: the minute stays missed, as the day's record will say.
            // The day still gets its tracker and the stop's mark, so one stopped throughout closes with the cause.
            const day = serviceDateOf(pollEpoch);
            if (trackerFor(day) !== null) state.stoppedDays[day] ??= state.quota.stopReason ?? "quota";
            ticks += 1;
            state.ticks += 1;
            if (!(await writeCheckpoint(false))) return { ticks, exit: "lost-lease" };
            continue;
        }
        const tick = await poll(pollEpoch);
        const taken = options.sink.take();
        state.quota.calls += taken.calls;
        applyTick(state.sweep, trackerFor, tick.input);
        pruneOpenLive(state.sweep, pollEpoch);
        ticks += 1;
        state.ticks += 1;

        if (tick.stop !== null) await stopCalls(tick.stop, pollEpoch, tick.stop === "quota" ? "daily quota exhausted" : "key refused");
        else if (state.quota.calls >= QUOTA_HARD_STOP) await stopCalls("quota", pollEpoch, `${QUOTA_HARD_STOP} calls today`);

        if (!(await writeCheckpoint(false))) return { ticks, exit: "lost-lease" };
        if (tick.success) await options.healthchecks?.ping();
        // A part that has just closed goes up now; one that failed to upload waits for the hourly pass.
        const pending = options.rawWriter.pendingFiles().length;
        if (pending > 0 && (pending !== lastPending || ticks % UPLOAD_PASS_EVERY_TICKS === 1)) await uploadPass();
        log(`tick ${state.ticks}: ${taken.calls} calls, ${taken.failures} failed, ${Math.round(taken.bytes / 1024)} KB, ${now() - pollEpoch} ms${tick.success ? "" : ", no ping"}`);
    }
    await shutdown(true);
    return { ticks, exit: "stopped" };

    /**
     * Stops the calls until the Chicago day resets, marks the poll's service day and every open
     * one with the cause, and posts the fail URL once (KTD13, KTD14).
     */
    async function stopCalls(reason: StopReason, pollEpoch: number, why: string): Promise<void> {
        state.quota.stopped = true;
        state.quota.stopReason = reason;
        for (const day of new Set([serviceDateOf(pollEpoch), ...trackers.keys()])) state.stoppedDays[day] ??= reason;
        log(`${why}; calls stop until the Chicago day resets`);
        await options.healthchecks?.fail();
    }

    /** One tick's calls: positions, then the sweep at bounded concurrency with jitter. */
    async function poll(pollEpoch: number): Promise<{ input: TickInput; success: boolean; stop: StopReason | null }> {
        const deadline = pollEpoch + tickBudgetMs;
        const batches = chunk(options.stations(), ARRIVALS_BATCH_SIZE);
        let stop: StopReason | null = null;
        const stopped = () => state.quota.stopped || stop !== null;
        const classify = (error: unknown): void => {
            if (error instanceof TrainTrackerQuotaError) stop = "quota";
            else if (error instanceof TrainTrackerKeyError) stop = "key";
        };
        /**
         * A batch the sweep never sent gets a raw line of its own, written past the sink so it is
         * neither a call nor quota, and a replay lists its stations as not polled (KTD3). It is
         * stamped with the moment it was passed over, after the positions call, so the replay
         * groups it with this tick rather than the one before.
         */
        const notRequested = (stationIds: string[]): void => {
            options.rawWriter.append({ endpoint: "arrivals", pollEpoch: now(), stationIds, httpStatus: null, body: null, errorCode: null, failure: "not-requested", durationMs: 0 });
        };

        let positions: PositionsResponse | null = null;
        if (!stopped()) {
            try {
                positions = await options.source.positions();
            } catch (error) {
                classify(error);
            }
        }

        const results: { stationIds: string[]; response: ArrivalsResponse | null }[] = batches.map((stationIds) => ({ stationIds, response: null }));
        let next = 0;
        const worker = async (): Promise<void> => {
            for (;;) {
                const index = next++;
                if (index >= batches.length) return;
                if (stopped() || now() > deadline) {
                    notRequested(batches[index]);
                    continue;
                }
                if (jitterMs > 0) {
                    try {
                        await sleep(Math.floor(random() * jitterMs), options.signal);
                    } catch {
                        notRequested(batches[index]); // shutdown: the rest of the sweep is passed over
                        continue;
                    }
                }
                try {
                    results[index].response = await options.source.arrivals(batches[index]);
                } catch (error) {
                    classify(error);
                    // The whole batch is lost until the closure table names the station.
                    if (error instanceof TrainTrackerError && error.code !== null && STALE_STATION_ERROR_CODES.includes(error.code)) {
                        log(`stale station id in arrivals batch ${batches[index].join(",")}: ${error.message}`);
                    }
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

        const success = positions !== null && results.every((r) => r.response !== null);
        return { input: { pollEpoch, positions, arrivals: results }, success, stop };
    }

    /** The open part is closed and every part uploaded; a previous day left unfinished waits for the successor. */
    async function shutdown(released: boolean): Promise<void> {
        options.rawWriter.closeOpenPart();
        await options.rawWriter.uploadPending();
        await writeCheckpoint(released);
        log(`stopped after ${ticks} tick(s); checkpoint ${released ? "released" : "kept"}`);
    }
}

function rolloverQuota(quota: Quota, chicagoDate: string): void {
    if (quota.chicagoDate === chicagoDate) return;
    quota.chicagoDate = chicagoDate;
    quota.calls = 0;
    quota.stopped = false;
    quota.stopReason = null;
}

function pruneOpenLive(sweep: SweepState, nowEpochMs: number): void {
    for (const [key, open] of Object.entries(sweep.openLive)) {
        if (nowEpochMs - open.lastSeen > OPEN_LIVE_TTL_MS) delete sweep.openLive[key];
    }
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
    await wait(ms, undefined, { signal });
}
