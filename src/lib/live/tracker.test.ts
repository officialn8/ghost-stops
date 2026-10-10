import { describe, expect, it } from "vitest";
import { parseChicagoLocal } from "./serviceDay";
import {
    applyTick,
    createDayTracker,
    createSweepState,
    hasGap,
    ledgerSummary,
    minuteIndexOf,
    slotKey,
    stationPolls,
    type TickInput,
    type TrackerState,
} from "./tracker";
import type { ArrivalPrediction, PositionsResponse, TrainRoute } from "./trainTracker";

const MINUTE = 60_000;
const T0 = parseChicagoLocal("2026-10-14 17:00:00");
const JARVIS = "41190";
const SOUTH = "30228";
const NORTH = "30227";

function prediction(overrides: Partial<ArrivalPrediction> & { arrivalAt: number }): ArrivalPrediction {
    return {
        stationId: JARVIS,
        stopId: SOUTH,
        stationName: "Jarvis",
        platform: "Service toward 95th/Dan Ryan",
        run: "901",
        route: "red",
        destinationStopId: overrides.scheduled ? "0" : "30089",
        destinationName: "95th/Dan Ryan",
        direction: 5,
        predictedAt: overrides.arrivalAt - MINUTE,
        arrivalText: "x",
        approaching: false,
        scheduled: false,
        fault: false,
        delayed: false,
        lat: null,
        lon: null,
        heading: null,
        ...overrides,
    };
}

function positions(counts: Partial<Record<TrainRoute, number>> = {}): PositionsResponse {
    const routes: TrainRoute[] = ["red", "blue", "brn", "g", "org", "p", "pink", "y"];
    return {
        generatedAt: T0,
        pollEpoch: T0,
        malformed: 0,
        routes: routes.map((route) => ({ route, trains: Array.from({ length: counts[route] ?? 0 }, () => ({}) as never) })),
    };
}

function tick(pollEpoch: number, predictions: ArrivalPrediction[], options: { failed?: string[]; positions?: PositionsResponse | null; stations?: string[] } = {}): TickInput {
    const stations = options.stations ?? [JARVIS];
    const failed = new Set(options.failed ?? []);
    return {
        pollEpoch,
        positions: options.positions === undefined ? positions({ red: 3 }) : options.positions,
        arrivals: stations.map((stationId) => ({
            stationIds: [stationId],
            response: failed.has(stationId)
                ? null
                : { generatedAt: pollEpoch, pollEpoch, stationIds: [stationId], malformed: 0, predictions: predictions.filter((p) => p.stationId === stationId) },
        })),
    };
}

function harness() {
    const trackers = new Map<string, TrackerState>();
    const sweep = createSweepState();
    const trackerFor = (date: string) => {
        let tracker = trackers.get(date);
        if (!tracker) {
            tracker = createDayTracker(date);
            trackers.set(date, tracker);
        }
        return tracker;
    };
    const apply = (input: TickInput) => applyTick(sweep, trackerFor, input);
    return { trackers, sweep, trackerFor, apply, day: () => trackerFor("2026-10-14") };
}

