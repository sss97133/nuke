#!/usr/bin/env python3
"""Driver door lock actuator: AutoLoc AUTZT2000 (dev_motors.autoloc_autzt2000; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/lock_actuator_DS.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_motors  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_motors.autoloc_autzt2000("lock_actuator_DS"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
