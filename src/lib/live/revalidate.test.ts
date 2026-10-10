import { describe, expect, it } from "vitest";
import { postRevalidate, siteFromEnv, type RevalidateOptions } from "./revalidate";

type Answer = { status: number; body?: unknown } | Error;

function fake(answers: Answer[]) {
    const calls: { url: string; headers: Record<string, string>; method: string }[] = [];
    const fetch: RevalidateOptions["fetch"] = async (url, init) => {
        calls.push({ url, headers: init.headers, method: init.method });
        const next = answers.shift();
        if (!next) throw new Error("no answer queued");
        if (next instanceof Error) throw next;
        return { ok: next.status < 300, status: next.status, json: async () => next.body };
    };
    return { fetch, calls };
}

const SECRET = "ghrv_test-secret";

function post(answers: Answer[]) {
    const http = fake(answers);
    const logged: string[] = [];
    const slept: number[] = [];
    const result = postRevalidate({ siteUrl: "https://ghost-stops.vercel.app/", secret: SECRET, fetch: http.fetch, sleep: async (ms) => void slept.push(ms), log: (m) => logged.push(m) });
    return { result, calls: http.calls, logged, slept };
}

describe("postRevalidate", () => {
    it("posts the bearer to the route with no body and reports revalidated", async () => {
        const { result, calls, logged } = post([{ status: 200, body: { revalidated: ["stations"] } }]);
        expect(await result).toEqual({ ok: true, outcome: "revalidated", status: 200, attempts: 1 });
        expect(calls).toEqual([{ url: "https://ghost-stops.vercel.app/api/internal/revalidate", method: "POST", headers: { Authorization: `Bearer ${SECRET}` } }]);
        expect(logged).toEqual(["revalidate: revalidated (HTTP 200)"]);
    });

    it("reports skipped when the site found no fresh reduction", async () => {
        const { result } = post([{ status: 200, body: { skipped: true } }]);
        expect((await result).outcome).toBe("skipped");
    });

    it("retries a 5xx, a 429, and a network failure three times, then reports failure without the secret", async () => {
        const { result, slept, logged } = post([{ status: 503 }, { status: 429 }, new Error(`fetch failed ${SECRET}`), { status: 500 }]);
        expect(await result).toEqual({ ok: false, outcome: "failed", status: 500, attempts: 4 });
        expect(slept).toEqual([2_000, 8_000, 30_000]);
        expect(logged).toEqual(["revalidate failed after 4 attempts: HTTP 500"]);
        expect(logged.join(" ")).not.toContain(SECRET);

        const recovered = post([{ status: 502 }, { status: 200, body: { revalidated: ["stations"] } }]);
        expect((await recovered.result).attempts).toBe(2);
    });

    it("treats a 401 as final: the secret differs at the two ends", async () => {
        const { result, calls, logged } = post([{ status: 401 }]);
        expect(await result).toEqual({ ok: false, outcome: "refused", status: 401, attempts: 1 });
        expect(calls).toHaveLength(1);
        expect(logged[0]).toMatch(/refused: HTTP 401/);
    });

    it("does not retry another 4xx", async () => {
        const { result, calls } = post([{ status: 404 }]);
        expect((await result).outcome).toBe("failed");
        expect(calls).toHaveLength(1);
    });
});

describe("siteFromEnv", () => {
    it("reads the site and the secret, trimmed, and is null when either is unset", () => {
        expect(siteFromEnv({ SITE_URL: " https://ghost-stops.vercel.app ", WORKER_REVALIDATE_SECRET: ` ${SECRET}\n` })).toEqual({ url: "https://ghost-stops.vercel.app", secret: SECRET });
        expect(siteFromEnv({ SITE_URL: "https://ghost-stops.vercel.app" })).toBeNull();
        expect(siteFromEnv({ WORKER_REVALIDATE_SECRET: SECRET })).toBeNull();
        expect(siteFromEnv({ SITE_URL: "", WORKER_REVALIDATE_SECRET: SECRET })).toBeNull();
        expect(siteFromEnv({})).toBeNull();
    });

    it("refuses a site that is not https, since the secret travels as a bearer header", () => {
        expect(() => siteFromEnv({ SITE_URL: "http://ghost-stops.vercel.app", WORKER_REVALIDATE_SECRET: SECRET })).toThrow("SITE_URL must be an https URL");
        expect(() => siteFromEnv({ SITE_URL: "http://localhost:3000" })).toThrow(/https/);
    });
});
