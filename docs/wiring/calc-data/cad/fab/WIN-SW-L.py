#!/usr/bin/env python3
"""Switch / control / module end WIN-SW-L (dev_switches; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/WIN-SW-L.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_switches  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_switches.nu_relics_rocker("WIN-SW-L", 2, "Driver door switch panel: window master (both windows) + lock rocker, Nu-Relics 17383-2 chrome reverse-polarity switches", "Nu-Relics #201 chrome switches, double (driver door)"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
