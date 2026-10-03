const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real YYYY-MM-DD calendar date (2026-02-30 is not one). */
export function isCalendarDate(value: string): boolean {
    const match = ISO_DATE.exec(value);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
