/**
 * CTA's static GTFS, read for the rail schedule only (R16, R18; KTD6).
 *
 * The feed is one 69 MB zip, bus-dominated: `stop_times.txt` alone is 367 MB uncompressed. The
 * extractor opens exactly the six named entries, streams each through a byte cap (the zip's own
 * declared sizes are untrusted), keeps only the eight rail routes' trips, and resolves every
 * platform (3xxxx) to its parent station (4xxxx) and the parent to the roster's CTA id, aborting
 * with the list of parents it cannot map. What comes out, `RailSchedule`, is small enough to
 * archive per feed version: the trips with their stop times, the calendar, and the exceptions.
 * The service-day arithmetic over it lives in ./schedule.ts.
 *
 * Downloads go over https only, with a size cap, to a file in the worker's data directory; a
 * version is the SHA-256 of the bytes, never the server's ETag.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import yauzl from "yauzl";
import { parseGtfsTime } from "./serviceDay";
import type { TrainRoute } from "./trainTracker";

export const GTFS_URL = "https://www.transitchicago.com/downloads/sch_data/google_transit.zip";

export const GTFS_ENTRIES = ["routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt"] as const;
export type GtfsEntry = (typeof GTFS_ENTRIES)[number];

const MB = 1024 * 1024;

/** Uncompressed bytes allowed per entry; the real feed's stop_times is 367 MB. */
export const ENTRY_BYTE_CAPS: Readonly<Record<GtfsEntry, number>> = {
    "routes.txt": 4 * MB,
    "trips.txt": 128 * MB,
    "stops.txt": 64 * MB,
    "stop_times.txt": 1536 * MB,
    "calendar.txt": 4 * MB,
    "calendar_dates.txt": 4 * MB,
};

/** The zip itself; the real feed is about 69 MB. */
export const FEED_BYTE_CAP = 256 * MB;

/** GTFS `route_id` to the Train Tracker route id. */
export const GTFS_RAIL_ROUTES: Readonly<Record<string, TrainRoute>> = {
    Red: "red",
    Blue: "blue",
    Brn: "brn",
    G: "g",
    Org: "org",
    P: "p",
    Pink: "pink",
    Y: "y",
};

export type GtfsFailure = "missing-entry" | "oversize" | "no-rail" | "unmapped" | "download" | "malformed";

export class GtfsError extends Error {
    override name = "GtfsError";
    constructor(
        readonly kind: GtfsFailure,
        message: string,
    ) {
        super(message);
    }
}

/** Where the entries come from: the downloaded zip, or a directory of the same files in tests. */
export interface EntrySource {
    /** A stream of the entry's bytes, or null when the entry is absent. */
    open(name: GtfsEntry): Promise<Readable | null>;
    close(): Promise<void>;
}

export async function zipEntrySource(zipPath: string): Promise<EntrySource> {
    const zipfile = await yauzl.openPromise(zipPath, { lazyEntries: true, autoClose: false });
    const entries = new Map<string, yauzl.Entry>();
    await new Promise<void>((resolve, reject) => {
        zipfile.on("entry", (entry: yauzl.Entry) => {
            entries.set(entry.fileName, entry);
            zipfile.readEntry();
        });
        zipfile.once("end", resolve);
        zipfile.once("error", reject);
        zipfile.readEntry();
    });
    return {
        async open(name) {
            const entry = entries.get(name);
            return entry ? zipfile.openReadStreamPromise(entry) : null;
        },
        async close() {
            zipfile.close();
        },
    };
}

export function directoryEntrySource(dir: string): EntrySource {
    return {
        async open(name) {
            const file = path.join(dir, name);
            return fs.existsSync(file) ? fs.createReadStream(file) : null;
        },
        async close() {},
    };
}

/** Passes bytes through until the cap, then fails the stream; `onChunk` sees every byte passed. */
function byteCap(label: string, cap: number, onChunk?: (chunk: Buffer) => void): Transform {
    let total = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            total += chunk.byteLength;
            if (total > cap) return callback(new GtfsError("oversize", `${label} runs past ${cap} bytes`));
            onChunk?.(chunk);
            callback(null, chunk);
        },
    });
}

