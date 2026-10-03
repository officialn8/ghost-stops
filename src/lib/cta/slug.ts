/**
 * Station slugs: stored on Station.slug by scripts/seed-reference-data.ts, never derived per request.
 *
 * Rule: take the display name without any parenthetical, lowercase it, drop apostrophes, and turn
 * slashes and whitespace into hyphens. Only when that collides with another station's slug, append
 * the station's primary line; when two stations on the same line still collide (the two Blue Line
 * Westerns and Harlems), append the branch end as well.
 */
import type { CTALine } from "../ctaLineColors";
import { normalizeStationLines } from "./normalizeStationLines";
import { getPrimaryLine } from "./sequences";
import { SLUG_ALIASES } from "./slugAliases";

export interface SlugInput {
    ctaStationId: string;
    name: string;
    lines: readonly CTALine[];
}

// CTA's own names for two stations whose stored names carry extra words.
const DISPLAY_NAME_OVERRIDES: Readonly<Record<string, string>> = {
    "41660": "Lake", // stored as "Lake (Subway)"
    "41280": "Jefferson Park", // stored as "Jefferson Park Transit Center"
};

// Which end of the Blue Line a same-named Blue station sits on.
const BLUE_BRANCH_ENDS: Readonly<Record<string, string>> = {
    "40670": "ohare", // Western
    "40750": "ohare", // Harlem
    "40220": "forest-park", // Western
    "40980": "forest-park", // Harlem
};

/** The name the UI shows: the stored name without a line-list parenthetical, or CTA's name. */
export function displayNameFor(station: { ctaStationId: string; name: string }): string {
    return DISPLAY_NAME_OVERRIDES[station.ctaStationId] ?? normalizeStationLines({ name: station.name }).cleanName;
}

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[\s/]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

/** The unqualified slug: the display name without any parenthetical. */
export function baseSlug(station: { ctaStationId: string; name: string }): string {
    return slugify(displayNameFor(station).replace(/\s*\([^)]*\)/g, ""));
}

/** Slugs for a whole roster, keyed by CTA station id. Throws if any slug would not be unique. */
export function generateSlugs(stations: readonly SlugInput[]): Map<string, string> {
    const slugs = new Map<string, string>();

    for (const [base, group] of Map.groupBy(stations, baseSlug)) {
        if (group.length === 1) {
            slugs.set(group[0].ctaStationId, base);
            continue;
        }
        const withLine = (s: SlugInput) => `${base}-${slugify(getPrimaryLine(s.lines) ?? "")}`;
        for (const [lineSlug, sameLine] of Map.groupBy(group, withLine)) {
            for (const s of sameLine) {
                if (sameLine.length === 1) {
                    slugs.set(s.ctaStationId, lineSlug);
                    continue;
                }
                const end = BLUE_BRANCH_ENDS[s.ctaStationId];
                if (!end) {
                    throw new Error(`Cannot give "${s.name}" a unique slug: it shares "${lineSlug}" with another station.`);
                }
                slugs.set(s.ctaStationId, `${lineSlug}-${end}`);
            }
        }
    }

    const duplicates = [...Map.groupBy(slugs, ([, slug]) => slug)].filter(([, entries]) => entries.length > 1);
    if (duplicates.length > 0) {
        throw new Error(`Duplicate slugs: ${duplicates.map(([slug]) => slug).join(", ")}`);
    }
    return slugs;
}

/** The canonical slug for a retired slug, so the station route can redirect it. */
export function resolveSlugAlias(
    slug: string,
    aliases: Readonly<Record<string, string>> = SLUG_ALIASES,
): string | undefined {
    return Object.hasOwn(aliases, slug) ? aliases[slug] : undefined;
}
