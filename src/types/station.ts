/**
 * The station API's shapes (KTD14): the list route `GET /api/chicago/stations` and the
 * slug-addressed detail route `GET /api/chicago/stations/{slug or uuid}`. The routes type their
 * responses with these, and the Phase 5 components (U17 to U21) read them.
 *
 * Dates are YYYY-MM-DD calendar strings (KTD17); only `lastSuccessfulFetch` is an instant, an ISO
 * timestamp. Nothing here is computed: the server builds every value, including the sentences.
 */
import type { DataSourceInfo, FactKey, FactValue, StationBadge, StationNarrativeData } from "./narrative";

export type { StationBadge };

/** Score v2 tiers (R17), from the most underused stations to the least. */
export type ScoreTierName = "ghost" | "fading" | "quiet" | "healthy";

/** A station's data status in the UI's vocabulary; src/lib/utils.ts maps the stored one to it. */
export type DataStatus = "available" | "missing" | "zero";

/** Station.status, derived from the station's closures by the seed and every sync run. */
export type StationStatus = "ACTIVE" | "CLOSED" | "TEMP_CLOSED";

/**
 * Freshness, from the latest successful sync run, so the list, the detail, and /api/health
 * cannot disagree (R13, KTD14).
 */
export interface Freshness {
  /** The last service date the data covers, YYYY-MM-DD. */
  dataThrough: string | null;
  /** When the last successful sync finished, an ISO timestamp. */
  lastSuccessfulFetch: string | null;
}

// ═══════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════

/**
 * Daily entries for the seven calendar days ending at the station's own last service date, which
 * lags the city's data-through date for a station that stopped reporting. `values` has one entry
 * per day from `start` to `end`, null for a day with no row (R25: the sparkline states its range).
 */
export interface StationSparkline {
  start: string;
  end: string;
  values: (number | null)[];
}

export interface StationListItem {
  id: string;
  slug: string | null;
  /** The name to show: Station.displayName, or the stored name until the seed fills it. */
  displayName: string;
  /** The stored name, which may carry a line-list parenthetical ("Oak Park (Blue)"). */
  name: string;
  lines: string[];
  status: StationStatus;
  closedAt: string | null;
  latitude: number;
  longitude: number;
  /** Null for a station outside the ranking: closed, or no riders in recent data. */
  tier: ScoreTierName | null;
  /** 1 is the most ghost-like; null outside the ranking. */
  rank: number | null;
  rankedCount: number | null;
  /** The ledger's riders-per-day number, the one the residual compares (R25, KTD18). */
  avg12m: number | null;
  avg30d: number | null;
  dataStatus: DataStatus;
  /** Null for a station with no ridership at all. */
  sparkline: StationSparkline | null;
  badge: StationBadge | null;
}

/** `GET /api/chicago/stations`: every station, rank 1 first, unranked stations after by name. */
export interface StationListResponse extends Freshness {
  stations: StationListItem[];
}

// ═══════════════════════════════════════════════════════════════
// DETAIL: the "why this score" card (R18)
// ═══════════════════════════════════════════════════════════════

export type ScoreComponentKey = "residual" | "yoy" | "longRun" | "erratic";

/**
 * Why a component has no value; mirrors src/lib/scoring/availability.ts. "neighbor-closure" is
 * year-over-year only: a station next door closed or reopened across its two windows.
 */
export type WhyNullKind = "closed" | "reopened" | "new" | "neighbor-closure" | "no-data" | "no-peers";

export interface WhyNullReason {
  kind: WhyNullKind;
  /**
   * The chip text, e.g. "reopened Jul 2025, year-over-year available from Oct 2026", or
   * "State/Lake closed next door in Jan 2026; year-over-year comparable again from Apr 2027".
   */
  text: string;
}

export interface WhyComponent {
  key: ScoreComponentKey;
  label: string;
  /** The component's share of the composite, 0 to 1. */
  weight: number;
  /** 0 to 100, higher is more ghost-like; null outside the ranking or when `value` is null. */
  pct: number | null;
  /**
   * The raw input: the residual's log ratio to the peers' baseline, the year-over-year and 2019
   * changes in percent, the erraticness ratio (median absolute deviation over median).
   */
  value: number | null;
  /** One plain-language sentence with the real numbers, or the null reason as a sentence. */
  sentence: string;
  /** Set exactly when `value` is null. */
  nullReason: WhyNullReason | null;
}

export type ChipKind = "new" | "reopened" | "closed" | "nearby-closure" | "stale";

/**
 * A station-level data-quality chip (R18), e.g. "reopened Jul 2025", or "State/Lake closed next
 * door in Jan 2026" when a closure next door set the station's year-over-year aside.
 */
export interface Chip {
  kind: ChipKind;
  text: string;
}

/**
 * How the residual's peers were chosen (KTD8): the nearest stations either side on the line, the
 * other Loop stations, or a hub's whole branch; "none" when no station qualified.
 */
export type PeerBasis = "neighbors" | "loop" | "branch-median" | "none";

