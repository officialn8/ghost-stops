/**
 * The words a station page puts in its <title> and link preview (R30), from the detail payload.
 * Pure, so the page and its tests share them.
 */
import { formatMonthYear, formatRiders } from "@/lib/format";
import { isClosedStatus } from "@/lib/utils";
import type { StationDetailResponse } from "@/types/station";

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "Halsted (Green)", or a hub's full line list: "Clark/Lake (Blue, Brown, Green, Orange, Pink, Purple)". */
export function stationLabel(detail: Pick<StationDetailResponse, "station">): string {
  const { displayName, lines } = detail.station;
  return lines.length > 0 ? `${displayName} (${lines.join(", ")})` : displayName;
}

function isClosed(detail: Pick<StationDetailResponse, "station">): boolean {
  return isClosedStatus(detail.station.status);
}

function closedSince(detail: Pick<StationDetailResponse, "station">): string | null {
  const { closedAt } = detail.station;
  return closedAt ? formatMonthYear(closedAt) : null;
}

/** "Halsted (Green) · 248 riders/day"; the layout's title template adds "· Ghost Stops". */
export function stationTitle(detail: Pick<StationDetailResponse, "station" | "metrics">): string {
  const label = stationLabel(detail);
  if (isClosed(detail)) {
    const since = closedSince(detail);
    return since ? `${label} · closed ${since}` : `${label} · closed`;
  }
  const { avg12m } = detail.metrics;
  if (!detail.metrics.ranked || avg12m === null) return `${label} · no recent data`;
  return `${label} · ${formatRiders(avg12m)} riders/day`;
}

/** One plain sentence for link previews: rank, tier, riders, and the data-through date. */
export function stationDescription(detail: Pick<StationDetailResponse, "station" | "metrics" | "dataThrough">): string {
  const name = detail.station.displayName;
  const through = detail.dataThrough ? ` Data through ${detail.dataThrough}.` : "";
  if (isClosed(detail)) {
    const since = closedSince(detail);
    return `${name} has been closed${since ? ` since ${since}` : ""}, so it is not ranked against other L stations.${through}`;
  }
  const { rank, rankedCount, tier, avg12m } = detail.metrics;
  if (!detail.metrics.ranked || rank === null || rankedCount === null || avg12m === null) {
    return `${name} has no recent ridership data, so it is not ranked against other L stations.${through}`;
  }
  const riders = formatRiders(avg12m);
  const tierNote = tier ? ` (tier: ${tier})` : "";
  return `${name} ranks ${ordinal(rank)} of ${rankedCount} L stations by ghost score${tierNote}, with ${riders} riders a day over the past 12 months.${through}`;
}
