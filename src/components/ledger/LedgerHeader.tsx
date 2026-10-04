"use client";

import type { Ref } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { noLineActive } from "@/components/shell/model";
import type { ActiveLines, SortKey, SortState } from "@/components/shell/ShellContext";
import { CTA_LINE_ORDER, cn, ctaLineColors, lineLabelInk, type CTALine } from "@/lib/utils";

/** How each sort head reads aloud: "Sort by riders per day, ascending". */
const SPOKEN: Readonly<Record<SortKey, string>> = { rank: "ghost score", riders: "riders per day", name: "name" };
const VISIBLE: Readonly<Record<SortKey, string>> = { rank: "Ghost score", riders: "Riders/day", name: "Name" };

/** An off line's outline: its color at 30%, the "dimmed" bar. */
const OFF_ALPHA = "4D";

export interface LedgerHeaderProps {
  variant: "column" | "sheet";
  query: string;
  onQueryChange: (query: string) => void;
  /** Enter in the search field: open the first match. */
  onSubmit: () => void;
  activeLines: ActiveLines;
  onToggleLine: (line: CTALine) => void;
  sort: SortState;
  onSort: (key: SortKey) => void;
  searchRef?: Ref<HTMLInputElement>;
}

/**
 * The ledger's fixed head (R27): search, the line filter as eight bars in the official colors,
 * and the sort heads in the one uppercase tracked label style. The column fits the bars in one
 * row; the phone sheet wraps them to two rows of four so the whole head shows at the sheet's
 * lowest snap point.
 */
export function LedgerHeader({
  variant,
  query,
  onQueryChange,
  onSubmit,
  activeLines,
  onToggleLine,
  sort,
  onSort,
  searchRef,
}: LedgerHeaderProps) {
  // Every line off shows every station (R27), so the bars show every line as on.
  const allOff = noLineActive(activeLines);

  return (
    <div className={cn("flex-none border-b border-rule px-4", variant === "sheet" ? "pt-1" : "pt-3")}>
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query !== "") {
            // Claimed, so the drawer's Escape listener leaves the station open (R28).
            event.preventDefault();
            onQueryChange("");
          } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
        aria-label="Search stations"
        placeholder="Search stations"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        // 18px on the phone: iOS zooms the page into any field set smaller than 16px.
        className={cn(
          "h-9 w-full rounded border border-rule bg-surface-2 px-3 placeholder:text-ink-3",
          variant === "sheet" ? "text-18" : "text-15",
        )}
        data-ledger-search
      />

      <div
        role="group"
        aria-label="Filter by line"
        className={cn("mt-2 grid gap-1", variant === "sheet" ? "grid-cols-4" : "grid-cols-8")}
      >
        {CTA_LINE_ORDER.map((line) => {
          const on = allOff || activeLines[line];
          const color = ctaLineColors[line];
          return (
            <button
              key={line}
              type="button"
              aria-pressed={on}
              aria-label={`${line} Line`}
              onClick={() => onToggleLine(line)}
              // Off is never color alone: the bar empties to an outline and the name is struck.
              className={cn(
                "flex h-6 min-w-0 items-center justify-center border font-narrow text-11",
                on ? "font-semibold" : "text-ink-2 line-through hover:text-ink",
              )}
              style={
                on
                  ? { backgroundColor: color, borderColor: color, color: lineLabelInk(line) }
                  : { borderColor: `${color}${OFF_ALPHA}` }
              }
            >
              {line}
            </button>
          );
        })}
      </div>

      {/* Column heads: the ghost score (the rank column's order) and name on the left, riders on the right. */}
      <div className="mt-1 flex h-8 items-center gap-4">
        <SortHead sortKey="rank" sort={sort} onSort={onSort} />
        <span className="min-w-0 flex-1">
          <SortHead sortKey="name" sort={sort} onSort={onSort} />
        </span>
        <SortHead sortKey="riders" sort={sort} onSort={onSort} />
      </div>
    </div>
  );
}

function SortHead({ sortKey, sort, onSort }: { sortKey: SortKey; sort: SortState; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey;
  const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
  const label = active
    ? `Sort by ${SPOKEN[sortKey]}, ${sort.direction === "asc" ? "ascending" : "descending"}`
    : `Sort by ${SPOKEN[sortKey]}`;

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={() => onSort(sortKey)}
      className={cn(
        "-mx-1 inline-flex h-6 items-center gap-0.5 rounded px-1 text-11 uppercase tracking-[0.08em]",
        active ? "text-ink" : "text-ink-2 hover:text-ink",
      )}
    >
      {VISIBLE[sortKey]}
      {active && <Arrow className="h-3 w-3" strokeWidth={1.75} aria-hidden />}
    </button>
  );
}
