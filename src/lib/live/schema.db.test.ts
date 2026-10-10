import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { prisma } from "@/lib/prisma";
import { createSyncTestCity, deleteSyncTestCity, stationIdFor } from "@/lib/sync/__fixtures__/db";

/**
 * The live tables (plan U4, KTD7) on the local or CI Postgres, after `prisma migrate deploy`:
 * the Date key reads back as a calendar string, the station rows cascade with their day, and the
 * migration's hand-written checks hold. The `migration drift` test in src/test/schema-v2.db.test.ts
 * proves the migrated database still matches schema.prisma.
 */
const CITY = "test-live-schema";
const DAY = "2026-09-14";
const OTHER_DAY = "2026-09-15";
const TEST_DAYS = [DAY, OTHER_DAY];
const date = (day: string) => new Date(`${day}T00:00:00Z`);

const liveDay = (overrides: Partial<Prisma.LiveDayUncheckedCreateInput> = {}): Prisma.LiveDayUncheckedCreateInput => ({
    serviceDate: date(DAY),
    verdict: "COUNTED",
    cause: null,
    pollsExpected: 1_440,
    pollsSucceeded: 1_438,
    coverage: 1_438 / 1_440,
    faultLines: [],
    scheduleVersion: "abc123",
    rawPath: null,
    rawBytes: null,
    reducerVersion: 1,
    reducedAt: new Date("2026-09-15T08:20:00Z"),
    ...overrides,
});

const stationDay = (ctaStationId: string, overrides: Partial<Prisma.LiveStationDayUncheckedCreateInput> = {}): Prisma.LiveStationDayUncheckedCreateInput => ({
    stationId: stationIdFor(CITY, ctaStationId),
    serviceDate: date(DAY),
    scheduled: 200,
    fulfilled: 180,
    cancelled: 4,
    ghosts: 10,
    unknown: 3,
    unobserved: 3,
    unmapped: 1,
    coverage: 0.99,
    counted: true,
    notCountedCause: null,
    observedGapMin: 8.5,
    scheduledGapMin: 7,
    byDirection: [{ stopId: "30166", scheduled: 100, fulfilled: 90, cancelled: 2, ghosts: 5, unknown: 1, unobserved: 2 }],
    ...overrides,
});

async function rejection(write: Promise<unknown>): Promise<unknown> {
    return write.then(
        () => null,
        (error: unknown) => error,
    );
}

async function expectKnownError(write: Promise<unknown>, code: string): Promise<void> {
    const error = await rejection(write);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe(code);
}

/** A check-constraint violation, named by the constraint the database refused on. */
async function expectCheckViolation(write: Promise<unknown>, constraint: string): Promise<void> {
    const error = await rejection(write);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(constraint);
}

async function clearTestDays(): Promise<void> {
    await prisma.liveDay.deleteMany({ where: { serviceDate: { in: TEST_DAYS.map(date) } } });
}

beforeAll(async () => {
    await clearTestDays();
    await createSyncTestCity(
        CITY,
        CTA_ROSTER.map((s) => s.ctaStationId),
    );
});

beforeEach(clearTestDays);

afterAll(async () => {
    await clearTestDays();
    await deleteSyncTestCity(CITY);
    await prisma.$disconnect();
});

