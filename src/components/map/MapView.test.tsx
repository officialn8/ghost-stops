import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeatureCollection, LineString, Point } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_LINES_ON } from "@/components/shell/model";
import { CTA_LINE_ORDER } from "@/lib/utils";
import { ShellContext, type ShellModel } from "@/components/shell/ShellContext";
import { ThemeProvider } from "@/components/theme";
import type { StationListItem } from "@/types/station";
import { FakeMap } from "./fakeMap";
import {
  DIMMED,
  LAYER,
  MAP_PALETTE,
  MAP_STYLE,
  SOURCE,
  SYSTEM_BOUNDS,
  trackLayerId,
  type StationFeatureProperties,
} from "./layers";

// mapbox-gl needs WebGL, which jsdom lacks: the Map component is replaced by one that records its
// props, and the map instance it would hand to onLoad is the FakeMap test double.
type MapProps = Record<string, unknown> & {
  onLoad: (event: { type: string; target: FakeMap }) => void;
  onIdle?: () => void;
  onClick: (event: unknown) => void;
  onMouseMove: (event: unknown) => void;
  onMouseLeave: () => void;
};
const mapProps = vi.hoisted(() => ({ current: null as MapProps | null }));

vi.mock("react-map-gl/mapbox", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: MapProps & { children?: React.ReactNode }) => {
      mapProps.current = props;
      return createElement("div", { "data-testid": "map" }, props.children);
    },
    AttributionControl: ({ position }: { position: string }) =>
      createElement("div", { "data-testid": "attribution", "data-position": position }),
    NavigationControl: ({ position }: { position: string }) =>
      createElement("div", { "data-testid": "navigation", "data-position": position }),
  };
});

// The token is read when the module loads; without one the map reports itself as failed.
process.env.NEXT_PUBLIC_MAPBOX_TOKEN ??= "pk.test";
const { default: MapView } = await import("./MapView");

function props(): MapProps {
  if (!mapProps.current) throw new Error("the map has not rendered");
  return mapProps.current;
}

function station(slug: string, overrides: Partial<StationListItem> = {}): StationListItem {
  return {
    id: `${slug}-id`,
    slug,
    displayName: slug,
    name: slug,
    lines: ["Green"],
    status: "ACTIVE",
    closedAt: null,
    latitude: 41.885,
    longitude: -87.648,
    tier: "ghost",
    rank: 1,
    rankedCount: 143,
    score: 98,
    avg12m: 700,
    avg30d: 740,
    dataStatus: "available",
    sparkline: null,
    badge: null,
    ...overrides,
  };
}

const HALSTED = station("halsted-green");
const STATE_LAKE = station("state-lake", {
  displayName: "State/Lake",
  lines: ["Brown", "Green", "Orange", "Purple", "Pink"],
  status: "CLOSED",
  closedAt: "2026-01-12",
  tier: null,
  rank: null,
  score: null,
  latitude: 41.88574,
  longitude: -87.62781,
});
const STATIONS = [HALSTED, STATE_LAKE];

const TRACKS: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[-87.66, 41.885], [-87.64, 41.885]] },
      properties: { segment_id: "seg_1", corridor: "Lake", is_loop: false, lines: ["Green"] },
    },
  ],
};

function model(overrides: Partial<ShellModel> = {}): ShellModel {
  const stations = overrides.stations ?? STATIONS;
  return {
    list: {
      status: "ready",
      data: { dataThrough: "2026-07-31", lastSuccessfulFetch: null, stations: [...stations] },
      stale: false,
    },
    retryList: vi.fn(),
    stations,
    stationBySlug: new Map(stations.map((s) => [s.slug ?? s.id, s])),
    selectedSlug: null,
    selected: null,
    openStation: vi.fn(),
    closeStation: vi.fn(),
    query: "",
    setQuery: vi.fn(),
    activeLines: ALL_LINES_ON,
    toggleLine: vi.fn(),
    sort: { key: "rank", direction: "asc" },
    sortBy: vi.fn(),
    ...overrides,
  };
}

function ui(shell: ShellModel) {
  return (
    <ThemeProvider>
      <ShellContext.Provider value={shell}>
        <MapView />
      </ShellContext.Provider>
    </ThemeProvider>
  );
}

/** Renders the map, then loads it on a FakeMap the way mapbox-gl's `load` event would. */
function renderLoaded(shell: ShellModel) {
  const view = render(ui(shell));
  const map = new FakeMap();
  act(() => props().onLoad({ type: "load", target: map }));
  return { ...view, map };
}

