/**
 * Retired station slugs mapped to their current slug, for the slug-addressed station route to answer
 * with a 308 redirect.
 *
 * Empty until a station is renamed. When a rename changes a slug, add `"old-slug": "new-slug"` here
 * in the same change so links shared before the rename keep working.
 */
export const SLUG_ALIASES: Readonly<Record<string, string>> = {};
