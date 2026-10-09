"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { AttributionControl, NavigationControl, type MapEvent, type MapMouseEvent } from "react-map-gl/mapbox";
import type { FeatureCollection, LineString } from "geojson";
import { ALL_LINES_ON, sheetOpenPx } from "@/components/shell/model";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/theme";
import { PHONE_QUERY, useIsPhone } from "@/hooks/useMediaQuery";
import { explodeAndStitchSegments } from "@/lib/cta/explodeAndStitchSegments";
import { cn } from "@/lib/utils";
import {
  INTERACTIVE_LAYERS,
  MAP_PALETTE,
  MAP_STYLE,
  SYSTEM_BOUNDS,
  nearestStation,
  networkBounds,
  stationFeatures,
  type StationHit,
} from "./layers";
import { StationMap, type Padding } from "./stationMap";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const TRACKS_URL = "/data/cta/chicago_track_segments.geojson";

type MapErrorEvent = Parameters<NonNullable<React.ComponentProps<typeof Map>["onError"]>>[0];

/** From 768px the drawer sits over the map's right edge; below it, it is the page under the map. */
const DRAWER_BESIDE_MAP = "(min-width: 768px)";

/** Names the canvas, which mapbox-gl makes a labeled region. */
const MAP_LOCALE = { "Map.Title": "Map of CTA L stations" };

type TrackProperties = { segment_id: string; corridor: string; is_loop: boolean; lines: string[] };

function drawerBesideMap(): boolean {
  return window.matchMedia(DRAWER_BESIDE_MAP).matches;
}

/**
 * The camera's inset from the map's edges when it frames the network: clear of the phone's sheet
 * on the map page, a small margin on a phone station page's 28vh map, and a 40px margin on wider
 * screens. The drawer's width, while one sits beside the map, is StationMap's to add.
 */
function networkPadding(isPhone: boolean, stationOpen: boolean): Padding {
  if (!isPhone) return { top: 40, bottom: 40, left: 40, right: 40 };
  if (stationOpen) return { top: 8, bottom: 8, left: 8, right: 8 };
  return { top: 24, left: 16, right: 16, bottom: sheetOpenPx(window.innerHeight) + 16 };
}

/**
 * How the map starts, read once from the viewport: the camera shows the whole network clear of
 * the phone's sheet, and Mapbox's logo sits where nothing covers it. A phone that opens on a
 * station page has a 28vh map and no sheet, so it takes a small margin; the station's fly-to
 * follows once the list loads.
 */
function openingSetup(stationOpen: boolean) {
  const isPhone = window.matchMedia(PHONE_QUERY).matches;
  return {
    initialViewState: { bounds: SYSTEM_BOUNDS, fitBoundsOptions: { padding: networkPadding(isPhone, stationOpen) } },
    // The phone's sheet covers the map's bottom edge, so Mapbox's logo joins its credits at the
    // top right; the top left is the "Whole network" button's.
    logoPosition: isPhone ? ("top-right" as const) : ("bottom-left" as const),
  };
}

/**
 * The CTA tracks, exploded once with every line on. The line filter dims tracks through paint, so
 * the pipeline reruns only if the track file itself changes.
 */
function useTracks() {
  const [tracks, setTracks] = useState<FeatureCollection<LineString, TrackProperties> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(TRACKS_URL, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: FeatureCollection<LineString, TrackProperties> | null) => setTracks(data))
      // Offline or aborted: the stations still draw, over the base map alone.
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return useMemo(() => (tracks ? explodeAndStitchSegments(tracks, ALL_LINES_ON) : null), [tracks]);
}

/** The station under a pointer event, nearest first where hit circles overlap. */
function stationAt(event: MapMouseEvent): StationHit | null {
  return nearestStation(event.features, event.point, (lngLat) => event.target.project(lngLat));
}

/**
 * The one map (KTD13), shared by every viewport: CTA tracks in the official colors and every
 * station as a presence mark, drawn by StationMap as Mapbox layers with no DOM markers. Clicking
 * or tapping any mark, closed and no-data ones included, opens its station page; selecting a
 * station inverts its mark and flies the camera to it, clear of the drawer.
 *
 * The canvas is not a keyboard path to stations: the ledger is. On a phone station page the map
 * is a 28vh locator above the dossier, so one finger scrolls the page and two fingers move the map.
 *
 * Closing a station flies the camera back to the whole network (or the lines the filter keeps),
 * and a "Whole network" button does the same at any time, so the map is never left on three
 * blocks of one line with no way out. Wider screens also get Mapbox's zoom buttons.
 */
