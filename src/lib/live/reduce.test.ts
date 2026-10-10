import { describe, expect, it } from "vitest";
import { lineFaults, malformedShare, reduceDay, REDUCER_VERSION, succeededPolls, type ReduceInput } from "./reduce";
import { medianGapMinutes, platformRouteKey, type DaySchedule, type ScheduledStop } from "./schedule";
import { expectedPolls, parseChicagoLocal, serviceDayStart } from "./serviceDay";
import { createDayTracker, minuteIndexOf, slotKey, type MinuteRecord, type TrackerState } from "./tracker";
import { TRAIN_ROUTES, type TrainRoute } from "./trainTracker";

const MINUTE = 60_000;
const DAY = "2026-10-14";
const at = (hhmm: string) => parseChicagoLocal(`${DAY} ${hhmm}:00`);
const JARVIS = "41190"; // Red
const SOUTHPORT = "40360"; // Brown
const STATE_LAKE = "40260"; // closed
/** Jarvis, Southport, State/Lake, and 140 stations with nothing scheduled: a sweep of production's size. */
const FILLER = Array.from({ length: 140 }, (_, i) => String(42000 + i));
const STATIONS = [JARVIS, SOUTHPORT, STATE_LAKE, ...FILLER];
const CLOSED = new Set([STATE_LAKE]);
const REDUCED_AT = new Date("2026-10-15T08:20:00Z");

/** A day of two stops an hour per platform at Jarvis (Red) and six an hour at Southport (Brown), 05:00 to 23:00. */
function schedule(): DaySchedule {
    const stops: ScheduledStop[] = [];
    let trip = 0;
    for (let hour = 5; hour < 24; hour++) {
        for (const stopId of ["30228", "30227"]) {
            for (const minute of ["10", "40"]) {
                stops.push({ stopId, stationId: JARVIS, route: "red", direction: "1", tripId: `r${trip++}`, instant: at(`${String(hour).padStart(2, "0")}:${minute}`), calendarDate: DAY, seconds: 0 });
            }
        }
        for (let i = 0; i < 6; i++) {
            stops.push({ stopId: "30070", stationId: SOUTHPORT, route: "brn", direction: "0", tripId: `b${trip++}`, instant: at(`${String(hour).padStart(2, "0")}:${String(i * 10).padStart(2, "0")}`), calendarDate: DAY, seconds: 0 });
        }
    }
    stops.sort((a, b) => a.instant - b.instant);
    const byStation = new Map<string, ScheduledStop[]>();
    const platformRoutes = new Map<string, DaySchedule["platformRoutes"] extends Map<string, infer V> ? V : never>();
    for (const stop of stops) {
        byStation.set(stop.stationId, [...(byStation.get(stop.stationId) ?? []), stop]);
        const key = platformRouteKey(stop.stopId, stop.route);
        const entry = platformRoutes.get(key) ?? { stopId: stop.stopId, stationId: stop.stationId, route: stop.route, instants: [], scheduledGapMin: null };
        entry.instants.push(stop.instant);
        platformRoutes.set(key, entry);
    }
    for (const e of platformRoutes.values()) e.scheduledGapMin = medianGapMinutes(e.instants);
    return { serviceDate: DAY, version: "v1", stops, byStation, platformRoutes, start: serviceDayStart(DAY), end: serviceDayStart("2026-10-15") };
}

/** A tracker that observed every scheduled stop as a passage and saw one schedule-only slot, with a full ledger. */
function fullTracker(options: { minutes?: number; trains?: (hour: number) => number[]; failedFor?: { stationId: string; minutes: number }; skipPassagesFor?: string; malformedPerMinute?: number } = {}): TrackerState {
    const t = createDayTracker(DAY);
    const expected = expectedPolls(DAY);
    const polled = options.minutes ?? expected;
    for (let i = 0; i < polled; i++) {
        const hour = Math.floor(i / 60);
        const record: MinuteRecord = { p: 1, f: [], t: options.trains ? options.trains(hour) : TRAIN_ROUTES.map(() => 3), m: options.malformedPerMinute ?? 0 };
        if (options.failedFor && i < options.failedFor.minutes) record.f = [options.failedFor.stationId];
        t.minutes[String(i)] = record;
    }
    let run = 100;
    for (const stop of schedule().stops) {
        if (stop.stationId === options.skipPassagesFor) continue;
        t.passages.push({ stationId: stop.stationId, stopId: stop.stopId, route: stop.route, run: String(run++), arrivedAt: stop.instant + MINUTE, lastSeen: stop.instant, vanishedAt: stop.instant + 2 * MINUTE });
    }
    // One schedule-only entry, fulfilled by its run: the feed-shape check needs a slot somewhere.
    const key = slotKey(JARVIS, "30228", "red", at("12:10"));
    t.slots[key] = { key, stationId: JARVIS, stopId: "30228", route: "red", scheduledAt: at("12:10"), scheduledText: "x", firstSeen: at("12:00"), lastSeen: at("12:08"), runs: ["100"], fault: false, liveSameRunAt: at("12:09") };
    return t;
}

