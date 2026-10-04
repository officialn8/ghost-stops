import { formatMonthYear } from "@/lib/format";
import { isClosedStatus } from "@/lib/utils";
import type { NeighborEntry, ScoreTierName, StationDetailResponse } from "@/types/station";

/**
 * Where a station stands, the one decision every dossier section reads: ranked with a tier and a
 * rank, closed, or open but with no riders in recent data (both outside the ranking, R24), or
 * ranked by the older score that has no tier yet.
 */
export type Standing =
  | { kind: "ranked"; tier: ScoreTierName; rank: number; rankedCount: number }
  | { kind: "closed"; since: string | null; temporary: boolean }
  | { kind: "no-data"; lastDay: string | null }
  | { kind: "unscored" };

/** The last day in the station's series with any riders, or null when its 91 days have none. */
function lastDayWithRiders(detail: StationDetailResponse): string | null {
  const days = detail.series?.days ?? [];
  for (let i = days.length - 1; i >= 0; i--) {
    if ((days[i].entries ?? 0) > 0) return days[i].date;
  }
  return null;
}

export function standingOf(detail: StationDetailResponse): Standing {
  const { station, metrics } = detail;
  if (isClosedStatus(station.status)) {
    return { kind: "closed", since: station.closedAt, temporary: station.status === "TEMP_CLOSED" };
  }
  if (!metrics.ranked) return { kind: "no-data", lastDay: lastDayWithRiders(detail) };
  const { tier, rank, rankedCount } = metrics;
  if (tier === null || rank === null || rankedCount === null) return { kind: "unscored" };
  return { kind: "ranked", tier, rank, rankedCount };
}

/**
 * The why section's heading, in the station's own tier: only a ghost-tier station is called a
 * ghost stop, and a healthy one is called healthy (R19, Reddit B4).
 */
const TIER_HEADING: Readonly<Record<ScoreTierName, string>> = {
  ghost: "Why it\u2019s a ghost stop",
  fading: "Why it\u2019s fading",
  quiet: "Why it\u2019s quiet",
  healthy: "Why it\u2019s healthy",
};

export function whyHeading(standing: Standing): string {
  if (standing.kind === "ranked") return TIER_HEADING[standing.tier];
  if (standing.kind === "closed" || standing.kind === "no-data") return "Why it is not ranked";
  return "Why it ranks here";
}

/** "closed since Jan 2026", "temporarily closed", or "closed", to run inside a sentence. */
export function closedPhrase(since: string | null, temporary = false): string {
  const word = temporary ? "temporarily closed" : "closed";
  return since ? `${word} since ${formatMonthYear(since)}` : word;
}

/** "Closed since Jan 2026", "Temporarily closed", or "Closed", to stand alone. */
export function closedLabel(since: string | null, temporary = false): string {
  const phrase = closedPhrase(since, temporary);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * The tags under the station name. A transfer serves more than one line. A terminal is where its
 * primary line ends: the payload has no terminal flag, so it is read from the line walk, which has
 * a neighbor on exactly one side at a line's end (both sides are empty only for a station the
 * sequences do not know, which is not tagged).
 */
export function stationTags(detail: StationDetailResponse): string[] {
  const tags: string[] = [];
  if (detail.station.lines.length > 1) tags.push("Transfer");
  const { primaryLine, lineNeighbors } = detail.comparisons;
  if (primaryLine && (lineNeighbors.prev === null) !== (lineNeighbors.next === null)) tags.push("Terminal");
  return tags;
}

export type NeighborStanding =
  | { kind: "ranked"; tier: ScoreTierName }
  | { kind: "closed"; since: string | null; temporary: boolean }
  | { kind: "no-data" };

/** A neighbor's standing for its along-the-line row: a closed one says since when (AE2). */
export function neighborStanding(neighbor: NeighborEntry): NeighborStanding {
  if (isClosedStatus(neighbor.status)) {
    return { kind: "closed", since: neighbor.closedAt, temporary: neighbor.status === "TEMP_CLOSED" };
  }
  return neighbor.tier === null ? { kind: "no-data" } : { kind: "ranked", tier: neighbor.tier };
}
