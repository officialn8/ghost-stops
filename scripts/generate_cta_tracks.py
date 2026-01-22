#!/usr/bin/env python3
"""
Generate CTA track segments from GTFS shapes.txt - FIXED VERSION

This script:
1. Downloads CTA GTFS data
2. Extracts rail line shapes BY SHAPE_ID
3. Splits into segments WITHIN each shape_id only
4. Groups identical segments across lines
5. Outputs GeoJSON for map rendering
"""

import json
import csv
import zipfile
import urllib.request
import os
from collections import defaultdict
from typing import List, Dict, Tuple, Set
import math

# CTA GTFS URL
GTFS_URL = "https://www.transitchicago.com/downloads/sch_data/google_transit.zip"

# Map route colors to line names
ROUTE_TO_LINE = {
    "Red": "Red",
    "Blue": "Blue",
    "Brn": "Brown",
    "G": "Green",
    "Org": "Orange",
    "P": "Purple",
    "Pink": "Pink",
    "Y": "Yellow"
}

def download_gtfs(url: str, output_path: str = "cta_gtfs.zip"):
    """Download GTFS zip file"""
    print(f"Downloading GTFS from {url}...")
    urllib.request.urlretrieve(url, output_path)
    print(f"Downloaded to {output_path}")
    return output_path

def extract_rail_shapes(zip_path: str) -> Dict[str, List[Dict]]:
    """Extract rail line shapes from GTFS, maintaining shape_id separation"""
    shapes_by_route_and_shape = defaultdict(lambda: defaultdict(list))

    with zipfile.ZipFile(zip_path, 'r') as zf:
        # First, get rail routes
        rail_routes = set()
        with zf.open('routes.txt') as f:
            reader = csv.DictReader(line.decode('utf-8-sig') for line in f)
            for row in reader:
                if row['route_id'] in ROUTE_TO_LINE:
                    rail_routes.add(row['route_id'])

        print(f"Found rail routes: {rail_routes}")

        # Get shape IDs from trips
        route_shapes = defaultdict(set)
        with zf.open('trips.txt') as f:
            reader = csv.DictReader(line.decode('utf-8-sig') for line in f)
            for row in reader:
                if row['route_id'] in rail_routes and row.get('shape_id'):
                    route_shapes[row['route_id']].add(row['shape_id'])

        # Print shape_id info
        for route_id, shape_ids in route_shapes.items():
            print(f"Route {route_id} ({ROUTE_TO_LINE.get(route_id)}): {len(shape_ids)} shape_ids")

        # Extract shape points, keeping shape_id separation
        with zf.open('shapes.txt') as f:
            reader = csv.DictReader(line.decode('utf-8-sig') for line in f)
            for row in reader:
                shape_id = row['shape_id']
                # Find which route this shape belongs to
                for route_id, shape_ids in route_shapes.items():
                    if shape_id in shape_ids:
                        lat = float(row['shape_pt_lat'])
                        lon = float(row['shape_pt_lon'])
                        seq = int(row['shape_pt_sequence'])
                        shapes_by_route_and_shape[route_id][shape_id].append({
                            'lon': lon,
                            'lat': lat,
                            'seq': seq
                        })

    # Sort points within each shape by sequence
    result = {}
    for route_id, shapes in shapes_by_route_and_shape.items():
        result[route_id] = []
        for shape_id, points in shapes.items():
            sorted_points = sorted(points, key=lambda x: x['seq'])
            coords = [(p['lon'], p['lat']) for p in sorted_points]
            if coords:  # Only add non-empty shapes
                result[route_id].append({
                    'shape_id': shape_id,
                    'coords': coords
                })
        print(f"Route {route_id}: {len(result[route_id])} shapes with points")

    return result

def normalize_coord(val: float, decimals: int = 5) -> float:
    """Normalize coordinate to fixed decimals (5 = ~1.1m precision)"""
    return round(val, decimals)

def is_loop_area(lon: float, lat: float) -> bool:
    """Check if coordinate is in the Loop area"""
    # Rough bounds for Chicago Loop
    return -87.64 <= lon <= -87.62 and 41.87 <= lat <= 41.89

def snap_loop_coord(val: float, is_lon: bool = True) -> float:
    """Snap Loop coordinates to coarser grid (4 decimals = ~11m)"""
    # Use coarser snapping for Loop to improve segment matching
    return round(val, 4)

def point_key(p1: Tuple[float, float], p2: Tuple[float, float]) -> str:
    """Create direction-invariant key for segment"""
    # Check if segment is in Loop area
    in_loop = (is_loop_area(p1[0], p1[1]) and is_loop_area(p2[0], p2[1]))

    # Use different normalization for Loop segments
    if in_loop:
        lon1, lat1 = snap_loop_coord(p1[0], True), snap_loop_coord(p1[1], False)
        lon2, lat2 = snap_loop_coord(p2[0], True), snap_loop_coord(p2[1], False)
    else:
        lon1, lat1 = normalize_coord(p1[0]), normalize_coord(p1[1])
        lon2, lat2 = normalize_coord(p2[0]), normalize_coord(p2[1])

    # Sort points to make key direction-invariant
    if (lon1, lat1) < (lon2, lat2):
        return f"{lon1},{lat1}_{lon2},{lat2}"
    else:
        return f"{lon2},{lat2}_{lon1},{lat1}"

