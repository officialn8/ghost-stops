import { describe, expect, it } from "vitest";
import { MAP_PALETTE } from "./layers";
import {
  CLOSED_BAR_REACH,
  GHOST_DASHES,
  IMAGE_PIXEL_RATIO,
  MARK_IMAGE,
  NO_DATA_DOTS,
  imageGeometry,
  markImages,
  type RasterImage,
} from "./marks";

/** The alpha (0 to 1) at a point given in CSS px from the image's center. */
function alphaAt(image: RasterImage, x: number, y: number, pixelRatio = IMAGE_PIXEL_RATIO): number {
  const { half } = imageGeometry();
  const px = Math.floor((x + half) * pixelRatio);
  const py = Math.floor((y + half) * pixelRatio);
  return image.data[(py * image.width + px) * 4 + 3] / 255;
}

/** Walks the ring's centerline and counts the separate inked runs, and the inked share of it. */
function runsAroundRing(image: RasterImage) {
  const { centerline } = imageGeometry();
  const steps = 1440;
  const inked = Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI;
    return alphaAt(image, Math.cos(angle) * centerline, Math.sin(angle) * centerline) > 0.5;
  });
  const runs = inked.filter((on, i) => on && !inked[(i - 1 + steps) % steps]).length;
  return { runs, share: inked.filter(Boolean).length / steps };
}

describe("mark images", () => {
  const images = markImages(MAP_PALETTE.dark.ink);

  it("are square, sized for the pixel ratio, and drawn in the theme ink", () => {
    for (const id of Object.values(MARK_IMAGE)) {
      const image = images[id];
      expect(image.width).toBe(image.height);
      expect(image.width).toBe(2 * imageGeometry().half * IMAGE_PIXEL_RATIO);
      expect(image.data).toHaveLength(image.width * image.height * 4);
      expect([...image.data.slice(0, 3)]).toEqual([0xf2, 0xf1, 0xec]);
    }
    expect([...markImages(MAP_PALETTE.light.ink)[MARK_IMAGE.bar].data.slice(0, 3)]).toEqual([0x14, 0x15, 0x18]);
  });

  it("break the ghost ring into PresenceMark's dashes", () => {
    const { runs, share } = runsAroundRing(images[MARK_IMAGE.dashed]);
    expect(GHOST_DASHES.count).toBe(7);
    expect(runs).toBe(GHOST_DASHES.count);
    expect(share).toBeCloseTo(2 / 3.6, 1);
  });

  it("dot the no-data ring", () => {
    const { runs, share } = runsAroundRing(images[MARK_IMAGE.dotted]);
    expect(runs).toBe(NO_DATA_DOTS.count);
    expect(share).toBeCloseTo(1 / 3, 1);
  });

  it("draw only the closed mark's bar, across the middle, leaving the ring to the circle layer", () => {
    const bar = images[MARK_IMAGE.bar];
    const { centerline } = imageGeometry();
    expect(alphaAt(bar, 0, 0)).toBe(1);
    expect(alphaAt(bar, centerline * CLOSED_BAR_REACH * 0.8, 0)).toBe(1);
    expect(alphaAt(bar, centerline * CLOSED_BAR_REACH * 1.2, 0)).toBe(0);
    expect(alphaAt(bar, 0, -centerline)).toBe(0);
    expect(runsAroundRing(bar).runs).toBe(0);
  });

  it("leave the hole inside the rings empty", () => {
    expect(alphaAt(images[MARK_IMAGE.dashed], 0, 0)).toBe(0);
    expect(alphaAt(images[MARK_IMAGE.dotted], 0, 0)).toBe(0);
  });

  it("are drawn once per ink", () => {
    expect(markImages(MAP_PALETTE.dark.ink)).toBe(images);
  });
});
