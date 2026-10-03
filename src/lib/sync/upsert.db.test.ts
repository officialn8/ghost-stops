import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSyncTestCity, deleteSyncTestCity, stationIdFor } from "./__fixtures__/db";
import type { RidershipRow } from "./match";
import type { DayType } from "./socrata";
import { upsertRidership } from "./upsert";

// Runs in the `db` Vitest project against the local or CI Postgres.
const CITY = "test-sync-upsert";
const station = (cta: string) => stationIdFor(CITY, cta);
const row = (cta: string, serviceDate: string, entries: number, dayType: DayType = "W"): RidershipRow => ({
    stationId: station(cta),
    serviceDate,
    entries,
    dayType,
});

async function stored(cta: string, serviceDate: string) {
    return prisma.ridershipDaily.findUniqueOrThrow({
        where: { stationId_serviceDate: { stationId: station(cta), serviceDate: new Date(serviceDate) } },
    });
}

beforeEach(async () => {
    await createSyncTestCity(CITY, ["40010", "40020"]);
});

afterAll(async () => {
    await deleteSyncTestCity(CITY);
    await prisma.$disconnect();
});

describe("upsertRidership", () => {
    it("inserts new station-days and reports them as inserted", async () => {
        const counts = await upsertRidership(prisma, [row("40010", "2026-06-01", 900), row("40020", "2026-06-01", 450, "A")]);

        expect(counts).toEqual({ inserted: 2, revised: 0 });
        expect(await stored("40020", "2026-06-01")).toMatchObject({ entries: 450, dayType: "A" });
    });

    it("revises nothing when entries and day type equal the stored values", async () => {
        const rows = [row("40010", "2026-06-01", 900), row("40010", "2026-06-02", 910)];
        await upsertRidership(prisma, rows);

        expect(await upsertRidership(prisma, rows)).toEqual({ inserted: 0, revised: 0 });
    });

    it("revises a row whose day type alone differs", async () => {
        await upsertRidership(prisma, [row("40010", "2026-07-03", 500, "W")]);

        expect(await upsertRidership(prisma, [row("40010", "2026-07-03", 500, "U")])).toEqual({ inserted: 0, revised: 1 });
        expect(await stored("40010", "2026-07-03")).toMatchObject({ entries: 500, dayType: "U" });
    });

    it("splits inserted from revised in a batch with both", async () => {
        await upsertRidership(prisma, [row("40010", "2025-03-03", 5000), row("40010", "2025-03-04", 5100)]);

        const counts = await upsertRidership(prisma, [
            row("40010", "2025-03-03", 5333), // restated
            row("40010", "2025-03-04", 5100), // unchanged
            row("40010", "2025-03-05", 5200), // new
            row("40020", "2025-03-05", 700), // new
        ]);
        expect(counts).toEqual({ inserted: 2, revised: 1 });
        expect((await stored("40010", "2025-03-03")).entries).toBe(5333);
    });

    it("writes in chunks and sums the counts across them", async () => {
        const rows = Array.from({ length: 7 }, (_, i) => row("40010", `2026-01-0${i + 1}`, 100 + i));

        expect(await upsertRidership(prisma, rows, 3)).toEqual({ inserted: 7, revised: 0 });
        expect(await prisma.ridershipDaily.count({ where: { stationId: station("40010") } })).toBe(7);
    });

    it("refuses a batch that names one station-day twice", async () => {
        await expect(
            upsertRidership(prisma, [row("40010", "2026-06-01", 1), row("40010", "2026-06-01", 2)]),
        ).rejects.toThrow(/twice/);
    });
});
