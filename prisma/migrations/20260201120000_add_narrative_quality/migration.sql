-- AlterTable
ALTER TABLE "DataSource" ADD COLUMN "lastSuccessfulFetch" DATETIME;
ALTER TABLE "DataSource" ADD COLUMN "lastError" TEXT;
ALTER TABLE "DataSource" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "StationFact" ADD COLUMN "quality" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "StationFact" ADD COLUMN "qualityNote" TEXT;
ALTER TABLE "StationFact" ADD COLUMN "evidenceMeta" JSON;

-- AlterTable
ALTER TABLE "StationNarrative" ADD COLUMN "quality" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "StationNarrative" ADD COLUMN "qualityNote" TEXT;
ALTER TABLE "StationNarrative" ADD COLUMN "evidenceMeta" JSON;
