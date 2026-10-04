/**
 * Station detail payloads for the dossier's component tests (U21), built by running the real score
 * v2 code over the shared fixture (src/lib/scoring/__fixtures__/stations.json): `scoreStations`
 * ranks the 26 stations, `buildWhyCard` builds each card from the stored columns scoring would
 * write, and the narrative job picks and renders each story. Components never import the scoring
 * code (ESLint); their tests import this module instead.
 *
 * What the fixture does not carry is made up, deterministically: 91 days of rows shaped by each
 * station's trailing-window averages and day-to-day swing (so the erraticness row and the chart
 * have data), a 2001 average and a population fact for the stories, and coordinates. Medians and
 * neighbor averages are taken over the fixture's 26 stations, not the whole system.
 */
import fixture from "@/lib/scoring/__fixtures__/stations.json";
import { STATION_CLOSURES } from "@/lib/cta/closures";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { getPrimaryLine, linesForStation, primaryLineNeighbors } from "@/lib/cta/sequences";
import { displayNameFor, generateSlugs } from "@/lib/cta/slug";
import { formatValue, getArchetypeInfo, getFactLabel } from "@/lib/narratives";
import { generateNarratives, type NarrativeStationInput } from "@/lib/narratives/generate";
import { mean, median, type DayRow, type WindowSummary } from "@/lib/scoring/components";
import { scoreColumns, scoreStations, type StationScore, type StationScoreInput } from "@/lib/scoring/score";
import { buildWhyCard } from "@/lib/scoring/whyCard";
import { seriesFor, SERIES_DAYS_BEFORE_END } from "@/lib/stations/ridership";
import { addDays } from "@/lib/sync/window";
import { tierName, toUiDataStatus } from "@/lib/utils";
import type { ArchetypeKey, DataSourceInfo, FactKey } from "@/types/narrative";
import type {
  NeighborEntry,
  StationDetailFact,
  StationDetailFacts,
  StationDetailResponse,
} from "@/types/station";

/** The nine stations the fixture names, in its order. */
export const DOSSIER_STATIONS = [
  "Halsted (Green)",
  "Logan Square",
  "State/Lake",
  "Damen (Green)",
  "Lawrence",
  "LaSalle/Van Buren",
  "Wilson",
  "O'Hare",
  "Western (O'Hare)",
] as const;

/** Any of the fixture's 26 stations; the nine above are the named ones. */
export type FixtureStationName = (typeof fixture.stations)[number]["name"];

export const FIXTURE_DATA_THROUGH = fixture.dataThrough;

/** A last successful refresh a day before "now" in the fixtures: fresh. */
export const FIXTURE_LAST_REFRESH = "2026-10-02T11:00:00.000Z";

const CTA_DATASET = {
  name: "CTA L Station Entries Daily Totals",
  url: "https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f",
};
const ACS = { name: "American Community Survey 5-Year Estimates (2020-2024)", url: "https://data.census.gov/" };

const SOURCES: Readonly<Record<string, DataSourceInfo>> = {
  [CTA_DATASET.name]: { code: "cta_socrata", ...CTA_DATASET, license: "Public Domain", refreshCadence: "daily", status: "ACTIVE" },
  [ACS.name]: { code: "census_acs_5yr", ...ACS, license: "Public Domain", refreshCadence: "annual", status: "ACTIVE" },
};

type FixtureStation = (typeof fixture.stations)[number];

const inputOf = (s: FixtureStation) => s.input as StationScoreInput;

const rosterName = (ctaStationId: string) => {
  const found = CTA_ROSTER.find((r) => r.ctaStationId === ctaStationId);
  if (!found) throw new Error(`No roster station ${ctaStationId}`);
  return found.name;
};

const SLUGS = generateSlugs(
  CTA_ROSTER.map((r) => ({ ctaStationId: r.ctaStationId, name: r.name, lines: linesForStation(r.ctaStationId) })),
);

/** The day type the ridership dataset would give a date: Saturday A, Sunday U, else W (no holidays). */
function dayTypeOf(date: string): DayRow["dayType"] {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 6 ? "A" : day === 0 ? "U" : "W";
}