export type CsvRow = Record<string, string>;

/** The rows of one entry, streamed under its byte cap; a missing entry is an error. */
export async function* readEntryRows(source: EntrySource, entry: GtfsEntry, caps: Readonly<Record<GtfsEntry, number>> = ENTRY_BYTE_CAPS): AsyncGenerator<CsvRow> {
    const stream = await source.open(entry);
    if (stream === null) throw new GtfsError("missing-entry", `the feed has no ${entry}`);
    const parser = parse({ bom: true, columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
    const capped = byteCap(entry, caps[entry]);
    // Errors on the source or the cap end the parser, so the loop below sees them.
    const piping = pipeline(stream, capped, parser).catch((error: unknown) => {
        parser.destroy(error instanceof Error ? error : new GtfsError("malformed", `${entry} could not be read`));
    });
    try {
        for await (const row of parser as AsyncIterable<CsvRow>) yield row;
    } finally {
        await piping;
    }
}

/** A trip's stop: the platform, the seconds past noon-minus-twelve, and whether riders may board. */
export type TripStop = [stopId: string, seconds: number, pickupType: number];

export interface RailTrip {
    id: string;
    route: TrainRoute;
    service: string;
    /** GTFS `direction_id`, "0" or "1"; several routes use only one. */
    direction: string;
    /** In stop-sequence order; the last stop is the terminal arrival. */
    stops: TripStop[];
}

export interface ServiceCalendar {
    /** Monday first, as GTFS lists them. */
    days: [number, number, number, number, number, number, number];
    start: string;
    end: string;
}

export interface ServiceException {
    service: string;
    date: string;
    /** 1 added, 2 removed. */
    type: 1 | 2;
}

/** The format stamp on an archived schedule; `loadSchedule` (./scheduleArchive.ts) refuses any other. */
export const RAIL_SCHEDULE_VERSION = 1;

/** Everything a day's scheduled stops need, extracted from one feed version (KTD6). */
export interface RailSchedule {
    version: typeof RAIL_SCHEDULE_VERSION;
    /** SHA-256 of the zip bytes, the version's name. */
    hash: string;
    bytes: number;
    /** The server's Last-Modified, as it sent it. */
    lastModified: string | null;
    extractedAt: string;
    /** Platform id (3xxxx) to the roster's CTA station id (4xxxx). */
    platforms: Record<string, string>;
    services: Record<string, ServiceCalendar>;
    exceptions: ServiceException[];
    trips: RailTrip[];
    /** The latest stop time in any trip, seconds past noon-minus-twelve; decides the day's close. */
    latestStopSeconds: number;
}

export interface ExtractOptions {
    /** The roster's CTA station ids; a GTFS parent outside it aborts the extract. */
    rosterIds: ReadonlySet<string>;
    caps?: Readonly<Record<GtfsEntry, number>>;
    hash?: string;
    bytes?: number;
    lastModified?: string | null;
    now?: () => Date;
}

const gtfsDate = (value: string): string => {
    if (!/^\d{8}$/.test(value)) throw new GtfsError("malformed", `not a GTFS date: "${value}"`);
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

function need(row: CsvRow, field: string, entry: GtfsEntry): string {
    const value = row[field];
    if (value === undefined) throw new GtfsError("malformed", `${entry} has no ${field} column`);
    return value;
}

/** Reads the rail schedule out of a feed; see the module comment for what it keeps. */
export async function extractRailSchedule(source: EntrySource, options: ExtractOptions): Promise<RailSchedule> {
    const caps = options.caps ?? ENTRY_BYTE_CAPS;

    // routes.txt: the rail routes present, by GTFS id.
    const railRoutes = new Map<string, TrainRoute>();
    for await (const row of readEntryRows(source, "routes.txt", caps)) {
        const id = need(row, "route_id", "routes.txt");
        const route = GTFS_RAIL_ROUTES[id];
        if (route !== undefined && need(row, "route_type", "routes.txt") === "1") railRoutes.set(id, route);
    }
    if (railRoutes.size === 0) throw new GtfsError("no-rail", "the feed lists no rail route");

    // trips.txt: the rail trips, with their service and direction.
    const trips = new Map<string, RailTrip>();
    for await (const row of readEntryRows(source, "trips.txt", caps)) {
        const route = railRoutes.get(need(row, "route_id", "trips.txt"));
        if (route === undefined) continue;
        trips.set(need(row, "trip_id", "trips.txt"), {
            id: row.trip_id,
            route,
            service: need(row, "service_id", "trips.txt"),
            direction: need(row, "direction_id", "trips.txt"),
            stops: [],
        });
    }
    if (trips.size === 0) throw new GtfsError("no-rail", "the feed lists no rail trip");

    // stops.txt: platforms to parents, parents to the roster.
    const parentOf = new Map<string, string>();
    const parents = new Set<string>();
    for await (const row of readEntryRows(source, "stops.txt", caps)) {
        const id = need(row, "stop_id", "stops.txt");
        const locationType = row.location_type ?? "0";
        if (locationType === "1") parents.add(id);
        else if (locationType === "0" && row.parent_station) parentOf.set(id, row.parent_station);
    }

    // stop_times.txt: the rail trips' stops, in sequence order.
    const stopsByTrip = new Map<string, { sequence: number; stop: TripStop }[]>();
    for await (const row of readEntryRows(source, "stop_times.txt", caps)) {
        const trip = trips.get(need(row, "trip_id", "stop_times.txt"));
        if (trip === undefined) continue;
        const stopId = need(row, "stop_id", "stop_times.txt");
        const time = row.arrival_time || row.departure_time;
        if (!time) throw new GtfsError("malformed", `stop_times.txt row for trip ${trip.id} has no time`);
        const list = stopsByTrip.get(trip.id) ?? [];
        list.push({
            sequence: Number(need(row, "stop_sequence", "stop_times.txt")),
            stop: [stopId, parseGtfsTime(time), Number(row.pickup_type || "0")],
        });
        stopsByTrip.set(trip.id, list);
    }

    // Every platform a rail trip stops at must map to a roster station.
    const platforms: Record<string, string> = {};
    const unmapped = new Set<string>();
    let latestStopSeconds = 0;
    for (const trip of trips.values()) {
        const list = stopsByTrip.get(trip.id);
        if (!list) continue;
        list.sort((a, b) => a.sequence - b.sequence);
        trip.stops = list.map((s) => s.stop);
        for (const [stopId, seconds] of trip.stops) {
            latestStopSeconds = Math.max(latestStopSeconds, seconds);
            const parent = parentOf.get(stopId) ?? (parents.has(stopId) ? stopId : undefined);
            if (parent === undefined || !options.rosterIds.has(parent)) {
                unmapped.add(parent ?? `platform ${stopId}`);
                continue;
            }
            platforms[stopId] = parent;
        }
    }
    if (unmapped.size > 0) {
        throw new GtfsError("unmapped", `GTFS parents with no roster station: ${[...unmapped].sort().join(", ")}`);
    }
    const railTrips = [...trips.values()].filter((t) => t.stops.length > 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (railTrips.length === 0) throw new GtfsError("no-rail", "no rail trip has stop times");

    // calendar.txt and calendar_dates.txt, for the services the rail trips use.
    const used = new Set(railTrips.map((t) => t.service));
    const services: Record<string, ServiceCalendar> = {};
    for await (const row of readEntryRows(source, "calendar.txt", caps)) {
        const id = need(row, "service_id", "calendar.txt");
        if (!used.has(id)) continue;
        const day = (name: string) => (need(row, name, "calendar.txt") === "1" ? 1 : 0);
        services[id] = {
            days: [day("monday"), day("tuesday"), day("wednesday"), day("thursday"), day("friday"), day("saturday"), day("sunday")],
            start: gtfsDate(need(row, "start_date", "calendar.txt")),
            end: gtfsDate(need(row, "end_date", "calendar.txt")),
        };
    }
    const exceptions: ServiceException[] = [];
    for await (const row of readEntryRows(source, "calendar_dates.txt", caps)) {
        const id = need(row, "service_id", "calendar_dates.txt");
        if (!used.has(id)) continue;
        const type = need(row, "exception_type", "calendar_dates.txt");
        if (type !== "1" && type !== "2") throw new GtfsError("malformed", `calendar_dates.txt exception_type "${type}"`);
        exceptions.push({ service: id, date: gtfsDate(need(row, "date", "calendar_dates.txt")), type: type === "1" ? 1 : 2 });
    }
    exceptions.sort((a, b) => (a.date === b.date ? (a.service < b.service ? -1 : 1) : a.date < b.date ? -1 : 1));

    return {
        version: RAIL_SCHEDULE_VERSION,
        hash: options.hash ?? "",
        bytes: options.bytes ?? 0,
        lastModified: options.lastModified ?? null,
        extractedAt: (options.now ?? (() => new Date()))().toISOString(),
        platforms: Object.fromEntries(Object.entries(platforms).sort(([a], [b]) => (a < b ? -1 : 1))),
        services,
        exceptions,
        trips: railTrips,
        latestStopSeconds,
    };
}

/** The subset of `fetch` the downloader uses. */
export type FeedFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "manual" }) => Promise<Response>;

export interface FeedDownloadOptions {
    /** The file the zip is written to; replaced whole. */
    toFile: string;
    fetch?: FeedFetch;
    url?: string;
    /** From the newest archived version, so an unchanged feed answers 304 and costs nothing. */
    ifModifiedSince?: string | null;
    maxBytes?: number;
    timeoutMs?: number;
}

export type FeedDownload =
    | { status: "unchanged" }
    | { status: "downloaded"; file: string; bytes: number; hash: string; lastModified: string | null };

/**
 * Downloads the feed over https, refusing any redirect off https, writing it to disk under a byte
 * cap and hashing the bytes. A 304 to the conditional request is "unchanged".
 */
export async function downloadFeed(options: FeedDownloadOptions): Promise<FeedDownload> {
    const http: FeedFetch = options.fetch ?? ((url, init) => fetch(url, init));
    const maxBytes = options.maxBytes ?? FEED_BYTE_CAP;
    let url = options.url ?? GTFS_URL;
    const headers: Record<string, string> = { Accept: "application/zip,application/octet-stream,*/*" };
    if (options.ifModifiedSince) headers["If-Modified-Since"] = options.ifModifiedSince;

    let response: Response;
    for (let hops = 0; ; hops++) {
        if (!url.startsWith("https://")) throw new GtfsError("download", "the feed URL is not https");
        try {
            response = await http(url, { headers, signal: AbortSignal.timeout(options.timeoutMs ?? 300_000), redirect: "manual" });
        } catch {
            throw new GtfsError("download", "the feed could not be fetched: network error or timeout");
        }
        if (response.status === 304) return { status: "unchanged" };
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location || hops >= 3) throw new GtfsError("download", `the feed redirected without a usable location (HTTP ${response.status})`);
            url = new URL(location, url).toString();
            continue;
        }
        break;
    }
    if (!response.ok) throw new GtfsError("download", `the feed answered HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new GtfsError("oversize", `the feed declares ${declared} bytes, over the ${maxBytes} byte cap`);

    fs.mkdirSync(path.dirname(options.toFile), { recursive: true });
    const temp = `${options.toFile}.part`;
    const hash = createHash("sha256");
    let total = 0;
    const counting = byteCap("the feed", maxBytes, (chunk) => {
        total += chunk.byteLength;
        hash.update(chunk);
    });
    try {
        if (response.body === null) throw new GtfsError("download", "the feed answered with no body");
        await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), counting, fs.createWriteStream(temp));
    } catch (error) {
        fs.rmSync(temp, { force: true });
        if (error instanceof GtfsError) throw error;
        throw new GtfsError("download", "the feed download was cut off");
    }
    fs.renameSync(temp, options.toFile);
    return { status: "downloaded", file: options.toFile, bytes: total, hash: hash.digest("hex"), lastModified: response.headers.get("last-modified") };
}
