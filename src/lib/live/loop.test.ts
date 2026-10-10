import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CTA_ROSTER } from "@/lib/cta/roster";
import type { Healthchecks } from "./healthchecks";
import { createCallSink, dayStateKey, QUOTA_HARD_STOP, runLoop, type DayReduction, type LoopHooks, type LoopOptions, type WorkerState } from "./loop";
import { createMemoryObjectStore, ObjectStoreError, type MemoryObjectStore } from "./objectStore";
import {
    CHECKPOINT_KEY,
    compactDay,
    createRawWriter,
    dayObjectKey,
    dayPartsPrefix,
    getCheckpoint,
    partKey,
    putCheckpoint,
    readRawDay,
    type Checkpoint,
    type CompactionResult,
    type RawWriter,
} from "./rawStore";
import { hourIndexOf, minuteIndexOf, parseChicagoLocal, serviceDateOf } from "./serviceDay";
import { createDayTracker, type TrackerState } from "./tracker";
import {
    TRAIN_ROUTES,
    TrainTrackerError,
    TrainTrackerKeyError,
    TrainTrackerQuotaError,
    type ArrivalPrediction,
    type ArrivalsResponse,
    type PositionsResponse,
    type RawCall,
    type TrainSource,
} from "./trainTracker";

const MINUTE = 60_000;
const T0 = parseChicagoLocal("2026-10-14 17:00:00");
const ROSTER_IDS = CTA_ROSTER.map((s) => s.ctaStationId);
const EIGHT = ROSTER_IDS.slice(0, 8);
const MACHINE = "e784e1";

type CloseContext = Parameters<LoopHooks["onDayClose"]>[1];

/** A Train Tracker stand-in that answers from a script and reports its calls to the sink like the client does. */
class FakeSource implements TrainSource {
    positionsCalls = 0;
    arrivalsCalls: string[][] = [];
    /** Per station, the predictions to answer with. */
    predictions = new Map<string, ArrivalPrediction[]>();
    /** Station ids whose batch fails with this error; a quota or key error stops the sweep. */
    failing = new Map<string, Error>();
    failPositions: Error | null = null;
    /** Virtual time each call takes. */
    callMs = 100;
    onBeforeCall: (() => void) | null = null;

    constructor(
        private readonly harness: { now: () => number; advance: (ms: number) => void; onCall: (call: RawCall) => void },
    ) {}

    private record(endpoint: RawCall["endpoint"], stationIds: string[], error: Error | null): void {
        const failure = error instanceof TrainTrackerError ? error.failure : error === null ? null : "network";
        this.harness.onCall({
            endpoint,
            pollEpoch: this.harness.now(),
            stationIds,
            httpStatus: error === null || error instanceof TrainTrackerError ? 200 : null,
            body: error === null || error instanceof TrainTrackerError ? `{"ctatt":{"errCd":"${error instanceof TrainTrackerError ? error.code : 0}"}}` : null,
            errorCode: error === null ? 0 : error instanceof TrainTrackerError ? error.code : null,
            failure,
            durationMs: this.callMs,
        });
    }

    async positions(): Promise<PositionsResponse> {
        this.onBeforeCall?.();
        this.positionsCalls += 1;
        this.harness.advance(this.callMs);
        this.record("positions", [], this.failPositions);
        if (this.failPositions) throw this.failPositions;
        return { generatedAt: this.harness.now(), pollEpoch: this.harness.now(), malformed: 0, routes: TRAIN_ROUTES.map((route) => ({ route, trains: route === "red" ? [{} as never] : [] })) };
    }

    async arrivals(stationIds: readonly string[]): Promise<ArrivalsResponse> {
        this.onBeforeCall?.();
        this.arrivalsCalls.push([...stationIds]);
        this.harness.advance(this.callMs);
        const error = stationIds.map((id) => this.failing.get(id)).find((e) => e !== undefined) ?? null;
        this.record("arrivals", [...stationIds], error);
        if (error) throw error;
        return {
            generatedAt: this.harness.now(),
            pollEpoch: this.harness.now(),
            stationIds: [...stationIds],
            malformed: 0,
            predictions: stationIds.flatMap((id) => this.predictions.get(id) ?? []),
        };
    }
}

interface Harness {
    clock: { value: number };
    store: MemoryObjectStore;
    source: FakeSource;
    rawWriter: RawWriter;
    sink: ReturnType<typeof createCallSink>;
    /** The recording hooks the loop runs with unless a test overrides them. */
    hooks: LoopHooks;
    /** Every call the source made, as the sink saw it. */
    calls: RawCall[];
    pings: number;
    fails: number;
    closed: TrackerState[];
    closeContexts: { serviceDate: string; context: CloseContext }[];
    finished: DayReduction[];
    gapFills: number[];
    logged: string[];
    controller: AbortController;
    run(overrides?: Partial<LoopOptions>): ReturnType<typeof runLoop>;
    checkpoint(): Promise<Checkpoint<WorkerState> | null>;
}

interface HarnessOptions {
    stationIds?: readonly string[];
    start?: number;
    /** While this answers true, every raw-part upload fails with a 503; the checkpoint and the day states still land. */
    rawUploadFailsWhile?: (nowEpochMs: number) => boolean;
}

let dir: string;
let h: Harness;