describe("LiveDay and LiveStationDay", () => {
    it("stores a day and its 144 station rows, and reads the date back as a calendar string", async () => {
        await prisma.liveDay.create({ data: liveDay() });
        await prisma.liveStationDay.createMany({ data: CTA_ROSTER.map((s) => stationDay(s.ctaStationId)) });

        const [day] = await prisma.$queryRaw<{ serviceDate: string; verdict: string; faultLines: unknown }[]>`
            SELECT "serviceDate"::text AS "serviceDate", "verdict"::text AS "verdict", "faultLines" FROM "LiveDay" WHERE "serviceDate" = ${DAY}::date`;
        expect(day).toEqual({ serviceDate: DAY, verdict: "COUNTED", faultLines: [] });

        const rows = await prisma.$queryRaw<{ serviceDate: string; n: bigint }[]>`
            SELECT "serviceDate"::text AS "serviceDate", count(*) AS n FROM "LiveStationDay"
            WHERE "serviceDate" = ${DAY}::date GROUP BY "serviceDate"`;
        expect(rows).toEqual([{ serviceDate: DAY, n: BigInt(144) }]);

        const stored = await prisma.liveStationDay.findUniqueOrThrow({
            where: { stationId_serviceDate: { stationId: stationIdFor(CITY, "40830"), serviceDate: date(DAY) } },
        });
        expect(stored).toMatchObject({ scheduled: 200, ghosts: 10, counted: true, observedGapMin: 8.5 });
        expect(stored.byDirection).toEqual([{ stopId: "30166", scheduled: 100, fulfilled: 90, cancelled: 2, ghosts: 5, unknown: 1, unobserved: 2 }]);
    });

    it("rejects a second row for the same station and day", async () => {
        await prisma.liveDay.create({ data: liveDay() });
        await prisma.liveStationDay.create({ data: stationDay("40830") });

        await expectKnownError(prisma.liveStationDay.create({ data: stationDay("40830", { ghosts: 11, fulfilled: 179 }) }), "P2002");
    });

    it("removes a day's station rows when the day is deleted", async () => {
        await prisma.liveDay.create({ data: liveDay() });
        await prisma.liveDay.create({ data: liveDay({ serviceDate: date(OTHER_DAY) }) });
        await prisma.liveStationDay.createMany({
            data: [stationDay("40830"), stationDay("41120"), stationDay("40830", { serviceDate: date(OTHER_DAY) })],
        });

        await prisma.liveDay.delete({ where: { serviceDate: date(DAY) } });

        const left = await prisma.liveStationDay.findMany({ where: { station: { cityId: { not: "" } }, serviceDate: { in: TEST_DAYS.map(date) } } });
        expect(left.map((r) => r.serviceDate.toISOString().slice(0, 10))).toEqual([OTHER_DAY]);
    });

    it("rejects a station row for a day with no LiveDay row", async () => {
        await expectKnownError(prisma.liveStationDay.create({ data: stationDay("40830") }), "P2003");
    });
});

describe("the migration's checks", () => {
    it("requires a cause on a set-aside day and none on a counted day", async () => {
        await expectCheckViolation(prisma.liveDay.create({ data: liveDay({ verdict: "SET_ASIDE", cause: null }) }), "LiveDay_cause_check");
        await expectCheckViolation(prisma.liveDay.create({ data: liveDay({ verdict: "COUNTED", cause: "site-gap" }) }), "LiveDay_cause_check");
        await expectCheckViolation(prisma.liveDay.create({ data: liveDay({ verdict: "SET_ASIDE", cause: "bad-luck" }) }), "LiveDay_cause_value_check");

        await prisma.liveDay.create({ data: liveDay({ verdict: "SET_ASIDE", cause: "site-gap", pollsSucceeded: 878, coverage: 878 / 1_440 }) });
    });

    it("keeps polls succeeded within polls expected and coverage within 0 to 1", async () => {
        await expectCheckViolation(prisma.liveDay.create({ data: liveDay({ pollsSucceeded: 1_441 }) }), "LiveDay_polls_check");
        await expectCheckViolation(prisma.liveDay.create({ data: liveDay({ coverage: 1.2 }) }), "LiveDay_coverage_check");
    });

    it("requires a cause on a station row that is not counted and none on one that is", async () => {
        await prisma.liveDay.create({ data: liveDay() });

        await expectCheckViolation(prisma.liveStationDay.create({ data: stationDay("40830", { counted: false, notCountedCause: null }) }), "LiveStationDay_counted_check");
        await expectCheckViolation(prisma.liveStationDay.create({ data: stationDay("40830", { counted: true, notCountedCause: "closed" }) }), "LiveStationDay_counted_check");
        await expectCheckViolation(prisma.liveStationDay.create({ data: stationDay("40830", { counted: false, notCountedCause: "quota" }) }), "LiveStationDay_cause_value_check");

        await prisma.liveStationDay.create({ data: stationDay("40830", { counted: false, notCountedCause: "tracker-fault" }) });
    });

    it("requires the verdict counts to sum to the scheduled stops", async () => {
        await prisma.liveDay.create({ data: liveDay() });

        await expectCheckViolation(prisma.liveStationDay.create({ data: stationDay("40830", { scheduled: 201 }) }), "LiveStationDay_sum_check");
        await expectCheckViolation(prisma.liveStationDay.create({ data: stationDay("40830", { ghosts: -1, fulfilled: 191 }) }), "LiveStationDay_nonnegative_check");

        // A closed station: nothing scheduled, nothing observed.
        await prisma.liveStationDay.create({
            data: stationDay("40260", { scheduled: 0, fulfilled: 0, cancelled: 0, ghosts: 0, unknown: 0, unobserved: 0, unmapped: 0, counted: false, notCountedCause: "closed", observedGapMin: null, scheduledGapMin: null, byDirection: [] }),
        });
    });
});
