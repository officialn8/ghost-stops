import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";
import type { StationDetailResponse, WhyComponent } from "@/types/station";

vi.mock("@/lib/prisma", async () => ({
    prisma: (await import("@/test/prisma-mock")).prismaMock,
}));
// One retired slug, so the alias branch has something to redirect.
vi.mock("@/lib/cta/slugAliases", () => ({ SLUG_ALIASES: { "harlem-forest-park": "harlem-blue-forest-park" } }));

const { GET } = await import("./route");

const CITY = "c";
const DATA_THROUGH = "2026-07-31";
const day = (date: string) => new Date(`${date}T00:00:00Z`);
const metrics = (rolling30dAvg: number, ghostScore: number, dataStatus = "normal") => ({ rolling30dAvg, ghostScore, dataStatus });

/** A score v2 metrics row for data through 2026-07-31; the v1 helper above covers rows without the v2 columns. */
function v2Metrics(overrides: Record<string, unknown> = {}) {
    return {
        ...metrics(300, 67),
        lastDayEntries: 290,
        serviceDateMax: day(DATA_THROUGH),
        dataThrough: day(DATA_THROUGH),
        scoreVersion: 2,
        tier: "QUIET",
        rank: 40,
        rankedCount: 143,
        residualPct: 60,
        yoyPct: 55,
        longRunPct: 50,
        erraticPct: 40,
        avg12m: 310,
        avg30d: 300,
        baselineAvg: 400,
        peerStationIds: { basis: "none", line: null, branch: null, stationIds: [], ctaStationIds: [], avg12m: [] },
        yoyChangePct: -4,
        vs2019Pct: -30,
        weekdayAvg: 330,
        weekendAvg: 250,
        ...overrides,
    };
}

// Stations the neighbor lookup may ask for, keyed by CTA station id.
type Neighbor = {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    status: string;
    metrics: (ReturnType<typeof metrics> & { tier?: string }) | null;
};
const BY_CTA_ID: Record<string, Neighbor> = {
    "40180": { id: "oak-park-uuid", name: "Oak Park (Blue)", slug: "oak-park-blue", displayName: "Oak Park", status: "ACTIVE", metrics: { ...metrics(1200, 55), tier: "QUIET" } },
    "40390": { id: "forest-park-uuid", name: "Forest Park", slug: "forest-park", displayName: "Forest Park", status: "ACTIVE", metrics: metrics(1800, 40) },
    "40260": { id: "state-lake-uuid", name: "State/Lake", slug: "state-lake", displayName: "State/Lake", status: "CLOSED", metrics: null },
    "40680": { id: "adams-wabash-uuid", name: "Adams/Wabash", slug: "adams-wabash", displayName: "Adams/Wabash", status: "ACTIVE", metrics: metrics(5000, 20) },
};

type Self = {
    id?: string;
    slug?: string;
    name?: string;
    displayName?: string | null;
    status?: string;
    closedAt?: Date | null;
    openedAt?: Date | null;
    closures?: { startDate: Date; endDate: Date | null }[];
    metrics?: Record<string, unknown> | null;
};

const STATION_UUID = "0b7a6f3e-5d0c-4c43-9a55-1f3d2a9c8e01";

/** Stubs the station the route resolves (by slug or uuid) and the neighbor lookups by CTA station id. */
function stubStation(ctaStationId: string | null, lines: string[], self: Self = {}) {
    const {
        id = STATION_UUID,
        slug = "under-test",
        name = "Station under test",
        displayName = null,
        status = "ACTIVE",
        closedAt = null,
        openedAt = null,
        closures = [],
        metrics: own = metrics(300, 67),
    } = self;
    const row = {
        id,
        cityId: CITY,
        ctaStationId,
        name,
        slug,
        displayName,
        status,
        closedAt,
        openedAt,
        latitude: 41.88,
        longitude: -87.63,
        lines: JSON.stringify(lines),
        metrics: own && { rolling90dAvg: 320, ...own },
        closures,
    };
    prismaMock.station.findFirst.mockImplementation((async (args: { where: { slug?: string; id?: string } }) => {
        return args.where.slug === row.slug || args.where.id === row.id ? row : null;
    }) as never);
    prismaMock.station.findUnique.mockImplementation((async (args: {
        where: { cityId_ctaStationId: { ctaStationId: string } };
    }) => BY_CTA_ID[args.where.cityId_ctaStationId.ctaStationId] ?? null) as never);
}

