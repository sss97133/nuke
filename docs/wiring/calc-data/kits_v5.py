#!/usr/bin/env python3
"""kits_v5.py — per-plug kits, tools per step, BOM, and the carts diff (paper build-out, Phases 3 + 5).

Called by reconcile_v5.py so ONE command rebuilds the whole registry. Attaches to the registry:
  endpoints     every plug/stud/port with its wires, kit, per-end parts and open items
  terminations  every wire end: where it lands, the part that terminates it, the family (steps + tools)
  bom           parts needed for the current scope, derived — never typed
  carts         the staged carts (orders/*.json), as captured
  diff          BOM vs carts, line by line: covered / short / extra / not claimed / missing
  cart_changes  the ProWire edits that would bring the staged cart to the design (a view; the cart is
                a reference until the paper build-out passes — owner 2026-09-26)
  tools         every tool the steps call for, with who uses it and its status
and writes calc-data/KITS_REPORT.md (generated; *_REPORT.md is gitignored — rerun to see it).

Inputs (curated, cited): catalog/parts.yaml, tools.yaml, families.yaml, endpoints.yaml;
orders/*.json (cart snapshots); the firewall cavity map is IMPORTED from
scripts/generate_connector_build_sheets.py (assign_bulkhead, OVERFLOW, DIRECT_FEED, PDM pin maps).

Deferred by design (owner 2026-09-26; canon ch.18 §6–8): cut lengths, twist/turns, and which wires
share a DR-25/SCL sleeve. Wire feet here are zone estimates × the locked pad (state row 33).
"""
import importlib.util
import json
import math
import re
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[3]   # the checkout this file lives in (was hard-coded /Users/skylar/nuke)
CD = REPO / "docs/wiring/calc-data"
CAT = CD / "catalog"
ORD = CD / "orders"
SHEETS = REPO / "scripts/generate_connector_build_sheets.py"
OUT_REP = CD / "KITS_REPORT.md"

MIL = {"black": "0", "brown": "1", "red": "2", "orange": "3", "yellow": "4", "green": "5",
       "blue": "6", "violet": "7", "gray": "8", "grey": "8", "white": "9"}
MIL_NAME = {v: k for k, v in MIL.items() if k != "grey"}
PAD_ENGINE, PAD_BODY = 1.20, 1.15            # state row 33: 20 % engine bay, 15 % body
CMA = {24: 404, 22: 642, 20: 1020, 18: 1620, 16: 2580, 14: 4110, 12: 6530}   # AWG circular mils
MINISEAL = [("D-609-03", 26, 20), ("D-609-04", 20, 16), ("D-609-05", 16, 12)]  # prowire 3137ct cavities
ENGINE_ONLY_OFF = {"23", "50", "73", "83", "84", "87", "88", "80", "82"}     # state row 50 (Dave, 2026-06-18)
# chassis circuits the June build sheet listed as 61-pin overflow; they cross in the body crossing instead (state row 50)
CHASSIS_OFF = {"100": "speed sender (Dakota SEN-01-5 on the NP205) is a chassis circuit: crossing = bulkhead C, cavity OPEN "
                      "(review A11, receipt 2026-09-28 registry corrections)"}
SHIELD_CABLES = {"99": "99g", "101": "101g", "103": "103g", "104": "104g"}   # M27500 2C: signal + cond 2
POOL_STATUS = {
    "jacket": "stock — DR-25 sized per bundle at the formboard",
    "seal_shrink": "stock — SCL sized per joint at the formboard",
    "lug_shrink": "stock — CPA per lug at the formboard",
    "markers": "stock — colour-ring cavity codes (Dave's method)",
    "power_spine": "power-spine chapter (DC primary) — claimed there",
}
WHITE_STOCK = ("prototype stock — Dave's method: pull one colour at max length, verify on the truck, "
               "cut last (state §2, row 'Calculate maximum distance first'); 61-pin wires white + colour rings (state 0i)")
# ProWire's in-stock striped M22759/16-22 colour codes (category page 'M22759-16-22-gauge-in-stock-striped-wire',
# fetched 2026-09-26 by the carts session): these are sold as -PRSP; the other /16-22 stripes as the plain code.
PRSP16_22 = {"10", "14", "23", "28", "30", "36", "37", "38", "41", "47", "48", "50", "57", "58", "61", "62",
             "67", "68", "70", "71", "72", "75", "76", "79"}
TRIM_MIN_USD = 25        # list a line as 'trim' only when the unneeded feet cost at least this much


