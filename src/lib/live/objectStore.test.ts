import { describe, expect, it } from "vitest";
import {
    createMemoryObjectStore,
    createR2Store,
    ObjectStoreError,
    parseListing,
    PreconditionFailedError,
    type ObjectStore,
    type SignedFetch,
} from "./objectStore";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const ACCESS_KEY = "fedcba9876543210fedcba9876543210";
const SECRET = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

interface Seen {
    method: string;
    url: URL;
    headers: Headers;
    body: Buffer | null;
}

type Answer = { status: number; body?: string; headers?: Record<string, string> } | Error;

/** Answers each signed request with the next queued response and records it. */
function fakeR2(answers: Answer[]) {
    const seen: Seen[] = [];
    const fetch: SignedFetch = async (request) => {
        const body = request.body === null ? null : Buffer.from(await request.arrayBuffer());
        seen.push({ method: request.method, url: new URL(request.url), headers: request.headers, body });
        const next = answers.shift();
        if (next === undefined) throw new Error("no response queued");
        if (next instanceof Error) throw next;
        return new Response(next.body ?? null, { status: next.status, headers: next.headers });
    };
    return { fetch, seen };
}

/** The error a call rejects with; a call that resolves fails the test. */
async function failureOf(call: Promise<unknown>): Promise<Error> {
    const outcome = await call.then(
        () => null,
        (error: unknown) => error,
    );
    if (!(outcome instanceof Error)) throw new Error("expected the call to reject with an Error");
    return outcome;
}

function r2(answers: Answer[]) {
    const http = fakeR2(answers);
    const store = createR2Store({ accountId: ACCOUNT, bucket: "ghost-stops-live", accessKeyId: ACCESS_KEY, secretAccessKey: SECRET, fetch: http.fetch, retryDelaysMs: [0, 0, 0] });
    return { store, seen: http.seen };
}

describe("the R2 store", () => {
    it("puts an object with a signed, path-style request and returns its ETag", async () => {
        const { store, seen } = r2([{ status: 200, headers: { etag: '"abc"' } }]);

        const result = await store.put("raw/v1/2026/10/2026-10-14/00.0000001760000000000.ndjson.gz", Buffer.from("x"), { contentType: "application/gzip" });

        expect(result).toEqual({ etag: '"abc"' });
        const [request] = seen;
        expect(request.method).toBe("PUT");
        expect(request.url.origin).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com`);
        expect(request.url.pathname).toBe("/ghost-stops-live/raw/v1/2026/10/2026-10-14/00.0000001760000000000.ndjson.gz");
        expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=fedcba9876543210fedcba9876543210\/\d{8}\/auto\/s3\/aws4_request/);
        expect(request.headers.get("content-type")).toBe("application/gzip");
        expect(request.body?.toString()).toBe("x");
    });

    it("sends the condition as If-Match or If-None-Match and reports a 412 as a lost precondition", async () => {
        const { store, seen } = r2([{ status: 200, headers: { etag: '"2"' } }, { status: 412 }, { status: 412 }]);

        await store.put("state/checkpoint.json.gz", Buffer.from("a"), { condition: { ifMatch: '"1"' } });
        expect(seen[0].headers.get("if-match")).toBe('"1"');
        expect(seen[0].headers.get("if-none-match")).toBeNull();

        await expect(store.put("state/checkpoint.json.gz", Buffer.from("a"), { condition: { ifNoneMatch: "*" } })).rejects.toBeInstanceOf(PreconditionFailedError);
        expect(seen[1].headers.get("if-none-match")).toBe("*");

        // A 412 is final, never retried.
        await expect(store.put("state/checkpoint.json.gz", Buffer.from("a"), { condition: { ifMatch: '"1"' } })).rejects.toThrow(/precondition failed/);
        expect(seen).toHaveLength(3);
    });

    it("gets and heads an object, and answers null for a missing one", async () => {
        const { store, seen } = r2([
            { status: 200, body: "payload", headers: { etag: '"e"', "last-modified": "Wed, 14 Oct 2026 08:00:00 GMT" } },
            { status: 404 },
            { status: 200, headers: { etag: '"e"', "content-length": "7", "last-modified": "Wed, 14 Oct 2026 08:00:00 GMT" } },
            { status: 404 },
        ]);

        const got = await store.get("k");
        expect(got?.body.toString()).toBe("payload");
        expect(got).toMatchObject({ etag: '"e"', size: 7, lastModified: Date.parse("2026-10-14T08:00:00Z") });
        expect(await store.get("missing")).toBeNull();
        expect(await store.head("k")).toEqual({ etag: '"e"', size: 7, lastModified: Date.parse("2026-10-14T08:00:00Z") });
        expect(await store.head("missing")).toBeNull();
        expect(seen.map((s) => s.method)).toEqual(["GET", "GET", "HEAD", "HEAD"]);
    });

    it("deletes, treating an absent object as deleted", async () => {
        const { store, seen } = r2([{ status: 204 }, { status: 404 }]);

        await store.delete("a");
        await store.delete("b");
        expect(seen.map((s) => [s.method, s.url.pathname])).toEqual([["DELETE", "/ghost-stops-live/a"], ["DELETE", "/ghost-stops-live/b"]]);
    });

    it("lists a prefix across continuation pages in key order", async () => {
        const page = (keys: string[], next: string | null) =>
            `<?xml version="1.0"?><ListBucketResult><IsTruncated>${next !== null}</IsTruncated>` +
            (next === null ? "" : `<NextContinuationToken>${next}</NextContinuationToken>`) +
            keys.map((k) => `<Contents><Key>${k}</Key><Size>${k.length}</Size></Contents>`).join("") +
            "</ListBucketResult>";
        const { store, seen } = r2([
            { status: 200, body: page(["raw/v1/2026/10/2026-10-14/01.b.ndjson.gz", "raw/v1/2026/10/2026-10-14/00.a.ndjson.gz"], "tok") },
            { status: 200, body: page(["raw/v1/2026/10/2026-10-14/02.c.ndjson.gz"], null) },
        ]);

        const listed = await store.list("raw/v1/2026/10/2026-10-14/");
        expect(listed.map((o) => o.key)).toEqual([
            "raw/v1/2026/10/2026-10-14/00.a.ndjson.gz",
            "raw/v1/2026/10/2026-10-14/01.b.ndjson.gz",
            "raw/v1/2026/10/2026-10-14/02.c.ndjson.gz",
        ]);
        expect(seen[0].url.searchParams.get("prefix")).toBe("raw/v1/2026/10/2026-10-14/");
        expect(seen[0].url.searchParams.get("list-type")).toBe("2");
        expect(seen[1].url.searchParams.get("continuation-token")).toBe("tok");
    });

    it("retries a 5xx, a 429, and a network failure three times, then surfaces the key and status only", async () => {
        const { store, seen } = r2([{ status: 503 }, { status: 429 }, new TypeError(`fetch failed https://${ACCOUNT}.r2.cloudflarestorage.com/x`), { status: 500 }]);

        const failure = await failureOf(store.put("state/checkpoint.json.gz", Buffer.from("a")));
        expect(failure).toBeInstanceOf(ObjectStoreError);
        expect(failure.message).toBe("put state/checkpoint.json.gz: HTTP 500");
        expect(failure.message).not.toContain(ACCOUNT);
        expect(failure.message).not.toContain("cloudflarestorage");
        expect(seen).toHaveLength(4);

        const network = r2([new Error("boom"), new Error("boom"), new Error("boom"), new Error("boom")]);
        await expect(network.store.get("k")).rejects.toThrow("get k: network error");
    });

    it("does not retry a 4xx", async () => {
        const { store, seen } = r2([{ status: 403 }]);

        await expect(store.get("k")).rejects.toThrow("get k: HTTP 403");
        expect(seen).toHaveLength(1);
    });

    it("refuses to start without credentials", () => {
        expect(() => createR2Store({ accountId: "", bucket: "b", accessKeyId: "a", secretAccessKey: "s" })).toThrow(/R2 needs/);
    });
});

