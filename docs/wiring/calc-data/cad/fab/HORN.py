#!/usr/bin/env python3
"""Horn: factory horn on the radiator support (assumed envelope) (dev_engine.gm_horn; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/HORN.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_engine  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_engine.gm_horn("HORN"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
