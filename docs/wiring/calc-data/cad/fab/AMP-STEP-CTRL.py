#!/usr/bin/env python3
"""Power step controller and motor: AMP Research PowerStep (K5 kit) (dev_engine.amp_powerstep; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/AMP-STEP-CTRL.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_engine  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_engine.amp_powerstep("AMP-STEP-CTRL"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
