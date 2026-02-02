import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "25");
    const sort = searchParams.get("sort") || "ghost_score_desc";

    // Get Chicago city
    const chicagoCity = await prisma.city.findUnique({
      where: { code: "chicago" }
    });

    if (!chicagoCity) {
      return NextResponse.json({
        error: "Chicago data not found. Run ETL first."
      }, { status: 404 });
    }

    // Get all metrics first
    const allMetrics = await prisma.stationMetrics.findMany({
      where: {
        station: {
          cityId: chicagoCity.id
        }
      }
    });

    // Create a map of stationId to metrics for quick lookup
    const metricsMap = new Map(
      allMetrics.map(metric => [metric.stationId, metric])
    );

    // Get stations separately
    const allStations = await prisma.station.findMany({
      where: {
        cityId: chicagoCity.id
      }
    });

    // Combine stations with metrics
    const stationsWithMetrics = allStations.map(station => ({
      ...station,
      metrics: metricsMap.get(station.id)
    }));

    // Sort stations based on sort parameter
    const sortedStations = stationsWithMetrics.sort((a, b) => {
      switch (sort) {
        case "ghost_score_desc":
          return (b.metrics?.ghostScore || 0) - (a.metrics?.ghostScore || 0);
        case "ghost_score_asc":
          return (a.metrics?.ghostScore || 0) - (b.metrics?.ghostScore || 0);
        case "name":
          return a.name.localeCompare(b.name);
        case "ridership":
          return (b.metrics?.rolling30dAvg || 0) - (a.metrics?.rolling30dAvg || 0);
        default:
          return (b.metrics?.ghostScore || 0) - (a.metrics?.ghostScore || 0);
      }
    });

    // Take only the requested limit
    const limitedStations = sortedStations.slice(0, limit);

    // Get last 7 days of ridership for sparklines
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stationIds = limitedStations.map(s => s.id);
    const recentRidership = await prisma.ridershipDaily.findMany({
      where: {
        stationId: { in: stationIds },
        serviceDate: { gte: sevenDaysAgo }
      },
      orderBy: { serviceDate: 'asc' }
    });

    // Group ridership by station
    const sparklineMap = new Map<string, number[]>();
    for (const r of recentRidership) {
      const existing = sparklineMap.get(r.stationId) || [];
      existing.push(r.entries);
      sparklineMap.set(r.stationId, existing);
    }

    // Get max service date for "data as of" info
    const latestMetric = allMetrics.reduce((latest, current) => {
      if (!latest || current.serviceDateMax > latest.serviceDateMax) {
        return current;
      }
      return latest;
    }, null as typeof allMetrics[0] | null);

    // Format response with real data
    const formattedStations = limitedStations.map(station => {
      // Calculate trend
      const rolling30d = station.metrics?.rolling30dAvg ?? 0;
      const rolling90d = station.metrics?.rolling90dAvg ?? 0;
      let trend: number | null = null;

      if (rolling90d > 0 && rolling30d !== null) {
        // Calculate percentage change from 90-day to 30-day average
        trend = ((rolling30d - rolling90d) / rolling90d) * 100;
      }

      return {
        id: station.id,
        name: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        lines: (() => {
          try {
            return JSON.parse(station.lines || '[]');
          } catch {
            return [];
          }
        })(),
        ghostScore: station.metrics?.ghostScore || 0,
        rolling30dAvg: station.metrics?.rolling30dAvg || null,
        trend: trend,
        sparkline: sparklineMap.get(station.id) || []
      };
    });

    return NextResponse.json({
      stations: formattedStations,
      dataAsOf: latestMetric?.serviceDateMax || new Date().toISOString()
    });

  } catch (error) {
    console.error("Chicago stations API error:", error);
    return NextResponse.json({
      error: "Failed to fetch Chicago stations",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}