/**
 * When a score v2 component cannot be computed, and why (R16, KTD9). A component is null when any
 * window it reads overlaps one of the station's closures or starts before the station opened; the
 * reason, with its dates, is what the "why this score" card shows in place of the number.
 *
 * Year-over-year is also set aside when a station next door closed or reopened across its two
 * windows (Nate, 2026-10-03): a closure moves riders to the stations beside it, so the trailing 90
 * days and the same days a year earlier no longer compare like with like. State/Lake's closure
 * swells Washington/Wabash and Clark/Lake; Lawrence and Berwyn's reopening drains Argyle and Wilson.
 * The 12-month and 2019 comparisons, which do not set a year against a year, are unaffected.
 *
 * Everything here is a pure function of the data-through date, the station's closures, its
 * opening date, and its neighbors' closures, all of which are stored (StationMetrics.dataThrough,
 * StationClosure, Station.openedAt, and the line sequences), so a reader can re-derive the reason
 * for any persisted null percentile.
 */
import { adjacentStations } from "@/lib/cta/sequences";
import { addDays, type DateWindow } from "@/lib/sync/window";
import type { PeerBasis } from "./peers";
import { componentWindows, scoreWindows, YEAR_2019, type ComponentKey } from "./windows";

/** A closed range: startDate up to, not including, endDate; endDate null while still closed. */
export interface ClosureRange {
    startDate: string;
    endDate: string | null;
}

/** A station next to this one on a line (`adjacentStations`), with its recorded closures. */
export interface NeighborClosures {
    ctaStationId: string;
    closures: readonly ClosureRange[];
}

export interface AvailabilityContext {
    dataThrough: string;
    openedAt: string | null;
    closures: readonly ClosureRange[];
    /** The station's neighbors that have closures (`neighborClosures`); only year-over-year reads them. */
    neighbors: readonly NeighborClosures[];
}

export type NullReason =
    /** The station is closed on the data-through date. */
    | { kind: "closed"; closedFrom: string }
    /**
     * The station reopened, but the component's windows still reach back into the closure.
     * `availableFrom` is the first data-through date at which they no longer do.
     */
    | { kind: "reopened"; closedFrom: string; reopenedOn: string; availableFrom: string | null }
    /** The station opened after a window starts; `availableFrom` is null when that window never moves (2019). */
    | { kind: "new"; openedAt: string; availableFrom: string | null }
    /**
     * Year-over-year only: a station next door was open in one window and closed in the other, or
     * closed for part of either. `date` is the change that did it, the closure's start ("closed")
     * or the day service resumed ("reopened"), the latest such change at any neighbor. `availableFrom`
     * is the first data-through date at which no neighbor's recorded closures do it.
     */
    | {
          kind: "neighbor-closure";
          neighborCtaStationId: string;
          change: "closed" | "reopened";
          date: string;
          availableFrom: string | null;
      }
    /** The windows are clear but hold no usable rows. */
    | { kind: "no-data" }
    /** The residual has no open station on the line to compare with. */
    | { kind: "no-peers" };

/** Far enough for the longest window (a year and 90 days) to clear any closure that has ended. */
const AVAILABLE_FROM_HORIZON_DAYS = 3 * 366;

const overlaps = (window: DateWindow, closure: ClosureRange) =>
    closure.startDate <= window.end && (closure.endDate === null || closure.endDate > window.start);

/** A window is blocked when one of the station's closures overlaps it or the station opened after it starts. */
function blocksWindow(window: DateWindow, ctx: AvailabilityContext): boolean {
    return ctx.closures.some((c) => overlaps(window, c)) || (ctx.openedAt !== null && ctx.openedAt > window.start);
}

function isBlocked(component: ComponentKey, ctx: AvailabilityContext, dataThrough: string): boolean {
    return componentWindows(component, dataThrough).some((w) => blocksWindow(w, ctx));
}

/** The first data-through date after `ctx.dataThrough` at which the component is no longer blocked. */
function availableFrom(component: ComponentKey, ctx: AvailabilityContext): string | null {
    // The 2019 window never moves: a closure in it, or an opening after it starts, blocks for good.
    if (component === "longRun" && blocksWindow(YEAR_2019, ctx)) return null;
    let date = ctx.dataThrough;
    for (let i = 0; i < AVAILABLE_FROM_HORIZON_DAYS; i++) {
        date = addDays(date, 1);
        if (!isBlocked(component, ctx, date)) return date;
    }
    return null;
}

export type NeighborClosureReason = Extract<NullReason, { kind: "neighbor-closure" }>;

/**
 * The neighbors of the station with CTA id `ctaStationId` that have recorded closures, from every
 * station's closures keyed by CTA id. Scoring and the why card both build a context with it.
 */
export function neighborClosures(
    ctaStationId: string | null,
    closuresByCta: ReadonlyMap<string, readonly ClosureRange[]>,
): NeighborClosures[] {
    if (ctaStationId === null) return [];
    return adjacentStations(ctaStationId).flatMap((id) => {
        const closures = closuresByCta.get(id);
        return closures && closures.length > 0 ? [{ ctaStationId: id, closures }] : [];
    });
}

