#!/usr/bin/env python3
"""options_v5.py — options (variants), the capacity ledger and readiness by layer, over k5_registry.json.

Vocabulary is harness-design practice (Siemens Capital, Zuken E3.series), not ours: the composite design carries every
option; a configuration selects options and derives the buildable harness; each wire carries the option it belongs to.
Layers follow the same tools' logical → wiring → harness → manufacturing order:
  L1 plugs     both ends resolve to a plug whose family is known (a device pin table exists)
  L2 wire      both ends named with pins and the records agree (R8, R14)
  L3 crossing  a firewall crossing has its cavity (R12), or the wire does not cross
  L4 ends      a terminal part number at both ends
  L5 material  the wire's stock and its terminals are covered by a captured cart
  length       measured (bench/twin) · estimated · unknown
Run order: reconcile_v5.py → check_plug_ends.py --wires → options_v5.py → manual_v5.py.
Writes reg['options'], reg['capacity'], reg['readiness'] into k5_registry.json and calc-data/OPTIONS.md.
"""
import json
import re
import sys
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

import yaml

CD = Path(__file__).resolve().parent
sys.path.insert(0, str(CD))
import kits_v5 as K                                   # noqa: E402
from load_map_rows import SUB2SECTION                  # noqa: E402

REG = CD / "k5_registry.json"
CHECKS = CD / "WIRE_CHECKS.json"
OUT_MD = CD / "OPTIONS.md"
LAYERS = ["L1 plugs", "L2 wire", "L3 crossing", "L4 ends", "L5 material"]
# MoTeC PDM30: 16 switch inputs, 8 × 20 A + 22 × 8 A outputs (PDM30 datasheet p.1; PDM user manual comparison table).
# PDM15: 16 inputs, 8 × 20 A + 7 × 8 A (PDM user manual comparison table). Outputs 1–8 are the 20 A ones (manual: "Resolution
# 0.5 A on Outputs 1 – 8").
PDM_CAP = {"PDM30": {"inputs": 16, "out20": 8, "out8": 22}, "PDM15": {"inputs": 16, "out20": 8, "out8": 7}}
M130_PINS = 60                                        # 34-way A + 26-way B (M130 datasheet)
BODY_CAP = {"FIREWALL-BODY-A": 12, "FIREWALL-BODY-B": 12, "FIREWALL-BODY-P": 4, "FIREWALL-BODY-C": 6}


def load():
    reg = json.load(REG.open())
    opts = yaml.safe_load((CD / "catalog" / "options.yaml").read_text())
    eps_yaml = __import__("kits_v5")._y("endpoints.yaml")
    checks = json.load(CHECKS.open()) if CHECKS.exists() else {"wires": [], "devices": [], "system": {}}
    return reg, opts, eps_yaml, checks


def live_wires(reg):
    return [w for w in reg["wires"] if not w.get("retired")] + list(reg["implied"])


def assign_options(wires, opts):
    """Every wire gets the option it belongs to: an explicit wire pattern first, then its subsystem, else BASE."""
    pat = [(code, re.compile(p)) for code, o in opts.items() for p in (o.get("wire_patterns") or [])]
    by_sub = {s: code for code, o in opts.items() for s in (o.get("subsystems") or [])}
    for w in wires:
        code = next((c for c, rx in pat if rx.match(str(w["id"]))), None) or by_sub.get(w.get("subsystem")) or "BASE"
        w["option"] = code
        w["option_status"] = opts[code]["status"]


def length_state(w):
    b = str(w.get("length_basis") or "").lower()
    if not w.get("length_ft"):
        return "unknown"
    if re.search(r"twin|polyline", b):
        return "twin"
    if re.search(r"measur|bench|taped on", b) and not re.search(r"not (yet )?(measured|taped)", b):
        return "measured"
    return "estimated"


