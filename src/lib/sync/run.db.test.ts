import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateNarratives } from "@/lib/narratives/generate";
import { prisma } from "@/lib/prisma";
import { clearSyncRuns, createSyncTestCity, deleteSyncTestCity, stationIdFor } from "./__fixtures__/db";
import { fakeSource, upstreamDays, UPDATED_AT } from "./__fixtures__/fake-source";
import { acquireLease, latestCompletedRun } from "./lease";
import { runSync, type SyncOptions } from "./run";
import type { UpstreamDay } from "./socrata";
import { upsertRidership } from "./upsert";
import { monthChunks } from "./window";

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
const WINDOW_FETCHES = ["2026-06-01..2026-06-30", "2026-07-01..2026-07-31"];

/** A finished run that started and ended `hoursAgo` before NOW, so seeded runs sort as a test orders them. */
async function seedRun(hoursAgo: number, data: Omit<Prisma.SyncRunCreateInput, "startedAt" | "finishedAt">) {
    const at = new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);
    await prisma.syncRun.create({ data: { ...data, startedAt: at, finishedAt: at } });
}

/** A stored fact for a scratch station, from a scratch source that outlives the city. */
async function seedFact(cta: string, factKey: string, value: number) {
    const source = await prisma.dataSource.upsert({
        where: { code: FACT_SOURCE },
        create: { code: FACT_SOURCE, name: "Sync test facts", url: "https://example.test/facts" },
        update: {},
    });
    await prisma.stationFact.create({
        data: {
            stationId: stationIdFor(CITY, cta),
            factKey,
            value,
            valueType: "number",
            unit: "riders/day",
            geography: "station",
            methodology: "Sync test fact",
            sourceId: source.id,
            quality: "HIGH",
        },
    });
}
const FACT_SOURCE = "test-sync-run-facts";

const cityNarratives = () =>
    prisma.stationNarrative.findMany({ where: { station: { city: { code: CITY } } }, orderBy: { stationId: "asc" } });

beforeEach(async () => {
    await clearSyncRuns();
    await createSyncTestCity(CITY, [A, B, CLOSED]);
});

