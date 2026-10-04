import type { FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";
import { ALL_LINES_ON } from "@/components/shell/model";
import { CTA_LINE_ORDER, type CTALine } from "@/lib/utils";
import { FakeMap } from "./fakeMap";
import {
  DIMMED,
  LAYER,
  MAP_PALETTE,
  SOURCE,
  SUBDUED_LABEL_OPACITY,
  ghostRingRadius,
  ringRadius,
  stationLayers,
  trackLayerId,
  trackLayers,
} from "./layers";
import { MARK_IMAGE } from "./marks";
import { FLY_DURATION_MS, FOCUS_ZOOM, RING_SCALE_MS, RING_START_SCALE, StationMap } from "./stationMap";

const STATIONS: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-87.648, 41.885] }, properties: { id: "halsted-id" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-87.628, 41.886] }, properties: { id: "state-lake-id" } },
  ],
};

function setup({ reducedMotion = true } = {}) {
  const map = new FakeMap();
  const stationMap = new StationMap(map, {
    palette: MAP_PALETTE.dark,
    prefersReducedMotion: () => reducedMotion,
  });
  const disconnect = stationMap.connect();
  return { map, stationMap, disconnect };
}

const ownLayerIds = () => [...trackLayers(MAP_PALETTE.dark), ...stationLayers(MAP_PALETTE.dark)].map((l) => l.id);

describe("StationMap install", () => {
  it("adds both sources, every layer in order, and the mark images", () => {
    const { map } = setup();
    expect(map.layers.map((l) => l.id)).toEqual(ownLayerIds());
    expect(map.sources.get(SOURCE.stations)?.spec).toMatchObject({ type: "geojson", promoteId: "id" });
    expect(map.sources.has(SOURCE.tracks)).toBe(true);
    expect([...map.images.keys()].sort()).toEqual(Object.values(MARK_IMAGE).sort());
    expect(map.rotationDisabled).toBe(true);
  });

  it("hides the base style's POI, transit, and road labels and quiets neighborhood names", () => {
    const { map } = setup();
    for (const id of ["poi-label", "transit-label", "road-label-simple", "road-rail", "airport-label"]) {
      expect(map.layout.get(id)).toEqual({ visibility: "none" });
    }
    expect(map.paint.get("settlement-subdivision-label")).toEqual({ "text-opacity": SUBDUED_LABEL_OPACITY });
    expect(map.layout.get("settlement-major-label")).toBeUndefined();
  });

  it("feeds data that arrives later through the sources, not by re-adding them", () => {
    const { map, stationMap } = setup();
    stationMap.setStations(STATIONS);
    expect(map.sources.get(SOURCE.stations)?.data).toBe(STATIONS);
    expect(map.layers).toHaveLength(ownLayerIds().length);
  });
});

