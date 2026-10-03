import { describe, expect, it, vi } from "vitest";
import type { ScoreColumns } from "@/lib/scoring/score";
import { computeBaseMetrics, dataStatusFor, writeStationMetrics, type BaseMetricInputs } from "./baseMetrics";
import { writeStationStatuses } from "./status";

const input = (overrides: Partial<BaseMetricInputs> = {}): BaseMetricInputs => ({
    stationId: "s1",
    lastDate: "2026-07-31",
    lastEntries: 950,
    avg12m: 1_000,
    avg90d: 980,
    avg30d: 960,
    daysLast60: 60,
    ...overrides,
});

describe("dataStatusFor", () => {
    it("is missing with no rows in 60 days, whatever the averages say", () => {
        expect(dataStatusFor({ daysLast60: 0, avg30d: null })).toBe("missing");
    });

    it("is zero when the 30-day average is under one rider or absent", () => {
        expect(dataStatusFor({ daysLast60: 12, avg30d: 0.4 })).toBe("zero");
        expect(dataStatusFor({ daysLast60: 12, avg30d: null })).toBe("zero");
    });

    it("is normal otherwise", () => {
        expect(dataStatusFor({ daysLast60: 60, avg30d: 1 })).toBe("normal");
    });
});

describe("computeBaseMetrics", () => {
    it("carries the averages and fills the v1 columns with 0 where there is no data", () => {
        const [closed] = computeBaseMetrics([input({ lastDate: "2026-01-04", lastEntries: 300, avg30d: null, avg90d: null, daysLast60: 0 })]);

        expect(closed).toEqual({
            stationId: "s1",
            serviceDateMax: "2026-01-04",
            lastDayEntries: 300,
            avg12m: 1_000,
            avg30d: null,
            rolling30dAvg: 0,
            rolling90dAvg: 0,
            dataStatus: "missing",
        });
    });
});

/** The score columns of a station left out of the ranking. */
const UNRANKED: ScoreColumns = {
    ghostScore: -1,
    scoreVersion: 2,
    tier: null,
    rank: null,
    rankedCount: 0,
    residualPct: null,
    yoyPct: null,
    longRunPct: null,
    erraticPct: null,
    baselineAvg: null,
    peerStationIds: { basis: "none", line: null, branch: null, stationIds: [], ctaStationIds: [], avg12m: [] },
    yoyChangePct: null,
    vs2019Pct: null,
    weekdayAvg: null,
    weekendAvg: null,
};

describe("the write path", () => {
    it("issues one statement per table whether there are 3 stations or 300", async () => {
        for (const stations of [3, 300]) {
            const tx = { $executeRaw: vi.fn().mockResolvedValue(stations) };
            const ids = Array.from({ length: stations }, (_, i) => `s${i}`);

            const metrics = computeBaseMetrics(ids.map((stationId) => input({ stationId })));
            await writeStationMetrics(tx, metrics.map((m) => ({ ...m, ...UNRANKED })), "2026-07-31", new Date());
            await writeStationStatuses(tx, ids.map((stationId) => ({ stationId, status: "ACTIVE", closedAt: null })));

            expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
        }
    });
});
