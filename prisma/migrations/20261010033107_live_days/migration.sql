-- Live Ghost score, Phase A (docs-private/plans/2026-10-09-1935-feat-live-ghost-score-plan.md, U4, KTD7):
-- the two tables the worker's nightly reduction writes and the readers scan. Both are additive;
-- no existing table changes. Rollback while they are empty is a migration that drops them.

-- CreateEnum
CREATE TYPE "LiveDayVerdict" AS ENUM ('COUNTED', 'SET_ASIDE');

-- CreateTable
CREATE TABLE "LiveDay" (
    "serviceDate" DATE NOT NULL,
    "verdict" "LiveDayVerdict" NOT NULL,
    "cause" TEXT,
    "pollsExpected" INTEGER NOT NULL,
    "pollsSucceeded" INTEGER NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "faultLines" JSONB NOT NULL DEFAULT '[]',
    "scheduleVersion" TEXT,
    "rawPath" TEXT,
    "rawBytes" INTEGER,
    "reducerVersion" INTEGER NOT NULL,
    "reducedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveDay_pkey" PRIMARY KEY ("serviceDate")
);

-- CreateTable
CREATE TABLE "LiveStationDay" (
    "stationId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "scheduled" INTEGER NOT NULL,
    "fulfilled" INTEGER NOT NULL,
    "cancelled" INTEGER NOT NULL,
    "ghosts" INTEGER NOT NULL,
    "unknown" INTEGER NOT NULL,
    "unobserved" INTEGER NOT NULL,
    "unmapped" INTEGER NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "counted" BOOLEAN NOT NULL,
    "notCountedCause" TEXT,
    "observedGapMin" DOUBLE PRECISION,
    "scheduledGapMin" DOUBLE PRECISION,
    "byDirection" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "LiveStationDay_pkey" PRIMARY KEY ("stationId","serviceDate")
);

-- CreateIndex
CREATE INDEX "LiveDay_reducedAt_idx" ON "LiveDay"("reducedAt");

-- CreateIndex
CREATE INDEX "LiveStationDay_serviceDate_idx" ON "LiveStationDay"("serviceDate");

-- AddForeignKey
ALTER TABLE "LiveStationDay" ADD CONSTRAINT "LiveStationDay_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStationDay" ADD CONSTRAINT "LiveStationDay_serviceDate_fkey" FOREIGN KEY ("serviceDate") REFERENCES "LiveDay"("serviceDate") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-edited: the checks Prisma cannot express. A set-aside day names its cause and a counted
-- day none; polls succeeded never exceed polls expected; a station row that is not counted names
-- why and a counted one does not; and the verdict counts sum to the scheduled stops.
ALTER TABLE "LiveDay"
    ADD CONSTRAINT "LiveDay_cause_check" CHECK (("verdict" = 'SET_ASIDE') = ("cause" IS NOT NULL)),
    ADD CONSTRAINT "LiveDay_cause_value_check" CHECK ("cause" IS NULL OR "cause" IN ('site-gap', 'no-schedule', 'tracker-fault', 'quota', 'feed-shape')),
    ADD CONSTRAINT "LiveDay_polls_check" CHECK ("pollsExpected" >= 0 AND "pollsSucceeded" >= 0 AND "pollsSucceeded" <= "pollsExpected"),
    ADD CONSTRAINT "LiveDay_coverage_check" CHECK ("coverage" >= 0 AND "coverage" <= 1);

ALTER TABLE "LiveStationDay"
    ADD CONSTRAINT "LiveStationDay_counted_check" CHECK ("counted" = ("notCountedCause" IS NULL)),
    ADD CONSTRAINT "LiveStationDay_cause_value_check" CHECK ("notCountedCause" IS NULL OR "notCountedCause" IN ('site-gap', 'tracker-fault', 'unobserved', 'closed')),
    ADD CONSTRAINT "LiveStationDay_sum_check" CHECK ("scheduled" = "fulfilled" + "cancelled" + "ghosts" + "unknown" + "unobserved"),
    ADD CONSTRAINT "LiveStationDay_nonnegative_check" CHECK ("fulfilled" >= 0 AND "cancelled" >= 0 AND "ghosts" >= 0 AND "unknown" >= 0 AND "unobserved" >= 0 AND "unmapped" >= 0),
    ADD CONSTRAINT "LiveStationDay_coverage_check" CHECK ("coverage" >= 0 AND "coverage" <= 1);
