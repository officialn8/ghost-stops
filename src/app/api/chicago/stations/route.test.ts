import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";
import type { StationDetailResponse, StationListResponse } from "@/types/station";

// Runs the cached function directly; the test checks the tag and revalidation it was given.
const unstable_cache = vi.fn((fn: () => unknown) => fn);
vi.mock("next/cache", () => ({ unstable_cache }));
vi.mock("@/lib/prisma", async () => ({
    prisma: (await import("@/test/prisma-mock")).prismaMock,
}));

const { GET } = await import("./route");

const CITY = "c";
const day = (date: string) => new Date(`${date}T00:00:00Z`);

function row(
    id: string,
    name: string,
    station: Record<string, unknown> = {},
    metrics: Record<string, unknown> | null = {},
) {
    return {
        id,
        slug: id,
        name,
        displayName: name.replace(/ \(.*\)$/, ""),
        status: "ACTIVE",
        closedAt: null,
        latitude: 41.88,
        longitude: -87.63,
        lines: '["Red"]',
        ...station,
        metrics: metrics && {
            tier: "QUIET",
            rank: 50,
            rankedCount: 143,
            avg12m: 2000,
            avg30d: 2100,
            dataStatus: "normal",
            serviceDateMax: day("2026-07-31"),
            residualPct: 60,
            yoyPct: 55,
            longRunPct: 50,
            yoyChangePct: -3,
            ...metrics,
        },
    };
}

async function list(): Promise<StationListResponse> {
    const response = await GET();
    expect(response.status).toBe(200);
    return (await response.json()) as StationListResponse;
}

beforeEach(() => {
    resetPrismaMock();
    prismaMock.city.findUnique.mockResolvedValue({ id: CITY, code: "chicago", name: "Chicago" });
    prismaMock.station.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([] as never);
    prismaMock.syncRun.findFirst.mockResolvedValue({
        finishedAt: new Date("2026-08-02T11:04:00Z"),
        windowEnd: day("2026-07-31"),
    } as never);
});

