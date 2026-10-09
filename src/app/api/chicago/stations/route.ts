import { NextResponse } from "next/server";
import { readStationList } from "@/lib/stations/list";

/**
 * GET /api/chicago/stations: every Chicago station for the map and the ledger (KTD14). It takes no
 * query parameters; the shell sorts and filters. The reader lives in src/lib/stations/list.ts.
 */

// The response is cached by unstable_cache in the reader, never rendered at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body = await readStationList();
    if (body === null) {
      return NextResponse.json({ error: "Chicago data not found" }, { status: 404 });
    }
    return NextResponse.json(body);
  } catch (error) {
    // The error stays in the server log; the body never carries its message.
    console.error("Chicago stations API error:", error);
    return NextResponse.json({ error: "Failed to load stations" }, { status: 500 });
  }
}
