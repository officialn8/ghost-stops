import { Ghost } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GHOST_SCALE } from "@/components/marks/PresenceMark";
import { hexToRgb } from "@/lib/utils";
import { MAP_PALETTE } from "./layers";
import {
  CLOSED_BAR_REACH,
  GHOST_BOX,
  GHOST_BOX_PER_RADIUS,
  GHOST_REACH,
  IMAGE_PIXEL_RATIO,
  IMAGE_RADIUS,
  MARK_IMAGE,
  NO_DATA_DOTS,
  STROKE_RATIO,
  ghostGeometry,
  imageGeometry,
  markImages,
  type RasterImage,
} from "./marks";

const DARK = MAP_PALETTE.dark;
const LIGHT = MAP_PALETTE.light;

/** The RGBA (alpha 0 to 1) at a point given in CSS px from the image's center. */
function pixelAt(image: RasterImage, half: number, x: number, y: number) {
  const px = Math.floor((x + half) * IMAGE_PIXEL_RATIO);
  const py = Math.floor((y + half) * IMAGE_PIXEL_RATIO);
  const i = (py * image.width + px) * 4;
  return { rgb: [...image.data.slice(i, i + 3)], alpha: image.data[i + 3] / 255 };
}

const ringAlpha = (image: RasterImage, x: number, y: number) => pixelAt(image, imageGeometry().half, x, y).alpha;

/** A point in the ghost glyph's 24-unit box, read from a ghost image. */
function glyphPixel(image: RasterImage, u: number, v: number) {
  const { unit, half } = ghostGeometry();
  return pixelAt(image, half, (u - GHOST_BOX / 2) * unit, (v - GHOST_BOX / 2) * unit);
}

/** Walks the ring's centerline and counts the separate inked runs, and the inked share of it. */
function runsAroundRing(image: RasterImage) {
  const { centerline } = imageGeometry();
  const steps = 1440;
  const inked = Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI;
    return ringAlpha(image, Math.cos(angle) * centerline, Math.sin(angle) * centerline) > 0.5;
  });
  const runs = inked.filter((on, i) => on && !inked[(i - 1 + steps) % steps]).length;
  return { runs, share: inked.filter(Boolean).length / steps };
}

describe("mark images", () => {
  const images = markImages(DARK);

  it("are square, sized for the pixel ratio, and drawn in the theme's colors", () => {
    for (const id of [MARK_IMAGE.dotted, MARK_IMAGE.bar]) {
      expect(images[id].width).toBe(images[id].height);
      expect(images[id].width).toBe(2 * imageGeometry().half * IMAGE_PIXEL_RATIO);
      expect(images[id].data).toHaveLength(images[id].width ** 2 * 4);
      expect([...images[id].data.slice(0, 3)]).toEqual(hexToRgb(DARK.ink));
    }
    for (const id of [MARK_IMAGE.ghostBody, MARK_IMAGE.ghostLine, MARK_IMAGE.ghostSelected]) {
      expect(images[id].width).toBe(2 * ghostGeometry().half * IMAGE_PIXEL_RATIO);
    }
    expect([...markImages(LIGHT)[MARK_IMAGE.bar].data.slice(0, 3)]).toEqual(hexToRgb(LIGHT.ink));
  });

  it("dot the no-data ring", () => {
    const { runs, share } = runsAroundRing(images[MARK_IMAGE.dotted]);
    expect(runs).toBe(NO_DATA_DOTS.count);
    expect(share).toBeCloseTo(1 / 3, 1);
    expect(ringAlpha(images[MARK_IMAGE.dotted], 0, 0)).toBe(0);
  });

  it("draw only the closed mark's bar, across the middle, leaving the ring to the circle layer", () => {
    const bar = images[MARK_IMAGE.bar];
    const { centerline } = imageGeometry();
    expect(ringAlpha(bar, 0, 0)).toBe(1);
    expect(ringAlpha(bar, centerline * CLOSED_BAR_REACH * 0.8, 0)).toBe(1);
    expect(ringAlpha(bar, centerline * CLOSED_BAR_REACH * 1.2, 0)).toBe(0);
    expect(ringAlpha(bar, 0, -centerline)).toBe(0);
    expect(runsAroundRing(bar).runs).toBe(0);
  });

  it("are drawn once per theme", () => {
    expect(markImages(DARK)).toBe(images);
    expect(markImages(LIGHT)).not.toBe(images);
  });
});

