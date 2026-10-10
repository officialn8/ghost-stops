/**
 * The raw record and the checkpoint on the object store (R13, R14; KTD2, KTD3).
 *
 * Raw polls: one NDJSON line per call, appended to a part file on local disk as it happens, so
 * a crash loses at most the line being written. A part covers one hour of a service day; once
 * the hour, the day, or the process ends it is gzipped and uploaded by the next upload pass under
 * `raw/v1/YYYY/MM/YYYY-MM-DD/HH.<start-epoch>.ndjson.gz`, where HH is the hour's index within
 * the service day (00 at 03:00 Chicago, so key order is time order across midnight) and the
 * start epoch keeps a successor's part beside a predecessor's. At day close the parts are
 * concatenated byte for byte into `raw/v1/YYYY/MM/YYYY-MM-DD.ndjson.gz` (gzip members
 * concatenate) and deleted; compaction is a no-op when the day object already exists.
 *
 * The checkpoint, `state/checkpoint.json.gz`, is one gzip JSON envelope written every minute
 * with a conditional put, so two instances can never both believe they hold the day: an
 * unreleased checkpoint under three minutes old from another machine id means the day is held.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip, gzipSync } from "node:zlib";
import { addDays } from "@/lib/sync/window";
import { gunzipJson, gzipJson, ObjectStoreError, type ObjectStore, type PutCondition } from "./objectStore";
import { dayCloseInstant, hourIndexOf, MINUTE_MS, pad2, serviceDateOf, serviceDayStart } from "./serviceDay";
import type { RawCall } from "./trainTracker";

export const RAW_PREFIX = "raw/v1";
export const CHECKPOINT_KEY = "state/checkpoint.json.gz";
export const LEASE_HOLD_MS = 3 * 60_000;
const PART_FILE = /^(\d{4}-\d{2}-\d{2})\.(\d{2})\.(\d{13})\.ndjson$/;
const NEWLINE = 0x0a;
/** Parts fetched or deleted at once during compaction; the concatenation keeps the key order. */
const COMPACTION_CONCURRENCY = 4;

const monthPrefix = (serviceDate: string) => `${RAW_PREFIX}/${serviceDate.slice(0, 4)}/${serviceDate.slice(5, 7)}`;

/** The compacted day object's key. */
export function dayObjectKey(serviceDate: string): string {
    return `${monthPrefix(serviceDate)}/${serviceDate}.ndjson.gz`;
}

/** The prefix every part of a day sits under. */
export function dayPartsPrefix(serviceDate: string): string {
    return `${monthPrefix(serviceDate)}/${serviceDate}/`;
}

export function partKey(serviceDate: string, hourIndex: number, startEpoch: number): string {
    return `${dayPartsPrefix(serviceDate)}${pad2(hourIndex)}.${String(startEpoch).padStart(13, "0")}.ndjson.gz`;
}

/** The local file a part is appended to before upload; its name carries everything the key needs. */
export function partFileName(serviceDate: string, hourIndex: number, startEpoch: number): string {
    return `${serviceDate}.${pad2(hourIndex)}.${String(startEpoch).padStart(13, "0")}.ndjson`;
}

export function partKeyOfFile(fileName: string): string | null {
    const match = PART_FILE.exec(fileName);
    return match ? partKey(match[1], Number(match[2]), Number(match[3])) : null;
}

/** A raw line: the call as the client recorded it, nothing more (the body is already scrubbed). */
export type RawLine = RawCall;

export interface RawWriter {
    /** Appends one line to its hour's part, synchronously; a new hour or day closes the open part first. */
    append(line: RawLine): void;
    /**
     * Closes the open part, if any, so the next upload pass takes it: on shutdown, and at day close
     * with the closing day's date, which leaves an open part of the next day alone.
     */
    closeOpenPart(serviceDate?: string): void;
    /** Uploads every closed part file on disk, oldest first; returns the keys uploaded. Failed ones stay. */
    uploadPending(): Promise<string[]>;
    /** Part files on disk waiting for a successful upload, the open one excluded; one day's only when given. */
    pendingFiles(serviceDate?: string): string[];
}

export interface RawWriterOptions {
    /** The local directory the part files live in; created if absent. */
    dir: string;
    store: ObjectStore;
    log?: (message: string) => void;
}

interface OpenPart {
    serviceDate: string;
    hourIndex: number;
    startEpoch: number;
    file: string;
}

/**
 * A part file's complete lines as one buffer, up to and including the last newline; a final
 * fragment with no newline (a cut-off write) is dropped. Null when the file holds no complete line.
 */
