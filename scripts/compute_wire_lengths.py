#!/usr/bin/env python3
"""
K5 wire length computer.

Joins landmark distances (measured at the truck) with wire-routing paths
(which landmarks each wire traverses) to compute final wire lengths.

Inputs:
  docs/wiring/output/K5_landmarks.yaml   — measured landmark distances (inches)
  docs/wiring/output/K5_wire_paths.yaml  — per-wire routing path

Output:
  docs/wiring/output/K5_computed_lengths.csv
  Plus stdout summary with variance vs current cut list estimates.

Rules applied per wire:
  base = sum of landmark distances along path (inches)
  + 12"          service loop (6" each end)
  + 6"           shielded bypass (if flag: shielded)
  + 6"           door flex (if flag: door_crossing)
  × 1.05         bend allowance (gauge >= 14 AWG, i.e. signal wire)
  × 1.10         bend allowance (gauge <= 12 AWG, heavy gauge)
"""

import csv
import sys
import argparse
from pathlib import Path

try:
    import yaml
except ImportError:
    print("pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
LANDMARKS_PATH = ROOT / "docs/wiring/output/K5_landmarks.yaml"
PATHS_PATH = ROOT / "docs/wiring/output/K5_wire_paths.yaml"
OUTPUT_CSV = ROOT / "docs/wiring/output/K5_computed_lengths.csv"
CUT_LIST_PATH = ROOT / "docs/wiring/output/K5_cut_list.txt"

SERVICE_LOOP_IN = 12
SHIELDED_BYPASS_IN = 6
DOOR_FLEX_IN = 6
BEND_ALLOWANCE_HEAVY = 1.10  # gauge <= 12 AWG
BEND_ALLOWANCE_LIGHT = 1.05  # gauge >= 14 AWG


def load_yaml(path: Path) -> dict:
    if not path.exists():
        print(f"MISSING: {path}", file=sys.stderr)
        sys.exit(1)
    with path.open() as fh:
        return yaml.safe_load(fh)


def compute_wire_inches(wire: dict, landmarks: dict) -> tuple[float, list[str]]:
    """Returns (computed_inches, warnings)."""
    warnings: list[str] = []
    path = wire.get("path", [])
    base = 0.0

    for landmark_id in path:
        if landmark_id not in landmarks:
            warnings.append(f"unknown landmark: {landmark_id}")
            continue
        value = landmarks[landmark_id]
        if value is None or value == "TBD":
            warnings.append(f"unmeasured landmark: {landmark_id}")
            continue
        base += float(value)

    if warnings:
        return 0.0, warnings

    extras = SERVICE_LOOP_IN
    flags = wire.get("flags") or []
    if "shielded" in flags:
        extras += SHIELDED_BYPASS_IN
    if "door_crossing" in flags:
        extras += DOOR_FLEX_IN

    subtotal = base + extras

    gauge = wire.get("gauge", 18)
    multiplier = BEND_ALLOWANCE_HEAVY if gauge <= 12 else BEND_ALLOWANCE_LIGHT
    final = subtotal * multiplier
    return final, []


def parse_cut_list_estimates(path: Path) -> dict[str, float]:
    """Pull est. lengths (ft) keyed by wire number from K5_cut_list.txt.
    Format: '#24  Ignition Coil 1   M130:A13   20 AWG TXL   WHT/ORG   4.6ft'
    """
    import re
    if not path.exists():
        return {}
    estimates: dict[str, float] = {}
    pattern = re.compile(r"^#(\d+)\b.*?(\d+(?:\.\d+)?)ft\b")
    with path.open() as fh:
        for raw in fh:
            m = pattern.match(raw.strip())
            if m:
                estimates[m.group(1)] = float(m.group(2))
    return estimates


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--landmarks", type=Path, default=LANDMARKS_PATH)
    ap.add_argument("--paths", type=Path, default=PATHS_PATH)
    ap.add_argument("--output", type=Path, default=OUTPUT_CSV)
    ap.add_argument("--no-write", action="store_true",
                    help="Print only, do not write CSV")
    ap.add_argument("--variance", action="store_true",
                    help="Show variance vs cut list estimates")
    args = ap.parse_args()

    landmarks_doc = load_yaml(args.landmarks)
    landmarks = landmarks_doc.get("landmarks", {})
    paths_doc = load_yaml(args.paths)
    wires = paths_doc.get("wires", {})

    estimates_ft = parse_cut_list_estimates(CUT_LIST_PATH) if args.variance else {}

    rows = []
    blocked = []
    total_in = 0.0

    for wire_id, wire in wires.items():
        inches, warnings = compute_wire_inches(wire, landmarks)
        if warnings:
            blocked.append((wire_id, wire.get("label", ""), warnings))
            continue

        feet = round(inches / 12.0, 2)
        est_ft = estimates_ft.get(str(wire_id))
        variance_pct = None
        if est_ft and est_ft > 0:
            variance_pct = round(100.0 * (feet - est_ft) / est_ft, 1)

        total_in += inches
        rows.append({
            "wire_id": wire_id,
            "label": wire.get("label", ""),
            "gauge": wire.get("gauge", ""),
            "path": "+".join(wire.get("path", [])),
            "flags": ",".join(wire.get("flags") or []),
            "computed_inches": round(inches, 1),
            "computed_feet": feet,
            "estimated_feet": est_ft if est_ft else "",
            "variance_pct": variance_pct if variance_pct is not None else "",
        })

    print(f"Computed: {len(rows)} wires")
    print(f"Blocked:  {len(blocked)} wires (missing landmark or path issue)")
    print(f"Total harness wire: {total_in / 12:.1f} ft "
          f"({total_in / 12 / 3.28:.1f} m)")

    if blocked:
        print("\nBLOCKED WIRES (fill landmarks before next run):")
        for wire_id, label, warns in blocked[:20]:
            print(f"  #{wire_id:>4} {label[:40]:<40}  {'; '.join(warns)}")
        if len(blocked) > 20:
            print(f"  ... and {len(blocked) - 20} more")

    if args.variance and rows:
        print("\nLargest variance vs estimate (>20% flagged):")
        flagged = [r for r in rows
                   if isinstance(r["variance_pct"], (int, float))
                   and abs(r["variance_pct"]) > 20]
        flagged.sort(key=lambda r: abs(r["variance_pct"]), reverse=True)
        for r in flagged[:15]:
            sign = "+" if r["variance_pct"] >= 0 else ""
            print(f"  #{r['wire_id']:>4} {r['label'][:35]:<35}  "
                  f"est {r['estimated_feet']:>5} ft → "
                  f"computed {r['computed_feet']:>5} ft  "
                  f"({sign}{r['variance_pct']}%)")

    if not args.no_write and rows:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nWrote: {args.output}")

    return 0 if not blocked else 2


if __name__ == "__main__":
    sys.exit(main())
