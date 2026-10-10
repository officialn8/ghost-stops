/**
 * CTA Train Tracker, the one module that knows the service's base URL (R12, R15; KTD4, KTD14,
 * KTD15). Callers depend on `TrainSource`, so GTFS-Realtime vehicle positions can replace this
 * client once that feed leaves beta.
 *
 * The key travels in the query string, so no request URL is ever logged, put in an error, or
 * handed to the recorder: errors carry an endpoint name and CTA's error code, and the raw body
 * reaches `onCall` with every occurrence of the key replaced. Every call, failed ones included,
 * reaches `onCall`, which is where the worker counts calls against the daily quota and writes the
 * raw line (KTD3). Error 102 is the quota stop and error 101 a revoked key; both are typed.
 *
 * Documented quirks handled here: JSON values are strings ("0" and "1" for flags), a route with
 * one train or a station with one prediction may answer with an object where an array is
 * expected, `route` names are lowercase while `rt` in arrivals is mixed case, and timestamps are
 * naive Chicago local in either "yyyyMMdd HH:mm:ss" or ISO-like form
 * (docs-private/reference/cta-train-tracker-api.md).
 */
import { parseChicagoLocal } from "./serviceDay";

const TRAIN_TRACKER_BASE = "https://lapi.transitchicago.com/api/1.0/";

/** The eight routes as the positions feed names them; one positions call covers them all. */
export const TRAIN_ROUTES = ["red", "blue", "brn", "g", "org", "p", "pink", "y"] as const;
export type TrainRoute = (typeof TRAIN_ROUTES)[number];

/** Stations per arrivals call (error 105 above it), so 144 stations take 36 calls. */
export const ARRIVALS_BATCH_SIZE = 4;

export const DEFAULT_TIMEOUT_MS = 10_000;

/** A body past this is a failed poll, never parsed: a positions response is tens of kilobytes. */
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

export const QUOTA_ERROR_CODE = 102;
export const KEY_ERROR_CODE = 101;

export type Endpoint = "positions" | "arrivals";

export type TrainTrackerFailure = "timeout" | "network" | "http" | "oversize" | "parse" | "api" | "quota" | "key";

/** One call as the recorder and the quota counter see it: an endpoint name, never a URL. */
export interface RawCall {
    endpoint: Endpoint;
    /** When the request was sent, epoch ms: the poll epoch every timestamp in the body is ordered by. */
    pollEpoch: number;
    /** The arrivals batch's station ids; empty for positions. */
    stationIds: string[];
    httpStatus: number | null;
    /** The response text with the key replaced; null when no body was read. */
    body: string | null;
    /** CTA's `errCd` (0 on success); null when no body parsed. */
    errorCode: number | null;
    failure: TrainTrackerFailure | null;
    durationMs: number;
}

export class TrainTrackerError extends Error {
    override name = "TrainTrackerError";
    constructor(
        readonly endpoint: Endpoint,
        readonly failure: TrainTrackerFailure,
        message: string,
        /** CTA's error code when the service answered with one. */
        readonly code: number | null = null,
    ) {
        super(message);
    }
}

/** Error 102: the key's daily transactions are spent until CTA's midnight reset (KTD14). */
export class TrainTrackerQuotaError extends TrainTrackerError {
    override name = "TrainTrackerQuotaError";
    constructor(endpoint: Endpoint) {
        super(endpoint, "quota", `Train Tracker ${endpoint}: daily usage exceeded (error ${QUOTA_ERROR_CODE})`, QUOTA_ERROR_CODE);
    }
}

/** Error 101: the key is invalid or revoked; polling cannot continue. */
export class TrainTrackerKeyError extends TrainTrackerError {
    override name = "TrainTrackerKeyError";
    constructor(endpoint: Endpoint) {
        super(endpoint, "key", `Train Tracker ${endpoint}: invalid key (error ${KEY_ERROR_CODE})`, KEY_ERROR_CODE);
    }
}

export interface TrainPosition {
    route: TrainRoute;
    /** The run number (`rn`); reused across the day, so never a trip key on its own. */
    run: string;
    destinationStopId: string;
    destinationName: string;
    /** CTA's operational direction (`trDr`), 1 or 5, with a meaning per route. */
    direction: number;
    /** The next station (4xxxx) and platform (3xxxx) the train will reach. */
    nextStationId: string;
    nextStopId: string;
    nextStationName: string;
    /** When the prediction was generated and the predicted arrival, epoch ms. */
    predictedAt: number;
    arrivalAt: number;
    approaching: boolean;
    delayed: boolean;
    lat: number | null;
    lon: number | null;
    heading: number | null;
}

