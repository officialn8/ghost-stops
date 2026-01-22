import { NextRequest, NextResponse } from "next/server";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sort = searchParams.get("sort") || "ghost_score_desc";

    // Open database connection
    const db = await open({
      filename: './prisma/dev.db',
      driver: sqlite3.Database
    });

    // Get Chicago city ID
    const chicagoCity = await db.get(
      "SELECT id FROM City WHERE code = 'chicago'"
    );

    if (!chicagoCity) {
      return NextResponse.json({
        error: "Chicago data not found. Run ETL first."
      }, { status: 404 });
    }

    // Build order clause
    let orderClause = '';
    switch (sort) {
      case "ghost_score_desc":
        orderClause = "m.ghostScore DESC";
        break;
      case "ghost_score_asc":
        orderClause = "m.ghostScore ASC";
        break;
      case "name":
        orderClause = "s.name ASC";
        break;
      case "ridership":
        orderClause = "m.rolling30dAvg DESC";
        break;
      default:
        orderClause = "m.ghostScore DESC";
    }

    // Get stations with metrics using raw SQL
    const stations = await db.all(`
      SELECT
        s.id,
        s.name,
        s.latitude,
        s.longitude,
        s.lines,
        m.ghostScore,
        m.rolling30dAvg,
        m.lastDayEntries,
        m.serviceDateMax,
        CASE
          WHEN m.serviceDateMax IS NULL THEN 'missing'
          WHEN m.rolling30dAvg = 0 THEN 'zero'
          ELSE 'available'
        END as dataStatus
      FROM Station s
      LEFT JOIN StationMetrics m ON s.id = m.stationId
      WHERE s.cityId = ?
      ORDER BY ${orderClause}
    `, [chicagoCity.id]);

    // Get max service date
    const latestDate = await db.get(`
      SELECT MAX(serviceDateMax) as maxDate
      FROM StationMetrics m
      JOIN Station s ON m.stationId = s.id
      WHERE s.cityId = ?
    `, [chicagoCity.id]);

    await db.close();

    // Format response
    const formattedStations = stations.map(station => ({
      id: station.id,
      name: station.name,
      latitude: station.latitude,
      longitude: station.longitude,
      lines: JSON.parse(station.lines || "[]"),
      ghostScore: station.ghostScore || 0,
      rolling30dAvg: station.rolling30dAvg || 0,
      lastDayEntries: station.lastDayEntries || 0,
      dataStatus: station.dataStatus || 'missing'
    }));

    return NextResponse.json({
      stations: formattedStations,
      dataAsOf: latestDate?.maxDate || new Date().toISOString()
    });

  } catch (error) {
    console.error("Chicago stations raw API error:", error);
    return NextResponse.json({
      error: "Failed to fetch Chicago stations",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}