describe("GET /api/chicago/stations", () => {
    it("caches its reads under the stations tag for an hour", () => {
        // The cron revalidates this tag after every run that writes, so the hour is only a fallback.
        expect(unstable_cache).toHaveBeenCalledWith(expect.any(Function), expect.any(Array), {
            tags: [STATIONS_CACHE_TAG],
            revalidate: 3600,
        });
    });

    it("returns every station with its slug, tier, rank, averages, and status, rank 1 first", async () => {
        prismaMock.station.findMany.mockResolvedValue([
            row("kostner", "Kostner", {}, { tier: "FADING", rank: 2 }),
            row("state-lake", "State/Lake", { status: "CLOSED", closedAt: day("2026-01-05") }, {
                tier: null,
                rank: null,
                avg30d: 0,
                dataStatus: "zero",
                residualPct: null,
                yoyPct: null,
                longRunPct: null,
            }),
            row("halsted-green", "Halsted (Green)", { lines: '["Green"]' }, { tier: "GHOST", rank: 1, avg12m: 812.5 }),
            row("new-station", "Brand New", {}, null),
        ] as never);

        const body = await list();
        expect(body.stations.map((s) => s.slug)).toEqual(["halsted-green", "kostner", "new-station", "state-lake"]);
        expect(body.stations[0]).toEqual({
            id: "halsted-green",
            slug: "halsted-green",
            displayName: "Halsted",
            name: "Halsted (Green)",
            lines: ["Green"],
            status: "ACTIVE",
            closedAt: null,
            latitude: 41.88,
            longitude: -87.63,
            tier: "ghost",
            rank: 1,
            rankedCount: 143,
            avg12m: 812.5,
            avg30d: 2100,
            dataStatus: "available",
            sparkline: { start: "2026-07-25", end: "2026-07-31", values: [null, null, null, null, null, null, null] },
            badge: null,
        });
        expect(body.stations[2]).toMatchObject({
            slug: "new-station",
            tier: null,
            rank: null,
            rankedCount: null,
            avg12m: null,
            dataStatus: "missing",
            sparkline: null,
        });
        expect(body.stations[3]).toMatchObject({ status: "CLOSED", closedAt: "2026-01-05", tier: null, rank: null, dataStatus: "zero" });
        // R26: the list carries the tier and rank, never the 0 to 100 value.
        expect(Object.keys(body.stations[0])).not.toContain("ghostScore");
    });

    it("gives a station whose data ends 2026-07-31 a sparkline from 2026-07-25 to 2026-07-31", async () => {
        prismaMock.station.findMany.mockResolvedValue([
            row("kostner", "Kostner"),
            // Stopped reporting at the end of May: its week ends at its own last day.
            row("gone-quiet", "Gone Quiet", {}, { rank: null, tier: null, dataStatus: "missing", serviceDateMax: day("2026-05-31") }),
        ] as never);
        prismaMock.$queryRaw.mockResolvedValue([
            { stationId: "kostner", serviceDate: "2026-07-25", entries: 410 },
            { stationId: "kostner", serviceDate: "2026-07-27", entries: 620 },
            { stationId: "kostner", serviceDate: "2026-07-31", entries: 640 },
            { stationId: "gone-quiet", serviceDate: "2026-05-31", entries: 3 },
        ] as never);

        const body = await list();
        const byId = Object.fromEntries(body.stations.map((s) => [s.id, s]));
        expect(byId.kostner.sparkline).toEqual({
            start: "2026-07-25",
            end: "2026-07-31",
            values: [410, null, 620, null, null, null, 640],
        });
        expect(byId["gone-quiet"].sparkline).toEqual({
            start: "2026-05-25",
            end: "2026-05-31",
            values: [null, null, null, null, null, null, 3],
        });
        // One query for every station's week, not one per station.
        expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prismaMock.station.findMany).toHaveBeenCalledTimes(1);
    });

    it("marks a small station whose riders are growing", async () => {
        prismaMock.station.findMany.mockResolvedValue([
            row("growing", "Growing", {}, { residualPct: 80, yoyPct: 30, longRunPct: 40, yoyChangePct: 2.5 }),
            row("steady", "Steady", {}, { residualPct: 80, yoyPct: 30, longRunPct: 40, yoyChangePct: -0.5 }),
        ] as never);

        const body = await list();
        expect(body.stations.map((s) => [s.id, s.badge])).toEqual([
            ["growing", "small-but-growing"],
            ["steady", "small-but-steady"],
        ]);
    });

    it("states data-through as the calendar date 2026-07-31, the same value the detail route gives", async () => {
        const body = await list();
        expect(body.dataThrough).toBe("2026-07-31");
        expect(body.lastSuccessfulFetch).toBe("2026-08-02T11:04:00.000Z");

        // The detail route reads the same sync run.
        const { GET: detailGET } = await import("./[slug]/route");
        prismaMock.station.findFirst.mockResolvedValue({
            ...row("kostner", "Kostner", {}, null),
            cityId: CITY,
            ctaStationId: null,
            openedAt: null,
            closures: [],
        } as never);
        prismaMock.stationMetrics.aggregate.mockResolvedValue({ _avg: { rolling30dAvg: null } } as never);
        prismaMock.station.count.mockResolvedValue(0);
        prismaMock.stationMetrics.findMany.mockResolvedValue([]);
        prismaMock.stationFact.findMany.mockResolvedValue([]);
        prismaMock.stationNarrative.findUnique.mockResolvedValue(null);
        const response = await detailGET(new NextRequest("http://localhost/api/chicago/stations/kostner"), {
            params: Promise.resolve({ slug: "kostner" }),
        });
        const detail = (await response.json()) as StationDetailResponse;
        expect(detail.dataThrough).toBe(body.dataThrough);
        expect(detail.lastSuccessfulFetch).toBe(body.lastSuccessfulFetch);
    });

    it("states no dates before any sync run has succeeded", async () => {
        prismaMock.syncRun.findFirst.mockResolvedValue(null);
        expect(await list()).toMatchObject({ dataThrough: null, lastSuccessfulFetch: null });
    });

    it("returns 404 when the city is missing", async () => {
        prismaMock.city.findUnique.mockResolvedValue(null);
        expect((await GET()).status).toBe(404);
    });

    it("answers 500 without the error text when the database fails", async () => {
        prismaMock.station.findMany.mockRejectedValue(new Error("connect ECONNREFUSED postgres://user:secret-pw@db.example.test/neondb"));
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});

        const response = await GET();
        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toEqual({ error: "Failed to load stations" });
        expect(JSON.stringify(body)).not.toContain("secret-pw");
        // The details stay in the server log.
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });
});
