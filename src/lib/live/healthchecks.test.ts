import { describe, expect, it } from "vitest";
import { createHealthchecks, type PingFetch } from "./healthchecks";

// A path too short for the gitleaks rule, which matches the twenty-plus characters of a real check's URL.
const PING_URL = "https://hc-ping.com/test-check";

type Answer = { status: number } | Error;

/** Answers each post with the next queued response and records what was asked. */
function fake(answers: Answer[]) {
    const calls: { url: string; method: string; signal: AbortSignal }[] = [];
    const fetch: PingFetch = async (url, init) => {
        calls.push({ url, method: init.method, signal: init.signal });
        const next = answers.shift();
        if (next === undefined) throw new Error("no answer queued");
        if (next instanceof Error) throw next;
        return { ok: next.status < 300, status: next.status };
    };
    return { fetch, calls };
}

function healthchecks(answers: Answer[], pingUrl = PING_URL) {
    const http = fake(answers);
    const logged: string[] = [];
    const checks = createHealthchecks({ pingUrl, fetch: http.fetch, log: (m) => logged.push(m) });
    return { checks, calls: http.calls, logged };
}

const noUrl = (value: unknown) => expect(JSON.stringify(value) ?? String(value)).not.toContain("hc-ping.com");

describe("createHealthchecks", () => {
    it("posts the ping to the URL and the fail to its /fail path, with a trailing slash trimmed", async () => {
        const { checks, calls, logged } = healthchecks([{ status: 200 }, { status: 200 }], `${PING_URL}/`);

        await checks.ping();
        await checks.fail();

        expect(calls.map((c) => [c.method, c.url])).toEqual([
            ["POST", PING_URL],
            ["POST", `${PING_URL}/fail`],
        ]);
        expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
        expect(logged).toEqual([]);
    });

    it("logs a failed ping by status, a network failure by kind, and never throws", async () => {
        const { checks, logged } = healthchecks([{ status: 500 }, new Error(`fetch failed: ${PING_URL}`), { status: 429 }]);

        await expect(checks.ping()).resolves.toBeUndefined();
        await expect(checks.ping()).resolves.toBeUndefined();
        await expect(checks.fail()).resolves.toBeUndefined();

        expect(logged).toEqual([
            "healthchecks ping failed: HTTP 500",
            "healthchecks ping failed: network error or timeout",
            "healthchecks fail failed: HTTP 429",
        ]);
        noUrl(logged);
    });

    it("refuses a ping URL that is not https", () => {
        expect(() => createHealthchecks({ pingUrl: "http://hc-ping.com/test-check" })).toThrow(/https/);
    });
});
