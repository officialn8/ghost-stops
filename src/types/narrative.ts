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
  | "ridership_latest_avg"
  | "ridership_decline_pct"
  | "population_change"
  | "vehicle_ownership_pct"
  | "jobs_walkshed_change"
  | "il_lane_miles_change"
  | "airport_arrivals";

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

// ═══════════════════════════════════════════════════════════════
// ARCHETYPES
// ═══════════════════════════════════════════════════════════════

export type ArchetypeKey =
  | "suburban_shift"
  | "car_culture"
  | "jobs_exodus"
  | "service_erosion"
  | "resilient_anomaly"
  | "airport_gateway";

export interface ArchetypeInfo {
  key: ArchetypeKey;
  title: string;
  emoji: string;
}

export interface NarrativeArchetype {
  key: ArchetypeKey;
  title: string;
  emoji: string;
  requiredFacts: FactKey[];
  optionalFacts: FactKey[];
  /** Returns confidence score 0-1 based on how well facts match this archetype */
  scoringLogic: (facts: FactMap, latestAvg: number) => number;
  /** Handlebars-style template with {{factKey|format}} placeholders */
  template: string;
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

// ═══════════════════════════════════════════════════════════════
// SEED DATA TYPES
// ═══════════════════════════════════════════════════════════════

export interface SeedFactData {
  value: number;
  unit: string;
  geography: Geography;
  timeframeStart?: number;
  timeframeEnd?: number;
  sourceCode: string;
  sourceNote?: string;
  methodology: string;
  quality?: DataQuality;
  qualityNote?: string;
  evidenceMeta?: EvidenceMeta;
}

export interface SeedStationData {
  name: string;
  facts: Partial<Record<FactKey, SeedFactData>>;
  archetypeOverride?: ArchetypeKey | null;
}

export interface SeedDataFile {
  sources: DataSourceInfo[];
  stations: SeedStationData[];
  regionalFacts: Partial<Record<FactKey, SeedFactData>>;
  defaultFactQuality?: DataQuality;
  defaultFactQualityNote?: string;
  defaultEvidenceMeta?: EvidenceMeta;
}
