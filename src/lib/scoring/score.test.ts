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
const WILSON = "40540";
const ARGYLE = "41200";
const WASHINGTON_WABASH = "41700";

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
        const logan = scoreColumns(byCta("41020")); // Logan Square
        expect(logan.weekdayAvg).toBe(4_797.52);
        expect(logan.weekendAvg).toBe(3_320.08);
        expect(logan.yoyChangePct).toBeCloseTo(((5 * 4_797.52 + 2 * 3_320.08) / (5 * 4_276.57 + 2 * 2_892.64) - 1) * 100, 10);
        expect(logan.vs2019Pct).toBeCloseTo((4_022.58 / 6_196.48 - 1) * 100, 10);

        // Wilson keeps its trailing averages and 2019 change; its year-over-year is set aside (below).
        const wilson = scoreColumns(byCta("40540"));
        expect(wilson.weekdayAvg).toBe(4_836.34);
        expect(wilson.weekendAvg).toBe(3_176.85);
        expect(wilson.yoyChangePct).toBeNull();
        expect(wilson.vs2019Pct).toBeCloseTo((4_514.26 / 5_598.32 - 1) * 100, 10);
    });

    it("sets aside year-over-year next to a closure: Lawrence's reopening for Wilson and Argyle, State/Lake's closing for its neighbors", () => {
        const reopened = { kind: "neighbor-closure", neighborCtaStationId: LAWRENCE, change: "reopened", date: "2025-07-20", availableFrom: "2026-10-17" };
        const closed = { kind: "neighbor-closure", neighborCtaStationId: STATE_LAKE, change: "closed", date: "2026-01-05", availableFrom: "2027-04-04" };
        // Argyle's other neighbor, Berwyn, is not in the fixture, so Lawrence names it.
        const expected: [string, object][] = [
            [WILSON, reopened],
            [ARGYLE, reopened],
            [WASHINGTON_WABASH, closed],
            [CLARK_LAKE, closed],
        ];
        for (const [cta, nullReason] of expected) {
            const s = byCta(cta);
            expect(s.components.yoy, cta).toEqual({ raw: null, pct: null, nullReason });
            expect(s.yoyChangePct, cta).toBeNull();
            expect(s.components.residual.raw, cta).not.toBeNull();
        }
        const setAside = scored.filter((s) => s.components.yoy.nullReason?.kind === "neighbor-closure");
        expect(setAside.map((s) => inputs[scored.indexOf(s)].ctaStationId).sort()).toEqual([CLARK_LAKE, WILSON, ARGYLE, WASHINGTON_WABASH].sort());
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

describe("scoreStations beside a closure", () => {
    // Five Green Line stations in a row; Oak Park, second, was closed until 2025-07-01, inside the
    // year-ago window (2025-05-03 to 2025-07-31) of data through 2026-07-31.
    const OAK_PARK_REOPENED = [{ startDate: "2025-01-01", endDate: "2025-07-01" }];
    const line = (oakParkClosures: { startDate: string; endDate: string | null }[]) =>
        scoreStations("2026-07-31", [
            station("40020", { avg12m: 900, trailing: window({ weekdayAvg: 900, weekendAvg: 540 }) }), // Harlem/Lake
            station("41350", { avg12m: 1_100, closures: oakParkClosures }), // Oak Park (Green)
            station("40610", { avg12m: 700, avg2019: 1_500, trailing: window({ weekdayAvg: 1_300, weekendAvg: 780 }) }), // Ridgeland
            station("41260", { avg12m: 2_000, trailing: window({ weekdayAvg: 800, weekendAvg: 480 }) }), // Austin (Green)
            station("40280", { avg12m: 1_500, trailing: window({ weekdayAvg: 1_050, weekendAvg: 630 }) }), // Central (Green)
        ]);
    const scores = line(OAK_PARK_REOPENED);

    it("sets the outer stations' year-over-year aside and counts it as the median in the composite", () => {
        const reason = { kind: "neighbor-closure", neighborCtaStationId: "41350", change: "reopened", date: "2025-07-01", availableFrom: "2026-09-28" };
        for (const i of [0, 2]) {
            const s = scores[i];
            expect(s.components.yoy).toEqual({ raw: null, pct: null, nullReason: reason });
            expect(scoreColumns(s)).toMatchObject({ yoyPct: null, yoyChangePct: null });
            const { residual, longRun, erratic } = s.components;
            expect(s.composite).toBeCloseTo(
                COMPONENT_WEIGHTS.residual * residual.pct! +
                    COMPONENT_WEIGHTS.yoy * 50 +
                    COMPONENT_WEIGHTS.longRun * longRun.pct! +
                    COMPONENT_WEIGHTS.erratic * erratic.pct!,
                10,
            );
        }
        // Oak Park's own reopening keeps its own reason.
        expect(scores[1].components.yoy.nullReason).toMatchObject({ kind: "reopened", reopenedOn: "2025-07-01" });
        // Austin and Central, not next to Oak Park, keep theirs, ranked between themselves.
        expect([scores[3].components.yoy.pct, scores[4].components.yoy.pct]).toEqual([100, 0]);
    });

    it("ranks every station once, contiguously", () => {
        expect(scores.map((s) => s.rank).sort()).toEqual([1, 2, 3, 4, 5]);
        expect(scores.every((s) => s.ranked && s.rankedCount === 5)).toBe(true);
    });

    it("changes year-over-year only: peers, the residual, the 2019 change, and erraticness are as without the closure", () => {
        const open = line([{ startDate: "2020-01-01", endDate: "2020-06-01" }]);
        expect(open[0].components.yoy.nullReason).toBeNull();
        expect(open[2].components.yoy.nullReason).toBeNull();
        scores.forEach((s, i) => {
            expect(s.peers).toEqual(open[i].peers);
            for (const k of ["residual", "longRun", "erratic"] as const) expect(s.components[k], `${i} ${k}`).toEqual(open[i].components[k]);
        });
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
