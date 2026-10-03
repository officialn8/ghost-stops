/**
 * The "why this score" card (R18; docs/audit-2026-10-02/ghost-score.md sections 5.2 and 5.3),
 * built from a station's persisted score v2 columns: one row per component with its percentile,
 * its raw value, and a plain-language sentence with the real numbers, the peers the residual used,
 * the small-station badge, and the station's data-quality chips.
 *
 * Pure. Every null is explained by the same rules that nulled it (./availability.ts), fed the
 * stored data-through date, closures, and opening date, and the closures of the stations next
 * door, which can set year-over-year aside. Two raw values have no column and are
 * re-derived exactly as scoring derived them: the residual from the 12-month average and the
 * peers' baseline, the erraticness from the trailing 90 days of rows.
 *
 * Changes are worded with the formatter the narratives use (src/lib/format.ts), so the card and
 * the story quote one number, and read as level by the same band (`isLevelChange`), so they agree
 * on its direction.
 */
import type { StationStatus } from "@prisma/client";
import { formatCalendarDate, formatChange, isLevelChange } from "@/lib/format";
import { addDays } from "@/lib/sync/window";
import { tierName } from "@/lib/utils";
import type { Chip, PeerBasis, WhyCard, WhyComponent, WhyNullReason, WhyPeer } from "@/types/station";
import {
    missingDataReason,
    neighborClosures,
    windowBlock,
    type ClosureRange,
    type NeighborClosureReason,
    type NullReason,
} from "./availability";
import { erraticness, residualLog, summarizeWindow, type DayRow } from "./components";
import { isRanked } from "./ranked";
import { COMPONENT_WEIGHTS, smallStationBadge, type PeerRecord } from "./score";
import { byComponent, COMPONENT_KEYS, scoreWindows, type ComponentKey } from "./windows";

/** A station whose last service date trails the city's by more than this is stale (R18). */
export const STATION_STALE_AFTER_DAYS = 14;

const LABELS: Readonly<Record<ComponentKey, string>> = {
    residual: "Riders against peers",
    yoy: "Change from last year",
    longRun: "Change since 2019",
    erratic: "Day-to-day swings",
};

/** How each component is named inside a chip: "year-over-year available from Oct 2026". */
const CHIP_NAMES: Readonly<Record<ComponentKey, string>> = {
    residual: "neighbor comparison",
    yoy: "year-over-year",
    longRun: "2019 comparison",
    erratic: "day-to-day swing",
};

export interface WhyCardInput {
    /** StationMetrics.dataThrough: the date the score was computed for. */
    dataThrough: string;
    status: StationStatus;
    closedAt: string | null;
    openedAt: string | null;
    closures: readonly ClosureRange[];
    /** The station's CTA id, which names the stations next to it; null off the map. */
    ctaStationId: string | null;
    /**
     * Other stations' recorded closures, with their display names. Those of the stations next to
     * this one decide whether its year-over-year is set aside; any others are ignored.
     */
    neighborClosures: readonly { ctaStationId: string; displayName: string; closures: readonly ClosureRange[] }[];
    metrics: {
        ghostScore: number;
        dataStatus: string;
        serviceDateMax: string | null;
        tier: string | null;
        rank: number | null;
        rankedCount: number | null;
        residualPct: number | null;
        yoyPct: number | null;
        longRunPct: number | null;
        erraticPct: number | null;
        avg12m: number | null;
        baselineAvg: number | null;
        yoyChangePct: number | null;
        vs2019Pct: number | null;
    };
    /** StationMetrics.peerStationIds, parsed. */
    peers: PeerRecord | null;
    /** Slug and display name of each peer, by station id. */
    peerStations: ReadonlyMap<string, { slug: string | null; displayName: string }>;
    /** The station's rows; those inside the trailing 90 days ending at `dataThrough` are used. */
    days: readonly DayRow[];
}

const PEER_BASES: readonly unknown[] = ["neighbors", "loop", "branch-median", "none"] satisfies PeerBasis[];
const isPeerBasis = (v: unknown): v is PeerBasis => PEER_BASES.includes(v);

/** StationMetrics.peerStationIds as scoring wrote it (score.ts `PeerRecord`); null for anything else. */
export function parsePeerRecord(json: unknown): PeerRecord | null {
    if (typeof json !== "object" || json === null) return null;
    const r = json as Record<string, unknown>;
    const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
    const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === "number");
    if (!isPeerBasis(r.basis)) return null;
    if (!strings(r.stationIds) || !strings(r.ctaStationIds) || !numbers(r.avg12m)) return null;
    if (r.stationIds.length !== r.avg12m.length) return null;
    return {
        basis: r.basis,
        line: typeof r.line === "string" ? r.line : null,
        branch: typeof r.branch === "string" ? r.branch : null,
        stationIds: r.stationIds,
        ctaStationIds: r.ctaStationIds,
        avg12m: r.avg12m,
    };
}

