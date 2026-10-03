#!/usr/bin/env tsx

/**
 * Exports the deduplicated ridership history from the local SQLite snapshot to a CSV that loads
 * straight into the v2 `RidershipDaily` table (revival plan U7, KTD3):
 *
 *   npx tsx scripts/export-history.ts --sqlite prisma/dev.db --station-ids <file> \
 *     --out exports/ridership-history.csv --through 2025-11-30
 *
 *   \copy "RidershipDaily" ("stationId","serviceDate","entries","dayType") FROM '<file>' WITH (FORMAT csv, HEADER true)
 *
 * The snapshot is opened read-only. Every assertion that fails exits non-zero, prints the summary
 * with its errors, and leaves no CSV behind, so a half-checked file can never be loaded.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The snapshot's last service date; the plan exports history through this day. */
export const HISTORY_THROUGH = "2025-11-30";

export const CSV_HEADER = "stationId,serviceDate,entries,dayType";

/**
 * The two Western stations whose `ctaStationId` values were swapped in the snapshot, so the Go
 * matcher filed each one's history under the other back to 2001. Their rows are left out of the
 * export entirely and re-fetched from Socrata by the U10 local runner.
 */
export const WESTERN_STATIONS = [
    { id: "9708ddfb0e6569405ab05449a77146ef", name: "Western (Blue, O'Hare branch)", ctaStationId: "40670" },
    { id: "35de68ed0714222a92455c3a04a8e0c1", name: "Western (Orange)", ctaStationId: "40310" },
] as const;

/**
 * Stations whose snapshot history before a date mixes in another CTA id's rows. Washington (Blue)
 * 40370 shared its matcher name with Washington/State 40500 (closed 2006), so through 2009 its days
 * hold whichever of the two the Go ETL wrote last; from 2010 on it equals upstream exactly. Rows
 * before `before` are left out and re-fetched from Socrata in Phase 2.
 */
export const MISATTRIBUTED_BEFORE = [
    { id: "5ff3a5463d2a2c0f594a157ace4849e7", name: "Washington (Blue)", ctaStationId: "40370", before: "2010-01-01" },
] as const;

const EXAMPLE_LIMIT = 5;
const FLUSH_AT_CHARS = 1 << 20;

/** The Go ETL wrote RFC3339 midnights; these are the rows the export keeps. */
const RFC3339_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00Z$/;
/** The manual backfill script wrote this shape; each such row is expected to duplicate an ETL row. */
const MANUAL_MIDNIGHT = /^(\d{4}-\d{2}-\d{2}) 00:00:00$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DayType = "W" | "A" | "U";
export type ServiceDateFormat = "rfc3339" | "manual";

export interface NormalizedServiceDate {
    date: string;
    format: ServiceDateFormat;
}

export interface ExportOptions {
    sqlitePath: string;
    /** Every exported station id must be in this set (production's `Station.id` values). */
    productionStationIds: ReadonlySet<string>;
    outPath: string;
    through?: string;
    /** Stations to drop in addition to the two Western stations. Recorded in the summary. */
    excludeStationIds?: readonly string[];
    /** Stations whose non-RFC3339 rows may be kept when they have no twin. Recorded in the summary. */
    keepUntwinnedStationIds?: readonly string[];
}

export interface TwinDisagreement {
    stationId: string;
    serviceDate: string;
    rfc3339Entries: number;
    nonRfc3339Entries: number;
}

export interface DateSpan {
    rows: number;
    minDate: string;
    maxDate: string;
}

export interface ExportSummary {
    ok: boolean;
    errors: string[];
    sqlitePath: string;
    /** The written CSV, or null when an assertion failed and nothing was kept. */
    output: string | null;
    through: string;
    options: { extraExcludedStationIds: string[]; keepUntwinnedStationIds: string[] };
    rowsRead: number;
    serviceDateShapes: { rfc3339: number; manual: number; unrecognized: number };
    unrecognizedServiceDateExamples: string[];
    orphanRowsDropped: number;
    orphanStationIds: string[];
    excludedRowsDropped: Record<string, number>;
    /** Rows dropped by MISATTRIBUTED_BEFORE, per station. */
    misattributedRowsDropped: Record<string, number>;
    rfc3339RowsKept: number;
    /** Non-RFC3339 rows dropped because an RFC3339 row exists for the same station and date. */
    nonRfc3339RowsDropped: number;
    nonRfc3339RowsWithoutTwin: number;
    untwinnedByStation: Record<string, DateSpan>;
    /** Untwinned non-RFC3339 rows kept because their station was named in keepUntwinnedStationIds. */
    nonRfc3339RowsKept: number;
    twinDisagreements: {
        exported: number;
        excluded: number;
        excludedByStation: Record<string, number>;
        examples: TwinDisagreement[];
    };
    rowsAfterThrough: number;
    invalidEntries: number;
    duplicateStationDates: number;
    stationIdsMissingFromProduction: string[];
    rowsWritten: number;
    distinctStationDates: number;
    distinctStations: number;
    minDate: string | null;
    maxDate: string | null;
    rowsPerYear: Record<string, number>;
}

