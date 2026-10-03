import type { SyncMode } from "./run";

/**
 * The two Vercel Cron schedules on /api/cron/sync-ridership, which vercel.json must repeat exactly:
 * Vercel sends the firing entry's schedule in the x-vercel-cron-schedule header. On the Hobby plan
 * each fires once a day at some minute within its hour, so the weekly run starts hours after the
 * daily one and never meets its lease.
 */
export const DAILY_SCHEDULE = "0 10 * * *";
export const WEEKLY_SCHEDULE = "0 14 * * 0";

export function syncModeForSchedule(schedule: string | null): SyncMode {
    return schedule === WEEKLY_SCHEDULE ? "weekly" : "daily";
}
