#!/usr/bin/env python3
"""
nuke wire <id> — print everything the substrate knows about a wire, in a
form you can read at the bench.

This is the smallest end-to-end demonstration that the substrate produces
useful output, not just rows. Pulls from vehicle_canonical + observation
metadata + landmark estimates + library citations.

Usage:
  PGPASSWORD=... python3 scripts/nuke_wire.py 4a
  PGPASSWORD=... python3 scripts/nuke_wire.py 110
"""
import os
import sys
import subprocess
import json

VEHICLE_ID = "e08bf694-970f-4cbe-8a74-8715158a0f2e"  # K5 VIN CKR187F127263


def psql(sql):
    pgpass = os.environ.get("PGPASSWORD")
    if not pgpass:
        sys.exit("PGPASSWORD env var required")
    r = subprocess.run(
        ["psql", "-h", "aws-0-us-west-1.pooler.supabase.com", "-p", "6543",
         "-U", "postgres.qkgaybvrernstplzjaam", "-d", "postgres",
         "-t", "-A", "-F", "\t", "-c", sql],
        env={**os.environ, "PGPASSWORD": pgpass, "PGOPTIONS": "-c statement_timeout=60000"},
        capture_output=True, text=True
    )
    if r.returncode != 0:
        sys.exit(f"psql failed: {r.stderr}")
    return r.stdout.strip()


