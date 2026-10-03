/**
 * Narrative Archetypes
 *
 * Story templates that explain a station's ridership. Two kinds:
 *
 * - Fact archetypes explain a long decline (or a station that resisted one) from the station's
 *   stored facts. Each has required facts, scoring logic, and a template; the scoring logic
 *   returns 0-1 confidence based on how well facts match the archetype, and the highest-scoring
 *   one is chosen for a station whose tier is not healthy.
 * - Rule archetypes (growth, stable, recent decline, airport, closed, no recent data) are chosen
 *   by rule in src/lib/narratives/generate.ts, from the numbers the score card shows.
 *
 * Every change phrase in a template comes from the renderer, which words it from the sign of the
 * number beside it, so no template reads a rise as a fall. Templates carry no em dashes or emoji.
 */

import type { ArchetypeDefinition, ArchetypeKey, FactKey, NarrativeArchetype, NarrativeFacts } from "@/types/narrative";

// ═══════════════════════════════════════════════════════════════
// ARCHETYPE METADATA
// ═══════════════════════════════════════════════════════════════

export const ARCHETYPE_TITLES: Record<ArchetypeKey, string> = {
  suburban_shift: "The Suburban Shift",
  car_culture: "Car Culture Won",
  jobs_exodus: "The Jobs Moved Away",
  service_erosion: "Service Erosion",
  resilient_anomaly: "Against the Odds",
  airport_gateway: "Airport Gateway",
  growth: "Gaining Riders",
  stable: "Holding Its Own",
  recent_decline: "Losing Riders",
  closed: "Closed",
  no_recent_data: "No Recent Data",
};

/** Shown beside the title by the current UI; never part of a rendered story. */
export const ARCHETYPE_EMOJIS: Record<ArchetypeKey, string> = {
  suburban_shift: "🏡",
  car_culture: "🚗",
  jobs_exodus: "💼",
  service_erosion: "⏰",
  resilient_anomaly: "💪",
  airport_gateway: "✈️",
  growth: "📈",
  stable: "⚖️",
  recent_decline: "📉",
  closed: "🚧",
  no_recent_data: "📭",
};

// ═══════════════════════════════════════════════════════════════
// SHARED TEMPLATE PIECES
// ═══════════════════════════════════════════════════════════════

/** The long run, 2001 against the 12-month average, without a closing period. */
const LONG_RUN =
  "In {{baseline_year}}, {{stationName}} averaged **{{baseline_avg|number}}** riders a day. " +
  "Its 12-month average {{baseline_verb}} **{{today_avg|number}}**, a **{{baseline_change|change}}** change";

const TODAY = "{{#if has_today}}Over the last 12 months it averaged **{{today_avg|number}}** riders a day.{{/if}}";

const YEAR_OVER_YEAR =
  "{{#if has_yoy}}The last 90 days show a **{{yoy_change|change}}** change from the same days a year earlier.{{/if}}";

const VS_2019 =
  "{{#if has_vs2019}}Its 12-month average is a **{{vs2019_change|change}}** change from 2019{{vs2019_clause}}.{{/if}}";

const paragraphs = (...lines: string[]) => lines.join("\n\n");

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate ridership decline as a decimal (0.4 = 40% decline).
 * Returns null if 2001 data is missing or zero to prevent divide-by-zero.
 */
function calculateDecline(facts: NarrativeFacts, latestAvg: number): number | null {
  const baseline = facts.ridership_2001_avg?.value;
  if (!baseline || baseline <= 0) return null;
  return (baseline - latestAvg) / baseline;
}

/**
 * Check if all required facts exist in the fact map.
 */
function hasRequiredFacts(facts: NarrativeFacts, required: FactKey[]): boolean {
  return required.every((key) => facts[key]?.value !== undefined);
}

// ═══════════════════════════════════════════════════════════════
// FACT ARCHETYPES
// ═══════════════════════════════════════════════════════════════

/**
 * The Suburban Shift
 *
 * Ridership dropped significantly while population remained stable or declined.
 * The neighborhood didn't grow, and neither did transit use.
 */
