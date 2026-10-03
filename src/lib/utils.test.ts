import { describe, it, expect } from "vitest";
// Imported through the `@/` alias on purpose: this test also proves the alias resolves under Vitest.
import { getGhostScoreColor, getTier, tierName, toUiDataStatus } from "@/lib/utils";

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

describe("getTier", () => {
    it.each([
        [95, { tier: "ghost", ink: 0.44, mark: "hollow-dashed" }],
        [80, { tier: "fading", ink: 0.72, mark: "hollow" }],
        [60, { tier: "quiet", ink: 1, mark: "hollow" }],
        [30, { tier: "healthy", ink: 1, mark: "solid" }],
    ])("maps %i to its tier, ink, and mark", (score, style) => {
        expect(getTier(score)).toEqual(style);
    });

    it.each([
        [100, "ghost"],
        [90, "ghost"],
        [89, "fading"],
        [75, "fading"],
        [74, "quiet"],
        [50, "quiet"],
        [49, "healthy"],
        [0, "healthy"],
    ])("puts %i in %s at the tier edges", (score, tier) => {
        expect(getTier(score).tier).toBe(tier);
    });
});

describe("tierName", () => {
    it("lowercases a stored tier and refuses anything else", () => {
        expect(tierName("GHOST")).toBe("ghost");
        expect(tierName("HEALTHY")).toBe("healthy");
        expect(tierName(null)).toBeNull();
        expect(tierName("SPOOKY")).toBeNull();
    });
});

describe("toUiDataStatus", () => {
    it("maps the stored status to the UI's words, missing when there is none", () => {
        expect(toUiDataStatus("normal")).toBe("available");
        expect(toUiDataStatus("zero")).toBe("zero");
        expect(toUiDataStatus("missing")).toBe("missing");
        expect(toUiDataStatus(undefined)).toBe("missing");
    });
});
