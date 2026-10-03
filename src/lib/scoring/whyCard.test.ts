import { describe, expect, it } from "vitest";
import type { ScoreComponentKey } from "@/types/station";
import type { DayRow } from "./components";
import { buildWhyCard, monthLabel, parsePeerRecord, type WhyCardInput } from "./whyCard";

const DATA_THROUGH = "2026-07-31";

function input(overrides: Partial<WhyCardInput> = {}, metrics: Partial<WhyCardInput["metrics"]> = {}): WhyCardInput {
    return {
        dataThrough: DATA_THROUGH,
        status: "ACTIVE",
        closedAt: null,
        openedAt: null,
        closures: [],
        peers: { basis: "loop", line: "Brown", branch: "loop", stationIds: [], ctaStationIds: [], avg12m: [] },
        peerStations: new Map(),
        days: [],
        ...overrides,
        metrics: {
            ghostScore: 50,
            dataStatus: "normal",
            serviceDateMax: DATA_THROUGH,
            tier: "QUIET",
            rank: 70,
            rankedCount: 143,
            residualPct: 50,
            yoyPct: 50,
            longRunPct: 50,
            erraticPct: 50,
            avg12m: 450,
            baselineAvg: 1000,
            yoyChangePct: -4,
            vs2019Pct: -38.4,
            ...metrics,
        },
    };
}

const row = (card: ReturnType<typeof buildWhyCard>, key: ScoreComponentKey) => card.components.find((c) => c.key === key)!;

describe("buildWhyCard sentences", () => {
    it("words each change with its sign, as the narratives round it", () => {
        const cases: [number, string, string][] = [
            [-4, "Down 4% from the same 90 days last year.", "Carries 4% fewer riders than in 2019."],
            [12.4, "Up 12% from the same 90 days last year.", "Carries 12% more riders than in 2019."],
            [0.3, "Up 0.3% from the same 90 days last year.", "Carries 0.3% more riders than in 2019."],
            [-0.02, "Unchanged from the same 90 days last year.", "Carries about as many riders as in 2019."],
            // The level band the narratives share (isLevelChange): under 0.05 points either way.
            [-0.04, "Unchanged from the same 90 days last year.", "Carries about as many riders as in 2019."],
            [0.04, "Unchanged from the same 90 days last year.", "Carries about as many riders as in 2019."],
            [0.05, "Up 0.1% from the same 90 days last year.", "Carries 0.1% more riders than in 2019."],
        ];
        for (const [change, yoy, longRun] of cases) {
            const card = buildWhyCard(input({}, { yoyChangePct: change, vs2019Pct: change }));
            expect(row(card, "yoy").sentence).toBe(yoy);
            expect(row(card, "longRun").sentence).toBe(longRun);
        }
    });

    it("names the residual's peers the way they were chosen", () => {
        const loop = buildWhyCard(input());
        expect(row(loop, "residual").sentence).toBe("Gets 45% of the riders its Loop neighbors get.");

        const garfield = buildWhyCard(
            input({
                peers: {
                    basis: "neighbors",
                    line: "Green",
                    branch: "main",
                    stationIds: ["a", "b", "c"],
                    ctaStationIds: ["40130", "40940", "41140"],
                    avg12m: [900, 1000, 1100],
                },
                peerStations: new Map([
                    ["a", { slug: "51st", displayName: "51st" }],
                    ["b", { slug: "halsted-green", displayName: "Halsted" }],
                    ["c", { slug: "king-drive", displayName: "King Drive" }],
                ]),
            }),
        );
        expect(row(garfield, "residual").sentence).toBe("Gets 45% of the riders its neighbors 51st, Halsted, and King Drive get.");

        const hub = buildWhyCard(
            input({ peers: { basis: "branch-median", line: "Red", branch: "main", stationIds: [], ctaStationIds: [], avg12m: [] } }, { avg12m: 3240 }),
        );
        expect(row(hub, "residual").sentence).toBe("Gets 3.2 times the riders of the median Red Line station.");

        expect(row(buildWhyCard(input({}, { avg12m: 4 })), "residual").sentence).toBe("Gets 0.4% of the riders its Loop neighbors get.");
    });

    it("states erraticness from the trailing 90 days only", () => {
        const days: DayRow[] = [
            // Outside the window (before 2026-05-03): ignored.
            { serviceDate: "2026-05-01", entries: 5000, dayType: "W" },
            { serviceDate: "2026-07-28", entries: 100, dayType: "W" },
            { serviceDate: "2026-07-29", entries: 100, dayType: "W" },
            { serviceDate: "2026-07-30", entries: 100, dayType: "W" },
        ];
        expect(row(buildWhyCard(input({ days })), "erratic")).toMatchObject({ value: 0, sentence: "Ridership holds steady day to day." });
        expect(row(buildWhyCard(input()), "erratic")).toMatchObject({
            value: null,
            pct: null,
            nullReason: { kind: "no-data", text: "not enough ridership data" },
            sentence: "Not enough ridership data.",
        });
    });
});

