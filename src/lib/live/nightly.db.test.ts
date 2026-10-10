import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { prisma } from "@/lib/prisma";
import { createSyncTestCity, deleteSyncTestCity } from "@/lib/sync/__fixtures__/db";
import type { RailSchedule } from "./gtfs";
import { dayStateKey, serializeClosedDay } from "./loop";
import { closeDay, fillGapDays, finishDay, type NightlyDeps } from "./nightly";
import { createMemoryObjectStore, type MemoryObjectStore } from "./objectStore";
import { dayObjectKey, dayPartsPrefix, partKey } from "./rawStore";
import { REDUCER_VERSION } from "./reduce";
import { archiveSchedule, writeScheduleIndex } from "./scheduleArchive";
import { parseChicagoLocal, serviceDayStart } from "./serviceDay";
import { createDayTracker, type TrackerState } from "./tracker";
import { TRAIN_ROUTES } from "./trainTracker";
import { gapDay, writeDay } from "./writeDay";

// Runs in the `db` Vitest project against the local or CI Postgres.
const CITY = "test-live-nightly";
const DAY = "2026-09-28";
const TEST_DAYS = ["2026-09-26", "2026-09-27", DAY, "2026-09-29"];
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const ROSTER_IDS = CTA_ROSTER.map((s) => s.ctaStationId);
const at = (hhmm: string) => parseChicagoLocal(`${DAY} ${hhmm}:00`);

/** A one-trip rail schedule: Red from Howard through Jarvis, listed on every day of 2026. */
const schedule: RailSchedule = {
    version: 1,
    hash: "hash-a",
    bytes: 1,
    lastModified: null,
    extractedAt: "2026-09-01T00:00:00.000Z",
    platforms: { "30174": "40900", "30228": "41190", "30252": "40100" },
    services: { weekly: { days: [1, 1, 1, 1, 1, 1, 1], start: "2026-01-01", end: "2026-12-31" } },
    exceptions: [],
    trips: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, route: "red" as const, service: "weekly", direction: "0", stops: [["30174", 8 * 3600 + i * 600, 0], ["30228", 8 * 3600 + i * 600 + 120, 0], ["30252", 8 * 3600 + i * 600 + 240, 0]] as [string, number, number][] })),
    latestStopSeconds: 9 * 3600,
};

function fullTracker(): TrackerState {
    const t = createDayTracker(DAY);
    for (let i = 0; i < 1_440; i++) t.minutes[String(i)] = { p: 1, f: [], t: TRAIN_ROUTES.map(() => 3), m: 0 };
    // Every scheduled Jarvis stop came; one Howard departure was posted from the schedule and never ran.
    for (let i = 0; i < 6; i++) {
        t.passages.push({ stationId: "41190", stopId: "30228", route: "red", run: `${800 + i}`, arrivedAt: at("08:02") + i * 600_000, lastSeen: at("08:01") + i * 600_000, vanishedAt: at("08:03") + i * 600_000 });
        if (i > 0) t.passages.push({ stationId: "40900", stopId: "30174", route: "red", run: `${800 + i}`, arrivedAt: at("08:00") + i * 600_000, lastSeen: at("07:59") + i * 600_000, vanishedAt: at("08:01") + i * 600_000 });
    }
    const key = "40900|30174|red|slot";
    t.slots[key] = { key, stationId: "40900", stopId: "30174", route: "red", scheduledAt: at("08:00"), scheduledText: "x", firstSeen: at("07:50"), lastSeen: at("08:06"), runs: ["799"], fault: false, liveSameRunAt: null };
    return t;
}

let cityId: string;
let store: MemoryObjectStore;
let posted: string[];
let fails: number;
let logged: string[];

function deps(overrides: Partial<NightlyDeps> = {}): NightlyDeps {
    return {
        db: prisma,
        store,
        stationIds: ROSTER_IDS,
        site: { url: "https://site.example", secret: "ghrv_test" },
        cityCode: CITY,
        healthchecks: { ping: async () => {}, fail: async () => void fails++ },
        now: () => new Date("2026-09-29T08:20:00Z"),
        log: (m) => logged.push(m),
        fetch: async (url, init) => {
            posted.push(`${init.method} ${url} ${init.headers.Authorization}`);
            return { ok: true, status: 200, json: async () => ({ revalidated: ["stations"] }) };
        },
        sleep: async () => {},
        ...overrides,
    };
}

async function clearTestDays(): Promise<void> {
    await prisma.liveDay.deleteMany({ where: { serviceDate: { in: TEST_DAYS.map(date) } } });
}