/** Back-to-back or overlapping closures as one, so a window inside both reads as closed throughout. */
function mergeClosures(closures: readonly ClosureRange[]): ClosureRange[] {
    const merged: ClosureRange[] = [];
    for (const c of [...closures].sort((a, b) => (a.startDate < b.startDate ? -1 : 1))) {
        const last = merged[merged.length - 1];
        if (last && (last.endDate === null || c.startDate <= last.endDate)) {
            if (last.endDate !== null && (c.endDate === null || c.endDate > last.endDate)) last.endDate = c.endDate;
        } else {
            merged.push({ ...c });
        }
    }
    return merged;
}

type WindowState = "open" | "closed" | "part-closed";

function stateIn(window: DateWindow, closures: readonly ClosureRange[]): WindowState {
    const touching = closures.filter((c) => overlaps(window, c));
    if (touching.length === 0) return "open";
    const covers = (c: ClosureRange) => c.startDate <= window.start && (c.endDate === null || c.endDate > window.end);
    return touching.some(covers) ? "closed" : "part-closed";
}

interface NeighborChange {
    change: "closed" | "reopened";
    date: string;
}

/**
 * The change at a neighbor (merged closures) that sets year-over-year aside on `dataThrough`, or
 * null: none when the neighbor is open throughout both windows or closed throughout both. A start
 * or end date counts when the day before it and the day itself both fall between the year-ago
 * window's start and the trailing window's end; the latest such date is named.
 */
function neighborChange(dataThrough: string, closures: readonly ClosureRange[]): NeighborChange | null {
    const { trailing90, yearAgo90 } = scoreWindows(dataThrough);
    const now = stateIn(trailing90, closures);
    if (now !== "part-closed" && now === stateIn(yearAgo90, closures)) return null;
    const inSpan = (date: string) => date > yearAgo90.start && date <= trailing90.end;
    const changes = closures.flatMap((c): NeighborChange[] => [
        ...(inSpan(c.startDate) ? [{ change: "closed" as const, date: c.startDate }] : []),
        ...(c.endDate !== null && inSpan(c.endDate) ? [{ change: "reopened" as const, date: c.endDate }] : []),
    ]);
    return changes.reduce<NeighborChange | null>((latest, c) => (latest === null || c.date > latest.date ? c : latest), null);
}

/** Why a closure next door sets year-over-year aside on `ctx.dataThrough`, or null when none does. */
function neighborClosureBlock(ctx: AvailabilityContext): NeighborClosureReason | null {
    const neighbors = ctx.neighbors.map((n) => ({ ctaStationId: n.ctaStationId, closures: mergeClosures(n.closures) }));
    const changeOn = (dataThrough: string) =>
        neighbors.flatMap((n) => {
            const change = neighborChange(dataThrough, n.closures);
            return change ? [{ ctaStationId: n.ctaStationId, ...change }] : [];
        });

    // The latest change names the reason; on a tie, the neighbor first along the lines.
    const latest = changeOn(ctx.dataThrough).reduce<ReturnType<typeof changeOn>[number] | null>(
        (best, c) => (best === null || c.date > best.date ? c : best),
        null,
    );
    if (latest === null) return null;

    let availableFrom: string | null = null;
    let date = ctx.dataThrough;
    for (let i = 0; i < AVAILABLE_FROM_HORIZON_DAYS; i++) {
        date = addDays(date, 1);
        if (changeOn(date).length === 0) {
            availableFrom = date;
            break;
        }
    }
    return { kind: "neighbor-closure", neighborCtaStationId: latest.ctaStationId, change: latest.change, date: latest.date, availableFrom };
}

/**
 * Why the component's windows rule it out on `ctx.dataThrough`, or null when they do not. The
 * station's own closures and opening come first; only then, for year-over-year, its neighbors'.
 */
export function windowBlock(component: ComponentKey, ctx: AvailabilityContext): NullReason | null {
    const windows = componentWindows(component, ctx.dataThrough);
    const closure = ctx.closures
        .filter((c) => windows.some((w) => overlaps(w, c)))
        .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
    if (closure) {
        if (closure.endDate === null || closure.endDate > ctx.dataThrough) {
            return { kind: "closed", closedFrom: closure.startDate };
        }
        return {
            kind: "reopened",
            closedFrom: closure.startDate,
            reopenedOn: closure.endDate,
            availableFrom: availableFrom(component, ctx),
        };
    }
    if (ctx.openedAt !== null && windows.some((w) => ctx.openedAt! > w.start)) {
        return { kind: "new", openedAt: ctx.openedAt, availableFrom: availableFrom(component, ctx) };
    }
    return component === "yoy" ? neighborClosureBlock(ctx) : null;
}

/**
 * Why a component whose windows are clear still has no value: no peers for the residual, else no
 * data. A reader explaining a null component uses its `windowBlock` first, then this.
 */
export function missingDataReason(component: ComponentKey, peerBasis: PeerBasis | null): NullReason {
    return component === "residual" && peerBasis === "none" ? { kind: "no-peers" } : { kind: "no-data" };
}
