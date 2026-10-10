/**
 * The verdict rule (R2, R10; KTD4, KTD9; AE4, AE13): one pure pass over a closed day's tracker
 * and its schedule.
 *
 * A slot (a schedule-only prediction) is fulfilled when a live prediction carrying one of its
 * runs replaced it at its platform, at any lateness, or when a logged passage on its platform
 * and route lies within the tolerance of its scheduled time, or, for a terminal departure, when
 * a passage with its route and run appears at another station within the tolerance plus a few
 * minutes of travel; cancelled when it vanished before the scheduled time minus the tolerance
 * and nothing came; a ghost when it was still posted at the scheduled time minus the tolerance
 * and nothing came by the scheduled time plus the tolerance; unknown when the site's polls have
 * a gap inside its window, so a verdict is never taken on what nobody watched.
 *
 * A GTFS scheduled stop then takes the verdict of the slot mapped to it (the nearest slot on
 * its platform and route within two minutes), or is fulfilled by a passage within the
 * tolerance whether or not a slot preceded it (the normal case: a train live from its first
 * appearance opens no slot), unknown when its window had a gap, and otherwise unobserved. A
 * ghost whose slot maps to no scheduled stop counts as unmapped, kept apart and never scored.
 */
import type { DaySchedule, ScheduledStop } from "./schedule";
import { medianGapMinutes } from "./schedule";
import { hasGap, type Passage, type Slot, type TrackerState } from "./tracker";
import type { TrainRoute } from "./trainTracker";

const MINUTE_MS = 60_000;

/** The ghost tolerance in minutes, the default until the sensitivity table freezes it (KTD4, U7). */
export const GHOST_TOLERANCE_MINUTES = 5;

/** A slot maps to a scheduled stop on its platform and route within this many minutes. */
export const SLOT_MAP_WINDOW_MS = 2 * MINUTE_MS;

/** How much later than its scheduled departure a terminal's train may show live at the next station. */
export const NEXT_STATION_TRAVEL_MS = 3 * MINUTE_MS;

export type SlotOutcome = "fulfilled" | "cancelled" | "ghost" | "unknown";
export type StopOutcome = SlotOutcome | "unobserved";
export type FulfilledBy = "same-run" | "passage" | "next-station";

export interface SlotVerdict {
    slot: Slot;
    verdict: SlotOutcome;
    /** How a fulfilled slot was fulfilled; null otherwise. */
    by: FulfilledBy | null;
    /** The live sighting or passage that fulfilled it was after the scheduled time plus the tolerance. */
    late: boolean;
    /** The scheduled stop it maps to; null when none lies within the mapping window (unmapped). */
    stop: ScheduledStop | null;
}

export interface StopVerdict {
    stop: ScheduledStop;
    verdict: StopOutcome;
    /** The slot that decided it, when one did. */
    slot: Slot | null;
    /** The passage that fulfilled it, when one did. */
    passage: Passage | null;
}

export interface PlatformSummary {
    stopId: string;
    /** Null for the platform pooled across its routes (what a rider at the platform sees). */
    route: TrainRoute | null;
    scheduled: number;
    fulfilled: number;
    cancelled: number;
    ghosts: number;
    unknown: number;
    unobserved: number;
    /** The median gap between consecutive passages, and between consecutive scheduled stops, in minutes. */
    observedGapMin: number | null;
    scheduledGapMin: number | null;
}

export interface StationSummary {
    stationId: string;
    scheduled: number;
    fulfilled: number;
    cancelled: number;
    ghosts: number;
    unknown: number;
    unobserved: number;
    /** Ghost slots at the station that map to no scheduled stop. */
    unmapped: number;
    /** Per platform (pooled) and per platform and route. */
    platforms: PlatformSummary[];
    /** The scheduled-weighted mean of the pooled platforms' gaps, to the minute (KTD9). */
    observedGapMin: number | null;
    scheduledGapMin: number | null;
}

export interface DayVerdicts {
    tolerance: number;
    slots: SlotVerdict[];
    stops: StopVerdict[];
    byStation: Map<string, StationSummary>;
}

const sameKey = (a: { stationId: string; stopId: string; route: TrainRoute }, b: { stationId: string; stopId: string; route: TrainRoute }) =>
    a.stationId === b.stationId && a.stopId === b.stopId && a.route === b.route;

