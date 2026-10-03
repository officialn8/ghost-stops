/**
 * Turns upstream rows into rows for RidershipDaily: one row per station-day, attributed by CTA
 * station id only. Names never take part (R9), so a renamed station keeps matching and a retired
 * id is reported rather than guessed at.
 */
import type { DayType, UpstreamDay } from "./socrata";

export interface RidershipRow {
    stationId: string;
    serviceDate: string;
    entries: number;
    dayType: DayType;
}

function prefer(candidate: UpstreamDay, current: UpstreamDay): boolean {
    if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
    return candidate.rides > current.rides;
}

/**
 * Collapses duplicate upstream rows (see `DuplicateDay`) to one per station-day, so an upsert never
 * touches a row twice. The most recently updated row wins, the rule Nate approved. Every duplicate
 * upstream holds today shares one `:updated_at`, so the higher count breaks the tie. Output keeps
 * first-seen order.
 */
export function dedupeDays(rows: readonly UpstreamDay[]): UpstreamDay[] {
    const kept = new Map<string, UpstreamDay>();
    for (const row of rows) {
        const key = `${row.ctaStationId}|${row.serviceDate}`;
        const current = kept.get(key);
        if (current === undefined || prefer(row, current)) kept.set(key, row);
    }
    return [...kept.values()];
}

export interface MatchResult {
    rows: RidershipRow[];
    /** CTA station ids upstream has and the city does not, sorted. */
    unmatched: string[];
}

export function matchStations(rows: readonly UpstreamDay[], stationIdByCtaId: ReadonlyMap<string, string>): MatchResult {
    const matched: RidershipRow[] = [];
    const unmatched = new Set<string>();
    for (const row of rows) {
        const stationId = stationIdByCtaId.get(row.ctaStationId);
        if (stationId === undefined) {
            unmatched.add(row.ctaStationId);
            continue;
        }
        matched.push({ stationId, serviceDate: row.serviceDate, entries: row.rides, dayType: row.dayType });
    }
    return { rows: matched, unmatched: [...unmatched].sort() };
}
