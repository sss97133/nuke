#!/usr/bin/env python3
"""Wiper motor with its washer pump (ends WIPER-MOTOR and WASHER-PUMP): factory 1977 C/K (dev_engine.gm_wiper; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/WIPER-MOTOR.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_engine  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_engine.gm_wiper("WIPER-MOTOR"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