/**
 * The station's last 91 days of rows ending at `lastDay`, shaped by its trailing window: each day
 * type cycles through its average and the average plus and minus its median absolute deviation,
 * so the rows recombine to the fixture's averages and swing. Days inside a closure carry zero
 * riders, as the CTA's data does for closed State/Lake.
 */
function syntheticDays(trailing: WindowSummary | null, closures: StationScoreInput["closures"], lastDay: string): DayRow[] {
  const start = addDays(lastDay, -SERIES_DAYS_BEFORE_END);
  const counters = { W: 0, weekend: 0 };
  const rows: DayRow[] = [];
  for (let date = start; date <= lastDay; date = addDays(date, 1)) {
    const dayType = dayTypeOf(date);
    const weekday = dayType === "W";
    const avg = (weekday ? trailing?.weekdayAvg : trailing?.weekendAvg) ?? null;
    const swing = (weekday ? trailing?.weekdayMadRatio : trailing?.weekendMadRatio) ?? 0;
    const closed = closures.some((c) => date >= c.startDate && (c.endDate === null || date < c.endDate));
    if (avg === null && !closed) continue;
    const step = weekday ? counters.W++ : counters.weekend++;
    const factor = [1, 1 + swing, 1 - swing][step % 3];
    rows.push({ serviceDate: date, entries: closed ? 0 : Math.round((avg ?? 0) * factor), dayType });
  }
  return rows;
}

const ranked = (score: StationScore) => score.ranked;

/** A synthetic but plausible 2001 average: the 2019 average plus a fifth, or none without one. */
function factsFor(input: StationScoreInput): StationDetailFacts {
  const facts: StationDetailFacts = {};
  const fact = (key: FactKey, value: Omit<StationDetailFact, "label">) => {
    facts[key] = { label: getFactLabel(key), ...value };
  };
  if (input.avg2019 !== null && input.avg2019 > 0) {
    const value = Math.round(input.avg2019 * 1.2);
    fact("ridership_2001_avg", {
      value,
      displayValue: formatValue(value, "number"),
      valueType: "number",
      unit: "riders/day",
      geography: "station",
      timeframeStart: 2001,
      timeframeEnd: 2001,
      methodology: "Daily average for calendar year 2001",
      quality: "HIGH",
      qualityNote: "Official CTA ridership data from data.cityofchicago.org",
      source: CTA_DATASET,
    });
  }
  const population = -0.08;
  fact("population_change", {
    value: population,
    displayValue: formatValue(population, "percent", true),
    valueType: "percent",
    unit: "%",
    geography: "walkshed_0.5mi",
    timeframeStart: 2010,
    timeframeEnd: 2024,
    methodology: "Area-weighted block group totals within a half-mile walkshed (2010 SF1 against 2020-2024 ACS).",
    quality: "HIGH",
    source: ACS,
  });
  return facts;
}

export interface DossierOptions {
  /** Changes to the station's scoring input, for variants the fixture lacks (no recent data). */
  input?: Partial<StationScoreInput>;
  /** The station's last day of rows, which ends its series; the city's data-through date by default. */
  lastDay?: string;
  lastSuccessfulFetch?: string | null;
  /** Leave the narrative out, as the detail route does when it describes another data-through date. */
  withoutNarrative?: boolean;
}