/** A pointer event over the given stations' marks, all projected onto the pointer. */
function pointerOver(map: FakeMap, ...stations: StationListItem[]) {
  return {
    point: { x: 100, y: 100 },
    target: { project: () => ({ x: 100, y: 100 }) },
    features: stations.map((s) => ({
      properties: { id: s.id, slug: s.slug },
      geometry: { type: "Point", coordinates: [s.longitude, s.latitude] },
    })),
    map,
  };
}

function stationFeature(map: FakeMap, id: string): StationFeatureProperties | undefined {
  const data = map.sources.get(SOURCE.stations)?.data as FeatureCollection<Point, StationFeatureProperties>;
  return data.features.find((f) => f.properties.id === id)?.properties;
}

/** A viewport `width` px wide, as matchMedia reports it, with reduced motion requested. */
function setViewport(width: number) {
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const matches = query.includes("prefers-reduced-motion")
      ? true
      : (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  mapProps.current = null;
  document.documentElement.setAttribute("data-theme", "dark");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(TRACKS), { status: 200 })),
  );
  setViewport(1440);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.unstubAllGlobals();
});

describe("MapView pointer", () => {
  it("opens the closure dossier when the closed mark is tapped", () => {
    const shell = model();
    const { map } = renderLoaded(shell);

    act(() => props().onClick(pointerOver(map, STATE_LAKE)));

    expect(shell.openStation).toHaveBeenCalledWith("state-lake");
  });

  it("opens a ranked station the same way, and does nothing over empty map", () => {
    const shell = model();
    const { map } = renderLoaded(shell);

    act(() => props().onClick(pointerOver(map)));
    expect(shell.openStation).not.toHaveBeenCalled();

    act(() => props().onClick(pointerOver(map, HALSTED)));
    expect(shell.openStation).toHaveBeenCalledWith("halsted-green");
  });

  it("does not push the open station's page again", () => {
    const shell = model({ selectedSlug: "halsted-green", selected: HALSTED });
    const { map } = renderLoaded(shell);

    act(() => props().onClick(pointerOver(map, HALSTED)));

    expect(shell.openStation).not.toHaveBeenCalled();
  });

  it("marks the hovered station instead of showing a tooltip, and clears it on leave", () => {
    const { map, container } = renderLoaded(model());

    act(() => props().onMouseMove(pointerOver(map, HALSTED)));
    expect(map.stateOf(SOURCE.stations, HALSTED.id)).toEqual({ hover: true });
    expect(map.canvas.style.cursor).toBe("pointer");
    expect(container.querySelector(".mapboxgl-marker, [role='tooltip']")).toBeNull();

    act(() => props().onMouseLeave());
    expect(map.stateOf(SOURCE.stations, HALSTED.id)).toEqual({ hover: false });
  });

  it("names the map for assistive technology", () => {
    render(ui(model()));
    expect(props().locale).toEqual({ "Map.Title": "Map of CTA L stations" });
    expect(props().interactiveLayerIds).toEqual([LAYER.hit]);
  });
});

