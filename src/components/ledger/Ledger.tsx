"use client";

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { animate, useReducedMotion } from "motion/react";
import { PresenceMark, TIER_LABEL } from "@/components/marks/PresenceMark";
import { ListStatus } from "@/components/shell/ListStatus";
import { useShell } from "@/components/shell/ShellContext";
import { CTA_LINE_ORDER, cn } from "@/lib/utils";
import { LedgerHeader } from "./LedgerHeader";
import { LedgerRow } from "./LedgerRow";
import { useLedgerModel, type LedgerModel, type LedgerRowModel } from "./useLedgerModel";

/** The scrolling list's id, the skip link's target (R28). One ledger is mounted at a time. */
export const LEDGER_LIST_ID = "stations";

/** Rows fade in over 120ms, 15ms apart, on a sort or filter change (R29). */
const ROW_FADE = 0.12;
const ROW_STAGGER = 0.015;
/** Only the rows on screen stagger, and at most this many, so a re-sort settles in about 400ms. */
const MAX_STAGGERED = 20;

function rowElements(container: HTMLElement | null): HTMLElement[] {
  return container ? [...container.querySelectorAll<HTMLElement>("[data-station-row]")] : [];
}

/**
 * Motion for the rows (R29), all enter-only and skipped under reduced motion: the first load fades
 * the list in once; a later sort or filter change fades the rows on screen in with a short
 * stagger. A search keystroke or a new selection does not animate.
 */
function useRowEntrance(scrollRef: RefObject<HTMLElement | null>, ready: boolean, arrangement: string) {
  const reduceMotion = useReducedMotion();
  const shown = useRef<string | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!ready || !scroller) return;
    const previous = shown.current;
    shown.current = arrangement;
    if (reduceMotion || previous === arrangement) return;

    if (previous === null) {
      animate(scroller, { opacity: [0, 1] }, { duration: ROW_FADE, ease: "easeOut" });
      return;
    }

    const view = scroller.getBoundingClientRect();
    rowElements(scroller)
      .filter((row) => {
        const box = row.getBoundingClientRect();
        return box.bottom > view.top && box.top < view.bottom;
      })
      .slice(0, MAX_STAGGERED)
      .forEach((row, i) => {
        animate(row, { opacity: [0, 1] }, { duration: ROW_FADE, delay: i * ROW_STAGGER, ease: "easeOut" });
      });
  }, [scrollRef, ready, arrangement, reduceMotion]);
}

/**
 * The selected row scrolls into view whenever the selection changes, including a deep link once
 * the list arrives. The row is always rendered, even when the search or filter would hide it.
 */
function useScrollToSelected(scrollRef: RefObject<HTMLElement | null>, ready: boolean, selectedSlug: string | null) {
  useEffect(() => {
    if (!ready || !selectedSlug) return;
    rowElements(scrollRef.current)
      .find((row) => row.dataset.stationRow === selectedSlug)
      ?.scrollIntoView({ block: "nearest" });
  }, [scrollRef, ready, selectedSlug]);
}

/** "/" anywhere outside a field puts the cursor in the search (R28). */
function useSlashToSearch(searchRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      const search = searchRef.current;
      if (!search) return;
      event.preventDefault();
      search.focus();
      search.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchRef]);
}

/**
 * Which row holds the list's one Tab stop (R28): the row last focused, if it is still shown, else
 * the selected row, else the first. The arrow keys move focus from there.
 */
function useRovingRows(ledger: LedgerModel, selectedSlug: string | null) {
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  const shown = useMemo(
    () => new Set([...ledger.ranked, ...ledger.sections.flatMap((section) => section.rows)].map((row) => row.station.slug)),
    [ledger],
  );
  const first = ledger.ranked[0]?.station.slug ?? ledger.sections[0]?.rows[0]?.station.slug ?? null;
  const tabStopSlug =
    focusedSlug && shown.has(focusedSlug) ? focusedSlug : selectedSlug && shown.has(selectedSlug) ? selectedSlug : first;
  const onFocusRow = useCallback((slug: string) => setFocusedSlug(slug), []);
  return { tabStopSlug, onFocusRow };
}

