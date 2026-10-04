import type { FeatureCollection, Geometry, Point } from "geojson";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "mapbox-gl";
import { noLineActive, passesLineFilter } from "@/components/shell/model";
import type { ActiveLines } from "@/components/shell/ShellContext";
import type { Theme } from "@/components/theme";
import { CTA_LINE_ORDER, ctaLineColors, tierStyle, type CTALine, type TierMark } from "@/lib/utils";
import type { StationListItem } from "@/types/station";
import { IMAGE_RADIUS, MARK_IMAGE, STROKE_RATIO, radiusStops } from "./marks";

/**
 * The map's layers as data (U19, KTD13): what each station feature carries, and the paint and
 * layout that turn it into a mark. Nothing here touches a map, so every rule is testable. The
 * vocabulary is PresenceMark's (R23): ink presence and mark shape, never a hue; hue is the eight
 * line colors on the tracks.
 */

// ═══════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════

export interface MapPalette {
  /** Text and marks: the theme's --ink. */
  ink: string;
  /** Hollow mark interiors, label halos, and track casings: the theme's --surface. */
  surface: string;
}

/** The two themes' --ink and --surface from src/app/globals.css; layers.test.ts holds them equal. */
export const MAP_PALETTE: Readonly<Record<Theme, MapPalette>> = {
  dark: { ink: "#F2F1EC", surface: "#141518" },
  light: { ink: "#141518", surface: "#F4F3EE" },
};

/** Mapbox's monochrome base styles; their POI, transit, and road labels are hidden on load. */
export const MAP_STYLE: Readonly<Record<Theme, string>> = {
  dark: "mapbox://styles/mapbox/dark-v11",
  light: "mapbox://styles/mapbox/light-v11",
};

/** Every station on the network, for the opening view: O'Hare to the lake, 95th to Linden. */
export const SYSTEM_BOUNDS: [[number, number], [number, number]] = [
  [-87.905, 41.722],
  [-87.605, 42.074],
];

// ═══════════════════════════════════════════════════════════════
// STATION FEATURES
// ═══════════════════════════════════════════════════════════════

/** A station's mark: a tier's, or one of the two marks for stations outside the ranking (R24). */
export type StationMark = TierMark | "closed" | "no-data";

/** PresenceMark's ink for the two marks outside the ranking: closed 52%, no data 44%. */
export const EXCLUDED_INK: Readonly<Record<"closed" | "no-data", number>> = { closed: 0.52, "no-data": 0.44 };

/** What a station or track keeps while the line filter leaves out every one of its lines. */
export const DIMMED = { mark: 0.3, label: 0.4, track: 0.2 } as const;

export interface StationFeatureProperties {
  /** The station id, promoted to the feature id so feature state (selected, hover) can find it. */
  id: string;
  slug: string | null;
  name: string;
  mark: StationMark;
  /** The mark's ink presence, 0 to 1. */
  ink: number;
  /** Ranked stations carry a name label; closed and no-data marks never do (AE2). */
  labeled: boolean;
  /** Every line the station serves is filtered out: drawn faint, never removed. */
  dimmed: boolean;
  /** Label priority: the most ghost-like stations keep their names when labels collide. */
  rank: number | null;
}

/**
 * A station's mark and ink. Ranked stations take their tier's from `tierStyle`, the one owner of
 * the tier-to-ink mapping (R17); a station outside the ranking is closed when its status says so
 * and otherwise has no recent data.
 */
export function stationMark(station: Pick<StationListItem, "tier" | "rank" | "status">): {
  mark: StationMark;
  ink: number;
} {
  if (station.rank === null || station.tier === null) {
    const mark = station.status === "ACTIVE" ? "no-data" : "closed";
    return { mark, ink: EXCLUDED_INK[mark] };
  }
  const { mark, ink } = tierStyle(station.tier);
  return { mark, ink };
}

/** Every station as a point feature, for the stations source. */
export function stationFeatures(
  stations: readonly StationListItem[],
  activeLines: ActiveLines,
): FeatureCollection<Point, StationFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: stations
      .filter((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude))
      .map((station) => {
        const { mark, ink } = stationMark(station);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [station.longitude, station.latitude] },
          properties: {
            id: station.id,
            slug: station.slug,
            name: station.displayName,
            mark,
            ink,
            labeled: mark !== "closed" && mark !== "no-data",
            dimmed: !passesLineFilter(station.lines, activeLines),
            rank: station.rank,
          },
        };
      }),
  };
}

