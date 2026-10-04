import type { DuplicateDay, RidershipSource, StationMonthTotal, UpstreamDay } from "../socrata";
import { addDays, type DateWindow } from "../window";

export const UPDATED_AT = "2026-09-28T18:04:45.135Z";
/** The portal's `rowsUpdatedAt` for that batch, which is whole seconds. */
export const ROWS_UPDATED_AT = "2026-09-28T18:04:46.000Z";

/** One upstream row per station per day from `start` to `end`, with rides from `rides`. */
export function upstreamDays(
    ctaStationIds: readonly string[],
    window: DateWindow,
    rides: (ctaStationId: string, date: string) => number = () => 1_000,
): UpstreamDay[] {
    const days: UpstreamDay[] = [];
    for (let date = window.start; date <= window.end; date = addDays(date, 1)) {
        for (const ctaStationId of ctaStationIds) {
            const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
            const dayType = weekday === 0 ? "U" : weekday === 6 ? "A" : "W";
            days.push({ ctaStationId, serviceDate: date, dayType, rides: rides(ctaStationId, date), updatedAt: UPDATED_AT });
        }
    }
    return days;
}

export interface FakeSourceCall {
    method: keyof RidershipSource;
    window?: DateWindow;
    ctaStationIds?: readonly string[];
}

/**
 * An in-memory Socrata: answers from `days` as the real dataset would, and records each call.
 * `fail` makes a fetch throw, to test what a run leaves behind when upstream breaks mid-run.
 */
export function fakeSource(days: UpstreamDay[], fail?: (call: FakeSourceCall) => boolean) {
    const calls: FakeSourceCall[] = [];
    const record = (call: FakeSourceCall) => {
        calls.push(call);
        if (fail?.(call)) throw new Error(`Socrata request failed with HTTP 503 (fake ${call.method})`);
    };

    const source: RidershipSource = {
        async maxDate() {
            record({ method: "maxDate" });
            return days.reduce((max, d) => (d.serviceDate > max ? d.serviceDate : max), "0000-00-00");
        },
        async fetchDays(window, ctaStationIds) {
            record({ method: "fetchDays", window, ctaStationIds });
            return days.filter(
                (d) =>
                    d.serviceDate >= window.start &&
                    d.serviceDate <= window.end &&
                    (!ctaStationIds?.length || ctaStationIds.includes(d.ctaStationId)),
            );
        },
        async stationMonthTotals() {
            record({ method: "stationMonthTotals" });
            const totals = new Map<string, StationMonthTotal>();
            for (const d of days) {
                const month = d.serviceDate.slice(0, 7);
                const key = `${d.ctaStationId}|${month}`;
                const total = totals.get(key) ?? { ctaStationId: d.ctaStationId, month, days: 0, rides: 0 };
                total.days += 1;
                total.rides += d.rides;
                totals.set(key, total);
            }
            return [...totals.values()];
        },
        async duplicateDays() {
            record({ method: "duplicateDays" });
            const groups = Map.groupBy(days, (d) => `${d.ctaStationId}|${d.serviceDate}`);
            const duplicates: DuplicateDay[] = [];
            for (const rows of groups.values()) {
                if (rows.length < 2) continue;
                duplicates.push({
                    ctaStationId: rows[0].ctaStationId,
                    serviceDate: rows[0].serviceDate,
                    rows: rows.length,
                    totalRides: rows.reduce((sum, r) => sum + r.rides, 0),
                    maxRides: Math.max(...rows.map((r) => r.rides)),
                    sameUpdate: rows.every((r) => r.updatedAt === rows[0].updatedAt),
                });
            }
            return duplicates;
        },
        async rowsUpdatedAt() {
            record({ method: "rowsUpdatedAt" });
            return ROWS_UPDATED_AT;
        },
    };
    return { source, calls };
}
