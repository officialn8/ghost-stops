"use client";

import { useRef, useState, type Ref } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { noLineActive } from "@/components/shell/model";
import type { ActiveLines, SortDirection, SortKey, SortState } from "@/components/shell/ShellContext";
import { CTA_LINE_ORDER, cn, ctaLineColors, lineLabelInk, type CTALine } from "@/lib/utils";

/** How each sort head reads aloud: "Sort by riders per day, fewest first". */
const SPOKEN: Readonly<Record<SortKey, string>> = { rank: "rank", riders: "riders per day", name: "name" };
const VISIBLE: Readonly<Record<SortKey, string>> = { rank: "Rank", riders: "Riders per day", name: "Name" };
/**
 * The direction, said for what the column shows: rank 1 is the most ghost-like station, so the
 * rank head never says "ascending" of a score that runs the other way.
 */
const DIRECTION: Readonly<Record<SortKey, Readonly<Record<SortDirection, string>>>> = {
  rank: { asc: "1 first", desc: "last first" },
  riders: { asc: "fewest first", desc: "most first" },
  name: { asc: "A to Z", desc: "Z to A" },
};

/** An off line's outline: its color at 30%, the "dimmed" bar. */
const OFF_ALPHA = "4D";

/** What the ledger holds, for the line above the search field. */
export interface LedgerSummary {
  total: number;
  matchCount: number;
  narrowed: boolean;
}

export interface LedgerHeaderProps {
  variant: "column" | "sheet";
  /** Null until the list has loaded. */
  summary: LedgerSummary | null;
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
 * The line that says what the list is, above the search field, set like a sign: the count and
 * the ranking, nothing more, so the first viewport names the Ghost score. The tier headings and
 * the dossier say what it measures. While a search or the line filter narrows the list, the same
 * line counts the matches instead, visibly and not only in the live region.
 */
function Lede({ summary }: { summary: LedgerSummary | null }) {
  if (summary?.narrowed) {
    return (
      <p className="text-13 text-ink-2" data-ledger-summary>
        <span className="font-mono tabular text-ink">{summary.matchCount}</span> of{" "}
        <span className="font-mono tabular">{summary.total}</span> stations match
      </p>
    );
  }
  return (
    <p className="text-13 text-ink-2" data-ledger-summary>
      {summary ? (
        <>
          <span className="font-mono tabular text-ink">{summary.total}</span> stations
        </>
      ) : (
        "L stations"
      )}
      , ranked by Ghost score
    </p>
  );
}

/**
 * The ledger's fixed head (R27): the lede, search, the line filter as eight bars in the official
 * colors, and the sort heads in the one uppercase tracked label style. The column fits the bars
 * in one row; the phone sheet wraps them to two rows of four so the whole head shows at the
 * sheet's lowest snap point.
 *
 * The eight bars are one Tab stop: the arrow keys move between them, Home and End jump to the
 * ends, and the sort heads follow with one Tab (R28).
 */
export function LedgerHeader({
  variant,
  summary,
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
  const [focusedLine, setFocusedLine] = useState<CTALine>(CTA_LINE_ORDER[0]);
  const bars = useRef<Partial<Record<CTALine, HTMLButtonElement | null>>>({});
  const columns = variant === "sheet" ? 4 : CTA_LINE_ORDER.length;

  const moveAcrossBars = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = CTA_LINE_ORDER.indexOf(focusedLine);
    const last = CTA_LINE_ORDER.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
        next = index === 0 ? last : index - 1;
        break;
      case "ArrowDown":
        next = Math.min(index + columns, last);
        break;
      case "ArrowUp":
        next = Math.max(index - columns, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next === index) return;
    const line = CTA_LINE_ORDER[next];
    setFocusedLine(line);
    bars.current[line]?.focus();
  };

  return (
    <div className={cn("flex-none border-b border-rule px-4", variant === "sheet" ? "pt-1" : "pt-3")} data-ledger-head>
      <Lede summary={summary} />

      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query !== "") {
            // Stopped here, so the key never reaches the drawer's window listener and the station
            // stays open (R28). React listens at the root (or portal) container, below the window.
            event.preventDefault();
            event.stopPropagation();
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
          "mt-2 h-9 w-full rounded border border-rule bg-surface-2 px-3 placeholder:text-ink-3",
          variant === "sheet" ? "text-18" : "text-15",
        )}
        data-ledger-search
      />

      <div
        role="group"
        aria-label="Filter by line"
        onKeyDown={moveAcrossBars}
        className={cn("mt-2 grid gap-1", variant === "sheet" ? "grid-cols-4" : "grid-cols-8")}
      >
        {CTA_LINE_ORDER.map((line) => {
          const on = allOff || activeLines[line];
          const color = ctaLineColors[line];
          return (
            <button
              key={line}
              ref={(element) => {
                bars.current[line] = element;
              }}
              type="button"
              tabIndex={line === focusedLine ? 0 : -1}
              aria-pressed={on}
              aria-label={`${line} Line`}
              onClick={() => onToggleLine(line)}
              onFocus={() => setFocusedLine(line)}
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

      {/* Column heads: rank (the ghost score's order) and name on the left, riders on the right. */}
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
  const label = active ? `Sort by ${SPOKEN[sortKey]}, ${DIRECTION[sortKey][sort.direction]}` : `Sort by ${SPOKEN[sortKey]}`;

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={active ? `${VISIBLE[sortKey]}, ${DIRECTION[sortKey][sort.direction]}. Press again to reverse.` : undefined}
      onClick={() => onSort(sortKey)}
      className={cn(
        "-mx-1 inline-flex h-6 items-center gap-0.5 whitespace-nowrap rounded px-1 text-11 uppercase tracking-[0.08em]",
        active ? "text-ink" : "text-ink-2 hover:text-ink",
      )}
    >
      {VISIBLE[sortKey]}
      {active && <Arrow className="h-3 w-3" strokeWidth={1.75} aria-hidden />}
    </button>
  );
}
