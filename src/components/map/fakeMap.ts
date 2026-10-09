import type { FeatureCollection } from "geojson";
import type { GeoJSONSourceSpecification, LayerSpecification } from "mapbox-gl";
import type { BaseLayer } from "./layers";
import type { RasterImage } from "./marks";
import type { Bounds } from "./layers";
import type { MapLike, Padding } from "./stationMap";

/**
 * A test double for the mapbox-gl Map, enough to exercise StationMap without WebGL. It keeps a
 * style's sources, layers, images, paint, layout, and feature state, and `swapStyle` replaces
 * the style the way `setStyle` does: everything added at runtime is gone until `style.load`.
 * Like mapbox-gl, it throws when asked to style a layer or set state on a source that is not in
 * the current style.
 */

/** A few layers from Mapbox's dark-v11 and light-v11 styles, as getStyle() lists them. */
export const BASE_STYLE_LAYERS: BaseLayer[] = [
  { id: "land", type: "background" },
  { id: "water", type: "fill" },
  { id: "road-simple", type: "line", metadata: { "mapbox:featureComponent": "road-network" } },
  { id: "road-rail", type: "line", metadata: { "mapbox:featureComponent": "transit" } },
  { id: "road-label-simple", type: "symbol", metadata: { "mapbox:featureComponent": "road-network" } },
  { id: "poi-label", type: "symbol", metadata: { "mapbox:featureComponent": "point-of-interest-labels" } },
  { id: "transit-label", type: "symbol", metadata: { "mapbox:featureComponent": "transit" } },
  { id: "airport-label", type: "symbol", metadata: { "mapbox:featureComponent": "transit" } },
  { id: "waterway-label", type: "symbol", metadata: { "mapbox:featureComponent": "natural-features" } },
  { id: "settlement-subdivision-label", type: "symbol", metadata: { "mapbox:featureComponent": "place-labels" } },
  { id: "settlement-minor-label", type: "symbol", metadata: { "mapbox:featureComponent": "place-labels" } },
  { id: "settlement-major-label", type: "symbol", metadata: { "mapbox:featureComponent": "place-labels" } },
];

interface FakeSource {
  spec: GeoJSONSourceSpecification;
  data: unknown;
  setData(data: FeatureCollection): void;
}

type Listener = () => void;

export class FakeMap implements MapLike {
  baseLayers: BaseLayer[] = BASE_STYLE_LAYERS;
  sources = new Map<string, FakeSource>();
  layers: LayerSpecification[] = [];
  images = new Map<string, { image: RasterImage; pixelRatio: number }>();
  paint = new Map<string, Record<string, unknown>>();
  layout = new Map<string, Record<string, unknown>>();
  featureState = new Map<string, Record<string, boolean>>();
  canvas = { style: { cursor: "" } };
  container = { clientWidth: 1280, clientHeight: 800 };
  zoom = 10.4;
  padding: Padding = { top: 0, bottom: 0, left: 0, right: 0 };
  moving = false;
  rotationDisabled = false;
  flights: Parameters<MapLike["flyTo"]>[0][] = [];
  jumps: Parameters<MapLike["jumpTo"]>[0][] = [];
  /** Every cameraForBounds call: what showNetwork asked the camera to frame. */
  fits: { bounds: Bounds; padding: Padding }[] = [];
  resizes = 0;
  /** The point at the canvas center, for jumpTo checks. */
  centerAtCanvasMiddle = { lng: -87.65, lat: 41.88 };

  private listeners = new Map<string, Set<Listener>>();
  private onceListeners = new Map<string, Set<Listener>>();

  touchZoomRotate = {
    disableRotation: () => {
      this.rotationDisabled = true;
    },
  };

  on(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return this;
  }

