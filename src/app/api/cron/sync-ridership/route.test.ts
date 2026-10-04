import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
import type { SyncSummary } from "@/lib/sync/run";
import { WEEKLY_SCHEDULE } from "@/lib/sync/schedule";

const runSync = vi.fn();
const revalidateTag = vi.fn();
vi.mock("@/lib/sync/run", () => ({ runSync }));
vi.mock("next/cache", () => ({ revalidateTag }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { GET } = await import("./route");

const summary = (overrides: Partial<SyncSummary> = {}): SyncSummary => ({
    runId: "run-1",
    status: "OK",
    window: { start: "2026-06-01", end: "2026-07-31" },
    upstreamMaxDate: "2026-07-31",
    upstreamUpdatedAt: "2026-09-28T18:04:46.000Z",
    dataThrough: "2026-07-31",
    rowsFetched: 8_784,
    rowsInserted: 61,
    rowsRevised: 3,
    unmatchedStationIds: [],
    driftMonths: [],
    narrativesWritten: 144,
    narrativesRejected: 0,
    durationMs: 12_000,
    error: null,
    ...overrides,
});

function request(headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/cron/sync-ridership", { headers });
}

beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    runSync.mockReset().mockResolvedValue(summary());
    revalidateTag.mockReset();
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("GET /api/cron/sync-ridership", () => {
    it("returns 401 without the bearer header, and with the wrong one", async () => {
        expect((await GET(request())).status).toBe(401);
        expect((await GET(request({ authorization: "Bearer wrong" }))).status).toBe(401);
        expect((await GET(request({ authorization: "test-cron-secret" }))).status).toBe(401);
        expect(runSync).not.toHaveBeenCalled();
    });

    it("returns 401 for everyone when CRON_SECRET is unset", async () => {
        vi.stubEnv("CRON_SECRET", "");
        expect((await GET(request({ authorization: "Bearer " }))).status).toBe(401);
        expect(runSync).not.toHaveBeenCalled();
    });

    it("runs the daily sync with the right bearer and revalidates the stations tag", async () => {
        const response = await GET(request({ authorization: "Bearer test-cron-secret", "x-vercel-cron-schedule": "0 10 * * *" }));

        expect(response.status).toBe(200);
        expect(runSync).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ trigger: "cron-daily", mode: "daily" }));
        expect(revalidateTag).toHaveBeenCalledWith(STATIONS_CACHE_TAG, { expire: 0 });
        expect(await response.json()).toMatchObject({
            status: "OK",
            mode: "daily",
            rowsInserted: 61,
            rowsRevised: 3,
            narrativesWritten: 144,
            narrativesRejected: 0,
        });
    });

    it("selects reconciliation when the weekly schedule fires", async () => {
        await GET(request({ authorization: "Bearer test-cron-secret", "x-vercel-cron-schedule": WEEKLY_SCHEDULE }));

        expect(runSync).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ trigger: "cron-weekly", mode: "weekly" }));
    });

    it("answers 500 with counts but no error text when the run fails", async () => {
        runSync.mockResolvedValue(summary({ status: "FAILED", rowsInserted: 0, rowsRevised: 0, error: "SocrataError: HTTP 503", unmatchedStationIds: ["40500"] }));

        const response = await GET(request({ authorization: "Bearer test-cron-secret" }));
        const body = await response.json();
        expect(response.status).toBe(500);
        expect(body).toMatchObject({ status: "FAILED", unmatchedStationIds: 1 });
        expect(JSON.stringify(body)).not.toContain("503");
        expect(revalidateTag).not.toHaveBeenCalled();
    });

    it("does not revalidate after a skipped run", async () => {
        runSync.mockResolvedValue(summary({ status: "SKIPPED" }));

        expect((await GET(request({ authorization: "Bearer test-cron-secret" }))).status).toBe(200);
        expect(revalidateTag).not.toHaveBeenCalled();
    });

    it("answers 500 after a partial run but still revalidates, since rows were written", async () => {
        runSync.mockResolvedValue(summary({ status: "PARTIAL", error: "SocrataError: HTTP 503" }));

        const response = await GET(request({ authorization: "Bearer test-cron-secret" }));
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ status: "PARTIAL", rowsInserted: 61 });
        expect(revalidateTag).toHaveBeenCalledWith(STATIONS_CACHE_TAG, { expire: 0 });
    });

    it("answers 500 with only status and mode when the run throws, leaking no error text", async () => {
        const message = "connect ECONNREFUSED postgres://user:secret-pw@db.example.test/neondb";
        runSync.mockRejectedValue(new Error(message));
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const response = await GET(request({ authorization: "Bearer test-cron-secret", "x-vercel-cron-schedule": "0 10 * * *" }));
        const body = await response.json();
        expect(response.status).toBe(500);
        expect(body).toEqual({ status: "ERROR", mode: "daily" });
        expect(JSON.stringify(body)).not.toContain("secret-pw");
        expect(JSON.stringify(body)).not.toContain("db.example.test");
        expect(revalidateTag).not.toHaveBeenCalled();

        // The log line carries the error's name only, never its message.
        expect(consoleError).toHaveBeenCalled();
        const logged = consoleError.mock.calls.flat().map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg)));
        for (const text of logged) {
            expect(text).not.toContain("secret-pw");
            expect(text).not.toContain("db.example.test");
            expect(text).not.toContain("ECONNREFUSED");
        }
    });

    it("passes the run a log that writes each line, a rejected narrative's included, to the function log", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});

        await GET(request({ authorization: "Bearer test-cron-secret" }));

        const options = runSync.mock.calls[0][2] as { log?: (message: string) => void };
        expect(typeof options.log).toBe("function");
        options.log!("narrative rejected for station s-1 (stable): missing population_change");
        expect(info).toHaveBeenCalledWith("sync-ridership", "narrative rejected for station s-1 (stable): missing population_change");
    });

    it("gives the run a drift deadline 240 seconds from the start of the request", async () => {
        const now = new Date("2026-08-12T10:00:00Z");
        vi.useFakeTimers({ now, toFake: ["Date"] });

        await GET(request({ authorization: "Bearer test-cron-secret" }));

        expect(runSync).toHaveBeenCalledTimes(1);
        const options = runSync.mock.calls[0][2] as { deadline: unknown };
        expect(typeof options.deadline).toBe("number");
        expect(options.deadline).toBe(now.getTime() + 240_000);
    });
});