function harness(options: HarnessOptions = {}): Harness {
    const clock = { value: options.start ?? T0 };
    const memory = createMemoryObjectStore({ now: () => clock.value });
    const store: MemoryObjectStore = {
        ...memory,
        put: async (key, body, putOptions) => {
            if (key.startsWith("raw/v1/") && options.rawUploadFailsWhile?.(clock.value)) throw new ObjectStoreError("put", key, 503);
            return memory.put(key, body, putOptions);
        },
    };
    const rawWriter = createRawWriter({ dir, store, log: (m) => result.logged.push(m) });
    const sink = createCallSink(rawWriter);
    const source = new FakeSource({
        now: () => clock.value,
        advance: (ms) => (clock.value += ms),
        onCall: (call) => {
            result.calls.push(call);
            sink.onCall(call);
        },
    });
    const controller = new AbortController();
    const healthchecks: Healthchecks = {
        ping: async () => {
            result.pings += 1;
        },
        fail: async () => {
            result.fails += 1;
        },
    };
    const hooks: LoopHooks = {
        onDayClose: async (tracker, context) => {
            result.closed.push(tracker);
            result.closeContexts.push({ serviceDate: tracker.serviceDate, context });
            return { serviceDate: tracker.serviceDate, reduced: true, revalidated: true, compacted: true };
        },
        finishDay: async (day) => {
            result.finished.push(day);
            return { ...day, revalidated: true, compacted: true };
        },
        fillGaps: async (now) => {
            result.gapFills.push(now);
        },
    };
    const result: Harness = {
        clock,
        store,
        source,
        rawWriter,
        sink,
        hooks,
        calls: [],
        pings: 0,
        fails: 0,
        closed: [],
        closeContexts: [],
        finished: [],
        gapFills: [],
        logged: [],
        controller,
        run: (overrides = {}) =>
            runLoop({
                source,
                sink,
                store,
                rawWriter,
                stations: () => options.stationIds ?? EIGHT,
                machineId: MACHINE,
                now: () => clock.value,
                sleep: async (ms, signal) => {
                    if (signal.aborted) throw new Error("aborted");
                    clock.value += ms;
                },
                signal: controller.signal,
                healthchecks,
                hooks,
                log: (m) => result.logged.push(m),
                jitterMs: 0,
                maxTicks: 3,
                ...overrides,
            }),
        checkpoint: async () => (await getCheckpoint<WorkerState>(store))?.checkpoint ?? null,
    };
    return result;
}

/** Hooks that compact the raw day the way the worker's do: at the close unless a part is still on disk, else when the loop finishes the day. */
function compactingHooks(harness: Harness, compactions: CompactionResult[]): LoopHooks {
    return {
        ...harness.hooks,
        onDayClose: async (tracker, context) => {
            await harness.hooks.onDayClose(tracker, context);
            let compacted = false;
            if (!context.rawPending) {
                const result = await compactDay(harness.store, tracker.serviceDate);
                compactions.push(result);
                compacted = result.status !== "no-parts";
            }
            return { serviceDate: tracker.serviceDate, reduced: true, revalidated: true, compacted };
        },
        finishDay: async (day) => {
            await harness.hooks.finishDay(day);
            const result = await compactDay(harness.store, day.serviceDate);
            compactions.push(result);
            return { ...day, revalidated: true, compacted: result.status !== "no-parts" };
        },
    };
}

function scheduleOnly(stationId: string, stopId: string, run: string, arrivalAt: number): ArrivalPrediction {
    return {
        stationId,
        stopId,
        stationName: "x",
        platform: "x",
        run,
        route: "red",
        destinationStopId: "0",
        destinationName: "Howard",
        direction: 1,
        predictedAt: arrivalAt - MINUTE,
        arrivalAt,
        arrivalText: "x",
        approaching: false,
        scheduled: true,
        fault: false,
        delayed: false,
        lat: null,
        lon: null,
        heading: null,
    };
}

async function seedCheckpoint(overrides: Omit<Partial<Checkpoint<WorkerState>>, "state"> & { state?: Partial<WorkerState> } = {}): Promise<void> {
    const tracker = createDayTracker("2026-10-14");
    tracker.slots["41190|30228|red|x"] = {
        key: "41190|30228|red|x",
        stationId: "41190",
        stopId: "30228",
        route: "red",
        scheduledAt: T0 + 5 * MINUTE,
        scheduledText: "x",
        firstSeen: T0 - 10 * MINUTE,
        lastSeen: T0 - 2 * MINUTE,
        runs: ["901"],
        fault: false,
        liveSameRunAt: null,
    };
    tracker.minutes[String(minuteIndexOf("2026-10-14", T0 - 2 * MINUTE))] = { p: 1, f: [], t: null, m: 0 };
    const state: WorkerState = {
        version: 1,
        trackers: [tracker],
        sweep: { openLive: {} },
        quota: { chicagoDate: "2026-10-14", calls: 1_234, stopped: false, stopReason: null },
        stoppedDays: {},
        previousDay: { serviceDate: "2026-10-13", reduced: true, revalidated: true, compacted: true },
        ticks: 10,
        ...overrides.state,
    };
    await putCheckpoint(h.store, { version: 1, machineId: MACHINE, writtenAt: T0 - 2 * MINUTE, released: false, ...overrides, state });
}

