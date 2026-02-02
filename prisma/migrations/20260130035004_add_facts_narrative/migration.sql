-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "apiUrl" TEXT,
    "datasetId" TEXT,
    "license" TEXT,
    "lastFetched" DATETIME,
    "refreshCadence" TEXT
);

-- CreateTable
CREATE TABLE "StationFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "valueType" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "geography" TEXT NOT NULL,
    "timeframeStart" INTEGER,
    "timeframeEnd" INTEGER,
    "methodology" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNote" TEXT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StationFact_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StationFact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StationNarrative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "archetypeKey" TEXT NOT NULL,
    "renderedStory" TEXT NOT NULL,
    "evidenceFactKeys" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "lastComputed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StationNarrative_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_code_key" ON "DataSource"("code");

-- CreateIndex
CREATE INDEX "StationFact_stationId_idx" ON "StationFact"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "StationFact_stationId_factKey_key" ON "StationFact"("stationId", "factKey");

-- CreateIndex
CREATE UNIQUE INDEX "StationNarrative_stationId_key" ON "StationNarrative"("stationId");
