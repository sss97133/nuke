#!/usr/bin/env python3
"""Tailgate window motor and regulator: Nu-Relics 17383-1 with its ACI motor (dev_motors.nu_relics_tailgate; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/TG-MOTOR-ACI.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_motors  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_motors.nu_relics_tailgate("TG-MOTOR-ACI"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
