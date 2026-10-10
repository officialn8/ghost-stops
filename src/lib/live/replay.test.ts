import { describe, expect, it } from "vitest";
import recordedArrivals from "@/test/fixtures/trains/arrivals-2026-10-09.json";
import recordedPositions from "@/test/fixtures/trains/positions-2026-10-09.json";
import type { RawLine } from "./rawStore";
import { groupTicks, replayRawLines } from "./replay";
import { parseChicagoLocal } from "./serviceDay";

const T0 = parseChicagoLocal("2026-10-09 22:27:20");
const MINUTE = 60_000;

const line = (endpoint: RawLine["endpoint"], pollEpoch: number, body: unknown, stationIds: string[] = [], errorCode = 0): RawLine => ({
    endpoint,
    pollEpoch,
    stationIds,
    httpStatus: 200,
    body: body === null ? null : JSON.stringify(body),
    errorCode,
    failure: errorCode === 0 ? null : "api",
    durationMs: 100,
});

describe("groupTicks", () => {
    it("starts a tick at each positions line and keeps its arrivals batches with it, in time order", () => {
        const ticks = groupTicks([
            line("arrivals", T0 + MINUTE + 500, recordedArrivals, ["40900"]),
            line("positions", T0 + MINUTE, recordedPositions),
            line("arrivals", T0 + 400, recordedArrivals, ["40900"]),
            line("positions", T0, recordedPositions),
        ]);
        expect(ticks.map((t) => t.map((l) => l.endpoint))).toEqual([["positions", "arrivals"], ["positions", "arrivals"]]);
    });
});

describe("replayRawLines", () => {
    it("rebuilds the tracker from the recording: a ledger line, slots for the schedule-only entries, open live predictions", () => {
        const stations = ["40900", "40380", "40830", "41680"];
        const replay = replayRawLines([line("positions", T0, recordedPositions), line("arrivals", T0 + 300, recordedArrivals, stations)]);

        expect(replay.ticks).toBe(1);
        expect(replay.unparsed).toBe(0);
        const day = replay.trackers.get("2026-10-09")!;
        expect(Object.keys(day.minutes)).toHaveLength(1);
        expect(Object.values(day.minutes)[0]).toMatchObject({ p: 1, f: [], t: [17, 19, 8, 9, 5, 1, 5, 0] });
        // 13 schedule-only predictions, several on one platform at Howard with the same time collapse by minute.
        expect(Object.keys(day.slots).length).toBeGreaterThan(0);
        expect(Object.keys(day.slots).length).toBeLessThanOrEqual(13);
        expect(day.passages).toEqual([]);
    });

    it("treats a failed call as a failed call and an unparsable body as unparsed", () => {
        const replay = replayRawLines([
            line("positions", T0, null, [], 900),
            line("arrivals", T0 + 100, { ctatt: { errCd: "0", tmst: "2026-10-09T22:27:16" } }, ["40900"]),
            line("arrivals", T0 + 200, null, ["40380"], 103),
            { ...line("arrivals", T0 + 300, null, ["40830"]), body: "not json" },
        ]);
        const day = replay.trackers.get("2026-10-09")!;
        expect(Object.values(day.minutes)[0]).toMatchObject({ p: 0, f: ["40380", "40830"], t: null });
        expect(replay.unparsed).toBe(1);
    });
});
