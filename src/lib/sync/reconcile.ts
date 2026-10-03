/**
 * Drift detection (R7, AE7). The weekly run compares every station-month's row count and ride sum
 * upstream with what is stored and records the months that differ. Each daily run then re-fetches
 * at most three of those months, oldest first, as month-bounded requests, and carries the rest in
 * its run record, so an upstream restatement of years of data never lands in one 300-second run.
 */
import type { PrismaClient } from "@prisma/client";
import { dedupeDays } from "./match";
import type { DuplicateDay, RidershipSource, StationMonthTotal } from "./socrata";
import { monthOf, monthRange, type DateWindow } from "./window";

export const MAX_DRIFT_FETCHES = 3;

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Reads a run record's `driftMonths` JSON, tolerating nothing but YYYY-MM strings. */
export function parseDriftMonths(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((m) => typeof m === "string" && ISO_MONTH.test(m))) {
        throw new Error("SyncRun.driftMonths is not a list of YYYY-MM months");
    }
    return value as string[];
}

export async function storedStationMonthTotals(
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
 * The count each duplicate station-day keeps once deduplicated, keyed `ctaStationId|date`. When a
 * day's rows share an update time the higher count wins without a request; otherwise the rows are
 * fetched and put through the same `dedupeDays` rule the sync applies.
 */
export async function keptDuplicateRides(
    source: RidershipSource,
    duplicates: readonly DuplicateDay[],
): Promise<Map<string, number>> {
    const kept = new Map<string, number>();
    for (const dup of duplicates) {
        let rides = dup.maxRides;
        if (!dup.sameUpdate) {
            const day = { start: dup.serviceDate, end: dup.serviceDate };
            const [winner] = dedupeDays(await source.fetchDays(day, [dup.ctaStationId]));
            rides = winner?.rides ?? dup.maxRides;
        }
        kept.set(`${dup.ctaStationId}|${dup.serviceDate}`, rides);
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
    const key = (ctaStationId: string, month: string) => `${ctaStationId}|${month}`;
    const expected = new Map<string, { days: number; rides: number }>();
    for (const u of upstream) {
        if (knownCtaStationIds.has(u.ctaStationId)) expected.set(key(u.ctaStationId, u.month), { days: u.days, rides: u.rides });
    }
    for (const dup of duplicates) {
        const total = expected.get(key(dup.ctaStationId, monthOf(dup.serviceDate)));
        if (total === undefined) continue;
        total.days -= dup.rows - 1;
        total.rides -= dup.totalRides - (keptRides.get(`${dup.ctaStationId}|${dup.serviceDate}`) ?? dup.maxRides);
    }

    const drift = new Set<string>();
    const storedKeys = new Set<string>();
    for (const s of stored) {
        const k = key(s.ctaStationId, s.month);
        storedKeys.add(k);
        const want = expected.get(k);
        if (want === undefined || want.days !== s.days || want.rides !== s.rides) drift.add(s.month);
    }
    for (const k of expected.keys()) {
        if (!storedKeys.has(k)) drift.add(k.slice(k.indexOf("|") + 1));
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
export function planDriftFetches(
    backlog: readonly string[],
    window: DateWindow,
    max = MAX_DRIFT_FETCHES,
): { fetch: string[]; carry: string[] } {
    const pending = [...new Set(backlog)].sort().filter((month) => {
        const range = monthRange(month);
        return !(range.start >= window.start && range.end <= window.end);
    });
    return { fetch: pending.slice(0, max), carry: pending.slice(max) };
}