const suburbanShift: NarrativeArchetype = {
  key: "suburban_shift",
  title: ARCHETYPE_TITLES.suburban_shift,
  emoji: ARCHETYPE_EMOJIS.suburban_shift,
  requiredFacts: ["ridership_2001_avg", "population_change"],
  scoringLogic: (facts, latestAvg) => {
    if (!hasRequiredFacts(facts, ["ridership_2001_avg", "population_change"])) {
      return 0;
    }

    const decline = calculateDecline(facts, latestAvg);
    if (decline === null) return 0;

    const populationChange = facts.population_change?.value ?? 0;

    // High score if: ridership down significantly AND population stable/declining
    if (decline > 0.4 && populationChange < 0.1) return 0.9;
    if (decline > 0.25 && populationChange < 0.2) return 0.7;
    if (decline > 0.15 && populationChange < 0.15) return 0.5;

    return 0;
  },
  template: paragraphs(
    `${LONG_RUN}.`,
    "{{#if population_change}}The neighborhood within half a mile saw a **{{population_change|change}}** change in population since 2010{{#if population_declining}}, suggesting residents have left the area{{/if}}.{{/if}}",
    "{{#if vehicle_ownership_pct}}Today, **{{vehicle_ownership_pct|percent}}** of households within walking distance own two or more vehicles{{#if car_heavy}}, a hallmark of car-dependent living{{/if}}.{{/if}}",
    YEAR_OVER_YEAR,
  ),
};

/**
 * Car Culture Won
 *
 * High vehicle ownership in the walkshed combined with ridership decline.
 * The car became the default, and transit lost.
 */
const carCulture: NarrativeArchetype = {
  key: "car_culture",
  title: ARCHETYPE_TITLES.car_culture,
  emoji: ARCHETYPE_EMOJIS.car_culture,
  requiredFacts: ["ridership_2001_avg", "vehicle_ownership_pct"],
  scoringLogic: (facts, latestAvg) => {
    if (!hasRequiredFacts(facts, ["ridership_2001_avg", "vehicle_ownership_pct"])) {
      return 0;
    }

    const decline = calculateDecline(facts, latestAvg);
    if (decline === null) return 0;

    const vehicleOwnership = facts.vehicle_ownership_pct?.value ?? 0;

    // High score if: high vehicle ownership AND ridership dropped
    if (vehicleOwnership > 0.5) {
      if (decline > 0.3) return 0.85;
      if (decline > 0.15) return 0.6;
    }

    return 0;
  },
  // Chosen only above 50% ownership, which is what "the car is king" claims.
  template: paragraphs(
    "{{stationName}} sits in a neighborhood where the car is king: **{{vehicle_ownership_pct|percent}}** of nearby households own two or more vehicles.",
    "{{#if lane_miles_added}}Illinois added **{{lane_miles_abs|number}}** lane-miles of roadway between 2000 and 2023, making driving ever more convenient.{{/if}}{{#if lane_miles_removed}}Illinois's roads lost **{{lane_miles_abs|number}}** lane-miles between 2000 and 2023.{{/if}}",
    `${LONG_RUN}{{#if ridership_fell}}, as residents chose their cars over the L{{/if}}.`,
    YEAR_OVER_YEAR,
  ),
};

/**
 * The Jobs Moved Away
 *
 * Employment in the walkshed declined significantly, taking transit riders with it.
 */
const jobsExodus: NarrativeArchetype = {
  key: "jobs_exodus",
  title: ARCHETYPE_TITLES.jobs_exodus,
  emoji: ARCHETYPE_EMOJIS.jobs_exodus,
  requiredFacts: ["ridership_2001_avg", "jobs_walkshed_change"],
  scoringLogic: (facts, latestAvg) => {
    if (!hasRequiredFacts(facts, ["ridership_2001_avg", "jobs_walkshed_change"])) {
      return 0;
    }

    const decline = calculateDecline(facts, latestAvg);
    if (decline === null) return 0;

    const jobsChange = facts.jobs_walkshed_change?.value ?? 0;

    // High score if: jobs declined significantly AND ridership dropped
    if (jobsChange < -0.2) {
      if (decline > 0.3) return 0.9;
      if (decline > 0.15) return 0.65;
    }

    return 0;
  },
  template: paragraphs(
    "{{#if jobs_declining}}When jobs leave, riders follow. {{/if}}The half-mile walkshed around {{stationName}} saw a **{{jobs_walkshed_change|change}}** change in employment since 2010.",
    "{{#if population_change}}Population in the area saw a **{{population_change|change}}** change{{#if jobs_fell_faster}}, but jobs fell even faster{{/if}}{{#if jobs_fell_instead}}, while jobs fell{{/if}}.{{/if}}",
    `${LONG_RUN}{{#if fell_with_jobs}}, at a station serving a neighborhood that lost its economic anchor{{/if}}.`,
    YEAR_OVER_YEAR,
  ),
};

