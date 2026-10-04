"use client";

import { createContext, useContext } from "react";
import type { CTALine } from "@/lib/utils";
import type { StationListItem, StationListResponse } from "@/types/station";

/**
 * The shell's state (KTD12): one owner for the station list, the selection, and the ledger's
 * search, line filter, and sort, on every viewport. It lives in the route-group layout, so it
 * survives navigation between station pages; the selection itself is the URL.
 */

export type SortKey = "rank" | "riders" | "name";
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

/** Which lines the filter shows. All off reads as all on (R27). */
export type ActiveLines = Readonly<Record<CTALine, boolean>>;

/**
 * The list fetch. A fetch that fails, or is still running after a few seconds, turns into an
 * error row with a retry action rather than a skeleton that never ends (KTD12).
 */
export type ListState =
  | { status: "loading" }
  | { status: "error"; reason: "failed" | "slow" }
  | {
      status: "ready";
      data: StationListResponse;
      /** The last successful refresh is more than ten days old (R13): the banner shows. */
      stale: boolean;
    };

export interface ShellModel {
  list: ListState;
  retryList: () => void;
  /** Every station, in the list route's order (rank 1 first); empty until the list loads. */
  stations: readonly StationListItem[];
  stationBySlug: ReadonlyMap<string, StationListItem>;
  /** The slug in the URL (/station/[slug]), or null on the map. Set for an unknown slug too. */
  selectedSlug: string | null;
  /** The selected station's list entry, once the list has loaded. */
  selected: StationListItem | null;
  /** Pushes the station's page, so browser back returns to wherever the reader was. */
  openStation: (slug: string) => void;
  /** Always pushes `/` (R22): closing lands on the map after any number of station hops. */
  closeStation: () => void;
  query: string;
  setQuery: (query: string) => void;
  activeLines: ActiveLines;
  toggleLine: (line: CTALine) => void;
  sort: SortState;
  /** Sorts by `key`; choosing the active key again reverses the direction (R27). */
  sortBy: (key: SortKey) => void;
}

export const ShellContext = createContext<ShellModel | null>(null);

export function useShell(): ShellModel {
  const model = useContext(ShellContext);
  if (!model) {
    throw new Error("useShell must be used inside the shell layout");
  }
  return model;
}