export interface RoutePositions {
    route: TrainRoute;
    trains: TrainPosition[];
}

export interface PositionsResponse {
    /** `tmst`, when CTA generated the response, epoch ms. */
    generatedAt: number;
    pollEpoch: number;
    /** Every route in `TRAIN_ROUTES` order; a route with no train in service has an empty array. */
    routes: RoutePositions[];
    /** Entries the parser could not read; the reducer's feed-shape check counts them (KTD7). */
    malformed: number;
}

export interface ArrivalPrediction {
    /** The parent station (`staId`, 4xxxx, the roster's CTA id) and the platform (`stpId`, 3xxxx). */
    stationId: string;
    stopId: string;
    stationName: string;
    /** The platform's description, e.g. "Service toward Kimball". */
    platform: string;
    run: string;
    route: TrainRoute;
    /** "0" on a schedule-only entry. */
    destinationStopId: string;
    destinationName: string;
    direction: number;
    predictedAt: number;
    arrivalAt: number;
    /** `arrT` as CTA wrote it, naive Chicago local, the text a schedule-only slot is keyed by. */
    arrivalText: string;
    approaching: boolean;
    /** `isSch`: a schedule-based entry in lieu of live data, the ghost signal. */
    scheduled: boolean;
    /** `isFlt`: CTA's own flag that a scheduled departure did not happen. */
    fault: boolean;
    delayed: boolean;
    lat: number | null;
    lon: number | null;
    heading: number | null;
}

export interface ArrivalsResponse {
    generatedAt: number;
    pollEpoch: number;
    stationIds: string[];
    predictions: ArrivalPrediction[];
    malformed: number;
}

export interface TrainSource {
    /** Every in-service train on all eight routes: one call. */
    positions(): Promise<PositionsResponse>;
    /** Every prediction at up to four stations, by CTA station id. */
    arrivals(stationIds: readonly string[]): Promise<ArrivalsResponse>;
}

/** The subset of `fetch` the client uses, so tests can answer without the network. */
export type HttpFetch = (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<HttpResponse>;

export interface HttpResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
    /** When present, the body is read in chunks so an oversize one is cut off early. */
    body?: ReadableStream<Uint8Array> | null;
}

export interface TrainTrackerOptions {
    key: string;
    fetch?: HttpFetch;
    now?: () => number;
    timeoutMs?: number;
    maxBodyBytes?: number;
    /** Every call, success or failure (KTD3, KTD14). */
    onCall?: (call: RawCall) => void;
}

export const CTA_STATION_ID = /^4\d{4}$/;

type RawRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is RawRecord => typeof value === "object" && value !== null && !Array.isArray(value);

