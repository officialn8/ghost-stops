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
const GHOST_EYE_Y = 10;
const GHOST_EYES: readonly (readonly [number, number])[] = [
  [9, GHOST_EYE_Y],
  [15, GHOST_EYE_Y],
];
type Segment = readonly [x0: number, y0: number, x1: number, y1: number];
/** The outline's straight sides, from the head down to the hem's outer corners. */
const GHOST_SIDES: readonly Segment[] = [
  [4, 10, 4, 22],
  [20, 22, 20, 10],
];
/** The hem's zigzag, corner to corner. */
const GHOST_HEM_EDGES: readonly Segment[] = GHOST_HEM.slice(1).map(
  ([x, y], i): Segment => [GHOST_HEM[i][0], GHOST_HEM[i][1], x, y],
);
const GHOST_HEM_TOP = Math.min(...GHOST_HEM.map(([, y]) => y));

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
    const from = GHOST_HEM[i - 1];
    const to = GHOST_HEM[i];
    if (u <= to[0]) return from[1] + ((u - from[0]) / (to[0] - from[0])) * (to[1] - from[1]);
  }
  return GHOST_HEM[GHOST_HEM.length - 1][1];
}

/** Whether a point in glyph units is inside the body, up to the outline's centerline. */
function inGhostBody(u: number, v: number): boolean {
  if (v <= GHOST_HEAD.cy) {
    const dx = u - GHOST_HEAD.cx;
    const dy = v - GHOST_HEAD.cy;
    return Math.sqrt(dx * dx + dy * dy) <= GHOST_HEAD.r;
  }
  return u >= 4 && u <= 20 && v <= hemAt(u);
}

/** Whether a point is within the outline's half stroke of a segment (its ends round, like joins). */
function nearSegment(u: number, v: number, segment: Segment): boolean {
  const x0 = segment[0];
  const y0 = segment[1];
  const dx = segment[2] - x0;
  const dy = segment[3] - y0;
  const t = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy)));
  const ex = u - (x0 + t * dx);
  const ey = v - (y0 + t * dy);
  return Math.sqrt(ex * ex + ey * ey) <= GHOST_HALF_STROKE;
}

/**
 * Whether a point in glyph units is under the 2-unit outline (round joins) or an eye. Each part
 * is tested only where its stroke can reach (a half stroke around it), which keeps sampling
 * cheap: the eyes' row, the sides' columns, and each hem edge's span below the hem's top.
 */
function onGhostLine(u: number, v: number): boolean {
  if (Math.abs(v - GHOST_EYE_Y) <= GHOST_HALF_STROKE) {
    for (const eye of GHOST_EYES) {
      const dx = u - eye[0];
      const dy = v - eye[1];
      if (Math.sqrt(dx * dx + dy * dy) <= GHOST_HALF_STROKE) return true;
    }
  }
  if (v <= GHOST_HEAD.cy) {
    const dx = u - GHOST_HEAD.cx;
    const dy = v - GHOST_HEAD.cy;
    if (Math.abs(Math.sqrt(dx * dx + dy * dy) - GHOST_HEAD.r) <= GHOST_HALF_STROKE) return true;
  }
  if (Math.abs(u - 4) <= GHOST_HALF_STROKE || Math.abs(u - 20) <= GHOST_HALF_STROKE) {
    for (const side of GHOST_SIDES) if (nearSegment(u, v, side)) return true;
  }
  if (v >= GHOST_HEM_TOP - GHOST_HALF_STROKE) {
    for (const edge of GHOST_HEM_EDGES) {
      if (u >= edge[0] - GHOST_HALF_STROKE && u <= edge[2] + GHOST_HALF_STROKE && nearSegment(u, v, edge)) return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// RASTERIZING
// ═══════════════════════════════════════════════════════════════

type Rgb = readonly [number, number, number];

const SUPERSAMPLE = 4;
const SAMPLES = SUPERSAMPLE ** 2;

/**
 * Sorts each of a square image's supersamples (CSS px from its center, `half` px to an edge)
 * into channels: `classify` returns a bit mask, and each set bit counts the sample for that
 * channel. The result is one count (0 to 16) per pixel per channel. Shape coverage never depends
 * on color, so this runs once per pixel ratio and every theme's images are painted from it.
 */
function countSamples(
  half: number,
  pixelRatio: number,
  channels: number,
  classify: (x: number, y: number) => number,
): { size: number; counts: Uint8Array[] } {
  const size = 2 * half * pixelRatio;
  const counts = Array.from({ length: channels }, () => new Uint8Array(size * size));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pixel = py * size + px;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        const y = (py + (sy + 0.5) / SUPERSAMPLE) / pixelRatio - half;
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / pixelRatio - half;
          const mask = classify(x, y);
          for (let c = 0; c < channels; c++) if (mask & (1 << c)) counts[c][pixel]++;
        }
      }
    }
  }
  return { size, counts };
}

/**
 * Paints an image from sample counts, bottom to top, where each sample counts toward at most one
 * fill: a pixel takes the coverage-weighted mix of its fills' colors and an alpha of the share of
 * samples covered. Uncovered pixels carry the top fill's color at zero alpha, so a filtered edge
 * blends toward the outermost color rather than black.
 */
