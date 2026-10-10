import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryObjectStore, PreconditionFailedError, type MemoryObjectStore } from "./objectStore";
import {
    CHECKPOINT_KEY,
    compactDay,
    createRawWriter,
    dayObjectKey,
    dayPartsPrefix,
    getCheckpoint,
    headCheckpoint,
    hourIndexOf,
    isCheckpointHeld,
    LEASE_HOLD_MS,
    partFileName,
    partKey,
    partKeyOfFile,
    putCheckpoint,
    readRawDay,
    type Checkpoint,
    type RawLine,
    type RawWriter,
} from "./rawStore";
import { parseChicagoLocal, serviceDayStart } from "./serviceDay";

const DAY = "2026-10-14";
const DAY_START = serviceDayStart(DAY); // 03:00 CDT
const MINUTE = 60_000;

const line = (pollEpoch: number, n: number): RawLine => ({
    endpoint: n % 37 === 0 ? "positions" : "arrivals",
    pollEpoch,
    stationIds: n % 37 === 0 ? [] : ["40830"],
    httpStatus: 200,
    body: `{"ctatt":{"n":${n}}}`,
    errorCode: 0,
    failure: null,
    durationMs: 100,
});

let dir: string;
let store: MemoryObjectStore;
let clock: number;
let logged: string[];

function writer(): RawWriter {
    return createRawWriter({ dir, store, log: (m) => logged.push(m) });
}

const storedLines = (key: string) =>
    gunzipSync(store.objects().get(key)!.body)
        .toString("utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as RawLine);

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "raw-store-"));
    store = createMemoryObjectStore({ now: () => clock });
    clock = DAY_START;
    logged = [];
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("keys", () => {
    it("names parts by service day, hour index, and start epoch, and the day object beside them", () => {
        expect(dayObjectKey(DAY)).toBe("raw/v1/2026/10/2026-10-14.ndjson.gz");
        expect(dayPartsPrefix(DAY)).toBe("raw/v1/2026/10/2026-10-14/");
        expect(partKey(DAY, 0, DAY_START)).toBe(`raw/v1/2026/10/2026-10-14/00.${DAY_START}.ndjson.gz`);
        expect(partFileName(DAY, 21, DAY_START)).toBe(`2026-10-14.21.${DAY_START}.ndjson`);
        expect(partKeyOfFile(partFileName(DAY, 21, DAY_START))).toBe(partKey(DAY, 21, DAY_START));
        expect(partKeyOfFile("notes.txt")).toBeNull();
    });

    it("counts hours from 03:00, so midnight is hour 21 and key order is time order", () => {
        expect(hourIndexOf(DAY, DAY_START)).toBe(0);
        expect(hourIndexOf(DAY, parseChicagoLocal("2026-10-15 00:30:00"))).toBe(21);
        expect(hourIndexOf(DAY, parseChicagoLocal("2026-10-15 02:59:00"))).toBe(23);
        // The fall-back day has 25 hours.
        expect(hourIndexOf("2026-10-31", parseChicagoLocal("2026-11-01 02:30:00"))).toBe(24);
        expect(partKey(DAY, 21, 1) < partKey(DAY, 23, 1)).toBe(true);
    });
});

