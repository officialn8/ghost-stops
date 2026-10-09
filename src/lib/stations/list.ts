import { unstable_cache } from "next/cache";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
import { prisma } from "@/lib/prisma";
import { smallStationBadge } from "@/lib/scoring/score";
import { readSparklineRows, sparklineFor } from "@/lib/stations/ridership";
import { readFreshness } from "@/lib/sync/freshness";
import { optionalDay, toDay } from "@/lib/sync/window";
import { safeJsonParse, tierName, toUiDataStatus } from "@/lib/utils";
import type { StationListItem, StationListResponse } from "@/types/station";

/**
 * The station list (KTD14): what `GET /api/chicago/stations` answers and what the method page
 * reads for its live example row. Cached under the stations tag, which the sync cron expires.
 */

/** An hour. The sync cron revalidates the tag after every run that writes, so this is only a fallback. */
const REVALIDATE_SECONDS = 3600;

/**
 * The whole payload in a fixed number of queries: the stations with their metrics, every
 * station's last week in one statement, and the freshness of the latest successful sync run.
 * Returns plain JSON, since the cache stores it serialized; null when the city does not exist.
 */
export const readStationList = unstable_cache(
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
              ghostScore: true,
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
        closedAt: optionalDay(s.closedAt),
        latitude: s.latitude,
        longitude: s.longitude,
        tier: tierName(m?.tier),
        rank: m?.rank ?? null,
        rankedCount: m?.rankedCount ?? null,
        score: m && m.rank !== null ? m.ghostScore : null,
        avg12m: m?.avg12m ?? null,
        avg30d: m?.avg30d ?? null,
        dataStatus: toUiDataStatus(m?.dataStatus),
        sparkline: m ? sparklineFor(toDay(m.serviceDateMax), weeks.get(s.id) ?? new Map()) : null,
        badge: m ? smallStationBadge(m) : null,
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
