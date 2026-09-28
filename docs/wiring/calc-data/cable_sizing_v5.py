#!/usr/bin/env python3
"""cable_sizing_v5.py — the DC primary cables sized from physics, not from a preference.

Inputs (every one cited):
  M22759/16 constants ......... ProWire/Thermax datasheet (ch.16 §1.8): resistance Ω/1000 ft per AWG; sizes to 2/0
  free-air ampacity ........... MoTeC PDM user manual p.48 (single wire in free air): 2# 150 A @ 80 °C / 120 A @ 100 °C,
                                4# 120 / 100, 6# 90 / 75
  bundled ampacity ............ ProWire Tefzel ampacity chart ("bundled in heat-shrink", 35 °C rise): 2# 100, 4# 72,
                                6# 54, 8# 40 A   https://www.prowireusa.com/tefzel-amperage-chart (read 2026-09-28)
  loads ....................... starter 200 A peak, brief (chapters/05 manifest); alternator Holley 197-302 = 150 A
                                (Holley product page, read 2026-09-28); PDM30 100 A and PDM15 80 A continuous total
                                (PDM user manual p.35); amplifier JL VX700/5i 60 A fuse recommendation (Crutchfield
                                snapshot); iBooster 40 A OEM fuse (ch.17 §17.5); Orion-Tr 12/12-30 → MIDI 40 (ch.17)
  rules ....................... fuse ≥ 125 % of normal load and ≤ 85 % of the cable's ampacity (ch.17 §17.2.3);
                                voltage drop ≤ 3 % = 0.42 V at 14 V (ch.16 §2.4); bundled derate applies only past
                                24 in of bundled run (ch.16 §2.2); parallel conductors: same gauge, same length,
                                same terminations (ch.17 §17.5.3); a cable in its own DR-25 sleeve, not bundled with
                                other current-carrying cables, is rated on the free-air column
  lengths ..................... the twin's polylines where they exist (k5_registry length_ft), else the estimate
The answer per cable: gauge, count in parallel, fuse, and the pass/fail of each rule, written as the decision the
registry build applies (reconcile_v5 DECISIONS) and as CABLE_SIZING.md for the receipt.
"""
import json
from collections import OrderedDict
from pathlib import Path

CD = Path(__file__).resolve().parent
R_PER_KFT = {"2/0": 0.091, "1/0": 0.126, "1": 0.149, "2": 0.183, "4": 0.280, "6": 0.445, "8": 0.701, "10": 1.26}
FREE_AIR_80 = {"2": 150, "4": 120, "6": 90}            # MoTeC PDM manual p.48, single wire in free air, 80 °C ambient
FREE_AIR_100 = {"2": 120, "4": 100, "6": 75}
BUNDLED_35 = {"2": 100, "4": 72, "6": 54, "8": 40, "10": 30}   # ProWire chart, bundled in heat-shrink, 35 °C rise
V_SYS, DROP_MAX = 14.0, 0.42