describe("the raw writer", () => {
    it("writes 120 lines over two hours into two parts and compacts them into one object in order", async () => {
        const w = writer();
        for (let n = 0; n < 120; n++) {
            clock = DAY_START + n * MINUTE;
            await w.write(line(clock, n));
        }
        await w.uploadOpenPart();

        const keys = [...store.objects().keys()].sort();
        expect(keys).toEqual([partKey(DAY, 0, DAY_START), partKey(DAY, 1, DAY_START + 60 * MINUTE)]);
        expect(storedLines(keys[0])).toHaveLength(60);
        expect(w.pendingFiles()).toEqual([]);

        const result = await compactDay(store, DAY);
        expect(result).toMatchObject({ status: "compacted", key: dayObjectKey(DAY), parts: 2 });
        const lines = storedLines(dayObjectKey(DAY));
        expect(lines.map((l) => JSON.parse(l.body as string).ctatt.n)).toEqual(Array.from({ length: 120 }, (_, i) => i));
        expect([...store.objects().keys()]).toEqual([dayObjectKey(DAY)]);
        expect(await readRawDay(store, DAY)).toHaveLength(120);
    });

    it("keeps every completed line on disk, dropping only a write that was cut off", async () => {
        const w = writer();
        await w.write(line(clock, 1));
        await w.write(line(clock + MINUTE, 2));
        const [file] = fs.readdirSync(dir);
        // A crash mid-write leaves a partial last line with no newline.
        fs.appendFileSync(path.join(dir, file), '{"endpoint":"arrivals","pollEpoch":');

        const successor = writer();
        expect(successor.pendingFiles()).toEqual([path.join(dir, file)]);
        expect(await successor.uploadLeftovers()).toEqual([partKey(DAY, 0, DAY_START)]);
        expect(storedLines(partKey(DAY, 0, DAY_START)).map((l) => JSON.parse(l.body as string).ctatt.n)).toEqual([1, 2]);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it("uploads a part twice as an idempotent overwrite", async () => {
        const w = writer();
        await w.write(line(clock, 1));
        await w.uploadOpenPart();
        const first = store.objects().get(partKey(DAY, 0, DAY_START));

        const again = writer();
        clock = DAY_START;
        await again.write(line(clock, 1));
        await again.uploadOpenPart();
        expect(store.objects().get(partKey(DAY, 0, DAY_START))?.etag).toBe(first?.etag);
        expect(store.objects().size).toBe(1);
    });

    it("compacts a predecessor's and a successor's parts for one hour in key order with no line lost", async () => {
        const w = writer();
        await w.write(line(DAY_START, 1));
        await w.write(line(DAY_START + MINUTE, 2));
        await w.uploadOpenPart(); // shutdown at 03:02

        clock = DAY_START + 5 * MINUTE;
        const successor = writer();
        await successor.write(line(clock, 3));
        await successor.write(line(clock + MINUTE, 4));
        await successor.uploadOpenPart();

        expect([...store.objects().keys()].sort()).toEqual([partKey(DAY, 0, DAY_START), partKey(DAY, 0, DAY_START + 5 * MINUTE)]);
        await compactDay(store, DAY);
        expect(storedLines(dayObjectKey(DAY)).map((l) => JSON.parse(l.body as string).ctatt.n)).toEqual([1, 2, 3, 4]);
    });

    it("rolls to a new part when the service day changes", async () => {
        const w = writer();
        await w.write(line(parseChicagoLocal("2026-10-15 02:59:00"), 1));
        await w.write(line(parseChicagoLocal("2026-10-15 03:00:00"), 2));
        await w.uploadOpenPart();

        expect([...store.objects().keys()].sort()).toEqual([
            partKey(DAY, 23, parseChicagoLocal("2026-10-15 02:59:00")),
            partKey("2026-10-15", 0, parseChicagoLocal("2026-10-15 03:00:00")),
        ]);
    });

    it("leaves a day whose object already exists untouched, parts and all", async () => {
        await store.put(dayObjectKey(DAY), gzipSync(Buffer.from("already\n")));
        await store.put(partKey(DAY, 0, DAY_START), gzipSync(Buffer.from("part\n")));

        expect(await compactDay(store, DAY)).toEqual({ status: "exists", key: dayObjectKey(DAY), bytes: store.objects().get(dayObjectKey(DAY))!.body.byteLength });
        expect(store.objects().size).toBe(2);
        expect(await compactDay(store, "2026-10-13")).toEqual({ status: "no-parts", key: dayObjectKey("2026-10-13") });
    });

    it("keeps writing locally while uploads fail, retrying the part later", async () => {
        const w = writer();
        await w.write(line(DAY_START, 1));
        // One surfaced failure: the R2 client's own three retries are tested with it.
        store.failNext(1, 503);
        await w.write(line(DAY_START + 60 * MINUTE, 2)); // the hour rolls; the upload fails
        expect(logged).toEqual([`raw part not uploaded, kept on disk: put ${partKey(DAY, 0, DAY_START)}: HTTP 503`]);
        expect(w.pendingFiles()).toEqual([path.join(dir, partFileName(DAY, 0, DAY_START))]);
        expect(fs.readdirSync(dir)).toHaveLength(2);
        expect(logged.join(" ")).not.toContain("cloudflarestorage");

        expect(await w.uploadLeftovers()).toEqual([partKey(DAY, 0, DAY_START)]);
        expect(w.pendingFiles()).toEqual([]);
        await w.uploadOpenPart();
        expect(store.objects().size).toBe(2);
    });

    it("reads a day's lines from its parts when it has not been compacted", async () => {
        const w = writer();
        await w.write(line(DAY_START, 1));
        await w.uploadOpenPart();
        expect((await readRawDay(store, DAY))?.map((l) => l.pollEpoch)).toEqual([DAY_START]);
        expect(await readRawDay(store, "2026-10-13")).toBeNull();
    });
});

describe("the checkpoint", () => {
    const checkpoint = (overrides: Partial<Checkpoint<{ slots: number }>> = {}): Checkpoint<{ slots: number }> => ({
        version: 1,
        machineId: "e784",
        writtenAt: DAY_START,
        released: false,
        state: { slots: 3 },
        ...overrides,
    });

    it("round-trips through gzip JSON and reports its age from the store's last-modified", async () => {
        clock = DAY_START;
        const { etag } = await putCheckpoint(store, checkpoint(), { ifNoneMatch: "*" });
        expect(etag).not.toBeNull();

        const read = await getCheckpoint<{ slots: number }>(store);
        expect(read?.checkpoint).toEqual(checkpoint());
        expect(read?.etag).toBe(etag);
        expect(await headCheckpoint(store, DAY_START + 3 * MINUTE)).toEqual({ ageMs: 3 * MINUTE, size: store.objects().get(CHECKPOINT_KEY)!.body.byteLength });
        expect(await headCheckpoint(createMemoryObjectStore(), DAY_START)).toBeNull();
        expect(await getCheckpoint(createMemoryObjectStore())).toBeNull();
    });

    it("fails a conditional put against a changed checkpoint rather than overwriting it", async () => {
        const first = await putCheckpoint(store, checkpoint(), { ifNoneMatch: "*" });
        await putCheckpoint(store, checkpoint({ machineId: "other", writtenAt: DAY_START + MINUTE }), { ifMatch: first.etag as string });

        await expect(putCheckpoint(store, checkpoint({ writtenAt: DAY_START + 2 * MINUTE }), { ifMatch: first.etag as string })).rejects.toBeInstanceOf(PreconditionFailedError);
        expect((await getCheckpoint<{ slots: number }>(store))?.checkpoint.machineId).toBe("other");
    });

    it("reports an unreleased checkpoint from another machine under three minutes old as held, and a released one as not", () => {
        const now = DAY_START + 2 * MINUTE;
        expect(isCheckpointHeld(checkpoint({ machineId: "other" }), "e784", now)).toBe(true);
        expect(isCheckpointHeld(checkpoint({ machineId: "other", released: true }), "e784", now)).toBe(false);
        expect(isCheckpointHeld(checkpoint({ machineId: "other" }), "e784", DAY_START + LEASE_HOLD_MS)).toBe(false);
        expect(isCheckpointHeld(checkpoint({ machineId: "e784" }), "e784", now)).toBe(false);
    });
});
