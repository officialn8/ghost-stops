import type { FeatureCollection, Feature, LineString } from 'geojson';
import {
  CTA_LINE_ORDER,
  CTA_LINE_COLORS,
  type CTALine,
  isStationActiveByLineFilter
} from './explodeSegments';

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

interface StitchedProperties extends ExplodedProperties {
  segment_count?: number; // Number of segments stitched together
}

// Re-export for convenience
export { CTA_LINE_ORDER, CTA_LINE_COLORS, type CTALine, isStationActiveByLineFilter };

/**
 * Corridor configurations define the full set of lines that share each corridor
 * and their fixed visual order (left to right / negative to positive offset).
 * Using fixed slots prevents offset jumps when the sharing set changes between
 * adjacent segments.
 */
interface CorridorConfig {
  lines: readonly string[];
  offsetStep: number;
}

const CORRIDOR_CONFIGS: Record<string, CorridorConfig> = {
  "Loop":         { lines: ["Brown", "Green", "Blue", "Orange", "Pink", "Purple"], offsetStep: 2.4 },
  "North Main":   { lines: ["Red", "Purple", "Brown"],                    offsetStep: 4.0 },
  "Lake":         { lines: ["Green", "Orange"],                           offsetStep: 5.0 },
  "West Side":    { lines: ["Green", "Pink"],                             offsetStep: 5.0 },
  "Forest Park":  { lines: ["Blue", "Pink"],                              offsetStep: 5.0 },
  "South Side":   { lines: ["Red", "Green"],                              offsetStep: 5.0 },
};

const LOOP_CORE_BBOX = {
  minLon: -87.6342,
  minLat: 41.8767,
  maxLon: -87.6259,
  maxLat: 41.8859,
};

type LoopSide = 'north' | 'south' | 'east' | 'west';

function inferLoopSideFromCoords(coords: number[][]): LoopSide {
  const start = coords[0];
  const end = coords[coords.length - 1];
  const midLon = (start[0] + end[0]) / 2;
  const midLat = (start[1] + end[1]) / 2;
  const dx = Math.abs(end[0] - start[0]);
  const dy = Math.abs(end[1] - start[1]);

  const centerLon = (LOOP_CORE_BBOX.minLon + LOOP_CORE_BBOX.maxLon) / 2;
  const centerLat = (LOOP_CORE_BBOX.minLat + LOOP_CORE_BBOX.maxLat) / 2;

  if (dx >= dy * 1.2) return midLat >= centerLat ? 'north' : 'south';
  if (dy >= dx * 1.2) return midLon >= centerLon ? 'east' : 'west';

  const edgeDistance: Record<LoopSide, number> = {
    north: Math.abs(midLat - LOOP_CORE_BBOX.maxLat),
    south: Math.abs(midLat - LOOP_CORE_BBOX.minLat),
    west: Math.abs(midLon - LOOP_CORE_BBOX.minLon),
    east: Math.abs(midLon - LOOP_CORE_BBOX.maxLon),
  };

  return (Object.entries(edgeDistance).sort((a, b) => a[1] - b[1])[0][0]) as LoopSide;
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

  // Tangent for clockwise traversal around loop center.
  const tx = ry;
  const ty = -rx;
  const dot = dx * tx + dy * ty;

  if (Math.abs(dot) > 1e-12) {
    return dot >= 0 ? coordinates : [...coordinates].reverse();
  }

  // Fallback for near-degenerate vectors.
  const side = inferLoopSideFromCoords(coordinates);
  let shouldReverse = false;
  if (side === 'north') shouldReverse = start[0] > end[0]; // west -> east
  if (side === 'south') shouldReverse = start[0] < end[0]; // east -> west
  if (side === 'east') shouldReverse = start[1] < end[1]; // north -> south
  if (side === 'west') shouldReverse = start[1] > end[1]; // south -> north

  return shouldReverse ? [...coordinates].reverse() : coordinates;
}

/**
 * Mapbox line-offset is direction-relative (positive means "right of line").
 * Normalize segment direction so offsets stay visually stable across segments.
 */
