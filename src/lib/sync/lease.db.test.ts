import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { clearSyncRuns } from "./__fixtures__/db";
import { acquireLease, finishRun, STALE_RUN_MS, SYNC_LEASE } from "./lease";

// Runs in the `db` Vitest project against the local or CI Postgres.
const NOW = new Date("2026-08-02T10:15:00Z");

beforeEach(clearSyncRuns);

afterAll(async () => {
    await clearSyncRuns();
    await prisma.$disconnect();
});

describe("acquireLease", () => {
    it("records a running row holding the lease before anything else happens", async () => {
        const lease = await acquireLease(prisma, "cron-daily", NOW);

        expect(lease.acquired).toBe(true);
        expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: lease.runId } })).toMatchObject({
            trigger: "cron-daily",
            status: "RUNNING",
            lease: SYNC_LEASE,
            startedAt: NOW,
            finishedAt: null,
        });
    });

    it("records a skipped run when another run holds the lease", async () => {
        const first = await acquireLease(prisma, "cron-daily", NOW);
        const second = await acquireLease(prisma, "cron-daily", new Date(NOW.getTime() + 30_000));

        expect(second.acquired).toBe(false);
        expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: second.runId } })).toMatchObject({
            status: "SKIPPED",
            lease: null,
            durationMs: 0,
        });
        expect((await prisma.syncRun.findUniqueOrThrow({ where: { id: first.runId } })).lease).toBe(SYNC_LEASE);
    });

    it("expires a running row older than an hour, then proceeds", async () => {
        const stale = await acquireLease(prisma, "cron-daily", NOW);
        const later = new Date(NOW.getTime() + STALE_RUN_MS + 60_000);

        const next = await acquireLease(prisma, "cron-daily", later);

        expect(next.acquired).toBe(true);
        expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: stale.runId } })).toMatchObject({
            status: "FAILED",
            lease: null,
            finishedAt: later,
            error: expect.stringMatching(/hour/),
        });
    });

    it("does not expire a running row younger than an hour", async () => {
        await acquireLease(prisma, "cron-daily", NOW);

        const next = await acquireLease(prisma, "cron-daily", new Date(NOW.getTime() + STALE_RUN_MS - 60_000));
        expect(next.acquired).toBe(false);
    });
});

describe("finishRun", () => {
    it("finalizes the row and releases the lease for the next run", async () => {
        const run = await acquireLease(prisma, "local", NOW);
        await finishRun(prisma, run.runId, {
            status: "OK",
            finishedAt: new Date(NOW.getTime() + 42_000),
            durationMs: 42_000,
            rowsFetched: 10,
            rowsInserted: 4,
            rowsRevised: 1,
            unmatchedStationIds: ["40500"],
            driftMonths: [],
            upstreamUpdatedAt: new Date("2026-09-28T18:04:46Z"),
            error: null,
        });

        expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
            status: "OK",
            lease: null,
            durationMs: 42_000,
            rowsFetched: 10,
            rowsInserted: 4,
            rowsRevised: 1,
            unmatchedStationIds: ["40500"],
            upstreamUpdatedAt: new Date("2026-09-28T18:04:46Z"),
        });
        expect((await acquireLease(prisma, "local", new Date(NOW.getTime() + 60_000))).acquired).toBe(true);
    });
});
