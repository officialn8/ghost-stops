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

function stubStation(
    ctaStationId: string | null,
    lines: string[],
    self: { status?: string; metrics?: ReturnType<typeof metrics> | null; name?: string } = {},
) {
    const { status = "ACTIVE", metrics: own = metrics(300, 67), name = "Station under test" } = self;
    prismaMock.station.findUnique.mockImplementation((async (args: {
        where: { id?: string; cityId_ctaStationId?: { ctaStationId: string } };
    }) => {
        if (args.where.id) {
            return {
                id: args.where.id,
                cityId: CITY,
                ctaStationId,
                name,
                status,
                latitude: 41.88,
                longitude: -87.63,
                lines: JSON.stringify(lines),
                metrics: own && { ...own, rolling90dAvg: 320 },
                city: { id: CITY, code: "chicago", name: "Chicago" },
            };
        }
        return BY_CTA_ID[args.where.cityId_ctaStationId!.ctaStationId] ?? null;
    }) as never);
}

type Detail = {
    metrics: { systemMedian: number; explanation: string; ranked: boolean };
    comparisons: {
        systemMedian: number;
        lineMedian: number;
        neighbors: { prev: { name: string } | null; next: { name: string } | null; neighborAvg: number };
    };
};

async function detail(id: string): Promise<Detail> {
    const response = await GET(new NextRequest(`http://localhost/api/chicago/stations/${id}`), {
        params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Detail;
}

async function neighbors(id: string) {
    return (await detail(id)).comparisons.neighbors;
}

// A row of the median population: the metrics with the station they belong to.
function peer(rolling30dAvg: number, lines: string[], status = "ACTIVE", dataStatus = "normal") {
    return { ...metrics(rolling30dAvg, 50, dataStatus), station: { status, lines: JSON.stringify(lines) } };
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

describe("GET /api/chicago/stations/[id] peer comparisons", () => {
    const LOOP = ["Brown", "Green", "Orange", "Purple", "Pink"];

    it("leaves closed and zero-rider stations out of the system and line medians", async () => {
        prismaMock.stationMetrics.findMany.mockResolvedValue([
            peer(1000, ["Brown"]),
            peer(2000, ["Brown"]),
            peer(4000, ["Red"]),
            peer(0, LOOP, "CLOSED", "zero"), // what the sync writes for State/Lake
            peer(0.4, ["Brown"], "ACTIVE", "zero"),
        ] as never);
        stubStation("41700", LOOP);

        const body = await detail("washington-wabash");
        expect(body.comparisons.systemMedian).toBe(2000);
        expect(body.metrics.systemMedian).toBe(2000);
        expect(body.comparisons.lineMedian).toBe(1500);
    });

    it("explains a station outside the ranking instead of comparing it", async () => {
        prismaMock.stationMetrics.findMany.mockResolvedValue([peer(1000, ["Brown"]), peer(2000, ["Brown"])] as never);
        const closed = "This station is closed, so it is not compared with other stations.";
        const noData = "No ridership data available for this station.";
        const cases = [
            { self: { status: "CLOSED", metrics: metrics(0, -1, "zero") }, explanation: closed }, // State/Lake after the sync
            { self: { status: "CLOSED", metrics: metrics(300, 30) }, explanation: closed }, // closed this week
            { self: { status: "TEMP_CLOSED", metrics: null }, explanation: closed },
            { self: { metrics: metrics(0.4, 45, "zero") }, explanation: noData },
            { self: { metrics: metrics(0, -1, "missing") }, explanation: noData },
            { self: { metrics: null }, explanation: noData },
        ];
        for (const { self, explanation } of cases) {
            stubStation(null, ["Brown"], self);
            const { metrics: result } = await detail("under-test");
            expect(result.explanation).toBe(explanation);
            // The panels hide the percentile line and the comparison bars when ranked is false.
            expect(result.ranked).toBe(false);
        }

        stubStation(null, ["Brown"]);
        expect((await detail("under-test")).metrics.ranked).toBe(true);
    });

    it("counts only ranked stations in the system average and percentile", async () => {
        stubStation("40980", ["Blue"]);
        await detail("harlem-forest-park");

        expect(prismaMock.stationMetrics.aggregate).toHaveBeenCalledWith({
            where: { station: { cityId: CITY, status: "ACTIVE" }, dataStatus: "normal" },
            _avg: { rolling30dAvg: true },
        });
        expect(prismaMock.station.count).toHaveBeenCalledWith({
            where: { cityId: CITY, status: "ACTIVE", metrics: { dataStatus: "normal" } },
        });
        expect(prismaMock.station.count).toHaveBeenCalledWith({
            where: { cityId: CITY, status: "ACTIVE", metrics: { dataStatus: "normal", rolling30dAvg: { lt: 300 } } },
        });
    });
});

describe("GET /api/chicago/stations/[id] narrative and facts", () => {
    it("returns O'Hare's stored narrative as the job wrote it, and labels facts from the shared table", async () => {
        stubStation("40890", ["Blue"], { name: "O'Hare" });
        prismaMock.stationFact.findMany.mockResolvedValue([
            {
                factKey: "airport_arrivals",
                value: 0,
                valueType: "number",
                unit: "arrivals/day",
                geography: "station",
                timeframeStart: null,
                timeframeEnd: null,
                methodology: "Placeholder until airport arrivals ingestion is implemented.",
                sourceNote: null,
                quality: "LOW",
                qualityNote: null,
                evidenceMeta: null,
                source: { code: "ohare_arrivals", name: "O'Hare Airport Arrivals", url: "https://example.test", status: "ACTIVE" },
            },
        ] as never);
        prismaMock.stationNarrative.findUnique.mockResolvedValue({
            archetypeKey: "airport_gateway",
            renderedStory: "Stored story.",
            evidenceFactKeys: '["airport_arrivals"]',
            templateVersion: "v2",
            confidence: 0.85,
            quality: "LOW",
            qualityNote: null,
            evidenceMeta: null,
        } as never);

        const body = (await detail("ohare")) as unknown as {
            narrative: { archetype: { key: string; title: string }; story: string; templateVersion: string };
            facts: Record<string, { label: string }>;
        };
        expect(body.narrative).toMatchObject({
            archetype: { key: "airport_gateway", title: "Airport Gateway" },
            story: "Stored story.",
            templateVersion: "v2",
        });
        expect(body.facts.airport_arrivals.label).toBe("Airport Arrivals");
    });
});