def readiness(reg, wires, checks):
    """Per wire: which layers pass. Facts come from the registry (plugs, terminations, carts diff) and the checks."""
    eps = reg["endpoints"]
    rules = {}
    for x in checks.get("wires", []):
        if x.get("kind") in ("v5", "implied"):
            rules[str(x["wire"])] = x.get("rules", {})
    ends = defaultdict(list)
    for t in reg["terminations"]:
        ends[str(t["wire"])].append(t)
    covered_wire_keys = {tuple(d["codes"]) and K.key_label(K.code_key(d["codes"][0])) for d in reg["diff"]
                         if d["kind"] == "wire" and str(d["status"]).startswith("covered")}
    covered_items = {d["item"] for d in reg["diff"] if d["kind"] == "wire" and str(d["status"]).startswith("covered")}
    covered_parts = {d["item"] for d in reg["diff"] if d["kind"] != "wire" and str(d["status"]).startswith("covered")}
    out = {}
    for w in wires:
        wid, r, te = str(w["id"]), rules.get(str(w["id"]), {}), ends.get(str(w["id"]), [])
        st = OrderedDict()
        fams = [eps.get(t["endpoint"], {}).get("family") for t in te]
        st["L1 plugs"] = bool(te) and len(te) >= 2 and all(f and f not in ("open", "unknown") for f in fams)
        r8, r14 = r.get("R8 ends", ["OPEN"])[0], r.get("R14 agree", ["PASS"])[0]
        st["L2 wire"] = r8 == "PASS" and r14 != "FAIL"
        r12 = r.get("R12 firewall")
        st["L3 crossing"] = (r12 is None) or r12[0] == "PASS"
        st["L4 ends"] = len(te) >= 2 and all(t.get("part") for t in te)
        keys = [K.key_label(k) for k in K.wire_keys(w)]
        parts = [t.get("part") for t in te if t.get("part")]
        st["L5 material"] = bool(keys) and all(k in covered_items for k in keys) and bool(parts) and all(p in covered_parts for p in parts)
        st["length"] = length_state(w)
        st["crosses"] = r12 is not None
        out[wid] = st
    return out


REAR = re.compile(r"TAIL|REAR|BRAKE|BACKUP|REVERSE|LICENSE|3RD|THIRD|TRAILER|CHMSL|CARGO", re.I)


def section_of(w):
    """The map's section for a wire: the loader's subsystem map, lighting split front/rear by the wire's words."""
    sub = w.get("subsystem")
    if sub == "LIGHTING_EXTERIOR":
        return "lighting_rear" if REAR.search(f"{w['id']} {w.get('label', '')} {json.dumps(w.get('to') or '')}") else "lighting_front"
    return SUB2SECTION.get(sub, "unsectioned")


def rollup(wires, ready, key):
    groups = defaultdict(list)
    for w in wires:
        groups[key(w)].append(str(w["id"]))
    rows = OrderedDict()
    for g, ids in sorted(groups.items(), key=lambda kv: str(kv[0])):
        row = OrderedDict(wires=len(ids))
        for L in LAYERS:
            row[L] = sum(1 for i in ids if ready[i][L])
        row["crossings"] = sum(1 for i in ids if ready[i]["crosses"])
        row["length"] = dict(Counter(ready[i]["length"] for i in ids))
        rows[g] = row
    return rows


