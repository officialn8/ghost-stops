import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Simple in-memory cache for arrivals
const arrivalsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const stationId = params.id;
    const ctaApiKey = process.env.CTA_API_KEY;

    if (!ctaApiKey) {
      return NextResponse.json({
        error: "Real-time arrivals not configured"
      }, { status: 501 });
    }

    // Check cache
    const cached = arrivalsCache.get(stationId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json(cached.data);
    }

    // Get station to find external ID
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: { externalId: true, name: true, lines: true }
    });

    if (!station || !station.externalId) {
      return NextResponse.json({
        error: "Station not found or no external ID"
      }, { status: 404 });
    }

    // TODO: Implement actual CTA Train Tracker API call
    // For now, return mock data
    const mockArrivals = {
      arrivals: [
        {
          routeId: JSON.parse(station.lines || '[]')[0] || "Red",
          destination: "Howard",
          prediction: "2 min",
          scheduled: new Date(Date.now() + 2 * 60 * 1000).toISOString()
        },
        {
          routeId: JSON.parse(station.lines || '[]')[0] || "Red",
          destination: "95th/Dan Ryan",
          prediction: "5 min",
          scheduled: new Date(Date.now() + 5 * 60 * 1000).toISOString()
        }
      ],
      stationName: station.name,
      timestamp: new Date().toISOString()
    };

    // Cache the response
    arrivalsCache.set(stationId, {
      data: mockArrivals,
      timestamp: Date.now()
    });

    return NextResponse.json(mockArrivals);

    // Real implementation would look like:
    /*
    const response = await fetch(
      `https://www.transitchicago.com/api/1.0/ttarrivals.aspx?key=${ctaApiKey}&stpid=${station.externalId}&outputType=JSON`
    );
    const data = await response.json();
    // Parse and format CTA response
    */

  } catch (error) {
    console.error("Arrivals API error:", error);
    return NextResponse.json({
      error: "Failed to fetch arrivals"
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}