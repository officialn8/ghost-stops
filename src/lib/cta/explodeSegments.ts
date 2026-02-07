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

const LOOP_CORE_BBOX = {
  minLon: -87.6342,
  minLat: 41.8767,
  maxLon: -87.6259,
  maxLat: 41.8859,
};

function inLoopBbox(coordinates: number[][]): boolean {
  if (coordinates.length === 0) return false;
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const midLon = (start[0] + end[0]) / 2;
  const midLat = (start[1] + end[1]) / 2;
  return (
    midLon >= LOOP_CORE_BBOX.minLon &&
    midLon <= LOOP_CORE_BBOX.maxLon &&
    midLat >= LOOP_CORE_BBOX.minLat &&
    midLat <= LOOP_CORE_BBOX.maxLat
  );
}

function normalizeLoopClockwise(coordinates: number[][]): number[][] {
  if (coordinates.length < 2) return coordinates;

  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const midLon = (start[0] + end[0]) / 2;
  const midLat = (start[1] + end[1]) / 2;
  const centerLon = (LOOP_CORE_BBOX.minLon + LOOP_CORE_BBOX.maxLon) / 2;
  const centerLat = (LOOP_CORE_BBOX.minLat + LOOP_CORE_BBOX.maxLat) / 2;

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const rx = midLon - centerLon;
  const ry = midLat - centerLat;

  const tx = ry;
  const ty = -rx;
  const dot = dx * tx + dy * ty;

  if (Math.abs(dot) > 1e-12) {
    return dot >= 0 ? coordinates : [...coordinates].reverse();
  }

  return coordinates;
}

/**
 * Mapbox line-offset is direction-relative; normalize segment direction so
 * offsets don't flip side between adjacent segments.
 */
function normalizeSegmentDirection(coordinates: number[][], corridor?: string): number[][] {
  if (coordinates.length < 2) return coordinates;

  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  let shouldReverse: boolean;
  if (corridor === "Loop" || inLoopBbox(coordinates)) {
    return normalizeLoopClockwise(coordinates);
  }
  if (corridor === "North Main" || corridor === "South Side") {
    const dx = Math.abs(end[0] - start[0]);
    const dy = Math.abs(end[1] - start[1]);
    shouldReverse = dx > dy * 1.25
      ? start[0] > end[0] // west -> east
      : start[1] < end[1]; // north -> south
  } else if (corridor === "Lake") {
    const dx = Math.abs(end[0] - start[0]);
    const dy = Math.abs(end[1] - start[1]);
    shouldReverse = dy > dx * 1.25
      ? start[1] < end[1] // north -> south for vertical Lake segments
      : start[0] > end[0]; // west -> east for horizontal Lake segments
  } else if (corridor === "West Side" || corridor === "Forest Park") {
    shouldReverse = start[0] > end[0]; // west -> east
  } else {
    const dx = Math.abs(end[0] - start[0]);
    const dy = Math.abs(end[1] - start[1]);
    shouldReverse = dx >= dy
      ? start[0] > end[0] // west -> east
      : start[1] < end[1]; // north -> south
  }

  return shouldReverse ? [...coordinates].reverse() : coordinates;
}

function normalizeSegmentDirectionWithLines(
  coordinates: number[][],
  corridor: string | undefined,
  lines: string[]
): number[][] {
  if (coordinates.length < 2) return coordinates;
  const lineSet = new Set(lines);
  const isPureGreenOrange = lineSet.size === 2 && lineSet.has("Green") && lineSet.has("Orange");
  if (!isPureGreenOrange) {
    return normalizeSegmentDirection(coordinates, corridor);
  }

  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const midLon = (start[0] + end[0]) / 2;
  const midLat = (start[1] + end[1]) / 2;
  const dx = Math.abs(end[0] - start[0]);
  const dy = Math.abs(end[1] - start[1]);
  const inWabashConnector = midLon > -87.6298 && midLon < -87.6248 && midLat > 41.868 && midLat < 41.8795;
  const shouldReverse = (inWabashConnector || dy >= dx * 0.9)
    ? start[1] < end[1] // north -> south
    : start[0] > end[0]; // west -> east

  return shouldReverse ? [...coordinates].reverse() : coordinates;
}

/**
 * Explodes multi-line segments into individual per-line features with calculated offsets
 * to render lines side-by-side without overlapping
 */
export function explodeSegments(
  segments: FeatureCollection<LineString, SegmentProperties>,
  activeLines: Record<string, boolean>,
  offsetStep = 5.0,      // Clear separation on shared corridors
  loopOffsetStep = 3.0   // Balanced: 5 lines span ~12px, less corner distortion
): FeatureCollection<LineString, ExplodedProperties> {
  const explodedFeatures: Feature<LineString, ExplodedProperties>[] = [];

  // Debug: count segments by line
  const lineCountsDebug: Record<string, number> = {};

  for (const segment of segments.features) {
    const { lines, segment_id, corridor, is_loop } = segment.properties;
    const normalizedCoordinates = normalizeSegmentDirectionWithLines(segment.geometry.coordinates, corridor, lines);

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
        geometry: {
          type: "LineString",
          coordinates: normalizedCoordinates
        },
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
