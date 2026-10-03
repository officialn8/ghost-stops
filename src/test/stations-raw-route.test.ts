import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("@/lib/prisma", async () => ({
    prisma: (await import("@/test/prisma-mock")).prismaMock,
}));

const { GET } = await import("@/app/api/chicago/stations-raw/route");

function station(name: string, ghostScore: number | null) {
    return {
        id: name,
        name,
        latitude: 41.88,
        longitude: -87.63,
        lines: '["Red"]',
        metrics:
            ghostScore === null
                ? null
                : { ghostScore, rolling30dAvg: 100, lastDayEntries: 90, serviceDateMax: new Date("2025-11-30") },
    };
}

async function names(sort: string): Promise<string[]> {
    const response = await GET(new NextRequest(`http://localhost/api/chicago/stations-raw?sort=${sort}`));
    const body = (await response.json()) as { stations: { name: string }[] };
    return body.stations.map((s) => s.name);
}

beforeEach(() => {
    resetPrismaMock();
    prismaMock.city.findUnique.mockResolvedValue({ id: "c", code: "chicago", name: "Chicago" });
    prismaMock.stationMetrics.findFirst.mockResolvedValue({ serviceDateMax: new Date("2025-11-30") } as never);
});

describe("GET /api/chicago/stations-raw", () => {
    it("ranks stations without metrics after every scored station", async () => {
        // Postgres sorts NULL first in a descending order, so a station with no metrics row leads.
        prismaMock.station.findMany.mockResolvedValue([
            station("State/Lake", null),
            station("Halsted", 72),
            station("Kostner", 70),
        ] as never);

        expect(await names("ghost_score_desc")).toEqual(["Halsted", "Kostner", "State/Lake"]);
        expect(await names("ridership")).toEqual(["Halsted", "Kostner", "State/Lake"]);
    });

    it("keeps the database order for the name sort", async () => {
        prismaMock.station.findMany.mockResolvedValue([
            station("Argyle", 40),
            station("State/Lake", null),
            station("Wilson", 30),
        ] as never);

        expect(await names("name")).toEqual(["Argyle", "State/Lake", "Wilson"]);
    });
});
