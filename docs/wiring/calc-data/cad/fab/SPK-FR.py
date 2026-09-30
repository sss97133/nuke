#!/usr/bin/env python3
"""Passenger door speaker: JL Audio C2-650X 6.5 in coax (dev_audio.jl_c2_650x; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/SPK-FR.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_audio  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_audio.jl_c2_650x("SPK-FR", "Passenger door"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
