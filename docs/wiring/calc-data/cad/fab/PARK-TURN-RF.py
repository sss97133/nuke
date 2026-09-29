#!/usr/bin/env python3
"""Factory lamp end PARK-TURN-RF (dev_lamps.park_turn; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/PARK-TURN-RF.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_lamps  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_lamps.park_turn("PARK-TURN-RF"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
