/**
 * The Healthchecks.io dead-man's switch (R17, KTD13): one ping after every successful poll cycle,
 * and a post to the check's fail URL at once on a quota stop, a revoked key, or a feed-shape day.
 * The ping URL is a secret; it is never logged, and a failed ping is logged by status only and
 * never retried inside the tick.
 */
export interface Healthchecks {
    ping(): Promise<void>;
    fail(): Promise<void>;
}

export type PingFetch = (url: string, init: { method: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface HealthchecksOptions {
    pingUrl: string;
    fetch?: PingFetch;
    log?: (message: string) => void;
    timeoutMs?: number;
}

export function createHealthchecks(options: HealthchecksOptions): Healthchecks {
    const base = options.pingUrl.replace(/\/+$/, "");
    if (!base.startsWith("https://")) throw new Error("the Healthchecks ping URL must be https");
    const http: PingFetch = options.fetch ?? ((url, init) => fetch(url, init));
    const log = options.log ?? (() => {});
    const timeoutMs = options.timeoutMs ?? 10_000;

    async function post(url: string, what: string): Promise<void> {
        try {
            const response = await http(url, { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
            if (!response.ok) log(`healthchecks ${what} failed: HTTP ${response.status}`);
        } catch {
            log(`healthchecks ${what} failed: network error or timeout`);
        }
    }

    return {
        ping: () => post(base, "ping"),
        fail: () => post(`${base}/fail`, "fail"),
    };
}
