import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FixtureStation {
    id: string;
    externalId: string | null;
    name?: string;
}

/** One `RidershipDaily` row: station id, raw serviceDate text, entries. */
export type FixtureRow = [stationId: string, serviceDate: string, entries: number];

export interface FixtureSnapshot {
    stations: FixtureStation[];
    rows: FixtureRow[];
    /**
     * The real snapshot has a unique index on (stationId, serviceDate text). Turning it off lets a
     * test insert an exact duplicate to prove the export's own distinct-count assertion fires.
     */
    uniqueStationDate?: boolean;
}

export function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Writes a SQLite file with the snapshot's `Station` and `RidershipDaily` shapes. The foreign key
 * is left off because the real snapshot holds orphan rows that a tested export must drop.
 */
export function writeFixtureSnapshot(dir: string, fixture: FixtureSnapshot): string {
    const dbPath = path.join(dir, "snapshot.db");
    const db = new DatabaseSync(dbPath);
    try {
        db.exec(`
            CREATE TABLE "Station" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "cityId" TEXT NOT NULL,
                "externalId" TEXT,
                "name" TEXT NOT NULL,
                "latitude" REAL NOT NULL,
                "longitude" REAL NOT NULL,
                "lines" TEXT NOT NULL,
                "ctaStationId" TEXT
            );
            CREATE TABLE "RidershipDaily" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "stationId" TEXT NOT NULL,
                "serviceDate" DATETIME NOT NULL,
                "entries" INTEGER NOT NULL
            );
            CREATE INDEX "RidershipDaily_stationId_serviceDate_idx" ON "RidershipDaily"("stationId", "serviceDate");
        `);
        if (fixture.uniqueStationDate !== false) {
            db.exec(
                `CREATE UNIQUE INDEX "RidershipDaily_stationId_serviceDate_key" ON "RidershipDaily"("stationId", "serviceDate");`,
            );
        }

        const insertStation = db.prepare(
            `INSERT INTO "Station" ("id", "cityId", "externalId", "name", "latitude", "longitude", "lines", "ctaStationId")
             VALUES (?, 'chicago', ?, ?, 41.88, -87.63, '["Red"]', NULL)`,
        );
        for (const station of fixture.stations) {
            insertStation.run(station.id, station.externalId, station.name ?? `Station ${station.id.slice(0, 6)}`);
        }

        const insertRow = db.prepare(
            `INSERT INTO "RidershipDaily" ("id", "stationId", "serviceDate", "entries") VALUES (?, ?, ?, ?)`,
        );
        fixture.rows.forEach(([stationId, serviceDate, entries], index) => {
            insertRow.run(`row-${index}`, stationId, serviceDate, entries);
        });
    } finally {
        db.close();
    }
    return dbPath;
}
