import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export async function GET() {
  const prisma = new PrismaClient();

  try {
    // Test 1: Can we connect?
    const cityCount = await prisma.city.count();

    // Test 2: Can we get Chicago?
    const chicago = await prisma.city.findUnique({
      where: { code: "chicago" }
    });

    // Test 3: Can we get stations?
    const stationCount = await prisma.station.count();

    // Test 4: Get a few stations without metrics
    const stationsNoMetrics = await prisma.station.findMany({
      take: 5
    });

    // Test 5: Get a few stations with metrics
    let stationsWithMetrics: any[] = [];
    try {
      stationsWithMetrics = await prisma.station.findMany({
        take: 5,
        include: {
          metrics: true
        }
      });
    } catch (metricsError) {
      console.error("Error fetching with metrics:", metricsError);
    }

    return NextResponse.json({
      tests: {
        cityCount,
        chicago,
        stationCount,
        stationsNoMetrics,
        stationsWithMetrics,
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: "Test failed",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}