def haversine_m(a, b):
    """Calculate distance between two points in meters"""
    lon1, lat1 = a
    lon2, lat2 = b
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    x = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    return 2 * R * math.asin(math.sqrt(x))

def douglas_peucker(points: List[Tuple[float, float]], epsilon: float = 0.00002) -> List[Tuple[float, float]]:
    """Simplify line using Douglas-Peucker algorithm"""
    if len(points) <= 2:
        return points

    # Find point with maximum distance from line between start and end
    max_dist = 0
    max_idx = 0

    for i in range(1, len(points) - 1):
        dist = point_line_distance(points[i], points[0], points[-1])
        if dist > max_dist:
            max_dist = dist
            max_idx = i

    # If max distance is greater than epsilon, recursively simplify
    if max_dist > epsilon:
        left = douglas_peucker(points[:max_idx + 1], epsilon)
        right = douglas_peucker(points[max_idx:], epsilon)
        return left[:-1] + right
    else:
        return [points[0], points[-1]]

def point_line_distance(point: Tuple[float, float], line_start: Tuple[float, float], line_end: Tuple[float, float]) -> float:
    """Calculate perpendicular distance from point to line"""
    x0, y0 = point
    x1, y1 = line_start
    x2, y2 = line_end

    if x1 == x2 and y1 == y2:
        return math.sqrt((x0 - x1)**2 + (y0 - y1)**2)

    num = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
    den = math.sqrt((y2 - y1)**2 + (x2 - x1)**2)
    return num / den

def create_segments(shapes_by_route: Dict[str, List[Dict]]) -> Tuple[Dict[str, Set[str]], Dict[str, List]]:
    """Create segments from shapes, processing each shape_id separately"""
    segment_lines = defaultdict(set)  # segment_key -> set of lines
    segment_coords = {}  # segment_key -> coords

    total_shapes = 0
    total_segments = 0
    long_segments = 0

    for route_id, shapes in shapes_by_route.items():
        line_name = ROUTE_TO_LINE.get(route_id, route_id)

        for shape_data in shapes:
            shape_id = shape_data['shape_id']
            points = shape_data['coords']

            if len(points) < 2:
                continue

            total_shapes += 1

            # Simplify line slightly to reduce point count while preserving shape
            simplified = douglas_peucker(points, epsilon=0.00003)  # ~3 meters

            # Create segments between consecutive points WITHIN this shape
            for i in range(len(simplified) - 1):
                p1 = simplified[i]
                p2 = simplified[i + 1]

                # Check segment length
                dist = haversine_m(p1, p2)
                if dist > 1000:  # Flag segments over 1km
                    long_segments += 1
                    print(f"WARNING: Long segment ({int(dist)}m) in {line_name} shape {shape_id}")

                key = point_key(p1, p2)
                segment_lines[key].add(line_name)
                total_segments += 1

                # Store coords in consistent order
                if (p1[0], p1[1]) < (p2[0], p2[1]):
                    segment_coords[key] = [p1, p2]
                else:
                    segment_coords[key] = [p2, p1]

    print(f"\nProcessed {total_shapes} shapes into {total_segments} segments")
    print(f"Found {long_segments} segments over 1km (should be very few)")

    return segment_lines, segment_coords

def detect_corridors(segment_lines: Dict[str, Set[str]]) -> Dict[str, str]:
    """Detect named corridors based on shared line patterns"""
    corridors = {}

    for seg_key, lines in segment_lines.items():
        lines_set = frozenset(lines)

        # Loop segments - check if multiple lines that typically share the Loop
        loop_lines = {"Brown", "Green", "Orange", "Pink", "Purple"}
        if len(lines_set & loop_lines) >= 3:
            corridors[seg_key] = "Loop"
        elif lines_set >= {"Brown", "Purple"}:
            corridors[seg_key] = "North Main"
        elif lines_set >= {"Red", "Green"}:
            corridors[seg_key] = "South Side"
        elif lines_set == {"Blue", "Pink"}:
            corridors[seg_key] = "Forest Park"
        elif lines_set == {"Green", "Pink"}:
            corridors[seg_key] = "West Side"
        elif len(lines) > 1:
            corridors[seg_key] = "Shared"
        else:
            corridors[seg_key] = list(lines)[0]

    return corridors

