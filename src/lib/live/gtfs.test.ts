import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CTA_ROSTER } from "@/lib/cta/roster";
import {
    directoryEntrySource,
    downloadFeed,
    ENTRY_BYTE_CAPS,
    extractRailSchedule,
    GtfsError,
    hashBytes,
    routesIn,
    zipEntrySource,
    type FeedFetch,
    type RailSchedule,
} from "./gtfs";
import { parseGtfsTime } from "./serviceDay";

const SLICE_DIR = fileURLToPath(new URL("./__fixtures__/gtfs-rail-slice/", import.meta.url));
const SLICE_ZIP = fileURLToPath(new URL("./__fixtures__/gtfs-rail-slice.zip", import.meta.url));
const ROSTER_IDS = new Set(CTA_ROSTER.map((s) => s.ctaStationId));
const NOW = () => new Date("2026-10-09T22:00:00Z");

let fromZip: RailSchedule;
const temps: string[] = [];

/** A copy of the slice directory to edit, removed after the test. */
function sliceCopy(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtfs-slice-"));
    for (const name of fs.readdirSync(SLICE_DIR)) fs.copyFileSync(path.join(SLICE_DIR, name), path.join(dir, name));
    temps.push(dir);
    return dir;
}

async function failureOf(call: Promise<unknown>): Promise<GtfsError> {
    const outcome = await call.then(
        () => null,
        (error: unknown) => error,
    );
    if (!(outcome instanceof GtfsError)) throw new Error(`expected a GtfsError, got ${String(outcome)}`);
    return outcome;
}

beforeAll(async () => {
    const source = await zipEntrySource(SLICE_ZIP);
    try {
        fromZip = await extractRailSchedule(source, { rosterIds: ROSTER_IDS, hash: "abc", bytes: 20_544, lastModified: "Mon, 14 Sep 2026 21:50:47 GMT", now: NOW });
    } finally {
        await source.close();
    }
});

afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("extractRailSchedule", () => {
    it("reads the slice from the zip: the eight routes, 55 rail trips, every platform mapped to the roster", () => {
        expect(fromZip.version).toBe(1);
        expect(fromZip.hash).toBe("abc");
        expect(fromZip.bytes).toBe(20_544);
        expect(fromZip.lastModified).toBe("Mon, 14 Sep 2026 21:50:47 GMT");
        expect(fromZip.extractedAt).toBe("2026-10-09T22:00:00.000Z");
        expect(routesIn(fromZip)).toEqual(["red", "blue", "brn", "g", "org", "p", "pink", "y"]);
        expect(fromZip.trips).toHaveLength(55);
        expect(Object.keys(fromZip.platforms)).toHaveLength(298);
        expect(fromZip.platforms["30228"]).toBe("41190"); // Jarvis
        expect(fromZip.platforms["30075"]).toBe("40380"); // Clark/Lake, outer Loop
        expect(new Set(Object.values(fromZip.platforms)).size).toBe(143); // State/Lake, closed, is not in the feed
    });

    it("keeps a trip's stops in sequence order with their times and pickup types", () => {
        const red = fromZip.trips.find((t) => t.id === "92275698970");
        expect(red).toMatchObject({ route: "red", service: "109201", direction: "1" });
        expect(red?.stops).toHaveLength(33);
        expect(red?.stops.at(-2)).toEqual(["30227", parseGtfsTime("04:08:00"), 0]);
        expect(red?.stops.at(-1)).toEqual(["30173", parseGtfsTime("04:09:00"), 0]);
        const green = fromZip.trips.find((t) => t.id === "92275546232");
        expect(green?.stops.find(([stop]) => stop === "30217")).toEqual(["30217", parseGtfsTime("04:44:00"), 1]);
    });

    it("keeps the rail services' calendar rows and exceptions, and the latest stop time", () => {
        expect(Object.keys(fromZip.services).sort()).toEqual(["109201", "109206", "109209"]);
        expect(fromZip.services["109201"]).toEqual({ days: [1, 1, 1, 1, 1, 0, 0], start: "2026-09-11", end: "2026-11-30" });
        expect(fromZip.exceptions).toEqual([
            { service: "109201", date: "2026-11-26", type: 2 },
            { service: "109206", date: "2026-11-26", type: 2 },
            { service: "109209", date: "2026-11-26", type: 1 },
        ]);
        expect(fromZip.latestStopSeconds).toBe(parseGtfsTime("25:13:00"));
    });

    it("drops the bus route, its trip, and its stops, parsing their quoted commas on the way", () => {
        expect(fromZip.trips.some((t) => t.id === "6810000272020")).toBe(false);
        expect(fromZip.platforms["67"]).toBeUndefined();
        expect(fromZip.services["68101"]).toBeUndefined();
    });

    it("reads the same schedule from a directory of the same files", async () => {
        const fromDir = await extractRailSchedule(directoryEntrySource(SLICE_DIR), { rosterIds: ROSTER_IDS, hash: "abc", bytes: 20_544, lastModified: fromZip.lastModified, now: NOW });
        expect(fromDir).toEqual(fromZip);
    });

    it("aborts with the parents it cannot map to the roster, by id", async () => {
        const roster = new Set(ROSTER_IDS);
        roster.delete("41190");
        roster.delete("40900");

        const failure = await failureOf(extractRailSchedule(directoryEntrySource(SLICE_DIR), { rosterIds: roster }));
        expect(failure.kind).toBe("unmapped");
        expect(failure.message).toBe("GTFS parents with no roster station: 40900, 41190");
    });

    it("aborts with a platform that has no parent station", async () => {
        const dir = sliceCopy();
        const stops = fs.readFileSync(path.join(dir, "stops.txt"), "utf8").replace("30228,,Jarvis,,42.015876,-87.669092,0,41190,2", "30228,,Jarvis,,42.015876,-87.669092,0,,2");
        fs.writeFileSync(path.join(dir, "stops.txt"), stops);

        const failure = await failureOf(extractRailSchedule(directoryEntrySource(dir), { rosterIds: ROSTER_IDS }));
        expect(failure.kind).toBe("unmapped");
        expect(failure.message).toContain("platform 30228");
    });

    it("aborts on a feed with no rail route and on a missing entry", async () => {
        const dir = sliceCopy();
        const routes = fs.readFileSync(path.join(dir, "routes.txt"), "utf8").split("\n").filter((line) => !/^50066,(Red|Blue|Brn|G|Org|P|Pink|Y),/.test(line)).join("\n");
        fs.writeFileSync(path.join(dir, "routes.txt"), routes);
        expect((await failureOf(extractRailSchedule(directoryEntrySource(dir), { rosterIds: ROSTER_IDS }))).kind).toBe("no-rail");

        fs.rmSync(path.join(dir, "calendar_dates.txt"));
        fs.writeFileSync(path.join(dir, "routes.txt"), fs.readFileSync(path.join(SLICE_DIR, "routes.txt")));
        const missing = await failureOf(extractRailSchedule(directoryEntrySource(dir), { rosterIds: ROSTER_IDS }));
        expect(missing.kind).toBe("missing-entry");
        expect(missing.message).toContain("calendar_dates.txt");
    });

    it("aborts the load when an entry runs past its byte cap", async () => {
        const caps = { ...ENTRY_BYTE_CAPS, "stop_times.txt": 10_000 };
        const failure = await failureOf(extractRailSchedule(directoryEntrySource(SLICE_DIR), { rosterIds: ROSTER_IDS, caps }));
        expect(failure.kind).toBe("oversize");
        expect(failure.message).toBe("stop_times.txt runs past 10000 bytes");
    });
});

