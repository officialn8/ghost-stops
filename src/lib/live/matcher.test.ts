import { describe, expect, it } from "vitest";
import { GHOST_TOLERANCE_MINUTES, verdictsFor } from "./matcher";
import { medianGapMinutes, platformRouteKey, type DaySchedule, type ScheduledStop } from "./schedule";
import { minuteIndexOf, parseChicagoLocal, serviceDayStart } from "./serviceDay";
import { createDayTracker, hasGap, slotKey, type Passage, type Slot, type TrackerState } from "./tracker";
import type { TrainRoute } from "./trainTracker";

const MINUTE = 60_000;
const DAY = "2026-10-14";
const JARVIS = "41190";
const SOUTH = "30228"; // Jarvis, toward 95th
const NORTH = "30227";
const HOWARD = "40900";
const HOWARD_SOUTH = "30174"; // Howard's departing platform toward 95th
const at = (hhmm: string) => parseChicagoLocal(`${DAY} ${hhmm}:00`);

/** A day schedule from a list of stops; the lookups the matcher reads are derived. */
function schedule(stops: { stationId: string; stopId: string; route?: TrainRoute; instant: number }[]): DaySchedule {
    const full: ScheduledStop[] = stops
        .map((s, i) => ({ stopId: s.stopId, stationId: s.stationId, route: s.route ?? "red", direction: "1", tripId: `t${i}`, instant: s.instant, calendarDate: DAY, seconds: 0 }))
        .sort((a, b) => a.instant - b.instant);
    const byStation = new Map<string, ScheduledStop[]>();
    const platformRoutes = new Map<string, DaySchedule["platformRoutes"] extends Map<string, infer V> ? V : never>();
    for (const stop of full) {
        byStation.set(stop.stationId, [...(byStation.get(stop.stationId) ?? []), stop]);
        const key = platformRouteKey(stop.stopId, stop.route);
        const entry = platformRoutes.get(key) ?? { stopId: stop.stopId, stationId: stop.stationId, route: stop.route, instants: [], scheduledGapMin: null };
        entry.instants.push(stop.instant);
        platformRoutes.set(key, entry);
    }
    for (const entry of platformRoutes.values()) entry.scheduledGapMin = medianGapMinutes(entry.instants);
    return { serviceDate: DAY, version: "test", stops: full, byStation, platformRoutes, start: serviceDayStart(DAY), end: serviceDayStart("2026-10-15") };
}

function slot(overrides: Partial<Slot> & { scheduledAt: number }): Slot {
    const stationId = overrides.stationId ?? JARVIS;
    const stopId = overrides.stopId ?? SOUTH;
    const route = overrides.route ?? "red";
    return {
        key: slotKey(stationId, stopId, route, overrides.scheduledAt),
        stationId,
        stopId,
        route,
        scheduledText: "x",
        firstSeen: overrides.scheduledAt - 10 * MINUTE,
        lastSeen: overrides.scheduledAt + 4 * MINUTE,
        runs: ["901"],
        fault: false,
        liveSameRunAt: null,
        ...overrides,
    };
}

function passage(overrides: Partial<Passage> & { arrivedAt: number }): Passage {
    return { stationId: JARVIS, stopId: SOUTH, route: "red", run: "901", lastSeen: overrides.arrivedAt - MINUTE, vanishedAt: overrides.arrivedAt + MINUTE, ...overrides };
}

/** A tracker whose ledger shows every minute of the day polled, less the minutes named. */
function tracker(options: { slots?: Slot[]; passages?: Passage[]; missed?: number[]; failedAt?: { epoch: number; station: string }[] } = {}): TrackerState {
    const t = createDayTracker(DAY);
    for (let i = 0; i < 1_440; i++) t.minutes[String(i)] = { p: 1, f: [], t: null, m: 0 };
    for (const epoch of options.missed ?? []) delete t.minutes[String(minuteIndexOf(DAY, epoch))];
    for (const { epoch, station } of options.failedAt ?? []) t.minutes[String(minuteIndexOf(DAY, epoch))] = { p: 1, f: [station], t: null, m: 0 };
    for (const s of options.slots ?? []) t.slots[s.key] = s;
    t.passages = options.passages ?? [];
    return t;
}

const jarvisSchedule = () =>
    schedule([
        { stationId: JARVIS, stopId: SOUTH, instant: at("17:00") },
        { stationId: JARVIS, stopId: SOUTH, instant: at("17:08") },
        { stationId: JARVIS, stopId: SOUTH, instant: at("17:16") },
        { stationId: JARVIS, stopId: SOUTH, instant: at("17:24") },
    ]);