function get(key: string) {
    return GET(new NextRequest(`http://localhost/api/chicago/stations/${key}`), {
        params: Promise.resolve({ slug: key }),
    });
}

async function detail(key = "under-test"): Promise<StationDetailResponse> {
    const response = await get(key);
    expect(response.status).toBe(200);
    return (await response.json()) as StationDetailResponse;
}

async function neighbors(key = "under-test") {
    return (await detail(key)).comparisons.neighbors;
}

// A row of the median population: the metrics with the station they belong to.
function peer(rolling30dAvg: number, lines: string[], status = "ACTIVE", dataStatus = "normal") {
    return { ...metrics(rolling30dAvg, 50, dataStatus), station: { status, lines: JSON.stringify(lines) } };
}

/** The station rows the why card names its peers from. */
function stubPeerStations(stations: { id: string; slug: string; name: string; displayName: string }[]) {
    prismaMock.station.findMany.mockResolvedValue(stations as never);
}

const component = (body: StationDetailResponse, key: WhyComponent["key"]) =>
    body.whyCard!.components.find((c) => c.key === key)!;

beforeEach(() => {
    resetPrismaMock();
    prismaMock.$queryRaw.mockResolvedValue([] as never);
    prismaMock.stationMetrics.aggregate.mockResolvedValue({ _avg: { rolling30dAvg: 1000 } } as never);
    prismaMock.station.count.mockResolvedValue(143);
    prismaMock.stationMetrics.findMany.mockResolvedValue([]);
    prismaMock.station.findMany.mockResolvedValue([]);
    prismaMock.stationFact.findMany.mockResolvedValue([]);
    prismaMock.stationNarrative.findUnique.mockResolvedValue(null);
    prismaMock.syncRun.findFirst.mockResolvedValue({
        finishedAt: new Date("2026-08-02T11:04:00Z"),
        windowEnd: day(DATA_THROUGH),
    } as never);
});

describe("GET /api/chicago/stations/[slug] resolution", () => {
    it("resolves a slug, redirects a retired slug with 308, resolves a uuid, and answers 404 otherwise", async () => {
        stubStation("40980", ["Blue"], { slug: "harlem-blue-forest-park", name: "Harlem", displayName: "Harlem" });

        const bySlug = await detail("harlem-blue-forest-park");
        expect(bySlug.station).toMatchObject({ id: STATION_UUID, slug: "harlem-blue-forest-park", displayName: "Harlem" });
        // Slugs are unique per city, so the lookup is scoped to Chicago.
        expect(prismaMock.station.findFirst.mock.calls[0][0]).toMatchObject({
            where: { slug: "harlem-blue-forest-park", city: { code: "chicago" } },
        });

        const alias = await get("harlem-forest-park");
        expect(alias.status).toBe(308);
        expect(alias.headers.get("location")).toBe("http://localhost/api/chicago/stations/harlem-blue-forest-park");

        // The v1 panels fetch by uuid until U21.
        prismaMock.station.findFirst.mockClear();
        expect((await detail(STATION_UUID)).station.slug).toBe("harlem-blue-forest-park");
        expect(prismaMock.station.findFirst.mock.calls.map(([args]) => args?.where)).toEqual([
            { slug: STATION_UUID, city: { code: "chicago" } },
            { id: STATION_UUID, city: { code: "chicago" } },
        ]);

        const missing = await get("nowhere");
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: "Station not found" });
    });

    it("answers 500 without the error text when the database fails", async () => {
        prismaMock.station.findFirst.mockRejectedValue(new Error("connect ECONNREFUSED postgres://user:secret-pw@db.example.test/neondb"));
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});

        const response = await get("anything");
        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toEqual({ error: "Failed to fetch station details" });
        expect(JSON.stringify(body)).not.toContain("secret-pw");
        // The details stay in the server log.
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });
});