describe("MapView layers", () => {
  it("draws State/Lake as the closed mark with no label", () => {
    const { map } = renderLoaded(model());
    expect(stationFeature(map, STATE_LAKE.id)).toMatchObject({ mark: "closed", labeled: false, slug: "state-lake" });
    expect(stationFeature(map, HALSTED.id)).toMatchObject({ mark: "ghost", labeled: true });
  });

  it("loads the tracks once and dims filtered-out lines and stations instead of removing them", async () => {
    const shell = model();
    const { map, rerender } = renderLoaded(shell);
    await waitFor(() => expect((map.sources.get(SOURCE.tracks)?.data as FeatureCollection).features).toHaveLength(1));

    rerender(ui({ ...shell, activeLines: { ...ALL_LINES_ON, Green: false } }));

    expect(map.paintOf(trackLayerId("Green"), "line-opacity")).toBe(DIMMED.track);
    expect((map.sources.get(SOURCE.tracks)?.data as FeatureCollection).features).toHaveLength(1);
    expect(stationFeature(map, HALSTED.id)?.dimmed).toBe(true);
    expect(stationFeature(map, STATE_LAKE.id)?.dimmed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("MapView selection and camera", () => {
  it("selects and flies to the open station with the drawer's padding beside the map", () => {
    setViewport(1440);
    const { map } = renderLoaded(model({ selectedSlug: "halsted-green", selected: HALSTED }));

    expect(map.stateOf(SOURCE.stations, HALSTED.id)).toEqual({ selected: true });
    expect(map.flights).toHaveLength(1);
    expect(map.flights[0]).toMatchObject({ center: [HALSTED.longitude, HALSTED.latitude], duration: 900 });
    expect(map.flights[0].padding.right).toBe(440);
  });

  it("flies with no padding on a phone, where the dossier is the page below a 28vh map", () => {
    setViewport(375);
    const { map } = renderLoaded(model({ selectedSlug: "halsted-green", selected: HALSTED }));

    expect(map.flights[0].padding.right).toBe(0);
    // One finger scrolls the dossier; the map still takes taps and two-finger gestures.
    expect(props().dragPan).toBe(false);
    // The top left is the "Whole network" button's; Mapbox's logo joins its credits top right.
    expect(props().logoPosition).toBe("top-right");
    expect(screen.queryByTestId("navigation")).toBeNull();
  });

  it("flies to a deep-linked station once the list loads, and only once", () => {
    const loading = model({ stations: [], selectedSlug: "halsted-green", selected: null });
    const { map, rerender } = renderLoaded(loading);
    expect(map.flights).toHaveLength(0);

    rerender(ui(model({ selectedSlug: "halsted-green", selected: HALSTED })));
    expect(map.flights).toHaveLength(1);

    // A list refresh hands back the same station as a new object: the camera stays.
    rerender(ui(model({ selectedSlug: "halsted-green", selected: { ...HALSTED } })));
    expect(map.flights).toHaveLength(1);
  });

  it("clears the selection on close, drops the padding, and flies back to the whole network", () => {
    const { map, rerender } = renderLoaded(model({ selectedSlug: "halsted-green", selected: HALSTED }));

    rerender(ui(model()));

    expect(map.stateOf(SOURCE.stations, HALSTED.id)).toEqual({ selected: false });
    expect(map.jumps.at(-1)).toEqual({ center: map.centerAtCanvasMiddle, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    expect(map.fits.at(-1)).toEqual({ bounds: SYSTEM_BOUNDS, padding: { top: 40, bottom: 40, left: 40, right: 40 } });
    expect(map.flights.at(-1)).toMatchObject({ zoom: 10, duration: 900, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  });

  it("leaves the opening view alone, and frames the network again from the button", async () => {
    const { map } = renderLoaded(model());
    expect(map.flights).toHaveLength(0);
    expect(map.fits).toHaveLength(0);
    expect(screen.getByTestId("navigation")).toHaveAttribute("data-position", "top-left");

    await userEvent.click(screen.getByRole("button", { name: "Whole network" }));
    expect(map.fits.at(-1)?.bounds).toEqual(SYSTEM_BOUNDS);
    expect(map.flights).toHaveLength(1);
  });

  it("frames the lines the filter keeps, inset for an open drawer", async () => {
    const monroe = station("monroe-red", { lines: ["Red"], latitude: 41.9, longitude: -87.7 });
    const redOnly = Object.fromEntries(CTA_LINE_ORDER.map((line) => [line, line === "Red"])) as typeof ALL_LINES_ON;
    const { map } = renderLoaded(
      model({ stations: [HALSTED, STATE_LAKE, monroe], activeLines: redOnly, selectedSlug: "monroe-red", selected: monroe }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Whole network" }));
    const fit = map.fits.at(-1);
    expect(fit?.bounds[0][0]).toBeCloseTo(-87.705, 5);
    expect(fit?.bounds[1][0]).toBeCloseTo(-87.695, 5);
    expect(fit?.padding).toEqual({ top: 40, bottom: 40, left: 40, right: 480 });
  });

  it("says the map is loading until it first goes idle", () => {
    renderLoaded(model());
    expect(screen.getByText("Loading the map")).toBeInTheDocument();
    act(() => props().onIdle?.());
    expect(screen.queryByText("Loading the map")).toBeNull();
    expect(props().onIdle).toBeUndefined();
  });

  it("hides the button on a phone station page, where the small map is a locator", () => {
    setViewport(375);
    renderLoaded(model({ selectedSlug: "halsted-green", selected: HALSTED }));
    expect(screen.queryByRole("button", { name: "Whole network" })).toBeNull();
  });

  it("restores the selected station's feature state after the theme swaps the style", async () => {
    const { map } = renderLoaded(model({ selectedSlug: "halsted-green", selected: HALSTED }));
    expect(props().mapStyle).toBe(MAP_STYLE.dark);
    expect(props().styleDiffing).toBe(false);

    act(() => document.documentElement.setAttribute("data-theme", "light"));
    await waitFor(() => expect(props().mapStyle).toBe(MAP_STYLE.light));

    // mapbox-gl drops runtime sources, layers, images, and feature state with the old style.
    act(() => map.swapStyle());

    expect(map.stateOf(SOURCE.stations, HALSTED.id)).toEqual({ selected: true });
    expect(stationFeature(map, STATE_LAKE.id)?.mark).toBe("closed");
    expect(map.layers.find((l) => l.id === LAYER.labels)?.paint).toMatchObject({ "text-color": MAP_PALETTE.light.ink });
    expect(map.flights).toHaveLength(1);
  });
});
