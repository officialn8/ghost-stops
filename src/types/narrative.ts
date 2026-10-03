/**
 * Facts + Narrative System Types
 *
 * Journalism-grade storytelling backed by cited facts.
 * Percents stored as decimals (0.52 = 52%), formatted in UI.
 */

// ═══════════════════════════════════════════════════════════════
// VALUE TYPES
// ═══════════════════════════════════════════════════════════════

export type ValueType = "number" | "percent" | "currency";

export type Geography = "station" | "walkshed_0.5mi" | "region_il";

export type DataQuality = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type DataSourceStatus = "ACTIVE" | "ERROR" | "DEPRECATED";

export type EvidenceMeta = Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════
// DATA SOURCES
// ═══════════════════════════════════════════════════════════════

export interface DataSourceInfo {
  code: string;
  name: string;
  url: string;
  apiUrl?: string;
  datasetId?: string;
  license?: string;
  refreshCadence?: "daily" | "annual" | "static";
  lastFetched?: string;
  lastSuccessfulFetch?: string;
  status?: DataSourceStatus;
}

// ═══════════════════════════════════════════════════════════════
// FACTS
// ═══════════════════════════════════════════════════════════════

export type FactKey =
  | "ridership_2001_avg"
  | "ridership_2006_avg"
  | "ridership_2012_avg"
  | "ridership_latest_avg"
  | "ridership_decline_pct"
  | "population_change"
  | "vehicle_ownership_pct"
  | "jobs_walkshed_change"
  | "il_lane_miles_change"
  | "airport_arrivals"
  | "station_opened";

export interface FactValue {
  value: number;
  displayValue: string;  // Pre-formatted: "2,450" or "-23%" or "$1,200"
  valueType: ValueType;
  unit: string;
  geography: Geography;
  timeframeStart?: number;
  timeframeEnd?: number;
  methodology: string;
  sourceNote?: string;  // For multi-source facts
  quality: DataQuality;
  qualityNote?: string;
  evidenceMeta?: EvidenceMeta;
  source: {
    name: string;
    url: string;
  };
}

export type FactMap = Partial<Record<FactKey, FactValue>>;

/** The part of a stored fact that narrative selection and rendering read. */
export interface NarrativeFact {
  value: number;
  quality: DataQuality;
}

/** A station's facts as narratives read them; a full `FactMap` is one too. */
export type NarrativeFacts = Partial<Record<FactKey, NarrativeFact>>;

// ═══════════════════════════════════════════════════════════════
// ARCHETYPES
// ═══════════════════════════════════════════════════════════════

export type ArchetypeKey =
  | "suburban_shift"
  | "car_culture"
  | "jobs_exodus"
  | "service_erosion"
  | "resilient_anomaly"
  | "airport_gateway"
  | "growth"
  | "stable"
  | "recent_decline"
  | "closed"
  | "no_recent_data";

export interface ArchetypeInfo {
  key: ArchetypeKey;
  title: string;
  emoji: string;
}

export interface ArchetypeDefinition {
  key: ArchetypeKey;
  title: string;
  emoji: string;
  /** Facts the archetype stands on: always cited as evidence, and the story is refused without them. */
  requiredFacts: FactKey[];
  /** Handlebars-style template with {{name|format}} placeholders (src/lib/narratives/renderer.ts) */
  template: string;
}

/** An archetype chosen by how well a station's facts fit it, rather than by rule. */
export interface NarrativeArchetype extends ArchetypeDefinition {
  /** Returns confidence score 0-1 based on how well facts match this archetype */
  scoringLogic: (facts: NarrativeFacts, latestAvg: number) => number;
}

// ═══════════════════════════════════════════════════════════════
// RENDERING CONTEXT
// ═══════════════════════════════════════════════════════════════

/** Score v2's tiers (StationMetrics.tier). */
export type NarrativeTier = "GHOST" | "FADING" | "QUIET" | "HEALTHY";

/** Score v2's small-station badge (src/lib/scoring/score.ts). */
export type StationBadge = "small-but-steady" | "small-but-growing";

/** The closure a closed station is in (StationClosure). Dates are YYYY-MM-DD. */
export interface NarrativeClosure {
  startDate: string;
  /** The day service resumes; null while the closure is open-ended. */
  endDate: string | null;
  reason: string;
}

/**
 * A closure or reopening next door that set the station's year-over-year aside (score v2): riders
 * moved between the two stations, so this year does not compare with last.
 */
export interface NarrativeNearbyClosure {
  /** The neighbor's display name. */
  stationName: string;
  change: "closed" | "reopened";
  /** YYYY-MM-DD: the day it closed, or the day service resumed. */
  date: string;
}

/**
 * What a template is rendered from: a station's facts and the numbers its score card shows, so
 * the story and the card quote the same figures.
 */
export interface NarrativeContext {
  stationName: string;
  facts: NarrativeFacts;
  /** The 12-month average, the headline ridership figure (R25). */
  avg12m: number | null;
  /** In percent: 4 is +4%. */
  yoyChangePct: number | null;
  vs2019Pct: number | null;
  tier: NarrativeTier | null;
  badge: StationBadge | null;
  closure: NarrativeClosure | null;
  /** Set when a closure next door set year-over-year aside, so `yoyChangePct` is null. */
  nearbyClosure: NarrativeNearbyClosure | null;
}

// ═══════════════════════════════════════════════════════════════
// NARRATIVES
// ═══════════════════════════════════════════════════════════════

export interface StationNarrativeData {
  archetype: ArchetypeInfo;
  story: string;  // Rendered markdown
  evidenceFactKeys: FactKey[];
  templateVersion: string;
  confidence: number;  // 0-1
  quality: DataQuality;
  qualityNote?: string;
  evidenceMeta?: EvidenceMeta;
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSE EXTENSIONS
// ═══════════════════════════════════════════════════════════════

export interface NarrativeAPIResponse {
  facts: FactMap | null;
  narrative: StationNarrativeData | null;
  sources: DataSourceInfo[] | null;
}
