import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { DataStatus, ScoreTierName } from "@/types/station"

// Defined with the API shapes in src/types/station.ts; re-exported for existing importers.
export type { DataStatus, ScoreTierName }

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** How a tier is drawn: `ink` is the opacity of the station mark, `mark` its outline style. */
export type TierMark = "hollow-dashed" | "hollow" | "solid"

export interface TierStyle {
  tier: ScoreTierName
  ink: 0.44 | 0.72 | 1
  mark: TierMark
}

/**
 * The tier and how to draw it for a v2 score (0 to 100, a percentile over ranked stations), the
 * one place that maps tiers to ink (KTD10). The bands are quantiles by construction: 90 and up
 * is ghost, 75 to 89 fading, 50 to 74 quiet, under 50 healthy. A fading station keeps less ink,
 * so the quietest stations literally fade on the map.
 */
export function getTier(score: number): TierStyle {
  if (score >= 90) return { tier: "ghost", ink: 0.44, mark: "hollow-dashed" }
  if (score >= 75) return { tier: "fading", ink: 0.72, mark: "hollow" }
  if (score >= 50) return { tier: "quiet", ink: 1, mark: "hollow" }
  return { tier: "healthy", ink: 1, mark: "solid" }
}

/** A tier's ink and mark by name, for the list payload, which carries the tier but not the score. */
export function tierStyle(tier: ScoreTierName): TierStyle {
  return getTier(TIER_FLOOR[tier])
}

/** The lowest score in each tier: getTier's cutoffs, read back. */
const TIER_FLOOR: Readonly<Record<ScoreTierName, number>> = { ghost: 90, fading: 75, quiet: 50, healthy: 0 }

const TIER_NAMES: readonly ScoreTierName[] = ["ghost", "fading", "quiet", "healthy"]

/** A stored tier (StationMetrics.tier, "GHOST") as the UI names it ("ghost"); null for anything else. */
export function tierName(tier?: string | null): ScoreTierName | null {
  const name = tier?.toLowerCase()
  return TIER_NAMES.find((t) => t === name) ?? null
}

/**
 * A stored StationMetrics.dataStatus ("normal", "zero", "missing") in the UI's vocabulary; a
 * station with no metrics row is missing.
 */
export function toUiDataStatus(stored?: string | null): DataStatus {
  if (stored === "normal") return "available"
  if (stored === "zero") return "zero"
  return "missing"
}

export function normalizeDataStatus(status?: string | null): DataStatus {
  if (status === "available" || status === "missing" || status === "zero") {
    return status
  }
  return "missing"
}

export function clampGhostScore(score?: number | null): number {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return 0
  }
  return Math.max(0, Math.min(100, score))
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

// ═══════════════════════════════════════════════════════════════
// CTA LINES: the only hues on screen (R23)
// ═══════════════════════════════════════════════════════════════

/** The eight "L" lines in CTA's canonical order, which every line list is sorted by. */
export const CTA_LINE_ORDER = ["Red", "Blue", "Brown", "Green", "Orange", "Purple", "Pink", "Yellow"] as const

export type CTALine = (typeof CTA_LINE_ORDER)[number]

/**
 * The CTA's official line colors, the one table in the app (KTD10). They draw tracks, the line
 * bars under station names, and the line filter, and nothing else: UI chrome is ink on a surface.
 */
export const ctaLineColors: Readonly<Record<CTALine, string>> = {
  Red: "#C60C30",
  Blue: "#00A1DE",
  Brown: "#62361B",
  Green: "#009B3A",
  Orange: "#F9461C",
  Purple: "#522398",
  Pink: "#E27EA6",
  Yellow: "#F9E300",
}

/** A line's color; the Purple Express runs as Purple, and an unknown name gets neutral gray. */
export function getLineColor(line: string): string {
  if (line === "Purple Express") return ctaLineColors.Purple
  return ctaLineColors[line as CTALine] ?? "#6B6B6B"
}

/** The dark and light inks of the two themes, for text set on a line color. */
const LABEL_INKS = ["#141518", "#F2F1EC"] as const

/**
 * The ink for text set on a line color: whichever of the two theme inks contrasts more. Yellow,
 * Pink, Blue, Green, and Orange all take the dark one; white on them fails WCAG AA.
 */
export function lineLabelInk(line: string): string {
  const color = getLineColor(line)
  return contrastRatio(LABEL_INKS[0], color) >= contrastRatio(LABEL_INKS[1], color) ? LABEL_INKS[0] : LABEL_INKS[1]
}

// ═══════════════════════════════════════════════════════════════
// CONTRAST (WCAG 2.x)
// ═══════════════════════════════════════════════════════════════

export type Rgb = readonly [number, number, number]

/** "#RRGGBB" to its three 0-255 channels. */
export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** A color drawn at `alpha` over an opaque background, as the eye receives it. */
export function blend(color: Rgb, background: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => color[i] * alpha + background[i] * (1 - alpha)) as unknown as Rgb
}

function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** The WCAG contrast ratio of two opaque colors, from 1 to 21. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const [la, lb] = [a, b].map((c) => relativeLuminance(typeof c === "string" ? hexToRgb(c) : c))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
