import { NextRequest, NextResponse } from "next/server";
import { readStationDetail } from "@/lib/stations/detail";

/** GET /api/chicago/stations/{slug or uuid}: one station's detail (src/lib/stations/detail.ts). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug: key } = await params;
    const result = await readStationDetail(key);
    if (result.kind === "redirect") {
      const location = new URL(`/api/chicago/stations/${encodeURIComponent(result.slug)}`, request.nextUrl.origin);
      return NextResponse.redirect(location, 308);
    }
    if (result.kind === "not-found") {
      return NextResponse.json({ error: "Station not found" }, { status: 404 });
    }
    return NextResponse.json(result.detail);
  } catch (error) {
    // The error stays in the server log; the body never carries its message.
    console.error("Station detail API error:", error);
    return NextResponse.json({
      error: "Failed to fetch station details"
    }, { status: 500 });
  }
}
