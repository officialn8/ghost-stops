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
import { median } from "@/lib/scoring/components";
import { addDays, toUtcDate } from "@/lib/sync/window";
import type { RailSchedule, RailTrip } from "./gtfs";
import { instantOfGtfsTime, MINUTE_MS, serviceDayStart } from "./serviceDay";
import type { TrainRoute } from "./trainTracker";

export { median };

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

/** Monday 0 to Sunday 6, as calendar.txt lists the days. */
const weekdayIndex = (date: string): number => (toUtcDate(date).getUTCDay() + 6) % 7;

/** The service ids running on a calendar date: the calendar's day bit, then the exceptions. */
export function activeServices(schedule: Pick<RailSchedule, "services" | "exceptions">, calendarDate: string): Set<string> {
    const active = new Set<string>();
    const weekday = weekdayIndex(calendarDate);
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

/** The median gap between consecutive instants, in minutes, rounded to a tenth; null under two. */
export function medianGapMinutes(instants: readonly number[]): number | null {
    if (instants.length < 2) return null;
    const sorted = [...instants].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((t, i) => (t - sorted[i]) / MINUTE_MS);
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
        // Noon minus twelve hours of the calendar date; every stop is that plus its seconds.
        const base = instantOfGtfsTime(calendarDate, 0);
        for (const trip of schedule.trips) {
            if (!active.has(trip.service)) continue;
            for (const [stopId, seconds] of boardingStops(trip)) {
                const instant = base + seconds * 1000;
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
        const atStation = byStation.get(stop.stationId);
        if (atStation === undefined) byStation.set(stop.stationId, [stop]);
        else atStation.push(stop);
        const key = platformRouteKey(stop.stopId, stop.route);
        const entry = platformRoutes.get(key);
        if (entry === undefined) platformRoutes.set(key, { stopId: stop.stopId, stationId: stop.stationId, route: stop.route, instants: [stop.instant], scheduledGapMin: null });
        else entry.instants.push(stop.instant);
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
