#!/usr/bin/env python3
"""Switch / control / module end TCASE-4WD-SW (dev_switches; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/TCASE-4WD-SW.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_switches  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_switches.torque_king_qu30048())

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
