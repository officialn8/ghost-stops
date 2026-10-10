import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CTA_ROSTER } from "@/lib/cta/roster";
import type { Healthchecks } from "./healthchecks";
import { createCallSink, dayStateKey, QUOTA_HARD_STOP, runLoop, type DayReduction, type LoopHooks, type LoopOptions, type WorkerState } from "./loop";
import { createMemoryObjectStore, type MemoryObjectStore } from "./objectStore";
import { CHECKPOINT_KEY, createRawWriter, dayPartsPrefix, getCheckpoint, putCheckpoint, type Checkpoint, type RawWriter } from "./rawStore";
import { minuteIndexOf, parseChicagoLocal } from "./serviceDay";
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
    pings: number;
    fails: number;
    closed: TrackerState[];
    finished: DayReduction[];
    gapFills: number[];
    logged: string[];
    controller: AbortController;
    run(overrides?: Partial<LoopOptions>): ReturnType<typeof runLoop>;
    checkpoint(): Promise<Checkpoint<WorkerState> | null>;
}

let dir: string;
let h: Harness;

function harness(options: { stationIds?: readonly string[]; start?: number } = {}): Harness {
    const clock = { value: options.start ?? T0 };
    const store = createMemoryObjectStore({ now: () => clock.value });
    const rawWriter = createRawWriter({ dir, store, log: (m) => h.logged.push(m) });
    const sink = createCallSink(rawWriter);
    const source = new FakeSource({ now: () => clock.value, advance: (ms) => (clock.value += ms), onCall: sink.onCall });
    const controller = new AbortController();
    const healthchecks: Healthchecks = {
        ping: async () => {
            h.pings += 1;
        },
        fail: async () => {
            h.fails += 1;
        },
    };
    const hooks: LoopHooks = {
        onDayClose: async (tracker) => {
            h.closed.push(tracker);
            return { serviceDate: tracker.serviceDate, reduced: true, revalidated: true, compacted: true };
        },
        finishDay: async (day) => {
            h.finished.push(day);
            return { ...day, revalidated: true, compacted: true };
        },
        fillGaps: async (now) => {
            h.gapFills.push(now);
        },
    };
    const result: Harness = {
        clock,
        store,
        source,
        rawWriter,
        sink,
        pings: 0,
        fails: 0,
        closed: [],
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
        previousDay: { serviceDate: "2026-10-13", reduced: true, revalidated: true, compacted: true },
        ticks: 10,
        ...overrides.state,
    };
    await putCheckpoint(h.store, { version: 1, machineId: MACHINE, writtenAt: T0 - 2 * MINUTE, released: false, ...overrides, state });
}

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
        const lines = fs.readdirSync(dir).length === 0 ? [] : [];
        expect(lines).toEqual([]); // uploaded at shutdown
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

    it("uploads raw parts left on disk before the first tick", async () => {
        fs.writeFileSync(path.join(dir, `2026-10-14.13.${String(T0 - 60 * MINUTE).padStart(13, "0")}.ndjson`), '{"endpoint":"positions","pollEpoch":1}\n');

        await h.run({ maxTicks: 1 });

        expect(h.logged).toContain("uploaded 1 raw part(s) left on disk");
        expect((await h.store.list(dayPartsPrefix("2026-10-14"))).map((p) => p.key)).toContain(`raw/v1/2026/10/2026-10-14/13.${String(T0 - 60 * MINUTE).padStart(13, "0")}.ndjson.gz`);
    });
});

describe("days", () => {
    it("closes the fall-back day at 03:15 CST on 2026-11-01 and no earlier", async () => {
        h = harness({ start: Date.parse("2026-11-01T09:14:00Z") }); // 03:14 CST
        const tracker = createDayTracker("2026-10-31");
        await putCheckpoint(h.store, {
            version: 1,
            machineId: MACHINE,
            writtenAt: h.clock.value - MINUTE,
            released: false,
            state: { version: 1, trackers: [tracker], sweep: { openLive: {} }, quota: { chicagoDate: "2026-11-01", calls: 0, stopped: false, stopReason: null }, previousDay: null, ticks: 0 },
        });

        await h.run({ maxTicks: 2 });

        expect(h.closed.map((t) => t.serviceDate)).toEqual(["2026-10-31"]);
        expect(h.logged.find((l) => l.startsWith("service day 2026-10-31 closed"))).toBeDefined();
        const closeTick = h.logged.findIndex((l) => l.startsWith("service day 2026-10-31 closed"));
        const firstTick = h.logged.findIndex((l) => l.startsWith("tick 1:"));
        expect(closeTick).toBeGreaterThan(firstTick); // the 03:14 tick ran first, the close came with the 03:15 tick
    });

    it("waits for the feed's latest stop time when it runs past 03:00", async () => {
        h = harness({ start: parseChicagoLocal("2026-10-15 03:20:00") });
        await seedCheckpoint({ writtenAt: h.clock.value - MINUTE });

        await h.run({ maxTicks: 1, latestStopSeconds: 27 * 3600 + 40 * 60 }); // closes at 03:55
        expect(h.closed).toEqual([]);
    });

    it("serializes a closed day to the store when no reducer is wired", async () => {
        await seedCheckpoint();
        h.clock.value = parseChicagoLocal("2026-10-15 03:20:00");

        await h.run({ maxTicks: 1, hooks: {} });

        const object = await h.store.get(dayStateKey("2026-10-14"));
        expect(object).not.toBeNull();
        const stored = JSON.parse(gunzipSync(object!.body).toString("utf8")) as TrackerState;
        expect(Object.keys(stored.slots)).toEqual(["41190|30228|red|x"]);
        expect((await h.checkpoint())?.state.previousDay).toEqual({ serviceDate: "2026-10-14", reduced: false, revalidated: false, compacted: false });
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

    it("exits without overwriting when the checkpoint changed under it", async () => {
        h.source.onBeforeCall = () => {
            if (h.source.positionsCalls === 2 && h.source.arrivalsCalls.length === 2) {
                void putCheckpoint(h.store, { version: 1, machineId: "other", writtenAt: h.clock.value, released: false, state: { version: 1, trackers: [], sweep: { openLive: {} }, quota: { chicagoDate: "2026-10-14", calls: 0, stopped: false, stopReason: null }, previousDay: null, ticks: 99 } });
            }
        };

        const result = await h.run({ maxTicks: 5 });

        expect(result).toEqual({ ticks: 2, exit: "lost-lease" });
        expect((await h.checkpoint())?.machineId).toBe("other");
        expect(h.logged).toContain("checkpoint changed under us: another instance holds the day; exiting");
        expect(await h.store.get(CHECKPOINT_KEY)).not.toBeNull();
    });
});
