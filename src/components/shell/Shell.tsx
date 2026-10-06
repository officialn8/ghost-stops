"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { MotionConfig } from "motion/react";
import { LEDGER_LIST_ID, Ledger } from "@/components/ledger/Ledger";
import { useIsPhone } from "@/hooks/useMediaQuery";
import { cn, type CTALine } from "@/lib/utils";
import type { StationListItem } from "@/types/station";
import { Drawer } from "./Drawer";
import { HealthBanner } from "./HealthBanner";
import { MobileSheet } from "./MobileSheet";
import { ALL_LINES_ON } from "./model";
import { ShellContext, type ActiveLines, type ShellModel, type SortKey, type SortState } from "./ShellContext";
import { TopBar } from "./TopBar";
import { useStationList } from "./useStationList";

// Mapbox needs the browser; the map region shows the bare surface until it loads.
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-surface-2" aria-hidden />,
});

const NO_STATIONS: readonly StationListItem[] = [];

function isShown(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** The skip link's click: focus the list itself, so the next Tab lands on a station row. */
function skipToStations(event: React.MouseEvent<HTMLAnchorElement>) {
  const list = document.getElementById(LEDGER_LIST_ID);
  if (!list) return;
  event.preventDefault();
  list.focus();
}

/**
 * After the drawer closes, focus returns to the row it was opened from when that row is on
 * screen, and otherwise to the ledger's search field (R28).
 */
function useFocusReturn(selectedSlug: string | null) {
  const previous = useRef<string | null>(selectedSlug);

  useEffect(() => {
    const closed = previous.current;
    previous.current = selectedSlug;
    if (closed === null || selectedSlug !== null) return;

    const row = [...document.querySelectorAll<HTMLElement>(`[data-station-row="${CSS.escape(closed)}"]`)].find(isShown);
    const search = [...document.querySelectorAll<HTMLElement>("[data-ledger-search]")].find(isShown);
    (row ?? search)?.focus();
  }, [selectedSlug]);
}

/**
 * The persistent shell (KTD12, KTD13): top bar, ledger, one map, and the station drawer, in a
 * route-group layout so it survives navigation between station pages. Layout is CSS:
 *
 * - 1100px and up: ledger column, map, and the drawer over the map's right edge.
 * - 768 to 1100px: the drawer replaces the ledger column while it is open.
 * - Under 768px: the map is full-bleed under a bottom sheet holding the ledger; a station page
 *   shrinks the same map to 28vh and the dossier scrolls below it.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ slug?: string }>();
  const selectedSlug = typeof params?.slug === "string" ? params.slug : null;
  const isOpen = selectedSlug !== null;
  const isPhone = useIsPhone();

  // The drawer the reader arrived on (a station link, server-rendered) shows at once rather than
  // shipping at opacity 0; after it first closes, every drawer opened slides in.
  const [arrivedOpen, setArrivedOpen] = useState(isOpen);
  if (arrivedOpen && !isOpen) setArrivedOpen(false);

  const { list, retry } = useStationList();
  const [query, setQuery] = useState("");
  const [activeLines, setActiveLines] = useState<ActiveLines>(ALL_LINES_ON);
  const [sort, setSort] = useState<SortState>({ key: "rank", direction: "asc" });

  const stations = list.status === "ready" ? list.data.stations : NO_STATIONS;
  const stationBySlug = useMemo(
    () => new Map(stations.flatMap((s) => (s.slug ? [[s.slug, s] as const] : []))),
    [stations],
  );
  const selected = selectedSlug ? (stationBySlug.get(selectedSlug) ?? null) : null;

  const openStation = useCallback((slug: string) => router.push(`/station/${slug}`), [router]);
  const closeStation = useCallback(() => router.push("/"), [router]);
  const toggleLine = useCallback(
    (line: CTALine) => setActiveLines((current) => ({ ...current, [line]: !current[line] })),
    [],
  );
  const sortBy = useCallback(
    (key: SortKey) =>
      setSort((current) =>
        current.key === key
          ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
          : // A new key starts ascending: the ghostliest or emptiest first, names A to Z.
            { key, direction: "asc" },
      ),
    [],
  );

  useFocusReturn(selectedSlug);

  const model = useMemo<ShellModel>(
    () => ({
      list,
      retryList: retry,
      stations,
      stationBySlug,
      selectedSlug,
      selected,
      openStation,
      closeStation,
      query,
      setQuery,
      activeLines,
      toggleLine,
      sort,
      sortBy,
    }),
    [list, retry, stations, stationBySlug, selectedSlug, selected, openStation, closeStation, query, activeLines, toggleLine, sort, sortBy],
  );

  return (
    <ShellContext.Provider value={model}>
      <MotionConfig reducedMotion="user">
        <div className="relative flex h-dvh flex-col overflow-hidden bg-surface text-ink">
          {/* The first Tab stop: past the bar and the ledger's head, straight to the rows (R28). It
              inverts when it appears, like a selection; it is left out where no ledger is mounted. */}
          {!(isPhone && isOpen) && (
            <a
              href={`#${LEDGER_LIST_ID}`}
              onClick={skipToStations}
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-banner focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-13 focus:text-surface"
            >
              Skip to stations
            </a>
          )}
          <TopBar />
          {list.status === "ready" && list.stale && <HealthBanner lastSuccessfulFetch={list.data.lastSuccessfulFetch} />}
          <div className="relative flex min-h-0 flex-1">
            {/* A phone's ledger lives in the bottom sheet, so the column is not mounted there. */}
            {!isPhone && (
              <aside
                aria-label="Stations"
                className={cn(
                  "hidden min-h-0 w-[360px] shrink-0 flex-col border-r border-rule md:flex",
                  isOpen && "md:hidden lg:flex",
                )}
              >
                <Ledger variant="column" />
              </aside>
            )}
            <main
              className={cn(
                "relative flex min-h-0 min-w-0 flex-1 flex-col",
                isOpen && "overflow-y-auto overscroll-contain md:overflow-visible",
              )}
            >
              <div
                className={cn("relative w-full min-h-0 flex-1", isOpen && "h-[28vh] flex-none md:h-auto md:flex-1")}
                data-map-region
              >
                <MapView />
              </div>
              {/* No exit animation: an exiting drawer would keep its children, and the route
                  inside them already reads "/", so it would fade an empty panel. */}
              {isOpen ? <Drawer entrance={!arrivedOpen}>{children}</Drawer> : children}
            </main>
          </div>
          {/* The sheet belongs to the phone's map page. vaul 1.1.2 renders it as a modal dialog
              whatever `modal` says (it never hands `modal` to Radix), which marks the rest of the
              page aria-hidden and traps focus, so a station page must not have it mounted. */}
          {isPhone && !isOpen && <MobileSheet />}
        </div>
      </MotionConfig>
    </ShellContext.Provider>
  );
}
