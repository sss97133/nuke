#!/usr/bin/env python3
"""
Ingest wire-closure JSON receipts under docs/wiring/receipts/ → vehicle_observations.

The cut-list ingester (ingest_k5_cut_list_to_observations.py) covers the 5
cell-level wiring properties present in the cut list: wire_circuit_id,
wire_color_code, wire_gauge_awg, wire_length_in, wire_specification.

Closure receipts cover what the cut list does not: terminal PNs at the A and
B ends. Each receipt's `termination.from_terminal_pn` and
`termination.to_terminal_pn` are emitted as cited observations when a `.value`
is present. `{unknown: true, needs: ...}` shapes are skipped (they're
documented gaps, not claims).

Each observation:
  - vehicle_id = K5 e08bf694 (VIN CKR187F127263)
  - kind = 'specification'
  - property_id = wire_terminal_pn_a or wire_terminal_pn_b
  - source_id   = observation_sources.slug='k5_wire_closure_receipts'
                  (created idempotent; documentation tier)
  - submitted_by_user_id = Skylar
  - structured_data carries wire_id, value, citation, receipt path, etc.

Modes:
  dry-run (default): parse + report
  --apply: connect to DB, insert in batches

Same caveat as the cut-list ingester: bypasses ingest-observation edge
function because property_id support hasn't been added there yet. Citation
trigger on the DB still enforces every write.
"""
import os
import re
import sys
import json
import datetime
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RECEIPTS_DIR = REPO / "docs/wiring/receipts"

VEHICLE_ID = "e08bf694-970f-4cbe-8a74-8715158a0f2e"
SKYLAR_USER_ID = "0b9f107a-d124-49de-9ded-94698f63c1c4"

PROPERTY_IDS = {
    "wire_terminal_pn_a": "028d3bd3-5f65-4c1c-b7a6-495d07a86f00",
    "wire_terminal_pn_b": "0ff1b153-45eb-45e9-97ba-df6931443302",
}


