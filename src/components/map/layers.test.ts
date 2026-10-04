import { readFileSync } from "node:fs";
import type { FeatureCollection, LineString } from "geojson";
import type { LayerSpecification } from "mapbox-gl";
import { expression, featureFilter, latest, validate } from "mapbox-gl/dist/style-spec/index.es.js";
import postcss from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GHOST_SCALE } from "@/components/marks/PresenceMark";
import { ALL_LINES_ON } from "@/components/shell/model";
import { explodeAndStitchSegments } from "@/lib/cta/explodeAndStitchSegments";
import { CTA_LINE_ORDER, tierStyle, type CTALine } from "@/lib/utils";
import type { ScoreTierName, StationListItem } from "@/types/station";
import {
  DIMMED,
  INTERACTIVE_LAYERS,
  LAYER,
  MAP_PALETTE,
  SOURCE,
  TRACK_RENDER_ORDER,
  baseStyleAdjustments,
  drawerPadding,
  nearestStation,
  stationFeatures,
  stationLayers,
  trackLayers,
  trackOpacity,
  type StationFeatureProperties,
} from "./layers";
import { BASE_STYLE_LAYERS } from "./fakeMap";
import { GHOST_BOX, GHOST_REACH, MARK_IMAGE, STROKE_RATIO, ghostGeometry } from "./marks";

type TrackProperties = { segment_id: string; corridor: string; is_loop: boolean; lines: string[] };

const TRACKS = JSON.parse(
  readFileSync(new URL("../../../public/data/cta/chicago_track_segments.geojson", import.meta.url), "utf8"),
) as FeatureCollection<LineString, TrackProperties>;

afterEach(() => {
  vi.restoreAllMocks();
});

function station(overrides: Partial<StationListItem> & Pick<StationListItem, "id">): StationListItem {
  return {
    slug: `${overrides.id}-slug`,
    displayName: overrides.id,
    name: overrides.id,
    lines: ["Green"],
    status: "ACTIVE",
    closedAt: null,
    latitude: 41.88,
    longitude: -87.63,
    tier: "healthy",
    rank: 100,
    rankedCount: 143,
    avg12m: 2000,
    avg30d: 2100,
    dataStatus: "available",
    sparkline: null,
    badge: null,
    ...overrides,
  };
}

const TIERS: ScoreTierName[] = ["ghost", "fading", "quiet", "healthy"];

const STATIONS: StationListItem[] = [
  ...TIERS.map((tier, i) => station({ id: tier, tier, rank: i + 1 })),
  station({
    id: "state-lake",
    slug: "state-lake",
    displayName: "State/Lake",
    status: "CLOSED",
    closedAt: "2026-01-12",
    tier: null,
    rank: null,
    lines: ["Brown", "Green", "Orange", "Purple", "Pink"],
  }),
  station({ id: "quiet-no-data", status: "ACTIVE", tier: null, rank: null, dataStatus: "missing" }),
];

function featureOf(id: string, activeLines = ALL_LINES_ON): StationFeatureProperties {
  const found = stationFeatures(STATIONS, activeLines).features.find((f) => f.properties.id === id);
  if (!found) throw new Error(`no feature ${id}`);
  return found.properties;
}

type ThemeName = keyof typeof MAP_PALETTE;

const LAYERS: Record<ThemeName, LayerSpecification[]> = {
  dark: stationLayers(MAP_PALETTE.dark),
  light: stationLayers(MAP_PALETTE.light),
};
const layerById = (id: string, theme: ThemeName = "dark"): LayerSpecification => {
  const layer = LAYERS[theme].find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id}`);
  return layer;
};

/** Evaluates a layer property the way mapbox-gl would for one feature, its state, and a zoom. */
function evaluate(
  layerId: string,
  group: "paint" | "layout",
  name: string,
  properties: StationFeatureProperties,
  state: Record<string, boolean> = {},
  zoom = 14,
  theme: ThemeName = "dark",
): unknown {
  const layer = layerById(layerId, theme);
  const value = (layer[group as keyof LayerSpecification] as Record<string, unknown> | undefined)?.[name];
  if (!Array.isArray(value)) return value;
  const parsed = expression.createPropertyExpression(value, latest[`${group}_${layer.type}`][name]);
  if (parsed.result !== "success") throw new Error(parsed.value.map((e) => e.message).join("; "));
  return parsed.value.evaluate({ zoom }, { type: 1, properties }, state);
}

function passesFilter(layerId: string, properties: StationFeatureProperties, zoom = 14): boolean {
  const layer = layerById(layerId);
  if (!("filter" in layer) || !layer.filter) return true;
  return featureFilter(layer.filter).filter({ zoom }, { type: 1, properties });
}

/**
 * The ink a reader sees for a mark: the circle's fill and ring, the dotted or barred image, and
 * the ghost glyph's body, outline, and inverted (selected) image.
 */
function visibleInk(properties: StationFeatureProperties, state: Record<string, boolean> = {}, theme: ThemeName = "dark") {
  const icon = (layerId: string) =>
    passesFilter(layerId, properties) ? evaluate(layerId, "paint", "icon-opacity", properties, state, 14, theme) : null;
  const isGhost = passesFilter(LAYER.ghostBody, properties);
  return {
    fill: evaluate(LAYER.dots, "paint", "circle-opacity", properties, state, 14, theme),
    ring: evaluate(LAYER.dots, "paint", "circle-stroke-opacity", properties, state, 14, theme),
    icon: icon(LAYER.marks),
    ghost: isGhost
      ? { body: icon(LAYER.ghostBody), line: icon(LAYER.ghostLine), selected: icon(LAYER.ghostSelected) }
      : null,
  };
}

const rgba = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},1)`;
};

