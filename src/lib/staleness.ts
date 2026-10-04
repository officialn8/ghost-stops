/**
 * When data counts as stale (R13). /api/health answers 503 and the UI shows its "last refresh"
 * banner and sentence on the same signal: the last successful refresh is more than
 * STALE_AFTER_DAYS old. Shared by the server's health check and the client shell, so the two
 * cannot drift apart; nothing here touches the database.
 */
export const STALE_AFTER_DAYS = 10;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether `instant` (epoch ms) is more than `days` before `now`; a missing instant counts as old. */
export function olderThanDays(instant: number | null, days: number, now: number): boolean {
  return instant === null || now - instant > days * DAY_MS;
}