describe("downloadFeed", () => {
    const zipBytes = fs.readFileSync(SLICE_ZIP);
    let outDir: string;

    function fake(responses: Array<{ status: number; body?: Buffer; headers?: Record<string, string> }>) {
        const calls: { url: string; headers: Record<string, string> }[] = [];
        const fetch: FeedFetch = async (url, init) => {
            calls.push({ url, headers: init.headers });
            const next = responses.shift();
            if (!next) throw new Error("no response queued");
            return new Response(next.body === undefined ? null : new Uint8Array(next.body), { status: next.status, headers: next.headers });
        };
        return { fetch, calls };
    }

    beforeAll(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), "gtfs-download-"));
    });

    it("writes the feed to disk, hashes the bytes, and keeps the server's Last-Modified", async () => {
        const http = fake([{ status: 200, body: zipBytes, headers: { "last-modified": "Mon, 14 Sep 2026 21:50:47 GMT", "content-length": String(zipBytes.byteLength) } }]);

        const result = await downloadFeed({ toFile: path.join(outDir, "feed.zip"), fetch: http.fetch, ifModifiedSince: "Sun, 13 Sep 2026 00:00:00 GMT" });

        expect(result).toEqual({
            status: "downloaded",
            file: path.join(outDir, "feed.zip"),
            bytes: zipBytes.byteLength,
            hash: hashBytes(zipBytes),
            lastModified: "Mon, 14 Sep 2026 21:50:47 GMT",
        });
        expect(fs.readFileSync(path.join(outDir, "feed.zip")).equals(zipBytes)).toBe(true);
        expect(http.calls[0].url).toBe("https://www.transitchicago.com/downloads/sch_data/google_transit.zip");
        expect(http.calls[0].headers["If-Modified-Since"]).toBe("Sun, 13 Sep 2026 00:00:00 GMT");
    });

    it("answers unchanged on a 304", async () => {
        const http = fake([{ status: 304 }]);
        expect(await downloadFeed({ toFile: path.join(outDir, "feed.zip"), fetch: http.fetch })).toEqual({ status: "unchanged" });
    });

    it("refuses a redirect off https and reports a failed download without a URL", async () => {
        const http = fake([{ status: 302, headers: { location: "http://mirror.example/google_transit.zip" } }]);
        const failure = await failureOf(downloadFeed({ toFile: path.join(outDir, "feed.zip"), fetch: http.fetch }));
        expect(failure.kind).toBe("download");
        expect(failure.message).toBe("the feed URL is not https");

        const denied = fake([{ status: 403 }]);
        expect((await failureOf(downloadFeed({ toFile: path.join(outDir, "feed.zip"), fetch: denied.fetch }))).message).toBe("the feed answered HTTP 403");
    });

    it("follows an https redirect", async () => {
        const http = fake([{ status: 301, headers: { location: "https://cdn.example/google_transit.zip" } }, { status: 200, body: zipBytes }]);
        expect((await downloadFeed({ toFile: path.join(outDir, "feed.zip"), fetch: http.fetch })).status).toBe("downloaded");
        expect(http.calls.map((c) => c.url)).toEqual(["https://www.transitchicago.com/downloads/sch_data/google_transit.zip", "https://cdn.example/google_transit.zip"]);
    });

    it("refuses a feed over the byte cap, declared or streamed, and leaves no file behind", async () => {
        const declared = fake([{ status: 200, body: zipBytes, headers: { "content-length": "999999999" } }]);
        expect((await failureOf(downloadFeed({ toFile: path.join(outDir, "big.zip"), fetch: declared.fetch, maxBytes: 1_000_000 }))).kind).toBe("oversize");

        const streamed = fake([{ status: 200, body: zipBytes }]);
        expect((await failureOf(downloadFeed({ toFile: path.join(outDir, "big.zip"), fetch: streamed.fetch, maxBytes: 1_000 }))).kind).toBe("oversize");
        expect(fs.existsSync(path.join(outDir, "big.zip"))).toBe(false);
        expect(fs.existsSync(path.join(outDir, "big.zip.part"))).toBe(false);
    });
});
