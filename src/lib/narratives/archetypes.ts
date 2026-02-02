/**
 * Narrative Archetypes
 *
 * Five story templates that explain why a station became a "ghost stop."
 * Each archetype has required facts, optional facts, scoring logic, and a template.
 *
 * Scoring logic returns 0-1 confidence based on how well facts match the archetype.
 * The highest-scoring archetype is selected for each station.
 */

import type { NarrativeArchetype, FactMap, ArchetypeKey } from "@/types/narrative";

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
};

export const ARCHETYPE_EMOJIS: Record<ArchetypeKey, string> = {
  suburban_shift: "🏡",
  car_culture: "🚗",
  jobs_exodus: "💼",
  service_erosion: "⏰",
  resilient_anomaly: "💪",
  airport_gateway: "✈️",
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate ridership decline as a decimal (0.4 = 40% decline).
 * Returns null if 2001 data is missing or zero to prevent divide-by-zero.
 */
function calculateDecline(facts: FactMap, latestAvg: number): number | null {
  const baseline = facts.ridership_2001_avg?.value;
  if (!baseline || baseline === 0) return null;
  return (baseline - latestAvg) / baseline;
}

/**
 * Check if all required facts exist in the fact map.
 */
function hasRequiredFacts(
  facts: FactMap,
  required: string[]
): boolean {
  return required.every((key) => {
    const factKey = key as keyof FactMap;
    return facts[factKey]?.value !== undefined;
  });
}

// ═══════════════════════════════════════════════════════════════
// ARCHETYPE DEFINITIONS
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
  optionalFacts: ["vehicle_ownership_pct", "jobs_walkshed_change"],
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
  template: `In 2001, {{stationName}} averaged **{{ridership_2001_avg|number}}** daily riders. Today, that number has fallen to just **{{ridership_latest_avg|number}}**—a **{{ridership_decline_pct|percent}}** drop over two decades.

{{#if population_change}}The surrounding neighborhood saw a **{{population_change|percent}}** change in population since 2010{{#if population_declining}}, suggesting residents may have left the area{{/if}}.{{/if}}

{{#if vehicle_ownership_pct}}Today, **{{vehicle_ownership_pct|percent}}** of households within walking distance own two or more vehicles—a hallmark of car-dependent living.{{/if}}`,
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
  optionalFacts: ["il_lane_miles_change", "jobs_walkshed_change"],
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
  template: `This station sits in a neighborhood where the car is king. **{{vehicle_ownership_pct|percent}}** of nearby households own two or more vehicles.

{{#if il_lane_miles_change}}Illinois added **{{il_lane_miles_change|number}}** lane-miles of roadway between 2000 and 2023, making driving ever more convenient while transit languished.{{/if}}

Ridership here has fallen from **{{ridership_2001_avg|number}}** to **{{ridership_latest_avg|number}}** daily riders—a **{{ridership_decline_pct|percent}}** decline as residents chose their cars over the L.`,
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
  optionalFacts: ["population_change"],
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
  template: `When jobs leave, riders follow. The half-mile walkshed around {{stationName}} has seen a **{{jobs_walkshed_change|percent}}** change in employment since 2010.

{{#if population_change}}Population in the area changed by **{{population_change|percent}}**{{#if jobs_fell_faster}}, but jobs vanished even faster{{/if}}.{{/if}}

Where once **{{ridership_2001_avg|number}}** riders boarded daily, now only **{{ridership_latest_avg|number}}** do—a transit station serving a neighborhood that lost its economic anchor.`,
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
  requiredFacts: ["ridership_2001_avg", "ridership_latest_avg"],
  optionalFacts: ["vehicle_ownership_pct", "population_change"],
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

    // Low baseline—this is the "unknown" archetype
    return 0.3;
  },
  template: `{{stationName}} tells a story of gradual decline that's hard to pin on any single cause.

In 2001, **{{ridership_2001_avg|number}}** riders boarded here daily. Today: **{{ridership_latest_avg|number}}**—a **{{ridership_decline_pct|percent}}** drop.

{{#if demographics_stable}}The neighborhood population has remained relatively stable{{#if jobs_stable}}, and local employment hasn't dramatically shifted{{/if}}.{{/if}}

Sometimes a station becomes a ghost simply because the system failed to adapt—service frequency dropped, bus connections were cut, or the station just stopped being part of anyone's routine.`,
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
  requiredFacts: ["ridership_2001_avg", "ridership_latest_avg"],
  optionalFacts: ["population_change", "vehicle_ownership_pct"],
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
  template: `{{stationName}} defies the trend. While neighboring stations withered, this one held its ground.

{{#if ridership_grew}}Remarkably, ridership has actually grown from **{{ridership_2001_avg|number}}** to **{{ridership_latest_avg|number}}** daily riders—a rare success story.{{else}}Ridership dipped only modestly from **{{ridership_2001_avg|number}}** to **{{ridership_latest_avg|number}}**—far better than the system average.{{/if}}

{{#if vehicle_ownership_pct}}This despite **{{vehicle_ownership_pct|percent}}** of nearby households owning multiple vehicles.{{/if}}

Some stations find ways to remain essential.`,
};

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export const ARCHETYPES: NarrativeArchetype[] = [
  suburbanShift,
  carCulture,
  jobsExodus,
  serviceErosion,
  resilientAnomaly,
];

/**
 * Find the best-matching archetype for a station's facts.
 *
 * @param facts - The station's fact values
 * @param latestAvg - Current rolling 30-day average ridership
 * @returns The archetype with highest confidence, plus its confidence score
 */
export function findBestArchetype(
  facts: FactMap,
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
