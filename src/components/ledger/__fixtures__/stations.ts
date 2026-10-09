import type { StationListItem } from "@/types/station";

const WEEK = { start: "2026-07-25", end: "2026-07-31" } as const;

/** A list-route station with plausible defaults; tests override what they exercise. */
export function station(overrides: Partial<StationListItem> & Pick<StationListItem, "slug" | "displayName">): StationListItem {
  const ranked = overrides.rank !== null;
  return {
    id: `${overrides.slug ?? overrides.displayName}-id`,
    name: overrides.displayName,
    lines: ["Green"],
    status: "ACTIVE",
    closedAt: null,
    latitude: 41.88,
    longitude: -87.63,
    tier: ranked ? "quiet" : null,
    rank: 1,
    rankedCount: 6,
    score: ranked ? 60 : null,
    avg12m: 1000,
    avg30d: 1000,
    dataStatus: "available",
    sparkline: { ...WEEK, values: [900, 700, 1000, 1100, 1050, 1200, 980] },
    badge: null,
    ...overrides,
  };
}

/**
 * Six ranked stations and two outside the ranking, in the list route's order: rank 1 first, then
 * the unranked by name. Rank, riders, and name each order them differently, and two share the
 * name Halsted.
 */
export const LEDGER_STATIONS: readonly StationListItem[] = [
  station({ slug: "oak-park-green", displayName: "Oak Park", rank: 1, tier: "ghost", score: 100, avg12m: 703.08 }),
  station({ slug: "halsted-green", displayName: "Halsted", rank: 2, tier: "ghost", score: 97, avg12m: 248.4 }),
  station({ slug: "monroe-red", displayName: "Monroe", lines: ["Red"], rank: 3, tier: "fading", score: 84, avg12m: 3722.86 }),
  station({ slug: "halsted-orange", displayName: "Halsted", lines: ["Orange"], rank: 4, tier: "quiet", score: 60, avg12m: 1500 }),
  station({ slug: "ohare", displayName: "O'Hare", lines: ["Blue"], rank: 5, tier: "healthy", score: 20, avg12m: 9000 }),
  station({
    slug: "clark-lake",
    displayName: "Clark/Lake",
    lines: ["Blue", "Brown", "Green", "Orange", "Purple", "Pink"],
    rank: 6,
    tier: "healthy",
    score: 2,
    avg12m: 12034.5,
  }),
  station({
    slug: "cicero-pink",
    displayName: "Cicero",
    lines: ["Pink"],
    rank: null,
    tier: null,
    avg12m: null,
    avg30d: null,
    dataStatus: "missing",
    sparkline: null,
  }),
  station({
    slug: "state-lake",
    displayName: "State/Lake",
    lines: ["Brown", "Green", "Orange", "Purple", "Pink"],
    status: "CLOSED",
    closedAt: "2026-01-05",
    rank: null,
    tier: null,
    avg12m: 3194.89,
    avg30d: 0,
    dataStatus: "zero",
    sparkline: { ...WEEK, values: [0, 0, 0, 0, 0, 0, 0] },
  }),
];
