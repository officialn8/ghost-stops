import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    SOCRATA_ENDPOINT,
    buildWhereClause,
    createRng,
    sampleStationDays,
    sampleUpstream,
    type ExportRow,
    type UpstreamFetch,
} from "../../scripts/sample-upstream";
import { makeTempDir, writeFixtureSnapshot } from "./fixtures/history/snapshot-db";

const STATION_A = "a".repeat(32);
const STATION_B = "b".repeat(32);

/** Rides as Socrata would return them, keyed by CTA station id and date. */
type Upstream = Record<string, { rides: number; daytype: string; stationname?: string }>;

const EXPORT_ROWS: ExportRow[] = [
    { stationId: STATION_A, serviceDate: "2001-01-02", entries: 1000, dayType: "W" },
    { stationId: STATION_B, serviceDate: "2001-01-06", entries: 400, dayType: "A" },
    { stationId: STATION_A, serviceDate: "2019-03-04", entries: 2500, dayType: "W" },
    { stationId: STATION_B, serviceDate: "2019-12-25", entries: 900, dayType: "W" },
    // Out-of-sample years are read past, never sampled.
    { stationId: STATION_A, serviceDate: "2025-11-15", entries: 50, dayType: "A" },
];

const MATCHING_UPSTREAM: Upstream = {
    "40010|2001-01-02": { rides: 1000, daytype: "W" },
    "40020|2001-01-06": { rides: 400, daytype: "A" },
    "40010|2019-03-04": { rides: 2500, daytype: "W" },
    // Christmas: Socrata says U, the calendar-derived export says W. Informational only.
    "40020|2019-12-25": { rides: 900, daytype: "U" },
};

let dir: string;
let csvPath: string;
let sqlitePath: string;

beforeEach(() => {
    dir = makeTempDir("sample-upstream-");
    csvPath = path.join(dir, "ridership-history.csv");
    writeExportCsv(EXPORT_ROWS);
    sqlitePath = writeFixtureSnapshot(dir, {
        stations: [
            { id: STATION_A, externalId: "40010" },
            { id: STATION_B, externalId: "40020" },
        ],
        rows: [],
    });
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function writeExportCsv(rows: ExportRow[]): void {
    const lines = rows.map((row) => `${row.stationId},${row.serviceDate},${row.entries},${row.dayType}`);
    fs.writeFileSync(csvPath, ["stationId,serviceDate,entries,dayType", ...lines, ""].join("\n"));
}

interface FakeCall {
    url: URL;
    headers: Record<string, string>;
}

/** Answers SoQL `$where` pairs from a lookup table, the way the dataset would. */
function fakeSocrata(upstream: Upstream, calls: FakeCall[] = []): UpstreamFetch {
    return async (url, init) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, headers: init.headers });
        const where = parsed.searchParams.get("$where") ?? "";
        const body = [...where.matchAll(/station_id='(\d+)' AND date='(\d{4}-\d{2}-\d{2})T00:00:00\.000'/g)].flatMap(
            ([, stationId, date]) => {
                const hit = upstream[`${stationId}|${date}`];
                if (!hit) return [];
                return [
                    {
                        station_id: stationId,
                        stationname: hit.stationname ?? `Station ${stationId}`,
                        date: `${date}T00:00:00.000`,
                        daytype: hit.daytype,
                        rides: String(hit.rides),
                    },
                ];
            },
        );
        return { ok: true, status: 200, json: async () => body };
    };
}

function sample(fetch: UpstreamFetch, appToken?: string) {
    return sampleUpstream({ csvPath, sqlitePath, seed: 7, perYear: 2, years: [2019, 2001], fetch, appToken });
}

