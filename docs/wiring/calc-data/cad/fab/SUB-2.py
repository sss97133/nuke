#!/usr/bin/env python3
"""Woofer 2 of 2: JBL Club 102SL 10 in shallow-mount woofer (dev_audio.jbl_club_102sl; its sources and frame are there).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/SUB-2.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_audio  # noqa: E402
import k5dev as D  # noqa: E402

globals().update(dev_audio.jbl_club_102sl("SUB-2", "2"))

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
