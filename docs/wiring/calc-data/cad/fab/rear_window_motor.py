#!/usr/bin/env python3
"""Factory electric tailgate window motor (base design) (dev_motors.gm_tailgate_motor; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/rear_window_motor.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_motors  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_motors.gm_tailgate_motor("rear_window_motor"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
