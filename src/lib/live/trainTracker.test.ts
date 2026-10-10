import { describe, expect, it } from "vitest";
import arrivalsSingle from "@/test/fixtures/trains/arrivals-single-eta.json";
import recordedArrivals from "@/test/fixtures/trains/arrivals-2026-10-09.json";
import quotaError from "@/test/fixtures/trains/error-102.json";
import recordedPositions from "@/test/fixtures/trains/positions-2026-10-09.json";
import { parseChicagoLocal } from "./serviceDay";
import {
    ARRIVALS_BATCH_SIZE,
    createTrainTracker,
    DEFAULT_TIMEOUT_MS,
    parseArrivalsBody,
    parsePositionsBody,
    scrubKey,
    TRAIN_ROUTES,
    TrainTrackerError,
    TrainTrackerKeyError,
    TrainTrackerQuotaError,
    type HttpFetch,
    type HttpResponse,
    type RawCall,
} from "./trainTracker";

const KEY = "0123456789abcdef0123456789abcdef";
/** The recording's poll epoch: 22:27 Chicago on 2026-10-09, a few seconds after its tmst. */
const POLL_EPOCH = parseChicagoLocal("2026-10-09 22:27:20");

interface Call {
    url: URL;
    signal: AbortSignal;
}

type Queued = { status: number; body: unknown } | { status: number; text: string } | { stream: string[]; status?: number } | Error | "hang";

/** Answers each request with the next queued response and records what was asked. */
function fakeHttp(responses: Queued[]) {
    const calls: Call[] = [];
    const fetch: HttpFetch = (url, init) => {
        calls.push({ url: new URL(url), signal: init.signal });
        const next = responses.shift();
        if (next === undefined) throw new Error("no response queued");
        if (next instanceof Error) return Promise.reject(next);
        if (next === "hang") {
            return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
        }
        if ("stream" in next) {
            const chunks = [...next.stream];
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    const chunk = chunks.shift();
                    if (chunk === undefined) controller.close();
                    else controller.enqueue(new TextEncoder().encode(chunk));
                },
            });
            const status = next.status ?? 200;
            return Promise.resolve({ ok: status < 300, status, body, text: async () => next.stream.join("") } satisfies HttpResponse);
        }
        const text = "text" in next ? next.text : JSON.stringify(next.body);
        return Promise.resolve({ ok: next.status < 300, status: next.status, text: async () => text } satisfies HttpResponse);
    };
    return { fetch, calls };
}

function tracker(responses: Queued[], options: { timeoutMs?: number; maxBodyBytes?: number } = {}) {
    const http = fakeHttp(responses);
    const recorded: RawCall[] = [];
    const source = createTrainTracker({ key: KEY, fetch: http.fetch, now: () => POLL_EPOCH, onCall: (c) => recorded.push(c), ...options });
    return { source, recorded, calls: http.calls };
}

const noKey = (value: unknown) => expect(JSON.stringify(value) ?? String(value)).not.toContain(KEY);

/** The error a call rejects with; a call that resolves fails the test. */
async function failureOf(call: Promise<unknown>): Promise<Error> {
    const outcome = await call.then(
        () => null,
        (error: unknown) => error,
    );
    if (!(outcome instanceof Error)) throw new Error("expected the call to reject with an Error");
    return outcome;
}

