import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { readTrainFreshness, readTrainHealthInputs } from "./health";
import { createMemoryObjectStore } from "./objectStore";

// Runs in the `db` Vitest project against the local or CI Postgres.
const NOW = new Date("2026-10-16T13:21:00Z");
const TEST_DAYS = ["2026-09-21", "2026-09-22", "2026-09-23"];
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

beforeEach(clearTestDays);

afterAll(async () => {
    await clearTestDays();
    await prisma.$disconnect();
});

describe("readTrainFreshness", () => {
    it("names the latest counted day, passing over a later set-aside one, and null before any", async () => {
        // Other tests may leave rows on other dates; only the test dates are asserted on when newer.
        await prisma.liveDay.createMany({ data: [day("2026-09-21", "COUNTED"), day("2026-09-22", "COUNTED"), day("2026-09-23", "SET_ASIDE")] });
        const newest = await prisma.liveDay.findFirst({ orderBy: { serviceDate: "desc" }, select: { serviceDate: true } });
        if (newest?.serviceDate.toISOString().slice(0, 10) === "2026-09-23") {
            expect(await readTrainFreshness(prisma)).toEqual({ observedThrough: "2026-09-22" });
        }
        const inputs = await readTrainHealthInputs(prisma, createMemoryObjectStore(), NOW);
        expect(inputs.latestDay).not.toBeNull();
        expect(inputs.checkpointAgeMs).toBeNull();
    });

    it("reads null before any row", async () => {
        if ((await prisma.liveDay.count()) === 0) {
            expect(await readTrainFreshness(prisma)).toEqual({ observedThrough: null });
            expect(await readTrainHealthInputs(prisma, null, NOW)).toEqual({ latestDay: null, observedThrough: null, checkpointAgeMs: "unreadable" });
        }
    });
});