describe("slot verdicts", () => {
    it("fulfils a slot replaced by a live prediction with the same run, and maps it to its scheduled stop", () => {
        const s = slot({ scheduledAt: at("17:08"), liveSameRunAt: at("17:09") });
        const verdicts = verdictsFor(tracker({ slots: [s] }), jarvisSchedule());

        expect(verdicts.slots).toHaveLength(1);
        expect(verdicts.slots[0]).toMatchObject({ verdict: "fulfilled", by: "same-run", late: false });
        expect(verdicts.slots[0].stop?.instant).toBe(at("17:08"));
        expect(verdicts.stops.find((v) => v.stop.instant === at("17:08"))).toMatchObject({ verdict: "fulfilled", slot: s });
        expect(verdicts.tolerance).toBe(GHOST_TOLERANCE_MINUTES);
    });

    it("fulfils a slot by a passage on its platform one minute late", () => {
        const verdicts = verdictsFor(tracker({ slots: [slot({ scheduledAt: at("17:08") })], passages: [passage({ arrivedAt: at("17:09"), run: "777" })] }), jarvisSchedule());
        expect(verdicts.slots[0]).toMatchObject({ verdict: "fulfilled", by: "passage", late: false });
    });

    it("fulfils, not ghosts, a train nine minutes late whose live prediction carries the slot's run", () => {
        const verdicts = verdictsFor(tracker({ slots: [slot({ scheduledAt: at("17:08"), liveSameRunAt: at("17:17") })] }), jarvisSchedule());
        expect(verdicts.slots[0]).toMatchObject({ verdict: "fulfilled", by: "same-run", late: true });
        expect(verdicts.byStation.get(JARVIS)).toMatchObject({ ghosts: 0, fulfilled: 1 });
    });

    it("calls a slot withdrawn twelve minutes early with no train cancelled, and the gap widens (AE4)", () => {
        const verdicts = verdictsFor(
            tracker({
                slots: [slot({ scheduledAt: at("17:08"), firstSeen: at("16:50"), lastSeen: at("16:56") })],
                passages: [passage({ arrivedAt: at("17:00"), run: "900" }), passage({ arrivedAt: at("17:16"), run: "902" }), passage({ arrivedAt: at("17:24"), run: "903" })],
            }),
            jarvisSchedule(),
        );
        expect(verdicts.slots[0]).toMatchObject({ verdict: "cancelled", by: null });
        const station = verdicts.byStation.get(JARVIS)!;
        expect(station).toMatchObject({ scheduled: 4, fulfilled: 3, cancelled: 1, ghosts: 0, unknown: 0, unobserved: 0 });
        // Passages at 17:00, 17:16, 17:24: gaps of 16 and 8, median 12, against a scheduled 8.
        expect(station.observedGapMin).toBe(12);
        expect(station.scheduledGapMin).toBe(8);
    });

    it("calls a slot still posted at the scheduled time with no train a ghost", () => {
        const verdicts = verdictsFor(tracker({ slots: [slot({ scheduledAt: at("17:08"), lastSeen: at("17:12") })] }), jarvisSchedule());
        expect(verdicts.slots[0]).toMatchObject({ verdict: "ghost", by: null });
        expect(verdicts.stops.find((v) => v.stop.instant === at("17:08"))?.verdict).toBe("ghost");
        expect(verdicts.byStation.get(JARVIS)).toMatchObject({ ghosts: 1, unmapped: 0 });
    });

    it("does not let a live train on another route at the same platform fulfil the slot", () => {
        const verdicts = verdictsFor(
            tracker({ slots: [slot({ scheduledAt: at("17:08") })], passages: [passage({ arrivedAt: at("17:08"), route: "p", run: "901" })] }),
            jarvisSchedule(),
        );
        expect(verdicts.slots[0].verdict).toBe("ghost");
    });

    it("counts a ghost with no scheduled stop within two minutes as unmapped, not scored", () => {
        const verdicts = verdictsFor(tracker({ slots: [slot({ scheduledAt: at("17:11") })] }), jarvisSchedule());
        expect(verdicts.slots[0]).toMatchObject({ verdict: "ghost", stop: null });
        const station = verdicts.byStation.get(JARVIS)!;
        expect(station.unmapped).toBe(1);
        expect(station.ghosts).toBe(0);
        expect(station.scheduled).toBe(4);
    });

    it("maps a slot to the nearest scheduled stop within two minutes, each stop at most once", () => {
        const a = slot({ scheduledAt: at("17:07"), runs: ["901"] });
        const b = slot({ scheduledAt: at("17:09"), runs: ["902"] });
        const verdicts = verdictsFor(tracker({ slots: [a, b] }), jarvisSchedule());
        expect(verdicts.slots.map((v) => v.stop?.instant ?? null)).toEqual([at("17:08"), null]);
    });

    it("calls a slot unknown when a minute inside its window was missed or its station's batch failed", () => {
        const missed = verdictsFor(tracker({ slots: [slot({ scheduledAt: at("17:08"), lastSeen: at("17:12") })], missed: [at("17:05")] }), jarvisSchedule());
        expect(missed.slots[0].verdict).toBe("unknown");

        const failed = verdictsFor(tracker({ slots: [slot({ scheduledAt: at("17:08"), lastSeen: at("17:12") })], failedAt: [{ epoch: at("17:12"), station: JARVIS }] }), jarvisSchedule());
        expect(failed.slots[0].verdict).toBe("unknown");

        const elsewhere = verdictsFor(tracker({ slots: [slot({ scheduledAt: at("17:08"), lastSeen: at("17:12") })], failedAt: [{ epoch: at("17:12"), station: HOWARD }] }), jarvisSchedule());
        expect(elsewhere.slots[0].verdict).toBe("ghost");
    });

    it("keeps a fulfilled verdict even when the window has a gap: the train was seen", () => {
        const verdicts = verdictsFor(tracker({ slots: [slot({ scheduledAt: at("17:08"), liveSameRunAt: at("17:10") })], missed: [at("17:06")] }), jarvisSchedule());
        expect(verdicts.slots[0].verdict).toBe("fulfilled");
    });

    it("fulfils a terminal departure when its run shows live at the next station within the tolerance", () => {
        const sched = schedule([
            { stationId: HOWARD, stopId: HOWARD_SOUTH, instant: at("17:00") },
            { stationId: JARVIS, stopId: SOUTH, instant: at("17:02") },
        ]);
        const terminal = slot({ stationId: HOWARD, stopId: HOWARD_SOUTH, scheduledAt: at("17:00"), runs: ["901"] });
        const seen = verdictsFor(tracker({ slots: [terminal], passages: [passage({ arrivedAt: at("17:03"), run: "901" })] }), sched);
        expect(seen.slots[0]).toMatchObject({ verdict: "fulfilled", by: "next-station", late: false });
        expect(seen.stops.find((v) => v.stop.stationId === JARVIS)?.verdict).toBe("fulfilled");

        const nobody = verdictsFor(tracker({ slots: [terminal] }), sched);
        expect(nobody.slots[0].verdict).toBe("ghost");

        const tooLate = verdictsFor(tracker({ slots: [terminal], passages: [passage({ arrivedAt: at("17:12"), run: "901" })] }), sched);
        expect(tooLate.slots[0].verdict).toBe("ghost");
    });
});