/** Up, down, Home, and End between the rows, whichever group or section they sit in. */
function moveBetweenRows(event: React.KeyboardEvent<HTMLDivElement>, scroller: HTMLElement | null) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-station-row]") : null;
  if (!target) return;
  const rows = rowElements(scroller);
  const index = rows.indexOf(target);
  if (index < 0) return;
  let next: number;
  switch (event.key) {
    case "ArrowDown":
      next = Math.min(index + 1, rows.length - 1);
      break;
    case "ArrowUp":
      next = Math.max(index - 1, 0);
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = rows.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  rows[next]?.focus();
}

/**
 * The station ledger: every station as a keyboard-reachable row, with search, the line
 * filter, and sort in a fixed head. Search, filter, and sort live in the shell, so they survive
 * moving between stations; the selection is the URL. `column` fills the desktop's 360px aside;
 * `sheet` is the same ledger in the phone's bottom sheet.
 */
export function Ledger({ variant }: { variant: "column" | "sheet" }) {
  const {
    list,
    retryList,
    stations,
    selectedSlug,
    openStation,
    query,
    setQuery,
    activeLines,
    toggleLine,
    sort,
    sortBy,
  } = useShell();
  const ledger = useLedgerModel({ stations, query, activeLines, sort, selectedSlug });
  const ready = list.status === "ready";

  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const arrangement = `${sort.key}:${sort.direction}:${CTA_LINE_ORDER.map((line) => (activeLines[line] ? 1 : 0)).join("")}`;
  useRowEntrance(scrollRef, ready, arrangement);
  useScrollToSelected(scrollRef, ready, selectedSlug);
  useSlashToSearch(searchRef);
  const { tabStopSlug, onFocusRow } = useRovingRows(ledger, selectedSlug);

  const { firstMatchSlug } = ledger;
  const openFirstMatch = useCallback(() => {
    if (query.trim() !== "" && firstMatchSlug) openStation(firstMatchSlug);
  }, [query, firstMatchSlug, openStation]);

  const clearSearch = useCallback(() => {
    setQuery("");
    searchRef.current?.focus();
  }, [setQuery]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LedgerHeader
        variant={variant}
        summary={ready ? { total: ledger.total, matchCount: ledger.matchCount, narrowed: ledger.narrowed } : null}
        query={query}
        onQueryChange={setQuery}
        onSubmit={openFirstMatch}
        activeLines={activeLines}
        onToggleLine={toggleLine}
        sort={sort}
        onSort={sortBy}
        searchRef={searchRef}
      />
      <div
        ref={scrollRef}
        id={LEDGER_LIST_ID}
        tabIndex={-1}
        onKeyDown={(event) => moveBetweenRows(event, scrollRef.current)}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-offset-[-2px]"
      >
        {list.status === "ready" ? (
          <LedgerBody
            ledger={ledger}
            query={query}
            selectedSlug={selectedSlug}
            tabStopSlug={tabStopSlug}
            onOpen={openStation}
            onFocusRow={onFocusRow}
            onClearSearch={clearSearch}
            dataThrough={list.data.dataThrough}
          />
        ) : (
          <ListStatus list={list} onRetry={retryList} />
        )}
        {variant === "sheet" && <div className="h-[env(safe-area-inset-bottom)]" aria-hidden />}
      </div>
      {/* The result count, read out as the search or filter changes (R28). */}
      <p role="status" className="sr-only">
        {ready ? ledger.announcement : ""}
      </p>
    </div>
  );
}

/**
 * A group's heading, which doubles as the legend: the mark the rows carry, the word for it, and
 * how many rows follow. Sentence case, type and the one mark, on a hairline.
 */