function input(overrides: Partial<ReduceInput> = {}): ReduceInput {
    return { serviceDate: DAY, tracker: fullTracker(), schedule: schedule(), stationIds: STATIONS, closedStationIds: CLOSED, quotaStopped: false, reducedAt: REDUCED_AT, ...overrides };
}

const station = (reduced: ReturnType<typeof reduceDay>, id: string) => reduced.stations.find((s) => s.ctaStationId === id)!;

describe("reduceDay", () => {
    it("counts a full day: one row per roster station, the sums intact, the closed station closed (AE7)", () => {
        const reduced = reduceDay(input());

        expect(reduced.day).toEqual({
            serviceDate: DAY,
            verdict: "COUNTED",
            cause: null,
            pollsExpected: 1_440,
            pollsSucceeded: 1_440,
            coverage: 1,
            faultLines: [],
            scheduleVersion: "v1",
            reducerVersion: REDUCER_VERSION,
            reducedAt: REDUCED_AT,
        });
        expect(reduced.stations).toHaveLength(143);
        expect(reduced.stations.map((s) => s.ctaStationId)).toEqual([...STATIONS].sort());
        for (const s of reduced.stations) expect(s.scheduled).toBe(s.fulfilled + s.cancelled + s.ghosts + s.unknown + s.unobserved);
        // A station with nothing scheduled that day is not counted: there was nothing to observe.
        expect(station(reduced, FILLER[0])).toMatchObject({ scheduled: 0, counted: false, notCountedCause: "unobserved", coverage: 1 });

        const jarvis = station(reduced, JARVIS);
        expect(jarvis).toMatchObject({ scheduled: 76, fulfilled: 76, ghosts: 0, unmapped: 0, coverage: 1, counted: true, notCountedCause: null, observedGapMin: 30, scheduledGapMin: 30 });
        expect(jarvis.byDirection.map((p) => [p.stopId, p.route, p.scheduled])).toEqual([["30227", null, 38], ["30227", "red", 38], ["30228", null, 38], ["30228", "red", 38]]);
        expect(station(reduced, SOUTHPORT)).toMatchObject({ scheduled: 114, fulfilled: 114, counted: true, observedGapMin: 10, scheduledGapMin: 10 });
        expect(station(reduced, STATE_LAKE)).toEqual({
            ctaStationId: STATE_LAKE,
            scheduled: 0,
            fulfilled: 0,
            cancelled: 0,
            ghosts: 0,
            unknown: 0,
            unobserved: 0,
            unmapped: 0,
            coverage: 0,
            counted: false,
            notCountedCause: "closed",
            observedGapMin: null,
            scheduledGapMin: null,
            byDirection: [],
        });
    });

    it("sets a 61%-coverage day aside as a site gap and counts no station (AE3)", () => {
        const reduced = reduceDay(input({ tracker: fullTracker({ minutes: 878 }) }));

        expect(reduced.day).toMatchObject({ verdict: "SET_ASIDE", cause: "site-gap", pollsSucceeded: 878, coverage: 0.6097 });
        expect(reduced.stations.every((s) => !s.counted)).toBe(true);
        expect(station(reduced, JARVIS).notCountedCause).toBe("site-gap");
        expect(station(reduced, STATE_LAKE).notCountedCause).toBe("closed");
        // The rows still carry what was observed; nothing is counted as a ghost for the gap.
        expect(station(reduced, JARVIS).ghosts).toBe(0);
    });

    it("names a Brown Line fault and loses only Brown Line stations' rows to it (AE14)", () => {
        // Three afternoon hours with no live Brown train while six trips an hour were scheduled.
        const trains = (hour: number) => TRAIN_ROUTES.map((r) => (r === "brn" && hour >= 10 && hour < 13 ? 0 : 3));
        const reduced = reduceDay(input({ tracker: fullTracker({ trains }) }));

        expect(reduced.day).toMatchObject({ verdict: "COUNTED", cause: null, faultLines: ["brn"] });
        expect(station(reduced, SOUTHPORT)).toMatchObject({ counted: false, notCountedCause: "tracker-fault" });
        expect(station(reduced, JARVIS)).toMatchObject({ counted: true, notCountedCause: null });
        expect(lineFaults(fullTracker({ trains }), schedule(), 1_440)).toEqual(["brn"]);
        // Two hours are not three.
        const brief = (hour: number) => TRAIN_ROUTES.map((r) => (r === "brn" && hour >= 10 && hour < 12 ? 0 : 3));
        expect(lineFaults(fullTracker({ trains: brief }), schedule(), 1_440)).toEqual([]);
        // One live train for four scheduled is the floor: six trips need under 1.5 live.
        const atFloor = (hour: number) => TRAIN_ROUTES.map((r) => (r === "brn" && hour >= 10 && hour < 13 ? 1.5 : 3));
        expect(lineFaults(fullTracker({ trains: atFloor }), schedule(), 1_440)).toEqual([]);
    });

    it("sets the day aside as a tracker fault when every scheduled line is in fault", () => {
        const trains = (hour: number) => TRAIN_ROUTES.map(() => (hour >= 10 && hour < 13 ? 0 : 3));
        const reduced = reduceDay(input({ tracker: fullTracker({ trains }) }));
        expect(reduced.day).toMatchObject({ verdict: "SET_ASIDE", cause: "tracker-fault", faultLines: ["red", "brn"] });
        expect(station(reduced, JARVIS).notCountedCause).toBe("tracker-fault");
    });

    it("drops a station whose own coverage is 85% on a counted day, as a site gap", () => {
        const reduced = reduceDay(input({ tracker: fullTracker({ failedFor: { stationId: JARVIS, minutes: 216 } }) }));
        expect(reduced.day.verdict).toBe("COUNTED");
        expect(station(reduced, JARVIS)).toMatchObject({ counted: false, notCountedCause: "site-gap", coverage: 0.85 });
        expect(station(reduced, SOUTHPORT).counted).toBe(true);
    });

    it("drops a station with fewer than 90% of its scheduled stops observed, as unobserved", () => {
        const reduced = reduceDay(input({ tracker: fullTracker({ skipPassagesFor: SOUTHPORT }) }));
        expect(station(reduced, SOUTHPORT)).toMatchObject({ counted: false, notCountedCause: "unobserved", unobserved: 114, fulfilled: 0 });
        expect(station(reduced, JARVIS).counted).toBe(true);
    });

    it("sets a day aside as feed-shape when no schedule-only prediction appeared all day, or responses were malformed", () => {
        const noSlots = fullTracker();
        noSlots.slots = {};
        expect(reduceDay(input({ tracker: noSlots })).day).toMatchObject({ verdict: "SET_ASIDE", cause: "feed-shape" });

        // 37 calls a minute; one malformed entry a minute is 2.7%.
        expect(reduceDay(input({ tracker: fullTracker({ malformedPerMinute: 1 }) })).day.cause).toBe("feed-shape");
        expect(malformedShare(fullTracker({ malformedPerMinute: 1 }), 1_440, 2)).toBeCloseTo(0.5, 5);
    });

    it("sets a quota-stopped day aside as quota and a day with no schedule aside as no-schedule", () => {
        expect(reduceDay(input({ quotaStopped: true })).day).toMatchObject({ verdict: "SET_ASIDE", cause: "quota" });
        const noSchedule = reduceDay(input({ schedule: null }));
        expect(noSchedule.day).toMatchObject({ verdict: "SET_ASIDE", cause: "no-schedule", scheduleVersion: null });
        expect(noSchedule.verdicts).toBeNull();
        expect(station(noSchedule, JARVIS)).toMatchObject({ scheduled: 0, counted: false, notCountedCause: "site-gap" });
    });

    it("expects 1,500 polls on the fall-back day", () => {
        const tracker = createDayTracker("2026-10-31");
        for (let i = 0; i < 1_440; i++) tracker.minutes[String(i)] = { p: 1, f: [], t: TRAIN_ROUTES.map(() => 3), m: 0 };
        const reduced = reduceDay(input({ serviceDate: "2026-10-31", tracker, schedule: { ...schedule(), serviceDate: "2026-10-31", stops: [], byStation: new Map(), platformRoutes: new Map() } }));
        expect(reduced.day).toMatchObject({ pollsExpected: 1_500, pollsSucceeded: 1_440, coverage: 0.96 });
    });
});

