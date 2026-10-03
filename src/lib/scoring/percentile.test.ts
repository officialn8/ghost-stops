import { describe, expect, it } from "vitest";
import { midrankPercentiles } from "./percentile";

describe("midrankPercentiles", () => {
    it("spans 0 to 100 over distinct values, in input order", () => {
        expect(midrankPercentiles([30, 10, 20, 40, 50])).toEqual([50, 0, 25, 75, 100]);
    });

    it("gives tied values equal percentiles, at their average rank", () => {
        // Ranks 1, 2.5, 2.5, 4: the tie shares (2 + 3) / 2.
        expect(midrankPercentiles([1, 5, 5, 9])).toEqual([0, 50, 50, 100]);
    });

    it("puts every value at the median when all are tied", () => {
        expect(midrankPercentiles([7, 7, 7])).toEqual([50, 50, 50]);
    });

    it("puts a lone value at the median and returns nothing for an empty population", () => {
        expect(midrankPercentiles([42])).toEqual([50]);
        expect(midrankPercentiles([])).toEqual([]);
    });

    it("refuses a value that is not a finite number", () => {
        expect(() => midrankPercentiles([1, Number.NaN])).toThrow(/finite/);
    });
});
