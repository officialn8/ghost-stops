import type { MetadataRoute } from "next";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { linesForStation } from "@/lib/cta/sequences";
import { generateSlugs } from "@/lib/cta/slug";
import { SITE_URL } from "@/lib/site";

/**
 * The map and every station page, open and closed (R8). Slugs come from the roster through the
 * same function the seed stores them with, so the sitemap needs no database at build time.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const slugs = generateSlugs(CTA_ROSTER.map((s) => ({ ...s, lines: linesForStation(s.ctaStationId) })));
  return [
    { url: new URL("/", SITE_URL).href, changeFrequency: "daily", priority: 1 },
    ...[...slugs.values()].sort().map((slug) => ({
      url: new URL(`/station/${slug}`, SITE_URL).href,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
