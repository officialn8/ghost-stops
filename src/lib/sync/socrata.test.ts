import { describe, expect, it } from "vitest";
import recordedDays from "./__fixtures__/socrata-days.json";
import { createSocrataSource, type HttpFetch } from "./socrata";

interface Call {
    params: URLSearchParams;
    headers: Record<string, string>;
}

/** Answers each request with the next queued response and records what was asked. */
function fakeHttp(responses: Array<{ status: number; body?: unknown } | Error>) {
    const calls: Call[] = [];
    const fetch: HttpFetch = async (url, init) => {
        calls.push({ params: new URL(url).searchParams, headers: init.headers });
        const next = responses.shift();
        if (next === undefined) throw new Error("no response queued");
        if (next instanceof Error) throw next;
        return { ok: next.status < 300, status: next.status, json: async () => next.body };
    };
    return { fetch, calls };
}

describe("createSocrataSource", () => {
    it("parses a recorded response for the two Western stations", async () => {
        const http = fakeHttp([{ status: 200, body: recordedDays }]);
        const source = createSocrataSource({ fetch: http.fetch, appToken: "test-token" });

        const days = await source.fetchDays({ start: "2025-11-02", end: "2025-11-03" }, ["40670", "40310"]);

        // AE8: Western (Blue, O'Hare branch) 3,476 and Western (Orange) 2,617 on 2025-11-03.
        expect(days.filter((d) => d.serviceDate === "2025-11-03")).toEqual([
            { ctaStationId: "40310", serviceDate: "2025-11-03", dayType: "W", rides: 2617, updatedAt: "2026-03-20T21:48:50.135Z" },
            { ctaStationId: "40670", serviceDate: "2025-11-03", dayType: "W", rides: 3476, updatedAt: "2026-03-20T21:48:50.135Z" },
        ]);
        const [call] = http.calls;
        expect(call.params.get("$where")).toBe(
            "date between '2025-11-02T00:00:00' and '2025-11-03T00:00:00' AND station_id in ('40670','40310')",
        );
        expect(call.params.get("$order")).toBe("date,station_id,:id");
    });

    it("sends the app token only in the X-App-Token header", async () => {
        const http = fakeHttp([{ status: 200, body: [{ max_date: "2026-07-31T00:00:00.000" }] }]);

        expect(await createSocrataSource({ fetch: http.fetch, appToken: "test-token" }).maxDate()).toBe("2026-07-31");
        expect(http.calls[0].headers["X-App-Token"]).toBe("test-token");
        expect([...http.calls[0].params.values()].join(" ")).not.toContain("test-token");
    });

    it("pages with $limit and $offset until a short page", async () => {
        const row = (date: string) => ({ station_id: "40010", date: `${date}T00:00:00.000`, daytype: "W", rides: "1", ":updated_at": "x" });
        const http = fakeHttp([
            { status: 200, body: [row("2026-06-01"), row("2026-06-02")] },
            { status: 200, body: [row("2026-06-03")] },
        ]);

        const days = await createSocrataSource({ fetch: http.fetch, pageSize: 2 }).fetchDays({ start: "2026-06-01", end: "2026-06-30" });

        expect(days.map((d) => d.serviceDate)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
        expect(http.calls.map((c) => [c.params.get("$limit"), c.params.get("$offset")])).toEqual([
            ["2", "0"],
            ["2", "2"],
        ]);
    });

    it("reads station-month totals and duplicate days", async () => {
        const http = fakeHttp([
            { status: 200, body: [{ station_id: "40380", month: "2011-07-01T00:00:00.000", days: "32", rides: "500000" }] },
            {
                status: 200,
                body: [
                    {
                        station_id: "40380", date: "2011-07-03T00:00:00.000", n: "2", total: "11147", hi: "5574",
                        first_update: "2026-03-20T21:36:29.885Z", last_update: "2026-03-20T21:36:29.885Z",
                    },
                ],
            },
        ]);
        const source = createSocrataSource({ fetch: http.fetch });

        expect(await source.stationMonthTotals()).toEqual([{ ctaStationId: "40380", month: "2011-07", days: 32, rides: 500000 }]);
        expect(await source.duplicateDays()).toEqual([
            { ctaStationId: "40380", serviceDate: "2011-07-03", rows: 2, totalRides: 11147, maxRides: 5574, sameUpdate: true },
        ]);
        expect(http.calls[1].params.get("$having")).toBe("count(*) > 1");
    });

    it("retries a 503 and a network failure, then succeeds", async () => {
        const http = fakeHttp([{ status: 503 }, new TypeError("fetch failed"), { status: 200, body: [{ max_date: "2026-07-31T00:00:00.000" }] }]);

        const source = createSocrataSource({ fetch: http.fetch, retryDelaysMs: [0, 0] });
        expect(await source.maxDate()).toBe("2026-07-31");
        expect(http.calls).toHaveLength(3);
    });

    it("retries a 429, then succeeds", async () => {
        const http = fakeHttp([{ status: 429 }, { status: 200, body: [{ max_date: "2026-07-31T00:00:00.000" }] }]);

        expect(await createSocrataSource({ fetch: http.fetch, retryDelaysMs: [0] }).maxDate()).toBe("2026-07-31");
        expect(http.calls).toHaveLength(2);
    });

    it("drops the failed request's URL and token from a network error once retries run out", async () => {
        const url = "https://data.cityofchicago.org/resource/5neh-572f.json?$select=max(date) AS max_date&$$app_token=leaked";
        const http = fakeHttp([new TypeError(`fetch failed: ${url}`), new TypeError(`fetch failed: ${url}`)]);

        const error = await createSocrataSource({ fetch: http.fetch, appToken: "leaked", retryDelaysMs: [0] })
            .maxDate()
            .catch((e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        const { message } = error as Error;
        expect(message).toBe("Socrata request failed: network error or timeout");
        expect(message).not.toContain(url);
        expect(message).not.toContain("leaked");
        expect(http.calls).toHaveLength(2);
    });

    it("rejects a body that is not an array without retrying", async () => {
        const http = fakeHttp([
            { status: 200, body: { error: true, message: "query failed" } },
            { status: 200, body: [{ max_date: "2026-07-31T00:00:00.000" }] },
        ]);

        await expect(createSocrataSource({ fetch: http.fetch, retryDelaysMs: [0] }).maxDate()).rejects.toThrow(
            "Socrata returned a body that is not an array",
        );
        expect(http.calls).toHaveLength(1);
    });

    it("rejects an empty max(date) response", async () => {
        const http = fakeHttp([{ status: 200, body: [] }]);

        await expect(createSocrataSource({ fetch: http.fetch }).maxDate()).rejects.toThrow("Socrata returned no max date");
    });

    it("fails without the URL or token in the message once retries run out, and never retries a 400", async () => {
        const exhausted = fakeHttp([{ status: 500 }, { status: 500 }]);
        const error = await createSocrataSource({ fetch: exhausted.fetch, appToken: "test-token", retryDelaysMs: [0] })
            .maxDate()
            .catch((e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Socrata request failed with HTTP 500");

        const badRequest = fakeHttp([{ status: 400 }]);
        await expect(createSocrataSource({ fetch: badRequest.fetch, retryDelaysMs: [0] }).maxDate()).rejects.toThrow(/HTTP 400/);
        expect(badRequest.calls).toHaveLength(1);
    });

    it("refuses station ids that are not five digits before sending anything", async () => {
        const http = fakeHttp([]);
        await expect(
            createSocrataSource({ fetch: http.fetch }).fetchDays({ start: "2026-06-01", end: "2026-06-30" }, ["40670') OR ('1"]),
        ).rejects.toThrow(/Not a CTA station id/);
        expect(http.calls).toHaveLength(0);
    });

    it("rejects rows with an unknown day type or a non-integer count", async () => {
        const bad = (field: string, value: string) => ({
            station_id: "40010", date: "2026-06-01T00:00:00.000", daytype: "W", rides: "5", ":updated_at": "x", [field]: value,
        });
        const window = { start: "2026-06-01", end: "2026-06-01" };

        await expect(createSocrataSource({ fetch: fakeHttp([{ status: 200, body: [bad("daytype", "H")] }]).fetch }).fetchDays(window)).rejects.toThrow(/daytype/);
        await expect(createSocrataSource({ fetch: fakeHttp([{ status: 200, body: [bad("rides", "4.5")] }]).fetch }).fetchDays(window)).rejects.toThrow(/rides/);
    });
});
