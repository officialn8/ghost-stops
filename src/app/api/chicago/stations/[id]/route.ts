import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

    // Get last 90 days of ridership data
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const ridershipData = await prisma.ridershipDaily.findMany({
      where: {
        stationId: stationId,
        serviceDate: {
          gte: ninetyDaysAgo
        }
      },
      orderBy: {
        serviceDate: 'asc'
      }
    });

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

    const systemAverage = systemStats._avg.rolling30dAvg || 0;

    // Calculate percentile
    const totalStations = await prisma.station.count({
      where: { cityId: station.cityId }
    });

    const stationsWithLowerRidership = await prisma.station.count({
      where: {
        cityId: station.cityId,
        metrics: {
          rolling30dAvg: {
            lt: station.metrics?.rolling30dAvg || 0
          }
        }
      }
    });

    const percentile = Math.round((stationsWithLowerRidership / totalStations) * 100);

    // Format response
    const response = {
      station: {
        id: station.id,
        name: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        lines: JSON.parse(station.lines || '[]'),
        ghostScore: station.metrics?.ghostScore || 0,
        rolling30dAvg: station.metrics?.rolling30dAvg || 0,
        lastDayEntries: station.metrics?.lastDayEntries || 0
      },
      ridershipSeries: ridershipData.map(r => ({
        date: r.serviceDate.toISOString().split('T')[0],
        entries: r.entries
      })),
      metrics: {
        ghostScore: station.metrics?.ghostScore || 0,
        percentile: percentile,
        systemAverage: Math.round(systemAverage),
        explanation: station.metrics?.rolling30dAvg
          ? `This station has ${Math.round(((systemAverage - station.metrics.rolling30dAvg) / systemAverage) * 100)}% less ridership than the system average`
          : "No ridership data available"
      }
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