/**
 * Service Erosion
 *
 * Ridership declined but demographics remained stable.
 * This is the fallback archetype when external factors don't explain the decline.
 */
const serviceErosion: NarrativeArchetype = {
  key: "service_erosion",
  title: ARCHETYPE_TITLES.service_erosion,
  emoji: ARCHETYPE_EMOJIS.service_erosion,
  requiredFacts: ["ridership_2001_avg"],
  scoringLogic: (facts, latestAvg) => {
    if (!hasRequiredFacts(facts, ["ridership_2001_avg"])) {
      return 0;
    }

    const decline = calculateDecline(facts, latestAvg);
    if (decline === null) return 0;

    const populationChange = facts.population_change?.value;
    const jobsChange = facts.jobs_walkshed_change?.value;

    const populationStable =
      populationChange === undefined || Math.abs(populationChange) < 0.15;
    const jobsStable =
      jobsChange === undefined || Math.abs(jobsChange) < 0.15;

    // This is a fallback: ridership dropped but demographics stable
    if (decline > 0.3 && populationStable && jobsStable) return 0.7;
    if (decline > 0.2 && populationStable) return 0.5;

    // Low baseline: this is the "unknown" archetype
    return 0.3;
  },
  template: paragraphs(
    "{{#if ridership_fell}}{{stationName}} tells a story of gradual decline that's hard to pin on any single cause.{{else}}{{stationName}} has held on to its riders, and no single factor stands out.{{/if}}",
    `${LONG_RUN}.`,
    "{{#if demographics_stable}}The neighborhood population has remained relatively stable{{#if jobs_stable}}, and local employment hasn't dramatically shifted{{/if}}.{{/if}}",
    "{{#if ridership_fell}}Sometimes a station becomes a ghost simply because the system failed to adapt: service frequency dropped, bus connections were cut, or the station just stopped being part of anyone's routine.{{/if}}",
    YEAR_OVER_YEAR,
  ),
};

/**
 * Against the Odds
 *
 * Station held its ground or grew despite adverse conditions.
 * A rare success story among ghost stations.
 */
const resilientAnomaly: NarrativeArchetype = {
  key: "resilient_anomaly",
  title: ARCHETYPE_TITLES.resilient_anomaly,
  emoji: ARCHETYPE_EMOJIS.resilient_anomaly,
  requiredFacts: ["ridership_2001_avg"],
  scoringLogic: (facts, latestAvg) => {
    if (!hasRequiredFacts(facts, ["ridership_2001_avg"])) {
      return 0;
    }

    const decline = calculateDecline(facts, latestAvg);
    if (decline === null) return 0;

    const vehicleOwnership = facts.vehicle_ownership_pct?.value ?? 0;

    // Ridership grew (negative decline) → high score
    if (decline < 0) return 0.9;

    // Small decline despite high car ownership → resilient
    if (decline < 0.15 && vehicleOwnership > 0.4) return 0.8;

    // Small decline overall → somewhat resilient
    if (decline < 0.1) return 0.6;

    return 0;
  },
  template: paragraphs(
    "{{stationName}} defies the trend.",
    `${LONG_RUN}.`,
    "{{#if car_heavy}}This despite **{{vehicle_ownership_pct|percent}}** of nearby households owning two or more vehicles.{{/if}}",
    "Some stations find ways to remain essential.",
    YEAR_OVER_YEAR,
  ),
};

// ═══════════════════════════════════════════════════════════════
// RULE ARCHETYPES
// ═══════════════════════════════════════════════════════════════

/**
 * Growth, stable, and recent decline tell one story from the score card's numbers: the 12-month
 * average, the year-over-year change, the change since 2019, and the 2001 comparison when the
 * station has one. The opening follows the same recent direction the job selects by, so the title
 * and the text always agree, and healthy stations are never framed as ghosts.
 */