describe("GET /api/chicago/stations/[slug] v1 contract", () => {
    it("carries every key the v1 panel, mobile layout, pills, and comparison bars read", async () => {
        stubStation("40980", ["Blue"], { metrics: v2Metrics() });
        const body = await detail();

        // StationDetailPanel rejects a response without these two (src/components/station/StationDetailPanel.tsx).
        expect(body.station).toBeTruthy();
        expect(body.metrics).toBeTruthy();
        const v1Keys = [
            "station.id",
            "station.name",
            "station.latitude",
            "station.longitude",
            "station.lines",
            "station.ghostScore",
            "station.rolling30dAvg",
            "station.trend",
            "ridershipSeries",
            "metrics.ghostScore",
            "metrics.percentile",
            "metrics.systemAverage",
            "metrics.systemMedian",
            "metrics.explanation",
            "metrics.ranked",
            "comparisons.systemMedian",
            "comparisons.primaryLine",
            "comparisons.lineMedian",
            "comparisons.neighbors.neighborAvg",
            "comparisons.vsSystemMedian",
            "comparisons.vsLineMedian",
            "comparisons.vsNeighbors",
            "facts",
            "narrative",
            "sources",
        ];
        for (const key of v1Keys) expect(body, key).toHaveProperty(key);
        // NeighborPills reads id, name, and ghostScore; the v2 pills navigate by slug.
        for (const side of ["prev", "next"] as const) {
            for (const key of ["id", "slug", "name", "rolling30dAvg", "ghostScore"]) {
                expect(body.comparisons.neighbors[side], `${side}.${key}`).toHaveProperty(key);
            }
        }
        expect(body.metrics).toMatchObject({ ghostScore: 67, ranked: true });
        expect(Array.isArray(body.ridershipSeries)).toBe(true);
    });

    it("adds the v2 fields beside the v1 ones", async () => {
        stubStation("40770", ["Red"], {
            slug: "lawrence",
            name: "Lawrence",
            displayName: "Lawrence",
            openedAt: null,
            closures: [{ startDate: day("2021-05-16"), endDate: day("2025-07-20") }],
            metrics: v2Metrics({ tier: "FADING", rank: 21, avg12m: 1500.4, avg30d: 1620.2 }),
        });
        const body = await detail("lawrence");

        expect(body.station).toMatchObject({
            slug: "lawrence",
            displayName: "Lawrence",
            status: "ACTIVE",
            closedAt: null,
            openedAt: null,
            dataStatus: "available",
        });
        expect(body.metrics).toMatchObject({
            tier: "fading",
            rank: 21,
            rankedCount: 143,
            avg12m: 1500.4,
            avg30d: 1620.2,
            dataThrough: DATA_THROUGH,
            scoreVersion: 2,
        });
    });
});

describe("GET /api/chicago/stations/[slug] neighbors", () => {
    it("gives Harlem at the Forest Park end Oak Park and Forest Park, with slugs", async () => {
        stubStation("40980", ["Blue"]);

        const result = await neighbors();
        expect(result.prev).toEqual({
            id: "oak-park-uuid",
            slug: "oak-park-blue",
            name: "Oak Park (Blue)",
            displayName: "Oak Park",
            status: "ACTIVE",
            rolling30dAvg: 1200,
            ghostScore: 55,
            tier: "quiet",
        });
        expect(result.next).toMatchObject({ id: "forest-park-uuid", slug: "forest-park", name: "Forest Park", ghostScore: 40 });
        expect(result.neighborAvg).toBe(1500);
    });

    it("returns no neighbors for a station without a CTA id", async () => {
        stubStation(null, ["Blue"]);

        const result = await neighbors();
        expect(result).toEqual({ prev: null, next: null, neighborAvg: 0 });
        expect(prismaMock.station.findUnique).not.toHaveBeenCalled();
    });

    it("names a closed or no-rider neighbor without a score and leaves it out of the average", async () => {
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

                const body = await detail();
                const result = body.comparisons.neighbors;
                expect(result.prev).toMatchObject({ id: "state-lake-uuid", slug: "state-lake", status: variant.status, ghostScore: null, tier: null });
                expect(result.neighborAvg).toBe(5000);
                expect(body.comparisons.vsNeighbors).toBe(-94);
            }
        } finally {
            BY_CTA_ID["40260"] = stateLake;
        }
    });

    it("walks the Brown Line Loop from Washington/Wabash past State/Lake, closed and unscored", async () => {
        stubStation("41700", ["Brown", "Green", "Orange", "Purple", "Pink"]);

        const body = await detail();
        expect(body.comparisons.primaryLine).toBe("Brown");
        expect(body.comparisons.neighbors.prev).toMatchObject({
            name: "State/Lake",
            slug: "state-lake",
            status: "CLOSED",
            ghostScore: null,
            tier: null,
        });
        expect(body.comparisons.neighbors.next).toMatchObject({ name: "Adams/Wabash", slug: "adams-wabash", ghostScore: 20 });
        expect(body.comparisons.neighbors.neighborAvg).toBe(5000);
    });
});