CABLES = [
    # id, from, to, continuous load A, brief peak A, fuse wanted (A or None), length ft (round trip factor applied below),
    # return path id (for drop), bundled? (run > 24 in inside a loom with other current carriers), zone
    dict(id="63", hot=True, min_awg="2", frm="Odyssey +", to="isolator stud A", cont=180, peak=200, fuse=None, ft=1.1, bundled=False,
         why_load="every load with the engine off: PDM30 100 + PDM15 80; cranking 200 A brief"),
    dict(id="ISO_OUT", hot=True, min_awg="2", frm="isolator stud B", to="distribution stud", cont=180, peak=200, fuse=None, ft=None, bundled=False,
         why_load="same current as #63"),
    dict(id="ODY_NEG", hot=True, min_awg="2", frm="Odyssey −", to="ground star", cont=180, peak=200, fuse=None, ft=None, bundled=False,
         why_load="the battery's return: same as #63"),
    dict(id="6", hot=True, frm="distribution stud", to="starter B+", cont=0, peak=200, fuse=None, ft=3.1, bundled=False, min_awg="2",
         why_load="cranking only, brief (unfused, ABYC cranking exemption); never below 2 AWG (ch.17 §17.4.3 'same as the starter cable', §17.5.6 Dave)"),
    dict(id="G1", hot=True, min_awg="2", frm="ground star", to="engine block", cont=150, peak=200, fuse=None, ft=3.5, bundled=False,
         why_load="starter return 200 A brief; alternator return up to 150 A continuous through the block"),
    dict(id="59", hot=True, frm="alternator B+", to="distribution stud", cont=150, peak=None, fuse="MEGA", ft=3.5, bundled=False,
         why_load="Holley 197-302 rated 150 A"),
    dict(id="PDM_BPOS", frm="distribution stud", to="PDM30 stud", cont=100, peak=None, fuse="MEGA", ft=1.9, bundled=False,
         why_load="PDM30 total output 100 A continuous (manual p.35)"),
    dict(id="PDM15_BPOS", hot=True, frm="distribution stud", to="PDM15 stud", cont=80, peak=None, fuse="MEGA", ft=None, bundled=False,
         why_load="PDM15 total output 80 A continuous (manual p.35)"),
    dict(id="GND_RET_CAB", frm="cab ground bank", to="ground star", cont=100, peak=None, fuse=None, ft=None, bundled=True,
         why_load="every PDM30 load returns through it; runs in the loom through the grommet"),
    dict(id="32", loop=2, frm="YellowTop +", to="amplifier +12 V", cont=60, peak=None, fuse="MIDI", fuse_fixed=60, ft=18.4, bundled=True,
         why_load="JL VX700/5i: 60 A fuse recommended; the run goes engine bay → bed, bundled with its ground"),
    dict(id="AMP_GND", loop=2, frm="amplifier −", to="ground star", cont=60, peak=None, fuse=None, ft=18.4, bundled=True,
         why_load="the amplifier's return, same length as #32"),
    dict(id="AMP_PWR_TAIL", frm="reducing block +", to="amplifier +12 V plug", cont=60, peak=None, fuse=None, ft=None, bundled=False, min_awg="4",
         why_load="short tail into the JL power plug: 'Min. Copper Power/GND Wire 4 AWG' (JL VX700/5i spec table); protected by #32's MIDI 60 A"),
    dict(id="AMP_GND_TAIL", frm="amplifier ground plug", to="reducing block -", cont=60, peak=None, fuse=None, ft=None, bundled=False, min_awg="4",
         why_load="the amplifier's ground tail, same rule"),
    dict(id="52", hot=True, frm="distribution stud", to="iBooster 1", cont=40, peak=None, fuse="MIDI", fuse_fixed=40, ft=4.6, bundled=False,
         why_load="OEM 40 A supply fuse (ch.17 §17.5)"),
    dict(id="IBOOST_GND", hot=True, frm="iBooster ground", to="ground star", cont=40, peak=None, fuse=None, ft=None, bundled=False,
         why_load="the iBooster's return carries #52's current (OEM 40 A supply fuse, ch.17 §17.5): sized like its feed so the "
                  "cable is one gauge on every page (book review 2026-09-28: it printed 8 AWG while #52 is 6)"),
    dict(id="DCDC_IN", hot=True, frm="distribution stud", to="Orion IN +", cont=35, peak=None, fuse="MIDI", fuse_fixed=60, ft=None, bundled=False,
         why_load="Orion-Tr Smart 12/12-30: 30 A out, ~35 A in. Fuse is the maker's: Victron Orion-Tr Smart manual §4.2 "
                  "'Cable and fuse recommendations', 12 V row: external battery protection fuse 60 A, minimum cable 6 mm² at 0.5 m, "
                  "10 mm² at 1–2 m (snapshot 2026-09-28). ch.17's MIDI 40 was 35 A x 1.25 = 44 A rounded down — under the 125 % floor "
                  "and under the maker's number; superseded 2026-09-28 night"),
    dict(id="DCDC_OUT", hot=True, frm="Orion OUT +", to="YellowTop +", cont=30, peak=None, fuse=None, ft=None, bundled=False, why_load="30 A charge"),
    dict(id="DCDC_GND", hot=True, frm="Orion −", to="ground star", cont=35, peak=None, fuse=None, ft=None, bundled=False, why_load="the Orion's return"),
    # ACC_NEG (YellowTop − → star) and G2 (star → frame) are not resized: their lengths are not in the twin and their loads
    # are not measured; they keep 4 AWG per ch.17 §17.4.4 until a length exists for the drop check.
]
MEGA = [100, 125, 150, 175, 200, 225, 250, 300]
MIDI = [30, 40, 50, 60, 70, 80, 100, 125, 150]


