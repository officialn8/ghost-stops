import type { FeatureCollection } from "geojson";
import type { GeoJSONSourceSpecification, LayerSpecification } from "mapbox-gl";
import { ALL_LINES_ON } from "@/components/shell/model";
import type { ActiveLines } from "@/components/shell/ShellContext";
import {
  EMPTY_COLLECTION,
  LAYER,
  SOURCE,
  SUBDUED_LABEL_OPACITY,
  TRACK_RENDER_ORDER,
  baseStyleAdjustments,
  drawerPadding,
  ringRadius,
  stationLayers,
  trackCasingId,
  trackCasingOpacity,
  trackLayerId,
  trackLayers,
  trackOpacity,
  type BaseLayer,
  type MapPalette,
} from "./layers";
import { IMAGE_PIXEL_RATIO, markImages, type RasterImage } from "./marks";

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The slice of mapbox-gl's Map that the station map drives. The real map satisfies it, and so
 * does the test double in fakeMap.ts, which is how the style-swap behavior is tested without
 * WebGL.
 */
export interface MapLike {
  on(type: "style.load", listener: () => void): unknown;
  off(type: "style.load", listener: () => void): unknown;
  once(type: "render", listener: () => void): unknown;
  getStyle(): { layers?: readonly BaseLayer[] } | null | undefined;
  getSource(id: string): object | null | undefined;
  addSource(id: string, source: GeoJSONSourceSpecification): unknown;
  getLayer(id: string): unknown;
  addLayer(layer: LayerSpecification): unknown;
  hasImage(id: string): boolean;
  addImage(id: string, image: RasterImage, options: { pixelRatio: number }): unknown;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): unknown;
  setFeatureState(target: { source: string; id: string }, state: Record<string, boolean>): unknown;
  getCanvas(): { style: { cursor: string } };
  getContainer(): { clientWidth: number; clientHeight: number };
  resize(): unknown;
  isMoving(): boolean;
  getZoom(): number;
  getPadding(): Partial<Padding>;
  setPadding(padding: Padding): unknown;
  flyTo(options: { center: [number, number]; zoom: number; duration: number; padding: Padding }): unknown;
  jumpTo(options: { center: { lng: number; lat: number }; padding: Padding }): unknown;
  unproject(point: [number, number]): { lng: number; lat: number };
  touchZoomRotate?: { disableRotation(): unknown };
}

interface GeoJSONSourceLike {
  setData(data: FeatureCollection): unknown;
}

function isGeoJSONSource(source: object | null | undefined): source is GeoJSONSourceLike {
  return typeof (source as Partial<GeoJSONSourceLike> | null | undefined)?.setData === "function";
}

/** A selection flies close enough to read the station's neighbors and their names. */
export const FOCUS_ZOOM = 13.5;
export const FLY_DURATION_MS = 900;
export const RING_SCALE_MS = 200;
/** The selection ring starts at this share of its size and scales up to full. */
export const RING_START_SCALE = 0.5;

const NO_PADDING: Padding = { top: 0, bottom: 0, left: 0, right: 0 };

export interface StationMapOptions {
  palette: MapPalette;
  /** Device pixels per CSS pixel for the mark images. */
  pixelRatio?: number;
  /** Read at each selection: the ring scales in only for readers who allow motion (R29). */
  prefersReducedMotion?: () => boolean;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function hasPadding(padding: Partial<Padding>): boolean {
  return Boolean(padding.top || padding.bottom || padding.left || padding.right);
}

/**
 * The station map's state and its one map (KTD13): it keeps what should be drawn (the theme, the
 * tracks, the stations, the line filter, the selected and hovered station) and applies it to
 * whatever style is loaded. A style swap, which the theme toggle causes, drops sources, layers,
 * images, and feature state, so everything is rebuilt on each `style.load`.
 */
export class StationMap {
  private readonly map: MapLike;
  private readonly pixelRatio: number;
  private readonly reducedMotion: () => boolean;
  private palette: MapPalette;
  private stations: FeatureCollection = EMPTY_COLLECTION;
  private tracks: FeatureCollection = EMPTY_COLLECTION;
  private activeLines: ActiveLines = ALL_LINES_ON;
  private selectedId: string | null = null;
  private hoveredId: string | null = null;

  constructor(map: MapLike, options: StationMapOptions) {
    this.map = map;
    this.palette = options.palette;
    this.pixelRatio = options.pixelRatio ?? IMAGE_PIXEL_RATIO;
    this.reducedMotion = options.prefersReducedMotion ?? prefersReducedMotion;
    // The CTA map stays north-up: no rotation from a two-finger twist.
    map.touchZoomRotate?.disableRotation();
    this.install();
  }

  /**
   * Rebuilds on every later style load (a theme swap) until the returned function disconnects,
   * which makes it an effect's whole body: `useEffect(() => stationMap.connect(), [stationMap])`.
   */
  connect(): () => void {
    this.map.on("style.load", this.install);
    return () => {
      this.map.off("style.load", this.install);
    };
  }

  /**
   * Builds the station map on the loaded style: base-style tweaks, mark images in the theme ink,
   * both sources, every layer, the line filter, and the selected and hovered feature state.
   * Idempotent, so a repeat on the same style adds nothing twice.
   */
  readonly install = (): void => {
    const { map } = this;

    const { hide, subdue } = baseStyleAdjustments(map.getStyle()?.layers ?? []);
    for (const id of hide) map.setLayoutProperty(id, "visibility", "none");
    for (const id of subdue) map.setPaintProperty(id, "text-opacity", SUBDUED_LABEL_OPACITY);

    for (const [id, image] of Object.entries(markImages(this.palette.ink, this.pixelRatio))) {
      if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: this.pixelRatio });
    }

