#!/usr/bin/env tsx

/**
 * Cuts the GTFS rail-slice fixture out of a full CTA feed (live Ghost score plan U3): the six
 * entries the extractor reads, trimmed to the eight rail routes and a few trips each, plus one bus
 * route, trip, and stop so the tests can prove what the extractor drops. The slice is written as
 * the six text files; `src/lib/live/__fixtures__/README.md` says how the zip beside them is made.
 *
 *   npx tsx scripts/cut-gtfs-slice.ts --feed /path/to/google_transit.zip --out src/lib/live/__fixtures__/gtfs-rail-slice
 *
 * Trips kept per rail route and direction: on the weekday service the earliest trip, the trip
 * nearest 08:00, and the latest-ending trip (past 24:00 where the route runs that late); on the
 * Saturday and Sunday services the trip nearest 08:00. Every stop time of a kept trip is kept.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { GTFS_RAIL_ROUTES, readEntryRows, zipEntrySource, type CsvRow, type GtfsEntry } from "../src/lib/live/gtfs";
import { parseGtfsTime } from "../src/lib/live/serviceDay";
import { isCliEntry } from "./cli";

export const SLICE_SERVICES = { weekday: "109201", saturday: "109206", sunday: "109209" } as const;
const TARGET_SECONDS = 8 * 3600;

function csvLine(columns: string[], row: CsvRow): string {
    return columns.map((c) => (row[c] ?? "").includes(",") || (row[c] ?? "").includes('"') ? `"${(row[c] ?? "").replace(/"/g, '""')}"` : (row[c] ?? "")).join(",");
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: { feed: { type: "string" }, out: { type: "string", default: "src/lib/live/__fixtures__/gtfs-rail-slice" } },
        strict: true,
    });
    if (!values.feed) throw new Error("--feed <google_transit.zip> is required");
    const source = await zipEntrySource(values.feed);
    const out = values.out;
    fs.mkdirSync(out, { recursive: true });

    const columns: Partial<Record<GtfsEntry, string[]>> = {};
    const kept: Record<GtfsEntry, CsvRow[]> = {
        "routes.txt": [],
        "trips.txt": [],
        "stops.txt": [],
        "stop_times.txt": [],
        "calendar.txt": [],
        "calendar_dates.txt": [],
    };
    const remember = (entry: GtfsEntry, row: CsvRow) => {
        columns[entry] ??= Object.keys(row);
        kept[entry].push(row);
    };

    // Routes: the eight rail routes and the first bus route.
    let busRoute: string | null = null;
    for await (const row of readEntryRows(source, "routes.txt")) {
        if (GTFS_RAIL_ROUTES[row.route_id] && row.route_type === "1") remember("routes.txt", row);
        else if (busRoute === null && row.route_type === "3") {
            busRoute = row.route_id;
            remember("routes.txt", row);
        }
    }

    // Trips: every rail trip on the three services, grouped; one bus trip.
    const candidates = new Map<string, CsvRow[]>();
    let busTrip: string | null = null;
    for await (const row of readEntryRows(source, "trips.txt")) {
        if (GTFS_RAIL_ROUTES[row.route_id] && Object.values(SLICE_SERVICES).includes(row.service_id as never)) {
            const key = `${row.route_id}|${row.service_id}|${row.direction_id}`;
            candidates.set(key, [...(candidates.get(key) ?? []), row]);
        } else if (busTrip === null && row.route_id === busRoute) {
            busTrip = row.trip_id;
            remember("trips.txt", row);
        }
    }
    const candidateIds = new Set([...candidates.values()].flat().map((t) => t.trip_id));

    // Stop times of the candidates (and the bus trip's first three), streamed once.
    const times = new Map<string, { first: number; last: number }>();
    const stopTimes = new Map<string, CsvRow[]>();
    let busRows = 0;
    for await (const row of readEntryRows(source, "stop_times.txt")) {
        if (candidateIds.has(row.trip_id)) {
            const seconds = parseGtfsTime(row.arrival_time || row.departure_time);
            const t = times.get(row.trip_id) ?? { first: Infinity, last: -Infinity };
            times.set(row.trip_id, { first: Math.min(t.first, seconds), last: Math.max(t.last, seconds) });
            stopTimes.set(row.trip_id, [...(stopTimes.get(row.trip_id) ?? []), row]);
        } else if (row.trip_id === busTrip && busRows < 3) {
            busRows += 1;
            remember("stop_times.txt", row);
        }
    }

    // Pick the trips.
    const picked: CsvRow[] = [];
    for (const [key, trips] of [...candidates.entries()].sort()) {
        const [, service] = key.split("|");
        const withTimes = trips.filter((t) => times.has(t.trip_id)).sort((a, b) => times.get(a.trip_id)!.first - times.get(b.trip_id)!.first);
        if (withTimes.length === 0) continue;
        const nearest = withTimes.reduce((best, t) =>
            Math.abs(times.get(t.trip_id)!.first - TARGET_SECONDS) < Math.abs(times.get(best.trip_id)!.first - TARGET_SECONDS) ? t : best,
        );
        const picks = service === SLICE_SERVICES.weekday
            ? [withTimes[0], nearest, withTimes.reduce((best, t) => (times.get(t.trip_id)!.last > times.get(best.trip_id)!.last ? t : best))]
            : [nearest];
        for (const trip of picks) if (!picked.includes(trip)) picked.push(trip);
    }
    for (const trip of picked) {
        remember("trips.txt", trip);
        for (const row of stopTimes.get(trip.trip_id) ?? []) remember("stop_times.txt", row);
    }

    // Stops: every rail platform and parent, plus the bus trip's stops.
    const busStops = new Set(kept["stop_times.txt"].filter((r) => r.trip_id === busTrip).map((r) => r.stop_id));
    for await (const row of readEntryRows(source, "stops.txt")) {
        const id = Number(row.stop_id);
        if ((id >= 30000 && id < 50000) || busStops.has(row.stop_id)) remember("stops.txt", row);
    }

    // Calendar rows and exceptions for the services kept.
    const services = new Set(kept["trips.txt"].map((t) => t.service_id));
    for await (const row of readEntryRows(source, "calendar.txt")) if (services.has(row.service_id)) remember("calendar.txt", row);
    for await (const row of readEntryRows(source, "calendar_dates.txt")) if (services.has(row.service_id)) remember("calendar_dates.txt", row);
    await source.close();

    for (const entry of Object.keys(kept) as GtfsEntry[]) {
        const cols = columns[entry];
        if (!cols) throw new Error(`nothing kept from ${entry}`);
        const text = [cols.join(","), ...kept[entry].map((row) => csvLine(cols, row))].join("\n") + "\n";
        fs.writeFileSync(path.join(out, entry), text);
        console.log(`${entry}: ${kept[entry].length} rows`);
    }
}

if (isCliEntry(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
