#!/usr/bin/env python3
"""
Ingest K5_cut_list_v2.txt into vehicle_observations as cited cell-level claims.

Each wire row in the cut list becomes N observations — one per wire-* property
(wire_circuit_id, wire_color_code, wire_gauge_awg, wire_specification,
 wire_length_in). The same wire_circuit_id ties the cells back together.

Citation:
- source_id   = observation_sources.slug='k5_cut_list_v2' (created idempotent)
- submitted_by_user_id = Skylar (shkylar@gmail.com)
- vehicle_id  = e08bf694 (1977 K5, VIN CKR187F127263; per K5_WIRING_STATE.md
                resolution on 2026-05-17)
- kind        = 'specification'
- rank        = 'normal'
- confidence  = 'high'
- structured_data carries the parsed cell + the verbatim cut-list row

Modes:
  dry-run (default): parse + print stats + sample first 3 SQL inserts to stdout
  --apply:           connect to DB, insert in 500-row batches with pg_sleep(0.05)

Why bootstrap-direct instead of via ingest-observation edge function:
  property_id is a brand-new column (added by PROPOSED_institution_minimum_
  substrate.sql today). The edge function hasn't been retrofitted to accept it.
  The DB-level citation trigger still guards every write, so the cited-data
  invariant holds.
  Follow-up: patch ingest-observation to pass property_id through.
"""
import os
import re
import sys
import json
import datetime
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CUT_LIST_PATH = REPO / "docs/wiring/output/K5_cut_list_v2.txt"

VEHICLE_ID = "e08bf694-970f-4cbe-8a74-8715158a0f2e"  # 1977 K5, VIN CKR187F127263
SKYLAR_USER_ID = "0b9f107a-d124-49de-9ded-94698f63c1c4"  # shkylar@gmail.com

PROPERTY_IDS = {
    "wire_circuit_id":     "da72995a-15f7-443c-a5ae-c98ff34e94dd",
    "wire_color_code":     "c2a3752a-307e-48a4-919d-473299a1a820",
    "wire_gauge_awg":      "d0b6c6f3-1003-4569-ab89-83c56a50e30c",
    "wire_length_in":      "97e1a643-85cd-41b0-b9d2-086d8543a051",
    "wire_specification":  "82d7779e-ebcf-4fbd-894d-04947934e6c9",
}

# Row parser: header column widths in K5_cut_list_v2.txt do NOT match the
# data row column widths (the renderer widened SPEC and COLOR by 6 chars
# each beyond the header). Rather than relying on offsets, we anchor on
# semantic landmarks: every well-formed row has a "<n> AWG <spec>" SPEC
# token and ends with a "<n>ft" or "<n>in" LENGTH token + optional notes.

ROW_RE = re.compile(
    r"^#(?P<id>\S+)"                                  # #4a
    r"\s+(?P<label>.+?)"                               # ETB TAC Motor 2
    r"\s{2,}(?P<from>\S(?:[^\n]*?\S)?)"               # M130:A01  (or "FLOOR DIMMER HI-OUT")
    r"\s{2,}(?P<spec>\d+\s+AWG(?:\s+[A-Z0-9/\-]+)?)"   # 18 AWG M22759/32
    r"\s+(?P<color>\S(?:[A-Z0-9/]| (?=[A-Z]))*?)"      # BRN  or  LT GRN/WHT/BLK
    r"\s+(?P<length>\d+\.?\d*(?:ft|in))"                # 4.6ft
    r"(?:\s+(?P<notes>.*?))?\s*$"
)

# Fallback for shielded-cable companion rows that lack their own spec/color/length
ROW_PARTIAL_RE = re.compile(
    r"^#(?P<id>\S+)\s+(?P<label>.+?)(?:\s{2,}(?P<rest>\S.*))?\s*$"
)


def parse_row(line: str):
    if not line.startswith("#"):
        return None
    if line.startswith("##"):  # comment line
        return None

    m = ROW_RE.match(line)
    if m:
        d = {k: (m.group(k) or "").strip() for k in ("id", "label", "from", "spec", "color", "length", "notes")}
        return d

    # Try partial — for companion rows with only id/label/rest
    m = ROW_PARTIAL_RE.match(line)
    if m:
        return {
            "id": m.group("id").strip(),
            "label": (m.group("label") or "").strip(),
            "from": (m.group("rest") or "").strip(),
            "spec": "",
            "color": "",
            "length": "",
            "notes": "",
            "_partial": True,
        }
    return None


