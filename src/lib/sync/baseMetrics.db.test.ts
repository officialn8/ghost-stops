import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSyncTestCity, deleteSyncTestCity, stationIdFor } from "./__fixtures__/db";
import { readBaseMetricInputs, storedMaxDate } from "./baseMetrics";
import type { RidershipRow } from "./match";
import { upsertRidership } from "./upsert";

// Runs in the `db` Vitest project against the local or CI Postgres.
const CITY = "test-sync-base-metrics";
const OTHER_CITY = "test-sync-base-metrics-other";
const BANDED = "40010";
const SPARSE = "40020";
const LAPSED = "40030"; // rows only from more than a year back, like a station closed for years
const EMPTY = "40040";
const AS_OF = "2026-07-31";

// A row on each side of every window edge, each with its own entries, so a window that moves by
// one day changes its average. Windows hold the days after asOf - N, through asOf.
const BANDED_ROWS: [serviceDate: string, entries: number][] = [
    ["2026-08-01", 90_000], // after asOf: the station's latest row, in no window
    ["2026-07-31", 100], // asOf
    ["2026-07-02", 300], // asOf - 29: the oldest day in the 30-day window
    ["2026-07-01", 1_000], // asOf - 30
    ["2026-06-02", 2_000], // asOf - 59: the oldest day counted in the last 60
    ["2026-06-01", 3_000], // asOf - 60
    ["2026-05-03", 4_400], // asOf - 89: the oldest day in the 90-day window
    ["2026-05-02", 6_000], // asOf - 90
    ["2025-08-01", 8_000], // asOf - 364: the oldest day in the 12-month window
    ["2025-07-31", 50_000], // asOf - 1 year
    ["2025-01-15", 70_000], // older than a year
];

const rows = (cityCode: string, cta: string, days: [string, number][]): RidershipRow[] =>
    days.map(([serviceDate, entries]) => ({ stationId: stationIdFor(cityCode, cta), serviceDate, entries, dayType: "W" }));

let cityId: string;

beforeAll(async () => {
    cityId = await createSyncTestCity(CITY, [BANDED, SPARSE, LAPSED, EMPTY]);
    await upsertRidership(prisma, [
        ...rows(CITY, BANDED, BANDED_ROWS),
        ...rows(CITY, SPARSE, [["2026-07-15", 500]]),
        ...rows(CITY, LAPSED, [["2025-01-10", 300]]),
    ]);
});

afterAll(async () => {
    await deleteSyncTestCity(CITY);
    await deleteSyncTestCity(OTHER_CITY);
    await prisma.$disconnect();
});

const inputsFor = async (cta: string) =>
    (await readBaseMetricInputs(prisma, cityId, AS_OF)).find((input) => input.stationId === stationIdFor(CITY, cta));

describe("readBaseMetricInputs", () => {
    it("averages each window over its own days only, up to asOf", async () => {
        expect(await inputsFor(BANDED)).toEqual({
            stationId: stationIdFor(CITY, BANDED),
            avg30d: 200, // (100 + 300) / 2
            avg90d: 1_800, // (100 + 300 + 1,000 + 2,000 + 3,000 + 4,400) / 6
            avg12m: 3_100, // the 90-day rows plus 6,000 and 8,000, / 8
            daysLast60: 4,
            // The latest row is read without the asOf bound. A run passes the stored max date as
            // asOf, so there it is always the asOf row.
            lastDate: "2026-08-01",
            lastEntries: 90_000,
        });
    });

    it("returns one row per station with ridership, with null averages when none is within a year", async () => {
        const inputs = await readBaseMetricInputs(prisma, cityId, AS_OF);

        expect(inputs.map((input) => input.stationId).sort()).toEqual(
            [BANDED, SPARSE, LAPSED].map((cta) => stationIdFor(CITY, cta)).sort(),
        );
        expect(await inputsFor(SPARSE)).toMatchObject({
            lastDate: "2026-07-15",
            lastEntries: 500,
            avg12m: 500,
            avg90d: 500,
            avg30d: 500,
            daysLast60: 1,
        });
        expect(await inputsFor(LAPSED)).toMatchObject({
            lastDate: "2025-01-10",
            lastEntries: 300,
            avg12m: null,
            avg90d: null,
            avg30d: null,
            daysLast60: 0,
        });
    });
});

describe("storedMaxDate", () => {
    it("reads the latest service date across the city's stations, null before the city has any", async () => {
        const otherCityId = await createSyncTestCity(OTHER_CITY, [BANDED]);
        expect(await storedMaxDate(prisma, otherCityId)).toBeNull();

        await upsertRidership(prisma, rows(OTHER_CITY, BANDED, [["2026-09-30", 10]]));

        expect(await storedMaxDate(prisma, otherCityId)).toBe("2026-09-30");
        expect(await storedMaxDate(prisma, cityId)).toBe("2026-08-01");
        expect((await readBaseMetricInputs(prisma, cityId, AS_OF)).map((input) => input.stationId)).not.toContain(
            stationIdFor(OTHER_CITY, BANDED),
        );
    });
});
