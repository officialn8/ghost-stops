"use client";

import { memo } from "react";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineBars } from "@/components/marks/LineBars";
import { PresenceMark, TIER_LABEL, type Exclusion } from "@/components/marks/PresenceMark";
import { formatMonthYear, formatRiders, linesLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LedgerStation } from "./useLedgerModel";

/**
 * The name's ink by presence (R23). The mark carries the exact tier ink (0.72, 0.44); text uses the
 * nearest text tokens, which are calibrated to stay at WCAG AA (src/test/contrast.test.ts), since a
 * 44% name would fall to about 4:1. Ghost and excluded names take ink-3, fading ink-2.
 */
const NAME_INK = { ghost: "text-ink-3", fading: "text-ink-2", quiet: "text-ink", healthy: "text-ink" } as const;

/** What an excluded row shows in place of riders: "closed Jan 2026", or "no recent data". */
export function exclusionText(station: Pick<LedgerStation, "closedAt">, exclusion: Exclusion): string {
  if (exclusion === "no-data") return "no recent data";
  return station.closedAt ? `closed ${formatMonthYear(station.closedAt)}` : "closed";
}

/**
 * A row's accessible name, station first, e.g. "Halsted, Green Line, rank 1 of 140, ghost, 248
 * riders per day", or "State/Lake, Brown, Green, Orange, Purple, Pink Lines, closed Jan 2026".
 */
export function rowLabel(station: LedgerStation, exclusion: Exclusion | null, outsideFilter: boolean): string {
  const parts = [station.displayName];
  if (station.lines.length > 0) {
    parts.push(linesLabel(station.lines));
  }
  if (exclusion) {
    parts.push(exclusionText(station, exclusion));
  } else {
    if (station.rank !== null) {
      parts.push(station.rankedCount ? `rank ${station.rank} of ${station.rankedCount}` : `rank ${station.rank}`);
    }
    if (station.tier) parts.push(TIER_LABEL[station.tier].toLowerCase());
    parts.push(station.avg12m === null ? "riders per day not available" : `${formatRiders(station.avg12m)} riders per day`);
  }
  if (outsideFilter) parts.push("outside filter");
  return parts.join(", ");
}

export interface LedgerRowProps {
  station: LedgerStation;
  exclusion: Exclusion | null;
  outsideFilter: boolean;
  selected: boolean;
  /** 0 for the list's one Tab stop, -1 for every other row; the arrow keys move between them (R28). */
  tabIndex: 0 | -1;
  onOpen: (slug: string) => void;
  /** The row took focus, by Tab, an arrow key, a click, or the drawer closing: it becomes the Tab stop. */
  onFocus: (slug: string) => void;
}

/**
 * One station in the ledger: a 56px button with the rank and presence mark, the
 * name over its line bars, the week's sparkline, and the 12-month riders per day (KTD18), the
 * row's most prominent number. The rows share one Tab stop; the tier is written in the group
 * heading above them, so the row itself carries only the mark. Presence is the name's own ink level and the mark's shape (R23);
 * numbers stay at full ink. A station outside the ranking shows why in place of the numbers, and
 * its row opens the closure dossier like any other (R24). The selected row inverts.
 */
function LedgerRowView({ station, exclusion, outsideFilter, selected, tabIndex, onOpen, onFocus }: LedgerRowProps) {
  const nameInk = selected ? "text-surface" : exclusion ? "text-ink-3" : NAME_INK[station.tier ?? "healthy"];
  const quiet = selected ? "text-surface/[.72]" : "text-ink-2";

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(station.slug)}
        onFocus={() => onFocus(station.slug)}
        tabIndex={tabIndex}
        aria-current={selected ? "true" : undefined}
        aria-label={rowLabel(station, exclusion, outsideFilter)}
        data-station-row={station.slug}
        className={cn(
          "flex h-14 w-full items-center gap-2 border-b border-rule px-4 text-left focus-visible:outline-offset-[-4px]",
          selected ? "bg-ink text-surface focus-visible:outline-surface" : "hover:bg-ink/[.04]",
        )}
      >
        <span className="flex w-12 shrink-0 items-center justify-between pr-1">
          <span className={cn("font-mono tabular text-13", selected ? "text-surface/[.72]" : "text-ink-3")}>
            {station.rank ?? ""}
          </span>
          <PresenceMark tier={station.tier} excluded={exclusion} size={10} className="shrink-0" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn("truncate font-narrow text-15 font-semibold", nameInk)}>
            {station.displayName}
          </span>
          <span className="flex h-4 items-center gap-2">
            <LineBars lines={station.lines} decorative barClassName="h-[3px] w-4" />
            {outsideFilter && <span className={cn("text-11", quiet)}>outside filter</span>}
          </span>
        </span>

        {exclusion ? (
          <span className={cn("shrink-0 text-right text-13", quiet)}>{exclusionText(station, exclusion)}</span>
        ) : (
          <>
            <Sparkline sparkline={station.sparkline} />
            <span className="w-16 shrink-0 text-right font-mono tabular text-15">
              {station.avg12m === null ? <span className={quiet}>n/a</span> : formatRiders(station.avg12m)}
            </span>
          </>
        )}
      </button>
    </li>
  );
}

/** Memoized: a keystroke in the search re-renders only the rows whose props change. */
export const LedgerRow = memo(LedgerRowView);