describe("succeededPolls", () => {
    it("counts a minute when positions worked and almost every batch did", () => {
        const t = createDayTracker(DAY);
        t.minutes["0"] = { p: 1, f: [], t: null, m: 0 };
        t.minutes["1"] = { p: 0, f: [], t: null, m: 0 };
        t.minutes["2"] = { p: 1, f: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], t: null, m: 0 }; // three batches of 36
        t.minutes["3"] = { p: 1, f: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p"], t: null, m: 0 }; // four
        t.minutes[String(minuteIndexOf(DAY, serviceDayStart("2026-10-15")))] = { p: 1, f: [], t: null, m: 0 }; // past the day
        expect(succeededPolls(t, 1_440, 143)).toBe(2);
    });
});

describe("the fault floor", () => {
    it("ignores hours with no positions record and routes with no schedule", () => {
        const t = createDayTracker(DAY);
        for (let i = 0; i < 1_440; i++) t.minutes[String(i)] = { p: 0, f: [], t: null, m: 0 };
        expect(lineFaults(t, schedule(), 1_440)).toEqual([]);
        const routes: TrainRoute[] = ["blue", "g"];
        expect(lineFaults(fullTracker({ trains: () => TRAIN_ROUTES.map(() => 0) }), schedule(), 1_440)).not.toEqual(expect.arrayContaining(routes));
    });
});
