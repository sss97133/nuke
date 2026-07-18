#!/usr/bin/env python3
"""Ingest K5_wire_labels.md → vehicle_observations.wire_label_a/b_text.

Parses every `| #X | gauge | color | near | far | notes |` row from the file.
near = M130/PDM30 end = end B; far = device end = end A.
"""
import os, re, sys, subprocess, json
from pathlib import Path

REPO = Path("/Users/skylar/nuke")
MD = REPO / "docs/wiring/output/K5_wire_labels.md"

VEHICLE_ID = "e08bf694-970f-4cbe-8a74-8715158a0f2e"
SKYLAR = "0b9f107a-d124-49de-9ded-94698f63c1c4"

ROW_RE = re.compile(
    r"^\|\s*#(?P<wid>[A-Za-z0-9_]+)\s*"
    r"\|\s*(?P<gauge>[^|]+?)\s*"
    r"\|\s*(?P<color>[^|]+?)\s*"
    r"\|\s*(?P<near>[^|]+?)\s*"
    r"\|\s*(?P<far>[^|]+?)\s*"
    r"\|\s*(?P<notes>[^|]*?)\s*\|\s*$"
)


def pg_q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"


def pg_j(d):
    return "'" + json.dumps(d, separators=(",", ":")).replace("'", "''") + "'::jsonb"


def main():
    text = MD.read_text()
    section = None
    rows = []
    for line in text.splitlines():
        if line.startswith("##"):
            section = line.lstrip("# ").strip()
            continue
        if "---" in line:
            continue
        m = ROW_RE.match(line)
        if not m:
            continue
        # Skip the header row
        if m.group("wid").lower() == "wire":
            continue
        rows.append({
            "wire_id": m.group("wid"),
            "section": section,
            "gauge": m.group("gauge").strip(),
            "color": m.group("color").strip(),
            "near_label_b": m.group("near").strip(),
            "far_label_a": m.group("far").strip(),
            "notes": m.group("notes").strip(),
        })
    print(f"Parsed {len(rows)} label rows from {MD.name}", file=sys.stderr)

    pgpass = os.environ.get("PGPASSWORD")
    if not pgpass:
        sys.exit("PGPASSWORD required")
    base = ["psql", "-h", "aws-0-us-west-1.pooler.supabase.com", "-p", "6543",
            "-U", "postgres.qkgaybvrernstplzjaam", "-d", "postgres",
            "-v", "ON_ERROR_STOP=1"]

    # Register source
    subprocess.run(base + ["-c",
        "INSERT INTO public.observation_sources (slug, display_name, category, base_trust_score, supported_observations, notes, tier) "
        "VALUES ('k5_wire_labels_md', 'K5 Wire Label Schedule (docs/wiring/output/K5_wire_labels.md)', 'documentation', 0.92, "
        "ARRAY['specification']::observation_kind[], "
        "'Skylar-authored per-wire label spec. Near-end = ECU/PDM (end B), Far-end = device (end A). Generated 2026-04-04.', 1) "
        "ON CONFLICT (slug) DO UPDATE SET updated_at = now();"],
        env={**os.environ, "PGPASSWORD": pgpass}, capture_output=True, text=True, check=True)

    src = subprocess.run(base + ["-t","-A","-c","SELECT id FROM public.observation_sources WHERE slug='k5_wire_labels_md';"],
        env={**os.environ, "PGPASSWORD": pgpass}, capture_output=True, text=True, check=True)
    source_id = src.stdout.strip()
    print(f"source_id={source_id}", file=sys.stderr)

    prop_a = subprocess.run(base + ["-t","-A","-c","SELECT id FROM public.observation_properties WHERE property_key='wire_label_a_text';"],
        env={**os.environ, "PGPASSWORD": pgpass}, capture_output=True, text=True, check=True).stdout.strip()
    prop_b = subprocess.run(base + ["-t","-A","-c","SELECT id FROM public.observation_properties WHERE property_key='wire_label_b_text';"],
        env={**os.environ, "PGPASSWORD": pgpass}, capture_output=True, text=True, check=True).stdout.strip()

    cols = "vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text"
    sql_lines = []
    skipped_existing = 0
    for r in rows:
        # Skip wires that already have receipts-sourced label observations (109, 110)
        if r["wire_id"] in ("109", "110"):
            skipped_existing += 2
            continue
        for end, prop_id, val in (("A", prop_a, r["far_label_a"]),
                                  ("B", prop_b, r["near_label_b"])):
            sd = {
                "wire_id": r["wire_id"],
                "loom": r["section"],
                "end": end,
                "property_key": f"wire_label_{'a' if end=='A' else 'b'}_text",
                "value": val,
                "citation": f"docs/wiring/output/K5_wire_labels.md ({r['section']})",
            }
            content = f"#{r['wire_id']} wire_label_{end.lower()}_text={val}"
            vals = (
                f"{pg_q(VEHICLE_ID)}, 'specification'::observation_kind, "
                f"{pg_q(prop_id)}, {pg_j(sd)}, "
                f"{pg_q(source_id)}, {pg_q(SKYLAR)}, now(), "
                f"'normal'::vfc_rank, 'high'::confidence_level, 0.92, "
                f"{pg_q(content[:500])}"
            )
            sql_lines.append(f"INSERT INTO public.vehicle_observations ({cols}) VALUES ({vals});")
    print(f"Generated {len(sql_lines)} label inserts (skipped {skipped_existing} already-cited from receipts)", file=sys.stderr)

    sql = "BEGIN;\nSET LOCAL statement_timeout='120s';\n" + "\n".join(sql_lines) + "\nCOMMIT;\n"
    r = subprocess.run(base + ["-c", sql], env={**os.environ, "PGPASSWORD": pgpass},
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAILED:\n{r.stderr[:2000]}", file=sys.stderr)
        sys.exit(1)
    print(f"Inserted {len(sql_lines)} label observations.", file=sys.stderr)


if __name__ == "__main__":
    main()
