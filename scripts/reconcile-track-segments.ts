#!/usr/bin/env tsx

/**
 * Topology + overlap reconciliation for CTA track segments.
 *
 * Pipeline:
 * 1) Run mapshaper snap/clean to reduce near-miss vertices.
 * 2) Use Turf lineOverlap + nearestPointOnLine to infer shared corridors.
 * 3) Rewrite corridor/is_loop labels from reconciled line memberships.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { lineOverlap, lineString, nearestPointOnLine } from "@turf/turf";
import type { Feature, FeatureCollection, LineString, MultiLineString } from "geojson";

type SegmentProperties = {
  segment_id: string;
  corridor: string;
  is_loop: boolean;
  lines: string[];
};

type SegmentGeometry = LineString | MultiLineString;
type SegmentFeature = Feature<LineString, SegmentProperties>;

const LINE_ORDER = ["Red", "Blue", "Brown", "Green", "Orange", "Purple", "Pink", "Yellow"];
const LOOP_LINES = new Set(["Brown", "Green", "Orange", "Pink", "Purple"]);
const LOOP_LINES_WITH_BLUE = new Set(["Brown", "Green", "Orange", "Pink", "Purple", "Blue"]);
const NORTH_MAIN_LINES = new Set(["Red", "Brown", "Purple"]);
const NORTH_MAIN_RED_PURPLE_LINES = new Set(["Red", "Purple"]);
const LAKE_LINES = new Set(["Green", "Orange"]);
const WEST_SIDE_LINES = new Set(["Green", "Pink"]);

const LOOP_CORE_BBOX: [number, number, number, number] = [-87.6342, 41.8767, -87.6259, 41.8859];
const NORTH_MAIN_SHARED_BBOX: [number, number, number, number] = [-87.6675, 41.91, -87.652, 42.0193];
const LAKE_SHARED_BBOX: [number, number, number, number] = [-87.691, 41.8745, -87.6255, 41.8865];
const WEST_SIDE_SHARED_BBOX: [number, number, number, number] = [-87.721, 41.8825, -87.6255, 41.8905];

const LOOP_SIDE_EXPECTED: Record<string, string[]> = {
  // Include Blue on the north Loop face (Clark/Lake area) per map requirement.
  north: ["Brown", "Green", "Blue", "Orange", "Pink", "Purple"],
  east: ["Brown", "Green", "Orange", "Purple"],
  south: ["Brown", "Orange", "Pink", "Purple"],
  west: ["Brown", "Orange", "Pink", "Purple"],
};

const OVERLAP_TOLERANCE_KM = 0.03; // ~30m
const SNAP_DISTANCE_TOLERANCE_KM = 0.02; // ~20m
const SNAP_INTERVAL_DEGREES = 0.00002; // ~2m
const BBOX_PREFILTER_DEGREES = 0.0005; // ~55m
const MIN_SEGMENT_LENGTH_METERS = 4;

function linesSorted(lines: Iterable<string>): string[] {
  const orderIndex = new Map(LINE_ORDER.map((line, idx) => [line, idx]));
  return Array.from(new Set(lines)).sort((a, b) => (orderIndex.get(a) ?? 999) - (orderIndex.get(b) ?? 999) || a.localeCompare(b));
}

function detectCorridor(lines: Set<string>, feature?: SegmentFeature): string {
  const inLoop = !feature || segmentInBBox(feature, LOOP_CORE_BBOX, "mid");
  const inNorthMain = !feature || segmentInBBox(feature, NORTH_MAIN_SHARED_BBOX, "mid");
  const inLake = !feature || segmentInBBox(feature, LAKE_SHARED_BBOX, "mid");
  const inWestSide = !feature || segmentInBBox(feature, WEST_SIDE_SHARED_BBOX, "mid");

  // Resolve corridor hand-offs before Loop inference so junction triples
  // like Green+Orange+Pink don't get coerced into Loop styling.
  if (lines.has("Green") && lines.has("Pink") && !lines.has("Brown") && !lines.has("Purple") && inWestSide) return "West Side";
  if (lines.has("Green") && lines.has("Orange") && !lines.has("Brown") && !lines.has("Purple") && inLake) return "Lake";
  if (lines.size === 2 && lines.has("Blue") && lines.has("Pink")) return "Forest Park";
  if (lines.size >= 2 && lines.has("Red") && lines.has("Green")) return "South Side";

  if (lines.size >= 2 && Array.from(lines).every((line) => NORTH_MAIN_LINES.has(line)) && inNorthMain) return "North Main";

  const loopOverlap = Array.from(lines).filter((line) => LOOP_LINES.has(line)).length;
  const loopOverlapWithBlue = Array.from(lines).filter((line) => LOOP_LINES_WITH_BLUE.has(line)).length;
  const hasLoopAnchor = lines.has("Brown") || lines.has("Purple");
  if (inLoop && ((loopOverlap >= 3 && hasLoopAnchor) || loopOverlapWithBlue >= 4)) return "Loop";

  if (lines.size > 1) return "Shared";
  return Array.from(lines)[0] ?? "Unknown";
}

function getEndpoints(feature: SegmentFeature): [number[], number[]] {
  const coords = feature.geometry.coordinates;
  return [coords[0], coords[coords.length - 1]];
}

function midpoint(feature: SegmentFeature): [number, number] {
  const [a, b] = getEndpoints(feature);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function pointInBBox(point: number[], bbox: [number, number, number, number]): boolean {
  return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}

function segmentInBBox(feature: SegmentFeature, bbox: [number, number, number, number], mode: "both" | "mid" | "any"): boolean {
  const [a, b] = getEndpoints(feature);
  if (mode === "both") return pointInBBox(a, bbox) && pointInBBox(b, bbox);
  if (mode === "mid") return pointInBBox(midpoint(feature), bbox);
  return pointInBBox(a, bbox) || pointInBBox(b, bbox);
}

function expandedBBox(feature: SegmentFeature, expandDeg = BBOX_PREFILTER_DEGREES): [number, number, number, number] {
  const [a, b] = getEndpoints(feature);
  const minLon = Math.min(a[0], b[0]) - expandDeg;
  const minLat = Math.min(a[1], b[1]) - expandDeg;
  const maxLon = Math.max(a[0], b[0]) + expandDeg;
  const maxLat = Math.max(a[1], b[1]) + expandDeg;
  return [minLon, minLat, maxLon, maxLat];
}

function bboxIntersects(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function inferLoopSide(feature: SegmentFeature): "north" | "south" | "east" | "west" {
  const [a, b] = getEndpoints(feature);
  const mid = midpoint(feature);
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  const centerLon = (LOOP_CORE_BBOX[0] + LOOP_CORE_BBOX[2]) / 2;
  const centerLat = (LOOP_CORE_BBOX[1] + LOOP_CORE_BBOX[3]) / 2;

  if (dx >= dy * 1.2) return mid[1] >= centerLat ? "north" : "south";
  if (dy >= dx * 1.2) return mid[0] >= centerLon ? "east" : "west";

  const edgeDistance: Record<"north" | "south" | "east" | "west", number> = {
    north: Math.abs(mid[1] - LOOP_CORE_BBOX[3]),
    south: Math.abs(mid[1] - LOOP_CORE_BBOX[1]),
    west: Math.abs(mid[0] - LOOP_CORE_BBOX[0]),
    east: Math.abs(mid[0] - LOOP_CORE_BBOX[2]),
  };

  return Object.entries(edgeDistance).sort((x, y) => x[1] - y[1])[0][0] as "north" | "south" | "east" | "west";
}

function lineDistanceKm(nearestResult: any): number {
  return nearestResult?.properties?.dist ?? nearestResult?.properties?.pointDistance ?? Number.POSITIVE_INFINITY;
}

function haversineMeters(a: number[], b: number[]): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function segmentLengthMeters(coordinates: number[][]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += haversineMeters(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

function normalizeCoordinates(part: number[][]): number[][] {
  const cleaned: number[][] = [];
  for (const coord of part) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    const normalized: number[] = [Number(coord[0]), Number(coord[1])];
    if (!Number.isFinite(normalized[0]) || !Number.isFinite(normalized[1])) continue;

    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.abs(prev[0] - normalized[0]) < 1e-9 && Math.abs(prev[1] - normalized[1]) < 1e-9) {
      continue;
    }

    cleaned.push(normalized);
  }
  return cleaned;
}

function coordinateKey(coordinates: number[][]): string {
  const forward = coordinates.map((coord) => `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`).join(";");
  const reverse = [...coordinates]
    .reverse()
    .map((coord) => `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`)
    .join(";");
  return forward <= reverse ? forward : reverse;
}

function runMapshaperCleanup(inputPath: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cta-topology-"));
  const outputPath = path.join(tempDir, "cleaned.geojson");

  const mapshaperBin = path.resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "mapshaper.cmd" : "mapshaper");
  if (!fs.existsSync(mapshaperBin)) {
    throw new Error(`mapshaper binary not found at ${mapshaperBin}`);
  }

  const args = [
    "-i",
    inputPath,
    "-snap",
    `interval=${SNAP_INTERVAL_DEGREES}`,
    "-clean",
    "-o",
    outputPath,
    "format=geojson",
    "force",
  ];

  execFileSync(mapshaperBin, args, { stdio: "inherit" });
  return outputPath;
}

function toAtomicLineSegments(feature: Feature<SegmentGeometry, SegmentProperties>): SegmentFeature[] {
  const props = feature.properties;
  const baseId = props.segment_id;
  const parts: number[][][] = feature.geometry.type === "LineString"
    ? [feature.geometry.coordinates as number[][]]
    : (feature.geometry.coordinates as number[][][]);

  const out: SegmentFeature[] = [];
  let created = 0;

  for (let partIdx = 0; partIdx < parts.length; partIdx += 1) {
    const part = parts[partIdx];
    if (!Array.isArray(part) || part.length < 2) continue;

    const normalizedPart = normalizeCoordinates(part);

    if (normalizedPart.length < 2) continue;
    if (segmentLengthMeters(normalizedPart) < MIN_SEGMENT_LENGTH_METERS) continue;

    const segmentId = created === 0 ? baseId : `${baseId}_p${partIdx}`;
    out.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: normalizedPart,
      },
      properties: {
        segment_id: segmentId,
        corridor: props.corridor,
        is_loop: props.is_loop,
        lines: [...props.lines],
      },
    });
    created += 1;
  }

  return out;
}

function reconcileSharedByOverlap(
  features: SegmentFeature[],
  candidateIndexes: number[],
  targetLines: Set<string>,
  workingLines: Array<Set<string>>,
  overlapMemo: Map<string, boolean>,
): number {
  const bboxes = new Map<number, [number, number, number, number]>();
  for (const idx of candidateIndexes) {
    bboxes.set(idx, expandedBBox(features[idx]));
  }

  const overlapping = (a: number, b: number): boolean => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = `${low}:${high}`;
    const cached = overlapMemo.get(key);
    if (cached !== undefined) return cached;

    if (!bboxIntersects(bboxes.get(a)!, bboxes.get(b)!)) {
      overlapMemo.set(key, false);
      return false;
    }

    const lineA = lineString(features[a].geometry.coordinates);
    const lineB = lineString(features[b].geometry.coordinates);
    const overlap = lineOverlap(lineA, lineB, { tolerance: OVERLAP_TOLERANCE_KM });
    if (overlap.features.length > 0) {
      overlapMemo.set(key, true);
      return true;
    }

    const [aStart, aEnd] = getEndpoints(features[a]);
    const [bStart, bEnd] = getEndpoints(features[b]);

    const aStartSnap = nearestPointOnLine(lineB, aStart, { units: "kilometers" });
    const aEndSnap = nearestPointOnLine(lineB, aEnd, { units: "kilometers" });
    const bStartSnap = nearestPointOnLine(lineA, bStart, { units: "kilometers" });
    const bEndSnap = nearestPointOnLine(lineA, bEnd, { units: "kilometers" });

    const closeEnough =
      lineDistanceKm(aStartSnap) <= SNAP_DISTANCE_TOLERANCE_KM &&
      lineDistanceKm(aEndSnap) <= SNAP_DISTANCE_TOLERANCE_KM &&
      lineDistanceKm(bStartSnap) <= SNAP_DISTANCE_TOLERANCE_KM &&
      lineDistanceKm(bEndSnap) <= SNAP_DISTANCE_TOLERANCE_KM;

    overlapMemo.set(key, closeEnough);
    return closeEnough;
  };

  let changed = 0;
  let iterationChanged = true;
  let iteration = 0;

  while (iterationChanged && iteration < 3) {
    iterationChanged = false;
    iteration += 1;

    const byLine = new Map<string, number[]>();
    for (const line of targetLines) byLine.set(line, []);
    for (const idx of candidateIndexes) {
      for (const line of workingLines[idx]) {
        if (targetLines.has(line)) byLine.get(line)!.push(idx);
      }
    }

    for (const idx of candidateIndexes) {
      const current = workingLines[idx];
      for (const line of targetLines) {
        if (current.has(line)) continue;

        const possible = byLine.get(line)!;
        for (const otherIdx of possible) {
          if (idx === otherIdx) continue;
          if (!overlapping(idx, otherIdx)) continue;

          current.add(line);
          changed += 1;
          iterationChanged = true;
          break;
        }
      }
    }
  }

  return changed;
}

function main() {
  const inputArg = process.argv[2];
  const inputPath = inputArg ? path.resolve(process.cwd(), inputArg) : path.resolve(process.cwd(), "public/data/cta/chicago_track_segments.geojson");
  const outputPath = inputPath;

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  console.log(`Loading ${inputPath}...`);
  const cleanedPath = runMapshaperCleanup(inputPath);
  const raw = fs.readFileSync(cleanedPath, "utf8");
  const cleaned = JSON.parse(raw) as FeatureCollection<SegmentGeometry, SegmentProperties>;
  const features = (cleaned.features as Array<Feature<SegmentGeometry, SegmentProperties>>)
    .flatMap((feature) => toAtomicLineSegments(feature));

  // Normalize line arrays in case a tool serializes them unexpectedly.
  for (const feature of features) {
    const lines = Array.isArray(feature.properties.lines)
      ? feature.properties.lines
      : typeof feature.properties.lines === "string"
        ? feature.properties.lines.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    feature.properties.lines = linesSorted(lines);
  }

  const workingLines = features.map((feature) => new Set(feature.properties.lines));
  const overlapMemo = new Map<string, boolean>();

  const loopCandidates = features
    .map((feature, idx) => ({ feature, idx }))
    .filter(({ feature }) => segmentInBBox(feature, LOOP_CORE_BBOX, "both") && feature.properties.lines.some((line) => LOOP_LINES.has(line)))
    .map(({ idx }) => idx);

  const loopBySide = new Map<number, "north" | "south" | "east" | "west">();
  for (const idx of loopCandidates) {
    loopBySide.set(idx, inferLoopSide(features[idx]));
  }

  const loopChangeCount = reconcileSharedByOverlap(features, loopCandidates, LOOP_LINES, workingLines, overlapMemo);

  // Enforce Loop-side baseline service patterns after overlap propagation.
  let loopTemplateAdds = 0;
  for (const idx of loopCandidates) {
    const side = loopBySide.get(idx)!;
    for (const line of LOOP_SIDE_EXPECTED[side]) {
      if (!workingLines[idx].has(line)) {
        workingLines[idx].add(line);
        loopTemplateAdds += 1;
      }
    }
  }

  const northMainRedPurpleCandidates = features
    .map((feature, idx) => ({ feature, idx }))
    .filter(({ feature }) =>
      segmentInBBox(feature, NORTH_MAIN_SHARED_BBOX, "mid")
      && feature.properties.lines.some((line) => NORTH_MAIN_RED_PURPLE_LINES.has(line))
    )
    .map(({ idx }) => idx);

  const northMainChangeCount = reconcileSharedByOverlap(
    features,
    northMainRedPurpleCandidates,
    NORTH_MAIN_RED_PURPLE_LINES,
    workingLines,
    overlapMemo
  );

  // Keep Red/Purple together on the North Main trunk.
  let northMainPairAdds = 0;
  for (const idx of northMainRedPurpleCandidates) {
    const lines = workingLines[idx];
    if (lines.has("Red") || lines.has("Purple")) {
      if (!lines.has("Red")) {
        lines.add("Red");
        northMainPairAdds += 1;
      }
      if (!lines.has("Purple")) {
        lines.add("Purple");
        northMainPairAdds += 1;
      }
    }
  }

  const lakeCandidates = features
    .map((feature, idx) => ({ feature, idx }))
    .filter(({ feature }) => segmentInBBox(feature, LAKE_SHARED_BBOX, "mid") && feature.properties.lines.some((line) => LAKE_LINES.has(line)))
    .map(({ idx }) => idx);
  const lakeChangeCount = reconcileSharedByOverlap(features, lakeCandidates, LAKE_LINES, workingLines, overlapMemo);

  const westSideCandidates = features
    .map((feature, idx) => ({ feature, idx }))
    .filter(({ feature }) => segmentInBBox(feature, WEST_SIDE_SHARED_BBOX, "mid") && feature.properties.lines.some((line) => WEST_SIDE_LINES.has(line)))
    .map(({ idx }) => idx);
  const westSideChangeCount = reconcileSharedByOverlap(features, westSideCandidates, WEST_SIDE_LINES, workingLines, overlapMemo);

  // Apply final line memberships and regenerate corridor labels.
  for (let idx = 0; idx < features.length; idx += 1) {
    const lines = linesSorted(workingLines[idx]);
    const lineSet = new Set(lines);
    const corridor = detectCorridor(lineSet, features[idx]);

    features[idx].properties.lines = lines;
    features[idx].properties.corridor = corridor;
    features[idx].properties.is_loop = corridor === "Loop";
  }

  // Deduplicate geometries introduced by topology cleanup by unioning line
  // membership instead of discarding one source feature.
  const deduped = new Map<string, SegmentFeature>();
  for (const feature of features) {
    const key = coordinateKey(feature.geometry.coordinates);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, {
        ...feature,
        properties: {
          ...feature.properties,
          lines: [...feature.properties.lines],
        },
      });
      continue;
    }

    const mergedLines = linesSorted([...existing.properties.lines, ...feature.properties.lines]);
    const mergedLineSet = new Set(mergedLines);
    const corridor = detectCorridor(mergedLineSet, existing);

    existing.properties.lines = mergedLines;
    existing.properties.corridor = corridor;
    existing.properties.is_loop = corridor === "Loop";
  }

  const dedupedFeatures = Array.from(deduped.values());
  dedupedFeatures.forEach((feature, idx) => {
    feature.properties.segment_id = `seg_${idx.toString().padStart(4, "0")}`;
  });

  const output: FeatureCollection<LineString, SegmentProperties> = {
    type: "FeatureCollection",
    features: dedupedFeatures,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  const corridorCounts = new Map<string, number>();
  const loopCombos = new Map<string, number>();
  for (const feature of dedupedFeatures) {
    const corridor = feature.properties.corridor;
    corridorCounts.set(corridor, (corridorCounts.get(corridor) ?? 0) + 1);
    if (feature.properties.is_loop) {
      const combo = feature.properties.lines.join(",");
      loopCombos.set(combo, (loopCombos.get(combo) ?? 0) + 1);
    }
  }

  console.log(`\nWrote ${outputPath}`);
  console.log(`Loop overlap additions: ${loopChangeCount}`);
  console.log(`Loop template additions: ${loopTemplateAdds}`);
  console.log(`North Main overlap additions: ${northMainChangeCount}`);
  console.log(`North Main Red/Purple pair additions: ${northMainPairAdds}`);
  console.log(`Lake overlap additions: ${lakeChangeCount}`);
  console.log(`West Side overlap additions: ${westSideChangeCount}`);

  console.log("\nCorridors:");
  for (const [corridor, count] of Array.from(corridorCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${corridor}: ${count}`);
  }

  console.log("\nLoop line combos:");
  for (const [combo, count] of Array.from(loopCombos.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}: ${combo}`);
  }
}

main();
