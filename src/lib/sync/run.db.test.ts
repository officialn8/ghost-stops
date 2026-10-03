import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { clearSyncRuns, createSyncTestCity, deleteSyncTestCity, stationIdFor } from "./__fixtures__/db";
import { fakeSource, upstreamDays, UPDATED_AT } from "./__fixtures__/fake-source";
import { acquireLease } from "./lease";
import { runSync, type SyncOptions } from "./run";
import type { UpstreamDay } from "./socrata";
import { upsertRidership } from "./upsert";

// Runs in the `db` Vitest project against the local or CI Postgres.
const CITY = "test-sync-run";
const A = "40010";
const B = "40020";
const CLOSED = "40030"; // like State/Lake: data until January, closed since
const NOW = new Date("2026-08-02T10:00:00Z");
const WINDOW_ROWS = upstreamDays([A, B], { start: "2026-06-01", end: "2026-07-31" }, (id) => (id === A ? 900 : 450));

const daily = (overrides: Partial<SyncOptions> = {}): SyncOptions => ({
    trigger: "cron-daily",
    mode: "daily",
    cityCode: CITY,
    now: () => NOW,
    ...overrides,
});

async function run(days: UpstreamDay[], options: Partial<SyncOptions> = {}, fail?: Parameters<typeof fakeSource>[1]) {
    const fake = fakeSource(days, fail);
    const summary = await runSync(prisma, fake.source, daily(options));
    const record = await prisma.syncRun.findUniqueOrThrow({ where: { id: summary.runId } });
    return { summary, record, calls: fake.calls };
}

const rowCount = () => prisma.ridershipDaily.count({ where: { station: { city: { code: CITY } } } });
const fetchedWindows = (calls: ReturnType<typeof fakeSource>["calls"]) =>
    calls.filter((c) => c.method === "fetchDays").map((c) => `${c.window!.start}..${c.window!.end}`);

beforeEach(async () => {
    await clearSyncRuns();
    await createSyncTestCity(CITY, [A, B, CLOSED]);
});

afterAll(async () => {
    await clearSyncRuns();
    await deleteSyncTestCity(CITY);
    await prisma.$disconnect();
});

