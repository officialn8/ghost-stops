import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { DataStatus, ScoreTierName } from "@/types/station"

// Defined with the API shapes in src/types/station.ts; re-exported for existing importers.
export type { DataStatus, ScoreTierName }

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Glass effect utilities
export function glass(opacity: number = 0.72, blur: number = 16) {
  return {
    backgroundColor: `rgba(255, 255, 255, ${opacity})`,
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    border: '1px solid rgba(15, 23, 42, 0.08)',
  }
}

// Ghost score color mapping on the v1 scale (cutoffs 65/50/35/20, set for the v1 composite's
// ceiling of about 75). Knowingly miscalibrated for score v2's 0-100 percentile until U18
// replaces it with `getTier`.
export function getGhostScoreColor(score: number): string {
  if (score >= 65) return "#DC2626" // red-600 (top tier ghost)
  if (score >= 50) return "#EA580C" // orange-600
  if (score >= 35) return "#F59E0B" // amber-500
  if (score >= 20) return "#84CC16" // lime-500
  return "#22C55E" // green-500
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

// CTA line color mapping
export const ctaLineColors = {
  "Red": "#C60C30",
  "Blue": "#00A1DE",
  "Brown": "#62361B",
  "Green": "#009B3A",
  "Orange": "#F9461C",
  "Purple": "#522398",
  "Purple Express": "#522398",
  "Pink": "#E27EA6",
  "Yellow": "#F9E300"
} as const

export function getLineColor(line: string): string {
  return ctaLineColors[line as keyof typeof ctaLineColors] || "#666666"
}