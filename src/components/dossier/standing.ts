import { formatCalendarDate } from "@/lib/format";
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
  if (station.status !== "ACTIVE") {
    return { kind: "closed", since: station.closedAt, temporary: station.status === "TEMP_CLOSED" };
  }
  if (!metrics.ranked) return { kind: "no-data", lastDay: lastDayWithRiders(detail) };
  const { tier, rank, rankedCount } = metrics;
  if (tier === null || rank === null || rankedCount === null) return { kind: "unscored" };
  return { kind: "ranked", tier, rank, rankedCount };
}

/** "Jan 2026", read in UTC so a calendar date never shifts a month (KTD17). */
export function monthYear(date: string): string {
  return formatCalendarDate(date, { month: "short", year: "numeric" });
}

/** "closed since Jan 2026", "temporarily closed", or "closed", to run inside a sentence. */
export function closedPhrase(since: string | null, temporary = false): string {
  const word = temporary ? "temporarily closed" : "closed";
  return since ? `${word} since ${monthYear(since)}` : word;
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

/** "Green Line", or "Brown, Green, Orange, Purple, Pink Lines". */
export function linesLabel(lines: readonly string[]): string {
  return `${lines.join(", ")} ${lines.length === 1 ? "Line" : "Lines"}`;
}

/** A whole number with thousands separators: 1,782. */
export function riders(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export type NeighborStanding =
  | { kind: "ranked"; tier: ScoreTierName }
  | { kind: "closed"; since: string | null; temporary: boolean }
  | { kind: "no-data" };

/**
 * A neighbor's standing for its along-the-line row. A closed neighbor reads "Closed", with its
 * month once the payload carries `closedAt` (NeighborEntry has no such field yet).
 */
export function neighborStanding(neighbor: NeighborEntry): NeighborStanding {
  if (neighbor.status !== "ACTIVE") {
    const since = "closedAt" in neighbor && typeof neighbor.closedAt === "string" ? neighbor.closedAt : null;
    return { kind: "closed", since, temporary: neighbor.status === "TEMP_CLOSED" };
  }
  return neighbor.tier === null ? { kind: "no-data" } : { kind: "ranked", tier: neighbor.tier };
}
