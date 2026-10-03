/**
 * Date windows for the ridership sync. Dates are YYYY-MM-DD calendar strings end to end (KTD17),
 * so no time zone ever shifts a service day.
 */

/** How far back each run re-fetches, so upstream revisions to recent days are absorbed (R10). */
const WINDOW_DAYS = 60;

export interface DateWindow {
    /** First service day, inclusive. */
    start: string;
    /** Last service day, inclusive. */
    end: string;
}

export const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * True for a real YYYY-MM-DD calendar date (2026-02-30 is not one). Years 0000 to 0099 are
 * rejected too, because Date.UTC reads them as 1900 to 1999.
 */
export function isCalendarDate(value: string): boolean {
    const match = ISO_DATE.exec(value);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** A YYYY-MM-DD calendar date as midnight UTC; throws on anything else, such as 2026-02-30. */
export function toUtcDate(date: string): Date {
    if (!isCalendarDate(date)) throw new Error(`Expected a YYYY-MM-DD calendar date, got "${date}"`);
    return new Date(`${date}T00:00:00Z`);
}

/** The calendar date of a UTC-midnight `Date`, as Prisma returns `@db.Date` columns. */
export function toDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** `toDay` for a nullable column: null stays null. */
export function optionalDay(date: Date | null | undefined): string | null {
    return date ? toDay(date) : null;
}

export function addDays(date: string, days: number): string {
    const parsed = toUtcDate(date);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return toDay(parsed);
}

export function monthOf(date: string): string {
    return toDay(toUtcDate(date)).slice(0, 7);
}

/** The first and last day of a YYYY-MM month. */
export function monthRange(month: string): DateWindow {
    const match = ISO_MONTH.exec(month);
    if (!match) throw new Error(`Expected a YYYY-MM month, got "${month}"`);
    const lastDay = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0));
    return { start: `${month}-01`, end: toDay(lastDay) };
}

/**
 * The trailing window: WINDOW_DAYS back from the later of upstream's latest date and ours (KTD4).
 * Anchored on data, never on the wall clock, so CTA's two-month publishing lag cannot leave a gap.
 */
export function trailingWindow(upstreamMax: string, storedMax: string | null): DateWindow {
    const end = storedMax !== null && storedMax > upstreamMax ? storedMax : upstreamMax;
    return { start: addDays(end, -WINDOW_DAYS), end };
}

/** Splits a window into calendar-month pieces, oldest first, so each request stays small. */
export function monthChunks(window: DateWindow): DateWindow[] {
    if (toUtcDate(window.end) < toUtcDate(window.start)) {
        throw new Error(`Window ${window.start} to ${window.end} ends before it starts`);
    }
    const chunks: DateWindow[] = [];
    let start = window.start;
    while (start <= window.end) {
        const monthEnd = monthRange(monthOf(start)).end;
        const end = monthEnd < window.end ? monthEnd : window.end;
        chunks.push({ start, end });
        start = addDays(end, 1);
    }
    return chunks;
}
