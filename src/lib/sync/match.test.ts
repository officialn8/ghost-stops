import { describe, expect, it } from "vitest";
import { dedupeDays, matchStations } from "./match";
import type { UpstreamDay } from "./socrata";

const day = (ctaStationId: string, serviceDate: string, rides: number, updatedAt = "2026-03-20T21:36:29.885Z"): UpstreamDay => ({
    ctaStationId,
    serviceDate,
    dayType: "W",
    rides,
    updatedAt,
});

describe("dedupeDays", () => {
    it("keeps the higher count when duplicate rows share an update time, as all of 2011's do", () => {
        const rows = [day("40380", "2011-07-03", 5574), day("40380", "2011-07-03", 5573), day("40380", "2011-07-04", 4000)];

        expect(dedupeDays(rows).map((d) => [d.serviceDate, d.rides])).toEqual([
            ["2011-07-03", 5574],
            ["2011-07-04", 4000],
        ]);
    });

    it("keeps the most recently updated row even when its count is lower", () => {
        const rows = [day("40380", "2025-03-03", 6000, "2026-01-01T00:00:00.000Z"), day("40380", "2025-03-03", 5333, "2026-03-20T00:00:00.000Z")];

        expect(dedupeDays(rows)).toEqual([rows[1]]);
    });

    it("leaves rows for different stations on one day alone", () => {
        expect(dedupeDays([day("40380", "2026-06-01", 1), day("40390", "2026-06-01", 2)])).toHaveLength(2);
    });
});

describe("matchStations", () => {
    const stations = new Map([
        ["40670", "western-blue-ohare"],
        ["40310", "western-orange"],
    ]);

    it("attributes rows by CTA station id", () => {
        const { rows } = matchStations([day("40670", "2025-11-03", 3476), day("40310", "2025-11-03", 2617)], stations);

        expect(rows).toEqual([
            { stationId: "western-blue-ohare", serviceDate: "2025-11-03", entries: 3476, dayType: "W" },
            { stationId: "western-orange", serviceDate: "2025-11-03", entries: 2617, dayType: "W" },
        ]);
    });

    it("reports unknown ids once each, sorted, and keeps the rest", () => {
        const result = matchStations(
            [day("40500", "2006-01-02", 10), day("40670", "2006-01-02", 900), day("40200", "2006-01-02", 20), day("40500", "2006-01-03", 11)],
            stations,
        );

        expect(result.unmatched).toEqual(["40200", "40500"]);
        expect(result.rows).toHaveLength(1);
    });
});