/** CTA answers with an object instead of a one-element array for a single train or prediction. */
function asArray(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function text(record: RawRecord, field: string): string {
    const value = record[field];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    throw new Error(`no ${field}`);
}

function flag(record: RawRecord, field: string): boolean {
    const value = text(record, field);
    if (value === "1") return true;
    if (value === "0") return false;
    throw new Error(`${field} is not 0 or 1`);
}

function optionalNumber(record: RawRecord, field: string): number | null {
    const value = record[field];
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function direction(record: RawRecord): number {
    const value = Number(text(record, "trDr"));
    if (!Number.isInteger(value)) throw new Error("trDr is not an integer");
    return value;
}

function routeId(value: string): TrainRoute {
    const id = value.toLowerCase();
    const route = TRAIN_ROUTES.find((r) => r === id);
    if (!route) throw new Error(`unknown route ${value}`);
    return route;
}

function parsePosition(record: RawRecord, route: TrainRoute, pollEpoch: number): TrainPosition {
    return {
        route,
        run: text(record, "rn"),
        destinationStopId: text(record, "destSt"),
        destinationName: text(record, "destNm"),
        direction: direction(record),
        nextStationId: text(record, "nextStaId"),
        nextStopId: text(record, "nextStpId"),
        nextStationName: text(record, "nextStaNm"),
        predictedAt: parseChicagoLocal(text(record, "prdt"), pollEpoch),
        arrivalAt: parseChicagoLocal(text(record, "arrT"), pollEpoch),
        approaching: flag(record, "isApp"),
        delayed: flag(record, "isDly"),
        lat: optionalNumber(record, "lat"),
        lon: optionalNumber(record, "lon"),
        heading: optionalNumber(record, "heading"),
    };
}

function parsePrediction(record: RawRecord, pollEpoch: number): ArrivalPrediction {
    const arrivalText = text(record, "arrT");
    return {
        stationId: text(record, "staId"),
        stopId: text(record, "stpId"),
        stationName: text(record, "staNm"),
        platform: text(record, "stpDe"),
        run: text(record, "rn"),
        route: routeId(text(record, "rt")),
        destinationStopId: text(record, "destSt"),
        destinationName: text(record, "destNm"),
        direction: direction(record),
        predictedAt: parseChicagoLocal(text(record, "prdt"), pollEpoch),
        arrivalAt: parseChicagoLocal(arrivalText, pollEpoch),
        arrivalText,
        approaching: flag(record, "isApp"),
        scheduled: flag(record, "isSch"),
        fault: flag(record, "isFlt"),
        delayed: flag(record, "isDly"),
        lat: optionalNumber(record, "lat"),
        lon: optionalNumber(record, "lon"),
        heading: optionalNumber(record, "heading"),
    };
}

/** The `ctatt` envelope every endpoint answers with, its error code read. */
function envelope(body: unknown): { ctatt: RawRecord; errorCode: number } {
    const ctatt = isRecord(body) ? body.ctatt : undefined;
    if (!isRecord(ctatt)) throw new Error("no ctatt envelope");
    const errorCode = Number(text(ctatt, "errCd"));
    if (!Number.isInteger(errorCode)) throw new Error("errCd is not an integer");
    return { ctatt, errorCode };
}

/** Parses a positions body (the `ctatt` envelope) as the client does; exported for replays. */
export function parsePositionsBody(body: unknown, pollEpoch: number): PositionsResponse {
    const { ctatt } = envelope(body);
    const generatedAt = parseChicagoLocal(text(ctatt, "tmst"), pollEpoch);
    let malformed = 0;
    const byRoute = new Map<TrainRoute, TrainPosition[]>(TRAIN_ROUTES.map((route) => [route, []]));
    for (const entry of asArray(ctatt.route)) {
        if (!isRecord(entry)) {
            malformed += 1;
            continue;
        }
        let route: TrainRoute;
        try {
            route = routeId(text(entry, "@name"));
        } catch {
            malformed += 1;
            continue;
        }
        const trains = byRoute.get(route) ?? [];
        for (const train of asArray(entry.train)) {
            try {
                if (!isRecord(train)) throw new Error("train is not an object");
                trains.push(parsePosition(train, route, pollEpoch));
            } catch {
                malformed += 1;
            }
        }
        byRoute.set(route, trains);
    }
    return {
        generatedAt,
        pollEpoch,
        routes: TRAIN_ROUTES.map((route) => ({ route, trains: byRoute.get(route) ?? [] })),
        malformed,
    };
}

/** Parses an arrivals body as the client does; exported for replays. */
export function parseArrivalsBody(body: unknown, pollEpoch: number, stationIds: readonly string[]): ArrivalsResponse {
    const { ctatt } = envelope(body);
    const generatedAt = parseChicagoLocal(text(ctatt, "tmst"), pollEpoch);
    let malformed = 0;
    const predictions: ArrivalPrediction[] = [];
    for (const entry of asArray(ctatt.eta)) {
        try {
            if (!isRecord(entry)) throw new Error("eta is not an object");
            predictions.push(parsePrediction(entry, pollEpoch));
        } catch {
            malformed += 1;
        }
    }
    return { generatedAt, pollEpoch, stationIds: [...stationIds], predictions, malformed };
}

/** Every occurrence of the key in a body replaced, so neither the recorder nor a log sees it. */
export function scrubKey(body: string, key: string): string {
    return key === "" ? body : body.split(key).join("[key]");
}

/** Reads a body up to `maxBytes`; "oversize" when it runs past, before the rest is read. */
async function readBody(response: HttpResponse, maxBytes: number): Promise<string | "oversize"> {
    if (response.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel().catch(() => {});
                return "oversize";
            }
            chunks.push(value);
        }
        return Buffer.concat(chunks).toString("utf8");
    }
    const body = await response.text();
    return Buffer.byteLength(body, "utf8") > maxBytes ? "oversize" : body;
}

