import { setTimeout as wait } from "node:timers/promises";

/** The default pause between retries; tests inject their own. */
export const sleep = (ms: number): Promise<void> => wait(ms);

/** An outcome worth retrying: no answer at all, a 429, or a 5xx. Anything else is final. */
export const retryableStatus = (status: number | null): boolean => status === null || status === 429 || status >= 500;
