"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { AttributionControl, type MapEvent, type MapMouseEvent } from "react-map-gl/mapbox";
import type { FeatureCollection, LineString } from "geojson";
import { ALL_LINES_ON } from "@/components/shell/model";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/theme";
import { PHONE_QUERY, useIsPhone } from "@/hooks/useMediaQuery";
import { explodeAndStitchSegments } from "@/lib/cta/explodeAndStitchSegments";
import {
  INTERACTIVE_LAYERS,
  MAP_PALETTE,
  MAP_STYLE,
  SYSTEM_BOUNDS,
  nearestStation,
  stationFeatures,
  type StationHit,
} from "./layers";
import { StationMap } from "./stationMap";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const TRACKS_URL = "/data/cta/chicago_track_segments.geojson";

/** From 768px the drawer sits over the map's right edge; below it, it is the page under the map. */
const DRAWER_BESIDE_MAP = "(min-width: 768px)";

/** Names the canvas, which mapbox-gl makes a labeled region. */
const MAP_LOCALE = { "Map.Title": "Map of CTA L stations" };

/** The phone's bottom sheet covers this share of the map at its first snap point. */
const SHEET_PEEK = 0.25;

type TrackProperties = { segment_id: string; corridor: string; is_loop: boolean; lines: string[] };

function drawerBesideMap(): boolean {
  return window.matchMedia(DRAWER_BESIDE_MAP).matches;
}

/**
 * How the map starts, read once from the viewport: the camera shows the whole network clear of
 * the phone's sheet, and Mapbox's logo sits where nothing covers it. A phone that opens on a
 * station page has a 28vh map and no sheet, so it takes a small margin; the station's fly-to
 * follows once the list loads.
 */
function openingSetup(stationOpen: boolean) {
  const isPhone = window.matchMedia(PHONE_QUERY).matches;
  const padding = !isPhone
    ? 40
    : stationOpen
      ? 8
      : { top: 24, left: 16, right: 16, bottom: Math.round(window.innerHeight * SHEET_PEEK) + 16 };
  return {
    initialViewState: { bounds: SYSTEM_BOUNDS, fitBoundsOptions: { padding } },
    // The phone's sheet covers the map's bottom edge.
    logoPosition: isPhone ? ("top-left" as const) : ("bottom-left" as const),
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
 */
export default function MapView() {
  const { theme } = useTheme();
  const { stations, selected, selectedSlug, openStation, activeLines } = useShell();
  const isPhone = useIsPhone();
  const containerRef = useRef<HTMLDivElement>(null);
  const [stationMap, setStationMap] = useState<StationMap | null>(null);
  const [opening] = useState(() => openingSetup(selectedSlug !== null));

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

  // Fly once per selection, including a deep link once the list has loaded; a list refresh that
  // hands back the same station does not move the camera.
  const flownTo = useRef<string | null>(null);
  useEffect(() => {
    if (!stationMap) return;
    if (!drawerOpen) {
      flownTo.current = null;
      stationMap.releasePadding();
      return;
    }
    if (!selected || flownTo.current === selected.id) return;
    flownTo.current = selected.id;
    stationMap.focus([selected.longitude, selected.latitude], drawerBesideMap());
  }, [stationMap, selected, drawerOpen]);

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
      </Map>
    </div>
  );
}