def all_wires_table(loom_filter=None):
    """Print a per-wire summary table across the K5."""
    where = f"AND vo.structured_data->>'loom' = '{loom_filter}'" if loom_filter else ""
    sql = f"""
WITH base AS (
  SELECT
    vo.structured_data->>'wire_id' AS wire_id,
    vo.structured_data->>'loom' AS loom,
    vo.structured_data->>'label' AS label,
    vo.structured_data->>'from_pin' AS from_pin
  FROM public.vehicle_observations vo
  JOIN public.observation_properties op ON op.id = vo.property_id
  WHERE vo.vehicle_id = '{VEHICLE_ID}' AND vo.is_superseded = false
    AND op.property_key = 'wire_circuit_id'
    {where}
),
gauge AS (
  SELECT structured_data->>'wire_id' AS wire_id, structured_data->>'value' AS v
  FROM public.vehicle_observations vo JOIN public.observation_properties op ON op.id = vo.property_id
  WHERE vo.vehicle_id = '{VEHICLE_ID}' AND vo.is_superseded = false AND op.property_key = 'wire_gauge_awg'
),
color AS (
  SELECT structured_data->>'wire_id' AS wire_id, structured_data->>'value' AS v
  FROM public.vehicle_observations vo JOIN public.observation_properties op ON op.id = vo.property_id
  WHERE vo.vehicle_id = '{VEHICLE_ID}' AND vo.is_superseded = false AND op.property_key = 'wire_color_code'
),
len AS (
  SELECT structured_data->>'wire_id' AS wire_id, structured_data->>'value' AS v
  FROM public.vehicle_observations vo JOIN public.observation_properties op ON op.id = vo.property_id
  WHERE vo.vehicle_id = '{VEHICLE_ID}' AND vo.is_superseded = false AND op.property_key = 'wire_length_in'
),
term_b AS (
  SELECT structured_data->>'wire_id' AS wire_id, substring(structured_data->>'value', 1, 18) AS v
  FROM public.vehicle_observations vo JOIN public.observation_properties op ON op.id = vo.property_id
  WHERE vo.vehicle_id = '{VEHICLE_ID}' AND vo.is_superseded = false AND op.property_key = 'wire_terminal_pn_b'
)
SELECT b.wire_id, b.loom, b.label, b.from_pin,
       COALESCE(g.v, '?') AS gauge, COALESCE(c.v, '?') AS color,
       COALESCE(l.v, '?') AS len_in, COALESCE(t.v, '?') AS terminal_b
FROM base b
LEFT JOIN gauge g ON g.wire_id = b.wire_id
LEFT JOIN color c ON c.wire_id = b.wire_id
LEFT JOIN len l ON l.wire_id = b.wire_id
LEFT JOIN term_b t ON t.wire_id = b.wire_id
ORDER BY b.loom,
         NULLIF(regexp_replace(b.wire_id, '\\D', '', 'g'), '')::int NULLS LAST,
         b.wire_id
"""
    out = psql(sql)
    if not out:
        print("No wires found.")
        return

    rows = [line.split("\t") for line in out.splitlines() if line.strip()]
    print()
    print("=" * 105)
    print(f"  K5 BUILD SHEET — {len(rows)} wires" + (f" — {loom_filter}" if loom_filter else ""))
    print("=" * 105)
    cur_loom = None
    for r in rows:
        wid, loom, label, from_pin, gauge, color, length, term_b = r[:8]
        if loom != cur_loom:
            print()
            print(f"  >> {loom}")
            print(f"  {'#':<6}{'LABEL':<30}{'ECU PIN':<14}{'GA':<4}{'COLOR':<12}{'LEN':<8}{'TERM-B':<20}")
            print(f"  {'─'*6}{'─'*30}{'─'*14}{'─'*4}{'─'*12}{'─'*8}{'─'*20}")
            cur_loom = loom
        label_short = (label[:28] + '..') if label and len(label) > 28 else (label or '?')
        from_pin_short = (from_pin[:12] + '..') if from_pin and len(from_pin) > 12 else (from_pin or '?')
        length_disp = f"{float(length):.1f}in" if length and length not in ('?', '') and length.replace('.','').isdigit() else length
        print(f"  #{wid:<5}{label_short:<30}{from_pin_short:<14}{gauge:<4}{color:<12}{length_disp:<8}{term_b:<20}")
    print()
    print(f"  Total: {len(rows)} wires")
    print()


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: nuke_wire.py <wire_id>  (e.g. 4a, 110, 24)\n"
                 "       nuke_wire.py all                — full K5 wire table\n"
                 "       nuke_wire.py all <LOOM_NAME>    — filter by loom")
    if sys.argv[1] == "all":
        loom = sys.argv[2] if len(sys.argv) > 2 else None
        all_wires_table(loom)
        return
    wid = sys.argv[1]

    # All cells for this wire from vehicle_canonical (one query)
    sql = f"""
SELECT
  op.property_key,
  vo.structured_data->>'value' AS value,
  vo.confidence::text AS conf,
  vo.confidence_score::text AS score,
  os.slug AS source,
  vo.structured_data->>'citation' AS citation,
  vo.structured_data->>'loom' AS loom,
  vo.structured_data->>'label' AS label,
  vo.structured_data->>'from_pin' AS from_pin,
  vo.structured_data->>'reasoning' AS reasoning
FROM public.vehicle_observations vo
JOIN public.observation_properties op ON op.id = vo.property_id
JOIN public.observation_sources os ON os.id = vo.source_id
WHERE vo.vehicle_id = '{VEHICLE_ID}'
  AND vo.is_superseded = false
  AND op.category = 'wiring'
  AND vo.structured_data->>'wire_id' = '{wid}'
ORDER BY op.property_key, vo.structured_data->>'end' NULLS FIRST
"""
    out = psql(sql)
    if not out:
        sys.exit(f"No cells found for wire #{wid} on K5 e08bf694.")

    rows = [line.split("\t") for line in out.splitlines() if line.strip()]

    # Pull out the wire's identity (first row has loom/label/from_pin)
    loom = next((r[6] for r in rows if r[6]), "?")
    label = next((r[7] for r in rows if r[7]), "?")
    from_pin = next((r[8] for r in rows if r[8]), "?")

    # Group cells by property family
    cells_by_prop = {}
    for r in rows:
        prop = r[0]
        cells_by_prop.setdefault(prop, []).append({
            "value": r[1], "conf": r[2], "score": r[3], "source": r[4],
            "citation": r[5], "reasoning": r[9] if len(r) > 9 else "",
        })

    # Format card
    print()
    print("=" * 78)
    print(f"   K5 WIRE #{wid}   {label}")
    print(f"   Loom: {loom}   ECU pin: {from_pin}")
    print("=" * 78)

    field_order = [
        ("wire_circuit_id",                   "Circuit ID"),
        ("wire_gauge_awg",                    "Gauge"),
        ("wire_color_code",                   "Color"),
        ("wire_specification",                "Mil-spec"),
        ("wire_length_in",                    "Length (in)"),
        ("wire_label_a_text",                 "Label end A (device)"),
        ("wire_label_b_text",                 "Label end B (ECU)"),
        ("wire_terminal_pn_a",                "Terminal A"),
        ("wire_terminal_pn_b",                "Terminal B"),
        ("wire_termination_a_inner_seal_pn",  "SCL inner A"),
        ("wire_termination_a_outer_cover_pn", "DR-25 outer A"),
        ("wire_termination_b_inner_seal_pn",  "SCL inner B"),
        ("wire_termination_b_outer_cover_pn", "DR-25 outer B"),
        ("wire_crimp_a_die_pn",               "Crimp die A"),
        ("wire_crimp_b_die_pn",               "Crimp die B"),
        ("wire_crimp_a_pull_test_lbf",        "Pull test A (lbf)"),
        ("wire_crimp_b_pull_test_lbf",        "Pull test B (lbf)"),
    ]

    cited = 0
    gapped = 0
    for prop, label_str in field_order:
        cells = cells_by_prop.get(prop, [])
        if not cells:
            gapped += 1
            print(f"  {label_str:25s}  —  (not in substrate)")
            continue
        for c in cells:
            cited += 1
            val = c["value"][:50] if c["value"] else "?"
            conf = c["conf"]
            score = c["score"]
            src = c["source"]
            conf_marker = {
                "verified": "★★★",
                "high": "★★ ",
                "medium": "★  ",
                "low": "·  ",
                "inferred": "?  ",
            }.get(conf, "   ")
            print(f"  {label_str:25s}  {conf_marker} {val:30s}  src: {src}")

    # Landmark path
    print()
    print("  Routing landmarks:")
    landmark_sql = f"""
SELECT
  vo.structured_data->>'sequence' AS seq,
  vo.structured_data->>'value' AS landmark,
  ld.structured_data->>'value' AS distance_in
FROM public.vehicle_observations vo
JOIN public.observation_properties op ON op.id = vo.property_id
LEFT JOIN public.vehicle_observations ld ON ld.vehicle_id = vo.vehicle_id
  AND ld.is_superseded = false
  AND ld.structured_data->>'landmark_id' = vo.structured_data->>'value'
  AND ld.property_id = (SELECT id FROM public.observation_properties WHERE property_key = 'landmark_distance_in')
WHERE vo.vehicle_id = '{VEHICLE_ID}'
  AND vo.is_superseded = false
  AND op.property_key = 'wire_landmark_traversal'
  AND vo.structured_data->>'wire_id' = '{wid}'
ORDER BY (vo.structured_data->>'sequence')::int
"""
    out = psql(landmark_sql)
    total_in = 0.0
    if out:
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) >= 3:
                seq, lm, dist = parts[0], parts[1], parts[2]
                dist_disp = f"{float(dist):>6.1f}in" if dist else "  ?  "
                print(f"     {seq:>2}. {lm:6s}  {dist_disp}  (estimate)")
                if dist:
                    total_in += float(dist)
        print(f"          estimated landmark sum: {total_in:.1f} in   ({total_in/12:.2f} ft)")
    else:
        print("     (no landmark traversal data — wire not in K5_wire_paths.yaml)")

    # Closure ratio
    print()
    print(f"  ───────────────────────────────────────────────────────────────────")
    pct = 100.0 * cited / (cited + gapped) if (cited + gapped) else 0
    print(f"  Closure: {cited} cited / {gapped} gapped  ({pct:.0f}% of build target)")

    # Legend
    print()
    print("  Legend:  ★★★ verified   ★★ high   ★ medium   · low   ? inferred")
    print()


if __name__ == "__main__":
    main()
