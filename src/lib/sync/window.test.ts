import { describe, expect, it } from "vitest";
import { addDays, isCalendarDate, monthChunks, monthOf, monthRange, trailingWindow } from "./window";

describe("trailingWindow", () => {
    it("starts 60 days before an upstream max of 2026-07-31, whatever today is", () => {
        expect(trailingWindow("2026-07-31", "2025-11-30")).toEqual({ start: "2026-06-01", end: "2026-07-31" });
    });

    it("anchors on the stored max when it is later than upstream's", () => {
        expect(trailingWindow("2026-07-31", "2026-08-02")).toEqual({ start: "2026-06-03", end: "2026-08-02" });
    });

    it("anchors on upstream when nothing is stored", () => {
        expect(trailingWindow("2026-07-31", null)).toEqual({ start: "2026-06-01", end: "2026-07-31" });
    });
});

describe("calendar helpers", () => {
    it("adds days across month and leap-year boundaries", () => {
        expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
        expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
        expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    });

    it("gives a month's first and last day", () => {
        expect(monthRange("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
        expect(monthRange("2025-12")).toEqual({ start: "2025-12-01", end: "2025-12-31" });
        expect(monthOf("2025-03-03")).toBe("2025-03");
    });

    it("splits a window into calendar-month pieces, oldest first", () => {
        expect(monthChunks({ start: "2026-05-15", end: "2026-07-31" })).toEqual([
            { start: "2026-05-15", end: "2026-05-31" },
            { start: "2026-06-01", end: "2026-06-30" },
            { start: "2026-07-01", end: "2026-07-31" },
        ]);
        expect(monthChunks({ start: "2026-07-03", end: "2026-07-09" })).toEqual([
            { start: "2026-07-03", end: "2026-07-09" },
        ]);
    });

    it("rejects malformed windows and months", () => {
        expect(() => monthChunks({ start: "2026-07-31", end: "2026-07-01" })).toThrow(/ends before it starts/);
        expect(() => monthRange("2026-13")).toThrow(/YYYY-MM/);
        expect(() => addDays("2026-02-30", 1)).toThrow(/YYYY-MM-DD/);
        expect(() => addDays("2026-13-01", 1)).toThrow(/YYYY-MM-DD/);
    });
});

describe("isCalendarDate", () => {
    it("accepts a real calendar date, including a leap day", () => {
        expect(isCalendarDate("2026-07-31")).toBe(true);
        expect(isCalendarDate("2024-02-29")).toBe(true);
    });

    it("rejects days and months the calendar does not have", () => {
        expect(isCalendarDate("2026-02-30")).toBe(false);
        expect(isCalendarDate("2026-13-01")).toBe(false);
    });

    it("rejects strings that are not YYYY-MM-DD", () => {
        expect(isCalendarDate("yesterday")).toBe(false);
        expect(isCalendarDate("2026-7-31")).toBe(false);
        expect(isCalendarDate("2026-07-31T00:00:00Z")).toBe(false);
    });
});