export function readPartBody(file: string): Buffer | null {
    const bytes = fs.readFileSync(file);
    const end = bytes.lastIndexOf(NEWLINE);
    return end < 0 ? null : bytes.subarray(0, end + 1);
}

export function createRawWriter(options: RawWriterOptions): RawWriter {
    const { dir, store } = options;
    const log = options.log ?? (() => {});
    fs.mkdirSync(dir, { recursive: true });
    let open: OpenPart | null = null;

    /** Uploads one part file and removes it; the key on success, null when it stays on disk. */
    async function upload(file: string): Promise<string | null> {
        const key = partKeyOfFile(path.basename(file));
        if (key === null) return null;
        const body = readPartBody(file);
        if (body === null) {
            fs.rmSync(file, { force: true });
            return key;
        }
        try {
            await store.put(key, gzipSync(body, { level: 6 }), { contentType: "application/gzip" });
        } catch (error) {
            // The file stays for the next pass; the message carries the key and status only.
            log(`raw part not uploaded, kept on disk: ${error instanceof ObjectStoreError ? error.message : key}`);
            return null;
        }
        fs.rmSync(file, { force: true });
        return key;
    }

    function pendingFiles(serviceDate?: string): string[] {
        return fs
            .readdirSync(dir)
            .filter((name) => PART_FILE.test(name) && (serviceDate === undefined || name.startsWith(`${serviceDate}.`)))
            .map((name) => path.join(dir, name))
            .filter((file) => file !== open?.file)
            .sort();
    }

    return {
        append(line) {
            const serviceDate = serviceDateOf(line.pollEpoch);
            const hourIndex = hourIndexOf(serviceDate, line.pollEpoch);
            if (open !== null && (open.serviceDate !== serviceDate || open.hourIndex !== hourIndex)) open = null;
            if (open === null) {
                const startEpoch = line.pollEpoch;
                open = { serviceDate, hourIndex, startEpoch, file: path.join(dir, partFileName(serviceDate, hourIndex, startEpoch)) };
            }
            fs.appendFileSync(open.file, `${JSON.stringify(line)}\n`);
        },

        closeOpenPart(serviceDate) {
            if (serviceDate === undefined || open?.serviceDate === serviceDate) open = null;
        },

        async uploadPending() {
            const uploaded: string[] = [];
            for (const file of pendingFiles()) {
                const key = await upload(file);
                if (key !== null) uploaded.push(key);
            }
            return uploaded;
        },

        pendingFiles,
    };
}

/** Runs `work` over `items` a few at a time, returning the results in the items' order. */
async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await work(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}

export type CompactionResult =
    | { status: "compacted"; key: string; bytes: number; parts: number }
    | { status: "exists"; key: string; bytes: number }
    | { status: "no-parts"; key: string };

/**
 * Concatenates a day's parts, in key order, into the day object and deletes them. A day object
 * that already exists is left alone, parts and all, so a retry after a crash changes nothing.
 */
export async function compactDay(store: ObjectStore, serviceDate: string): Promise<CompactionResult> {
    const key = dayObjectKey(serviceDate);
    const existing = await store.head(key);
    if (existing !== null) return { status: "exists", key, bytes: existing.size };
    const parts = await store.list(dayPartsPrefix(serviceDate));
    if (parts.length === 0) return { status: "no-parts", key };
    const buffers = await mapConcurrent(parts, COMPACTION_CONCURRENCY, async (part) => {
        const object = await store.get(part.key);
        if (object === null) throw new ObjectStoreError("get", part.key, 404, "part vanished during compaction");
        return object.body;
    });
    const body = Buffer.concat(buffers);
    await store.put(key, body, { contentType: "application/gzip" });
    await mapConcurrent(parts, COMPACTION_CONCURRENCY, (part) => store.delete(part.key));
    return { status: "compacted", key, bytes: body.byteLength, parts: parts.length };
}

/** Every line of one or more concatenated gzip members, decoded one line at a time, never as one string. */
async function* gunzipLines(members: readonly Buffer[]): AsyncGenerator<string> {
    const source = Readable.from(members).pipe(createGunzip());
    let carry: Buffer = Buffer.alloc(0);
    for await (const chunk of source as AsyncIterable<Buffer>) {
        const data = carry.byteLength === 0 ? chunk : Buffer.concat([carry, chunk]);
        let start = 0;
        for (;;) {
            const end = data.indexOf(NEWLINE, start);
            if (end < 0) break;
            if (end > start) yield data.toString("utf8", start, end);
            start = end + 1;
        }
        carry = data.subarray(start);
    }
    if (carry.byteLength > 0) yield carry.toString("utf8");
}