beforeAll(async () => {
    await clearTestDays();
    cityId = await createSyncTestCity(CITY, ROSTER_IDS);
});

beforeEach(async () => {
    await clearTestDays();
    store = createMemoryObjectStore();
    posted = [];
    fails = 0;
    logged = [];
    await archiveSchedule(store, schedule);
    await writeScheduleIndex(store, { version: 1, versions: [{ hash: "hash-a", bytes: 1, lastModified: null, firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-28T00:00:00Z", latestStopSeconds: 9 * 3600, trips: 6 }] });
    await store.put(partKey(DAY, 5, serviceDayStart(DAY) + 5 * 3_600_000), gzipSync(Buffer.from('{"endpoint":"positions"}\n')));
});

afterAll(async () => {
    await clearTestDays();
    await deleteSyncTestCity(CITY);
    await prisma.$disconnect();
});

describe("closeDay", () => {
    it("reduces, writes both tables in one go, revalidates the site, compacts the raw day, and records its path", async () => {
        const result = await closeDay({ ...deps(), db: prisma }, fullTracker(), { quotaStopped: false });

        expect(result).toEqual({ serviceDate: DAY, reduced: true, revalidated: true, compacted: true });
        const day = await prisma.liveDay.findUniqueOrThrow({ where: { serviceDate: date(DAY) } });
        expect(day).toMatchObject({ verdict: "COUNTED", cause: null, scheduleVersion: "hash-a", rawPath: dayObjectKey(DAY) });
        expect(day.rawBytes).toBeGreaterThan(0);
        expect(await prisma.liveStationDay.count({ where: { serviceDate: date(DAY) } })).toBe(144);
        const howard = await prisma.liveStationDay.findFirst({ where: { serviceDate: date(DAY), station: { ctaStationId: "40900", cityId } } });
        expect(howard).toMatchObject({ scheduled: 6, ghosts: 1, fulfilled: 5, counted: true });
        expect(posted).toEqual(["POST https://site.example/api/internal/revalidate Bearer ghrv_test"]);
        expect(await store.get(dayObjectKey(DAY))).not.toBeNull();
        expect(await store.list(`raw/v1/2026/09/${DAY}/`)).toEqual([]);
        expect(fails).toBe(0);
        expect(logged.some((l) => l.startsWith(`${DAY} reduced: COUNTED`))).toBe(true);
    });

    it("finishes a day left reduced but not revalidated or compacted", async () => {
        await closeDay({ ...deps(), fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }), store: createMemoryObjectStore() }, fullTracker(), { quotaStopped: false });
        posted = [];

        const finished = await finishDay(deps(), { serviceDate: DAY, reduced: true, revalidated: false, compacted: false });
        expect(finished).toEqual({ serviceDate: DAY, reduced: true, revalidated: true, compacted: true });
        expect(posted).toHaveLength(1);
        expect((await prisma.liveDay.findUniqueOrThrow({ where: { serviceDate: date(DAY) } })).rawPath).toBe(dayObjectKey(DAY));
    });

    it("leaves the compaction for later when a raw part is still on disk, and does it on the next call", async () => {
        const deferred = await closeDay(deps(), fullTracker(), { quotaStopped: false, compact: false });
        expect(deferred).toEqual({ serviceDate: DAY, reduced: true, revalidated: true, compacted: false });
        expect(await store.get(dayObjectKey(DAY))).toBeNull();
        expect(await store.list(dayPartsPrefix(DAY))).toHaveLength(1);
        expect((await prisma.liveDay.findUniqueOrThrow({ where: { serviceDate: date(DAY) } })).rawPath).toBeNull();

        const finished = await finishDay(deps(), deferred);
        expect(finished).toEqual({ serviceDate: DAY, reduced: true, revalidated: true, compacted: true });
        expect(await store.list(dayPartsPrefix(DAY))).toEqual([]);
        expect((await prisma.liveDay.findUniqueOrThrow({ where: { serviceDate: date(DAY) } })).rawPath).toBe(dayObjectKey(DAY));
        expect(posted).toHaveLength(1); // the close revalidated; the finish had nothing to repeat
    });

    it("posts the fail URL for a feed-shape day and skips the site when none is configured", async () => {
        const noSlots = fullTracker();
        noSlots.slots = {};
        const result = await closeDay(deps({ site: null }), noSlots, { quotaStopped: false });
        expect(result.revalidated).toBe(true);
        expect(posted).toEqual([]);
        expect(fails).toBe(1);
        expect((await prisma.liveDay.findUniqueOrThrow({ where: { serviceDate: date(DAY) } })).cause).toBe("feed-shape");
    });

    it("sets a day aside as no-schedule when no version was in force when it closed", async () => {
        await writeScheduleIndex(store, { version: 1, versions: [] });
        await closeDay(deps(), fullTracker(), { quotaStopped: false });
        expect((await prisma.liveDay.findUniqueOrThrow({ where: { serviceDate: date(DAY) } })).cause).toBe("no-schedule");
    });
});

describe("a refused write", () => {
    const lastRow = () => writeDay(prisma, gapDay("2026-09-27", new Date("2026-09-28T08:20:00Z")), null, { cityCode: CITY });

    it("lands no row, posts the fail URL, still compacts the raw day, and is no gap while its tracker is in the store", async () => {
        // A roster short by one station: the write refuses a station set that does not cover the city's 144.
        const tracker = fullTracker();
        await serializeClosedDay(store, tracker); // what the loop does before the close hook

        const result = await closeDay(deps({ stationIds: ROSTER_IDS.slice(1) }), tracker, { quotaStopped: false });

        expect(result).toEqual({ serviceDate: DAY, reduced: false, revalidated: true, compacted: true });
        expect(await prisma.liveDay.findUnique({ where: { serviceDate: date(DAY) } })).toBeNull();
        expect(await prisma.liveStationDay.count({ where: { serviceDate: date(DAY) } })).toBe(0);
        expect(fails).toBe(1);
        expect(posted).toEqual([]);
        expect(await store.get(dayObjectKey(DAY))).not.toBeNull();
        expect(await store.list(dayPartsPrefix(DAY))).toEqual([]);
        expect(logged.find((l) => l.startsWith(`${DAY} not written:`))).toMatch(/143 station rows for 144 stations; once the roster and the database agree, run: npx tsx scripts\/live-rereduce\.ts --date 2026-09-28$/);

        // The gap filler: 2026-09-27 holds the last row; 09-28 was watched (its tracker is in the store), 09-29 was not.
        await lastRow();
        expect(await fillGapDays(deps(), Date.parse("2026-09-30T13:00:00Z"))).toEqual(["2026-09-29"]);
        expect(await prisma.liveDay.findUnique({ where: { serviceDate: date(DAY) } })).toBeNull();
        expect(logged).toContain(`${DAY} was watched but not written; no gap row: npx tsx scripts/live-rereduce.ts --date ${DAY}`);

        // Without the tracker in the store, the day is a gap like any other.
        await clearTestDays();
        await store.delete(dayStateKey(DAY));
        await lastRow();
        expect(await fillGapDays(deps(), Date.parse("2026-09-30T13:00:00Z"))).toEqual([DAY, "2026-09-29"]);
    });

    it("leaves a row stored under a newer reducer alone, with no alert", async () => {
        await writeDay(prisma, { ...gapDay(DAY, new Date("2026-09-29T08:20:00Z")), reducerVersion: REDUCER_VERSION + 1 }, null, { cityCode: CITY });

        const result = await closeDay(deps(), fullTracker(), { quotaStopped: false });

        expect(result).toEqual({ serviceDate: DAY, reduced: false, revalidated: true, compacted: true });
        expect(fails).toBe(0);
        expect(await prisma.liveDay.findUniqueOrThrow({ where: { serviceDate: date(DAY) } })).toMatchObject({ verdict: "SET_ASIDE", reducerVersion: REDUCER_VERSION + 1, rawPath: null });
        expect(logged.find((l) => l.startsWith(`${DAY} not written:`))).toMatch(/newer than/);
        expect(logged.find((l) => l.startsWith(`${DAY} not written:`))).not.toMatch(/live-rereduce/);
    });
});

describe("fillGapDays", () => {
    it("writes set-aside rows for the days between the last row and the latest closed day, and nothing before the first row", async () => {
        expect(await fillGapDays(deps(), Date.parse("2026-09-30T13:00:00Z"))).toEqual([]);

        await closeDay(deps(), fullTracker(), { quotaStopped: false }); // 2026-09-28
        // 2026-09-30 13:00Z is 08:00 Chicago: 2026-09-29 closed at 03:15.
        expect(await fillGapDays(deps(), Date.parse("2026-09-30T13:00:00Z"))).toEqual(["2026-09-29"]);
        expect(await prisma.liveDay.findUniqueOrThrow({ where: { serviceDate: date("2026-09-29") } })).toMatchObject({ verdict: "SET_ASIDE", cause: "site-gap", pollsSucceeded: 0 });
        expect(await prisma.liveStationDay.count({ where: { serviceDate: date("2026-09-29") } })).toBe(0);
        expect(await fillGapDays(deps(), Date.parse("2026-09-30T13:00:00Z"))).toEqual([]);
    });
});
