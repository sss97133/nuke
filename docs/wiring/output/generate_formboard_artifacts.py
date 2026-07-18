#!/usr/bin/env python3
"""
Parse K5_cut_list_v2.txt and emit:
  1. K5_wire_formboard_cuts.csv  - 123 rows with 15%/20% length pad
  2. K5_wire_neighbor_inventory_request.md - aggregated by (gauge, color)

Sources cited:
  - K5_cut_list_v2.txt (the 123 wires, requested colors, baseline lengths)
  - K5_wire_spec_and_costs.md (3-stripe remap table, Tefzel decision)
  - 15% pad standard, 20% on engine bay
"""
import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
CUT_LIST = ROOT / "K5_cut_list_v2.txt"
FORMBOARD_CSV = ROOT / "K5_wire_formboard_cuts.csv"
NEIGHBOR_MD = ROOT / "K5_wire_neighbor_inventory_request.md"

# 3-color stripe remap from K5_wire_spec_and_costs.md (M22759/32 only does 2-color)
STRIPE_REMAP = {
    "ORN/BLK/RED": "ORN/RED",
    "ORN/BLK/YEL": "ORN/YEL",
    "ORN/BLK/BLU": "ORN/BLU",
    "ORN/BLK/BLK": "ORN/BLK",
    "ORN/BLK/WHT": "ORN/BRN",
    "ORN/WHT/BLK": "WHT/ORN",
    "BLU/WHT/WHT": "BLU/WHT",
    "BLU/WHT/BLK": "BLU/BLK",
}

# Sections that should get 20% engine-bay pad (heat + redo risk)
ENGINE_BAY_SECTIONS = {"ENGINE LOOM"}

# Parse cut list: split each row on 2+ space gaps (the format's column separator)
wires = []
current_section = None
section_pat = re.compile(r">>\s+(.+?)\s+\(")
gap_pat = re.compile(r"\s{2,}")
len_pat = re.compile(r"^([\d.]+)ft$")

for line in CUT_LIST.read_text().splitlines():
    sec = section_pat.search(line)
    if sec:
        current_section = sec.group(1).strip()
        continue
    if not line.startswith("#") or line.startswith("# "):
        continue
    if line.startswith("#    LABEL"):
        continue
    # Format: #ID  LABEL  FROM  SPEC  COLOR  LENGTHft  NOTES (cols separated by 2+ spaces)
    # Some rows have only 1 space between COLOR and LENGTHft (when color is long 3-stripe).
    # Pre-process: separate "COLOR LENGTHft" jam by inserting 2-space gap if needed.
    body = line[1:].rstrip()
    body = re.sub(r"(\S)\s(\d+\.\d+ft)", r"\1  \2", body)
    parts = gap_pat.split(body)
    length = None
    length_idx = None
    for i in range(1, len(parts)):
        lm = len_pat.match(parts[i].strip())
        if lm:
            length = lm.group(1)
            length_idx = i
            break
    if length is None or length_idx < 4:
        continue
    # parts[0] may be "ID LABEL" jammed (3-digit IDs use 1-space sep).
    head = parts[0].strip()
    sp = head.find(" ")
    if sp > 0:
        wid, label_prefix = head[:sp], head[sp+1:].strip()
    else:
        wid, label_prefix = head, ""
    label_rest = " ".join(parts[1:length_idx - 3]).strip()
    label = (label_prefix + " " + label_rest).strip() if label_prefix else label_rest
    frm = parts[length_idx - 3].strip()
    spec = parts[length_idx - 2].strip()
    color = parts[length_idx - 1].strip()
    notes = " ".join(parts[length_idx + 1:]).strip() if length_idx + 1 < len(parts) else ""
    color_clean = STRIPE_REMAP.get(color, color)
    pad_pct = 0.20 if current_section in ENGINE_BAY_SECTIONS else 0.15
    base_len = float(length)
    padded_len = round(base_len * (1 + pad_pct) * 4) / 4  # round to 0.25 ft
    wires.append({
        "id": wid,
        "section": current_section,
        "label": label.strip(),
        "from": frm,
        "spec": spec.strip(),
        "requested_color": color,
        "available_color": color_clean,
        "remapped": "YES" if color != color_clean else "",
        "base_length_ft": base_len,
        "pad_pct": int(pad_pct * 100),
        "cut_length_ft": padded_len,
        "notes": notes.strip(),
    })

