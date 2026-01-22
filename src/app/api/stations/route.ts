import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  try {
    const stations = await prisma.station.findMany();
    return NextResponse.json(stations, { status: 200 });
  } catch (error) {
    console.error("Prisma API Error:", error);
    return NextResponse.json({ error: "Failed to fetch stations" }, { status: 500 });
  }
}
