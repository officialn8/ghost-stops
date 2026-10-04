import { describe, expect, it } from "vitest";
import type { StationDetailResponse } from "@/types/station";
import { ordinal, stationDescription, stationLabel, stationTitle } from "./metadata";

type Detail = Pick<StationDetailResponse, "station" | "metrics" | "dataThrough">;

function detail(overrides: { station?: Partial<Detail["station"]>; metrics?: Partial<Detail["metrics"]> } = {}): Detail {
    return {
        dataThrough: "2026-07-31",
        station: {
            id: "id",
            name: "Halsted (Green)",
            displayName: "Halsted",
            slug: "halsted-green",
            lines: ["Green"],
            latitude: 41.78,
            longitude: -87.64,
            rolling30dAvg: 240,
            status: "ACTIVE",
            closedAt: null,
            openedAt: null,
            dataStatus: "available",
            ...overrides.station,
        },
        metrics: {
            ranked: true,
            tier: "ghost",
            rank: 1,
            rankedCount: 140,
            avg12m: 247.6,
            avg30d: 240,
            dataThrough: "2026-07-31",
            scoreVersion: 2,
            ...overrides.metrics,
        },
    };
}

describe("stationTitle", () => {
    it("names the station with its line and its riders per day", () => {
        expect(stationTitle(detail())).toBe("Halsted (Green) · 248 riders/day");
    });

    it("lists every line at a hub and groups thousands", () => {
        const hub = detail({ station: { displayName: "Clark/Lake", lines: ["Blue", "Brown", "Green"] }, metrics: { avg12m: 12345.4 } });
        expect(stationTitle(hub)).toBe("Clark/Lake (Blue, Brown, Green) · 12,345 riders/day");
    });

    it("says when a closed station closed instead of a ridership figure", () => {
        const closed = detail({
            station: { displayName: "State/Lake", lines: ["Brown", "Green"], status: "CLOSED", closedAt: "2026-01-05" },
            metrics: { ranked: false, rank: null, tier: null },
        });
        expect(stationTitle(closed)).toBe("State/Lake (Brown, Green) · closed Jan 2026");
    });

    it("says a station without recent data has none", () => {
        expect(stationTitle(detail({ metrics: { ranked: false, avg12m: null } }))).toBe("Halsted (Green) · no recent data");
    });
});

describe("stationDescription", () => {
    it("gives the rank among ranked stations, the tier, riders, and the data-through date", () => {
        expect(stationDescription(detail())).toBe(
            "Halsted ranks 1st of 140 L stations by ghost score (tier: ghost), with 248 riders a day over the past 12 months. Data through 2026-07-31.",
        );
    });

    it("explains why a closed station is not ranked", () => {
        const closed = detail({ station: { displayName: "State/Lake", status: "CLOSED", closedAt: "2026-01-05" }, metrics: { ranked: false } });
        expect(stationDescription(closed)).toBe(
            "State/Lake has been closed since Jan 2026, so it is not ranked against other L stations. Data through 2026-07-31.",
        );
    });
});

describe("helpers", () => {
    it.each([
        [1, "1st"],
        [2, "2nd"],
        [3, "3rd"],
        [4, "4th"],
        [11, "11th"],
        [12, "12th"],
        [13, "13th"],
        [21, "21st"],
        [102, "102nd"],
        [111, "111th"],
    ])("writes %i as %s", (n, text) => {
        expect(ordinal(n)).toBe(text);
    });

    it("leaves the parenthetical off a station with no lines", () => {
        expect(stationLabel(detail({ station: { lines: [] } }))).toBe("Halsted");
    });
});
