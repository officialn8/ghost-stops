import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
import { prisma } from "@/lib/prisma";
import { smallStationBadge } from "@/lib/scoring/score";
import { readSparklineRows, sparklineFor } from "@/lib/stations/ridership";
import { readFreshness } from "@/lib/sync/freshness";
import { toDay } from "@/lib/sync/window";
import { safeJsonParse, tierName, toUiDataStatus } from "@/lib/utils";
import type { StationListItem, StationListResponse } from "@/types/station";

/**
 * GET /api/chicago/stations: every Chicago station for the map and the ledger (KTD14). It takes no
 * query parameters; the shell sorts and filters. No UI reads it until U20, which replaces
 * stations-raw with it.
 */

// The response is cached by unstable_cache below, never rendered at build time.
export const dynamic = "force-dynamic";

/** An hour. The sync cron revalidates the tag after every run that writes, so this is only a fallback. */
const REVALIDATE_SECONDS = 3600;

/**
 * The whole payload in a fixed number of queries: the stations with their metrics, every
 * station's last week in one statement, and the freshness of the latest successful sync run.
 * Returns plain JSON, since the cache stores it serialized; null when the city does not exist.
 */
const readStationList = unstable_cache(
  async (): Promise<StationListResponse | null> => {
    const city = await prisma.city.findUnique({ where: { code: "chicago" }, select: { id: true } });
    if (!city) return null;

    const [stations, weekRows, freshness] = await Promise.all([
      prisma.station.findMany({
        where: { cityId: city.id },
        select: {
          id: true,
          slug: true,
          name: true,
          displayName: true,
          status: true,
          closedAt: true,
          latitude: true,
          longitude: true,
          lines: true,
          metrics: {
            select: {
              tier: true,
              rank: true,
              rankedCount: true,
              avg12m: true,
              avg30d: true,
              dataStatus: true,
              serviceDateMax: true,
              residualPct: true,
              yoyPct: true,
              longRunPct: true,
              yoyChangePct: true,
            },
          },
        },
      }),
      readSparklineRows(prisma, city.id),
      readFreshness(prisma),
    ]);

    const weeks = new Map<string, Map<string, number>>();
    for (const r of weekRows) {
      const week = weeks.get(r.stationId) ?? new Map<string, number>();
      week.set(r.serviceDate, r.entries);
      weeks.set(r.stationId, week);
    }

    const items: StationListItem[] = stations.map((s) => {
      const m = s.metrics;
      return {
        id: s.id,
        slug: s.slug ?? null,
        displayName: s.displayName ?? s.name,
        name: s.name,
        lines: safeJsonParse<string[]>(s.lines, []),
        status: s.status,
        closedAt: s.closedAt ? toDay(s.closedAt) : null,
        latitude: s.latitude,
        longitude: s.longitude,
        tier: tierName(m?.tier),
        rank: m?.rank ?? null,
        rankedCount: m?.rankedCount ?? null,
        avg12m: m?.avg12m ?? null,
        avg30d: m?.avg30d ?? null,
        dataStatus: toUiDataStatus(m?.dataStatus),
        sparkline: m ? sparklineFor(toDay(m.serviceDateMax), weeks.get(s.id) ?? new Map()) : null,
        badge: m
          ? smallStationBadge({
              residualPct: m.residualPct,
              yoyPct: m.yoyPct,
              longRunPct: m.longRunPct,
              yoyChangePct: m.yoyChangePct,
            })
          : null,
      };
    });

    // Rank 1 first, then the stations outside the ranking by name, so the default order is stable.
    items.sort(
      (a, b) =>
        (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY) ||
        a.displayName.localeCompare(b.displayName),
    );

    return { ...freshness, stations: items };
  },
  ["api-chicago-stations"],
  { tags: [STATIONS_CACHE_TAG], revalidate: REVALIDATE_SECONDS },
);

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