  off(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  once(type: string, listener: Listener) {
    if (!this.onceListeners.has(type)) this.onceListeners.set(type, new Set());
    this.onceListeners.get(type)!.add(listener);
    return this;
  }

  /** Fires an event at its listeners, as the map would. */
  fire(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
    const once = [...(this.onceListeners.get(type) ?? [])];
    this.onceListeners.delete(type);
    for (const listener of once) listener();
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  /** `setStyle`: drops everything added at runtime, then fires `style.load` once it "loads". */
  swapStyle({ load = true }: { load?: boolean } = {}) {
    this.sources.clear();
    this.layers = [];
    this.images.clear();
    this.paint.clear();
    this.layout.clear();
    this.featureState.clear();
    if (load) this.fire("style.load");
  }

  getStyle() {
    return { layers: [...this.baseLayers, ...this.layers] };
  }

  getSource(id: string) {
    return this.sources.get(id);
  }

  addSource(id: string, spec: GeoJSONSourceSpecification) {
    if (this.sources.has(id)) throw new Error(`There is already a source with ID "${id}".`);
    const source: FakeSource = {
      spec,
      data: spec.data,
      setData: (data) => {
        source.data = data;
      },
    };
    this.sources.set(id, source);
    return this;
  }

  getLayer(id: string) {
    return this.layers.find((layer) => layer.id === id) ?? this.baseLayers.find((layer) => layer.id === id);
  }

  addLayer(layer: LayerSpecification) {
    if (this.getLayer(layer.id)) throw new Error(`Layer "${layer.id}" already exists.`);
    if ("source" in layer && typeof layer.source === "string" && !this.sources.has(layer.source)) {
      throw new Error(`Source "${layer.source}" not found.`);
    }
    this.layers.push(layer);
    return this;
  }

  hasImage(id: string) {
    return this.images.has(id);
  }

  addImage(id: string, image: RasterImage, options: { pixelRatio: number }) {
    if (this.images.has(id)) throw new Error(`An image named "${id}" already exists.`);
    this.images.set(id, { image, pixelRatio: options.pixelRatio });
    return this;
  }

  setLayoutProperty(layerId: string, name: string, value: unknown) {
    this.requireLayer(layerId);
    this.layout.set(layerId, { ...this.layout.get(layerId), [name]: value });
    return this;
  }

  setPaintProperty(layerId: string, name: string, value: unknown) {
    this.requireLayer(layerId);
    this.paint.set(layerId, { ...this.paint.get(layerId), [name]: value });
    return this;
  }

  /** A layer's paint property: the last value set at runtime, else its spec's. */
  paintOf(layerId: string, name: string): unknown {
    const runtime = this.paint.get(layerId);
    if (runtime && name in runtime) return runtime[name];
    const layer = this.layers.find((l) => l.id === layerId);
    return (layer?.paint as Record<string, unknown> | undefined)?.[name];
  }

  setFeatureState(target: { source: string; id: string }, state: Record<string, boolean>) {
    if (!this.sources.has(target.source)) {
      throw new Error(`The source "${target.source}" does not exist in the map's style.`);
    }
    const key = `${target.source}/${target.id}`;
    this.featureState.set(key, { ...this.featureState.get(key), ...state });
    return this;
  }

  stateOf(source: string, id: string): Record<string, boolean> {
    return this.featureState.get(`${source}/${id}`) ?? {};
  }

  getCanvas() {
    return this.canvas;
  }

  getContainer() {
    return this.container;
  }

  resize() {
    this.resizes++;
    return this;
  }

  isMoving() {
    return this.moving;
  }

  getZoom() {
    return this.zoom;
  }

  getPadding() {
    return this.padding;
  }

  setPadding(padding: Padding) {
    this.padding = padding;
    return this;
  }

  flyTo(options: Parameters<MapLike["flyTo"]>[0]) {
    this.flights.push(options);
    this.padding = options.padding;
    this.zoom = options.zoom;
    return this;
  }

  /** The box's center at a fixed zoom; the real map's math is Mapbox's to test. */
  cameraForBounds(bounds: Bounds, options: { padding: Padding }) {
    this.fits.push({ bounds, padding: options.padding });
    const [[west, south], [east, north]] = bounds;
    return { center: { lng: (west + east) / 2, lat: (south + north) / 2 }, zoom: 10 };
  }

  jumpTo(options: Parameters<MapLike["jumpTo"]>[0]) {
    this.jumps.push(options);
    this.padding = options.padding;
    return this;
  }

  unproject() {
    return this.centerAtCanvasMiddle;
  }

  private requireLayer(layerId: string) {
    if (!this.getLayer(layerId)) throw new Error(`Cannot style non-existing layer "${layerId}".`);
  }
}
