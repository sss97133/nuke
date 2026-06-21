#!/usr/bin/env python3
"""
Wiring Substrate v2 — STEP 1 one-time idempotent ingestion of the K5 wiring
file-substrate into DB rows.

Spec:    docs/wiring/WIRING_SUBSTRATE_V2_SPEC.md  (build order item 1)
Receipt: docs/wiring/receipts/2026-06-10_substrate-v2-step1-ingestion.md
Run:     npm run wiring:v2:ingest          (registered in package.json)

Sources (frozen v1 file substrate -> seed atoms, provenance source=v1_file_substrate):
  1. docs/wiring/output/K5_cut_list_v4_1.txt          -> vehicle_custom_circuits (168 wires)
  2. docs/wiring/receipts/*.md                        -> wiring_decisions (shallow parse:
         filename + frontmatter + first heading; bodies stay the human render)
  3. docs/wiring/output/K5_landmarks_blender_derived.yaml -> vehicle_harness_landmarks (30)
  4. policy rules (vdrop 3%, x1.25 safety, slack/pads, 22AWG floor, PDM ratings,
         fuse ladder) from calc-data/rules_extracted.md + pdm_power_budget.md
                                                      -> wiring_policy_rules

Idempotency: INSERT ... ON CONFLICT DO NOTHING against natural keys
  (overlay_id, circuit_code) / (slug) / (vehicle_id, landmark_code, method) /
  (rule_key, version). Re-run => 0 new rows. The script NEVER updates or
  deletes existing rows (Step 1 contract).
"""

import os
import re
import sys
import json
import glob
import psycopg2
import psycopg2.extras

ROOT = "/Users/skylar/nuke"
CUT_LIST = f"{ROOT}/docs/wiring/output/K5_cut_list_v4_1.txt"
SUBSYSTEMS = f"{ROOT}/docs/wiring/calc-data/subsystems.json"
LANDMARKS = f"{ROOT}/docs/wiring/output/K5_landmarks_blender_derived.yaml"
RECEIPTS_DIR = f"{ROOT}/docs/wiring/receipts"

VEHICLE_ID = "e08bf694-970f-4cbe-8a74-8715158a0f2e"          # 1977 K5 Blazer
OVERLAY_ID = "eafee5c6-c105-4148-be9c-61cca0bc2377"          # existing ultra-tier overlay
DERIVATION_VERSION = "v4.1"
SOURCE_TAG = "v1_file_substrate"
POLICY_VERSION = "v1_file_substrate_2026-06-10"

EXPECTED_WIRES = 168       # cut list v4.1 header
EXPECTED_LANDMARKS = 30    # L01..L30

# Wires added in v4 / v4.1 after subsystems.json (v3 registry, 145 ids) was built.
# Mapping carries receipt lineage; flagged in each row's notes.
V41_SUBSYSTEM_ADDENDUM = {
    **{str(n): "DASH_CLUSTER_DAKOTA" for n in range(114, 125)},  # 2026-05-14 Dakota addendum
    "125": "TRANS_6L80E",        # Holley T43 CAN stub rides the trans subsystem (#58)
    "126": "EPARKING_BRAKE",     # E-Stopp dash trigger (#54 is EPARKING_BRAKE)
    "85a": "LIGHTING_EXTERIOR", "85b": "LIGHTING_EXTERIOR",      # high-beam dimmer legs of #85/#86
    "86a": "LIGHTING_EXTERIOR", "86b": "LIGHTING_EXTERIOR",
    "ECU_PWR": "CORE_ENGINE", "ECU_GND1": "CORE_ENGINE", "ECU_GND2": "CORE_ENGINE",  # v4.1 ECU lifelines
    "PDM_BPOS": "CORE_ENGINE", "PDM_GND1": "CORE_ENGINE", "PDM_GND2": "CORE_ENGINE", # v4.1 PDM feed
}

FROM_RE = re.compile(
    r"(M130:\S+|PDM30:\S+|PDM30|ECU|AMP \S+|GM \S+ SNDR|TAP #\S+(?: DASH)?|"
    r"DASH STAR GND|OUT29 SPLICE|SPLICE #\S+|DASH BUTTON|DIMMER (?:LO|HI)-OUT|"
    r"ENGINE BLOCK|CAN Backbone)\s*$"
)
SPEC_RE = re.compile(r"(\d+)\s*AWG((?: M22759/\d+| TWISTED PAIR| SHIELDED 2C| bare/BLK)?)")
LEN_RE = re.compile(r"([\d.]+)ft")
WIRE_RE = re.compile(r"^#(\S+)\s+(.*)$")


