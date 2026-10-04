"use client";

import { useMemo } from "react";
import type { Exclusion } from "@/components/marks/PresenceMark";
import { isExcluded, noLineActive, passesLineFilter } from "@/components/shell/model";
import type { ActiveLines, SortState } from "@/components/shell/ShellContext";
import { CTA_LINE_ORDER, isClosedStatus } from "@/lib/utils";
import type { StationListItem } from "@/types/station";

/** A station the ledger can open: it has a page, so it has a slug. */
export type LedgerStation = StationListItem & { slug: string };

export interface LedgerRowModel {
  station: LedgerStation;
  /** Why the station is outside the ranking, or null for a ranked station. */
  exclusion: Exclusion | null;
  /** Shown only because it is selected: the search or the line filter would hide it. */
  outsideFilter: boolean;
}

/** A trailing section of stations outside the ranking (R24), always after the ranked rows. */
export interface LedgerSection {
  kind: Exclusion;
  title: string;
  rows: LedgerRowModel[];
}

export interface LedgerModel {
  /** Ranked stations that match, in the chosen sort, plus the selected one if it would be hidden. */
  ranked: LedgerRowModel[];
  /** "Closed", then "No recent data"; only the ones with rows. Ordered by name whatever the sort. */
  sections: LedgerSection[];
  /** Stations the search and the line filter let through; the pinned selection is not counted. */
  matchCount: number;
  /** Every station with a page. */
  total: number;
  /** Whether a search or a line filter is in effect. */
  narrowed: boolean;
  /** The first matching row in display order: what Enter in the search field opens. */
  firstMatchSlug: string | null;
  /** The live region's sentence (R28). */
  announcement: string;
}

export interface LedgerInput {
  stations: readonly StationListItem[];
  query: string;
  activeLines: ActiveLines;
  sort: SortState;
  selectedSlug: string | null;
}

const SECTION_TITLE: Readonly<Record<Exclusion, string>> = {
  closed: "Closed",
  "no-data": "No recent data",
};

/** Why a station sits outside the ranking: closed (for now or for good), or no recent riders. */
export function exclusionOf(station: Pick<StationListItem, "rank" | "status">): Exclusion | null {
  if (!isExcluded(station)) return null;
  return isClosedStatus(station.status) ? "closed" : "no-data";
}

/**
 * A name or a query reduced to its letters and digits, lowercased and without accents, so
 * "ohare" finds O'Hare and "state lake" finds State/Lake.
 */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Whether a display name contains an already-normalized needle; an empty needle matches all. */
export function matchesQuery(displayName: string, needle: string): boolean {
  return needle === "" || normalizeSearch(displayName).includes(needle);
}

const collator = new Intl.Collator("en-US", { sensitivity: "base", numeric: true });

const byName = (a: StationListItem, b: StationListItem) => collator.compare(a.displayName, b.displayName);

/** Rank order, the tie-breaker for every key; an unranked station would go last. */
const byRank = (a: StationListItem, b: StationListItem) =>
  (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY);

/**
 * The ranked rows' order. Ascending is rank 1 (the most ghost-like) first, the fewest riders
 * first, or A to Z. A station with no riders figure sorts last in either riders direction, and a
 * tie (two stations named Halsted) falls back to rank in either direction.
 */
export function compareStations(a: StationListItem, b: StationListItem, sort: SortState): number {
  const sign = sort.direction === "asc" ? 1 : -1;
  switch (sort.key) {
    case "rank":
      return sign * byRank(a, b);
    case "riders": {
      if (a.avg12m === null || b.avg12m === null) {
        if (a.avg12m !== b.avg12m) return a.avg12m === null ? 1 : -1;
        return byRank(a, b);
      }
      return sign * (a.avg12m - b.avg12m) || byRank(a, b);
    }
    case "name":
      return sign * byName(a, b) || byRank(a, b);
  }
}

function announce(narrowed: boolean, matchCount: number, total: number): string {
  if (!narrowed) return `${total} ${total === 1 ? "station" : "stations"}`;
  if (matchCount === 0) return "No stations match";
  return matchCount === 1 ? "1 station matches" : `${matchCount} stations match`;
}

/**
 * Everything the ledger shows, from the shell's list and its search, filter, sort, and selection
 * (R24, R27). Pure, so the rules are tested without rendering:
 *
 * - Ranked stations that pass the search and the line filter, in the chosen sort.
 * - Stations outside the ranking in trailing "Closed" and "No recent data" sections, by name,
 *   whatever the sort.
 * - The selected station always, in its sorted place, flagged when it would otherwise be hidden.
 */
export function deriveLedger({ stations, query, activeLines, sort, selectedSlug }: LedgerInput): LedgerModel {
  const needle = normalizeSearch(query);
  const linesNarrowed = !noLineActive(activeLines) && CTA_LINE_ORDER.some((line) => !activeLines[line]);
  const narrowed = needle !== "" || linesNarrowed;

  const ranked: LedgerRowModel[] = [];
  const excluded: Record<Exclusion, LedgerRowModel[]> = { closed: [], "no-data": [] };
  let total = 0;
  let matchCount = 0;

  for (const station of stations) {
    if (!station.slug) continue;
    total += 1;
    const matches =
      matchesQuery(station.displayName, needle) && (!linesNarrowed || passesLineFilter(station.lines, activeLines));
    if (matches) matchCount += 1;
    if (!matches && station.slug !== selectedSlug) continue;

    const exclusion = exclusionOf(station);
    const row: LedgerRowModel = { station: station as LedgerStation, exclusion, outsideFilter: !matches };
    (exclusion ? excluded[exclusion] : ranked).push(row);
  }

  ranked.sort((a, b) => compareStations(a.station, b.station, sort));
  const sections = (["closed", "no-data"] as const)
    .filter((kind) => excluded[kind].length > 0)
    .map((kind) => ({
      kind,
      title: SECTION_TITLE[kind],
      rows: excluded[kind].sort((a, b) => byName(a.station, b.station) || a.station.slug.localeCompare(b.station.slug)),
    }));

  const firstMatch = [...ranked, ...sections.flatMap((section) => section.rows)].find((row) => !row.outsideFilter);

  return {
    ranked,
    sections,
    matchCount,
    total,
    narrowed,
    firstMatchSlug: firstMatch?.station.slug ?? null,
    announcement: announce(narrowed, matchCount, total),
  };
}

/** The ledger's rows for the shell's current state, recomputed only when an input changes. */
export function useLedgerModel(input: LedgerInput): LedgerModel {
  const { stations, query, activeLines, sort, selectedSlug } = input;
  return useMemo(
    () => deriveLedger({ stations, query, activeLines, sort, selectedSlug }),
    [stations, query, activeLines, sort, selectedSlug],
  );
}
