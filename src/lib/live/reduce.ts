/**
 * The nightly reduction (R8, R10, R13, R16, R18; KTD5, KTD7, KTD9; AE3, AE7, AE14): a closed
 * day's tracker and schedule become one LiveDay row and one LiveStationDay row per roster station.
 *
 * The day's verdict, in order: no schedule in force sets it aside (`no-schedule`); a quota stop
 * sets it aside (`quota`); polls under 90% of the expected count set it aside (`site-gap`); a
 * feed whose shape changed, no schedule-only prediction all day while trains were scheduled or
 * malformed entries in over 1% of responses, sets it aside (`feed-shape`); a line whose positions
 * showed fewer than one live train for every four scheduled in three consecutive hours that each
 * scheduled at least four is in fault for the day, and when every line is, the day is set aside
 * (`tracker-fault`). Otherwise the day is counted and the lines in fault are named.
 *
 * A station loses a counted day when it is closed, when a line serving it is in fault, when its
 * own successful polls are under 90% of the expected count, or when fewer than 90% of its
 * scheduled stops were observed at all (fulfilled, cancelled, or ghost); its row names which. On
 * a set-aside day every open station's row names the site's gap (or the tracker's fault), and a
 * closed station's row stays `closed`.
 */
import { verdictsFor, type DayVerdicts, type PlatformSummary } from "./matcher";
import type { DaySchedule } from "./schedule";
import { expectedPolls } from "./serviceDay";
import { hourIndexOf } from "./rawStore";
import { stationPolls, type TrackerState } from "./tracker";
import { ARRIVALS_BATCH_SIZE, TRAIN_ROUTES, type TrainRoute } from "./trainTracker";

/** Bumped when the matching rule changes meaning; a re-reduce rewrites a day under it (KTD6). */
export const REDUCER_VERSION = 1;

export const DAY_COVERAGE_FLOOR = 0.9;
export const STATION_COVERAGE_FLOOR = 0.9;
export const OBSERVED_STOP_FLOOR = 0.9;
/** A minute counts as a succeeded poll when its positions call worked and this share of batches did. */
export const MINUTE_BATCH_FLOOR = 0.9;
export const FEED_SHAPE_MALFORMED_SHARE = 0.01;
/** The tracker-fault floor (KTD7): live trains under this share of the hour's scheduled trips ... */
export const FAULT_LIVE_SHARE = 1 / 4;
/** ... in this many consecutive hours that each scheduled at least this many trips. */
export const FAULT_CONSECUTIVE_HOURS = 3;
export const FAULT_MIN_SCHEDULED_TRIPS = 4;

export type DayCause = "site-gap" | "no-schedule" | "tracker-fault" | "quota" | "feed-shape";
export type StationCause = "site-gap" | "tracker-fault" | "unobserved" | "closed";

export interface LiveDayRow {
    serviceDate: string;
    verdict: "COUNTED" | "SET_ASIDE";
    cause: DayCause | null;
    pollsExpected: number;
    pollsSucceeded: number;
    coverage: number;
    faultLines: TrainRoute[];
    scheduleVersion: string | null;
    reducerVersion: number;
    reducedAt: Date;
}

export interface LiveStationDayRow {
    ctaStationId: string;
    scheduled: number;
    fulfilled: number;
    cancelled: number;
    ghosts: number;
    unknown: number;
    unobserved: number;
    unmapped: number;
    coverage: number;
    counted: boolean;
    notCountedCause: StationCause | null;
    observedGapMin: number | null;
    scheduledGapMin: number | null;
    byDirection: PlatformSummary[];
}

export interface ReduceInput {
    serviceDate: string;
    tracker: TrackerState;
    /** The day's schedule, or null when no version was in force. */
    schedule: DaySchedule | null;
    /** Every roster station, open or closed. */
    stationIds: readonly string[];
    closedStationIds: ReadonlySet<string>;
    /** A quota stop or a revoked key stopped the calls during this day. */
    quotaStopped: boolean;
    toleranceMinutes?: number;
    reducedAt: Date;
}

