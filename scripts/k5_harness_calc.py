#!/usr/bin/env python3
"""
K5 harness recalculation engine — the harness is DERIVED, not designed.

Toggle subsystems in a TOML config; everything downstream recalculates:
active wires, loads, PDM channel loading + freed channels, gauge audit
(voltage-drop check per doctrine), lengths (landmark paths), per-gauge
footage + ProWire pricing, trunk bundle ODs, and a DIFF vs another config.

Rule sources (extracted 2026-06-09, see docs/wiring/calc-data/rules_extracted.md):
  DOC-05  chapters/05-build-manifest.md   — signal->wire expansion, PDM grouping
  DOC-06  chapters/06-compute-engine.md   — gauge from amps, ECU derivation
  SERVER  supabase/functions/_shared/wiringCompute.ts — gauge formula constants
  PLAN    docs/wiring/output/K5_pdm30_channel_plan.md — AUTHORITATIVE channel map
  PRO     docs/wiring/calc-data/prowire_index.md — catalog_parts snapshot (1,248 SKUs)
Data:
  docs/wiring/calc-data/subsystems.json  — 22 subsystems x (devices, wire_ids, amps, channels)
  docs/wiring/output/K5_cut_list_v3.txt  — 145-wire registry (id, FROM, spec, color)
  docs/wiring/output/K5_wire_paths.yaml  — per-wire landmark traversal
  docs/wiring/output/K5_landmarks_blender_derived.yaml — landmark inches (derived; tape supersedes)

Usage:
  python3 scripts/k5_harness_calc.py --config docs/wiring/configs/k5_baseline.toml
  python3 scripts/k5_harness_calc.py --config A.toml --diff B.toml
  python3 scripts/k5_harness_calc.py --list-subsystems
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("pip install pyyaml")
try:
    import tomllib
except ImportError:
    import tomli as tomllib

ROOT = Path(__file__).resolve().parent.parent
CD = ROOT / "docs/wiring/calc-data"
OUT = ROOT / "docs/wiring/output"

# ── Rule constants (SERVER wiringCompute.ts — doctrine-matching version) ──
VDROP_PCT = 3.0            # DOC-06: 3% max drop
SYS_V = 12.0               # SERVER uses 12V => 0.36V allowance
SAFETY = 1.25              # DOC-06: +25% on ALL loads (server behavior; client motor-only is contradiction C2)
ROUND_TRIP = 2.0           # SERVER: x2 round trip
AWG = {  # ohms/ft @20C, ampacity (chassis bundle) — SERVER table, identical in CONST/CUTLIST
    22: (0.01614, 5), 20: (0.01015, 7.5), 18: (0.00639, 10), 16: (0.00402, 15),
    14: (0.00253, 20), 12: (0.00159, 25), 10: (0.00100, 35), 8: (0.000628, 50),
    6: (0.000395, 65), 4: (0.000249, 85), 2: (0.000156, 115), 0: (0.0000983, 150),
}
# length allowances — scripts/compute_wire_lengths.py (established)
SERVICE_LOOP_IN, SHIELD_IN, DOOR_IN = 12, 6, 6
BEND_LIGHT, BEND_HEAVY = 1.05, 1.10
# PDM30 channel ratings — VALIDATED against MoTeC PDM manual p39 (overlayCompute comment):
# OUT1-8 = 20A dual-pin, OUT9-30 = 8A. (Server's 20/15/10 and CALC's banded versions are stale — contradiction C6.)
PDM_RATING = lambda ch: 20 if ch <= 8 else 8
# ProWire catalog snapshot avg $/ft by (spec, awg) — calc-data/prowire_index.md (catalog_parts, last scrape 2026-05-11)
PRICE = {("/32", 22): 0.41, ("/32", 20): 0.27, ("/32", 18): 0.48, ("/32", 16): 0.49,
         ("/32", 14): 0.84, ("/32", 12): 1.52, ("/16", 10): 2.01, ("/16", 8): 9.25,
         ("/16", 12): 1.00, ("/16", 14): 0.68, ("/16", 16): 0.47, ("/16", 18): 0.87,
         ("/16", 4): 10.50, ("/16", 2): 15.80, ("/16", 0): 15.80}
# M22759 nominal finished OD inches — published spec NOMINALS; VERIFY against ProWire
# product pages (catalog rows carry URLs). Flagged in bundle output.
OD_IN = {22: 0.042, 20: 0.051, 18: 0.060, 16: 0.070, 14: 0.083, 12: 0.099,
         10: 0.142, 8: 0.180, 6: 0.220, 4: 0.275, 2: 0.340, 0: 0.415}
BUNDLE_FILL = 0.65  # standard round-bundle packing approximation (engine-introduced; no doctrine rule exists — rules_extracted.md §11)

# trunk classification by first path landmark(s)
TRUNKS = {
    "ENGINE_LOOM": {"L01", "L02"}, "DASH_LOOM": {"L17", "L18", "L19", "L28"},
    "REAR_LOOM": {"L24"}, "DOOR_L": {"L20"}, "DOOR_R": {"L22"},
    "FRONT_LIGHTS": {"L14"}, "POWER": {"L15"}, "ROOF": {"L23"}, "FW_JUMP": {"L16"},
}

# cross-dependencies (subsystems.json cross_dependency notes)
def cross_keep(wire_id, on):
    if wire_id == "53" and (on.get("LIGHTING_EXTERIOR") or on.get("TRANS_6L80E")):
        return True   # brake switch feeds brake lamps + TC unlock
    if wire_id == "57" and (on.get("LIGHTING_EXTERIOR") or on.get("CAMERA_REAR")):
        return True   # reverse switch feeds backup lights + camera trigger
    return False


def load_data():
    subs = json.load((CD / "subsystems.json").open())
    landmarks = yaml.safe_load((OUT / "K5_landmarks_blender_derived.yaml").open())["landmarks"]
    paths = yaml.safe_load((OUT / "K5_wire_paths.yaml").open())["wires"]
    wires = {}
    for line in (OUT / "K5_cut_list_v3.txt").open():
        if not line.startswith("#") or line.startswith("#  "):
            continue
        parts = re.split(r"\s{2,}", line.rstrip())
        if len(parts) < 5:
            continue
        wid = parts[0].lstrip("#")
        label, frm = parts[1], parts[2]
        m = re.match(r"(\d+)\s*AWG\s*(\S*)", parts[3])
        gauge = int(m.group(1)) if m else None
        spec = parts[3]
        color = parts[4] if len(parts) > 4 else ""
        lm = re.search(r"([\d.]+)ft", line)
        est_ft = float(lm.group(1)) if lm else None
        wires[wid] = {"label": label, "from": frm, "gauge": gauge, "spec": spec,
                      "color": color, "est_ft": est_ft}
    devices = json.load(Path("/Users/skylar/k5-harness-pull/devices.json").open())
    dev_amps = {}
    for d in devices:
        try:
            dev_amps[d["name"].lower()] = float(d.get("amps") or 0)
        except (ValueError, TypeError):
            pass
    return subs, landmarks, paths, wires, dev_amps


def wire_len_ft(wid, gauge, paths, landmarks, est_ft):
    p = paths.get(str(wid))
    if not p:
        return est_ft, "cutlist_estimate"
    base = sum(float(landmarks[l]) for l in p["path"] if landmarks.get(l))
    extras = SERVICE_LOOP_IN
    flags = p.get("flags", [])
    if "shielded" in flags:
        extras += SHIELD_IN
    if "door_crossing" in flags:
        extras += DOOR_IN
    mult = BEND_HEAVY if (gauge or 18) <= 12 else BEND_LIGHT
    return round((base + extras) * mult / 12.0, 2), "landmark_derived"


def gauge_check(gauge, amps, length_ft):
    """SERVER selectWireGauge: smallest wire w/ vdrop<=3% of 12V AND ampacity>=1.25x amps."""
    if not gauge or not amps or not length_ft or gauge not in AWG:
        return None
    eff = amps * SAFETY
    v_allow = SYS_V * VDROP_PCT / 100.0
    ohms, ampacity = AWG[gauge]
    vdrop = eff * ohms * length_ft * ROUND_TRIP
    ok = vdrop <= v_allow and ampacity >= eff
    need = None
    if not ok:
        for g in sorted(AWG, reverse=True):
            o, a = AWG[g]
            if eff * o * length_ft * ROUND_TRIP <= v_allow and a >= eff:
                need = g
                break
        need = need if need is not None else 0
    return {"vdrop": round(vdrop, 3), "ok": ok, "need_awg": need}


def spec_family(gauge):
    return "/32" if (gauge or 18) >= 12 else "/16"


def compute(cfg_path):
    cfg = tomllib.load(open(cfg_path, "rb"))
    toggles = cfg.get("toggles", {})
    subs, landmarks, paths, wires, dev_amps = load_data()
    S = subs["subsystems"]
    on = {name: toggles.get(name, not s.get("toggleable", True) or True)
          for name, s in S.items() if name != "NON_ELECTRICAL"}
    # non-toggleable subsystems are always on
    for name, s in S.items():
        if not s.get("toggleable", True):
            on[name] = True

    active, dropped = {}, {}
    for name, s in S.items():
        if name == "NON_ELECTRICAL":
            continue
        for wid in s.get("wire_ids", []):
            rec = dict(wires.get(wid, {"label": f"(not in cut list) {wid}", "gauge": None,
                                       "spec": "?", "color": "?", "est_ft": None, "from": "?"}))
            rec["subsystem"] = name
            if on.get(name) or cross_keep(wid, on):
                active[wid] = rec
            else:
                dropped[wid] = rec

    mech = bool(toggles.get("MECHANICAL_GAUGES", False))
    mech_alt = subs.get("MECHANICAL_GAUGES_ALTERNATE", {})

    # lengths + gauge audit
    total_ft, by_gauge, audit_flags = 0.0, {}, []
    for wid, w in active.items():
        ft, meth = wire_len_ft(wid, w["gauge"], paths, landmarks, w["est_ft"])
        w["len_ft"], w["len_method"] = ft, meth
        if ft:
            total_ft += ft
            if w["gauge"] is not None:
                key = (spec_family(w["gauge"]), w["gauge"])
                by_gauge[key] = by_gauge.get(key, 0) + ft
        amps = dev_amps.get(w["label"].lower())
        chk = gauge_check(w["gauge"], amps, ft) if amps else None
        if chk and not chk["ok"]:
            audit_flags.append(f"#{wid} {w['label']}: {w['gauge']} AWG fails at {amps}A x {ft}ft "
                               f"(vdrop {chk['vdrop']}V) -> needs {chk['need_awg']} AWG")

    # PDM loading: parse OUTn from cut list FROM + subsystem channel notes
    ch_load = {}
    for wid, w in active.items():
        m = re.search(r"OUT(\d+)", w.get("from", ""))
        if m:
            ch = int(m.group(1))
            amps = dev_amps.get(w["label"].lower(), 0)
            ch_load.setdefault(ch, []).append((wid, w["label"], amps))
    freed = []
    for wid, w in dropped.items():
        m = re.search(r"OUT(\d+)", w.get("from", ""))
        if m and int(m.group(1)) not in ch_load:
            freed.append((int(m.group(1)), w["label"]))

    # power budget (subsystem nameplate sums for ON subsystems)
    cont = sum(S[n].get("total_amps", 0) for n, v in on.items() if v and n in S
               and n not in ("CHARGING_STARTING",))  # starter peak excluded from continuous
    alt_required = math.ceil(cont * SAFETY)

    # trunk bundle ODs
    trunk_w = {}
    for wid, w in active.items():
        p = paths.get(str(wid))
        first = p["path"][0] if p and p.get("path") else None
        for tname, lms in TRUNKS.items():
            if first in lms:
                trunk_w.setdefault(tname, []).append(w["gauge"] or 18)
                break
    trunk_od = {t: round(math.sqrt(sum(OD_IN.get(g, 0.06) ** 2 for g in gs) / BUNDLE_FILL), 3)
                for t, gs in trunk_w.items()}

    # cost
    cost = sum(PRICE.get(k, 0) * ft for k, ft in by_gauge.items())

    return {
        "name": Path(cfg_path).stem, "toggles_on": {k: v for k, v in sorted(on.items())},
        "mechanical_gauges": mech, "mech_note": mech_alt.get("description", "")[:160] if mech else "",
        "wires": len(active), "wires_dropped": len(dropped),
        "dropped_list": sorted(dropped.keys(), key=str),
        "total_ft": round(total_ft, 1),
        "by_gauge": {f"M22759{k[0]}-{k[1]:02d}": round(v, 1) for k, v in sorted(by_gauge.items(), key=lambda x: -x[0][1])},
        "gauge_audit_flags": audit_flags,
        "pdm_channels_used": len(ch_load), "pdm_freed": sorted(set(freed)),
        "pdm_overloads": [f"OUT{c}: {sum(a for _, _, a in lst):.1f}A > {PDM_RATING(c)}A rating"
                          for c, lst in sorted(ch_load.items())
                          if sum(a for _, _, a in lst) > PDM_RATING(c)],
        "continuous_amps": round(cont, 1),  # nameplate worst-case sum; coils/injectors pulsed — see PLAN budget 299A continuous
        "alternator_required_A": alt_required,
        "trunk_od_in": dict(sorted(trunk_od.items())),
        "wire_cost_usd": round(cost, 2),
        "_active": active,
    }


def report(R, fh=sys.stdout):
    p = lambda *a: print(*a, file=fh)
    p(f"\n══ K5 HARNESS CALC — {R['name']} ══")
    off = [k for k, v in R["toggles_on"].items() if not v]
    p(f"Subsystems OFF: {', '.join(off) if off else 'none (full build)'}")
    if R["mechanical_gauges"]:
        p(f"MECHANICAL_GAUGES alternate ON — {R['mech_note']}")
    p(f"Wires: {R['wires']} active ({R['wires_dropped']} dropped)  |  Total: {R['total_ft']} ft  |  Conductor cost: ${R['wire_cost_usd']} (ProWire snapshot)")
    p(f"Nameplate load sum: {R['continuous_amps']} A (pulsed loads at peak — channel-plan continuous budget is 299A vs 250A alt, see calc-data/pdm_power_budget.md)")
    p(f"PDM channels in use: {R['pdm_channels_used']}/30" + (f"  |  FREED: {['OUT%d (%s)' % f for f in R['pdm_freed']]}" if R["pdm_freed"] else ""))
    for w in R["pdm_overloads"]:
        p(f"  ⚠ PDM OVERLOAD {w}")
    p("Per-gauge footage:")
    for k, v in R["by_gauge"].items():
        p(f"  {k}: {v} ft")
    p("Trunk bundle OD (in, packing 0.65 — ODs are spec NOMINALS, verify vs ProWire pages):")
    for t, od in R["trunk_od_in"].items():
        p(f"  {t}: ⌀{od}\"")
    if R["gauge_audit_flags"]:
        p("Gauge audit (doctrine: ≤3% Vdrop @12V, x1.25, round trip):")
        for f_ in R["gauge_audit_flags"]:
            p(f"  ⚠ {f_}")


def diff(A, B, fh=sys.stdout):
    p = lambda *a: print(*a, file=fh)
    p(f"\n══ DIFF: {A['name']} → {B['name']} ══")
    dropped = sorted(set(A["_active"]) - set(B["_active"]), key=str)
    added = sorted(set(B["_active"]) - set(A["_active"]), key=str)
    p(f"Wires: {A['wires']} → {B['wires']}  ({'-' if dropped else ''}{len(dropped)} dropped, +{len(added)} added)")
    if dropped:
        p("  dropped: " + ", ".join(f"#{w}" for w in dropped))
    if added:
        p("  added:   " + ", ".join(f"#{w}" for w in added))
    p(f"Footage: {A['total_ft']} → {B['total_ft']} ft  (Δ {round(B['total_ft']-A['total_ft'],1)})")
    p(f"Conductor cost: ${A['wire_cost_usd']} → ${B['wire_cost_usd']}  (Δ ${round(B['wire_cost_usd']-A['wire_cost_usd'],2)})")
    p(f"Continuous: {A['continuous_amps']} → {B['continuous_amps']} A  |  Alt required: {A['alternator_required_A']} → {B['alternator_required_A']} A")
    p(f"PDM channels: {A['pdm_channels_used']} → {B['pdm_channels_used']}" +
      (f"  freed: {['OUT%d' % f[0] for f in B['pdm_freed']]}" if B["pdm_freed"] else ""))
    for t in sorted(set(A["trunk_od_in"]) | set(B["trunk_od_in"])):
        a, b = A["trunk_od_in"].get(t, 0), B["trunk_od_in"].get(t, 0)
        if abs(a - b) > 0.001:
            p(f"Trunk {t}: ⌀{a}\" → ⌀{b}\"")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path)
    ap.add_argument("--diff", type=Path)
    ap.add_argument("--list-subsystems", action="store_true")
    args = ap.parse_args()
    if args.list_subsystems:
        subs = json.load((CD / "subsystems.json").open())["subsystems"]
        for n, s in subs.items():
            print(f"{n:24} toggleable={s.get('toggleable')}  wires={s.get('wire_count')}  amps={s.get('total_amps')}")
        return
    if not args.config:
        ap.error("--config required")
    A = compute(args.config)
    report(A)
    if args.diff:
        B = compute(args.diff)
        report(B)
        diff(A, B)


if __name__ == "__main__":
    main()
