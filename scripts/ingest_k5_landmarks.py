#!/usr/bin/env python3
"""Ingest K5_wire_paths.yaml → vehicle_observations.wire_landmark_traversal.

One observation per (wire_id, sequence, landmark_id). Each carries:
  structured_data.wire_id        = the cut-list ID
  structured_data.sequence       = 0-indexed position along the path
  structured_data.traversal_key  = '<wire_id>_<sequence>' (the discriminator)
  structured_data.value          = the landmark ID (e.g. "L01")
  structured_data.flags          = any path-level flags (shielded, door_crossing)
"""
import os, subprocess, sys, re
from pathlib import Path

# Lightweight YAML parsing — the file is regular enough we don't need pyyaml.
# Format: "<wire_id>": {label: "...", gauge: N, path: [L##, L##, ...]} optional flags: [...]
WIRE_LINE_RE = re.compile(
    r'^\s*"?(?P<wid>[A-Za-z0-9_]+)"?\s*:\s*\{(?P<body>.+)\}\s*$'
)

REPO = Path(__file__).resolve().parent.parent if __file__.startswith("/Users") else Path("/Users/skylar/nuke")
YAML_PATH = REPO / "docs/wiring/output/K5_wire_paths.yaml"

VEHICLE_ID = "e08bf694-970f-4cbe-8a74-8715158a0f2e"
SKYLAR_USER_ID = "0b9f107a-d124-49de-9ded-94698f63c1c4"


def parse_yaml_lines():
    wires = {}
    for line in YAML_PATH.read_text().splitlines():
        m = WIRE_LINE_RE.match(line)
        if not m:
            continue
        wid = m.group("wid")
        body = m.group("body")
        # Extract path list
        path_m = re.search(r"path:\s*\[([^\]]*)\]", body)
        if not path_m:
            continue
        path_str = path_m.group(1)
        landmarks = [t.strip() for t in path_str.split(",") if t.strip()]
        # Extract label
        label_m = re.search(r'label:\s*"([^"]*)"', body)
        label = label_m.group(1) if label_m else None
        # Extract flags
        flags_m = re.search(r"flags:\s*\[([^\]]*)\]", body)
        flags = []
        if flags_m:
            flags = [t.strip() for t in flags_m.group(1).split(",") if t.strip()]
        wires[wid] = {"label": label, "path": landmarks, "flags": flags}
    return wires


def pg_quote(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def pg_jsonb(d):
    import json
    return "'" + json.dumps(d, separators=(",", ":")).replace("'", "''") + "'::jsonb"


def main():
    wires = parse_yaml_lines()
    print(f"Parsed {len(wires)} wires from {YAML_PATH.name}", file=sys.stderr)

    inserts = []
    for wid, w in wires.items():
        for seq, lm in enumerate(w["path"]):
            inserts.append({
                "wire_id": wid,
                "label": w["label"],
                "sequence": seq,
                "traversal_key": f"{wid}_{seq}",
                "landmark_id": lm,
                "flags": w["flags"],
            })

    print(f"Generated {len(inserts)} traversal observations across {len(wires)} wires", file=sys.stderr)

    pgpass = os.environ.get("PGPASSWORD")
    if not pgpass:
        sys.exit("ERROR: PGPASSWORD required")
    base_cmd = [
        "psql", "-h", "aws-0-us-west-1.pooler.supabase.com", "-p", "6543",
        "-U", "postgres.qkgaybvrernstplzjaam", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1",
    ]

    # 1) Register source
    subprocess.run(base_cmd + ["-c",
        "INSERT INTO public.observation_sources (slug, display_name, category, base_trust_score, supported_observations, notes, tier) "
        "VALUES ('k5_wire_paths_yaml', 'K5 Wire Routing Paths (docs/wiring/output/K5_wire_paths.yaml)', 'documentation', 0.90, "
        "ARRAY['specification']::observation_kind[], "
        "'Per-wire landmark-traversal sequences derived from K5_measurement_worksheet.md routing notes (2026-04-04).', 1) "
        "ON CONFLICT (slug) DO UPDATE SET updated_at = now();"],
        env={**os.environ, "PGPASSWORD": pgpass}, capture_output=True, text=True, check=True)

    src = subprocess.run(base_cmd + ["-t","-A","-c",
        "SELECT id FROM public.observation_sources WHERE slug='k5_wire_paths_yaml';"],
        env={**os.environ, "PGPASSWORD": pgpass}, capture_output=True, text=True, check=True)
    source_id = src.stdout.strip()
    print(f"source_id = {source_id}", file=sys.stderr)

    prop = subprocess.run(base_cmd + ["-t","-A","-c",
        "SELECT id FROM public.observation_properties WHERE property_key='wire_landmark_traversal';"],
        env={**os.environ, "PGPASSWORD": pgpass}, capture_output=True, text=True, check=True)
    property_id = prop.stdout.strip()
    print(f"property_id = {property_id}", file=sys.stderr)

    # 2) Insert in one transaction (no NOT EXISTS — this property is new)
    sql_lines = []
    for r in inserts:
        structured = {
            "wire_id": r["wire_id"],
            "sequence": r["sequence"],
            "traversal_key": r["traversal_key"],
            "value": r["landmark_id"],
            "label": r["label"],
            "flags": r["flags"],
            "property_key": "wire_landmark_traversal",
            "citation": "docs/wiring/output/K5_wire_paths.yaml",
        }
        content = f"#{r['wire_id']} seq {r['sequence']} → {r['landmark_id']} ({r['label']})"
        cols = "vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text"
        vals = (
            f"{pg_quote(VEHICLE_ID)}, 'specification'::observation_kind, "
            f"{pg_quote(property_id)}, {pg_jsonb(structured)}, "
            f"{pg_quote(source_id)}, {pg_quote(SKYLAR_USER_ID)}, "
            f"now(), 'normal'::vfc_rank, 'high'::confidence_level, 0.85, "
            f"{pg_quote(content[:500])}"
        )
        sql_lines.append(f"INSERT INTO public.vehicle_observations ({cols}) VALUES ({vals});")

    sql = "BEGIN;\nSET LOCAL statement_timeout='120s';\n" + "\n".join(sql_lines) + "\nCOMMIT;\n"
    r = subprocess.run(base_cmd + ["-c", sql],
        env={**os.environ, "PGPASSWORD": pgpass}, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"INSERT FAILED:\n{r.stderr[:2000]}", file=sys.stderr)
        sys.exit(1)
    print(f"Inserted {len(inserts)} traversal observations.", file=sys.stderr)


if __name__ == "__main__":
    main()
