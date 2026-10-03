/**
 * The raw values behind score v2's four components (docs/audit-2026-10-02/ghost-score.md section
 * 5.2), as pure functions of a station's daily rows and averages:
 *
 * - residual: log of the station's 12-month average over its peers' baseline (peers.ts);
 * - year-over-year change: the trailing 90 days against the same days a year earlier, with
 *   weekdays and weekends averaged separately and recombined 5:2, so neither the day mix of the
 *   window nor the season moves it;
 * - long-run change: the 12-month average against the 2019 average;
 * - erraticness: median absolute deviation over median, within weekdays and within weekends,
 *   over the trailing 90 days, averaged.
 *
 * Changes are in percent. Every function returns null rather than a number it cannot stand behind.
 */

export interface DayRow {
    serviceDate: string;
    entries: number;
    /** W weekday, A Saturday, U Sunday or holiday. */
    dayType: string;
}

/** One window's ridership, weekdays apart from weekends (Saturdays, Sundays, and holidays). */
export interface WindowSummary {
    weekdayDays: number;
    weekendDays: number;
    weekdayAvg: number | null;
    weekendAvg: number | null;
    /** Median absolute deviation over median; null with no rows or a median of zero. */
    weekdayMadRatio: number | null;
    weekendMadRatio: number | null;
}

const WEEKDAY_WEIGHT = 5;
const WEEKEND_WEIGHT = 2;

export function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

function madRatio(values: readonly number[]): number | null {
    const m = median(values);
    if (m === null || m <= 0) return null;
    return median(values.map((v) => Math.abs(v - m)))! / m;
}

export function summarizeWindow(rows: readonly DayRow[]): WindowSummary {
    const weekday = rows.filter((r) => r.dayType === "W").map((r) => r.entries);
    const weekend = rows.filter((r) => r.dayType !== "W").map((r) => r.entries);
    return {
        weekdayDays: weekday.length,
        weekendDays: weekend.length,
        weekdayAvg: mean(weekday),
        weekendAvg: mean(weekend),
        weekdayMadRatio: madRatio(weekday),
        weekendMadRatio: madRatio(weekend),
    };
}

/** A typical day from the two day-type averages, a week's 5 weekdays to 2 weekend days. */
export function recombineDayTypes(weekdayAvg: number | null, weekendAvg: number | null): number | null {
    if (weekdayAvg === null || weekendAvg === null) return null;
    return (WEEKDAY_WEIGHT * weekdayAvg + WEEKEND_WEIGHT * weekendAvg) / (WEEKDAY_WEIGHT + WEEKEND_WEIGHT);
}

export function yoyChangePct(now: WindowSummary | null, then: WindowSummary | null): number | null {
    if (now === null || then === null) return null;
    const current = recombineDayTypes(now.weekdayAvg, now.weekendAvg);
    const previous = recombineDayTypes(then.weekdayAvg, then.weekendAvg);
    if (current === null || previous === null || previous <= 0) return null;
    return (current / previous - 1) * 100;
}

export function vs2019Pct(avg12m: number | null, avg2019: number | null): number | null {
    if (avg12m === null || avg2019 === null || avg2019 <= 0) return null;
    return (avg12m / avg2019 - 1) * 100;
}

/** Negative when the station carries fewer riders than its peers; 0 when it matches them. */
export function residualLog(avg12m: number | null, baseline: number | null): number | null {
    if (avg12m === null || baseline === null || avg12m <= 0 || baseline <= 0) return null;
    return Math.log(avg12m / baseline);
}

/** The mean of the weekday and weekend ratios that exist; the audit averages the two equally. */
export function erraticness(summary: WindowSummary | null): number | null {
    if (summary === null) return null;
    return mean([summary.weekdayMadRatio, summary.weekendMadRatio].filter((r): r is number => r !== null));
}