/** The poll epochs of every call the source made on a service day, in order: what the day's raw record must hold. */
const callsOn = (serviceDate: string) => h.calls.filter((c) => serviceDateOf(c.pollEpoch) === serviceDate).map((c) => c.pollEpoch);

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-"));
    h = harness();
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("the tick", () => {
    it("polls positions once and every station's arrivals, records, checkpoints, and pings, three times", async () => {
        h = harness({ stationIds: ROSTER_IDS });

        const result = await h.run();

        expect(result).toEqual({ ticks: 3, exit: "max-ticks" });
        expect(h.source.positionsCalls).toBe(3);
        expect(h.source.arrivalsCalls).toHaveLength(108);
        expect(h.source.arrivalsCalls[0]).toEqual(ROSTER_IDS.slice(0, 4));
        expect(h.pings).toBe(3);
        expect(h.fails).toBe(0);
        // Three ticks' raw lines, 37 a tick, uploaded at shutdown.
        const parts = await h.store.list(dayPartsPrefix("2026-10-14"));
        expect(parts).toHaveLength(1);
        const lines = gunzipSync((await h.store.get(parts[0].key))!.body).toString("utf8").trim().split("\n");
        expect(lines).toHaveLength(111);
        const checkpoint = await h.checkpoint();
        expect(checkpoint).toMatchObject({ machineId: MACHINE, released: true });
        expect(checkpoint?.state.ticks).toBe(3);
        expect(checkpoint?.state.quota).toEqual({ chicagoDate: "2026-10-14", calls: 111, stopped: false, stopReason: null });
        expect(checkpoint?.state.stoppedDays).toEqual({});
        expect(checkpoint?.state.trackers.map((t) => t.serviceDate)).toEqual(["2026-10-14"]);
        expect(Object.keys(checkpoint!.state.trackers[0].minutes)).toHaveLength(3);
        expect(h.gapFills).toEqual([T0]);
        expect(h.logged[0]).toBe("no checkpoint; starting fresh");
    });

    it("runs a tick up to a minute late and skips the minute when it is a minute or more behind", async () => {
        // Ticks are due on whole minutes from the start. The second tick takes 90 s, so the third
        // starts 30 s late and runs; when the second takes 130 s instead, the third's minute is skipped.
        let slow = 90_000;
        h.source.onBeforeCall = () => {
            if (h.source.positionsCalls === 1 && h.source.arrivalsCalls.length === 2) h.clock.value += slow;
        };
        await h.run({ maxTicks: 3 });
        const first = minuteIndexOf("2026-10-14", T0);
        const minutesOf = async () => Object.keys((await h.checkpoint())!.state.trackers[0].minutes).map(Number).sort((a, b) => a - b);
        expect(await minutesOf()).toEqual([first, first + 1, first + 2]);
        expect(h.logged.some((l) => l.startsWith("behind by"))).toBe(false);

        fs.rmSync(dir, { recursive: true, force: true });
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-"));
        h = harness();
        slow = 130_000;
        h.source.onBeforeCall = () => {
            if (h.source.positionsCalls === 1 && h.source.arrivalsCalls.length === 2) h.clock.value += slow;
        };
        await h.run({ maxTicks: 3 });
        expect(await minutesOf()).toEqual([first, first + 1, first + 3]);
        expect(h.logged).toContain("behind by 1 minute(s); skipping");
    });

    it("records a failed arrivals batch, lists its stations as missed, and skips the ping", async () => {
        h.source.failing.set(EIGHT[5], new TrainTrackerError("arrivals", "http", "Train Tracker arrivals: HTTP 503"));

        await h.run({ maxTicks: 1 });

        expect(h.pings).toBe(0);
        const checkpoint = await h.checkpoint();
        const [record] = Object.values(checkpoint!.state.trackers[0].minutes);
        expect(record).toMatchObject({ p: 1, f: EIGHT.slice(4, 8).sort() });
        expect(fs.readdirSync(dir)).toEqual([]); // uploaded at shutdown
        const parts = await h.store.list(dayPartsPrefix("2026-10-14"));
        const raw = gunzipSync((await h.store.get(parts[0].key))!.body).toString("utf8").trim().split("\n").map((l) => JSON.parse(l) as RawCall);
        expect(raw.filter((l) => l.failure === "http")).toHaveLength(1);
        expect(h.logged.at(-2)).toMatch(/no ping$/);
    });

    it("stops calling for the rest of the Chicago day on a quota error, posts the fail URL once, and leaves later minutes missed", async () => {
        h.source.failing.set(EIGHT[1], new TrainTrackerQuotaError("arrivals"));

        await h.run({ maxTicks: 4 });

        expect(h.source.positionsCalls).toBe(1);
        expect(h.source.arrivalsCalls.length).toBeLessThanOrEqual(2);
        expect(h.fails).toBe(1);
        expect(h.pings).toBe(0);
        const checkpoint = await h.checkpoint();
        expect(checkpoint?.state.quota).toMatchObject({ stopped: true, stopReason: "quota" });
        expect(checkpoint?.state.stoppedDays).toEqual({ "2026-10-14": "quota" });
        expect(Object.keys(checkpoint!.state.trackers[0].minutes)).toHaveLength(1);
        expect(checkpoint?.state.ticks).toBe(4);
        expect(h.logged).toContain("daily quota exhausted; calls stop until the Chicago day resets");
    });

    it("treats a revoked key the same way", async () => {
        h.source.failPositions = new TrainTrackerKeyError("positions");

        await h.run({ maxTicks: 2 });

        expect(h.source.positionsCalls).toBe(1);
        expect(h.source.arrivalsCalls).toHaveLength(0);
        expect(h.fails).toBe(1);
        expect((await h.checkpoint())?.state.quota.stopReason).toBe("key");
        expect((await h.checkpoint())?.state.stoppedDays).toEqual({ "2026-10-14": "key" });
    });

    it("stops at the hard quota stop before CTA refuses", async () => {
        await seedCheckpoint({ state: { quota: { chicagoDate: "2026-10-14", calls: QUOTA_HARD_STOP - 1, stopped: false, stopReason: null } } });

        await h.run({ maxTicks: 2 });

        expect(h.source.positionsCalls).toBe(1);
        expect(h.fails).toBe(1);
        expect((await h.checkpoint())?.state.quota).toMatchObject({ calls: QUOTA_HARD_STOP + 2, stopped: true, stopReason: "quota" });
    });

    it("resets the quota when the Chicago date changes", async () => {
        await seedCheckpoint({ state: { quota: { chicagoDate: "2026-10-13", calls: 90_000, stopped: true, stopReason: "quota" } } });

        await h.run({ maxTicks: 1 });

        expect(h.source.positionsCalls).toBe(1);
        expect((await h.checkpoint())?.state.quota).toEqual({ chicagoDate: "2026-10-14", calls: 3, stopped: false, stopReason: null });
    });
});