function GroupHeading({
  id,
  mark,
  label,
  count,
  first,
}: {
  id: string;
  mark: React.ReactNode;
  label: string;
  count: number;
  first: boolean;
}) {
  return (
    <h2 id={id} className={cn("flex items-center gap-2 border-b border-rule px-4 pb-2 text-13 text-ink-2", first ? "pt-3" : "pt-6")}>
      <span className="flex w-4 shrink-0 items-center justify-center">{mark}</span>
      <span>
        {label}, <span className="font-mono tabular">{count}</span> {count === 1 ? "station" : "stations"}
      </span>
    </h2>
  );
}

function LedgerBody({
  ledger,
  query,
  selectedSlug,
  tabStopSlug,
  onOpen,
  onFocusRow,
  onClearSearch,
  dataThrough,
}: {
  ledger: LedgerModel;
  query: string;
  selectedSlug: string | null;
  tabStopSlug: string | null;
  onOpen: (slug: string) => void;
  onFocusRow: (slug: string) => void;
  onClearSearch: () => void;
  dataThrough: string | null;
}) {
  const headingId = useId();
  const searching = query.trim() !== "";

  const rows = (models: LedgerRowModel[]) =>
    models.map(({ station, exclusion, outsideFilter }) => (
      <LedgerRow
        key={station.id}
        station={station}
        exclusion={exclusion}
        outsideFilter={outsideFilter}
        selected={station.slug === selectedSlug}
        tabIndex={station.slug === tabStopSlug ? 0 : -1}
        onOpen={onOpen}
        onFocus={onFocusRow}
      />
    ));

  return (
    <>
      {ledger.narrowed && ledger.matchCount === 0 && (
        <div className="flex min-h-14 items-center gap-3 border-b border-rule px-4 py-2">
          <p className="min-w-0 flex-1 break-words text-13 text-ink-2">
            {searching ? <>No stations match &ldquo;{query.trim()}&rdquo;. Not even a ghost.</> : "No stations on the selected lines"}
          </p>
          {searching && (
            <button
              type="button"
              onClick={onClearSearch}
              className="inline-flex h-8 shrink-0 items-center rounded border border-rule px-3 text-13 hover:bg-ink/[.06]"
            >
              Clear search
            </button>
          )}
        </div>
      )}
      {ledger.total === 0 && <p className="px-4 py-4 text-13 text-ink-2">No stations to show.</p>}

      {/* Under the rank sort the ranked rows read as tiers, each under its mark and its word. */}
      {ledger.tierGroups ? (
        ledger.tierGroups.map((group, i) => {
          const id = `${headingId}-${group.tier}`;
          return (
            <Fragment key={group.tier}>
              <GroupHeading
                id={id}
                mark={<PresenceMark tier={group.tier} size={10} />}
                label={TIER_LABEL[group.tier]}
                count={group.rows.length}
                first={i === 0}
              />
              <ol aria-labelledby={id}>{rows(group.rows)}</ol>
            </Fragment>
          );
        })
      ) : (
        ledger.ranked.length > 0 && <ol aria-label="Ranked stations">{rows(ledger.ranked)}</ol>
      )}

      {ledger.sections.map((section) => {
        const id = `${headingId}-${section.kind}`;
        return (
          <Fragment key={section.kind}>
            <GroupHeading
              id={id}
              mark={<PresenceMark tier={null} excluded={section.kind} size={10} />}
              label={section.title}
              count={section.rows.length}
              first={false}
            />
            <ul aria-labelledby={id}>{rows(section.rows)}</ul>
          </Fragment>
        );
      })}

      {/* Where the numbers come from and how old they are, in the list itself (R13). */}
      {dataThrough && (
        <p className="px-4 pb-4 pt-6 text-13 text-ink-2">
          CTA publishes station entries about two months after the fact. Data through{" "}
          <time className="font-mono tabular text-ink" dateTime={dataThrough}>
            {dataThrough}
          </time>
          .
        </p>
      )}
    </>
  );
}
