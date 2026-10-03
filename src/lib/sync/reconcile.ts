/**
 * Drift detection (R7, AE7). The weekly run compares every station-month's row count and ride sum
 * upstream with what is stored and records the months that differ. Each daily run then re-fetches
 * at most three of those months, oldest first, as month-bounded requests, and carries the rest in
 * its run record, so an upstream restatement of years of data never lands in one 300-second run.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { dedupeDays } from "./match";
import type { DuplicateDay, RidershipSource, StationMonthTotal } from "./socrata";
import { ISO_MONTH, monthOf, monthRange, type DateWindow } from "./window";

const MAX_DRIFT_FETCHES = 3;

/** Keys a station-day or a station-month. */
const stationKey = (ctaStationId: string, dateOrMonth: string) => `${ctaStationId}|${dateOrMonth}`;

/** Reads a run record's `driftMonths` JSON, tolerating nothing but YYYY-MM strings. */
export function parseDriftMonths(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((m) => typeof m === "string" && ISO_MONTH.test(m))) {
        throw new Error("SyncRun.driftMonths is not a list of YYYY-MM months");
    }
    return value as string[];
}

async function storedStationMonthTotals(
    db: Pick<PrismaClient, "$queryRaw">,
    cityId: string,
): Promise<StationMonthTotal[]> {
    const rows = await db.$queryRaw<{ ctaStationId: string; month: string; days: number; rides: bigint }[]>`
        SELECT s."ctaStationId", to_char(r."serviceDate", 'YYYY-MM') AS month,
               count(*)::int AS days, sum(r."entries")::bigint AS rides
        FROM "RidershipDaily" r
        JOIN "Station" s ON s.id = r."stationId"
        WHERE s."cityId" = ${cityId} AND s."ctaStationId" IS NOT NULL
        GROUP BY 1, 2`;
    return rows.map((r) => ({ ctaStationId: r.ctaStationId, month: r.month, days: r.days, rides: Number(r.rides) }));
}

/**
 * The count each duplicate station-day keeps once deduplicated, keyed by `stationKey`. When a day's
 * rows share an update time the higher count wins without a request; otherwise its month is
 * fetched once and put through the same `dedupeDays` rule the sync applies.
 */
export async function keptDuplicateRides(
    source: RidershipSource,
    duplicates: readonly DuplicateDay[],
): Promise<Map<string, number>> {
    const kept = new Map(duplicates.map((dup) => [stationKey(dup.ctaStationId, dup.serviceDate), dup.maxRides]));
    const untiedMonths = new Set(duplicates.filter((dup) => !dup.sameUpdate).map((dup) => monthOf(dup.serviceDate)));
    for (const month of [...untiedMonths].sort()) {
        for (const winner of dedupeDays(await source.fetchDays(monthRange(month)))) {
            const key = stationKey(winner.ctaStationId, winner.serviceDate);
            if (kept.has(key)) kept.set(key, winner.rides);
        }
    }
    return kept;
}

/**
 * Months, sorted, in which any known station's stored count or sum differs from upstream's.
 * Upstream totals count every duplicate row and the stored side holds one per day, so each
 * duplicate day's extra rows come off upstream's side first. Stations the city does not know
 * (retired ids) are ignored. A stored station-month that upstream lacks also counts as drift,
 * although a re-fetch cannot remove it: the sync never deletes rows.
 */
export function findDriftMonths(
    upstream: readonly StationMonthTotal[],
    stored: readonly StationMonthTotal[],
    duplicates: readonly DuplicateDay[],
    keptRides: ReadonlyMap<string, number>,
    knownCtaStationIds: ReadonlySet<string>,
): string[] {
    const expected = new Map<string, StationMonthTotal>();
    for (const u of upstream) {
        if (knownCtaStationIds.has(u.ctaStationId)) expected.set(stationKey(u.ctaStationId, u.month), { ...u });
    }
    for (const dup of duplicates) {
        const total = expected.get(stationKey(dup.ctaStationId, monthOf(dup.serviceDate)));
        if (total === undefined) continue;
        total.days -= dup.rows - 1;
        total.rides -= dup.totalRides - (keptRides.get(stationKey(dup.ctaStationId, dup.serviceDate)) ?? dup.maxRides);
    }

    const drift = new Set<string>();
    const storedKeys = new Set<string>();
    for (const s of stored) {
        const key = stationKey(s.ctaStationId, s.month);
        storedKeys.add(key);
        const want = expected.get(key);
        if (want === undefined || want.days !== s.days || want.rides !== s.rides) drift.add(s.month);
    }
    for (const [key, want] of expected) {
        if (!storedKeys.has(key)) drift.add(want.month);
    }
    return [...drift].sort();
}

/** The weekly pass: every month in which upstream and the stored data disagree. */
export async function reconcileMonths(
    db: Pick<PrismaClient, "$queryRaw">,
    source: RidershipSource,
    cityId: string,
    knownCtaStationIds: ReadonlySet<string>,
): Promise<string[]> {
    const [upstream, duplicates, stored] = await Promise.all([
        source.stationMonthTotals(),
        source.duplicateDays(),
        storedStationMonthTotals(db, cityId),
    ]);
    const keptRides = await keptDuplicateRides(source, duplicates);
    return findDriftMonths(upstream, stored, duplicates, keptRides, knownCtaStationIds);
}

/**
 * Splits the backlog into the months this run re-fetches, oldest first, and the months it carries.
 * Months the trailing window has just fetched in full are dropped.
 */
export function planDriftFetches(backlog: readonly string[], window: DateWindow): { fetch: string[]; carry: string[] } {
    const pending = [...new Set(backlog)].sort().filter((month) => {
        const range = monthRange(month);
        return !(range.start >= window.start && range.end <= window.end);
    });
    return { fetch: pending.slice(0, MAX_DRIFT_FETCHES), carry: pending.slice(MAX_DRIFT_FETCHES) };
}