def capacity(reg, wires, opts, eps_yaml):
    """Used vs spare on every shared resource, and what the candidate options would take from the spares."""
    fw = reg.get("kits_meta", {}).get("firewall", {})
    by_opt = defaultdict(list)
    for w in wires:
        by_opt[w["option"]].append(w)
    # the base ledger counts base and decided wires only; each candidate's take is reported on top of it (standards review,
    # round 3: PW/PL wires were counted as used, so "candidates don't fit" was computed on an already-consumed base)
    def pdm_refs(w):
        for s_ in (str(w.get("frm") or ""), json.dumps(w.get("to") or "")):
            for m in re.finditer(r"\b(PDM30|PDM15):(OUT|DIG)(\d+)", s_):
                yield m.group(1), ("out" if m.group(2) == "OUT" else "in"), int(m.group(3))
    is_cand = lambda w: (opts.get(w["option"]) or {}).get("status") in ("candidate", "rejected")
    pdm = {d: {"out": Counter(), "in": Counter()} for d in PDM_CAP}
    for w in wires:
        if is_cand(w):
            continue
        for d, kind, n in pdm_refs(w):
            pdm[d][kind][n] += 1
    res = OrderedDict()
    res["61-pin (engine only)"] = OrderedDict(capacity=61, used=fw.get("crossing_now"), spare=fw.get("spare_cavities", []),
                                             source="kits_v5 firewall map; state rows 50, 53")
    for e, n in BODY_CAP.items():
        pins = eps_yaml.get(e, {}).get("pins") or {}
        res[f"body bulkhead {e[-1]}"] = OrderedDict(capacity=n, used=len(pins), spare=n - len(pins),
                                                    source="catalog/endpoints.yaml pins")
    res["power grommet"] = OrderedDict(capacity=None, used=len(fw.get("grommet", [])), spare=None, source="kits_v5 firewall map")
    # round 4: cable pass-throughs, one cable per Blue Sea 1003 CableClam (max cable 0.56 in; web_snapshots/www.bluesea.com__CableClam_1.40in.md)
    for e, ep in eps_yaml.items():
        clam = (ep.get("per_end") or {}).get("part") == "BLUESEA-1003" or "BLUESEA-1003" in (ep.get("kit") or {})
        if clam and not e.startswith("FIREWALL-GROMMET"):
            n_ = len(ep.get("wires") or []) if (ep.get("per_end") or {}).get("part") == "BLUESEA-1003" else int((ep.get("kit") or {})["BLUESEA-1003"])
            used_ = len(ep.get("wires") or [])
            res[f"pass-through {e}"] = OrderedDict(capacity=n_, used=used_, spare=n_ - used_,
                                                   source="catalog/endpoints.yaml; one cable per Blue Sea 1003 CableClam")
    for d, cap in PDM_CAP.items():
        used_out = sorted(pdm[d]["out"])
        used20 = [o for o in used_out if o <= 8]
        used8 = [o for o in used_out if o > 8]
        res[f"{d} 20 A outputs"] = OrderedDict(capacity=cap["out20"], used=len(used20), spare=cap["out20"] - len(used20),
                                              source="PDM30 datasheet p.1; PDM user manual comparison table")
        res[f"{d} 8 A outputs"] = OrderedDict(capacity=cap["out8"], used=len(used8), spare=cap["out8"] - len(used8),
                                             source="PDM30 datasheet p.1; PDM user manual comparison table")
        res[f"{d} inputs"] = OrderedDict(capacity=cap["inputs"], used=len(pdm[d]["in"]), spare=cap["inputs"] - len(pdm[d]["in"]),
                                        spare_ids=[f"DIG{i}" for i in range(1, cap["inputs"] + 1) if i not in pdm[d]["in"]],
                                        source="PDM30 datasheet p.1; PDM user manual comparison table")
    m130 = reg.get("m130_pinout") or {}
    m_used = m130.get("used", 0) if isinstance(m130, dict) else len(m130)
    res["M130 pins"] = OrderedDict(capacity=M130_PINS, used=m_used, spare=M130_PINS - m_used, source="M130 datasheet; registry pinout (kits_v5)")
    for bank in ("GND-BANK-ENG", "GND-BANK-CAB", "GND-SPLICE-REAR"):
        n = len(eps_yaml.get(bank, {}).get("wires") or [])
        res[f"ground bank {bank}"] = OrderedDict(capacity=None, used=n, spare=None, source="catalog/endpoints.yaml wires; stud count not yet set")
    stock = [d for d in reg["diff"] if d["kind"] == "wire" and (d.get("need_ft") or d.get("cart_ft"))]
    res["wire stock (ft)"] = OrderedDict(
        lines=[OrderedDict(item=d["item"], need_ft=d["need_ft"], cart_ft=d["cart_ft"], on_hand_ft=None, status=d["status"]) for d in stock],
        source="kits_v5 BOM vs carts; on hand is not recorded anywhere yet")
    # demand from candidate options: designed wires count what they take; undesigned ones declare it in options.yaml
    demand = OrderedDict()
    for code, o in opts.items():
        if o["status"] != "candidate":
            continue
        ws = by_opt.get(code, [])
        d = OrderedDict(status=o["status"], designed_wires=len(ws))
        dd = o.get("demand") or {}
        d["crossings"] = dd.get("crossings", sum(1 for w in ws if re.search(r"FIREWALL", json.dumps(w))))
        took = {(dv, k, n) for w in ws for dv, k, n in pdm_refs(w) if n not in pdm[dv][k]}     # on top of the base
        d["pdm30_outputs"] = dd.get("pdm30_outputs", len({n for dv, k, n in took if dv == "PDM30" and k == "out"}))
        d["pdm30_inputs"] = dd.get("pdm30_inputs", len({n for dv, k, n in took if dv == "PDM30" and k == "in"}))
        d["pdm15_outputs"] = len({n for dv, k, n in took if dv == "PDM15" and k == "out"})
        d["takes"] = sorted(f"{dv} {'OUT' if k == 'out' else 'DIG'}{n}" for dv, k, n in took)
        # an output-setting conflict on a candidate's wires (reconcile_v5 pdm_settings) is the candidate's to resolve
        d["setting_conflicts"] = sorted({w["pdm_limit"] for w in ws if "CONFLICT" in str(w.get("pdm_limit") or "")})
        d["notes"] = dd.get("notes")
        demand[code] = d
    verdict = OrderedDict()
    tot_cross = sum(d["crossings"] for d in demand.values())
    body_spare = sum(r["spare"] for k, r in res.items() if k.startswith("body bulkhead"))
    verdict["body crossings"] = f"Body firewall crossings: candidates would take {tot_cross}; body bulkheads have {body_spare} spare — " + (
        "fits, but only in the 4-way power connector P (size 12 contacts); signal wires need bulkhead C" if tot_cross <= body_spare else "does NOT fit: bulkhead C is required")
    out_need = sum(d["pdm30_outputs"] for d in demand.values())
    out_spare = res["PDM30 20 A outputs"]["spare"] + res["PDM30 8 A outputs"]["spare"]
    verdict["PDM30 outputs"] = f"PDM30 outputs: candidates would take {out_need}; {out_spare} spare — " + ("fits" if out_need <= out_spare else f"does NOT fit; the engine PDM15 has {res['PDM15 20 A outputs']['spare'] + res['PDM15 8 A outputs']['spare']} spare outputs for engine-bay loads")
    in_need = sum(d["pdm30_inputs"] for d in demand.values())
    verdict["PDM30 inputs"] = f"PDM30 inputs: candidates would take {in_need}; {res['PDM30 inputs']['spare']} spare — " + (
        "fits" if in_need <= res["PDM30 inputs"]["spare"] else f"does NOT fit; PDM15 has {res['PDM15 inputs']['spare']} spare inputs, read over CAN")
    return OrderedDict(resources=res, candidate_demand=demand, verdict=verdict)


