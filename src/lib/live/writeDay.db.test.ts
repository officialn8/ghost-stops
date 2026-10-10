import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { prisma } from "@/lib/prisma";
import { createSyncTestCity, deleteSyncTestCity, stationIdFor } from "@/lib/sync/__fixtures__/db";
import { REDUCER_VERSION, type LiveDayRow, type LiveStationDayRow } from "./reduce";
import { gapDay, recordRawPath, writeDay, WriteDayRefused } from "./writeDay";

// Runs in the `db` Vitest project against the local or CI Postgres.
const CITY = "test-live-write";
const DAY = "2026-09-24";
const OTHER = "2026-09-25";
const TEST_DAYS = [DAY, OTHER];
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const ROSTER_IDS = CTA_ROSTER.map((s) => s.ctaStationId);

const dayRow = (overrides: Partial<LiveDayRow> = {}): LiveDayRow => ({
    serviceDate: DAY,
    verdict: "COUNTED",
    cause: null,
    pollsExpected: 1_440,
    pollsSucceeded: 1_430,
    coverage: 1_430 / 1_440,
    faultLines: [],
    scheduleVersion: "abc",
    reducerVersion: REDUCER_VERSION,
    reducedAt: new Date("2026-09-25T08:20:00Z"),
    ...overrides,
});

const stationRow = (ctaStationId: string, overrides: Partial<LiveStationDayRow> = {}): LiveStationDayRow => ({
    ctaStationId,
    scheduled: 100,
    fulfilled: 90,
    cancelled: 2,
    ghosts: 5,
    unknown: 1,
    unobserved: 2,
    unmapped: 0,
    coverage: 0.99,
    counted: true,
    notCountedCause: null,
    observedGapMin: 8,
    scheduledGapMin: 7,
    byDirection: [{ stopId: "30228", route: null, scheduled: 100, fulfilled: 90, cancelled: 2, ghosts: 5, unknown: 1, unobserved: 2, observedGapMin: 8, scheduledGapMin: 7 }],
    ...overrides,
});

const allRows = () => ROSTER_IDS.map((id) => stationRow(id, id === "40260" ? { scheduled: 0, fulfilled: 0, cancelled: 0, ghosts: 0, unknown: 0, unobserved: 0, counted: false, notCountedCause: "closed", byDirection: [] } : {}));

async function clearTestDays(): Promise<void> {
    await prisma.liveDay.deleteMany({ where: { serviceDate: { in: TEST_DAYS.map(date) } } });
}

async function stored(day: string) {
    const liveDay = await prisma.liveDay.findUnique({ where: { serviceDate: date(day) } });
    const stations = await prisma.liveStationDay.count({ where: { serviceDate: date(day) } });
    return { liveDay, stations };
}

beforeAll(async () => {
    await clearTestDays();
    await createSyncTestCity(CITY, ROSTER_IDS);
});

beforeEach(clearTestDays);

afterAll(async () => {
    await clearTestDays();
    await deleteSyncTestCity(CITY);
    await prisma.$disconnect();
});

