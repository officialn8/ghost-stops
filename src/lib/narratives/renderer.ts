/**
 * Template Renderer
 *
 * Renders an archetype template from a station's facts and the numbers on its score card.
 * Uses a simplified Handlebars-like syntax:
 *   - {{name}} - Basic interpolation
 *   - {{name|format}} - Interpolation with a format: number, percent (a level), change (signed)
 *   - {{#if name}}...{{/if}} - Conditional blocks, which may nest
 *   - {{#if name}}...{{else}}...{{/if}} - If/else blocks
 *
 * A name is either a computed value (`computeVariables` below) or a stored fact key. Every phrase
 * that describes a change is computed here from the sign of the number it sits beside, so a story
 * can never say "has fallen to" over a rise (R19). The renderer also reports which stored facts
 * the text drew on and any name it could not fill, so the narrative job can refuse a story that
 * cites a fact the station does not have.
 *
 * This is a deterministic, no-AI renderer for journalism-grade trust.
 */

import { formatCalendarDate, isLevelChange } from "@/lib/format";
import type { FactKey, NarrativeContext } from "@/types/narrative";
import { formatChange, formatNumber, formatPercent } from "./formatters";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RenderedNarrative {
  /** Markdown paragraphs separated by blank lines. */
  story: string;
  /** Stored facts the story drew on, in a fixed order. */
  evidenceFactKeys: FactKey[];
  /** Names the template needed that had no value: a fact the station lacks, or a template bug. */
  missing: string[];
}

interface Variable {
  /** Null when the inputs behind it are missing; a condition on it is then false and cites nothing. */
  value: string | number | boolean | null;
  /** The stored facts this value is drawn from. */
  facts: readonly FactKey[];
}

/** Tracks what one render cited and what it could not fill. */
interface Usage {
  facts: Set<FactKey>;
  missing: string[];
}

// ═══════════════════════════════════════════════════════════════
// COMPUTED VALUES
// ═══════════════════════════════════════════════════════════════

/** The year of the long-run comparison: the earliest year in the ridership data. */
const BASELINE_FACT: FactKey = "ridership_2001_avg";
const BASELINE_YEAR = "2001";

/** Above this change, population or jobs read as declining. */
const DECLINE_THRESHOLD = -0.05;

/** Changes the renderer reads a direction from. */
export type Direction = "up" | "down" | "level";

/** The long-run direction: a change that rounds to a whole 0% is level ("has held near"). */
function direction(change: number | null): Direction | null {
  if (change === null) return null;
  if (Math.round(Math.abs(change * 100)) === 0) return "level";
  return change > 0 ? "up" : "down";
}

/**
 * The recent direction a story tells, and the narrative job selects its archetype by: the
 * year-over-year change, else the change since 2019, both in percent (4 is +4%). Level when the
 * change prints as 0% (`isLevelChange`, the score card's band), so a story never says "losing
 * riders" beside a card that says "Unchanged". The small-station badge keeps its strict sign, so
 * a change under 0.05 points can badge a station "small but growing" beside a story holding steady.
 */
export function recentDirection(yoyChangePct: number | null, vs2019Pct: number | null): Direction | null {
  const recent = yoyChangePct ?? vs2019Pct;
  if (recent === null) return null;
  const change = recent / 100;
  if (isLevelChange(change)) return "level";
  return change > 0 ? "up" : "down";
}

const LONG_RUN_VERBS: Record<Direction, string> = {
  up: "has grown to",
  down: "has fallen to",
  level: "has held near",
};

const VS_2019_CLAUSES: Record<Direction, string> = {
  up: ", above its pre-pandemic level",
  down: ", still below its pre-pandemic level",
  level: ", about level with its pre-pandemic ridership",
};

/** Em dashes are never rendered (R19); one arriving in stored text becomes a comma. */
function withoutEmDash(text: string): string {
  return text.replace(/\s*\u2014\s*/g, ", ");
}

