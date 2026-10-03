import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/stations.json";
import type { WindowSummary } from "./components";
import {
    COMPONENT_WEIGHTS,
    SCORE_VERSION,
    scoreColumns,
    scoreStations,
    smallStationBadge,
    type StationScore,
    type StationScoreInput,
} from "./score";

const inputs = fixture.stations.map((s) => s.input as StationScoreInput);
const scored = scoreStations(fixture.dataThrough, inputs);
const byCta = (cta: string): StationScore => {
    const i = inputs.findIndex((input) => input.ctaStationId === cta);
    return scored[i];
};

const LAWRENCE = "40770";
const STATE_LAKE = "40260";
const LASALLE_VAN_BUREN = "40160";
const CLARK_LAKE = "40380";
const DAMEN_GREEN = "41710";

const window = (overrides: Partial<WindowSummary> = {}): WindowSummary => ({
    weekdayDays: 64,
    weekendDays: 26,
    weekdayAvg: 1_000,
    weekendAvg: 600,
    weekdayMadRatio: 0.08,
    weekendMadRatio: 0.15,
    ...overrides,
});

/** A station on the Green Line's main branch at `ctaStationId`, open throughout, with steady ridership. */
const station = (ctaStationId: string, overrides: Partial<StationScoreInput> = {}): StationScoreInput => ({
    stationId: `s-${ctaStationId}`,
    ctaStationId,
    status: "ACTIVE",
    dataStatus: "normal",
    openedAt: null,
    closures: [],
    avg12m: 1_000,
    avg2019: 1_200,
    trailing: window(),
    yearAgo: window(),
    ...overrides,
});