function normalizeSegmentDirection(
  coordinates: number[][],
  corridor: string,
  isLoop: boolean,
  lines?: string[]
): number[][] {
  if (coordinates.length < 2) return coordinates;

  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const midLon = (start[0] + end[0]) / 2;
  const midLat = (start[1] + end[1]) / 2;
  let shouldReverse = false;

  const lineSet = new Set(lines ?? []);
  const isPureGreenOrange = lineSet.size === 2 && lineSet.has('Green') && lineSet.has('Orange');

  if (isPureGreenOrange) {
    // Force stable orientation for the Green/Orange shared spine:
    // - Wabash/Loop south connector: north -> south
    // - Lake approach and other strongly horizontal sections: west -> east
    const dx = Math.abs(end[0] - start[0]);
    const dy = Math.abs(end[1] - start[1]);
    const inWabashConnector = midLon > -87.6298 && midLon < -87.6248 && midLat > 41.868 && midLat < 41.8795;
    shouldReverse = (inWabashConnector || dy >= dx * 0.9)
      ? start[1] < end[1] // north -> south
      : start[0] > end[0]; // west -> east

    return shouldReverse ? [...coordinates].reverse() : coordinates;
  }

  if (isLoop || corridor === 'Loop') {
    return normalizeLoopClockwise(coordinates);
  } else if (corridor === 'North Main' || corridor === 'South Side') {
    // Prefer north->south, but avoid random flips on near-horizontal segments.
    const dx = Math.abs(end[0] - start[0]);
    const dy = Math.abs(end[1] - start[1]);
    shouldReverse = dx > dy * 1.25
      ? start[0] > end[0]  // west -> east
      : start[1] < end[1]; // north -> south
  } else if (corridor === 'Lake') {
    // Lake is mostly west->east, but south Loop connectors can be vertical.
    // Choose canonical direction by dominant axis to avoid offset sign flips.
    const dx = Math.abs(end[0] - start[0]);
    const dy = Math.abs(end[1] - start[1]);
    shouldReverse = dy > dx * 1.25
      ? start[1] < end[1] // north -> south for vertical Lake segments
      : start[0] > end[0]; // west -> east for horizontal Lake segments
  } else if (corridor === 'West Side' || corridor === 'Forest Park') {
    // Canonical west -> east for west/east corridors
    shouldReverse = start[0] > end[0];
  } else {
    const dx = Math.abs(end[0] - start[0]);
    const dy = Math.abs(end[1] - start[1]);

    if (dx >= dy) {
      shouldReverse = start[0] > end[0]; // west -> east
    } else {
      shouldReverse = start[1] < end[1]; // north -> south
    }
  }

  return shouldReverse ? [...coordinates].reverse() : coordinates;
}

/**
 * Detect the corridor from the set of lines sharing a segment.
 * This is the primary detection method — it works regardless of what
 * corridor label is stored in the GeoJSON data.
 */
function detectCorridorFromLines(lines: string[]): string | null {
  const lineSet = new Set(lines);

  // North Main: any combo of Red, Brown, Purple (2+)
  if (lineSet.size >= 2 && [...lineSet].every(l => ["Red", "Brown", "Purple"].includes(l))) {
    return "North Main";
  }

  // Lake: Green + Orange
  if (lineSet.size === 2 && lineSet.has("Green") && lineSet.has("Orange")) {
    return "Lake";
  }

  // West Side: Green + Pink
  if (lineSet.size === 2 && lineSet.has("Green") && lineSet.has("Pink")) {
    return "West Side";
  }

  // Forest Park: Blue + Pink
  if (lineSet.size === 2 && lineSet.has("Blue") && lineSet.has("Pink")) {
    return "Forest Park";
  }

  // South Side: Red + Green
  if (lineSet.size >= 2 && lineSet.has("Red") && lineSet.has("Green")) {
    return "South Side";
  }

  // Loop fallback:
  // Require a Brown or Purple anchor so tri-line junctions like
  // Green+Orange+Pink don't accidentally receive Loop slot offsets.
  const loopLines = new Set(["Brown", "Green", "Orange", "Pink", "Purple"]);
  const loopWithBlue = new Set(["Brown", "Green", "Blue", "Orange", "Pink", "Purple"]);
  const loopOverlap = [...lineSet].filter(l => loopLines.has(l)).length;
  const loopWithBlueOverlap = [...lineSet].filter(l => loopWithBlue.has(l)).length;
  const hasLoopAnchor = lineSet.has("Brown") || lineSet.has("Purple");
  if ((loopOverlap >= 3 && hasLoopAnchor) || (loopWithBlueOverlap >= 4 && hasLoopAnchor)) {
    return "Loop";
  }

  return null;
}