describe("positions", () => {
    it("yields all eight routes from the recording, each with an array of trains", async () => {
        const { source, calls } = tracker([{ status: 200, body: recordedPositions }]);

        const response = await source.positions();

        expect(response.routes.map((r) => r.route)).toEqual([...TRAIN_ROUTES]);
        expect(response.routes.map((r) => r.trains.length)).toEqual([17, 19, 8, 9, 5, 1, 5, 0]);
        expect(response.generatedAt).toBe(parseChicagoLocal("2026-10-09 22:27:15"));
        expect(response.pollEpoch).toBe(POLL_EPOCH);
        expect(response.malformed).toBe(0);
        const [call] = calls;
        expect(call.url.pathname).toBe("/api/1.0/ttpositions.aspx");
        expect(call.url.searchParams.get("rt")).toBe("red,blue,brn,g,org,p,pink,y");
        expect(call.url.searchParams.get("outputType")).toBe("JSON");
    });

    it("types a train's fields: direction a number, flags booleans, timestamps instants", async () => {
        const { source } = tracker([{ status: 200, body: recordedPositions }]);

        const [red] = (await source.positions()).routes;
        expect(red.trains[0]).toEqual({
            route: "red",
            run: "827",
            destinationStopId: "30173",
            destinationName: "Howard",
            direction: 1,
            nextStationId: "41170",
            nextStopId: "30223",
            nextStationName: "Garfield",
            predictedAt: parseChicagoLocal("2026-10-09 22:26:59"),
            arrivalAt: parseChicagoLocal("2026-10-09 22:27:59"),
            approaching: true,
            delayed: false,
            lat: 41.78553,
            lon: -87.63112,
            heading: 358,
        });
    });

    it("normalizes the recording's one-train Purple route (an object) to a one-element array", async () => {
        const { source } = tracker([{ status: 200, body: recordedPositions }]);

        const purple = (await source.positions()).routes.find((r) => r.route === "p");
        expect(purple?.trains).toHaveLength(1);
        expect(purple?.trains[0]).toMatchObject({ run: "524", nextStationName: "Main", direction: 5 });
    });

    it("yields an empty array for the recording's Yellow route, which has no train field", async () => {
        const { source } = tracker([{ status: 200, body: recordedPositions }]);

        expect((await source.positions()).routes.find((r) => r.route === "y")?.trains).toEqual([]);
    });

    it("counts an unreadable train as malformed instead of failing the poll", () => {
        const body = structuredClone(recordedPositions) as { ctatt: { route: { train: Record<string, unknown>[] }[] } };
        body.ctatt.route[0].train[0] = { rn: "1" };

        const parsed = parsePositionsBody(body, POLL_EPOCH);
        expect(parsed.malformed).toBe(1);
        expect(parsed.routes[0].trains).toHaveLength(16);
    });
});

