import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { DAILY_SCHEDULE, syncModeForSchedule, WEEKLY_SCHEDULE } from "./schedule";

describe("sync schedules", () => {
    it("match the two cron entries in vercel.json exactly, since the header carries the string", () => {
        const config = JSON.parse(fs.readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
            crons: { path: string; schedule: string }[];
            fluid?: boolean;
        };

        expect(config.crons).toEqual([
            { path: "/api/cron/sync-ridership", schedule: DAILY_SCHEDULE },
            { path: "/api/cron/sync-ridership", schedule: WEEKLY_SCHEDULE },
        ]);
        // Without Fluid compute a Hobby function stops at 60 seconds, not 300.
        expect(config.fluid).toBe(true);
    });

    it("maps the weekly schedule to reconciliation and anything else to the daily run", () => {
        expect(syncModeForSchedule(WEEKLY_SCHEDULE)).toBe("weekly");
        expect(syncModeForSchedule(DAILY_SCHEDULE)).toBe("daily");
        expect(syncModeForSchedule(null)).toBe("daily");
    });
});