describe("buildWhyCard nulls and chips", () => {
    it("explains a station opened in 2024: no 2019 comparison, and the new chip", () => {
        const card = buildWhyCard(input({ openedAt: "2024-08-05" }, { longRunPct: null, vs2019Pct: null }));
        expect(row(card, "longRun")).toMatchObject({
            value: null,
            pct: null,
            nullReason: { kind: "new", text: "opened Aug 2024, no 2019 comparison" },
        });
        expect(row(card, "yoy").value).toBe(-4);
        expect(card.chips).toEqual([{ kind: "new", text: "opened Aug 2024" }]);
    });

    it("says when a newly opened station's year-over-year arrives", () => {
        const card = buildWhyCard(input({ openedAt: "2025-09-15" }, { yoyChangePct: null, vs2019Pct: null }));
        expect(row(card, "yoy").nullReason).toEqual({ kind: "new", text: "opened Sep 2025, year-over-year available from Dec 2026" });
        expect(row(card, "residual").nullReason).toEqual({
            kind: "new",
            text: "opened Sep 2025, neighbor comparison available from Sep 2026",
        });
    });

    it("says when no station on the line qualifies as a peer", () => {
        const card = buildWhyCard(
            input({ peers: { basis: "none", line: "Yellow", branch: "main", stationIds: [], ctaStationIds: [], avg12m: [] } }, { baselineAvg: null }),
        );
        expect(row(card, "residual").nullReason).toEqual({ kind: "no-peers", text: "no station on the line to compare with" });
    });

    it("marks a station stale when it reports no riders or its data trails the city's by over 14 days", () => {
        const stale = (metrics: Partial<WhyCardInput["metrics"]>) => buildWhyCard(input({}, metrics)).chips;
        expect(stale({ dataStatus: "missing" })).toEqual([{ kind: "stale", text: "no ridership data in the last 60 days" }]);
        expect(stale({ dataStatus: "zero" })).toEqual([{ kind: "stale", text: "under one rider a day in the last 30 days" }]);
        expect(stale({ serviceDateMax: "2026-07-16" })).toEqual([{ kind: "stale", text: "data ends 2026-07-16" }]);
        expect(stale({ serviceDateMax: "2026-07-17" })).toEqual([]);
    });

    it("gives a closed station the closed chip without a stale one, and no score", () => {
        const card = buildWhyCard(
            input(
                { status: "CLOSED", closedAt: "2026-01-05", closures: [{ startDate: "2026-01-05", endDate: null }] },
                { ghostScore: -1, dataStatus: "zero", tier: null, rank: null },
            ),
        );
        expect(card).toMatchObject({ score: null, tier: null, rank: null });
        expect(card.chips).toEqual([{ kind: "closed", text: "closed since Jan 2026" }]);
    });

    it("scores the healthiest ranked station 0, the other side of the -1 unranked sentinel", () => {
        const card = buildWhyCard(input({}, { ghostScore: 0, tier: "HEALTHY", rank: 143, rankedCount: 143 }));
        expect(card).toMatchObject({ score: 0, tier: "healthy", rank: 143, rankedCount: 143 });
    });

    it("badges a small station whose riders are steady", () => {
        const card = buildWhyCard(input({}, { residualPct: 80, yoyPct: 30, longRunPct: 40, yoyChangePct: -0.5 }));
        expect(card.badge).toBe("small-but-steady");
    });
});

describe("parsePeerRecord", () => {
    it("reads the stored record and rejects anything else", () => {
        const record = { basis: "loop", line: "Brown", branch: "loop", stationIds: ["a"], ctaStationIds: ["40260"], avg12m: [10] };
        expect(parsePeerRecord(record)).toEqual(record);
        expect(parsePeerRecord(null)).toBeNull();
        expect(parsePeerRecord({ ...record, basis: "everyone" })).toBeNull();
        expect(parsePeerRecord({ ...record, avg12m: [] })).toBeNull();
    });
});

describe("monthLabel", () => {
    it("reads the calendar date in UTC, so the first of a month stays in it", () => {
        expect(monthLabel("2025-07-01")).toBe("Jul 2025");
        expect(monthLabel("2026-01-31")).toBe("Jan 2026");
    });
});
