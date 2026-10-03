import { describe, it, expect } from "vitest";
// Imported through the `@/` alias on purpose: this test also proves the alias resolves under Vitest.
import { getGhostScoreColor } from "@/lib/utils";

describe("getGhostScoreColor", () => {
    describe("at each threshold", () => {
        it.each([
            [65, "#DC2626"],
            [50, "#EA580C"],
            [35, "#F59E0B"],
            [20, "#84CC16"],
        ])("maps %i to %s", (score, color) => {
            expect(getGhostScoreColor(score)).toBe(color);
        });
    });

    describe("one point below each threshold", () => {
        it.each([
            [64, "#EA580C"],
            [49, "#F59E0B"],
            [34, "#84CC16"],
            [19, "#22C55E"],
        ])("maps %i to %s", (score, color) => {
            expect(getGhostScoreColor(score)).toBe(color);
        });
    });

    describe("ends of the 0-100 range", () => {
        it("maps 100 to red", () => {
            expect(getGhostScoreColor(100)).toBe("#DC2626");
        });

        it("maps 0 to green", () => {
            expect(getGhostScoreColor(0)).toBe("#22C55E");
        });
    });
});