describe("the map palette", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const token = (theme: "dark" | "light", name: string) => {
    let value = "";
    postcss.parse(css).walkRules((rule) => {
      if (!rule.selectors.includes(`[data-theme="${theme}"]`)) return;
      rule.walkDecls(name, (decl) => {
        value = decl.value.replace(/\/\*.*\*\//, "").trim();
      });
    });
    return value;
  };
  const hexToChannels = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  };

  it.each(["dark", "light"] as const)("matches the %s theme's ink, surface, and ink-3 tokens", (theme) => {
    expect(hexToChannels(MAP_PALETTE[theme].ink)).toBe(token(theme, "--ink"));
    expect(hexToChannels(MAP_PALETTE[theme].surface)).toBe(token(theme, "--surface"));
    // The ghost glyph's outline, as PresenceMark's GHOST_INK draws it.
    expect(MAP_PALETTE[theme].ghostInk).toBe(Number(token(theme, "--ink-3-alpha")));
  });
});

describe("station features", () => {
  it("take each tier's ink from tierStyle, and draw the ghost tier as a ghost", () => {
    for (const tier of TIERS) {
      const { mark, ink } = featureOf(tier);
      expect(ink).toBe(tierStyle(tier).ink);
      expect(mark).toBe(tier === "ghost" ? "ghost" : tierStyle(tier).mark);
    }
  });

  it("give a closed station the closed mark at 52% and no label", () => {
    expect(featureOf("state-lake")).toMatchObject({ mark: "closed", ink: 0.52, labeled: false, slug: "state-lake" });
  });

  it("give an unranked open station the no-data mark at 44% and no label", () => {
    expect(featureOf("quiet-no-data")).toMatchObject({ mark: "no-data", ink: 0.44, labeled: false });
  });

  it("label every ranked station", () => {
    for (const tier of TIERS) expect(featureOf(tier).labeled).toBe(true);
  });

  it("dim a station whose lines are all filtered out, and treat all-off as all-on", () => {
    const greenOff = { ...ALL_LINES_ON, Green: false };
    expect(featureOf("ghost", greenOff).dimmed).toBe(true);
    expect(featureOf("state-lake", greenOff).dimmed).toBe(false);
    const allOff = Object.fromEntries(CTA_LINE_ORDER.map((line) => [line, false])) as Record<CTALine, boolean>;
    expect(featureOf("ghost", allOff).dimmed).toBe(false);
  });

  it("skip a station without coordinates rather than placing it at 0, 0", () => {
    const features = stationFeatures([station({ id: "nowhere", latitude: Number.NaN })], ALL_LINES_ON);
    expect(features.features).toHaveLength(0);
  });
});

