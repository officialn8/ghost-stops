#!/bin/bash
# Regenerate CTA tracks with improved Loop segment matching

echo "Regenerating CTA track segments with Loop endpoint snapping..."
python3 scripts/generate_cta_tracks.py

echo ""
echo "Track segments regenerated. The map will automatically use the new data."
echo "Changes:"
echo "- Loop segment endpoints are snapped to 4-decimal precision (~11m)"
echo "- This improves shared segment matching in the Loop area"
echo "- Regular segments still use 5-decimal precision (~1.1m)"