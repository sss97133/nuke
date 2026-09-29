#!/usr/bin/env python3
"""Left headlight: Truck-Lite 27270C 7 in round LED (dev_lamps.truck_lite_27270c; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/HEADLIGHT-L.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_lamps  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_lamps.truck_lite_27270c("HEADLIGHT-L"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