describe("slots", () => {
    it("opens a slot for a schedule-only prediction and keeps its first and last sightings and its runs", () => {
        const h = harness();
        const scheduledAt = T0 + 8 * MINUTE;
        h.apply(tick(T0, [prediction({ scheduled: true, run: "901", arrivalAt: scheduledAt, arrivalText: "2026-10-14T17:08:00" })]));
        h.apply(tick(T0 + MINUTE, [prediction({ scheduled: true, run: "903", arrivalAt: scheduledAt + 20_000, fault: true })]));

        const key = slotKey(JARVIS, SOUTH, "red", scheduledAt);
        expect(Object.keys(h.day().slots)).toEqual([key]);
        expect(h.day().slots[key]).toEqual({
            key,
            stationId: JARVIS,
            stopId: SOUTH,
            route: "red",
            scheduledAt,
            scheduledText: "2026-10-14T17:08:00",
            firstSeen: T0,
            lastSeen: T0 + MINUTE,
            runs: ["901", "903"],
            fault: true,
            liveSameRunAt: null,
        });
        expect(h.day().passages).toEqual([]);
        expect(Object.keys(h.sweep.openLive)).toEqual([]);
    });

    it("gives a run number that reappears on another route or platform its own slot (AE13)", () => {
        const h = harness();
        h.apply(tick(T0, [prediction({ scheduled: true, run: "901", arrivalAt: T0 + 5 * MINUTE })]));
        h.apply(tick(T0 + 30 * MINUTE, [prediction({ scheduled: true, run: "901", stopId: NORTH, arrivalAt: T0 + 40 * MINUTE })]));
        h.apply(tick(T0 + 31 * MINUTE, [prediction({ scheduled: true, run: "901", route: "p", stopId: NORTH, arrivalAt: T0 + 40 * MINUTE })]));

        expect(Object.keys(h.day().slots)).toEqual([
            slotKey(JARVIS, SOUTH, "red", T0 + 5 * MINUTE),
            slotKey(JARVIS, NORTH, "red", T0 + 40 * MINUTE),
            slotKey(JARVIS, NORTH, "p", T0 + 40 * MINUTE),
        ]);
        expect(h.day().slots[slotKey(JARVIS, SOUTH, "red", T0 + 5 * MINUTE)].lastSeen).toBe(T0);
    });

    it("notes when a live prediction with one of the slot's runs shows at the slot's platform", () => {
        const h = harness();
        const scheduledAt = T0 + 6 * MINUTE;
        h.apply(tick(T0, [prediction({ scheduled: true, run: "901", arrivalAt: scheduledAt })]));
        h.apply(tick(T0 + MINUTE, [prediction({ run: "901", stopId: NORTH, arrivalAt: scheduledAt + MINUTE })])); // other platform
        expect(h.day().slots[slotKey(JARVIS, SOUTH, "red", scheduledAt)].liveSameRunAt).toBeNull();

        h.apply(tick(T0 + 2 * MINUTE, [prediction({ run: "901", arrivalAt: scheduledAt + 3 * MINUTE })]));
        expect(h.day().slots[slotKey(JARVIS, SOUTH, "red", scheduledAt)].liveSameRunAt).toBe(T0 + 2 * MINUTE);
    });
});

describe("passages", () => {
    it("logs a passage when a live prediction that was near vanishes from a polled board, and opens no slot", () => {
        const h = harness();
        h.apply(tick(T0, [prediction({ run: "902", arrivalAt: T0 + 6 * MINUTE })]));
        h.apply(tick(T0 + 4 * MINUTE, [prediction({ run: "902", arrivalAt: T0 + 6 * MINUTE + 10_000 })]));
        h.apply(tick(T0 + 5 * MINUTE, [prediction({ run: "902", arrivalAt: T0 + 6 * MINUTE + 30_000, approaching: true })]));
        expect(h.day().passages).toEqual([]);
        expect(Object.keys(h.sweep.openLive)).toHaveLength(1);

        h.apply(tick(T0 + 7 * MINUTE, []));
        expect(h.day().passages).toEqual([
            { stationId: JARVIS, stopId: SOUTH, route: "red", run: "902", arrivedAt: T0 + 6 * MINUTE + 30_000, lastSeen: T0 + 5 * MINUTE, vanishedAt: T0 + 7 * MINUTE },
        ]);
        expect(h.day().slots).toEqual({});
        expect(h.sweep.openLive).toEqual({});
    });

    it("counts an arrival within two minutes of the poll as near, even without the approaching flag", () => {
        const h = harness();
        h.apply(tick(T0, [prediction({ run: "904", arrivalAt: T0 + 2 * MINUTE })]));
        h.apply(tick(T0 + MINUTE, []));
        expect(h.day().passages).toHaveLength(1);
    });

    it("drops a live prediction that vanishes while still far off, with no passage", () => {
        const h = harness();
        h.apply(tick(T0, [prediction({ run: "905", arrivalAt: T0 + 15 * MINUTE })]));
        h.apply(tick(T0 + MINUTE, []));
        expect(h.day().passages).toEqual([]);
        expect(h.sweep.openLive).toEqual({});
    });

    it("keeps a board's open predictions when its batch failed, deciding at the next successful poll", () => {
        const h = harness();
        h.apply(tick(T0, [prediction({ run: "906", arrivalAt: T0 + MINUTE, approaching: true })]));
        h.apply(tick(T0 + MINUTE, [], { failed: [JARVIS] }));
        expect(h.day().passages).toEqual([]);
        expect(Object.keys(h.sweep.openLive)).toHaveLength(1);

        h.apply(tick(T0 + 2 * MINUTE, []));
        expect(h.day().passages).toHaveLength(1);
        expect(h.day().passages[0]).toMatchObject({ lastSeen: T0, vanishedAt: T0 + 2 * MINUTE });
    });

    it("keeps a prediction that moved from near back to far open until it vanishes", () => {
        const h = harness();
        h.apply(tick(T0, [prediction({ run: "907", arrivalAt: T0 + MINUTE, approaching: true })]));
        h.apply(tick(T0 + MINUTE, [prediction({ run: "907", arrivalAt: T0 + 9 * MINUTE })])); // delayed, re-predicted
        h.apply(tick(T0 + 2 * MINUTE, []));
        expect(h.day().passages[0]).toMatchObject({ arrivedAt: T0 + 9 * MINUTE });
    });
});

