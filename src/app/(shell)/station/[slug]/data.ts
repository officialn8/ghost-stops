import { cache } from "react";
import { unstable_cache } from "next/cache";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { linesForStation } from "@/lib/cta/sequences";
import { generateSlugs, resolveSlugAlias } from "@/lib/cta/slug";
import { readStationDetail } from "@/lib/stations/detail";

/**
 * The station page's data: the detail payload, cached under the stations tag so the sync cron's
 * revalidation purges it with the list (KTD14), and deduplicated within a request so
 * generateMetadata and the page read it once.
 */
const readCached = unstable_cache(readStationDetail, ["station-detail"], {
  tags: [STATIONS_CACHE_TAG],
  revalidate: 3600,
});

/** Every station's slug, from the roster through the function the seed stores them with. */
const KNOWN_SLUGS = new Set(
  generateSlugs(CTA_ROSTER.map((s) => ({ ...s, lines: linesForStation(s.ctaStationId) }))).values(),
);

/**
 * Only a station's slug or a retired slug is cached; anything else is read uncached, so arbitrary
 * URLs cannot fill the data cache with entries. That includes a station id, which the detail lookup
 * still accepts until the uuid fallback goes (KTD7, U23): it reads uncached, as the API route does.
 */
export function cacheable(slug: string): boolean {
  return KNOWN_SLUGS.has(slug) || resolveSlugAlias(slug) !== undefined;
}

export const getStationDetail = cache((slug: string) => (cacheable(slug) ? readCached(slug) : readStationDetail(slug)));
