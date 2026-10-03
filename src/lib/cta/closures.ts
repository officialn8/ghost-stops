/**
 * Station closures: the source of truth for Station.status and Station.closedAt, which the seed
 * (and later the sync) derive from these rows so the three never disagree.
 *
 * A closure covers startDate up to, not including, endDate: endDate is the day service resumed,
 * and null means the station is still closed. Dates are the first and last days the ridership
 * data shows the station shut, not announcement dates.
 */
import type { StationStatus } from "@prisma/client";

export interface StationClosureDef {
    ctaStationId: string;
    startDate: string;
    endDate: string | null;
    reason: string;
}

const RPM_REBUILD = "Closed for the Red-Purple Modernization rebuild";

export const STATION_CLOSURES: readonly StationClosureDef[] = [
    // Argyle and Bryn Mawr stayed open through the rebuild; their ridership never stops.
    { ctaStationId: "40770", startDate: "2021-05-16", endDate: "2025-07-20", reason: RPM_REBUILD }, // Lawrence
    { ctaStationId: "40340", startDate: "2021-05-16", endDate: "2025-07-20", reason: RPM_REBUILD }, // Berwyn
    {
        ctaStationId: "40260", // State/Lake
        startDate: "2026-01-05",
        endDate: null,
        reason: "Closed for demolition and reconstruction of the station",
    },
];

export function closuresFor(ctaStationId: string): StationClosureDef[] {
    return STATION_CLOSURES.filter((c) => c.ctaStationId === ctaStationId);
}

export interface DerivedStatus {
    status: StationStatus;
    closedAt: string | null;
}

/** A station's status on `asOf` (YYYY-MM-DD) from its closures. */
export function deriveStatus(closures: readonly StationClosureDef[], asOf: string): DerivedStatus {
    const current = closures.find((c) => c.startDate <= asOf && (c.endDate === null || asOf < c.endDate));
    if (!current) return { status: "ACTIVE", closedAt: null };
    return { status: current.endDate === null ? "CLOSED" : "TEMP_CLOSED", closedAt: current.startDate };
}
