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
 * One train is one passage is one stop: each passage fulfils at most one scheduled stop, and a
 * slot fulfilled by its own run reserves that run's passage for its stop before the rest are
 * assigned, so a late train is not counted again at the stop after it.
 *
 * A day holds about 50,000 scheduled stops and as many passages, so every lookup goes through
 * a per-platform bucket of instants (sorted, binary-searched) rather than a scan of the day.
 */
import { medianGapMinutes, platformRouteKey, type DaySchedule, type ScheduledStop } from "./schedule";
import { MINUTE_MS } from "./serviceDay";
import { hasGap, platformKey, type Passage, type Slot, type TrackerState } from "./tracker";
import type { TrainRoute } from "./trainTracker";

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

/** The verdict counts every summary carries; the five outcomes sum to `scheduled`. */
export interface VerdictCounts {
    scheduled: number;
    fulfilled: number;
    cancelled: number;
    ghosts: number;
    unknown: number;
    unobserved: number;
}

export const zeroCounts = (): VerdictCounts => ({ scheduled: 0, fulfilled: 0, cancelled: 0, ghosts: 0, unknown: 0, unobserved: 0 });

export interface PlatformSummary extends VerdictCounts {
    stopId: string;
    /** Null for the platform pooled across its routes (what a rider at the platform sees). */
    route: TrainRoute | null;
    /** The median gap between consecutive passages, and between consecutive scheduled stops, in minutes. */
    observedGapMin: number | null;
    scheduledGapMin: number | null;
}

export interface StationSummary extends VerdictCounts {
    stationId: string;
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

const runKey = (route: TrainRoute, run: string) => `${route}|${run}`;
const platformRunKey = (stationId: string, stopId: string, route: TrainRoute, run: string) => `${platformKey(stationId, stopId, route)}|${run}`;

/** Items bucketed by key; each bucket keeps the items' order, which callers keep sorted by time. */
function bucket<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
    const buckets = new Map<string, T[]>();
    for (const item of items) {
        const key = keyOf(item);
        const list = buckets.get(key);
        if (list === undefined) buckets.set(key, [item]);
        else list.push(item);
    }
    return buckets;
}

/** The first index whose time is at or after `from`, in a list sorted by `timeOf`. */
function lowerBound<T>(sorted: readonly T[], timeOf: (item: T) => number, from: number): number {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (timeOf(sorted[mid]) < from) low = mid + 1;
        else high = mid;
    }
    return low;
}

/**
 * The nearest item within `window` of `at` that `free` admits, earlier items winning ties
 * (only a strictly closer one replaces). The list is sorted by `timeOf`.
 */
function nearest<T>(sorted: readonly T[], timeOf: (item: T) => number, at: number, window: number, free: (item: T) => boolean): T | null {
    let best: T | null = null;
    for (let i = lowerBound(sorted, timeOf, at - window); i < sorted.length; i++) {
        const item = sorted[i];
        const time = timeOf(item);
        if (time > at + window) break;
        if (!free(item)) continue;
        if (best === null || Math.abs(time - at) < Math.abs(timeOf(best) - at)) best = item;
    }
    return best;
}

/** The first item in time order within `window` of `at`, or null. */
function firstWithin<T>(sorted: readonly T[], timeOf: (item: T) => number, at: number, window: number): T | null {
    const i = lowerBound(sorted, timeOf, at - window);
    return i < sorted.length && timeOf(sorted[i]) <= at + window ? sorted[i] : null;
}

const stopInstant = (stop: ScheduledStop) => stop.instant;
const passageTime = (p: Passage) => p.arrivedAt;

