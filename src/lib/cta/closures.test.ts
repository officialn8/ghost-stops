import { describe, expect, it } from "vitest";
import { STATION_CLOSURES, deriveStatus } from "./closures";

const LAWRENCE = "40770";
const STATE_LAKE = "40260";

function closuresFor(ctaStationId: string) {
    return STATION_CLOSURES.filter((c) => c.ctaStationId === ctaStationId);
}

describe("STATION_CLOSURES", () => {
    it("records the Red-Purple Modernization closures of Lawrence and Berwyn and the State/Lake rebuild", () => {
        expect(STATION_CLOSURES.map((c) => [c.ctaStationId, c.startDate, c.endDate])).toEqual([
            ["40770", "2021-05-16", "2025-07-20"],
            ["40340", "2021-05-16", "2025-07-20"],
            ["40260", "2026-01-05", null],
        ]);
    });
});

describe("deriveStatus", () => {
    it("marks an open-ended closure CLOSED from its first day", () => {
        expect(deriveStatus(closuresFor(STATE_LAKE), "2026-01-04")).toEqual({ status: "ACTIVE", closedAt: null });
        expect(deriveStatus(closuresFor(STATE_LAKE), "2026-01-05")).toEqual({
            status: "CLOSED",
            closedAt: "2026-01-05",
        });
    });

    it("marks a bounded closure TEMP_CLOSED until the day service resumes", () => {
        expect(deriveStatus(closuresFor(LAWRENCE), "2023-01-01")).toEqual({
            status: "TEMP_CLOSED",
            closedAt: "2021-05-16",
        });
        expect(deriveStatus(closuresFor(LAWRENCE), "2025-07-19").status).toBe("TEMP_CLOSED");
        expect(deriveStatus(closuresFor(LAWRENCE), "2025-07-20")).toEqual({ status: "ACTIVE", closedAt: null });
    });

    it("treats a station with no closures as ACTIVE", () => {
        expect(deriveStatus([], "2026-10-03")).toEqual({ status: "ACTIVE", closedAt: null });
    });
});
