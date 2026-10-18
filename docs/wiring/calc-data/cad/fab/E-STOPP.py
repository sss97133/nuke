#!/usr/bin/env python3
"""Electric parking brake: E-Stopp ESK001 actuator, control box and button (dev_motors.estopp_esk001; its sources and frame
are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/E-STOPP.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_motors  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_motors.estopp_esk001("E-STOPP"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