describe("GET /api/chicago/stations/[slug] peer comparisons", () => {
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

        const body = await detail();
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
            const { metrics: result } = await detail();
            expect(result.explanation).toBe(explanation);
            // The panels hide the percentile line and the comparison bars when ranked is false.
            expect(result.ranked).toBe(false);
        }

        stubStation(null, ["Brown"]);
        expect((await detail()).metrics.ranked).toBe(true);
    });

    it("counts only ranked stations in the system average and percentile", async () => {
        stubStation("40980", ["Blue"]);
        await detail();

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

describe("GET /api/chicago/stations/[slug] freshness and series", () => {
    it("states data-through as a calendar date from the latest successful sync run", async () => {
        stubStation("40980", ["Blue"], { metrics: v2Metrics() });
        const body = await detail();

        expect(body.dataThrough).toBe("2026-07-31");
        expect(body.lastSuccessfulFetch).toBe("2026-08-02T11:04:00.000Z");
        expect(prismaMock.syncRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "OK" } }));
    });

    it("fills the series with a gap for each missing day and keeps ridershipSeries to the days with rows", async () => {
        stubStation("40980", ["Blue"], { metrics: v2Metrics() });
        prismaMock.$queryRaw.mockResolvedValue([
            { serviceDate: "2026-05-02", entries: 100, dayType: "A" },
            { serviceDate: "2026-07-29", entries: 120, dayType: "W" },
            { serviceDate: "2026-07-31", entries: 80, dayType: "W" },
        ] as never);

        const body = await detail();
        expect(body.ridershipSeries).toEqual([
            { date: "2026-05-02", entries: 100 },
            { date: "2026-07-29", entries: 120 },
            { date: "2026-07-31", entries: 80 },
        ]);
        expect(body.series).toMatchObject({ start: "2026-05-02", end: "2026-07-31" });
        expect(body.series!.days).toHaveLength(91);
        expect(body.series!.days[0]).toEqual({ date: "2026-05-02", entries: 100, dayType: "A" });
        expect(body.series!.days[1]).toEqual({ date: "2026-05-03", entries: null, dayType: null });
        expect(body.series!.days.slice(-3)).toEqual([
            { date: "2026-07-29", entries: 120, dayType: "W" },
            { date: "2026-07-30", entries: null, dayType: null },
            { date: "2026-07-31", entries: 80, dayType: "W" },
        ]);
    });

    it("drops rows the score's 90 days reach back to from the 91-day series", async () => {
        // Rows newer than the metrics (a run that failed after its upsert) push the series past the score window.
        stubStation("40980", ["Blue"], { metrics: v2Metrics() });
        prismaMock.$queryRaw.mockResolvedValue([
            { serviceDate: "2026-05-03", entries: 90, dayType: "U" },
            { serviceDate: "2026-08-05", entries: 80, dayType: "W" },
        ] as never);

        const body = await detail();
        expect(body.series).toMatchObject({ start: "2026-05-07", end: "2026-08-05" });
        expect(body.ridershipSeries).toEqual([{ date: "2026-08-05", entries: 80 }]);
    });

    it("returns a null series for a station with no ridership", async () => {
        stubStation("40980", ["Blue"], { metrics: null });
        const body = await detail();
        expect(body.series).toBeNull();
        expect(body.ridershipSeries).toEqual([]);
    });
});

