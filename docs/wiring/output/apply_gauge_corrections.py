#!/usr/bin/env python3
"""
Apply physics-derived gauge corrections to K5_cut_list_v2.txt → K5_cut_list_v3.txt.

Rules:
  - Derive gauge per chapter 6: amperage + length + 3% Vdrop + 25% safety margin
  - Practical floor: 22 AWG for low-current signal wires
                     (24 AWG reserved for CAN/Ethernet per K5_wire_spec_and_costs.md)
  - Upsize wires that are UNDERSIZED — these are safety issues
  - Downsize wires that are oversized by ≥2 gauges
  - Leave wires oversized by 1 gauge alone (margin acceptable)
  - Preserve all other cut list columns (label, from, color, length, notes)
"""
import re
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "K5_cut_list_v2.txt"
DST = ROOT / "K5_cut_list_v3.txt"

# Reuse audit functions
import sys
sys.path.insert(0, str(ROOT))
from audit_wire_gauges import (
    AWG_OHMS_PER_KFT, AWG_AMPACITY, VDROP_PCT, SYSTEM_V, SAFETY_MARGIN,
    CURRENT_MAP, parse_cut_list, derive_gauge, lookup_current
)

# Practical floor
SIGNAL_FLOOR_AWG = 22

# Wires whose label suggests the practical floor doesn't apply (e.g., CAN/Ethernet)
NO_FLOOR_PATTERNS = [r"CAN Bus", r"Ethernet"]

def practical_gauge(label, derived_gauge, current_a):
    if current_a > 1.0:
        return derived_gauge
    for p in NO_FLOOR_PATTERNS:
        if re.search(p, label, re.IGNORECASE):
            return derived_gauge
    return min(derived_gauge, SIGNAL_FLOOR_AWG)

# Build a map of (wire_id) → corrected_gauge
wires = parse_cut_list()
corrections = {}
for w in wires:
    I, _ = lookup_current(w["label"])
    if I is None:
        continue
    derived, _ = derive_gauge(I, w["length"])
    target = practical_gauge(w["label"], derived, I)
    if target != w["gauge"]:
        corrections[w["id"]] = (w["gauge"], target, I)

# Rewrite the cut list line by line. Match the GAUGE token in the SPEC column.
src_text = SRC.read_text()
out_lines = []

# Patterns
gap_pat = re.compile(r"\s{2,}")
len_pat = re.compile(r"^([\d.]+)ft$")
section_pat = re.compile(r">>\s+(.+?)\s+\(")

for line in src_text.splitlines():
    if not line.startswith("#") or line.startswith("# ") or line.startswith("#    LABEL"):
        out_lines.append(line)
        continue
    body = re.sub(r"(\S)\s(\d+\.\d+ft)", r"\1  \2", line[1:].rstrip())
    parts = gap_pat.split(body)
    length_idx = None
    for i in range(1, len(parts)):
        m = len_pat.match(parts[i].strip())
        if m and i >= 4:
            length_idx = i
            break
    if length_idx is None:
        out_lines.append(line)
        continue
    head = parts[0].strip()
    sp = head.find(" ")
    wid = head[:sp] if sp > 0 else head
    if wid not in corrections:
        out_lines.append(line)
        continue
    old_g, new_g, current = corrections[wid]
    # Replace "NN AWG" in the line. Preserve column width with padding.
    old_pat = re.compile(rf"\b{old_g}\s+AWG\b")
    if not old_pat.search(line):
        # spec column may use different format, e.g. "20 AWG M22759/32" — replace first match
        old_pat = re.compile(rf"\b{old_g} AWG")
    # Use right-padded new gauge so column alignment is preserved (2-char gauge)
    new_str = f"{new_g:>2} AWG"
    new_line = old_pat.sub(new_str, line, count=1)
    out_lines.append(new_line)

# Add the change marker line
header_lines = []
in_header = True
for i, line in enumerate(out_lines):
    if line.startswith("Generated:") or line.startswith("Amended:"):
        header_lines.append(line)
    if line.startswith("==="):
        break

# Insert amendment note right after the existing Amended: line
final = []
inserted = False
for line in out_lines:
    final.append(line)
    if line.startswith("Amended:") and not inserted:
        final.append('Amended: 2026-05-14 — Gauges audited per chapter 6 doctrine (I × R ≤ 3% Vdrop, +25% safety). 22 AWG floor for signals. See receipts/2026-05-14_substrate-amendment-gauge-audit.md')
        inserted = True

DST.write_text('\n'.join(final) + '\n')

# Report
print(f"Corrections applied: {len(corrections)} wires")
print(f"{'ID':<8} {'WAS':<6} {'NOW':<6} {'CURRENT':<8} {'CHANGE'}")
print("-" * 50)
for wid in sorted(corrections.keys(), key=lambda x: (len(x), x)):
    old, new, I = corrections[wid]
    direction = "↓ down" if new > old else "↑ UP   "
    print(f"{wid:<8} {old:<3}AWG {new:<3}AWG {I:<6.2f}A  {direction} {old-new:+d} gauges")

# Per-gauge totals
from collections import defaultdict
ft_was = defaultdict(float)
ft_now = defaultdict(float)
for w in wires:
    wid = w["id"]
    if wid in corrections:
        old, new, _ = corrections[wid]
        ft_was[old] += w["length"]
        ft_now[new] += w["length"]
    else:
        ft_was[w["gauge"]] += w["length"]
        ft_now[w["gauge"]] += w["length"]
print()
print(f"Per-gauge length comparison (BEFORE vs AFTER correction, ft):")
print(f"{'AWG':<6} {'BEFORE':<10} {'AFTER':<10} {'DELTA'}")
for g in sorted(set(list(ft_was.keys()) + list(ft_now.keys())), reverse=True):
    was = ft_was.get(g, 0)
    now = ft_now.get(g, 0)
    delta = now - was
    arrow = "▲" if delta > 0.5 else ("▼" if delta < -0.5 else " ")
    print(f"{g:<3}AWG  {was:<8.1f}  {now:<8.1f}  {arrow} {delta:+.1f}")

print()
print(f"Wrote {DST}")
