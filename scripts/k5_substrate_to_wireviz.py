#!/usr/bin/env python3
"""
Generate WireViz YAML for a K5 loom FROM SUBSTRATE (vehicle_canonical view),
NOT from K5_cut_list_v2.txt.

This is the inversion. The cut list text file becomes a historical artifact.
The DB is the source of truth. Re-running this script will pick up any new
cited observations automatically.

Output:
  docs/wiring/output/K5_<loom_slug>_FROM_SUBSTRATE.yaml

Usage:
  PGPASSWORD=... python3 scripts/k5_substrate_to_wireviz.py "ENGINE LOOM"
  PGPASSWORD=... python3 scripts/k5_substrate_to_wireviz.py    # all looms

Scope of this MVP:
  - Queries vehicle_canonical for K5 wiring cells of the requested loom
  - Pivots cells back into per-wire records
  - Emits a minimal WireViz YAML (metadata + connectors + cables)
  - Skips connection-list generation (needs from_pin → connector mapping
    code that already lives in docs/wiring/output/generate_wireviz_yaml.py;
    next pass refactors that to take per-wire dicts instead of reading text)

Proof-of-life metric: the wire count from substrate matches the cut list.
"""
import os
import re
import sys
import subprocess
from pathlib import Path
from collections import defaultdict

REPO = Path(__file__).resolve().parent.parent
VEHICLE_ID = "e08bf694-970f-4cbe-8a74-8715158a0f2e"
OUT_DIR = REPO / "docs/wiring/output"

# IEC 60757 color mapping (matches the existing generator)
COLOR_MAP = {
    "BLK": "BK", "BRN": "BN", "RED": "RD", "ORG": "OG", "ORN": "OG", "YEL": "YE",
    "GRN": "GN", "BLU": "BU", "VIO": "VT", "PPL": "VT", "GRY": "GY", "WHT": "WH",
    "TAN": "BN", "PNK": "PK",
    "DK BLU": "BU", "LT BLU": "BU", "DK GRN": "GN", "LT GRN": "GN",
}


def iec(color):
    if not color:
        return "WH"
    parts = [p.strip() for p in color.split("/")]
    return "".join(COLOR_MAP.get(p, p[:2].upper()) for p in parts) or "WH"


def safe_id(s):
    s = re.sub(r"[^a-zA-Z0-9_]", "_", s or "X")
    return re.sub(r"_+", "_", s).strip("_") or "X"


def slugify_loom(s):
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s.strip().lower())
    return s.strip("_") or "unknown"


def psql(sql: str) -> str:
    pgpass = os.environ.get("PGPASSWORD")
    if not pgpass:
        sys.exit("ERROR: PGPASSWORD required")
    cmd = [
        "psql",
        "-h", "aws-0-us-west-1.pooler.supabase.com",
        "-p", "6543",
        "-U", "postgres.qkgaybvrernstplzjaam",
        "-d", "postgres",
        "-t", "-A", "-F", "\t",
        "-c", sql,
    ]
    r = subprocess.run(cmd, env={**os.environ, "PGPASSWORD": pgpass},
                       capture_output=True, text=True, check=True)
    return r.stdout.strip()


def list_looms():
    out = psql(f"""
        SELECT DISTINCT vc.structured_data->>'loom' AS loom
        FROM public.vehicle_canonical vc
        JOIN public.observation_properties op ON op.id = vc.property_id
        WHERE vc.vehicle_id = '{VEHICLE_ID}'
          AND op.category = 'wiring'
          AND vc.structured_data->>'loom' IS NOT NULL
        ORDER BY 1
    """)
    return [line for line in out.splitlines() if line.strip()]


def fetch_loom_wires(loom: str):
    sql = f"""
        SELECT
          vc.structured_data->>'wire_id'   AS wire_id,
          vc.structured_data->>'label'     AS label,
          vc.structured_data->>'from_pin'  AS from_pin,
          vc.structured_data->>'notes'     AS notes,
          op.property_key                  AS property_key,
          vc.structured_data->>'value'     AS value,
          os.slug                          AS source
        FROM public.vehicle_canonical vc
        JOIN public.observation_properties op ON op.id = vc.property_id
        JOIN public.observation_sources os ON os.id = vc.source_id
        WHERE vc.vehicle_id = '{VEHICLE_ID}'
          AND op.category = 'wiring'
          AND vc.structured_data->>'loom' = '{loom.replace("'", "''")}'
        ORDER BY vc.structured_data->>'wire_id', op.property_key
    """
    out = psql(sql)
    wires = defaultdict(lambda: {"sources": set()})
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        # Pad to 7 in case any field is empty (psql still emits empty cols)
        while len(parts) < 7:
            parts.append("")
        wid, label, from_pin, notes, prop, value, source = parts[:7]
        if not wid:
            continue
        w = wires[wid]
        w["wire_id"] = wid
        w.setdefault("label", label)
        w.setdefault("from_pin", from_pin)
        w.setdefault("notes", notes)
        w[prop] = value
        w["sources"].add(source)
    return wires


