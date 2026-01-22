import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getMockLinesForStation } from "@/lib/ctaLineColors";

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

    // Get max service date for "data as of" info
    const latestMetric = allMetrics.reduce((latest, current) => {
      if (!latest || current.serviceDateMax > latest.serviceDateMax) {
        return current;
      }
      return latest;
    }, null as typeof allMetrics[0] | null);

    // Format response with real data
    const formattedStations = limitedStations.map(station => ({
      id: station.id,
      name: station.name,
      latitude: station.latitude,
      longitude: station.longitude,
      lines: getMockLinesForStation(station.name), // Still use mock lines until ETL is fixed
      ghostScore: station.metrics?.ghostScore || 0,
      rolling30dAvg: station.metrics?.rolling30dAvg || 0,
      lastDayEntries: station.metrics?.lastDayEntries || 0
    }));

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