describe("sampleUpstream", () => {
    it("reports a mismatch when a stored value differs from the upstream value", async () => {
        const report = await sample(
            fakeSocrata({ ...MATCHING_UPSTREAM, "40010|2019-03-04": { rides: 2611, daytype: "W" } }),
        );

        expect(report.ok).toBe(false);
        expect(report.ridesMismatches).toBe(1);
        expect(report.missingUpstream).toBe(0);
        expect(report.samples.find((row) => row.status === "mismatch")).toMatchObject({
            stationId: STATION_A,
            ctaStationId: "40010",
            serviceDate: "2019-03-04",
            storedEntries: 2500,
            upstreamRides: 2611,
        });
    });

    it("passes when every sampled value matches, treating a day type difference as informational", async () => {
        const report = await sample(fakeSocrata(MATCHING_UPSTREAM));

        expect(report).toMatchObject({
            ok: true,
            seed: 7,
            perYear: 2,
            years: [2019, 2001],
            ridesMismatches: 0,
            missingUpstream: 0,
            dayTypeDifferences: 1,
        });
        expect(report.samples).toHaveLength(4);
        expect(report.samples.find((row) => row.serviceDate === "2019-12-25")).toMatchObject({
            status: "match",
            derivedDayType: "W",
            upstreamDayType: "U",
            dayTypeDiffers: true,
        });
    });

    it("fails when a sampled station-day is missing upstream", async () => {
        const upstream = { ...MATCHING_UPSTREAM };
        delete upstream["40020|2001-01-06"];
        const report = await sample(fakeSocrata(upstream));

        expect(report.ok).toBe(false);
        expect(report.missingUpstream).toBe(1);
        expect(report.samples.find((row) => row.status === "missing")).toMatchObject({
            serviceDate: "2001-01-06",
            upstreamRides: null,
            upstreamRowCount: 0,
        });
    });

    it("sends the app token only in the X-App-Token header", async () => {
        const calls: FakeCall[] = [];
        await sample(fakeSocrata(MATCHING_UPSTREAM, calls), "test-app-token");

        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
            expect(`${call.url.origin}${call.url.pathname}`).toBe(SOCRATA_ENDPOINT);
            expect(call.url.href).not.toContain("test-app-token");
            expect(call.headers["X-App-Token"]).toBe("test-app-token");
        }
    });

    it("sends no token header when no token is configured", async () => {
        const calls: FakeCall[] = [];
        const report = await sample(fakeSocrata(MATCHING_UPSTREAM, calls));

        expect(calls.every((call) => !("X-App-Token" in call.headers))).toBe(true);
        expect(JSON.stringify(report)).not.toMatch(/token/i);
    });

    it("throws on an HTTP error without echoing the request URL", async () => {
        const denied: UpstreamFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
        const failure = sample(denied);

        await expect(failure).rejects.toThrow(/HTTP 403/);
        await expect(failure).rejects.not.toThrow(/cityofchicago/);
    });

    it("throws when a year has fewer rows than the sample size", async () => {
        writeExportCsv(EXPORT_ROWS.filter((row) => row.serviceDate !== "2001-01-06"));
        await expect(sample(fakeSocrata(MATCHING_UPSTREAM))).rejects.toThrow(/only 1 rows from 2001/);
    });

    it("throws when a sampled station has no CTA id in the snapshot", async () => {
        const otherDir = path.join(dir, "missing-cta-id");
        fs.mkdirSync(otherDir);
        sqlitePath = writeFixtureSnapshot(otherDir, {
            stations: [
                { id: STATION_A, externalId: "40010" },
                { id: STATION_B, externalId: null },
            ],
            rows: [],
        });
        await expect(sample(fakeSocrata(MATCHING_UPSTREAM))).rejects.toThrow(
            new RegExp(`no CTA station id .*${STATION_B}`),
        );
    });
});

describe("sampleStationDays", () => {
    const candidates: ExportRow[] = [2001, 2019, 2020].flatMap((year) =>
        Array.from({ length: 100 }, (_, index) => ({
            stationId: index % 2 === 0 ? STATION_A : STATION_B,
            serviceDate: new Date(Date.UTC(year, 0, 1 + index)).toISOString().slice(0, 10),
            entries: index,
            dayType: "W",
        })),
    );

    it("picks the requested count per year, only from those years, without repeats", () => {
        const picks = sampleStationDays(candidates, { years: [2019, 2001], perYear: 30, seed: 20261003 });

        expect(picks).toHaveLength(60);
        expect(picks.filter((row) => row.serviceDate.startsWith("2019-"))).toHaveLength(30);
        expect(picks.filter((row) => row.serviceDate.startsWith("2001-"))).toHaveLength(30);
        expect(new Set(picks).size).toBe(60);
    });

    it("is deterministic for a seed and independent of input order", () => {
        const first = sampleStationDays(candidates, { years: [2019, 2001], perYear: 30, seed: 42 });
        const shuffled = [...candidates].reverse();
        expect(sampleStationDays(shuffled, { years: [2019, 2001], perYear: 30, seed: 42 })).toEqual(first);
        expect(sampleStationDays(candidates, { years: [2019, 2001], perYear: 30, seed: 43 })).not.toEqual(first);
    });
});

describe("createRng", () => {
    it("repeats its sequence for a seed and stays in [0, 1)", () => {
        const a = createRng(99);
        const b = createRng(99);
        const values = Array.from({ length: 1000 }, () => a());
        expect(Array.from({ length: 1000 }, () => b())).toEqual(values);
        expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    });
});

describe("buildWhereClause", () => {
    it("matches each station-day exactly", () => {
        expect(buildWhereClause([{ ctaStationId: "40010", serviceDate: "2019-03-04" }])).toBe(
            "(station_id='40010' AND date='2019-03-04T00:00:00.000')",
        );
    });

    it("refuses values that are not a numeric station id and a calendar date", () => {
        expect(() => buildWhereClause([{ ctaStationId: "40010' OR '1'='1", serviceDate: "2019-03-04" }])).toThrow(
            /unsafe/,
        );
        expect(() => buildWhereClause([{ ctaStationId: "40010", serviceDate: "2019-03-04' OR 1=1" }])).toThrow(
            /unsafe/,
        );
    });
});
