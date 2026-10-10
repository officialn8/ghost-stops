/**
 * The service day and Chicago time for the live Ghost score (R8, R16; KTD5).
 *
 * A service day runs from 03:00 Chicago to 03:00 the next morning and is named by the calendar
 * date it starts on, as a YYYY-MM-DD string (the repo's date convention). Train Tracker's
 * timestamps are naive Chicago wall-clock strings, GTFS stop times are seconds past "noon minus
 * twelve hours" of a trip's service date, and raw files bucket at the 03:00 boundary; every
 * conversion goes through `Intl.DateTimeFormat` with the `America/Chicago` zone. Nothing here does
 * `new Date()` arithmetic on a local string, which would read the string in the server's zone.
 *
 * Chicago's UTC offset changes only at 02:00 local, which is 07:00 or 08:00 UTC, on the hour, so
 * one Intl reading per UTC hour gives the exact offset for every instant in that hour. The
 * reading is cached, which keeps the matcher's and the schedule's millions of conversions cheap.
 */
import { addDays, isCalendarDate } from "@/lib/sync/window";

export const CHICAGO_TZ = "America/Chicago";

/** The hour a service day starts, Chicago time. */
export const SERVICE_DAY_START_HOUR = 3;

/** Minutes past 03:00 plus the tolerance before a day is reduced, so the last slots have verdicts. */
export const DAY_CLOSE_MARGIN_MINUTES = 10;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** A Chicago wall-clock reading: the calendar date and the time of day. */
export interface WallClock {
    date: string;
    hour: number;
    minute: number;
    second: number;
}

const wallClockFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

function assertCalendarDate(date: string): void {
    if (!isCalendarDate(date)) throw new Error(`Expected a YYYY-MM-DD calendar date, got "${date}"`);
}

/** The wall clock read as if it were UTC: the number `Date.UTC` gives for its fields. */
function wallClockAsUtc(wall: WallClock): number {
    const [year, month, day] = wall.date.split("-").map(Number);
    return Date.UTC(year, month - 1, day, wall.hour, wall.minute, wall.second);
}

/** The Intl reading itself, once per UTC hour. */
function offsetFromIntl(epochMs: number): number {
    const parts = wallClockFormat.formatToParts(new Date(epochMs));
    const field = (type: Intl.DateTimeFormatPartTypes) => {
        const part = parts.find((p) => p.type === type);
        if (!part) throw new Error(`Intl gave no ${type} part`);
        return part.value;
    };
    const wall: WallClock = {
        date: `${field("year")}-${field("month")}-${field("day")}`,
        hour: Number(field("hour")) % 24,
        minute: Number(field("minute")),
        second: Number(field("second")),
    };
    return wallClockAsUtc(wall) - epochMs;
}

const offsetByUtcHour = new Map<number, number>();

/** Chicago's UTC offset at an instant, in milliseconds (negative: -5 h in summer, -6 h in winter). */
export function chicagoOffsetMs(epochMs: number): number {
    const hour = Math.floor(epochMs / HOUR_MS);
    let offset = offsetByUtcHour.get(hour);
    if (offset === undefined) {
        offset = offsetFromIntl(hour * HOUR_MS);
        offsetByUtcHour.set(hour, offset);
    }
    return offset;
}

/** The Chicago wall clock at an instant. */
export function chicagoWallClock(epochMs: number): WallClock {
    const local = new Date(Math.floor(epochMs) + chicagoOffsetMs(epochMs));
    return {
        date: `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`,
        hour: local.getUTCHours(),
        minute: local.getUTCMinutes(),
        second: local.getUTCSeconds(),
    };
}

const sameWallClock = (a: WallClock, b: WallClock) =>
    a.date === b.date && a.hour === b.hour && a.minute === b.minute && a.second === b.second;

/**
 * The instant a Chicago wall clock names. A reading inside the fall-back hour names two instants;
 * the one nearest `nearEpochMs` (a poll's own epoch) wins, or the first without a reference. A
 * reading inside the spring-forward gap names none and is moved forward by the gap, as a clock
 * that was not reset would read.
 */
export function instantOfChicagoLocal(wall: WallClock, nearEpochMs?: number): number {
    assertCalendarDate(wall.date);
    if (wall.hour < 0 || wall.hour > 23 || wall.minute < 0 || wall.minute > 59 || wall.second < 0 || wall.second > 59) {
        throw new Error(`Not a time of day: ${wall.hour}:${wall.minute}:${wall.second}`);
    }
    const guess = wallClockAsUtc(wall);
    // The offsets in force a day either side cover both sides of any transition.
    const offsets = [...new Set([chicagoOffsetMs(guess - 24 * HOUR_MS), chicagoOffsetMs(guess + 24 * HOUR_MS)])];
    const candidates = offsets.map((offset) => guess - offset).filter((instant) => sameWallClock(chicagoWallClock(instant), wall));
    if (candidates.length === 0) {
        // Inside the gap: no instant reads this way. Use the offset from before the transition.
        return guess - chicagoOffsetMs(guess - 24 * HOUR_MS);
    }
    if (candidates.length === 1 || nearEpochMs === undefined) return Math.min(...candidates);
    return candidates.reduce((best, c) => (Math.abs(c - nearEpochMs) < Math.abs(best - nearEpochMs) ? c : best));
}

