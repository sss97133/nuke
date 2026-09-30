#!/usr/bin/env python3
"""Write the nuke.ag MAP tab's public files from the layout builder's model:
nuke_frontend/public/wiring/k5-positions.json, k5-routes.json and nuke_frontend/public/models/k5-harness-v4-{bay,cab,rear}.glb.
Usage: python3 export_site.py <path to nuke_frontend>. The files carry no prices, order or listing ids, or people's names."""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "..", "..", "nuke_frontend")
sys.exit(subprocess.call([sys.executable, os.path.join(HERE, "build.py"), "--export-site", FE]))