afterAll(async () => {
    await clearSyncRuns();
    await deleteSyncTestCity(CITY);
    await prisma.dataSource.deleteMany({ where: { code: FACT_SOURCE } });
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

    it("carries the drift backlog past later skipped and failed runs", async () => {
        await seedRun(3, { trigger: "cron-weekly", status: "OK", driftMonths: ["2025-03"] });
        await seedRun(2, { trigger: "cron-daily", status: "SKIPPED", durationMs: 0 });
        await seedRun(1, { trigger: "cron-daily", status: "FAILED", error: "Error: Socrata request failed" });
        expect((await latestCompletedRun(prisma))?.driftMonths).toEqual(["2025-03"]);

        const { record, calls } = await run(WINDOW_ROWS);
        expect(fetchedWindows(calls)).toEqual([...WINDOW_FETCHES, "2025-03-01..2025-03-31"]);
        expect(record).toMatchObject({ status: "OK", driftMonths: [] });
    });

    it("carries the backlog a later partial run recorded: a partial run counts as completed", async () => {
        await seedRun(170, { trigger: "cron-weekly", status: "OK", driftMonths: ["2025-03"] });
        // A weekly run that reconciled, then failed writing metrics after the window had changed rows.
        await seedRun(2, { trigger: "cron-weekly", status: "PARTIAL", driftMonths: ["2024-11"] });
        await seedRun(1, { trigger: "cron-daily", status: "FAILED" });
        expect((await latestCompletedRun(prisma))?.driftMonths).toEqual(["2024-11"]);

        const { record, calls } = await run(WINDOW_ROWS);
        expect(fetchedWindows(calls)).toEqual([...WINDOW_FETCHES, "2024-11-01..2024-11-30"]);
        expect(record.driftMonths).toEqual([]);
    });

    it("keeps every drift month not yet fetched when a drift fetch fails partway", async () => {
        await seedRun(1, { trigger: "cron-weekly", status: "OK", driftMonths: ["2019-05", "2024-12", "2025-01", "2025-04"] });

        const { record, calls } = await run(WINDOW_ROWS, {}, (call) => call.window?.start === "2024-12-01");
        expect(fetchedWindows(calls)).toEqual([...WINDOW_FETCHES, "2019-05-01..2019-05-31", "2024-12-01..2024-12-31"]);
        expect(record).toMatchObject({ status: "PARTIAL", lease: null, rowsInserted: 122 });
        // 2019-05 was fetched before the failure; it may stay listed, since a re-fetch is harmless.
        expect(record.driftMonths).toEqual(expect.arrayContaining(["2024-12", "2025-01", "2025-04"]));
    });

    it("drops drift months a wide --since run fetched in full, and fetches those it did not", async () => {
        await seedRun(1, { trigger: "cron-weekly", status: "OK", driftMonths: ["2018-11", "2019-01", "2019-05", "2025-03"] });

        const { record, calls } = await run(WINDOW_ROWS, { trigger: "local --since 2019-01-15", since: "2019-01-15" });
        const windowFetches = monthChunks({ start: "2019-01-15", end: "2026-07-31" }).map((w) => `${w.start}..${w.end}`);
        // 2019-05 and 2025-03 lie inside the window, so each is fetched once, with it. 2018-11 is
        // older than --since and 2019-01 only partly inside, so both are fetched as drift months.
        expect(fetchedWindows(calls)).toEqual([...windowFetches, "2018-11-01..2018-11-30", "2019-01-01..2019-01-31"]);
        expect(record).toMatchObject({ status: "OK", rowsInserted: 122, driftMonths: [] });
    });

    it("writes base metrics and the v2 score for every station with rows, replacing a v1 score", async () => {
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
            dataStatus: "normal",
            avg12m: 900,
            avg30d: 900,
            rolling30dAvg: 900,
            rolling90dAvg: 900,
            lastDayEntries: 900,
            weekdayAvg: 900,
            weekendAvg: 900,
        });
        expect((await metrics(A)).dataThrough?.toISOString().slice(0, 10)).toBe("2026-07-31");
        expect(await metrics(CLOSED)).toMatchObject({ ghostScore: -1, dataStatus: "missing", avg30d: null, rolling30dAvg: 0, avg12m: 300 });
        expect((await metrics(CLOSED)).serviceDateMax.toISOString().slice(0, 10)).toBe("2026-01-04");

        // Austin (Blue) and Harlem/Lake share no line here, so neither has peers; with no year-ago
        // or 2019 rows only erraticness is known, and both are equally steady: a tie at the median,
        // broken by station id for the rank. The unranked station still records its raw inputs:
        // walking the Green Line, Harlem/Lake is its peer.
        const scored = await prisma.stationMetrics.findMany({
            where: { station: { city: { code: CITY } } },
            orderBy: { stationId: "asc" },
            select: {
                stationId: true,
                scoreVersion: true,
                ghostScore: true,
                tier: true,
                rank: true,
                rankedCount: true,
                residualPct: true,
                erraticPct: true,
                peerStationIds: true,
            },
        });
        const noPeers = expect.objectContaining({ basis: "none" });
        const tied = { scoreVersion: 2, ghostScore: 50, tier: "QUIET", rankedCount: 2, residualPct: null, erraticPct: 50, peerStationIds: noPeers };
        expect(scored).toEqual([
            { stationId: stationIdFor(CITY, A), rank: 1, ...tied },
            { stationId: stationIdFor(CITY, B), rank: 2, ...tied },
            {
                stationId: stationIdFor(CITY, CLOSED),
                scoreVersion: 2,
                ghostScore: -1,
                tier: null,
                rank: null,
                rankedCount: 2,
                residualPct: null,
                erraticPct: null,
                peerStationIds: {
                    basis: "neighbors",
                    line: "Green",
                    branch: "main",
                    stationIds: [stationIdFor(CITY, B)],
                    ctaStationIds: [B],
                    avg12m: [450],
                },
            },
        ]);
    });

    it("writes no metrics and no statuses, and finalizes as failed, when scoring throws", async () => {
        await run(WINDOW_ROWS);
        await prisma.stationMetrics.deleteMany({ where: { station: { city: { code: CITY } } } });
        await prisma.stationNarrative.deleteMany({ where: { station: { city: { code: CITY } } } });
        await prisma.stationClosure.create({
            data: { stationId: stationIdFor(CITY, CLOSED), startDate: new Date("2026-01-05"), reason: "Rebuild" },
        });

        const { record } = await run(WINDOW_ROWS, {
            scoreStations: () => {
                throw new Error("scoring exploded");
            },
        });

        expect(record).toMatchObject({ status: "FAILED", lease: null, rowsInserted: 0, rowsRevised: 0 });
        expect(record.error).toMatch(/scoring exploded/);
        expect(await prisma.stationMetrics.count({ where: { station: { city: { code: CITY } } } })).toBe(0);
        expect(await cityNarratives()).toEqual([]);
        expect((await prisma.station.findUniqueOrThrow({ where: { id: stationIdFor(CITY, CLOSED) } })).status).toBe("ACTIVE");
    });

    it("writes a v2 narrative for every station with metrics, stamped with the metrics' data-through date", async () => {
        await seedFact(A, "ridership_2001_avg", 1_800);

        const { summary } = await run(WINDOW_ROWS);
        expect(summary).toMatchObject({ status: "OK", narrativesWritten: 2, narrativesRejected: 0 });

        const metrics = await prisma.stationMetrics.findMany({ where: { station: { city: { code: CITY } } } });
        const narratives = await cityNarratives();
        // The station with no ridership has no metrics, so no story either.
        expect(narratives.map((n) => n.stationId)).toEqual([stationIdFor(CITY, A), stationIdFor(CITY, B)]);
        for (const narrative of narratives) {
            expect(narrative.templateVersion).toBe("v2");
            expect(narrative.lastComputed).toEqual(NOW);
            const own = metrics.find((m) => m.stationId === narrative.stationId)!;
            expect(narrative.dataThrough?.toISOString().slice(0, 10)).toBe("2026-07-31");
            expect(narrative.dataThrough).toEqual(own.dataThrough);
        }

        // A quiet station with a stored 2001 average: the fact story, told from the 12-month average.
        expect(narratives[0]).toMatchObject({
            archetypeKey: "service_erosion",
            evidenceFactKeys: '["ridership_2001_avg"]',
            confidence: 0.7,
            quality: "HIGH",
            qualityNote: null,
            evidenceMeta: {
                metrics: { avg12m: 900, yoyChangePct: null, vs2019Pct: null, dataThrough: "2026-07-31" },
                tier: "QUIET",
                badge: null,
                selectedBy: "facts",
            },
        });
        expect(narratives[0].renderedStory).toContain("has fallen to **900**, a **-50%** change");
        // No facts and no year-ago or 2019 rows: the card's numbers alone, with no direction claimed.
        expect(narratives[1]).toMatchObject({
            archetypeKey: "stable",
            renderedStory: "Station 40020 ranks as a quiet station. Over the last 12 months it averaged **450** riders a day.",
            evidenceFactKeys: "[]",
            quality: "UNKNOWN",
        });
    });

    it("regenerates narratives idempotently: a second run with unchanged metrics changes only lastComputed", async () => {
        await seedFact(A, "ridership_2001_avg", 1_800);
        await run(WINDOW_ROWS);
        const first = await cityNarratives();

        const later = new Date(NOW.getTime() + 60 * 60 * 1000);
        await run(WINDOW_ROWS, { now: () => later });
        const second = await cityNarratives();

        const exceptLastComputed = (rows: typeof first) => rows.map((n) => ({ ...n, lastComputed: null }));
        expect(second).toHaveLength(2);
        expect(exceptLastComputed(second)).toEqual(exceptLastComputed(first));
        expect(second.map((n) => n.lastComputed)).toEqual([later, later]);
    });

    it("writes metrics and statuses but no narratives, and finalizes as partial, when narrative generation throws", async () => {
        await run(WINDOW_ROWS);
        await prisma.stationMetrics.deleteMany({ where: { station: { city: { code: CITY } } } });
        await prisma.stationNarrative.deleteMany({ where: { station: { city: { code: CITY } } } });
        await prisma.stationClosure.create({
            data: { stationId: stationIdFor(CITY, CLOSED), startDate: new Date("2026-01-05"), reason: "Rebuild" },
        });

        const { summary, record } = await run(WINDOW_ROWS, {
            generateNarratives: () => {
                throw new Error("narratives exploded");
            },
        });

        // Nothing upstream changed, so only the narrative failure makes this run partial.
        expect(record).toMatchObject({ status: "PARTIAL", lease: null, rowsInserted: 0, rowsRevised: 0 });
        expect(record.error).toMatch(/narratives exploded/);
        expect(summary).toMatchObject({ dataThrough: "2026-07-31", narrativesWritten: 0 });
        expect(await prisma.stationMetrics.count({ where: { station: { city: { code: CITY } } } })).toBe(2);
        expect((await prisma.station.findUniqueOrThrow({ where: { id: stationIdFor(CITY, CLOSED) } })).status).toBe("CLOSED");
        expect(await cityNarratives()).toEqual([]);
    });

    it("logs and counts a narrative that cites a fact its station lacks, writing the others", async () => {
        await seedFact(A, "population_change", 0.03);
        const lines: string[] = [];

        const { summary, record } = await run(WINDOW_ROWS, {
            log: (line) => lines.push(line),
            // Both stations get the stable story; this one cites population, which only A has.
            generateNarratives: (stations, dataThrough) =>
                generateNarratives(stations, dataThrough, {
                    templates: { stable: "{{stationName}} saw a **{{population_change|change}}** change in population." },
                }),
        });

        expect(record.status).toBe("OK");
        expect(summary).toMatchObject({ narrativesWritten: 1, narrativesRejected: 1 });
        expect(lines.filter((line) => line.includes("narrative"))).toEqual([
            `narrative rejected for station ${stationIdFor(CITY, B)} (stable): missing population_change`,
        ]);
        expect((await cityNarratives()).map((n) => [n.stationId, n.renderedStory, n.evidenceFactKeys])).toEqual([
            [stationIdFor(CITY, A), "Station 40010 saw a **+3%** change in population.", '["population_change"]'],
        ]);
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

    it("reopens a station whose closure has ended, and keeps one with an open closure closed", async () => {
        const reopened = stationIdFor(CITY, B);
        const closed = stationIdFor(CITY, CLOSED);
        await prisma.station.update({ where: { id: reopened }, data: { status: "CLOSED", closedAt: new Date("2026-03-01") } });
        await prisma.station.update({ where: { id: closed }, data: { status: "CLOSED", closedAt: new Date("2026-01-05") } });
        await prisma.stationClosure.createMany({
            data: [
                { stationId: reopened, startDate: new Date("2026-03-01"), endDate: new Date("2026-07-15"), reason: "Track work" },
                { stationId: closed, startDate: new Date("2026-01-05"), reason: "Rebuild" },
            ],
        });

        await run(WINDOW_ROWS); // 2026-08-02 in Chicago

        expect(await prisma.station.findUniqueOrThrow({ where: { id: reopened } })).toMatchObject({ status: "ACTIVE", closedAt: null });
        expect(await prisma.station.findUniqueOrThrow({ where: { id: closed } })).toMatchObject({
            status: "CLOSED",
            closedAt: new Date("2026-01-05"),
        });
    });

    it("writes no base metrics when the station status write fails in the same transaction", async () => {
        const closing = stationIdFor(CITY, CLOSED);
        await prisma.stationClosure.create({ data: { stationId: closing, startDate: new Date("2026-01-05"), reason: "Rebuild" } });
        // A trigger scoped to this scratch station makes the status update fail, with no change to the code under test.
        await prisma.$executeRawUnsafe(`
            CREATE OR REPLACE FUNCTION sync_test_refuse_station_update() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'sync test: station update refused'; END $$ LANGUAGE plpgsql`);
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sync_test_refuse_station_update ON "Station"`);
        await prisma.$executeRawUnsafe(`
            CREATE TRIGGER sync_test_refuse_station_update BEFORE UPDATE ON "Station"
            FOR EACH ROW WHEN (OLD."id" = '${closing}') EXECUTE FUNCTION sync_test_refuse_station_update()`);
        const { record } = await run(WINDOW_ROWS).finally(async () => {
            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sync_test_refuse_station_update ON "Station"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sync_test_refuse_station_update()`);
        });

        expect(record).toMatchObject({ status: "PARTIAL", rowsInserted: 122 });
        expect(record.error).toMatch(/station update refused/);
        expect(await prisma.stationMetrics.count({ where: { station: { city: { code: CITY } } } })).toBe(0);
        expect(await cityNarratives()).toEqual([]);
        expect((await prisma.station.findUniqueOrThrow({ where: { id: closing } })).status).toBe("ACTIVE");
    });
});
