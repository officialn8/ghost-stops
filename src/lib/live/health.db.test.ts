import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { readTrainFreshness, readTrainHealthInputs } from "./health";
import { createMemoryObjectStore } from "./objectStore";

// Runs in the `db` Vitest project against the local or CI Postgres. Both readers answer from the
// newest LiveDay row in the table, so these days sit after every date the other db test files
// write (all in 2026), which keeps them the newest whatever those files leave behind. The project
// runs one file at a time, and this file clears its days before each test and after the last.
const NOW = new Date("2026-10-16T13:21:00Z");
const TEST_DAYS = ["2030-01-01", "2030-01-02", "2030-01-03"];
const date = (day: string) => new Date(`${day}T00:00:00Z`);

async function clearTestDays(): Promise<void> {
    await prisma.liveDay.deleteMany({ where: { serviceDate: { in: TEST_DAYS.map(date) } } });
}

const day = (serviceDate: string, verdict: "COUNTED" | "SET_ASIDE") => ({
    serviceDate: date(serviceDate),
    verdict,
    cause: verdict === "SET_ASIDE" ? "site-gap" : null,
    pollsExpected: 1_440,
    pollsSucceeded: verdict === "SET_ASIDE" ? 800 : 1_440,
    coverage: verdict === "SET_ASIDE" ? 800 / 1_440 : 1,
    reducerVersion: 1,
    reducedAt: new Date(`${serviceDate}T08:20:00Z`),
});

// Two counted days, then a set-aside one: the newest day of any verdict is not the newest counted day.
beforeEach(async () => {
    await clearTestDays();
    await prisma.liveDay.createMany({ data: [day("2030-01-01", "COUNTED"), day("2030-01-02", "COUNTED"), day("2030-01-03", "SET_ASIDE")] });
});

afterAll(async () => {
    await clearTestDays();
    await prisma.$disconnect();
});

describe("readTrainFreshness", () => {
    it("names the latest counted day, passing over a later set-aside one", async () => {
        expect(await readTrainFreshness(prisma)).toEqual({ observedThrough: "2030-01-02" });
    });
});

describe("readTrainHealthInputs", () => {
    it("reads the latest day of any verdict beside the latest counted one, and a store with no checkpoint as null", async () => {
        expect(await readTrainHealthInputs(prisma, createMemoryObjectStore(), NOW)).toEqual({
            latestDay: "2030-01-03",
            observedThrough: "2030-01-02",
            checkpointAgeMs: null,
        });
    });

    it("reads the checkpoint as unreadable when no store is configured", async () => {
        expect(await readTrainHealthInputs(prisma, null, NOW)).toEqual({
            latestDay: "2030-01-03",
            observedThrough: "2030-01-02",
            checkpointAgeMs: "unreadable",
        });
    });
});
