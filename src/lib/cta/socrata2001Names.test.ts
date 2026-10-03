import { describe, it, expect } from "vitest";
import { SOCRATA_2001_NAME_PAIRS, SOCRATA_2001_NAMES } from "./socrata2001Names";

describe("socrata2001Names", () => {
    describe("SOCRATA_2001_NAME_PAIRS", () => {
        it("has 147 pairs", () => {
            expect(SOCRATA_2001_NAME_PAIRS).toHaveLength(147);
        });

        it("lists each display name exactly once", () => {
            const displayNames = SOCRATA_2001_NAME_PAIRS.map(([display]) => display);
            expect(new Set(displayNames).size).toBe(displayNames.length);
        });

        it("has no blank or padded names on either side", () => {
            for (const [display, socrata] of SOCRATA_2001_NAME_PAIRS) {
                expect(display.trim()).toBe(display);
                expect(socrata.trim()).toBe(socrata);
                expect(display.length).toBeGreaterThan(0);
                expect(socrata.length).toBeGreaterThan(0);
            }
        });
    });

    describe("SOCRATA_2001_NAMES", () => {
        it("resolves every display name to exactly one Socrata name", () => {
            expect(Object.keys(SOCRATA_2001_NAMES)).toHaveLength(SOCRATA_2001_NAME_PAIRS.length);
            for (const [display, socrata] of SOCRATA_2001_NAME_PAIRS) {
                expect(SOCRATA_2001_NAMES[display]).toBe(socrata);
            }
        });

        it("maps branch-qualified and apostrophe names", () => {
            expect(SOCRATA_2001_NAMES["Harlem (Blue - O'Hare Branch)"]).toBe("Harlem-O'Hare");
            expect(SOCRATA_2001_NAMES["Harlem (Blue - Forest Park Branch)"]).toBe("Harlem-Forest Park");
            expect(SOCRATA_2001_NAMES["Western (Blue - O'Hare Branch)"]).toBe("Western-O'Hare");
            expect(SOCRATA_2001_NAMES["Western (Orange)"]).toBe("Western-Orange");
            expect(SOCRATA_2001_NAMES["O'Hare (Blue)"]).toBe("O'Hare");
        });

        it("maps line-qualified aliases of one station to the same Socrata name", () => {
            expect(SOCRATA_2001_NAMES["Jackson (Red)"]).toBe("Jackson/State");
            expect(SOCRATA_2001_NAMES["Jackson/State (Red)"]).toBe("Jackson/State");
            expect(SOCRATA_2001_NAMES["Monroe/State (Red)"]).toBe("Monroe/State");
            expect(SOCRATA_2001_NAMES["95th/Dan Ryan (Red)"]).toBe("95th/Dan Ryan");
        });

        it("returns undefined for a station with no 2001 mapping", () => {
            expect(SOCRATA_2001_NAMES["Not A Station"]).toBeUndefined();
        });
    });
});