def _load_sheets():
    spec = importlib.util.spec_from_file_location("conn_sheets", SHEETS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _y(name):
    data = yaml.safe_load((CAT / name).read_text())
    if name == "endpoints.yaml":
        # per-plug pin tables read from makers' documents live one file per plug in catalog/pin_tables/<CODE>.yaml
        # ({CODE: {family, kit, pins, open, sources, ...}}); they overlay the base entry key by key, never replace it
        for f in sorted((CAT / "pin_tables").glob("*.yaml")):
            for code, over in (yaml.safe_load(f.read_text()) or {}).items():
                base = data.setdefault(code, {})
                for k, v in (over or {}).items():
                    if k == "pins" and isinstance(base.get("pins"), dict) and isinstance(v, dict):
                        base["pins"] = {**base["pins"], **v}
                    elif k in ("sources", "open") and isinstance(base.get(k), list) and isinstance(v, list):
                        base[k] = list(dict.fromkeys(base[k] + v))
                    else:
                        base[k] = v
    return data


def awg_equiv(cma):
    """Smallest standard AWG whose area covers `cma` (for combined-wire splice sizing)."""
    for g in sorted(CMA, reverse=True):
        if CMA[g] >= cma:
            return g
    return 10


def splice_for(awgs):
    """MiniSeal colour by the combined area of the wires entering one side (engineering rule:
    total circular mils → equivalent AWG → the 3137CT cavity range that holds it)."""
    eq = awg_equiv(sum(CMA.get(a, 0) for a in awgs))
    for code, lo, hi in MINISEAL:
        if hi <= eq <= lo:
            return code, eq
    return None, eq


def wire_keys(w):
    """[(spec, awg, MIL colour code)] for a registry wire — one per conductor ("yellow + green" is a
    twisted pair = two conductors; "white/red" is one white wire with a red stripe). [] = not stock."""
    spec, awg, col = (w.get("spec") or ""), w.get("awg"), (w.get("color") or "").strip().lower()
    if not isinstance(awg, int):
        return []
    if spec.startswith("M27500"):
        return [("M27500-2C", awg, "shield")]
    m = re.match(r"(M22759/(?:16|32))", spec)
    if not m:
        return []
    keys = []
    for cond in col.split("+"):
        parts = [p.strip() for p in cond.split("/") if p.strip()]
        if not parts or any(p not in MIL for p in parts):
            return []
        keys.append((m.group(1), awg, "".join(MIL[p] for p in parts[:2])))
    return keys


def code_key(code):
    m = re.match(r"(M22759/(?:16|32))-(\d+)-(\d+)(?:-PRSP)?$", code)
    if m:
        return (m.group(1), int(m.group(2)), m.group(3))
    m = re.match(r"M27500-(\d+)ML2T08$", code)
    if m:
        return ("M27500-2C", int(m.group(1)), "shield")
    return None


def key_label(k):
    spec, awg, c = k
    if c == "shield":
        return f"{awg} AWG shielded 2-conductor"
    return f"{spec} {awg} AWG {'/'.join(MIL_NAME[ch] for ch in c)}"


def attach(reg):
    parts, tools, fams, eps = _y("parts.yaml"), _y("tools.yaml"), _y("families.yaml"), _y("endpoints.yaml")
    sheets = _load_sheets()
    carts = [json.loads(p.read_text()) for p in sorted(ORD.glob("*.json"))]

    wires = {w["id"]: w for w in reg["wires"]}
    wires.update({w["id"]: w for w in reg["implied"]})
    retired = {w["id"] for w in reg["wires"] if w.get("retired")}

    # ------------------------------------------------ firewall: the build-sheet cavity map, then the engine-only rule
    assigned, spare = sheets.assign_bulkhead(None)
    bulk = {wid: cav for cav, wid in assigned.items() if wid}
    body_off = sorted(w for w in bulk if w in ENGINE_ONLY_OFF)
    overflow = [w for w, _ in sheets.OVERFLOW if w in wires and w not in retired and not wires[w].get("superseded")]
    # 2026-09-27 crossings: the CAN pair to the engine PDM15 and the isolator's ECU-shutdown wire take spare cavities
    overflow += [w for w in ("CAN_FW_H", "CAN_FW_L", "DAK_CTS_RET", "DAK_OILP_5V", "DAK_OILP_GND")
                 if w in wires and w not in overflow]
    grommet = [w for w, _, _ in sheets.DIRECT_FEED if w in wires and w not in retired]
    for g in ("ECU_GND1", "ECU_GND2", "PDM_GND1", "PDM_GND2", "PDM_BPOS", "GND_RET_CAB"):
        if g in wires and g not in grommet:
            grommet.append(g)     # battery-corner returns/feeds from the cabin boxes, too big or not mapped
    crossing = [w for w in bulk if w not in ENGINE_ONLY_OFF and w in wires and w not in retired] + overflow
    free_after = 61 - len(crossing)
    # Proposed: overflow wires take the cavities freed by the engine-only rule (state row 50) and by retired rows,
    # nearest to their parent signal's cavity — rule R3 of scripts/generate_connector_build_sheets.py.
    freed = sorted([c for c, w in assigned.items() if w and (w in ENGINE_ONLY_OFF or w in retired)] + list(spare))
    parent = {"102g": "102", "102r": "102", "112g": "112", "112r": "112", "114": "110", "115": "102",
              "DAK_CTS_RET": "114", "DAK_OILP_5V": "115", "DAK_OILP_GND": "115"}
    reassigned = {}
    for w in overflow:
        anchor = bulk.get(parent.get(w, ""), None)
        if anchor and freed:
            ax, ay = sheets.CAV_XY[anchor]
            freed.sort(key=lambda c: (sheets.CAV_XY[c][0] - ax) ** 2 + (sheets.CAV_XY[c][1] - ay) ** 2)
        if freed:
            reassigned[w] = freed.pop(0)
    bulk.update(reassigned)
    bulk_spare = sorted(freed)
    # wires the engine PDM15 drives stay in the engine bay (2026-09-27): they no longer cross the firewall, so they give
    # their 61-pin cavities back and leave the power grommet
    engine_local = {w for w in wires if str(wires[w].get("frm") or "").startswith("PDM15:")}
    for w in [w for w in bulk if w in engine_local]:
        bulk_spare.append(bulk.pop(w))
    # spares = every cavity no CROSSING wire holds (the engine-only rule's 9 body circuits keep a stale entry in `bulk`)
    bulk_spare = sorted(set(sheets.CAV_XY) - {bulk[w] for w in crossing if w in bulk}, key=str)
    crossing = [w for w in crossing if w not in engine_local]
    # crossing wires still without a cavity take the spares the engine-local wires gave back, nearest their parent signal
    bulk_spare = sorted(set(sheets.CAV_XY) - {bulk[w] for w in crossing if w in bulk}, key=str)
    for w in [w for w in crossing if w not in bulk]:
        if not bulk_spare:
            break
        anchor = bulk.get(parent.get(w, ""), None)
        if anchor:
            ax, ay = sheets.CAV_XY[anchor]
            bulk_spare.sort(key=lambda c: (sheets.CAV_XY[c][0] - ax) ** 2 + (sheets.CAV_XY[c][1] - ay) ** 2)
        bulk[w] = reassigned[w] = bulk_spare.pop(0)
    bulk_spare = sorted(bulk_spare, key=str)
    # chassis circuits leave the 61-pin AFTER the nearest-cavity pass, so no other wire's cavity moves (review A11)
    for w in CHASSIS_OFF:
        if w in bulk and w in crossing:
            crossing.remove(w)
            bulk_spare = sorted(bulk_spare + [bulk.pop(w)], key=str)
            reassigned.pop(w, None)
            overflow = [x for x in overflow if x != w]
    grommet = [w for w in grommet if w not in engine_local]
    # 2026-09-27 whole truck: rows the April direct-feed list put in the grommet that no longer cross there
    GROMMET_OFF = {"51": "the blower feed ends at the control-head switch in the cab; its speed leads cross in body bulkhead B",
                   "48": "the horn feed crosses in body bulkhead B", "49": "the wiper feed crosses in body bulkhead B",
                   "6": "distribution stud -> starter: both in the engine bay (chapters/17 §17.3)",
                   "59": "alternator -> distribution stud: both in the engine bay (chapters/17 §17.3)",
                   "63": "battery -> isolator: both in the engine bay (chapters/17 §17.3)",
                   "52": "distribution stud -> iBooster: both on the engine side of the firewall"}
    grommet = [w for w in grommet if w not in GROMMET_OFF]

    # ------------------------------------------------ ECU/PDM pin maps
    pin_re = re.compile(r"^(M130|PDM30|PDM15):([AB])(\d{1,2})\b")
    out_pins = defaultdict(list)
    for pin, f in sheets.PDM_A_PIN.items():
        out_pins[f].append(("A", pin))
    for pin, f in sheets.PDM_B_PIN.items():
        out_pins[f].append(("B", pin))

    def ecu_pins(w):
        """[(box, conn, pin)] where wire w lands on the M130 / PDM30 / PDM15, from its FROM field. The PDM15 uses the
        PDM30's pin positions for everything it has (MoTeC PDM user manual p.43: OUT1-15, DIG1-16, 0V, CAN, Batt-)."""
        frm = (w.get("frm") or "").strip()
        m = pin_re.match(frm)
        if m:
            got = [(m.group(1), m.group(2), int(m.group(3)))]
        else:
            m = re.match(r"^(PDM30|PDM15):(OUT\d+|DIG\d+|GND|VBAT-|CANHI|CANLO)\b", frm)
            got = [(m.group(1), c, p) for c, p in out_pins.get(m.group(2), [])] if m else []
        # a far end named as one ECU/PDM pin ends there too (2026-09-28 power-spine review: ISO_KILL at M130 B14, ECU_PWR at
        # PDM30 B6, CAN_FW_H/L at PDM15 B26/B25 had no termination row). A record naming two pins ("B26 ... / B25 ...") is a
        # pair modelled as one wire and stays as it is.
        to = w.get("to")
        tt = to if isinstance(to, str) else (f"{to.get('device')}:{to.get('pin')}" if isinstance(to, dict)
                                              and to.get("device") in ("M130", "PDM30", "PDM15") else "")
        m = pin_re.match(str(tt).strip())
        if m and "/" not in str(tt):
            got.append((m.group(1), m.group(2), int(m.group(3))))
        return got

    # ------------------------------------------------ dead endpoints leave the registry
    # An endpoint is dead when it is retired itself, or when every wire it lists is retired. The #25 lesson
    # (2026-09-27): the wire was retired, its device lived on, reached the map, and was asked of the owner.
    dead = {eid: ep.get("retired") or "every wire it lists is retired: " + ", ".join(map(str, ep["wires"]))
            for eid, ep in eps.items()
            if ep.get("retired") or (isinstance(ep.get("wires"), list) and ep["wires"]
                                     and all(str(w) in retired for w in ep["wires"]))}
    for eid in dead:
        eps.pop(eid)
    reg["retired_endpoints"] = dead
    reg.setdefault("kits_meta", {}).setdefault("grommet_off", GROMMET_OFF)

    # ------------------------------------------------ resolve endpoints → wires
    resolved, terms, need = OrderedDict(), [], Counter()
    replaced = {}
    splices, unresolved_pins = [], []
    for eid, ep in eps.items():
        spec = ep.get("wires") or []
        wl, cav_of = [], {}
        if isinstance(spec, dict) and "pins" in spec:
            box, conn = spec["pins"].split(":")
            for w in wires.values():
                if w["id"] in retired:
                    continue
                for b, c, p in ecu_pins(w):
                    if b == box and c == conn:
                        wl.append(w["id"])
                        cav_of[w["id"]] = f"{c}{p:02d}"
        elif isinstance(spec, dict) and "pdm" in spec:
            for w in wires.values():
                if w["id"] in retired:
                    continue
                pins = [(c, p) for b, c, p in ecu_pins(w) if b == spec.get("box", "PDM30") and c == spec["pdm"]]
                if pins:
                    wl.append(w["id"])
                    cav_of[w["id"]] = "+".join(f"{c}{p}" for c, p in pins)
        elif isinstance(spec, dict) and spec.get("bulkhead"):
            wl = list(crossing)
            cav_of = {w: bulk.get(w, "NEEDS CAVITY") for w in crossing}
            if bulk_spare:
                need["MS27488-20-2"] += len(bulk_spare)   # one plug per spare cavity in THIS shell's grommet
        elif isinstance(spec, dict) and spec.get("grommet"):
            wl = list(grommet)
        elif ep.get("pins"):
            cav_of = {str(k): str(v) for k, v in ep["pins"].items()}
            wl = list(cav_of)
        else:
            wl = [str(x) for x in spec]
        missing_ids = [w for w in wl if w not in wires]
        wl = [w for w in wl if w in wires and w not in retired]

        doubled = {str(x) for x in (ep.get("doubled") or [])}
        fam = fams.get(ep.get("family")) or {}
        rng = ep.get("range", fam.get("wire_range_awg"))
        out_of_range = []
        pigtailed = []
        if isinstance(rng, list):
            small, big = max(rng), min(rng)
            for w in wl:
                a = wires[w].get("awg")
                if not isinstance(a, int) or big <= a <= small:
                    continue
                if eid.startswith(("PDM30", "PDM15")) and a < big:
                    # a paired 20 A output takes two 16 AWG pigtails; a single 8 A pin can't (review A1, PDM manual p.48)
                    note = (f"{w} {a} AWG: 2 × 16 AWG pigtails + M81824/1-3 in-line" if "+" in str(cav_of.get(w, ""))
                            else f"{w} {a} AWG on a single 8 A pin: OPEN — one 16 AWG pigtail + M81824/1-3, or a lighter wire "
                                 "(PDM manual p.48: 24# to 20# on 8 A outputs)")
                    if a < 12:
                        note += " — load wire is past D-609-05's 16–12 range: step-down splice or a 12 AWG run"
                    pigtailed.append(note)
                else:
                    out_of_range.append(f"{w} ({a} AWG vs {small}–{big})")

        # kit parts, once per endpoint
        for code, q in (ep.get("kit") or {}).items():
            need[str(code)] += q
        for w, lug in (ep.get("lugs") or {}).items():
            for code in (lug if isinstance(lug, list) else [lug]):
                need[code] += 1

        # per-wire-end parts from the family
        fid = ep.get("family")
        per_end = []
        if fid == "ssc":
            by_cav = defaultdict(list)
            for w in wl:
                for cv in cav_of.get(w, "").split("+"):
                    if cv:
                        by_cav[cv].append(w)
            need["SSC-N"] += len(by_cav)
            empty = (ep.get("cavities") or 0) - len(by_cav)
            if ep.get("cavities"):
                need["4-1437284-3"] += max(0, empty)
            for cv, ws in sorted(by_cav.items()):
                if len(ws) > 1:
                    awgs = [wires[x]["awg"] for x in ws if isinstance(wires[x]["awg"], int)]
                    code, eq = splice_for(awgs)
                    if code:
                        splices.append({"at": f"{eid} {cv}", "wires": ws, "splice": code, "equiv_awg": eq})
                        need[code] += 1
                        continue
                    # too big for one MiniSeal: groups that fit D-609-05 with a 20 AWG lead out, then one join
                    per = max(1, (CMA[12] - CMA[20]) // max(CMA.get(a, 642) for a in awgs))
                    groups = [ws[i:i + per] for i in range(0, len(ws), per)]
                    for g in groups:
                        gc, ge = splice_for([wires[x]["awg"] for x in g] + [20])
                        splices.append({"at": f"{eid} {cv}", "wires": g + ["20 AWG lead"], "splice": gc, "equiv_awg": ge})
                        need[gc] += 1
                    jc, je = splice_for([20] * (len(groups) + 1))
                    splices.append({"at": f"{eid} {cv}", "wires": [f"{len(groups)} group leads", "pin lead"], "splice": jc, "equiv_awg": je})
                    need[jc] += 1
            per_end = [{"cavity": cv, "wires": ws, "part": "SSC-N"} for cv, ws in sorted(by_cav.items())]
        elif fid == "d38999_20":
            part = fam["per_end"]["contact_cabin" if ep.get("side") == "cabin" else "contact_engine"]
            need[part] += len(wl)
            per_end = [{"cavity": cav_of.get(w), "wires": [w], "part": part} for w in wl]
        elif ep.get("per_end") or fid in ("gt150", "mp150", "ev1"):
            pe_cfg = ep.get("per_end") or {"gt150": {"part": "12191818", "seal": "15366021"},
                                            "mp150": {"part": "12110847", "seal": "15324976"},
                                            "ev1": {"part": "68102"}}[fid]
            for w in wl:
                need[str(pe_cfg["part"])] += 1
                if pe_cfg.get("seal"):
                    need[str(pe_cfg["seal"])] += 1
            label = " + ".join(str(x) for x in (pe_cfg["part"], pe_cfg.get("seal")) if x)
            per_end = [{"wires": [w], "part": label, "cavity": cav_of.get(w)} for w in wl]
        elif fid == "ring_small":
            # a named ground stud (G-*) takes one ring per wire, stacked; other ring endpoints keep their shared rings
            per_end = [{"wires": [w], "part": "RING-SMALL", "cavity": f"ring {i}" if eid.startswith(("G-", "GND-")) else "ring"}
                       for i, w in enumerate(wl, 1)]
        elif fid in ("kit_terminal", "te_amp_plug"):
            per_end = [{"wires": [w], "part": "kit terminal + seal", "cavity": cav_of.get(w)} for w in wl]
        elif fid == "lug":
            per_end = [{"wires": [w], "part": " + ".join(ep["lugs"].get(w, []) if isinstance(ep["lugs"].get(w), list)
                                                         else [ep["lugs"].get(w, "?")])} for w in wl]
        elif fid == "miniseal":
            by_g = fam.get("per_end", {}).get("splice_by_gauge", {})
            def _splice(awg):
                for rng, code in by_g.items():
                    lo, hi = sorted(int(x) for x in str(rng).split("-"))
                    if isinstance(awg, int) and lo <= awg <= hi:
                        return code
                return "D-609 (gauge unknown)"
            rail = bool(ep.get("kit"))                      # the rails carry their D-609-05s in the kit already
            per_end = []
            for i, w in enumerate(wl, 1):
                code = "rail splice (in the kit)" if rail else _splice(wires[w].get("awg"))
                if not rail and not code.startswith("D-609 ("):
                    need[code] += 1
                per_end.append({"wires": [w], "part": code, "cavity": cav_of.get(w) or f"splice {i}"})
        elif fid in ("open", None, "none", "unknown"):
            # connector not picked yet: the wire still ends here (the map and the checks need the end); the part stays open
            per_end = [{"wires": [w], "part": "open (connector not picked)", "cavity": cav_of.get(w)} for w in wl]

        for pe in per_end:
            for w in pe["wires"]:
                terms.append(OrderedDict(wire=w, endpoint=eid, where=ep.get("where"), cavity=pe.get("cavity"),
                                         part=pe["part"], family=fid,
                                         doubled=(w in doubled) or None))
        for code in (ep.get("replaces_cart") or []):
            replaced[str(code)] = eid
        resolved[eid] = OrderedDict(
            device=ep.get("device"), where=ep.get("where"), family=fid, kit=ep.get("kit") or {},
            wires=wl, cavities=cav_of or None, empty=ep.get("empty"), doubled=sorted(doubled) or None,
            range=rng, out_of_range=[x for x in out_of_range if x.split(" ")[0] not in doubled],
            pigtailed=pigtailed, note=ep.get("note"),
            branch_wires_missing=ep.get("branch_wires_missing", 0), unknown_wire_ids=missing_ids,
            open=ep.get("open", []), sources=ep.get("sources", []), splice_point=ep.get("splice_point"))

    # shield terminations: one solder sleeve per shielded cable (ECU end only)
    for sig in SHIELD_CABLES:
        if sig in wires:
            need["S02-03-R"] += 1
    # PDM 20 A outputs: two 16 AWG pigtails per output, joined to the load wire (registry meta note)
    pdm_pairs = [(w, cv) for w, cv in (resolved.get("PDM30-A", {}).get("cavities") or {}).items() if "+" in cv]
    pdm_pairs += [(w, cv) for w, cv in (resolved.get("PDM30-B", {}).get("cavities") or {}).items() if "+" in cv]
    for w, cv in pdm_pairs:
        need["D-609-05"] += 1

    # ------------------------------------------------ wire feet: every active + implied wire, zone estimate × pad
    feet = Counter()
    unkeyed = []
    claims_no_len = defaultdict(list)
    for w in list(reg["wires"]) + list(reg["implied"]):
        if w["id"] in retired or w["id"] in SHIELD_CABLES.values():
            continue                    # cond 2 of a shielded cable rides in its cable
        ks = wire_keys(w)
        L = w.get("length_ft")
        if ks and not isinstance(L, (int, float)):
            for k in ks:
                claims_no_len[k].append(w["id"])   # claims the stock line; its length is still unmeasured
            continue
        if not ks:
            unkeyed.append(w["id"])
            continue
        pad = PAD_ENGINE if re.search(r"ENGINE", w.get("section") or "", re.I) else PAD_BODY
        for k in ks:
            feet[k] += L * pad

    # ------------------------------------------------ carts
    cart = OrderedDict()     # code -> {vendor, qty, uom, ext}
    for c in carts:
        vendor = c.get("vendor")
        for ln in c["lines"]:
            v = ln.get("vendor", vendor)
            cart[ln["code"]] = {"vendor": v, "qty": ln["qty"], "uom": ln.get("uom", "EA"), "ext": ln.get("ext")}
    supply = Counter({c: v["qty"] for c, v in cart.items()})
    inside = defaultdict(list)
    for code, v in cart.items():
        for sub, n in ((parts.get(code) or {}).get("contains") or {}).items():
            if sub in parts:                      # only real part codes; housing_34 etc. stay descriptive
                supply[sub] += v["qty"] * n
                inside[sub].append(f"{v['qty']} × {code} × {n}")
    cart_by_key = defaultdict(list)
    for code in cart:
        k = code_key(code)
        if k:
            cart_by_key[k].append(code)

    diff = []
    # wire
    for k in sorted(set(feet) | set(cart_by_key) | set(claims_no_len), key=lambda k: (k[0], -k[1], k[2])):
        have = sum(cart[c]["qty"] for c in cart_by_key.get(k, []))
        nd = round(feet.get(k, 0), 1)
        st = ("covered" if have >= nd else f"short by {round(nd - have, 1)} ft") if nd else (
            WHITE_STOCK if k[2] == "9" else "not claimed by this scope")
        if claims_no_len.get(k):
            who = ", ".join(claims_no_len[k])
            st = (f"claimed by {who} — length not measured yet" if not nd
                  else st + f"; also {who} (length not measured yet)")
        diff.append(OrderedDict(kind="wire", item=key_label(k), codes=cart_by_key.get(k, []),
                                need_ft=nd, cart_ft=have, status=st))
    # parts
    pool_codes = {c for c, p in parts.items() if isinstance(p, dict) and p.get("pool")}
    for code in sorted(set(need) | {c for c in cart if not code_key(c)}):
        n = need.get(code, 0)
        n = math.ceil(n - 1e-9) if n else 0
        have = supply.get(code, 0)
        p = parts.get(code) or {}
        if code in replaced and not n:
            st = f"REMOVE — wrong plug for this part (see {replaced[code]})"
        elif p.get("kind") == "tool":
            st = "tool — see Tools"
        elif code in pool_codes:
            st = POOL_STATUS.get(p["pool"], "pool")
            if n and have < n:
                st = "missing — in no cart (" + st + ")"
        elif n and have >= n:
            st = "covered" + (f" (+{have - n} spare)" if have > n else "")
        elif n and have:
            st = f"short by {n - have}"
        elif n:
            st = {"via_dave": "via Dave (with the M130)", "open": "open — a pick/photo sets the PN"}.get(
                p.get("status"), "missing — in no cart")
        else:
            st = "not claimed by this scope"
        diff.append(OrderedDict(kind=p.get("kind", "?"), item=code, name=p.get("name", ""), need=n, cart=have,
                                inside=inside.get(code, []),
                                vendor=(cart.get(code) or {}).get("vendor") or p.get("vendor"), status=st))

    # ------------------------------------------------ tools: every step's tool across the families in use
    used = defaultdict(set)
    for eid, ep in resolved.items():
        f = fams.get(ep["family"]) or {}
        for st in f.get("steps", []):
            t = st.get("tool")
            for tid in (t if isinstance(t, list) else [t]):
                if tid and tid in tools:
                    used[tid].add(ep["family"])
        c = eps[eid].get("crimper")
        if c in tools:
            used[c].add(ep["family"])
    tool_rows = []
    for tid, t in tools.items():
        if tid not in used and t.get("status") == "alt":
            continue
        tool_rows.append(OrderedDict(id=tid, name=t.get("name"), pn=t.get("pn"), status=t.get("status"),
                                     families=sorted(used.get(tid, [])), buy=t.get("buy"), note=t.get("note"),
                                     price=(t.get("buy") or {}).get("price")))

    dev_eps = {e for e, ep in resolved.items()
               if ep["where"] in ("engine", "rear", "cabin") and not re.match(r"(M130|PDM30|PORT|FIREWALL|RAIL|PS-|COIL-GROUND|CAN-BUS)", e)}
    dev_ends = [(e, w) for e in dev_eps for w in resolved[e]["wires"]]
    mapped = [t for t in terms if t["endpoint"] in dev_eps and t.get("cavity")]
    unmapped_eps = sorted({e for e in dev_eps if resolved[e]["wires"]
                           and not any(t["endpoint"] == e and t.get("cavity") for t in terms)})
    reg["kits_meta"] = OrderedDict(
        built_by="docs/wiring/calc-data/kits_v5.py",
        scope="Chapter 1 (engine running) + power spine + comms ports; M130/PDM connectors count every active wire",
        firewall=OrderedDict(map="scripts/generate_connector_build_sheets.py (2026-06-10 build sheet)",
                             engine_only_off=body_off, overflow=overflow, crossing_now=len(crossing),
                             free_after_engine_only=free_after, grommet=grommet,
                             proposed_overflow_cavities=reassigned, spare_cavities=bulk_spare),
        deferred="cut lengths, twist/turns, DR-25/SCL grouping — formboard (owner 2026-09-26; ch.18 §6–8)",
        pad={"engine": PAD_ENGINE, "body": PAD_BODY, "source": "K5_WIRING_STATE.md row 33"},
        device_end_coverage=OrderedDict(mapped=len(mapped), wire_ends=len(dev_ends),
                                        endpoints_without_pin_map=unmapped_eps),
        wires_without_stock_key=unkeyed,
        wires_without_length={key_label(k): v for k, v in claims_no_len.items()},
    )
    reg["endpoints"] = resolved
    reg["terminations"] = terms
    reg["splices"] = splices
    reg["bom"] = OrderedDict(parts={k: (math.ceil(v - 1e-9)) for k, v in sorted(need.items())},
                             wire_ft={key_label(k): round(v, 1) for k, v in sorted(feet.items())})
    reg["carts"] = [{k: c[k] for k in ("vendor", "captured", "status", "line_count", "total") if k in c} for c in carts]
    reg["diff"] = diff
    reg["cart_changes"] = cart_changes(diff, cart)
    reg["tools"] = tool_rows
    reg["dossiers"] = build_dossiers(reg, resolved, terms, bulk, wires, parts, tools, fams, eps, cart, need, splices)
    reg["m130_pinout"] = m130_pinout(reg, wires)
    write_report(reg, parts, tools)
    write_dossiers(reg)
    write_pinout(reg)
    write_book(reg, tools, fams)
    return reg


def m130_pinout(reg, wires):
    """Dave-format M130 pin table from the registry: pin (unpadded, Dave style), function, colour, what it goes to.
    Pins and wires come from the M130 terminations; CAN from the CAN-BUS endpoint (#62 has no M130 pin of its own)."""
    ecu = reg.get("ecu_pins") or {}
    rails = set(ecu.get("rail_pins") or [])
    by_pin = defaultdict(list)
    for t in reg["terminations"]:
        if t["endpoint"] in ("M130-A", "M130-B") and t.get("cavity"):
            by_pin[t["cavity"]].append(t["wire"])
    m = re.search(r"M130 (B\d+)/(B\d+)", (reg["endpoints"].get("CAN-BUS") or {}).get("device", ""))
    if m:
        for pin in m.groups():
            by_pin[pin].append("62")
    rows = []
    for pin, code, name in ecu.get("M130", []):
        ws = [w for w in by_pin.get(pin, []) if w in wires]
        cols = []
        for w in ws:
            c = (wires[w].get("color") or "").strip() or ("shielded cable" if "M27500" in str(wires[w].get("spec")) else "")
            c = "shielded cable" if c == "cable" else c
            if " + " in c and code in ("CAN_HI", "CAN_LO"):      # the twisted pair: High = first colour, Low = second
                c = c.split(" + ")[0 if code == "CAN_HI" else 1]
            if c and c not in cols:
                cols.append(c)
        if not ws:
            goes = "unused"
        elif len(ws) > 1:
            goes = f"{len(ws)} wires spliced to 1 pin: " + "; ".join(dave_name(wires[w]) for w in ws)
        else:
            goes = dave_name(wires[ws[0]])
        rows.append(OrderedDict(pin=pin[0] + str(int(pin[1:])), function=f"{name} ({code})",
                                color=" / ".join(cols) or "—", goes_to=goes, wires=ws))
    return OrderedDict(source=ecu.get("source", ""), used=sum(1 for r in rows if r["wires"]), pins=len(rows), rows=rows)


def write_pinout(reg):
    po = reg["m130_pinout"]
    L = ["Pin,M130 Function,Color,Goes to"]
    q = lambda s: ('"' + s.replace('"', '""') + '"') if ("," in s or '"' in s) else s
    for r in po["rows"]:
        L.append(",".join(q(x) for x in (r["pin"], r["function"], r["color"], r["goes_to"])))
    bad = [b for b in book_lint("\n".join(L)) if not b.startswith("unstamped")]
    if bad:
        raise SystemExit("M130_PINOUT breaks the book's rules:\n  " + "\n  ".join(bad[:20]))
    (CD / "M130_PINOUT.csv").write_text("\n".join(L) + "\n")


def cart_changes(diff, cart):
    """ProWire edits that would bring the staged cart to the design. Wire rounds up to 5 ft; a colour moving
    from /32-22 to /16-22 keeps its old footage when larger (prototype margin); white stays 1,000 ft prototype
    stock. 'trim' lists lines whose unneeded feet cost >= TRIM_MIN_USD. Parts: missing / short / remove."""
    def code_for(spec, awg, colours):
        c = "".join(MIL[x] for x in colours.split("/"))
        base = f"{spec}-{awg}-{c}"
        if len(c) == 2 and not (spec == "M22759/16" and awg == 22 and c not in PRSP16_22):
            return base + "-PRSP"
        return base

    def r5(x):
        return int(math.ceil(x / 5.0) * 5)

    out = OrderedDict(remove=[], add=[], set_qty=[], trim=[], parts=[])
    for d in diff:
        if d["kind"] != "wire":
            continue
        m = re.match(r"(M22759/(?:16|32)) (\d+) AWG (\S+)$", d["item"])
        if not m:
            continue
        spec, awg, col = m.group(1), int(m.group(2)), m.group(3)
        need, have, codes = d["need_ft"], d["cart_ft"], d["codes"]
        if spec == "M22759/32" and awg == 22:
            out["remove"] += [OrderedDict(code=c, qty=cart[c]["qty"], why="22 AWG is M22759/16 (state 0p)") for c in codes]
            continue
        if spec == "M22759/16" and awg == 22:
            cc = code_for(spec, awg, col).split("-")[2]
            prev = max([v["qty"] for k, v in cart.items() if k.startswith("M22759/32-22-") and k.split("-")[2] == cc] or [0])
            q = 1000 if col == "white" else max(r5(need), int(prev))
            out["add"].append(OrderedDict(code=code_for(spec, awg, col), qty=q, need_ft=need,
                                          why="prototype stock" if col == "white" else f"need {need} ft"))
            continue
        if d["status"].startswith("short"):
            if codes:
                out["set_qty"].append(OrderedDict(code=codes[0], qty_from=have, qty=r5(max(have, need)), need_ft=need))
            else:
                out["add"].append(OrderedDict(code=code_for(spec, awg, col), qty=r5(need), need_ft=need, why=f"need {need} ft"))
        elif need and codes and have > r5(need):
            c = cart[codes[0]]
            unit = (c.get("ext") or 0) / c["qty"] if c.get("qty") else 0
            if (have - r5(need)) * unit >= TRIM_MIN_USD:
                out["trim"].append(OrderedDict(code=codes[0], qty_from=have, qty=r5(need), need_ft=need,
                                               saves=round((have - r5(need)) * unit, 2)))
    out["parts"] = [OrderedDict(code=d["item"], name=d.get("name", ""), need=d["need"], cart=d["cart"],
                                vendor=d.get("vendor"), status=d["status"])
                    for d in diff if d["kind"] != "wire" and d["status"].startswith(("missing", "short", "REMOVE"))]
    return out


K1S = {24: 5, 22: 6, 20: 7, 18: 8, 16: 8}          # ProWire SSC-N tooling chart
K43 = {24: 4, 22: 5, 20: 6}                          # K43 plate (receipt 2026-09-25 addendum 2026-09-26)
PULL = {24: 8, 22: 8, 20: 13, 18: 20, 16: 30, 14: 50}  # ch.18 §7 (IPC/WHMA-A-620 §19.1); 18 AWG = 20 lbf same table;
                                                     # 24 AWG: Checkline sheet, contact table (24 AWG = 36 N / 8 lbf)
PULL_M39029 = {24: 8, 22: 13, 20: 21}               # size-20 contact crimp tensile, Checkline sheet: 36 / 57 / 92 N
CHECKLINE = "Checkline 'Wire pull test standards' (checkline.com/res/products/126677/wire_pull_test_standards.pdf), contact table, size 20"
DOSSIER_POINTS = ["CLT-ECU", "OILP-ECU", "CKP", "CMP", "CAN-BUS", "PORT-UTC", "FIREWALL-ENGINE",
                  "TB", "COIL-1", "INJ-1", "KNOCK-1", "APS", "MAP", "PORT-ETH"]


def build_dossiers(reg, resolved, terms, bulk, wires, parts, tools, fams, eps, cart, need, splices):
    """Every field of a harness point with its value, source and state: cited | bench | deferred | open.
    A point is design-complete when nothing is 'open' (bench = first-plug check at the build; deferred = the
    owner's last values: cut length, twist, sleeve grouping)."""
    out = OrderedDict()
    have = lambda code: (code in cart) or (parts.get(code, {}) or {}).get("status") in (None,) and False
    for eid in DOSSIER_POINTS:
        if eid not in resolved:
            continue
        ep, raw = resolved[eid], eps[eid]
        rows = []
        R = lambda f, v, s, st="cited": rows.append(OrderedDict(field=f, value=v, source=s, state=st))
        R("device", ep["device"], "; ".join(raw.get("sources", [])[:1]) or "endpoints.yaml")
        for code, q in (raw.get("kit") or {}).items():
            code = str(code)
            in_cart = code in cart
            add = not in_cart and code in need
            R("plug / kit", f"{code} ×{q}", (parts.get(code) or {}).get("sources", [""])[0] if parts.get(code) else "parts.yaml",
              "cited" if in_cart else ("cited" if add else "open"))
            if add:
                rows[-1]["value"] += " (on the cart change)"
        for o in ep.get("open") or []:
            R("open item", o, "endpoints.yaml", "open")
        dbl = set(ep.get("doubled") or [])
        for w in ep["wires"]:
            wr = wires[w]
            a = wr.get("awg")
            # every decision that shaped this wire (spec, colour, pin), not just the first one
            src = "; ".join((wr.get("sources") or [])[:1] + [c for c in (wr.get("conflicts") or []) if c.startswith("decision")])
            R(f"#{w} wire", f"{wr.get('label')} — {a} AWG {wr.get('spec')} {wr.get('color') or ''}".rstrip(), src)
            # ECU / PDM end
            frm = wr.get("frm") or ""
            m = re.match(r"^(M130|PDM30):([AB]\d{1,2})", frm)
            if m and isinstance(a, int):
                sp = [s["splice"] for s in splices if s["at"].endswith(" " + m.group(2)[0] + m.group(2)[1:].zfill(2)) and w in s["wires"]]
                R(f"#{w} ECU end", f"{frm}: SSC-N, AFM8 + K1S selector {K1S.get(a, '?')}" + (f"; splice {sp[0]}" if sp else ""),
                  "ProWire SSC-N tooling chart; motec_m130_datasheet.pdf p.4–5" + ("; ProWire 3137CT (MiniSeal cavities)" if sp else ""))
                R(f"#{w} ECU strip length", "measure the SSC-N barrel on the first contact", "no published value", "bench")
            elif not m:
                R(f"#{w} far end", frm or "—", "registry", "cited" if frm and "?" not in frm else "open")
            # firewall
            if w in bulk:
                cav = bulk[w]
                # sources are what we hold (audit_citations.py checks them): the cavity is our own map; contacts, crimp
                # frame, positioner and insertion tool are DMC's tooling page and DigiKey's contact pages (2026-09-26 snapshots).
                R(f"#{w} firewall", f"cavity {cav}: M39029/56-351 (cabin) + /58-363 (engine), AFM8 + K43, insert/remove M81969/14-10",
                  "K5_connector_FIREWALL_D38999.svg; DMC tooling for M39029/56-351; DigiKey M39029/56-351 + M39029/58-363")
                R(f"#{w} firewall crimp setting",
                  f"K43 selector {K43.get(a, '?')} at {a} AWG — read it off the K43's data plate when the tool arrives",
                  "K43 listing photo (not kept); DMC K43 page: the data plate gives the selector position", "bench")
                R(f"#{w} firewall strip", "measure the barrel depth on the first contact; conductor visible at the inspection hole",
                  "no saved source for the barrel depth", "bench")
            # device end
            t = next((t for t in terms if t["endpoint"] == eid and t["wire"] == w), None)
            if t:
                cav = t.get("cavity")
                st = "cited" if cav else "open"
                # the terminal and seal cite their own pages; the cavity cites the plug's pinout source
                part_src = [str((parts.get(c) or {}).get("sources", [""])[0]) for c in str(t["part"]).split(" + ")
                            if (parts.get(c) or {}).get("sources")]
                R(f"#{w} device end", f"cavity {cav or '?'}: {t['part']}" + (" — doubled over (MoTeC)" if w in dbl else ""),
                  "; ".join(part_src + raw.get("sources", [])[:1]) or "; ".join(raw.get("sources", [])[:2]), st)
        # tools for the family
        fam = fams.get(ep["family"]) or {}
        crimper = raw.get("crimper")
        tool_ids = [crimper] if crimper else []
        for s in fam.get("steps", []):
            tl = s.get("tool")
            for tid in (tl if isinstance(tl, list) else [tl]):
                if tid and tid in tools and tid not in tool_ids:
                    tool_ids.append(tid)
        for tid in tool_ids:
            t = tools.get(tid) or {}
            unknown = "UNKNOWN" in str(t.get("note", "")) and not t.get("pn")
            R("tool", f"{t.get('name')} {('(' + str(t.get('pn')) + ')') if t.get('pn') else ''} — {t.get('status')}",
              (t.get("sources") or ["tools.yaml"])[0] if t.get("sources") else "tools.yaml", "open" if unknown else "cited")
        awgs = sorted({wires[w].get("awg") for w in ep["wires"] if isinstance(wires[w].get("awg"), int)})
        R("pull test", ", ".join(f"{g} AWG ≥ {PULL.get(g, '?')} lbf" for g in awgs),
          "chapters/18 §7 (IPC/WHMA-A-620 §19.1)" + ("; 24 AWG: " + CHECKLINE if 24 in awgs else ""))
        fw_awgs = sorted({wires[w].get("awg") for w in ep["wires"] if w in bulk and wires[w].get("awg") in PULL_M39029})
        if fw_awgs:
            R("firewall pull test", ", ".join(f"{g} AWG ≥ {PULL_M39029[g]} lbf" for g in fw_awgs), CHECKLINE)
        R("strip length (device end)", "measure the terminal barrel on the first plug", "maker's drawing not public", "bench")
        R("cut length, twist, sleeve", "last values (formboard)", "owner 2026-09-26; chapters/18 §6–8", "deferred")
        n_open = sum(1 for r in rows if r["state"] == "open")
        out[eid] = OrderedDict(device=ep["device"], status="design-complete" if n_open == 0 else f"{n_open} open",
                               rows=rows)
    return out


STATE_WORD = {"to_buy": "to buy", "confirm_owned": "confirm you own it", "picked": "picked", "have": "have", "in_cart": "in the cart",
              "via_dave": "via Dave", "alt": "alternative"}


def dossier_md(eid, d, siblings=""):
    """One plug as the owner reads it: one row per wire (ECU/PDM end, firewall cavity, device end, each with the
    tool for that step), then tools, checks, open items and a numbered source list. [n] = that list."""
    srcs = []

    def ref(s):
        s = (s or "").strip()
        if not s or s == "registry":
            return ""
        if s not in srcs:
            srcs.append(s)
        return f" [{srcs.index(s) + 1}]"

    wires, kit, tools, checks, opens, fw_note = OrderedDict(), [], [], OrderedDict(), [], None
    for r in d["rows"]:
        f, v, s, st = r["field"], r["value"], r["source"], r["state"]
        m = re.match(r"#(\S+) (.+)$", f)
        if m:
            wires.setdefault(m.group(1), {})[m.group(2)] = (v, s, st)
        elif f == "plug / kit":
            kit.append(v + ref(s) + ("" if st == "cited" else " (open)"))
        elif f == "tool":
            name, _, status = v.rpartition(" — ")
            tools.append(f"{name.strip()} — {STATE_WORD.get(status.strip(), status.strip())}{ref(s)}"
                         + (" (open: model not named)" if st == "open" else ""))
        elif f == "open item":
            opens.append(v)
        elif f == "pull test":
            checks["pull test"] = f"pull test {v}{ref(s)}"
        elif f == "firewall pull test":
            checks["fw pull"] = f"#20 contact pull test {v}{ref(s)}"
        elif f == "strip length (device end)":
            checks["device strip"] = "device-end strip length: measure the terminal barrel on the first plug (bench)"
        elif f == "cut length, twist, sleeve":
            checks["formboard"] = f"cut length, twist, sleeve grouping: formboard{ref(s)}"
    rows = []
    for w, k in wires.items():
        cells = {}
        if "wire" in k:
            v, s, _ = k["wire"]
            label, _, spec = v.partition(" — ")
            base, _, dec = s.partition("; decision: ")
            cl = re.match(r"output/K5_cut_list_v4_2\.txt:(\d+)$", base.strip())
            cells["Wire"] = f"#{w} {label}" + (f" · v4.2 L{cl.group(1)}" if cl else ref(base))
            cells["Spec"] = spec + (ref("decision: " + dec) if dec else "")
        if "ECU end" in k:
            v, s, _ = k["ECU end"]
            m = re.match(r"^(M130|PDM30):([AB]\d+): SSC-N, AFM8 \+ K1S selector (\S+?)(?:; splice (\S+))?$", v)
            cells["ECU / PDM end"] = (f"{m.group(1)} {m.group(2)} · SSC-N · AFM8 + K1S sel {m.group(3)}"
                                      + (f" · splice {m.group(4)}" if m.group(4) else "") if m else v) + ref(s)
        if "ECU strip length" in k:
            checks["ssc strip"] = "SSC-N strip length: measure the barrel on the first contact (bench)"
        if "firewall" in k:
            v, s, _ = k["firewall"]
            m = re.match(r"^cavity (\S+): (.+?), AFM8 \+ K43 selector (\S+), insert/remove (\S+)$", v)
            if m:
                cells["Firewall"] = f"{m.group(1)} · AFM8 + K43 sel {m.group(3)}{ref(s)}"
                fw_note = f"Firewall contacts: {m.group(2)}; insert/remove with {m.group(4)}{ref(s)}"
            else:
                cells["Firewall"] = v + ref(s)
        if "firewall strip" in k:
            v, s, _ = k["firewall strip"]
            checks["fw strip"] = f"#20 contact strip: {v}{ref(s)}"
        for kind in ("device end", "far end"):
            if kind in k:
                v, s, st = k[kind]
                m = re.match(r"^cavity (\S+): (.+)$", v)
                cells["Device end"] = (f"{m.group(1)} · {m.group(2)}" if m else v) + ref(s) + (" (open)" if st == "open" else "")
                break
        rows.append(cells)
    cols = [c for c in ("Wire", "Spec", "ECU / PDM end", "Firewall", "Device end") if any(c in r for r in rows)]
    n_open = int(d["status"].split()[0]) if d["status"] != "design-complete" else 0
    status = "solved" if not n_open else f"{n_open} item{'s' if n_open > 1 else ''} open"
    L = [f"## {eid} — {d['device']} · {status}", ""]
    if siblings:
        L += [siblings, ""]
    if kit:
        L += ["Kit: " + " · ".join(kit), ""]
    if fw_note:
        L += [fw_note, ""]
    L += ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    L += ["| " + " | ".join(r.get(c, "—") for c in cols) + " |" for r in rows]
    order = ("ssc strip", "fw strip", "device strip", "pull test", "fw pull", "formboard")
    L += ["", "**Tools:** " + (" · ".join(tools) or "none beyond the kit"),
          "", "**Checks:** " + " · ".join(checks[k] for k in order if k in checks)]
    if opens:
        L += ["", "**Open:** " + " · ".join(opens)]
    L += ["", "**Sources:**", ""] + [f"{i}. {s}" for i, s in enumerate(srcs, 1)] + [""]
    return "\n".join(L)


def sibling_line(reg, eid):
    """For a '-1' plug (COIL-1, INJ-1, KNOCK-1): where its identical siblings land — signal wire, M130 pin, firewall cavity."""
    m = re.match(r"^(.*)-1$", eid)
    if not m:
        return ""
    sibs = sorted((e for e in reg["endpoints"] if re.fullmatch(re.escape(m.group(1)) + r"-(\d+)", e) and e != eid),
                  key=lambda e: int(e.rsplit("-", 1)[1]))
    wires = {w["id"]: w for w in reg["wires"] + reg.get("implied", [])}
    fw = {t["wire"]: t.get("cavity") for t in reg["terminations"] if t["endpoint"] == "FIREWALL-ENGINE"}
    out = []
    for e in sibs:
        sig = [w for w in reg["endpoints"][e]["wires"] if str((wires.get(w) or {}).get("frm") or "").startswith("M130:")]
        if sig:
            w = sig[0]
            out.append(f"{e} #{w} M130 {wires[w]['frm'].split(':')[1]}" + (f" (firewall {fw[w]})" if fw.get(w) else ""))
    return ("Same layout for the others: " + " · ".join(out)) if out else ""


def write_dossiers(reg):
    L = ["# Harness points — fully cited (generated by kits_v5.py)", "",
         "One row per wire; [n] = the plug's source list. bench = measure on the first part at the build; "
         "formboard = the owner's last values. The raw field rows (value, source, state) are "
         "k5_registry.json['dossiers'].", ""]
    for eid, d in reg["dossiers"].items():
        L.append(dossier_md(eid, d, sibling_line(reg, eid)))
    (CD / "DOSSIERS.md").write_text("\n".join(L) + "\n")


def write_report(reg, parts, tools):
    L = []
    P = L.append
    km = reg["kits_meta"]
    fw = km["firewall"]
    P("# KITS REPORT — per-plug kits, tools per step, BOM vs carts (generated by kits_v5.py)")
    P("")
    P(f"Scope: {km['scope']}. Deferred: {km['deferred']}.")
    P("")
    dc = km["device_end_coverage"]
    P(f"**Device-end pin maps:** {dc['mapped']} of {dc['wire_ends']} device-end wire ends have a cited cavity. "
      f"Plugs still without a pin map: {', '.join(dc['endpoints_without_pin_map']) or 'none'}.")
    P("")
    P("## Firewall 61-pin")
    P("")
    P(f"- Build-sheet map (2026-06-10): body circuits still holding cavities under the engine-only rule "
      f"(state row 50): {', '.join('#' + w for w in fw['engine_only_off'])}.")
    P(f"- Overflow wires with no cavity: {', '.join('#' + w for w in fw['overflow'])}.")
    P(f"- Engine-only crossing count: {fw['crossing_now']} of 61 → {fw['free_after_engine_only']} free.")
    P(f"- Grommet crossings (too big for #20 contacts or battery-class): {', '.join(fw['grommet'])}.")
    P(f"- Proposed cavities for the overflow wires (nearest freed cavity, rule R3): "
      f"{', '.join(f'#{w} → {c}' for w, c in fw['proposed_overflow_cavities'].items())}; spare after: {', '.join(fw['spare_cavities'])}.")
    P("")
    P("## Plugs")
    P("")
    P("| Plug | Where | Kit | Wires | Range check | Open |")
    P("|---|---|---|---|---|---|")
    for eid, ep in reg["endpoints"].items():
        kit = ", ".join(f"{k} ×{v}" for k, v in ep["kit"].items()) or "—"
        rc = "; ".join(["OUT OF RANGE: " + x for x in ep["out_of_range"]] + ep.get("pigtailed", [])) or "ok"
        opn = " · ".join(ep["open"]) or "—"
        if ep["branch_wires_missing"]:
            opn = f"{ep['branch_wires_missing']} branch wire(s) not in registry · " + opn
        P(f"| {eid} | {ep['where']} | {kit} | {len(ep['wires'])} | {rc} | {opn} |")
    P("")
    P("## Splices at shared ECU/PDM pins")
    P("")
    P("| At | Wires | Splice | Equivalent AWG |")
    P("|---|---|---|---|")
    for s in reg["splices"]:
        P(f"| {s['at']} | {', '.join(s['wires'])} | {s['splice'] or 'too big for one MiniSeal'} | {s['equiv_awg']} |")
    P("")
    P("## BOM vs carts")
    P("")
    P("| Kind | Item | Need | Cart | Status |")
    P("|---|---|---|---|---|")
    for d in reg["diff"]:
        if d["kind"] == "wire":
            P(f"| wire | {d['item']} ({', '.join(d['codes']) or 'no cart line'}) | {d['need_ft']} ft | {d['cart_ft']} ft | {d['status']} |")
        else:
            P(f"| {d['kind']} | {d['item']} {('— ' + d['name']) if d['name'] else ''} | {d['need']} | {d['cart']} | {d['status']} |")
    P("")
    cc = reg["cart_changes"]
    P("## Cart change list (ProWire Q27156 → the design; a view, not applied)")
    P("")
    P(f"Remove {len(cc['remove'])} · add {len(cc['add'])} · change qty {len(cc['set_qty'])} · "
      f"trim {len(cc['trim'])} · part lines {len(cc['parts'])}.")
    P("")
    P("| Action | Code | Qty | Note |")
    P("|---|---|---|---|")
    for x in cc["remove"]:
        P(f"| remove | {x['code']} | {x['qty']} | {x['why']} |")
    for x in cc["add"]:
        P(f"| add | {x['code']} | {x['qty']} ft | {x['why']} |")
    for x in cc["set_qty"]:
        P(f"| qty | {x['code']} | {x['qty_from']} → {x['qty']} ft | need {x['need_ft']} ft |")
    for x in cc["trim"]:
        P(f"| trim | {x['code']} | {x['qty_from']} → {x['qty']} ft | need {x['need_ft']} ft; saves ${x['saves']:,.2f} |")
    for x in cc["parts"]:
        P(f"| part | {x['code']} {('— ' + x['name']) if x['name'] else ''} | need {x['need']}, cart {x['cart']} | "
          f"{x['status']}{(' · ' + x['vendor']) if x['vendor'] else ''} |")
    P("")
    P("## Tools")
    P("")
    P("| Tool | PN | Used by | Status | Price |")
    P("|---|---|---|---|---|")
    for t in reg["tools"]:
        pr = f"${t['price']:,.2f}" if t.get("price") else ""
        P(f"| {t['name']} | {t['pn'] or ''} | {', '.join(t['families']) or '—'} | {t['status']} | {pr} |")
    buy = [t for t in reg["tools"] if t["status"] in ("to_buy", "picked") and t.get("price")]
    P("")
    P(f"Tools to buy with a price on file: {len(buy)} = ${sum(t['price'] for t in buy):,.2f} "
      f"(unpriced: {', '.join(t['name'] for t in reg['tools'] if t['status'] == 'to_buy' and not t.get('price')) or 'none'}).")
    P("")
    if km["wires_without_stock_key"]:
        P(f"Wires with no stock key (spec/colour not a Tefzel stock item or no length): "
          f"{', '.join(km['wires_without_stock_key'])}.")
    OUT_REP.write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    reg = json.loads((CD / "k5_registry.json").read_text())
    attach(reg)
    (CD / "k5_registry.json").write_text(json.dumps(reg, indent=1, ensure_ascii=False) + "\n")
    print(f"kits: {len(reg['endpoints'])} endpoints, {len(reg['terminations'])} wire ends, "
          f"{len(reg['bom']['parts'])} part codes -> {OUT_REP}")


# =============================================================== the build book's own design, in code
# The owner surface (Claude Doc "K5 Parts & Build Book") has rules. They live here so every regeneration obeys them,
# and book_lint() fails the build when a page breaks one:
#   - every part and tool carries one stamp: HAVE / BUY NOW / YOUR PICK / LATER (the book's "How to read this");
#   - Dave's words, not cut-list codes (K5_WIRING_STATE §1: "Dave's vocabulary is the deliverable standard");
#   - each fact once (design tenet 2): shared build steps and tools are stated once; a plug lists only its own wires;
#   - sources a reader can open or recognise, never a repo path (k5-wiring-pickup: don't point him at repo files).
STAMPS = ("HAVE", "BUY NOW", "YOUR PICK", "LATER")
BOOK_ORDER = ["TB", "COIL-1", "INJ-1", "CKP", "CMP", "KNOCK-1", "MAP", "CLT-ECU", "OILP-ECU", "APS",
              "FIREWALL-ENGINE", "CAN-BUS", "PORT-UTC", "PORT-ETH"]
BOOK_TITLE = {
    "TB": "Throttle body (GM 12699160, Gen V SENT)", "COIL-1": "Coil 1 (coils 2–8 the same)",
    "INJ-1": "Injector 1 (injectors 2–8 the same)", "CKP": "Crank sensor", "CMP": "Cam sensor",
    "KNOCK-1": "Knock sensor 1 (knock 2 the same)", "MAP": "MAP sensor (GM Gen IV 1-bar)",
    "CLT-ECU": "Coolant temp sensor (for the M130)", "OILP-ECU": "Oil pressure sensor (for the M130)",
    "APS": "Gas pedal (GM Gen III truck pedal, 9-way plug, bought 2025-04-02)", "FIREWALL-ENGINE": "61-pin firewall plug, engine side",
    "CAN-BUS": "CAN bus (M130 to PDM30)", "PORT-UTC": "PDM30 laptop port (5-pin XLR)",
    "PORT-ETH": "M130 laptop port (RJ45)",
}
PIN_WORD = {"TB": "Throttle-body pin", "COIL-1": "Coil pin", "INJ-1": "Injector pin", "CKP": "Sensor pin",
            "CMP": "Sensor pin", "KNOCK-1": "Sensor pin", "MAP": "Sensor pin", "CLT-ECU": "Sensor pin",
            "OILP-ECU": "Sensor pin", "APS": "Pedal pin"}
BASE_NAME = {"110": "coolant temp", "102": "oil PSI", "108": "MAP", "109": "inlet air temp", "112": "fuel PSI",
             "113": "oil temp", "99": "crank", "101": "cam", "103": "knock 1", "104": "knock 2"}
SPECIAL_NAME = {"4a": "throttle motor −", "4b": "throttle motor +", "4c": "TPS signal (SENT)", "4e": "TPS 5 V",
                "4f": "TPS 0 V", "62": "CAN trunk", "64": "wideband +12 V", "111": "A/C high-pressure switch",
                "105": "A/C low-pressure switch", "95": "iBooster relay", "100": "speed sensor",
                "114": "Dakota coolant sender", "115": "Dakota oil sender",
                "UTC_CANH": "laptop port CAN high", "UTC_CANL": "laptop port CAN low", "UTC_0V": "laptop port 0 V",
                "ETH_TX+": "Ethernet TX+", "ETH_TX-": "Ethernet TX−", "ETH_RX+": "Ethernet RX+", "ETH_RX-": "Ethernet RX−",
                "ECU_PWR": "ECU 12 V supply", "ECU_GND1": "ECU ground 1", "ECU_GND2": "ECU ground 2",
                "116": "Dakota tach", "118": "Dakota speedo", "PCS_RPM": "PCS RPM input (tach mirror)",
                "PCS_TPS": "PCS throttle input (pedal track 1 tap)",
                # review C23 (2026-09-28): Dave's words for codes the pages printed
                "APS_T2_GND": "pedal track 2 0 V", "COIL1_SGND": "coil 1 signal ground",
                "INJ_PWR": "injector +12 V feed", "COIL_PWR": "coil +12 V feed", "DAK_OILP_GND": "Dakota oil sender 0 V",
                "DAK_OILP_5V": "Dakota oil sender 5 V", "DAK_CTS_RET": "Dakota coolant sender return",
                "LTCD_GND": "wideband 0 V", "VSS_PWR": "speed sender 5 V", "VSS_GND": "speed sender 0 V",
                "VSS_DAK": "speed sender signal (Dakota)"}


CAB_END = {"ECU": "M130 (pin not assigned yet)", "PDM30": "PDM30 (channel not assigned yet)",
           "GM CTS SNDR": "Dakota VHX box", "GM OPS SNDR": "Dakota VHX box"}


def cab_end(frm):
    frm = str(frm or "")
    if frm in CAB_END:
        return CAB_END[frm]
    return frm.replace("M130:", "M130 ").replace("PDM30:", "PDM30 ") or "—"


def dave_name(w):
    """Dave's words for a wire (his M130 sheet: 'coolant temp', 'oil PSI', 'TPS', 'crank sensor', '0 volt')."""
    wid, label, frm = str(w["id"]), w.get("label") or "", str(w.get("frm") or "")
    if wid in SPECIAL_NAME:
        return SPECIAL_NAME[wid]
    m = re.fullmatch(r"APS_T([12])_(SIG|5V|GND)", wid)
    if m:
        return f"pedal track {m.group(1)} " + {"SIG": "signal", "5V": "5 V", "GND": "0 V"}[m.group(2)]
    m = re.fullmatch(r"COIL(\d+)_(PWR|GND|SGND)", wid)
    if m:
        return f"coil {m.group(1)} " + {"PWR": "+12 V", "GND": "chassis ground", "SGND": "signal ground"}[m.group(2)]
    m = re.fullmatch(r"INJ(\d+)_PWR", wid)
    if m:
        return f"injector {m.group(1)} +12 V"
    m = re.match(r"Fuel Injector (\d+)", label)
    if m:
        return f"injector {m.group(1)} driver"
    m = re.match(r"Ignition Coil (\d+)", label)
    if m:
        return f"coil {m.group(1)} trigger"
    m = re.fullmatch(r"(\d+)([grs]?)", wid)
    if m and m.group(1) in BASE_NAME:
        role = {"": "signal", "g": "0 V", "s": "shield drain",
                "r": "6.3 V" if frm.endswith("B19") else "5 V"}[m.group(2)]
        return f"{BASE_NAME[m.group(1)]} {role}"
    return label


def book_source(s):
    """A source as the owner can recognise or open it; repo-internal references are dropped (None)."""
    s = (s or "").strip()
    url = re.search(r"https?://[^\s)'\"]+", s)
    rules = [
        (r"Dave's M130 sheet|Desert Performance|Overland Bronco", "Dave's M130 sheet"),
        (r"decision: spec M22759/32 -> M22759/16", "MoTeC PDM + C125 manuals (22 AWG wire is M22759/16-22)"),
        (r"SSC-N tooling chart", "ProWire SSC-N tooling chart · MoTeC M130 datasheet"),
        (r"K5_connector_FIREWALL|state row 43", "61-pin cavity map (June 10 build sheet)"),
        (r"DMC tooling", "[DMC tooling for M39029/56-351](https://dmctools.com/m39029/contact/196)"),
        (r"Checkline", "[Checkline pull-test sheet](https://www.checkline.com/res/products/126677/wire_pull_test_standards.pdf)"),
        (r"IPC/WHMA", "IPC/WHMA-A-620 pull-test values"),
        (r"MaxxECU", "[MaxxECU GM SENT throttle-body pinout](https://www.maxxecu.com/webhelp/wirings-e-throttle_bodies.html)"),
        (r"siemensdeka", "[Siemens Deka FI114961](https://siemensdeka.com/product/60lbh-siemens-deka-high-impedance-long-style-with-ev1-connector-fi114961-60mm/)"),
        (r"Holley 199R10762", "[Holley EFI manual 199R10762](https://documents.holley.com/199r10762rev1.pdf) (pedal)"),
        (r"ictbillet|ICT Billet", "[ICT Billet WCTHB50](https://www.ictbillet.com/products/lt-gen-v-throttle-body-connector-component-kit)"),
        (r"MoTeC PDM (user )?manual p\.50", "MoTeC PDM manual p.50 (CAN)"),
        (r"MoTeC PDM (user )?manual p\.48", "MoTeC PDM manual p.48"),
        (r"M1 Tune manual", "MoTeC M1 Tune manual p.10 (Ethernet)"),
        (r"GPR .*SENT|SENT Secure Serial", "MoTeC M130 firmware notes (SENT)"),
        (r"ProWire 12110847|12110847 'female", "ProWire 12110847 terminal + 15324976 seal pages"),
        (r"receipt 2026-09-25", "your Sep 25 orders"),
        (r"prowire p-2077", "ProWire LS crank/MAP plug kit page"),
        (r"prowire p-2076", "ProWire LS cam plug kit page"),
        (r"prowire p-1753", "ProWire GT150 coolant-temp kit page"),
        (r"prowire p-2069", "ProWire LS coil plug kit page"),
        (r"prowire p-3718", "ProWire 8-injector EV1 kit page"),
        (r"prowire 68201", "ProWire LS knock plug kit page"),
        (r"ProWire p-3845|ProWire p-3846", "ProWire GT150 6-way housing + TPA pages"),
        (r"M-RJ45-CABLE", "ProWire MoTeC RJ45 panel cable page"),
        (r"Amphenol", "Amphenol accessory datasheet"),
        (r"core-ics", "Raychem 202K boot dimensions"),
        (r"RT125", "ProWire RT125 epoxy page"),
    ]
    for rx, name in rules:
        if re.search(rx, s):
            return name
    if url:
        return f"[{re.sub(r'^https?://(www\.)?', '', url.group(0)).split('/')[0]}]({url.group(0)})"
    return None   # repo paths, 'registry', catalog file names, cut-list line numbers: not sources a reader can use


OPEN_STAMP = [
    (r"sensor not in any cart", "YOUR PICK", "the MAP sensor itself: a GM Gen IV 1-bar MAP (the plug above fits it)"),
    (r"^seal fit", "LATER", "bench check: if 22 AWG slides loose in the white seal (15324976, 1.3–2.1 mm), use the blue "
                            "15324974 (1.0–1.9 mm) — its fit with terminal 12110847 is not confirmed yet"),
    (r"kit terminal crimper", "LATER", "the terminal part number on the kit bag names the crimper"),
    (r"68201 terminal family", "LATER", "the kit bag shows whether its terminals are Metri-Pack or GT150; both 22 AWG "
                                        "sets are on the list"),
    (r"match the housing", "LATER", "match the housing to the pedal's socket when the pedal is in hand; RaceSpec's "
                                    "Delphi 6-position kit ($8) is the fallback"),
    (r"TE AMP|throttle-body terminals", "LATER", "the terminal part number in the ICT kit names the TE crimper"),
    (r"^pin order for 12699160", "LATER", "bench check before crimping: this throttle body's pin order is borrowed from other GM "
                                          "SENT throttle bodies (no saved source names 12699160); meter it — the two motor pins "
                                          "are the pair with a low resistance between them"),
]


def open_line(text):
    for rx, stamp, words in OPEN_STAMP:
        if re.search(rx, text):
            return stamp, words
    return "LATER", text


KIT_VENDOR = {"prowire": ("in the ProWire cart", "ProWire cart"), "digikey": ("in the DigiKey cart", "DigiKey cart"),
              "ebay": ("on the eBay list (surplus listing chosen)", "eBay list"),
              "ictbillet": ("on the ICT Billet link", "ICT Billet order")}


def _where(d):
    """Where a part stands against the carts, in the book's words."""
    have, later = KIT_VENDOR.get((d or {}).get("vendor"), ("in a cart", "cart"))
    st = (d or {}).get("status", "")
    m_short = re.match(r"short by (\d+)", st)
    return (have if st.startswith("covered") else
            f"{have}, {m_short.group(1)} more to add" if m_short else f"to add to the {later}")


def kit_stamps(reg, ep):
    """A plug's kits as (code, qty words, stamp, where) — shared by the book and the manual pages."""
    diff = {d["item"]: d for d in reg["diff"] if d["kind"] != "wire"}
    out = []
    for code, q in (ep.get("kit") or {}).items():
        qty = f"×{q}" if q >= 1 else f"(one kit covers {round(1 / q)})"
        out.append((code, qty, "BUY NOW", _where(diff.get(str(code)))))
    return out


def plug_parts(reg, eid):
    """Terminals and seals at one plug as (code, kind, count here, count in all, stamp, where) — counted from the same terminations the BOM counts."""
    diff = {d["item"]: d for d in reg["diff"] if d["kind"] != "wire"}
    cnt = Counter()
    for t in reg["terminations"]:
        if t["endpoint"] == eid:
            for code in str(t.get("part") or "").split(" + "):
                if code in diff:
                    cnt[code] += 1
    return [(code, diff[code]["kind"], n, diff[code]["need"], "BUY NOW", _where(diff[code])) for code, n in cnt.items()]


def plug_opens(ep, d):
    """A plug's open items as (stamp, words) — the one list the book and the manual pages both print."""
    opens = [open_line(o) for o in (ep.get("open") or [])]
    for r in (d or {}).get("rows", []):
        if r["field"] == "tool" and r["state"] == "open":
            opens.append(("LATER", r["value"].rpartition(" — ")[0].strip() + ": the terminal part number in the kit names it"))
    return opens


def tool_stamp(t):
    st, buy = t.get("status"), t.get("buy") or {}
    price = f", ${buy['price']:,.2f}" if buy.get("price") else ""
    if st == "confirm_owned":
        return "YOUR PICK — do you own one? If not, I add one to the order"
    if st == "in_cart":
        return "BUY NOW — in the ProWire cart"
    if st == "picked":
        return f"BUY NOW — chosen: eBay listing {buy.get('ref', '')}{price}".rstrip()
    if st == "to_buy" and buy.get("url"):
        return f"BUY NOW — [ProWire]({buy['url']}){price}"
    return "LATER — " + ("the terminal part number on the kit bag names it" if "kit bag" in str(t.get("note", ""))
                         or "terminal PN" in str(t.get("note", "")) else "picked with the power chapter")


FAMILY_LABEL = {
    "ssc": "M130 and PDM30 plugs (Superseal 1.0)", "d38999_20": "61-pin firewall plug",
    "gt150": "GT150 plugs: coolant temp, oil PSI", "mp150": "Metri-Pack 150 plugs: crank, cam, MAP, knock",
    "ev1": "Injector plugs (EV1)", "te_amp_plug": "Throttle-body plug (ICT WCTHB50)",
    "kit_terminal": "Coil plugs (ProWire kit terminals)", "miniseal": "Splices at the M130 and PDM30 pins, the pedal pigtail and the isolator leads",
    "xlr_solder": "PDM30 laptop port (5-pin XLR)",
}
GENERIC_SOURCES = {"ProWire SSC-N tooling chart · MoTeC M130 datasheet", "61-pin cavity map (June 10 build sheet)",
                   "[DMC tooling for M39029/56-351](https://dmctools.com/m39029/contact/196)", "IPC/WHMA-A-620 pull-test values",
                   "MoTeC PDM + C125 manuals (22 AWG wire is M22759/16-22)",
                   "[Checkline pull-test sheet](https://www.checkline.com/res/products/126677/wire_pull_test_standards.pdf)"}
END_WORD = [(r"^COIL_PWR rail splice$", "coil +12 V splice"), (r"^INJ_PWR rail splice$", "injector +12 V splice"),
            (r"^CAN trunk #62$", "CAN trunk (splice)"), (r"^Ground star \(cab\)$", "cab ground star"),
            (r"^XLR NC5FDL1 pin (\d)$", r"XLR pin \1"), (r"^RJ45 service port pin (\d)$", r"RJ45 pin \1"),
            (r"^head ring terminal \((.+)\)$", r"head ring terminal, \1")]


def end_word(s):
    s = str(s or "")
    for rx, rep in END_WORD:
        if re.match(rx, s):
            return re.sub(rx, rep, s)
    return cab_end(s) if s else "—"


def cap(s):
    return s[:1].upper() + s[1:] if s else s


def book_md(reg, tools, fams):
    wires = {str(w["id"]): w for w in reg["wires"] + reg["implied"]}
    eps, dos = reg["endpoints"], reg["dossiers"]
    fw = {t["wire"]: t.get("cavity") for t in reg["terminations"] if t["endpoint"] == "FIREWALL-ENGINE"}
    dev = defaultdict(dict)
    for t in reg["terminations"]:
        dev[t["endpoint"]][t["wire"]] = t
    solved = [e for e in BOOK_ORDER if dos.get(e, {}).get("status") == "design-complete"]
    short = lambda e: BOOK_TITLE[e].split(" (")[0]
    L = ["# Plug write-ups", "",
         f"{len(solved)} of {len(BOOK_ORDER)} engine plugs are solved to the last field: "
         + "; ".join(short(e) for e in solved) + f". The other {len(BOOK_ORDER) - len(solved)} have one or two items "
         "left, stamped in their sections. Every 22 AWG run is M22759/16, 20 AWG and up M22759/32, and the crank, cam and "
         "knock runs are two-conductor shielded cable (M27500). Cut lengths, twist and sleeve grouping are LATER: they come "
         "off the formboard.", ""]

    # ---- how each plug type is built (once)
    used = []
    for e in BOOK_ORDER:
        for f in [eps[e]["family"]] + [t["family"] for t in dev.get(e, {}).values()]:
            if f in FAMILY_LABEL and f not in used:
                used.append(f)
    for f in ("ssc", "d38999_20", "miniseal"):
        if f not in used:
            used.append(f)
    order = list(FAMILY_LABEL)
    used.sort(key=order.index)
    tshort = lambda tid: re.sub(r"^(DMC |Delphi/Aptiv |Deutsch )", "", (tools.get(tid) or {}).get("name", tid)).split(" (")[0]
    L += ["## How each plug type is built", "", "| Plug type | Contact or terminal | Crimp tool and setting |", "|---|---|---|"]
    for f in used:
        fam = fams.get(f) or {}
        crimp = next((s for s in fam.get("steps", []) if s.get("do") == "crimp"), None)
        ct = (crimp or {}).get("tool")
        ct = [ct] if isinstance(ct, str) else (ct or [])
        ct = [t for t in ct if t in tools]
        if f == "xlr_solder":
            tool_txt = "solder cups — soldering iron"
        elif not ct or any((tools[t].get("status") == "to_buy" and not tools[t].get("buy")) for t in ct):
            tool_txt = "the crimper the terminal bag names — LATER"
        else:
            tool_txt = " + ".join(tshort(t) for t in ct)
            val = str((crimp or {}).get("value") or "")
            if val and not val.startswith("UNKNOWN") and "selector" in val:
                tool_txt += f", {val}"
        per = fam.get("per_end") or {}
        vals = []
        for k, v in per.items():
            if isinstance(v, dict):
                vals += [f"{code} ({rng} AWG)" for rng, code in v.items()]
            elif isinstance(v, str):
                vals.append(v)
        if f == "d38999_20":
            vals = ["M39029/56-351 socket (cab side)", "M39029/58-363 pin (engine side)"]
        L.append(f"| {FAMILY_LABEL[f]} | {', '.join(vals) or 'the terminals in the kit'} | {tool_txt} |")
    L += ["", "Pull-test every crimp: 22 AWG ≥ 8 lbf, 20 ≥ 13, 18 ≥ 20, 16 ≥ 30. The 61-pin contacts are stricter: "
          "22 AWG ≥ 13 lbf, 20 ≥ 21. Strip so the conductor shows in the inspection hole; measure the barrel on the first "
          "contact of every type at the bench (no saved source gives the depth). Read the K43's selector settings off its "
          "data plate when it arrives.", "",
          "From: " + " · ".join(sorted(GENERIC_SOURCES)), ""]

    # ---- tools (once), BUY NOW first
    tids = []
    for f in used:
        for s in (fams.get(f) or {}).get("steps", []):
            tl = s.get("tool")
            for t in ([tl] if isinstance(tl, str) else (tl or [])):
                if t in tools and t not in tids:
                    tids.append(t)
    for e in BOOK_ORDER:
        c = (eps.get(e) or {}).get("crimper")
        if c in tools and c not in tids:
            tids.append(c)
    for t in ("PULL_GAUGE", "HEAT_GUN", "SOLDER_IRON", "DMM", "TORQUE_INLB", "FLUSH_CUTTER"):
        if t in tools and t not in tids:
            tids.append(t)
    fam_of = defaultdict(list)
    for f in used:
        for s in (fams.get(f) or {}).get("steps", []):
            tl = s.get("tool")
            for t in ([tl] if isinstance(tl, str) else (tl or [])):
                if FAMILY_LABEL[f].split(" (")[0].split(":")[0] not in fam_of[t]:
                    fam_of[t].append(FAMILY_LABEL[f].split(" (")[0].split(":")[0])
    rank = lambda t: [s in tool_stamp(tools[t]) for s in STAMPS].index(True) if any(s in tool_stamp(tools[t]) for s in STAMPS) else 9
    L += ["## Tools", "", "| Tool | For | Stamp |", "|---|---|---|"]
    for t in sorted((t for t in tids if tools[t].get("status") != "alt"), key=lambda t: (["BUY NOW", "YOUR PICK", "LATER", "HAVE"].index(
            next(s for s in ("BUY NOW", "YOUR PICK", "LATER", "HAVE") if s in tool_stamp(tools[t]))), tids.index(t))):
        tt = tools[t]
        name = cap(tt["name"]).replace(" (for AFM8)", " for the AFM8") + (
            f" ({tt['pn']})" if tt.get("pn") and str(tt["pn"]) not in tt["name"] else "")
        fams_t = fam_of.get(t, [])
        for_ = ("every plug type" if len(fams_t) >= 6 else ", ".join(fams_t)) or cap(
            str(tt.get("does") or tt.get("range") or "").split(";")[0].split(" — ")[0]) or "cutting wire"
        L.append(f"| {name} | {for_} | {tool_stamp(tt)} |")
    L.append("")

    # ---- plugs
    for e in BOOK_ORDER:
        d, ep = dos[e], eps[e]
        n_open = 0 if d["status"] == "design-complete" else int(d["status"].split()[0])
        L += [f"## {BOOK_TITLE[e]} · " + ("solved" if not n_open else f"{n_open} item{'s' if n_open > 1 else ''} open"), ""]
        sib = sibling_line(reg, e)
        if sib:
            parts_ = []
            for chunk in sib.split(": ", 1)[1].split(" · "):
                m = re.match(r"(\w+)-(\d+) #(\S+) M130 (\S+)(?: \(firewall (\S+)\))?", chunk)
                if m:
                    word = {"COIL": "coil", "INJ": "injector", "KNOCK": "knock sensor"}[m.group(1)]
                    parts_.append(f"{word} {m.group(2)} — M130 {m.group(4)}" + (f", 61-pin {m.group(5)}" if m.group(5) else ""))
            L += ["The others: " + " · ".join(parts_) + ".", ""]
        kit_bits = [f"{code} {qty}: **{stamp}**, {where}" for code, qty, stamp, where in kit_stamps(reg, ep)]
        if kit_bits:
            L += ["Kit: " + " · ".join(kit_bits), ""]
        pinword = PIN_WORD.get(e)
        colour_of = lambda ww: (ww.get("color") or ("shielded cable" if "M27500" in str(ww.get("spec")) else ""))
        colour_of2 = lambda ww: "shielded cable" if colour_of(ww) == "cable" else colour_of(ww)
        if e == "FIREWALL-ENGINE":
            L += ["| Cavity | Wire | Size, colour | Cab end |", "|---|---|---|---|"]
            unassigned = []
            for w in sorted(ep["wires"], key=lambda w: (len(fw.get(w) or "zz"), fw.get(w) or "zz")):
                ww = wires[w]
                ce = cab_end(ww.get("frm"))
                if "not assigned" in ce:
                    unassigned.append(dave_name(ww))
                L.append(f"| {fw.get(w, '—')} | {dave_name(ww)} | {ww.get('awg')} AWG {colour_of2(ww)} | {ce} |")
            if unassigned:
                L += ["", f"The plug itself is complete. {len(unassigned)} cab ends are still open ({', '.join(unassigned)}); "
                      "they close with the decision sheet (speed source, A/C inputs, PDM channels)."]
        elif e in ("CAN-BUS", "PORT-UTC", "PORT-ETH"):
            L += ["| Wire | Size, colour | From | To |", "|---|---|---|---|"]
            shown = [w for w in ep["wires"] if not (e == "CAN-BUS" and w.startswith("UTC_"))]
            for w in shown:
                ww = wires[w]
                to = ww.get("to") if isinstance(ww.get("to"), str) else ""
                if e == "CAN-BUS" and w == "62":
                    frm_, to = "M130 B17 (high) / B18 (low)", "PDM30 B26 / B25; one 100 Ω terminator at the PDM30 end"
                else:
                    frm_ = end_word(ww.get("frm"))
                colour = colour_of2(ww) or ("Cat5 pair" if "Cat5" in str(ww.get("spec")) else "")
                L.append(f"| {dave_name(ww)} | {ww.get('awg')} AWG {colour} | {frm_} | {end_word(to)} |")
            if e == "CAN-BUS":
                L += ["", "The laptop-port branch off this trunk is under PDM30 laptop port."]
        else:
            L += [f"| Wire | Size, colour | {pinword} | 61-pin | Other end |", "|---|---|---|---|---|"]
            for w in ep["wires"]:
                ww, t = wires[w], dev[e].get(w, {})
                frm_ = str(ww.get("frm") or "")
                other = frm_.replace("M130:", "M130 ") if frm_.startswith("M130:") else end_word(
                    ww["to"] if isinstance(ww.get("to"), str) and not str(ww["to"]).startswith(e) else frm_)
                if frm_.startswith("M130:") and any(w in s["wires"] for s in reg["splices"]):
                    other += " (spliced)"
                doubled = ", doubled over at the terminal" if t.get("doubled") else ""
                L.append(f"| {dave_name(ww)} | {ww.get('awg')} AWG {colour_of2(ww)}{doubled} | {t.get('cavity') or '—'} | "
                         f"{fw.get(w) or '—'} | {other} |")
        for stamp, words in plug_opens(ep, d):
            L += ["", f"**{stamp}** — {words}"]
        srcs = []
        for r in d["rows"]:
            nm = book_source(r["source"])
            if nm and nm not in srcs and nm not in GENERIC_SOURCES:
                srcs.append(nm)
        if srcs:
            L += ["", "From: " + " · ".join(srcs)]
        L.append("")
    return "\n".join(L).rstrip() + "\n"


def book_lint(md):
    """The book's rules, checked. Returns the list of violations (empty = the page may be published)."""
    body = re.sub(r"\]\([^)]*\)", "]", md)                      # link targets are URLs, not text a reader sees
    bad = []
    for m in re.finditer(r"\b[\w/-]+\.(?:md|ya?ml|py|svg|csv|json|txt|xlsx)\b|calc-data|chapters/|receipts/|\bregistry\b", body):
        bad.append(f"repo reference: {m.group(0)}")
    for m in re.finditer(r"\b(CLT|OPS|ETB|CKP|CMP|APS|OTS|IAT|TAC)\b", body):
        bad.append(f"cut-list code, not Dave's word: {m.group(0)}")
    for line in body.splitlines():
        if line.startswith("Kit:") and not all(any(s in part for s in STAMPS) for part in line[4:].split(" · ")):
            bad.append(f"unstamped kit: {line[:80]}")
        if re.search(r"×0\.|\bNone\b|\bUNKNOWN\b", line):
            bad.append(f"machine value: {line[:80]}")
    in_tools = False
    for line in body.splitlines():
        if line.startswith("## "):
            in_tools = line.startswith("## Tools")
        elif in_tools and line.startswith("| ") and not line.startswith("| Tool") and not any(s in line for s in STAMPS):
            bad.append(f"unstamped tool: {line[:80]}")
    return bad


def write_book(reg, tools, fams):
    md = book_md(reg, tools, fams)
    bad = book_lint(md)
    if bad:
        raise SystemExit("BOOK_PLUGS.md breaks the book's rules:\n  " + "\n  ".join(bad[:40]))
    (CD / "BOOK_PLUGS.md").write_text(md)