export default function MapView() {
  const { theme } = useTheme();
  const { stations, selected, selectedSlug, openStation, activeLines } = useShell();
  const isPhone = useIsPhone();
  const containerRef = useRef<HTMLDivElement>(null);
  const [stationMap, setStationMap] = useState<StationMap | null>(null);
  const [opening] = useState(() => openingSetup(selectedSlug !== null));
  // Without a token there is no map to load; a rejected one (401, 403) says so on its first tile.
  const [mapFailed, setMapFailed] = useState(!MAPBOX_TOKEN);
  // The style loads well before its tiles; the map has drawn once it first goes idle.
  const [mapDrawn, setMapDrawn] = useState(false);
  const handleIdle = useCallback(() => setMapDrawn(true), []);

  const tracks = useTracks();
  const stationData = useMemo(() => stationFeatures(stations, activeLines), [stations, activeLines]);
  const palette = MAP_PALETTE[theme];
  const drawerOpen = selectedSlug !== null;
  const selectedId = selected?.id ?? null;

  const handleLoad = useCallback((event: MapEvent) => setStationMap(new StationMap(event.target, { palette })), [palette]);

  useEffect(() => stationMap?.connect(), [stationMap]);

  // The theme's style URL changes on the Map below; its `style.load` rebuilds in this palette.
  useEffect(() => {
    stationMap?.setPalette(palette);
  }, [stationMap, palette]);
  useEffect(() => {
    stationMap?.setStations(stationData);
  }, [stationMap, stationData]);
  useEffect(() => {
    if (tracks) stationMap?.setTracks(tracks);
  }, [stationMap, tracks]);
  useEffect(() => {
    stationMap?.setActiveLines(activeLines);
  }, [stationMap, activeLines]);
  useEffect(() => {
    stationMap?.select(selectedId);
  }, [stationMap, selectedId]);

  /** Frames the network, or the filtered lines, inset for the sheet or the open drawer. */
  const showNetwork = useCallback(
    (stationOpen: boolean) => {
      stationMap?.showNetwork(
        networkBounds(stationData),
        networkPadding(isPhone, stationOpen),
        stationOpen && !isPhone && drawerBesideMap(),
      );
    },
    [stationMap, stationData, isPhone],
  );

  // Fly once per selection, including a deep link once the list has loaded; a list refresh that
  // hands back the same station does not move the camera. Closing flies back to the network.
  const flownTo = useRef<string | null>(null);
  const wasOpen = useRef(drawerOpen);
  useEffect(() => {
    if (!stationMap) return;
    if (!drawerOpen) {
      flownTo.current = null;
      stationMap.releasePadding();
      if (wasOpen.current) showNetwork(false);
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    if (!selected || flownTo.current === selected.id) return;
    flownTo.current = selected.id;
    stationMap.focus([selected.longitude, selected.latitude], drawerBesideMap());
  }, [stationMap, selected, drawerOpen, showNetwork]);

  // The map's box changes size between breakpoints and when the phone's dossier shrinks it to
  // 28vh; mapbox-gl only follows window resizes, so the box is observed here.
  const drawerOpenRef = useRef(drawerOpen);
  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);
  useEffect(() => {
    const element = containerRef.current;
    if (!stationMap || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => stationMap.resize(drawerOpenRef.current, drawerBesideMap()));
    observer.observe(element);
    return () => observer.disconnect();
  }, [stationMap]);

  const handleClick = useCallback(
    (event: MapMouseEvent) => {
      const slug = stationAt(event)?.slug;
      if (slug && slug !== selectedSlug) openStation(slug);
    },
    [openStation, selectedSlug],
  );
  const handleMouseMove = useCallback(
    (event: MapMouseEvent) => stationMap?.hover(stationAt(event)?.id ?? null),
    [stationMap],
  );
  const handleMouseLeave = useCallback(() => stationMap?.hover(null), [stationMap]);
  const handleError = useCallback((event: MapErrorEvent) => {
    // Only an unusable token means no map; a tile that fails to load is not the map failing.
    const status = (event.error as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403) setMapFailed(true);
  }, []);

  // On a phone station page one finger scrolls the dossier, not the map above it.
  const locator = isPhone && drawerOpen;
  // The phone's sheet covers the map's bottom edge, so Mapbox's credits move to the top.
  const attributionPosition = isPhone ? "top-right" : "bottom-left";

  return (
    <div ref={containerRef} className="absolute inset-0">
      <Map
        initialViewState={opening.initialViewState}
        mapStyle={MAP_STYLE[theme]}
        styleDiffing={false}
        mapboxAccessToken={MAPBOX_TOKEN}
        locale={MAP_LOCALE}
        interactiveLayerIds={INTERACTIVE_LAYERS}
        onLoad={handleLoad}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onError={handleError}
        onIdle={mapDrawn ? undefined : handleIdle}
        minZoom={8}
        maxZoom={18}
        maxPitch={0}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        dragPan={!locator}
        attributionControl={false}
        logoPosition={opening.logoPosition}
      >
        <AttributionControl key={attributionPosition} position={attributionPosition} />
        {!isPhone && <NavigationControl position="top-left" showCompass={false} />}
      </Map>
      {/* The way back to the whole L, in the corner Mapbox's controls leave free; not on a phone
          station page, where the small map is a locator and the sheet is gone. */}
      {!locator && (
        <button
          type="button"
          onClick={() => showNetwork(drawerOpen)}
          className={cn(
            "absolute left-2.5 z-chrome inline-flex h-8 items-center rounded border border-rule bg-surface-2 px-3 text-13 text-ink hover:border-ink-2 active:translate-y-px",
            isPhone ? "top-2.5" : "top-20",
          )}
        >
          Whole network
        </button>
      )}
      {mapFailed ? (
        <p role="status" className="absolute inset-x-4 top-16 z-chrome text-13 text-ink-2">
          The map could not load. Every station is still in the list.
        </p>
      ) : (
        !mapDrawn && (
          <p
            role="status"
            className={cn(
              "pointer-events-none absolute inset-x-4 z-chrome -translate-y-1/2 text-center text-13 text-ink-2",
              // The phone's sheet covers the lower half of the map, so the sentence sits in the upper part.
              isPhone ? "top-1/4" : "top-1/2",
            )}
          >
            Loading the map
          </p>
        )
      )}
    </div>
  );
}
