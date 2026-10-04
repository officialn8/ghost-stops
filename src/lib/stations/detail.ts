/**
 * A station's detail payload (KTD14): what `GET /api/chicago/stations/{slug}` returns and what the
 * station page renders. Server-only: it reads the database.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveSlugAlias } from "@/lib/cta/slug";
import { adjacentStations, getPrimaryLine, primaryLineNeighbors } from "@/lib/cta/sequences";
import { formatValue, getArchetypeInfo, getFactLabel } from "@/lib/narratives";
import { mean, median } from "@/lib/scoring/components";
import { SCORE_VERSION } from "@/lib/scoring/score";
import { scoreWindows } from "@/lib/scoring/windows";
import { buildWhyCard, parsePeerRecord } from "@/lib/scoring/whyCard";
import { readStationDays, seriesFor, SERIES_DAYS_BEFORE_END } from "@/lib/stations/ridership";
import { isRanked } from "@/lib/sync/baseMetrics";
import { readFreshness } from "@/lib/sync/freshness";
import { addDays, optionalDay, toDay } from "@/lib/sync/window";
import { safeJsonParse, tierName, toUiDataStatus } from "@/lib/utils";
import type { FactKey, ArchetypeKey, DataSourceInfo } from "@/types/narrative";
import type {
  NeighborEntry,
  StationDetailFacts,
  StationDetailNarrative,
  StationDetailResponse,
} from "@/types/station";

const CITY_CODE = "chicago";

const STATION_INCLUDE = {
  metrics: true,
  closures: { select: { startDate: true, endDate: true } },
} satisfies Prisma.StationInclude;

/**
 * The station a path segment names, in KTD7's order: its slug, then a retired slug (answered with a
 * redirect to the current one), else nothing. A station id is not a name for it.
 */
async function resolveStation(key: string) {
  const station = await prisma.station.findFirst({
    where: { slug: key, city: { code: CITY_CODE } },
    include: STATION_INCLUDE,
  });
  if (station) return { station };
  const canonical = resolveSlugAlias(key);
  return canonical === undefined ? null : { redirectTo: canonical };
}

export type StationDetailResult =
  | { kind: "found"; detail: StationDetailResponse }
  /** A retired slug: answer with a permanent redirect to the current one. */
  | { kind: "redirect"; slug: string }
  | { kind: "not-found" };

