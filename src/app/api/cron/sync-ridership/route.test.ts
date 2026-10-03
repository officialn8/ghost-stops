import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    dataThrough: "2026-07-31",
    rowsFetched: 8_784,
    rowsInserted: 61,
    rowsRevised: 3,
    unmatchedStationIds: [],
    driftMonths: [],
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
        expect(revalidateTag).toHaveBeenCalledWith("stations");
        expect(await response.json()).toMatchObject({ status: "OK", mode: "daily", rowsInserted: 61, rowsRevised: 3 });
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
});
