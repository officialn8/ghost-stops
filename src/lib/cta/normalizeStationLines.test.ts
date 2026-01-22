import { describe, it, expect } from "vitest";
import { normalizeStationLines, warnIfNameContainsLineInfo } from "./normalizeStationLines";

describe("normalizeStationLines", () => {
    describe("array input", () => {
        it("handles already-correct array format", () => {
            const result = normalizeStationLines({
                name: "Chicago",
                lines: ["Brown", "Purple"],
            });
            expect(result.lines).toEqual(["Brown", "Purple"]);
            expect(result.cleanName).toBe("Chicago");
        });

        it("sorts lines by canonical CTA order", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: ["Purple", "Brown", "Red"],
            });
            expect(result.lines).toEqual(["Red", "Brown", "Purple"]);
        });

        it("deduplicates lines", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: ["Brown", "Brown", "Purple", "Purple"],
            });
            expect(result.lines).toEqual(["Brown", "Purple"]);
        });
    });

    describe("string parsing", () => {
        it("parses slash-separated line string", () => {
            const result = normalizeStationLines({
                name: "Sedgwick",
                lines: "Brown/Purple",
            });
            expect(result.lines).toEqual(["Brown", "Purple"]);
        });

        it("parses comma-separated line string", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: "Red, Blue, Green",
            });
            expect(result.lines).toEqual(["Red", "Blue", "Green"]);
        });

        it("parses single line string", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: "Yellow",
            });
            expect(result.lines).toEqual(["Yellow"]);
        });

        it("handles 'and' separator", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: "Red and Blue",
            });
            expect(result.lines).toEqual(["Red", "Blue"]);
        });
    });

    describe("alias normalization", () => {
        it("normalizes Purple Express to Purple", () => {
            const result = normalizeStationLines({
                name: "Linden",
                lines: ["Purple Express"],
            });
            expect(result.lines).toEqual(["Purple"]);
        });

        it("normalizes Purple Express in string format", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: "Purple Express/Brown",
            });
            expect(result.lines).toEqual(["Brown", "Purple"]);
        });

        it("normalizes case differences", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: ["blue", "RED", "Green"],
            });
            expect(result.lines).toEqual(["Red", "Blue", "Green"]);
        });
    });

    describe("parenthetical extraction from name", () => {
        it("extracts lines from station name with parentheses", () => {
            const result = normalizeStationLines({
                name: "Sedgwick (Brown/Purple)",
                lines: [],
            });
            expect(result.cleanName).toBe("Sedgwick");
            expect(result.lines).toEqual(["Brown", "Purple"]);
        });

        it("extracts single line from name", () => {
            const result = normalizeStationLines({
                name: "Oakton–Skokie (Yellow)",
            });
            expect(result.cleanName).toBe("Oakton–Skokie");
            expect(result.lines).toEqual(["Yellow"]);
        });

        it("keeps name if parentheses don't contain valid lines", () => {
            const result = normalizeStationLines({
                name: "Station (Terminal)",
                lines: ["Red"],
            });
            expect(result.cleanName).toBe("Station (Terminal)");
            expect(result.lines).toEqual(["Red"]);
        });

        it("merges lines from name and lines field", () => {
            const result = normalizeStationLines({
                name: "Test (Red)",
                lines: ["Blue"],
            });
            expect(result.lines).toEqual(["Red", "Blue"]);
        });
    });

    describe("alternative field names", () => {
        it("uses station.line as fallback", () => {
            const result = normalizeStationLines({
                name: "Test",
                line: "Green",
            });
            expect(result.lines).toEqual(["Green"]);
        });

        it("uses station.routes as fallback", () => {
            const result = normalizeStationLines({
                name: "Test",
                routes: ["Orange", "Pink"],
            });
            expect(result.lines).toEqual(["Orange", "Pink"]);
        });

        it("uses station.line_summary as fallback", () => {
            const result = normalizeStationLines({
                name: "Test",
                line_summary: "Blue/Red",
            });
            expect(result.lines).toEqual(["Red", "Blue"]);
        });
    });

    describe("edge cases", () => {
        it("handles empty/missing lines gracefully", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: [],
            });
            expect(result.lines).toEqual([]);
            expect(result.cleanName).toBe("Test");
        });

        it("handles undefined station", () => {
            const result = normalizeStationLines({});
            expect(result.lines).toEqual([]);
            expect(result.cleanName).toBe("");
        });

        it("filters out invalid line names", () => {
            const result = normalizeStationLines({
                name: "Test",
                lines: ["Red", "Invalid", "Blue", "Fake"],
            });
            expect(result.lines).toEqual(["Red", "Blue"]);
        });

        it("provides rawLineString for debugging", () => {
            const result = normalizeStationLines({
                name: "Test (Brown/Purple)",
                lines: [],
            });
            expect(result.rawLineString).toBe("Brown/Purple");
        });
    });
});

describe("warnIfNameContainsLineInfo", () => {
    it("does not throw for normal station names", () => {
        expect(() => warnIfNameContainsLineInfo("Chicago")).not.toThrow();
        expect(() => warnIfNameContainsLineInfo("Howard")).not.toThrow();
    });

    it("does not throw for names with non-line parentheses", () => {
        expect(() => warnIfNameContainsLineInfo("Station (Terminal)")).not.toThrow();
    });

    // Note: console.warn is called for names with line info in parentheses,
    // but we don't test that here to avoid console noise
});