describe("StationMap after a style swap", () => {
  it("restores the selected station's feature state", () => {
    const { map, stationMap } = setup();
    stationMap.setStations(STATIONS);
    stationMap.select("halsted-id");
    expect(map.stateOf(SOURCE.stations, "halsted-id")).toEqual({ selected: true });

    map.swapStyle();

    expect(map.stateOf(SOURCE.stations, "halsted-id")).toEqual({ selected: true });
    expect(map.sources.get(SOURCE.stations)?.data).toBe(STATIONS);
    expect(map.layers.map((l) => l.id)).toEqual(ownLayerIds());
  });

  it("restores hover too, and the line filter", () => {
    const { map, stationMap } = setup();
    stationMap.hover("state-lake-id");
    stationMap.setActiveLines({ ...ALL_LINES_ON, Blue: false });

    map.swapStyle();

    expect(map.stateOf(SOURCE.stations, "state-lake-id")).toEqual({ hover: true });
    expect(map.paintOf(trackLayerId("Blue"), "line-opacity")).toBe(DIMMED.track);
    expect(map.paintOf(trackLayerId("Red"), "line-opacity")).toBe(1);
  });

  it("draws the new theme: light ink and surface in the layers and the images", () => {
    const { map, stationMap } = setup();
    stationMap.setPalette(MAP_PALETTE.light);
    map.swapStyle();

    const labels = map.layers.find((l) => l.id === LAYER.labels);
    expect(labels?.paint).toMatchObject({ "text-color": MAP_PALETTE.light.ink, "text-halo-color": MAP_PALETTE.light.surface });
    expect(map.paintOf(LAYER.ghostLine, "icon-opacity")).toEqual(["case", expect.anything(), 0, ["*", MAP_PALETTE.light.ghostInk, expect.anything()]]);

    // The ghost images are drawn again, in the light theme's ink and surface.
    const pixels = (id: string) => map.images.get(id)?.image.data ?? new Uint8ClampedArray();
    const opaque = (data: Uint8ClampedArray) => {
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 255) return [...data.slice(i, i + 3)];
      return null;
    };
    expect(opaque(pixels(MARK_IMAGE.ghostLine))).toEqual([0x14, 0x15, 0x18]);
    expect(opaque(pixels(MARK_IMAGE.ghostBody))).toEqual([0xf4, 0xf3, 0xee]);
  });

  it("holds changes made while the new style loads and applies them when it does", () => {
    const { map, stationMap } = setup();
    map.swapStyle({ load: false });

    // Nothing of ours is on the loading style; none of this may touch it.
    expect(() => {
      stationMap.setStations(STATIONS);
      stationMap.select("halsted-id");
      stationMap.hover("halsted-id");
      stationMap.setActiveLines({ ...ALL_LINES_ON, Red: false });
    }).not.toThrow();

    map.fire("style.load");
    expect(map.sources.get(SOURCE.stations)?.data).toBe(STATIONS);
    expect(map.stateOf(SOURCE.stations, "halsted-id")).toEqual({ selected: true, hover: true });
    expect(map.paintOf(trackLayerId("Red"), "line-opacity")).toBe(DIMMED.track);
  });

  it("stops rebuilding once disconnected, and reconnects without doubling up", () => {
    const { map, stationMap, disconnect } = setup();
    disconnect();
    expect(map.listenerCount("style.load")).toBe(0);

    stationMap.connect();
    stationMap.connect();
    expect(map.listenerCount("style.load")).toBe(1);
  });
});

describe("StationMap selection and hover", () => {
  it("moves the selected state from the old station to the new one, and clears it on close", () => {
    const { map, stationMap } = setup();
    stationMap.select("halsted-id");
    stationMap.select("state-lake-id");
    expect(map.stateOf(SOURCE.stations, "halsted-id")).toEqual({ selected: false });
    expect(map.stateOf(SOURCE.stations, "state-lake-id")).toEqual({ selected: true });
    stationMap.select(null);
    expect(map.stateOf(SOURCE.stations, "state-lake-id")).toEqual({ selected: false });
  });

  it("scales the selected ring in over 200ms, around a ring mark or a ghost", () => {
    const { map, stationMap } = setup({ reducedMotion: false });
    stationMap.select("halsted-id");
    expect(map.paintOf(LAYER.ring, "circle-radius")).toEqual(ringRadius(RING_START_SCALE));
    expect(map.paintOf(LAYER.ghostRing, "circle-radius")).toEqual(ghostRingRadius(RING_START_SCALE));

    map.fire("render");
    for (const id of [LAYER.ring, LAYER.ghostRing]) {
      expect(map.paintOf(id, "circle-radius-transition")).toEqual({ duration: RING_SCALE_MS, delay: 0 });
    }
    expect(map.paintOf(LAYER.ring, "circle-radius")).toEqual(ringRadius(1));
    expect(map.paintOf(LAYER.ghostRing, "circle-radius")).toEqual(ghostRingRadius(1));
  });

  it("does not animate the ring for a reader who prefers reduced motion", () => {
    const { map, stationMap } = setup({ reducedMotion: true });
    stationMap.select("halsted-id");
    expect(map.paint.get(LAYER.ring)).toBeUndefined();
    expect(map.paint.get(LAYER.ghostRing)).toBeUndefined();
    expect(map.paintOf(LAYER.ring, "circle-radius")).toEqual(ringRadius(1));
  });

  it("shows a pointer and the hover state over a mark, and clears both on leave", () => {
    const { map, stationMap } = setup();
    stationMap.hover("halsted-id");
    expect(map.canvas.style.cursor).toBe("pointer");
    expect(map.stateOf(SOURCE.stations, "halsted-id")).toEqual({ hover: true });
    stationMap.hover(null);
    expect(map.canvas.style.cursor).toBe("");
    expect(map.stateOf(SOURCE.stations, "halsted-id")).toEqual({ hover: false });
  });
});