describe("GET /api/chicago/stations/[slug] narrative and facts", () => {
    const fact = {
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
    };
    const story = (dataThrough: Date | null) => ({
        archetypeKey: "airport_gateway",
        renderedStory: "Stored story.",
        evidenceFactKeys: '["airport_arrivals"]',
        templateVersion: "v2",
        confidence: 0.85,
        quality: "LOW",
        qualityNote: null,
        evidenceMeta: null,
        dataThrough,
    });

    it("returns O'Hare's stored narrative as the job wrote it, and labels facts from the shared table", async () => {
        stubStation("40890", ["Blue"], { name: "O'Hare", metrics: v2Metrics() });
        prismaMock.stationFact.findMany.mockResolvedValue([fact] as never);
        prismaMock.stationNarrative.findUnique.mockResolvedValue(story(day(DATA_THROUGH)) as never);

        const body = await detail();
        expect(body.narrative).toMatchObject({
            archetype: { key: "airport_gateway", title: "Airport Gateway" },
            story: "Stored story.",
            templateVersion: "v2",
            dataThrough: DATA_THROUGH,
        });
        expect(body.facts!.airport_arrivals!.label).toBe("Airport Arrivals");
    });

    it("omits a narrative whose data-through lags the metrics, and one with no date, but keeps the facts", async () => {
        stubStation("40890", ["Blue"], { name: "O'Hare", metrics: v2Metrics() });
        prismaMock.stationFact.findMany.mockResolvedValue([fact] as never);

        for (const dataThrough of [day("2026-07-30"), null]) {
            prismaMock.stationNarrative.findUnique.mockResolvedValue(story(dataThrough) as never);
            const body = await detail();
            expect(body.narrative).toBeNull();
            expect(body.facts!.airport_arrivals!.label).toBe("Airport Arrivals");
            expect(body.sources).toHaveLength(1);
        }
    });
});