describe("scoreStations on the fixture", () => {
    it("returns one score per input, in input order", () => {
        expect(scored.map((s) => s.stationId)).toEqual(inputs.map((i) => i.stationId));
    });

    it("AE1: Lawrence through 2026-07-31 has a residual and a 2019 comparison, no year-over-year, and no badge", () => {
        const lawrence = byCta(LAWRENCE);
        expect(lawrence.ranked).toBe(true);
        expect(lawrence.components.residual.raw).not.toBeNull();
        expect(lawrence.components.residual.pct).not.toBeNull();
        expect(lawrence.components.longRun.raw).not.toBeNull();
        expect(lawrence.components.longRun.pct).not.toBeNull();
        expect(lawrence.components.yoy).toEqual({
            raw: null,
            pct: null,
            nullReason: { kind: "reopened", closedFrom: "2021-05-16", reopenedOn: "2025-07-20", availableFrom: "2026-10-17" },
        });
        expect(lawrence.badge).toBeNull();
    });

    it("excludes closed State/Lake from the ranking but still scores it a row", () => {
        const stateLake = byCta(STATE_LAKE);
        expect(stateLake).toMatchObject({ ranked: false, score: null, tier: null, rank: null, composite: null });
        expect(stateLake.rankedCount).toBe(25);
        for (const component of Object.values(stateLake.components)) {
            expect(component.pct).toBeNull();
            expect(component.nullReason).toEqual({ kind: "closed", closedFrom: "2026-01-05" });
        }
        expect(scoreColumns(stateLake)).toMatchObject({ ghostScore: -1, tier: null, rank: null, rankedCount: 25, scoreVersion: SCORE_VERSION });
    });

    it("ranks every ranked station once, contiguously from 1 to the ranked count", () => {
        const ranked = scored.filter((s) => s.ranked);
        expect(ranked).toHaveLength(25);
        expect(ranked.map((s) => s.rank).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
        for (const s of scored) expect(s.rankedCount).toBe(25);
    });

    it("orders scores the same way as ranks, from 0 to 100", () => {
        const ranked = scored.filter((s) => s.ranked).sort((a, b) => a.rank! - b.rank!);
        expect(ranked[0].score).toBe(100);
        expect(ranked[ranked.length - 1].score).toBe(0);
        for (let i = 1; i < ranked.length; i++) expect(ranked[i].score!).toBeLessThanOrEqual(ranked[i - 1].score!);
    });

    it("compares a Loop station with the other open Loop stations", () => {
        const lasalle = byCta(LASALLE_VAN_BUREN);
        expect(lasalle.peers.basis).toBe("loop");
        expect([...lasalle.peers.ctaStationIds].sort()).toEqual(["40040", "40680", "40730", "40850", "41700"]);
    });

    it("compares Clark/Lake with its primary line's branch median, and the persisted record says so", () => {
        const clarkLake = byCta(CLARK_LAKE);
        expect(clarkLake.peers).toMatchObject({ basis: "branch-median", line: "Blue", branch: "main" });
        expect(scoreColumns(clarkLake).peerStationIds).toMatchObject({ basis: "branch-median", line: "Blue", branch: "main" });
    });

    it("gives a component with no usable window the median in the composite and keeps its percentile null", () => {
        const damen = byCta(DAMEN_GREEN);
        expect(damen.components.longRun).toEqual({ raw: null, pct: null, nullReason: { kind: "new", openedAt: "2024-08-05", availableFrom: null } });
        const { residual, yoy, erratic } = damen.components;
        expect(damen.composite).toBeCloseTo(
            COMPONENT_WEIGHTS.residual * residual.pct! +
                COMPONENT_WEIGHTS.yoy * yoy.pct! +
                COMPONENT_WEIGHTS.longRun * 50 +
                COMPONENT_WEIGHTS.erratic * erratic.pct!,
            10,
        );
    });

    it("persists the trailing weekday and weekend averages and the raw changes", () => {
        const columns = scoreColumns(byCta("40540")); // Wilson
        expect(columns.weekdayAvg).toBe(4_836.34);
        expect(columns.weekendAvg).toBe(3_176.85);
        expect(columns.yoyChangePct).toBeCloseTo(((5 * 4_836.34 + 2 * 3_176.85) / (5 * 5_826.38 + 2 * 4_095.36) - 1) * 100, 10);
        expect(columns.vs2019Pct).toBeCloseTo((4_514.26 / 5_598.32 - 1) * 100, 10);
    });

    it.each(fixture.stations.filter((s) => "expected" in s).map((s) => [s.name, s] as const))(
        "matches the contract for %s",
        (_name, s) => {
            const actual = byCta(s.input.ctaStationId);
            const expected = (s as unknown as { expected: Record<string, unknown> }).expected;
            expect(contractView(actual)).toEqual(expected);
        },
    );
});

/** The fields the fixture pins, rounded so the contract reads cleanly. */
function contractView(s: StationScore) {
    const round = (value: number | null, places: number) => (value === null ? null : Number(value.toFixed(places)));
    const component = (c: StationScore["components"]["residual"]) => ({
        raw: round(c.raw, 4),
        pct: round(c.pct, 2),
        nullReason: c.nullReason,
    });
    return {
        ranked: s.ranked,
        score: s.score,
        tier: s.tier,
        rank: s.rank,
        composite: round(s.composite, 2),
        baselineAvg: round(s.baselineAvg, 2),
        peers: { basis: s.peers.basis, line: s.peers.line, branch: s.peers.branch, ctaStationIds: s.peers.ctaStationIds },
        components: {
            residual: component(s.components.residual),
            yoy: component(s.components.yoy),
            longRun: component(s.components.longRun),
            erratic: component(s.components.erratic),
        },
        badge: s.badge,
    };
}

describe("scoreStations at the edges", () => {
    it("returns nothing for an empty population", () => {
        expect(scoreStations("2026-07-31", [])).toEqual([]);
    });

    it("puts a lone station at the median, ranked first of one, with no peers", () => {
        const [only] = scoreStations("2026-07-31", [station("40020")]);
        expect(only).toMatchObject({ ranked: true, score: 50, tier: "QUIET", rank: 1, rankedCount: 1 });
        expect(only.peers.basis).toBe("none");
        expect(only.components.residual).toEqual({ raw: null, pct: null, nullReason: { kind: "no-peers" } });
        expect(only.components.yoy.pct).toBe(50);
    });

    it("leaves the residual null with a no-peers reason when no station on the line can be a peer", () => {
        const scores = scoreStations("2026-07-31", [
            station("40140"), // Dempster-Skokie: its only line partners are Oakton-Skokie and Howard (a hub)
            station("40020"),
            station("41350"),
        ]);
        expect(scores[0].components.residual).toEqual({ raw: null, pct: null, nullReason: { kind: "no-peers" } });
        expect(scoreColumns(scores[0]).peerStationIds).toMatchObject({ basis: "none", stationIds: [] });
    });

    it("leaves components null with a no-data reason when their windows have no rows", () => {
        const [missing] = scoreStations("2026-07-31", [station("40020", { trailing: null, yearAgo: null, avg2019: null }), station("41350")]);
        expect(missing.components.yoy).toEqual({ raw: null, pct: null, nullReason: { kind: "no-data" } });
        expect(missing.components.erratic).toEqual({ raw: null, pct: null, nullReason: { kind: "no-data" } });
        expect(missing.components.longRun).toEqual({ raw: null, pct: null, nullReason: { kind: "no-data" } });
        expect(scoreColumns(missing)).toMatchObject({ weekdayAvg: null, weekendAvg: null, yoyChangePct: null, vs2019Pct: null });
    });

    it("excludes zero and missing data statuses from the ranking and from everyone's peers", () => {
        const scores = scoreStations("2026-07-31", [
            station("40020"), // Harlem/Lake
            station("41350", { dataStatus: "zero", avg12m: 0.5 }), // Oak Park (Green)
            station("40610", { dataStatus: "missing", avg12m: 800 }), // Ridgeland
            station("41260", { avg12m: 2_000 }), // Austin (Green)
        ]);
        expect(scores.map((s) => s.rank)).toEqual([expect.any(Number), null, null, expect.any(Number)]);
        expect(scores[0].peers.ctaStationIds).toEqual(["41260"]);
        expect(scores[0].rankedCount).toBe(2);
    });

    it("gives tied stations equal scores and breaks the rank tie by station id", () => {
        const scores = scoreStations("2026-07-31", [station("40020", { stationId: "b" }), station("40020", { stationId: "a" })]);
        expect(scores[0].score).toBe(scores[1].score);
        expect(scores.map((s) => s.rank)).toEqual([2, 1]);
    });

    it("ranks a station whose components rank higher as more ghost-like", () => {
        // Four Green Line stations in a row. Ridgeland carries a third of its neighbors' riders and lost a fifth of them.
        const scores = scoreStations("2026-07-31", [
            station("40020", { avg12m: 3_000 }), // Harlem/Lake
            station("41350", { avg12m: 3_000 }), // Oak Park (Green)
            station("40610", { avg12m: 1_000, trailing: window({ weekdayAvg: 800, weekendAvg: 480 }), avg2019: 2_000 }), // Ridgeland
            station("41260", { avg12m: 3_000 }), // Austin (Green)
        ]);
        expect(scores[2]).toMatchObject({ rank: 1, score: 100, tier: "GHOST" });
        expect(scores[2].components.residual.pct).toBe(100);
        expect(scores[2].components.yoy.pct).toBe(100);
    });
});

describe("smallStationBadge", () => {
    it("marks a station far below its peers whose change components are low as small but steady", () => {
        expect(smallStationBadge({ residualPct: 80, yoyPct: 30, longRunPct: 40, yoyChangePct: -1 })).toBe("small-but-steady");
        expect(smallStationBadge({ residualPct: 75, yoyPct: 49.9, longRunPct: 0, yoyChangePct: 0 })).toBe("small-but-steady");
    });

    it("says small but growing when its riders rose year over year", () => {
        expect(smallStationBadge({ residualPct: 90, yoyPct: 10, longRunPct: 20, yoyChangePct: 6.5 })).toBe("small-but-growing");
    });

    it("gives no badge below the residual threshold, at or above the change threshold, or with a change component missing", () => {
        expect(smallStationBadge({ residualPct: 74.9, yoyPct: 10, longRunPct: 10, yoyChangePct: 1 })).toBeNull();
        expect(smallStationBadge({ residualPct: 90, yoyPct: 50, longRunPct: 10, yoyChangePct: 1 })).toBeNull();
        expect(smallStationBadge({ residualPct: 90, yoyPct: 10, longRunPct: 50, yoyChangePct: 1 })).toBeNull();
        expect(smallStationBadge({ residualPct: 90, yoyPct: null, longRunPct: 10, yoyChangePct: null })).toBeNull();
        expect(smallStationBadge({ residualPct: null, yoyPct: 10, longRunPct: 10, yoyChangePct: 1 })).toBeNull();
    });

    it("is what scoreStations reports for a small steady station and a small growing one", () => {
        // Two quiet stations among busy neighbors, both holding their riders; one also growing.
        const busy = { avg12m: 5_000, avg2019: 8_000, yearAgo: window({ weekdayAvg: 1_250, weekendAvg: 750 }) };
        const scores = scoreStations("2026-07-31", [
            station("40020", busy),
            station("41350", { avg12m: 1_000, avg2019: 900 }), // steady: same as a year ago
            station("40610", busy),
            station("41260", { avg12m: 1_000, avg2019: 900, trailing: window({ weekdayAvg: 1_100, weekendAvg: 660 }) }), // growing
            station("40280", busy),
        ]);
        expect(scores[1].badge).toBe("small-but-steady");
        expect(scores[3].badge).toBe("small-but-growing");
        expect(scores[0].badge).toBeNull();
    });
});