/**
 * Get the fixed offset for a line within a corridor.
 * First tries the corridor label from the data, then falls back to
 * detecting the corridor from the line combination.
 * Returns null if no matching corridor config is found.
 */
function getCorridorOffset(corridor: string, line: string, allLines?: string[]): number | null {
  // Try direct corridor lookup first
  let config = CORRIDOR_CONFIGS[corridor];

  // If corridor label doesn't match a config, detect from line combination
  if (!config && allLines && allLines.length >= 2) {
    const detectedCorridor = detectCorridorFromLines(allLines);
    if (detectedCorridor) {
      config = CORRIDOR_CONFIGS[detectedCorridor];
    }
  }

  if (!config) return null;

  const lineIndex = config.lines.indexOf(line);
  if (lineIndex === -1) return null;

  const totalSlots = config.lines.length;
  return (lineIndex - (totalSlots - 1) / 2) * config.offsetStep;
}

/**
 * Create a unique key for grouping segments by their properties
 */
function getGroupKey(props: ExplodedProperties): string {
  return `${props.line}|${props.offset_px}|${props.is_loop}|${props.corridor}`;
}

/**
 * Check if two points are the same (within tolerance)
 */
function pointsEqual(p1: number[], p2: number[], tolerance = 0.000001): boolean {
  return Math.abs(p1[0] - p2[0]) < tolerance && Math.abs(p1[1] - p2[1]) < tolerance;
}

/**
 * Build connected paths from segments using edge-based traversal
 */