/** Carries the summary so the CLI can print what was found before exiting non-zero. */
export class ExportHistoryError extends Error {
    readonly summary: ExportSummary;

    constructor(message: string, summary: ExportSummary) {
        super(message);
        this.name = "ExportHistoryError";
        this.summary = summary;
    }
}

export function isCalendarDate(value: string): boolean {
    const match = ISO_DATE.exec(value);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/**
 * Maps a snapshot `serviceDate` to a calendar date and the writer that produced it. Returns null
 * for any other shape (offsets, fractions, non-midnight times) rather than guessing which day it
 * meant, so an unexpected input fails the export instead of shifting a row by a day.
 */
export function normalizeServiceDate(raw: string): NormalizedServiceDate | null {
    const rfc3339 = RFC3339_MIDNIGHT.exec(raw);
    const match = rfc3339 ?? MANUAL_MIDNIGHT.exec(raw);
    if (!match || !isCalendarDate(match[1])) return null;
    return { date: match[1], format: rfc3339 ? "rfc3339" : "manual" };
}

/**
 * Day type from the calendar alone: Saturday A, Sunday U, otherwise W. Weekday holidays stay W;
 * the sync overwrites day type with Socrata's value for every row it re-fetches.
 */
export function deriveDayType(isoDate: string): DayType {
    if (!isCalendarDate(isoDate)) throw new Error(`${isoDate} is not a calendar date.`);
    const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
    if (weekday === 6) return "A";
    if (weekday === 0) return "U";
    return "W";
}

/** Minimal RFC 4180 reader: quoted fields may hold commas, doubled quotes, and newlines. */
export function parseCsv(text: string): string[][] {
    const records: string[][] = [];
    let record: string[] = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            record.push(field);
            field = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            record.push(field);
            records.push(record);
            record = [];
            field = "";
        } else {
            field += ch;
        }
    }
    if (inQuotes) throw new Error("CSV ends inside a quoted field.");
    if (field !== "" || record.length > 0) {
        record.push(field);
        records.push(record);
    }
    return records;
}

/**
 * Reads production station ids from a plain list (one uuid per line) or from a CSV export of
 * `Station` whose first column header is `id`.
 */
export function readStationIdList(filePath: string): Set<string> {
    const text = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
    const records = parseCsv(text).filter((record) => record.some((field) => field.trim() !== ""));
    const hasHeader = records.length > 0 && records[0][0].trim() === "id";
    if (!hasHeader && records.some((record) => record.length > 1)) {
        throw new Error(`${filePath} has several columns but no first column header "id".`);
    }

    const ids = new Set(
        records
            .slice(hasHeader ? 1 : 0)
            .map((record) => record[0].trim())
            .filter((id) => id !== ""),
    );
    if (ids.size === 0) throw new Error(`${filePath} lists no station ids.`);
    return ids;
}

