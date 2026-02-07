#!/usr/bin/env python3
"""
Compatibility wrapper for CTA track segment reconciliation.

This delegates to the Turf + mapshaper implementation:
  scripts/reconcile-track-segments.ts
"""

import os
import subprocess
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    os.chdir(root)

    input_path = "public/data/cta/chicago_track_segments.geojson"
    print(f"Running topology cleanup + overlap reconciliation on {input_path}...")
    subprocess.run(
        ["npx", "tsx", "scripts/reconcile-track-segments.ts", input_path],
        check=True,
    )
    print("Done.")


if __name__ == "__main__":
    main()
