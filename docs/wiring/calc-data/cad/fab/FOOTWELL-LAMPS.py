#!/usr/bin/env python3
"""Footwell lamp: Lumitec Mini Rail2 101241 (dev_lamps.lumitec_mini_rail2; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/FOOTWELL-LAMPS.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_lamps  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_lamps.lumitec_mini_rail2("FOOTWELL-LAMPS"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
