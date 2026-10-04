import { GHOST_SCALE } from "@/components/marks/PresenceMark";
import { hexToRgb } from "@/lib/utils";

/**
 * How a station mark is sized and drawn on the map, in the one vocabulary PresenceMark defines
 * (R23, KTD10). A circle layer draws the solid and hollow rings. It cannot dot its stroke, carry
 * a bar, or draw a ghost, so the dotted ring (no data), the bar across the closed mark, and the
 * ghost glyph (ghost tier) are small raster images drawn here in the theme's ink and surface,
 * which symbol layers scale with the circle layer's radius so they always line up.
 *
 * Every proportion comes from PresenceMark at its 10px size: a 1.5px ring around a 3.5px hole,
 * the no-data ring's 1 on 2 dots, the closed bar reaching 60% of the ring's radius either side
 * of the center, and the ghost glyph's box GHOST_SCALE times the ring's diameter.
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

/** PresenceMark's no-data dots (1 on, 2 off), as whole turns around its 4.25px ring. */
const PRESENCE_RING_CENTERLINE = 4.25;
const NO_DATA_DOT = { on: 1, off: 2 };

/** Repeats of an SVG dash pattern around PresenceMark's ring, rounded so the ring has no seam. */
function dashesAround({ on, off }: { on: number; off: number }) {
  const circumference = 2 * Math.PI * PRESENCE_RING_CENTERLINE;
  return { count: Math.round(circumference / (on + off)), fraction: on / (on + off) };
}

export const NO_DATA_DOTS = dashesAround(NO_DATA_DOT);

/** The bar across a closed mark reaches this share of the ring's radius either side of center. */
export const CLOSED_BAR_REACH = 0.6;

export const MARK_IMAGE = {
  dotted: "station-mark-dotted",
  bar: "station-mark-bar",
  /** The ghost's body in the surface: tracks never show through it. */
  ghostBody: "station-mark-ghost-body",
  /** The ghost's outline and eyes in ink, faded to the ghost tier's ink by the layer. */
  ghostLine: "station-mark-ghost-line",
  /** The selected ghost, inverted: an ink body with a surface outline and eyes. */
  ghostSelected: "station-mark-ghost-selected",
} as const;

export type MarkImageId = (typeof MARK_IMAGE)[keyof typeof MARK_IMAGE];

/** The inner radius the images are drawn for; the symbol layers' icon size is radius / this. */
export const IMAGE_RADIUS = 6;

/** Device pixels per CSS pixel in the images: sharp from a 1x screen to a 3x phone. */
export const IMAGE_PIXEL_RATIO = 3;

/** An image in the shape mapbox-gl's addImage takes: RGBA rows, not premultiplied, like ImageData. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** The theme's two colors, which the images are drawn in. */
export interface MarkColors {
  ink: string;
  surface: string;
}

/** The ring marks' geometry inside an image, in CSS px from the image's center. */
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

// ═══════════════════════════════════════════════════════════════
// THE GHOST GLYPH
// ═══════════════════════════════════════════════════════════════

/**
 * Lucide's Ghost, the glyph PresenceMark draws, as geometry in its 24-unit box with a 2-unit
 * stroke and round joins. Its path:
 *
 *   body  M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z
 *   eyes  M9 10h.01 and M15 10h.01 (round dots of radius 1)
 *
 * The body is a head (the upper half of a radius-8 circle at 12, 10), straight sides at x 4 and
 * 20, and a zigzag hem.
 */
export const GHOST_BOX = 24;
const GHOST_HALF_STROKE = 1;
const GHOST_HEAD = { cx: 12, cy: 10, r: 8 };
const GHOST_HEM: readonly (readonly [number, number])[] = [
  [4, 22],
  [7, 19],
  [9.5, 21.5],
  [12, 19],
  [14.5, 21.5],
  [17, 19],
  [20, 22],
];
const GHOST_EYES: readonly (readonly [number, number])[] = [
  [9, 10],
  [15, 10],
];
/** Straight edges of the outline: the left side, the hem, and the right side. */
const GHOST_EDGES: readonly (readonly [number, number, number, number])[] = [
  [4, 10, 4, 22],
  ...GHOST_HEM.slice(1).map(([x, y], i) => [GHOST_HEM[i][0], GHOST_HEM[i][1], x, y] as const),
  [20, 22, 20, 10],
];

/** The farthest the drawn glyph reaches from the box's center: a hem corner plus the stroke. */
export const GHOST_REACH = Math.hypot(20 - GHOST_BOX / 2, 22 - GHOST_BOX / 2) + GHOST_HALF_STROKE;

/**
 * The ghost's size against a ring mark's: its box is GHOST_SCALE times the ring's outer diameter,
 * as in PresenceMark. Multiply a ring mark's inner radius by these to get the box's side and the
 * glyph's reach from its center, in the same units.
 */
export const GHOST_BOX_PER_RADIUS = GHOST_SCALE * 2 * (1 + STROKE_RATIO);
export const GHOST_REACH_PER_RADIUS = (GHOST_BOX_PER_RADIUS / GHOST_BOX) * GHOST_REACH;

