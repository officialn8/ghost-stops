/**
 * Ghost score v2 (R14 to R17; KTD8 to KTD10; docs/audit-2026-10-02/ghost-score.md section 5.2).
 *
 * Four components, each a percentile over the ranked stations where it is known, oriented so a
 * higher percentile is more ghost-like: riders below the peers' baseline (45%), a year-over-year
 * decline (25%), a decline since 2019 (20%), and day-to-day erraticness (10%). An unknown
 * component counts as the median, 50. The weighted sum is re-ranked, so the score is itself a
 * percentile: 100 is the most ghost-like ranked station and 0 the least. There is no constant
 * context term; a station's shape (terminal, transfer, Loop) only chooses its peers.
 *
 * Ranked stations are those `isRanked` admits: open, with riders in recent data. Every other
 * station still gets its raw inputs, but no percentile, tier, or rank.
 */
import type { ScoreTier, StationStatus } from "@prisma/client";
import { getTier, type ScoreTierName } from "@/lib/utils";
import type { StationBadge } from "@/types/station";
import { missingDataReason, windowBlock, type ClosureRange, type NullReason } from "./availability";
import { erraticness, residualLog, vs2019Pct, yoyChangePct, type WindowSummary } from "./components";
import { selectPeers, type PeerBasis, type PeerCandidate, type PeerSet } from "./peers";
import { midrankPercentiles } from "./percentile";
import { isRanked, type MetricsDataStatus } from "./ranked";
import { byComponent, COMPONENT_KEYS, type ComponentKey } from "./windows";

export const SCORE_VERSION = 2;

export const COMPONENT_WEIGHTS: Readonly<Record<ComponentKey, number>> = {
    residual: 0.45,
    yoy: 0.25,
    longRun: 0.2,
    erratic: 0.1,
};

/** What an unknown component contributes to the composite (R16): neither for nor against. */
const UNKNOWN_COMPONENT_PCT = 50;

/**
 * Which way each raw value points: the residual and both changes are ghost-like when low, so they
 * are ranked negated; erraticness is ghost-like when high.
 */
const GHOSTWARD: Readonly<Record<ComponentKey, 1 | -1>> = { residual: -1, yoy: -1, longRun: -1, erratic: 1 };

export interface StationScoreInput {
    stationId: string;
    ctaStationId: string | null;
    /** Derived for this run from the closures (src/lib/sync/status.ts). */
    status: StationStatus;
    /** StationMetrics.dataStatus. */
    dataStatus: MetricsDataStatus;
    openedAt: string | null;
    closures: readonly ClosureRange[];
    /** The base metrics' 12-month average, the ledger's number (R25). */
    avg12m: number | null;
    avg2019: number | null;
    /** The trailing 90 days and the same days a year earlier; null when not read. */
    trailing: WindowSummary | null;
    yearAgo: WindowSummary | null;
}

export interface ComponentScore {
    /**
     * The raw value: the residual's log ratio, the year-over-year and 2019 changes in percent, the
     * erraticness ratio. Null when a window rules it out or the data cannot support it.
     */
    raw: number | null;
    /** 0 to 100, higher is more ghost-like; null for an unranked station or an unknown component. */
    pct: number | null;
    /** Why `raw` is null; null whenever it is not. */
    nullReason: NullReason | null;
}

export type SmallStationBadge = StationBadge;

export interface StationScore {
    stationId: string;
    ranked: boolean;
    /** 0 to 100, rounded; null when the station is not ranked. */
    score: number | null;
    tier: ScoreTier | null;
    /** 1 is the most ghost-like; contiguous over ranked stations. */
    rank: number | null;
    rankedCount: number;
    /** The weighted sum of component percentiles, before re-ranking. */
    composite: number | null;
    components: Record<ComponentKey, ComponentScore>;
    peers: PeerSet;
    baselineAvg: number | null;
    yoyChangePct: number | null;
    vs2019Pct: number | null;
    /** From the trailing 90 days. */
    weekdayAvg: number | null;
    weekendAvg: number | null;
    badge: SmallStationBadge | null;
}

/** The stored tier (StationMetrics.tier) for each tier the UI names. */
const STORED_TIERS: Readonly<Record<ScoreTierName, ScoreTier>> = {
    ghost: "GHOST",
    fading: "FADING",
    quiet: "QUIET",
    healthy: "HEALTHY",
};

function tierFor(score: number): ScoreTier {
    return STORED_TIERS[getTier(score).tier];
}

/**
 * The "small but steady" badge (audit section 5.3): a station far below its peers whose riders
 * are not falling, the answer to "a small neighborhood station is not a ghost". Residual
 * percentile 75 or above with both change percentiles known and below 50; "growing" when the
 * year-over-year change is positive. A pure function of persisted columns.
 */
export function smallStationBadge(fields: {
    residualPct: number | null;
    yoyPct: number | null;
    longRunPct: number | null;
    yoyChangePct: number | null;
}): SmallStationBadge | null {
    const { residualPct, yoyPct, longRunPct, yoyChangePct } = fields;
    if (residualPct === null || yoyPct === null || longRunPct === null) return null;
    if (residualPct < 75 || yoyPct >= 50 || longRunPct >= 50) return null;
    return yoyChangePct !== null && yoyChangePct > 0 ? "small-but-growing" : "small-but-steady";
}

