import { describe, expect, it } from "vitest";
import { addYears, componentWindows, scoreWindows } from "./windows";

describe("addYears", () => {
    it("moves a date by whole calendar years", () => {
        expect(addYears("2026-07-31", -1)).toBe("2025-07-31");
        expect(addYears("2025-07-20", 1)).toBe("2026-07-20");
    });

    it("clamps 29 February to the 28th in a common year, as Postgres date arithmetic does", () => {
        expect(addYears("2024-02-29", -1)).toBe("2023-02-28");
        expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    });
});

describe("scoreWindows", () => {
    it("lays out every window as inclusive days ending at the data-through date", () => {
        expect(scoreWindows("2026-07-31")).toEqual({
            // The base metrics' avg12m window: after asOf - 1 year, through asOf.
            twelveMonth: { start: "2025-08-01", end: "2026-07-31" },
            trailing90: { start: "2026-05-03", end: "2026-07-31" },
            // The same 90 calendar days one year earlier.
            yearAgo90: { start: "2025-05-03", end: "2025-07-31" },
            year2019: { start: "2019-01-01", end: "2019-12-31" },
        });
    });

    it("keeps the trailing window at 90 days across a leap day", () => {
        const { trailing90, yearAgo90 } = scoreWindows("2024-03-31");
        expect(trailing90).toEqual({ start: "2024-01-02", end: "2024-03-31" });
        expect(yearAgo90).toEqual({ start: "2023-01-02", end: "2023-03-31" });
    });
});

describe("componentWindows", () => {
    it("names the windows each component reads", () => {
        const w = scoreWindows("2026-07-31");
        expect(componentWindows("residual", "2026-07-31")).toEqual([w.twelveMonth]);
        expect(componentWindows("yoy", "2026-07-31")).toEqual([w.trailing90, w.yearAgo90]);
        expect(componentWindows("longRun", "2026-07-31")).toEqual([w.twelveMonth, w.year2019]);
        expect(componentWindows("erratic", "2026-07-31")).toEqual([w.trailing90]);
    });
});
