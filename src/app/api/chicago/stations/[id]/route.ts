import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { findNeighbors, getPrimaryLine } from "@/lib/cta/stationSequences";
import { formatValue, ARCHETYPE_TITLES, ARCHETYPE_EMOJIS } from "@/lib/narratives";
import type { FactKey, ArchetypeKey } from "@/types/narrative";

const prisma = new PrismaClient();

// Helper to calculate median from an array of numbers
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: stationId } = await params;

    // Get station with metrics
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      include: {
        metrics: true,
        city: true
      }
    });

    if (!station || station.city.code !== "chicago") {
      return NextResponse.json({
        error: "Station not found"
      }, { status: 404 });
    }

    // Get last 90 days of ridership data (relative to latest station data)
    type RidershipRow = { serviceDate: Date | string; entries: number };
    const ridershipData = await prisma.$queryRaw<RidershipRow[]>`
      SELECT serviceDate, entries
      FROM RidershipDaily
      WHERE stationId = ${stationId}
        AND date(serviceDate) >= date(
          (SELECT MAX(serviceDate) FROM RidershipDaily WHERE stationId = ${stationId}),
          '-90 days'
        )
      ORDER BY serviceDate ASC
    `;

    // Calculate system average for comparison
    const systemStats = await prisma.stationMetrics.aggregate({
      where: {
        station: {
          cityId: station.cityId
        }
      },
      _avg: {
        rolling30dAvg: true
      }
    });

    const systemAverage = systemStats._avg.rolling30dAvg ?? 0;

    // Calculate percentile
    const totalStations = await prisma.station.count({
      where: { cityId: station.cityId }
    });

    const stationsWithLowerRidership = await prisma.station.count({
      where: {
        cityId: station.cityId,
        metrics: station.metrics?.rolling30dAvg !== null && station.metrics?.rolling30dAvg !== undefined ? {
          rolling30dAvg: {
            lt: station.metrics.rolling30dAvg
          }
        } : undefined
      }
    });

    const percentile = totalStations > 0
      ? Math.round((stationsWithLowerRidership / totalStations) * 100)
      : 0;

    // Parse station lines
    const stationLines: string[] = (() => {
      try {
        return JSON.parse(station.lines || '[]');
      } catch {
        return [];
      }
    })();

    // Get all station metrics for median calculations
    const allMetrics = await prisma.stationMetrics.findMany({
      where: {
        station: { cityId: station.cityId },
        rolling30dAvg: { not: null }
      },
      include: {
        station: true
      }
    });

    // Calculate system median
    const allRolling30dAvg = allMetrics
      .map(m => m.rolling30dAvg)
      .filter((v): v is number => v !== null);
    const systemMedian = calculateMedian(allRolling30dAvg);

    // Calculate line median for primary line
    const primaryLine = getPrimaryLine(stationLines);
    let lineMedian = 0;
    if (primaryLine) {
      const lineStationMetrics = allMetrics.filter(m => {
        try {
          const lines = JSON.parse(m.station.lines || '[]');
          return lines.includes(primaryLine);
        } catch {
          return false;
        }
      });
      const lineValues = lineStationMetrics
        .map(m => m.rolling30dAvg)
        .filter((v): v is number => v !== null);
      lineMedian = calculateMedian(lineValues);
    }

    // Find neighbor stations
    const neighborInfo = findNeighbors(station.name, stationLines);
    const primaryLineNeighbors = neighborInfo.find(n => n.line === primaryLine) || neighborInfo[0];

    // Fetch neighbor station data
    let prevNeighbor: { id: string; name: string; rolling30dAvg: number; ghostScore: number } | null = null;
    let nextNeighbor: { id: string; name: string; rolling30dAvg: number; ghostScore: number } | null = null;

    if (primaryLineNeighbors) {
      // Find prev station
      if (primaryLineNeighbors.prev) {
        const prevStation = await prisma.station.findFirst({
          where: {
            cityId: station.cityId,
            name: { contains: primaryLineNeighbors.prev }
          },
          include: { metrics: true }
        });
        if (prevStation && prevStation.metrics) {
          prevNeighbor = {
            id: prevStation.id,
            name: prevStation.name,
            rolling30dAvg: prevStation.metrics.rolling30dAvg ?? 0,
            ghostScore: prevStation.metrics.ghostScore
          };
        }
      }

      // Find next station
      if (primaryLineNeighbors.next) {
        const nextStation = await prisma.station.findFirst({
          where: {
            cityId: station.cityId,
            name: { contains: primaryLineNeighbors.next }
          },
          include: { metrics: true }
        });
        if (nextStation && nextStation.metrics) {
          nextNeighbor = {
            id: nextStation.id,
            name: nextStation.name,
            rolling30dAvg: nextStation.metrics.rolling30dAvg ?? 0,
            ghostScore: nextStation.metrics.ghostScore
          };
        }
      }
    }

    // Calculate neighbor average
    const neighborValues = [prevNeighbor?.rolling30dAvg, nextNeighbor?.rolling30dAvg]
      .filter((v): v is number => v !== null && v !== undefined);
    const neighborAvg = neighborValues.length > 0
      ? neighborValues.reduce((a, b) => a + b, 0) / neighborValues.length
      : 0;

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

    // Fetch facts and narrative for this station
    const facts = await prisma.stationFact.findMany({
      where: { stationId },
      include: { source: true },
    });

    const narrative = await prisma.stationNarrative.findUnique({
      where: { stationId },
    });

    // Build facts response object
    const factsResponse = facts.length > 0
      ? Object.fromEntries(
          facts.map((f) => [
            f.factKey,
            {
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

    // Build narrative response object
    let narrativeResponse = narrative
      ? {
          archetype: {
            key: narrative.archetypeKey as ArchetypeKey,
            title: ARCHETYPE_TITLES[narrative.archetypeKey as ArchetypeKey],
            emoji: ARCHETYPE_EMOJIS[narrative.archetypeKey as ArchetypeKey],
          },
          story: narrative.renderedStory,
          evidenceFactKeys: JSON.parse(narrative.evidenceFactKeys) as FactKey[],
          templateVersion: narrative.templateVersion,
          confidence: narrative.confidence,
          quality: narrative.quality,
          qualityNote: narrative.qualityNote ?? undefined,
          evidenceMeta: narrative.evidenceMeta ?? undefined,
        }
      : null;

    const isOhare = /o['’]?hare/i.test(station.name);
    const hasAirportArrivals = Boolean(factsResponse?.airport_arrivals);
    if (isOhare && hasAirportArrivals) {
      narrativeResponse = {
        archetype: {
          key: "airport_gateway",
          title: ARCHETYPE_TITLES.airport_gateway,
          emoji: ARCHETYPE_EMOJIS.airport_gateway,
        },
        story:
          "O'Hare is an airport-driven station. Local residential population doesn't explain its ridership—airport arrivals and traveler demand do. Census walkshed metrics are intentionally excluded here to avoid misleading comparisons.",
        evidenceFactKeys: ["airport_arrivals"],
        templateVersion: "airport_v1",
        confidence: 0.85,
        quality: "MEDIUM",
        qualityNote: "Airport arrivals are the primary driver; Census facts excluded.",
        evidenceMeta: { override: true },
      };
    }

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

    // Generate contextual explanation
    const generateExplanation = (): string => {
      if (station.metrics?.dataStatus === "missing" || station.metrics?.rolling30dAvg == null) {
        return "No ridership data available for this station.";
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

    // Format response
    const response = {
      station: {
        id: station.id,
        name: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        lines: stationLines,
        ghostScore: station.metrics?.ghostScore ?? 0,
        rolling30dAvg: station.metrics?.rolling30dAvg ?? null,
        trend: trend
      },
      ridershipSeries: ridershipData.map(r => {
        const serviceDate = r.serviceDate instanceof Date ? r.serviceDate : new Date(r.serviceDate);
        return {
          date: serviceDate.toISOString().split('T')[0],
          entries: r.entries
        };
      }),
      metrics: {
        ghostScore: station.metrics?.ghostScore ?? 0,
        percentile: percentile,
        systemAverage: Math.round(systemAverage),
        systemMedian: Math.round(systemMedian),
        explanation: generateExplanation()
      },
      comparisons: {
        systemMedian: Math.round(systemMedian),
        primaryLine: primaryLine,
        lineMedian: Math.round(lineMedian),
        neighbors: {
          prev: prevNeighbor,
          next: nextNeighbor,
          neighborAvg: Math.round(neighborAvg)
        },
        vsSystemMedian,
        vsLineMedian,
        vsNeighbors
      },
      // Facts + Narrative system
      facts: factsResponse,
      narrative: narrativeResponse,
      sources: sourcesResponse,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error("Station detail API error:", error);
    return NextResponse.json({
      error: "Failed to fetch station details"
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}