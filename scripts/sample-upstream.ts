#!/usr/bin/env tsx

/**
 * Checks the snapshot's vintage against upstream before the history load (revival plan U7, KTD3):
 * samples station-days from the export CSV for 2019 and 2001 with a seeded RNG and compares each
 * stored value with the Socrata dataset 5neh-572f. Any rides difference, or a sampled day missing
 * upstream, exits 1 and stops the plan. Day type differences are informational (holidays).
 *
 *   npx tsx scripts/sample-upstream.ts --csv exports/ridership-history.csv --sqlite prisma/dev.db --seed 20261003
 *
 * CHICAGO_DATA_APP_TOKEN, when set, travels only in the X-App-Token header. Request URLs and
 * headers are never printed.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { isCliEntry } from "./cli";
import { isCalendarDate } from "./dates";
import { CSV_HEADER } from "./export-history";

export const DATASET_ID = "5neh-572f";
export const SOCRATA_ENDPOINT = `https://data.cityofchicago.org/resource/${DATASET_ID}.json`;
export const DEFAULT_SEED = 20261003;
export const DEFAULT_YEARS: readonly number[] = [2019, 2001];
export const DEFAULT_PER_YEAR = 30;

/** Station-days per request; thirty exact-match clauses keep the URL well under common limits. */
const BATCH_SIZE = 30;

export interface ExportRow {
    stationId: string;
    serviceDate: string;
    entries: number;
    dayType: string;
}

