import { describe, expect, it } from "vitest";
import { findDriftMonths, keptDuplicateRides, parseDriftMonths, planDriftFetches } from "./reconcile";
import type { DuplicateDay, RidershipSource, StationMonthTotal, UpstreamDay } from "./socrata";

const total = (ctaStationId: string, month: string, days: number, rides: number): StationMonthTotal => ({
    ctaStationId,
    month,
    days,
    rides,
});
const KNOWN = new Set(["40450", "40380"]);

describe("findDriftMonths", () => {
    const stored = [total("40450", "2025-02", 28, 140_000), total("40450", "2025-03", 31, 160_000), total("40380", "2025-03", 31, 400_000)];

    it("lists nothing when every station-month matches", () => {
        expect(findDriftMonths(stored, stored, [], new Map(), KNOWN)).toEqual([]);
    });

    it("lists March 2025 when CTA restates 95th/Dan Ryan's sum for that month (AE7)", () => {
        const upstream = [total("40450", "2025-02", 28, 140_000), total("40450", "2025-03", 31, 160_250), total("40380", "2025-03", 31, 400_000)];

        expect(findDriftMonths(upstream, stored, [], new Map(), KNOWN)).toEqual(["2025-03"]);
    });

    it("lists months with a day missing on either side", () => {
        const upstream = [total("40450", "2025-02", 28, 140_000), total("40380", "2025-03", 31, 400_000), total("40380", "2025-04", 30, 390_000)];

        expect(findDriftMonths(upstream, stored, [], new Map(), KNOWN)).toEqual(["2025-03", "2025-04"]);
    });

    it("ignores station ids the city does not know, such as retired ones", () => {
        expect(findDriftMonths([...stored, total("40500", "2005-06", 30, 9_000)], stored, [], new Map(), KNOWN)).toEqual([]);
    });

    it("does not flag a month whose only difference is upstream's duplicate rows", () => {
        // July 2011: upstream holds two rows for 2011-07-03; the stored month kept the higher count.
        const dup: DuplicateDay = { ctaStationId: "40380", serviceDate: "2011-07-03", rows: 2, totalRides: 11_147, maxRides: 5_574, sameUpdate: true };
        const upstream = [total("40380", "2011-07", 32, 500_000 + 5_573)];
        const storedJuly = [total("40380", "2011-07", 31, 500_000)];

        expect(findDriftMonths(upstream, storedJuly, [dup], new Map([["40380|2011-07-03", 5_574]]), KNOWN)).toEqual([]);
        expect(findDriftMonths(upstream, storedJuly, [], new Map(), KNOWN)).toEqual(["2011-07"]);
    });
});

describe("keptDuplicateRides", () => {
    it("takes the higher count for tied rows without a request, and asks upstream once per month otherwise", async () => {
        const requested: string[][] = [];
        const rows: UpstreamDay[] = [
            { ctaStationId: "40390", serviceDate: "2011-08-01", dayType: "W", rides: 4007, updatedAt: "2026-01-01T00:00:00Z" },
            { ctaStationId: "40390", serviceDate: "2011-08-01", dayType: "W", rides: 3969, updatedAt: "2026-03-20T00:00:00Z" },
        ];
        const source = {
            fetchDays: async (window: { start: string }, ids?: readonly string[]) => {
                requested.push([window.start, ...(ids ?? [])]);
                return rows;
            },
        } as unknown as RidershipSource;

        const kept = await keptDuplicateRides(source, [
            { ctaStationId: "40380", serviceDate: "2011-07-03", rows: 2, totalRides: 11_147, maxRides: 5_574, sameUpdate: true },
            { ctaStationId: "40390", serviceDate: "2011-08-01", rows: 2, totalRides: 7_976, maxRides: 4_007, sameUpdate: false },
        ]);

        expect(kept).toEqual(new Map([["40380|2011-07-03", 5_574], ["40390|2011-08-01", 3_969]]));
        expect(requested).toEqual([["2011-08-01"]]);
    });
});

describe("planDriftFetches", () => {
    const WINDOW = { start: "2026-06-01", end: "2026-07-31" };

    it("fetches three of four drift months, oldest first, and carries the fourth", () => {
        expect(planDriftFetches(["2025-03", "2019-05", "2024-12", "2025-01"], WINDOW)).toEqual({
            fetch: ["2019-05", "2024-12", "2025-01"],
            carry: ["2025-03"],
        });
    });

    it("drops months the trailing window already covered in full", () => {
        expect(planDriftFetches(["2026-06", "2026-07", "2026-05"], WINDOW)).toEqual({ fetch: ["2026-05"], carry: [] });
    });
});

describe("parseDriftMonths", () => {
    it("accepts YYYY-MM lists and rejects anything else", () => {
        expect(parseDriftMonths(["2025-03"])).toEqual(["2025-03"]);
        expect(parseDriftMonths([])).toEqual([]);
        expect(() => parseDriftMonths(["2025-13"])).toThrow(/YYYY-MM/);
        expect(() => parseDriftMonths({})).toThrow(/YYYY-MM/);
    });
});