describe("a stop across the service day", () => {
    it("keeps a quota stop on its service day past the midnight reset, so the day closes with the cause", async () => {
        h = harness({ start: parseChicagoLocal("2026-10-14 23:29:00") });
        // CTA answers 102 once, at 23:30; the key works again after its midnight reset.
        h.source.onBeforeCall = () => {
            if (h.clock.value >= parseChicagoLocal("2026-10-15 00:00:00")) h.source.failing.clear();
            else if (h.clock.value >= parseChicagoLocal("2026-10-14 23:30:00")) h.source.failing.set(EIGHT[1], new TrainTrackerQuotaError("arrivals"));
        };

        await h.run({ maxTicks: 230 }); // 23:29 through 03:18

        expect(h.fails).toBe(1);
        expect(h.source.positionsCalls).toBe(2 + 199); // 23:29, 23:30, then every minute from midnight
        expect(h.closeContexts.map((c) => [c.serviceDate, c.context.stopReason, c.context.quota.stopped])).toEqual([["2026-10-14", "quota", false]]);
        const minutes = Object.keys(h.closed[0].minutes).map(Number);
        const stopMinute = minuteIndexOf("2026-10-14", parseChicagoLocal("2026-10-14 23:30:00"));
        const midnight = minuteIndexOf("2026-10-14", parseChicagoLocal("2026-10-15 00:00:00"));
        expect(minutes).toContain(stopMinute);
        expect(minutes.filter((m) => m > stopMinute && m < midnight)).toEqual([]);
        expect(minutes).toContain(midnight);
        const checkpoint = await h.checkpoint();
        expect(checkpoint?.state.stoppedDays).toEqual({});
        expect(checkpoint?.state.quota).toMatchObject({ chicagoDate: "2026-10-15", stopped: false, stopReason: null });
    });

    it("marks a day whose tracker only stopped ticks created, so it closes with the cause as well", async () => {
        h = harness({ start: parseChicagoLocal("2026-10-15 02:29:00") });
        h.source.failing.set(EIGHT[1], new TrainTrackerQuotaError("arrivals"));
        h.source.onBeforeCall = () => {
            if (h.clock.value >= parseChicagoLocal("2026-10-16 00:00:00")) h.source.failing.clear();
        };

        await h.run({ maxTicks: 1490 }); // 02:29 on the 15th through 03:18 on the 16th

        expect(h.fails).toBe(1);
        expect(h.closeContexts.map((c) => [c.serviceDate, c.context.stopReason, c.context.quota.stopped])).toEqual([
            ["2026-10-14", "quota", true],
            ["2026-10-15", "quota", false],
        ]);
        // The 15th was polled only after the reset; its tracker came from the stopped ticks.
        const [, fifteenth] = h.closed;
        const minutes = Object.keys(fifteenth.minutes).map(Number);
        expect(minutes.length).toBeGreaterThan(0);
        expect(Math.min(...minutes)).toBe(minuteIndexOf("2026-10-15", parseChicagoLocal("2026-10-16 00:00:00")));
        const checkpoint = await h.checkpoint();
        expect(checkpoint?.state.trackers.map((t) => t.serviceDate)).toEqual(["2026-10-16"]);
        expect(checkpoint?.state.stoppedDays).toEqual({});
    });
});

describe("the raw record", () => {
    it("writes a line for each arrivals batch the sweep passed over at the budget, counting only the calls it made", async () => {
        await h.run({ maxTicks: 1, tickBudgetMs: 150, concurrency: 1 });

        expect(h.source.arrivalsCalls).toEqual([EIGHT.slice(0, 4)]);
        expect(h.pings).toBe(0);
        const checkpoint = await h.checkpoint();
        expect(checkpoint?.state.quota.calls).toBe(2);
        expect(Object.values(checkpoint!.state.trackers[0].minutes)[0]).toMatchObject({ p: 1, f: EIGHT.slice(4, 8).sort() });
        const lines = (await readRawDay(h.store, "2026-10-14"))!;
        expect(lines.map((l) => [l.endpoint, l.failure])).toEqual([
            ["positions", null],
            ["arrivals", null],
            ["arrivals", "not-requested"],
        ]);
        expect(lines[2]).toMatchObject({ stationIds: EIGHT.slice(4, 8), httpStatus: null, body: null, errorCode: null, durationMs: 0 });
        expect(lines[2].pollEpoch).toBeGreaterThanOrEqual(lines[0].pollEpoch); // grouped with this tick on replay
    });

    it("writes the line for the batches a shutdown passes over during the sweep", async () => {
        h.source.onBeforeCall = () => {
            if (h.source.positionsCalls === 1 && h.source.arrivalsCalls.length === 0) h.controller.abort();
        };

        const result = await h.run({ maxTicks: 5, jitterMs: 10, concurrency: 1, random: () => 0.5 });

        expect(result).toEqual({ ticks: 1, exit: "stopped" });
        expect(h.source.arrivalsCalls).toHaveLength(1);
        const lines = (await readRawDay(h.store, "2026-10-14"))!;
        expect(lines.map((l) => l.failure)).toEqual([null, null, "not-requested"]);
        expect((await h.checkpoint())?.state.quota.calls).toBe(2);
    });
});