export interface ReducedDay {
    day: LiveDayRow;
    stations: LiveStationDayRow[];
    verdicts: DayVerdicts | null;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Minutes of the day that count as a succeeded poll: positions worked and almost every batch did. */
export function succeededPolls(tracker: TrackerState, expected: number, stationsSwept: number): number {
    const batches = Math.ceil(stationsSwept / ARRIVALS_BATCH_SIZE);
    const allowedFailedStations = Math.floor((1 - MINUTE_BATCH_FLOOR) * batches) * ARRIVALS_BATCH_SIZE;
    let count = 0;
    for (const [index, record] of Object.entries(tracker.minutes)) {
        if (Number(index) < 0 || Number(index) >= expected) continue;
        if (record.p === 1 && record.f.length <= allowedFailedStations) count += 1;
    }
    return count;
}

/** The share of responses the parser could not fully read, over the day's polled minutes. */
export function malformedShare(tracker: TrackerState, expected: number, stationsSwept: number): number {
    const callsPerMinute = 1 + Math.ceil(stationsSwept / ARRIVALS_BATCH_SIZE);
    let minutes = 0;
    let malformed = 0;
    for (const [index, record] of Object.entries(tracker.minutes)) {
        if (Number(index) < 0 || Number(index) >= expected) continue;
        minutes += 1;
        malformed += record.m;
    }
    return minutes === 0 ? 0 : malformed / (minutes * callsPerMinute);
}

/** The lines in fault for the day (KTD7): too few live trains for the scheduled trips, three hours running. */
export function lineFaults(tracker: TrackerState, schedule: DaySchedule, expected: number): TrainRoute[] {
    const hours = Math.ceil(expected / 60);
    const faults: TrainRoute[] = [];
    for (const [routeIndex, route] of TRAIN_ROUTES.entries()) {
        const trips: Set<string>[] = Array.from({ length: hours }, () => new Set<string>());
        for (const stop of schedule.stops) {
            if (stop.route !== route) continue;
            const hour = hourIndexOf(schedule.serviceDate, stop.instant);
            if (hour >= 0 && hour < hours) trips[hour].add(stop.tripId);
        }
        const live: { sum: number; n: number }[] = Array.from({ length: hours }, () => ({ sum: 0, n: 0 }));
        for (const [index, record] of Object.entries(tracker.minutes)) {
            const hour = Math.floor(Number(index) / 60);
            if (hour < 0 || hour >= hours || record.t === null) continue;
            live[hour].sum += record.t[routeIndex] ?? 0;
            live[hour].n += 1;
        }
        let run = 0;
        for (let hour = 0; hour < hours; hour++) {
            const scheduled = trips[hour].size;
            const observed = live[hour].n === 0 ? null : live[hour].sum / live[hour].n;
            const fault = scheduled >= FAULT_MIN_SCHEDULED_TRIPS && observed !== null && observed < scheduled * FAULT_LIVE_SHARE;
            run = fault ? run + 1 : 0;
            if (run >= FAULT_CONSECUTIVE_HOURS) {
                faults.push(route);
                break;
            }
        }
    }
    return faults;
}

/** The routes with a scheduled stop at the station that day. */
export function routesServing(schedule: DaySchedule, stationId: string): Set<TrainRoute> {
    return new Set((schedule.byStation.get(stationId) ?? []).map((s) => s.route));
}

const emptyCounts = () => ({ scheduled: 0, fulfilled: 0, cancelled: 0, ghosts: 0, unknown: 0, unobserved: 0, unmapped: 0, observedGapMin: null, scheduledGapMin: null, byDirection: [] as PlatformSummary[] });

export function reduceDay(input: ReduceInput): ReducedDay {
    const { serviceDate, tracker, schedule, stationIds, closedStationIds } = input;
    const expected = expectedPolls(serviceDate);
    const stationsSwept = stationIds.filter((id) => !closedStationIds.has(id)).length;
    const pollsSucceeded = succeededPolls(tracker, expected, stationsSwept);
    const coverage = round4(pollsSucceeded / expected);
    const verdicts = schedule === null ? null : verdictsFor(tracker, schedule, input.toleranceMinutes);

    let cause: DayCause | null = null;
    let faultLines: TrainRoute[] = [];
    if (schedule === null) cause = "no-schedule";
    else if (input.quotaStopped) cause = "quota";
    else if (coverage < DAY_COVERAGE_FLOOR) cause = "site-gap";
    else if ((schedule.stops.length > 0 && Object.keys(tracker.slots).length === 0) || malformedShare(tracker, expected, stationsSwept) > FEED_SHAPE_MALFORMED_SHARE) cause = "feed-shape";
    else {
        faultLines = lineFaults(tracker, schedule, expected);
        const scheduledRoutes = new Set(schedule.stops.map((s) => s.route));
        if (scheduledRoutes.size > 0 && [...scheduledRoutes].every((r) => faultLines.includes(r))) cause = "tracker-fault";
    }
    const day: LiveDayRow = {
        serviceDate,
        verdict: cause === null ? "COUNTED" : "SET_ASIDE",
        cause,
        pollsExpected: expected,
        pollsSucceeded,
        coverage,
        faultLines,
        scheduleVersion: schedule?.version ?? null,
        reducerVersion: REDUCER_VERSION,
        reducedAt: input.reducedAt,
    };

    const stations: LiveStationDayRow[] = [];
    for (const ctaStationId of [...stationIds].sort()) {
        const closed = closedStationIds.has(ctaStationId);
        const summary = closed ? null : (verdicts?.byStation.get(ctaStationId) ?? null);
        const counts = summary ?? emptyCounts();
        const stationCoverage = closed ? 0 : round4(stationPolls(tracker, ctaStationId, expected) / expected);
        let notCountedCause: StationCause | null = null;
        if (closed) notCountedCause = "closed";
        else if (cause !== null) notCountedCause = cause === "tracker-fault" ? "tracker-fault" : "site-gap";
        else if (schedule !== null && [...routesServing(schedule, ctaStationId)].some((r) => faultLines.includes(r))) notCountedCause = "tracker-fault";
        else if (stationCoverage < STATION_COVERAGE_FLOOR) notCountedCause = "site-gap";
        else if (counts.scheduled === 0 || counts.fulfilled + counts.cancelled + counts.ghosts < OBSERVED_STOP_FLOOR * counts.scheduled) notCountedCause = "unobserved";
        stations.push({
            ctaStationId,
            scheduled: counts.scheduled,
            fulfilled: counts.fulfilled,
            cancelled: counts.cancelled,
            ghosts: counts.ghosts,
            unknown: counts.unknown,
            unobserved: counts.unobserved,
            unmapped: counts.unmapped,
            coverage: stationCoverage,
            counted: notCountedCause === null,
            notCountedCause,
            observedGapMin: counts.observedGapMin,
            scheduledGapMin: counts.scheduledGapMin,
            byDirection: summary?.platforms ?? [],
        });
    }
    return { day, stations, verdicts };
}