def emit_yaml(loom: str, wires: dict) -> str:
    def wire_sort_key(w):
        m = re.match(r"(\d+)([a-z]*)", w)
        return (int(m.group(1)) if m else 0, m.group(2) if m else w)

    out = []
    out.append(f"# Generated from vehicle_canonical — substrate-driven, not file-driven.")
    out.append(f"# Vehicle: {VEHICLE_ID}")
    out.append(f"# Loom: {loom}")
    out.append(f"# Wires projected: {len(wires)}")
    out.append("")
    out.append("metadata:")
    out.append(f"  title: K5 {loom}")
    out.append(f"  description: |")
    out.append(f"    Projection of {len(wires)} wires from public.vehicle_canonical for")
    out.append(f"    vehicle_id={VEHICLE_ID}. Source of truth is the DB; this YAML")
    out.append(f"    is regenerated on demand. Cite-by-cell provenance retained in")
    out.append(f"    structured_data on each underlying observation row.")
    out.append("")
    out.append("connectors:")
    out.append("  M130_A:  {type: MoTeC Superseal Connector A (34-pin), pincount: 34}")
    out.append("  M130_B:  {type: MoTeC Superseal Connector B (26-pin), pincount: 26}")
    out.append("  PDM30_A: {type: MoTeC Superseal Connector A (34-pin), pincount: 34}")
    out.append("  PDM30_B: {type: MoTeC Superseal Connector B (26-pin), pincount: 26}")
    out.append("")
    out.append("cables:")
    for wid in sorted(wires.keys(), key=wire_sort_key):
        w = wires[wid]
        cid = "W" + safe_id(wid)
        gauge = w.get("wire_gauge_awg")
        color = w.get("wire_color_code")
        length_in = w.get("wire_length_in")
        spec = w.get("wire_specification")
        term_a = w.get("wire_terminal_pn_a")
        term_b = w.get("wire_terminal_pn_b")

        out.append(f"  {cid}:")
        if gauge:
            out.append(f"    gauge: {gauge} AWG")
        else:
            out.append(f"    # gauge: substrate gap")
        if length_in:
            try:
                length_ft = round(float(length_in) / 12.0, 2)
                out.append(f"    length: {length_ft}")
                out.append(f"    length_unit: ft")
            except ValueError:
                out.append(f"    # length: unparsable ({length_in})")
        if color:
            out.append(f"    colors: [{iec(color)}]")
        if spec:
            out.append(f"    type: {spec}")
        notes_bits = [w.get("label", ""), f"from {w.get('from_pin', '')}"]
        if term_a:
            notes_bits.append(f"term_a={term_a}")
        if term_b:
            notes_bits.append(f"term_b={term_b}")
        notes_bits.append("sources=" + ",".join(sorted(w["sources"])))
        notes = " | ".join(b for b in notes_bits if b)
        out.append(f"    notes: \"{notes}\"")
    out.append("")
    out.append("# Connection list intentionally omitted in this MVP — needs the")
    out.append("# from_pin → connector pin mapping logic that lives in")
    out.append("# docs/wiring/output/generate_wireviz_yaml.py. Next pass: refactor")
    out.append("# that generator to consume the per-wire dicts produced above.")
    return "\n".join(out) + "\n"


def main():
    if len(sys.argv) > 1:
        looms = [sys.argv[1]]
    else:
        looms = list_looms()
        print(f"Found {len(looms)} looms in substrate:", file=sys.stderr)
        for l in looms:
            print(f"  - {l}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    grand_total = 0
    for loom in looms:
        wires = fetch_loom_wires(loom)
        if not wires:
            print(f"  {loom}: 0 wires — skipping", file=sys.stderr)
            continue
        yaml_text = emit_yaml(loom, wires)
        out_path = OUT_DIR / f"K5_{slugify_loom(loom)}_FROM_SUBSTRATE.yaml"
        out_path.write_text(yaml_text)
        print(f"  {loom}: {len(wires)} wires → {out_path.relative_to(REPO)}", file=sys.stderr)
        grand_total += len(wires)

    print(f"\nTotal: {grand_total} wires across {len(looms)} looms emitted from substrate.", file=sys.stderr)


if __name__ == "__main__":
    main()