describe("station layer paint", () => {
  it("maps each ring tier to its ink: healthy and quiet 100%, fading 72%", () => {
    expect(visibleInk(featureOf("healthy"))).toEqual({ fill: 1, ring: 1, icon: null, ghost: null });
    expect(evaluate(LAYER.dots, "paint", "circle-color", featureOf("healthy"))?.toString()).toBe(rgba(MAP_PALETTE.dark.ink));

    // Hollow: a surface hole inside a ring at the tier's ink.
    expect(visibleInk(featureOf("quiet"))).toEqual({ fill: 1, ring: 1, icon: null, ghost: null });
    expect(evaluate(LAYER.dots, "paint", "circle-color", featureOf("quiet"))?.toString()).toBe(rgba(MAP_PALETTE.dark.surface));
    expect(visibleInk(featureOf("fading"))).toEqual({ fill: 1, ring: 0.72, icon: null, ghost: null });

    for (const tier of ["healthy", "quiet", "fading"] as const) {
      const ink = visibleInk(featureOf(tier));
      expect(tierStyle(tier).mark === "solid" ? ink.fill : ink.ring).toBe(tierStyle(tier).ink);
    }
  });

  it("draws the ghost tier as the ghost glyph: an opaque surface body and an outline at the theme's ink-3", () => {
    const ghost = featureOf("ghost");
    for (const theme of ["dark", "light"] as const) {
      expect(visibleInk(ghost, {}, theme)).toEqual({
        // The circle draws nothing, so no disc peeks out beside the glyph.
        fill: 0,
        ring: 0,
        icon: null,
        ghost: { body: 1, line: MAP_PALETTE[theme].ghostInk, selected: 0 },
      });
    }
    expect(evaluate(LAYER.ghostBody, "layout", "icon-image", ghost)?.toString()).toBe(MARK_IMAGE.ghostBody);
    expect(evaluate(LAYER.ghostLine, "layout", "icon-image", ghost)?.toString()).toBe(MARK_IMAGE.ghostLine);
    expect(evaluate(LAYER.ghostSelected, "layout", "icon-image", ghost)?.toString()).toBe(MARK_IMAGE.ghostSelected);
  });

  it("gives the ghost glyph only to the ghost tier", () => {
    for (const id of ["fading", "quiet", "healthy", "state-lake", "quiet-no-data"]) {
      for (const layer of [LAYER.ghostBody, LAYER.ghostLine, LAYER.ghostSelected, LAYER.ghostRing]) {
        expect(passesFilter(layer, featureOf(id))).toBe(false);
      }
    }
    expect(passesFilter(LAYER.marks, featureOf("ghost"))).toBe(false);
    expect(passesFilter(LAYER.ring, featureOf("ghost"))).toBe(false);
  });

  it("sizes the ghost's box at GHOST_SCALE times a ring mark's outer diameter, at every zoom", () => {
    const ghost = featureOf("ghost");
    for (const zoom of [9, 10.4, 12, 13.5, 15, 17]) {
      const radius = Number(evaluate(LAYER.dots, "paint", "circle-radius", ghost, {}, zoom));
      const stroke = Number(evaluate(LAYER.dots, "paint", "circle-stroke-width", ghost, {}, zoom));
      const iconSize = Number(evaluate(LAYER.ghostLine, "layout", "icon-size", ghost, {}, zoom));
      expect(stroke).toBeCloseTo(radius * STROKE_RATIO);
      expect(iconSize * ghostGeometry().box).toBeCloseTo(GHOST_SCALE * 2 * (radius + stroke));
      // The selection ring clears the glyph's hem corners.
      const ringRadius = Number(evaluate(LAYER.ghostRing, "paint", "circle-radius", ghost, {}, zoom));
      expect(ringRadius).toBeCloseTo(iconSize * ghostGeometry().unit * GHOST_REACH);
      expect(ringRadius).toBeGreaterThan((iconSize * ghostGeometry().box) / 2);
    }
    expect(GHOST_BOX).toBe(24);
  });

  it("draws the closed mark as a 52% ring with the bar, and the no-data mark as a 44% dotted ring", () => {
    expect(visibleInk(featureOf("state-lake"))).toEqual({ fill: 1, ring: 0.52, icon: 0.52, ghost: null });
    expect(evaluate(LAYER.marks, "layout", "icon-image", featureOf("state-lake"))?.toString()).toBe(MARK_IMAGE.bar);
    expect(visibleInk(featureOf("quiet-no-data"))).toEqual({ fill: 1, ring: 0, icon: 0.44, ghost: null });
    expect(evaluate(LAYER.marks, "layout", "icon-image", featureOf("quiet-no-data"))?.toString()).toBe(MARK_IMAGE.dotted);
  });

  it("takes pointer events on every mark, closed and no-data included", () => {
    expect(INTERACTIVE_LAYERS).toEqual([LAYER.hit]);
    for (const id of ["state-lake", "quiet-no-data", "ghost", "healthy"]) {
      expect(passesFilter(LAYER.hit, featureOf(id), 10)).toBe(true);
    }
    expect(Number(evaluate(LAYER.hit, "paint", "circle-radius", featureOf("state-lake"), {}, 10))).toBeGreaterThan(
      Number(evaluate(LAYER.dots, "paint", "circle-radius", featureOf("state-lake"), {}, 10)),
    );
  });

  it("never labels a closed or no-data mark, at any zoom or state", () => {
    for (const id of ["state-lake", "quiet-no-data"]) {
      expect(passesFilter(LAYER.labels, featureOf(id), 16)).toBe(false);
      expect(passesFilter(LAYER.focusLabel, featureOf(id), 16)).toBe(false);
    }
    expect(passesFilter(LAYER.labels, featureOf("ghost"))).toBe(true);
  });

  it("dims a filtered-out station's mark and label without hiding them", () => {
    const greenOff = { ...ALL_LINES_ON, Green: false };
    expect(visibleInk(featureOf("fading", greenOff)).ring).toBeCloseTo(0.72 * DIMMED.mark);
    expect(visibleInk(featureOf("ghost", greenOff)).ghost?.line).toBeCloseTo(MAP_PALETTE.dark.ghostInk * DIMMED.mark);
    // Like a ring's hole, the ghost's body stays opaque.
    expect(visibleInk(featureOf("ghost", greenOff)).ghost?.body).toBe(1);
    expect(evaluate(LAYER.labels, "paint", "text-opacity", featureOf("ghost", greenOff))).toBe(DIMMED.label);
  });

  it("inverts the selected mark and rings it at 2px", () => {
    const selected = { selected: true };
    const fading = featureOf("fading");
    expect(visibleInk(fading, selected)).toEqual({ fill: 1, ring: 1, icon: null, ghost: null });
    expect(evaluate(LAYER.dots, "paint", "circle-color", fading, selected)?.toString()).toBe(rgba(MAP_PALETTE.dark.ink));
    expect(evaluate(LAYER.dots, "paint", "circle-stroke-color", fading, selected)?.toString()).toBe(
      rgba(MAP_PALETTE.dark.surface),
    );
    expect(evaluate(LAYER.ring, "paint", "circle-stroke-width", fading, selected)).toBe(2);
    expect(evaluate(LAYER.ring, "paint", "circle-stroke-opacity", fading, selected)).toBe(1);
    expect(evaluate(LAYER.ring, "paint", "circle-stroke-opacity", fading)).toBe(0);

    // The closed mark's bar steps aside for the inverted dot too.
    expect(visibleInk(featureOf("state-lake"), selected).icon).toBe(0);
  });

  it("inverts a selected ghost (ink body, surface outline) and rings it at 2px", () => {
    const selected = { selected: true };
    const ghost = featureOf("ghost");
    expect(visibleInk(ghost, selected)).toEqual({ fill: 0, ring: 0, icon: null, ghost: { body: 0, line: 0, selected: 1 } });
    expect(evaluate(LAYER.ghostRing, "paint", "circle-stroke-width", ghost, selected)).toBe(2);
    expect(evaluate(LAYER.ghostRing, "paint", "circle-stroke-opacity", ghost, selected)).toBe(1);
    expect(evaluate(LAYER.ghostRing, "paint", "circle-stroke-opacity", ghost, { hover: true })).toBe(0.6);
    expect(evaluate(LAYER.ghostRing, "paint", "circle-stroke-opacity", ghost)).toBe(0);
  });

  it("shows the hovered or selected name at any zoom through the focus layer, and only there", () => {
    const ghost = featureOf("ghost");
    expect(layerById(LAYER.labels).minzoom).toBe(12.5);
    expect(layerById(LAYER.focusLabel).minzoom).toBeUndefined();
    expect(evaluate(LAYER.focusLabel, "paint", "text-opacity", ghost, { hover: true }, 10)).toBe(1);
    expect(evaluate(LAYER.focusLabel, "paint", "text-opacity", ghost, { selected: true }, 10)).toBe(1);
    expect(evaluate(LAYER.focusLabel, "paint", "text-opacity", ghost, {}, 10)).toBe(0);
    expect(evaluate(LAYER.labels, "paint", "text-opacity", ghost, { hover: true })).toBe(0);
    expect(evaluate(LAYER.labels, "paint", "text-opacity", ghost)).toBe(1);
  });

  it("sizes marks by zoom only", () => {
    const small = evaluate(LAYER.dots, "paint", "circle-radius", featureOf("ghost"), {}, 10);
    const large = evaluate(LAYER.dots, "paint", "circle-radius", featureOf("healthy"), {}, 15);
    expect(evaluate(LAYER.dots, "paint", "circle-radius", featureOf("healthy"), {}, 10)).toBe(small);
    expect(Number(large)).toBeGreaterThan(Number(small));
  });

  it("is a valid Mapbox style in both themes", () => {
    for (const palette of Object.values(MAP_PALETTE)) {
      const style = {
        version: 8,
        glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
        sources: {
          [SOURCE.tracks]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          [SOURCE.stations]: { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" },
        },
        layers: [...trackLayers(palette), ...stationLayers(palette)],
      };
      expect(validate(style).map((error) => error.message)).toEqual([]);
    }
  });
});

describe("tracks", () => {
  it("recompute without writing to the console", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    explodeAndStitchSegments(TRACKS, ALL_LINES_ON, 5.0, 3.0, true);
    explodeAndStitchSegments(TRACKS, ALL_LINES_ON, 5.0, 3.0, true);

    expect(log).not.toHaveBeenCalled();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("keep every line's geometry when exploded with all lines on, so a filter can dim them", () => {
    const lines = new Set(explodeAndStitchSegments(TRACKS, ALL_LINES_ON).features.map((f) => f.properties.line));
    expect([...lines].sort()).toEqual([...CTA_LINE_ORDER].sort());
  });

  it("draw one casing and one core layer per line, Red on top", () => {
    const layers = trackLayers(MAP_PALETTE.light);
    expect(layers).toHaveLength(CTA_LINE_ORDER.length * 2);
    expect(layers.at(-1)?.id).toBe("track-Red");
    expect(TRACK_RENDER_ORDER).toHaveLength(8);
  });

  it("dim filtered-out lines, and read all-off as all-on", () => {
    const redOnly = Object.fromEntries(CTA_LINE_ORDER.map((line) => [line, line === "Red"])) as Record<CTALine, boolean>;
    expect(trackOpacity("Red", redOnly)).toBe(1);
    expect(trackOpacity("Blue", redOnly)).toBe(DIMMED.track);
    const allOff = Object.fromEntries(CTA_LINE_ORDER.map((line) => [line, false])) as Record<CTALine, boolean>;
    expect(trackOpacity("Blue", allOff)).toBe(1);
  });
});

describe("drawerPadding", () => {
  it("clamps the drawer's 440px to half the canvas", () => {
    expect(drawerPadding(1280, true)).toBe(440);
    expect(drawerPadding(768, true)).toBe(384);
    expect(drawerPadding(880, true)).toBe(440);
  });

  it("is zero on a phone, where the drawer is the page below the map", () => {
    expect(drawerPadding(375, false)).toBe(0);
  });

  it("is zero before the canvas has a size", () => {
    expect(drawerPadding(0, true)).toBe(0);
  });
});

describe("baseStyleAdjustments", () => {
  it("hides POI, transit, and road labels and Mapbox's rail lines, and quiets neighborhood names", () => {
    const { hide, subdue } = baseStyleAdjustments(BASE_STYLE_LAYERS);
    expect(hide.sort()).toEqual(["airport-label", "poi-label", "road-label-simple", "road-rail", "transit-label"]);
    expect(subdue).toEqual(["settlement-subdivision-label"]);
  });

  it("leaves the station map's own layers alone", () => {
    const own = [...trackLayers(MAP_PALETTE.dark), ...stationLayers(MAP_PALETTE.dark)];
    expect(baseStyleAdjustments(own)).toEqual({ hide: [], subdue: [] });
  });
});

describe("nearestStation", () => {
  const point = (lng: number, lat: number, properties: Record<string, unknown>) => ({
    properties,
    geometry: { type: "Point" as const, coordinates: [lng, lat] },
  });
  // A flat projection: one degree is 1000px.
  const project = ([lng, lat]: [number, number]) => ({ x: lng * 1000, y: -lat * 1000 });

  it("takes the station nearest the pointer among overlapping hit circles", () => {
    const hit = nearestStation(
      [point(1, 1, { id: "far", slug: "far" }), point(1.002, 1, { id: "near", slug: "near" })],
      { x: 1003, y: -1000 },
      project,
    );
    expect(hit).toEqual({ id: "near", slug: "near" });
  });

  it("returns a closed station's slug like any other", () => {
    expect(nearestStation([point(0, 0, { id: "state-lake-id", slug: "state-lake" })], { x: 0, y: 0 }, project)).toEqual({
      id: "state-lake-id",
      slug: "state-lake",
    });
  });

  it("returns null over empty map and a null slug when the station has none", () => {
    expect(nearestStation([], { x: 0, y: 0 }, project)).toBeNull();
    expect(nearestStation(undefined, { x: 0, y: 0 }, project)).toBeNull();
    expect(nearestStation([point(0, 0, { id: "x" })], { x: 0, y: 0 }, project)).toEqual({ id: "x", slug: null });
  });
});