function buildPaths(segments: Feature<LineString, ExplodedProperties>[]): number[][] {
  const n = segments.length;
  const paths: number[][] = [];
  const visitedEdges = new Set<number>();

  // Build adjacency information
  const connections = new Map<string, { idx: number; isStart: boolean }[]>();

  // Helper to create point key
  const pointKey = (p: number[]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

  // Build connection map
  for (let i = 0; i < n; i++) {
    const coords = segments[i].geometry.coordinates;
    const start = coords[0];
    const end = coords[coords.length - 1];
    const startKey = pointKey(start);
    const endKey = pointKey(end);

    if (!connections.has(startKey)) connections.set(startKey, []);
    if (!connections.has(endKey)) connections.set(endKey, []);

    connections.get(startKey)!.push({ idx: i, isStart: true });
    connections.get(endKey)!.push({ idx: i, isStart: false });
  }

  // Build paths by walking edges
  while (visitedEdges.size < n) {
    // Find an unvisited edge to start a new path
    let startIdx = -1;
    for (let i = 0; i < n; i++) {
      if (!visitedEdges.has(i)) {
        startIdx = i;
        break;
      }
    }

    if (startIdx === -1) break; // All edges visited

    const path: number[] = [startIdx];
    visitedEdges.add(startIdx);

    // Try to extend path in both directions
    let extended = true;
    while (extended) {
      extended = false;

      // Try to extend from the end of the path
      const lastIdx = path[path.length - 1];
      const lastCoords = segments[lastIdx].geometry.coordinates;
      const lastEnd = lastCoords[lastCoords.length - 1];
      const lastEndKey = pointKey(lastEnd);

      const endConnections = connections.get(lastEndKey) || [];
      for (const conn of endConnections) {
        if (!visitedEdges.has(conn.idx)) {
          visitedEdges.add(conn.idx);
          path.push(conn.idx);
          extended = true;
          break;
        }
      }

      if (!extended) {
        // Try to extend from the start of the path
        const firstIdx = path[0];
        const firstCoords = segments[firstIdx].geometry.coordinates;
        const firstStart = firstCoords[0];
        const firstStartKey = pointKey(firstStart);

        const startConnections = connections.get(firstStartKey) || [];
        for (const conn of startConnections) {
          if (!visitedEdges.has(conn.idx)) {
            visitedEdges.add(conn.idx);
            path.unshift(conn.idx);
            extended = true;
            break;
          }
        }
      }
    }

    paths.push(path);
  }

  return paths;
}

/**
 * Merge a path of connected segments into a single LineString
 */
function mergeSegments(
  segments: Feature<LineString, ExplodedProperties>[],
  indices: number[]
): Feature<LineString, StitchedProperties> {
  if (indices.length === 0) throw new Error('No segments to merge');

  // If single segment, just return it with segment_count
  if (indices.length === 1) {
    const seg = segments[indices[0]];
    return {
      type: 'Feature',
      geometry: seg.geometry,
      properties: {
        ...seg.properties,
        segment_count: 1
      }
    };
  }

  // Build adjacency for these segments
  const adjacency = new Map<number, Array<{ idx: number; connection: 'start-start' | 'start-end' | 'end-start' | 'end-end' }>>();

  for (let i = 0; i < indices.length; i++) {
    const idx1 = indices[i];
    const coords1 = segments[idx1].geometry.coordinates;
    const start1 = coords1[0];
    const end1 = coords1[coords1.length - 1];

    adjacency.set(idx1, []);

    for (let j = i + 1; j < indices.length; j++) {
      const idx2 = indices[j];
      const coords2 = segments[idx2].geometry.coordinates;
      const start2 = coords2[0];
      const end2 = coords2[coords2.length - 1];

      if (pointsEqual(end1, start2)) {
        adjacency.get(idx1)!.push({ idx: idx2, connection: 'end-start' });
        if (!adjacency.has(idx2)) adjacency.set(idx2, []);
        adjacency.get(idx2)!.push({ idx: idx1, connection: 'start-end' });
      } else if (pointsEqual(end1, end2)) {
        adjacency.get(idx1)!.push({ idx: idx2, connection: 'end-end' });
        if (!adjacency.has(idx2)) adjacency.set(idx2, []);
        adjacency.get(idx2)!.push({ idx: idx1, connection: 'end-end' });
      } else if (pointsEqual(start1, start2)) {
        adjacency.get(idx1)!.push({ idx: idx2, connection: 'start-start' });
        if (!adjacency.has(idx2)) adjacency.set(idx2, []);
        adjacency.get(idx2)!.push({ idx: idx1, connection: 'start-start' });
      } else if (pointsEqual(start1, end2)) {
        adjacency.get(idx1)!.push({ idx: idx2, connection: 'start-end' });
        if (!adjacency.has(idx2)) adjacency.set(idx2, []);
        adjacency.get(idx2)!.push({ idx: idx1, connection: 'end-start' });
      }
    }
  }

  // Find a starting segment (prefer one with only one connection)
  let startIdx = indices[0];
  for (const idx of indices) {
    const connections = adjacency.get(idx) || [];
    if (connections.length === 1) {
      startIdx = idx;
      break;
    }
  }

  // Build ordered path
  const orderedSegments: Array<{ idx: number; reversed: boolean }> = [];
  const used = new Set<number>();

  // Add first segment
  orderedSegments.push({ idx: startIdx, reversed: false });
  used.add(startIdx);

  // Build path by following connections
  while (used.size < indices.length) {
    const lastSegment = orderedSegments[orderedSegments.length - 1];
    const lastIdx = lastSegment.idx;
    const lastReversed = lastSegment.reversed;

    const connections = adjacency.get(lastIdx) || [];
    let found = false;

    for (const conn of connections) {
      if (used.has(conn.idx)) continue;

      // Determine if we need to reverse the next segment
      let nextReversed = false;
      if (lastReversed) {
        // Last segment was reversed, so its start is the active end
        if (conn.connection === 'start-start') nextReversed = false;
        else if (conn.connection === 'start-end') nextReversed = true;
        else if (conn.connection === 'end-start') continue; // Wrong connection
        else if (conn.connection === 'end-end') continue; // Wrong connection
      } else {
        // Last segment was not reversed, so its end is the active end
        if (conn.connection === 'end-start') nextReversed = false;
        else if (conn.connection === 'end-end') nextReversed = true;
        else if (conn.connection === 'start-start') continue; // Wrong connection
        else if (conn.connection === 'start-end') continue; // Wrong connection
      }

      orderedSegments.push({ idx: conn.idx, reversed: nextReversed });
      used.add(conn.idx);
      found = true;
      break;
    }

    if (!found) {
      // Can't continue path. Abort merge so caller can safely fall back to
      // unmerged segments instead of returning a partial geometry.
      throw new Error(`Could not connect all segments in path. Connected ${used.size} of ${indices.length}`);
    }
  }

  // Merge coordinates
  const mergedCoords: number[][] = [];

  for (let i = 0; i < orderedSegments.length; i++) {
    const { idx, reversed } = orderedSegments[i];
    const coords = [...segments[idx].geometry.coordinates];

    if (reversed) coords.reverse();

    if (i === 0) {
      mergedCoords.push(...coords);
    } else {
      // Skip first point to avoid duplication
      mergedCoords.push(...coords.slice(1));
    }
  }

  // Use properties from first segment, ensure line is a string
  const firstSegment = segments[indices[0]];

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: mergedCoords
    },
    properties: {
      segment_id: firstSegment.properties.segment_id,
      corridor: firstSegment.properties.corridor,
      is_loop: firstSegment.properties.is_loop,
      line: firstSegment.properties.line, // Ensure this stays a string
      shared_count: firstSegment.properties.shared_count,
      shared_index: firstSegment.properties.shared_index,
      offset_px: firstSegment.properties.offset_px,
      segment_count: orderedSegments.length
    }
  };
}

