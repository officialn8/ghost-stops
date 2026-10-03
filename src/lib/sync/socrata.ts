/**
 * Upstream CTA "L" ridership from the Chicago Data Portal (Socrata dataset 5neh-572f), read
 * through SODA 2.1. Callers depend on `RidershipSource`, so SODA 3 can replace this client (KTD4).
 *
 * The app token travels only in the X-App-Token header. Request URLs and headers are never put
 * in an error message or a log line.
 */
import { ISO_DATE, type DateWindow } from "./window";

const RIDERSHIP_DATASET = "5neh-572f";
const RIDERSHIP_ENDPOINT = `https://data.cityofchicago.org/resource/${RIDERSHIP_DATASET}.json`;

/** Rows per request; SODA 2.1 pages with $limit and $offset. */
const PAGE_SIZE = 50_000;

export type DayType = "W" | "A" | "U";

export interface UpstreamDay {
    ctaStationId: string;
    serviceDate: string;
    /** W weekday, A Saturday, U Sunday or holiday. */
    dayType: DayType;
    rides: number;
    /** Socrata's `:updated_at`, used to choose between duplicate rows for one station-day. */
    updatedAt: string;
}

export interface StationMonthTotal {
    ctaStationId: string;
    /** YYYY-MM */
    month: string;
    days: number;
    rides: number;
}

/** A station-day for which upstream holds more than one row (618 of them, all in July and August 2011). */
export interface DuplicateDay {
    ctaStationId: string;
    serviceDate: string;
    rows: number;
    totalRides: number;
    maxRides: number;
    /** True when every row of the day has the same `:updated_at`. */
    sameUpdate: boolean;
}

export interface RidershipSource {
    /** The latest service date upstream has published. */
    maxDate(): Promise<string>;
    /** Every upstream row in the window, optionally only for some stations, in a stable order. */
    fetchDays(window: DateWindow, ctaStationIds?: readonly string[]): Promise<UpstreamDay[]>;
    /** Row count and ride sum for every station and month, for the weekly reconciliation. */
    stationMonthTotals(): Promise<StationMonthTotal[]>;
    duplicateDays(): Promise<DuplicateDay[]>;
}

/** The subset of `fetch` the client uses, so tests can answer without the network. */
export type HttpFetch = (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface SocrataOptions {
    appToken?: string;
    fetch?: HttpFetch;
    timeoutMs?: number;
    /** Waits before each retry of a 429, a 5xx, or a network failure; one retry per entry. */
    retryDelaysMs?: readonly number[];
    pageSize?: number;
}

export class SocrataError extends Error {
    override name = "SocrataError";
}

export const CTA_STATION_ID = /^\d{5}$/;
const DAY_TYPES: ReadonlySet<string> = new Set(["W", "A", "U"]);

type RawRow = Record<string, unknown>;

function text(row: RawRow, field: string): string {
    const value = row[field];
    if (typeof value !== "string") throw new SocrataError(`Upstream row has no ${field}`);
    return value;
}

function count(row: RawRow, field: string): number {
    const value = Number(text(row, field));
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new SocrataError(`Upstream ${field} is not a non-negative integer: ${String(row[field])}`);
    }
    return value;
}

function readCtaStationId(row: RawRow): string {
    const id = text(row, "station_id");
    if (!CTA_STATION_ID.test(id)) throw new SocrataError(`Upstream station_id is not a CTA station id: ${id}`);
    return id;
}

/** Socrata floating timestamps look like 2026-07-31T00:00:00.000; the calendar date is the prefix. */
function calendarDate(row: RawRow, field: string): string {
    const date = text(row, field).slice(0, 10);
    if (!ISO_DATE.test(date)) throw new SocrataError(`Upstream ${field} is not a date: ${String(row[field])}`);
    return date;
}

function parseUpstreamDay(row: RawRow): UpstreamDay {
    const dayType = text(row, "daytype");
    if (!DAY_TYPES.has(dayType)) throw new SocrataError(`Upstream daytype is not W, A, or U: ${dayType}`);
    return {
        ctaStationId: readCtaStationId(row),
        serviceDate: calendarDate(row, "date"),
        dayType: dayType as DayType,
        rides: count(row, "rides"),
        updatedAt: text(row, ":updated_at"),
    };
}