describe("parseListing", () => {
    it("reads keys and sizes and decodes XML entities", () => {
        const xml = "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>a&amp;b</Key><Size>12</Size></Contents></ListBucketResult>";
        expect(parseListing(xml)).toEqual({ objects: [{ key: "a&b", size: 12 }], continuationToken: null });
    });
});

describe("the in-memory store", () => {
    it("exposes the same interface as the R2 client", () => {
        const stores: ObjectStore[] = [createMemoryObjectStore(), createR2Store({ accountId: ACCOUNT, bucket: "b", accessKeyId: ACCESS_KEY, secretAccessKey: SECRET })];
        expect(stores).toHaveLength(2);
    });

    it("puts, gets, heads, lists, and deletes with S3-shaped ETags", async () => {
        const store = createMemoryObjectStore({ now: () => 1_000 });

        const { etag } = await store.put("raw/v1/2026/10/2026-10-14/00.x.ndjson.gz", Buffer.from("hello"), { contentType: "application/gzip" });
        expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
        expect((await store.get("raw/v1/2026/10/2026-10-14/00.x.ndjson.gz"))?.body.toString()).toBe("hello");
        expect(await store.head("raw/v1/2026/10/2026-10-14/00.x.ndjson.gz")).toEqual({ etag, size: 5, lastModified: 1_000 });
        expect(await store.list("raw/v1/2026/10/2026-10-14/")).toEqual([{ key: "raw/v1/2026/10/2026-10-14/00.x.ndjson.gz", size: 5 }]);
        expect(await store.get("nope")).toBeNull();
        await store.delete("raw/v1/2026/10/2026-10-14/00.x.ndjson.gz");
        await store.delete("raw/v1/2026/10/2026-10-14/00.x.ndjson.gz");
        expect(await store.list("raw/")).toEqual([]);
    });

    it("refuses a conditional put against a changed object or an existing one", async () => {
        const store = createMemoryObjectStore();
        const first = await store.put("state/checkpoint.json.gz", Buffer.from("1"));

        await store.put("state/checkpoint.json.gz", Buffer.from("2"), { condition: { ifMatch: first.etag as string } });
        await expect(store.put("state/checkpoint.json.gz", Buffer.from("3"), { condition: { ifMatch: first.etag as string } })).rejects.toBeInstanceOf(PreconditionFailedError);
        await expect(store.put("state/checkpoint.json.gz", Buffer.from("3"), { condition: { ifNoneMatch: "*" } })).rejects.toBeInstanceOf(PreconditionFailedError);
        expect((await store.get("state/checkpoint.json.gz"))?.body.toString()).toBe("2");
        await store.put("fresh", Buffer.from("x"), { condition: { ifNoneMatch: "*" } });
    });

    it("fails the next operations on request, so callers' retries can be tested", async () => {
        const store = createMemoryObjectStore();
        store.failNext(2, 503);

        await expect(store.put("k", Buffer.from("x"))).rejects.toThrow("put k: HTTP 503");
        await expect(store.get("k")).rejects.toThrow("get k: HTTP 503");
        await store.put("k", Buffer.from("x"));
    });
});