/** Nothing to draw yet: the sources start with this until the station list and tracks load. */
export const EMPTY_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

// ═══════════════════════════════════════════════════════════════
// LAYERS
// ═══════════════════════════════════════════════════════════════

export const SOURCE = { tracks: "cta-tracks", stations: "stations" } as const;

export const LAYER = {
  /** A transparent, wider circle under each mark: the click and hover target. */
  hit: "station-hit",
  /** Solid and hollow marks, and the selected mark's inverted dot. */
  dots: "station-dots",
  /** The dashed, dotted, and barred marks a circle cannot draw (marks.ts). */
  marks: "station-marks",
  /** The 2px selection ring, and a fainter one on hover. */
  ring: "station-ring",
  /** Names from zoom 12.5, collision-managed. */
  labels: "station-labels",
  /** The hovered or selected station's name at any zoom. */
  focusLabel: "station-focus-label",
} as const;

/** The layers pointer events query. */
export const INTERACTIVE_LAYERS: string[] = [LAYER.hit];

/** Station names appear from this zoom; below it only the hovered or selected one shows. */
export const LABEL_MIN_ZOOM = 12.5;

export const trackLayerId = (line: CTALine) => `track-${line}`;
export const trackCasingId = (line: CTALine) => `track-casing-${line}`;

/** Red draws last, on top, where it shares the North Side main with Brown and Purple. */
export const TRACK_RENDER_ORDER: readonly CTALine[] = [...CTA_LINE_ORDER.filter((line) => line !== "Red"), "Red"];

const TRACK_CASING_OPACITY = 0.85;

/** Paint changes apply at once; the only animated paint is the selection ring (StationMap). */
const INSTANT = { duration: 0, delay: 0 };

const SELECTED: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
const HOVERED: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
const FOCUSED: ExpressionSpecification = ["any", SELECTED, HOVERED];
const IS_DIMMED: ExpressionSpecification = ["boolean", ["get", "dimmed"], false];
const MARK: ExpressionSpecification = ["get", "mark"];
const LABELED: ExpressionSpecification = ["==", ["get", "labeled"], true];
const IS_LOOP: ExpressionSpecification = ["boolean", ["get", "is_loop"], false];

/** The mark's ink: its tier's presence, less while the filter leaves out all its lines. */
const INK: ExpressionSpecification = ["*", ["number", ["get", "ink"], 1], ["case", IS_DIMMED, DIMMED.mark, 1]];

function byZoom(stops: unknown[]): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], ...stops];
}

/** The selection ring's radius: just outside the mark, times `scale` while it scales in. */
export function ringRadius(scale = 1): ExpressionSpecification {
  return byZoom(radiusStops((1 + STROKE_RATIO) * scale));
}

const LABEL_FONT = ["DIN Pro Medium", "Arial Unicode MS Regular"];

const LABEL_LAYOUT: SymbolLayerSpecification["layout"] = {
  "text-field": ["get", "name"],
  "text-font": LABEL_FONT,
  "text-size": byZoom([LABEL_MIN_ZOOM, 12, 17, 14]),
  "text-anchor": "left",
  "text-justify": "left",
  "text-offset": byZoom([12, ["literal", [0.75, 0]], 17, ["literal", [1, 0]]]),
  "text-max-width": 8,
  "symbol-sort-key": ["coalesce", ["get", "rank"], 9999],
};

/** The CTA tracks, one casing and one core layer per line, in the official colors (R23). */
export function trackLayers(palette: MapPalette): LineLayerSpecification[] {
  const width = (add: number): ExpressionSpecification =>
    byZoom([
      10,
      ["case", IS_LOOP, 1.4 + add, 1.8 + add],
      12,
      ["case", IS_LOOP, 2 + add, 2.6 + add],
      14,
      ["case", IS_LOOP, 3 + add, 3.8 + add],
    ]);
  const base = (line: CTALine): Pick<LineLayerSpecification, "type" | "source" | "filter" | "layout"> => ({
    type: "line",
    source: SOURCE.tracks,
    filter: ["==", ["get", "line"], line],
    layout: { "line-cap": "round", "line-join": "round" },
  });

  const casings = TRACK_RENDER_ORDER.map(
    (line): LineLayerSpecification => ({
      ...base(line),
      id: trackCasingId(line),
      paint: {
        "line-color": palette.surface,
        "line-width": width(2),
        "line-offset": ["get", "offset_px"],
        "line-opacity": TRACK_CASING_OPACITY,
        "line-opacity-transition": INSTANT,
      },
    }),
  );
  const cores = TRACK_RENDER_ORDER.map(
    (line): LineLayerSpecification => ({
      ...base(line),
      id: trackLayerId(line),
      paint: {
        "line-color": ctaLineColors[line],
        "line-width": width(0),
        "line-offset": ["get", "offset_px"],
        "line-opacity": 1,
        "line-opacity-transition": INSTANT,
      },
    }),
  );
  return [...casings, ...cores];
}