/** "Jul 2025", in UTC so a calendar date never shifts a month (KTD17). */
export function monthLabel(date: string): string {
    return formatCalendarDate(date, { month: "short", year: "numeric" });
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "A", "A and B", "A, B, and C". */
function listNames(names: readonly string[]): string {
    if (names.length <= 2) return names.join(" and ");
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** The size of a change in percent, as the narratives print it, without its sign: "4%", "0.3%", "0%". */
function changeSize(changePct: number): string {
    return formatChange(Math.abs(changePct) / 100).replace(/^\+/, "");
}

/** The phrases a station-level chip and a component's null reason share: "reopened Jul 2025". */
const closedSince = (date: string) => `closed since ${monthLabel(date)}`;
const reopenedOn = (date: string) => `reopened ${monthLabel(date)}`;
const openedOn = (date: string) => `opened ${monthLabel(date)}`;
/** "State/Lake closed next door in Jan 2026". */
const changedNextDoor = (name: string, reason: NeighborClosureReason) => `${name} ${reason.change} next door in ${monthLabel(reason.date)}`;

/**
 * The chip text for a null component: "reopened Jul 2025, year-over-year available from Oct 2026",
 * or "State/Lake closed next door in Jan 2026; year-over-year comparable again from Apr 2027".
 */
function nullReasonText(component: ComponentKey, reason: NullReason, nameOf: (ctaStationId: string) => string): string {
    const name = CHIP_NAMES[component];
    const availability = (from: string | null) =>
        from ? `${name} available from ${monthLabel(from)}` : component === "longRun" ? "no 2019 comparison" : `no ${name} yet`;
    switch (reason.kind) {
        case "closed":
            return closedSince(reason.closedFrom);
        case "reopened":
            return `${reopenedOn(reason.reopenedOn)}, ${availability(reason.availableFrom)}`;
        case "new":
            return `${openedOn(reason.openedAt)}, ${availability(reason.availableFrom)}`;
        case "neighbor-closure":
            return `${changedNextDoor(nameOf(reason.neighborCtaStationId), reason)}; ${
                reason.availableFrom ? `${name} comparable again from ${monthLabel(reason.availableFrom)}` : `no ${name} yet`
            }`;
        case "no-peers":
            return "no station on the line to compare with";
        case "no-data":
            return "not enough ridership data";
    }
}

function residualSentence(raw: number, peers: PeerRecord | null, names: readonly string[]): string {
    const ratio = Math.exp(raw);
    const share =
        ratio >= 2
            ? `${Math.round(ratio * 10) / 10} times the riders`
            : `${ratio * 100 >= 1 ? Math.round(ratio * 100) : (ratio * 100).toFixed(1)}% of the riders`;
    switch (peers?.basis) {
        case "loop":
            return `Gets ${share} its Loop neighbors get.`;
        case "branch-median":
            return `Gets ${share} of the median ${peers.line ? `${peers.line} Line` : "line"} station.`;
        default:
            return names.length > 0 ? `Gets ${share} its neighbors ${listNames(names)} get.` : `Gets ${share} its neighbors get.`;
    }
}

/** Level, the band the narratives read too: a change that prints as 0%. */
const isLevel = (changePct: number) => isLevelChange(changePct / 100);

function yoySentence(changePct: number): string {
    if (isLevel(changePct)) return "Unchanged from the same 90 days last year.";
    return `${changePct < 0 ? "Down" : "Up"} ${changeSize(changePct)} from the same 90 days last year.`;
}

function longRunSentence(changePct: number): string {
    if (isLevel(changePct)) return "Carries about as many riders as in 2019.";
    return `Carries ${changeSize(changePct)} ${changePct < 0 ? "fewer" : "more"} riders than in 2019.`;
}

function erraticSentence(ratio: number): string {
    const percent = Math.round(ratio * 100);
    return percent === 0 ? "Ridership holds steady day to day." : `Ridership swings about ${percent}% day to day.`;
}

type ComponentBlocks = Readonly<Record<ComponentKey, NullReason | null>>;

/** The first window block of `kind`, in component order. */
function firstBlock<K extends NullReason["kind"]>(blocks: ComponentBlocks, kind: K): Extract<NullReason, { kind: K }> | undefined {
    return COMPONENT_KEYS.map((k) => blocks[k]).find((b): b is Extract<NullReason, { kind: K }> => b?.kind === kind);
}

/** The station-level chips: closed, reopened, new, nearby closure, stale, in that order, at most one of each. */
function stationChips(input: WhyCardInput, blocks: ComponentBlocks, nameOf: (ctaStationId: string) => string): Chip[] {
    const chips: Chip[] = [];
    const openClosure = input.closures.find((c) => c.endDate === null || c.endDate > input.dataThrough);
    const closedFrom =
        input.status !== "ACTIVE" ? (input.closedAt ?? openClosure?.startDate ?? null) : firstBlock(blocks, "closed")?.closedFrom;
    if (input.status !== "ACTIVE" || closedFrom) {
        chips.push({ kind: "closed", text: closedFrom ? closedSince(closedFrom) : "closed" });
    }
    const reopened = firstBlock(blocks, "reopened");
    if (reopened) chips.push({ kind: "reopened", text: reopenedOn(reopened.reopenedOn) });
    const opened = firstBlock(blocks, "new");
    if (opened) chips.push({ kind: "new", text: openedOn(opened.openedAt) });
    const nextDoor = firstBlock(blocks, "neighbor-closure");
    if (nextDoor) chips.push({ kind: "nearby-closure", text: changedNextDoor(nameOf(nextDoor.neighborCtaStationId), nextDoor) });

    // A closed station has no riders by definition; the closed chip already says why.
    if (chips[0]?.kind !== "closed") {
        const { dataStatus, serviceDateMax } = input.metrics;
        if (dataStatus === "missing") {
            chips.push({ kind: "stale", text: "no ridership data in the last 60 days" });
        } else if (dataStatus === "zero") {
            chips.push({ kind: "stale", text: "under one rider a day in the last 30 days" });
        } else if (serviceDateMax !== null && serviceDateMax < addDays(input.dataThrough, -STATION_STALE_AFTER_DAYS)) {
            chips.push({ kind: "stale", text: `data ends ${serviceDateMax}` });
        }
    }
    return chips;
}

/** A component's sentence with its real numbers, for a component that has a value. */
function componentSentence(key: ComponentKey, value: number, peers: PeerRecord | null, peerList: readonly WhyPeer[]): string {
    switch (key) {
        case "residual":
            return residualSentence(value, peers, peerList.map((p) => p.displayName));
        case "yoy":
            return yoySentence(value);
        case "longRun":
            return longRunSentence(value);
        case "erratic":
            return erraticSentence(value);
    }
}

export function buildWhyCard(input: WhyCardInput): WhyCard {
    const { metrics, peers } = input;
    const closuresByCta = new Map(input.neighborClosures.map((n) => [n.ctaStationId, n.closures]));
    const names = new Map(input.neighborClosures.map((n) => [n.ctaStationId, n.displayName]));
    const nameOf = (ctaStationId: string) => names.get(ctaStationId) ?? ctaStationId;
    const ctx = {
        dataThrough: input.dataThrough,
        openedAt: input.openedAt,
        closures: input.closures,
        neighbors: neighborClosures(input.ctaStationId, closuresByCta),
    };
    const blocks = byComponent((k) => windowBlock(k, ctx));
    const blocked = (k: ComponentKey) => blocks[k] !== null;

    const peerList: WhyPeer[] =
        peers === null
            ? []
            : peers.stationIds.map((id, i) => {
                  const station = input.peerStations.get(id);
                  return { id, slug: station?.slug ?? null, displayName: station?.displayName ?? id, avg12m: peers.avg12m[i] };
              });

    const { trailing90 } = scoreWindows(input.dataThrough);
    const trailing = input.days.filter((d) => d.serviceDate >= trailing90.start && d.serviceDate <= trailing90.end);

    // Each raw value is null whenever scoring left it null: a window block, or data that cannot support it.
    const raws: Record<ComponentKey, number | null> = {
        residual: blocked("residual") ? null : residualLog(metrics.avg12m, metrics.baselineAvg),
        yoy: blocked("yoy") ? null : metrics.yoyChangePct,
        longRun: blocked("longRun") ? null : metrics.vs2019Pct,
        erratic: blocked("erratic") ? null : erraticness(summarizeWindow(trailing)),
    };
    const pcts: Record<ComponentKey, number | null> = {
        residual: metrics.residualPct,
        yoy: metrics.yoyPct,
        longRun: metrics.longRunPct,
        erratic: metrics.erraticPct,
    };

    const components = COMPONENT_KEYS.map((key): WhyComponent => {
        const value = raws[key];
        if (value === null) {
            const reason = blocks[key] ?? missingDataReason(key, peers?.basis ?? null);
            const nullReason: WhyNullReason = { kind: reason.kind, text: nullReasonText(key, reason, nameOf) };
            return { key, label: LABELS[key], weight: COMPONENT_WEIGHTS[key], pct: null, value, sentence: `${capitalize(nullReason.text)}.`, nullReason };
        }
        const sentence = componentSentence(key, value, peers, peerList);
        return { key, label: LABELS[key], weight: COMPONENT_WEIGHTS[key], pct: pcts[key], value, sentence, nullReason: null };
    });

    const ranked = isRanked(input.status, metrics.dataStatus) && metrics.ghostScore >= 0;
    return {
        score: ranked ? metrics.ghostScore : null,
        tier: tierName(metrics.tier),
        rank: metrics.rank,
        rankedCount: metrics.rankedCount,
        badge: smallStationBadge(metrics),
        components,
        chips: stationChips(input, blocks, nameOf),
        peers: {
            basis: peers?.basis ?? "none",
            line: peers?.line ?? null,
            branch: peers?.branch ?? null,
            stations: peerList,
            baseline: metrics.baselineAvg,
        },
    };
}
