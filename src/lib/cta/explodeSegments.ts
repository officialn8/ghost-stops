import type { FeatureCollection, Feature, LineString } from 'geojson';

// Stable line ordering for consistent offset calculation
export const CTA_LINE_ORDER = [
  "Red", "Blue", "Brown", "Green", "Orange",
  "Purple", "Pink", "Yellow"
] as const;

export type CTALine = typeof CTA_LINE_ORDER[number];

// CTA brand colors (NOT official CTA colors)
export const CTA_LINE_COLORS: Record<CTALine, string> = {
  "Red": "#F25757",     // Vibrant Coral
  "Blue": "#0090C1",    // Ocean Blue
  "Brown": "#513B3C",   // Chocolate Plum
  "Green": "#06D6A0",   // Emerald
  "Orange": "#F58549",  // Atomic Tangerine
  "Purple": "#4F1271",  // Indigo
  "Pink": "#FF6B6B",    // Grapefruit Pink
  "Yellow": "#F7E733"   // Bright Lemon
};

interface SegmentProperties {
  segment_id: string;
  corridor: string;
  is_loop: boolean;
  lines: string[];
}

interface ExplodedProperties {
  segment_id: string;
  corridor: string;
  is_loop: boolean;
  line: string;
  shared_count: number;
  shared_index: number;
  offset_px: number;
}

/**
 * Explodes multi-line segments into individual per-line features with calculated offsets
 * to render lines side-by-side without overlapping
 */
export function explodeSegments(
  segments: FeatureCollection<LineString, SegmentProperties>,
  activeLines: Record<string, boolean>,
  offsetStep = 3.5,
  loopOffsetStep = 2.0
): FeatureCollection<LineString, ExplodedProperties> {
  const explodedFeatures: Feature<LineString, ExplodedProperties>[] = [];

  // Debug: count segments by line
  const lineCountsDebug: Record<string, number> = {};

  for (const segment of segments.features) {
    const { lines, segment_id, corridor, is_loop } = segment.properties;

    // Filter to only active lines
    const activeSegmentLines = lines.filter(line => activeLines[line]);

    if (activeSegmentLines.length === 0) continue;

    // Sort lines by stable order
    const sortedLines = activeSegmentLines.sort((a, b) => {
      const indexA = CTA_LINE_ORDER.indexOf(a as CTALine);
      const indexB = CTA_LINE_ORDER.indexOf(b as CTALine);
      return indexA - indexB;
    });

    const sharedCount = sortedLines.length;

    // Use smaller offset for Loop segments
    const effectiveOffsetStep = is_loop ? loopOffsetStep : offsetStep;

    // Create a feature for each line with calculated offset
    sortedLines.forEach((line, index) => {
      const offset_px = (index - (sharedCount - 1) / 2) * effectiveOffsetStep;

      explodedFeatures.push({
        type: "Feature",
        geometry: segment.geometry,
        properties: {
          segment_id,
          corridor,
          is_loop,
          line,
          shared_count: sharedCount,
          shared_index: index,
          offset_px
        }
      });

      // Count for debugging
      lineCountsDebug[line] = (lineCountsDebug[line] || 0) + 1;
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('Exploded segments by line (no stitching):', lineCountsDebug);
  }

  return {
    type: "FeatureCollection",
    features: explodedFeatures
  };
}

/**
 * Checks if a station is active based on its lines and the active line filter
 */
export function isStationActiveByLineFilter(
  stationLines: string[],
  activeLines: Record<string, boolean>
): boolean {
  return stationLines.some(line => activeLines[line]);
}