describe("startup", () => {
    it("resumes a two-minute-old checkpoint from the same machine: slots, ledger, and call count", async () => {
        await seedCheckpoint();
        h.source.predictions.set(EIGHT[0], [scheduleOnly(EIGHT[0], "30001", "777", T0 + 9 * MINUTE)]);

        await h.run({ maxTicks: 1 });

        const checkpoint = await h.checkpoint();
        const [tracker] = checkpoint!.state.trackers;
        expect(Object.keys(tracker.slots).sort()).toEqual(["41190|30228|red|x", `${EIGHT[0]}|30001|red|${Math.floor((T0 + 9 * MINUTE) / MINUTE)}`].sort());
        expect(checkpoint?.state.quota.calls).toBe(1_234 + 3);
        expect(checkpoint?.state.ticks).toBe(11);
        expect(h.logged[0]).toBe(`checkpoint from machine ${MACHINE} loaded, 2 min old, 1 open day(s)`);
        expect(h.finished).toEqual([]);
    });

    it("resumes a forty-minute-old checkpoint on the same day, leaving the forty minutes missed", async () => {
        await seedCheckpoint({ writtenAt: T0 - 40 * MINUTE });

        await h.run({ maxTicks: 1 });

        const [tracker] = (await h.checkpoint())!.state.trackers;
        expect(Object.keys(tracker.slots)).toEqual(["41190|30228|red|x"]);
        const minutes = Object.keys(tracker.minutes).map(Number).sort((a, b) => a - b);
        expect(minutes).toEqual([minuteIndexOf("2026-10-14", T0 - 2 * MINUTE), minuteIndexOf("2026-10-14", T0)]);
        expect(h.logged[0]).toMatch(/40 min old/);
    });

    it("closes a checkpoint's day that has already ended before polling, and starts the new day fresh", async () => {
        await seedCheckpoint({ writtenAt: T0 - 2 * MINUTE });
        h.clock.value = parseChicagoLocal("2026-10-15 03:20:00");

        await h.run({ maxTicks: 1 });

        expect(h.closed.map((t) => t.serviceDate)).toEqual(["2026-10-14"]);
        expect(Object.keys(h.closed[0].slots)).toEqual(["41190|30228|red|x"]);
        expect(h.source.positionsCalls).toBe(1);
        const checkpoint = await h.checkpoint();
        expect(checkpoint?.state.trackers.map((t) => t.serviceDate)).toEqual(["2026-10-15"]);
        expect(checkpoint?.state.previousDay).toMatchObject({ serviceDate: "2026-10-14", reduced: true });
    });

    it("finishes a day left reduced but not compacted before the first tick", async () => {
        await seedCheckpoint({ state: { previousDay: { serviceDate: "2026-10-13", reduced: true, revalidated: false, compacted: false } } });

        await h.run({ maxTicks: 1 });

        expect(h.finished).toEqual([{ serviceDate: "2026-10-13", reduced: true, revalidated: false, compacted: false }]);
        expect((await h.checkpoint())?.state.previousDay).toEqual({ serviceDate: "2026-10-13", reduced: true, revalidated: true, compacted: true });
    });

    it("leaves a previous day's finish to a later upload pass while one of its parts is still on disk", async () => {
        h = harness({ rawUploadFailsWhile: (now) => now < T0 + 30 * MINUTE });
        fs.writeFileSync(path.join(dir, `2026-10-13.20.${String(T0 - 20 * 60 * MINUTE).padStart(13, "0")}.ndjson`), '{"endpoint":"positions","pollEpoch":1}\n');
        await seedCheckpoint({ state: { previousDay: { serviceDate: "2026-10-13", reduced: true, revalidated: true, compacted: false } } });
        let partsInStoreAtFinish = -1;
        const hooks: LoopHooks = {
            ...h.hooks,
            finishDay: async (day) => {
                partsInStoreAtFinish = (await h.store.list(dayPartsPrefix(day.serviceDate))).length;
                return h.hooks.finishDay(day);
            },
        };

        await h.run({ maxTicks: 62, hooks }); // the hourly retry at tick 61 falls past the failure window

        expect(h.logged).not.toContain("uploaded 1 raw part(s) left on disk");
        expect(h.finished).toEqual([{ serviceDate: "2026-10-13", reduced: true, revalidated: true, compacted: false }]);
        expect(partsInStoreAtFinish).toBe(1);
        expect((await h.checkpoint())?.state.previousDay).toEqual({ serviceDate: "2026-10-13", reduced: true, revalidated: true, compacted: true });
    });

    it("exits when another machine's unreleased checkpoint is under three minutes old, and starts on a released one", async () => {
        await seedCheckpoint({ machineId: "other", writtenAt: T0 - MINUTE });
        expect(await h.run()).toEqual({ ticks: 0, exit: "held" });
        expect(h.source.positionsCalls).toBe(0);
        expect(h.logged[0]).toMatch(/^checkpoint held by machine other, written 60 s ago; exiting$/);

        await seedCheckpoint({ machineId: "other", writtenAt: T0 - MINUTE, released: true });
        expect((await h.run({ maxTicks: 1 })).exit).toBe("max-ticks");
        expect(h.source.positionsCalls).toBe(1);
        expect((await h.checkpoint())?.machineId).toBe(MACHINE);
    });

    it("takes over a stale checkpoint from another machine and keeps its state", async () => {
        await seedCheckpoint({ machineId: "other", writtenAt: T0 - 10 * MINUTE });
        await h.run({ maxTicks: 1 });
        expect((await h.checkpoint())?.state.quota.calls).toBe(1_237);
    });

    it("takes the lease before closing a day, so a second successor that read the same stale checkpoint closes nothing", async () => {
        h = harness({ start: parseChicagoLocal("2026-10-15 03:20:00") });
        await seedCheckpoint({ machineId: "old", writtenAt: h.clock.value - 10 * MINUTE });
        const stale = await h.store.get(CHECKPOINT_KEY);

        expect((await h.run({ maxTicks: 1 })).exit).toBe("max-ticks");
        expect(h.closed.map((t) => t.serviceDate)).toEqual(["2026-10-14"]);

        // A second instance that read the checkpoint before the first wrote it.
        const closedByB: string[] = [];
        const store: MemoryObjectStore = { ...h.store, get: async (key) => (key === CHECKPOINT_KEY ? stale : h.store.get(key)) };
        const result = await h.run({
            maxTicks: 1,
            store,
            machineId: "b",
            hooks: {
                ...h.hooks,
                onDayClose: async (tracker) => {
                    closedByB.push(tracker.serviceDate);
                    return { serviceDate: tracker.serviceDate, reduced: true, revalidated: true, compacted: true };
                },
            },
        });

        expect(result).toEqual({ ticks: 0, exit: "lost-lease" });
        expect(closedByB).toEqual([]);
        expect(h.closed).toHaveLength(1);
        expect(h.logged).toContain("checkpoint changed under us: another instance holds the day; exiting");
        expect((await h.checkpoint())?.machineId).toBe(MACHINE);
    });

    it("uploads raw parts left on disk before the first tick", async () => {
        fs.writeFileSync(path.join(dir, `2026-10-14.13.${String(T0 - 60 * MINUTE).padStart(13, "0")}.ndjson`), '{"endpoint":"positions","pollEpoch":1}\n');

        await h.run({ maxTicks: 1 });

        expect(h.logged).toContain("uploaded 1 raw part(s) left on disk");
        expect((await h.store.list(dayPartsPrefix("2026-10-14"))).map((p) => p.key)).toContain(`raw/v1/2026/10/2026-10-14/13.${String(T0 - 60 * MINUTE).padStart(13, "0")}.ndjson.gz`);
    });

    it("fails loud on worker state stamped with a version this build does not read, and writes nothing back", async () => {
        await seedCheckpoint({ state: { version: 2 as never } });

        await expect(h.run({ maxTicks: 1 })).rejects.toThrow("state/checkpoint.json.gz state is stamped version 2; this build reads version 1");

        expect(h.source.positionsCalls).toBe(0);
        const checkpoint = await h.checkpoint();
        expect(checkpoint).toMatchObject({ machineId: MACHINE, writtenAt: T0 - 2 * MINUTE, released: false });
        expect(checkpoint?.state.version).toBe(2);
    });
});

