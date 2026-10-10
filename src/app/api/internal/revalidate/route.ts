import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { bearerMatches } from "@/lib/bearerAuth";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
import { prisma } from "@/lib/prisma";

/**
 * The worker's cache refresh after a nightly write (KTD8): a POST with its own bearer secret,
 * WORKER_REVALIDATE_SECRET, never CRON_SECRET. It reads no body and expires the `stations` tag only
 * when the most recently reduced LiveDay row was written within the last quarter hour; otherwise
 * it answers skipped. That check is shared state, so it holds across function instances, and a
 * leaked secret can expire the cache only in the quarter hour after each write; the answer to a
 * leak is rotating the secret at both ends (docs-private/runbooks/live-worker.md).
 */
export const dynamic = "force-dynamic";

/** How long after a reduction the route will expire the cache. */
export const REVALIDATE_WINDOW_MS = 15 * 60_000;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
    if (!bearerMatches(request.headers.get("authorization"), process.env.WORKER_REVALIDATE_SECRET)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const latest = await prisma.liveDay.findFirst({ orderBy: { reducedAt: "desc" }, select: { reducedAt: true } });
    if (latest === null || Date.now() - latest.reducedAt.getTime() > REVALIDATE_WINDOW_MS) {
        return NextResponse.json({ skipped: true }, { headers: NO_STORE });
    }
    // Expire now rather than serve the old list while it refreshes, as the cron route does.
    revalidateTag(STATIONS_CACHE_TAG, { expire: 0 });
    return NextResponse.json({ revalidated: [STATIONS_CACHE_TAG] }, { headers: NO_STORE });
}
