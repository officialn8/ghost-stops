/**
 * The schedule archive on the object store (KTD6): each feed version the worker has seen, as
 * `schedules/<hash>.json.gz`, and an index of when each was first and last seen. A day's schedule
 * is the newest version first seen before that day closed, and a feed published later never
 * changes a closed day (R16).
 */
import fs from "node:fs";
import { downloadFeed, extractRailSchedule, zipEntrySource, GtfsError, RAIL_SCHEDULE_VERSION, type EntrySource, type FeedDownload, type FeedFetch, type RailSchedule } from "./gtfs";
import { gunzipJson, gzipJson, type ObjectStore } from "./objectStore";

export const SCHEDULE_PREFIX = "schedules";
export const SCHEDULE_INDEX_KEY = `${SCHEDULE_PREFIX}/index.json`;

export interface ScheduleVersion {
    hash: string;
    bytes: number;
    lastModified: string | null;
    /** ISO instants: when the worker first and last saw the feed answer with these bytes. */
    firstSeen: string;
    lastSeen: string;
    latestStopSeconds: number;
    trips: number;
}

/** The format stamp on the index; `readScheduleIndex` refuses any other. */
export const SCHEDULE_INDEX_VERSION = 1;

export interface ScheduleIndex {
    version: typeof SCHEDULE_INDEX_VERSION;
    /** Oldest first. */
    versions: ScheduleVersion[];
}

export const scheduleKey = (hash: string) => `${SCHEDULE_PREFIX}/${hash}.json.gz`;

/**
 * Refuses an object stamped with a format this build does not read, naming its key. Without the
 * check, a worker rolled back past a format change would read the newer object as its own shape
 * and could write it back damaged.
 */
function assertStamp(key: string, found: unknown, expected: number): void {
    if (found !== expected) throw new Error(`${key} is stamped version ${String(found)}; this build reads version ${expected}`);
}

export async function readScheduleIndex(store: ObjectStore): Promise<ScheduleIndex> {
    const object = await store.get(SCHEDULE_INDEX_KEY);
    if (object === null) return { version: SCHEDULE_INDEX_VERSION, versions: [] };
    const index = JSON.parse(object.body.toString("utf8")) as ScheduleIndex;
    assertStamp(SCHEDULE_INDEX_KEY, index.version, SCHEDULE_INDEX_VERSION);
    return index;
}

export async function writeScheduleIndex(store: ObjectStore, index: ScheduleIndex): Promise<void> {
    await store.put(SCHEDULE_INDEX_KEY, Buffer.from(JSON.stringify(index, null, 2), "utf8"), { contentType: "application/json" });
}

/** The newest archived version first seen at or before `epochMs`; null before the first. */
export function versionInForce(index: ScheduleIndex, epochMs: number): ScheduleVersion | null {
    return index.versions.findLast((version) => Date.parse(version.firstSeen) <= epochMs) ?? null;
}

export async function archiveSchedule(store: ObjectStore, schedule: RailSchedule): Promise<void> {
    await store.put(scheduleKey(schedule.hash), gzipJson(schedule, 9), { contentType: "application/gzip" });
}

export async function loadSchedule(store: ObjectStore, hash: string): Promise<RailSchedule | null> {
    const key = scheduleKey(hash);
    const object = await store.get(key);
    if (object === null) return null;
    const schedule = gunzipJson<RailSchedule>(object.body);
    assertStamp(key, schedule.version, RAIL_SCHEDULE_VERSION);
    return schedule;
}

export interface RefreshOptions {
    store: ObjectStore;
    /** Where the zip is downloaded to, on local disk. */
    feedFile: string;
    rosterIds: ReadonlySet<string>;
    fetch?: FeedFetch;
    url?: string;
    now?: () => Date;
    log?: (message: string) => void;
}

export type RefreshResult =
    | { status: "unchanged"; version: ScheduleVersion }
    | { status: "archived"; version: ScheduleVersion; schedule: RailSchedule }
    | { status: "failed"; reason: string; version: ScheduleVersion | null };

/**
 * The daily feed check: a conditional download, versioned by the hash of the bytes; a new
 * version is extracted and archived, and the index records when each was first and last seen.
 * A failed download or extract keeps the previous version in force and is reported, never thrown.
 */
export async function refreshSchedule(options: RefreshOptions): Promise<RefreshResult> {
    const now = options.now ?? (() => new Date());
    const log = options.log ?? (() => {});
    const index = await readScheduleIndex(options.store);
    const newest = index.versions.at(-1) ?? null;
    let download: FeedDownload;
    try {
        download = await downloadFeed({ toFile: options.feedFile, fetch: options.fetch, url: options.url, ifModifiedSince: newest?.lastModified ?? null });
    } catch (error) {
        const reason = error instanceof GtfsError ? `${error.kind}: ${error.message}` : "download failed";
        log(`schedule check failed, previous version stays in force: ${reason}`);
        return { status: "failed", reason, version: newest };
    }
    const seenAt = now().toISOString();
    if (download.status === "unchanged" || (newest !== null && download.hash === newest.hash)) {
        if (newest === null) return { status: "failed", reason: "the feed answered 304 before any version was archived", version: null };
        newest.lastSeen = seenAt;
        await writeScheduleIndex(options.store, index);
        return { status: "unchanged", version: newest };
    }

    let schedule: RailSchedule;
    let source: EntrySource | null = null;
    try {
        source = await zipEntrySource(download.file);
        schedule = await extractRailSchedule(source, {
            rosterIds: options.rosterIds,
            hash: download.hash,
            bytes: download.bytes,
            lastModified: download.lastModified,
            now,
        });
    } catch (error) {
        const reason = error instanceof GtfsError ? `${error.kind}: ${error.message}` : "extract failed: the feed is not a readable zip";
        log(`schedule extract failed, previous version stays in force: ${reason}`);
        return { status: "failed", reason, version: newest };
    } finally {
        await source?.close();
        fs.rmSync(download.file, { force: true });
    }
    await archiveSchedule(options.store, schedule);
    const version: ScheduleVersion = {
        hash: schedule.hash,
        bytes: schedule.bytes,
        lastModified: schedule.lastModified,
        firstSeen: seenAt,
        lastSeen: seenAt,
        latestStopSeconds: schedule.latestStopSeconds,
        trips: schedule.trips.length,
    };
    index.versions.push(version);
    await writeScheduleIndex(options.store, index);
    log(`schedule version ${schedule.hash.slice(0, 12)} archived: ${schedule.trips.length} trips, latest stop ${schedule.latestStopSeconds} s`);
    return { status: "archived", version, schedule };
}
