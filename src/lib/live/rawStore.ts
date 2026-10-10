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
import { gunzipSync, gzipSync } from "node:zlib";
import { ObjectStoreError, type ObjectStore, type PutCondition } from "./objectStore";
import { serviceDateOf, serviceDayStart } from "./serviceDay";
import type { RawCall } from "./trainTracker";

export const RAW_PREFIX = "raw/v1";
export const CHECKPOINT_KEY = "state/checkpoint.json.gz";
export const LEASE_HOLD_MS = 3 * 60_000;
const HOUR_MS = 60 * 60_000;
const PART_FILE = /^(\d{4}-\d{2}-\d{2})\.(\d{2})\.(\d{13})\.ndjson$/;

const monthPrefix = (serviceDate: string) => `${RAW_PREFIX}/${serviceDate.slice(0, 4)}/${serviceDate.slice(5, 7)}`;

/** The compacted day object's key. */
export function dayObjectKey(serviceDate: string): string {
    return `${monthPrefix(serviceDate)}/${serviceDate}.ndjson.gz`;
}

/** The prefix every part of a day sits under. */
export function dayPartsPrefix(serviceDate: string): string {
    return `${monthPrefix(serviceDate)}/${serviceDate}/`;
}

/** The hour of a service day an instant falls in: 0 at 03:00 Chicago, up to 24 on a fall-back day. */
export function hourIndexOf(serviceDate: string, epochMs: number): number {
    return Math.floor((epochMs - serviceDayStart(serviceDate)) / HOUR_MS);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

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
    /** Closes the open part, if any, so the next upload pass takes it: at day close and on shutdown. */
    closeOpenPart(): void;
    /** Uploads every closed part file on disk, oldest first; returns the keys uploaded. Failed ones stay. */
    uploadPending(): Promise<string[]>;
    /** Part files on disk waiting for a successful upload, the open one excluded. */
    pendingFiles(): string[];
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

/** The complete lines of a part file; a final fragment with no newline (a cut-off write) is dropped. */
export function readPartLines(file: string): string[] {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    // The last element is "" after a complete final line, or a cut-off write, which is dropped.
    lines.pop();
    return lines;
}

export function createRawWriter(options: RawWriterOptions): RawWriter {
    const { dir, store } = options;
    const log = options.log ?? (() => {});
    fs.mkdirSync(dir, { recursive: true });
    let open: OpenPart | null = null;

    async function upload(file: string): Promise<boolean> {
        const key = partKeyOfFile(path.basename(file));
        if (key === null) return false;
        const lines = readPartLines(file);
        if (lines.length === 0) {
            fs.rmSync(file, { force: true });
            return true;
        }
        const body = gzipSync(Buffer.from(`${lines.join("\n")}\n`, "utf8"), { level: 6 });
        try {
            await store.put(key, body, { contentType: "application/gzip" });
        } catch (error) {
            // The file stays for uploadLeftovers; the message carries the key and status only.
            log(`raw part not uploaded, kept on disk: ${error instanceof ObjectStoreError ? error.message : key}`);
            return false;
        }
        fs.rmSync(file, { force: true });
        return true;
    }

    function pendingFiles(): string[] {
        return fs
            .readdirSync(dir)
            .filter((name) => PART_FILE.test(name))
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

        closeOpenPart() {
            open = null;
        },

        async uploadPending() {
            const uploaded: string[] = [];
            for (const file of pendingFiles()) {
                if (await upload(file)) uploaded.push(partKeyOfFile(path.basename(file)) as string);
            }
            return uploaded;
        },

        pendingFiles,
    };
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
    const buffers: Buffer[] = [];
    for (const part of parts) {
        const object = await store.get(part.key);
        if (object === null) throw new ObjectStoreError("get", part.key, 404, "part vanished during compaction");
        buffers.push(object.body);
    }
    const body = Buffer.concat(buffers);
    await store.put(key, body, { contentType: "application/gzip" });
    for (const part of parts) await store.delete(part.key);
    return { status: "compacted", key, bytes: body.byteLength, parts: parts.length };
}

/** The lines of a compacted day object, or of the parts still under its prefix when it has none. */
export async function readRawDay(store: ObjectStore, serviceDate: string): Promise<RawLine[] | null> {
    const day = await store.get(dayObjectKey(serviceDate));
    let buffers: Buffer[];
    if (day !== null) {
        buffers = [day.body];
    } else {
        const parts = await store.list(dayPartsPrefix(serviceDate));
        if (parts.length === 0) return null;
        buffers = [];
        for (const part of parts) {
            const object = await store.get(part.key);
            if (object !== null) buffers.push(object.body);
        }
    }
    return gunzipSync(Buffer.concat(buffers))
        .toString("utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as RawLine);
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
    const checkpoint = JSON.parse(gunzipSync(object.body).toString("utf8")) as Checkpoint<T>;
    return { checkpoint, etag: object.etag };
}

/**
 * Writes the checkpoint under a condition: the ETag read last, or absence. A lost condition
 * throws `PreconditionFailedError`, which the worker treats as another instance holding the day.
 */
export async function putCheckpoint<T>(store: ObjectStore, checkpoint: Checkpoint<T>, condition?: PutCondition): Promise<{ etag: string | null }> {
    const body = gzipSync(Buffer.from(JSON.stringify(checkpoint), "utf8"), { level: 6 });
    return store.put(CHECKPOINT_KEY, body, { contentType: "application/gzip", condition });
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