# Write form board CSV
with FORMBOARD_CSV.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=[
        "id", "section", "label", "from", "spec",
        "requested_color", "available_color", "remapped",
        "base_length_ft", "pad_pct", "cut_length_ft", "notes"
    ])
    w.writeheader()
    w.writerows(wires)

# Aggregate by (gauge, available_color) for neighbor inventory
def gauge_of(spec):
    m = re.match(r"(\d+)\s+AWG", spec)
    return f"{m.group(1)} AWG" if m else spec

agg = defaultdict(lambda: {"total_ft": 0, "wire_count": 0, "wire_ids": []})
for w in wires:
    g = gauge_of(w["spec"])
    key = (g, w["available_color"], w["spec"])
    agg[key]["total_ft"] += w["cut_length_ft"]
    agg[key]["wire_count"] += 1
    agg[key]["wire_ids"].append(w["id"])

# Group by gauge for the neighbor request
by_gauge = defaultdict(list)
for (g, color, spec), data in agg.items():
    by_gauge[(g, spec)].append((color, data))

with NEIGHBOR_MD.open("w") as f:
    f.write("# K5 Wire — Neighbor Inventory Request\n\n")
    f.write("**Purpose:** Check neighbor's stock against this list. Anything he has, we use. Anything he doesn't, we order from ProWire USA.\n\n")
    f.write("**Spec required:** M22759/32 Tefzel (12-22 AWG) or M22759/16 Tefzel (10-8 AWG). Tin-plated copper, ETFE insulation, 150°C, MIL-spec.\n\n")
    f.write("**Lengths include 15% pad (20% engine bay).** Round up to nearest 5 ft.\n\n")
    f.write("---\n\n")

    total_lines = 0
    grand_total_ft = 0
    for (g, spec), rows in sorted(by_gauge.items(), key=lambda x: int(x[0][0].split()[0])):
        rows.sort(key=lambda r: -r[1]["total_ft"])
        gauge_total = sum(d["total_ft"] for _, d in rows)
        gauge_wires = sum(d["wire_count"] for _, d in rows)
        grand_total_ft += gauge_total
        total_lines += len(rows)
        f.write(f"## {g} ({spec}) — {gauge_total:.1f} ft total, {gauge_wires} wires\n\n")
        f.write("| Color | Wires | Ft needed | Round up |\n")
        f.write("|---|---|---|---|\n")
        for color, data in rows:
            ru = int((data["total_ft"] // 5 + 1) * 5)
            f.write(f"| {color} | {data['wire_count']} | {data['total_ft']:.1f} | {ru} ft |\n")
        f.write("\n")

    f.write("---\n\n")
    f.write(f"**Grand total: {grand_total_ft:.1f} ft across {total_lines} (gauge, color) combinations.**\n\n")
    f.write("## How to use this with your neighbor\n\n")
    f.write("1. Walk through each gauge section. Ask: \"Do you have any M22759/32 in [gauge]?\"\n")
    f.write("2. For each spool he has, note the color and approximate footage.\n")
    f.write("3. Mark this sheet: ✓ = neighbor has enough, ½ = partial, ✗ = need to order.\n")
    f.write("4. We re-run with his inventory subtracted; only the ✗ rows go on the ProWire order.\n\n")
    f.write("## Color remap notes\n\n")
    remapped = [w for w in wires if w["remapped"]]
    if remapped:
        f.write(f"{len(remapped)} wires had 3-color stripe codes (e.g. ORN/BLK/RED) that don't exist in M22759/32. Remapped to 2-color equivalents per K5_wire_spec_and_costs.md. Differentiation maintained via heat-shrink labels at both ends.\n\n")

print(f"Wrote {FORMBOARD_CSV}")
print(f"Wrote {NEIGHBOR_MD}")
print(f"{len(wires)} wires, {sum(w['cut_length_ft'] for w in wires):.1f} ft total (padded), {len(agg)} unique (gauge,color) SKUs")
