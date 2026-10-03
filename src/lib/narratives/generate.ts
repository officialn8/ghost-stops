/**
 * The narrative job (R19; KTD11): one story for every station with metrics, generated after
 * scoring in the same sync run and from the same numbers as the score card, and stamped with the
 * run's data-through date so the detail route can withhold a story that no longer matches the
 * metrics beside it.
 *
 * Reads happen before the run's transaction and the write is one set-based statement inside it
 * (KTD10). Import direction (KTD21): this module never imports the scoring code or the Prisma
 * client instance; src/lib/sync/run.ts hands it the scores as plain data and the database client
 * as a parameter. src/lib/narratives/index.ts does not re-export it.
 *
 * Archetype selection, first match wins:
 * 1. O'Hare, by CTA station id, with its airport_arrivals fact: airport_gateway. Harlem (O'Hare)
 *    and Western (O'Hare) carry the same placeholder fact but are neighborhood stations.
 * 2. Closed or temporarily closed: closed, saying since when and why. No score framing.
 * 3. Open but not ranked (no riders in recent data): no_recent_data.
 * 4. Tier HEALTHY, or a small-station badge: growth when the recent change is positive, stable
 *    otherwise. The recent change is the year-over-year change, else the change since 2019: the
 *    badge's own sign rule, so a "small but growing" badge always sits beside a growth story.
 * 5. Tier GHOST, FADING, or QUIET: the fact archetype that best fits the 12-month average.
 * 6. No fact archetype fits (the station has no usable 2001 average): growth when the recent
 *    change is positive, recent_decline when negative, stable when it is unknown.
 */

import type { DataQuality, Prisma, PrismaClient, StationStatus } from "@prisma/client";
import type {
  ArchetypeKey,
  FactKey,
  NarrativeClosure,
  NarrativeContext,
  NarrativeFacts,
  NarrativeTier,
  StationBadge,
} from "@/types/narrative";
import { ARCHETYPE_DEFINITIONS, findBestArchetype } from "./archetypes";
import { renderNarrative } from "./renderer";

/** StationNarrative.templateVersion for every story this job writes. */
export const TEMPLATE_VERSION = "v2";

/** O'Hare by CTA station id, never by name: two other stations have "O'Hare" in theirs. */
const OHARE_CTA_STATION_ID = "40890";

/** The confidence the detail route's hardcoded O'Hare story carried, kept so the page reads the same. */
const AIRPORT_CONFIDENCE = 0.85;

/**
 * The 2001 average compares a station with itself only if it was open all of 2001. Station.openedAt
 * is set only for stations that opened after the ridership data begins; for those, a stored 2001
 * average is either zero or another station's riders (Cermak-McCormick Place opened in 2015).
 */
const BASELINE_YEAR_START = "2001-01-01";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/** One station's input to the job: its record, this run's status, and score v2's numbers. */
export interface NarrativeStationInput {
  stationId: string;
  ctaStationId: string | null;
  /** Station.displayName, else Station.name. */
  name: string;
  status: StationStatus;
  /** YYYY-MM-DD; set only for stations that opened after the ridership data begins. */
  openedAt: string | null;
  /** Whether score v2 ranks the station: open, with riders in recent data. */
  ranked: boolean;
  tier: NarrativeTier | null;
  badge: StationBadge | null;
  /** The 12-month average, the card's headline figure (R25). */
  avg12m: number | null;
  /** In percent: 4 is +4%. */
  yoyChangePct: number | null;
  vs2019Pct: number | null;
  /** The closure a closed station is in; null when open. */
  closure: NarrativeClosure | null;
  /** Every stored fact; the job decides which it may use. */
  facts: NarrativeFacts;
}

/** Which selection rule chose a story's archetype (the numbered rules above). */
export type NarrativeSelection = "airport" | "closed" | "unranked" | "healthy" | "badge" | "facts" | "components";

export interface NarrativeEvidenceMeta {
  /** The score card's numbers the story quotes; they are not stored facts, so not evidence keys. */
  metrics: { avg12m: number | null; yoyChangePct: number | null; vs2019Pct: number | null; dataThrough: string };
  tier: NarrativeTier | null;
  badge: StationBadge | null;
  selectedBy: NarrativeSelection;
}

/** One StationNarrative row, less the columns the write sets (lastComputed, dataThrough). */
export interface NarrativeRow {
  stationId: string;
  archetypeKey: ArchetypeKey;
  renderedStory: string;
  /** A JSON array of the stored fact keys the story drew on, as StationNarrative stores it. */
  evidenceFactKeys: string;
  templateVersion: string;
  confidence: number;
  quality: DataQuality;
  qualityNote: string | null;
  evidenceMeta: NarrativeEvidenceMeta;
}