describe("the ledger", () => {
    it("records each minute's positions call, failed stations, and live trains per route", () => {
        const h = harness();
        h.apply(tick(T0, [], { stations: [JARVIS, "40900"], failed: ["40900"], positions: positions({ red: 17, y: 0, p: 1 }) }));
        h.apply(tick(T0 + MINUTE, [], { stations: [JARVIS, "40900"], positions: null }));

        const index = minuteIndexOf("2026-10-14", T0);
        expect(h.day().minutes[String(index)]).toEqual({ p: 1, f: ["40900"], t: [17, 0, 0, 0, 0, 1, 0, 0] });
        expect(h.day().minutes[String(index + 1)]).toEqual({ p: 0, f: [], t: null });
        expect(ledgerSummary(h.day(), 1_440)).toEqual({ polled: 2, positionsOk: 1 });
        expect(stationPolls(h.day(), "40900", 1_440)).toBe(1);
        expect(stationPolls(h.day(), JARVIS, 1_440)).toBe(2);
    });

    it("finds a gap when a minute has no record or lists the station as failed", () => {
        const h = harness();
        h.apply(tick(T0, []));
        h.apply(tick(T0 + MINUTE, [], { failed: [JARVIS] }));
        h.apply(tick(T0 + 2 * MINUTE, []));
        h.apply(tick(T0 + 4 * MINUTE, []));

        expect(hasGap(h.day(), JARVIS, T0, T0)).toBe(false);
        expect(hasGap(h.day(), JARVIS, T0, T0 + MINUTE)).toBe(true);
        expect(hasGap(h.day(), JARVIS, T0 + 2 * MINUTE, T0 + 2 * MINUTE)).toBe(false);
        expect(hasGap(h.day(), JARVIS, T0 + 2 * MINUTE, T0 + 4 * MINUTE)).toBe(true); // minute 3 missing
        expect(hasGap(h.day(), "40900", T0 + MINUTE, T0 + MINUTE)).toBe(false);
    });
});

describe("the overlap around 03:00", () => {
    it("files a prediction under the day its time names and a poll after 03:00 under both open days", () => {
        const h = harness();
        const poll = parseChicagoLocal("2026-10-15 03:05:00");
        h.apply(tick(poll, [
            prediction({ scheduled: true, run: "908", arrivalAt: parseChicagoLocal("2026-10-15 02:58:00") }), // yesterday's slot, still posted
            prediction({ scheduled: true, run: "909", arrivalAt: parseChicagoLocal("2026-10-15 03:10:00") }),
        ]));

        expect([...h.trackers.keys()].sort()).toEqual(["2026-10-14", "2026-10-15"]);
        expect(Object.keys(h.trackerFor("2026-10-14").slots)).toEqual([slotKey(JARVIS, SOUTH, "red", parseChicagoLocal("2026-10-15 02:58:00"))]);
        expect(Object.keys(h.trackerFor("2026-10-15").slots)).toEqual([slotKey(JARVIS, SOUTH, "red", parseChicagoLocal("2026-10-15 03:10:00"))]);
        expect(h.trackerFor("2026-10-14").minutes["1445"]).toEqual({ p: 1, f: [], t: [3, 0, 0, 0, 0, 0, 0, 0] });
        expect(h.trackerFor("2026-10-15").minutes["5"]).toEqual({ p: 1, f: [], t: [3, 0, 0, 0, 0, 0, 0, 0] });
        expect(ledgerSummary(h.trackerFor("2026-10-14"), 1_440)).toEqual({ polled: 0, positionsOk: 0 });
    });

    it("keys the two 01:30s of the fall-back night as different slots", () => {
        const first = Date.parse("2026-11-01T06:30:00Z");
        const second = Date.parse("2026-11-01T07:30:00Z");
        expect(slotKey(JARVIS, SOUTH, "red", first)).not.toBe(slotKey(JARVIS, SOUTH, "red", second));
        expect(slotKey(JARVIS, SOUTH, "red", first)).toBe(slotKey(JARVIS, SOUTH, "red", first + 30_000));
    });
});