function paint(size: number, fills: readonly { counts: Uint8Array; rgb: Rgb }[]): RasterImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const edge = fills[fills.length - 1].rgb;
  for (let pixel = 0; pixel < size * size; pixel++) {
    let covered = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const { counts, rgb } of fills) {
      const n = counts[pixel];
      if (n === 0) continue;
      covered += n;
      r += n * rgb[0];
      g += n * rgb[1];
      b += n * rgb[2];
    }
    const i = pixel * 4;
    data[i] = covered ? r / covered : edge[0];
    data[i + 1] = covered ? g / covered : edge[1];
    data[i + 2] = covered ? b / covered : edge[2];
    data[i + 3] = Math.round((covered / SAMPLES) * 255);
  }
  return { width: size, height: size, data };
}

const RING = { dotted: 1 << 0, bar: 1 << 1 };
const GHOST = { line: 1 << 0, bodyOnly: 1 << 1, body: 1 << 2 };

/**
 * Sorts a ring image's samples: the no-data ring's dots (dashes clockwise from three o'clock,
 * where an SVG circle's dash pattern starts) and the closed mark's bar.
 */
function ringClassifier(): (x: number, y: number) => number {
  const { stroke, centerline } = imageGeometry();
  const halfStroke = stroke / 2;
  const barReach = centerline * CLOSED_BAR_REACH;
  return (x, y) => {
    let mask = 0;
    if (Math.abs(y) <= halfStroke && Math.abs(x) <= barReach) mask |= RING.bar;
    if (Math.abs(Math.sqrt(x * x + y * y) - centerline) <= halfStroke) {
      const turn = (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1;
      if ((turn * NO_DATA_DOTS.count) % 1 < NO_DATA_DOTS.fraction) mask |= RING.dotted;
    }
    return mask;
  };
}

/** Sorts a ghost image's samples: on the outline or an eye, inside the body, or inside and not on it. */
function ghostClassifier(): (x: number, y: number) => number {
  const { unit } = ghostGeometry();
  return (x, y) => {
    const u = GHOST_BOX / 2 + x / unit;
    const v = GHOST_BOX / 2 + y / unit;
    // Outside the glyph's bounds (x 4 to 20, y 2 to 22, plus the half stroke) nothing is drawn.
    if (u < 4 - GHOST_HALF_STROKE || u > 20 + GHOST_HALF_STROKE || v < 2 - GHOST_HALF_STROKE || v > 22 + GHOST_HALF_STROKE) {
      return 0;
    }
    const line = onGhostLine(u, v);
    const body = inGhostBody(u, v);
    return (line ? GHOST.line : 0) | (body ? GHOST.body : 0) | (body && !line ? GHOST.bodyOnly : 0);
  };
}

interface Coverage {
  ring: { size: number; dotted: Uint8Array; bar: Uint8Array };
  ghost: { size: number; line: Uint8Array; bodyOnly: Uint8Array; body: Uint8Array };
}

const coverageByRatio = new Map<number, Coverage>();

function coverage(pixelRatio: number): Coverage {
  const cached = coverageByRatio.get(pixelRatio);
  if (cached) return cached;
  const ring = countSamples(imageGeometry().half, pixelRatio, 2, ringClassifier());
  const ghost = countSamples(ghostGeometry().half, pixelRatio, 3, ghostClassifier());
  const result: Coverage = {
    ring: { size: ring.size, dotted: ring.counts[0], bar: ring.counts[1] },
    ghost: { size: ghost.size, line: ghost.counts[0], bodyOnly: ghost.counts[1], body: ghost.counts[2] },
  };
  coverageByRatio.set(pixelRatio, result);
  return result;
}

const cache = new Map<string, Readonly<Record<MarkImageId, RasterImage>>>();

/**
 * Every mark image in one theme's colors, drawn once per theme and pixel ratio. The shapes are
 * sampled once per pixel ratio; a theme only paints those counts in its colors.
 */
export function markImages(
  { ink, surface }: MarkColors,
  pixelRatio = IMAGE_PIXEL_RATIO,
): Readonly<Record<MarkImageId, RasterImage>> {
  const key = `${ink}/${surface}@${pixelRatio}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const { ring, ghost } = coverage(pixelRatio);
  const inkRgb = hexToRgb(ink);
  const surfaceRgb = hexToRgb(surface);

  const images = {
    [MARK_IMAGE.dotted]: paint(ring.size, [{ counts: ring.dotted, rgb: inkRgb }]),
    [MARK_IMAGE.bar]: paint(ring.size, [{ counts: ring.bar, rgb: inkRgb }]),
    [MARK_IMAGE.ghostBody]: paint(ghost.size, [{ counts: ghost.body, rgb: surfaceRgb }]),
    [MARK_IMAGE.ghostLine]: paint(ghost.size, [{ counts: ghost.line, rgb: inkRgb }]),
    [MARK_IMAGE.ghostSelected]: paint(ghost.size, [
      { counts: ghost.bodyOnly, rgb: inkRgb },
      { counts: ghost.line, rgb: surfaceRgb },
    ]),
  };
  cache.set(key, images);
  return images;
}
