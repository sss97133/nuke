#!/usr/bin/env python3
"""Switch / control / module end WIN-SW-R (dev_switches; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/WIN-SW-R.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_switches  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_switches.nu_relics_rocker("WIN-SW-R", 2, "Passenger door window switch (in series with the master), Nu-Relics 17383-2", "Nu-Relics #201 chrome switches, double (passenger door)"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