    if (!map.getSource(SOURCE.tracks)) {
      map.addSource(SOURCE.tracks, { type: "geojson", data: this.tracks });
    }
    if (!map.getSource(SOURCE.stations)) {
      map.addSource(SOURCE.stations, { type: "geojson", data: this.stations, promoteId: "id" });
    }
    for (const layer of [...trackLayers(this.palette), ...stationLayers(this.palette)]) {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    }

    this.applyLineFilter();
    if (this.selectedId) this.setState(this.selectedId, { selected: true });
    if (this.hoveredId) this.setState(this.hoveredId, { hover: true });
  };

  /** The theme's ink and surface, applied when the theme's style loads. */
  setPalette(palette: MapPalette): void {
    this.palette = palette;
  }

  setStations(data: FeatureCollection): void {
    this.stations = data;
    this.setSourceData(SOURCE.stations, data);
  }

  setTracks(data: FeatureCollection): void {
    this.tracks = data;
    this.setSourceData(SOURCE.tracks, data);
  }

  /** Filtered-out lines dim rather than vanish, so the network keeps its shape (R27). */
  setActiveLines(activeLines: ActiveLines): void {
    this.activeLines = activeLines;
    this.applyLineFilter();
  }

  /** Marks the selected station: the inverted dot and its ring, which scales in. */
  select(id: string | null): void {
    if (id === this.selectedId) return;
    const previous = this.selectedId;
    this.selectedId = id;
    if (!this.isReady()) return;
    if (previous) this.setState(previous, { selected: false });
    if (id) {
      this.setState(id, { selected: true });
      this.scaleInRing();
    }
  }

  /** The station under the pointer: a pointer cursor, a faint ring, and its name at any zoom. */
  hover(id: string | null): void {
    if (id === this.hoveredId) return;
    const previous = this.hoveredId;
    this.hoveredId = id;
    this.map.getCanvas().style.cursor = id ? "pointer" : "";
    if (!this.isReady()) return;
    if (previous) this.setState(previous, { hover: false });
    if (id) this.setState(id, { hover: true });
  }

  /**
   * Flies to a station so it lands in the middle of the map the drawer leaves visible. The canvas
   * is measured first, because on a phone the map has just shrunk to 28vh. Never `essential`, so
   * a reader who asked for less motion gets a jump instead (KTD16).
   */
  focus(center: [number, number], drawerBesideMap: boolean): void {
    const { map } = this;
    map.resize();
    const right = drawerPadding(map.getContainer().clientWidth, drawerBesideMap);
    map.flyTo({
      center,
      zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
      duration: FLY_DURATION_MS,
      padding: { ...NO_PADDING, right },
    });
  }

  /** The drawer closed: drop the camera padding without moving what the reader sees. */
  releasePadding(): void {
    const { map } = this;
    if (!hasPadding(map.getPadding())) return;
    const { clientWidth, clientHeight } = map.getContainer();
    map.jumpTo({ center: map.unproject([clientWidth / 2, clientHeight / 2]), padding: NO_PADDING });
  }

  /**
   * The map's box changed size (a breakpoint, or the phone's 28vh dossier map): resize the
   * canvas, and keep any drawer padding within half the new width, or drop it when the drawer no
   * longer sits beside the map. A padding change keeps the selected station centered.
   */
  resize(drawerOpen: boolean, drawerBesideMap: boolean): void {
    const { map } = this;
    map.resize();
    const padding = map.getPadding();
    if (!padding.right || map.isMoving()) return;
    const right = drawerOpen ? drawerPadding(map.getContainer().clientWidth, drawerBesideMap) : 0;
    if (right !== padding.right) map.setPadding({ ...NO_PADDING, right });
  }

  /** Updates a source in place; before the style has it, install adds it with this data. */
  private setSourceData(id: string, data: FeatureCollection): void {
    const source = this.map.getSource(id);
    if (isGeoJSONSource(source)) source.setData(data);
  }

  private isReady(): boolean {
    return Boolean(this.map.getSource(SOURCE.stations));
  }

  private setState(id: string, state: Record<string, boolean>): void {
    this.map.setFeatureState({ source: SOURCE.stations, id }, state);
  }

  private applyLineFilter(): void {
    const { map, activeLines } = this;
    for (const line of TRACK_RENDER_ORDER) {
      if (map.getLayer(trackLayerId(line))) {
        map.setPaintProperty(trackLayerId(line), "line-opacity", trackOpacity(line, activeLines));
      }
      if (map.getLayer(trackCasingId(line))) {
        map.setPaintProperty(trackCasingId(line), "line-opacity", trackCasingOpacity(line, activeLines));
      }
    }
  }

  /**
   * The selected ring scales in over 200ms. Feature state never animates, so the ring layer's
   * radius drops to half for one frame and then transitions back. Skipped entirely for a reader
   * who prefers reduced motion.
   */
  private scaleInRing(): void {
    const { map } = this;
    if (this.reducedMotion() || !map.getLayer(LAYER.ring)) return;
    map.setPaintProperty(LAYER.ring, "circle-radius-transition", { duration: 0, delay: 0 });
    map.setPaintProperty(LAYER.ring, "circle-radius", ringRadius(RING_START_SCALE));
    map.once("render", () => {
      if (!map.getLayer(LAYER.ring)) return;
      map.setPaintProperty(LAYER.ring, "circle-radius-transition", { duration: RING_SCALE_MS, delay: 0 });
      map.setPaintProperty(LAYER.ring, "circle-radius", ringRadius(1));
    });
  }
}
