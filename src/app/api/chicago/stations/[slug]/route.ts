import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveSlugAlias } from "@/lib/cta/slug";
import { getPrimaryLine, primaryLineNeighbors } from "@/lib/cta/sequences";
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
  RankedNeighborEntry,
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
 * The station a path segment names, in KTD7's order: its slug, a retired slug (answered with a
 * redirect to the current one), its id (the v1 panels fetch by id until U21), else nothing. One
 * query finds both the slug match and the id match; the order is applied here.
 */
async function resolveStation(key: string) {
  const matches = await prisma.station.findMany({
    where: { OR: [{ slug: key }, { id: key }], city: { code: CITY_CODE } },
    include: STATION_INCLUDE,
  });
  const bySlug = matches.find((s) => s.slug === key);
  if (bySlug) return { station: bySlug };
  const canonical = resolveSlugAlias(key);
  if (canonical !== undefined) return { redirectTo: canonical };
  const byId = matches.find((s) => s.id === key);
  return byId ? { station: byId } : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug: key } = await params;

    const resolved = await resolveStation(key);
    if (resolved?.redirectTo !== undefined) {
      const location = new URL(`/api/chicago/stations/${encodeURIComponent(resolved.redirectTo)}`, request.nextUrl.origin);
      return NextResponse.redirect(location, 308);
    }
    const station = resolved?.station;
    if (!station) {
      return NextResponse.json({
        error: "Station not found"
      }, { status: 404 });
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
    // no-data neighbors are named in the line walk (State/Lake on the Brown Line Loop) but carry
    // no score; the v1 neighbors keep them null.
    type Neighbor = { ranked: true; entry: RankedNeighborEntry } | { ranked: false; entry: NeighborEntry };
    const neighborIds = station.ctaStationId ? primaryLineNeighbors(station.ctaStationId, stationLines) : null;
    const neighborCtaIds = [neighborIds?.prev, neighborIds?.next].filter((id): id is string => !!id);

    // Peer comparisons (average, percentile, medians) use ranked stations only, the isRanked rule:
    // closed State/Lake's metrics row reports 0 riders and would drag every comparison down.
    // A station with no 30-day average (no metrics row) has no percentile: it reports 0.
    const ownRolling30dAvg = station.metrics?.rolling30dAvg ?? null;
    const [
      days,
      systemStats,
      totalStations,
      stationsWithLowerRidership,
      allMetrics,
      neighborStations,
      facts,
      narrative,
      peerStations,
      freshness,
    ] = await Promise.all([
      // The last 91 days of the station's data, reaching back to the score's 90 days if they start earlier
      readStationDays(prisma, stationId, trailingStart),
      prisma.stationMetrics.aggregate({
        where: {
          station: { cityId: station.cityId, status: "ACTIVE" },
          dataStatus: "normal"
        },
        _avg: {
          rolling30dAvg: true
        }
      }),
      prisma.station.count({
        where: { cityId: station.cityId, status: "ACTIVE", metrics: { dataStatus: "normal" } }
      }),
      // Without the station's own average Prisma would drop the filter and count every ranked station.
      ownRolling30dAvg === null
        ? Promise.resolve(0)
        : prisma.station.count({
            where: {
              cityId: station.cityId,
              status: "ACTIVE",
              metrics: { dataStatus: "normal", rolling30dAvg: { lt: ownRolling30dAvg } }
            }
          }),
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
              metrics: { select: { rolling30dAvg: true, ghostScore: true, dataStatus: true, tier: true } }
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
        rolling30dAvg: found.metrics?.rolling30dAvg ?? 0,
      };
      const m = found.metrics;
      return m !== null && isRanked(found.status, m.dataStatus)
        ? { ranked: true, entry: { ...named, ghostScore: m.ghostScore, tier: tierName(m.tier) } }
        : { ranked: false, entry: { ...named, ghostScore: null, tier: null } };
    };
    const prevNeighbor = neighbor(neighborIds?.prev);
    const nextNeighbor = neighbor(neighborIds?.next);
    // v1: an unranked neighbor is null, so the v1 pills show no badge for a station with no score.
    const rankedOnly = (n: Neighbor | null): RankedNeighborEntry | null => (n?.ranked ? n.entry : null);
    const prevRanked = rankedOnly(prevNeighbor);
    const nextRanked = rankedOnly(nextNeighbor);

    const systemAverage = systemStats._avg.rolling30dAvg ?? 0;

    const percentile = ownRolling30dAvg !== null && totalStations > 0
      ? Math.round((stationsWithLowerRidership / totalStations) * 100)
      : 0;

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
        .filter((n): n is RankedNeighborEntry => n !== null)
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

    // The v1 chart's range is the station's last date and the 90 days before it; the series adds
    // the missing days back as gaps.
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

    // Generate contextual explanation
    const generateExplanation = (): string => {
      if (!station.metrics || !ranked || station.metrics.rolling30dAvg == null) {
        return station.status === "CLOSED" || station.status === "TEMP_CLOSED"
          ? "This station is closed, so it is not compared with other stations."
          : "No ridership data available for this station.";
      }

      const insights: string[] = [];

      // Use median for comparison (more robust than mean)
      const diffFromMedian = stationAvg - systemMedian;
      const percentDiffFromMedian = systemMedian > 0
        ? Math.round((Math.abs(diffFromMedian) / systemMedian) * 100)
        : 0;

      // Primary ridership comparison
      if (diffFromMedian < 0) {
        insights.push(`This station has ${percentDiffFromMedian}% less ridership than the system median`);
      } else if (diffFromMedian > 0) {
        insights.push(`This station has ${percentDiffFromMedian}% more ridership than the system median`);
      } else {
        insights.push("This station matches the system median ridership");
      }

      // Line comparison context
      if (primaryLine && lineMedian > 0) {
        const lineDiff = stationAvg - lineMedian;
        const linePercentDiff = Math.round((Math.abs(lineDiff) / lineMedian) * 100);
        if (lineDiff < -20 && linePercentDiff > 30) {
          insights.push(`${linePercentDiff}% below the ${primaryLine} Line median`);
        }
      }

      // Neighbor comparison
      if (neighborAvg > 0 && stationAvg < neighborAvg * 0.6) {
        const neighborPercentDiff = Math.round(((neighborAvg - stationAvg) / neighborAvg) * 100);
        insights.push(`${neighborPercentDiff}% less than neighboring stations`);
      }

      return insights.join(". ") + ".";
    };

    // Calculate trend
    const rolling30d = station.metrics?.rolling30dAvg ?? 0;
    const rolling90d = station.metrics?.rolling90dAvg ?? 0;
    let trend: number | null = null;

    if (rolling90d > 0 && rolling30d !== null) {
      // Calculate percentage change from 90-day to 30-day average
      trend = ((rolling30d - rolling90d) / rolling90d) * 100;
    }

    // The why card needs score v2 metrics, which carry the date they were computed for. A v1 row
    // that a Phase 2 sync stamped with dataThrough still holds the v1 score and no v2 columns.
    const m = station.metrics;
    const whyCard = m && metricsDataThrough && m.scoreVersion >= SCORE_VERSION
      ? buildWhyCard({
          dataThrough: metricsDataThrough,
          status: station.status,
          closedAt: optionalDay(station.closedAt),
          openedAt: optionalDay(station.openedAt),
          closures: station.closures.map(c => ({ startDate: toDay(c.startDate), endDate: optionalDay(c.endDate) })),
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

    // Format response: the v1 fields keep their meaning until U21; the rest is additive.
    const response: StationDetailResponse = {
      station: {
        id: station.id,
        name: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        lines: stationLines,
        ghostScore: station.metrics?.ghostScore ?? 0,
        rolling30dAvg: station.metrics?.rolling30dAvg ?? null,
        trend: trend,
        slug: station.slug,
        displayName: station.displayName ?? station.name,
        status: station.status,
        closedAt: optionalDay(station.closedAt),
        openedAt: optionalDay(station.openedAt),
        dataStatus: toUiDataStatus(station.metrics?.dataStatus)
      },
      ridershipSeries: seriesDays.map(d => ({ date: d.serviceDate, entries: d.entries })),
      series: seriesStart && seriesEnd ? seriesFor(seriesStart, seriesEnd, seriesDays) : null,
      metrics: {
        ghostScore: station.metrics?.ghostScore ?? 0,
        percentile: percentile,
        systemAverage: Math.round(systemAverage),
        systemMedian: Math.round(systemMedian),
        explanation: generateExplanation(),
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

    return NextResponse.json(response);

  } catch (error) {
    // The error stays in the server log; the body never carries its message.
    console.error("Station detail API error:", error);
    return NextResponse.json({
      error: "Failed to fetch station details"
    }, { status: 500 });
  }
}