def pg_quote(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def pg_jsonb(d):
    return "'" + json.dumps(d, separators=(",", ":")).replace("'", "''") + "'::jsonb"


def extract_cells(receipt: dict, receipt_path: str):
    wire_id = receipt.get("wire_id")
    label = receipt.get("label")
    loom = receipt.get("loom")
    term = receipt.get("termination", {}) or {}

    cells = []
    for side_key, prop_key in [
        ("from_terminal_pn", "wire_terminal_pn_a"),
        ("to_terminal_pn",   "wire_terminal_pn_b"),
    ]:
        cell = term.get(side_key)
        if not isinstance(cell, dict):
            continue
        if "value" not in cell:
            # {unknown: true, needs: ...} — not a claim
            continue
        cells.append({
            "property_key": prop_key,
            "property_id": PROPERTY_IDS[prop_key],
            "value": cell["value"],
            "citation": cell.get("source"),
            "wire_id": wire_id,
            "label": label,
            "loom": loom,
            "receipt_path": receipt_path,
        })
    return cells


def insert_sql(cell, source_id, observed_at):
    structured = {
        "wire_id": cell["wire_id"],
        "loom": cell["loom"],
        "label": cell["label"],
        "property_key": cell["property_key"],
        "value": cell["value"],
        "citation": cell["citation"],
        "receipt_path": cell["receipt_path"],
    }
    content = f"{cell['receipt_path']} :: {cell['property_key']} = {cell['value']} ({cell['citation']})"
    cols = (
        "vehicle_id, kind, property_id, structured_data, source_id, "
        "submitted_by_user_id, observed_at, rank, confidence, "
        "confidence_score, content_text"
    )
    vals = (
        f"{pg_quote(VEHICLE_ID)}, "
        f"'specification'::observation_kind, "
        f"{pg_quote(cell['property_id'])}, "
        f"{pg_jsonb(structured)}, "
        f"{pg_quote(source_id)}, "
        f"{pg_quote(SKYLAR_USER_ID)}, "
        f"{pg_quote(observed_at)}, "
        f"'normal'::vfc_rank, "
        f"'high'::confidence_level, "
        f"0.95, "
        f"{pg_quote(content[:500])}"
    )
    return f"INSERT INTO public.vehicle_observations ({cols}) VALUES ({vals});"


def build_cells():
    paths = sorted(RECEIPTS_DIR.glob("*-closure.json"))
    all_cells = []
    receipts_seen = 0
    for path in paths:
        try:
            d = json.loads(path.read_text())
        except Exception as e:
            print(f"  PARSE FAIL: {path.name}: {e}", file=sys.stderr)
            continue
        receipts_seen += 1
        rel = str(path.relative_to(REPO))
        for cell in extract_cells(d, rel):
            cell["_observed_at"] = datetime.datetime.fromtimestamp(
                path.stat().st_mtime, tz=datetime.timezone.utc
            ).isoformat()
            all_cells.append(cell)
    return receipts_seen, all_cells


def apply(cells):
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

    # Upsert source
    subprocess.run(
        base_cmd + ["-c",
            "INSERT INTO public.observation_sources "
            "(slug, display_name, category, base_trust_score, supported_observations, notes, tier) "
            "VALUES ('k5_wire_closure_receipts', "
            "'K5 wire-closure JSON receipts (docs/wiring/receipts/*-closure.json)', "
            "'documentation', 0.95, "
            "ARRAY['specification']::observation_kind[], "
            "'Hand-authored per-wire closure receipts validating against wire-closure.schema.json. Each receipt covers one wire end-to-end with cited or explicitly-unknown fields.', "
            "1) "
            "ON CONFLICT (slug) DO UPDATE SET updated_at = now();"],
        env={**os.environ, "PGPASSWORD": pgpass},
        capture_output=True, text=True, check=True,
    )
    src = subprocess.run(
        base_cmd + ["-t", "-A", "-c",
            "SELECT id FROM public.observation_sources WHERE slug='k5_wire_closure_receipts';"],
        env={**os.environ, "PGPASSWORD": pgpass},
        capture_output=True, text=True, check=True,
    )
    source_id = src.stdout.strip()
    if not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", source_id):
        sys.exit(f"ERROR: unexpected source_id: {source_id!r}")
    print(f"observation_sources k5_wire_closure_receipts.id = {source_id}", file=sys.stderr)

    # Insert
    sql_lines = "\n".join(insert_sql(c, source_id, c["_observed_at"]) for c in cells)
    sql = f"BEGIN;\n{sql_lines}\nCOMMIT;\n"
    r = subprocess.run(
        base_cmd + ["-c", sql],
        env={**os.environ, "PGPASSWORD": pgpass},
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"INSERT FAILED:\n{r.stderr}", file=sys.stderr)
        sys.exit(1)
    print(f"Inserted {len(cells)} terminal-PN observations under source_id={source_id}", file=sys.stderr)


def main():
    n_receipts, cells = build_cells()
    print(f"Parsed {n_receipts} closure receipts", file=sys.stderr)
    print(f"Extracted {len(cells)} terminal-PN cells", file=sys.stderr)
    by_prop = {}
    for c in cells:
        by_prop[c["property_key"]] = by_prop.get(c["property_key"], 0) + 1
    for k, v in sorted(by_prop.items()):
        print(f"  {k:24s} {v}", file=sys.stderr)

    by_wire = sorted({c["wire_id"] for c in cells})
    print(f"Wires covered: {by_wire}", file=sys.stderr)

    if "--apply" in sys.argv:
        apply(cells)
    else:
        print("\n--- DRY-RUN: first 3 inserts (SQL) ---", file=sys.stderr)
        for c in cells[:3]:
            print(insert_sql(c, "<source_id resolved at apply time>", c["_observed_at"]))
        print("\nRe-run with --apply to write to DB.", file=sys.stderr)


if __name__ == "__main__":
    main()
