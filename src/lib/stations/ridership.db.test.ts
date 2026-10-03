import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSyncTestCity, deleteSyncTestCity, stationIdFor } from "@/lib/sync/__fixtures__/db";
import type { RidershipRow } from "@/lib/sync/match";
import type { DayType } from "@/lib/sync/socrata";
import { upsertRidership } from "@/lib/sync/upsert";
import { readSparklineRows, readStationDays } from "./ridership";

// Runs in the `db` Vitest project against the local or CI Postgres.
const CITY = "test-station-ridership";
const OTHER_CITY = "test-station-ridership-other";
const CURRENT = "40010"; // data through 2026-07-31, the city's data-through date
const LAPSED = "40020"; // stopped reporting on 2026-05-31
const UNSCORED = "40030"; // rows but no metrics row yet
const EMPTY = "40040";

const id = (cta: string) => stationIdFor(CITY, cta);
const rows = (cityCode: string, cta: string, days: [string, number, DayType?][]): RidershipRow[] =>
    days.map(([serviceDate, entries, dayType = "W"]) => ({ stationId: stationIdFor(cityCode, cta), serviceDate, entries, dayType }));

const metricsRow = (stationId: string, serviceDateMax: string) => ({
    stationId,
    ghostScore: 50,
    lastUpdated: new Date(),
    serviceDateMax: new Date(`${serviceDateMax}T00:00:00Z`),
});

beforeAll(async () => {
    const cityId = await createSyncTestCity(CITY, [CURRENT, LAPSED, UNSCORED, EMPTY]);
    const otherCityId = await createSyncTestCity(OTHER_CITY, [CURRENT]);
    await upsertRidership(prisma, [
        ...rows(CITY, CURRENT, [
            ["2026-05-01", 1], // 91 days before the last day: outside the chart's range
            ["2026-05-02", 2, "A"], // 90 days before: the chart's first day
            ["2026-07-24", 724], // the day before the sparkline's week
            ["2026-07-25", 725, "A"],
            ["2026-07-27", 727],
            ["2026-07-31", 731],
        ]),
        ...rows(CITY, LAPSED, [
            ["2026-05-24", 524],
            ["2026-05-25", 525],
            ["2026-05-31", 531],
        ]),
        ...rows(CITY, UNSCORED, [["2026-07-31", 9]]),
        ...rows(OTHER_CITY, CURRENT, [["2026-07-31", 99]]),
    ]);
    await prisma.stationMetrics.createMany({
        data: [
            metricsRow(id(CURRENT), "2026-07-31"),
            metricsRow(id(LAPSED), "2026-05-31"),
            metricsRow(id(EMPTY), "2026-07-31"),
            metricsRow(stationIdFor(OTHER_CITY, CURRENT), "2026-07-31"),
        ],
    });
    expect(cityId).not.toBe(otherCityId);
});

afterAll(async () => {
    await deleteSyncTestCity(CITY);
    await deleteSyncTestCity(OTHER_CITY);
    await prisma.$disconnect();
});

describe("readSparklineRows", () => {
    it("reads each station's seven days ending at its own last service date, in one statement for the city", async () => {
        const city = await prisma.city.findUniqueOrThrow({ where: { code: CITY } });

        expect(await readSparklineRows(prisma, city.id)).toEqual([
            { stationId: id(CURRENT), serviceDate: "2026-07-25", entries: 725 },
            { stationId: id(CURRENT), serviceDate: "2026-07-27", entries: 727 },
            { stationId: id(CURRENT), serviceDate: "2026-07-31", entries: 731 },
            { stationId: id(LAPSED), serviceDate: "2026-05-25", entries: 525 },
            { stationId: id(LAPSED), serviceDate: "2026-05-31", entries: 531 },
        ]);
    });
});

describe("readStationDays", () => {
    it("reads the station's last date and the 90 days before it, oldest first, with the day type", async () => {
        const days = await readStationDays(prisma, id(CURRENT), null);
        expect(days[0]).toEqual({ serviceDate: "2026-05-02", entries: 2, dayType: "A" });
        expect(days.map((d) => d.serviceDate)).toEqual(["2026-05-02", "2026-07-24", "2026-07-25", "2026-07-27", "2026-07-31"]);
    });

    it("reaches back further when the score's window starts earlier, and no later when it starts later", async () => {
        expect((await readStationDays(prisma, id(CURRENT), "2026-05-01"))[0].serviceDate).toBe("2026-05-01");
        expect((await readStationDays(prisma, id(CURRENT), "2026-07-01"))[0].serviceDate).toBe("2026-05-02");
    });

    it("reads nothing for a station without rows", async () => {
        expect(await readStationDays(prisma, id(EMPTY), null)).toEqual([]);
        expect(await readStationDays(prisma, id(EMPTY), "2026-05-03")).toEqual([]);
    });
});