describe("writeDay", () => {
    it("writes the day and its 144 rows, which read back with the sum identity intact", async () => {
        const result = await writeDay(prisma, dayRow(), allRows(), { cityCode: CITY });

        expect(result).toEqual({ serviceDate: DAY, stations: 144, replaced: false });
        const { liveDay, stations } = await stored(DAY);
        expect(liveDay).toMatchObject({ verdict: "COUNTED", cause: null, pollsSucceeded: 1_430, scheduleVersion: "abc", reducerVersion: REDUCER_VERSION, rawPath: null });
        expect(stations).toBe(144);
        const jarvis = await prisma.liveStationDay.findUniqueOrThrow({ where: { stationId_serviceDate: { stationId: stationIdFor(CITY, "41190"), serviceDate: date(DAY) } } });
        expect(jarvis.scheduled).toBe(jarvis.fulfilled + jarvis.cancelled + jarvis.ghosts + jarvis.unknown + jarvis.unobserved);
        expect(jarvis.byDirection).toEqual(stationRow("41190").byDirection);
    });

    it("replaces a day written twice, leaving one LiveDay and 144 rows", async () => {
        await writeDay(prisma, dayRow(), allRows(), { cityCode: CITY });
        const again = await writeDay(prisma, dayRow({ pollsSucceeded: 1_440, coverage: 1 }), allRows().map((r) => (r.scheduled === 0 ? r : { ...r, ghosts: 6, fulfilled: 89 })), { cityCode: CITY });

        expect(again).toEqual({ serviceDate: DAY, stations: 144, replaced: true });
        const { liveDay, stations } = await stored(DAY);
        expect(liveDay?.pollsSucceeded).toBe(1_440);
        expect(stations).toBe(144);
        expect(await prisma.liveStationDay.count({ where: { serviceDate: date(DAY), ghosts: 6 } })).toBe(143);
    });

    it("refuses 143 rows and leaves the stored day untouched", async () => {
        await writeDay(prisma, dayRow(), allRows(), { cityCode: CITY });

        const refused = await writeDay(prisma, dayRow({ pollsSucceeded: 1_000, coverage: 1_000 / 1_440 }), allRows().slice(1), { cityCode: CITY }).then(
            () => null,
            (e: unknown) => e,
        );
        expect(refused).toBeInstanceOf(WriteDayRefused);
        expect((refused as WriteDayRefused).reason).toBe("station-count");
        expect((await stored(DAY)).liveDay?.pollsSucceeded).toBe(1_430);
        expect((await stored(DAY)).stations).toBe(144);
    });

    it("refuses an unknown station id and a day stored under a newer reducer version", async () => {
        const unknown = await writeDay(prisma, dayRow(), [...allRows(), stationRow("49999")], { cityCode: CITY }).then(
            () => null,
            (e: unknown) => e,
        );
        expect((unknown as WriteDayRefused).reason).toBe("unknown-station");
        expect((await stored(DAY)).liveDay).toBeNull();

        await writeDay(prisma, dayRow({ reducerVersion: REDUCER_VERSION + 1 }), allRows(), { cityCode: CITY });
        const older = await writeDay(prisma, dayRow(), allRows(), { cityCode: CITY }).then(
            () => null,
            (e: unknown) => e,
        );
        expect((older as WriteDayRefused).reason).toBe("newer-reducer");
        expect((await stored(DAY)).liveDay?.reducerVersion).toBe(REDUCER_VERSION + 1);
    });

    it("leaves no LiveDay and no station rows when the write fails midway", async () => {
        // A row with a negative count fails the database's check inside the transaction.
        const broken = allRows().map((r, i) => (i === 100 ? { ...r, ghosts: -1 } : r));
        await expect(writeDay(prisma, dayRow(), broken, { cityCode: CITY })).rejects.toThrow();
        expect(await stored(DAY)).toEqual({ liveDay: null, stations: 0 });
    });

    it("writes a gap day with no station rows and records a raw path afterwards", async () => {
        const result = await writeDay(prisma, gapDay(OTHER, new Date("2026-09-26T08:20:00Z")), null, { cityCode: CITY });
        expect(result).toEqual({ serviceDate: OTHER, stations: 0, replaced: false });
        expect((await stored(OTHER)).liveDay).toMatchObject({ verdict: "SET_ASIDE", cause: "site-gap", pollsExpected: 1_440, pollsSucceeded: 0, coverage: 0 });

        await recordRawPath(prisma, OTHER, "raw/v1/2026/09/2026-09-25.ndjson.gz", 12_345);
        expect((await stored(OTHER)).liveDay).toMatchObject({ rawPath: "raw/v1/2026/09/2026-09-25.ndjson.gz", rawBytes: 12_345 });
    });
});
