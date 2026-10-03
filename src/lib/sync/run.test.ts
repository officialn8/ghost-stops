import { describe, expect, it } from "vitest";
import type { NarrativeStationRecord } from "@/lib/narratives/generate";
import { narrativeInputs, type ComputedStationMetrics } from "./run";
import type { StationStatusRow } from "./status";

function metricsRow(stationId: string, overrides: Partial<ComputedStationMetrics> = {}): ComputedStationMetrics {
    return {
        stationId,
        serviceDateMax: "2026-07-31",
        lastDayEntries: 400,
        avg12m: 450,
        avg30d: 420,
        rolling30dAvg: 420,
        rolling90dAvg: 430,
        dataStatus: "normal",
        ghostScore: 80,
        scoreVersion: 2,
        tier: "FADING",
        rank: 10,
        rankedCount: 143,
        residualPct: 80,
        yoyPct: 30,
        longRunPct: 40,
        erraticPct: 50,
        baselineAvg: 900,
        peerStationIds: { basis: "loop", line: "Brown", branch: "loop", stationIds: [], ctaStationIds: [], avg12m: [] },
        yoyChangePct: 2.5,
        vs2019Pct: -12,
        weekdayAvg: 480,
        weekendAvg: 300,
        yoyNeighborClosure: null,
        ...overrides,
    };
}

function record(stationId: string, overrides: Partial<NarrativeStationRecord> = {}): NarrativeStationRecord {
    return { stationId, ctaStationId: "40000", name: `Station ${stationId}`, openedAt: null, closures: [], facts: {}, ...overrides };
}

const REBUILD = { startDate: "2026-01-05", endDate: null, reason: "Closed for reconstruction" };
const TRACK_WORK = { startDate: "2023-03-01", endDate: "2023-06-01", reason: "Track work" };

describe("narrativeInputs", () => {
    it("hands a closed station the closure its status was derived from, unranked", () => {
        const [input] = narrativeInputs(
            [record("state-lake", { ctaStationId: "40260", name: "State/Lake", closures: [TRACK_WORK, REBUILD] })],
            [metricsRow("state-lake", { dataStatus: "zero", ghostScore: -1, tier: null, rank: null, yoyChangePct: null, vs2019Pct: null })],
            [{ stationId: "state-lake", status: "CLOSED", closedAt: "2026-01-05" }],
        );

        expect(input).toMatchObject({
            stationId: "state-lake",
            ctaStationId: "40260",
            name: "State/Lake",
            status: "CLOSED",
            ranked: false,
            tier: null,
            closure: REBUILD,
        });
    });

    it("passes an open ranked station score v2's numbers and its badge, with no closure", () => {
        const [input] = narrativeInputs(
            [record("lasalle", { closures: [TRACK_WORK], facts: { ridership_2001_avg: { value: 1200, quality: "HIGH" } } })],
            [metricsRow("lasalle")],
            [{ stationId: "lasalle", status: "ACTIVE", closedAt: null }],
        );

        expect(input).toEqual({
            stationId: "lasalle",
            ctaStationId: "40000",
            name: "Station lasalle",
            status: "ACTIVE",
            openedAt: null,
            ranked: true,
            tier: "FADING",
            badge: "small-but-growing",
            avg12m: 450,
            yoyChangePct: 2.5,
            vs2019Pct: -12,
            closure: null,
            nearbyClosure: null,
            facts: { ridership_2001_avg: { value: 1200, quality: "HIGH" } },
        });
    });

    it("hands on the closure next door that set year-over-year aside, naming the neighbor by its display name", () => {
        const inputs = narrativeInputs(
            [
                record("wabash", { ctaStationId: "41700", name: "Washington/Wabash" }),
                record("state-lake", { ctaStationId: "40260", name: "State/Lake", closures: [REBUILD] }),
            ],
            [
                metricsRow("wabash", {
                    yoyPct: null,
                    yoyChangePct: null,
                    yoyNeighborClosure: {
                        kind: "neighbor-closure",
                        neighborCtaStationId: "40260",
                        change: "closed",
                        date: "2026-01-05",
                        availableFrom: "2027-04-04",
                    },
                }),
            ],
            [{ stationId: "wabash", status: "ACTIVE", closedAt: null }],
        );

        expect(inputs).toHaveLength(1);
        expect(inputs[0]).toMatchObject({
            stationId: "wabash",
            yoyChangePct: null,
            closure: null,
            nearbyClosure: { stationName: "State/Lake", change: "closed", date: "2026-01-05" },
        });
    });

    it("marks an open station with no recent riders unranked", () => {
        const [input] = narrativeInputs(
            [record("quiet")],
            [metricsRow("quiet", { dataStatus: "missing", ghostScore: -1, tier: null, rank: null })],
            [{ stationId: "quiet", status: "ACTIVE", closedAt: null }],
        );
        expect(input).toMatchObject({ status: "ACTIVE", ranked: false, closure: null });
    });

    it("throws for a station with metrics but no narrative record or no status", () => {
        const status: StationStatusRow = { stationId: "orphan", status: "ACTIVE", closedAt: null };
        expect(() => narrativeInputs([], [metricsRow("orphan")], [status])).toThrow(
            "Station orphan has metrics but no narrative inputs or status",
        );
        expect(() => narrativeInputs([record("orphan")], [metricsRow("orphan")], [])).toThrow(
            "Station orphan has metrics but no narrative inputs or status",
        );
    });
});
