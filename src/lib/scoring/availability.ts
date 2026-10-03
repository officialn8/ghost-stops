/**
 * When a score v2 component cannot be computed, and why (R16, KTD9). A component is null when any
 * window it reads overlaps one of the station's closures or starts before the station opened; the
 * reason, with its dates, is what the "why this score" card shows in place of the number.
 *
 * Everything here is a pure function of the data-through date, the station's closures, and its
 * opening date, all of which are stored (StationMetrics.dataThrough, StationClosure,
 * Station.openedAt), so a reader can re-derive the reason for any persisted null percentile.
 */
import { addDays, type DateWindow } from "@/lib/sync/window";
import type { PeerBasis } from "./peers";
import { componentWindows, YEAR_2019, type ComponentKey } from "./windows";

/** A closed range: startDate up to, not including, endDate; endDate null while still closed. */
export interface ClosureRange {
    startDate: string;
    endDate: string | null;
}

export interface AvailabilityContext {
    dataThrough: string;
    openedAt: string | null;
    closures: readonly ClosureRange[];
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

/** Why the component's windows rule it out on `ctx.dataThrough`, or null when they do not. */
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
    return null;
}

/**
 * Why a component whose windows are clear still has no value: no peers for the residual, else no
 * data. A reader explaining a null component uses its `windowBlock` first, then this.
 */
export function missingDataReason(component: ComponentKey, peerBasis: PeerBasis | null): NullReason {
    return component === "residual" && peerBasis === "none" ? { kind: "no-peers" } : { kind: "no-data" };
}