/** A story the job refused: it needed facts or values the station does not have. */
export interface NarrativeRejection {
  stationId: string;
  archetypeKey: ArchetypeKey;
  missing: string[];
}

export interface GenerateOptions {
  /** Replaces archetype templates; tests use it to make a story cite a fact its station lacks. */
  templates?: Partial<Record<ArchetypeKey, string>>;
}

export interface GeneratedNarratives {
  rows: NarrativeRow[];
  rejected: NarrativeRejection[];
}

// ═══════════════════════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════════════════════

/** The station's facts, less a 2001 average that cannot describe it. */
function usableFacts(station: NarrativeStationInput): NarrativeFacts {
  if (station.openedAt === null || station.openedAt <= BASELINE_YEAR_START) return station.facts;
  const facts = { ...station.facts };
  delete facts.ridership_2001_avg;
  return facts;
}

interface Selected {
  key: ArchetypeKey;
  confidence: number;
  selectedBy: NarrativeSelection;
}

function selectArchetype(station: NarrativeStationInput, facts: NarrativeFacts): Selected {
  if (station.ctaStationId === OHARE_CTA_STATION_ID && facts.airport_arrivals !== undefined) {
    return { key: "airport_gateway", confidence: AIRPORT_CONFIDENCE, selectedBy: "airport" };
  }
  if (station.status !== "ACTIVE") return { key: "closed", confidence: 1, selectedBy: "closed" };
  if (!station.ranked) return { key: "no_recent_data", confidence: 1, selectedBy: "unranked" };

  const recent = station.yoyChangePct ?? station.vs2019Pct;
  if (station.tier === "HEALTHY" || station.badge !== null) {
    return {
      key: recent !== null && recent > 0 ? "growth" : "stable",
      confidence: 1,
      selectedBy: station.tier === "HEALTHY" ? "healthy" : "badge",
    };
  }
  if (station.avg12m !== null) {
    const best = findBestArchetype(facts, station.avg12m);
    if (best.confidence > 0) return { key: best.archetype.key, confidence: best.confidence, selectedBy: "facts" };
  }
  const key: ArchetypeKey = recent === null || recent === 0 ? "stable" : recent > 0 ? "growth" : "recent_decline";
  return { key, confidence: 1, selectedBy: "components" };
}

// ═══════════════════════════════════════════════════════════════
// QUALITY
// ═══════════════════════════════════════════════════════════════

const QUALITY_RANK: Record<DataQuality, number> = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

/** The weakest quality among the evidence facts; UNKNOWN when the story cites none. */
function evidenceQuality(keys: readonly FactKey[], facts: NarrativeFacts): DataQuality {
  let quality: DataQuality | null = null;
  for (const key of keys) {
    const factQuality = facts[key]!.quality;
    if (quality === null || QUALITY_RANK[factQuality] < QUALITY_RANK[quality]) quality = factQuality;
  }
  return quality ?? "UNKNOWN";
}

function qualityNote(key: ArchetypeKey, quality: DataQuality, evidenceCount: number): string | null {
  if (key === "airport_gateway") return "Airport arrivals are the primary driver; Census facts excluded.";
  if (key === "closed") return "Based on the station's closure dates.";
  if (evidenceCount === 0) return "Based on CTA ridership alone; no neighborhood facts were used.";
  switch (quality) {
    case "LOW":
      return "Some evidence facts are placeholders or low confidence.";
    case "MEDIUM":
      return "Narrative derived from mixed-confidence evidence.";
    case "UNKNOWN":
      return "The quality of some evidence facts is not recorded.";
    case "HIGH":
      return null;
  }
}

const round2 = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

// ═══════════════════════════════════════════════════════════════
// GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * One narrative row per station, or a rejection for a story that would cite a fact the station
 * lacks or leave a value blank; the caller logs rejections and writes the rows. Pure and
 * deterministic: the same inputs give the same rows.
 */
