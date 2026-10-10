/**
 * The object store behind the raw files, the schedule archive, and the checkpoint (KTD2, KTD3):
 * one small interface over a bucket, an R2 implementation that signs plain `fetch` calls with
 * aws4fetch, and an in-memory implementation for tests and replays.
 *
 * Errors carry the operation, the object key, and the HTTP status, never the account hostname.
 * A conditional put that loses (412) is its own error, because the checkpoint doubles as the
 * single-instance lease and the loser must exit rather than overwrite.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { AwsClient } from "aws4fetch";
import { retryableStatus, sleep } from "./retry";

export interface ObjectHead {
    etag: string | null;
    size: number;
    /** Epoch ms from the store's Last-Modified; null when it gave none. */
    lastModified: number | null;
}

export interface StoredObject extends ObjectHead {
    body: Buffer;
}

export interface ListedObject {
    key: string;
    size: number;
}

/** A put that succeeds only when the object is unchanged (`ifMatch`) or absent (`ifNoneMatch`). */
export type PutCondition = { ifMatch: string } | { ifNoneMatch: "*" };

export interface PutOptions {
    contentType?: string;
    condition?: PutCondition;
}

export interface ObjectStore {
    put(key: string, body: Buffer, options?: PutOptions): Promise<{ etag: string | null }>;
    /** Null when the object does not exist. */
    get(key: string): Promise<StoredObject | null>;
    head(key: string): Promise<ObjectHead | null>;
    /** Deleting an absent object is not an error. */
    delete(key: string): Promise<void>;
    /** Every object under the prefix, in key order. */
    list(prefix: string): Promise<ListedObject[]>;
}

export type StoreOperation = "put" | "get" | "head" | "delete" | "list";

export class ObjectStoreError extends Error {
    override name = "ObjectStoreError";
    constructor(
        readonly operation: StoreOperation,
        readonly key: string,
        readonly status: number | null,
        detail = status === null ? "network error" : `HTTP ${status}`,
    ) {
        super(`${operation} ${key}: ${detail}`);
    }
}

/** The condition on a put did not hold: another writer changed or created the object. */
export class PreconditionFailedError extends ObjectStoreError {
    override name = "PreconditionFailedError";
    constructor(key: string) {
        super("put", key, 412, "precondition failed");
    }
}

/** The subset of `fetch` the R2 client uses: it is handed an already signed Request. */
export type SignedFetch = (request: Request) => Promise<Response>;

export interface R2StoreOptions {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    fetch?: SignedFetch;
    /** Waits before each retry of a 5xx, a 429, or a network failure; one retry per entry. */
    retryDelaysMs?: readonly number[];
    timeoutMs?: number;
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Code-unit order, as S3 lists keys; the store's keys are its own ASCII paths. */
const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** A value as gzip JSON, the shape of every small object the store holds: checkpoint, schedules, day states. */
export function gzipJson(value: unknown, level = 6): Buffer {
    return gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level });
}

export function gunzipJson<T>(body: Buffer): T {
    return JSON.parse(gunzipSync(body).toString("utf8")) as T;
}

function parseLastModified(value: string | null): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** The keys and sizes in a ListObjectsV2 body; keys here are the store's own, never user text. */
export function parseListing(xml: string): { objects: ListedObject[]; continuationToken: string | null } {
    const objects: ListedObject[] = [];
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([^<]*)<\/Key>/.exec(match[1])?.[1];
        const size = /<Size>(\d+)<\/Size>/.exec(match[1])?.[1];
        if (key !== undefined) objects.push({ key: decodeXml(key), size: Number(size ?? 0) });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
    return { objects, continuationToken: truncated ? (token === null ? null : decodeXml(token)) : null };
}