describe("scheduled stop verdicts", () => {
    it("fulfils a stop from the passage log when the train was live from its first appearance, and opens no slot", () => {
        const verdicts = verdictsFor(tracker({ passages: [passage({ arrivedAt: at("17:01"), run: "950" })] }), jarvisSchedule());
        const stop = verdicts.stops.find((v) => v.stop.instant === at("17:00"));
        expect(stop).toMatchObject({ verdict: "fulfilled", slot: null });
        expect(stop?.passage?.run).toBe("950");
        expect(verdicts.slots).toEqual([]);
    });

    it("uses each passage for one stop, the nearest", () => {
        const verdicts = verdictsFor(tracker({ passages: [passage({ arrivedAt: at("17:04"), run: "950" })] }), jarvisSchedule());
        const [a, b] = [at("17:00"), at("17:08")].map((t) => verdicts.stops.find((v) => v.stop.instant === t)?.verdict);
        expect([a, b].filter((v) => v === "fulfilled")).toHaveLength(1);
    });

    it("calls a stop with no prediction of either kind unobserved, or unknown when its window had a gap", () => {
        const quiet = verdictsFor(tracker(), jarvisSchedule());
        expect(quiet.stops.map((v) => v.verdict)).toEqual(["unobserved", "unobserved", "unobserved", "unobserved"]);
        expect(quiet.byStation.get(JARVIS)).toMatchObject({ scheduled: 4, unobserved: 4, observedGapMin: null, scheduledGapMin: 8 });

        const gap = verdictsFor(tracker({ missed: [at("17:14")] }), jarvisSchedule());
        expect(gap.stops.map((v) => v.verdict)).toEqual(["unobserved", "unobserved", "unknown", "unobserved"]);
    });

    it("sums every station's verdicts to its scheduled stops and splits platforms pooled and by route", () => {
        const sched = schedule([
            { stationId: JARVIS, stopId: SOUTH, route: "red", instant: at("17:00") },
            { stationId: JARVIS, stopId: SOUTH, route: "red", instant: at("17:10") },
            { stationId: JARVIS, stopId: SOUTH, route: "p", instant: at("17:05") },
            { stationId: JARVIS, stopId: NORTH, route: "red", instant: at("17:03") },
        ]);
        const verdicts = verdictsFor(
            tracker({
                slots: [slot({ scheduledAt: at("17:10"), lastSeen: at("17:14") })],
                passages: [passage({ arrivedAt: at("17:00"), run: "1" }), passage({ arrivedAt: at("17:05"), route: "p", run: "2" }), passage({ arrivedAt: at("17:04"), stopId: NORTH, run: "3" })],
            }),
            sched,
        );
        const station = verdicts.byStation.get(JARVIS)!;
        expect(station).toMatchObject({ scheduled: 4, fulfilled: 3, ghosts: 1, cancelled: 0, unknown: 0, unobserved: 0 });
        expect(station.scheduled).toBe(station.fulfilled + station.cancelled + station.ghosts + station.unknown + station.unobserved);
        expect(station.platforms.map((p) => [p.stopId, p.route, p.scheduled, p.fulfilled, p.ghosts])).toEqual([
            [NORTH, null, 1, 1, 0],
            [NORTH, "red", 1, 1, 0],
            [SOUTH, null, 3, 2, 1],
            [SOUTH, "p", 1, 1, 0],
            [SOUTH, "red", 2, 1, 1],
        ]);
        // South pooled: passages 17:00 and 17:05 (gap 5), scheduled 17:00, 17:05, 17:10 (gap 5); north has one of each.
        expect(station.platforms.find((p) => p.stopId === SOUTH && p.route === null)).toMatchObject({ observedGapMin: 5, scheduledGapMin: 5 });
        expect(station.observedGapMin).toBe(5);
        expect(station.scheduledGapMin).toBe(5);
    });
});