/** The detail for the station a path segment names (slug or retired slug), or why there is none. */
export async function readStationDetail(key: string): Promise<StationDetailResult> {
  const resolved = await resolveStation(key);
  if (resolved?.redirectTo !== undefined) {
    return { kind: "redirect", slug: resolved.redirectTo };
  }
  const station = resolved?.station;
  if (!station) {
    return { kind: "not-found" };
  }
  const stationId = station.id;

  // Parse station lines
  const stationLines = safeJsonParse<string[]>(station.lines, []);
  const primaryLine = getPrimaryLine(stationLines);

  // The date the score was computed for; the why card, the erraticness window, and the
  // narrative check all key on it.
  const metricsDataThrough = optionalDay(station.metrics?.dataThrough);
  const trailingStart = metricsDataThrough ? scoreWindows(metricsDataThrough).trailing90.start : null;
  const peerRecord = parsePeerRecord(station.metrics?.peerStationIds);

  // Neighbor stations on the primary line, looked up by CTA station id in one query. Closed and
  // no-data neighbors are named in the line walk (State/Lake on the Brown Line Loop) but carry no
  // tier, and they stay out of the ranked pair behind the neighbor average.
  type Neighbor = { ranked: boolean; entry: NeighborEntry };
  const neighborIds = station.ctaStationId ? primaryLineNeighbors(station.ctaStationId, stationLines) : null;
  const neighborCtaIds = [neighborIds?.prev, neighborIds?.next].filter((id): id is string => !!id);
  // Every station next door on any line: a closure at one sets the why card's year-over-year aside.
  const adjacentCtaIds = station.ctaStationId ? adjacentStations(station.ctaStationId) : [];

  // The medians use ranked stations only, the isRanked rule: closed State/Lake's metrics row
  // reports 0 riders and would drag every comparison down.
  const [
    days,
    allMetrics,
    neighborStations,
    facts,
    narrative,
    peerStations,
    stationsNextDoor,
    freshness,
  ] = await Promise.all([
    // The last 91 days of the station's data, reaching back to the score's 90 days if they start earlier
    readStationDays(prisma, stationId, trailingStart),
    // Ranked station metrics for median calculations
    prisma.stationMetrics.findMany({
      where: {
        station: { cityId: station.cityId },
        rolling30dAvg: { not: null }
      },
      include: {
        station: true
      }
    }),
    neighborCtaIds.length > 0
      ? prisma.station.findMany({
          where: { cityId: station.cityId, ctaStationId: { in: neighborCtaIds } },
          select: {
            ctaStationId: true,
            id: true,
            name: true,
            slug: true,
            displayName: true,
            status: true,
            closedAt: true,
            metrics: { select: { rolling30dAvg: true, dataStatus: true, tier: true } }
          }
        })
      : Promise.resolve([]),
    prisma.stationFact.findMany({
      where: { stationId },
      include: { source: true },
    }),
    prisma.stationNarrative.findUnique({
      where: { stationId },
    }),
    peerRecord && peerRecord.stationIds.length > 0
      ? prisma.station.findMany({
          where: { id: { in: peerRecord.stationIds } },
          select: { id: true, slug: true, name: true, displayName: true },
        })
      : Promise.resolve([]),
    // Those stations with their recorded closures: a handful of rows at most.
    adjacentCtaIds.length > 0
      ? prisma.station.findMany({
          where: { cityId: station.cityId, ctaStationId: { in: adjacentCtaIds } },
          select: { ctaStationId: true, name: true, displayName: true, closures: { select: { startDate: true, endDate: true } } },
        })
      : Promise.resolve([]),
    readFreshness(prisma),
  ]);

  const neighborByCtaId = new Map(neighborStations.map(n => [n.ctaStationId, n]));
  const neighbor = (ctaStationId: string | null | undefined): Neighbor | null => {
    const found = ctaStationId ? neighborByCtaId.get(ctaStationId) : undefined;
    if (!found) return null;
    const named = {
      id: found.id,
      slug: found.slug,
      name: found.name,
      displayName: found.displayName ?? found.name,
      status: found.status,
      closedAt: optionalDay(found.closedAt),
      rolling30dAvg: found.metrics?.rolling30dAvg ?? 0,
    };
    const m = found.metrics;
    return m !== null && isRanked(found.status, m.dataStatus)
      ? { ranked: true, entry: { ...named, tier: tierName(m.tier) } }
      : { ranked: false, entry: { ...named, tier: null } };
  };
  const prevNeighbor = neighbor(neighborIds?.prev);
  const nextNeighbor = neighbor(neighborIds?.next);
  // The ranked pair behind the neighbor average: an unranked neighbor is null here.
  const rankedOnly = (n: Neighbor | null): NeighborEntry | null => (n?.ranked ? n.entry : null);
  const prevRanked = rankedOnly(prevNeighbor);
  const nextRanked = rankedOnly(nextNeighbor);

  const rankedMetrics = allMetrics.filter(m => isRanked(m.station.status, m.dataStatus));

  // Calculate system median
  const allRolling30dAvg = rankedMetrics
    .map(m => m.rolling30dAvg)
    .filter((v): v is number => v !== null);
  const systemMedian = median(allRolling30dAvg) ?? 0;

  // Calculate line median for primary line
  let lineMedian = 0;
  if (primaryLine) {
    const lineStationMetrics = rankedMetrics.filter(m =>
      safeJsonParse<string[]>(m.station.lines, []).includes(primaryLine)
    );
    const lineValues = lineStationMetrics
      .map(m => m.rolling30dAvg)
      .filter((v): v is number => v !== null);
    lineMedian = median(lineValues) ?? 0;
  }

  // Calculate neighbor average over ranked neighbors only
  const neighborAvg = mean(
    [prevRanked, nextRanked]
      .filter((n): n is NeighborEntry => n !== null)
      .map(n => n.rolling30dAvg)
  ) ?? 0;

  // Calculate percentage differences
  const stationAvg = station.metrics?.rolling30dAvg ?? 0;
  const vsSystemMedian = systemMedian > 0
    ? Math.round(((stationAvg - systemMedian) / systemMedian) * 100)
    : 0;
  const vsLineMedian = lineMedian > 0
    ? Math.round(((stationAvg - lineMedian) / lineMedian) * 100)
    : 0;
  const vsNeighbors = neighborAvg > 0
    ? Math.round(((stationAvg - neighborAvg) / neighborAvg) * 100)
    : 0;

  // The chart's range is the station's last date and the 90 days before it; the series adds the
  // missing days back as gaps.
  const seriesEnd = days.length > 0 ? days[days.length - 1].serviceDate : null;
  const seriesStart = seriesEnd ? addDays(seriesEnd, -SERIES_DAYS_BEFORE_END) : null;
  const seriesDays = seriesStart ? days.filter(d => d.serviceDate >= seriesStart) : [];

  // Build facts response object
  const factsResponse = facts.length > 0
    ? Object.fromEntries(
        facts.map((f) => [
          f.factKey,
          {
            label: getFactLabel(f.factKey),
            value: f.value,
            displayValue: formatValue(
              f.value,
              f.valueType as "number" | "percent" | "currency",
              f.factKey.includes("change") || f.factKey.includes("decline")
            ),
            valueType: f.valueType,
            unit: f.unit,
            geography: f.geography,
            timeframeStart: f.timeframeStart,
            timeframeEnd: f.timeframeEnd,
            methodology: f.methodology,
            sourceNote: f.sourceNote,
            quality: f.quality,
            qualityNote: f.qualityNote ?? undefined,
            evidenceMeta: f.evidenceMeta ?? undefined,
            source: {
              name: f.source.name,
              url: f.source.url,
            },
          },
        ])
      )
    : null;

  // Every station's story, O'Hare's included, comes from the narrative job. A story written for
  // another data-through date than the metrics is withheld (KTD11): the why card stands alone
  // rather than beside prose that quotes other numbers.
  const narrativeDataThrough = optionalDay(narrative?.dataThrough);
  const narrativeResponse: StationDetailNarrative | null =
    narrative && narrativeDataThrough !== null && narrativeDataThrough === metricsDataThrough
      ? {
          archetype: getArchetypeInfo(narrative.archetypeKey as ArchetypeKey),
          story: narrative.renderedStory,
          evidenceFactKeys: JSON.parse(narrative.evidenceFactKeys) as FactKey[],
          templateVersion: narrative.templateVersion,
          confidence: narrative.confidence,
          quality: narrative.quality,
          qualityNote: narrative.qualityNote ?? undefined,
          evidenceMeta: (narrative.evidenceMeta ?? undefined) as StationDetailNarrative["evidenceMeta"],
          dataThrough: narrativeDataThrough,
        }
      : null;

  // Get unique sources for citation
  const sourcesResponse = facts.length > 0
    ? Array.from(
        new Map(
          facts.map((f) => [
            f.source.code,
            {
              code: f.source.code,
              name: f.source.name,
              url: f.source.url,
              apiUrl: f.source.apiUrl,
              license: f.source.license,
              refreshCadence: f.source.refreshCadence ?? undefined,
              lastFetched: f.source.lastFetched
                ? f.source.lastFetched.toISOString()
                : undefined,
              lastSuccessfulFetch: f.source.lastSuccessfulFetch
                ? f.source.lastSuccessfulFetch.toISOString()
                : undefined,
              status: f.source.status,
            },
          ])
        ).values()
      )
    : null;

  // Closed and no-data stations are left out of every comparison (R5, KTD9); the panels hide their bars.
  const ranked = station.metrics !== null && isRanked(station.status, station.metrics.dataStatus);

  // The closures next door, one entry per station, for the why card's year-over-year row.
  const neighborClosures = stationsNextDoor.flatMap((s) =>
    s.ctaStationId === null
      ? []
      : [{
          ctaStationId: s.ctaStationId,
          displayName: s.displayName ?? s.name,
          closures: s.closures.map((c) => ({ startDate: toDay(c.startDate), endDate: optionalDay(c.endDate) })),
        }]
  );

  // The why card needs score v2 metrics, which carry the date they were computed for. A v1 row
  // that a Phase 2 sync stamped with dataThrough holds no v2 columns.
  const m = station.metrics;
  const whyCard = m && metricsDataThrough && m.scoreVersion >= SCORE_VERSION
    ? buildWhyCard({
        dataThrough: metricsDataThrough,
        status: station.status,
        closedAt: optionalDay(station.closedAt),
        openedAt: optionalDay(station.openedAt),
        closures: station.closures.map(c => ({ startDate: toDay(c.startDate), endDate: optionalDay(c.endDate) })),
        ctaStationId: station.ctaStationId,
        neighborClosures,
        metrics: {
          ghostScore: m.ghostScore,
          dataStatus: m.dataStatus,
          serviceDateMax: optionalDay(m.serviceDateMax),
          tier: m.tier,
          rank: m.rank,
          rankedCount: m.rankedCount,
          residualPct: m.residualPct,
          yoyPct: m.yoyPct,
          longRunPct: m.longRunPct,
          erraticPct: m.erraticPct,
          avg12m: m.avg12m,
          baselineAvg: m.baselineAvg,
          yoyChangePct: m.yoyChangePct,
          vs2019Pct: m.vs2019Pct,
        },
        peers: peerRecord,
        peerStations: new Map(peerStations.map(p => [p.id, { slug: p.slug, displayName: p.displayName ?? p.name }])),
        days,
      })
    : null;

  const response: StationDetailResponse = {
    station: {
      id: station.id,
      name: station.name,
      latitude: station.latitude,
      longitude: station.longitude,
      lines: stationLines,
      rolling30dAvg: station.metrics?.rolling30dAvg ?? null,
      slug: station.slug,
      displayName: station.displayName ?? station.name,
      status: station.status,
      closedAt: optionalDay(station.closedAt),
      openedAt: optionalDay(station.openedAt),
      dataStatus: toUiDataStatus(station.metrics?.dataStatus)
    },
    series: seriesStart && seriesEnd ? seriesFor(seriesStart, seriesEnd, seriesDays) : null,
    metrics: {
      ranked,
      tier: tierName(station.metrics?.tier),
      rank: station.metrics?.rank ?? null,
      rankedCount: station.metrics?.rankedCount ?? null,
      avg12m: station.metrics?.avg12m ?? null,
      avg30d: station.metrics?.avg30d ?? null,
      dataThrough: metricsDataThrough,
      scoreVersion: station.metrics?.scoreVersion ?? null
    },
    comparisons: {
      systemMedian: Math.round(systemMedian),
      primaryLine: primaryLine,
      lineMedian: Math.round(lineMedian),
      neighbors: {
        prev: prevRanked,
        next: nextRanked,
        neighborAvg: Math.round(neighborAvg)
      },
      lineNeighbors: {
        prev: prevNeighbor?.entry ?? null,
        next: nextNeighbor?.entry ?? null
      },
      vsSystemMedian,
      vsLineMedian,
      vsNeighbors
    },
    whyCard,
    // Facts + Narrative system
    facts: factsResponse as StationDetailFacts | null,
    narrative: narrativeResponse,
    sources: sourcesResponse as DataSourceInfo[] | null,
    // Freshness from the latest successful sync run, the same value the list states (KTD14)
    dataThrough: freshness.dataThrough,
    lastSuccessfulFetch: freshness.lastSuccessfulFetch,
  };

  return { kind: "found", detail: response };
}