export function generateNarratives(
  stations: readonly NarrativeStationInput[],
  dataThrough: string,
  options: GenerateOptions = {},
): GeneratedNarratives {
  const rows: NarrativeRow[] = [];
  const rejected: NarrativeRejection[] = [];

  for (const station of stations) {
    const facts = usableFacts(station);
    const { key, confidence, selectedBy } = selectArchetype(station, facts);
    const definition = ARCHETYPE_DEFINITIONS[key];
    const context: NarrativeContext = {
      stationName: station.name,
      facts,
      avg12m: station.avg12m,
      yoyChangePct: station.yoyChangePct,
      vs2019Pct: station.vs2019Pct,
      tier: station.tier,
      badge: station.badge,
      closure: station.closure,
    };
    const rendered = renderNarrative(
      { template: options.templates?.[key] ?? definition.template, requiredFacts: definition.requiredFacts },
      context,
    );
    const missing = rendered.story.length === 0 ? [...rendered.missing, "story"] : rendered.missing;
    if (missing.length > 0) {
      rejected.push({ stationId: station.stationId, archetypeKey: key, missing });
      continue;
    }

    const quality = evidenceQuality(rendered.evidenceFactKeys, facts);
    rows.push({
      stationId: station.stationId,
      archetypeKey: key,
      renderedStory: rendered.story,
      evidenceFactKeys: JSON.stringify(rendered.evidenceFactKeys),
      templateVersion: TEMPLATE_VERSION,
      confidence,
      quality,
      qualityNote: qualityNote(key, quality, rendered.evidenceFactKeys.length),
      evidenceMeta: {
        metrics: {
          avg12m: round2(station.avg12m),
          yoyChangePct: round2(station.yoyChangePct),
          vs2019Pct: round2(station.vs2019Pct),
          dataThrough,
        },
        tier: station.tier,
        badge: station.badge,
        selectedBy,
      },
    });
  }

  return { rows, rejected };
}

// ═══════════════════════════════════════════════════════════════
// READ AND WRITE
// ═══════════════════════════════════════════════════════════════

/** What the job reads for a station besides its metrics and status. */
export interface NarrativeStationRecord {
  stationId: string;
  ctaStationId: string | null;
  /** Station.displayName, else Station.name. */
  name: string;
  openedAt: string | null;
  closures: NarrativeClosure[];
  facts: NarrativeFacts;
}

const toDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Every station in the city with its closures and stored facts, in one read outside the run's
 * transaction. Facts and their sources are only read, never written.
 */
export async function readNarrativeStations(
  db: Pick<PrismaClient, "station">,
  cityId: string,
): Promise<NarrativeStationRecord[]> {
  const stations = await db.station.findMany({
    where: { cityId },
    select: {
      id: true,
      ctaStationId: true,
      name: true,
      displayName: true,
      openedAt: true,
      closures: { select: { startDate: true, endDate: true, reason: true } },
      facts: { select: { factKey: true, value: true, quality: true } },
    },
  });
  return stations.map((s) => ({
    stationId: s.id,
    ctaStationId: s.ctaStationId,
    name: s.displayName?.trim() || s.name,
    openedAt: s.openedAt === null ? null : toDay(s.openedAt),
    closures: s.closures.map((c) => ({
      startDate: toDay(c.startDate),
      endDate: c.endDate === null ? null : toDay(c.endDate),
      reason: c.reason,
    })),
    facts: Object.fromEntries(s.facts.map((f) => [f.factKey, { value: f.value, quality: f.quality }])) as NarrativeFacts,
  }));
}

/**
 * Upserts every generated narrative in one statement (KTD10), stamped with the run's
 * data-through date and time. Rows travel as one jsonb parameter, as the metrics write does:
 * Prisma 6 rejects arrays holding nulls, which rules out `unnest` for the nullable columns.
 */
export async function writeStationNarratives(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  rows: readonly NarrativeRow[],
  dataThrough: string,
  now: Date,
): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO "StationNarrative" (
      "id", "stationId", "archetypeKey", "renderedStory", "evidenceFactKeys", "templateVersion",
      "confidence", "quality", "qualityNote", "evidenceMeta", "lastComputed", "dataThrough"
    )
    SELECT gen_random_uuid()::text, n."stationId", n."archetypeKey", n."renderedStory", n."evidenceFactKeys",
           n."templateVersion", n."confidence", n."quality"::"DataQuality", n."qualityNote", n."evidenceMeta",
           ${now}, ${dataThrough}::date
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS n(
      "stationId" text, "archetypeKey" text, "renderedStory" text, "evidenceFactKeys" text,
      "templateVersion" text, "confidence" float8, "quality" text, "qualityNote" text, "evidenceMeta" jsonb
    )
    ON CONFLICT ("stationId") DO UPDATE SET
      "archetypeKey" = EXCLUDED."archetypeKey",
      "renderedStory" = EXCLUDED."renderedStory",
      "evidenceFactKeys" = EXCLUDED."evidenceFactKeys",
      "templateVersion" = EXCLUDED."templateVersion",
      "confidence" = EXCLUDED."confidence",
      "quality" = EXCLUDED."quality",
      "qualityNote" = EXCLUDED."qualityNote",
      "evidenceMeta" = EXCLUDED."evidenceMeta",
      "lastComputed" = EXCLUDED."lastComputed",
      "dataThrough" = EXCLUDED."dataThrough"`;
}