/** The subset of `fetch` this script uses, so tests can answer without the network. */
export type UpstreamFetch = (
    url: string,
    init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface StationDayQuery {
    ctaStationId: string;
    serviceDate: string;
}

interface UpstreamRow {
    ctaStationId: string;
    serviceDate: string;
    stationName: string | null;
    dayType: string | null;
    rides: number;
}

export interface SampleResult {
    year: number;
    stationId: string;
    ctaStationId: string;
    serviceDate: string;
    storedEntries: number;
    upstreamRides: number | null;
    upstreamRowCount: number;
    upstreamStationName: string | null;
    derivedDayType: string;
    upstreamDayType: string | null;
    dayTypeDiffers: boolean | null;
    status: "match" | "mismatch" | "missing";
}

export interface SampleReport {
    ok: boolean;
    dataset: string;
    csvPath: string;
    seed: number;
    perYear: number;
    years: number[];
    sampled: number;
    ridesMismatches: number;
    missingUpstream: number;
    /** Informational: the export derives day type from the calendar, so holidays differ. */
    dayTypeDifferences: number;
    samples: SampleResult[];
}

export interface SampleOptions {
    csvPath: string;
    sqlitePath: string;
    seed?: number;
    perYear?: number;
    years?: readonly number[];
    fetch?: UpstreamFetch;
    appToken?: string;
}

/** mulberry32: small, fast, and identical on every platform for a given 32-bit seed. */
export function createRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function compareRows(a: ExportRow, b: ExportRow): number {
    if (a.stationId !== b.stationId) return a.stationId < b.stationId ? -1 : 1;
    if (a.serviceDate !== b.serviceDate) return a.serviceDate < b.serviceDate ? -1 : 1;
    return 0;
}

/**
 * Picks `perYear` distinct station-days from each year. Candidates are sorted first, so the picks
 * depend only on the rows and the seed, never on file order.
 */
export function sampleStationDays(
    rows: readonly ExportRow[],
    { years, perYear, seed }: { years: readonly number[]; perYear: number; seed: number },
): ExportRow[] {
    const rng = createRng(seed);
    const picks: ExportRow[] = [];

    for (const year of years) {
        const candidates = rows.filter((row) => row.serviceDate.startsWith(`${year}-`)).sort(compareRows);
        if (candidates.length < perYear) {
            throw new Error(`The export has only ${candidates.length} rows from ${year}; cannot sample ${perYear}.`);
        }
        // Partial Fisher-Yates: the first perYear slots become a uniform sample without replacement.
        for (let i = 0; i < perYear; i++) {
            const j = i + Math.floor(rng() * (candidates.length - i));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        picks.push(...candidates.slice(0, perYear).sort(compareRows));
    }
    return picks;
}

/**
 * One exact-match clause per station-day. Values are validated rather than escaped, because they
 * come from our own files and anything else in a SoQL literal is a bug worth stopping on.
 */
export function buildWhereClause(queries: readonly StationDayQuery[]): string {
    return queries
        .map(({ ctaStationId, serviceDate }) => {
            if (!/^\d+$/.test(ctaStationId) || !isCalendarDate(serviceDate)) {
                throw new Error(`Refusing to build SoQL from unsafe value ${JSON.stringify({ ctaStationId, serviceDate })}.`);
            }
            return `(station_id='${ctaStationId}' AND date='${serviceDate}T00:00:00.000')`;
        })
        .join(" OR ");
}

function parseUpstreamRow(raw: unknown): UpstreamRow {
    if (typeof raw !== "object" || raw === null) throw new Error("Socrata returned a row that is not an object.");
    const row = raw as Record<string, unknown>;
    const rides = Number(row.rides);
    if (typeof row.station_id !== "string" || typeof row.date !== "string" || !Number.isSafeInteger(rides)) {
        throw new Error(`Socrata returned an unexpected row: ${JSON.stringify(row)}`);
    }
    return {
        ctaStationId: row.station_id,
        serviceDate: row.date.slice(0, 10),
        stationName: typeof row.stationname === "string" ? row.stationname : null,
        dayType: typeof row.daytype === "string" ? row.daytype : null,
        rides,
    };
}

async function fetchUpstream(
    queries: readonly StationDayQuery[],
    fetchFn: UpstreamFetch,
    appToken: string | undefined,
): Promise<UpstreamRow[]> {
    const url = new URL(SOCRATA_ENDPOINT);
    url.searchParams.set("$select", "station_id,stationname,date,daytype,rides");
    url.searchParams.set("$where", buildWhereClause(queries));
    url.searchParams.set("$order", "station_id,date");
    url.searchParams.set("$limit", "1000");

    const headers: Record<string, string> = { Accept: "application/json" };
    if (appToken) headers["X-App-Token"] = appToken;

    const response = await fetchFn(url.toString(), { headers });
    if (!response.ok) throw new Error(`Socrata request failed with HTTP ${response.status}.`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error("Socrata returned a body that is not an array.");
    return body.map(parseUpstreamRow);
}

/** Streams the export and keeps only rows from the sampled years (about 50k of 1.26M per year). */
export async function readExportRows(csvPath: string, years: readonly number[]): Promise<ExportRow[]> {
    const prefixes = years.map((year) => `${year}-`);
    const lines = readline.createInterface({
        input: fs.createReadStream(csvPath, { encoding: "utf8" }),
        crlfDelay: Infinity,
    });

    const rows: ExportRow[] = [];
    let sawHeader = false;
    for await (const line of lines) {
        if (!sawHeader) {
            if (line.replace(/^﻿/, "") !== CSV_HEADER) {
                throw new Error(`${csvPath} does not start with the export header ${CSV_HEADER}.`);
            }
            sawHeader = true;
            continue;
        }
        if (line === "") continue;

        const fields = line.split(",");
        if (fields.length !== 4) throw new Error(`Unexpected export line: ${line}`);
        const [stationId, serviceDate, entriesText, dayType] = fields;
        if (!prefixes.some((prefix) => serviceDate.startsWith(prefix))) continue;

        const entries = Number(entriesText);
        if (!Number.isSafeInteger(entries)) throw new Error(`Unexpected entries in export line: ${line}`);
        rows.push({ stationId, serviceDate, entries, dayType });
    }
    if (!sawHeader) throw new Error(`${csvPath} is empty.`);
    return rows;
}

/** Station uuid to CTA station id, from the snapshot's `externalId` (its `ctaStationId` is wrong for four stations). */
export function readCtaStationIds(sqlitePath: string): Map<string, string | null> {
    if (!fs.existsSync(sqlitePath)) throw new Error(`Snapshot not found: ${sqlitePath}`);
    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
        const rows = db.prepare(`SELECT "id", "externalId" FROM "Station"`).all();
        return new Map(
            rows.map((row) => [String(row.id), typeof row.externalId === "string" ? row.externalId : null]),
        );
    } finally {
        db.close();
    }
}

export async function sampleUpstream(options: SampleOptions): Promise<SampleReport> {
    const seed = options.seed ?? DEFAULT_SEED;
    const perYear = options.perYear ?? DEFAULT_PER_YEAR;
    const years = [...(options.years ?? DEFAULT_YEARS)];
    const fetchFn: UpstreamFetch = options.fetch ?? fetch;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`Seed must be a 32-bit unsigned integer, got ${seed}.`);
    if (!Number.isInteger(perYear) || perYear < 1) throw new Error(`Sample size per year must be a positive integer, got ${perYear}.`);

    const ctaIds = readCtaStationIds(options.sqlitePath);
    const picks = sampleStationDays(await readExportRows(options.csvPath, years), { years, perYear, seed });

    const unmapped = [...new Set(picks.map((pick) => pick.stationId))].filter((id) => !ctaIds.get(id));
    if (unmapped.length > 0) {
        throw new Error(`The snapshot has no CTA station id (Station.externalId) for ${unmapped.join(", ")}.`);
    }
    const queries: StationDayQuery[] = picks.map((pick) => ({
        ctaStationId: ctaIds.get(pick.stationId) as string,
        serviceDate: pick.serviceDate,
    }));

    const upstreamRows: UpstreamRow[] = [];
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
        upstreamRows.push(...(await fetchUpstream(queries.slice(i, i + BATCH_SIZE), fetchFn, options.appToken)));
    }
    const upstreamByKey = Map.groupBy(upstreamRows, (row) => `${row.ctaStationId}|${row.serviceDate}`);

    const samples = picks.map((pick, index): SampleResult => {
        const { ctaStationId } = queries[index];
        const hits = upstreamByKey.get(`${ctaStationId}|${pick.serviceDate}`) ?? [];
        const first = hits[0] ?? null;
        const status = hits.length === 0 ? "missing" : hits.every((hit) => hit.rides === pick.entries) ? "match" : "mismatch";
        return {
            year: Number(pick.serviceDate.slice(0, 4)),
            stationId: pick.stationId,
            ctaStationId,
            serviceDate: pick.serviceDate,
            storedEntries: pick.entries,
            upstreamRides: first?.rides ?? null,
            upstreamRowCount: hits.length,
            upstreamStationName: first?.stationName ?? null,
            derivedDayType: pick.dayType,
            upstreamDayType: first?.dayType ?? null,
            dayTypeDiffers: first?.dayType ? first.dayType !== pick.dayType : null,
            status,
        };
    });

    const ridesMismatches = samples.filter((sample) => sample.status === "mismatch").length;
    const missingUpstream = samples.filter((sample) => sample.status === "missing").length;
    return {
        ok: ridesMismatches === 0 && missingUpstream === 0,
        dataset: DATASET_ID,
        csvPath: path.resolve(options.csvPath),
        seed,
        perYear,
        years,
        sampled: samples.length,
        ridesMismatches,
        missingUpstream,
        dayTypeDifferences: samples.filter((sample) => sample.dayTypeDiffers === true).length,
        samples,
    };
}

async function main(argv: string[]): Promise<number> {
    const { values } = parseArgs({
        args: argv,
        options: {
            csv: { type: "string", default: "exports/ridership-history.csv" },
            sqlite: { type: "string", default: "prisma/dev.db" },
            seed: { type: "string", default: String(DEFAULT_SEED) },
            "per-year": { type: "string", default: String(DEFAULT_PER_YEAR) },
            years: { type: "string", default: DEFAULT_YEARS.join(",") },
        },
    });

    try {
        const report = await sampleUpstream({
            csvPath: values.csv,
            sqlitePath: values.sqlite,
            seed: Number(values.seed),
            perYear: Number(values["per-year"]),
            years: values.years.split(",").map((year) => Number(year.trim())),
            appToken: process.env.CHICAGO_DATA_APP_TOKEN?.trim() || undefined,
        });
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) {
            console.error(
                `Upstream sample failed: ${report.ridesMismatches} rides mismatches, ${report.missingUpstream} missing upstream.`,
            );
        }
        return report.ok ? 0 : 1;
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

if (isCliEntry(import.meta.url)) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}