/** The verdict of every slot and every scheduled stop of a closed day. */
export function verdictsFor(tracker: TrackerState, schedule: DaySchedule, toleranceMinutes: number = GHOST_TOLERANCE_MINUTES): DayVerdicts {
    const tol = toleranceMinutes * MINUTE_MS;
    const passages = [...tracker.passages].sort((a, b) => a.arrivedAt - b.arrivedAt);
    const passagesByRun = bucket(passages, (p) => runKey(p.route, p.run));
    const passagesByPlatform = bucket(passages, (p) => platformKey(p.stationId, p.stopId, p.route));
    const passagesByPlatformRun = bucket(passages, (p) => platformRunKey(p.stationId, p.stopId, p.route, p.run));
    // schedule.stops is sorted by instant, so each bucket is too.
    const stopsByPlatformRoute = bucket(schedule.stops, (s) => platformRouteKey(s.stopId, s.route));
    const slots = Object.values(tracker.slots).sort((a, b) => a.scheduledAt - b.scheduledAt);

    // 1. Each slot maps to the nearest scheduled stop on its platform and route within the window, each stop once.
    const stopOfSlot = new Map<Slot, ScheduledStop>();
    const slotOfStop = new Map<ScheduledStop, Slot>();
    for (const slot of slots) {
        const candidates = stopsByPlatformRoute.get(platformRouteKey(slot.stopId, slot.route)) ?? [];
        const best = nearest(candidates, stopInstant, slot.scheduledAt, SLOT_MAP_WINDOW_MS, (stop) => !slotOfStop.has(stop));
        if (best !== null) {
            stopOfSlot.set(slot, best);
            slotOfStop.set(best, slot);
        }
    }

    // 2. Each passage fulfils at most one scheduled stop. First, a slot replaced by a live prediction
    //    with its run reserves, for the stop it maps to, the free passage with that run on its
    //    platform and route nearest its scheduled time, from the tolerance before it to the end of
    //    the day: the same-run rule fulfils at any lateness, so its passage can come at any lateness
    //    too, but no earlier than a passage can serve a stop. Run numbers recur through a day, hours
    //    apart, so the nearest is the trip's own passage whenever one was logged. Without the
    //    reservation a late train's passage would go to the next stop by proximity, and one train
    //    would fulfil two stops. Then every other passage takes the nearest unassigned stop on its
    //    platform and route within the tolerance.
    const passageOfStop = new Map<ScheduledStop, Passage>();
    const reserved = new Set<Passage>();
    for (const slot of slots) {
        const stop = stopOfSlot.get(slot);
        if (slot.liveSameRunAt === null || stop === undefined) continue;
        const distance = (p: Passage) => Math.abs(p.arrivedAt - slot.scheduledAt);
        let best: Passage | null = null;
        for (const run of slot.runs) {
            const candidates = passagesByPlatformRun.get(platformRunKey(slot.stationId, slot.stopId, slot.route, run)) ?? [];
            for (let i = lowerBound(candidates, passageTime, slot.scheduledAt - tol); i < candidates.length; i++) {
                const p = candidates[i];
                if (reserved.has(p)) continue;
                // The nearer wins, and at equal distance the earlier, as `nearest` has it.
                if (best === null || distance(p) < distance(best) || (distance(p) === distance(best) && p.arrivedAt < best.arrivedAt)) best = p;
            }
        }
        if (best !== null) {
            reserved.add(best);
            passageOfStop.set(stop, best);
        }
    }
    for (const p of passages) {
        if (reserved.has(p)) continue;
        const candidates = stopsByPlatformRoute.get(platformRouteKey(p.stopId, p.route)) ?? [];
        const stop = nearest(candidates, stopInstant, p.arrivedAt, tol, (s) => !passageOfStop.has(s));
        if (stop !== null) passageOfStop.set(stop, p);
    }

    // 3. Slot verdicts. A mapped slot's passage is the one its stop was assigned; an unmapped slot
    //    takes any passage on its platform and route within the tolerance. The lookups run only
    //    as far down the chain as the verdict needs.
    const slotVerdicts: SlotVerdict[] = [];
    for (const slot of slots) {
        const windowStart = slot.scheduledAt - tol;
        const windowEnd = slot.scheduledAt + tol;
        const stop = stopOfSlot.get(slot) ?? null;
        const platformPassage = (): Passage | null =>
            stop !== null
                ? (passageOfStop.get(stop) ?? null)
                : firstWithin(passagesByPlatform.get(platformKey(slot.stationId, slot.stopId, slot.route)) ?? [], passageTime, slot.scheduledAt, tol);
        const runPassage = (): Passage | null => {
            for (const run of slot.runs) {
                const found = (passagesByRun.get(runKey(slot.route, run)) ?? []).find(
                    (p) => p.stationId !== slot.stationId && p.arrivedAt >= windowStart && p.arrivedAt <= windowEnd + NEXT_STATION_TRAVEL_MS,
                );
                if (found !== undefined) return found;
            }
            return null;
        };
        let verdict: SlotOutcome;
        let by: FulfilledBy | null = null;
        let late = false;
        let passage: Passage | null;
        if (slot.liveSameRunAt !== null) {
            verdict = "fulfilled";
            by = "same-run";
            late = slot.liveSameRunAt > windowEnd;
        } else if ((passage = platformPassage()) !== null) {
            verdict = "fulfilled";
            by = "passage";
        } else if ((passage = runPassage()) !== null) {
            verdict = "fulfilled";
            by = "next-station";
            late = passage.arrivedAt > windowEnd;
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

function count(summary: VerdictCounts, verdict: StopOutcome): void {
    summary.scheduled += 1;
    if (verdict === "fulfilled") summary.fulfilled += 1;
    else if (verdict === "cancelled") summary.cancelled += 1;
    else if (verdict === "ghost") summary.ghosts += 1;
    else if (verdict === "unknown") summary.unknown += 1;
    else summary.unobserved += 1;
}

const platformSummaryKey = (stopId: string, route: TrainRoute | null) => `${stopId}|${route ?? ""}`;

function summarize(stops: StopVerdict[], slots: SlotVerdict[], passages: Passage[], schedule: DaySchedule): Map<string, StationSummary> {
    const stations = new Map<string, StationSummary>();
    const platformsByStation = new Map<string, Map<string, PlatformSummary>>();
    const station = (id: string): StationSummary => {
        let s = stations.get(id);
        if (!s) {
            s = { ...zeroCounts(), stationId: id, unmapped: 0, platforms: [], observedGapMin: null, scheduledGapMin: null };
            stations.set(id, s);
            platformsByStation.set(id, new Map());
        }
        return s;
    };
    const platform = (s: StationSummary, stopId: string, route: TrainRoute | null): PlatformSummary => {
        const platforms = platformsByStation.get(s.stationId)!;
        const key = platformSummaryKey(stopId, route);
        let p = platforms.get(key);
        if (!p) {
            p = { ...zeroCounts(), stopId, route, observedGapMin: null, scheduledGapMin: null };
            platforms.set(key, p);
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

    // Gaps: passages per platform (pooled and per route) and scheduled stops likewise, each grouped once.
    const passagesByPlatform = bucket(passages, (p) => platformSummaryKey(p.stopId, null));
    const passagesByPlatformRoute = bucket(passages, (p) => platformSummaryKey(p.stopId, p.route));
    const stopsByPlatform = bucket(schedule.stops, (s) => platformSummaryKey(s.stopId, null));
    for (const s of stations.values()) {
        for (const p of s.platforms) {
            const arrivals = (p.route === null ? passagesByPlatform : passagesByPlatformRoute).get(platformSummaryKey(p.stopId, p.route)) ?? [];
            p.observedGapMin = medianGapMinutes(arrivals.filter((x) => x.stationId === s.stationId).map((x) => x.arrivedAt));
            p.scheduledGapMin =
                p.route === null
                    ? medianGapMinutes((stopsByPlatform.get(platformSummaryKey(p.stopId, null)) ?? []).map((x) => x.instant))
                    : (schedule.platformRoutes.get(platformRouteKey(p.stopId, p.route))?.scheduledGapMin ?? null);
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