function csvField(value: string): string {
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Buffers lines and writes them in about 1 MB batches; the full export is roughly 1.26M rows. */
class BatchedWriter {
    private fd: number | null;
    private chunks: string[] = [];
    private size = 0;

    constructor(filePath: string) {
        this.fd = fs.openSync(filePath, "w");
    }

    write(text: string): void {
        this.chunks.push(text);
        this.size += text.length;
        if (this.size >= FLUSH_AT_CHARS) this.flush();
    }

    close(): void {
        if (this.fd === null) return;
        this.flush();
        fs.closeSync(this.fd);
        this.fd = null;
    }

    discard(): void {
        if (this.fd === null) return;
        fs.closeSync(this.fd);
        this.fd = null;
    }

    private flush(): void {
        if (this.fd === null || this.chunks.length === 0) return;
        const buffer = Buffer.from(this.chunks.join(""), "utf8");
        let offset = 0;
        while (offset < buffer.length) offset += fs.writeSync(this.fd, buffer, offset);
        this.chunks = [];
        this.size = 0;
    }
}

interface RawRow {
    serviceDate: SQLOutputValue;
    entries: SQLOutputValue;
}

/** Yields each station's rows together; the query orders by station id, so groups are contiguous. */
function* groupByStation(rows: Iterable<Record<string, SQLOutputValue>>): Generator<[string, RawRow[]]> {
    const seen = new Set<string>();
    let current: string | null = null;
    let group: RawRow[] = [];

    for (const row of rows) {
        const stationId = row.stationId;
        if (typeof stationId !== "string") throw new Error(`RidershipDaily.stationId is not text: ${String(stationId)}`);
        if (stationId !== current) {
            if (current !== null) yield [current, group];
            if (seen.has(stationId)) throw new Error(`Rows for station ${stationId} were not contiguous.`);
            seen.add(stationId);
            current = stationId;
            group = [];
        }
        group.push({ serviceDate: row.serviceDate, entries: row.entries });
    }
    if (current !== null) yield [current, group];
}

function emptySummary(sqlitePath: string, through: string, options: ExportOptions): ExportSummary {
    return {
        ok: false,
        errors: [],
        sqlitePath,
        output: null,
        through,
        options: {
            extraExcludedStationIds: [...(options.excludeStationIds ?? [])],
            keepUntwinnedStationIds: [...(options.keepUntwinnedStationIds ?? [])],
        },
        rowsRead: 0,
        serviceDateShapes: { rfc3339: 0, manual: 0, unrecognized: 0 },
        unrecognizedServiceDateExamples: [],
        orphanRowsDropped: 0,
        orphanStationIds: [],
        excludedRowsDropped: {},
        misattributedRowsDropped: {},
        rfc3339RowsKept: 0,
        nonRfc3339RowsDropped: 0,
        nonRfc3339RowsWithoutTwin: 0,
        untwinnedByStation: {},
        nonRfc3339RowsKept: 0,
        twinDisagreements: { exported: 0, excluded: 0, excludedByStation: {}, examples: [] },
        rowsAfterThrough: 0,
        invalidEntries: 0,
        duplicateStationDates: 0,
        stationIdsMissingFromProduction: [],
        rowsWritten: 0,
        distinctStationDates: 0,
        distinctStations: 0,
        minDate: null,
        maxDate: null,
        rowsPerYear: {},
    };
}

interface ParsedRow {
    date: string;
    format: ServiceDateFormat;
    entries: SQLOutputValue;
}

function collectErrors(summary: ExportSummary): string[] {
    const errors: string[] = [];
    const { serviceDateShapes, twinDisagreements } = summary;

    if (serviceDateShapes.unrecognized > 0) {
        errors.push(
            `${serviceDateShapes.unrecognized} rows have an unrecognized serviceDate shape ` +
                `(examples: ${summary.unrecognizedServiceDateExamples.join(", ")})`,
        );
    }
    if (summary.nonRfc3339RowsWithoutTwin > 0) {
        const spans = Object.entries(summary.untwinnedByStation)
            .map(([id, span]) => `${id}: ${span.rows} rows ${span.minDate}..${span.maxDate}`)
            .join("; ");
        errors.push(
            `${summary.nonRfc3339RowsWithoutTwin} non-RFC3339 rows have no RFC3339 twin (${spans}). ` +
                "Decide explicitly with --keep-untwinned-station or --exclude-station",
        );
    }
    if (twinDisagreements.exported > 0) {
        const examples = twinDisagreements.examples
            .map((e) => `${e.stationId} ${e.serviceDate}: ${e.rfc3339Entries} vs ${e.nonRfc3339Entries}`)
            .join("; ");
        errors.push(
            `${twinDisagreements.exported} RFC3339 twin pairs disagree on entries in exported stations (${examples})`,
        );
    }
    if (summary.rowsAfterThrough > 0) {
        errors.push(
            `${summary.rowsAfterThrough} rows are dated after ${summary.through} (latest ${summary.maxDate}); ` +
                "the snapshot is not the one this export was planned against",
        );
    }
    if (summary.invalidEntries > 0) {
        errors.push(`${summary.invalidEntries} rows have entries that are not a non-negative integer`);
    }
    if (summary.distinctStationDates !== summary.rowsWritten) {
        errors.push(
            `distinct station-dates (${summary.distinctStationDates}) does not equal rows written (${summary.rowsWritten})`,
        );
    }
    if (summary.stationIdsMissingFromProduction.length > 0) {
        errors.push(
            `${summary.stationIdsMissingFromProduction.length} exported station ids are not in the production ` +
                `Station list: ${summary.stationIdsMissingFromProduction.join(", ")}`,
        );
    }
    return errors;
}

/**
 * Exports the deduplicated history. Throws ExportHistoryError (with the summary) when any
 * assertion fails; the CSV is written to a `.partial` file and renamed only after every check passes.
 */
export function exportHistory(options: ExportOptions): ExportSummary {
    const through = options.through ?? HISTORY_THROUGH;
    if (!isCalendarDate(through)) throw new Error(`The through date must be YYYY-MM-DD, got ${through}.`);

    const sqlitePath = path.resolve(options.sqlitePath);
    const outPath = path.resolve(options.outPath);
    if (outPath === sqlitePath) throw new Error(`Output path ${outPath} would overwrite the snapshot.`);
    if (!fs.existsSync(sqlitePath)) throw new Error(`Snapshot not found: ${sqlitePath}`);

    const summary = emptySummary(sqlitePath, through, options);
    const excluded = new Set<string>([...WESTERN_STATIONS.map((station) => station.id), ...summary.options.extraExcludedStationIds]);
    const keepUntwinned = new Set(summary.options.keepUntwinnedStationIds);
    const partialPath = `${outPath}.partial`;

    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    let writer: BatchedWriter | null = null;
    let renamed = false;

    try {
        const snapshotStationIds = new Set(
            db.prepare(`SELECT "id" FROM "Station"`).all().map((row) => String(row.id)),
        );
        for (const id of [...excluded, ...keepUntwinned]) {
            if (!snapshotStationIds.has(id)) throw new Error(`Station ${id} named in the options is not in the snapshot.`);
        }

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        writer = new BatchedWriter(partialPath);
        writer.write(`${CSV_HEADER}\n`);

        const rows = db.prepare(`SELECT "stationId", "serviceDate", "entries" FROM "RidershipDaily" ORDER BY "stationId"`).iterate();

        for (const [stationId, rawRows] of groupByStation(rows)) {
            summary.rowsRead += rawRows.length;

            const parsed: ParsedRow[] = [];
            for (const raw of rawRows) {
                const normalized = typeof raw.serviceDate === "string" ? normalizeServiceDate(raw.serviceDate) : null;
                if (!normalized) {
                    summary.serviceDateShapes.unrecognized++;
                    if (summary.unrecognizedServiceDateExamples.length < EXAMPLE_LIMIT) {
                        summary.unrecognizedServiceDateExamples.push(String(raw.serviceDate));
                    }
                    continue;
                }
                summary.serviceDateShapes[normalized.format]++;
                parsed.push({ ...normalized, entries: raw.entries });
            }

            if (!snapshotStationIds.has(stationId)) {
                summary.orphanRowsDropped += rawRows.length;
                summary.orphanStationIds.push(stationId);
                continue;
            }
            const isExcluded = excluded.has(stationId);
            if (isExcluded) summary.excludedRowsDropped[stationId] = rawRows.length;

            const cutoff = isExcluded ? undefined : MISATTRIBUTED_BEFORE.find((s) => s.id === stationId)?.before;
            const inRange = cutoff ? parsed.filter((row) => row.date >= cutoff) : parsed;
            if (cutoff) summary.misattributedRowsDropped[stationId] = parsed.length - inRange.length;

            const rfc3339ByDate = new Map<string, SQLOutputValue>();
            for (const row of inRange) {
                if (row.format === "rfc3339" && !rfc3339ByDate.has(row.date)) rfc3339ByDate.set(row.date, row.entries);
            }

            const kept: ParsedRow[] = [];
            for (const row of inRange) {
                if (row.format === "rfc3339") {
                    kept.push(row);
                    continue;
                }
                if (rfc3339ByDate.has(row.date)) {
                    const twinEntries = rfc3339ByDate.get(row.date);
                    if (twinEntries !== row.entries) {
                        if (isExcluded) {
                            summary.twinDisagreements.excluded++;
                            summary.twinDisagreements.excludedByStation[stationId] =
                                (summary.twinDisagreements.excludedByStation[stationId] ?? 0) + 1;
                        } else {
                            summary.twinDisagreements.exported++;
                            if (summary.twinDisagreements.examples.length < EXAMPLE_LIMIT) {
                                summary.twinDisagreements.examples.push({
                                    stationId,
                                    serviceDate: row.date,
                                    rfc3339Entries: Number(twinEntries),
                                    nonRfc3339Entries: Number(row.entries),
                                });
                            }
                        }
                    }
                    if (!isExcluded) summary.nonRfc3339RowsDropped++;
                    continue;
                }
                // An excluded station's rows are all dropped and counted in excludedRowsDropped.
                if (isExcluded) continue;

                if (keepUntwinned.has(stationId)) {
                    kept.push(row);
                    summary.nonRfc3339RowsKept++;
                    continue;
                }
                summary.nonRfc3339RowsWithoutTwin++;
                const span = summary.untwinnedByStation[stationId];
                if (span) {
                    span.rows++;
                    if (row.date < span.minDate) span.minDate = row.date;
                    if (row.date > span.maxDate) span.maxDate = row.date;
                } else {
                    summary.untwinnedByStation[stationId] = { rows: 1, minDate: row.date, maxDate: row.date };
                }
            }
            if (isExcluded || kept.length === 0) continue;

            summary.rfc3339RowsKept += kept.filter((row) => row.format === "rfc3339").length;
            if (!options.productionStationIds.has(stationId)) summary.stationIdsMissingFromProduction.push(stationId);
            summary.distinctStations++;

            kept.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
            let previousDate: string | null = null;
            for (const row of kept) {
                if (row.date === previousDate) {
                    summary.duplicateStationDates++;
                } else {
                    summary.distinctStationDates++;
                }
                previousDate = row.date;

                if (row.date > through) summary.rowsAfterThrough++;
                if (typeof row.entries !== "number" || !Number.isSafeInteger(row.entries) || row.entries < 0) {
                    summary.invalidEntries++;
                }

                writer.write(`${csvField(stationId)},${row.date},${String(row.entries)},${deriveDayType(row.date)}\n`);
                summary.rowsWritten++;
                const year = row.date.slice(0, 4);
                summary.rowsPerYear[year] = (summary.rowsPerYear[year] ?? 0) + 1;
                if (summary.minDate === null || row.date < summary.minDate) summary.minDate = row.date;
                if (summary.maxDate === null || row.date > summary.maxDate) summary.maxDate = row.date;
            }
        }

        writer.close();
        summary.errors = collectErrors(summary);
        if (summary.errors.length > 0) {
            throw new ExportHistoryError(`History export failed: ${summary.errors.join("; ")}.`, summary);
        }

        fs.renameSync(partialPath, outPath);
        renamed = true;
        summary.ok = true;
        summary.output = outPath;
        return summary;
    } finally {
        writer?.discard();
        db.close();
        if (!renamed) fs.rmSync(partialPath, { force: true });
    }
}

function main(argv: string[]): number {
    const { values } = parseArgs({
        args: argv,
        options: {
            sqlite: { type: "string", default: "prisma/dev.db" },
            "station-ids": { type: "string" },
            out: { type: "string", default: "exports/ridership-history.csv" },
            through: { type: "string", default: HISTORY_THROUGH },
            "exclude-station": { type: "string", multiple: true, default: [] },
            "keep-untwinned-station": { type: "string", multiple: true, default: [] },
        },
    });

    const stationIdsPath = values["station-ids"];
    if (!stationIdsPath) {
        console.error("--station-ids <file> is required: production Station ids, one per line or a CSV with an id column.");
        return 2;
    }

    try {
        const summary = exportHistory({
            sqlitePath: values.sqlite,
            productionStationIds: readStationIdList(stationIdsPath),
            outPath: values.out,
            through: values.through,
            excludeStationIds: values["exclude-station"],
            keepUntwinnedStationIds: values["keep-untwinned-station"],
        });
        console.log(JSON.stringify(summary, null, 2));
        return 0;
    } catch (error) {
        if (error instanceof ExportHistoryError) console.log(JSON.stringify(error.summary, null, 2));
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

function isCliEntry(moduleUrl: string): boolean {
    const entry = process.argv[1];
    return entry !== undefined && path.resolve(entry) === fileURLToPath(moduleUrl);
}

if (isCliEntry(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
