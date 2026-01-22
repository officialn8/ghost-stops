-- AlterTable
ALTER TABLE "Station" ADD COLUMN "ctaStationId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StationMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "lastDayEntries" INTEGER,
    "rolling30dAvg" REAL,
    "rolling90dAvg" REAL,
    "ghostScore" INTEGER NOT NULL,
    "lastUpdated" DATETIME NOT NULL,
    "serviceDateMax" DATETIME NOT NULL,
    "dataStatus" TEXT NOT NULL DEFAULT 'normal',
    CONSTRAINT "StationMetrics_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StationMetrics" ("ghostScore", "id", "lastDayEntries", "lastUpdated", "rolling30dAvg", "rolling90dAvg", "serviceDateMax", "stationId") SELECT "ghostScore", "id", "lastDayEntries", "lastUpdated", "rolling30dAvg", "rolling90dAvg", "serviceDateMax", "stationId" FROM "StationMetrics";
DROP TABLE "StationMetrics";
ALTER TABLE "new_StationMetrics" RENAME TO "StationMetrics";
CREATE UNIQUE INDEX "StationMetrics_stationId_key" ON "StationMetrics"("stationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Station_cityId_ctaStationId_idx" ON "Station"("cityId", "ctaStationId");
