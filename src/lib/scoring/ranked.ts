import type { StationStatus } from "@prisma/client";

/**
 * The stored `StationMetrics.dataStatus` (the UI's `DataStatus` in src/types/station.ts is another
 * vocabulary): `missing` when a station has no rows in 60 days, `zero` when its 30-day average is
 * under one rider (KTD9).
 */
export type MetricsDataStatus = "normal" | "zero" | "missing";

/**
 * Whether a station takes part in rankings and peer comparisons (R5, KTD9): open, with riders in
 * its recent data. Closed State/Lake fails both: upstream reports it at 0 riders a day.
 */
export function isRanked(status: StationStatus, dataStatus: string): boolean {
    return status === "ACTIVE" && dataStatus === "normal";
}