def parse_cut_list(path):
    wires, section = [], None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        if line.startswith(">>"):
            section = re.sub(r"\(.*", "", line[2:]).strip()
            continue
        m = WIRE_RE.match(line)
        if not m:
            continue
        wid, rest = m.group(1), m.group(2)
        lm = LEN_RE.search(rest)
        sm = SPEC_RE.search(rest)
        if not lm or not sm or not section:
            continue  # header/comment lines
        if "LABEL" in rest and "FROM" in rest:
            continue
        gauge = int(sm.group(1))
        spec = sm.group(2).strip() or None
        before_spec = rest[: sm.start()].rstrip()
        fm = FROM_RE.search(before_spec)
        if not fm:
            raise SystemExit(f"FROM parse failed for wire #{wid}: {line!r}")
        from_ref = fm.group(1)
        label = before_spec[: fm.start()].strip()
        color = rest[sm.end(): lm.start()].strip() or None
        notes = rest[lm.end():].strip() or None
        if ":" in from_ref:
            from_component, from_pin = from_ref.split(":", 1)
        else:
            from_component, from_pin = from_ref, None
        wires.append({
            "id": wid, "label": label, "from_component": from_component,
            "from_pin": from_pin, "gauge": gauge, "spec": spec, "color": color,
            "length_ft": float(lm.group(1)), "notes": notes, "section": section,
        })
    return wires


def subsystem_map():
    data = json.load(open(SUBSYSTEMS, encoding="utf-8"))
    m = {}
    for name, sub in data["subsystems"].items():
        for w in sub.get("wire_ids", []):
            m[w] = name
    return m


def parse_landmarks(path):
    """The yaml is comment-heavy; landmark lines are `  Lnn: <num>   # desc`."""
    rows = []
    lm_re = re.compile(r"^\s{2}(L\d{2}):\s+([\d.]+)\s+#\s*(.*)$")
    for line in open(path, encoding="utf-8"):
        m = lm_re.match(line)
        if m:
            rows.append({"code": m.group(1), "inches": float(m.group(2)),
                         "desc": m.group(3).strip()})
    return rows


def parse_receipts(d):
    """Shallow parse: filename -> slug/date; frontmatter keys; first # heading.
    Bodies are NOT deep-parsed (they remain the human render)."""
    out = []
    for path in sorted(glob.glob(f"{d}/*.md")):
        fname = os.path.basename(path)
        fmatch = re.match(r"(\d{4}-\d{2}-\d{2})_(.+)\.md$", fname)
        if not fmatch:
            continue
        date, slug_part = fmatch.group(1), fmatch.group(2)
        slug = f"{date}_{slug_part}"
        lines = open(path, encoding="utf-8").read().splitlines()
        fm, heading = {}, None
        in_fm, fm_key = False, None
        for i, line in enumerate(lines):
            if i == 0 and line.strip() == "---":
                in_fm = True
                continue
            if in_fm:
                if line.strip() == "---":
                    in_fm = False
                    continue
                kv = re.match(r"^(\w[\w_]*):\s*(.*)$", line)
                if kv:
                    fm_key = kv.group(1)
                    fm[fm_key] = kv.group(2).strip()
                elif re.match(r"^\s+-\s+", line) and fm_key:
                    fm.setdefault(fm_key + "_list", []).append(
                        re.sub(r"^\s+-\s+", "", line).strip())
                continue
            if line.startswith("# ") and heading is None:
                heading = line[2:].strip()
            # bullet-style metadata used by newer receipts: "- **Amends:** x"
            bm = re.match(r"^-\s+\*\*(\w[\w ]*?):\*\*\s*(.*)$", line)
            if bm:
                fm.setdefault(bm.group(1).strip().lower().replace(" ", "_"),
                              bm.group(2).strip())
        supersedes = []
        for key in ("amends", "retracts", "supersedes"):
            candidates = []
            if fm.get(key):
                candidates.append(fm[key])
            candidates.extend(fm.get(key + "_list", []))
            for item in candidates:
                cleaned = re.sub(r"\s*\(.*\)$", "", item).strip("` ")
                cleaned = re.sub(r"^receipts/", "", cleaned)
                cleaned = re.sub(r"\.md$", "", cleaned)
                if cleaned and cleaned.lower() not in ("none", "n/a", "-"):
                    supersedes.append(cleaned)
        change_type = fm.get("change_type")
        if not change_type:  # infer from filename prefix only (no body parse)
            for kind in ("decision", "amendment", "retraction", "open-question",
                         "acceptance", "addendum", "research", "migration-plan",
                         "substrate"):
                if slug_part.startswith(kind) or f"_{kind}" in slug_part:
                    change_type = kind.replace("-", "_")
                    break
        status_line = fm.get("status", "")
        source = "skylar_verbal" if "skylar" in status_line.lower() else (
            "agent_scientific_method" if "agent decision" in status_line.lower()
            else SOURCE_TAG)
        out.append({
            "slug": slug, "date": fm.get("date", date),
            "subject": heading or slug_part.replace("-", " "),
            "chosen": heading or slug_part.replace("-", " "),
            "change_type": change_type, "scope": fm.get("scope"),
            "status": fm.get("status"), "source": source,
            "supersedes": supersedes,
            "receipt_path": f"docs/wiring/receipts/{fname}",
        })
    return out


