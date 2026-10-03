import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("@/lib/prisma", async () => ({
    prisma: (await import("@/test/prisma-mock")).prismaMock,
}));

const { GET } = await import("@/app/api/chicago/stations-raw/route");

function station(name: string, ghostScore: number | null, dataStatus = "normal", status = "ACTIVE") {
    return {
        id: name,
        name,
        status,
        latitude: 41.88,
        longitude: -87.63,
        lines: '["Red"]',
        metrics:
            ghostScore === null
                ? null
                : {
                      ghostScore,
                      rolling30dAvg: dataStatus === "normal" ? 100 : 0,
                      lastDayEntries: 90,
                      serviceDateMax: new Date("2025-11-30"),
                      dataStatus,
                  },
    };
}

async function body(sort: string) {
    const response = await GET(new NextRequest(`http://localhost/api/chicago/stations-raw?sort=${sort}`));
    return (await response.json()) as { stations: { name: string; dataStatus: string }[] };
}

async function names(sort: string): Promise<string[]> {
    return (await body(sort)).stations.map((s) => s.name);
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

    it("ranks closed and no-data stations last in every score sort", async () => {
        // After the sync, closed State/Lake has a metrics row: upstream reports 0 riders a day.
        prismaMock.station.findMany.mockResolvedValue([
            station("State/Lake", -1, "zero", "CLOSED"),
            station("Gone Quiet", 40, "missing"),
            station("Just Closed", 50, "normal", "CLOSED"), // closed this week; its 30 days still look normal
            station("Kostner", 70),
            station("Halsted", 72),
        ] as never);

        const last = ["State/Lake", "Gone Quiet", "Just Closed"];
        expect(await names("ghost_score_asc")).toEqual(["Kostner", "Halsted", ...last]);
        expect(await names("ghost_score_desc")).toEqual(["Kostner", "Halsted", ...last]);
        expect((await body("ridership")).stations.slice(-3, -1)).toMatchObject([
            { name: "State/Lake", dataStatus: "zero" },
            { name: "Gone Quiet", dataStatus: "missing" },
        ]);
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