/**
 * Explodes multi-line segments into individual per-line features with calculated offsets,
 * then stitches contiguous segments together to reduce seams
 */
export function explodeAndStitchSegments(
  segments: FeatureCollection<LineString, SegmentProperties>,
  activeLines: Record<string, boolean>,
  offsetStep = 5.0,      // Clear separation on shared corridors
  loopOffsetStep = 3.0,  // Balanced: 5 lines span ~12px, less corner distortion
  stitchOnlyLoop = true // Safety: only stitch Loop segments by default
): FeatureCollection<LineString, StitchedProperties> {
  // First, explode segments as before
  const explodedFeatures: Feature<LineString, ExplodedProperties>[] = [];

  // Count segments by line for debugging
  const lineCountsBefore: Record<string, number> = {};

  for (const segment of segments.features) {
    const { lines, segment_id, corridor, is_loop } = segment.properties;
    const normalizedCoordinates = normalizeSegmentDirection(
      segment.geometry.coordinates,
      corridor,
      is_loop,
      lines
    );

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

    // Create a feature for each line with corridor-aware fixed offset
    sortedLines.forEach((line, index) => {
      let offset_px: number;

      // Prefer fixed corridor slot offsets whenever available, even if this
      // segment currently has only one line after filtering/data mismatches.
      const corridorOffset = getCorridorOffset(corridor, line, lines);
      if (corridorOffset !== null) {
        offset_px = corridorOffset;
      } else if (sharedCount === 1) {
        // Truly single-line, non-corridor segment
        offset_px = 0;
      } else {
        // Fallback for unconfigured corridors
        const effectiveOffsetStep = is_loop ? loopOffsetStep : offsetStep;
        offset_px = (index - (sharedCount - 1) / 2) * effectiveOffsetStep;
      }

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
          line, // Ensure this is a string, not an array
          shared_count: sharedCount,
          shared_index: index,
          offset_px
        }
      });

      // Count for debugging
      lineCountsBefore[line] = (lineCountsBefore[line] || 0) + 1;
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('Exploded segments by line (before stitching):', lineCountsBefore);
  }

  // Now stitch contiguous segments
  // Separate Loop and non-Loop segments
  const loopFeatures: Feature<LineString, ExplodedProperties>[] = [];
  const nonLoopFeatures: Feature<LineString, ExplodedProperties>[] = [];

  for (const feature of explodedFeatures) {
    if (feature.properties.is_loop) {
      loopFeatures.push(feature);
    } else {
      nonLoopFeatures.push(feature);
    }
  }

  const stitchedFeatures: Feature<LineString, StitchedProperties>[] = [];

  // Process non-Loop segments (no stitching if stitchOnlyLoop is true)
  if (stitchOnlyLoop) {
    // Don't stitch non-Loop segments, just pass them through
    for (const feature of nonLoopFeatures) {
      stitchedFeatures.push({
        ...feature,
        properties: {
          ...feature.properties,
          segment_count: 1
        }
      });
    }
  } else {
    // Stitch non-Loop segments too
    const nonLoopStitched = stitchSegments(nonLoopFeatures);
    stitchedFeatures.push(...nonLoopStitched);
  }

  // Always stitch Loop segments
  const loopStitched = stitchSegments(loopFeatures);
  stitchedFeatures.push(...loopStitched);

  // Count segments by line after stitching
  const lineCountsAfter: Record<string, number> = {};
  for (const feature of stitchedFeatures) {
    const line = feature.properties.line;
    lineCountsAfter[line] = (lineCountsAfter[line] || 0) + 1;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('Stitched features by line (after stitching):', lineCountsAfter);

    // Verify no segments were lost
    for (const line in lineCountsBefore) {
      const before = lineCountsBefore[line];
      const after = lineCountsAfter[line] || 0;
      if (after === 0 && before > 0) {
        console.error(`ERROR: Line ${line} had ${before} segments before stitching but ${after} after!`);
      }
    }
  }

  return {
    type: "FeatureCollection",
    features: stitchedFeatures
  };
}