def split_spec(spec: str):
    """'18 AWG M22759/32' -> ('18', 'M22759/32')
       '22 AWG'           -> ('22', None)
       'Marine 4 AWG'     -> ('4',  'Marine')"""
    if not spec:
        return None, None
    m = re.match(r"(\d+)\s+AWG\s+(\S+(?:/\S+)?)", spec)
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"(\d+)\s+AWG\s*$", spec)
    if m:
        return m.group(1), None
    m = re.match(r"(\S+)\s+(\d+)\s+AWG", spec)
    if m:
        return m.group(2), m.group(1)
    return None, None


def length_to_inches(s: str):
    if not s:
        return None
    m = re.match(r"(\d+\.?\d*)\s*ft", s)
    if m:
        return round(float(m.group(1)) * 12.0, 2)
    m = re.match(r"(\d+\.?\d*)\s*in", s)
    if m:
        return round(float(m.group(1)), 2)
    return None


def pg_quote(s):
    if s is None:
        return "NULL"
    if isinstance(s, (int, float)):
        return str(s)
    return "'" + str(s).replace("'", "''") + "'"


def pg_jsonb(d):
    return "'" + json.dumps(d, separators=(",", ":")).replace("'", "''") + "'::jsonb"


def build_rows():
    text = CUT_LIST_PATH.read_text()
    file_mtime = datetime.datetime.fromtimestamp(
        CUT_LIST_PATH.stat().st_mtime, tz=datetime.timezone.utc
    ).isoformat()

    wires = []
    current_loom = None
    for line in text.splitlines():
        if line.startswith(">>"):
            current_loom = line.lstrip(">").strip().split("(")[0].strip()
            continue
        f = parse_row(line)
        if f is None:
            continue
        f["loom"] = current_loom
        f["_raw_line"] = line.rstrip()
        wires.append(f)

    inserts = []
    skipped = []
    for f in wires:
        gauge, mil_spec = split_spec(f["spec"])
        length_in = length_to_inches(f["length"])

        cells = [("wire_circuit_id", f["id"])]
        if f["color"]:
            cells.append(("wire_color_code", f["color"]))
        if gauge:
            cells.append(("wire_gauge_awg", gauge))
        if mil_spec:
            cells.append(("wire_specification", mil_spec))
        if length_in is not None:
            cells.append(("wire_length_in", str(length_in)))

        for prop_key, value_str in cells:
            structured = {
                "wire_id": f["id"],
                "loom": f["loom"],
                "label": f["label"],
                "from_pin": f["from"],
                "color": f["color"],
                "spec_raw": f["spec"],
                "length_raw": f["length"],
                "notes": f["notes"],
                "property_key": prop_key,
                "value": value_str,
                "raw_cut_list_row": f["_raw_line"],
            }
            inserts.append({
                "property_key": prop_key,
                "property_id": PROPERTY_IDS[prop_key],
                "structured_data": structured,
                "content_text": f["_raw_line"][:500],
                "observed_at": file_mtime,
            })

        if not gauge and not f["spec"].strip() == "":
            skipped.append({"wire_id": f["id"], "reason": "unparsable_spec", "raw": f["spec"]})

    return wires, inserts, skipped


def insert_sql(row, source_id):
    cols = (
        "vehicle_id, kind, property_id, structured_data, source_id, "
        "submitted_by_user_id, observed_at, rank, confidence, "
        "confidence_score, content_text"
    )
    vals = (
        f"{pg_quote(VEHICLE_ID)}, "
        f"'specification'::observation_kind, "
        f"{pg_quote(row['property_id'])}, "
        f"{pg_jsonb(row['structured_data'])}, "
        f"{pg_quote(source_id)}, "
        f"{pg_quote(SKYLAR_USER_ID)}, "
        f"{pg_quote(row['observed_at'])}, "
        f"'normal'::vfc_rank, "
        f"'high'::confidence_level, "
        f"0.90, "
        f"{pg_quote(row['content_text'])}"
    )
    return f"INSERT INTO public.vehicle_observations ({cols}) VALUES ({vals});"


