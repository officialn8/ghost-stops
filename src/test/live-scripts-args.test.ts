import { describe, expect, it } from "vitest";
import { isClosed, parseRereduceArgs } from "../../scripts/live-rereduce";
import { parseSensitivityArgs } from "../../scripts/live-sensitivity";
import { parseChicagoLocal } from "@/lib/live/serviceDay";

describe("parseRereduceArgs", () => {
    it("takes one calendar date and nothing else", () => {
        expect(parseRereduceArgs(["--date", "2026-10-15"])).toEqual({ date: "2026-10-15" });
        expect(() => parseRereduceArgs([])).toThrow(/--date/);
        expect(() => parseRereduceArgs(["--date", "2026-02-30"])).toThrow(/YYYY-MM-DD/);
        expect(() => parseRereduceArgs(["--date", "2026-10-15", "--force"])).toThrow();
    });
});

describe("isClosed", () => {
    it("refuses the open day until 03:15 the next morning", () => {
        expect(isClosed("2026-10-15", parseChicagoLocal("2026-10-16 03:14:00"))).toBe(false);
        expect(isClosed("2026-10-15", parseChicagoLocal("2026-10-16 03:15:00"))).toBe(true);
        expect(isClosed("2026-10-16", parseChicagoLocal("2026-10-16 12:00:00"))).toBe(false);
    });
});

describe("parseSensitivityArgs", () => {
    it("takes an ordered date range", () => {
        expect(parseSensitivityArgs(["--from", "2026-10-15", "--to", "2026-10-17"])).toEqual({ from: "2026-10-15", to: "2026-10-17" });
        expect(() => parseSensitivityArgs(["--from", "2026-10-15"])).toThrow(/required/);
        expect(() => parseSensitivityArgs(["--from", "2026-10-17", "--to", "2026-10-15"])).toThrow(/not be before/);
        expect(() => parseSensitivityArgs(["--from", "20261015", "--to", "2026-10-17"])).toThrow(/YYYY-MM-DD/);
    });
});
