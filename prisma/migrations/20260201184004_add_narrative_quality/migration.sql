/*
  Warnings:

  - You are about to alter the column `evidenceMeta` on the `StationFact` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.
  - You are about to alter the column `evidenceMeta` on the `StationNarrative` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StationFact" (
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
    "quality" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "qualityNote" TEXT,
    "evidenceMeta" JSONB,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StationFact_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StationFact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StationFact" ("computedAt", "evidenceMeta", "factKey", "geography", "id", "methodology", "quality", "qualityNote", "sourceId", "sourceNote", "stationId", "timeframeEnd", "timeframeStart", "unit", "value", "valueType") SELECT "computedAt", "evidenceMeta", "factKey", "geography", "id", "methodology", "quality", "qualityNote", "sourceId", "sourceNote", "stationId", "timeframeEnd", "timeframeStart", "unit", "value", "valueType" FROM "StationFact";
DROP TABLE "StationFact";
ALTER TABLE "new_StationFact" RENAME TO "StationFact";
CREATE INDEX "StationFact_stationId_idx" ON "StationFact"("stationId");
CREATE UNIQUE INDEX "StationFact_stationId_factKey_key" ON "StationFact"("stationId", "factKey");
CREATE TABLE "new_StationNarrative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "archetypeKey" TEXT NOT NULL,
    "renderedStory" TEXT NOT NULL,
    "evidenceFactKeys" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "quality" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "qualityNote" TEXT,
    "evidenceMeta" JSONB,
    "lastComputed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StationNarrative_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StationNarrative" ("archetypeKey", "confidence", "evidenceFactKeys", "evidenceMeta", "id", "lastComputed", "quality", "qualityNote", "renderedStory", "stationId", "templateVersion") SELECT "archetypeKey", "confidence", "evidenceFactKeys", "evidenceMeta", "id", "lastComputed", "quality", "qualityNote", "renderedStory", "stationId", "templateVersion" FROM "StationNarrative";
DROP TABLE "StationNarrative";
ALTER TABLE "new_StationNarrative" RENAME TO "StationNarrative";
CREATE UNIQUE INDEX "StationNarrative_stationId_key" ON "StationNarrative"("stationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