describe("StationMap line filter", () => {
  it("dims filtered-out tracks and their casings, and reads all-off as all-on", () => {
    const { map, stationMap } = setup();
    stationMap.setActiveLines({ ...ALL_LINES_ON, Green: false });
    expect(map.paintOf(trackLayerId("Green"), "line-opacity")).toBe(DIMMED.track);
    expect(map.paintOf("track-casing-Green", "line-opacity")).toBeLessThan(DIMMED.track);
    expect(map.paintOf(trackLayerId("Red"), "line-opacity")).toBe(1);

    const allOff = Object.fromEntries(CTA_LINE_ORDER.map((line) => [line, false])) as Record<CTALine, boolean>;
    stationMap.setActiveLines(allOff);
    for (const line of CTA_LINE_ORDER) expect(map.paintOf(trackLayerId(line), "line-opacity")).toBe(1);
  });
});

describe("StationMap camera", () => {
  it("flies 900ms to the station with the drawer's padding clamped to half the canvas", () => {
    const { map, stationMap } = setup();
    map.container.clientWidth = 1280;
    stationMap.focus([-87.648, 41.885], true);
    expect(map.flights.at(-1)).toEqual({
      center: [-87.648, 41.885],
      zoom: FOCUS_ZOOM,
      duration: FLY_DURATION_MS,
      padding: { top: 0, bottom: 0, left: 0, right: 440 },
    });
    expect(map.flights.at(-1)).not.toHaveProperty("essential");

    map.container.clientWidth = 768;
    stationMap.focus([-87.648, 41.885], true);
    expect(map.flights.at(-1)?.padding.right).toBe(384);
  });

  it("uses no padding on a phone and measures the canvas after it shrinks", () => {
    const { map, stationMap } = setup();
    map.container.clientWidth = 375;
    const before = map.resizes;
    stationMap.focus([-87.648, 41.885], false);
    expect(map.resizes).toBe(before + 1);
    expect(map.flights.at(-1)?.padding.right).toBe(0);
  });

  it("keeps a closer zoom the reader already chose", () => {
    const { map, stationMap } = setup();
    map.zoom = 15.2;
    stationMap.focus([-87.648, 41.885], true);
    expect(map.flights.at(-1)?.zoom).toBe(15.2);
  });

  it("drops the padding on close without moving the view", () => {
    const { map, stationMap } = setup();
    stationMap.focus([-87.648, 41.885], true);
    stationMap.releasePadding();
    expect(map.jumps.at(-1)).toEqual({
      center: map.centerAtCanvasMiddle,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    const jumps = map.jumps.length;
    stationMap.releasePadding();
    expect(map.jumps).toHaveLength(jumps);
  });

  it("re-clamps the padding when the canvas resizes, and drops it when the drawer leaves its side", () => {
    const { map, stationMap } = setup();
    map.container.clientWidth = 1280;
    stationMap.focus([-87.648, 41.885], true);

    map.container.clientWidth = 800;
    stationMap.resize(true, true);
    expect(map.padding.right).toBe(400);

    map.container.clientWidth = 375;
    stationMap.resize(true, false);
    expect(map.padding.right).toBe(0);
  });

  it("leaves the camera alone on resize while it flies or when no padding is set", () => {
    const { map, stationMap } = setup();
    stationMap.resize(true, true);
    expect(map.padding.right).toBe(0);

    stationMap.focus([-87.648, 41.885], true);
    map.moving = true;
    map.container.clientWidth = 600;
    stationMap.resize(true, true);
    expect(map.padding.right).toBe(440);
  });
});
