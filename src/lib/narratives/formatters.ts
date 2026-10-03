/**
 * Value Formatters
 *
 * Format raw fact values for display in narratives and UI.
 *
 * CONVENTION: Percents are stored as decimals (0.52 = 52%).
 * All formatters handle this convention consistently.
 */

import type { FactKey, ValueType } from "@/types/narrative";

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
  const { formatted, sign } = roundPercent(value, decimals);
  return sign < 0 ? `-${formatted}%` : `${formatted}%`;
}

/**
 * A decimal as a rounded, unsigned percentage, and the sign of what is shown: a value that
 * rounds to zero has sign 0, so it never prints as "-0%" or "+0%".
 */
function roundPercent(value: number, decimals: number): { formatted: string; sign: -1 | 0 | 1 } {
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value * 100) * factor) / factor;
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return { formatted, sign: rounded === 0 ? 0 : value < 0 ? -1 : 1 };
}

/**
 * Format a change percentage with explicit sign.
 * Examples: 0.12 → "+12%", -0.12 → "-12%", 0 → "0%"
 *
 * Use this for change metrics where direction matters.
 */
export function formatPercentChange(value: number, decimals = 0): string {
  const { formatted, sign } = roundPercent(value, decimals);
  if (sign > 0) return `+${formatted}%`;
  if (sign < 0) return `-${formatted}%`;
  return `${formatted}%`;
}

/**
 * A change as narratives and the score card show it: always signed, in whole percents, with one
 * decimal when a whole percent would read as zero, so a small rise still shows as one.
 * Examples: 0.0398 → "+4%", -0.384 → "-38%", 0.003 → "+0.3%", 0.0004 → "0%"
 */
export function formatChange(value: number): string {
  const percent = Math.abs(value * 100);
  if (Math.round(percent * 10) === 0) return "0%";
  return formatPercentChange(value, Math.round(percent) >= 1 ? 0 : 1);
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

/** The one label table for fact keys, shared by the detail route and the fact cards. */
const FACT_LABELS: Record<FactKey, string> = {
  ridership_2001_avg: "2001 Ridership",
  ridership_2006_avg: "2006 Ridership",
  ridership_2012_avg: "2012 Ridership",
  ridership_latest_avg: "Current Ridership",
  ridership_decline_pct: "Ridership Change",
  population_change: "Population Change",
  vehicle_ownership_pct: "Vehicle Ownership",
  jobs_walkshed_change: "Jobs Change",
  il_lane_miles_change: "IL Lane-Miles Added",
  airport_arrivals: "Airport Arrivals",
  station_opened: "Station Opened",
};

/**
 * Generate a human-readable label for a fact key; a key the table lacks is title-cased
 * ("bus_routes_cut" → "Bus Routes Cut").
 */
export function getFactLabel(factKey: string): string {
  return (
    FACT_LABELS[factKey as FactKey] ??
    factKey.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
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