describe("arrivals", () => {
    it("yields the recording's predictions with the flags as booleans and the ids as the roster's strings", async () => {
        const { source, calls } = tracker([{ status: 200, body: recordedArrivals }]);

        const response = await source.arrivals(["40900", "40380", "40830", "41680"]);

        expect(response.predictions).toHaveLength(51);
        expect(response.stationIds).toEqual(["40900", "40380", "40830", "41680"]);
        expect(response.malformed).toBe(0);
        // CTA station ids are five-digit strings everywhere in the repo (the roster keys on them).
        expect(response.predictions[0]).toEqual({
            stationId: "40380",
            stopId: "30075",
            stationName: "Clark/Lake",
            platform: "Service at Outer Loop platform",
            run: "021",
            route: "g",
            destinationStopId: "30004",
            destinationName: "Harlem/Lake",
            direction: 1,
            predictedAt: parseChicagoLocal("2026-10-09 22:27:01"),
            arrivalAt: parseChicagoLocal("2026-10-09 22:28:01"),
            arrivalText: "2026-10-09T22:28:01",
            approaching: true,
            scheduled: false,
            fault: false,
            delayed: false,
            lat: 41.88574,
            lon: -87.63012,
            heading: 269,
        });
        expect(calls[0].url.pathname).toBe("/api/1.0/ttarrivals.aspx");
        expect(calls[0].url.searchParams.get("mapid")).toBe("40900,40380,40830,41680");
    });

    it("reads schedule-only entries, CTA's fault flag, and mixed-case route ids", async () => {
        const { source } = tracker([{ status: 200, body: recordedArrivals }]);

        const { predictions } = await source.arrivals(["40900", "40380", "40830", "41680"]);
        const scheduled = predictions.filter((p) => p.scheduled);
        expect(scheduled).toHaveLength(13);
        expect(scheduled.every((p) => p.destinationStopId === "0" && p.lat === null && p.lon === null)).toBe(true);
        expect(predictions.filter((p) => p.fault).map((p) => [p.stationId, p.route, p.run])).toEqual([["41680", "y", "594"]]);
        expect(new Set(predictions.map((p) => p.route))).toEqual(new Set(["g", "blue", "brn", "org", "pink", "p", "red", "y"]));
    });

    it("normalizes a single prediction answered as an object to a one-element array", async () => {
        const { source } = tracker([{ status: 200, body: arrivalsSingle }]);

        const { predictions } = await source.arrivals(["41680"]);
        expect(predictions).toHaveLength(1);
        expect(predictions[0]).toMatchObject({ stationId: "41680", scheduled: true, fault: true, route: "y" });
    });

    it("parses arrT in the yyyyMMdd HH:mm:ss and the ISO-like forms to the same instant", () => {
        const entry = (recordedArrivals as { ctatt: { eta: Record<string, unknown>[] } }).ctatt.eta[0];
        const compact = { ...entry, prdt: "20261009 22:27:01", arrT: "20261009 22:28:01" };
        const body = (eta: unknown) => ({ ctatt: { tmst: "2026-10-09T22:27:16", errCd: "0", errNm: null, eta } });

        const [a] = parseArrivalsBody(body(entry), POLL_EPOCH, ["40380"]).predictions;
        const [b] = parseArrivalsBody(body(compact), POLL_EPOCH, ["40380"]).predictions;
        expect(b.arrivalAt).toBe(a.arrivalAt);
        expect(b.predictedAt).toBe(a.predictedAt);
    });

    it("refuses a batch over four stations or an id that is not a CTA station id, without a call", async () => {
        const { source, calls } = tracker([]);

        await expect(source.arrivals(["40900", "40380", "40830", "41680", "40010"])).rejects.toThrow(new RegExp(`1 to ${ARRIVALS_BATCH_SIZE}`));
        await expect(source.arrivals(["30075"])).rejects.toThrow(/Not a CTA station id/);
        await expect(source.arrivals([])).rejects.toThrow(TrainTrackerError);
        expect(calls).toEqual([]);
    });
});