describe("days", () => {
    it("closes the fall-back day at 03:15 CST on 2026-11-01 and no earlier, from a checkpoint written before the stop marker existed", async () => {
        h = harness({ start: Date.parse("2026-11-01T09:14:00Z") }); // 03:14 CST
        const tracker = createDayTracker("2026-10-31");
        const legacy: Omit<WorkerState, "stoppedDays"> = { version: 1, trackers: [tracker], sweep: { openLive: {} }, quota: { chicagoDate: "2026-11-01", calls: 0, stopped: false, stopReason: null }, previousDay: null, ticks: 0 };
        await putCheckpoint(h.store, { version: 1, machineId: MACHINE, writtenAt: h.clock.value - MINUTE, released: false, state: legacy as WorkerState });

        await h.run({ maxTicks: 2 });

        expect(h.closed.map((t) => t.serviceDate)).toEqual(["2026-10-31"]);
        expect(h.logged.find((l) => l.startsWith("service day 2026-10-31 closed"))).toBeDefined();
        const closeTick = h.logged.findIndex((l) => l.startsWith("service day 2026-10-31 closed"));
        const firstTick = h.logged.findIndex((l) => l.startsWith("tick 1:"));
        expect(closeTick).toBeGreaterThan(firstTick); // the 03:14 tick ran first, the close came with the 03:15 tick
        expect((await h.checkpoint())?.state.stoppedDays).toEqual({});
    });

    it("waits for the feed's latest stop time when it runs past 03:00", async () => {
        h = harness({ start: parseChicagoLocal("2026-10-15 03:20:00") });
        await seedCheckpoint({ writtenAt: h.clock.value - MINUTE });

        await h.run({ maxTicks: 1, latestStopSeconds: () => 27 * 3600 + 40 * 60 }); // closes at 03:55
        expect(h.closed).toEqual([]);
    });

    it("reads the feed's latest stop time at each close, so a schedule refreshed while running moves the close", async () => {
        h = harness({ start: parseChicagoLocal("2026-10-15 03:20:00") });
        await seedCheckpoint({ writtenAt: h.clock.value - MINUTE });
        let latestStopSeconds: number | undefined = 27 * 3600 + 40 * 60; // closes at 03:55 ...
        h.source.onBeforeCall = () => {
            if (h.source.positionsCalls === 1) latestStopSeconds = undefined; // ... until the feed read after the first tick says 03:15
        };

        await h.run({ maxTicks: 2, latestStopSeconds: () => latestStopSeconds });

        expect(h.closed.map((t) => t.serviceDate)).toEqual(["2026-10-14"]);
        const closeLine = h.logged.findIndex((l) => l.startsWith("service day 2026-10-14 closed"));
        const firstTick = h.logged.findIndex((l) => l.startsWith("tick 11:"));
        expect(closeLine).toBeGreaterThan(firstTick);
    });

    it("serializes a closed day to the store before the close hook runs, and records nothing else without a reducer", async () => {
        await seedCheckpoint();
        h.clock.value = parseChicagoLocal("2026-10-15 03:20:00");
        let snapshotAtClose: boolean | null = null;
        await h.run({
            maxTicks: 1,
            hooks: {
                onDayClose: async (tracker) => {
                    snapshotAtClose = (await h.store.head(dayStateKey(tracker.serviceDate))) !== null;
                    return { serviceDate: tracker.serviceDate, reduced: false, revalidated: false, compacted: false };
                },
            },
        });
        expect(snapshotAtClose).toBe(true);
        const object = await h.store.get(dayStateKey("2026-10-14"));
        expect(object).not.toBeNull();
        const stored = JSON.parse(gunzipSync(object!.body).toString("utf8")) as TrackerState;
        expect(Object.keys(stored.slots)).toEqual(["41190|30228|red|x"]);
        expect((await h.checkpoint())?.state.previousDay).toEqual({ serviceDate: "2026-10-14", reduced: false, revalidated: false, compacted: false });

        // The default hooks: the same, with no reducer wired at all.
        await seedCheckpoint();
        await h.store.delete(dayStateKey("2026-10-14"));
        await h.run({ maxTicks: 1, hooks: {} });
        expect(await h.store.head(dayStateKey("2026-10-14"))).not.toBeNull();
        expect((await h.checkpoint())?.state.previousDay).toEqual({ serviceDate: "2026-10-14", reduced: false, revalidated: false, compacted: false });
    });

    it("fills the gap days after a close as well as at startup", async () => {
        h = harness({ start: parseChicagoLocal("2026-10-15 03:14:00") });
        await seedCheckpoint({ writtenAt: h.clock.value - MINUTE });

        await h.run({ maxTicks: 2 });

        expect(h.closed.map((t) => t.serviceDate)).toEqual(["2026-10-14"]);
        expect(h.gapFills).toEqual([parseChicagoLocal("2026-10-15 03:14:00"), parseChicagoLocal("2026-10-15 03:15:00")]);
    });

    it("uploads the day's last raw part before the close hook, so the compacted day object holds every line of the day", async () => {
        h = harness({ start: parseChicagoLocal("2026-10-15 01:50:00") });
        const compactions: CompactionResult[] = [];

        await h.run({ maxTicks: 90, hooks: compactingHooks(h, compactions) }); // 01:50 through 03:19

        expect(h.closeContexts.map((c) => [c.serviceDate, c.context.rawPending, c.context.stopReason])).toEqual([["2026-10-14", false, null]]);
        expect(h.logged.filter((l) => l.startsWith("raw part not uploaded"))).toEqual([]);
        // The 01:xx part went up when 02:00 closed it, the 02:xx part when 03:00 did: two parts, every line, in order.
        expect(compactions).toEqual([expect.objectContaining({ status: "compacted", parts: 2 })]);
        const appended = callsOn("2026-10-14");
        expect(appended).toHaveLength(70 * 3); // 01:50 through 02:59, three calls a tick
        expect((await readRawDay(h.store, "2026-10-14"))?.map((l) => l.pollEpoch)).toEqual(appended);
        expect(await h.store.head(dayObjectKey("2026-10-14"))).not.toBeNull();
        expect(await h.store.list(dayPartsPrefix("2026-10-14"))).toEqual([]);
        expect(h.finished).toEqual([]);
        expect((await h.checkpoint())?.state.previousDay).toEqual({ serviceDate: "2026-10-14", reduced: true, revalidated: true, compacted: true });
    });

    it("tells the hook when the day's last part is still on disk, and finishes the day once an upload pass has cleared it", async () => {
        // Raw uploads fail from 02:59 to 03:20: the part that closes at 03:00 and the retry at the 03:15 close both stay on disk.
        const failing = [parseChicagoLocal("2026-10-15 02:59:00"), parseChicagoLocal("2026-10-15 03:20:00")];
        h = harness({ start: parseChicagoLocal("2026-10-15 02:50:00"), rawUploadFailsWhile: (now) => now >= failing[0] && now < failing[1] });
        const compactions: CompactionResult[] = [];
        const hooks = compactingHooks(h, compactions);
        let partsInStoreAtFinish = -1;
        const finishDay = hooks.finishDay;
        hooks.finishDay = async (day) => {
            partsInStoreAtFinish = (await h.store.list(dayPartsPrefix(day.serviceDate))).length;
            return finishDay(day);
        };

        await h.run({ maxTicks: 65, hooks }); // 02:50 through 03:54: the hourly retry falls at 03:50

        expect(h.closeContexts.map((c) => [c.serviceDate, c.context.rawPending])).toEqual([["2026-10-14", true]]);
        expect(h.logged).toContain("2026-10-14: a raw part is still on disk; the day compacts once it is uploaded");
        expect(h.logged.filter((l) => l.startsWith("raw part not uploaded"))).toHaveLength(2);
        expect(h.finished).toEqual([{ serviceDate: "2026-10-14", reduced: true, revalidated: true, compacted: false }]);
        expect(partsInStoreAtFinish).toBe(1);
        expect(compactions).toEqual([expect.objectContaining({ status: "compacted", parts: 1 })]);
        const appended = callsOn("2026-10-14");
        expect(appended).toHaveLength(10 * 3);
        expect((await readRawDay(h.store, "2026-10-14"))?.map((l) => l.pollEpoch)).toEqual(appended);
        expect((await h.checkpoint())?.state.previousDay).toEqual({ serviceDate: "2026-10-14", reduced: true, revalidated: true, compacted: true });
    });
});

