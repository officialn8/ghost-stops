import { describe, expect, it } from "vitest";
import { DAY_MS, olderThanDays, STALE_AFTER_DAYS } from "./staleness";

describe("olderThanDays", () => {
    const now = Date.parse("2026-10-03T12:00:00Z");

    it("is stale just past the threshold and fresh at it", () => {
        expect(olderThanDays(now - STALE_AFTER_DAYS * DAY_MS - 1, STALE_AFTER_DAYS, now)).toBe(true);
        expect(olderThanDays(now - STALE_AFTER_DAYS * DAY_MS, STALE_AFTER_DAYS, now)).toBe(false);
    });

    it("counts a missing instant as old", () => {
        expect(olderThanDays(null, STALE_AFTER_DAYS, now)).toBe(true);
    });
});