describe("GET /api/chicago/stations/[slug] why card", () => {
    it("marks Lawrence's year-over-year row null with the reopened chip", async () => {
        stubStation("40770", ["Red"], {
            slug: "lawrence",
            name: "Lawrence",
            displayName: "Lawrence",
            closures: [{ startDate: day("2021-05-16"), endDate: day("2025-07-20") }],
            metrics: v2Metrics({
                ghostScore: 62,
                tier: "QUIET",
                rank: 48,
                residualPct: 70,
                yoyPct: null,
                longRunPct: 55,
                erraticPct: 35,
                avg12m: 1500,
                baselineAvg: 2000,
                peerStationIds: {
                    basis: "neighbors",
                    line: "Red",
                    branch: "main",
                    stationIds: ["argyle-uuid", "wilson-uuid"],
                    ctaStationIds: ["41200", "40540"],
                    avg12m: [1200, 2800],
                },
                yoyChangePct: null,
                vs2019Pct: -40.2,
            }),
        });
        stubPeerStations([
            { id: "argyle-uuid", slug: "argyle", name: "Argyle", displayName: "Argyle" },
            { id: "wilson-uuid", slug: "wilson", name: "Wilson", displayName: "Wilson" },
        ]);
        // Weekdays 80 to 120 around a median of 100 swing 10%; the weekend days 20% around 50.
        prismaMock.$queryRaw.mockResolvedValue([
            { serviceDate: "2026-07-25", entries: 60, dayType: "A" },
            { serviceDate: "2026-07-26", entries: 40, dayType: "U" },
            { serviceDate: "2026-07-27", entries: 80, dayType: "W" },
            { serviceDate: "2026-07-28", entries: 100, dayType: "W" },
            { serviceDate: "2026-07-29", entries: 120, dayType: "W" },
            { serviceDate: "2026-07-30", entries: 100, dayType: "W" },
            { serviceDate: "2026-07-31", entries: 90, dayType: "W" },
        ] as never);

        const body = await detail("lawrence");
        const card = body.whyCard!;
        expect(card).toMatchObject({ score: 62, tier: "quiet", rank: 48, rankedCount: 143, badge: null });
        expect(card.chips).toEqual([{ kind: "reopened", text: "reopened Jul 2025" }]);

        expect(component(body, "yoy")).toEqual({
            key: "yoy",
            label: "Change from last year",
            weight: 0.25,
            pct: null,
            value: null,
            sentence: "Reopened Jul 2025, year-over-year available from Oct 2026.",
            nullReason: { kind: "reopened", text: "reopened Jul 2025, year-over-year available from Oct 2026" },
        });
        expect(component(body, "residual")).toMatchObject({
            pct: 70,
            value: Math.log(0.75),
            sentence: "Gets 75% of the riders its neighbors Argyle and Wilson get.",
            nullReason: null,
        });
        expect(component(body, "longRun")).toMatchObject({
            pct: 55,
            value: -40.2,
            sentence: "Carries 40% fewer riders than in 2019.",
            nullReason: null,
        });
        expect(component(body, "erratic")).toMatchObject({
            pct: 35,
            sentence: "Ridership swings about 15% day to day.",
            nullReason: null,
        });
        expect(component(body, "erratic").value).toBeCloseTo(0.15);
        expect(card.peers).toEqual({
            basis: "neighbors",
            line: "Red",
            branch: "main",
            stations: [
                { id: "argyle-uuid", slug: "argyle", displayName: "Argyle", avg12m: 1200 },
                { id: "wilson-uuid", slug: "wilson", displayName: "Wilson", avg12m: 2800 },
            ],
            baseline: 2000,
        });
        expect(prismaMock.station.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: { in: ["argyle-uuid", "wilson-uuid"] } } }),
        );
        for (const c of card.components) expect(c.sentence).not.toContain("—");
    });

    it("compares a hub with its branch's median and names the line", async () => {
        const blue = [
            { id: "ohare-uuid", slug: "ohare", name: "O'Hare", displayName: "O'Hare" },
            { id: "grand-blue-uuid", slug: "grand-blue", name: "Grand (Blue)", displayName: "Grand" },
            { id: "kedzie-blue-uuid", slug: "kedzie-blue", name: "Kedzie (Blue)", displayName: "Kedzie" },
        ];
        stubStation("40380", ["Blue", "Brown", "Green", "Orange", "Purple", "Pink"], {
            slug: "clark-lake",
            name: "Clark/Lake",
            displayName: "Clark/Lake",
            metrics: v2Metrics({
                ghostScore: 12,
                tier: "HEALTHY",
                rank: 127,
                residualPct: 5,
                yoyPct: 30,
                longRunPct: 40,
                erraticPct: 20,
                avg12m: 9000,
                baselineAvg: 3000,
                peerStationIds: {
                    basis: "branch-median",
                    line: "Blue",
                    branch: "main",
                    stationIds: blue.map((s) => s.id),
                    ctaStationIds: ["40890", "40490", "40250"],
                    avg12m: [6000, 3000, 1500],
                },
                yoyChangePct: 6.4,
                vs2019Pct: -45.6,
            }),
        });
        stubPeerStations(blue);

        const body = await detail("clark-lake");
        expect(body.whyCard).toMatchObject({ score: 12, tier: "healthy", rank: 127, badge: null, chips: [] });
        expect(component(body, "residual").sentence).toBe("Gets 3 times the riders of the median Blue Line station.");
        expect(component(body, "yoy").sentence).toBe("Up 6% from the same 90 days last year.");
        expect(component(body, "longRun").sentence).toBe("Carries 46% fewer riders than in 2019.");
        expect(body.whyCard!.peers).toMatchObject({ basis: "branch-median", line: "Blue", baseline: 3000 });
        expect(body.whyCard!.peers.stations.map((s) => s.slug)).toEqual(["ohare", "grand-blue", "kedzie-blue"]);
    });

    it("gives closed State/Lake no score, every row closed, and the closed chip alone", async () => {
        stubStation("40260", ["Brown", "Green", "Orange", "Purple", "Pink"], {
            slug: "state-lake",
            name: "State/Lake",
            status: "CLOSED",
            closedAt: day("2026-01-05"),
            closures: [{ startDate: day("2026-01-05"), endDate: null }],
            metrics: v2Metrics({
                ...metrics(0, -1, "zero"),
                tier: null,
                rank: null,
                residualPct: null,
                yoyPct: null,
                longRunPct: null,
                erraticPct: null,
                yoyChangePct: null,
                vs2019Pct: null,
            }),
        });

        const body = await detail("state-lake");
        expect(body.station).toMatchObject({ status: "CLOSED", closedAt: "2026-01-05", dataStatus: "zero" });
        expect(body.whyCard).toMatchObject({ score: null, tier: null, rank: null, badge: null });
        expect(body.whyCard!.chips).toEqual([{ kind: "closed", text: "closed since Jan 2026" }]);
        for (const c of body.whyCard!.components) {
            expect(c).toMatchObject({ pct: null, value: null, nullReason: { kind: "closed", text: "closed since Jan 2026" } });
        }
    });

    it("has no card for a station without score v2 metrics", async () => {
        stubStation("40980", ["Blue"], { metrics: metrics(300, 67) });
        expect((await detail()).whyCard).toBeNull();
    });
});
