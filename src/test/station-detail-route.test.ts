import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("@/lib/prisma", async () => ({
    prisma: (await import("@/test/prisma-mock")).prismaMock,
}));

const { GET } = await import("@/app/api/chicago/stations/[id]/route");

const CITY = "c";
const metrics = (rolling30dAvg: number, ghostScore: number, dataStatus = "normal") => ({ rolling30dAvg, ghostScore, dataStatus });

// Stations the neighbor lookup may ask for, keyed by CTA station id.
type Neighbor = { id: string; name: string; status: string; metrics: ReturnType<typeof metrics> | null };
const BY_CTA_ID: Record<string, Neighbor> = {
    "40180": { id: "oak-park-blue", name: "Oak Park (Blue)", status: "ACTIVE", metrics: metrics(1200, 55) },
    "40390": { id: "forest-park", name: "Forest Park", status: "ACTIVE", metrics: metrics(1800, 40) },
    "40260": { id: "state-lake", name: "State/Lake", status: "CLOSED", metrics: null },
    "40680": { id: "adams-wabash", name: "Adams/Wabash", status: "ACTIVE", metrics: metrics(5000, 20) },
};

function stubStation(ctaStationId: string | null, lines: string[]) {
    prismaMock.station.findUnique.mockImplementation((async (args: {
        where: { id?: string; cityId_ctaStationId?: { ctaStationId: string } };
    }) => {
        if (args.where.id) {
            return {
                id: args.where.id,
                cityId: CITY,
                ctaStationId,
                name: "Station under test",
                latitude: 41.88,
                longitude: -87.63,
                lines: JSON.stringify(lines),
                metrics: { ...metrics(300, 67), rolling90dAvg: 320, dataStatus: "normal" },
                city: { id: CITY, code: "chicago", name: "Chicago" },
            };
        }
        return BY_CTA_ID[args.where.cityId_ctaStationId!.ctaStationId] ?? null;
    }) as never);
}

async function neighbors(id: string) {
    const response = await GET(new NextRequest(`http://localhost/api/chicago/stations/${id}`), {
        params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
        comparisons: { neighbors: { prev: { name: string } | null; next: { name: string } | null; neighborAvg: number } };
    };
    return body.comparisons.neighbors;
}

beforeEach(() => {
    resetPrismaMock();
    prismaMock.$queryRaw.mockResolvedValue([] as never);
    prismaMock.stationMetrics.aggregate.mockResolvedValue({ _avg: { rolling30dAvg: 1000 } } as never);
    prismaMock.station.count.mockResolvedValue(143);
    prismaMock.stationMetrics.findMany.mockResolvedValue([]);
    prismaMock.stationFact.findMany.mockResolvedValue([]);
    prismaMock.stationNarrative.findUnique.mockResolvedValue(null);
});

describe("GET /api/chicago/stations/[id] neighbors", () => {
    it("gives Harlem at the Forest Park end Oak Park and Forest Park", async () => {
        stubStation("40980", ["Blue"]);

        const result = await neighbors("harlem-forest-park");
        expect(result.prev?.name).toBe("Oak Park (Blue)");
        expect(result.next?.name).toBe("Forest Park");
        expect(result.neighborAvg).toBe(1500);
    });

    it("returns no neighbors for a station without a CTA id", async () => {
        stubStation(null, ["Blue"]);

        const result = await neighbors("no-cta-id");
        expect(result).toEqual({ prev: null, next: null, neighborAvg: 0 });
        expect(prismaMock.station.findUnique).toHaveBeenCalledTimes(1);
    });

    it("drops a neighbor that is closed or has no riders in the data, even with a metrics row", async () => {
        const stateLake = BY_CTA_ID["40260"];
        const variants: Neighbor[] = [
            { ...stateLake, metrics: metrics(0, -1, "zero") }, // what the sync writes for State/Lake
            { ...stateLake, metrics: metrics(300, 30) }, // closed this week; its 30 days still look normal
            { ...stateLake, status: "ACTIVE", metrics: metrics(0, -1, "missing") },
        ];
        try {
            for (const variant of variants) {
                BY_CTA_ID["40260"] = variant;
                stubStation("41700", ["Brown", "Green", "Orange", "Purple", "Pink"]);

                const result = await neighbors("washington-wabash");
                expect(result.prev).toBeNull();
                expect(result.neighborAvg).toBe(5000);
            }
        } finally {
            BY_CTA_ID["40260"] = stateLake;
        }
    });

    it("drops a neighbor that has no metrics and averages the other side", async () => {
        // Washington/Wabash on the Brown Loop ring: State/Lake (closed, unscored) before, Adams/Wabash after.
        stubStation("41700", ["Brown", "Green", "Orange", "Purple", "Pink"]);

        const result = await neighbors("washington-wabash");
        expect(result.prev).toBeNull();
        expect(result.next?.name).toBe("Adams/Wabash");
        expect(result.neighborAvg).toBe(5000);
    });
});
