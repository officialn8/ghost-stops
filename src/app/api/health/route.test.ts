import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryObjectStore, type MemoryObjectStore } from "@/lib/live/objectStore";
import { putCheckpoint } from "@/lib/live/rawStore";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("@/lib/prisma", async () => ({
    prisma: (await import("@/test/prisma-mock")).prismaMock,
}));

/** The site's R2 store, as the route builds it from the environment; null until a test sets one. */
const r2 = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("@/lib/live/objectStore", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/live/objectStore")>()),
    r2StoreFromEnv: () => r2.store,
}));

const { GET } = await import("./route");

const NOW = new Date("2026-08-12T12:30:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const day = (date: string) => new Date(`${date}T00:00:00Z`);

/** No train collection at all: the default before any test stubs the live tables. */
const NOT_STARTED = { status: "not-started", observedThrough: null, latestDay: null, checkpointAgeMinutes: null };

/** Answers the two LiveDay queries: the latest row of any verdict, and the latest counted one. */
function stubLiveDays(latest: string | null, counted: string | null = latest) {
    prismaMock.liveDay.findFirst.mockImplementation((async (args: { where?: { verdict?: string } }) => {
        const chosen = args.where?.verdict === "COUNTED" ? counted : latest;
        return chosen === null ? null : { serviceDate: day(chosen) };
    }) as never);
}

async function checkpointWritten(minutesOld: number): Promise<MemoryObjectStore> {
    const store = createMemoryObjectStore({ now: () => minutesAgo(minutesOld).getTime() });
    await putCheckpoint(store, { version: 1, machineId: "m", writtenAt: 0, released: false, state: {} });
    return store;
}

type FindFirstArgs = {
    where: { status?: string | { in: string[] }; OR?: unknown[]; upstreamUpdatedAt?: unknown };
    select: Record<string, boolean>;
};

/**
 * Answers the five health queries: last ok run, last ok reconciliation (the one with an OR on the
 * trigger; two days old unless given), stuck running row, latest finished run, and the latest run
 * that read CTA's update time.
 */
function stubRuns(runs: {
    lastOk?: object | null;
    lastReconcile?: object | null;
    stuck?: object | null;
    latest?: object | null;
    upstreamUpdate?: object | null;
}) {
    prismaMock.syncRun.findFirst.mockImplementation((async (args: FindFirstArgs) => {
        if (args.where.upstreamUpdatedAt) return runs.upstreamUpdate ?? null;
        if (args.where.status === "OK" && args.where.OR) {
            return runs.lastReconcile === undefined ? { finishedAt: daysAgo(2) } : runs.lastReconcile;
        }
        if (args.where.status === "OK") return runs.lastOk ?? null;
        if (args.where.status === "RUNNING") return runs.stuck ?? null;
        return runs.latest ?? null;
    }) as never);
}

beforeEach(() => {
    resetPrismaMock();
    r2.store = null;
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("GET /api/health", () => {
    it("returns 200 with both dates after a recent successful run", async () => {
        stubRuns({
            lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") },
            latest: { unmatchedStationIds: [], driftMonths: [] },
            upstreamUpdate: { upstreamUpdatedAt: new Date("2026-07-28T18:04:46Z") },
        });

        const response = await GET();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            status: "ok",
            lastSuccessfulRunAt: daysAgo(1).toISOString(),
            lastReconciliationAt: daysAgo(2).toISOString(),
            dataThrough: "2026-07-31",
            unmatchedStationIds: [],
            driftBacklogMonths: 0,
            upstreamUpdatedAt: "2026-07-28T18:04:46.000Z",
            warnings: [],
            trains: NOT_STARTED,
        });
    });

    it("returns 503 when the latest successful run is 11 days old", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(11), windowEnd: new Date("2026-07-31") } });

        const response = await GET();
        expect(response.status).toBe(503);
        expect((await response.json()).status).toBe("stale");
    });

    it("returns 503 when no weekly reconciliation has succeeded in 15 days, though daily runs do", async () => {
        const lastOk = { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") };

        stubRuns({ lastOk, lastReconcile: { finishedAt: daysAgo(16) } });
        const response = await GET();
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ status: "reconcile-stale", lastReconciliationAt: daysAgo(16).toISOString() });

        stubRuns({ lastOk, lastReconcile: null });
        expect((await (await GET()).json()).status).toBe("reconcile-stale");

        stubRuns({ lastOk, lastReconcile: { finishedAt: daysAgo(14) } });
        expect((await GET()).status).toBe(200);
    });

    it("reports a stale daily sync before a stale reconciliation", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(11), windowEnd: null }, lastReconcile: null });
        expect((await (await GET()).json()).status).toBe("stale");
    });

    it("asks for the last reconciliation by the weekly cron's and the runner's triggers", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: null } });
        await GET();
        const reconcileQuery = prismaMock.syncRun.findFirst.mock.calls
            .map(([args]) => args as FindFirstArgs)
            .find((args) => args.where.OR !== undefined);
        expect(reconcileQuery?.where).toEqual({
            status: "OK",
            OR: [{ trigger: "cron-weekly" }, { trigger: { contains: "--reconcile" } }],
        });
    });

    it("returns 503 when no run has ever succeeded", async () => {
        stubRuns({});
        expect((await GET()).status).toBe(503);
    });

    it("reports trains ok with a three-minute-old checkpoint and yesterday's day, keeping 200", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") }, latest: { unmatchedStationIds: [], driftMonths: [] } });
        stubLiveDays("2026-08-11");
        r2.store = await checkpointWritten(3);

        const response = await GET();
        expect(response.status).toBe(200);
        expect((await response.json()).trains).toEqual({ status: "ok", observedThrough: "2026-08-11", latestDay: "2026-08-11", checkpointAgeMinutes: 3 });
    });

    it("answers 200 not-started before the first LiveDay row, whatever the checkpoint says", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") } });
        stubLiveDays(null);
        r2.store = await checkpointWritten(400);
        expect((await (await GET()).json()).trains.status).toBe("not-started");
        expect((await GET()).status).toBe(200);

        r2.store = createMemoryObjectStore(); // no checkpoint at all
        expect((await (await GET()).json()).trains.status).toBe("not-started");
    });

    it("answers 503 trains-stale on a fifty-minute-old checkpoint while the ridership status stays ok", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") } });
        stubLiveDays("2026-08-11");
        r2.store = await checkpointWritten(50);

        const response = await GET();
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body.status).toBe("ok");
        expect(body.trains).toEqual({ status: "trains-stale", observedThrough: "2026-08-11", latestDay: "2026-08-11", checkpointAgeMinutes: 50 });
    });

    it("answers 503 trains-unreduced when the latest day is three days old with a fresh checkpoint", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") } });
        stubLiveDays("2026-08-09");
        r2.store = await checkpointWritten(2);

        const response = await GET();
        expect(response.status).toBe(503);
        expect((await response.json()).trains.status).toBe("trains-unreduced");
    });

    it("reports an unreadable bucket as trains-stale with an unknown age and no error text", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") } });
        stubLiveDays("2026-08-11");
        const failing = createMemoryObjectStore();
        failing.failNext(1, 403);
        r2.store = failing;

        const response = await GET();
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body.trains).toEqual({ status: "trains-stale", observedThrough: "2026-08-11", latestDay: "2026-08-11", checkpointAgeMinutes: null });
        expect(JSON.stringify(body)).not.toMatch(/403|HTTP|cloudflare/);

        r2.store = null; // no R2 variables at all, as on a preview
        expect((await (await GET()).json()).trains.status).toBe("trains-stale");
    });

    it("answers 503 error when the train read throws, as for a ridership read", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") } });
        prismaMock.liveDay.findFirst.mockRejectedValue(new Error("connect ECONNREFUSED db.example.test"));

        const response = await GET();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: "error" });
    });

    it("returns 503 when a running row is 61 minutes old", async () => {
        stubRuns({
            lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") },
            stuck: { startedAt: new Date(NOW.getTime() - 61 * 60 * 1000) },
        });

        const response = await GET();
        expect(response.status).toBe(503);
        expect((await response.json()).status).toBe("stuck");
    });

    it("never reads or returns a run's error text", async () => {
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") } });

        const body = JSON.stringify(await (await GET()).json());
        for (const [args] of prismaMock.syncRun.findFirst.mock.calls) {
            expect(Object.keys((args as FindFirstArgs).select)).not.toContain("error");
        }
        expect(body).not.toContain("error");
    });

    it("warns about unmatched station ids and a drift backlog over twelve months, still with 200", async () => {
        const months = [...Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}`), "2025-01"];
        stubRuns({
            lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") },
            latest: { unmatchedStationIds: ["40500"], driftMonths: months },
        });

        const response = await GET();
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.driftBacklogMonths).toBe(13);
        expect(body.warnings).toEqual(["Upstream station ids with no station: 40500", "Drift backlog of 13 months"]);
    });

    it("does not warn about a backlog of exactly twelve months", async () => {
        const months = Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}`);
        stubRuns({ lastOk: { finishedAt: daysAgo(1), windowEnd: new Date("2026-07-31") }, latest: { unmatchedStationIds: [], driftMonths: months } });

        expect((await (await GET()).json()).warnings).toEqual([]);
    });

    it("returns 503 with no error text when the health inputs cannot be read", async () => {
        prismaMock.syncRun.findFirst.mockRejectedValue(new Error("connect ECONNREFUSED postgres://user:secret-pw@db.example.test/neondb"));

        const response = await GET();
        const body = await response.json();
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toEqual({ status: "error" });
        expect(JSON.stringify(body)).not.toContain("secret-pw");
        expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    });
});