/** The lines of a compacted day object, or of the parts still under its prefix when it has none. */
export async function readRawDay(store: ObjectStore, serviceDate: string): Promise<RawLine[] | null> {
    const day = await store.get(dayObjectKey(serviceDate));
    let members: Buffer[];
    if (day !== null) {
        members = [day.body];
    } else {
        const parts = await store.list(dayPartsPrefix(serviceDate));
        if (parts.length === 0) return null;
        const objects = await mapConcurrent(parts, COMPACTION_CONCURRENCY, (part) => store.get(part.key));
        members = objects.flatMap((object) => (object === null ? [] : [object.body]));
    }
    const lines: RawLine[] = [];
    for await (const line of gunzipLines(members)) lines.push(JSON.parse(line) as RawLine);
    return lines;
}

/**
 * A day's raw lines with the overlap its tracker saw (KTD5): the polls from the hour before
 * 03:00 in the day before's file, where its first slots were first posted, and the polls up to
 * the day's close instant in the day after's file, where its last trains came and went. Raw
 * lines bucket by poll time, so a replay of one file alone loses both. Null when the day itself
 * has no raw record; a neighbor that has none contributes nothing. Lines come back in poll order.
 */
export async function readRawDayWithOverlap(store: ObjectStore, serviceDate: string, toleranceMinutes: number): Promise<RawLine[] | null> {
    const day = await readRawDay(store, serviceDate);
    if (day === null) return null;
    const from = serviceDayStart(serviceDate) - 60 * MINUTE_MS;
    const until = dayCloseInstant(serviceDate, toleranceMinutes);
    // Each neighbor is read whole and cut down at once, so only one full day is held beside this one.
    const before = ((await readRawDay(store, addDays(serviceDate, -1))) ?? []).filter((line) => line.pollEpoch >= from);
    const after = ((await readRawDay(store, addDays(serviceDate, 1))) ?? []).filter((line) => line.pollEpoch < until);
    return [...before, ...day, ...after].sort((a, b) => a.pollEpoch - b.pollEpoch);
}

/** The checkpoint envelope: who wrote it, when, whether they let go, and the worker's state. */
export interface Checkpoint<T> {
    version: 1;
    /** Fly's machine id, so an in-place deploy or a crash restart keeps the same id. */
    machineId: string;
    writtenAt: number;
    /** Set by a clean shutdown, so a successor starts at once. */
    released: boolean;
    state: T;
}

export interface CheckpointRead<T> {
    checkpoint: Checkpoint<T>;
    etag: string | null;
}

export async function getCheckpoint<T>(store: ObjectStore): Promise<CheckpointRead<T> | null> {
    const object = await store.get(CHECKPOINT_KEY);
    if (object === null) return null;
    return { checkpoint: gunzipJson<Checkpoint<T>>(object.body), etag: object.etag };
}

/**
 * Writes the checkpoint under a condition: the ETag read last, or absence. A lost condition
 * throws `PreconditionFailedError`, which the worker treats as another instance holding the day.
 */
export async function putCheckpoint<T>(store: ObjectStore, checkpoint: Checkpoint<T>, condition?: PutCondition): Promise<{ etag: string | null }> {
    return store.put(CHECKPOINT_KEY, gzipJson(checkpoint), { contentType: "application/gzip", condition });
}

export interface CheckpointAge {
    /** Milliseconds since the store last modified the checkpoint; null when the store gave no time. */
    ageMs: number | null;
    size: number;
}

/** The checkpoint's age from the store's own last-modified time, without downloading it (U19). */
export async function headCheckpoint(store: ObjectStore, nowEpochMs: number): Promise<CheckpointAge | null> {
    const head = await store.head(CHECKPOINT_KEY);
    if (head === null) return null;
    return { ageMs: head.lastModified === null ? null : Math.max(0, nowEpochMs - head.lastModified), size: head.size };
}

/** Whether another instance still holds the day: unreleased, not ours, and fresher than the hold. */
export function isCheckpointHeld(checkpoint: Pick<Checkpoint<unknown>, "machineId" | "writtenAt" | "released">, machineId: string, nowEpochMs: number): boolean {
    if (checkpoint.released || checkpoint.machineId === machineId) return false;
    return nowEpochMs - checkpoint.writtenAt < LEASE_HOLD_MS;
}