def fuse_pick(kind, load):
    want = load * 1.25
    return next(f for f in (MEGA if kind == "MEGA" else MIDI) if f >= want)


def ampacity(awg, n, bundled, hot=False):
    tbl = BUNDLED_35 if bundled else (FREE_AIR_100 if hot else FREE_AIR_80)
    a = tbl.get(awg)
    return None if a is None else a * n


def drop(awg, n, amps, ft):
    if not ft:
        return None
    return amps * (R_PER_KFT[awg] / 1000.0) * ft / n


def size(c):
    """Try single 2 AWG first (Dave's stock), then 2 × 2 AWG in parallel (the owner's parallel rule); return the first
    that passes every rule, with the rule results."""
    options = [("8", 1), ("6", 1), ("4", 1), ("2", 1), ("2", 2)]      # smallest that passes every rule
    if c.get("min_awg"):
        options = [(a, n) for a, n in options if int(a) <= int(c["min_awg"])]
    best = None
    for awg, n in options:
        fuse = (c.get("fuse_fixed") or fuse_pick(c["fuse"], c["cont"])) if c["fuse"] else None
        amp = ampacity(awg, n, c["bundled"], hot=c.get("hot", False))
        if amp is None:
            continue
        need_amp = max(c["cont"], (fuse / 0.85) if fuse else 0)
        ok_amp = amp >= need_amp
        # brief cranking: the drop rule with a 0.5 V allowance, no continuous-ampacity requirement (ABYC exemption)
        d_cont = drop(awg, n, c["cont"], c["ft"]) if c["cont"] else 0.0
        if d_cont is not None:
            d_cont *= c.get("loop", 1)                     # feed + return of the same gauge and length
        d_peak = drop(awg, n, c["peak"], c["ft"]) if c["peak"] else 0.0
        ok_drop = (d_cont is None) or (d_cont <= DROP_MAX)
        ok_peak = (d_peak is None) or (d_peak <= 0.5)
        res = OrderedDict(awg=awg, n=n, fuse=(f"{c['fuse']} {fuse} A" if fuse else "none"), ampacity=amp, need=round(need_amp),
                          basis=("bundled 35 °C rise" if c["bundled"] else ("free air, 100 °C ambient (engine bay)" if c.get("hot") else "free air, 80 °C ambient")), drop_cont=(None if d_cont is None else round(d_cont, 3)),
                          drop_peak=(None if d_peak is None else round(d_peak, 3)), passes=ok_amp and ok_drop and ok_peak)
        if res["passes"]:
            return res
        best = best or res
    return best


