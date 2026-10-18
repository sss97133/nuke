#!/usr/bin/env python3
"""Switch / control / module end TG-SW-DASH (dev_switches; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/TG-SW-DASH.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_switches  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_switches.mck5_dash_switch())

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