/** "January 2026". */
const formatMonthYear = (date: string) => formatCalendarDate(date, { month: "long", year: "numeric" });

/** "March 15, 2026". */
const formatFullDate = (date: string) => formatCalendarDate(date, { month: "long", day: "numeric", year: "numeric" });

/**
 * A closure reason worded "Closed for ..." reads as a purpose after "has been closed since
 * January 2026"; any other wording is quoted as the reason given.
 */
function closureWording(reason: string): { purpose: string | null; note: string | null } {
  const text = withoutEmDash(reason.trim()).replace(/\.$/, "");
  const purpose = text.match(/^closed\s+(.+)$/i)?.[1] ?? null;
  return purpose ? { purpose, note: null } : { purpose: null, note: text || null };
}

/** Every computed value a template can name, each with the facts it is drawn from. */
function computeVariables(ctx: NarrativeContext): Record<string, Variable> {
  const v = (value: Variable["value"], facts: readonly FactKey[] = []): Variable => ({ value, facts });
  /** A yes-or-no value that is null, not false, when its input is missing. */
  const when = (known: boolean, test: () => boolean, facts: readonly FactKey[] = []) => v(known ? test() : null, facts);

  const fact = (key: FactKey) => ctx.facts[key]?.value ?? null;
  const BASE: readonly FactKey[] = [BASELINE_FACT];
  const POP: readonly FactKey[] = ["population_change"];
  const JOBS: readonly FactKey[] = ["jobs_walkshed_change"];
  const CARS: readonly FactKey[] = ["vehicle_ownership_pct"];
  const LANES: readonly FactKey[] = ["il_lane_miles_change"];

  const storedBaseline = fact(BASELINE_FACT);
  const baseline = storedBaseline !== null && storedBaseline > 0 ? storedBaseline : null;
  const baselineChange = baseline !== null && ctx.avg12m !== null ? ctx.avg12m / baseline - 1 : null;
  const longRun = direction(baselineChange);
  const population = fact("population_change");
  const jobs = fact("jobs_walkshed_change");
  const cars = fact("vehicle_ownership_pct");
  const lanes = fact("il_lane_miles_change");
  const yoy = ctx.yoyChangePct === null ? null : ctx.yoyChangePct / 100;
  const vs2019 = ctx.vs2019Pct === null ? null : ctx.vs2019Pct / 100;
  const vs2019Direction = direction(vs2019);
  const recent = recentDirection(ctx.yoyChangePct, ctx.vs2019Pct);
  const closure = ctx.closure === null ? null : closureWording(ctx.closure.reason);

  return {
    stationName: v(withoutEmDash(ctx.stationName)),

    // The card's numbers
    today_avg: v(ctx.avg12m),
    has_today: v(ctx.avg12m === null ? null : true),
    yoy_change: v(yoy),
    has_yoy: v(yoy === null ? null : true),
    vs2019_change: v(vs2019),
    has_vs2019: v(vs2019 === null ? null : true),
    vs2019_clause: v(vs2019Direction === null ? null : VS_2019_CLAUSES[vs2019Direction]),
    recent_up: when(recent !== null, () => recent === "up"),
    recent_down: when(recent !== null, () => recent === "down"),
    small_station: v(ctx.badge === null ? null : true),
    unhealthy: v(ctx.tier !== null && ctx.tier !== "HEALTHY" ? true : null),
    tier_word: v(ctx.tier === null ? null : ctx.tier.toLowerCase()),

    // The long run: the 2001 average against the 12-month average
    has_baseline: v(baselineChange === null ? null : true, BASE),
    baseline_year: v(baseline === null ? null : BASELINE_YEAR, BASE),
    baseline_avg: v(baseline, BASE),
    baseline_change: v(baselineChange, BASE),
    baseline_verb: v(longRun === null ? null : LONG_RUN_VERBS[longRun], BASE),
    ridership_grew: when(longRun !== null, () => longRun === "up", BASE),
    ridership_fell: when(longRun !== null, () => longRun === "down", BASE),

    // The neighborhood
    population_declining: when(population !== null, () => population! < DECLINE_THRESHOLD, POP),
    demographics_stable: when(population !== null, () => Math.abs(population!) < 0.15, POP),
    jobs_declining: when(jobs !== null, () => jobs! < DECLINE_THRESHOLD, JOBS),
    jobs_stable: when(jobs !== null, () => Math.abs(jobs!) < 0.15, JOBS),
    jobs_fell_faster: when(
      population !== null && jobs !== null,
      () => population! < DECLINE_THRESHOLD && jobs! < population! - 0.05,
      [...POP, ...JOBS],
    ),
    jobs_fell_instead: when(
      population !== null && jobs !== null,
      () => population! >= DECLINE_THRESHOLD && jobs! < DECLINE_THRESHOLD,
      [...POP, ...JOBS],
    ),
    fell_with_jobs: when(
      longRun !== null && jobs !== null,
      () => longRun === "down" && jobs! < DECLINE_THRESHOLD,
      [...BASE, ...JOBS],
    ),
    car_heavy: when(cars !== null, () => cars! >= 0.4, CARS),
    lane_miles_added: when(lanes !== null, () => lanes! > 0, LANES),
    lane_miles_removed: when(lanes !== null, () => lanes! < 0, LANES),
    lane_miles_abs: v(lanes === null ? null : Math.abs(lanes), LANES),

    // A closure next door that set year-over-year aside
    nearby_station: v(ctx.nearbyClosure === null ? null : withoutEmDash(ctx.nearbyClosure.stationName)),
    nearby_change: v(ctx.nearbyClosure?.change ?? null),
    nearby_month: v(ctx.nearbyClosure === null ? null : formatMonthYear(ctx.nearbyClosure.date)),

    // A closure
    closed_since: v(ctx.closure === null ? null : formatMonthYear(ctx.closure.startDate)),
    closure_purpose: v(closure?.purpose ?? null),
    closure_note: v(closure?.note ?? null),
    reopens_on: v(ctx.closure?.endDate ? formatFullDate(ctx.closure.endDate) : null),
  };
}