/** The verdict of every slot and every scheduled stop of a closed day. */
export function verdictsFor(tracker: TrackerState, schedule: DaySchedule, toleranceMinutes: number = GHOST_TOLERANCE_MINUTES): DayVerdicts {
    const tol = toleranceMinutes * MINUTE_MS;
    const passages = [...tracker.passages].sort((a, b) => a.arrivedAt - b.arrivedAt);
    const passagesByRun = new Map<string, Passage[]>();
    for (const p of passages) passagesByRun.set(`${p.route}|${p.run}`, [...(passagesByRun.get(`${p.route}|${p.run}`) ?? []), p]);
    const slots = Object.values(tracker.slots).sort((a, b) => a.scheduledAt - b.scheduledAt);

    // 1. Each slot maps to the nearest scheduled stop on its platform and route within the window, each stop once.
    const stopOfSlot = new Map<Slot, ScheduledStop>();
    const slotOfStop = new Map<ScheduledStop, Slot>();
    for (const slot of slots) {
        let best: ScheduledStop | null = null;
        for (const stop of schedule.stops) {
            if (stop.stopId !== slot.stopId || stop.route !== slot.route || slotOfStop.has(stop)) continue;
            const distance = Math.abs(stop.instant - slot.scheduledAt);
            if (distance > SLOT_MAP_WINDOW_MS) continue;
            if (best === null || distance < Math.abs(best.instant - slot.scheduledAt)) best = stop;
        }
        if (best !== null) {
            stopOfSlot.set(slot, best);
            slotOfStop.set(best, slot);
        }
    }

    // 2. Each passage fulfils at most one scheduled stop: the nearest unassigned one on its platform
    //    and route within the tolerance. One train is one passage is one stop.
    const passageOfStop = new Map<ScheduledStop, Passage>();
    for (const p of passages) {
        let nearest: ScheduledStop | null = null;
        for (const stop of schedule.stops) {
            if (stop.stopId !== p.stopId || stop.route !== p.route || passageOfStop.has(stop)) continue;
            const distance = Math.abs(p.arrivedAt - stop.instant);
            if (distance > tol) continue;
            if (nearest === null || distance < Math.abs(nearest.instant - p.arrivedAt)) nearest = stop;
        }
        if (nearest !== null) passageOfStop.set(nearest, p);
    }

    // 3. Slot verdicts. A mapped slot's passage is the one its stop was assigned; an unmapped slot
    //    takes any passage on its platform and route within the tolerance.
    const slotVerdicts: SlotVerdict[] = [];
    for (const slot of slots) {
        const windowStart = slot.scheduledAt - tol;
        const windowEnd = slot.scheduledAt + tol;
        const stop = stopOfSlot.get(slot) ?? null;
        const platformPassage =
            stop !== null ? (passageOfStop.get(stop) ?? null) : (passages.find((p) => sameKey(p, slot) && Math.abs(p.arrivedAt - slot.scheduledAt) <= tol) ?? null);
        const runPassage =
            slot.runs
                .flatMap((run) => passagesByRun.get(`${slot.route}|${run}`) ?? [])
                .find((p) => p.stationId !== slot.stationId && p.arrivedAt >= windowStart && p.arrivedAt <= windowEnd + NEXT_STATION_TRAVEL_MS) ?? null;
        let verdict: SlotOutcome;
        let by: FulfilledBy | null = null;
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
        } else if (hasGap(tracker, slot.stationId, windowStart, windowEnd)) {
            verdict = "unknown";
        } else if (slot.lastSeen + MINUTE_MS < windowStart) {
            verdict = "cancelled";
        } else {
            verdict = "ghost";
        }
        slotVerdicts.push({ slot, verdict, by, late, stop });
    }
    const verdictOfSlot = new Map(slotVerdicts.map((sv) => [sv.slot, sv]));

    // 4. Stop verdicts: the mapped slot's, else the assigned passage, else a gap, else unobserved.
    const stopVerdicts: StopVerdict[] = [];
    for (const stop of schedule.stops) {
        const slot = slotOfStop.get(stop);
        if (slot !== undefined) {
            stopVerdicts.push({ stop, verdict: verdictOfSlot.get(slot)!.verdict, slot, passage: passageOfStop.get(stop) ?? null });
            continue;
        }
        const passage = passageOfStop.get(stop);
        if (passage !== undefined) stopVerdicts.push({ stop, verdict: "fulfilled", slot: null, passage });
        else if (hasGap(tracker, stop.stationId, stop.instant - tol, stop.instant + tol)) stopVerdicts.push({ stop, verdict: "unknown", slot: null, passage: null });
        else stopVerdicts.push({ stop, verdict: "unobserved", slot: null, passage: null });
    }

    return { tolerance: toleranceMinutes, slots: slotVerdicts, stops: stopVerdicts, byStation: summarize(stopVerdicts, slotVerdicts, passages, schedule) };
}