def attach(reg, opts, eps_yaml, checks):
    wires = live_wires(reg)
    assign_options(wires, opts)
    ready = readiness(reg, wires, checks)
    reg["readiness"] = OrderedDict(
        layers=LAYERS, per_wire=ready,
        by_option=rollup(wires, ready, lambda w: w["option"]),
        by_section=rollup(wires, ready, section_of),
        configuration=rollup([w for w in wires if w["option_status"] in ("base", "decided")], ready, lambda w: "buildable (base + decided)"),
        composite=rollup(wires, ready, lambda w: "composite (every option)"),
    )
    reg["options"] = OrderedDict((code, OrderedDict(name=o["name"], status=o["status"], decided=(str(o["decided"]) if o.get("decided") else None), source=o.get("source"),
                                                    subsystems=o.get("subsystems") or [], wires=[str(w["id"]) for w in wires if w["option"] == code],
                                                    demand=o.get("demand"), history=o.get("history")))
                                 for code, o in opts.items())
    reg["capacity"] = capacity(reg, wires, opts, eps_yaml)
    return reg


def write_md(reg):
    P = []
    P.append("# OPTIONS — variants, capacity ledger, readiness by layer (generated by options_v5.py)\n")
    P.append("Vocabulary: composite design (every option) → configuration (base + decided) → buildable harness. "
             "A candidate's wires ride in the composite; its demand is shown against the spares.\n")
    P.append("## Options\n\n| code | option | status | decided | wires | source |\n|---|---|---|---|---|---|")
    for code, o in reg["options"].items():
        P.append(f"| {code} | {o['name']} | **{o['status']}** | {o['decided'] or ''} | {len(o['wires'])} | {(o['source'] or '').splitlines()[0][:110]} |")
    P.append("\n## Readiness by layer\n\nEach cell = wires passing that layer / wires in the group. length = measured · estimated · unknown.\n")
    for title, key in (("Configuration vs composite", "configuration"), ("By option", "by_option"), ("By section", "by_section")):
        rows = dict(reg["readiness"][key])
        if key == "configuration":
            rows.update(reg["readiness"]["composite"])
        P.append(f"### {title}\n\n| group | wires | " + " | ".join(LAYERS) + " | crossings | length |\n|---|---|" + "---|" * len(LAYERS) + "---|---|")
        for g, r in rows.items():
            L = r["length"]
            P.append(f"| {g} | {r['wires']} | " + " | ".join(str(r[x]) for x in LAYERS)
                     + f" | {r['crossings']} | m {L.get('measured', 0)} · e {L.get('estimated', 0)} · u {L.get('unknown', 0)} |")
        P.append("")
    P.append("## Capacity ledger\n\n| resource | capacity | used | spare | source |\n|---|---|---|---|---|")
    for k, r in reg["capacity"]["resources"].items():
        if "lines" in r:
            continue
        sp = r["spare"]
        sp = ", ".join(sp) if isinstance(sp, list) else ("" if sp is None else sp)
        extra = (" (" + ", ".join(r["spare_ids"]) + ")") if r.get("spare_ids") else ""
        P.append(f"| {k} | {'' if r['capacity'] is None else r['capacity']} | {r['used']} | {sp}{extra} | {r['source']} |")
    P.append("\n### Wire stock\n\n| item | need ft | in carts ft | on hand ft | status |\n|---|---|---|---|---|")
    for l in reg["capacity"]["resources"]["wire stock (ft)"]["lines"]:
        P.append(f"| {l['item']} | {l['need_ft']} | {l['cart_ft']} | not recorded | {l['status']} |")
    P.append("\n### What the candidates would take\n\n| option | designed wires | crossings | PDM30 outputs | PDM30 inputs | notes |\n|---|---|---|---|---|---|")
    for code, d in reg["capacity"]["candidate_demand"].items():
        P.append(f"| {code} | {d['designed_wires']} | {d['crossings']} | {d['pdm30_outputs']} | {d['pdm30_inputs']} | {d['notes'] or ''} |")
    P.append("\n### Verdict\n")
    for k, v in reg["capacity"]["verdict"].items():
        P.append(f"- **{k}:** {v}")
    OUT_MD.write_text("\n".join(P) + "\n")


def main():
    reg, opts, eps_yaml, checks = load()
    attach(reg, opts, eps_yaml, checks)
    REG.write_text(json.dumps(reg, indent=1, ensure_ascii=False, default=str) + "\n")
    write_md(reg)
    c = reg["readiness"]["configuration"]["buildable (base + decided)"]
    m = reg["readiness"]["composite"]["composite (every option)"]
    print(f"options: {len(opts)} ({Counter(o['status'] for o in opts.values())})")
    print(f"buildable harness: {c['wires']} wires · " + " · ".join(f"{L} {c[L]}" for L in LAYERS) + f" · crossings {c['crossings']} · length {c['length']}")
    print(f"composite:         {m['wires']} wires · " + " · ".join(f"{L} {m[L]}" for L in LAYERS))
    for k, v in reg["capacity"]["verdict"].items():
        print(f"  {k}: {v}")
    print(f"-> {OUT_MD}")


if __name__ == "__main__":
    main()
