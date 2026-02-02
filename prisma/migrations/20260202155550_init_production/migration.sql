-- CreateEnum
CREATE TYPE "DataQuality" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('ACTIVE', 'ERROR', 'DEPRECATED');

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "externalId" TEXT,
    "ctaStationId" TEXT,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "lines" TEXT NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationAlias" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "aliasName" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "StationAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RidershipDaily" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "entries" INTEGER NOT NULL,

    CONSTRAINT "RidershipDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationMetrics" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "lastDayEntries" INTEGER,
    "rolling30dAvg" DOUBLE PRECISION,
    "rolling90dAvg" DOUBLE PRECISION,
    "ghostScore" INTEGER NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "serviceDateMax" TIMESTAMP(3) NOT NULL,
    "dataStatus" TEXT NOT NULL DEFAULT 'normal',

    CONSTRAINT "StationMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "apiUrl" TEXT,
    "datasetId" TEXT,
    "license" TEXT,
    "lastFetched" TIMESTAMP(3),
    "lastSuccessfulFetch" TIMESTAMP(3),
    "lastError" TEXT,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "refreshCadence" TEXT,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationFact" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "valueType" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "geography" TEXT NOT NULL,
    "timeframeStart" INTEGER,
    "timeframeEnd" INTEGER,
    "methodology" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNote" TEXT,
    "quality" "DataQuality" NOT NULL DEFAULT 'UNKNOWN',
    "qualityNote" TEXT,
    "evidenceMeta" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationNarrative" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "archetypeKey" TEXT NOT NULL,
    "renderedStory" TEXT NOT NULL,
    "evidenceFactKeys" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "quality" "DataQuality" NOT NULL DEFAULT 'UNKNOWN',
    "qualityNote" TEXT,
    "evidenceMeta" JSONB,
    "lastComputed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "City_code_key" ON "City"("code");

-- CreateIndex
CREATE INDEX "Station_cityId_name_idx" ON "Station"("cityId", "name");

-- CreateIndex
CREATE INDEX "Station_cityId_ctaStationId_idx" ON "Station"("cityId", "ctaStationId");

-- CreateIndex
CREATE UNIQUE INDEX "Station_cityId_externalId_key" ON "Station"("cityId", "externalId");

-- CreateIndex
CREATE INDEX "StationAlias_normalized_idx" ON "StationAlias"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "StationAlias_stationId_aliasName_key" ON "StationAlias"("stationId", "aliasName");

-- CreateIndex
CREATE INDEX "RidershipDaily_stationId_serviceDate_idx" ON "RidershipDaily"("stationId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "RidershipDaily_stationId_serviceDate_key" ON "RidershipDaily"("stationId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "StationMetrics_stationId_key" ON "StationMetrics"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_code_key" ON "DataSource"("code");

-- CreateIndex
CREATE INDEX "StationFact_stationId_idx" ON "StationFact"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "StationFact_stationId_factKey_key" ON "StationFact"("stationId", "factKey");

-- CreateIndex
CREATE UNIQUE INDEX "StationNarrative_stationId_key" ON "StationNarrative"("stationId");

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationAlias" ADD CONSTRAINT "StationAlias_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidershipDaily" ADD CONSTRAINT "RidershipDaily_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationMetrics" ADD CONSTRAINT "StationMetrics_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationFact" ADD CONSTRAINT "StationFact_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationFact" ADD CONSTRAINT "StationFact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationNarrative" ADD CONSTRAINT "StationNarrative_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