describe("failures", () => {
    it("raises the quota error on errCd 102 and records the call as a quota failure", async () => {
        const { source, recorded } = tracker([{ status: 200, body: quotaError }]);

        const failure = await source.positions().catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(TrainTrackerQuotaError);
        expect(failure).toMatchObject({ endpoint: "positions", failure: "quota", code: 102 });
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({ endpoint: "positions", httpStatus: 200, errorCode: 102, failure: "quota", pollEpoch: POLL_EPOCH });
    });

    it("raises the key error on errCd 101", async () => {
        const body = { ctatt: { tmst: "2026-10-09T22:27:16", errCd: "101", errNm: "Invalid API key" } };
        const { source, recorded } = tracker([{ status: 200, body }]);

        await expect(source.arrivals(["40900"])).rejects.toBeInstanceOf(TrainTrackerKeyError);
        expect(recorded[0]).toMatchObject({ endpoint: "arrivals", stationIds: ["40900"], errorCode: 101, failure: "key" });
    });

    it("names any other CTA error by its code", async () => {
        const body = { ctatt: { tmst: "2026-10-09T22:27:16", errCd: "900", errNm: "Server error" } };
        const { source, recorded } = tracker([{ status: 200, body }]);

        await expect(source.positions()).rejects.toMatchObject({ failure: "api", code: 900, message: expect.stringMatching(/900/) });
        expect(recorded[0]).toMatchObject({ errorCode: 900, failure: "api" });
    });

    it("aborts a call at the timeout, ten seconds by default", async () => {
        expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
        const { source, recorded, calls } = tracker(["hang"], { timeoutMs: 20 });

        await expect(source.positions()).rejects.toMatchObject({ failure: "timeout", message: expect.stringMatching(/timed out/) });
        expect(calls[0].signal.aborted).toBe(true);
        expect(recorded[0]).toMatchObject({ httpStatus: null, body: null, errorCode: null, failure: "timeout" });
    });

    it("fails the poll on an oversize body, cutting a streamed body off early", async () => {
        const chunk = "x".repeat(600);
        const { source, recorded } = tracker([{ stream: [chunk, chunk, chunk, chunk] }], { maxBodyBytes: 1_000 });

        await expect(source.positions()).rejects.toMatchObject({ failure: "oversize" });
        expect(recorded[0]).toMatchObject({ httpStatus: 200, body: null, failure: "oversize" });

        const text = tracker([{ status: 200, text: "y".repeat(2_000) }], { maxBodyBytes: 1_000 });
        await expect(text.source.positions()).rejects.toMatchObject({ failure: "oversize" });
    });

    it("records an HTTP failure with its scrubbed body and a network failure with none", async () => {
        const { source, recorded } = tracker([{ status: 503, text: "<html>busy</html>" }, new TypeError("fetch failed")]);

        await expect(source.positions()).rejects.toMatchObject({ failure: "http", message: "Train Tracker positions: HTTP 503" });
        expect(recorded[0]).toMatchObject({ httpStatus: 503, body: "<html>busy</html>", failure: "http" });

        await expect(source.positions()).rejects.toMatchObject({ failure: "network" });
        expect(recorded[1]).toMatchObject({ httpStatus: null, body: null, failure: "network" });
    });

    it("fails a body that is not a Train Tracker document as a parse failure", async () => {
        const { source, recorded } = tracker([{ status: 200, body: { unexpected: true } }, { status: 200, text: "not json" }]);

        await expect(source.positions()).rejects.toMatchObject({ failure: "parse" });
        await expect(source.positions()).rejects.toMatchObject({ failure: "parse" });
        expect(recorded.map((c) => c.failure)).toEqual(["parse", "parse"]);
    });
});

describe("the key", () => {
    it("scrubs a body that echoes the request URL before it reaches the recorder", async () => {
        const page = `<html>Bad gateway for /api/1.0/ttarrivals.aspx?key=${KEY}&mapid=40900&outputType=JSON (${KEY})</html>`;
        const { source, recorded } = tracker([{ status: 502, text: page }]);

        const failure = await failureOf(source.arrivals(["40900"]));
        expect(recorded[0].body).toBe("<html>Bad gateway for /api/1.0/ttarrivals.aspx?key=[key]&mapid=40900&outputType=JSON ([key])</html>");
        noKey(recorded[0]);
        noKey(failure.message);
        noKey(failure.stack);
    });

    it("never puts the key or the URL in an error, a stack, or a recorded call", async () => {
        const { source, recorded } = tracker(["hang", { status: 200, body: quotaError }, new TypeError(`fetch failed: https://lapi.transitchicago.com/x?key=${KEY}`)], { timeoutMs: 10 });

        for (let i = 0; i < 3; i++) {
            const failure = await failureOf(source.positions());
            noKey(failure.message);
            noKey(failure.stack);
            expect(failure.message).not.toContain("lapi.transitchicago.com");
        }
        for (const call of recorded) {
            noKey(call);
            expect(Object.keys(call)).not.toContain("url");
        }
    });

    it("replaces every occurrence of the key in a body", () => {
        expect(scrubKey(`a ${KEY} b ${KEY}`, KEY)).toBe("a [key] b [key]");
        expect(scrubKey("unchanged", "")).toBe("unchanged");
    });

    it("refuses to start without a key", () => {
        expect(() => createTrainTracker({ key: "" })).toThrow(/key/);
    });
});