def ensure_source_sql():
    """Idempotent: returns SQL that registers the cut-list as a source and
    selects its id into a psql variable for the batch."""
    return """
INSERT INTO public.observation_sources
  (slug, display_name, category, base_trust_score, supported_observations, notes, tier)
VALUES
  ('k5_cut_list_v2',
   'K5 Cut List v2 (docs/wiring/output/K5_cut_list_v2.txt)',
   'documentation',
   0.95,
   ARRAY['specification']::observation_kind[],
   'Canonical K5 harness cut list. Each wire row maps to N observations (one per wire-* property).',
   1)
ON CONFLICT (slug) DO NOTHING;

\\gset
SELECT id AS source_id FROM public.observation_sources WHERE slug = 'k5_cut_list_v2' \\gset
"""


def apply(rows):
    pgpass = os.environ.get("PGPASSWORD")
    if not pgpass:
        sys.exit("ERROR: PGPASSWORD env var required for --apply")
    base_cmd = [
        "psql",
        "-h", "aws-0-us-west-1.pooler.supabase.com",
        "-p", "6543",
        "-U", "postgres.qkgaybvrernstplzjaam",
        "-d", "postgres",
        "-v", "ON_ERROR_STOP=1",
    ]

    # 1) Register the source (or fetch existing id)
    # Upsert source, then SELECT id (psql emits INSERT status alongside RETURNING)
    subprocess.run(
        base_cmd + ["-c",
                    "INSERT INTO public.observation_sources (slug, display_name, category, base_trust_score, supported_observations, notes, tier) "
                    "VALUES ('k5_cut_list_v2', 'K5 Cut List v2 (docs/wiring/output/K5_cut_list_v2.txt)', 'documentation', 0.95, ARRAY['specification']::observation_kind[], 'Canonical K5 harness cut list. Each row → N observations (one per wire-* property).', 1) "
                    "ON CONFLICT (slug) DO UPDATE SET updated_at = now();"],
        env={**os.environ, "PGPASSWORD": pgpass},
        capture_output=True, text=True, check=True,
    )
    src = subprocess.run(
        base_cmd + ["-t", "-A", "-c",
                    "SELECT id FROM public.observation_sources WHERE slug='k5_cut_list_v2';"],
        env={**os.environ, "PGPASSWORD": pgpass},
        capture_output=True, text=True, check=True,
    )
    source_id = src.stdout.strip()
    # Sanity-check it's a UUID
    if not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", source_id):
        sys.exit(f"ERROR: unexpected source_id format: {source_id!r}")
    print(f"observation_sources k5_cut_list_v2.id = {source_id}", file=sys.stderr)

    # 2) Insert in batches of 500 with pg_sleep(0.05) between batches.
    batch_size = 500
    total = len(rows)
    for i in range(0, total, batch_size):
        batch = rows[i:i + batch_size]
        sql = "BEGIN;\n" + "\n".join(insert_sql(r, source_id) for r in batch) + "\nCOMMIT;\nSELECT pg_sleep(0.05);\n"
        r = subprocess.run(
            base_cmd + ["-c", sql],
            env={**os.environ, "PGPASSWORD": pgpass},
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"BATCH FAILED at offset {i}:\n{r.stderr}", file=sys.stderr)
            sys.exit(1)
        print(f"  batch {i // batch_size + 1}: inserted {len(batch)} rows ({i + len(batch)}/{total})", file=sys.stderr)

    print(f"Inserted {total} cell-level observations under source_id={source_id}", file=sys.stderr)


def main():
    wires, rows, skipped = build_rows()
    print(f"Parsed {len(wires)} wires from {CUT_LIST_PATH}", file=sys.stderr)
    print(f"Generated {len(rows)} cell-level observations", file=sys.stderr)
    print(f"Skipped/flagged: {len(skipped)} (see stderr 'SKIPPED' lines)", file=sys.stderr)
    for s in skipped[:10]:
        print(f"  SKIPPED: {s}", file=sys.stderr)

    by_prop = {}
    for r in rows:
        by_prop[r["property_key"]] = by_prop.get(r["property_key"], 0) + 1
    print("\nPer-property counts:", file=sys.stderr)
    for k, v in sorted(by_prop.items()):
        print(f"  {k:24s} {v}", file=sys.stderr)

    if "--apply" in sys.argv:
        apply(rows)
    else:
        print("\n--- DRY-RUN: first 3 inserts (SQL) ---", file=sys.stderr)
        for r in rows[:3]:
            print(insert_sql(r, "<source_id resolved at apply time>"))
        print("\nRe-run with --apply to write to DB.", file=sys.stderr)


if __name__ == "__main__":
    main()