/**
 * Helper function to stitch a group of segments
 */
function stitchSegments(
  features: Feature<LineString, ExplodedProperties>[]
): Feature<LineString, StitchedProperties>[] {
  if (features.length === 0) return [];

  // Group segments by their line/offset/corridor properties
  const groups = new Map<string, Feature<LineString, ExplodedProperties>[]>();

  for (const feature of features) {
    const key = getGroupKey(feature.properties);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(feature);
  }

  // Process each group to stitch segments
  const stitchedFeatures: Feature<LineString, StitchedProperties>[] = [];

  for (const groupSegments of groups.values()) {
    if (groupSegments.length === 1) {
      // Single segment, just add it
      stitchedFeatures.push({
        ...groupSegments[0],
        properties: {
          ...groupSegments[0].properties,
          segment_count: 1
        }
      });
    } else {
      // Find connected paths and merge them
      const paths = buildPaths(groupSegments);

      for (const path of paths) {
        if (path.length === 1) {
          // Single segment in path
          stitchedFeatures.push({
            ...groupSegments[path[0]],
            properties: {
              ...groupSegments[path[0]].properties,
              segment_count: 1
            }
          });
        } else {
          // Multiple segments to merge. If merge fails, keep originals to
          // avoid dropping geometry from partially connected paths.
          try {
            const merged = mergeSegments(groupSegments, path);
            stitchedFeatures.push(merged);
          } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('Falling back to unmerged segments for path:', error);
            }

            for (const idx of path) {
              stitchedFeatures.push({
                ...groupSegments[idx],
                properties: {
                  ...groupSegments[idx].properties,
                  segment_count: 1
                }
              });
            }
          }
        }
      }
    }
  }

  return stitchedFeatures;
}

// Re-export for backwards compatibility and as a fallback
export { explodeSegments } from './explodeSegments';

// Debug helper to check segment counts
export function debugSegmentCounts(features: FeatureCollection<LineString, { line?: string; lines?: string[] }>): void {
  if (process.env.NODE_ENV !== 'production') {
    const counts: Record<string, number> = {};
    for (const feature of features.features) {
      const line = feature.properties.line || feature.properties.lines?.join(',') || 'unknown';
      counts[line] = (counts[line] || 0) + 1;
    }
    console.log('Segment counts by line:', counts);
  }
}
