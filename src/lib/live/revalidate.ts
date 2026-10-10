/**
 * The worker's call to the site after a nightly write (KTD8): POST /api/internal/revalidate with
 * the worker's own bearer secret and no body. Three retries with backoff on a network failure, a
 * 5xx, or a 429; a 401 is final (the secret differs at the two ends, which rotation fixes). A
 * failure is reported, never thrown: the day is already written, and the one-hour cache
 * fallback bounds the staleness. Neither the secret nor the response text is logged.
 */
import { retryableStatus, sleep as defaultSleep } from "./retry";

/** The subset of `fetch` the call uses, so tests can answer without the network. */
export type RevalidateFetch = (
    url: string,
    init: { method: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RevalidateOptions {
    siteUrl: string;
    secret: string;
    fetch?: RevalidateFetch;
    sleep?: (ms: number) => Promise<void>;
    retryDelaysMs?: readonly number[];
    timeoutMs?: number;
    log?: (message: string) => void;
}

export interface RevalidateResult {
    ok: boolean;
    /** The site's answer: expired, or skipped because no fresh reduction was found. */
    outcome: "revalidated" | "skipped" | "refused" | "failed";
    status: number | null;
    attempts: number;
}

const DEFAULT_RETRY_DELAYS_MS = [2_000, 8_000, 30_000] as const;

/**
 * The site the worker refreshes, from WORKER_REVALIDATE_SECRET and SITE_URL; null when either is
 * unset. The secret travels as a bearer header, so a SITE_URL that is not https is refused.
 */
export function siteFromEnv(env: Record<string, string | undefined>): { url: string; secret: string } | null {
    const secret = env.WORKER_REVALIDATE_SECRET?.trim();
    const url = env.SITE_URL?.trim();
    if (url && !url.startsWith("https://")) throw new Error("SITE_URL must be an https URL");
    return secret && url ? { url, secret } : null;
}

export async function postRevalidate(options: RevalidateOptions): Promise<RevalidateResult> {
    const http: RevalidateFetch = options.fetch ?? ((url, init) => fetch(url, init));
    const sleep = options.sleep ?? defaultSleep;
    const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const log = options.log ?? (() => {});
    const url = `${options.siteUrl.replace(/\/+$/, "")}/api/internal/revalidate`;
    for (let attempt = 1; ; attempt++) {
        let status: number | null = null;
        try {
            const response = await http(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${options.secret}` },
                signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
            });
            status = response.status;
            if (response.ok) {
                const body = (await response.json().catch(() => null)) as { revalidated?: unknown; skipped?: unknown } | null;
                const outcome = body?.skipped === true ? "skipped" : "revalidated";
                log(`revalidate: ${outcome} (HTTP ${status})`);
                return { ok: true, outcome, status, attempts: attempt };
            }
            if (status === 401 || status === 403) {
                log(`revalidate refused: HTTP ${status}; the secret differs at the two ends`);
                return { ok: false, outcome: "refused", status, attempts: attempt };
            }
            if (!retryableStatus(status)) {
                log(`revalidate failed: HTTP ${status}`);
                return { ok: false, outcome: "failed", status, attempts: attempt };
            }
        } catch {
            // Network failure or timeout; nothing from the error text is kept.
        }
        if (attempt > delays.length) {
            log(`revalidate failed after ${attempt} attempts: ${status === null ? "network error or timeout" : `HTTP ${status}`}`);
            return { ok: false, outcome: "failed", status, attempts: attempt };
        }
        await sleep(delays[attempt - 1]);
    }
}
