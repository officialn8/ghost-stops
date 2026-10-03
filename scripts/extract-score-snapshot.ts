#!/usr/bin/env tsx

/**
 * Extracts the score v2 acceptance fixture (revival plan U12) from the machine-local snapshot
 * export: the daily rows the score reads when data runs through 2025-11-30, keyed by CTA
 * station id, gzip-compressed, so the oracle test can load them into any test database.
 *
 *   npx tsx scripts/extract-score-snapshot.ts \
 *     --history exports/ridership-history.csv \
 *     --stations exports/backups/2026-10-03-production/Station.csv \
 *     --out src/lib/scoring/__fixtures__/snapshot-2025-11-30.csv.gz
 *
 * Inputs (both gitignored, both on Nate's machine; see docs/runbooks/history-load.md):
 * - the history export (scripts/export-history.ts): stationId,serviceDate,entries,dayType, with
 *   stationId the production Station.id and the two Western stations already left out (KTD3);
 * - the production Station backup taken before the revival_v2 migration, which maps each
 *   Station.id to a CTA id. Its ctaStationId column predates the migration's four id fixes, so
 *   the map uses externalId, which is what the migration set ctaStationId to.
 *
 * Output: ctaStationId,serviceDate,entries,dayType, sorted by station and date, holding 2019 (the
 * long-run baseline) and 2024-08-01 to 2025-11-30 (the 12-month, trailing and year-ago 90-day,
 * and base-metric windows, with a month of margin before the year-ago window).
 */

import fs from "node:fs";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { isCliEntry } from "./cli";

export const SNAPSHOT_RANGES = [
    { start: "2019-01-01", end: "2019-12-31" },
    { start: "2024-08-01", end: "2025-11-30" },
] as const;

const HISTORY_HEADER = "stationId,serviceDate,entries,dayType";
export const FIXTURE_HEADER = "ctaStationId,serviceDate,entries,dayType";

/** Station.id to CTA id from the backup's header row and lines, using externalId (see above). */
export function ctaIdsByStationId(stationCsv: string): Map<string, string> {
    const [header, ...lines] = stationCsv.trim().split("\n");
    const columns = header.split(",");
    const idAt = columns.indexOf("id");
    const externalIdAt = columns.indexOf("externalId");
    if (idAt < 0 || externalIdAt < 0) throw new Error("Station CSV needs id and externalId columns");
    const map = new Map<string, string>();
    for (const line of lines) {
        // Only the leading columns are read, and none of them holds a quoted comma.
        const fields = line.split(",");
        const externalId = fields[externalIdAt];
        if (!/^4\d{4}$/.test(externalId)) throw new Error(`Station ${fields[idAt]} has no CTA id in externalId`);
        map.set(fields[idAt], externalId);
    }
    return map;
}

const inRange = (date: string) => SNAPSHOT_RANGES.some((r) => date >= r.start && date <= r.end);

/** The fixture CSV text for the history rows inside the snapshot ranges. */
export function extractRows(historyCsv: string, ctaIds: ReadonlyMap<string, string>): string {
    const lines = historyCsv.split("\n");
    if (lines[0].trim() !== HISTORY_HEADER) throw new Error(`Unexpected history header: ${lines[0]}`);
    const rows: [string, string, string, string][] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "") continue;
        const [stationId, serviceDate, entries, dayType] = line.split(",");
        if (!inRange(serviceDate)) continue;
        const cta = ctaIds.get(stationId);
        if (!cta) throw new Error(`History row for unknown station ${stationId}`);
        rows.push([cta, serviceDate, entries, dayType]);
    }
    rows.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
    return [FIXTURE_HEADER, ...rows.map((r) => r.join(","))].join("\n") + "\n";
}

function main(argv: string[]): void {
    const { values } = parseArgs({
        args: argv,
        options: {
            history: { type: "string", default: "exports/ridership-history.csv" },
            stations: { type: "string", default: "exports/backups/2026-10-03-production/Station.csv" },
            out: { type: "string", default: "src/lib/scoring/__fixtures__/snapshot-2025-11-30.csv.gz" },
        },
    });
    const ctaIds = ctaIdsByStationId(fs.readFileSync(values.stations, "utf8"));
    const csv = extractRows(fs.readFileSync(values.history, "utf8"), ctaIds);
    // level 9 and a zeroed header mtime (gzip's default) keep the output byte-identical across runs.
    const gz = gzipSync(Buffer.from(csv, "utf8"), { level: 9 });
    fs.writeFileSync(values.out, gz);
    const rowCount = csv.split("\n").length - 2;
    console.log(`Wrote ${rowCount} rows (${gz.length} bytes gzipped) to ${values.out}`);
}

if (isCliEntry(import.meta.url)) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
