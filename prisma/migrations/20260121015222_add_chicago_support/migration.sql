/*
  Warnings:

  - You are about to drop the `Ridership` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `cityId` to the `Station` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lines` to the `Station` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Ridership_stationId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Ridership";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StationAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "aliasName" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    CONSTRAINT "StationAlias_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RidershipDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "serviceDate" DATETIME NOT NULL,
    "entries" INTEGER NOT NULL,
    CONSTRAINT "RidershipDaily_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StationMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "lastDayEntries" INTEGER,
    "rolling30dAvg" REAL,
    "rolling90dAvg" REAL,
    "ghostScore" INTEGER NOT NULL,
    "lastUpdated" DATETIME NOT NULL,
    "serviceDateMax" DATETIME NOT NULL,
    CONSTRAINT "StationMetrics_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cityId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "lines" TEXT NOT NULL,
    CONSTRAINT "Station_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Station" ("id", "latitude", "longitude", "name") SELECT "id", "latitude", "longitude", "name" FROM "Station";
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";
CREATE INDEX "Station_cityId_name_idx" ON "Station"("cityId", "name");
CREATE UNIQUE INDEX "Station_cityId_externalId_key" ON "Station"("cityId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "City_code_key" ON "City"("code");

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