POLICY_RULES = [
    # (rule_key, rule_value, source, notes)
    ("vdrop_max_pct",
     {"value": 3, "unit": "pct", "basis_volts": 12, "max_drop_volts": 0.36},
     "docs/wiring/chapters/06-compute-engine.md; supabase/functions/_shared/wiringCompute.ts selectWireGauge",
     "Max allowable round-trip voltage drop for gauge selection."),
    ("safety_margin_multiplier",
     {"value": 1.25},
     "docs/wiring/chapters/06-compute-engine.md; wiringCompute.ts (effectiveAmps = amps x 1.25)",
     "Applied to ALL loads for both drop and ampacity checks (server doctrine; client motor-only variant is flagged stale in calc-data/rules_extracted.md C2)."),
    ("length_slack_multiplier",
     {"value": 1.15},
     "harnessConstants.ts SLACK_MULTIPLIER; calc-data/rules_extracted.md §4",
     "Zone-length estimates multiplied by 1.15 (15% slack)."),
    ("length_pad_body_pct",
     {"value": 15, "unit": "pct"},
     ".claude/rules/wiring-wire-closure-protocol.md field 10",
     "Estimate pad for body-zone runs."),
    ("length_pad_engine_pct",
     {"value": 20, "unit": "pct"},
     ".claude/rules/wiring-wire-closure-protocol.md field 10",
     "Estimate pad for engine-bay runs. Doc-only rule — exists nowhere in code per rules_extracted.md §4."),
    ("signal_gauge_floor_awg",
     {"value": 22},
     "docs/wiring/receipts/2026-05-14_substrate-amendment-gauge-audit.md; cut list v4.1 header",
     "22 AWG floor for signal wires (gauge audit doctrine)."),
    ("pdm30_channel_ratings",
     {"channels": [{"range": "OUT1-OUT8", "rating_amps": 20, "dual_pin": True, "transient_amps": 115},
                    {"range": "OUT9-OUT30", "rating_amps": 8, "dual_pin": False, "transient_amps": 60}],
      "dual_pin_pairs": ["A01+A10", "A03+A12", "A05+A14", "A07+A16", "A09+A17", "B03+B09", "B05+B11", "B07+B13"],
      "max_continuous_total_amps": 100},
     "MoTeC PDM User Manual p39 (VALIDATED per calc-data/rules_extracted.md C6); docs/wiring/output/K5_pdm30_channel_plan.md (2026-04-05 AUTHORITATIVE)",
     "Two stale variants exist (wiringCompute.ts server ladder; harness_spec_latest.txt 2026-04-13) — this row is the validated one. Total-output ceiling 100A per VALIDATION_REPORT / v4.1 receipt."),
    ("pdm15_channel_ratings",
     {"channels": [{"range": "OUT1-OUT8", "rating_amps": 20}, {"range": "OUT9-OUT15", "rating_amps": 8}]},
     "MoTeC PDM User Manual p39 via overlayCompute.ts validated comment (calc-data/rules_extracted.md C6)",
     "8x20A + 7x8A."),
    ("pdm_direct_wire_threshold_amps",
     {"value": 20},
     "docs/wiring/chapters/05-build-manifest.md; calc-data/rules_extracted.md §6",
     ">20A continuous cannot ride a PDM channel — direct-wired with relay/fuse."),
    ("fuse_rating_rule",
     {"rule": "next standard size >= continuous_amps * 1.25",
      "standard_sizes": [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100],
      "cap": 100, "applies": "non-PDM circuits only (PDM channels self-protect)"},
     "calc-data/rules_extracted.md §3 (from wiringCompute.ts)",
     "Fuse ladder policy."),
]


