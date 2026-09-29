#!/usr/bin/env python3
"""Backup camera: Rear View Safety RVS-7180355-IR license-plate camera (dev_video.rvs_camera; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/Backup_Camera.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_video  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_video.rvs_camera("Backup_Camera"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