/** A SoQL timestamp literal for a validated calendar date. */
function soqlDate(date: string): string {
    if (!ISO_DATE.test(date)) throw new SocrataError(`Not a YYYY-MM-DD date: ${date}`);
    return `'${date}T00:00:00'`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createSocrataSource(options: SocrataOptions = {}): RidershipSource {
    const http: HttpFetch = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const retryDelaysMs = options.retryDelaysMs ?? [2_000, 8_000];
    const pageSize = options.pageSize ?? PAGE_SIZE;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.appToken) headers["X-App-Token"] = options.appToken;

    async function query(params: Record<string, string>): Promise<RawRow[]> {
        const url = `${RIDERSHIP_ENDPOINT}?${new URLSearchParams(params)}`;
        for (let attempt = 0; ; attempt++) {
            let status: number | null = null;
            try {
                const response = await http(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
                if (response.ok) {
                    const body = await response.json();
                    if (!Array.isArray(body)) throw new SocrataError("Socrata returned a body that is not an array");
                    return body as RawRow[];
                }
                status = response.status;
            } catch (error) {
                if (error instanceof SocrataError) throw error;
                // A network failure or timeout; the error's own text may carry the URL, so drop it.
            }
            const retryable = status === null || status === 429 || status >= 500;
            if (!retryable || attempt >= retryDelaysMs.length) {
                throw new SocrataError(
                    status === null
                        ? "Socrata request failed: network error or timeout"
                        : `Socrata request failed with HTTP ${status}`,
                );
            }
            await sleep(retryDelaysMs[attempt]);
        }
    }

    async function queryAll(params: Record<string, string>): Promise<RawRow[]> {
        const rows: RawRow[] = [];
        for (let offset = 0; ; offset += pageSize) {
            const page = await query({ ...params, $limit: String(pageSize), $offset: String(offset) });
            for (const row of page) rows.push(row);
            if (page.length < pageSize) return rows;
        }
    }

    return {
        async maxDate() {
            const [row] = await query({ $select: "max(date) AS max_date" });
            if (!row) throw new SocrataError("Socrata returned no max date");
            return calendarDate(row, "max_date");
        },

        async fetchDays(window, ctaStationIds) {
            const where = [`date between ${soqlDate(window.start)} and ${soqlDate(window.end)}`];
            if (ctaStationIds && ctaStationIds.length > 0) {
                for (const id of ctaStationIds) {
                    if (!CTA_STATION_ID.test(id)) throw new SocrataError(`Not a CTA station id: ${id}`);
                }
                where.push(`station_id in (${ctaStationIds.map((id) => `'${id}'`).join(",")})`);
            }
            const rows = await queryAll({
                $select: "station_id,date,daytype,rides,:updated_at",
                $where: where.join(" AND "),
                // Deterministic, so paging never skips or repeats a row.
                $order: "date,station_id,:id",
            });
            return rows.map(parseUpstreamDay);
        },

        async stationMonthTotals() {
            const rows = await queryAll({
                $select: "station_id,date_trunc_ym(date) AS month,count(*) AS days,sum(rides) AS rides",
                $group: "station_id,month",
                $order: "month,station_id",
            });
            return rows.map((row) => ({
                ctaStationId: readCtaStationId(row),
                month: calendarDate(row, "month").slice(0, 7),
                days: count(row, "days"),
                rides: count(row, "rides"),
            }));
        },

        async duplicateDays() {
            const rows = await queryAll({
                $select:
                    "station_id,date,count(*) AS n,sum(rides) AS total,max(rides) AS hi," +
                    "min(:updated_at) AS first_update,max(:updated_at) AS last_update",
                $group: "station_id,date",
                $having: "count(*) > 1",
                $order: "date,station_id",
            });
            return rows.map((row) => ({
                ctaStationId: readCtaStationId(row),
                serviceDate: calendarDate(row, "date"),
                rows: count(row, "n"),
                totalRides: count(row, "total"),
                maxRides: count(row, "hi"),
                sameUpdate: text(row, "first_update") === text(row, "last_update"),
            }));
        },
    };
}