const METRICS_STORY = paragraphs(
  "{{#if small_station}}{{stationName}} carries fewer riders than comparable stations, but its ridership {{#if recent_up}}is growing{{else}}is holding up better than most{{/if}}." +
    "{{else}}{{#if unhealthy}}{{stationName}} ranks as a {{tier_word}} station{{#if recent_up}}, but its ridership is growing{{/if}}{{#if recent_down}}, and it has been losing riders{{/if}}." +
    "{{else}}{{stationName}} {{#if recent_up}}is gaining riders{{else}}is holding its own{{/if}}.{{/if}}{{/if}} " +
    TODAY,
  `${YEAR_OVER_YEAR} ${VS_2019}`,
  `{{#if has_baseline}}${LONG_RUN}.{{#if ridership_fell}}{{#if recent_up}} The recent gains have not made up for that longer decline.{{/if}}{{/if}}{{/if}}`,
);

const ruleArchetype = (key: ArchetypeKey, template: string, requiredFacts: FactKey[] = []): ArchetypeDefinition => ({
  key,
  title: ARCHETYPE_TITLES[key],
  emoji: ARCHETYPE_EMOJIS[key],
  requiredFacts,
  template,
});

const RULE_ARCHETYPES = {
  growth: ruleArchetype("growth", METRICS_STORY),
  stable: ruleArchetype("stable", METRICS_STORY),
  recent_decline: ruleArchetype("recent_decline", METRICS_STORY),
  airport_gateway: ruleArchetype(
    "airport_gateway",
    "{{stationName}} is an airport-driven station. Local residential population doesn't explain its ridership: airport arrivals and traveler demand do. Census walkshed metrics are intentionally excluded here to avoid misleading comparisons.",
    ["airport_arrivals"],
  ),
  closed: ruleArchetype(
    "closed",
    paragraphs(
      "{{stationName}} has been closed since **{{closed_since}}**{{#if closure_purpose}} {{closure_purpose}}{{/if}}.{{#if closure_note}} Reason given: {{closure_note}}.{{/if}}",
      "{{#if reopens_on}}Service is scheduled to resume on **{{reopens_on}}**.{{/if}}",
    ),
  ),
  no_recent_data: ruleArchetype(
    "no_recent_data",
    "The CTA's ridership data shows no recent riders at {{stationName}}, so it is not compared with other stations for now.",
  ),
} satisfies Partial<Record<ArchetypeKey, ArchetypeDefinition>>;

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

/** The fact archetypes `findBestArchetype` chooses among. */
export const ARCHETYPES: NarrativeArchetype[] = [
  suburbanShift,
  carCulture,
  jobsExodus,
  serviceErosion,
  resilientAnomaly,
];

/** Every archetype by key, fact and rule alike. */
export const ARCHETYPE_DEFINITIONS: Record<ArchetypeKey, ArchetypeDefinition> = {
  suburban_shift: suburbanShift,
  car_culture: carCulture,
  jobs_exodus: jobsExodus,
  service_erosion: serviceErosion,
  resilient_anomaly: resilientAnomaly,
  ...RULE_ARCHETYPES,
};

/**
 * Find the best-matching archetype for a station's facts.
 *
 * @param facts - The station's fact values
 * @param latestAvg - Current 12-month average ridership, the score card's figure
 * @returns The archetype with highest confidence, plus its confidence score
 */
export function findBestArchetype(
  facts: NarrativeFacts,
  latestAvg: number
): { archetype: NarrativeArchetype; confidence: number } {
  let bestArchetype = ARCHETYPES[0];
  let bestConfidence = 0;

  for (const archetype of ARCHETYPES) {
    const confidence = archetype.scoringLogic(facts, latestAvg);
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestArchetype = archetype;
    }
  }

  return { archetype: bestArchetype, confidence: bestConfidence };
}

/**
 * Get archetype metadata by key.
 */
export function getArchetypeInfo(key: ArchetypeKey) {
  return {
    key,
    title: ARCHETYPE_TITLES[key],
    emoji: ARCHETYPE_EMOJIS[key],
  };
}