export interface WhyPeer {
  id: string;
  slug: string | null;
  displayName: string;
  /** The peer's 12-month average when the score was computed. */
  avg12m: number;
}

export interface WhyPeers {
  basis: PeerBasis;
  /** The station's primary line and its branch there ("loop" for a Loop station). */
  line: string | null;
  branch: string | null;
  stations: WhyPeer[];
  /** The median of the peers' 12-month averages, the residual's denominator. */
  baseline: number | null;
}

export interface WhyCard {
  /** The 0 to 100 value, shown only inside the card (R26); null outside the ranking. */
  score: number | null;
  tier: ScoreTierName | null;
  rank: number | null;
  rankedCount: number | null;
  badge: StationBadge | null;
  /** Residual, year-over-year, long-run, erraticness, in that order. */
  components: WhyComponent[];
  chips: Chip[];
  peers: WhyPeers;
}

// ═══════════════════════════════════════════════════════════════
// DETAIL: the response
// ═══════════════════════════════════════════════════════════════

/**
 * An adjacent station on the primary line. A closed or unranked neighbor has a null score and
 * tier; it never enters the neighbor average. `id`, `name`, `rolling30dAvg`, and `ghostScore` are
 * the fields the v1 pills read.
 */
export interface NeighborEntry {
  id: string;
  slug: string | null;
  name: string;
  displayName: string;
  status: StationStatus;
  rolling30dAvg: number;
  ghostScore: number | null;
  tier: ScoreTierName | null;
}

/** A ranked neighbor, the only kind `comparisons.neighbors` carries: it always has a score. */
export type RankedNeighborEntry = NeighborEntry & { ghostScore: number };

export interface StationSeriesDay {
  date: string;
  /** Null for a day with no row: a gap, not zero riders. */
  entries: number | null;
  /** W weekday, A Saturday, U Sunday or holiday; null on a gap. */
  dayType: string | null;
}

/** Every calendar day of the range `ridershipSeries` covers: the station's last 91 days of data. */
export interface StationSeries {
  start: string;
  end: string;
  days: StationSeriesDay[];
}

export interface StationDetailStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: string[];
  /** v1: the stored score, -1 for a station outside the ranking. */
  ghostScore: number;
  rolling30dAvg: number | null;
  /** v1: the 30-day average against the 90-day one, in percent. */
  trend: number | null;
  slug: string | null;
  displayName: string;
  status: StationStatus;
  closedAt: string | null;
  openedAt: string | null;
  dataStatus: DataStatus;
}

export interface StationDetailMetrics {
  ghostScore: number;
  percentile: number;
  systemAverage: number;
  systemMedian: number;
  explanation: string;
  /** False for closed and no-data stations, which are not compared with others. */
  ranked: boolean;
  tier: ScoreTierName | null;
  rank: number | null;
  rankedCount: number | null;
  avg12m: number | null;
  avg30d: number | null;
  /** The data-through date the metrics were computed for. */
  dataThrough: string | null;
  scoreVersion: number | null;
}

export interface StationDetailComparisons {
  systemMedian: number;
  primaryLine: string | null;
  lineMedian: number;
  /**
   * v1: the ranked neighbors either side on the primary line. A closed or unranked neighbor is
   * null here, as in v1, so the v1 pills never show a badge without a score.
   */
  neighbors: {
    prev: RankedNeighborEntry | null;
    next: RankedNeighborEntry | null;
    neighborAvg: number;
  };
  /**
   * Every adjacent station on the primary line, closed and unranked ones included (State/Lake on
   * the Brown Line Loop), with a null score and tier for those. Null when there is no station on
   * that side: past a terminal, or for a station with no CTA id.
   */
  lineNeighbors: {
    prev: NeighborEntry | null;
    next: NeighborEntry | null;
  };
  vsSystemMedian: number;
  vsLineMedian: number;
  vsNeighbors: number;
}

/** A cited fact as the detail route sends it: the v1 fact with its display label. */
export interface StationDetailFact extends FactValue {
  label: string;
}

export type StationDetailFacts = Partial<Record<FactKey, StationDetailFact>>;

/** A stored narrative, shown only when it describes the same data-through date as the metrics (KTD11). */
export interface StationDetailNarrative extends StationNarrativeData {
  dataThrough: string;
}

/**
 * `GET /api/chicago/stations/{slug or uuid}`. A strict superset of the v1 response until U21:
 * `station`, `ridershipSeries`, `metrics`, `comparisons`, `facts`, `narrative`, and `sources` keep
 * their v1 fields and meanings; everything else is additive.
 */
export interface StationDetailResponse extends Freshness {
  station: StationDetailStation;
  /** v1: the station's last 91 days of data, days with rows only. */
  ridershipSeries: { date: string; entries: number }[];
  /** The same range with every day present; null when the station has no data. */
  series: StationSeries | null;
  metrics: StationDetailMetrics;
  comparisons: StationDetailComparisons;
  /** Null when the station has no score v2 metrics yet. */
  whyCard: WhyCard | null;
  facts: StationDetailFacts | null;
  narrative: StationDetailNarrative | null;
  sources: DataSourceInfo[] | null;
}
