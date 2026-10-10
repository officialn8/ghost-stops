import { describe, expect, it } from "vitest";
import { assessTrains, CHECKPOINT_STALE_MS, readTrainHealthInputs, trainsFail, type TrainHealthInputs } from "./health";
import { createMemoryObjectStore } from "./objectStore";
import { putCheckpoint } from "./rawStore";

// 2026-10-16 08:21 Chicago (13:21Z): service day 2026-10-16, after yesterday's 03:15 close.
const NOW = new Date("2026-10-16T13:21:00Z");
const MINUTE = 60_000;

const inputs = (overrides: Partial<TrainHealthInputs> = {}): TrainHealthInputs => ({
    latestDay: "2026-10-15",
    observedThrough: "2026-10-15",
    checkpointAgeMs: 3 * MINUTE,
    ...overrides,
});

describe("assessTrains", () => {
    it("is ok with a three-minute-old checkpoint and yesterday's day", () => {
        expect(assessTrains(inputs(), NOW)).toEqual({ status: "ok", observedThrough: "2026-10-15", latestDay: "2026-10-15", checkpointAgeMinutes: 3 });
        expect(trainsFail(assessTrains(inputs(), NOW))).toBe(false);
    });

    it("is not-started before any LiveDay row, whatever the checkpoint says", () => {
        expect(assessTrains(inputs({ latestDay: null, observedThrough: null, checkpointAgeMs: null }), NOW).status).toBe("not-started");
        expect(assessTrains(inputs({ latestDay: null, observedThrough: null, checkpointAgeMs: "unreadable" }), NOW).status).toBe("not-started");
        expect(assessTrains(inputs({ latestDay: null, observedThrough: null, checkpointAgeMs: 2 * MINUTE }), NOW).status).toBe("not-started");
        expect(trainsFail(assessTrains(inputs({ latestDay: null, observedThrough: null }), NOW))).toBe(false);
    });

    it("is stale when the checkpoint is older than 45 minutes, missing, or unreadable", () => {
        expect(assessTrains(inputs({ checkpointAgeMs: 50 * MINUTE }), NOW)).toMatchObject({ status: "trains-stale", checkpointAgeMinutes: 50 });
        expect(assessTrains(inputs({ checkpointAgeMs: CHECKPOINT_STALE_MS }), NOW).status).toBe("ok");
        expect(assessTrains(inputs({ checkpointAgeMs: null }), NOW)).toMatchObject({ status: "trains-stale", checkpointAgeMinutes: null });
        expect(assessTrains(inputs({ checkpointAgeMs: "unreadable" }), NOW)).toMatchObject({ status: "trains-stale", checkpointAgeMinutes: null });
        expect(trainsFail(assessTrains(inputs({ checkpointAgeMs: null }), NOW))).toBe(true);
    });

    it("is unreduced when the latest day is more than two service days old, with a fresh checkpoint", () => {
        expect(assessTrains(inputs({ latestDay: "2026-10-14" }), NOW).status).toBe("ok"); // one night missed
        expect(assessTrains(inputs({ latestDay: "2026-10-13", observedThrough: "2026-10-13" }), NOW)).toMatchObject({ status: "trains-unreduced", latestDay: "2026-10-13" });
        // A set-aside latest day still counts as reduced; observedThrough names the last counted one.
        expect(assessTrains(inputs({ latestDay: "2026-10-15", observedThrough: "2026-10-12" }), NOW).status).toBe("ok");
    });

    it("reports a stale checkpoint before an unreduced day", () => {
        expect(assessTrains(inputs({ latestDay: "2026-10-10", checkpointAgeMs: 90 * MINUTE }), NOW).status).toBe("trains-stale");
    });
});

describe("readTrainHealthInputs", () => {
    const db = (rows: { serviceDate: string; verdict: "COUNTED" | "SET_ASIDE" }[]) => ({
        liveDay: {
            findFirst: async (args: { where?: { verdict?: string } }) => {
                const matching = rows.filter((r) => !args.where?.verdict || r.verdict === args.where.verdict).sort((a, b) => (a.serviceDate < b.serviceDate ? 1 : -1));
                return matching[0] ? { serviceDate: new Date(`${matching[0].serviceDate}T00:00:00Z`) } : null;
            },
        },
    });

    it("reads the latest day, the latest counted day, and the checkpoint's age", async () => {
        const store = createMemoryObjectStore({ now: () => NOW.getTime() - 4 * MINUTE });
        await putCheckpoint(store, { version: 1, machineId: "m", writtenAt: 0, released: false, state: {} });

        const result = await readTrainHealthInputs(db([{ serviceDate: "2026-10-14", verdict: "COUNTED" }, { serviceDate: "2026-10-15", verdict: "SET_ASIDE" }]) as never, store, NOW);
        expect(result).toEqual({ latestDay: "2026-10-15", observedThrough: "2026-10-14", checkpointAgeMs: 4 * MINUTE });
    });

    it("reports a missing checkpoint as null, a failing bucket as unreadable, and no store as unreadable", async () => {
        const rows = db([{ serviceDate: "2026-10-15", verdict: "COUNTED" }]) as never;
        expect((await readTrainHealthInputs(rows, createMemoryObjectStore(), NOW)).checkpointAgeMs).toBeNull();

        const failing = createMemoryObjectStore();
        failing.failNext(1, 403);
        expect((await readTrainHealthInputs(rows, failing, NOW)).checkpointAgeMs).toBe("unreadable");

        expect((await readTrainHealthInputs(rows, null, NOW)).checkpointAgeMs).toBe("unreadable");
    });

    it("reads nulls before the first row", async () => {
        expect(await readTrainHealthInputs(db([]) as never, createMemoryObjectStore(), NOW)).toEqual({ latestDay: null, observedThrough: null, checkpointAgeMs: null });
    });
});