/** The detail payload for one fixture station, as the detail route would answer for it. */
export function dossierFixture(name: FixtureStationName, options: DossierOptions = {}): StationDetailResponse {
  const dataThrough = fixture.dataThrough;
  const stations = fixture.stations;
  const index = stations.findIndex((s) => s.name === name);
  if (index < 0) throw new Error(`No fixture station named ${name}`);

  const inputs = stations.map((s, i) => (i === index ? { ...inputOf(s), ...options.input } : inputOf(s)));
  const scores = scoreStations(dataThrough, inputs);
  const input = inputs[index];
  const score = scores[index];
  const ctaStationId = input.ctaStationId!;

  const info = (i: number) => {
    const cta = inputs[i].ctaStationId!;
    const storedName = rosterName(cta);
    const lastDay = i === index ? (options.lastDay ?? dataThrough) : dataThrough;
    const days = syntheticDays(inputs[i].trailing, inputs[i].closures, lastDay);
    const last30 = days.filter((d) => d.serviceDate > addDays(lastDay, -30)).map((d) => d.entries);
    return {
      cta,
      stationId: inputs[i].stationId,
      name: storedName,
      displayName: displayNameFor({ ctaStationId: cta, name: storedName }),
      slug: SLUGS.get(cta) ?? null,
      lines: linesForStation(cta) as string[],
      days,
      lastDay,
      avg30d: mean(last30),
    };
  };
  const all = stations.map((_, i) => info(i));
  const self = all[index];
  const byCta = new Map(all.map((s, i) => [s.cta, i]));

  const statusOf = (i: number) => inputs[i].status;
  // The open closure's first day, for a closed station and for a closed neighbor's row (AE2).
  const closedAtOf = (i: number) =>
    inputs[i].status === "ACTIVE"
      ? null
      : (inputs[i].closures.find((c) => c.endDate === null || c.endDate > dataThrough)?.startDate ?? null);
  const closedAt = closedAtOf(index);

  // Comparisons over the fixture's ranked stations, as the detail route takes them over the city's.
  const rankedIdx = scores.flatMap((s, i) => (ranked(s) ? [i] : []));
  const avg30 = (i: number) => all[i].avg30d ?? 0;
  const systemMedian = median(rankedIdx.map(avg30)) ?? 0;
  const primaryLine = getPrimaryLine(self.lines);
  const lineMedian = primaryLine ? (median(rankedIdx.filter((i) => all[i].lines.includes(primaryLine)).map(avg30)) ?? 0) : 0;

  const neighborEntry = (cta: string | null | undefined): NeighborEntry | null => {
    const i = cta ? byCta.get(cta) : undefined;
    if (i === undefined) return null;
    const s = scores[i];
    return {
      id: all[i].stationId,
      slug: all[i].slug,
      name: all[i].name,
      displayName: all[i].displayName,
      status: statusOf(i),
      closedAt: closedAtOf(i),
      rolling30dAvg: avg30(i),
      tier: tierName(s.tier),
    };
  };
  const neighborIds = primaryLineNeighbors(ctaStationId, self.lines);
  const prev = neighborEntry(neighborIds?.prev);
  const next = neighborEntry(neighborIds?.next);
  const rankedOnly = (n: NeighborEntry | null): NeighborEntry | null =>
    n !== null && n.tier !== null && n.status === "ACTIVE" ? n : null;
  const neighborAvg = mean([rankedOnly(prev), rankedOnly(next)].flatMap((n) => (n ? [n.rolling30dAvg] : []))) ?? 0;

  const own30 = self.avg30d ?? 0;
  const vs = (baseline: number) => (baseline > 0 ? Math.round(((own30 - baseline) / baseline) * 100) : 0);

  const columns = scoreColumns(score);
  const displayNames = new Map(all.map((s) => [s.cta, s.displayName]));
  const whyCard = buildWhyCard({
    dataThrough,
    status: input.status,
    closedAt,
    openedAt: input.openedAt,
    closures: input.closures,
    ctaStationId,
    neighborClosures: inputs
      .filter((s) => s.closures.length > 0 && s.ctaStationId !== null)
      .map((s) => ({ ctaStationId: s.ctaStationId!, displayName: displayNames.get(s.ctaStationId!)!, closures: s.closures })),
    metrics: {
      ghostScore: columns.ghostScore,
      dataStatus: input.dataStatus,
      serviceDateMax: self.days.at(-1)?.serviceDate ?? null,
      tier: columns.tier,
      rank: columns.rank,
      rankedCount: columns.rankedCount,
      residualPct: columns.residualPct,
      yoyPct: columns.yoyPct,
      longRunPct: columns.longRunPct,
      erraticPct: columns.erraticPct,
      avg12m: input.avg12m,
      baselineAvg: columns.baselineAvg,
      yoyChangePct: columns.yoyChangePct,
      vs2019Pct: columns.vs2019Pct,
    },
    peers: columns.peerStationIds,
    peerStations: new Map(all.map((s) => [s.stationId, { slug: s.slug, displayName: s.displayName }])),
    days: self.days,
  });

  const facts = factsFor(input);
  const yoyReason = score.components.yoy.nullReason;
  const nearbyClosure =
    yoyReason?.kind === "neighbor-closure"
      ? { stationName: displayNames.get(yoyReason.neighborCtaStationId) ?? yoyReason.neighborCtaStationId, change: yoyReason.change, date: yoyReason.date }
      : null;
  const closureDef = STATION_CLOSURES.find((c) => c.ctaStationId === ctaStationId && (c.endDate === null || c.endDate > dataThrough));
  const narrativeInput: NarrativeStationInput = {
    stationId: input.stationId,
    ctaStationId,
    name: self.displayName,
    status: input.status,
    openedAt: input.openedAt,
    ranked: score.ranked,
    tier: score.tier,
    badge: score.badge,
    avg12m: input.avg12m,
    yoyChangePct: score.yoyChangePct,
    vs2019Pct: score.vs2019Pct,
    closure: input.status === "ACTIVE" || !closureDef ? null : { startDate: closureDef.startDate, endDate: closureDef.endDate, reason: closureDef.reason },
    nearbyClosure,
    facts: Object.fromEntries(Object.entries(facts).map(([key, f]) => [key, { value: f.value, quality: f.quality }])),
  };
  const [row] = generateNarratives([narrativeInput], dataThrough).rows;
  const narrative =
    row && !options.withoutNarrative
      ? {
          archetype: getArchetypeInfo(row.archetypeKey as ArchetypeKey),
          story: row.renderedStory,
          evidenceFactKeys: JSON.parse(row.evidenceFactKeys) as FactKey[],
          templateVersion: row.templateVersion,
          confidence: row.confidence,
          quality: row.quality,
          qualityNote: row.qualityNote ?? undefined,
          evidenceMeta: row.evidenceMeta as unknown as Record<string, unknown>,
          dataThrough,
        }
      : null;

  const sources = [...new Set(Object.values(facts).map((f) => f.source.name))].map((n) => SOURCES[n]);
  const seriesEnd = self.days.at(-1)?.serviceDate ?? null;
  const seriesStart = seriesEnd ? addDays(seriesEnd, -SERIES_DAYS_BEFORE_END) : null;

  return {
    station: {
      id: input.stationId,
      name: self.name,
      latitude: 41.88,
      longitude: -87.63,
      lines: self.lines,
      rolling30dAvg: self.avg30d,
      slug: self.slug,
      displayName: self.displayName,
      status: input.status,
      closedAt,
      openedAt: input.openedAt,
      dataStatus: toUiDataStatus(input.dataStatus),
    },
    series: seriesStart && seriesEnd ? seriesFor(seriesStart, seriesEnd, self.days) : null,
    metrics: {
      ranked: score.ranked,
      tier: tierName(score.tier),
      rank: score.rank,
      rankedCount: score.rankedCount,
      avg12m: input.avg12m,
      avg30d: self.avg30d,
      dataThrough,
      scoreVersion: columns.scoreVersion,
    },
    comparisons: {
      systemMedian: Math.round(systemMedian),
      primaryLine,
      lineMedian: Math.round(lineMedian),
      neighbors: { prev: rankedOnly(prev), next: rankedOnly(next), neighborAvg: Math.round(neighborAvg) },
      lineNeighbors: { prev, next },
      vsSystemMedian: vs(systemMedian),
      vsLineMedian: vs(lineMedian),
      vsNeighbors: vs(neighborAvg),
    },
    whyCard,
    facts,
    narrative,
    sources,
    dataThrough,
    lastSuccessfulFetch: options.lastSuccessfulFetch === undefined ? FIXTURE_LAST_REFRESH : options.lastSuccessfulFetch,
  };
}

/**
 * An open station with no riders in recent data, which score v2 leaves out of the ranking: Western
 * (O'Hare) with its rows ending on 2026-05-20 and its stored data status "missing".
 */
export function noDataDossier(): StationDetailResponse {
  return dossierFixture("Western (O'Hare)", { input: { dataStatus: "missing" }, lastDay: "2026-05-20" });
}

/** A station whose story describes another data-through date, so the route withholds it. */
export function noNarrativeDossier(name: FixtureStationName = "Halsted (Green)"): StationDetailResponse {
  return dossierFixture(name, { withoutNarrative: true });
}
