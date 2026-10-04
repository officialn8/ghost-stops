import { CTA_LINE_ORDER, type CTALine } from "@/lib/utils";
import type { StationListItem } from "@/types/station";
import type { ActiveLines } from "./ShellContext";

/** Every line on: the filter's starting state. */
export const ALL_LINES_ON: ActiveLines = Object.fromEntries(CTA_LINE_ORDER.map((line) => [line, true])) as Record<
  CTALine,
  boolean
>;

/** Whether no line is on, which the filter reads as every line on (R27). */
export function noLineActive(active: ActiveLines): boolean {
  return CTA_LINE_ORDER.every((line) => !active[line]);
}

/** Whether a station passes the line filter: it serves at least one line that is on. */
export function passesLineFilter(lines: readonly string[], active: ActiveLines): boolean {
  if (noLineActive(active)) return true;
  return lines.some((line) => active[line === "Purple Express" ? "Purple" : (line as CTALine)]);
}

/** Whether a station is outside the ranking: closed, or with no recent riders (R24). */
export function isExcluded(station: Pick<StationListItem, "rank">): boolean {
  return station.rank === null;
}