/** A line's track opacity under the filter: faint when filtered out, and all-off reads as all-on. */
export function trackOpacity(line: CTALine, activeLines: ActiveLines): number {
  return noLineActive(activeLines) || activeLines[line] ? 1 : DIMMED.track;
}

export function trackCasingOpacity(line: CTALine, activeLines: ActiveLines): number {
  return TRACK_CASING_OPACITY * trackOpacity(line, activeLines);
}

/**
 * The station layers, bottom to top. Radius follows zoom only. Paint reads the feature's mark and
 * ink, the `dimmed` flag, and the `selected` and `hover` feature state:
 *
 * - healthy: a solid ink dot; quiet and fading: a hollow ring at their ink over a surface hole.
 * - ghost and no data: the hole only, with the dashed or dotted ring drawn by the marks layer.
 * - closed: a ring at 52% with the bar from the marks layer, and no label.
 * - selected: inverted, a full-ink dot with a surface gap, then a 2px ink ring.
 */
export function stationLayers(palette: MapPalette): LayerSpecification[] {
  const { ink, surface } = palette;
  const radius = byZoom(radiusStops());
  const stroke = byZoom(radiusStops(STROKE_RATIO));

  const hit: CircleLayerSpecification = {
    id: LAYER.hit,
    type: "circle",
    source: SOURCE.stations,
    paint: {
      "circle-radius": byZoom([9, 8, 13, 12, 17, 14]),
      "circle-color": ink,
      "circle-opacity": 0,
      "circle-stroke-width": 0,
    },
  };

  const dots: CircleLayerSpecification = {
    id: LAYER.dots,
    type: "circle",
    source: SOURCE.stations,
    paint: {
      "circle-radius": radius,
      "circle-color": ["case", SELECTED, ink, ["==", MARK, "solid"], ink, surface],
      "circle-opacity": ["case", SELECTED, 1, ["==", MARK, "solid"], INK, 1],
      "circle-stroke-width": stroke,
      "circle-stroke-color": ["case", SELECTED, surface, ink],
      "circle-stroke-opacity": ["case", SELECTED, 1, ["match", MARK, ["hollow-dashed", "no-data"], 0, INK]],
    },
  };

  const marks: SymbolLayerSpecification = {
    id: LAYER.marks,
    type: "symbol",
    source: SOURCE.stations,
    filter: ["match", MARK, ["hollow-dashed", "no-data", "closed"], true, false],
    layout: {
      "icon-image": ["match", MARK, "hollow-dashed", MARK_IMAGE.dashed, "no-data", MARK_IMAGE.dotted, MARK_IMAGE.bar],
      "icon-size": byZoom(radiusStops(1 / IMAGE_RADIUS)),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotation-alignment": "viewport",
      "icon-pitch-alignment": "viewport",
    },
    paint: {
      "icon-opacity": ["case", SELECTED, 0, INK],
    },
  };

  const ring: CircleLayerSpecification = {
    id: LAYER.ring,
    type: "circle",
    source: SOURCE.stations,
    paint: {
      "circle-radius": ringRadius(1),
      "circle-radius-transition": INSTANT,
      "circle-color": ink,
      "circle-opacity": 0,
      "circle-stroke-width": ["case", SELECTED, 2, 1],
      "circle-stroke-color": ink,
      "circle-stroke-opacity": ["case", SELECTED, 1, HOVERED, 0.6, 0],
    },
  };

  const labelPaint = {
    "text-color": ink,
    "text-halo-color": surface,
    "text-halo-width": 1.5,
  };

  const labels: SymbolLayerSpecification = {
    id: LAYER.labels,
    type: "symbol",
    source: SOURCE.stations,
    minzoom: LABEL_MIN_ZOOM,
    filter: LABELED,
    layout: LABEL_LAYOUT,
    paint: {
      ...labelPaint,
      // The focus layer draws the hovered or selected name, so this one steps aside for it.
      "text-opacity": ["case", FOCUSED, 0, IS_DIMMED, DIMMED.label, 1],
    },
  };

  const focusLabel: SymbolLayerSpecification = {
    id: LAYER.focusLabel,
    type: "symbol",
    source: SOURCE.stations,
    filter: LABELED,
    layout: { ...LABEL_LAYOUT, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { ...labelPaint, "text-opacity": ["case", FOCUSED, 1, 0] },
  };

  return [hit, dots, marks, ring, labels, focusLabel];
}

// ═══════════════════════════════════════════════════════════════
// BASE STYLE
// ═══════════════════════════════════════════════════════════════

export interface BaseLayer {
  id: string;
  type: string;
  metadata?: unknown;
}

const HIDDEN_SYMBOLS = /poi|transit|airport|road|ferry|rail|shield|exit|aerialway|path|golf|building|housenum/;
const HIDDEN_COMPONENTS = new Set(["point-of-interest-labels", "transit", "road-network", "walking-cycling", "buildings"]);
const HIDDEN_LINES = /rail|transit|aerialway|ferry/;
const SUBDUED_SYMBOLS = /settlement-subdivision|neighborhood/;
const OWN_LAYER = /^(track|station)-/;

/** Neighborhood names stay as context, quieter than the station names. */
export const SUBDUED_LABEL_OPACITY = 0.6;

function featureComponent(layer: BaseLayer): string | null {
  const metadata = layer.metadata as Record<string, unknown> | undefined;
  const component = metadata?.["mapbox:featureComponent"];
  return typeof component === "string" ? component : null;
}

/**
 * The base style's layers to hide (POI, transit, and road labels, and Mapbox's own rail lines,
 * which would compete with the CTA tracks) and the place labels to quiet. Matched by id and by
 * Mapbox's feature component, so it holds for both the dark and the light style.
 */
export function baseStyleAdjustments(layers: readonly BaseLayer[]): { hide: string[]; subdue: string[] } {
  const hide: string[] = [];
  const subdue: string[] = [];
  for (const layer of layers) {
    if (OWN_LAYER.test(layer.id)) continue;
    const component = featureComponent(layer);
    if (layer.type === "symbol") {
      if (HIDDEN_SYMBOLS.test(layer.id) || (component !== null && HIDDEN_COMPONENTS.has(component))) {
        hide.push(layer.id);
      } else if (SUBDUED_SYMBOLS.test(layer.id)) {
        subdue.push(layer.id);
      }
    } else if (layer.type === "line" && (HIDDEN_LINES.test(layer.id) || component === "transit")) {
      hide.push(layer.id);
    }
  }
  return { hide, subdue };
}

// ═══════════════════════════════════════════════════════════════
// CAMERA AND POINTER
// ═══════════════════════════════════════════════════════════════

/** The drawer's width over the map's right edge from 768px (R20). */
export const DRAWER_WIDTH = 440;

/**
 * Right padding for a fly-to, so the station lands in the middle of the map the drawer leaves
 * visible. Clamped to half the canvas (KTD13): 440 at a 1280px canvas, 384 at 768px. A phone's
 * drawer is the page below the map, so it needs none.
 */
export function drawerPadding(canvasWidth: number, drawerBesideMap: boolean): number {
  if (!drawerBesideMap || !(canvasWidth > 0)) return 0;
  return Math.min(DRAWER_WIDTH, Math.floor(canvasWidth / 2));
}

export interface RenderedFeature {
  properties?: Record<string, unknown> | null;
  geometry?: Geometry | null;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface StationHit {
  id: string;
  slug: string | null;
}

/**
 * The station under the pointer. The hit circles are wider than the marks and overlap where
 * stations crowd (the Loop), so of everything under the pointer this takes the nearest.
 */
export function nearestStation(
  features: readonly RenderedFeature[] | undefined,
  point: ScreenPoint,
  project: (lngLat: [number, number]) => ScreenPoint,
): StationHit | null {
  let nearest: StationHit | null = null;
  let best = Infinity;
  for (const feature of features ?? []) {
    const id = feature.properties?.id;
    if (typeof id !== "string" || feature.geometry?.type !== "Point") continue;
    const [lng, lat] = feature.geometry.coordinates;
    const at = project([lng, lat]);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance < best) {
      best = distance;
      const slug = feature.properties?.slug;
      nearest = { id, slug: typeof slug === "string" && slug !== "" ? slug : null };
    }
  }
  return nearest;
}
