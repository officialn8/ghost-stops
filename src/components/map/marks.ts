import { hexToRgb } from "@/lib/utils";

/**
 * How a station mark is sized and drawn on the map, in the one vocabulary PresenceMark defines
 * (R23, KTD10). A circle layer draws the solid and hollow marks. It cannot dash its stroke or
 * carry a bar, so the dashed ring (ghost), the dotted ring (no data), and the bar across the
 * closed mark are small raster images drawn here in the theme ink, which a symbol layer scales
 * with the circle layer's radius so the two always line up.
 *
 * Every proportion comes from PresenceMark at its 10px size: a 1.5px ring around a 3.5px hole,
 * the ghost ring's 2 on 1.6 dash, the no-data ring's 1 on 2 dots, and the closed bar reaching
 * 60% of the ring's radius either side of the center.
 */

/**
 * The mark's inner radius (the circle layer's `circle-radius`) in CSS px by zoom, linear between
 * stops. The stops sit on odd zooms so each tile's zoom range [z, z + 1] falls on one linear
 * piece, which keeps the symbol layer's icon size exactly in step with the circle layer.
 */
export const MARK_RADIUS_STOPS: readonly (readonly [zoom: number, radius: number])[] = [
  [9, 2],
  [11, 2.75],
  [13, 4],
  [15, 5.5],
  [17, 7],
];

/** The ring's width as a share of the inner radius: PresenceMark's 1.5px ring on a 3.5px hole. */
export const STROKE_RATIO = 1.5 / 3.5;

/** PresenceMark's ghost dash (2 on, 1.6 off) and no-data dots (1 on, 2 off), as whole turns. */
const PRESENCE_RING_CENTERLINE = 4.25;
const GHOST_DASH = { on: 2, off: 1.6 };
const NO_DATA_DOT = { on: 1, off: 2 };

/** Repeats of an SVG dash pattern around PresenceMark's ring, rounded so the ring has no seam. */
function dashesAround({ on, off }: { on: number; off: number }) {
  const circumference = 2 * Math.PI * PRESENCE_RING_CENTERLINE;
  return { count: Math.round(circumference / (on + off)), fraction: on / (on + off) };
}

export const GHOST_DASHES = dashesAround(GHOST_DASH);
export const NO_DATA_DOTS = dashesAround(NO_DATA_DOT);

/** The bar across a closed mark reaches this share of the ring's radius either side of center. */
export const CLOSED_BAR_REACH = 0.6;

export const MARK_IMAGE = {
  dashed: "station-mark-dashed",
  dotted: "station-mark-dotted",
  bar: "station-mark-bar",
} as const;

export type MarkImageId = (typeof MARK_IMAGE)[keyof typeof MARK_IMAGE];

/** The inner radius the images are drawn for; the symbol layer's icon size is radius / this. */
export const IMAGE_RADIUS = 6;

/** Device pixels per CSS pixel in the images: sharp from a 1x screen to a 3x phone. */
export const IMAGE_PIXEL_RATIO = 3;

/** An image in the shape mapbox-gl's addImage takes: RGBA rows, not premultiplied, like ImageData. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** The mark's geometry inside an image, in CSS px from the image's center. */
export function imageGeometry() {
  const stroke = IMAGE_RADIUS * STROKE_RATIO;
  const centerline = IMAGE_RADIUS + stroke / 2;
  const half = Math.ceil(IMAGE_RADIUS + stroke + 1);
  return { stroke, centerline, half };
}

/** The radius stops as interpolate arguments, each radius times `scale` plus `add`. */
export function radiusStops(scale = 1, add = 0): number[] {
  return MARK_RADIUS_STOPS.flatMap(([zoom, radius]) => [zoom, radius * scale + add]);
}

type Shape = (x: number, y: number) => boolean;

const SUPERSAMPLE = 4;

/** Draws `shape` (CSS px from the center) in `ink`, antialiased by supersampling each pixel. */
function rasterize(shape: Shape, ink: string, pixelRatio: number): RasterImage {
  const { half } = imageGeometry();
  const size = 2 * half * pixelRatio;
  const [r, g, b] = hexToRgb(ink);
  const data = new Uint8ClampedArray(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / pixelRatio - half;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / pixelRatio - half;
          if (shape(x, y)) covered++;
        }
      }
      const i = (py * size + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round((covered / SUPERSAMPLE ** 2) * 255);
    }
  }

  return { width: size, height: size, data };
}

/**
 * A ring broken into `count` dashes, each `fraction` of its repeat. Angles run clockwise from
 * three o'clock, where an SVG circle's dash pattern starts.
 */
function brokenRing(count: number, fraction: number): Shape {
  const { stroke, centerline } = imageGeometry();
  return (x, y) => {
    if (Math.abs(Math.hypot(x, y) - centerline) > stroke / 2) return false;
    const turn = (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1;
    return (turn * count) % 1 < fraction;
  };
}

function closedBar(): Shape {
  const { stroke, centerline } = imageGeometry();
  return (x, y) => Math.abs(y) <= stroke / 2 && Math.abs(x) <= centerline * CLOSED_BAR_REACH;
}

const cache = new Map<string, Readonly<Record<MarkImageId, RasterImage>>>();

/** The three mark images in one theme's ink, drawn once per ink and pixel ratio. */
export function markImages(ink: string, pixelRatio = IMAGE_PIXEL_RATIO): Readonly<Record<MarkImageId, RasterImage>> {
  const key = `${ink}@${pixelRatio}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const images = {
    [MARK_IMAGE.dashed]: rasterize(brokenRing(GHOST_DASHES.count, GHOST_DASHES.fraction), ink, pixelRatio),
    [MARK_IMAGE.dotted]: rasterize(brokenRing(NO_DATA_DOTS.count, NO_DATA_DOTS.fraction), ink, pixelRatio),
    [MARK_IMAGE.bar]: rasterize(closedBar(), ink, pixelRatio),
  };
  cache.set(key, images);
  return images;
}
