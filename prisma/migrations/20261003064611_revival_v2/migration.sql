-- CreateEnum
CREATE TYPE "StationStatus" AS ENUM ('ACTIVE', 'CLOSED', 'TEMP_CLOSED');

-- CreateEnum
CREATE TYPE "ScoreTier" AS ENUM ('GHOST', 'FADING', 'QUIET', 'HEALTHY');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED', 'SKIPPED');

-- DropIndex
DROP INDEX "Station_cityId_ctaStationId_idx";

-- Hand-edited: RidershipDaily is dropped and recreated lean instead of altered in place.
-- Its rows are reloaded from the history export afterwards (docs/runbooks/history-load.md).
-- DropTable
DROP TABLE "RidershipDaily";

-- CreateTable
CREATE TABLE "RidershipDaily" (
    "stationId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "entries" INTEGER NOT NULL,
    "dayType" CHAR(1) NOT NULL,

    CONSTRAINT "RidershipDaily_pkey" PRIMARY KEY ("stationId","serviceDate")
);

-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "closedAt" DATE,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "openedAt" DATE,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "status" "StationStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "StationMetrics" ADD COLUMN     "avg12m" DOUBLE PRECISION,
ADD COLUMN     "avg30d" DOUBLE PRECISION,
ADD COLUMN     "baselineAvg" DOUBLE PRECISION,
ADD COLUMN     "dataThrough" DATE,
ADD COLUMN     "erraticPct" DOUBLE PRECISION,
ADD COLUMN     "longRunPct" DOUBLE PRECISION,
ADD COLUMN     "peerStationIds" JSONB,
ADD COLUMN     "rank" INTEGER,
ADD COLUMN     "rankedCount" INTEGER,
ADD COLUMN     "residualPct" DOUBLE PRECISION,
ADD COLUMN     "scoreVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "tier" "ScoreTier",
ADD COLUMN     "vs2019Pct" DOUBLE PRECISION,
ADD COLUMN     "weekdayAvg" DOUBLE PRECISION,
ADD COLUMN     "weekendAvg" DOUBLE PRECISION,
ADD COLUMN     "yoyChangePct" DOUBLE PRECISION,
ADD COLUMN     "yoyPct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "StationNarrative" ADD COLUMN     "dataThrough" DATE;

-- Hand-edited: correct four CTA station ids before "Station_cityId_ctaStationId_key" exists.
-- Each update is guarded on the known wrong value, so it does nothing on a database without them.
-- Western (Blue, O'Hare branch) and Western (Orange) hold each other's ids; swap them in one statement.
UPDATE "Station"
SET "ctaStationId" = CASE "ctaStationId" WHEN '40310' THEN '40670' ELSE '40310' END
WHERE ("externalId", "ctaStationId") IN (('40670', '40310'), ('40310', '40670'));

-- Washington (Blue) carries 40500, the retired Washington/State id.
UPDATE "Station" SET "ctaStationId" = '40370' WHERE "externalId" = '40370' AND "ctaStationId" = '40500';

-- Jefferson Park Transit Center has no CTA id.
UPDATE "Station" SET "ctaStationId" = '41280' WHERE "externalId" = '41280' AND "ctaStationId" IS NULL;

-- CreateTable
CREATE TABLE "StationClosure" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "reason" TEXT NOT NULL,

    CONSTRAINT "StationClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationLineSequence" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "StationLineSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncRunStatus" NOT NULL,
    "lease" TEXT,
    "windowStart" DATE,
    "windowEnd" DATE,
    "upstreamMaxDate" DATE,
    "rowsFetched" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsRevised" INTEGER NOT NULL DEFAULT 0,
    "unmatchedStationIds" JSONB NOT NULL DEFAULT '[]',
    "driftMonths" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StationClosure_stationId_startDate_key" ON "StationClosure"("stationId", "startDate");

-- CreateIndex
CREATE INDEX "StationLineSequence_stationId_idx" ON "StationLineSequence"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "StationLineSequence_line_branch_seq_key" ON "StationLineSequence"("line", "branch", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRun_lease_key" ON "SyncRun"("lease");

-- CreateIndex
CREATE INDEX "SyncRun_status_startedAt_idx" ON "SyncRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "RidershipDaily_serviceDate_idx" ON "RidershipDaily"("serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Station_cityId_ctaStationId_key" ON "Station"("cityId", "ctaStationId");

-- CreateIndex
CREATE UNIQUE INDEX "Station_cityId_slug_key" ON "Station"("cityId", "slug");

-- AddForeignKey
ALTER TABLE "RidershipDaily" ADD CONSTRAINT "RidershipDaily_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationClosure" ADD CONSTRAINT "StationClosure_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationLineSequence" ADD CONSTRAINT "StationLineSequence_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