def main():
    reg = json.load((CD / "k5_registry.json").open())
    W = {str(w["id"]): w for w in reg["wires"] + reg["implied"]}
    out = []
    for c in CABLES:
        w = W.get(c["id"], {})
        if c["ft"] is None and w.get("length_ft"):
            c["ft"] = w["length_ft"]
        r = size(c)
        out.append((c, r, w.get("awg")))
    lines = ["# CABLE SIZING — the DC primary from physics (generated by cable_sizing_v5.py)", "",
             "Rules and sources are in the script's docstring. A cable passes when its ampacity covers the larger of the load and fuse ÷ 0.85, "
             "the continuous drop is ≤ 0.42 V, and the cranking drop is ≤ 0.5 V. Lengths are the twin's where they exist (round trip "
             "is counted through the return cable listed separately).", "",
             "| cable | from → to | load | fuse | today | **sized** | ampacity vs need | drop cont / peak (V) | basis | passes |", "|---|---|---|---|---|---|---|---|---|---|"]
    decisions = {}
    for c, r, today in out:
        sized = f"{r['n']} × {r['awg']} AWG" if r["n"] > 1 else f"{r['awg']} AWG"
        lines.append(f"| {c['id']} | {c['frm']} → {c['to']} | {c['cont']} A{(' / ' + str(c['peak']) + ' A brief') if c['peak'] else ''} | {r['fuse']} | {today} AWG | **{sized}** | {r['ampacity']} vs {r['need']} | "
                     f"{r['drop_cont'] if r['drop_cont'] is not None else '— (no length)'} / {r['drop_peak'] if r['drop_peak'] is not None else '—'} | {r['basis']} | {'yes' if r['passes'] else 'NO'} |")
        decisions[c["id"]] = OrderedDict(awg=int(r["awg"]), parallel=r["n"], fuse=r["fuse"], why=(
            f"sized from physics 2026-09-28: load {c['cont']} A ({c['why_load']}); ampacity {r['ampacity']} A ({r['basis']}) vs need {r['need']} A; "
            f"drop {r['drop_cont']} V" + (f", cranking {r['drop_peak']} V" if c['peak'] else "") + f"; {r['fuse']}. cable_sizing_v5.py"))
    lines += ["", "## What the table says", "",
              "- The 2-vs-4 AWG question is not a preference: on this truck every spine cable is 2 AWG M22759/16, and the four that carry the "
              "whole battery current (battery → isolator → stud, the battery's return, the block ground, the alternator feed) are two 2 AWG in "
              "parallel, equal length, each in its own sleeve. That is Dave's 2 AWG stock, doubled where one cable cannot carry the fuse.",
              "- The PDM30 feed stays a single 2 AWG on the MEGA 125 (free-air 150 A ≥ 147 A required; 1.9 ft, solo in its sleeve).",
              "- Engine-bay cables are rated on the manual's 100 °C-ambient column; the cab-side PDM30 feed on the 80 °C column; loom and bed runs on the bundled chart.",
              "- The PDM15 feed moves from 4 AWG to 2 AWG: a MEGA 100 needs 118 A of cable and 4 AWG has 100 A at 100 °C.",
              "- The amplifier feed and its ground move from 4 AWG to 2 AWG: at 18.4 ft the 3 % drop rule fails at 4 AWG (0.62 V) and passes at 2 AWG "
              "(0.40 V). Moving the YellowTop to the bed would bring the run under 8 ft and let 4 AWG pass; that is the alternative.",
              "- The iBooster feed and the Orion input move from 8 AWG to 6 AWG: a MIDI 40 needs 47 A of cable; 8 AWG bundled is 40 A.",
              "- Insulation is Tefzel M22759/16 (600 V, 150 °C), the locked spec; ProWire stocks the 2 AWG (M22759/16-2). Dave's 600 V battery "
              "cable is the same voltage class in a PVC/XLPE jacket; the difference is temperature rating and the lock, not the physics."]
    (CD / "CABLE_SIZING.md").write_text("\n".join(lines) + "\n")
    (CD / "cable_decisions.json").write_text(json.dumps(decisions, indent=1))
    for c, r, today in out:
        print(f"{c['id']:12s} today {today} AWG -> {r['n']}x{r['awg']} AWG  {r['fuse']:12s} amp {r['ampacity']} vs {r['need']}  drop {r['drop_cont']} / {r['drop_peak']}  {'ok' if r['passes'] else 'FAIL'}")
    print(f"-> {CD / 'CABLE_SIZING.md'}")


if __name__ == "__main__":
    main()
