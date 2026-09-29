#!/usr/bin/env python3
"""Is each wire end the right answer for this truck? Plug-end design rules, run on every termination.

Layer 2 of the confidence model (memory: feedback_two_layer_confidence_record_vs_design): a choice is right when it
passes every rule that applies, using inputs that carry a source. Each rule answers PASS, FAIL, or OPEN (an input is
missing, so the rule can't run yet). Nothing here is a guess: a rule with no data says OPEN and names what's missing.

Rules
  R1 range     the terminal/contact's wire range includes the wire's gauge (doubled-over wire counts as 3 AWG larger,
               MoTeC C125 manual p.21)
  R2 cavity    the end has a cavity, and no two ends share one unless the plug is a splice point
  R3 tool      a crimp tool is named for this terminal (tools.yaml `for`, or the family's crimp step)
  R4 setting   if the tool has selector settings, this gauge has one
  R5 pull      the family's pull-test step gives a value for this gauge
  R6 ecu pin   an M130 pin's function (MoTeC M130 datasheet pin table) fits the wire's job
  R7 seal     the seal's insulation range (parts.yaml insulation_mm) holds the wire's outside diameter (WIRE-OD,
               ProWire tables); within 0.05 mm of a limit = OPEN (bench check)
  (not yet: housing mates the device's connector -- needs the device connector PN on each endpoint)

Usage: python3 check_plug_ends.py [--fails] [--endpoint EID]
Exit status 1 if any rule FAILs.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

CD = Path(__file__).resolve().parent
REPO = CD.parents[2]
M130_PAGES = [REPO / f"docs/library/_extracted/component_drawings__motec_m130_datasheet/page-000{n}.txt" for n in (4, 5)]


def y(name):
    return yaml.safe_load(open(CD / "catalog" / name))


def m130_pin_table():
    """pin -> (short name, long name), read from the stored MoTeC M130 datasheet text."""
    pins = {}
    for p in M130_PAGES:
        if p.exists():
            for line in p.read_text(errors="ignore").splitlines():
                m = re.match(r"^([AB]\d{2})\s+(\S+)\s+(.+?)\s*$", line)
                if m:
                    pins[m.group(1)] = (m.group(2), m.group(3))
    return pins


# wire job (Dave's words) -> the M130 pin functions that can do it
PIN_FIT = [
    (r"injector \d+ driver|fuel injector", ("INJ_PH", "INJ_LS")),
    (r"coil \d+ trigger|ignition", ("IGN_LS",)),
    (r"6\.3 ?v", ("SEN_6V3",)),
    (r"\b5 ?v\b", ("SEN_5V0",)),
    (r"\b0 ?v\b", ("SEN_0V",)),
    (r"shield drain", ("SEN_0V",)),
    (r"knock", ("KNOCK",)),
    (r"crank signal|cam signal", ("UDIG",)),
    (r"sent", ("UDIG",)),
    (r"throttle motor", ("OUT_HB",)),
    (r"can (hi|lo|high|low)|can trunk", ("CAN",)),
    (r"temp (signal|sender)|temp sig", ("AT", "AV")),
    (r"signal|sender|temp|pressure|psi|map|pedal track \d sig|throttle input", ("AV", "UDIG")),
    (r"ecu ground|ground \d", ("BAT_NEG",)),
    (r"ecu 12 ?v|supply", ("BAT_POS",)),
    (r"ethernet", ("ETH",)),
    (r"tach|speedo", ("OUT_HB", "LS", "UDIG")),
]


def run():
    import kits_v5  # Dave's words for wire names
    r = json.load(open(CD / "k5_registry.json"))
    parts, tools, fams = y("parts.yaml"), y("tools.yaml"), y("families.yaml")
    wires = {str(w["id"]): w for w in r["wires"] + r["implied"]}
    eps = r["endpoints"]
    pins = m130_pin_table()
    by_ep = defaultdict(list)
    for t in r["terminations"]:
        by_ep[t["endpoint"]].append(t)
    results = []
    for eid, ts in by_ep.items():
        ep = eps.get(eid, {})
        fam = fams.get(ep.get("family") or ts[0].get("family")) or {}
        steps = fam.get("steps") or []
        crimp = next((s for s in steps if s.get("do") == "crimp"), {})
        pull = next((s for s in steps if s.get("do") in ("pull test", "pull + look")), {})
        solder = (ep.get("family") or ts[0].get("family")) in ("xlr_solder", "solder_sleeve")
        cav_count = Counter(str(t.get("cavity")) for t in ts if t.get("cavity"))
        splice_point = (ep.get("family") == "ssc") or bool(ep.get("splice_point"))   # spliced groups by design
        for t in ts:
            w = wires.get(str(t["wire"]), {})
            awg = w.get("awg")
            doubled = bool(t.get("doubled")) or str(t["wire"]) in [str(x) for x in (ep.get("doubled") or [])]
            eff = (awg - 3) if isinstance(awg, int) and doubled else awg
            pig = next((pn for pn in (ep.get("pigtailed") or []) if pn.split(" ")[0] == str(t["wire"])), None)
            if pig:
                eff = 16            # the contact holds a 16 AWG pigtail; the load wire meets it in the splice
            name = kits_v5.dave_name(w) if w else str(t["wire"])
            codes = [c for c in str(t.get("part") or "").split(" + ") if c]
            term = next((c for c in codes if (parts.get(c) or {}).get("kind") in ("terminal", "contact")), None)
            lugc = next((c for c in codes if (parts.get(c) or {}).get("kind") == "lug"), None)   # round 4: a named lug sets its own gauge
            res = {}
            # R1 range
            rng = (parts.get(term) or {}).get("range_awg") if term else None
            if not rng and lugc:
                mg = re.search(r"(\d+)(?:-(\d+))? AWG", str((parts.get(lugc) or {}).get("name") or ""))
                if mg:
                    rng = [int(mg.group(1)), int(mg.group(2) or mg.group(1))]
            rng = rng or (ep.get("range_by_wire") or {}).get(str(t["wire"])) or ep.get("range") or fam.get("wire_range_awg")
            # range_by_wire: a maker gives a range per cavity (JL VX700/5i power plug: power/ground 4 AWG, remote 18-10 AWG)
            if not isinstance(eff, int):
                res["R1 range"] = ("OPEN", f"wire gauge unknown ({awg})")
            elif not rng:
                res["R1 range"] = ("OPEN", f"no wire range known for {term or t.get('part') or eid}")
            else:
                small, big = max(rng), min(rng)
                ok = big <= eff <= small
                res["R1 range"] = ("PASS" if ok else "FAIL",
                                   f"{awg} AWG{' doubled (~' + str(eff) + ')' if doubled else ''}"
                                   f"{' via 16 AWG pigtails (' + pig.split(': ')[1] + ')' if pig else ''} vs {small}–{big} AWG ({term or 'plug range'})")
                if pig and ok:
                    sp = re.search(r"(D-609-0\d)", pig)
                    srng = (parts.get(sp.group(1)) or {}).get("range_awg") if sp else None
                    if srng and not (min(srng) <= awg <= max(srng)):
                        res["R1 range"] = ("FAIL", f"load wire {awg} AWG is outside the splice {sp.group(1)} range {max(srng)}–{min(srng)} AWG")
            # a device lead shared by several wires is ONE splice: judge its fill on the combined gauge (kits_v5.splice_for,
            # the 3137CT cavity rule), not wire by wire (2026-09-28: #100 + VSS_DAK on the SEN-01-5 white lead)
            cv = t.get("cavity")
            sp_code = next((c for c in codes if c.startswith("D-609")), None)
            if sp_code and cv and cav_count[str(cv)] > 1:
                grp = [x for x in ts if str(x.get("cavity")) == str(cv)]
                awgs = [wires.get(str(x["wire"]), {}).get("awg") for x in grp]
                srng = (parts.get(sp_code) or {}).get("range_awg")
                if all(isinstance(a, int) for a in awgs) and srng:
                    _, eq = kits_v5.splice_for(awgs)
                    ok = min(srng) <= eq <= max(srng)
                    res["R1 range"] = ("PASS" if ok else "FAIL",
                                       f"one splice for {len(grp)} wires ({' + '.join(map(str, awgs))} AWG = {eq} AWG equivalent, "
                                       f"before the device's own lead) vs {sp_code} {max(srng)}–{min(srng)} AWG")
            # R2 cavity
            stud_family = (ep.get("family") or t.get("family")) in ("ring_small", "lug")
            not_cavity = cv and any(str(cv) in str(o) and "not a cavity" in str(o) for o in (ep.get("open") or []))
            if not cv or cv in ("NEEDS CAVITY",):
                res["R2 cavity"] = ("OPEN", "no cavity assigned")
            elif not_cavity:
                # the plug's own write-up says this pin text is a description, not a cavity (2026-09-28: E-Stopp #126)
                res["R2 cavity"] = ("OPEN", f"'{cv}' is not a cavity (the plug's open item says so) — cavity not read yet")
            elif stud_family and str(cv).startswith("stud"):
                res["R2 cavity"] = ("PASS", f"on the stud ({cv}) — lugs share a stud by design")
            elif stud_family and str(cv) in ("ring", "lug") and cav_count[str(cv)] > 1:
                res["R2 cavity"] = ("OPEN", f"{cav_count[str(cv)]} wires share '{cv}' — which ring/stud each lands on isn't recorded"
                                            + (f" (plan: {ep.get('note')})" if ep.get("note") else ""))
            elif cav_count[str(cv)] > 1 and not splice_point:
                res["R2 cavity"] = ("FAIL", f"cavity {cv} holds {cav_count[str(cv)]} wires")
            else:
                res["R2 cavity"] = ("PASS", f"cavity {cv}")
            # R3 tool / R4 setting
            tool_ids = crimp.get("tool")
            tool_ids = tool_ids if isinstance(tool_ids, list) else [tool_ids] if tool_ids else []
            named = [k for k, v in tools.items() if term and term in (v.get("for") or [])]
            for c in (ep.get("kit") or {}):
                named += [k for k, v in tools.items() if str(c) in [str(x) for x in (v.get("for") or [])]]
            cand = [x for x in tool_ids if x in tools and x != "AFM8"] + [x for x in named if x not in tool_ids]
            if not cand:
                res["R3 tool"] = ("OPEN", f"no crimp tool named for {term or t.get('part') or eid}")
                res["R4 setting"] = ("OPEN", "no tool")
            else:
                res["R3 tool"] = ("PASS", ", ".join(dict.fromkeys(cand)))
                sel = next((tools[x].get("settings_awg_to_selector") for x in cand if tools.get(x, {}).get("settings_awg_to_selector")), None)
                if sel is None:
                    res["R4 setting"] = ("PASS", "fixed-die tool (no selector)")
                elif isinstance(eff, int) and eff in sel:
                    res["R4 setting"] = ("PASS", f"selector {sel[eff]} at {eff} AWG")
                else:
                    res["R4 setting"] = ("FAIL", f"no selector setting for {eff} AWG (has {sorted(sel)})")
            # R5 pull
            pv = str(pull.get("value") or "")
            if solder:
                res["R5 pull"] = ("PASS", "solder joint — no crimp pull test")
            elif pull.get("do") == "pull + look":
                res["R5 pull"] = ("PASS", f"{pull.get('value')} ({pull.get('source', '')})")
            elif not pull:
                res["R5 pull"] = ("OPEN", "no pull-test step for this plug type")
            elif isinstance(awg, int) and re.search(rf"\b{awg}\b[^·]*≥\s*\d+", pv):
                res["R5 pull"] = ("PASS", pv)
            else:
                res["R5 pull"] = ("OPEN", f"no pull value for {awg} AWG in '{pv}'")
            # R7 seal: the seal's insulation range holds this wire's outside diameter (parts.yaml insulation_mm, WIRE-OD)
            seal = next((c for c in codes if (parts.get(c) or {}).get("kind") == "seal"), None)
            if seal:
                rng_mm = (parts.get(seal) or {}).get("insulation_mm")
                spec = str(w.get("spec") or "").split()[0]
                od = ((parts.get("WIRE-OD") or {}).get("od_mm") or {}).get(spec, {}).get(awg)
                if not rng_mm:
                    res["R7 seal"] = ("OPEN", f"no insulation range recorded for seal {seal}")
                elif od is None:
                    res["R7 seal"] = ("OPEN", f"no outside diameter recorded for {spec} {awg} AWG")
                else:
                    lo, hi = rng_mm
                    edge = min(od - lo, hi - od)
                    if od < lo or od > hi:
                        res["R7 seal"] = ("FAIL", f"{spec}-{awg} is {od} mm; seal {seal} takes {lo}–{hi} mm")
                    elif edge < 0.05:
                        res["R7 seal"] = ("OPEN", f"{spec}-{awg} is {od} mm, at the edge of seal {seal} ({lo}–{hi} mm) — bench check")
                    else:
                        res["R7 seal"] = ("PASS", f"{spec}-{awg} {od} mm inside seal {seal} {lo}–{hi} mm")
            # R6 ecu pin
            if eid.startswith("M130"):
                pin = str(cv or "")
                fn = pins.get(pin)
                job = name.lower()
                want = next((ok for rx, ok in PIN_FIT if re.search(rx, job)), None)
                if not fn:
                    res["R6 ecu pin"] = ("OPEN", f"pin {pin} not in the stored M130 pin table")
                elif not want:
                    res["R6 ecu pin"] = ("OPEN", f"'{name}' on {pin} {fn[0]}: no rule for this job yet")
                else:
                    ok = any(fn[0].startswith(p) for p in want)
                    res["R6 ecu pin"] = ("PASS" if ok else "FAIL", f"'{name}' on {pin} = {fn[0]} ({fn[1]})")
            results.append({"endpoint": eid, "wire": t["wire"], "name": name, "cavity": cv, "part": t.get("part"), "rules": res})
    return results


# ================================================================= wires, devices, system: R8–R14
# Owner 2026-09-27: "need to ensure all our wires are right ... think about the 61 pin connector to the firewall think
# about how the fuel pump communicates ... so much missing end points". Plan: ~/.claude/plans/vivid-hugging-globe.md.
#   R8  both ends     from and to are named points (device, connector cavity, splice, stud, ground point) with pins
#   R9  pin fits      M130 pin function fits the job; a PDM output has a channel within its rating; device pin known
#   R10 circuit       a device has the wires its signal type needs (chapters/05-build-manifest.md)
#   R11 command       every PDM-driven load has a recorded way to be switched; loads a retired relay used to switch
#   R12 firewall      a wire whose ends sit on opposite sides crosses through a 61-pin cavity or the grommet
#   R13 locked        no wire or device contradicts a locked decision (K5_WIRING_STATE.md §1; wiring_decisions rows)
#   R14 agree         the wire record and the plug write-up name the same far end and pin
# Populations are reported apart: v5 active (the master list), implied (grounds / power spine), April concept.

PDM30_RATING_A = {**{f"OUT{n}": 20 for n in range(1, 9)}, **{f"OUT{n}": 8 for n in range(9, 31)}}
# MoTeC PDM30 datasheet (stored text): "8 x 20 A outputs ... 22 x 8 A outputs"
SIGNAL_WIRES = {"analog_5v": 3, "analog_temp": 2, "low_side_drive": 2, "logic_coil_drive": 4}   # chapters/05 table
ENGINE_RUN = {"CORE_ENGINE", "FUEL", "COOLING", "CHARGING_STARTING", "DASH_CLUSTER_DAKOTA", "HARNESS_INFRA"}
# docs/wiring/configs/k5_engine_start_minimum.toml: "crank + run the LS3 + show gauges"
LOCKED = [
    ("PDM replaces relays — no relay/bypass designs (2026-09-24)", re.compile(r"relay(?!ed)", re.I)),
    ("Accessory drive = Holley Mid-Mount: no electric water pump (2026-09-24)", re.compile(r"electric[ _]water[ _]pump|\bewp\b", re.I)),
    ("One radiator fan (owner, Gemini thread T78; endpoints.yaml FAN)", re.compile(r"radiator[ _]fan[ _]2", re.I)),
]
SUPERSEDED = [
    ("April bulkhead/grommet scheme superseded by the one D38999 61-pin + grommet (state §1 2026-06-18, 2026-09-24)",
     re.compile(r"bulkhead_h\d|bulkhead_fuelpump|pdm30_out_wp\b|\bwp_pdm", re.I)),
    ("TB 12699160 is a Gen V SENT throttle body: position is one SENT line in its own plug, no separate TPS "
     "sensors (registry #4d)", re.compile(r"throttle position sensor [12]", re.I)),
]
TODO = re.compile(r"todo|tbd|unknown|\?|^$", re.I)
# the M130 pin-fit table for R9, run on Dave's wire names: returns first, the generic 'signal' rule last
R9_FIT = ([(r"ground|gnd|\b0 ?v\b|return", ("SEN_0V", "BAT_NEG"))]
          + [x for x in PIN_FIT if not x[0].startswith("signal|sender")]
          + [x for x in PIN_FIT if x[0].startswith("signal|sender")])
CAB, ENG, OTHER, UNK = "cab", "engine bay", "other", "unknown"


def _n(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


# April device names superseded by a later owner decision (mirrors reconcile_v5.SUPERSEDED_APR for the device checks)
SUPERSEDED_APR = [(r"Aeromotive|A1000|16301", "the truck has a Quantum hanger P367 (state 0f(c))"),
                  (r"iBoost_trigger|HB_spare_iBoost", "the iBooster wakes from PDM30 OUT9 (IBOOST_WAKE) and is fed direct (#52)"),
                  (r"T43|558-499|Holley", "the Holley T43 path is dead (receipt 2026-07-12)")]


def run_wires():
    import load_map_rows as L          # the map loader's name aliases (April/device names -> plug codes)
    import kits_v5                      # Dave's words for wire names (as R6)
    r = json.load(open(CD / "k5_registry.json"))
    pins = m130_pin_table()
    eps = r["endpoints"]
    fw = r.get("kits_meta", {}).get("firewall", {})
    bulk = {str(w): c for w, c in (eps.get("FIREWALL-ENGINE", {}).get("cavities") or {}).items()}
    grommet = {str(w) for w in fw.get("grommet", [])}
    devices = {_n(d["name"]): d for d in r["devices"]}
    alias = {_n(k): v for k, v in L.ALIASES.items()}
    code_of = lambda name: alias.get(_n(name)) or (name if name in eps else None)
    base_of = lambda x: re.split(r"\s\(|:|\s->|\s\+", str(x or ""))[0].strip()
    codeish = lambda x: code_of(base_of(x)) or (base_of(x) if base_of(x) in eps else None)
    # the body circuits' own firewall crossing (never the engine-only 61-pin: state rows 50, 53)
    body = {str(w): (eid, cav) for eid in ("FIREWALL-BODY-A", "FIREWALL-BODY-B", "FIREWALL-BODY-P", "FIREWALL-BODY-C")
            for w, cav in ((eps.get(eid) or {}).get("cavities") or {}).items()}
    BODY_RANGE = {"FIREWALL-BODY-A": (16, 20), "FIREWALL-BODY-B": (16, 20), "FIREWALL-BODY-P": (12, 14), "FIREWALL-BODY-C": (14, 20)}
    ends = defaultdict(list)
    for t in r["terminations"]:
        ends[str(t["wire"])].append(t)
    # side of the firewall for a named point
    ep_side = {c: {"cabin": CAB, "engine": ENG, "firewall": None, "unknown": UNK}.get(e.get("where"), OTHER) for c, e in eps.items()}
    zone_side = {"engine_bay": ENG, "dash": CAB, "firewall": None, "rear": OTHER, "doors": OTHER, "underbody": OTHER}
    april_side = {"engine-harness": ENG, "lighting-front": ENG, "dash-cabin": CAB}
    section_side = {"engine": ENG, "power_spine": ENG, "lighting_front": ENG, "dash_cabin": CAB,
                    "body_convenience": OTHER, "lighting_rear": OTHER, "powertrain_chassis": OTHER}

    def side(name, hint=None):
        s = str(name or "")
        base = re.split(r"\s\(|:|\s->|\s\+", s)[0].strip()       # "WIN-SW-L (ground)" / "window_motor_DS:A" -> the plug code
        if base != s and (code_of(base) or base in eps):
            s = base
        if re.match(r"^PDM15", s):
            return ENG                         # the engine PDM sits in the engine bay by the battery (working position)
        if re.match(r"^(M130|PDM30)", s) or s == "ECU" or s.startswith("FIREWALL-CABIN"):
            return CAB                         # the current map puts the M130 and PDM30 in the cab (an assumption)
        if s.startswith("FIREWALL-ENGINE"):
            return ENG
        c = code_of(s)
        if c and ep_side.get(c):
            return ep_side[c]
        d = devices.get(_n(s))
        if d and zone_side.get(d.get("zone")):
            return zone_side[d["zone"]]
        if re.search(r"kick.?panel|\bdash|\bcab\b|console|rj45|laptop|glove|under.?dash", s, re.I):
            return CAB
        if re.search(r"block|head|alternator|starter|battery|\bbat[+-]|isolator|engine", s, re.I):
            return ENG                         # the DC primary lives in the engine bay (endpoints.yaml PS-STUDS)
        return april_side.get(hint) or section_side.get(hint, UNK)

    retired_eps = set(r.get("retired_endpoints") or {})
    locked_hit = lambda *names: next((d for d, rx in LOCKED + SUPERSEDED for nm in names if nm and rx.search(str(nm))), None)
    worst = lambda sts: "FAIL" if "FAIL" in sts else "OPEN" if "OPEN" in sts else "PASS"
    out = []

    # ---------------------------------------------------------------- wires: v5 active + implied + April concept
    pop = ([("v5", w) for w in r["wires"] if not w.get("retired")] + [("implied", w) for w in r["implied"]]
           + [("april", c) for c in r["candidates"]])
    relay_loads = {}                           # a load an April relay used to switch -> the relay
    for c in r["candidates"]:
        if (re.search(r"relay", str(c["frm"].get("device")), re.I)
                and not re.search(r"relay|diode|pdm30|ign|feed|batt|fuse|gnd|ground|^g\d|stud|junction", str(c["to"].get("device")), re.I)):
            relay_loads[_n(c["to"]["device"])] = (c["frm"]["device"], c["to"]["device"])
    pdm_loads = {}
    for kind, w in pop:
        wid = str(w["id"])
        res = {}
        frm, to = w.get("frm"), w.get("to")
        label = w.get("label") or ""
        # the two ends, as (name, pin)
        if kind == "april":
            a = (frm.get("device"), frm.get("pin")); b = (to.get("device"), to.get("pin"))
        else:
            fs = str(frm or "")
            m = re.match(r"^(M130|PDM30|PDM15):(\S+)", fs)
            a = (m.group(1), m.group(2)) if m else (fs or None, None if kind == "v5" else "")
            start = None if m else codeish(fs)
            far = [t for t in ends.get(wid, []) if not str(t["endpoint"]).startswith(("M130", "PDM30", "PDM15", "FIREWALL"))
                   and t["endpoint"] != start]          # the far end is never the wire's own start (2026-09-27 fix)
            want = codeish(to) if isinstance(to, str) else None
            pick = next((t for t in far if t["endpoint"] == want), None) or (far[0] if far else None)
            if isinstance(to, dict):
                b = (to.get("device"), to.get("pin"))
            elif kind == "implied" and to:
                pin = pick.get("cavity") if pick and pick["endpoint"] == want else None
                if not pin:
                    mm = re.search(r"\(([^)]*)\)\s*$", str(to)) or re.match(r"^[^:\s]+:(\S.*)$", str(to))
                    pin = mm.group(1) if mm else ""
                b = (to, pin)
            elif pick:
                b = (pick["endpoint"], pick.get("cavity"))
            else:
                b = (None, None)
        # R8 both ends: judge each end, report the worse
        drain = re.search(r"shield drain", label, re.I)
        probs = []
        if not a[0]:
            probs.append(("FAIL", "no start point"))
        elif a[0] == "ECU" and not a[1]:
            probs.append(("OPEN", "starts at 'ECU' with no pin assigned"))
        elif a[0] in ("M130", "PDM30", "PDM15") and TODO.search(str(a[1] or "")):
            probs.append(("OPEN", f"{a[0]} pin/channel '{a[1]}' not assigned"))
        floats = drain and re.search(r"ecu end only|floats", str(w.get("notes") or ""), re.I)
        if not b[0] and floats:
            pass                               # a shield drain grounded at the ECU end only: no far end by design
        elif not b[0]:
            probs.append(("OPEN", "shield drain: floats at the sensor end? not stated") if drain
                         else ("FAIL", "no far end: the wire goes nowhere recorded"))
        elif kind == "implied" and not all(codeish(x) or re.match(r"^(M130|PDM30|PDM15):", str(x)) for x in (fs, b[0])):
            probs.append(("OPEN", " / ".join(str(x) for x in (fs, b[0]) if not (codeish(x) or re.match(r"^(M130|PDM30|PDM15):", str(x))))
                          + ": not a named plug or stud yet"))
        elif TODO.search(str(b[1] or "")) and (eps.get(codeish(b[0]) or "") or {}).get("family") not in ("ring_small", "lug"):
            probs.append(("OPEN", f"far end {b[0]}: pin '{b[1] or '—'}' not read from its pinout"))
        res["R8 ends"] = ((worst([st for st, _ in probs]), "; ".join(x for _, x in probs)) if probs
                          else ("PASS", f"{a[0]}:{a[1]} -> {b[0]}:{b[1]}"))
        # the PDM output that drives this wire: its start, or the in-line pigtail splice it starts at (SPL-<box>-OUTn,
        # registry corrections 2026-09-28 review A1) — the output is the same, only the first 16 AWG legs moved
        ms = re.match(r"^SPL-(PDM30|PDM15)-(OUT\d+)\b", str(frm or "")) if kind != "april" else None
        drv = (ms.group(1), ms.group(2)) if ms else (a[0], a[1]) if a[0] in ("PDM30", "PDM15") else (None, None)
        # R9 pin fits the job
        subs = []
        if a[0] == "M130" and a[1] and not TODO.search(a[1]):
            fn = pins.get(a[1][:3])
            job = (kits_v5.dave_name(w) if kind == "v5" else label).lower()
            want = next((ok for rx, ok in R9_FIT if re.search(rx, job)), None)
            if not fn:
                subs.append(("OPEN", f"M130 {a[1]} not in the stored pin table"))
            elif want:
                subs.append(("PASS" if any(fn[0].startswith(p) for p in want) else "FAIL", f"M130 {a[1]} = {fn[0]}"))
        if drv[0]:
            ch = re.match(r"(OUT\d+)", str(drv[1] or ""))
            if not ch and re.search(r"OUT", str(drv[1] or "")):
                subs.append(("FAIL", "PDM output channel not assigned (OUT?)"))
            elif ch:
                dev = devices.get(_n(label)) or devices.get(_n(b[0]))
                amps = dev.get("amps") if dev else None
                try:
                    amps = float(str(amps).split()[0]) if amps not in (None, "") else None
                except ValueError:
                    amps = None
                rate = PDM30_RATING_A.get(ch.group(1)) if drv[0] == "PDM30" or int(ch.group(1)[3:]) <= 15 else None
                if drv[0] == "PDM15" and int(ch.group(1)[3:]) > 15:
                    subs.append(("FAIL", f"the PDM15 has no {ch.group(1)} (OUT1-15, manual p.43)"))
                if rate and amps is not None:
                    subs.append(("PASS" if amps <= rate else "FAIL", f"{ch.group(1)} {rate} A vs load {amps} A"))
                pdm_loads[wid] = (ch.group(1), label, b[0])
        if isinstance(to, dict) and TODO.search(str(to.get("pin") or "")):
            subs.append(("OPEN", f"device pin '{to.get('pin')}' not read from the pinout"))
        if subs:
            res["R9 pin"] = (worst([s for s, _ in subs]), "; ".join(x for _, x in subs))
        # R11 command path
        if drv[0] and str(drv[1] or "").startswith("OUT") and kind != "april":
            ctl = w.get("control")
            res["R11 command"] = ("PASS", f"switched by {ctl}") if ctl else ("OPEN", "what switches this PDM output isn't recorded (a switch on a PDM input, or a CAN message from the M130)")
        load_key = _n(b[0]) if b[0] else None
        if load_key and load_key in relay_loads and kind != "april":
            ctl = w.get("control")
            res["R11 command"] = (("PASS", f"{relay_loads[load_key][0]} retired (PDM replaces relays); now {ctl}") if ctl else
                                  ("FAIL", f"{b[0]} was switched by {relay_loads[load_key][0]} (retired: PDM replaces relays); nothing replaces that command"))
        # R12 firewall
        v5_engine = kind == "april" and w.get("sub") == "engine-harness" and any(
            code_of(nm) in eps and code_of(nm) not in ("M130-A", "M130-B") for nm in (a[0], b[0]))
        hint = w.get("sub") if kind == "april" else None if kind == "implied" else (
            ("lighting_rear" if L.REAR.search(label) else "lighting_front") if w.get("subsystem") == "LIGHTING_EXTERIOR"
            else L.SUB2SECTION.get(w.get("subsystem")))
        sa, sb = side(a[0], hint), (side(b[0], hint) if b[0] else None)
        if sb is None or v5_engine:
            pass                               # no far end (R8's failure), or an April engine row the v5 list governs
        elif {sa, sb} == {CAB, ENG}:
            if wid in bulk:
                awg = w.get("awg")
                ok = isinstance(awg, int) and 20 <= awg <= 24
                res["R12 firewall"] = ("PASS" if ok else "FAIL", f"61-pin cavity {bulk[wid]}" + ("" if ok else f" but {awg} AWG (#20 contacts take 20–24 AWG)"))
            elif wid in grommet:
                res["R12 firewall"] = ("PASS", "through the grommet")
            elif wid in body:
                eid, cav = body[wid]
                lo, hi = BODY_RANGE[eid]
                awg = w.get("awg")
                ok = isinstance(awg, int) and lo <= awg <= hi
                res["R12 firewall"] = ("PASS" if ok else "FAIL", f"body bulkhead {eid[-1]} cavity {cav}"
                                       + ("" if ok else f" but {awg} AWG (its contacts take {lo}–{hi} AWG)"))
            else:
                res["R12 firewall"] = ("FAIL", f"crosses the firewall ({a[0]} in the {sa} -> {b[0]} in the {sb}) with no path")
        elif {sa, sb} == {CAB, OTHER} and kind != "april" and wid in body:
            eid, cav = body[wid]
            lo, hi = BODY_RANGE[eid]
            awg = w.get("awg")
            ok = isinstance(awg, int) and lo <= awg <= hi
            res["R12 firewall"] = ("PASS" if ok else "FAIL", f"cab exit: body bulkhead {eid[-1]} cavity {cav}"
                                   + ("" if ok else f" but {awg} AWG (its contacts take {lo}–{hi} AWG)"))
        elif {sa, sb} == {CAB, OTHER} and kind != "april" and any(
                "crossing: bulkhead C" in " ".join(map(str, (eps.get(codeish(x) or "") or {}).get("open") or []))
                or "crossing: bulkhead C" in str(w.get("notes") or "") for x in (a[0], b[0])):
            res["R12 firewall"] = ("OPEN", "crosses cab -> chassis through the body crossing: bulkhead C, cavity OPEN "
                                           "(the engine-only 61-pin is not its path, state row 50)")
        elif UNK in (sa, sb) and CAB in (sa, sb) and kind != "april":
            res["R12 firewall"] = ("OPEN", f"can't tell which side {a[0] if sa == UNK else b[0]} is on")
        # R13 locked decisions
        hit = locked_hit(a[0], b[0], label)
        if hit or (b[0] and code_of(b[0]) in retired_eps):
            res["R13 locked"] = ("FAIL", f"contradicts '{hit or 'a retired endpoint'}'" + (" — retired on the map, still in the registry source" if kind == "april" else ""))
        # R14 records agree (v5 only: wire record 'to' vs the plug write-up)
        if kind == "v5" and isinstance(to, dict):
            far = [t for t in ends.get(wid, []) if not str(t["endpoint"]).startswith(("M130", "PDM30", "PDM15", "FIREWALL"))]
            rec = code_of(to.get("device"))
            if far and rec and rec not in {t["endpoint"] for t in far}:
                res["R14 agree"] = ("FAIL", f"record says {to.get('device')} ({rec}); write-up ends at {', '.join(t['endpoint'] for t in far)}")
            elif far and TODO.search(str(to.get("pin") or "")) and far[0].get("cavity") and not TODO.search(str(far[0].get("cavity"))):
                # (a record and a plug that both say the pin is unknown agree; R8 already stamps it OPEN — 2026-09-28)
                res["R14 agree"] = ("FAIL", f"record pin '{to.get('pin')}'; write-up has cavity {far[0].get('cavity')} at {far[0]['endpoint']}")
            elif not far and code_of(to.get("device")) in eps and not str(to.get("device")).startswith(("M130",)):
                res["R14 agree"] = ("OPEN", f"record says {to.get('device')}; its write-up doesn't list this wire")
        eng_run = (w.get("subsystem") in ENGINE_RUN) if kind != "april" else (w.get("sub") == "engine-harness")
        out.append({"wire": wid, "kind": kind, "label": label, "from": a, "to": b, "sides": (sa, sb),
                    "from_str": (str(frm) if kind != "april" else None), "control": (w.get("control") if kind != "april" else None),
                    "subsystem": w.get("subsystem") or w.get("sub"), "engine_run": eng_run, "rules": res})

    # ---------------------------------------------------------------- devices: R10 circuit complete, R13 locked
    at_device = defaultdict(set)
    for x in out:
        for nm in (x["from"][0], x["to"][0], x["label"], x.get("from_str")):
            if nm:
                at_device[_n(nm)].add((x["wire"], x["kind"]))
                if codeish(nm):
                    at_device[_n(codeish(nm))].add((x["wire"], x["kind"]))
    dev_out = []
    for key, d in devices.items():
        res = {}
        need = SIGNAL_WIRES.get(d.get("signal"))
        if need and not locked_hit(d["name"]):          # a dead device needs no circuit
            have = {w for w in at_device.get(key, set())} | {w for w in at_device.get(_n(code_of(d["name"]) or ""), set())}
            v5n = sum(1 for _, k in have if k != "april")
            res["R10 circuit"] = ("PASS" if len(have) >= need else "FAIL",
                                  f"{d.get('signal')} needs {need} wires; has {len(have)} ({v5n} decided, {len(have) - v5n} concept)")
        hit = locked_hit(d["name"])
        if hit:
            res["R13 locked"] = ("FAIL", f"device contradicts '{hit}'")
        if res:
            dev_out.append({"device": d["name"], "zone": d.get("zone"), "signal": d.get("signal"), "rules": res})

    ctl_at = defaultdict(list)                  # plug code -> commands recorded on redesigned wires landing there
    for x in out:
        if x["kind"] != "april" and x.get("control"):
            for nm in (x["to"][0], x.get("from_str")):
                if nm and codeish(nm):
                    ctl_at[codeish(nm)].append(x["control"])
    for key, (relay, load) in relay_loads.items():
        sup = next((why for rx, why in SUPERSEDED_APR if re.search(rx, load)), None)
        cmds = ctl_at.get(codeish(load) or "", [])
        verdict = (("PASS", f"{relay} retired; the load is superseded: {sup}") if sup else
                   ("PASS", f"{relay} retired (PDM replaces relays); now {cmds[0]}") if cmds else
                   ("FAIL", f"was switched by {relay} (retired: PDM replaces relays); needs a PDM output and a recorded command"))
        dev_out.append({"device": load, "zone": None, "signal": None, "rules": {"R11 command": verdict}})

    # ---------------------------------------------------------------- system
    # the CAN bus, hop by hop: every node the design puts on it must be reached by a wire with both ends
    byid = {x["wire"]: x for x in out}
    hops = [("M130", "PDM30", ["CAN_HI", "CAN_LO"]), ("PDM30", "PDM15", ["CAN_FW_H", "CAN_FW_L"]), ("PDM15", "LTCD", ["CAN_LTCD_H", "CAN_LTCD_L"])]
    hop_txt, hop_ok = [], True
    for a_, b_, ids in hops:
        ok = all(i in byid and byid[i]["to"][0] and byid[i]["rules"].get("R8 ends", ("FAIL",))[0] != "FAIL" for i in ids)
        hop_ok &= ok
        hop_txt.append(f"{a_}→{b_} {'ok' if ok else 'MISSING'} ({'/'.join(ids)})")
    system = {
        "CAN bus": ("PASS" if hop_ok else "FAIL", "; ".join(hop_txt) + " — the PDMs take commands over CAN (MoTeC PDM manual "
                    "p.39: 4 messages × 8 bytes; p.23: a message that stops arriving times out); 100R at each end (p.50)"),
        "Body bulkhead": ("PASS" if all(sum(1 for e, _ in body.values() if e == k) <= n for k, n in
                                         (("FIREWALL-BODY-A", 12), ("FIREWALL-BODY-B", 12), ("FIREWALL-BODY-P", 4), ("FIREWALL-BODY-C", 6))) else "FAIL",
                          " · ".join(f"{k[-1]} {sum(1 for e, _ in body.values() if e == k)}/{n}" for k, n in
                                     (("FIREWALL-BODY-A", 12), ("FIREWALL-BODY-B", 12), ("FIREWALL-BODY-P", 4), ("FIREWALL-BODY-C", 6)))
                          + " — body circuits cross here, never the engine-only 61-pin (state rows 50, 53)"),
        "61-pin cavities": ("PASS" if len(bulk) <= 61 else "FAIL",
                            f"{len(bulk)}/61 used · spare {', '.join(fw.get('spare_cavities', [])) or 'none'} · "
                            f"assumes the M130 and PDM30 in the cab"),
    }
    return out, dev_out, system


def report_wires(args):
    out, dev_out, system = run_wires()
    pops = [("v5", "v5 active"), ("implied", "implied"), ("april", "April concept")]
    rules = sorted({k for x in out for k in x["rules"]})
    print("WIRES — R8–R14 over k5_registry.json · assumed positions: M130 + PDM30 in the cab, PDM15 in the engine bay by the battery")
    print(f"  {'':14s}" + "".join(f"{lbl + ' (' + str(sum(1 for x in out if x['kind'] == k)) + ')':>30s}" for k, lbl in pops))
    for rule in rules:
        cells = []
        for k, _ in pops:
            c = Counter(x["rules"][rule][0] for x in out if x["kind"] == k and rule in x["rules"])
            cells.append(f"P{c['PASS']:4d} F{c['FAIL']:4d} O{c['OPEN']:4d}" if c else "—")
        print(f"  {rule:14s}" + "".join(f"{cl:>30s}" for cl in cells))
    er = [x for x in out if x["engine_run"] and x["kind"] != "april"]
    clean = [x for x in er if all(s == "PASS" for s, _ in x["rules"].values())]
    print(f"\nENGINE-RUN SET (k5_engine_start_minimum: {', '.join(sorted(ENGINE_RUN))}): {len(er)} wires · every rule PASS: "
          f"{len(clean)} · any FAIL: {sum(1 for x in er if any(s == 'FAIL' for s, _ in x['rules'].values()))}")
    print("\nSYSTEM")
    for k, (st, why) in system.items():
        print(f"  {st:4s} {k}: {why}")
    dc = Counter((k, v[0]) for d in dev_out for k, v in d["rules"].items())
    print("\nDEVICES")
    for rule in sorted({k for k, _ in dc}):
        print(f"  {rule:14s} PASS {dc[(rule, 'PASS')]:3d}  FAIL {dc[(rule, 'FAIL')]:3d}")
    only = args[args.index("--list") + 1] if "--list" in args else None
    if only:
        print(f"\n{only} — FAIL and OPEN, v5 + implied first")
        for x in sorted(out, key=lambda x: (x["kind"] == "april", x["kind"], x["wire"])):
            st = next(((s, why) for k, (s, why) in x["rules"].items() if k.startswith(only)), None)
            if st and st[0] != "PASS":
                print(f"  {st[0]:4s} {x['kind']:7s} #{x['wire']:<16s} {x['label'][:34]:34s} {st[1][:150]}")
        for d in dev_out:
            st = next(((s, why) for k, (s, why) in d["rules"].items() if k.startswith(only)), None)
            if st and st[0] != "PASS":
                print(f"  {st[0]:4s} device  {d['device'][:52]:52s} {st[1][:120]}")
    (CD / "WIRE_CHECKS.json").write_text(json.dumps({"wires": out, "devices": dev_out, "system": system}, indent=1, default=list) + "\n")
    return any(s == "FAIL" for x in out for s, _ in x["rules"].values())


def main():
    if "--wires" in sys.argv:
        sys.exit(1 if report_wires(sys.argv) else 0)
    res = run()
    only = sys.argv[sys.argv.index("--endpoint") + 1] if "--endpoint" in sys.argv else None
    if only:
        res = [x for x in res if x["endpoint"] == only]
    tally = defaultdict(Counter)
    for x in res:
        for rule, (st, _) in x["rules"].items():
            tally[rule][st] += 1
    ends = len(res)
    clean = sum(1 for x in res if all(st == "PASS" for st, _ in x["rules"].values()))
    fails = [x for x in res if any(st == "FAIL" for st, _ in x["rules"].values())]
    print(f"wire ends: {ends} · every rule PASS: {clean} · any FAIL: {len(fails)} · rest OPEN somewhere: {ends - clean - len(fails)}")
    # round 4 lint: every endpoint part code has a parts.yaml row (explicit kit / OPEN markers aside), so the parts lists print it
    reg_ = json.load(open(CD / "k5_registry.json")); parts_ = y("parts.yaml")
    marker = re.compile(r"^(open \(|OPEN|rail splice|kit terminal$|seal$|D-609 \(gauge unknown\)|RING-SMALL$)")
    codes_ = set()
    for ep_ in reg_["endpoints"].values():
        codes_ |= {str(c) for c in (ep_.get("kit") or {})}
    for t_ in reg_["terminations"]:
        codes_ |= {c for c in str(t_.get("part") or "").split(" + ") if c}
    missing_ = sorted(c for c in codes_ if c not in parts_ and not marker.match(c))
    print(f"parts lint: {'PASS' if not missing_ else 'FAIL'} — {len(missing_)} endpoint part codes with no parts.yaml row" + (f": {missing_}" if missing_ else ""))
    lead_ends = [x for x in res if str(x.get("part") or "").startswith("D-609")]
    print(f"device-lead MiniSeal splices: {len({(x['endpoint'], str(x['cavity'])) for x in lead_ends})} for {len(lead_ends)} wire ends "
          f"(a lead shared by several wires is one splice)")
    for rule in sorted(tally):
        c = tally[rule]
        print(f"  {rule:11s} PASS {c['PASS']:4d}  FAIL {c['FAIL']:3d}  OPEN {c['OPEN']:4d}")
    if "--fails" in sys.argv:
        for x in fails:
            bad = {k: v for k, v in x["rules"].items() if v[0] == "FAIL"}
            print(f"\nFAIL {x['endpoint']} · #{x['wire']} {x['name']} (cavity {x['cavity']})")
            for k, (_, why) in bad.items():
                print(f"   {k}: {why}")
    if "--open" in sys.argv:
        why = Counter(f"{k}: {re.sub(r'[0-9]+', 'N', v[1])[:90]}" for x in res for k, v in x["rules"].items() if v[0] == "OPEN")
        print("\nOPEN, by reason:")
        for k, n in why.most_common(25):
            print(f"  {n:4d}  {k}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
