#!/usr/bin/env python3
"""Mirror monitor: Rear View Safety replacement mirror with a 4.3 in display (dev_video.rvs_mirror; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/MIRROR-MON.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_video  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_video.rvs_mirror("MIRROR-MON"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
