import { describe, expect, it } from "vitest";
import recordedArrivals from "@/test/fixtures/trains/arrivals-2026-10-09.json";
import recordedPositions from "@/test/fixtures/trains/positions-2026-10-09.json";
import type { RawLine } from "./rawStore";
import { groupTicks, replayRawLines } from "./replay";
import { minuteIndexOf, parseChicagoLocal } from "./serviceDay";

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

    it("lists the stations of a batch the worker passed over as not polled, from its not-requested line", () => {
        const replay = replayRawLines([
            line("positions", T0, recordedPositions),
            line("arrivals", T0 + 100, recordedArrivals, ["40900", "40380", "40830", "41680"]),
            { ...line("arrivals", T0 + 200, null, ["40010", "40020"]), httpStatus: null, errorCode: null, failure: "not-requested", durationMs: 0 },
        ]);
        const day = replay.trackers.get("2026-10-09")!;
        expect(Object.values(day.minutes)[0]).toMatchObject({ p: 1, f: ["40010", "40020"] });
        expect(replay.unparsed).toBe(0);
    });

    it("carries the polls after 03:00 into the earlier day: its ledger past minute 1440 and a passage that vanished then", () => {
        // A Red Line train approaching Howard at 02:58, predicted for 02:59, gone from the board at 03:01.
        const eta = {
            staId: "40900",
            stpId: "30173",
            staNm: "Howard",
            stpDe: "Service toward 95th/Dan Ryan",
            rn: "901",
            rt: "Red",
            destSt: "30089",
            destNm: "95th/Dan Ryan",
            trDr: "5",
            prdt: "2026-10-15T02:58:05",
            arrT: "2026-10-15T02:59:00",
            isApp: "1",
            isSch: "0",
            isDly: "0",
            isFlt: "0",
            flags: null,
            lat: "42.01881",
            lon: "-87.67311",
            heading: "180",
        };
        const arrivals = (tmst: string, etas: unknown[]) => ({ ctatt: { tmst, errCd: "0", errNm: null, eta: etas } });
        const t1 = parseChicagoLocal("2026-10-15 02:58:00");
        const t2 = parseChicagoLocal("2026-10-15 03:01:00");

        const replay = replayRawLines([
            line("positions", t1, recordedPositions),
            line("arrivals", t1 + 300, arrivals("2026-10-15T02:57:58", [eta]), ["40900"]),
            line("positions", t2, recordedPositions),
            line("arrivals", t2 + 300, arrivals("2026-10-15T03:00:58", []), ["40900"]),
        ]);

        expect([...replay.trackers.keys()].sort()).toEqual(["2026-10-14", "2026-10-15"]);
        const earlier = replay.trackers.get("2026-10-14")!;
        expect(Object.keys(earlier.minutes).map(Number).sort((a, b) => a - b)).toEqual([minuteIndexOf("2026-10-14", t1), minuteIndexOf("2026-10-14", t2)]);
        expect(minuteIndexOf("2026-10-14", t2)).toBe(1441);
        expect(earlier.passages).toEqual([expect.objectContaining({ stationId: "40900", run: "901", arrivedAt: parseChicagoLocal("2026-10-15 02:59:00"), lastSeen: t1, vanishedAt: t2 })]);
        expect(replay.trackers.get("2026-10-15")!.passages).toEqual([]);
    });
});