describe("shutdown and the lease", () => {
    it("finishes the tick on SIGTERM, uploads the open part, and releases the checkpoint", async () => {
        h.source.onBeforeCall = () => {
            if (h.source.arrivalsCalls.length === 1) h.controller.abort();
        };

        const result = await h.run({ maxTicks: 10 });

        expect(result).toEqual({ ticks: 1, exit: "stopped" });
        expect(h.source.arrivalsCalls).toHaveLength(2); // the tick finished its sweep
        expect(fs.readdirSync(dir)).toEqual([]);
        expect(await h.store.list(dayPartsPrefix("2026-10-14"))).toHaveLength(1);
        expect((await h.checkpoint())?.released).toBe(true);
        expect(h.logged.at(-1)).toBe("stopped after 1 tick(s); checkpoint released");
    });

    it("ends the sleep between ticks on SIGTERM, uploads the open part, and releases the checkpoint", async () => {
        // The sleep stays pending until the signal aborts, as the real one does; SIGTERM lands a few ms into it.
        const waits: number[] = [];
        const result = await h.run({
            maxTicks: 10,
            sleep: (ms, signal) =>
                new Promise<void>((_, reject) => {
                    waits.push(ms);
                    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
                    setTimeout(() => h.controller.abort(), 5);
                }),
        });

        expect(result).toEqual({ ticks: 1, exit: "stopped" });
        expect(waits).toHaveLength(1);
        expect(waits[0]).toBeGreaterThan(0);
        expect(h.source.positionsCalls).toBe(1);
        expect(fs.readdirSync(dir)).toEqual([]);
        const first = h.calls[0].pollEpoch;
        expect((await h.store.list(dayPartsPrefix("2026-10-14"))).map((p) => p.key)).toEqual([partKey("2026-10-14", hourIndexOf("2026-10-14", first), first)]);
        expect((await h.checkpoint())?.released).toBe(true);
        expect(h.logged.at(-1)).toBe("stopped after 1 tick(s); checkpoint released");
    });

    it("does the same with the real timer between ticks, which the signal ends at once", async () => {
        // No injected sleep: the loop waits on node:timers/promises for the near-minute the fake
        // clock computes, and a real AbortController fires 30 ms into that wait.
        const started = Date.now();
        const result = await h.run({
            maxTicks: 10,
            sleep: undefined,
            log: (m) => {
                h.logged.push(m);
                if (m.startsWith("tick 1:")) setTimeout(() => h.controller.abort(), 30);
            },
        });

        expect(result).toEqual({ ticks: 1, exit: "stopped" });
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(h.source.positionsCalls).toBe(1);
        expect(fs.readdirSync(dir)).toEqual([]);
        expect(await h.store.list(dayPartsPrefix("2026-10-14"))).toHaveLength(1);
        expect((await h.checkpoint())?.released).toBe(true);
        expect(h.logged.at(-1)).toBe("stopped after 1 tick(s); checkpoint released");
    });

    it("exits without overwriting when the checkpoint changed under it", async () => {
        h.source.onBeforeCall = () => {
            if (h.source.positionsCalls === 2 && h.source.arrivalsCalls.length === 2) {
                void putCheckpoint(h.store, {
                    version: 1,
                    machineId: "other",
                    writtenAt: h.clock.value,
                    released: false,
                    state: { version: 1, trackers: [], sweep: { openLive: {} }, quota: { chicagoDate: "2026-10-14", calls: 0, stopped: false, stopReason: null }, stoppedDays: {}, previousDay: null, ticks: 99 },
                });
            }
        };

        const result = await h.run({ maxTicks: 5 });

        expect(result).toEqual({ ticks: 2, exit: "lost-lease" });
        expect((await h.checkpoint())?.machineId).toBe("other");
        expect(h.logged).toContain("checkpoint changed under us: another instance holds the day; exiting");
        expect(await h.store.get(CHECKPOINT_KEY)).not.toBeNull();
    });
});