/** Scores every station, returning one result per input in input order. Pure. */
export function scoreStations(dataThrough: string, stations: readonly StationScoreInput[]): StationScore[] {
    const ranked = stations.map((s) => isRanked(s.status, s.dataStatus));
    const blocks = stations.map((s) =>
        byComponent((k) => windowBlock(k, { dataThrough, openedAt: s.openedAt, closures: s.closures })),
    );

    // Peers are ranked stations whose own 12-month window is clear of closures and of their opening.
    const eligible = new Map<string, PeerCandidate>();
    stations.forEach((s, i) => {
        if (ranked[i] && s.ctaStationId !== null && s.avg12m !== null && s.avg12m > 0 && blocks[i].residual === null) {
            eligible.set(s.ctaStationId, { stationId: s.stationId, avg12m: s.avg12m });
        }
    });

    const peers = stations.map((s) => selectPeers(s.ctaStationId, eligible));
    const raws = stations.map((s, i): Record<ComponentKey, number | null> => ({
        residual: blocks[i].residual ? null : residualLog(s.avg12m, peers[i].baseline),
        yoy: blocks[i].yoy ? null : yoyChangePct(s.trailing, s.yearAgo),
        longRun: blocks[i].longRun ? null : vs2019Pct(s.avg12m, s.avg2019),
        erratic: blocks[i].erratic ? null : erraticness(s.trailing),
    }));

    const pcts = stations.map(() => byComponent<number | null>(() => null));
    for (const k of COMPONENT_KEYS) {
        const known = stations.flatMap((_, i) => (ranked[i] && raws[i][k] !== null ? [i] : []));
        const ranks = midrankPercentiles(known.map((i) => GHOSTWARD[k] * raws[i][k]!));
        known.forEach((i, j) => (pcts[i][k] = ranks[j]));
    }

    const rankedIdx = stations.flatMap((_, i) => (ranked[i] ? [i] : []));
    const composite = (i: number) =>
        COMPONENT_KEYS.reduce((sum, k) => sum + COMPONENT_WEIGHTS[k] * (pcts[i][k] ?? UNKNOWN_COMPONENT_PCT), 0);
    const composites = new Map(rankedIdx.map((i) => [i, composite(i)]));
    const finalPcts = midrankPercentiles(rankedIdx.map((i) => composites.get(i)!));
    const scores = new Map(rankedIdx.map((i, j) => [i, Math.round(finalPcts[j])]));
    // Rank 1 is the highest composite; equal composites are ordered by station id so reruns agree.
    const byStationId = (a: number, b: number) => (stations[a].stationId < stations[b].stationId ? -1 : 1);
    const order = [...rankedIdx].sort((a, b) => composites.get(b)! - composites.get(a)! || byStationId(a, b));
    const ranks = new Map(order.map((i, j) => [i, j + 1]));

    return stations.map((s, i) => {
        const components = byComponent(
            (k): ComponentScore => ({
                raw: raws[i][k],
                pct: pcts[i][k],
                nullReason: raws[i][k] !== null ? null : (blocks[i][k] ?? missingDataReason(k, peers[i].basis)),
            }),
        );
        const score = scores.get(i) ?? null;
        return {
            stationId: s.stationId,
            ranked: ranked[i],
            score,
            tier: score === null ? null : tierFor(score),
            rank: ranks.get(i) ?? null,
            rankedCount: rankedIdx.length,
            composite: composites.get(i) ?? null,
            components,
            peers: peers[i],
            baselineAvg: peers[i].baseline,
            yoyChangePct: raws[i].yoy,
            vs2019Pct: raws[i].longRun,
            weekdayAvg: blocks[i].erratic ? null : (s.trailing?.weekdayAvg ?? null),
            weekendAvg: blocks[i].erratic ? null : (s.trailing?.weekendAvg ?? null),
            badge: smallStationBadge({
                residualPct: pcts[i].residual,
                yoyPct: pcts[i].yoy,
                longRunPct: pcts[i].longRun,
                yoyChangePct: raws[i].yoy,
            }),
        };
    });
}

/** How StationMetrics.peerStationIds records the peers, so the card can say what was compared. */
export interface PeerRecord {
    basis: PeerBasis;
    line: string | null;
    branch: string | null;
    stationIds: string[];
    ctaStationIds: string[];
    avg12m: number[];
}

/** The StationMetrics columns score v2 owns (R15); `ghostScore` is -1, the no-score marker, when unranked. */
export interface ScoreColumns {
    ghostScore: number;
    scoreVersion: number;
    tier: ScoreTier | null;
    rank: number | null;
    rankedCount: number;
    residualPct: number | null;
    yoyPct: number | null;
    longRunPct: number | null;
    erraticPct: number | null;
    baselineAvg: number | null;
    peerStationIds: PeerRecord;
    yoyChangePct: number | null;
    vs2019Pct: number | null;
    weekdayAvg: number | null;
    weekendAvg: number | null;
}

export function scoreColumns(score: StationScore): ScoreColumns {
    const { basis, line, branch, stationIds, ctaStationIds, avg12m } = score.peers;
    return {
        ghostScore: score.score ?? -1,
        scoreVersion: SCORE_VERSION,
        tier: score.tier,
        rank: score.rank,
        rankedCount: score.rankedCount,
        residualPct: score.components.residual.pct,
        yoyPct: score.components.yoy.pct,
        longRunPct: score.components.longRun.pct,
        erraticPct: score.components.erratic.pct,
        baselineAvg: score.baselineAvg,
        peerStationIds: { basis, line, branch, stationIds, ctaStationIds, avg12m },
        yoyChangePct: score.yoyChangePct,
        vs2019Pct: score.vs2019Pct,
        weekdayAvg: score.weekdayAvg,
        weekendAvg: score.weekendAvg,
    };
}
