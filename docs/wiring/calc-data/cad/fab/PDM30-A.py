#!/usr/bin/env python3
"""MoTeC PDM30 body power box (MoTeC part 14103): endpoints PDM30-A (34-way), PDM30-B (26-way), PDM30-STUD (M6).

The case is the M130's (motec_m1case.py); the PDM's own numbers and pages are in motec_pdm.py.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/PDM30-A.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import motec_pdm  # noqa: E402

UNIT = motec_pdm.unit("PDM30")


def build():
    return UNIT.build()


def part_meta(bodies):
    return UNIT.part_meta(bodies)


if __name__ == "__main__":
    UNIT.main(sys.argv[1] if len(sys.argv) > 1 else "out")
