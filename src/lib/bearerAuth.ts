import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether an Authorization header carries exactly `Bearer <secret>`. Shared by the cron route
 * (CRON_SECRET) and the worker's revalidate route (WORKER_REVALIDATE_SECRET), each with its own
 * secret, so neither token opens the other door (KTD8). The digests have equal length, so the
 * comparison takes the same time however the header differs; an unset secret matches nothing.
 */
export function bearerMatches(header: string | null | undefined, secret: string | undefined): boolean {
    if (!secret || header === null || header === undefined) return false;
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
