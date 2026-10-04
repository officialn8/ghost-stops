import { cache } from "react";
import { unstable_cache } from "next/cache";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
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

export const getStationDetail = cache((slug: string) => readCached(slug));
