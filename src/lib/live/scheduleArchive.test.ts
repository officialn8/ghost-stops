import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CTA_ROSTER } from "@/lib/cta/roster";
import type { FeedFetch } from "./gtfs";
import { createMemoryObjectStore, gzipJson, type MemoryObjectStore } from "./objectStore";
import { loadSchedule, readScheduleIndex, refreshSchedule, SCHEDULE_INDEX_KEY, scheduleKey, versionInForce, type ScheduleIndex } from "./scheduleArchive";

const SLICE_ZIP = fileURLToPath(new URL("./__fixtures__/gtfs-rail-slice.zip", import.meta.url));
const ROSTER_IDS = new Set(CTA_ROSTER.map((s) => s.ctaStationId));
const zipBytes = fs.readFileSync(SLICE_ZIP);

let store: MemoryObjectStore;
let dir: string;
let clock: Date;
let logged: string[];

function fake(responses: Array<{ status: number; body?: Buffer; headers?: Record<string, string> } | Error>) {
    const calls: { headers: Record<string, string> }[] = [];
    const fetch: FeedFetch = async (_url, init) => {
        calls.push({ headers: init.headers });
        const next = responses.shift();
        if (!next) throw new Error("no response queued");
        if (next instanceof Error) throw next;
        return new Response(next.body === undefined ? null : new Uint8Array(next.body), { status: next.status, headers: next.headers });
    };
    return { fetch, calls };
}

const refresh = (fetch: FeedFetch) =>
    refreshSchedule({ store, feedFile: path.join(dir, "feed.zip"), rosterIds: ROSTER_IDS, fetch, now: () => clock, log: (m) => logged.push(m) });

beforeEach(() => {
    store = createMemoryObjectStore();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-archive-"));
    clock = new Date("2026-10-12T15:00:00Z");
    logged = [];
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("refreshSchedule", () => {
    it("archives a new feed version and reads it back", async () => {
        const http = fake([{ status: 200, body: zipBytes, headers: { "last-modified": "Mon, 14 Sep 2026 21:50:47 GMT" } }]);

        const result = await refresh(http.fetch);

        expect(result.status).toBe("archived");
        if (result.status !== "archived") return;
        expect(result.version).toEqual({
            hash: createHash("sha256").update(zipBytes).digest("hex"),
            bytes: zipBytes.byteLength,
            lastModified: "Mon, 14 Sep 2026 21:50:47 GMT",
            firstSeen: "2026-10-12T15:00:00.000Z",
            lastSeen: "2026-10-12T15:00:00.000Z",
            latestStopSeconds: 25 * 3600 + 13 * 60,
            trips: 55,
        });
        expect(http.calls[0].headers["If-Modified-Since"]).toBeUndefined();
        expect([...store.objects().keys()].sort()).toEqual([scheduleKey(result.version.hash), SCHEDULE_INDEX_KEY]);
        expect(await loadSchedule(store, result.version.hash)).toEqual(result.schedule);
        expect(fs.existsSync(path.join(dir, "feed.zip"))).toBe(false);
        expect(logged[0]).toMatch(/^schedule version [0-9a-f]{12} archived: 55 trips, latest stop 90780 s$/);
    });

    it("records an unchanged feed's last-seen time, whether it answers 304 or the same bytes", async () => {
        await refresh(fake([{ status: 200, body: zipBytes, headers: { "last-modified": "Mon, 14 Sep 2026 21:50:47 GMT" } }]).fetch);

        clock = new Date("2026-10-13T15:00:00Z");
        const notModified = fake([{ status: 304 }]);
        expect((await refresh(notModified.fetch)).status).toBe("unchanged");
        expect(notModified.calls[0].headers["If-Modified-Since"]).toBe("Mon, 14 Sep 2026 21:50:47 GMT");

        clock = new Date("2026-10-14T15:00:00Z");
        expect((await refresh(fake([{ status: 200, body: zipBytes }]).fetch)).status).toBe("unchanged");

        const index = await readScheduleIndex(store);
        expect(index.versions).toHaveLength(1);
        expect(index.versions[0]).toMatchObject({ firstSeen: "2026-10-12T15:00:00.000Z", lastSeen: "2026-10-14T15:00:00.000Z" });
        expect(store.objects().size).toBe(2);
    });

    it("keeps the previous version in force when the download or the extract fails", async () => {
        await refresh(fake([{ status: 200, body: zipBytes }]).fetch);
        const before = (await readScheduleIndex(store)).versions[0];

        const failed = await refresh(fake([new Error("ECONNRESET")]).fetch);
        expect(failed).toEqual({ status: "failed", reason: "download: the feed could not be fetched: network error or timeout", version: before });

        const garbage = await refresh(fake([{ status: 200, body: Buffer.from("not a zip") }]).fetch);
        expect(garbage.status).toBe("failed");
        expect((await readScheduleIndex(store)).versions).toEqual([before]);
        expect(logged.filter((l) => l.includes("previous version stays in force"))).toHaveLength(2);
    });

    it("reports a 304 before any version as a failure", async () => {
        expect((await refresh(fake([{ status: 304 }]).fetch)).status).toBe("failed");
    });
});

describe("format stamps", () => {
    it("refuses an index stamped with a version it does not read, naming the key and the version", async () => {
        await store.put(SCHEDULE_INDEX_KEY, Buffer.from(JSON.stringify({ version: 2, versions: [] }), "utf8"), { contentType: "application/json" });

        await expect(readScheduleIndex(store)).rejects.toThrow(`${SCHEDULE_INDEX_KEY} is stamped version 2`);
    });

    it("refuses an archived schedule stamped with a version it does not read, naming the key and the version", async () => {
        await store.put(scheduleKey("abc"), gzipJson({ version: 2, hash: "abc" }), { contentType: "application/gzip" });

        await expect(loadSchedule(store, "abc")).rejects.toThrow(`${scheduleKey("abc")} is stamped version 2`);
    });
});

describe("versionInForce", () => {
    const index: ScheduleIndex = {
        version: 1,
        versions: [
            { hash: "a", bytes: 1, lastModified: null, firstSeen: "2026-10-12T15:00:00Z", lastSeen: "2026-10-20T15:00:00Z", latestStopSeconds: 0, trips: 1 },
            { hash: "b", bytes: 1, lastModified: null, firstSeen: "2026-10-21T15:00:00Z", lastSeen: "2026-10-21T15:00:00Z", latestStopSeconds: 0, trips: 1 },
        ],
    };

    it("picks the newest version first seen before the instant, and none before the first", () => {
        expect(versionInForce(index, Date.parse("2026-10-21T08:15:00Z"))?.hash).toBe("a"); // the day that closed before b arrived
        expect(versionInForce(index, Date.parse("2026-10-22T08:15:00Z"))?.hash).toBe("b");
        expect(versionInForce(index, Date.parse("2026-10-21T15:00:00Z"))?.hash).toBe("b");
        expect(versionInForce(index, Date.parse("2026-10-01T00:00:00Z"))).toBeNull();
        expect(versionInForce({ version: 1, versions: [] }, Date.now())).toBeNull();
    });
});