/**
 * The indexed matcher against a plain scan: the same four rules written as the loops over every
 * stop and passage, on random days, so the bucketing and binary searches can never drift from
 * the rule they implement.
 */
describe("the indexed matcher equals a plain scan", () => {
    function reference(tracker: TrackerState, sched: DaySchedule, toleranceMinutes: number) {
        const tol = toleranceMinutes * MINUTE;
        const passages = [...tracker.passages].sort((a, b) => a.arrivedAt - b.arrivedAt);
        const slots = Object.values(tracker.slots).sort((a, b) => a.scheduledAt - b.scheduledAt);
        const stopOfSlot = new Map<Slot, ScheduledStop>();
        const slotOfStop = new Map<ScheduledStop, Slot>();
        for (const slot of slots) {
            let best: ScheduledStop | null = null;
            for (const stop of sched.stops) {
                if (stop.stopId !== slot.stopId || stop.route !== slot.route || slotOfStop.has(stop)) continue;
                const d = Math.abs(stop.instant - slot.scheduledAt);
                if (d > 2 * MINUTE) continue;
                if (best === null || d < Math.abs(best.instant - slot.scheduledAt)) best = stop;
            }
            if (best !== null) {
                stopOfSlot.set(slot, best);
                slotOfStop.set(best, slot);
            }
        }
        const passageOfStop = new Map<ScheduledStop, Passage>();
        for (const p of passages) {
            let nearestStop: ScheduledStop | null = null;
            for (const stop of sched.stops) {
                if (stop.stopId !== p.stopId || stop.route !== p.route || passageOfStop.has(stop)) continue;
                const d = Math.abs(p.arrivedAt - stop.instant);
                if (d > tol) continue;
                if (nearestStop === null || d < Math.abs(nearestStop.instant - p.arrivedAt)) nearestStop = stop;
            }
            if (nearestStop !== null) passageOfStop.set(nearestStop, p);
        }
        const slotVerdicts = slots.map((slot) => {
            const stop = stopOfSlot.get(slot) ?? null;
            const windowStart = slot.scheduledAt - tol;
            const windowEnd = slot.scheduledAt + tol;
            const platformPassage =
                stop !== null
                    ? (passageOfStop.get(stop) ?? null)
                    : (passages.find((p) => p.stationId === slot.stationId && p.stopId === slot.stopId && p.route === slot.route && Math.abs(p.arrivedAt - slot.scheduledAt) <= tol) ?? null);
            const runPassage =
                passages.find((p) => p.route === slot.route && slot.runs.includes(p.run) && p.stationId !== slot.stationId && p.arrivedAt >= windowStart && p.arrivedAt <= windowEnd + 3 * MINUTE) ?? null;
            let verdict: string;
            let by: string | null = null;
            let late = false;
            if (slot.liveSameRunAt !== null) {
                verdict = "fulfilled";
                by = "same-run";
                late = slot.liveSameRunAt > windowEnd;
            } else if (platformPassage !== null) {
                verdict = "fulfilled";
                by = "passage";
            } else if (runPassage !== null) {
                verdict = "fulfilled";
                by = "next-station";
                late = runPassage.arrivedAt > windowEnd;
            } else if (hasGap(tracker, slot.stationId, windowStart, windowEnd)) verdict = "unknown";
            else if (slot.lastSeen + MINUTE < windowStart) verdict = "cancelled";
            else verdict = "ghost";
            return { key: slot.key, verdict, by, late, stop: stop?.tripId ?? null };
        });
        const stopVerdicts = sched.stops.map((stop) => {
            const slot = slotOfStop.get(stop);
            if (slot !== undefined) return { trip: stop.tripId, verdict: slotVerdicts.find((v) => v.key === slot.key)!.verdict, slot: slot.key, passage: passageOfStop.get(stop)?.run ?? null };
            const passage = passageOfStop.get(stop);
            if (passage !== undefined) return { trip: stop.tripId, verdict: "fulfilled", slot: null, passage: passage.run };
            if (hasGap(tracker, stop.stationId, stop.instant - tol, stop.instant + tol)) return { trip: stop.tripId, verdict: "unknown", slot: null, passage: null };
            return { trip: stop.tripId, verdict: "unobserved", slot: null, passage: null };
        });
        return { slotVerdicts, stopVerdicts };
    }

    /** A small deterministic generator (mulberry32). */
    function rng(seed: number): () => number {
        let state = seed >>> 0;
        return () => {
            state = (state + 0x6d2b79f5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    it.each([1, 2, 3, 4, 5, 6, 7, 8])("agrees on random day %i at every tolerance", (seed) => {
        const random = rng(seed);
        const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
        const platforms: { stationId: string; stopId: string; route: TrainRoute }[] = [
            { stationId: JARVIS, stopId: SOUTH, route: "red" },
            { stationId: JARVIS, stopId: NORTH, route: "red" },
            { stationId: JARVIS, stopId: SOUTH, route: "p" },
            { stationId: HOWARD, stopId: HOWARD_SOUTH, route: "red" },
        ];
        const stopList = Array.from({ length: 60 }, () => {
            const p = pick(platforms);
            return { ...p, instant: at("06:00") + Math.floor(random() * 600) * MINUTE };
        });
        const sched = schedule(stopList);
        const slotList: Slot[] = Array.from({ length: 25 }, () => {
            const p = pick(platforms);
            const scheduledAt = at("06:00") + Math.floor(random() * 600) * MINUTE + (random() < 0.5 ? 0 : 30_000);
            return slot({
                ...p,
                scheduledAt,
                runs: [String(700 + Math.floor(random() * 20))],
                firstSeen: scheduledAt - Math.floor(random() * 20) * MINUTE,
                lastSeen: scheduledAt - 10 * MINUTE + Math.floor(random() * 20) * MINUTE,
                liveSameRunAt: random() < 0.3 ? scheduledAt + Math.floor(random() * 12 - 2) * MINUTE : null,
            });
        });
        const passageList: Passage[] = Array.from({ length: 60 }, (_, i) => {
            const p = pick(platforms);
            return passage({ ...p, run: String(700 + Math.floor(random() * 20)), arrivedAt: at("06:00") + Math.floor(random() * 600) * MINUTE + i * 7 });
        });
        const missed = Array.from({ length: 6 }, () => at("06:00") + Math.floor(random() * 600) * MINUTE);
        const t = tracker({ slots: slotList, passages: passageList, missed });

        for (const tolerance of [2, 5, 8]) {
            const actual = verdictsFor(t, sched, tolerance);
            const expected = reference(t, sched, tolerance);
            expect(actual.slots.map((v) => ({ key: v.slot.key, verdict: v.verdict, by: v.by, late: v.late, stop: v.stop?.tripId ?? null }))).toEqual(expected.slotVerdicts);
            expect(actual.stops.map((v) => ({ trip: v.stop.tripId, verdict: v.verdict, slot: v.slot?.key ?? null, passage: v.passage?.run ?? null }))).toEqual(expected.stopVerdicts);
            for (const s of actual.byStation.values()) expect(s.scheduled).toBe(s.fulfilled + s.cancelled + s.ghosts + s.unknown + s.unobserved);
        }
    });
});