def main():
    conn = psycopg2.connect(
        host=os.environ.get("PGHOST", "aws-0-us-west-1.pooler.supabase.com"),
        port=int(os.environ.get("PGPORT", "6543")),
        user=os.environ.get("PGUSER", "postgres.qkgaybvrernstplzjaam"),
        password=os.environ["PGPASSWORD"],
        dbname=os.environ.get("PGDATABASE", "postgres"),
    )
    conn.autocommit = False
    cur = conn.cursor()
    inserted = {}

    # ---- 1. circuits from cut list v4.1 -------------------------------------
    wires = parse_cut_list(CUT_LIST)
    assert len(wires) == EXPECTED_WIRES, \
        f"cut list parse: expected {EXPECTED_WIRES}, got {len(wires)}"
    assert len({w['id'] for w in wires}) == EXPECTED_WIRES, "duplicate wire ids"

    sub_map = subsystem_map()
    rows = []
    for w in wires:
        sub = sub_map.get(w["id"])
        note_extra = ""
        if sub is None:
            sub = V41_SUBSYSTEM_ADDENDUM.get(w["id"])
            note_extra = " | subsystem assigned at ingest from receipt lineage (not in subsystems.json v3 registry)"
        if sub is None:
            raise SystemExit(f"no subsystem for wire #{w['id']}")
        notes = (f"source: {SOURCE_TAG} (K5_cut_list_v4_1.txt, loom section: {w['section']})"
                 + note_extra + (f" | {w['notes']}" if w["notes"] else ""))
        rows.append((
            OVERLAY_ID, w["id"], w["label"], sub,
            w["color"], w["gauge"], w["spec"], "SHIELDED" in (w["spec"] or ""),
            w["from_component"], w["from_pin"], w["label"],
            "uncut", DERIVATION_VERSION, w["length_ft"], notes,
        ))
    psycopg2.extras.execute_values(cur, """
        INSERT INTO vehicle_custom_circuits
          (overlay_id, circuit_code, circuit_name, system_category,
           wire_color, wire_gauge_awg, wire_type, is_shielded,
           from_component, from_pin, to_component,
           build_state, derivation_version, planned_length_ft, notes)
        VALUES %s
        ON CONFLICT (overlay_id, circuit_code) DO NOTHING
    """, rows, page_size=200)
    inserted["vehicle_custom_circuits"] = cur.rowcount

    # ---- 2. decisions from receipts ------------------------------------------
    decisions = parse_receipts(RECEIPTS_DIR)
    drows = [(VEHICLE_ID, d["slug"], d["date"], d["subject"], d["chosen"],
              d["change_type"], d["scope"], d["status"], d["source"],
              d["supersedes"], d["receipt_path"]) for d in decisions]
    psycopg2.extras.execute_values(cur, """
        INSERT INTO wiring_decisions
          (vehicle_id, slug, decided_on, subject, chosen,
           change_type, scope, status, source, supersedes, receipt_path)
        VALUES %s
        ON CONFLICT (slug) DO NOTHING
    """, drows, page_size=200)
    inserted["wiring_decisions"] = cur.rowcount

    # ---- 3. landmarks ---------------------------------------------------------
    lms = parse_landmarks(LANDMARKS)
    assert len(lms) == EXPECTED_LANDMARKS, \
        f"landmarks: expected {EXPECTED_LANDMARKS}, got {len(lms)}"
    lrows = []
    for lm in lms:
        rederived = lm["code"] in ("L14", "L15")
        method = ("analytic_polyline_derived" if rederived
                  else "blender_polyline_derived_v2")
        lrows.append((
            VEHICLE_ID, lm["code"], lm["desc"], lm["inches"], method,
            "2026-06-10" if rederived else "2026-06-09",
            "claude session (digital twin v2)" if not rederived
            else "claude session (battery-corner re-derivation, receipt 2026-06-10_battery-corner-rederivation.md)",
            "docs/wiring/output/K5_landmarks_blender_derived.yaml",
            "A1-A6 position assumptions + C1/C2 substrate conflicts per yaml header; "
            "values are tape-routed-equivalent inches WITHOUT service loop; "
            "NOT physical tape measurements",
            f"source: {SOURCE_TAG}",
        ))
    psycopg2.extras.execute_values(cur, """
        INSERT INTO vehicle_harness_landmarks
          (vehicle_id, landmark_code, description, distance_in, method,
           derived_on, derived_by, source_file, assumptions, notes)
        VALUES %s
        ON CONFLICT (vehicle_id, landmark_code, method) DO NOTHING
    """, lrows, page_size=100)
    inserted["vehicle_harness_landmarks"] = cur.rowcount

    # ---- 4. policy rules -------------------------------------------------------
    prows = [(None, key, json.dumps(val), POLICY_VERSION, src, "2026-06-10", notes)
             for key, val, src, notes in POLICY_RULES]
    psycopg2.extras.execute_values(cur, """
        INSERT INTO wiring_policy_rules
          (vehicle_id, rule_key, rule_value, version, source, effective_date, notes)
        VALUES %s
        ON CONFLICT (rule_key, version) DO NOTHING
    """, prows, page_size=100)
    inserted["wiring_policy_rules"] = cur.rowcount

    conn.commit()
    print(json.dumps({
        "parsed": {"wires": len(wires), "receipts": len(decisions),
                    "landmarks": len(lms), "policy_rules": len(POLICY_RULES)},
        "inserted": inserted,
    }, indent=2))
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