describe("the ghost glyph", () => {
  const images = markImages(DARK);
  const body = images[MARK_IMAGE.ghostBody];
  const line = images[MARK_IMAGE.ghostLine];
  const selected = images[MARK_IMAGE.ghostSelected];
  const surface = hexToRgb(DARK.surface);
  const ink = hexToRgb(DARK.ink);

  it("is lucide's Ghost, the glyph PresenceMark draws", () => {
    const markup = renderToStaticMarkup(createElement(Ghost));
    const paths = [...markup.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);
    expect(paths.sort()).toEqual(
      ["M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z", "M9 10h.01", "M15 10h.01"].sort(),
    );
    expect(markup).toContain('viewBox="0 0 24 24"');
  });

  it("has a box GHOST_SCALE times a ring mark's outer diameter, as in PresenceMark", () => {
    const ringOuterDiameter = 2 * IMAGE_RADIUS * (1 + STROKE_RATIO);
    expect(ghostGeometry().box).toBeCloseTo(GHOST_SCALE * ringOuterDiameter);
    expect(GHOST_BOX_PER_RADIUS * 5).toBeCloseTo(GHOST_SCALE * 2 * 5 * (1 + STROKE_RATIO));
    // The image holds the whole glyph, hem corners and stroke included.
    expect(ghostGeometry().half).toBeGreaterThanOrEqual(GHOST_REACH * ghostGeometry().unit);
  });

  it("fills the body with the opaque surface, so tracks never show through", () => {
    for (const [u, v] of [[12, 6], [12, 14], [6, 16], [18, 16], [9.5, 20]] as const) {
      expect(glyphPixel(body, u, v)).toEqual({ rgb: surface, alpha: 1 });
    }
    // The notches between the hem's points, and anything past the outline, stay clear.
    expect(glyphPixel(body, 12, 21.5).alpha).toBe(0);
    expect(glyphPixel(body, 12, 0.5).alpha).toBe(0);
    expect(glyphPixel(body, 2, 14).alpha).toBe(0);
  });

  it("draws the outline and eyes in ink, with the inside of the body clear", () => {
    for (const [u, v] of [[12, 2], [4, 15], [20, 15], [9, 10], [15, 10], [7, 19], [12, 19], [20, 22]] as const) {
      expect(glyphPixel(line, u, v)).toEqual({ rgb: ink, alpha: 1 });
    }
    expect(glyphPixel(line, 12, 6).alpha).toBe(0);
    expect(glyphPixel(line, 12, 14).alpha).toBe(0);
    expect(glyphPixel(line, 12, 21.5).alpha).toBe(0);
  });

  it("inverts when selected: an ink body with a surface outline and eyes", () => {
    expect(glyphPixel(selected, 12, 6)).toEqual({ rgb: ink, alpha: 1 });
    expect(glyphPixel(selected, 9, 10)).toEqual({ rgb: surface, alpha: 1 });
    expect(glyphPixel(selected, 4, 15)).toEqual({ rgb: surface, alpha: 1 });
    expect(glyphPixel(selected, 12, 21.5).alpha).toBe(0);
  });

  it("is drawn in the light theme's colors for the light theme", () => {
    const light = markImages(LIGHT);
    expect(glyphPixel(light[MARK_IMAGE.ghostBody], 12, 6).rgb).toEqual(hexToRgb(LIGHT.surface));
    expect(glyphPixel(light[MARK_IMAGE.ghostLine], 4, 15).rgb).toEqual(hexToRgb(LIGHT.ink));
  });
});