def create_geojson(segment_lines: Dict[str, Set[str]],
                   segment_coords: Dict[str, List],
                   corridors: Dict[str, str]) -> Dict:
    """Create GeoJSON FeatureCollection"""
    features = []

    for i, (seg_key, lines) in enumerate(segment_lines.items()):
        coords = segment_coords[seg_key]
        corridor = corridors.get(seg_key, "Unknown")
        is_loop = corridor == "Loop"

        feature = {
            "type": "Feature",
            "properties": {
                "segment_id": f"seg_{i:04d}",
                "corridor": corridor,
                "is_loop": is_loop,
                "lines": sorted(list(lines))  # Sort for consistency
            },
            "geometry": {
                "type": "LineString",
                "coordinates": coords
            }
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features
    }

def calculate_bbox(features: List[Dict]) -> Tuple[float, float, float, float]:
    """Calculate bounding box of all features"""
    min_lon = float('inf')
    max_lon = float('-inf')
    min_lat = float('inf')
    max_lat = float('-inf')

    for feature in features:
        for coord in feature['geometry']['coordinates']:
            lon, lat = coord
            min_lon = min(min_lon, lon)
            max_lon = max(max_lon, lon)
            min_lat = min(min_lat, lat)
            max_lat = max(max_lat, lat)

    return min_lon, min_lat, max_lon, max_lat

def validate_segments(geojson: Dict) -> None:
    """Validate segment lengths"""
    distance_buckets = {
        "0-50m": 0,
        "50-200m": 0,
        "200-500m": 0,
        "500-1000m": 0,
        "1000m+": 0
    }

    for feature in geojson['features']:
        coords = feature['geometry']['coordinates']
        if len(coords) == 2:
            dist = haversine_m(coords[0], coords[1])

            if dist < 50:
                distance_buckets["0-50m"] += 1
            elif dist < 200:
                distance_buckets["50-200m"] += 1
            elif dist < 500:
                distance_buckets["200-500m"] += 1
            elif dist < 1000:
                distance_buckets["500-1000m"] += 1
            else:
                distance_buckets["1000m+"] += 1

    print("\nSegment length distribution:")
    for bucket, count in distance_buckets.items():
        print(f"  {bucket}: {count} segments")

def main():
    # Create scripts directory if needed
    os.makedirs("scripts", exist_ok=True)
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    # Download GTFS
    zip_path = download_gtfs(GTFS_URL, "scripts/cta_gtfs.zip")

    try:
        # Extract shapes WITH shape_id separation
        shapes_by_route = extract_rail_shapes(zip_path)

        if not shapes_by_route:
            print("ERROR: No rail shapes found in GTFS!")
            return

        # Create segments (properly, within each shape)
        segment_lines, segment_coords = create_segments(shapes_by_route)
        print(f"\nCreated {len(segment_lines)} unique segments")

        # Detect corridors
        corridors = detect_corridors(segment_lines)

        # Analyze segment sharing
        sharing_stats = defaultdict(int)
        for lines in segment_lines.values():
            sharing_stats[len(lines)] += 1

        print("\nSegment sharing statistics:")
        for num_lines, count in sorted(sharing_stats.items()):
            print(f"  {count} segments shared by {num_lines} line(s)")

        # Create GeoJSON
        geojson = create_geojson(segment_lines, segment_coords, corridors)

        # Validate segments
        validate_segments(geojson)

        # Validate and print stats
        bbox = calculate_bbox(geojson['features'])
        print(f"\nGenerated GeoJSON stats:")
        print(f"  Features: {len(geojson['features'])}")
        print(f"  Bounding box: {bbox}")
        print(f"  Expected Chicago area: ~(-87.94, 41.64, -87.52, 42.02)")

        # Validate Chicago bounds
        if bbox[0] < -88 or bbox[2] > -87 or bbox[1] < 41 or bbox[3] > 43:
            print("  WARNING: Bounding box seems outside Chicago area!")
        else:
            print("  ✓ Bounding box is within Chicago area")

        # Write output
        output_path = "public/data/cta/chicago_track_segments.geojson"
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        with open(output_path, 'w') as f:
            json.dump(geojson, f, indent=2)

        print(f"\nSuccessfully wrote {output_path}")

        # Print sample segments
        print("\nSample segments:")
        for i, feature in enumerate(geojson['features'][:5]):
            props = feature['properties']
            print(f"  {props['segment_id']}: {props['corridor']} - Lines: {', '.join(props['lines'])}")

        # Find some shared segments
        print("\nSample shared segments:")
        shared_count = 0
        for feature in geojson['features']:
            if len(feature['properties']['lines']) > 1:
                props = feature['properties']
                print(f"  {props['segment_id']}: {props['corridor']} - Lines: {', '.join(props['lines'])}")
                shared_count += 1
                if shared_count >= 5:
                    break

    finally:
        # Clean up
        if os.path.exists(zip_path):
            os.remove(zip_path)

if __name__ == "__main__":
    main()