import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeDataStatus, safeJsonParse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
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

    // Build order by for Prisma
    type OrderByType = { metrics?: { ghostScore?: 'asc' | 'desc'; rolling30dAvg?: 'asc' | 'desc' }; name?: 'asc' | 'desc' };
    let orderBy: OrderByType = {};
    switch (sort) {
      case "ghost_score_desc":
        orderBy = { metrics: { ghostScore: 'desc' } };
        break;
      case "ghost_score_asc":
        orderBy = { metrics: { ghostScore: 'asc' } };
        break;
      case "name":
        orderBy = { name: 'asc' };
        break;
      case "ridership":
        orderBy = { metrics: { rolling30dAvg: 'desc' } };
        break;
      default:
        orderBy = { metrics: { ghostScore: 'desc' } };
    }

    // Get stations with metrics using Prisma
    const stations = await prisma.station.findMany({
      where: { cityId: chicagoCity.id },
      include: { metrics: true },
      orderBy
    });

    // Postgres sorts a missing metrics row first in a descending order, which would rank an
    // unscored station (State/Lake, closed) as the ghostiest. Keep unscored stations last; the
    // sort is stable, so the database order holds otherwise.
    if (sort !== "name") {
      stations.sort((a, b) => Number(a.metrics === null) - Number(b.metrics === null));
    }

    // Get max service date
    const latestMetric = await prisma.stationMetrics.findFirst({
      where: {
        station: { cityId: chicagoCity.id }
      },
      orderBy: { serviceDateMax: 'desc' },
      select: { serviceDateMax: true }
    });

    // Format response
    const formattedStations = stations.map(station => {
      const dataStatus = !station.metrics?.serviceDateMax 
        ? 'missing'
        : station.metrics.rolling30dAvg === 0 
          ? 'zero' 
          : 'available';

      return {
        id: station.id,
        name: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        lines: safeJsonParse<string[]>(station.lines, []),
        ghostScore: station.metrics?.ghostScore ?? 0,
        rolling30dAvg: station.metrics?.rolling30dAvg ?? 0,
        lastDayEntries: station.metrics?.lastDayEntries ?? 0,
        dataStatus: normalizeDataStatus(dataStatus)
      };
    });

    return NextResponse.json({
      stations: formattedStations,
      dataAsOf: latestMetric?.serviceDateMax?.toISOString() || new Date().toISOString()
    });

  } catch (error) {
    console.error("Chicago stations raw API error:", error);
    return NextResponse.json({
      error: "Failed to fetch Chicago stations",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}