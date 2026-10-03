#!/usr/bin/env python3
"""Test the segment stitching by analyzing the results"""

import json

def analyze_segments(filepath):
    with open(filepath) as f:
        data = json.load(f)

    total = len(data['features'])
    by_line = {}
    by_segment_count = {}

    for feature in data['features']:
        props = feature['properties']
        line = props.get('line', 'unknown')
        segment_count = props.get('segment_count', 1)

        if line not in by_line:
            by_line[line] = 0
        by_line[line] += 1

        if segment_count not in by_segment_count:
            by_segment_count[segment_count] = 0
        by_segment_count[segment_count] += 1

    print(f"Total features after stitching: {total}")
    print("\nFeatures by line:")
    for line, count in sorted(by_line.items()):
        print(f"  {line}: {count}")

    print("\nStitching statistics:")
    for count, num in sorted(by_segment_count.items()):
        if count == 1:
            print(f"  Single segments: {num}")
        else:
            print(f"  Stitched from {count} segments: {num}")

if __name__ == "__main__":
    # This would need to be run after the app processes and saves the stitched data
    print("To use this script, first save the explodedTracks data from the browser console:")
    print("  1. Open browser dev tools on the map page")
    print("  2. Add a console.log in MapContainer to output explodedTracks")
    print("  3. Copy the output and save to a file")
    print("  4. Run: python3 scripts/test_stitching.py <filepath>")