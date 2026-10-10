/**
 * A service day's scheduled stops from an archived rail schedule (R16; KTD4, KTD6, KTD9).
 *
 * A scheduled stop belongs to the service day its instant falls in: 03:00 Chicago to 03:00 the
 * next morning. CTA's feed writes a post-midnight trip either way, as 25:10:00 on the day before
 * or as 01:10:00 on the calendar day it runs, and both name the same instant, so the instant is
 * the one rule under which a stop, the polls that watched for it, the raw file that recorded
 * them, and the day row that counts it all name the same day. Building a day therefore reads the
 * trips active on its calendar date and on the next one.
 *
 * Dropped from a trip: its last stop, the terminal arrival (Train Tracker has no prediction
 * there), and any stop riders cannot board (`pickup_type` 1, the exit-only platforms).
 */
import { addDays } from "@/lib/sync/window";
import type { RailSchedule, RailTrip } from "./gtfs";
import { instantOfGtfsTime, serviceDayStart } from "./serviceDay";
import type { TrainRoute } from "./trainTracker";

export interface ScheduledStop {
    /** The platform (3xxxx) and the roster's station id (4xxxx). */
    stopId: string;
    stationId: string;
    route: TrainRoute;
    /** GTFS `direction_id` of the trip. */
    direction: string;
    tripId: string;
    /** When the stop is scheduled, epoch ms. */
    instant: number;
    /** The calendar date the trip is listed under and its GTFS time, for the record. */
    calendarDate: string;
    seconds: number;
}

/** One platform on one route: the grain a schedule-only slot is matched at (KTD4). */
export interface PlatformRoute {
    stopId: string;
    stationId: string;
    route: TrainRoute;
    /** Scheduled instants in order. */
    instants: number[];
    /** The median gap between consecutive scheduled stops, in minutes; null under two stops. */
    scheduledGapMin: number | null;
}

export interface DaySchedule {
    serviceDate: string;
    /** The feed version (hash) this came from. */
    version: string;
    /** Every scheduled stop of the day, by instant. */
    stops: ScheduledStop[];
    /** Per station, by instant. */
    byStation: Map<string, ScheduledStop[]>;
    /** Per platform and route. */
    platformRoutes: Map<string, PlatformRoute>;
    /** Day start and end instants, the window the stops fall in. */
    start: number;
    end: number;
}

export const platformRouteKey = (stopId: string, route: TrainRoute) => `${stopId}|${route}`;

const WEEKDAY_INDEX = (date: string): number => {
    // Monday 0 .. Sunday 6, as calendar.txt lists them; the date is a calendar string, so UTC is safe.
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return (day + 6) % 7;
};

/** The service ids running on a calendar date: the calendar's day bit, then the exceptions. */
export function activeServices(schedule: Pick<RailSchedule, "services" | "exceptions">, calendarDate: string): Set<string> {
    const active = new Set<string>();
    const weekday = WEEKDAY_INDEX(calendarDate);
    for (const [id, calendar] of Object.entries(schedule.services)) {
        if (calendar.start <= calendarDate && calendarDate <= calendar.end && calendar.days[weekday] === 1) active.add(id);
    }
    for (const exception of schedule.exceptions) {
        if (exception.date !== calendarDate) continue;
        if (exception.type === 1) active.add(exception.service);
        else active.delete(exception.service);
    }
    return active;
}

/** A trip's stops riders can board at: everything but the terminal arrival and exit-only platforms. */
export function boardingStops(trip: RailTrip): RailTrip["stops"] {
    return trip.stops.slice(0, -1).filter(([, , pickupType]) => pickupType !== 1);
}

export function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The median gap between consecutive instants, in minutes, rounded to a tenth; null under two. */
export function medianGapMinutes(instants: readonly number[]): number | null {
    if (instants.length < 2) return null;
    const sorted = [...instants].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((t, i) => (t - sorted[i]) / 60_000);
    const value = median(gaps);
    return value === null ? null : Math.round(value * 10) / 10;
}

/** Every scheduled stop of one service day, from the trips active on its date and the next. */
export function scheduledStopsFor(schedule: RailSchedule, serviceDate: string): DaySchedule {
    const start = serviceDayStart(serviceDate);
    const end = serviceDayStart(addDays(serviceDate, 1));
    const stops: ScheduledStop[] = [];
    for (const calendarDate of [serviceDate, addDays(serviceDate, 1)]) {
        const active = activeServices(schedule, calendarDate);
        for (const trip of schedule.trips) {
            if (!active.has(trip.service)) continue;
            for (const [stopId, seconds] of boardingStops(trip)) {
                const instant = instantOfGtfsTime(calendarDate, seconds);
                if (instant < start || instant >= end) continue;
                const stationId = schedule.platforms[stopId];
                if (stationId === undefined) continue; // the extractor refuses such a feed; belt and braces
                stops.push({ stopId, stationId, route: trip.route, direction: trip.direction, tripId: trip.id, instant, calendarDate, seconds });
            }
        }
    }
    stops.sort((a, b) => a.instant - b.instant || (a.stopId < b.stopId ? -1 : a.stopId > b.stopId ? 1 : 0) || (a.route < b.route ? -1 : 1));

    const byStation = new Map<string, ScheduledStop[]>();
    const platformRoutes = new Map<string, PlatformRoute>();
    for (const stop of stops) {
        byStation.set(stop.stationId, [...(byStation.get(stop.stationId) ?? []), stop]);
        const key = platformRouteKey(stop.stopId, stop.route);
        const entry = platformRoutes.get(key) ?? { stopId: stop.stopId, stationId: stop.stationId, route: stop.route, instants: [], scheduledGapMin: null };
        entry.instants.push(stop.instant);
        platformRoutes.set(key, entry);
    }
    for (const entry of platformRoutes.values()) entry.scheduledGapMin = medianGapMinutes(entry.instants);

    return { serviceDate, version: schedule.hash, stops, byStation, platformRoutes, start, end };
}

/** Scheduled stops per route for a day, for reports and the tracker-fault floor. */
export function countByRoute(day: DaySchedule): Record<TrainRoute, number> {
    const counts = { red: 0, blue: 0, brn: 0, g: 0, org: 0, p: 0, pink: 0, y: 0 };
    for (const stop of day.stops) counts[stop.route] += 1;
    return counts;
}