export function createTrainTracker(options: TrainTrackerOptions): TrainSource {
    const { key } = options;
    if (!key) throw new Error("Train Tracker needs a key");
    const http: HttpFetch = options.fetch ?? globalThis.fetch;
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const headers = { Accept: "application/json" };

    function url(endpoint: Endpoint, params: Record<string, string>): string {
        const target = new URL(endpoint === "positions" ? "ttpositions.aspx" : "ttarrivals.aspx", TRAIN_TRACKER_BASE);
        target.searchParams.set("key", key);
        for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value);
        target.searchParams.set("outputType", "JSON");
        return target.toString();
    }

    /** One call: fetch, cap, scrub, record, parse the envelope. Throws a typed error on any failure. */
    async function call(endpoint: Endpoint, params: Record<string, string>, stationIds: string[]): Promise<{ body: unknown; pollEpoch: number }> {
        const pollEpoch = now();
        const record: RawCall = {
            endpoint,
            pollEpoch,
            stationIds,
            httpStatus: null,
            body: null,
            errorCode: null,
            failure: null,
            durationMs: 0,
        };
        const fail = (failure: TrainTrackerFailure, message: string, code: number | null = null): never => {
            record.failure = failure;
            record.durationMs = now() - pollEpoch;
            options.onCall?.(record);
            if (failure === "quota") throw new TrainTrackerQuotaError(endpoint);
            if (failure === "key") throw new TrainTrackerKeyError(endpoint);
            throw new TrainTrackerError(endpoint, failure, message, code);
        };

        let response: HttpResponse;
        try {
            response = await http(url(endpoint, params), { headers, signal: AbortSignal.timeout(timeoutMs) });
        } catch (error) {
            // The error's own text may carry the URL, so only its kind survives.
            const timedOut = error instanceof Error && error.name === "TimeoutError";
            return fail(timedOut ? "timeout" : "network", `Train Tracker ${endpoint}: ${timedOut ? `timed out after ${timeoutMs} ms` : "network error"}`);
        }
        record.httpStatus = response.status;

        let body: string | "oversize";
        try {
            body = await readBody(response, maxBodyBytes);
        } catch (error) {
            const timedOut = error instanceof Error && error.name === "TimeoutError";
            return fail(timedOut ? "timeout" : "network", `Train Tracker ${endpoint}: body ${timedOut ? "timed out" : "could not be read"}`);
        }
        if (body === "oversize") return fail("oversize", `Train Tracker ${endpoint}: body over ${maxBodyBytes} bytes`);
        record.body = scrubKey(body, key);
        if (!response.ok) return fail("http", `Train Tracker ${endpoint}: HTTP ${response.status}`);

        let parsed: unknown;
        let errorCode: number;
        try {
            parsed = JSON.parse(record.body);
            errorCode = envelope(parsed).errorCode;
        } catch {
            return fail("parse", `Train Tracker ${endpoint}: body is not a Train Tracker JSON document`);
        }
        record.errorCode = errorCode;
        if (errorCode === QUOTA_ERROR_CODE) return fail("quota", "", errorCode);
        if (errorCode === KEY_ERROR_CODE) return fail("key", "", errorCode);
        if (errorCode !== 0) {
            const name = isRecord(parsed) && isRecord(parsed.ctatt) && typeof parsed.ctatt.errNm === "string" ? parsed.ctatt.errNm : "error";
            return fail("api", `Train Tracker ${endpoint}: error ${errorCode} (${name})`, errorCode);
        }
        record.durationMs = now() - pollEpoch;
        options.onCall?.(record);
        return { body: parsed, pollEpoch };
    }

    return {
        async positions() {
            const { body, pollEpoch } = await call("positions", { rt: TRAIN_ROUTES.join(",") }, []);
            return parsePositionsBody(body, pollEpoch);
        },

        async arrivals(stationIds) {
            if (stationIds.length === 0 || stationIds.length > ARRIVALS_BATCH_SIZE) {
                throw new TrainTrackerError("arrivals", "api", `Train Tracker arrivals takes 1 to ${ARRIVALS_BATCH_SIZE} stations, got ${stationIds.length}`);
            }
            for (const id of stationIds) {
                if (!CTA_STATION_ID.test(id)) throw new TrainTrackerError("arrivals", "api", `Not a CTA station id: ${id}`);
            }
            const ids = [...stationIds];
            const { body, pollEpoch } = await call("arrivals", { mapid: ids.join(",") }, ids);
            return parseArrivalsBody(body, pollEpoch, ids);
        },
    };
}