function decodeXml(text: string): string {
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** Cloudflare R2 over its S3 API, path-style, signed per request. */
export function createR2Store(options: R2StoreOptions): ObjectStore {
    const { accountId, bucket } = options;
    if (!accountId || !bucket || !options.accessKeyId || !options.secretAccessKey) {
        throw new Error("R2 needs an account id, a bucket, and an access key pair");
    }
    const aws = new AwsClient({
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        service: "s3",
        region: "auto",
        retries: 0,
    });
    const http: SignedFetch = options.fetch ?? ((request) => fetch(request));
    const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const origin = `https://${accountId}.r2.cloudflarestorage.com`;

    const objectUrl = (key: string) =>
        `${origin}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

    /** One request with retries on a 5xx, a 429, or a network failure; the response is returned whole. */
    async function request(operation: StoreOperation, key: string, url: string, init: RequestInit): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            let response: Response | null = null;
            try {
                const signed = await aws.sign(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
                response = await http(signed);
            } catch {
                // The failure's own text may carry the hostname; only the fact survives.
            }
            if (response !== null && !retryableStatus(response.status)) return response;
            if (attempt >= retryDelaysMs.length) {
                throw new ObjectStoreError(operation, key, response?.status ?? null);
            }
            await sleep(retryDelaysMs[attempt]);
        }
    }

    return {
        async put(key, body, putOptions = {}) {
            const headers: Record<string, string> = {
                "Content-Type": putOptions.contentType ?? "application/octet-stream",
                "Content-Length": String(body.byteLength),
            };
            const condition = putOptions.condition;
            if (condition && "ifMatch" in condition) headers["If-Match"] = condition.ifMatch;
            if (condition && "ifNoneMatch" in condition) headers["If-None-Match"] = condition.ifNoneMatch;
            // A view over the Buffer's memory, not a copy: a day object is tens of megabytes.
            const response = await request("put", key, objectUrl(key), { method: "PUT", headers, body: new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength) });
            if (response.status === 412) throw new PreconditionFailedError(key);
            if (!response.ok) throw new ObjectStoreError("put", key, response.status);
            return { etag: response.headers.get("etag") };
        },

        async get(key) {
            const response = await request("get", key, objectUrl(key), { method: "GET" });
            if (response.status === 404) return null;
            if (!response.ok) throw new ObjectStoreError("get", key, response.status);
            const body = Buffer.from(await response.arrayBuffer());
            return {
                body,
                etag: response.headers.get("etag"),
                size: body.byteLength,
                lastModified: parseLastModified(response.headers.get("last-modified")),
            };
        },

        async head(key) {
            const response = await request("head", key, objectUrl(key), { method: "HEAD" });
            if (response.status === 404) return null;
            if (!response.ok) throw new ObjectStoreError("head", key, response.status);
            return {
                etag: response.headers.get("etag"),
                size: Number(response.headers.get("content-length") ?? 0),
                lastModified: parseLastModified(response.headers.get("last-modified")),
            };
        },

        async delete(key) {
            const response = await request("delete", key, objectUrl(key), { method: "DELETE" });
            if (response.status === 404 || response.ok) return;
            throw new ObjectStoreError("delete", key, response.status);
        },

        async list(prefix) {
            const objects: ListedObject[] = [];
            let token: string | null = null;
            do {
                const params = new URLSearchParams({ "list-type": "2", prefix });
                if (token !== null) params.set("continuation-token", token);
                const response: Response = await request("list", prefix, `${origin}/${bucket}?${params}`, { method: "GET" });
                if (!response.ok) throw new ObjectStoreError("list", prefix, response.status);
                const page = parseListing(await response.text());
                objects.push(...page.objects);
                token = page.continuationToken;
            } while (token !== null);
            return objects.sort(byKey);
        },
    };
}

interface MemoryObject {
    body: Buffer;
    etag: string;
    contentType: string;
    lastModified: number;
}

export interface MemoryObjectStore extends ObjectStore {
    /** Every stored object by key, for assertions. */
    objects(): Map<string, { body: Buffer; etag: string; contentType: string }>;
    /** Makes the next operations fail with the given status (null for a network failure); 0 clears it. */
    failNext(count: number, status?: number | null): void;
}

const quotedEtag = (body: Buffer) => `"${createHash("md5").update(body).digest("hex")}"`;

/** The same contract in memory, with S3-shaped ETags, for tests and replays. */
export function createMemoryObjectStore(options: { now?: () => number } = {}): MemoryObjectStore {
    const now = options.now ?? Date.now;
    const objects = new Map<string, MemoryObject>();
    let failures = 0;
    let failureStatus: number | null = 500;

    function maybeFail(operation: StoreOperation, key: string): void {
        if (failures <= 0) return;
        failures -= 1;
        throw new ObjectStoreError(operation, key, failureStatus);
    }

    return {
        async put(key, body, putOptions = {}) {
            maybeFail("put", key);
            const current = objects.get(key);
            const condition = putOptions.condition;
            if (condition && "ifMatch" in condition && current?.etag !== condition.ifMatch) throw new PreconditionFailedError(key);
            if (condition && "ifNoneMatch" in condition && current !== undefined) throw new PreconditionFailedError(key);
            const stored: MemoryObject = {
                body: Buffer.from(body),
                etag: quotedEtag(body),
                contentType: putOptions.contentType ?? "application/octet-stream",
                lastModified: now(),
            };
            objects.set(key, stored);
            return { etag: stored.etag };
        },

        async get(key) {
            maybeFail("get", key);
            const stored = objects.get(key);
            if (!stored) return null;
            return { body: Buffer.from(stored.body), etag: stored.etag, size: stored.body.byteLength, lastModified: stored.lastModified };
        },

        async head(key) {
            maybeFail("head", key);
            const stored = objects.get(key);
            if (!stored) return null;
            return { etag: stored.etag, size: stored.body.byteLength, lastModified: stored.lastModified };
        },

        async delete(key) {
            maybeFail("delete", key);
            objects.delete(key);
        },

        async list(prefix) {
            maybeFail("list", prefix);
            return [...objects.entries()]
                .filter(([key]) => key.startsWith(prefix))
                .map(([key, stored]) => ({ key, size: stored.body.byteLength }))
                .sort(byKey);
        },

        objects() {
            return new Map([...objects.entries()].map(([key, o]) => [key, { body: o.body, etag: o.etag, contentType: o.contentType }]));
        },

        failNext(count, status = 500) {
            failures = count;
            failureStatus = status;
        },
    };
}

const R2_ENV_NAMES = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;

export type R2Env = Pick<R2StoreOptions, "accountId" | "bucket" | "accessKeyId" | "secretAccessKey">;

/** The four R2 variables, trimmed, or the names of the missing ones. */
export function r2EnvOf(env: Record<string, string | undefined>): { ok: true; env: R2Env } | { ok: false; missing: string[] } {
    const missing = R2_ENV_NAMES.filter((name) => !env[name]?.trim());
    if (missing.length > 0) return { ok: false, missing };
    return {
        ok: true,
        env: {
            accountId: env.R2_ACCOUNT_ID!.trim(),
            bucket: env.R2_BUCKET!.trim(),
            accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
            secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
        },
    };
}

/** The four R2 variables for a script that cannot run without them; the error names the missing ones. */
export function readR2Env(env: Record<string, string | undefined>): R2Env {
    const read = r2EnvOf(env);
    if (!read.ok) throw new Error(`${read.missing.join(", ")} must be set`);
    return read.env;
}

/**
 * The R2 store from the environment, or null when any of the four variables is unset (a preview
 * deployment, a shell without them). The site's token is read-only and scoped to the one bucket.
 */
export function r2StoreFromEnv(env: Record<string, string | undefined>, options: Pick<R2StoreOptions, "retryDelaysMs" | "timeoutMs"> = {}): ObjectStore | null {
    const read = r2EnvOf(env);
    return read.ok ? createR2Store({ ...read.env, ...options }) : null;
}
