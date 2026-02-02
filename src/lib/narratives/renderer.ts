/**
 * Template Renderer
 *
 * Renders archetype templates with fact values interpolated.
 * Uses a simplified Handlebars-like syntax:
 *   - {{factKey}} - Basic interpolation
 *   - {{factKey|format}} - Interpolation with format (number, percent)
 *   - {{#if condition}}...{{/if}} - Conditional blocks
 *   - {{#if condition}}...{{else}}...{{/if}} - If/else blocks
 *
 * This is a deterministic, no-AI renderer for journalism-grade trust.
 */

import type { FactMap, FactKey } from "@/types/narrative";
import { formatNumber, formatPercent } from "./formatters";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface RenderContext {
  stationName: string;
  facts: FactMap;
  latestAvg: number;
  computed: ComputedValues;
}

interface ComputedValues {
  ridership_decline_pct: number | null;
  population_declining: boolean;
  jobs_fell_faster: boolean;
  demographics_stable: boolean;
  jobs_stable: boolean;
  ridership_grew: boolean;
}

// ═══════════════════════════════════════════════════════════════
// COMPUTED VALUES
// ═══════════════════════════════════════════════════════════════

/**
 * Compute derived values from facts for template conditionals.
 */
function computeValues(facts: FactMap, latestAvg: number): ComputedValues {
  const baseline = facts.ridership_2001_avg?.value;
  const declinePct =
    baseline && baseline > 0 ? (baseline - latestAvg) / baseline : null;

  const populationChange = facts.population_change?.value ?? 0;
  const jobsChange = facts.jobs_walkshed_change?.value ?? 0;

  return {
    ridership_decline_pct: declinePct,
    population_declining: populationChange < -0.05,
    jobs_fell_faster:
      jobsChange < populationChange - 0.05 && jobsChange < -0.1,
    demographics_stable: Math.abs(populationChange) < 0.15,
    jobs_stable: Math.abs(jobsChange) < 0.15,
    ridership_grew: declinePct !== null && declinePct < 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALUE RESOLUTION
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve a variable name to its value.
 * Handles both direct fact keys and computed values.
 */
function resolveValue(
  key: string,
  context: RenderContext
): number | string | boolean | null {
  // Station name
  if (key === "stationName") {
    return context.stationName;
  }

  // Computed values
  if (key in context.computed) {
    return context.computed[key as keyof ComputedValues];
  }

  // Latest average (special case - not in facts table)
  if (key === "ridership_latest_avg") {
    return context.latestAvg;
  }

  // Fact values
  const factKey = key as FactKey;
  if (context.facts[factKey]) {
    return context.facts[factKey]!.value;
  }

  return null;
}

/**
 * Check if a condition is truthy for template conditionals.
 */
function checkCondition(condition: string, context: RenderContext): boolean {
  const value = resolveValue(condition, context);

  // Null/undefined is falsy
  if (value === null || value === undefined) return false;

  // Boolean values
  if (typeof value === "boolean") return value;

  // Numbers: 0 is falsy, non-zero is truthy
  if (typeof value === "number") return value !== 0;

  // Strings: empty is falsy
  if (typeof value === "string") return value.length > 0;

  return false;
}

// ═══════════════════════════════════════════════════════════════
// FORMATTING
// ═══════════════════════════════════════════════════════════════

/**
 * Format a value for display in the template.
 *
 * @param value - The raw value
 * @param format - Optional format specifier ("number", "percent")
 */
function formatValueForTemplate(
  value: number | string | boolean | null,
  format?: string
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  // Number formatting
  switch (format) {
    case "percent":
      return formatPercent(value);
    case "number":
      return formatNumber(value);
    default:
      // Auto-detect: small decimals are probably percents
      if (Math.abs(value) < 2 && value !== 0 && Math.abs(value) !== Math.floor(Math.abs(value))) {
        return formatPercent(value);
      }
      return formatNumber(value);
  }
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE PARSING
// ═══════════════════════════════════════════════════════════════

/**
 * Process conditional blocks: {{#if condition}}...{{/if}}
 * Also handles {{#if condition}}...{{else}}...{{/if}}
 */
function processConditionals(template: string, context: RenderContext): string {
  // Pattern for {{#if condition}}...{{/if}} with optional {{else}}
  const ifPattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

  return template.replace(ifPattern, (match, condition, content) => {
    const isTruthy = checkCondition(condition, context);

    // Check for else block
    const elseParts = content.split(/\{\{else\}\}/);

    if (elseParts.length === 2) {
      // Has else block
      return isTruthy ? elseParts[0] : elseParts[1];
    }

    // No else block
    return isTruthy ? content : "";
  });
}

/**
 * Process variable interpolation: {{variable}} or {{variable|format}}
 */
function processInterpolation(template: string, context: RenderContext): string {
  // Pattern for {{variable}} or {{variable|format}}
  const varPattern = /\{\{(\w+)(?:\|(\w+))?\}\}/g;

  return template.replace(varPattern, (match, variable, format) => {
    const value = resolveValue(variable, context);
    return formatValueForTemplate(value, format);
  });
}

/**
 * Clean up whitespace and empty lines from rendered template.
 */
function cleanupWhitespace(text: string): string {
  return text
    // Remove lines that are only whitespace
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n\n")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    // Trim
    .trim();
}

// ═══════════════════════════════════════════════════════════════
// MAIN RENDERER
// ═══════════════════════════════════════════════════════════════

/**
 * Render a narrative template with the given facts.
 *
 * @param template - The archetype template string
 * @param stationName - The station's display name
 * @param facts - The station's fact values
 * @param latestAvg - Current rolling 30-day average ridership
 * @returns Rendered markdown string
 */
export function renderTemplate(
  template: string,
  stationName: string,
  facts: FactMap,
  latestAvg: number
): string {
  const context: RenderContext = {
    stationName,
    facts,
    latestAvg,
    computed: computeValues(facts, latestAvg),
  };

  // Process in order: conditionals first (they may contain variables)
  let result = template;

  // Multiple passes for nested conditionals
  for (let i = 0; i < 3; i++) {
    const before = result;
    result = processConditionals(result, context);
    if (result === before) break;
  }

  // Then variable interpolation
  result = processInterpolation(result, context);

  // Cleanup
  result = cleanupWhitespace(result);

  return result;
}

/**
 * Render a complete narrative for a station.
 *
 * @param archetype - The archetype definition
 * @param stationName - The station's display name
 * @param facts - The station's fact values
 * @param latestAvg - Current rolling 30-day average ridership
 * @returns Object with rendered story and evidence fact keys used
 */
export function renderNarrative(
  archetype: { template: string; requiredFacts: string[]; optionalFacts: string[] },
  stationName: string,
  facts: FactMap,
  latestAvg: number
): { story: string; evidenceFactKeys: string[] } {
  const story = renderTemplate(archetype.template, stationName, facts, latestAvg);

  // Determine which facts were actually used (exist and have values)
  const allFactKeys = [...archetype.requiredFacts, ...archetype.optionalFacts];
  const evidenceFactKeys = allFactKeys.filter((key) => {
    const factKey = key as FactKey;
    return facts[factKey]?.value !== undefined;
  });

  // Always include ridership_latest_avg if we have baseline
  if (facts.ridership_2001_avg && !evidenceFactKeys.includes("ridership_latest_avg")) {
    evidenceFactKeys.push("ridership_latest_avg");
  }

  // Include computed decline if both exist
  if (facts.ridership_2001_avg && latestAvg > 0) {
    if (!evidenceFactKeys.includes("ridership_decline_pct")) {
      evidenceFactKeys.push("ridership_decline_pct");
    }
  }

  return { story, evidenceFactKeys };
}
