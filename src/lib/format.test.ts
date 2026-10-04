import { describe, expect, it } from "vitest";
import {
    formatCalendarDate,
    formatChicagoDay,
    formatDateRange,
    formatMonthYear,
    formatRiders,
    linesLabel,
} from "./format";

describe("calendar dates", () => {
    it("reads YYYY-MM-DD in UTC, so a date never shifts a day (KTD17)", () => {
        expect(formatCalendarDate("2025-11-30", { month: "short", day: "numeric" })).toBe("Nov 30");
        expect(formatMonthYear("2026-01-05")).toBe("Jan 2026");
    });

    it("gives the same text on a repeat call with the same options (cached formatter)", () => {
        const options = { month: "short", day: "numeric", year: "numeric" } as const;
        expect(formatCalendarDate("2026-07-31", options)).toBe("Jul 31, 2026");
        expect(formatCalendarDate("2026-07-31", options)).toBe("Jul 31, 2026");
    });

    it("drops the year on the start of a range within one year, keeps it across a new year", () => {
        expect(formatDateRange("2026-05-02", "2026-07-31")).toBe("May 2 to Jul 31, 2026");
        expect(formatDateRange("2025-11-02", "2026-01-31")).toBe("Nov 2, 2025 to Jan 31, 2026");
    });
});

describe("formatChicagoDay", () => {
    it("names the day an instant fell on in Chicago, not in UTC", () => {
        // 03:30 UTC on Sep 21 is still the evening of Sep 20 in Chicago.
        expect(formatChicagoDay("2026-09-21T03:30:00.000Z")).toBe("Sep 20, 2026");
    });
});

describe("formatRiders and linesLabel", () => {
    it("rounds riders and groups thousands", () => {
        expect(formatRiders(1781.6)).toBe("1,782");
        expect(formatRiders(247.4)).toBe("247");
    });

    it("names one line or several", () => {
        expect(linesLabel(["Green"])).toBe("Green Line");
        expect(linesLabel(["Brown", "Purple"])).toBe("Brown, Purple Lines");
    });
});
