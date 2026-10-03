import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { clearSyncRuns } from "./__fixtures__/db";
import { readHealthInputs } from "./health";
import { SYNC_LEASE } from "./lease";

// Runs in the `db` Vitest project against the local or CI Postgres.
const NOW = new Date("2026-08-02T10:15:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const hoursAgo = (hours: number) => minutesAgo(hours * 60);
const day = (date: string) => new Date(`${date}T00:00:00Z`);

beforeEach(clearSyncRuns);

afterAll(async () => {
    await clearSyncRuns();
    await prisma.$disconnect();
});

describe("readHealthInputs", () => {
    it("reports the oldest run still running after an hour as stuck, and not one 59 minutes in", async () => {
        await prisma.syncRun.createMany({
            data: [
                { trigger: "cron-daily", status: "OK", startedAt: hoursAgo(26), finishedAt: hoursAgo(26) },
                { trigger: "cron-daily", status: "FAILED", startedAt: hoursAgo(3), finishedAt: hoursAgo(2) },
                { trigger: "cron-daily", status: "RUNNING", lease: SYNC_LEASE, startedAt: minutesAgo(59) },
            ],
        });
        expect((await readHealthInputs(prisma, NOW)).stuckSince).toBeNull();

        // The lease is unique, so older running rows hold none, as an expired run's row would.
        const stuck = await prisma.syncRun.create({ data: { trigger: "cron-daily", status: "RUNNING", startedAt: minutesAgo(61) } });
        expect((await readHealthInputs(prisma, NOW)).stuckSince).toEqual(stuck.startedAt);

        const older = await prisma.syncRun.create({ data: { trigger: "cron-daily", status: "RUNNING", startedAt: minutesAgo(90) } });
        expect((await readHealthInputs(prisma, NOW)).stuckSince).toEqual(older.startedAt);
    });

    it("takes the last success from the OK run that finished last", async () => {
        // In start order: the local backfill started before the last daily OK run and finished after it.
        await prisma.syncRun.createMany({
            data: [
                { trigger: "cron-daily", status: "OK", startedAt: hoursAgo(28), finishedAt: hoursAgo(27), windowEnd: day("2026-07-29") },
                { trigger: "local", status: "OK", startedAt: hoursAgo(8), finishedAt: hoursAgo(2), windowEnd: day("2026-07-31") },
                { trigger: "cron-daily", status: "OK", startedAt: hoursAgo(5), finishedAt: hoursAgo(5), windowEnd: day("2026-07-30") },
                { trigger: "cron-daily", status: "PARTIAL", startedAt: hoursAgo(1), finishedAt: minutesAgo(50), windowEnd: day("2026-08-01") },
                { trigger: "cron-daily", status: "FAILED", startedAt: minutesAgo(30), finishedAt: minutesAgo(29) },
            ],
        });

        expect((await readHealthInputs(prisma, NOW)).lastSuccess).toEqual({ finishedAt: hoursAgo(2), windowEnd: day("2026-07-31") });
    });

    it("takes the last reconciliation from OK weekly-cron and --reconcile runs only", async () => {
        await prisma.syncRun.createMany({
            data: [
                { trigger: "cron-weekly", status: "OK", startedAt: hoursAgo(300), finishedAt: hoursAgo(300) },
                { trigger: "local --reconcile", status: "OK", startedAt: hoursAgo(200), finishedAt: hoursAgo(200) },
                { trigger: "cron-weekly", status: "FAILED", startedAt: hoursAgo(30), finishedAt: hoursAgo(30) },
                { trigger: "cron-daily", status: "OK", startedAt: hoursAgo(2), finishedAt: hoursAgo(2) },
                { trigger: "local --since 2001-01-01", status: "OK", startedAt: hoursAgo(1), finishedAt: hoursAgo(1) },
            ],
        });
        expect((await readHealthInputs(prisma, NOW)).lastReconcile).toEqual({ finishedAt: hoursAgo(200) });

        await prisma.syncRun.create({ data: { trigger: "cron-weekly", status: "OK", startedAt: hoursAgo(5), finishedAt: hoursAgo(5) } });
        expect((await readHealthInputs(prisma, NOW)).lastReconcile).toEqual({ finishedAt: hoursAgo(5) });
    });

    it("reads the backlog and unmatched ids from the latest completed run, passing over skipped and failed runs", async () => {
        await prisma.syncRun.createMany({
            data: [
                { trigger: "cron-weekly", status: "OK", startedAt: hoursAgo(3), unmatchedStationIds: ["40500"], driftMonths: ["2025-03"] },
                { trigger: "cron-daily", status: "SKIPPED", startedAt: hoursAgo(2) },
                { trigger: "cron-daily", status: "FAILED", startedAt: hoursAgo(1) },
            ],
        });

        expect((await readHealthInputs(prisma, NOW)).latest).toEqual({ unmatchedStationIds: ["40500"], driftMonths: ["2025-03"] });
    });
});
