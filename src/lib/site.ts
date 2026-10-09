/**
 * The site's canonical origin, for metadata, the sitemap, and robots. Vercel sets
 * VERCEL_PROJECT_PRODUCTION_URL (the production domain, without a scheme) on every deployment,
 * previews included, so links in a preview's metadata point at production.
 */
export const SITE_URL = new URL(
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000",
);

export const SITE_NAME = "Ghost Stops";

/** CTA's daily station entries on the Chicago Data Portal: the ridership behind every number. */
export const CTA_RIDERSHIP_URL =
  "https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f";