/** The ghost's geometry inside its images, in CSS px. */
export function ghostGeometry() {
  const box = IMAGE_RADIUS * GHOST_BOX_PER_RADIUS;
  const unit = box / GHOST_BOX;
  const half = Math.ceil(GHOST_REACH * unit + 1);
  return { box, unit, half };
}

/** The bottom edge of the body at `u`: the hem's zigzag. */
function hemAt(u: number): number {
  for (let i = 1; i < GHOST_HEM.length; i++) {
    const [x0, y0] = GHOST_HEM[i - 1];
    const [x1, y1] = GHOST_HEM[i];
    if (u <= x1) return y0 + ((u - x0) / (x1 - x0)) * (y1 - y0);
  }
  return GHOST_HEM[GHOST_HEM.length - 1][1];
}

/** Whether a point in glyph units is inside the body, up to the outline's centerline. */
function inGhostBody(u: number, v: number): boolean {
  if (v <= GHOST_HEAD.cy) return Math.hypot(u - GHOST_HEAD.cx, v - GHOST_HEAD.cy) <= GHOST_HEAD.r;
  return u >= 4 && u <= 20 && v <= hemAt(u);
}

function distanceToSegment(u: number, v: number, [x0, y0, x1, y1]: readonly [number, number, number, number]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(u - (x0 + t * dx), v - (y0 + t * dy));
}

/** Whether a point in glyph units is under the 2-unit outline (round joins) or an eye. */
function onGhostLine(u: number, v: number): boolean {
  if (GHOST_EYES.some(([x, y]) => Math.hypot(u - x, v - y) <= GHOST_HALF_STROKE)) return true;
  if (v <= GHOST_HEAD.cy && Math.abs(Math.hypot(u - GHOST_HEAD.cx, v - GHOST_HEAD.cy) - GHOST_HEAD.r) <= GHOST_HALF_STROKE) {
    return true;
  }
  return GHOST_EDGES.some((edge) => distanceToSegment(u, v, edge) <= GHOST_HALF_STROKE);
}

/** A glyph-unit shape as a shape in CSS px from the image's center. */
function inGlyphUnits(test: (u: number, v: number) => boolean): Shape {
  const { unit } = ghostGeometry();
  return (x, y) => test(GHOST_BOX / 2 + x / unit, GHOST_BOX / 2 + y / unit);
}

// ═══════════════════════════════════════════════════════════════
// RASTERIZING
// ═══════════════════════════════════════════════════════════════

type Shape = (x: number, y: number) => boolean;

/** A shape and its color; an image stacks these bottom to top. */
interface Fill {
  shape: Shape;
  color: string;
}

const SUPERSAMPLE = 4;

/**
 * Draws `fills` (CSS px from the center, bottom to top) into a square image `half` CSS px from
 * center to edge, antialiased by supersampling each pixel: each sample takes the color of the
 * topmost fill covering it. Uncovered pixels carry the top fill's color at zero alpha, so a
 * filtered edge blends toward the outermost color rather than black.
 */
function rasterize(fills: readonly Fill[], half: number, pixelRatio: number): RasterImage {
  const size = 2 * half * pixelRatio;
  const colors = fills.map((fill) => hexToRgb(fill.color));
  const edge = colors[colors.length - 1];
  const samples = SUPERSAMPLE ** 2;
  const data = new Uint8ClampedArray(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / pixelRatio - half;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / pixelRatio - half;
          for (let i = fills.length - 1; i >= 0; i--) {
            if (!fills[i].shape(x, y)) continue;
            covered++;
            for (let c = 0; c < 3; c++) sum[c] += colors[i][c];
            break;
          }
        }
      }
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = covered ? sum[c] / covered : edge[c];
      data[i + 3] = Math.round((covered / samples) * 255);
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

/** Every mark image in one theme's colors, drawn once per theme and pixel ratio. */
export function markImages(
  { ink, surface }: MarkColors,
  pixelRatio = IMAGE_PIXEL_RATIO,
): Readonly<Record<MarkImageId, RasterImage>> {
  const key = `${ink}/${surface}@${pixelRatio}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const ring = imageGeometry().half;
  const ghost = ghostGeometry().half;
  const body = inGlyphUnits(inGhostBody);
  const line = inGlyphUnits(onGhostLine);

  const images = {
    [MARK_IMAGE.dotted]: rasterize([{ shape: brokenRing(NO_DATA_DOTS.count, NO_DATA_DOTS.fraction), color: ink }], ring, pixelRatio),
    [MARK_IMAGE.bar]: rasterize([{ shape: closedBar(), color: ink }], ring, pixelRatio),
    [MARK_IMAGE.ghostBody]: rasterize([{ shape: body, color: surface }], ghost, pixelRatio),
    [MARK_IMAGE.ghostLine]: rasterize([{ shape: line, color: ink }], ghost, pixelRatio),
    [MARK_IMAGE.ghostSelected]: rasterize(
      [
        { shape: body, color: ink },
        { shape: line, color: surface },
      ],
      ghost,
      pixelRatio,
    ),
  };
  cache.set(key, images);
  return images;
}
