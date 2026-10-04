"use client";

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";
import { animate, useReducedMotion } from "motion/react";
import { ListStatus } from "@/components/shell/ListStatus";
import { useShell } from "@/components/shell/ShellContext";
import { CTA_LINE_ORDER } from "@/lib/utils";
import { LedgerHeader } from "./LedgerHeader";
import { LedgerRow } from "./LedgerRow";
import { useLedgerModel, type LedgerModel, type LedgerRowModel } from "./useLedgerModel";

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
        query={query}
        onQueryChange={setQuery}
        onSubmit={openFirstMatch}
        activeLines={activeLines}
        onToggleLine={toggleLine}
        sort={sort}
        onSort={sortBy}
        searchRef={searchRef}
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {list.status === "ready" ? (
          <LedgerBody
            ledger={ledger}
            query={query}
            selectedSlug={selectedSlug}
            onOpen={openStation}
            onClearSearch={clearSearch}
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

function LedgerBody({
  ledger,
  query,
  selectedSlug,
  onOpen,
  onClearSearch,
}: {
  ledger: LedgerModel;
  query: string;
  selectedSlug: string | null;
  onOpen: (slug: string) => void;
  onClearSearch: () => void;
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
        onOpen={onOpen}
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

      {ledger.ranked.length > 0 && <ol aria-label="Ranked stations">{rows(ledger.ranked)}</ol>}

      {ledger.sections.map((section) => {
        const id = `${headingId}-${section.kind}`;
        return (
          <Fragment key={section.kind}>
            <h2 id={id} className="border-b border-rule px-4 pb-2 pt-6 text-13 text-ink-2">
              {section.title}
            </h2>
            <ul aria-labelledby={id}>{rows(section.rows)}</ul>
          </Fragment>
        );
      })}
    </>
  );
}
