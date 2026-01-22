import type { FeatureCollection, Feature, LineString, MultiLineString } from 'geojson';
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
      // Can't continue path - add remaining segments as separate features
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`Could not connect all segments in path. Connected ${used.size} of ${indices.length}`);
      }
      break;
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
  offsetStep = 3.5,
  loopOffsetStep = 2.0,
  stitchOnlyLoop = true // Safety: only stitch Loop segments by default
): FeatureCollection<LineString, StitchedProperties> {
  // First, explode segments as before
  const explodedFeatures: Feature<LineString, ExplodedProperties>[] = [];

  // Count segments by line for debugging
  const lineCountsBefore: Record<string, number> = {};

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

  for (const [groupKey, groupSegments] of groups) {
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
          // Multiple segments to merge
          const merged = mergeSegments(groupSegments, path);
          stitchedFeatures.push(merged);
        }
      }
    }
  }

  return stitchedFeatures;
}

// Re-export for backwards compatibility and as a fallback
export { explodeSegments } from './explodeSegments';

// Debug helper to check segment counts
export function debugSegmentCounts(features: FeatureCollection<LineString, any>): void {
  if (process.env.NODE_ENV !== 'production') {
    const counts: Record<string, number> = {};
    for (const feature of features.features) {
      const line = feature.properties.line || feature.properties.lines?.join(',') || 'unknown';
      counts[line] = (counts[line] || 0) + 1;
    }
    console.log('Segment counts by line:', counts);
  }
}