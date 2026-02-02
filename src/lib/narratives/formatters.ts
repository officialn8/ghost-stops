/**
 * Value Formatters
 *
 * Format raw fact values for display in narratives and UI.
 *
 * CONVENTION: Percents are stored as decimals (0.52 = 52%).
 * All formatters handle this convention consistently.
 */

import type { ValueType } from "@/types/narrative";

// ═══════════════════════════════════════════════════════════════
// CORE FORMATTERS
// ═══════════════════════════════════════════════════════════════

/**
 * Format a number with thousands separators.
 * Examples: 2450 → "2,450", 1234567 → "1,234,567"
 */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a decimal as a percentage.
 * Examples: 0.52 → "52%", -0.12 → "-12%", 0.1567 → "16%"
 *
 * CONVENTION: Input is a decimal (0.52 = 52%), output is "52%"
 */
export function formatPercent(value: number, decimals = 0): string {
  const percentage = value * 100;
  const formatted = Math.abs(percentage).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  // Always show sign for non-zero values (except when it's positive change displayed positively)
  if (percentage < 0) {
    return `-${formatted}%`;
  }
  return `${formatted}%`;
}

/**
 * Format a change percentage with explicit sign.
 * Examples: 0.12 → "+12%", -0.12 → "-12%", 0 → "0%"
 *
 * Use this for change metrics where direction matters.
 */
export function formatPercentChange(value: number, decimals = 0): string {
  const percentage = value * 100;
  const formatted = Math.abs(percentage).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  if (percentage > 0) {
    return `+${formatted}%`;
  } else if (percentage < 0) {
    return `-${formatted}%`;
  }
  return `${formatted}%`;
}

/**
 * Format currency (USD).
 * Examples: 1234.56 → "$1,235", 1234567 → "$1,234,567"
 */
export function formatCurrency(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ═══════════════════════════════════════════════════════════════
// GENERIC VALUE FORMATTER
// ═══════════════════════════════════════════════════════════════

/**
 * Format a value based on its type.
 *
 * @param value - The raw value (percents as decimals)
 * @param valueType - The type of value
 * @param isChange - Whether this is a change metric (adds +/- signs)
 */
export function formatValue(
  value: number,
  valueType: ValueType,
  isChange = false
): string {
  switch (valueType) {
    case "percent":
      return isChange ? formatPercentChange(value) : formatPercent(value);
    case "currency":
      return formatCurrency(value);
    case "number":
    default:
      return formatNumber(value);
  }
}

// ═══════════════════════════════════════════════════════════════
// DISPLAY VALUE WITH UNIT
// ═══════════════════════════════════════════════════════════════

/**
 * Format a value with its unit for full display.
 * Examples:
 *   - (2450, "number", "riders/day") → "2,450 riders/day"
 *   - (0.52, "percent", "%") → "52%"
 *   - (4200, "number", "lane-miles") → "4,200 lane-miles"
 */
export function formatValueWithUnit(
  value: number,
  valueType: ValueType,
  unit: string,
  isChange = false
): string {
  const formatted = formatValue(value, valueType, isChange);

  // Percent already includes the % symbol
  if (valueType === "percent") {
    return formatted;
  }

  // Currency already includes the $ symbol
  if (valueType === "currency") {
    return formatted;
  }

  // Add unit for numbers
  return `${formatted} ${unit}`;
}

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME LABEL
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a human-readable timeframe label.
 *
 * Examples:
 *   - (2001, 2001) → "2001"
 *   - (2010, 2024) → "2010–2024"
 *   - (null, null) → "current" or "rolling"
 *   - (2020, 2024) → "2020–2024"
 */
export function formatTimeframe(
  start?: number | null,
  end?: number | null,
  type: "range" | "since" | "as_of" = "range"
): string {
  if (start === null || start === undefined) {
    if (end === null || end === undefined) {
      return "current";
    }
    return `as of ${end}`;
  }

  if (end === null || end === undefined) {
    return `since ${start}`;
  }

  if (start === end) {
    return `${start}`;
  }

  switch (type) {
    case "since":
      return `since ${start}`;
    case "as_of":
      return `${start}–${end}`;
    case "range":
    default:
      return `${start}–${end}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// FACT LABEL GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a human-readable label for a fact key.
 */
export function getFactLabel(factKey: string): string {
  const labels: Record<string, string> = {
    ridership_2001_avg: "2001 Ridership",
    ridership_latest_avg: "Current Ridership",
    ridership_decline_pct: "Ridership Change",
    population_change: "Population Change",
    vehicle_ownership_pct: "Vehicle Ownership",
    jobs_walkshed_change: "Jobs Change",
    il_lane_miles_change: "IL Lane-Miles Added",
    airport_arrivals: "Airport Arrivals",
  };

  return labels[factKey] || factKey;
}

/**
 * Determine trend direction from a value.
 * Positive → "up", Negative → "down", Zero → "stable"
 */
export function getTrendDirection(
  value: number,
  threshold = 0.01
): "up" | "down" | "stable" {
  if (value > threshold) return "up";
  if (value < -threshold) return "down";
  return "stable";
}
