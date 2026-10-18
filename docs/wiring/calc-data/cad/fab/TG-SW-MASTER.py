#!/usr/bin/env python3
"""Switch / control / module end TG-SW-MASTER (dev_switches; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/TG-SW-MASTER.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_switches  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_switches.nu_relics_rocker("TG-SW-MASTER", 1, "Tailgate window master switch at the dash, Nu-Relics reverse-polarity switch (#121 single, candidate)", "Nu-Relics standard chrome switch, single (#121)", "121", picked=False))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
