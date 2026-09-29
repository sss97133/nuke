#!/usr/bin/env python3
"""MoTeC PDM15 engine power box (MoTeC part 14104): endpoints PDM15-A (34-way), PDM15-B (26-way), PDM15-STUD (M6).

The same case, headers and stud as the PDM30 (MoTeC PDM manual p.47 draws both); the difference is inside and on the
label. mounts.yaml flags the PDM15 in the engine bay (unsealed case); this model is the part, not its place.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/PDM15-A.py <out_dir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import motec_pdm  # noqa: E402

UNIT = motec_pdm.unit("PDM15")


def build():
    return UNIT.build()


def part_meta(bodies):
    return UNIT.part_meta(bodies)


if __name__ == "__main__":
    UNIT.main(sys.argv[1] if len(sys.argv) > 1 else "out")