function emptyPlatform(stopId: string, route: TrainRoute | null): PlatformSummary {
    return { stopId, route, scheduled: 0, fulfilled: 0, cancelled: 0, ghosts: 0, unknown: 0, unobserved: 0, observedGapMin: null, scheduledGapMin: null };
}

function count(summary: { fulfilled: number; cancelled: number; ghosts: number; unknown: number; unobserved: number; scheduled: number }, verdict: StopOutcome): void {
    summary.scheduled += 1;
    if (verdict === "fulfilled") summary.fulfilled += 1;
    else if (verdict === "cancelled") summary.cancelled += 1;
    else if (verdict === "ghost") summary.ghosts += 1;
    else if (verdict === "unknown") summary.unknown += 1;
    else summary.unobserved += 1;
}

function summarize(stops: StopVerdict[], slots: SlotVerdict[], passages: Passage[], schedule: DaySchedule): Map<string, StationSummary> {
    const stations = new Map<string, StationSummary>();
    const station = (id: string): StationSummary => {
        let s = stations.get(id);
        if (!s) {
            s = { stationId: id, scheduled: 0, fulfilled: 0, cancelled: 0, ghosts: 0, unknown: 0, unobserved: 0, unmapped: 0, platforms: [], observedGapMin: null, scheduledGapMin: null };
            stations.set(id, s);
        }
        return s;
    };
    const platform = (s: StationSummary, stopId: string, route: TrainRoute | null): PlatformSummary => {
        let p = s.platforms.find((x) => x.stopId === stopId && x.route === route);
        if (!p) {
            p = emptyPlatform(stopId, route);
            s.platforms.push(p);
        }
        return p;
    };

    for (const sv of stops) {
        const s = station(sv.stop.stationId);
        count(s, sv.verdict);
        count(platform(s, sv.stop.stopId, null), sv.verdict);
        count(platform(s, sv.stop.stopId, sv.stop.route), sv.verdict);
    }
    for (const sv of slots) {
        if (sv.verdict === "ghost" && sv.stop === null) station(sv.slot.stationId).unmapped += 1;
    }

    // Gaps: passages per platform (pooled and per route), scheduled stops likewise.
    for (const s of stations.values()) {
        for (const p of s.platforms) {
            const arrivals = passages.filter((x) => x.stationId === s.stationId && x.stopId === p.stopId && (p.route === null || x.route === p.route)).map((x) => x.arrivedAt);
            p.observedGapMin = medianGapMinutes(arrivals);
            const scheduled = schedule.stops.filter((x) => x.stationId === s.stationId && x.stopId === p.stopId && (p.route === null || x.route === p.route)).map((x) => x.instant);
            p.scheduledGapMin = medianGapMinutes(scheduled);
        }
        const pooled = s.platforms.filter((p) => p.route === null && p.scheduled > 0);
        const weighted = (pick: (p: PlatformSummary) => number | null): number | null => {
            const parts = pooled.flatMap((p) => (pick(p) === null ? [] : [{ weight: p.scheduled, value: pick(p) as number }]));
            const weight = parts.reduce((sum, x) => sum + x.weight, 0);
            if (weight === 0) return null;
            return Math.round(parts.reduce((sum, x) => sum + x.value * x.weight, 0) / weight);
        };
        s.observedGapMin = weighted((p) => p.observedGapMin);
        s.scheduledGapMin = weighted((p) => p.scheduledGapMin);
        s.platforms.sort((a, b) => (a.stopId === b.stopId ? (a.route ?? "").localeCompare(b.route ?? "") : a.stopId < b.stopId ? -1 : 1));
    }
    return stations;
}