// ═══════════════════════════════════════════════════════════════
// VALUE RESOLUTION
// ═══════════════════════════════════════════════════════════════

/** A computed value, or else a stored fact by its key. */
function resolve(name: string, variables: Record<string, Variable>, ctx: NarrativeContext): Variable {
  if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name];
  const key = name as FactKey;
  return { value: ctx.facts[key]?.value ?? null, facts: [key] };
}

/** True for `true`, a non-empty string, or any number: a fact stored as 0 is present. */
function isTruthy(value: Variable["value"]): boolean {
  if (value === null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length > 0;
  return value;
}

// ═══════════════════════════════════════════════════════════════
// FORMATTING
// ═══════════════════════════════════════════════════════════════

/**
 * Format a value for display in the template.
 *
 * @param value - The raw value; percents and changes are decimals (0.52 = 52%)
 * @param format - Optional format specifier ("number", "percent", "change")
 */
function formatValueForTemplate(value: Variable["value"], format?: string): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";

  switch (format) {
    case "percent":
      return formatPercent(value);
    case "change":
      return formatChange(value);
    case "number":
    default:
      return formatNumber(value);
  }
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE PARSING
// ═══════════════════════════════════════════════════════════════

/** An {{#if}} block with no other {{#if}} inside it, so its {{else}}, if any, is its own. */
const INNERMOST_IF = /\{\{#if\s+(\w+)\}\}((?:(?!\{\{#if\s)[\s\S])*?)\{\{\/if\}\}/g;

/**
 * Process conditional blocks, innermost first, so text after a nested block that renders
 * nothing is kept. A condition cites its facts when the branch it chose renders text.
 */
function processConditionals(
  template: string,
  resolveName: (name: string) => Variable,
  usage: Usage,
): string {
  let result = template;
  for (;;) {
    const next = result.replace(INNERMOST_IF, (_match, name: string, content: string) => {
      const variable = resolveName(name);
      const [whenTrue, whenFalse = ""] = content.split("{{else}}");
      const branch = isTruthy(variable.value) ? whenTrue : whenFalse;
      if (variable.value !== null && branch.trim().length > 0) {
        for (const key of variable.facts) usage.facts.add(key);
      }
      return branch;
    });
    if (next === result) return result;
    result = next;
  }
}

/**
 * Process variable interpolation: {{variable}} or {{variable|format}}. A value that cannot be
 * filled is reported by the facts it lacks, or by its own name when no fact explains it.
 */
function processInterpolation(
  template: string,
  resolveName: (name: string) => Variable,
  hasFact: (key: FactKey) => boolean,
  usage: Usage,
): string {
  return template.replace(/\{\{(\w+)(?:\|(\w+))?\}\}/g, (_match, name: string, format?: string) => {
    const variable = resolveName(name);
    for (const key of variable.facts) usage.facts.add(key);
    if (variable.value === null) {
      const lacking = variable.facts.filter((key) => !hasFact(key));
      for (const missing of lacking.length > 0 ? lacking : [name]) {
        if (!usage.missing.includes(missing)) usage.missing.push(missing);
      }
    }
    return formatValueForTemplate(variable.value, format);
  });
}

/**
 * Clean up whitespace and empty lines from rendered template.
 */
function cleanupWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n");
}

/** Evidence in a fixed order: the long-run figure first, then the neighborhood. */
const EVIDENCE_ORDER: readonly FactKey[] = [
  "ridership_2001_avg",
  "population_change",
  "vehicle_ownership_pct",
  "jobs_walkshed_change",
  "il_lane_miles_change",
  "airport_arrivals",
];

function orderEvidence(keys: Iterable<FactKey>): FactKey[] {
  const rank = (key: FactKey) => {
    const i = EVIDENCE_ORDER.indexOf(key);
    return i === -1 ? EVIDENCE_ORDER.length : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// ═══════════════════════════════════════════════════════════════
// MAIN RENDERER
// ═══════════════════════════════════════════════════════════════

/**
 * Render a template for one station.
 *
 * @param template - The archetype template string
 * @param context - The station's facts and score card numbers
 * @returns The story, the stored facts it cited, and any name it could not fill
 */
export function renderTemplate(template: string, context: NarrativeContext): RenderedNarrative {
  const variables = computeVariables(context);
  const resolveName = (name: string) => resolve(name, variables, context);
  const hasFact = (key: FactKey) => context.facts[key] !== undefined;
  const usage: Usage = { facts: new Set(), missing: [] };

  const withBranches = processConditionals(template, resolveName, usage);
  const text = cleanupWhitespace(processInterpolation(withBranches, resolveName, hasFact, usage));
  // A tag left over means unbalanced template syntax, which no story should carry.
  if (/\{\{|\}\}/.test(text)) usage.missing.push("template syntax");

  // Only a fact the station has is evidence; one it lacks is reported as missing instead.
  const evidence = [...usage.facts].filter(hasFact);
  return { story: text, evidenceFactKeys: orderEvidence(evidence), missing: usage.missing };
}

/**
 * Render a complete narrative for a station: the template, plus the facts the archetype stands
 * on, which are evidence even where the text does not quote them, and missing when absent.
 */
export function renderNarrative(
  archetype: { template: string; requiredFacts: readonly FactKey[] },
  context: NarrativeContext
): RenderedNarrative {
  const rendered = renderTemplate(archetype.template, context);
  const absent = archetype.requiredFacts.filter((key) => context.facts[key] === undefined);
  const present = archetype.requiredFacts.filter((key) => context.facts[key] !== undefined);
  return {
    story: rendered.story,
    evidenceFactKeys: orderEvidence(new Set([...rendered.evidenceFactKeys, ...present])),
    missing: [...rendered.missing, ...absent.filter((key) => !rendered.missing.includes(key))],
  };
}
