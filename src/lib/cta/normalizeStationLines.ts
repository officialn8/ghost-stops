/**
 * Normalizes station line data from various possible formats into a consistent string array.
 * 
 * Handles:
 * - lines: string[] (already correct format)
 * - lines: string (comma/slash separated)
 * - line: string
 * - routes: string[]
 * - line_summary / lines_display: string
 * - Line info embedded in station name like "Sedgwick (Brown/Purple)"
 */

import { CTALine } from "../ctaLineColors";

// Canonical CTA line order for consistent output
export const CTA_LINE_ORDER: CTALine[] = [
    "Red",
    "Blue",
    "Brown",
    "Green",
    "Orange",
    "Purple",
    "Pink",
    "Yellow",
];

// Valid line names for validation
const VALID_LINES = new Set(CTA_LINE_ORDER);

// Aliases to normalize
const LINE_ALIASES: Record<string, CTALine> = {
    "purple express": "Purple",
    "purpleexpress": "Purple",
    "prp": "Purple",
    "pexp": "Purple",
    "red": "Red",
    "blue": "Blue",
    "brown": "Brown",
    "brn": "Brown",
    "green": "Green",
    "grn": "Green",
    "orange": "Orange",
    "org": "Orange",
    "purple": "Purple",
    "pink": "Pink",
    "pnk": "Pink",
    "yellow": "Yellow",
    "y": "Yellow",
};

/**
 * Station object with possible line-related fields
 */
export interface StationLikeObject {
    name?: string;
    lines?: string[] | string;
    line?: string;
    routes?: string[] | string;
    route?: string;
    line_summary?: string;
    lines_display?: string;
}

/**
 * Result of normalizing station lines
 */
export interface NormalizedStationResult {
    /** Normalized array of valid CTA line names, ordered canonically */
    lines: CTALine[];
    /** Clean station name with parenthetical line info removed */
    cleanName: string;
    /** Raw line string found (for debugging/fallback) */
    rawLineString?: string;
}

/**
 * Parse a line string into individual line names
 */
function parseLineString(input: string): string[] {
    if (!input || typeof input !== "string") return [];

    // Split on common separators: /, ,, &, "and", whitespace around separators
    return input
        .split(/[\/,&]|\s+and\s+/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/**
 * Normalize a single line name to a valid CTALine
 */
function normalizeLineName(name: string): CTALine | null {
    if (!name || typeof name !== "string") return null;

    const normalized = name.toLowerCase().trim();

    // Check aliases first
    if (LINE_ALIASES[normalized]) {
        return LINE_ALIASES[normalized];
    }

    // Try title case match against valid lines
    const titleCase = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    if (VALID_LINES.has(titleCase as CTALine)) {
        return titleCase as CTALine;
    }

    return null;
}

/**
 * Extract line info from parentheses in station name
 * e.g., "Sedgwick (Brown/Purple)" -> { name: "Sedgwick", lineString: "Brown/Purple" }
 */
function extractParenthesesInfo(name: string): {
    cleanName: string;
    lineString: string | null;
} {
    if (!name || typeof name !== "string") {
        return { cleanName: name || "", lineString: null };
    }

    // Match parentheses at end of name containing line info
    const match = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (match) {
        const [, cleanName, parenContent] = match;
        // Check if the parentheses content looks like line info
        const potentialLines = parseLineString(parenContent);
        const hasValidLines = potentialLines.some((l) => normalizeLineName(l) !== null);

        if (hasValidLines) {
            return {
                cleanName: cleanName.trim(),
                lineString: parenContent
            };
        }
    }

    return { cleanName: name, lineString: null };
}

/**
 * Normalize station lines from any input format to a consistent CTALine[]
 */
export function normalizeStationLines(station: StationLikeObject): NormalizedStationResult {
    const collectedLines: string[] = [];
    let rawLineString: string | undefined;

    // Extract from name parentheses first
    const { cleanName, lineString: nameLineString } = extractParenthesesInfo(
        station.name || ""
    );

    if (nameLineString) {
        collectedLines.push(...parseLineString(nameLineString));
        rawLineString = nameLineString;
    }

    // Try station.lines (array or string)
    if (station.lines) {
        if (Array.isArray(station.lines)) {
            collectedLines.push(...station.lines);
        } else if (typeof station.lines === "string") {
            collectedLines.push(...parseLineString(station.lines));
            rawLineString = rawLineString || station.lines;
        }
    }

    // Try station.line (string)
    if (station.line && typeof station.line === "string") {
        collectedLines.push(...parseLineString(station.line));
        rawLineString = rawLineString || station.line;
    }

    // Try station.routes
    if (station.routes) {
        if (Array.isArray(station.routes)) {
            collectedLines.push(...station.routes);
        } else if (typeof station.routes === "string") {
            collectedLines.push(...parseLineString(station.routes));
            rawLineString = rawLineString || station.routes;
        }
    }

    // Try station.route
    if (station.route && typeof station.route === "string") {
        collectedLines.push(...parseLineString(station.route));
        rawLineString = rawLineString || station.route;
    }

    // Try station.line_summary
    if (station.line_summary && typeof station.line_summary === "string") {
        collectedLines.push(...parseLineString(station.line_summary));
        rawLineString = rawLineString || station.line_summary;
    }

    // Try station.lines_display
    if (station.lines_display && typeof station.lines_display === "string") {
        collectedLines.push(...parseLineString(station.lines_display));
        rawLineString = rawLineString || station.lines_display;
    }

    // Normalize, dedupe, and sort by canonical order
    const normalizedSet = new Set<CTALine>();
    for (const line of collectedLines) {
        const normalized = normalizeLineName(line);
        if (normalized) {
            normalizedSet.add(normalized);
        }
    }

    // Sort by canonical CTA order
    const sortedLines = CTA_LINE_ORDER.filter((line) => normalizedSet.has(line));

    return {
        lines: sortedLines,
        cleanName,
        rawLineString,
    };
}

/**
 * Debug helper: Check if station name contains parenthetical line info
 * (which should no longer happen after refactoring)
 */
export function warnIfNameContainsLineInfo(stationName: string, stationId?: string): void {
    if (typeof stationName !== "string") return;

    const match = stationName.match(/\(([^)]+)\)/);
    if (match) {
        const potentialLines = parseLineString(match[1]);
        const hasValidLines = potentialLines.some((l) => normalizeLineName(l) !== null);

        if (hasValidLines) {
            console.warn(
                `[CTA Line Pills] Station name contains line info in parentheses: "${stationName}"` +
                (stationId ? ` (id: ${stationId})` : "") +
                `. This should be extracted and displayed as pills instead.`
            );
        }
    }
}