describe("runSync", () => {
    it("inserts the trailing window, then a second identical run revises nothing", async () => {
        const first = await run(WINDOW_ROWS);

        expect(first.summary).toMatchObject({
            status: "OK",
            window: { start: "2026-06-01", end: "2026-07-31" },
            upstreamMaxDate: "2026-07-31",
            dataThrough: "2026-07-31",
            rowsFetched: 122,
            rowsInserted: 122,
            rowsRevised: 0,
        });
        expect(first.record).toMatchObject({ status: "OK", lease: null, rowsInserted: 122 });
        expect(first.record.windowStart?.toISOString().slice(0, 10)).toBe("2026-06-01");
        expect(fetchedWindows(first.calls)).toEqual(["2026-06-01..2026-06-30", "2026-07-01..2026-07-31"]);

        const second = await run(WINDOW_ROWS);
        expect(second.record).toMatchObject({ status: "OK", lease: null, rowsInserted: 0, rowsRevised: 0 });
    });

    it("records an unknown CTA station id without aborting the run", async () => {
        const days = [...WINDOW_ROWS, ...upstreamDays(["40500"], { start: "2026-07-01", end: "2026-07-02" })];

        const { record } = await run(days);
        expect(record).toMatchObject({ status: "OK", rowsInserted: 122, unmatchedStationIds: ["40500"] });
    });

    it("records a skipped run and writes no ridership while another run holds the lease (AE5)", async () => {
        await acquireLease(prisma, "cron-daily", new Date(NOW.getTime() - 30_000));

        const { summary, record, calls } = await run(WINDOW_ROWS);
        expect(summary.status).toBe("SKIPPED");
        expect(record).toMatchObject({ status: "SKIPPED", lease: null });
        expect(calls).toEqual([]);
        expect(await rowCount()).toBe(0);
    });

    it("finalizes as partial with the error when upstream fails after rows were written", async () => {
        const { record } = await run(WINDOW_ROWS, {}, (call) => call.window?.start === "2026-07-01");

        expect(record).toMatchObject({ status: "PARTIAL", lease: null, rowsInserted: 60 }); // June only
        expect(record.error).toMatch(/HTTP 503/);
        expect(record.finishedAt).not.toBeNull();
    });

    it("finalizes as failed when nothing was written", async () => {
        const { record } = await run(WINDOW_ROWS, {}, (call) => call.method === "maxDate");

        expect(record).toMatchObject({ status: "FAILED", lease: null, rowsInserted: 0 });
        expect((await acquireLease(prisma, "cron-daily", NOW)).acquired).toBe(true);
    });

    it("lists a restated month weekly, then the next daily run re-fetches only that month (AE7)", async () => {
        const stationA = stationIdFor(CITY, A);
        await upsertRidership(prisma, [
            { stationId: stationA, serviceDate: "2025-03-03", entries: 5_000, dayType: "W" },
            { stationId: stationA, serviceDate: "2025-03-04", entries: 5_100, dayType: "W" },
        ]);
        const restated: UpstreamDay[] = [
            ...WINDOW_ROWS,
            { ctaStationId: A, serviceDate: "2025-03-03", dayType: "W", rides: 5_333, updatedAt: UPDATED_AT },
            { ctaStationId: A, serviceDate: "2025-03-04", dayType: "W", rides: 5_100, updatedAt: UPDATED_AT },
        ];

        const weekly = await run(restated, { trigger: "cron-weekly", mode: "weekly" });
        expect(weekly.record).toMatchObject({ status: "OK", driftMonths: ["2025-03"] });

        const next = await run(restated);
        expect(fetchedWindows(next.calls)).toEqual(["2026-06-01..2026-06-30", "2026-07-01..2026-07-31", "2025-03-01..2025-03-31"]);
        expect(next.record).toMatchObject({ status: "OK", rowsRevised: 1, driftMonths: [] });

        const confirm = await run(restated, { trigger: "cron-weekly", mode: "weekly" });
        expect(confirm.record.driftMonths).toEqual([]);
    });

    it("fetches three of four carried drift months and carries the fourth", async () => {
        await prisma.syncRun.create({
            data: { trigger: "cron-weekly", status: "OK", finishedAt: NOW, driftMonths: ["2025-04", "2019-05", "2024-12", "2025-01"] },
        });

        const { record, calls } = await run(WINDOW_ROWS);
        expect(fetchedWindows(calls).slice(2)).toEqual(["2019-05-01..2019-05-31", "2024-12-01..2024-12-31", "2025-01-01..2025-01-31"]);
        expect(record.driftMonths).toEqual(["2025-04"]);
    });

    it("carries every drift month unfetched once the deadline has passed", async () => {
        await prisma.syncRun.create({ data: { trigger: "cron-weekly", status: "OK", finishedAt: NOW, driftMonths: ["2025-03"] } });

        const { record, calls } = await run(WINDOW_ROWS, { deadline: NOW.getTime() - 1 });
        expect(fetchedWindows(calls)).toHaveLength(2);
        expect(record.driftMonths).toEqual(["2025-03"]);
    });

    it("re-fetches only the named stations from --since, leaving the drift backlog alone", async () => {
        await prisma.syncRun.create({ data: { trigger: "cron-weekly", status: "OK", finishedAt: NOW, driftMonths: ["2025-03"] } });

        const { record, calls } = await run(WINDOW_ROWS, {
            trigger: "local --since 2026-07-01 --station-id 40020",
            since: "2026-07-01",
            ctaStationIds: [B],
        });
        expect(calls.filter((c) => c.method === "fetchDays").map((c) => c.ctaStationIds)).toEqual([[B]]);
        expect(record).toMatchObject({ trigger: "local --since 2026-07-01 --station-id 40020", rowsInserted: 31, driftMonths: ["2025-03"] });
    });

    it("writes base metrics for every station with rows, keeping an existing v1 score", async () => {
        await prisma.stationMetrics.create({
            data: { stationId: stationIdFor(CITY, A), ghostScore: 55, lastUpdated: NOW, serviceDateMax: new Date("2025-11-30") },
        });
        // Stored January rows, outside the window: the closed station's last data.
        await upsertRidership(
            prisma,
            ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"].map((serviceDate) => ({
                stationId: stationIdFor(CITY, CLOSED),
                serviceDate,
                entries: 300,
                dayType: "W",
            })),
        );

        await run(WINDOW_ROWS);

        const metrics = async (cta: string) => prisma.stationMetrics.findUniqueOrThrow({ where: { stationId: stationIdFor(CITY, cta) } });
        expect(await metrics(A)).toMatchObject({
            ghostScore: 55,
            dataStatus: "normal",
            avg12m: 900,
            avg30d: 900,
            rolling30dAvg: 900,
            rolling90dAvg: 900,
            lastDayEntries: 900,
        });
        expect((await metrics(A)).dataThrough?.toISOString().slice(0, 10)).toBe("2026-07-31");
        expect(await metrics(CLOSED)).toMatchObject({ ghostScore: -1, dataStatus: "missing", avg30d: null, rolling30dAvg: 0, avg12m: 300 });
        expect((await metrics(CLOSED)).serviceDateMax.toISOString().slice(0, 10)).toBe("2026-01-04");
    });

    it("recomputes station status from closures", async () => {
        await prisma.stationClosure.create({
            data: { stationId: stationIdFor(CITY, CLOSED), startDate: new Date("2026-01-05"), reason: "Rebuild" },
        });

        await run(WINDOW_ROWS);
        expect(await prisma.station.findUniqueOrThrow({ where: { id: stationIdFor(CITY, CLOSED) } })).toMatchObject({
            status: "CLOSED",
            closedAt: new Date("2026-01-05"),
        });
        expect((await prisma.station.findUniqueOrThrow({ where: { id: stationIdFor(CITY, A) } })).status).toBe("ACTIVE");
    });
});
