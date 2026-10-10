import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataDir, machineId, openStationIds, parseWorkerArgs, summarizeCalls } from "../../scripts/live-worker";
import { readR2Env } from "@/lib/live/objectStore";
import { readTrainTrackerKey, type RawCall } from "@/lib/live/trainTracker";

describe("parseWorkerArgs", () => {
    it("runs the worker with no arguments and one check per flag", () => {
        expect(parseWorkerArgs([])).toEqual({ mode: "run" });
        expect(parseWorkerArgs(["--once"])).toEqual({ mode: "once" });
        expect(parseWorkerArgs(["--gtfs-check"])).toEqual({ mode: "gtfs-check" });
        expect(parseWorkerArgs(["--store-check"])).toEqual({ mode: "store-check" });
    });

    it("refuses two checks at once and unknown flags", () => {
        expect(() => parseWorkerArgs(["--once", "--gtfs-check"])).toThrow(/choose one/);
        expect(() => parseWorkerArgs(["--reconcile"])).toThrow();
        expect(() => parseWorkerArgs(["once"])).toThrow();
    });
});

describe("the environment", () => {
    it("reads the four R2 variables and names the missing ones", () => {
        expect(readR2Env({ R2_ACCOUNT_ID: "acct", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s " })).toEqual({
            accountId: "acct",
            bucket: "b",
            accessKeyId: "k",
            secretAccessKey: "s",
        });
        expect(() => readR2Env({ R2_ACCOUNT_ID: "acct" })).toThrow("R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set");
    });

    it("requires the Train Tracker key from the shell, never .env.local", () => {
        expect(readTrainTrackerKey({ CTA_TRAIN_TRACKER_KEY: " abc " })).toBe("abc");
        expect(() => readTrainTrackerKey({})).toThrow(/not read from \.env\.local/);
    });

    it("defaults the data directory to the temp directory and the machine id to the host and pid", () => {
        expect(dataDir({})).toBe(path.join(os.tmpdir(), "ghost-stops-live"));
        expect(dataDir({ LIVE_WORKER_DATA_DIR: "/var/lib/ghost-stops" })).toBe("/var/lib/ghost-stops");
        expect(machineId({ FLY_MACHINE_ID: "e784e1" })).toBe("e784e1");
        expect(machineId({})).toBe(`${os.hostname()}-${process.pid}`);
    });
});

describe("openStationIds", () => {
    it("leaves out a station closed on the day, which Train Tracker answers 103 for", () => {
        expect(openStationIds("2026-10-14")).toHaveLength(143);
        expect(openStationIds("2026-10-14")).not.toContain("40260"); // State/Lake, closed since 2026-01-05
        expect(openStationIds("2025-12-01")).toContain("40260");
        expect(openStationIds("2023-06-01")).not.toContain("40770"); // Lawrence, during the rebuild
    });
});

describe("summarizeCalls", () => {
    const call = (overrides: Partial<RawCall>): RawCall => ({
        endpoint: "arrivals",
        pollEpoch: 1,
        stationIds: ["40900"],
        httpStatus: 200,
        body: "x".repeat(100),
        errorCode: 0,
        failure: null,
        durationMs: 120,
        ...overrides,
    });

    it("reports counts, sizes, and averages per endpoint, and names failures", () => {
        const lines = summarizeCalls([
            call({ endpoint: "positions", stationIds: [], body: "p".repeat(30_000), durationMs: 300 }),
            call({ body: "a".repeat(20_000), durationMs: 100 }),
            call({ body: "a".repeat(10_000), durationMs: 200 }),
            call({ body: null, httpStatus: null, errorCode: null, failure: "timeout", durationMs: 10_000 }),
        ]);
        expect(lines).toEqual([
            "positions: 1 call(s), 1 answered errCd 0, bodies 30000 to 30000 bytes (30000 total), 300 ms average",
            "arrivals: 3 call(s), 2 answered errCd 0, bodies 0 to 20000 bytes (30000 total), 3433 ms average",
            "failed: arrivals timeout",
        ]);
    });

    it("says nothing about an endpoint that was never called", () => {
        expect(summarizeCalls([call({ endpoint: "positions" })])).toHaveLength(1);
    });
});