const NAIVE_TIMESTAMP = /^(\d{4})-?(\d{2})-?(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * A Train Tracker timestamp (`tmst`, `prdt`, `arrT`) in either documented shape, "yyyyMMdd
 * HH:mm:ss" or "yyyy-MM-ddTHH:mm:ss", both naive Chicago local, as an instant. `nearEpochMs` is the
 * poll's own epoch, which settles the fall-back hour.
 */
export function parseChicagoLocal(text: string, nearEpochMs?: number): number {
    const match = NAIVE_TIMESTAMP.exec(text);
    if (!match) throw new Error(`Not a Chicago timestamp: "${text}"`);
    const [, year, month, day, hour, minute, second] = match;
    return instantOfChicagoLocal(
        { date: `${year}-${month}-${day}`, hour: Number(hour), minute: Number(minute), second: Number(second) },
        nearEpochMs,
    );
}

/** The service date an instant belongs to: the Chicago calendar date, or the day before until 03:00. */
export function serviceDateOf(epochMs: number): string {
    const wall = chicagoWallClock(epochMs);
    return wall.hour < SERVICE_DAY_START_HOUR ? addDays(wall.date, -1) : wall.date;
}

/** The instant a service day starts: 03:00 Chicago on its date (never inside a transition). */
export function serviceDayStart(serviceDate: string): number {
    return instantOfChicagoLocal({ date: serviceDate, hour: SERVICE_DAY_START_HOUR, minute: 0, second: 0 });
}

/** The minute of a service day an instant falls in: 0 at 03:00 Chicago, past the day's end for the overlap. */
export function minuteIndexOf(serviceDate: string, epochMs: number): number {
    return Math.floor((epochMs - serviceDayStart(serviceDate)) / MINUTE_MS);
}

/** The hour of a service day an instant falls in: 0 at 03:00 Chicago, up to 24 on a fall-back day. */
export function hourIndexOf(serviceDate: string, epochMs: number): number {
    return Math.floor((epochMs - serviceDayStart(serviceDate)) / HOUR_MS);
}

const GTFS_TIME = /^(\d{1,2}):(\d{2}):(\d{2})$/;

/** A GTFS stop time ("25:10:00" is allowed) as seconds past the service day's noon-minus-twelve. */
export function parseGtfsTime(text: string): number {
    const match = GTFS_TIME.exec(text);
    if (!match) throw new Error(`Not a GTFS time: "${text}"`);
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/**
 * The instant of a GTFS time on a service date: noon of that date minus twelve hours, plus the
 * seconds (the GTFS rule, which keeps times past 24:00 on their trip's service date, AE11).
 */
export function instantOfGtfsTime(serviceDate: string, seconds: number): number {
    const noon = instantOfChicagoLocal({ date: serviceDate, hour: 12, minute: 0, second: 0 });
    return noon - 12 * HOUR_MS + seconds * 1000;
}

/** The polls a service day expects at one a minute: its elapsed minutes (1,500 on a fall-back day). */
export function expectedPolls(serviceDate: string): number {
    return Math.round((serviceDayStart(addDays(serviceDate, 1)) - serviceDayStart(serviceDate)) / MINUTE_MS);
}

/**
 * When a service day closes for reduction: 03:00 the next morning, or the feed's latest scheduled
 * stop if that runs later, plus the tolerance and a margin so the last slots have their verdicts.
 */
export function dayCloseInstant(serviceDate: string, toleranceMinutes: number, latestStopSeconds?: number): number {
    const dayEnd = serviceDayStart(addDays(serviceDate, 1));
    const latestStop = latestStopSeconds === undefined ? dayEnd : instantOfGtfsTime(serviceDate, latestStopSeconds);
    return Math.max(dayEnd, latestStop) + (toleranceMinutes + DAY_CLOSE_MARGIN_MINUTES) * MINUTE_MS;
}

/**
 * The latest service day that has closed by `nowEpochMs`: the calendar anchor the readers' windows
 * and the worker's gap filling share (KTD7), so "yesterday" means the same day everywhere.
 */
export function latestClosedServiceDay(nowEpochMs: number, toleranceMinutes: number): string {
    let day = addDays(serviceDateOf(nowEpochMs), -1);
    while (dayCloseInstant(day, toleranceMinutes) > nowEpochMs) day = addDays(day, -1);
    return day;
}
