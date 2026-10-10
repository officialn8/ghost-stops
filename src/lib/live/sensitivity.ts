/**
 * The tolerance sensitivity table (U7, KTD4): the same recorded days scored under several
 * tolerances, so the plateau value can be frozen as GHOST_TOLERANCE_MINUTES with its date. Beside
 * ghosts per 100 system-wide and per line it reports what the probe days must confirm: the share
 * of slots fulfilled by their run number after the tolerance (runs survive the schedule-only-to-
 * live flip), the share of scheduled stops fulfilled from the passage log alone (trains live from
 * their first appearance), how long schedule-only entries stay posted, and how far ahead they
 * appear.
 */
import { verdictsFor } from "./matcher";
import { median, type DaySchedule } from "./schedule";
import type { TrackerState } from "./tracker";
import { TRAIN_ROUTES, type TrainRoute } from "./trainTracker";

export const SENSITIVITY_TOLERANCES = [2, 3, 5, 8] as const;

export interface SensitivityDay {
    serviceDate: string;
    tracker: TrackerState;
    schedule: DaySchedule;
}

export interface SensitivityRow {
    tolerance: number;
    scheduled: number;
    ghosts: number;
    /** Ghosts per 100 scheduled stops, to a tenth. */
    ghostsPer100: number;
    perRoute: Record<TrainRoute, number | null>;
    slots: number;
    unmappedSlots: number;
    /** Of all slots: fulfilled by the same run showing live after the scheduled time plus the tolerance. */
    fulfilledLateByRun: number;
    /** Of fulfilled scheduled stops: fulfilled from the passage log with no slot before them. */
    fulfilledFromPassages: number;
    unknown: number;
    cancelled: number;
}

export interface SensitivityTable {
    days: string[];
    rows: SensitivityRow[];
    /** Minutes a schedule-only entry stays posted (median), and minutes ahead of its time it first appears (median). */
    postedMinutes: number | null;
    horizonMinutes: number | null;
}

const per100 = (part: number, whole: number): number | null => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

export function sensitivityTable(days: readonly SensitivityDay[], tolerances: readonly number[] = SENSITIVITY_TOLERANCES): SensitivityTable {
    const rows: SensitivityRow[] = [];
    for (const tolerance of tolerances) {
        let scheduled = 0;
        let ghosts = 0;
        let slots = 0;
        let unmappedSlots = 0;
        let lateByRun = 0;
        let fulfilledStops = 0;
        let fromPassages = 0;
        let unknown = 0;
        let cancelled = 0;
        const routeScheduled = Object.fromEntries(TRAIN_ROUTES.map((r) => [r, 0])) as Record<TrainRoute, number>;
        const routeGhosts = Object.fromEntries(TRAIN_ROUTES.map((r) => [r, 0])) as Record<TrainRoute, number>;
        for (const day of days) {
            const verdicts = verdictsFor(day.tracker, day.schedule, tolerance);
            for (const sv of verdicts.stops) {
                scheduled += 1;
                routeScheduled[sv.stop.route] += 1;
                if (sv.verdict === "ghost") {
                    ghosts += 1;
                    routeGhosts[sv.stop.route] += 1;
                } else if (sv.verdict === "fulfilled") {
                    fulfilledStops += 1;
                    if (sv.slot === null) fromPassages += 1;
                } else if (sv.verdict === "unknown") unknown += 1;
                else if (sv.verdict === "cancelled") cancelled += 1;
            }
            for (const sv of verdicts.slots) {
                slots += 1;
                if (sv.stop === null) unmappedSlots += 1;
                if (sv.by === "same-run" && sv.late) lateByRun += 1;
            }
        }
        rows.push({
            tolerance,
            scheduled,
            ghosts,
            ghostsPer100: per100(ghosts, scheduled) ?? 0,
            perRoute: Object.fromEntries(TRAIN_ROUTES.map((r) => [r, per100(routeGhosts[r], routeScheduled[r])])) as Record<TrainRoute, number | null>,
            slots,
            unmappedSlots,
            fulfilledLateByRun: per100(lateByRun, slots) ?? 0,
            fulfilledFromPassages: per100(fromPassages, fulfilledStops) ?? 0,
            unknown,
            cancelled,
        });
    }
    const allSlots = days.flatMap((d) => Object.values(d.tracker.slots));
    const minutes = (ms: number) => Math.round(ms / 6_000) / 10;
    const posted = median(allSlots.map((s) => s.lastSeen - s.firstSeen));
    const horizon = median(allSlots.map((s) => s.scheduledAt - s.firstSeen));
    return { days: days.map((d) => d.serviceDate), rows, postedMinutes: posted === null ? null : minutes(posted), horizonMinutes: horizon === null ? null : minutes(horizon) };
}

/** The table as text, for the method page's limits section. */
export function formatSensitivityTable(table: SensitivityTable): string {
    const lines = [`days: ${table.days.join(", ")}`];
    lines.push(`schedule-only entries stay posted ${table.postedMinutes ?? "?"} min (median) and appear ${table.horizonMinutes ?? "?"} min ahead (median)`);
    lines.push("tol  scheduled  ghosts  per100  " + TRAIN_ROUTES.map((r) => r.padStart(5)).join(" ") + "  slots  unmapped  late-by-run%  from-passages%  unknown  cancelled");
    for (const row of table.rows) {
        lines.push(
            `${String(row.tolerance).padStart(3)}  ${String(row.scheduled).padStart(9)}  ${String(row.ghosts).padStart(6)}  ${String(row.ghostsPer100).padStart(6)}  ` +
                TRAIN_ROUTES.map((r) => String(row.perRoute[r] ?? "-").padStart(5)).join(" ") +
                `  ${String(row.slots).padStart(5)}  ${String(row.unmappedSlots).padStart(8)}  ${String(row.fulfilledLateByRun).padStart(12)}  ${String(row.fulfilledFromPassages).padStart(14)}  ${String(row.unknown).padStart(7)}  ${String(row.cancelled).padStart(9)}`,
        );
    }
    return lines.join("\n");
}
