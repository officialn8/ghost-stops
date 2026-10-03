import { describe, expect, it } from "vitest";
import type { DayType } from "@/lib/sync/socrata";
import {
    erraticness,
    median,
    recombineDayTypes,
    residualLog,
    summarizeWindow,
    vs2019Pct,
    yoyChangePct,
    type DayRow,
    type WindowSummary,
} from "./components";

const day = (serviceDate: string, entries: number, dayType: DayType): DayRow => ({ serviceDate, entries, dayType });

const summary = (overrides: Partial<WindowSummary> = {}): WindowSummary => ({
    weekdayDays: 63,
    weekendDays: 27,
    weekdayAvg: 1_000,
    weekendAvg: 500,
    weekdayMadRatio: 0.1,
    weekendMadRatio: 0.2,
    ...overrides,
});

describe("median", () => {
    it("takes the middle value, or the mean of the middle two", () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([])).toBeNull();
    });
});

describe("summarizeWindow", () => {
    it("averages weekdays and weekends separately, counting Saturdays and Sundays or holidays as weekend", () => {
        const rows = [
            day("2026-07-27", 1_000, "W"),
            day("2026-07-28", 1_200, "W"),
            day("2026-07-29", 1_400, "W"),
            day("2026-08-01", 600, "A"),
            day("2026-08-02", 400, "U"),
            day("2026-09-07", 300, "U"), // Labor Day: a weekday the CTA counts with Sundays
        ];

        expect(summarizeWindow(rows)).toEqual({
            weekdayDays: 3,
            weekendDays: 3,
            weekdayAvg: 1_200,
            weekendAvg: 1_300 / 3,
            // Weekday median 1,200, deviations 200, 0, 200: MAD 200.
            weekdayMadRatio: 200 / 1_200,
            // Weekend median 400, deviations 200, 0, 100: MAD 100.
            weekendMadRatio: 100 / 400,
        });
    });

    it("leaves a day type with no rows, or a zero median, without an average or ratio", () => {
        expect(summarizeWindow([day("2026-07-27", 0, "W"), day("2026-07-28", 0, "W")])).toEqual({
            weekdayDays: 2,
            weekendDays: 0,
            weekdayAvg: 0,
            weekendAvg: null,
            weekdayMadRatio: null,
            weekendMadRatio: null,
        });
    });
});

describe("recombineDayTypes", () => {
    it("weights the weekday average 5 and the weekend average 2, whatever the day mix in the window", () => {
        expect(recombineDayTypes(1_400, 700)).toBe((5 * 1_400 + 2 * 700) / 7);
        expect(recombineDayTypes(1_400, null)).toBeNull();
    });
});

describe("yoyChangePct", () => {
    it("compares the recombined trailing 90 days with the same days a year earlier, in percent", () => {
        const now = summary({ weekdayAvg: 900, weekendAvg: 400 });
        const then = summary({ weekdayAvg: 1_000, weekendAvg: 500 });
        // (5 * 900 + 2 * 400) / (5 * 1,000 + 2 * 500) - 1 = 5,300 / 6,000 - 1
        expect(yoyChangePct(now, then)).toBeCloseTo((5_300 / 6_000 - 1) * 100, 10);
    });

    it("is unaffected by how many weekend days each window happens to hold", () => {
        const now = summary({ weekdayDays: 64, weekendDays: 26 });
        const then = summary({ weekdayDays: 62, weekendDays: 28 });
        expect(yoyChangePct(now, then)).toBe(0);
    });

    it("is null when either window lacks a day type or the earlier one carried no riders", () => {
        expect(yoyChangePct(summary(), summary({ weekendAvg: null }))).toBeNull();
        expect(yoyChangePct(summary(), summary({ weekdayAvg: 0, weekendAvg: 0 }))).toBeNull();
        expect(yoyChangePct(null, summary())).toBeNull();
    });
});

describe("vs2019Pct", () => {
    it("compares the 12-month average with the 2019 average, in percent", () => {
        expect(vs2019Pct(600, 800)).toBeCloseTo(-25, 10);
        expect(vs2019Pct(600, null)).toBeNull();
        expect(vs2019Pct(null, 800)).toBeNull();
        expect(vs2019Pct(600, 0)).toBeNull();
    });
});

describe("residualLog", () => {
    it("is the log of the station's 12-month average over its peers' baseline", () => {
        expect(residualLog(500, 1_000)).toBeCloseTo(Math.log(0.5), 12);
        expect(residualLog(1_000, 1_000)).toBe(0);
        expect(residualLog(500, null)).toBeNull();
        expect(residualLog(0, 1_000)).toBeNull();
    });
});

describe("erraticness", () => {
    it("averages the weekday and weekend MAD-to-median ratios equally", () => {
        expect(erraticness(summary({ weekdayMadRatio: 0.1, weekendMadRatio: 0.3 }))).toBeCloseTo(0.2, 12);
    });

    it("uses the one day type that has a ratio, and is null when neither has", () => {
        expect(erraticness(summary({ weekendMadRatio: null }))).toBe(0.1);
        expect(erraticness(summary({ weekdayMadRatio: null, weekendMadRatio: null }))).toBeNull();
        expect(erraticness(null)).toBeNull();
    });
});
