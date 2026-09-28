#!/usr/bin/env python3
"""reconcile_v5.py — Phase 0 of the K5 paper build-out.

Plan: ~/.claude/plans/replicated-hatching-sutherland.md (approved 2026-09-26).
Builds ONE registry from the four overlapping harness layouts, so every later
output (cut list, connector schedule, per-plug kits, BOM, Lego-book pages, the
app's k5Subsystems.ts) derives from a single source instead of parallel copies.

Deterministic. No network, no DB. Re-run any time; output is overwritten.

Sources (all rows keep file:line provenance):
  V42  docs/wiring/output/K5_cut_list_v4_2.txt      174 wires, newest decisions (Jun 10).
       Parsed with lego-book/build_ch1.parse_cut_list (reused, not re-implemented).
  CH1  docs/wiring/output/lego-book/ch1_wire_index.csv  Dave-convention colors,
       printed labels, engine-running flags (Sep 25).
  APR  docs/wiring/build-plan/MASTER_CUT_LIST.csv   332 wires, whole vehicle, both
       ends + terminals (Apr 17). Pre-dates the Tefzel lock (2026-05-11) and the
       6L90/PCS, EV1, Quantum-pump, engine-only-firewall decisions.
  DEV  /Users/skylar/k5-harness-pull/devices.json   141-device manifest.
  SUB  docs/wiring/calc-data/subsystems.json         wire -> subsystem (v3 era).

Outputs:
  docs/wiring/calc-data/k5_registry.json   the master (v5.0-draft)
  docs/wiring/calc-data/RECONCILE_REPORT.md
"""
import csv
import importlib.util
import json
import os
import re
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]   # the checkout this file lives in (was hard-coded /Users/skylar/nuke)
WD = REPO / "docs/wiring"
CD = WD / "calc-data"
LEGO = WD / "output/lego-book"
APR_CSV = WD / "build-plan/MASTER_CUT_LIST.csv"
CH1_CSV = LEGO / "ch1_wire_index.csv"
DEV_JSON = Path("/Users/skylar/k5-harness-pull/devices.json")
SUB_JSON = CD / "subsystems.json"
OUT_REG = CD / "k5_registry.json"
OUT_REP = CD / "RECONCILE_REPORT.md"

# ---------------------------------------------------------------- V42 via the existing parser
def load_v42():
    here = os.getcwd()
    os.chdir(LEGO)  # build_ch1 runs its twin-geometry step at import; it expects its own dir
    try:
        spec = importlib.util.spec_from_file_location("build_ch1", LEGO / "build_ch1.py")
        b1 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(b1)
        wires = b1.parse_cut_list()
        V42_ECU["M130"] = [[pin, code, name] for pin, (code, name) in b1.M130.items()]
        V42_ECU["rail_pins"] = sorted(b1.RAIL_PINS)
    finally:
        os.chdir(here)
    return wires


# M130 pin functions, read from lego-book/build_ch1.py (CONNECTOR_DATA_REPORT.md:231-295, Dave-style names) at load
V42_ECU = {"source": "reference/connectors/CONNECTOR_DATA_REPORT.md:231-295 via output/lego-book/build_ch1.py M130 table"}


def load_ch1():
    return {r["wire_id"].lstrip("#"): r for r in csv.DictReader(CH1_CSV.open())}


# ---------------------------------------------------------------- APR, re-aligned on insulation
INS_RE = re.compile(r"^(TXL|GXL|SXL|Tefzel|Welding|COAX|SHIELDED|M22759|M27500)", re.I)


def load_apr():
    raw = list(csv.reader(APR_CSV.open()))
    rows = []
    for n, f in enumerate(raw[1:], 2):
        i = next((k for k in range(6, len(f)) if INS_RE.match(f[k] or "")), None)
        if i is None:
            continue
        rest = f[i + 8:]
        if len(rest) == 1 and "," in rest[0]:  # bundle+notes merged into one quoted field
            bundle, notes = rest[0].split(",", 1)
        else:
            bundle, notes = (rest[0] if rest else ""), ",".join(rest[1:])
        rows.append(OrderedDict(
            line=n, sub=f[0], id=f[1], from_dev=f[2], from_pin=",".join(f[3:i - 3]).strip(),
            to_dev=f[i - 3].strip(), to_pin=f[i - 2].strip(), awg=f[i - 1].strip(), ins=f[i],
            color=f[i + 1], length_in=f[i + 2], term_from=f[i + 5], term_to=f[i + 6],
            label=f[i + 7], bundle=bundle.strip(), notes=notes.strip(),
        ))
    return rows


# ---------------------------------------------------------------- normalisation + matching
M130_RE = re.compile(r"\b([AB])\s*0?(\d{1,2})\b")


def ecu_key(dev, pin):
    """'M130_Connector_A' + 'A19 (INJ_PH1)' -> 'M130:A19'; 'M130:A1' -> 'M130:A01'."""
    d = (dev or "").upper()
    if "M130" not in d and not d.startswith("M130"):
        return None
    m = M130_RE.search(pin or "") or M130_RE.search(d.split(":")[-1])
    return f"M130:{m.group(1)}{int(m.group(2)):02d}" if m else None


STOP = set("the a of and to for with from sensor signal wire bus rail left right front rear lh rh ecu pdm30 pdm m130 connector pin "
           "conductor via stub branch handoff h1 todo".split())
SYN = {  # April abbreviations -> v4.2 words (so KNK1- finds 'Knock Sensor Bank 1 Ground')
    "knk": ["knock"], "oilp": ["oil", "pressure"], "ops": ["oil", "pressure"], "fpress": ["fuel", "pressure"],
    "fps": ["fuel", "pressure"], "clt": ["coolant", "temp"], "cts": ["coolant", "temp"], "ect": ["coolant", "temp"],
    "iat": ["intake", "air", "temp"], "oilt": ["oil", "temp"], "ots": ["oil", "temp"], "dbw": ["etb", "throttle"],
    "tps": ["throttle"], "tac": ["throttle"], "ckp": ["crank"], "cmp": ["cam"], "gnd": ["ground"], "sgnd": ["ground"],
    "ref": ["reference"], "wb": ["wideband"], "lambda": ["wideband"], "inj": ["injector"], "vhx": ["dakota"],
    "temperature": ["temp"], "hdlt": ["headlight"], "wtr": ["coolant"], "spd": ["speed"], "vss": ["speed"],
}


def toks(*parts):
    s = " ".join(p or "" for p in parts).lower()
    s = re.sub(r"([a-z])(\d)", r"\1 \2", s)          # knk1 -> knk 1, coil8 -> coil 8
    s = re.sub(r"[_/()\-+:#.,]", " ", s)
    out = set()
    for t in s.split():
        if len(t) < 2 or t in STOP or t.isdigit():
            continue
        out.update(SYN.get(t, [t]))
    return out


SIDE = {"left": "L", "lh": "L", "ds": "L", "driver": "L", "right": "R", "rh": "R", "ps": "R", "passenger": "R"}


def side_of(*parts):
    s = " ".join(p or "" for p in parts).lower()
    found = {v for k, v in SIDE.items() if re.search(rf"\b{k}\b", s)}
    return found.pop() if len(found) == 1 else None


def num_of(*parts):
    m = re.search(r"(?:tps|knk|knock|coil|injector|inj|ign|cyl|bank|track|motor|\bm|\bb|\bt)[\s_]*(\d)(?!\d)",
                  " ".join(p or "" for p in parts).lower())
    return m.group(1) if m else None


SECTION_TO_SUB = {
    "ENGINE LOOM": {"engine-harness"},
    "EXTERIOR / BODY": {"lighting-front", "lighting-rear", "body-convenience", "dash-cabin"},
    "INTERIOR / DASH": {"dash-cabin", "body-convenience"},
    "CHASSIS / UNDERBODY": {"powertrain-chassis", "lighting-rear", "engine-harness", "body-convenience"},
    "AUDIO": {"body-convenience", "dash-cabin"},
    "POWER / COMM": {"powertrain-chassis", "engine-harness", "dash-cabin"},
    "MISC": None,
    "DAKOTA": {"dash-cabin"},
}


def allowed_subs(section):
    for k, v in SECTION_TO_SUB.items():
        if section.upper().startswith(k) or k in section.upper():
            return v
    return None  # companions, lifelines, APS, etc.: engine or dash — no restriction


GENERIC = {"battery", "positive", "negative", "feed", "power", "main", "b", "12v", "out", "in", "com", "trigger", "input"}


def role(label, *devs):
    s = " ".join([label or ""] + [d or "" for d in devs]).lower()
    lab = (label or "").lower()
    if re.search(r"5\s?v|reference|\bref\b|5v_ref", s):
        return "5v"
    if re.search(r"ground|\bgnd\b|sgnd|negative|return|-\s*$", lab) or "_gnd" in s:
        return "ground"
    if re.search(r"\+\s*$|\bpwr\b|\+12v|\bb\+|feed\b", lab):
        return "power"
    return "other"


RAILS = {"INJ_PWR", "COIL_PWR", "COIL_GND"}  # buses; April models the per-device branches separately


def score(v, a):
    """Containment of label words (notes excluded — they drown the signal), with role, side + index guards."""
    tv = toks(v["label"]) - GENERIC
    ta = toks(a["label"], a["from_dev"], a["to_dev"]) - GENERIC
    if not tv or not ta:
        return 0.0
    if role(v["label"]) != role(a["label"], a["from_dev"], a["to_dev"]):
        return 0.0  # a signal never pairs with a 5V ref or a ground return, and vice versa
    s = len(tv & ta) / min(len(tv), len(ta))
    sv, sa = side_of(v["label"]), side_of(a["label"], a["from_dev"], a["to_dev"])
    if sv and sa and sv != sa:
        return 0.0
    nv, na = num_of(v["label"]), num_of(a["label"], a["from_dev"], a["to_dev"])
    if nv and na and nv != na:
        return 0.0
    return s


def match(v42, apr):
    """Greedy 1:1. Pass 1: exact M130 pin + best label score. Pass 2: label score within section."""
    by_pin = defaultdict(list)
    for a in apr:
        for k in (ecu_key(a["from_dev"], a["from_pin"]), ecu_key(a["to_dev"], a["to_pin"])):
            if k:
                by_pin[k].append(a)
    cand = []
    for v in v42:
        if v["id"] in RAILS:
            continue
        vk = ecu_key(v["frm"].split(":")[0] if ":" in v["frm"] else v["frm"], v["frm"])
        pool = by_pin.get(vk, []) if vk else []
        if pool:
            for a in pool:
                s = score(v, a)
                # April's M130 pins are unreliable ("or similar", B08/B10 refs, fuel PSI on A14): a pin is only a
                # tie-breaker bonus, never enough on its own
                if s >= 0.6:
                    cand.append((1.0 + s, v["id"], a["id"], "pin"))
        subs = allowed_subs(v["section"] or "")
        for a in apr:
            if subs and a["sub"] not in subs:
                continue
            s = score(v, a)
            if s >= 0.6:
                cand.append((s, v["id"], a["id"], "label"))
    cand.sort(key=lambda t: -t[0])
    used_v, used_a, pairs = set(), set(), {}
    for s, vid, aid, how in cand:
        if vid in used_v or aid in used_a:
            continue
        used_v.add(vid)
        used_a.add(aid)
        pairs[vid] = (aid, round(s, 2), how)
    return pairs


# ---------------------------------------------------------------- decisions since v4.2 (cited)
GSTAR_EARLY = "GND-BANK-ENG (ground star: stud bank beside the batteries - both battery negatives, block, frame and engine-bay returns)"
GCAB_EARLY = "GND-BANK-CAB (cab ground bank beside the PDM30)"
GREAR_EARLY = "GND-SPLICE-REAR (rear harness ground bus)"
SW0V_EARLY = ("chapters/17 §17.7.7: each switch sits between its DIG pin and the PDM's 0V; MoTeC PDM manual p.47: A_28 and B_22 "
              "= 0V")
IMPLIED = [
    # id, label, from, to, awg, spec, source
    ("G1", "Main ground: ground star to engine block (starter + alternator return)", GSTAR_EARLY, "PS-STUDS (engine block near the starter)", 2, "M22759/16",
     "output/lego-book/ch1_p1_power_spine.md (twin 41.7 in); chapters/17:69"),
    ("G2", "Ground star to frame rail (welded boss)", GSTAR_EARLY, "PS-STUDS (frame rail boss)", 4, "M22759/16",
     "chapters/17-power-architecture-ecu-pdm.md:70; state 0h(2)"),
    ("G3", "Ground strap engine to firewall (cab)", "PS-STUDS (engine head/block)", "PS-STUDS (firewall bond stud)", 8, "M22759/16",
     "chapters/17-power-architecture-ecu-pdm.md:71; state 0h(2)"),
    ("ETH_TX+", "M130 Ethernet TX+ to cab RJ45 (crossover)", "M130:B23", "PORT-ETH (socket pin 3)", 24, "Cat5 pair",
     "MoTeC M1 Tune manual p.10; state 0k"),
    ("ETH_TX-", "M130 Ethernet TX- to cab RJ45", "M130:B24", "PORT-ETH (socket pin 6)", 24, "Cat5 pair", "MoTeC M1 Tune manual p.10"),
    ("ETH_RX+", "M130 Ethernet RX+ to cab RJ45", "M130:B25", "PORT-ETH (socket pin 1)", 24, "Cat5 pair", "MoTeC M1 Tune manual p.10"),
    ("ETH_RX-", "M130 Ethernet RX- to cab RJ45", "M130:B26", "PORT-ETH (socket pin 2)", 24, "Cat5 pair", "MoTeC M1 Tune manual p.10"),
    ("CAN_HI", "CAN trunk High: M130 B17 CAN_HI -> PDM30 B26 CAN High", "M130:B17", "PDM30:B26 (CAN High)", 22, "M22759/16 twisted",
     "MoTeC M1 hardware techspec: B17 CAN_HI 'CAN Bus 1 High'; MoTeC PDM user manual p.44 PDM30 B_26 CAN High; p.49 twisted pair"),
    ("CAN_LO", "CAN trunk Low: M130 B18 CAN_LO -> PDM30 B25 CAN Low", "M130:B18", "PDM30:B25 (CAN Low)", 22, "M22759/16 twisted",
     "MoTeC M1 hardware techspec: B18 CAN_LO 'CAN Bus 1 Low'; MoTeC PDM user manual p.44 PDM30 B_25 CAN Low; p.49 twisted pair"),
    ("UTC_CANH", "PDM config port CAN-HI (XLR pin 5)", "CAN-BUS (trunk CAN_HI splice)", "PORT-UTC (XLR pin 5)", 22, "M22759/32 twisted",
     "MoTeC PDM manual p.48; state 0k"),
    ("UTC_CANL", "PDM config port CAN-LO (XLR pin 4)", "CAN-BUS (trunk CAN_LO splice)", "PORT-UTC (XLR pin 4)", 22, "M22759/32 twisted", "MoTeC PDM manual p.48"),
    ("UTC_0V", "PDM config port 0V (XLR pin 1)", "PDM30:B22", "PORT-UTC (XLR pin 1)", 22, "M22759/32",
     "MoTeC PDM manual p.48 (UTC 0V) + p.47 (PDM30 B_22 = 0V)"),
    ("ISO_KILL", "Isolator state (yellow, grounded while closed) to the M130 shutdown input", "SPL-ISO-YEL (stub splice on the switch's yellow wire, tab 7)",
     "M130:B14 (UDIG7)", 22, "M22759/32",
     "MoTeC PDM manual p.7: 'the isolator switch should have a secondary switch that is connected to a shutdown input on the "
     "ECU'; Blue Sea 7700 yellow = LED output, the LED's ground while the switch is closed (instructions p.2); M1 hardware spec "
     "p.9: universal digital input, switchable 3k3 pull-up via diode to +5 V, programmable trigger levels +/-10 V, peak 200 V — "
     "reads the yellow low when closed, high when open; the M1 tune shuts the engine down when it reads open"),
    ("DAK_CONST", "Dakota VHX CONST. POWER (always-hot, fused)", "PDM30-STUD (3 A inline fuse)", "DAKOTA-VHX (CONST. POWER)", 18, "M22759/32",
     "DAKOTA_VHX_ARCHITECTURE.md §2 'CONST. POWER gap'; VHX manual p.6"),
    ("PCS_BATT", "PCS TCM-2650 constant 12V (5A)", "PS-STUDS (distribution stud, 5 A fuse)", "PCS harness B+", 18, "M22759/32",
     "receipts/2026-07-12_6l80e-can-master-ruling.md F3"),
    ("PCS_IGN", "PCS TCM-2650 ignition", "PDM15:OUT13", "PCS harness IGN", 20, "M22759/32", "ZGP TCM2650 setup guide rev2 p.1"),
    ("PCS_TPS", "PCS analog 1 <- pedal track 1 signal tap (signal only)", "M130:B21 / APS track 1 signal", "PCS analog input 1", 22,
     "M22759/32",
     "ZGP guide p.13 + Table 4 (AI1 may piggyback an ECU sensor); the TB 12699160 position line is SENT (digital), so the "
     "analog tap moves to the pedal's track 1"),
    ("PCS_RPM", "PCS speed input 3 <- M130 tach mirror", "M130:A33 (OUT_HB5)", "PCS orange/black", 22, "M22759/32",
     "ZGP guide p.12; 6L90 ruling"),
    ("PCS_BRK", "PCS 'Brake Light' digital input <- brake switch", "Brake light switch out", "PCS digital input", 22, "M22759/32",
     "ZGP guide p.18"),
    ("PCS_NS", "PCS lever-position ground out -> PDM crank-enable input", "PCS PWM vs Lever Position", "PDM30:DIG11 (B20) crank enable, relayed to the engine PDM over CAN", 22, "M22759/32",
     "ZGP guide p.19-20; receipts/2026-09-26_substrate-correction-1977-neutral-start-switch-on-column.md"),
    ("PCS_REV", "PCS lever-position ground out -> PDM reverse-lamp input", "PCS PWM vs Lever Position", "PDM30:DIG15 (B17) reverse", 22, "M22759/32",
     "ZGP guide p.19-20"),
]
PDM_PIGTAIL_NOTE = ("PDM 20 A outputs feeding a wire heavier than 16 AWG land two 16 AWG pigtails, one per pin, equal length "
                    "(registry wires <load>_PT1/_PT2), joined to the load wire in an in-line MiniSeal M81824/1-3 "
                    "(endpoints SPL-<box>-OUTn) — Superseal contact max 16 AWG, MoTeC PDM manual p.48 20# to 16# on 20 A "
                    "outputs; state 0h finding (1), review A1 2026-09-28")

# Per-coil and per-injector branch wires. Coil pins per Dave's M130 sheet ("ignition coil": a chassis ground,
# b signal ground, c signal/trigger, d switched power; grounds to a head ring terminal); injector = EV1 2-pin
# (Siemens Deka FI114961, 12.5 ohm). Gauge by current: coil branch 18 AWG (MoTeC PDM manual p.48: 18# = 11 A at
# 80 C) and injector branch 20 AWG (14 V / 12.5 ohm = 1.1 A; 20# = 8 A). Lengths are ordering estimates; the
# final cut is last (owner 2026-09-26).
DAVE_SHEET = "Desert Performance 'M130 ECU Overland Bronco.xlsx' (Dave's M130 sheet): ignition coil a/b/c/d"
DEKA = "Siemens Deka FI114961: EV1 (Minitimer), 12.5 ohm (siemensdeka.com product page)"
BRANCH_EST = "ordering estimate (DEL-Stributor cluster / fuel rail) — cut last"
BRANCH_EXTRA = {}
SPALD = ("SPAL 12 VDC brushless fan wiring diagram (reference_documents/component_drawings/SPAL_Brushless_Fan_Wiring_Diagram.pdf): "
         "'FAN TO CHASSIS GROUND'; power red through a fuse; ProWire 30130628 kit: two 12 ga power terminals, two 20-18 ga control "
         "(web_snapshots/www.prowireusa.com__SPAL-BRUSHLESS-FAN-CONNECTOR-KIT-30130628.md)")
FANPWM = ("SPAL brushless PWM requirements (Kartek, image https://www.kartek.com/mm5/graphics/00000002/spal-brushless-fans-engine-ecu-"
          "pwm-pulse-width-modulation-requirements.jpg, read 2026-09-28): PWM 50-500 Hz, typical 100 Hz, 0-100 % duty, 4.8 mA; Kartek "
          "page (web_snapshots/www.kartek.com__spal-30107090-...md): 'negative or grounding type PWM ... the controller or ECU provides "
          "the low' on the white wire. PDM outputs are high side only (PDM manual p.22), so the M130 drives it: A34 OUT_HB6 is unused "
          "(M130 pinout) and a half bridge's 'high and low side drivers can be PWM', low side to 20 kHz (M1 hardware techspec, Half "
          "Bridge Output). 20 AWG: the kit's control terminals take 20-18 ga (ProWire 30130628), the 61-pin #20 contacts 20-24 AWG")
FANJ = ("fan junction (round 3 close): PDM15 OUT1 and OUT6 each feed 2 x 16 AWG pigtails into their own M81824/1-3 (2 x 2,580 = 5,160 CM, 12 AWG equivalent, in the 16-12 cavity) -> a 12 AWG leg; both legs and the 12 AWG fan tail land on FAN-JUNCTION, a Blue Sea 2103 PowerPost Plus (3/8-16 stud, 150 A) on ProWire 9918 rings (12-10 AWG, 3/8 in). Limits 16 A per output, 32 A total >= 1.25 x 25 A. Each output's pigtails: 2 x 12 A at 100 C (PDM manual p.48) = 24 A, 0.85 x 24 = 20.4 >= 16. Each leg carries 16 A: 12 AWG singles 38 A (ProWire singles table, 60 C difference), 0.85 x 38 = 32.3 >= 16. The tail carries 32 A: it needs 32 / 0.85 = 37.6 A, the singles table gives 38 A — only in free air at <= 90 C ambient (the hot-soak OPEN and the outside-the-loom routing apply to the tail)")
IMPLIED += [("FAN_LEG1", "Fan feed leg 1: PDM15 OUT1 (pigtail splice) -> FAN-JUNCTION stud", "PDM15:OUT1", "FAN-JUNCTION (stud)", 12,
             "M22759/32", FANJ),
            ("FAN_LEG2", "Fan feed leg 2: PDM15 OUT6 (pigtail splice) -> FAN-JUNCTION stud", "PDM15:OUT6", "FAN-JUNCTION (stud)", 12,
             "M22759/32", FANJ)]
BRANCH_EXTRA["FAN_LEG1"] = {"color": "red", "free_air": True, "control": "CAN: M130 fan request (MoTeC PDM manual p.39 CAN input) — OUT1 and OUT6 on one channel (p.22)", "length_ft": None, "length_basis": "short leg from the splice to the stud; formboard"}
BRANCH_EXTRA["FAN_LEG2"] = {"color": "red", "free_air": True, "control": "CAN: M130 fan request (MoTeC PDM manual p.39 CAN input) — OUT1 and OUT6 on one channel (p.22)", "length_ft": None, "length_basis": "short leg from the splice to the stud; formboard"}
IMPLIED += [("FUEL_SND_LEAD", "Fuel sender signal lead: the #98 / #117 splice to DT pin 1 above the tank lid", "SPL-FUEL-SND (lead side)",
             "FUEL-LEVEL (1)", 20, "M22759/32",
             "the two instruments' sender wires join in ONE in-line splice (M81824/1-2, blue: 2 x 20 AWG = 2,040 CM, 16 AWG equivalent, one side; "
             "the 20 AWG lead the other — 3137CT 20-16 AWG) so the DT size-16 contact holds one wire (standards review, round 3); the "
             "adjudication on #98/#117 stands (two instruments on one sender)")]
BRANCH_EXTRA["FUEL_SND_LEAD"] = {"length_ft": None, "length_basis": "short lead from the splice to the tank-top plug; cut at the tank"}
IMPLIED += [("FAN_PWM", "Radiator fan speed: M130 A34 low-side PWM -> SPAL white control lead", "M130:A34", "FAN (PWM white lead)", 20,
             "M22759/32", FANPWM)]
BRANCH_EXTRA["FAN_PWM"] = {"length_ft": 4.6, "length_basis": "cut list v4.2 zone estimate (the M130-to-engine-bay runs)",
                           "control": "M1 tune: A34 as a low-side PWM fan output at 100 Hz; set speed 25-100 % over 10-90 % duty (SPAL chart)"}
IMPLIED += [("FAN_GND", "Radiator fan ground (SPAL 30107090 black) in the loom to the ground star", "FAN (ground)", GSTAR_EARLY, 12,
             "M22759/32", SPALD + "; the fan had no ground wire in the registry; grounds run in the loom (state row 56)")]
BRANCH_EXTRA["FAN_GND"] = {"color": "black", "length_ft": 2.2, "length_basis": "follows #21 (twin: battery -> K5H_RadFan_1, x 1.2 pad)"}
IMPLIED += [("PUMP_GND", "Fuel pump ground: hanger ground terminal to a frame stud near the tank", "FUEL-PUMP (hanger ground)",
             GSTAR_EARLY, 14, "M22759/32", "QFS P367 5.1 A (highflowfuel.com); matches the #66 feed gauge; returns in the loom with "
             "#66 to the ground star (owner 2026-09-27: grounds in the loom)")]
BRANCH_EXTRA["PUMP_GND"] = {"color": "black", "length_ft": 18.4,
                            "length_basis": "follows #66: the ground returns in the loom beside the feed from the tank to the "
                                            "engine-bay ground star (owner 2026-09-27: grounds in the loom), so it is the feed's "
                                            "18.4 ft cut list v4.2 zone estimate — was a 3.0 ft 'ordering estimate' that assumed a "
                                            "frame stud by the tank"}
for _n in range(1, 9):
    IMPLIED += [
        (f"COIL{_n}_PWR", f"Coil {_n} switched +12 V (pin d) from the COIL_PWR rail", "COIL_PWR rail splice", f"COIL-{_n}:d",
         18, "M22759/32", DAVE_SHEET),
        (f"COIL{_n}_GND", f"Coil {_n} chassis ground (pin a) to the head ring terminal", f"COIL-{_n}:a",
         "head ring terminal (chassis ground)", 18, "M22759/32", DAVE_SHEET),
        (f"COIL{_n}_SGND", f"Coil {_n} signal ground (pin b) to the head ring terminal", f"COIL-{_n}:b",
         "head ring terminal (signal ground)", 18, "M22759/32", DAVE_SHEET),
        (f"INJ{_n}_PWR", f"Injector {_n} +12 V (pin 2, Dave's sheet) from the INJ_PWR rail", "INJ_PWR rail splice", f"INJ-{_n}:2",
         20, "M22759/32", DEKA),
    ]
    BRANCH_EXTRA[f"COIL{_n}_PWR"] = {"color": "red", "length_ft": 2.0, "length_basis": BRANCH_EST}
    BRANCH_EXTRA[f"COIL{_n}_GND"] = {"color": "black", "length_ft": 2.0, "length_basis": BRANCH_EST}
    BRANCH_EXTRA[f"COIL{_n}_SGND"] = {"color": "brown/black", "length_ft": 2.0, "length_basis": BRANCH_EST}
    BRANCH_EXTRA[f"INJ{_n}_PWR"] = {"color": "red", "length_ft": 1.5, "length_basis": BRANCH_EST}

# --- 2026-09-27: the engine-start set wired end to end (owner: "get it done ... i can tell u to replace later";
#     plan ~/.claude/plans/vivid-hugging-globe.md). The engine PDM is a MoTeC PDM15 in the engine bay by the battery
#     (owner 2026-09-24 "rule of thumb in motec is to run multiple pdm"; split = engine loads on the PDM15, body on
#     the PDM30). PDM15 pins: MoTeC PDM user manual p.43. Inputs are switch-to-ground (chapters/17 §17.8.7).
PDM15_PIN = "MoTeC PDM user manual p.43 (PDM15 pinout)"
CANW = "MoTeC PDM user manual p.50 (CAN wiring: twisted 22# Tefzel, one twist per 50 mm; a bus over 2 m takes a 100R at each end)"
LTCDM = "MoTeC LTCD user manual, Power/CAN connector DTM 4-pin (F) #68054: 1 Battery - black, 2 CAN Lo green, 3 CAN Hi white, 4 Battery + red"
IMPLIED += [
    ("PDM15_BPOS", "PDM15 battery feed (engine PDM)", "Distribution stud (MEGA 80 A)", "PDM15 battery stud (M6)", 6, "M22759/16",
     PDM15_PIN + " connector C = M6 stud Battery +; chapters/17 §17.3 topology, §17.8.4 (6 AWG at the M6 stud)"),
    ("PDM15_GND1", "PDM15 battery negative 1", "PDM15:A26", GSTAR_EARLY, 20, "M22759/32", PDM15_PIN + " A_26; chapters/17 §17.4.7"),
    ("PDM15_GND2", "PDM15 battery negative 2", "PDM15:B18", GSTAR_EARLY, 20, "M22759/32", PDM15_PIN + " B_18; chapters/17 §17.4.7"),
    ("IGN_RUN_B", "Ignition RUN to the body PDM (switch-to-ground input)", "PDM30:DIG1", "IGN-SWITCH (IGN/RUN terminal)", 22,
     "M22759/16", "output/K5_pdm30_channel_plan.md DIG1 A27; chapters/17 §17.8.7"),
    ("IGN_START", "Ignition START to the body PDM (crank request; relayed to the engine PDM over CAN)", "PDM30:DIG10",
     "IGN-SWITCH (SOL/START terminal)", 22, "M22759/16",
     "PDM30 DIG10 freed when the locks moved to reversing switches; the engine PDM15 takes RUN/START over CAN from the PDM30 "
     "(MoTeC PDM manual p.39 CAN input; p.23 timeout -> off): no firewall crossing, and a dead bus shuts the engine loads off"),
    ("IGN_SW_0V", "Ignition switch battery terminal to PDM30 0V (the switch now switches 0V)", "PDM30:A28",
     "IGN-SWITCH (BAT terminal)", 22, "M22759/16", SW0V_EARLY + "; cab side, no crossing"),
    ("START_TRIG", "Starter solenoid S terminal from the engine PDM", "PDM15:OUT4", "STARTER-S (starter solenoid S terminal)", 12,
     "M22759/32", PDM15_PIN + " OUT4 20 A (A7 + A16); owner row 54 'PDM replaces relays'"),
    ("CAN_FW_H", "CAN Hi: body PDM30 to engine PDM15, through the 61-pin", "PDM30:CANHI", "PDM15:B26 (CAN High)", 22,
     "M22759/16 twisted", CANW + "; " + PDM15_PIN + " B_26"),
    ("CAN_FW_L", "CAN Lo: body PDM30 to engine PDM15, through the 61-pin", "PDM30:CANLO", "PDM15:B25 (CAN Low)", 22,
     "M22759/16 twisted", CANW + "; " + PDM15_PIN + " B_25"),
    ("CAN_LTCD_H", "CAN Hi: PDM15 to the LTCD (100R terminator at the LTCD end)", "PDM15:CANHI", "WIDEBAND:3 (CAN Hi, white)", 22,
     "M22759/16 twisted", CANW + "; " + LTCDM),
    ("CAN_LTCD_L", "CAN Lo: PDM15 to the LTCD", "PDM15:CANLO", "WIDEBAND:2 (CAN Lo, green)", 22, "M22759/16 twisted", CANW + "; " + LTCDM),
    ("LTCD_GND", "LTCD battery negative", "WIDEBAND:1 (Battery -, black)", GSTAR_EARLY, 20, "M22759/32", LTCDM + "; chapters/17 §17.4.2"),
    ("AC_LP_0V", "A/C low-pressure switch second lead to PDM15 0V", "PDM15:A28", "AC-LP-SW (second lead)", 22, "M22759/16",
     SW0V_EARLY + " (the PDM15 shares the PDM30 pin positions, manual p.43); state 0e(a): the M130 has no analog inputs left, a "
     "switch belongs on a PDM input"),
    ("AC_HP_0V", "A/C high-pressure switch second lead to PDM15 0V", "PDM15:A28", "AC-HP-SW (second lead)", 22, "M22759/16",
     SW0V_EARLY + "; state 0e(a)"),
]
NUREL = "Nu-Relics 17383-2 (1973-91 Blazer/Jimmy front-door power window kit: bolt-in, reverse-polarity chrome switches, harness; nu-relics.com/73-87-Chevy-Truck-Regulators-p/17383-2.htm)"
AUTOLOC = "AutoLoc AUTZT2000 compact heavy-duty 2-wire lock actuator, 13 lb (autoloc.com catalog)"
RVS = "Rear View Safety RVS-7180355-IR license-plate camera + replacement mirror display, 12 V, reverse trigger (rearviewsafety.com)"
SEN015 = ("Dakota Digital SEN-01-5: 3-wire speed sender — red +5 V from SPD +, black to SPD -, white signal to SPD SND (Dakota "
          "VHX manual 650314:P p.8); 16k PPM (manual p.5 drawing), 7/8-18 GM speedometer-drive thread (summitracing.com "
          "dak-sen-01-5, page not saved)")
REV = "reversing switch topology: each rocker rests to ground and lifts one motor lead to +12 V (no relay — owner row 54; PDM30 outputs are high-side only)"
IMPLIED += [
    # doors: power windows (Nu-Relics 17383-2) — the switches reverse the motors; the PDM output is the fuse
    ("WIN_GND_L", "Driver window/lock switch panel ground", "WIN-SW-L (ground)", GCAB_EARLY, 14, "M22759/32", NUREL + "; " + REV),
    ("WIN_GND_R", "Passenger window/lock switch ground", "WIN-SW-R (ground)", GCAB_EARLY, 14, "M22759/32", NUREL + "; " + REV),
    ("WIN_R_UP", "Master switch to passenger switch: passenger window UP line", "WIN-SW-L (passenger UP)", "WIN-SW-R (master UP)", 14,
     "M22759/32", NUREL + " (master in series with the passenger switch)"),
    ("WIN_R_DN", "Master switch to passenger switch: passenger window DOWN line", "WIN-SW-L (passenger DOWN)", "WIN-SW-R (master DOWN)", 14,
     "M22759/32", NUREL),
    ("WIN_MOT_L_A", "Driver window motor lead A", "WIN-SW-L (motor L A)", "window_motor_DS:A", 14, "M22759/32", NUREL),
    ("WIN_MOT_L_B", "Driver window motor lead B", "WIN-SW-L (motor L B)", "window_motor_DS:B", 14, "M22759/32", NUREL),
    ("WIN_MOT_R_A", "Passenger window motor lead A", "WIN-SW-R (motor A)", "window_motor_PS:A", 14, "M22759/32", NUREL),
    ("WIN_MOT_R_B", "Passenger window motor lead B", "WIN-SW-R (motor B)", "window_motor_PS:B", 14, "M22759/32", NUREL),
    # doors: power locks — both rockers in parallel on one lock bus, feed always on (you lock the truck key-off)
    ("LOCK_FEED_R", "Lock feed to the passenger lock rocker (second wire on #38's pin)", "PDM30:OUT21", "LOCK-SW-R (feed)", 16, "M22759/32", REV),
    ("LOCK_GND_L", "Driver lock rocker ground", "LOCK-SW-L (ground)", GCAB_EARLY, 16, "M22759/32", REV),
    ("LOCK_GND_R", "Passenger lock rocker ground", "LOCK-SW-R (ground)", GCAB_EARLY, 16, "M22759/32", REV),
    ("LOCK_BUS_A", "Lock bus A: both rockers and both actuators (lock)", "LOCK-SW-L (A)", "lock_actuator_DS:1 + lock_actuator_PS:1 + LOCK-SW-R (A)",
     16, "M22759/32", AUTOLOC + "; " + REV),
    ("LOCK_BUS_B", "Lock bus B: both rockers and both actuators (unlock)", "LOCK-SW-L (B)", "lock_actuator_DS:2 + lock_actuator_PS:2 + LOCK-SW-R (B)",
     16, "M22759/32", AUTOLOC + "; " + REV),
    # factory power tailgate window: dash switch and tailgate key switch both reverse the motor (was a relay)
    ("TG_FEED", "Tailgate window feed to the factory dash switch", "PDM30:OUT1", "TG-SW-DASH (feed)", 14, "M22759/32",
     "PDM30 OUT1 freed when the fan moved to the engine PDM; 1977 K5 electric tailgate window: dash switch + tailgate key switch; " + REV),
    ("TG_GND", "Tailgate dash switch ground", "TG-SW-DASH (ground)", GCAB_EARLY, 14, "M22759/32", REV),
    ("TG_BUS_UP", "Tailgate window UP line: dash switch -> tailgate key switch", "TG-SW-DASH (UP)", "TG-SW-KEY (UP in)", 14,
     "M22759/32", "factory circuit: the key switch sits in series between the dash switch and the motor"),
    ("TG_BUS_DN", "Tailgate window DOWN line: dash switch -> tailgate key switch", "TG-SW-DASH (DOWN)", "TG-SW-KEY (DOWN in)", 14,
     "M22759/32", "factory circuit"),
    ("TG_MOT_A", "Tailgate key switch -> window motor lead A", "TG-SW-KEY (UP out)", "rear_window_motor:A", 14, "M22759/32",
     "factory circuit (inside the tailgate)"),
    # candidate (not bought): Nu-Relics 17383-1 with option #100 (no switches; motor plug + terminals), driven the way the doors
    # are: a reverse-polarity master switch at the dash feeding a second reversing switch (the key switch) in series; no relay
    # (state row 54). TG_FEED (PDM30 OUT1, a 20 A pair already pigtailed) feeds the master in this configuration.
    ("TGR_M_GND", "Tailgate master switch ground (rests the motor leads to ground)", "TG-SW-MASTER (ground)", GCAB_EARLY, 14, "M22759/32", "TGR"),
    ("TGR_UP", "Tailgate master switch UP line -> keyed switch in series", "TG-SW-MASTER (UP)", "TG-SW-KEY-REV (master UP in)", 14, "M22759/32", "TGR"),
    ("TGR_DN", "Tailgate master switch DOWN line -> keyed switch in series", "TG-SW-MASTER (DOWN)", "TG-SW-KEY-REV (master DOWN in)", 14, "M22759/32", "TGR"),
    ("TGR_KEY_FEED", "Keyed switch feed, branched at the master switch feed", "TG-SW-MASTER (feed, spliced to TG_FEED)", "TG-SW-KEY-REV (feed)", 14,
     "M22759/32", "TGR"),
    ("TGR_KEY_GND", "Keyed switch ground to the rear ground bus", "TG-SW-KEY-REV (ground)", "GND-SPLICE-REAR (rear harness ground bus)", 14,
     "M22759/32", "TGR"),
    ("TGR_CUT_IN", "Keyed switch motor lead A -> tailgate-closed cutout (183C)", "TG-SW-KEY-REV (motor A)", "TG-CUTOUT (183C)", 14, "M22759/32", "TGR"),
    ("TGR_MOT_A", "Tailgate-closed cutout (183E) -> ACI motor pole A", "TG-CUTOUT (183E)", "TG-MOTOR-ACI (pole A)", 14, "M22759/32", "TGR"),
    ("TGR_MOT_B", "Keyed switch motor lead B -> ACI motor pole B", "TG-SW-KEY-REV (motor B)", "TG-MOTOR-ACI (pole B)", 14, "M22759/32", "TGR"),
    ("TG_KEY_FEED", "Tailgate key switch FEED (factory circuit 60), branched from the dash switch feed", "TG-SW-DASH (feed, spliced to TG_FEED)",
     "TG-SW-KEY (FEED, circuit 60)", 14, "M22759/32", "TG78"),
    ("TG_CUT_IN", "Tailgate window UP line: splice 183 (key switch CLOSE terminal) -> tailgate-closed cutout switch (circuit 183C)",
     "TG-SW-KEY (CLOSE, splice 183)", "TG-CUTOUT (183C)", 14, "M22759/32", "TG78"),
    ("TG_MOT_B", "Tailgate key switch -> window motor lead B", "TG-SW-KEY (DOWN out)", "rear_window_motor:B", 14, "M22759/32",
     "factory circuit (inside the tailgate)"),
    # rear camera (license plate) + mirror display
    ("CAM_GND", "Backup camera ground", "Backup_Camera (ground)", GREAR_EARLY, 20, "M22759/32", RVS),
    ("CAM_VIDEO", "Backup camera video to the mirror display (kit RCA coax)", "Backup_Camera (video)", "MIRROR-MON (video in)", None, "kit coax (RCA)",
     RVS + "; route: plate -> body -> cab -> headliner -> mirror"),
    ("MIRROR_PWR", "Mirror display power (ignition)", "PDM30:OUT23", "MIRROR-MON (+12 V)", 20, "M22759/32",
     "PDM30 OUT23 freed when the transmission controller moved to the engine PDM; " + RVS),
    ("MIRROR_GND", "Mirror display ground", "MIRROR-MON (ground)", GCAB_EARLY, 20, "M22759/32", RVS),
    ("MIRROR_TRIG", "Mirror display reverse trigger (tap of the reverse group)", "PDM30:OUT15 tap", "MIRROR-MON (reverse trigger)", 20,
     "M22759/32", RVS + " — shows the camera only in reverse"),
    # rear stop/turn: the brake+turn filaments get their own outputs (the April plan had none)
    ("REAR_ST_L", "Left rear stop/turn (1157 brake filament)", "PDM30:OUT16", "Tail_Light_Left:1157_BRK", 18, "M22759/32",
     "PDM30 OUT16 freed when the A/C clutch moved to the engine PDM; PDM logic: brake DIG14, left turn DIG4, hazard DIG16"),
    ("REAR_ST_R", "Right rear stop/turn (1157 brake filament)", "PDM30:OUT22", "Tail_Light_Right:1157_BRK", 18, "M22759/32",
     "PDM30 OUT22 freed when the locks moved to one feed; PDM logic: brake DIG14, right turn DIG5, hazard DIG16"),
    ("BRK_SW_0V", "Brake light switch feed terminal to PDM30 0V (it now switches 0V into DIG14)", "PDM30:A28",
     "BRAKE-SW (feed terminal)", 22, "M22759/16", SW0V_EARLY + "; channel plan DIG14 brake"),
    # road speed: the NP205's mechanical speedometer drive through an electronic sender (true speed in 4-Lo)
    ("VSS_PWR", "Speed sender power from the Dakota box (SPD +)", "DAKOTA-VHX (SPD +)", "VSS-SENDER (power)", 22, "M22759/16", SEN015 + "; VHX manual p.6"),
    ("VSS_GND", "Speed sender ground (SPD -)", "VSS-SENDER (ground)", "DAKOTA-VHX (SPD -)", 22, "M22759/16", SEN015 + "; VHX manual p.6"),
    ("VSS_DAK", "Speed sender signal to the Dakota SPD SND input", "VSS-SENDER (signal)", "DAKOTA-VHX (SPD SND)", 22, "M22759/16", SEN015 + "; VHX manual p.6"),
]
TG78 = ("1978 C-K wiring booklet ST-352-78 (reference_documents/wiring_diagram_booklets/ST_352_78_CK_Wiring.pdf) p.16, sheet A-4 "
        "'Power Rear Window (RPO A33)' (read from the page image 2026-09-28): key switch 8900713 = OPEN 184 / FEED 60 (12 OR/B-60, "
        "battery via the 30 A circuit breaker) / CLOSE 183, in PARALLEL with the dash switch 8911352 (5 UP / 4 FEED / 3 DOWN): the "
        "two switches' outputs join at splice-183 and splice-184; the UP line then runs through the N/O 'tailgate closed' cutout "
        "switch 2977647 (12 LBL-183C in, 12 LBL-183E out) to the motor 6288909 UP-1; DN-2 = 12 T/W-184C")
TGR = ("Nu-Relics 17383-1 tailgate regulator + new ACI motor (web_snapshots/www.nu-relics.com__17383-1.md): option #100 'No "
       "Switches (Will Include Motor Plugs and Terminals)', option #121 'Standard Chrome Switches - 1 single switches'; ACI motor "
       "3 A no load / 5 A low / 11 A high load / 20 A stall; 'Our ACI motors are reverse polarity motors and require reverse "
       "polarity switches' — power to one pole, ground to the other, not the case. Modelled like the doors (master in series with "
       "the second switch, Nu-Relics 17383-2; " + REV + "); state row 54 (no relay). Leads 14 AWG: 22 A at 80 C (MoTeC PDM manual "
       "p.48) covers the 20 A stall; the feed is TG_FEED from PDM30 OUT1, a 20 A pair with pigtails, limit at or under the 14 AWG "
       "rating. CANDIDATE — the owner has no regulator and has not bought the kit")
IMPLIED[:] = [(i, l, f, t, g, sp, TG78 if src == "TG78" else TGR if src == "TGR" else src) for i, l, f, t, g, sp, src in IMPLIED]
# implied rows a later fact retires: they leave the wire list but stay in the registry (retired_implied), never deleted
IMPLIED_RETIRED = {"TG_GND": ("the factory dash switch 8911352 has three terminals, 5 UP / 4 FEED / 3 DOWN, and no ground (1978 "
                              "booklet p.16, sheet A-4); the ground came from the reversing-switch design, which the factory "
                              "switches do not use (book review 2026-09-28)")}
TGW = "tailgate circuit redrawn to the factory drawing (" + TG78 + "; pin-table review 2026-09-28)"
BLW = ("1978 C-K wiring booklet p.16 sheet A-4 'Air Conditioning RPO C-60' + p.8-9 circuit table (catalog/pin_tables/BLOWER-RES.yaml): "
       "the A/C resistor plug has FOUR cavities — 51 low (BAT), 63 M1, 72 M2, 101 output to the blower; not '3 prongs'")
IMPLIED_EXTRA_0927 = {
    "PDM15_BPOS": {"color": "red"}, "PDM15_GND1": {"color": "black"}, "PDM15_GND2": {"color": "black"},
    "CAN_FW_H": {"color": "yellow"}, "CAN_FW_L": {"color": "green"},       # Dave's colours: yellow CAN-H, green CAN-L
    "CAN_LTCD_H": {"color": "yellow"}, "CAN_LTCD_L": {"color": "green"}, "LTCD_GND": {"color": "black"},
    "IGN_SW_0V": {"color": "black"},
    "GSS_PWR": {"control": "PDM30 DIG1 ignition RUN (same output as #71)"},
    "ALT_L": {"control": "ignition RUN over CAN from the PDM30 (DIG1); a dead bus drops it with the other engine loads"},
    "START_TRIG": {"control": "PDM15 logic over CAN: START request (PDM30 DIG10) AND PCS neutral (PDM30 DIG11) AND the M130 crank-enable bit"},
    "PCS_IGN": {"control": "ignition RUN over CAN from the PDM30 (DIG1)"},
    "TG_FEED": {"control": "PDM30 DIG1 ignition RUN (the factory switches do the switching; the PDM is the fuse)"},
    "TG_KEY_FEED": {"control": "shares TG_FEED (PDM30 OUT1 on DIG1 ignition RUN): the key switch works only key-on — the factory "
                               "fed it always-hot (circuit 60 via the 30 A breaker); owner call whether OUT1 runs always-on"},
    "TG_CUT_IN": {"control": "the tailgate-closed cutout passes UP only with the tailgate shut (1978 booklet p.16)"},
    "MIRROR_PWR": {"control": "PDM30 DIG1 ignition RUN"},
    "LOCK_FEED_R": {"control": "always on (same output as #38: you lock the truck key-off)"},
    "TG_MOT_A": {"control": "factory dash + key switches reverse the motor; fed by TG_FEED (PDM30 OUT1 on DIG1)"},
    "TG_MOT_B": {"control": "factory dash + key switches reverse the motor; fed by TG_FEED (PDM30 OUT1 on DIG1)"},
    **{k: {"control": "the window switches reverse the motor; fed by #34/#35 (PDM30 OUT3/OUT4)"}
       for k in ("WIN_MOT_L_A", "WIN_MOT_L_B", "WIN_MOT_R_A", "WIN_MOT_R_B")},
    "MIRROR_TRIG": {"control": "reverse: PCS lever position on PDM30 DIG15 (tap of the reverse group OUT15)"},
    "REAR_ST_L": {"control": "PDM30 logic: brake DIG14, left turn DIG4 (flash), hazard DIG16"},
    "REAR_ST_R": {"control": "PDM30 logic: brake DIG14, right turn DIG5 (flash), hazard DIG16"},
}

# Colour/length for implied rows where a later record already fixes them (cited). Lengths stay None
# when nothing measured them — the kit build lists those as "no length" rather than guessing.
IMPLIED_EXTRA = {
    "G1": {"color": "black", "length_ft": 3.5,
           "length_basis": "twin: BAT- -> block 41.7 in in the digital twin (output/lego-book/power_spine_twin_lengths.txt); not taped on the truck"},
    "G2": {"color": "black"},
    "G3": {"color": "black"},
    "UTC_CANH": {"color": "yellow"},   # Dave's M130 sheet colours: yellow CAN-H, green CAN-L, brown 0V
    "UTC_CANL": {"color": "green"},    #   (receipts/2026-09-25_orders-staged-prowire-ksv-ict.md, 13:00 addendum)
    "UTC_0V": {"color": "brown"},
}
IMPLIED_EXTRA.update(BRANCH_EXTRA)
# --- 2026-09-27 evening: the whole truck (owner: "work on the whole truck"). Every lamp and device gets a named ground
#     stud, every factory switch becomes a PDM30 input or stays in its own factory circuit, audio runs head unit -> amp ->
#     speakers, and the body circuits cross the firewall through their own Deutsch bulkhead (endpoints FIREWALL-BODY-*),
#     never the engine-only 61-pin (state rows 50, 53).
PLAN_CH = "output/K5_pdm30_channel_plan.md DIG map (switch-to-ground)"
SW0V = ("chapters/17 §17.7.7: each switch sits between its DIG pin and the PDM's 0V; MoTeC PDM manual p.47: PDM30 A_28 and "
        "B_22 = 0V (the pin takes a spliced 0V bus)")
AGENT = ("agent choice under owner delegation 2026-09-27 ('you can choose the parts ... get it done ... i can tell u to replace "
         "later') — replaceable")
BLUESEA = ("Blue Sea Systems 7700 ML-RBS instructions 990180170 Rev.006 (reference_documents/component_drawings/"
           "BlueSea_7700_ML-RBS_Instructions_990180170-006.pdf): magnetic latch, 'draws no current in ON or OFF state' (p.1); "
           "cranking 1,000A 30 s on 2/0 AWG (p.1); stud terminals A and B interchangeable, 3/8\"-16, 140 in-lb max; red = +VDC 24 hr "
           "via 10 A (min), black = ground, brown = to close, orange = to open, yellow = LED output; 'Use minimum 16 AWG wire "
           "for the Control Circuit' (p.2)")
MOTEC_ISO = ("MoTeC PDM user manual p.7: 'Battery positive must generally be connected via an isolator switch or relay. The "
             "isolator must isolate the battery from all devices in the vehicle including the PDM, starter motor and alternator'")
ORION = ("Victron Orion-Tr Smart 12/12-30 non-isolated DC-DC charger ORI121236140 — 30 A, 'engine running detection', remote "
         "on-off on a two-pole H/L connector (powerwerx.com page, snapshot web_snapshots/powerwerx.com__victron-ori121236140-"
         "oriontrsmart-30a-nonisolated.md)")
GND_WHY = ("owner 2026-09-27: grounds run in the loom — 'dave runs his grounds in the looms ... would be dumb to be grounding to "
           "body all the time'; Dave's DC primary has a ground-stud bank (state 0i). Each zone's returns run in the harness to its "
           "ground bank; the banks return in the harness to the ground star, never through the body")
M77 = "1977 Light Truck Service Manual (reference_documents/k5_factory_docs)"
HERMOSA = ("RetroSound Model Hermosa manual p.16 (reference_documents/component_drawings/RetroSound_Hermosa_Manual.pdf): "
           "yellow constant +12 V, red ignition/ACC, black ground, blue/white remote/amp turn-on, front + rear RCA line outs; "
           "head unit per chapters/appendix-d-k5-build.md 'RetroSound Hermosa + Kicker amp/speakers/sub'")
AMPR = ("AMP Research PowerStep install guide IM75146 (reference_documents/component_drawings/amp_research_75146_install.pdf): "
        "the kit harness drives both step motors; red lead to battery +, black to battery - (step 8); the trigger wires "
        "splice into the door switch wires (steps 14-15)")
ESTOPP = ("E-Stopp ESK001 wiring diagram (reference_documents/component_drawings/extracted/estopp_esk001_wiring.png): "
          "control box G red +12 V from battery, F blue safety to ignition, H black ground, E green button/ground-sync (kit)")
IBOOST = ("chapters/17 §17.3: MIDI 40 A -> iBooster, 6 AWG /16 (#52, cable_decisions.json: a MIDI 40 needs 47 A of cable, 8 AWG bundled is 40 A); Bosch OEM supply 40 A on pin 1, ignition 12 V 5 A on "
          "pin 20; state §1 'Bosch iBooster Gen 2 (Tesla salvage + Tulay connector)', installed on the driver firewall (state)")
AMPWHY = "JL VX700/5i guide (web_snapshots/www.retailspecs.com__VXi_700_5_MAN.md) 'Power Connector': '4 AWG is the required copper wire size for this amplifier'; spec table 'Min. Copper Power/GND Wire 4 AWG', 'Recommended Fuse 60 A'. The 18.4 ft loop needs 2 AWG for the 3 % drop (4 AWG 0.62 V = 4.4 %; cable_sizing_v5), so the run lands on a reducing block beside the amp and a short 4 AWG tail enters the set screw. JL's own step A: 'install a fused distribution block near the amplifiers'. 4 AWG under the 60 A MIDI: 72 A bundled x 0.85 = 61 A >= 60 A"
GSTAR = "GND-BANK-ENG (ground star: stud bank beside the batteries - both battery negatives, block, frame and engine-bay returns)"
GCAB = "GND-BANK-CAB (cab ground bank beside the PDM30)"
GFL = GFR_ = GFW = GSTAR                       # engine-bay loads return in the loom to the ground star
GKL = GKR = GROOF = GCAB                       # cab loads return in the loom to the cab bank
GREAR = GFRAME = "GND-SPLICE-REAR (rear harness ground bus)"   # rear loads return to the rear bus, which returns to the cab bank


def _gnd(wid, label, dev, stud, awg=20):
    return (wid, label, f"{dev} (ground)", stud, awg, "M22759/32", GND_WHY)


IMPLIED += [
    # ---- lamp and device grounds (the April cut list carried none)
    _gnd("HL_L_GND", "Left headlight ground", "HEADLIGHT-L", GFL, 16),
    _gnd("HL_R_GND", "Right headlight ground", "HEADLIGHT-R", GFR_, 16),
    _gnd("PT_LF_GND", "Left front park/turn lamp ground", "PARK-TURN-LF", GFL),
    _gnd("PT_RF_GND", "Right front park/turn lamp ground", "PARK-TURN-RF", GFR_),
    ("MK_LF_GND", "Left front side marker ground", "MARKER-LF (ground)", GFL, 20, "M22759/32",
     GND_WHY + "; the factory grounded the marker through the turn filament so it flashed opposite (" + M77 + " p.780) — "
     "a direct ground keeps it steady on LEDs"),
    ("MK_RF_GND", "Right front side marker ground", "MARKER-RF (ground)", GFR_, 20, "M22759/32", GND_WHY + "; " + M77 + " p.780"),
    _gnd("HORN_GND", "Horn ground", "HORN", GFL, 14),
    _gnd("WASH_GND", "Washer pump ground", "WASHER-PUMP", GFW),
    _gnd("UH_GND", "Underhood lamp ground", "UNDERHOOD-LAMP", GFW),
    ("WIPER_GND", "Wiper motor ground strap", "WIPER-MOTOR (ground strap)", GFW, 14, "M22759/32",
     M77 + " p.803: the wiper motor housing grounds to the chassis through a ground strap"),
    _gnd("BLOWER_GND", "Blower motor ground", "BLOWER-MOTOR", GFW, 12),
    _gnd("MK_LR_GND", "Left rear side marker ground", "MARKER-LR", GREAR),
    _gnd("MK_RR_GND", "Right rear side marker ground", "MARKER-RR", GREAR),
    _gnd("TL_L_GND", "Left tail lamp ground", "Tail_Light_Left", GREAR, 18),
    _gnd("TL_R_GND", "Right tail lamp ground", "Tail_Light_Right", GREAR, 18),
    _gnd("BU_L_GND", "Left backup lamp ground", "Backup_Light_Left", GREAR),
    _gnd("BU_R_GND", "Right backup lamp ground", "Backup_Light_Right", GREAR),
    _gnd("LIC_GND", "License lamp ground", "LICENSE-LAMP", GREAR),
    _gnd("CHMSL_GND", "Third brake light ground", "CHMSL", GREAR),
    _gnd("CARGO_GND", "Cargo/bed lamp ground", "CARGO-LAMP", GREAR),
    _gnd("CL_L_GND", "Left cab clearance lamp ground", "CLEARANCE-L", GROOF),
    _gnd("CL_C_GND", "Center cab clearance lamp ground", "CLEARANCE-C", GROOF),
    _gnd("CL_R_GND", "Right cab clearance lamp ground", "CLEARANCE-R", GROOF),
    _gnd("DOME_GND", "Dome lamp ground", "DOME-LAMP", GROOF),
    _gnd("UD_GND", "Under-dash lamps ground", "UNDERDASH-LAMPS", GKL),
    _gnd("FW_GND", "Footwell lamps ground", "FOOTWELL-LAMPS", GKL),
    _gnd("USB_GND", "USB port ground", "USB-PORT", GKL),
    _gnd("OUT12V_GND", "12 V outlet ground", "OUTLET-12V", GKL, 12),
    ("RADIO_GND", "Radio ground (black)", "RADIO (black, ground)", GCAB, 18, "M22759/32", HERMOSA),
    ("ESTOPP_GND", "E-Stopp control box ground (wire H, black)", "E-STOPP (H, black)", GREAR, 16, "M22759/32", ESTOPP),
    ("STEP_GND", "AMP Research harness negative (black lead) to battery negative", "AMP-STEP-CTRL (black lead)", GSTAR_EARLY, None,
     "kit harness", AMPR),
    ("AMP_GND", "Amplifier ground run: reducing block beside the amp to the ground star", "AMP-BLOCK (- in, 2 AWG)", GSTAR, 4, "M22759/16",
     GND_WHY + "; ground cable matches the feed (#32, state 0n)"),
    ("AMP_PWR_TAIL", "Amplifier +12 V tail: reducing block to the amp power plug (4 AWG, JL's required size)", "AMP-BLOCK (+ out, 4 AWG)",
     "AMP (+12 VDC, power plug set screw)", 4, "M22759/16", AMPWHY),
    ("AMP_GND_TAIL", "Amplifier ground tail: amp power plug to the reducing block (4 AWG, JL's required size)", "AMP (Ground, power plug set screw)",
     "AMP-BLOCK (- out, 4 AWG)", 4, "M22759/16", AMPWHY),
    ("IBOOST_GND", "iBooster ground to battery negative", "IBOOSTER (ground, Tulay harness)", GSTAR_EARLY, 8, "M22759/16",
     IBOOST + "; chapters/17 §17.3: battery-iBooster is a spine cable, its ground returns to the star"),
    # ---- factory switches as PDM30 inputs (switch-to-ground; the switch carries a signal, not load current)
    ("HL_SW_PARK", "Headlight switch PARK output -> PDM30 DIG2", "PDM30:DIG2", "HL-SW (park/tail terminal)", 22, "M22759/16",
     PLAN_CH + " DIG2 A19"),
    ("HL_SW_HEAD", "Headlight switch HEAD output -> PDM30 DIG3", "PDM30:DIG3", "HL-SW (headlamp terminal)", 22, "M22759/16",
     PLAN_CH + " DIG3 A29"),
    ("HL_SW_0V", "Headlight switch battery-feed terminal to PDM30 0V (it now switches 0V)", "PDM30:A28",
     "HL-SW (battery feed terminal)", 22, "M22759/16", SW0V),
    ("TURN_SW_R", "Turn switch right-front output -> PDM30 DIG5", "PDM30:DIG5", "TURN-SW (right front output)", 22, "M22759/16",
     PLAN_CH + " DIG5 A30"),
    ("TURN_SW_0V", "Turn and hazard feed terminals (column connector) to PDM30 0V", "PDM30:A28",
     "TURN-SW (turn + hazard flasher feeds, jumpered)", 22, "M22759/16",
     SW0V + "; the hazard contact joins all four lamp outputs to the hazard feed, so hazard reads as both turn inputs at once "
     "(" + M77 + " p.783: hazard feed = brown wire in the column connector; p.784: stop input = white, left unused — the "
     "brake switch has its own input, DIG14)"),
    ("HORN_SW", "Horn button -> PDM30 DIG6 (the button grounds through the column)", "PDM30:DIG6", "HORN-SW (column horn contact)",
     22, "M22759/16", PLAN_CH + " DIG6 A31"),
    # ---- factory wiper circuit kept whole: grounding-type dash switch, the PDM output is the fused ignition feed
    ("WIPER_T1", "Wiper switch to motor terminal 1 (series field + armature to ground)", "WIPER-SW (terminal 1 lead)",
     "WIPER-MOTOR (terminal 1)", 16, "M22759/32",
     M77 + " p.803: the wiper dash switch is a grounding type; LO and HI complete terminal 1 to ground at the switch"),
    ("WIPER_T3", "Wiper switch to motor terminal 3 (shunt field)", "WIPER-SW (terminal 3 lead)", "WIPER-MOTOR (terminal 3)", 18,
     "M22759/32", M77 + " p.803: LO grounds the shunt field via terminal 3; OFF ties 3 to 1 through the park switch"),
    # ---- factory Four-Season blower: switch + resistor stay; the HI blower relay becomes a PDM output (row 54)
    ("BLOWER_BAT", "Blower switch LOW lead to the resistor BAT terminal (factory circuit 51)", "BLOWER-SW (LOW lead)", "BLOWER-RES (BAT tap)", 16, "M22759/32",
     M77 + " p.87-88: blower resistor on the evaporator case; 73-87 C/K A/C resistor = 3 prongs, low speeds through the switch "
     "and resistor, high through the relay (gmsquarebody.com threads 38262, 5343)"),
    ("BLOWER_MED", "Blower switch M1 lead to the resistor", "BLOWER-SW (M1 lead)", "BLOWER-RES (M1 tap)", 16, "M22759/32",
     M77 + " p.87-88; 3-prong resistor (gmsquarebody.com)"),
    ("BLOWER_M2", "Blower switch M2 lead to the resistor", "BLOWER-SW (M2 lead)", "BLOWER-RES (M2 tap)", 16, "M22759/32",
     M77 + " p.87-88; the third resistor prong (gmsquarebody.com); confirm the lead count against the control head when it is out"),
    ("BLOWER_MOT", "Blower resistor to the motor (on the case)", "BLOWER-RES (motor lead)", "BLOWER-MOTOR (+)", 12, "M22759/32",
     M77 + " p.87-88"),
    ("BLOWER_HI", "Blower HIGH feed, straight to the motor", "PDM30:OUT2", "BLOWER-MOTOR (+)", 12, "M22759/32",
     M77 + " p.87-88: HI ran through the blower relay on the evaporator case, fed from the junction block through its own "
     "fuse; owner row 54 'PDM replaces relays'; PDM30 OUT2 (20 A) freed when the second radiator fan was retired (T78)"),
    # ---- audio: RetroSound Hermosa -> Kicker 5-channel amp -> speakers; amp fed direct (chapters/17 §17.3)
    ("RADIO_CONST", "Radio constant +12 V (yellow, memory)", "PDM30:OUT11", "RADIO (yellow, constant +12 V)", 20, "M22759/32",
     HERMOSA + "; PDM30 OUT11 freed when the AMP Research controller moved to its own battery-fed harness"),
    ("RADIO_REM", "Radio amp turn-on (blue/white) -> amplifier REM", "RADIO (blue/white, amp turn-on)", "AMP (REM)", 20, "M22759/32",
     HERMOSA + "; replaces the retired amplifier-coil wire #96"),
    ("RCA_FRONT", "Radio front RCA line out -> amplifier channels 1/2", "RADIO (front RCA line out)", "AMP (input 1/2)", None,
     "RCA pair", HERMOSA),
    ("RCA_REAR", "Radio rear RCA line out -> amplifier channels 3/4", "RADIO (rear RCA line out)", "AMP (input 3/4)", None,
     "RCA pair", HERMOSA + "; RetroSound Motor 2B user manual p.3: 'Multi-channel pre-amp outputs (front, rear, subwoofer)'"),
    ("SUB_JMP_P", "Woofer jumper (+): woofer 1 to woofer 2, in parallel", "SUB (+)", "SUB-2 (+)", 10, "M22759/16", "owner 2026-09-25: 'we are gonna do jbl 10\" compact woofers, an amp not sure which and then the appropriate other speakers'; JBL Club 102SL: impedance selector 2 or 4 ohm, 350 W RMS (Crutchfield page, snapshot web_snapshots/www.crutchfield.com__JBL-Club-102SL.md) — both set to 4 ohm and wired in parallel = 2 ohm for the amp's 300 W sub channel; build book 'Audio, decided Sep 25': 10 AWG pair with a jumper between the two woofers"),
    ("SUB_JMP_N", "Woofer jumper (-): woofer 1 to woofer 2, in parallel", "SUB (-)", "SUB-2 (-)", 10, "M22759/16", "owner 2026-09-25: 'we are gonna do jbl 10\" compact woofers, an amp not sure which and then the appropriate other speakers'; JBL Club 102SL: impedance selector 2 or 4 ohm, 350 W RMS (Crutchfield page, snapshot web_snapshots/www.crutchfield.com__JBL-Club-102SL.md) — both set to 4 ohm and wired in parallel = 2 ohm for the amp's 300 W sub channel; build book 'Audio, decided Sep 25': 10 AWG pair with a jumper between the two woofers"),
    ("RCA_SUB", "Radio sub RCA out -> amplifier sub input", "RADIO (sub RCA out)", "AMP (sub input)", None, "RCA pair",
     "RetroSound Motor 2B user manual p.3 (reference_documents/component_drawings/RetroSound_Motor-2B_User_Manual.pdf): "
     "'Multi-channel pre-amp outputs (front, rear, subwoofer)'; the JL VX700/5i DSP does 'input routing and mixing' "
     "(Crutchfield page) — confirm it has a third input pair for this; if not, its DSP mixes the sub channel from front + rear"),
    # ---- AMP Research steps: the kit harness drives and reverses both motors; it needs battery, ground and the doors
    ("STEP_DOOR_L", "Driver door signal to the AMP Research harness (tap of #42)", "DOOR-JAMB-L (switch terminal)",
     "AMP-STEP-CTRL (trigger 1)", 20, "M22759/32", AMPR),
    ("STEP_DOOR_R", "Passenger door signal to the AMP Research harness (tap of #43)", "DOOR-JAMB-R (switch terminal)",
     "AMP-STEP-CTRL (trigger 2)", 20, "M22759/32", AMPR),
    # ---- the Dakota senders' other leads (the gauge-feed lock names SEN-04-5 + SEN-03-8; the April rows carried these)
    ("DAK_CTS_RET", "Dakota temp sender (SEN-04-5) second wire -> VHX WTR -", "DAKOTA-VHX (WTR -)", "DAK-CTS (sender lead 2)", 22,
     "M22759/16", "Dakota VHX manual 650314:P p.9 (reference_documents/component_drawings/dakota_digital_vhx_manual.pdf): SEN-04-5 uses a two-wire harness — one wire to WTR SND, the other to WTR -"),
    ("DAK_OILP_5V", "Dakota oil sensor (SEN-03-8) +5 V (red) from VHX OIL +", "DAKOTA-VHX (OIL +)", "DAK-OILP (red, +5 V)", 22,
     "M22759/16", "Dakota VHX manual 650314:P p.9 (reference_documents/component_drawings/dakota_digital_vhx_manual.pdf): OIL + supplies 5 V DC to the SEN-03-8 red wire only"),
    ("DAK_OILP_GND", "Dakota oil sensor (SEN-03-8) ground (black + bare shield) to VHX OIL -", "DAKOTA-VHX (OIL -)",
     "DAK-OILP (black + shield)", 22, "M22759/16",
     "Dakota VHX manual 650314:P p.9 (reference_documents/component_drawings/dakota_digital_vhx_manual.pdf): three-wire harness plus a bare shield — white OIL SND, red OIL +, black and the shield to OIL -; keep it "
     "away from plug wires"),
    # ---- the alternator's one control wire (the pigtail was 'have' with no registry wire)
    ("ALT_L", "Alternator L terminal (197-400 pigtail, 560 ohm in line) from the engine PDM, on in RUN", "PDM15:OUT9",
     "ALTERNATOR-SENSE (L, 197-400 pigtail)", 20, "M22759/32",
     "Holley mid-mount fitment guide p.15 (reference_documents/component_drawings/holley_midmount_fitment.pdf): connect L to "
     "switched voltage on in RUN, with a charge lamp or 560 ohm 1/2 W in line — 'Holley's part # 197-400 already has the "
     "resistor in line'; kit contents list the 197-302 alternator + 197-400 pigtail (Holley_Mid_Mount_Accessory_Drive_Kit.pdf)"),
    # ---- ground returns in the loom (owner 2026-09-27)
    ("GND_RET_CAB", "Cab ground bank return to the ground star (through the power grommet)", GCAB, GSTAR, 2, "M22759/16",
     GND_WHY + "; sized like the PDM30 feed (PDM_BPOS 2 AWG) since every cab load returns through it"),
    ("GND_RET_REAR", "Rear ground bus return to the cab ground bank", GREAR, GCAB, 10, "M22759/16",
     GND_WHY + "; rear lamps + camera + E-Stopp returns"),
    # ---- isolator: Blue Sea 7700 ML-RBS on the battery POSITIVE (owner 2026-09-27: 'pick the isolator'). The Cartek XR
    #      draft was dropped the same day: its instructions (p.3) read 'designed for motorsport use only and should not be
    #      used on road/street vehicles', and MoTeC puts the isolator on battery positive (PDM user manual p.7)
    ("ISO_OUT", "Isolator stud B to the distribution stud", "PS-STUDS (isolator stud B)", "PS-STUDS (distribution stud)", 2, "M22759/16",
     MOTEC_ISO + "; " + BLUESEA + "; chapters/17 §17.3: battery -> isolator -> distribution stud"),
    ("ISO_PWR", "Isolator control power (red, 24 hr) from the Odyssey positive, fused 10 A at the battery", "ODYSSEY (+, 10 A fuse)",
     "ISOLATOR (red, +12 V 24 hr)", 16, "M22759/32", BLUESEA + " — 'Connect the red wire through a 10A (min) circuit protection "
     "device to DC+ ... a direct connection to the battery' (p.2)"),
    ("ISO_GND", "Isolator control ground (black) to the ground star", "ISOLATOR (black, ground)", GSTAR, 16, "M22759/32",
     BLUESEA + "; " + GND_WHY),
    ("ISO_CLOSE", "Isolator CLOSE lead (brown) to the dash switch pin 3", "ISOLATOR (brown, +12 V to close)",
     "ISO-SWITCH (2145 pin 3, CLOSE)", 16, "M22759/32", BLUESEA + " — 'Connect the brown wire to the CLOSE side of the Control "
     "Switch, pin 3' (p.2)"),
    ("ISO_OPEN", "Isolator OPEN lead (orange) to the dash switch pin 1", "ISOLATOR (orange, +12 V to open)",
     "ISO-SWITCH (2145 pin 1, OPEN)", 16, "M22759/32", BLUESEA + " — 'Connect the orange wire to the OPEN side of the Control "
     "Switch, pin 1' (p.2)"),
    ("ISO_LED", "Isolator state output (yellow) to the dash switch LED ground, pin 7", "ISOLATOR (yellow, LED output)",
     "ISO-SWITCH (2145 pin 7, LED ground)", 16, "M22759/32", BLUESEA + " — 'Connect the LED Ground terminal of the Control "
     "Switch, pin 7, to the yellow wire' (p.2); the M130 shutdown input tees off it in the cab (ISO_KILL)"),
    ("ISO_SW_PWR", "Dash switch feed (pin 2 common + pin 8 LED power) from the Odyssey positive, 24 hr", "ODYSSEY (+, 5 A fuse)",
     "ISO-SWITCH (2145 pins 2 + 8)", 16, "M22759/32", BLUESEA + " — pin 2 'through a 2A (min) circuit protection device to DC+. "
     "Use a 24-hour power source (connected directly to the battery)'; pin 8 'can share the same wire/fuse' (p.2); 5 A keeps the "
     "fuse above Blue Sea's 2 A minimum and under the 16 AWG wire's rating (chapters/16) — " + AGENT),
    # ---- batteries (owner 2026-09-27): Odyssey = running battery, Optima YellowTop = accessories, charged by a DC-DC charger
    ("ODY_NEG", "Odyssey negative to the ground star", "ODYSSEY (-)", GSTAR, 2, "M22759/16",
     "owner 2026-09-27 (Odyssey for the running); the positive-side isolator leaves the negative as the ground star (chapters/17 "
     "§17.4.7: PDM Batt- to battery negative); 2 AWG like #63 (Blue Sea p.2: engine-starting wires need no circuit protection)"),
    ("ACC_NEG", "YellowTop negative to the ground star", "ACC-BATT (-)", GSTAR, 4, "M22759/16",
     "owner 2026-09-27 (YellowTop for accessories); carries the amplifier's return (#32 is 4 AWG) and the DC-DC charge current"),
    ("DCDC_IN", "DC-DC charger input from the distribution stud (MIDI 60 A)", "PS-STUDS (distribution stud, MIDI 60 A)", "DCDC (IN +)", 8,
     "M22759/16", ORION + " — downstream of the isolator, so the charger stops when the truck is isolated"),
    ("DCDC_OUT", "DC-DC charger output to the YellowTop positive", "DCDC (OUT +)", "ACC-BATT (+)", 8, "M22759/16", ORION),
    ("DCDC_GND", "DC-DC charger negative to the ground star", "DCDC (-)", GSTAR, 8, "M22759/16",
     ORION + " — non-isolated: input and output share the negative"),
    # ---- Dakota indicators the owner wants working (2026-09-27: 'it makes sense youd want brake, check eng and gear to work')
    ("DAK_CEL", "M130 check-engine output to the Dakota CHECK ENG (-) input", "M130:A32", "DAKOTA-VHX (CHECK ENG (-))", 22, "M22759/16",
     "Dakota VHX manual 650314:P p.6: CHECK ENG (-) is ground-activated; M130 A32 = OUT_HB4 half bridge (stored pin table), free since #118 retired — "
     "set it as the warning/check-engine output in the M1 tune"),
    ("DAK_BRAKE", "E-Stopp green wire (brake indicator) to the Dakota BRAKE (-) input", "E-STOPP (E, green: switched ground)",
     "DAKOTA-VHX (BRAKE (-))", 22, "M22759/16",
     "Dakota VHX manual 650314:P p.6: BRAKE (-) = brake system / parking brake warning input, ground-activated; E-Stopp kit "
     "drawing (extracted/estopp_esk001_wiring.png): wire E, green, 'Ground Sync Trigger'; estopp.com troubleshooting: 'The green "
     "wire is a low-current switched ground' (about 25 mA, for a brake indicator light) — snapshot web_snapshots/estopp.com__"
     "troubleshooting.md"),
    ("DAK_GEAR", "Dakota GSS-3000 1-WIRE to the VHX GEAR input", "GSS-3000 (1-WIRE)", "DAKOTA-VHX (GEAR (1 WIRE))", 22, "M22759/16",
     "Dakota GSS-3000 manual MAN# 650715:G (dakotadigital.com/pdf/GSS-3000.pdf, snapshot web_snapshots/www.dakotadigital.com__"
     "GSS-3000.md): 'Connect a wire to 1-WIRE on the GSS-3000 to the GEAR terminal of a Dakota Digital control box'; the sensor "
     "arm follows the shift linkage and the decoder learns each gear position"),
    ("GSS_PWR", "GSS-3000 decoder +12 V ignition (second wire on #71's output)", "PDM30:OUT29", "GSS-3000 (+12 V ignition)", 20,
     "M22759/32", "GSS-3000 manual: decoder '+12 VOLTS IGNITION' and GROUND; shares the Dakota ACC output (#71), on with the key"),
    ("GSS_GND", "GSS-3000 decoder ground", "GSS-3000 (ground)", GCAB, 20, "M22759/32", GND_WHY),
    ("GSS_SENS_R", "GSS-3000 sensor cable, red (kit cable, 10 ft)", "GSS-SENSOR (red)", "GSS-3000 (RED)", None, "kit cable", "Dakota GSS-3000 manual (web_snapshots/www.dakotadigital.com__GSS-3000.md): 'The sensor cable (10 feet long) attached to the sensor contains three wires which connect to the decoder' — match RED, GREEN (or white), BLACK to the decoder labels"),
    ("GSS_SENS_G", "GSS-3000 sensor cable, green or white (kit cable, 10 ft)", "GSS-SENSOR (green/white)", "GSS-3000 (GREEN)", None,
     "kit cable", "Dakota GSS-3000 manual (web_snapshots/www.dakotadigital.com__GSS-3000.md): 'The sensor cable (10 feet long) attached to the sensor contains three wires which connect to the decoder' — match RED, GREEN (or white), BLACK to the decoder labels"),
    ("GSS_SENS_B", "GSS-3000 sensor cable, black (kit cable, 10 ft)", "GSS-SENSOR (black)", "GSS-3000 (BLACK)", None, "kit cable", "Dakota GSS-3000 manual (web_snapshots/www.dakotadigital.com__GSS-3000.md): 'The sensor cable (10 feet long) attached to the sensor contains three wires which connect to the decoder' — match RED, GREEN (or white), BLACK to the decoder labels"),
    ("TCASE_SW_GND", "4WD indicator switch ground side, in the loom to the cab ground bank", "TCASE-4WD-SW (ground side)", GCAB, 20,
     "M22759/32", GND_WHY + "; the fabricated switch closes this to #55 in 4WD (Dakota VHX manual p.6: 4x4 (-) is ground-activated)"),
    # ---- the fuel level sender's return (April row dash-cabin-W007 carried it through the retired Bulkhead_H3)
    ("FUEL_SND_GND", "Fuel level sender return to the Dakota FUEL - (sender ground output)", "DAKOTA-VHX (FUEL -)",
     "FUEL-LEVEL (sender ground: TBD, hanger connector)", 20, "M22759/32",
     "Dakota VHX manual p.6: FUEL - = fuel level sensor ground output; the Quantum hanger's connector is a bench read "
     "(endpoints.yaml FUEL-PUMP) — a sender grounded through its flange needs no wire"),
    # ---- iBooster wake and E-Stopp ignition safety from spare PDM30 outputs
    ("IBOOST_WAKE", "iBooster ignition 12 V (pin 20) from the body PDM", "PDM30:OUT9", "IBOOSTER (20, ignition 12 V)", 20,
     "M22759/32", IBOOST + "; PDM30 OUT9 (8 A, set to 5 A) freed when the step motors moved behind their own controller"),
    ("ESTOPP_IGN", "E-Stopp safety-to-ignition (wire F, blue)", "PDM30:OUT10", "E-STOPP (F, blue)", 20, "M22759/32",
     ESTOPP + "; PDM30 OUT10 freed from the right step motor"),
]
IMPLIED_EXTRA_0927.update({
    "BLOWER_HI": {"control": "blower switch HI contact on PDM30 DIG7"},
    "RADIO_CONST": {"control": "always on (the PDM30 stays awake key-off: hazards and locks need it)"},
    "IBOOST_WAKE": {"control": "PDM30 DIG1 ignition RUN"},
    "ESTOPP_IGN": {"control": "PDM30 DIG1 ignition RUN"},
    "REAR_ST_L": {"control": "PDM30 logic: brake DIG14, left turn DIG4 (flash); hazard = DIG4 + DIG5 together"},
    "REAR_ST_R": {"control": "PDM30 logic: brake DIG14, right turn DIG5 (flash); hazard = DIG4 + DIG5 together"},
})
IMPLIED_EXTRA.update(IMPLIED_EXTRA_0927)

# Decisions made after v4.2 that change an existing v4.2 row (cited). Applied over the v4.2 value;
# the old value is kept in `conflicts`, so each row reads its own history. Nothing is deleted:
# a retired row stays in the registry with `retired` set (deletion is owner-only).
WIRE22_WHY = ("decision: spec M22759/32 -> M22759/16 at 22 AWG — MoTeC C125 manual p.20 + PDM manual p.48 specify "
              "M22759/16-22; /32-22 OD 1.09 mm is under the 1.20 mm seal minimum (GT150 12191818), /16-22 is 1.27–1.37 mm")
DAVE_SENSORS = "Dave's M130 sheet ('M130 ECU Overland Bronco.xlsx', Sensor Connections)"
TWIN = ("twin: output/lego-book/power_spine_twin_lengths.txt (paths in the digital twin, battery at the passenger firewall "
        "corner); not taped on the truck")
DC2 = ("2 AWG: cranking loop 7.6 ft drops 0.28 V at 200 A < 0.42 V ceiling, 1/0 question closed (state 0h); "
       "Dave's DC primary runs 2 AWG (state 0i)")
BLADE20 = ("terminal sets the floor: the factory switch blades are Packard 56-series terminals, made 20–18, 16–14, 12 and 10 AWG "
           "(CE Auto Electric Supply 'Packard 56 Series Female Terminals' page, read 2026-09-28) — no 22 AWG size; the signal "
           "is a switch-to-0V input at milliamps, so 20 AWG M22759/32 is the smallest wire that crimps. The PDM/M130 end takes "
           "it: Superseal 1.0 contacts 24–16 AWG (state); 8 A outputs 24#–20# (PDM manual p.9)")
DECISIONS = {
    # --- 2026-09-28 night: pin-table pass (check_plug_ends R1 range vs the gm_blade family) ---
    "53": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "121": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "33": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "46": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "45": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "42": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "43": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "67": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "60": {"retired": "superseded by #ECU_PWR on M130 A26 BAT_POS (receipts/2026-06-10_cut-list-v4.1-ecu-lifelines.md)"},
    "61": {"retired": "superseded pending retirement (receipts/2026-06-10_cut-list-v4.1-ecu-lifelines.md)"},
    "25": {"retired": "water pump is mechanical on the Holley mid-mount (K5_WIRING_STATE.md 0f(a))"},
    "63": {"awg": 2, "length_ft": 1.1, "why": DC2, "length_basis": TWIN},
    "6": {"awg": 2, "length_ft": 3.1, "why": DC2, "length_basis": TWIN},
    "59": {"awg": 2, "length_ft": 3.5, "why": DC2, "length_basis": TWIN},
    "PDM_BPOS": {"awg": 2, "length_ft": 1.9, "why": DC2, "length_basis": TWIN},
    "32": {"awg": 4, "why": "8 AWG x 18.4 ft fails the 3 % rule; 4 AWG red M22759/16-4-2 "
                            "(receipts/2026-09-25_orders-staged-prowire-ksv-ict.md, 17:30 addendum)"},
    "30a": {"color": "red", "why": "woofer 10 AWG carted red/black; yellow/gray held back (receipt 2026-09-25, lego-book addendum)"},
    # --- 2026-09-26 PM: the owner's parts, checked against MoTeC's manuals and the makers' data ---
    "62": {"awg": 22, "why": "MoTeC PDM user manual p.50 CAN Bus Wiring Requirements: 'twisted 22# Tefzel is usually OK', "
                             "min one twist per 50 mm; 24# is not offered",
           "note": "100R 0.25 W terminators, not 120R, one at each end of the trunk (M130 end, LTCD end): the bus reaches "
                   "the PDM15 and the LTCD, past the 2 m short-bus rule (MoTeC PDM manual p.49-50; review A10). Topology on "
                   "the CAN-BUS endpoint"},
    "51": {"awg": 12, "spec": "M22759/32", "why": "blower = 4 Seasons 35587 (A/C order 2026-09-24, eBay 406732859496); no published "
                             "amp rating (Summit/CARiD pages), so the wire is sized to its protection: a PDM30 20 A output. "
                             "MoTeC PDM manual p.48: 14# = 22 A at 80 C, so 12 AWG carries the full 20 A with margin; drop "
                             "at 20 A over 1.7 m = 0.19 V (1.4 %); fits the D-609-05 splice from the 2 x 16 AWG pigtails. "
                             "Reference only: 1977 LTSM Sec. 1B factory Four-Season blower 12.8 A max",
           "note": "measure the installed draw on HIGH with the wheel fitted; it sets the PDM current limit"},
    "4d": {"retired": "TB GM 12699160 is a Gen V SENT throttle body: one digital position line, no TPS2 "
                      "(GM SENT ETB pinout 1 motor+, 2 motor-, 3 SENT, 4 low ref, 5 +5 V, 6 unused — MaxxECU 'E-Throttle "
                      "bodies' (GM 12678223), rusefi wiki 'SENT ETB' (GM 12617792)); A17/AV4 is free"},
    "4c": {"frm": "M130:B09", "why": "SENT position to a universal digital input: MoTeC GPR (M130) fw 01.11.0099 'Throttle Servo 2 "
                                     "(includes SENT Secure Serial Decode Type)'; B09/UDIG4 is spare on Dave's sheet; A14/AV1 is free",
           "note": "TB pin 3 (SENT)"},
    "66": {"awg": 14, "spec": "M22759/32", "frm": "PDM30:OUT? (8 A output; channel set in the power chapter)",
           "why": "QFS P367 (HFP-367) draws 5.1 A at 60 psi, 4.6 A at 45 psi (highflowfuel.com product page), not the "
                  "Aeromotive A1000 35 A the 8 AWG came from; drop over 18.4 ft at 5.1 A: 16 AWG 0.40 V (3.0 %), "
                  "14 AWG 0.26 V (1.9 %) using MoTeC PDM manual p.48 resistances",
           "note": "PDM output drives the pump directly — no relay (owner row 54), no MIDI fuse; the PDM limit protects the wire",
           "protection": ("PDM15 OUT5 maximum-current setting, 8 A (MoTeC PDM manual p.23 Over-Current Shutdown "
                          "'to protect the wire and the PDM output'; p.25: a device drawing no more than 5 A takes a wire rated 8 A "
                          "and an 8 A setting — the P367 draws 5.1 A at 60 psi). No inline fuse: chapters/17 §17.8 item 6 "
                          "'PDM-switched loads carry none (the PDM is the fuse)'. The §17.5 'Fuel pump ... MIDI 30-40A' row sized "
                          "a relay-fed Aeromotive A1000 and does not apply to a PDM-driven pump")},
    "94": {"retired": "no pump relay: the PDM drives the 5.1 A pump from an 8 A output (owner row 54 'PDM replaces relays'); "
                      "frees bulkhead cavity 'n'"},
    # --- Dave's M130 sheet ('M130 ECU Overland Bronco.xlsx', Desert Performance) is the wiring oracle:
    #     crank/cam run from B19 6.3 V (white/orange) with 0 V on B15 (white/blue, 'Ref Sync 0 volt');
    #     every other analog sensor runs 5 V from A2 (orange) and 0 V on B16 (brown). MoTeC M1 techspec: UDIG inputs
    #     have a 3k3 pull-up to +5 V and are 'suitable for hall/optical'; B19 = SEN_6V3 sensor supply.
    "99r": {"frm": "M130:B19", "color": "white/orange", "label": "CKP 6.3V Supply",
            "why": DAVE_SENSORS + " — crank 3 = 6.3 volt (B19)"},
    "101r": {"frm": "M130:B19", "color": "white/orange", "label": "CMP 6.3V Supply",
             "why": DAVE_SENSORS + " — SYNC 1 = 6.3 volt (B19)"},
    "101g": {"frm": "M130:B15", "why": DAVE_SENSORS + " — SYNC 2 = 0 volt white/blue (B15)"},
    "99s": {"color": "white/blue", "why": DAVE_SENSORS + " — B15 wires are white/blue"},
    "101s": {"frm": "M130:B15", "color": "white/blue", "why": DAVE_SENSORS + " — drain to B15 with the cam ground"},
    "4f": {"frm": "M130:B16", "why": DAVE_SENSORS + " — TPS 0 volt = B16 (brown)", "note": "TB pin 4 (low reference)"},
    "108r": {"frm": "M130:A02", "color": "orange", "why": DAVE_SENSORS + " — MAP 3 = 5 volt A2 (orange)"},
    "108g": {"frm": "M130:B16", "why": DAVE_SENSORS + " — MAP 1 = 0 volt B16"},
    "109g": {"frm": "M130:B16", "why": DAVE_SENSORS + " — AIT 1 = 0 volt B16"},
    "113g": {"frm": "M130:B16", "why": DAVE_SENSORS + " — Oil Temp 1 = 0 volt B16"},
    "103g": {"frm": "M130:B16", "why": "Dave's sheet keeps B15 for crank/cam only ('Ref Sync 0 volt'); knock return joins the B16 group"},
    "103s": {"frm": "M130:B16", "why": "knock shield drains with its return on B16 (ECU end only)"},
    "APS_T1_GND": {"frm": "M130:B16", "why": "pedal track 1 pairs with A2 5 V on B16, like Dave's analog sensors; track 2 keeps the second supply A9"},
    "APS_T2_GND": {"frm": "M130:B15", "color": "white/blue", "why": "pedal track 2 needs a separate 0 V from track 1 (GM dual-track APP); B15 is the other sensor 0 V"},
    "4e": {"note": "TB pin 5 (+5 V)"},
    "4a": {"note": "TB pin 2 (motor -); motor direction is set in the M1 servo calibration"},
    "4b": {"note": "TB pin 1 (motor +)"},
    "30b": {"color": "black", "why": "woofer 10 AWG carted red/black; yellow/gray held back (receipt 2026-09-25, lego-book addendum)"},
}


LTCD_WHY = ("LTCD manual p.31: 110 mA typical plus the heater current, heater 0.5-1 A typical (up to 2 A on startup); p.37: "
            "'Each sensor can draw over 3 Amps when cold' -> 2 sensors x > 3 A + 0.11 A = > 6.1 A cold. MoTeC PDM manual p.48: "
            "22# = 6 A at 80 C / 5 A at 100 C (under the cold draw), 20# = 8 A / 6 A, 18# = 11 A / 9 A. OUT12 is an 8 A output "
            "(PDM manual p.43), so the wire is sized to the output: 18 AWG carries 8 A at 100 C ambient (the PDM15's recommended "
            "ceiling, manual Mounting). 18 AWG is past MoTeC's 24#-20# recommendation for 8 A outputs (p.48) and inside the "
            "Superseal contact's 24-16 AWG. Feed drop at 6.1 A over 4.6 ft (1.40 m x 0.018 ohm/m): 0.15 V (1.3 %) (review A4)")
CAN_CMD = "CAN from the M130 (MoTeC PDM manual p.39 CAN input, 4 messages x 8 bytes); a timed-out message switches it off (p.23)"
D0927 = {
    # engine PDM loads (PDM15 in the engine bay: no firewall crossing for these feeds)
    "21": {"frm": "FAN-JUNCTION (stud: the 12 AWG tail to the fan)", "free_air": True, "control": "CAN: M130 fan request (" + CAN_CMD + ") — OUT1 and OUT6 on one channel (PDM manual p.22)",
           "why": ("one radiator fan (owner, Gemini T78): SPAL 30107090 'roughly 25 amp max' (300 W / 12 V, web_snapshots/www.kartek.com__"
                   "spal-30107090-...md) is over one 20 A output's 20 A continuous (PDM manual p.36), so OUT1 and the free OUT6 are paralleled "
                   "(p.6: 'can be connected in parallel to increase current capacity'); " + AGENT),
           "note": "BUILD: route the fan feed apart from its ground and outside the loom from the breakout to the fan (free-air rating, ProWire singles table) | OPEN — needs: hot-soak air temperature at the fan motor, thermocouple, engine at operating temp after shutdown (bench/first start). Above 90 C, the close path is 10 AWG (50 A free air, ProWire singles table) with the fan plug's 12 ga terminal fed by a short 12 AWG tail",
           "length_ft": 2.2, "length_basis": ("twin: K5H_Battery (the PDM15's working position 'by the battery'; the twin has no PDM15 "
                                               "object) to K5H_RadFan_1, 0.55 m = 1.8 ft axis-aligned (twin_centers.json), x 1.2 engine pad "
                                               "(state row 33); not taped on the truck"),
           "protection": ("PDM15 OUT1 + OUT6, 16 A each = 32 A: the lowest equal pair >= 1.25 x 25 A = 31.25 A (1 A steps, PDM manual "
                          "p.36), so the limit cannot come down further. 12 AWG end to end (4 x 18 AWG pigtails -> M81824/1-3 -> 12 AWG -> "
                          "the 12 ga SPAL terminal): ProWire 'Aerospace & Defense Singles Ampacity Rating' (web_snapshots/www.prowireusa.com__Aerospace%20&%20Defense%20Singles%20Ampacity%20Rating.md, linked from ProWire's Tefzel chart 'for wire/s in free air and not bundled'): single conductor in free air, 12 AWG = 38 A at a 60 C difference (150 C Tefzel, 90 C ambient), 10 AWG = 50 A; Table 2: 2 conductors x 0.85. The short run (twin 2.2 ft) leaves the loom at the breakout, so it is rated in "
                          "free air, not on the bundled chart (ch.16 §2.2). Alone: 38 A >= 37.6 A (32 A / 0.85, ch.17 rule) and >= 32 A "
                          "(MoTeC p.25: the wire carries the setting). Paired with FAN_GND: 38 x 0.85 = 32.3 A — passes MoTeC's rule, "
                          "misses the 85 % rule. OPEN: (1) both results need ambient <= 90 C at the fan run; the table has no column for "
                          "the 100 C engine-bay figure used elsewhere; (2) route #21 apart from FAN_GND past the breakout to keep the "
                          "single-conductor rating, or accept MoTeC's rule for the pair. SPAL gives no fuse value ('varies dependent on "
                          "the SPAL brushless motor size')")},
    "22": {"retired": "one radiator fan (owner, Gemini thread T78; endpoints.yaml FAN)"},
    "INJ_PWR": {"frm": "PDM15:OUT2", "awg": 14,
                "conflict": ("decision: awg 16 -> 14 — OUT2 needs ceil(1.25 x 8.9 A) = 12 A; 16# is 12 A at 100 C (MoTeC PDM manual p.48) "
                             "and 0.85 x 12 = 10.2 A < 12; 14# is 18 A at 100 C, 0.85 x 18 = 15.3 A >= 12. The rail stubs still fit D-609-05 "
                             "(16-12 AWG): the first joins 14 + 20 + 20 AWG = 4,110 + 1,020 + 1,020 = 6,150 CM <= 6,530 (12 AWG); the "
                             "injector branch leads (INJn_PWR, 20 AWG) do not change (round 3, setting conflict 1)"), "to": {"device": "INJ_PWR rail splice", "pin": "splice: feeds INJ1-8_PWR", "terminal": "D-609-05"},
                "control": "ignition RUN over CAN from the PDM30 (DIG1); the M130 can cut it over CAN",
                "why": "8 x EV1 12.5 ohm = 8.9 A with all open (Siemens Deka FI114961) on a 20 A output; " + AGENT},
    "COIL_PWR": {"frm": "PDM15:OUT3", "to": {"device": "COIL_PWR rail splice (DEL-Stributor bracket)", "pin": "splice: feeds COIL1-8_PWR",
                                          "terminal": "D-609-05"},
                 "control": "ignition RUN over CAN from the PDM30 (DIG1); the M130 can cut it over CAN",
                 "why": "8 x D510C on the DEL-Stributor bracket (state §1) on a 20 A output; " + AGENT},
    "COIL_GND": {"to": {"device": "COIL-GROUND-RINGS", "pin": "head ring terminal", "terminal": "ring"},
                 "why": "coil grounds land on the head (Dave's sheet: coil pin a chassis ground to a head ring terminal)"},
    "66": {"frm": "PDM15:OUT5", "to": {"device": "FUEL-PUMP", "pin": "pump + (hanger connector: read off the hanger, bench)",
                                       "terminal": "open"},
           "control": "CAN: M130 fuel pump request (" + CAN_CMD + ")",
           "protection": ("PDM15 OUT5 maximum-current setting 7 A = ceil(1.25 x 5.1 A) (a 20 A output programmable in 1 A steps, PDM "
                          "manual p.36; the P367 draw: web_snapshots/www.highflowfuel.com__fuel-pump-oem-replacement-hfp-367-qfs.md: 'Flow: 145LPH, Draws 5.1 Amps @ 60psi'; pdm_settings row); no inline fuse "
                          "(chapters/17 §17.8 item 6 'the PDM is the fuse')"),
           "why": "the pump was wired to a relay; relays are out (owner row 54). OUT10 was an 8 A single pin: the 14 AWG feed "
                  "(3 % drop over 18.4 ft) is past the Superseal contact's 24-16 AWG and MoTeC's 24#-20# for 8 A outputs (p.48), "
                  "so it moves to the free 20 A pair OUT5 (A9 + A17, PDM manual p.43) and takes the pigtail + M81824/1-3 "
                  "treatment of #21; OUT10 is free again (book review 2026-09-28); " + AGENT},
    "23": {"frm": "PDM15:OUT11", "to": {"device": "AC-CLUTCH", "pin": "clutch lead", "terminal": "open"},
           "control": "CAN: M130 A/C request, interlocked by the PDM15 low/high pressure switch inputs",
           "why": "compressor ordered 2026-09-24 (state §1 A/C hard parts); clutch is an engine-bay load; " + AGENT},
    "64": {"frm": "PDM15:OUT12", "label": "LTCD power (+12 V)", "awg": 16, "spec": "M22759/32",
           "conflict": ("decision: awg 18 -> 16 — OUT12 needs ceil(1.25 x 6.1 A) = 8 A; 18# is 9 A at 100 C (PDM manual p.48), 0.85 x 9 = "
                        "7.65 A < 8; 16# is 12 A at 100 C, 0.85 x 12 = 10.2 A >= 8. The DTM socket 0462-005-20141 takes 16-18 AWG (DEUTSCH "
                        "Contacts Catalog p.125) — but it is rated 7.5 A, under the 8 A setting (see pdm_settings)"),
           "protection": ("PDM15 OUT12 maximum-current setting 7 A: the DTM size-20 socket is rated 7.5 A (DEUTSCH Contacts Catalog "
                          "p.125, 'Solid Contacts - Common Contact System'), under the 8 A output; the LTCD's cold draw is > 6.1 A "
                          "(LTC manual p.31 + p.37, a lower bound) — if a cold start trips 7 A, the feed needs a second contact"),
           "to": {"device": "WIDEBAND", "pin": "4 (Battery +, red)", "terminal": "DTM06-4S (MoTeC #68054)"},
           "control": "ignition RUN over CAN from the PDM30 (DIG1)",
           "why": "MoTeC LTCD user manual Power/CAN connector pin 4; " + AGENT + " | 22 -> 18 AWG: " + LTCD_WHY},
    "106": {"retired": "the LSU 4.9 sensors plug into the LTCD's own leads (MoTeC LTCD user manual: connectors A/B mate the sensor; "
                       "cutting the sensor connector loses its trimming resistor) — no ECU wire"},
    "107": {"retired": "as #106: sensor 2 plugs into LTCD connector B"},
    "105": {"frm": "PDM15:DIG4", "to": {"device": "A/C low-pressure switch (accumulator)", "pin": "switch lead", "terminal": "open"},
            "why": "state 0e(a): the M130 has no analog inputs left; a pressure switch is a switch, so it lands on a PDM input "
                   "(chapters/17 §17.8.7); " + AGENT},
    "111": {"frm": "PDM15:DIG5", "to": {"device": "A/C high-pressure switch (liquid line)", "pin": "switch lead", "terminal": "open"},
            "why": "as #105; " + AGENT},
    # plug write-up pins into the wire records (the TB and oil-pressure write-ups already carry them)
    "4a": {"to": {"device": "Electronic_Throttle_Body", "pin": "2 (motor -)", "terminal": "WCTHB50 kit terminal (TE AMP)"},
           "why": "the 12605109 6-pin terminal name is stale: the plug is the ICT WCTHB50 kit for the 12699160 (endpoints.yaml TB; review A2)"},
    "4b": {"to": {"device": "Electronic_Throttle_Body", "pin": "1 (motor +)", "terminal": "WCTHB50 kit terminal (TE AMP)"},
           "why": "the 12605109 6-pin terminal name is stale: the plug is the ICT WCTHB50 kit for the 12699160 (endpoints.yaml TB; review A2)"},
    "4c": {"to": {"device": "Electronic_Throttle_Body", "pin": "3 (SENT)", "terminal": "WCTHB50 kit terminal (TE AMP)"},
           "why": "the 12605109 6-pin terminal name is stale: the plug is the ICT WCTHB50 kit for the 12699160 (endpoints.yaml TB; review A2)"},
    "4e": {"to": {"device": "Electronic_Throttle_Body", "pin": "5 (+5 V)", "terminal": "WCTHB50 kit terminal (TE AMP)"},
           "why": "the 12605109 6-pin terminal name is stale: the plug is the ICT WCTHB50 kit for the 12699160 (endpoints.yaml TB; review A2)"},
    "4f": {"to": {"device": "Electronic_Throttle_Body", "pin": "4 (low reference)", "terminal": "WCTHB50 kit terminal (TE AMP)"},
           "why": "the 12605109 6-pin terminal name is stale: the plug is the ICT WCTHB50 kit for the 12699160 (endpoints.yaml TB; review A2)"},
    "102": {"to": {"device": "Oil_Pressure_Sensor_ECU", "pin": "3 (signal)", "terminal": "per OILP-ECU write-up"}},
    "102g": {"to": {"device": "Oil_Pressure_Sensor_ECU", "pin": "1 (0 V)", "terminal": "per OILP-ECU write-up"}},
    "102r": {"to": {"device": "Oil_Pressure_Sensor_ECU", "pin": "2 (5 V)", "terminal": "per OILP-ECU write-up"}},
    # Dakota (dual-sender lock 2026-05-14; manual 650314:P p.6: power and ground 18 AWG)
    "98": {"frm": "M130:B20", "label": "Fuel level sender -> M130 AV6 (with the Dakota #117 in parallel)", "awg": 20, "spec": "M22759/32",
           "to": {"device": "SPL-FUEL-SND", "pin": "sender side (with #117)", "terminal": "M81824/1-2"},
           "why": ("un-retired: state §1 row 32 locks 'Fuel sender: GM 0-90 ohm -> AV input + 270 ohm pull-up'. The later Dakota lock "
                   "(row 36, receipts/2026-05-14_addendum-dakota-dual-sender-wires.md) keeps it: '#117 ... In parallel with #98 Fuel "
                   "Level Sender (ECU)'; row 46 (v4.2, 2026-06-10) leaves 'AV6/B20 left free for #98'; B20 AV6 is unused in the "
                   "M130 pinout. The retirement's 'no analog input left' (0e(a)) predates nothing that took B20. Book review 2026-09-28"),
           "note": ("OPEN — for Dave (adjudication, not a pick): #98 (M130 AV6 with a 270 ohm pull-up to 5 V, state row 32 'Fuel sender: GM 0-90 ohm -> AV input + 270 ohm pull-up') and #117 (Dakota VHX FUEL SND) share ONE resistive sender. Physics: each instrument reads the sender by pushing its own current through it and measuring the voltage; a second source in parallel shifts that voltage, so both read wrong. Dakota VHX manual 650314:P p.11: 'The fuel sender gets power from the control box only ... make sure that the wire does not have power' — the M130 pull-up is power on that wire. p.23: the VHX reads eight resistance senders or CUSTOM, or 'BUS' (fuel level into the AUX I/O port through a BIM module); it has no 0-5 V fuel input. So the paths are: (a) the sender to the M130 only (row 32) and the VHX on BUS through a BIM-EFI-1 reading the M1 General CAN stream (state 0c fork, DAKOTA_VHX_ARCHITECTURE.md); (b) the sender to the Dakota only and no M130 fuel level; (c) a second sender in the tank. The gauge-feed lock (row 36, dual senders) kept both wires without resolving this | "
                    "270 ohm pull-up to a sensor 5 V at the ECU end (state row 32; the 5 V letter follows the A7 pairing ruling); "
                    "OPEN: confirm the Dakota FUEL SND still reads true with the M130 pull-up on the same sender (bench) — "
                    "DAKOTA_VHX_ARCHITECTURE.md FIX 1 flagged the pin as unassigned, not the parallel reading")},
    "117": {"to": {"device": "Dakota VHX control box", "pin": "FUEL SND", "terminal": "screw terminal"}, "awg": 20, "spec": "M22759/32",
            "frm": "SPL-FUEL-SND (sender side, with #98)",
            "note": "OPEN — for Dave (adjudication, not a pick): #98 (M130 AV6 with a 270 ohm pull-up to 5 V, state row 32 'Fuel sender: GM 0-90 ohm -> AV input + 270 ohm pull-up') and #117 (Dakota VHX FUEL SND) share ONE resistive sender. Physics: each instrument reads the sender by pushing its own current through it and measuring the voltage; a second source in parallel shifts that voltage, so both read wrong. Dakota VHX manual 650314:P p.11: 'The fuel sender gets power from the control box only ... make sure that the wire does not have power' — the M130 pull-up is power on that wire. p.23: the VHX reads eight resistance senders or CUSTOM, or 'BUS' (fuel level into the AUX I/O port through a BIM module); it has no 0-5 V fuel input. So the paths are: (a) the sender to the M130 only (row 32) and the VHX on BUS through a BIM-EFI-1 reading the M1 General CAN stream (state 0c fork, DAKOTA_VHX_ARCHITECTURE.md); (b) the sender to the Dakota only and no M130 fuel level; (c) a second sender in the tank. The gauge-feed lock (row 36, dual senders) kept both wires without resolving this",
            "why": "the tank-top plug is a Deutsch DT 2-way (size 16 contacts 0460-202-16141 / 0462-201-16141, '20-16 AWG': web_snapshots/www.customconnectorkits.com__0460-202-16141.md), so 22 AWG is under its floor; the sender carries mA, so 20 AWG M22759/32 is the smallest that fits (research/2026-09-28_unpicked-parts-and-fuel-hanger.md §1.3). Dakota VHX manual p.11: run the sender as 'a twisted pair'; FUEL - goes 'only direct to the fuel level sensor'"},
    "119": {"frm": "PDM30:OUT27", "to": {"device": "Dakota VHX control box", "pin": "L TURN", "terminal": "screw terminal"},
            "control": "tap of the left turn output: the PDM flashes OUT27 from the turn switch input DIG4 (channel plan)"},
    "120": {"frm": "PDM30:OUT28", "to": {"device": "Dakota VHX control box", "pin": "R TURN", "terminal": "screw terminal"},
            "control": "tap of the right turn output: the PDM flashes OUT28 from the turn switch input DIG5 (channel plan)"},
    "122": {"to": {"device": "Dakota VHX control box", "pin": "BRAKE (warning input)", "terminal": "screw terminal"}},
    "71": {"frm": "PDM30:OUT29", "awg": 18, "to": {"device": "Dakota VHX control box", "pin": "ACC. POWER", "terminal": "screw terminal"},
           "control": "PDM30 DIG1 ignition RUN",
           "why": "Dakota 650314:P p.6: ACC. POWER 18 AWG"},
    "124": {"retired": "duplicates #71 (both switched +12 V to the VHX; DAKOTA_VHX_ARCHITECTURE.md §2)"},
    # doors, tailgate, camera, lamps, speed (owner 2026-09-27: "we need power windows ... we have nothing in the doors ... rear camera")
    "34": {"label": "Driver window switch feed (reversing master)", "awg": 14,
           "to": {"device": "WIN-SW-L", "pin": "feed (+12 V)", "terminal": "kit harness"},
           "control": "PDM30 DIG1 ignition RUN (the switches reverse the motors; the PDM is the fuse)",
           "why": "a motor fed straight from the PDM can't reverse; the reversing master switch sits between (" + NUREL + "); " + AGENT},
    "35": {"label": "Passenger window switch feed", "awg": 14,
           "to": {"device": "WIN-SW-R", "pin": "feed (+12 V)", "terminal": "kit harness"},
           "control": "PDM30 DIG1 ignition RUN", "why": NUREL + "; " + AGENT},
    "36": {"retired": "the master switch is fed by #34 and reverses the motor itself (Nu-Relics reverse-polarity switches) — no ECU wire"},
    "37": {"retired": "pointed at a relay coil; the passenger switch is fed by #35 and the master's UP/DOWN lines (WIN_R_UP/DN)"},
    "38": {"label": "Lock feed to the lock rockers (both doors)", "awg": 16,
           "to": {"device": "LOCK-SW-L", "pin": "feed (+12 V)", "terminal": "kit harness"},
           "control": "always on (you lock the truck with the key off); the rockers switch, the PDM is the fuse",
           "why": "two 2-wire actuators on one reversing bus (" + AUTOLOC + "); " + AGENT},
    "47": {"retired": "both actuators ride the lock bus (LOCK_BUS_A/B) fed by #38 — a second output can't reverse a motor either"},
    "44": {"retired": "the lock rockers carry the actuator current directly; no ECU wire"},
    "97": {"to": {"device": "Backup_Camera", "pin": "+12 V (red)", "terminal": "kit"}, "control": "reverse group: PDM30 DIG15 (PCS reverse)",
           "why": RVS + "; " + AGENT},
    "76": {"to": {"device": "Backup_Light_Right", "pin": "+", "terminal": "open"}},
    "89": {"to": {"device": "Backup_Light_Left", "pin": "+", "terminal": "open"}},
    "75": {"to": {"device": "Tail_Light_Right", "pin": "1157_RUN", "terminal": "1157-Socket"},
           "why": "the record put the right tail lamp on the left lamp's socket"},
    "81": {"to": {"device": "Tail_Light_Left", "pin": "1157_RUN", "terminal": "1157-Socket"},
           "why": "the park/tail group drives the RUN filament; the stop/turn filament has its own output (REAR_ST_L)"},
    "93": {"frm": "PDM30:OUT5", "to": {"device": "Third brake light (CHMSL)", "pin": "+", "terminal": "open"},
           "control": "PDM30 logic: brake DIG14",
           "why": "a third BRAKE light lights with the brake, not in reverse (it sat in the reverse group); PDM30 OUT5 freed by the "
                  "retired water pump; " + AGENT},
    "53": {"frm": "PDM30:DIG14", "to": {"device": "Brake light switch (factory, pedal)", "pin": "switch lead", "terminal": "open"},
           "why": "channel plan DIG14 brake; the factory pedal switch now switches ground into the PDM (chapters/17 §17.8.7)"},
    "100": {"frm": "M130:B08", "to": {"device": "VSS-SENDER", "pin": "signal", "terminal": "kit pigtail"},
            "why": "speed from the NP205 mechanical speedometer drive through an electronic sender — true road speed in 4-Lo and 4-Hi "
                   "(" + SEN015 + "); M130 B08 = UDIG3, spare; share the sender signal with the Dakota (bench: confirm it drives both); " + AGENT,
            "awg": 20, "spec": "M22759/32",
            "note": "crossing: FIREWALL-BODY-C cavity 1 (left 61-pin cavity d: the sender is a chassis circuit; review A11)",
            "conflict": "decision: firewall crossing 61-pin cavity d -> body crossing (bulkhead C, cavity OPEN) — state row 50 keeps "
                        "the 61-pin engine-only; the speed sender is a chassis circuit (review A11, 2026-09-28) | crosses the body bulkhead FIREWALL-BODY-C, a Deutsch DT04-6P-L012 ('Wire Range: 14-20 AWG', size 16, 13 A — web_snapshots/www.prowireusa.com__p-2900-dt-6-way-flanged-receptacle.md): 22 AWG is under its floor, so 20 AWG M22759/32 (round 3)"},
    "118": {"retired": "the Dakota reads the speed sender directly (SEN-01-5 is made for the VHX); M130 A32 is free"},
    "48": {"to": {"device": "Horn", "pin": "+", "terminal": "open"}, "control": "horn button on PDM30 DIG6 (channel plan)",
           "why": "the record drove a horn relay coil; relays are out (row 54) — PDM30 OUT14 drives the horn itself"},
    "95": {"retired": "iBooster relay: relays are out (row 54); the iBooster is fed direct from its MIDI 40 A (chapters/17 §17.3)"},
    "96": {"retired": "amplifier relay: relays are out (row 54); the amplifier is fed direct from its MIDI fuse (chapters/17 §17.3) "
                      "and wakes on the head unit's remote turn-on lead"},
    "57": {"retired": "reverse comes from the PCS TCM-2650 lever-position output (PCS_REV -> PDM reverse input); the 6L90 has no "
                      "reverse light switch (receipt 2026-09-26 neutral-start correction); it pointed at the retired April bulkhead"},
    "112": {"to": {"device": "Fuel_Pressure_Sensor", "pin": "3 (signal)", "terminal": "per FUELP write-up (Dave's convention)"}},
    "112g": {"to": {"device": "Fuel_Pressure_Sensor", "pin": "1 (0 V)", "terminal": "per FUELP write-up (Dave's convention)"}},
    "112r": {"to": {"device": "Fuel_Pressure_Sensor", "pin": "2 (5 V)", "terminal": "per FUELP write-up (Dave's convention)"}},
    "65": {"retired": "powered a MoTeC C125 display (April plan OUT29) that is not in the build: the Dakota VHX is the cluster "
                      "(dual-sender lock 2026-05-14); OUT29 powers the Dakota (#71)"},
    "99s": {"note": "drain grounded at the ECU end only; floats at the sensor end"},
    "101s": {"note": "drain grounded at the ECU end only; floats at the sensor end"},
    "103s": {"note": "drain grounded at the ECU end only; floats at the sensor end"},
    "104s": {"note": "drain grounded at the ECU end only; floats at the sensor end"},
    "123": {"awg": 18, "why": "Dakota 650314:P p.6: GROUND 18 AWG or larger"},
    # lifelines: where they land (chapters/17)
    "ECU_PWR": {"to": {"device": "PDM30", "pin": "B6 (PDM30:OUT24, 8 A) — on with ignition RUN", "terminal": "Superseal 1.0"},
                "notes_sub": [("Feed via switched element (OPEN — see header). Route to BAT+ star, passenger firewall corner.",
                               "Fed from PDM30 OUT24 (pin B6), on with ignition RUN (chapters/17 §17.7.4; relays are out, row 54).")],
                "control": "PDM30 DIG1 ignition RUN",
                "why": "chapters/17 §17.7.4: the M130 has no wake pin, its supply is switched upstream; relays are out (row 54), "
                       "so a PDM output is the switch — the PDM on the M130's side of the firewall (PDM30, cab), on OUT24 freed "
                       "when the wideband moved to the engine PDM; " + AGENT},
    "ECU_GND1": {"to": {"device": "COIL-GROUND-RINGS", "pin": "ECM ground ring on the head", "terminal": "ring"},
                 "notes_sub": [("To battery-negative star.", "In the loom to the engine head ring with the coil grounds (chapters/17 §17.4 item 6: ECM grounds land direct on the block or head, never through chassis; state row 56: grounds ride the loom, never the body). Ring, stud and bank OPEN on COIL-GROUND-RINGS (review A9).")],
                 "why": "chapters/17 §17.4.6: ECM grounds land direct on the head or block; §17.7.3 equal-length pair"},
    "ECU_GND2": {"to": {"device": "COIL-GROUND-RINGS", "pin": "ECM ground ring on the head", "terminal": "ring"},
                 "notes_sub": [("To battery-negative star.", "In the loom to the engine head ring with the coil grounds (chapters/17 §17.4 item 6: ECM grounds land direct on the block or head, never through chassis; state row 56: grounds ride the loom, never the body). Ring, stud and bank OPEN on COIL-GROUND-RINGS (review A9).")],
                 "why": "chapters/17 §17.4.6, §17.7.3"},
    "PDM_BPOS": {"to": {"device": "Distribution stud", "pin": "via MEGA 125 A", "terminal": "lug"},
                 "notes_sub": [
                     ('manual p.4 wire spec "16mm2 (6#) or 25mm2 (4#)"',
                      'manual p.4: the PDM16/PDM32 Autosport pin suits 16 mm2 (6#) or 25 mm2 (4#), the PDM15/PDM30 "use a 6 mm '
                      'eyelet to suit the wire size"; p.48 recommends 4# to 2# for battery pos'),
                     ("0 AWG = 150 A chassis ampacity >= 125 A (100 A x1.25)",
                      "2 AWG /16 (decision 2026-09-26, state 0n): 150 A at 80 °C / 120 A at 100 °C, single wire in free air "
                      "(MoTeC PDM manual p.48), on the MEGA 125 A (100 A x 1.25, chapters/17 §17.5 item 5); the run is in the "
                      "cab-side/grommet path, not beside the exhaust"),
                     ("Fused/fusible-link at battery end: rating TBD",
                      "fused MEGA 125 A at the distribution bus (chapters/17 §17.3 topology; lug 2516LTP on the MEGA holder's M8 stud)")],
                 "why": "chapters/17 §17.3: distribution stud -> MEGA 125 A -> PDM30 stud"},
    "PDM_GND1": {"to": {"device": "BAT-", "pin": "battery negative post (star)", "terminal": "ring"},
                 "why": "chapters/17 §17.4.7: both PDM Batt- pins to battery negative"},
    "PDM_GND2": {"to": {"device": "BAT-", "pin": "battery negative post (star)", "terminal": "ring"}, "why": "chapters/17 §17.4.7"},
    "62": {"retired": ("one record for a twisted pair: split into CAN_HI (M130 B17 CAN_HI -> PDM30 B26 CAN High) and CAN_LO "
                       "(B18 CAN_LO -> B25 CAN Low) — MoTeC M1 hardware techspec (B17 'CAN Bus 1 High', B18 'CAN Bus 1 Low'); PDM "
                       "manual p.44; the M130 pinout showed B18 spare with both conductors on B17 (book review 2026-09-28)"),
           "frm": "M130:B17", "label": "CAN trunk M130 to PDM30 (Hi B17 / Lo B18)",
           "to": {"device": "PDM30", "pin": "B26 CAN Hi / B25 CAN Lo", "terminal": "Superseal 1.0"},
           "why": "M130 datasheet B17 CAN_HI / B18 CAN_LO; PDM30 datasheet B26/B25; the bus now reaches the engine PDM15 and the LTCD "
                  "(> 2 m), so it takes a 100R at each end — M130 end and LTCD end (MoTeC PDM manual p.50); " + AGENT},
}
for _k, _v in D0927.items():
    _d = DECISIONS.setdefault(_k, {})
    if "why" in _d and "why" in _v:
        _v = dict(_v, why=_d["why"] + " | " + _v["why"])
    _d.update(_v)

D0927B = {
    # ---- headlights through the factory floor dimmer (locked 2026-05-14): OUT17/OUT18 -> dimmer common -> LOW/HIGH legs
    "85": {"to": {"device": "FLOOR-DIMMER", "pin": "COMMON (feed)", "terminal": "factory 3-blade"},
           "control": "headlight switch HEAD on PDM30 DIG3"},
    "86": {"to": {"device": "FLOOR-DIMMER", "pin": "COMMON (feed)", "terminal": "factory 3-blade"},
           "control": "headlight switch HEAD on PDM30 DIG3", "note": "paralleled with #85 at the dimmer common (receipt 2026-05-14)"},
    "85a": {"frm": "FLOOR-DIMMER:LOW", "to": {"device": "HEADLIGHT-L", "pin": "LOW", "terminal": "Truck-Lite 27270C plug"},
            "why": "dimmer outputs = light blue and tan wires (1977 manual p.780)",
            "control": "floor dimmer picks LOW/HIGH; fed by PDM30 OUT17/OUT18 (#85/#86) on headlight switch HEAD (DIG3)"},
    "85b": {"frm": "FLOOR-DIMMER:HIGH", "to": {"device": "HEADLIGHT-L", "pin": "HIGH", "terminal": "Truck-Lite 27270C plug"},
            "control": "floor dimmer picks LOW/HIGH; fed by PDM30 OUT17/OUT18 (#85/#86) on headlight switch HEAD (DIG3)"},
    "86a": {"frm": "FLOOR-DIMMER:LOW", "to": {"device": "HEADLIGHT-R", "pin": "LOW", "terminal": "Truck-Lite 27270C plug"},
            "control": "floor dimmer picks LOW/HIGH; fed by PDM30 OUT17/OUT18 (#85/#86) on headlight switch HEAD (DIG3)"},
    "86b": {"frm": "FLOOR-DIMMER:HIGH", "to": {"device": "HEADLIGHT-R", "pin": "HIGH", "terminal": "Truck-Lite 27270C plug"},
            "control": "floor dimmer picks LOW/HIGH; fed by PDM30 OUT17/OUT18 (#85/#86) on headlight switch HEAD (DIG3)"},
    "114": {"frm": "DAK-CTS (SEN-04-5 lead 1)", "label": "Dakota temp sender (SEN-04-5) -> VHX WTR SND",
            "to": {"device": "DAKOTA-VHX", "pin": "WTR SND", "terminal": "screw terminal"},
            "why": "Dakota VHX manual p.9: SEN-04-5 two-wire, one to WTR SND (the other is DAK_CTS_RET); the record said factory GM"},
    "115": {"frm": "DAK-OILP (SEN-03-8 white, signal)", "label": "Dakota oil sensor (SEN-03-8) signal -> VHX OIL SND",
            "to": {"device": "DAKOTA-VHX", "pin": "OIL SND", "terminal": "screw terminal"},
            "why": "Dakota VHX manual p.9: SEN-03-8 white to OIL SND (red +5 V and black/shield are DAK_OILP_5V / DAK_OILP_GND)"},
    "121": {"frm": "FLOOR-DIMMER:HIGH", "label": "High beam tap (dimmer HIGH out, with #85b/#86b) -> Dakota VHX HIGH (+)",
            "to": {"device": "DAKOTA-VHX", "pin": "HIGH (+)", "terminal": "screw terminal"},
            "why": "Dakota VHX manual p.6: HIGH (+) high beam indicator input; the record ran it from 'TAP #85b' to the dimmer"},
    "123": {"frm": "DAKOTA-VHX:GROUND", "label": "Dakota VHX ground -> cab ground bank",
            "to": {"device": "GND-BANK-CAB", "pin": "stud", "terminal": "ring"},
            "why": "Dakota VHX manual p.6: GROUND = main chassis ground input; grounds run in the loom (owner 2026-09-27)"},
    # ---- front park/turn, markers
    "83": {"to": {"device": "PARK-TURN-LF", "pin": "PARK (1157 low filament)", "terminal": "1157 socket"},
           "control": "headlight switch PARK on PDM30 DIG2"},
    "84": {"to": {"device": "PARK-TURN-RF", "pin": "PARK (1157 low filament)", "terminal": "1157 socket"},
           "control": "headlight switch PARK on PDM30 DIG2"},
    "80": {"to": {"device": "PARK-TURN-LF", "pin": "TURN (1157 high filament)", "terminal": "1157 socket"},
           "control": "PDM30 flash: left turn DIG4; hazard = DIG4 + DIG5",
           "why": "the record ran the left front turn lamp to the turn switch; the lamp is the load, the switch is a PDM input"},
    "82": {"to": {"device": "PARK-TURN-RF", "pin": "TURN (1157 high filament)", "terminal": "1157 socket"},
           "control": "PDM30 flash: right turn DIG5; hazard = DIG4 + DIG5",
           "why": "the record ran the right front turn lamp to a hazard flasher; the PDM makes the flash (channel plan)"},
    "87": {"to": {"device": "MARKER-LF", "pin": "+", "terminal": "factory socket"}, "control": "headlight switch PARK on PDM30 DIG2"},
    "88": {"to": {"device": "MARKER-RF", "pin": "+", "terminal": "factory socket"}, "control": "headlight switch PARK on PDM30 DIG2"},
    "77": {"control": "headlight switch PARK on PDM30 DIG2"}, "78": {"control": "headlight switch PARK on PDM30 DIG2"},
    "79": {"to": {"device": "CLEARANCE-L", "pin": "+", "terminal": "lamp lead"}, "control": "headlight switch PARK on PDM30 DIG2"},
    "90": {"to": {"device": "CLEARANCE-C", "pin": "+", "terminal": "lamp lead"}, "control": "headlight switch PARK on PDM30 DIG2"},
    "91": {"to": {"device": "CLEARANCE-R", "pin": "+", "terminal": "lamp lead"}, "control": "headlight switch PARK on PDM30 DIG2"},
    "92": {"to": {"device": "LICENSE-LAMP", "pin": "+", "terminal": "lamp lead"}, "control": "headlight switch PARK on PDM30 DIG2"},
    "75": {"control": "headlight switch PARK on PDM30 DIG2"}, "81": {"control": "headlight switch PARK on PDM30 DIG2"},
    "76": {"control": "reverse: PCS lever position on PDM30 DIG15"}, "89": {"control": "reverse: PCS lever position on PDM30 DIG15"},
    "93": {"control": "brake switch on PDM30 DIG14"}, "97": {"control": "reverse: PCS lever position on PDM30 DIG15"},
    "39": {"frm": "PDM30:OUT13", "label": "Park/tail feed -> Dakota VHX DIM (+) night dimming",
           "to": {"device": "DAKOTA-VHX", "pin": "DIM (+)", "terminal": "screw terminal"}, "control": "headlight switch PARK on PDM30 DIG2",
           "why": "Dakota VHX manual p.5-6: DIM (+) night dimming input — 'connect to tail light circuit'; it started at 'ECU'"},
    # ---- horn, washer, wiper, underhood (front body loads)
    "48": {"to": {"device": "HORN", "pin": "+", "terminal": "horn blade"}, "control": "horn button on PDM30 DIG6"},
    "50": {"to": {"device": "WASHER-PUMP", "pin": "+", "terminal": "pump lead"}, "control": "washer switch on PDM30 DIG9 (#46)"},
    "46": {"frm": "PDM30:DIG9", "label": "Wiper switch washer contact -> PDM30 DIG9",
           "to": {"device": "WIPER-SW", "pin": "washer contact", "terminal": "factory switch"},
           "why": "channel plan DIG9 A33; the factory switch grounds through its mounting (1977 manual p.803)"},
    "49": {"to": {"device": "WIPER-MOTOR", "pin": "terminal board center (feed)", "terminal": "factory"},
           "control": "PDM30 DIG1 ignition RUN (the factory dash switch picks the speed)",
           "why": "1977 manual p.803: the ignition switch feeds the wiper's center terminal and the dash switch grounds terminals "
                  "1 and 3 — the factory circuit stays whole (WIPER_T1/T3), the PDM output is the fused feed; DIG7/DIG8 wiper "
                  "inputs of the channel plan are not needed"},
    "73": {"to": {"device": "UNDERHOOD-LAMP", "pin": "+", "terminal": "lamp lead"}, "control": "courtesy group: door jambs DIG12/DIG13"},
    # ---- blower: factory switch + resistor, HI from its own output
    "51": {"to": {"device": "BLOWER-SW", "pin": "feed", "terminal": "factory control head"},
           "control": "PDM30 DIG1 ignition RUN (the factory switch picks LOW/MED through the resistor)",
           "why": "1977 manual p.87-88 (Four-Season: resistor on the evaporator case, HI through a relay); set OUT6's limit to "
                  "the 16 AWG speed leads"},
    "45": {"frm": "PDM30:DIG7", "label": "Blower switch HI contact -> PDM30 DIG7",
           "to": {"device": "BLOWER-SW", "pin": "HI contact", "terminal": "factory control head"},
           "why": "the HI position used to energize the blower relay; now it is a PDM input that turns on OUT2 (BLOWER_HI); DIG7 "
                  "freed from the wiper (factory wiper circuit kept)"},
    # ---- interior, accessories
    "67": {"to": {"device": "DOME-LAMP", "pin": "+", "terminal": "lamp lead"}, "control": "courtesy group: door jambs DIG12/DIG13"},
    "68": {"to": {"device": "UNDERDASH-LAMPS", "pin": "+", "terminal": "lamp lead"}, "control": "courtesy group: door jambs DIG12/DIG13"},
    "69": {"to": {"device": "FOOTWELL-LAMPS", "pin": "+", "terminal": "lamp lead"}, "control": "courtesy group: door jambs DIG12/DIG13"},
    "74": {"to": {"device": "CARGO-LAMP", "pin": "+", "terminal": "lamp lead"}, "control": "courtesy group: door jambs DIG12/DIG13"},
    "42": {"frm": "PDM30:DIG12", "label": "Driver door jamb switch -> PDM30 DIG12",
           "to": {"device": "DOOR-JAMB-L", "pin": "switch terminal", "terminal": "factory pin switch"},
           "why": "channel plan DIG12 B21; the jamb switch grounds through the body when the door opens; it ran to a keyless module "
                  "nothing else carries"},
    "43": {"frm": "PDM30:DIG13", "label": "Passenger door jamb switch -> PDM30 DIG13",
           "to": {"device": "DOOR-JAMB-R", "pin": "switch terminal", "terminal": "factory pin switch"},
           "why": "channel plan DIG13 B15"},
    "70": {"to": {"device": "USB-PORT", "pin": "+12 V", "terminal": "port lead"}, "control": "PDM30 DIG1 ignition RUN"},
    "72": {"to": {"device": "OUTLET-12V", "pin": "+12 V", "terminal": "outlet lead"}, "control": "PDM30 DIG1 ignition RUN", "awg": 12,
           "free_air": True,
           "note": "BUILD: route the 12 V outlet feed and its ground outside the loom from the breakout to the socket (free-air rating, ProWire singles table)",
           "why": ("OUT8 needs ceil(1.25 x 15 A) = 19 A (Blue Sea 1011, 15 A max). 14 AWG is 22 A at 80 C (PDM manual p.48), 0.85 x 22 = 18.7 < 19. "
                   "p.48 has no 12 AWG row; ProWire's bundled chart gives 12 AWG 20 A (0.85 x 20 = 17, fails in the loom), its singles table "
                   "gives 12 AWG 38 A at a 60 C difference and x 0.85 for two conductors = 32.3 A, 0.85 x 32.3 = 27.5 A >= 19 — so 12 AWG run "
                   "with its ground outside the loom (ProWire 'Aerospace & Defense Singles Ampacity Rating' (web_snapshots/www.prowireusa.com__Aerospace%20&%20Defense%20Singles%20Ampacity%20Rating.md)); 12 AWG fits the pigtail splice M81824/1-3 (16-12)")},
    # ---- column switches
    "33": {"frm": "PDM30:DIG4", "label": "Turn switch left-front output -> PDM30 DIG4",
           "to": {"device": "TURN-SW", "pin": "left front output", "terminal": "column connector"},
           "why": "channel plan DIG4 A21: the column switch now switches 0V into the PDM (TURN_SW_0V); the PDM makes the flash"},
    "41": {"retired": "the hazard flasher is gone: the PDM30 makes the flash, and the column's hazard feed is tied to 0V with the "
                      "turn feed (TURN_SW_0V), so hazard reads as both turn inputs (DIG4 + DIG5)"},
    "40": {"retired": "the ignition switch feeds the PDM30 inputs (IGN_RUN_B, IGN_START); the M130 has no ignition pin (chapters/17)"},
    "56": {"retired": "the PCS lever-position output is the neutral-start input (PCS_NS, PDM30 DIG11; receipt 2026-09-26 "
                      "substrate-correction-1977-neutral-start-switch-on-column)"},
    "55": {"frm": "TCASE-4WD-SW", "label": "NP205 4WD indicator switch -> Dakota VHX 4x4 (-)",
           "to": {"device": "DAKOTA-VHX", "pin": "4x4 (-)", "terminal": "screw terminal"},
           "why": "Dakota VHX manual p.6: '4x4 (-) 4 wheel drive indicator input' from the transfer case switch; it ran to an "
                  "M130 input with no pin"},
    # ---- audio: speakers on the amp (front pair through the door pass-throughs), head unit and amp power
    "26a": {"to": {"device": "SPK-FL", "pin": "+", "terminal": "speaker terminal"}},
    "26b": {"to": {"device": "SPK-FL", "pin": "-", "terminal": "speaker terminal"}},
    "27a": {"to": {"device": "SPK-FR", "pin": "+", "terminal": "speaker terminal"}},
    "27b": {"to": {"device": "SPK-FR", "pin": "-", "terminal": "speaker terminal"}},
    "28a": {"to": {"device": "SPK-RL", "pin": "+", "terminal": "speaker terminal"}},
    "28b": {"to": {"device": "SPK-RL", "pin": "-", "terminal": "speaker terminal"}},
    "29a": {"to": {"device": "SPK-RR", "pin": "+", "terminal": "speaker terminal"}},
    "29b": {"to": {"device": "SPK-RR", "pin": "-", "terminal": "speaker terminal"}},
    "30a": {"to": {"device": "SUB", "pin": "+", "terminal": "speaker terminal"}},
    "30b": {"to": {"device": "SUB", "pin": "-", "terminal": "speaker terminal"}},
    "31": {"to": {"device": "RADIO", "pin": "red (ignition/ACC +12 V)", "terminal": "harness plug A"},
           "control": "PDM30 DIG1 ignition RUN", "why": "RetroSound Model Hermosa manual p.16"},
    "32": {"frm": "ACC-BATT (+, MIDI 60 A)", "to": {"device": "AMP-BLOCK", "pin": "+ in (2 AWG)", "terminal": "block set screw"},
           "why": "the amplifier runs off the accessory battery (owner 2026-09-27: YellowTop 'for other stuff like accessories'); "
                  "the JL Audio VX700/5i takes '4-gauge power and ground leads and a 60-amp fuse' (Crutchfield page, snapshot "
                  "web_snapshots/www.crutchfield.com__JL-Audio-VX700-5i.md), so the MIDI at the battery is 60 A (owner 2026-09-27 "
                  "ruled out Kicker: 'kicker is not cool... what a brand for a 100k truck'); it started at 'ECU'"},
    # ---- AMP Research steps
    "3": {"frm": "Distribution stud (kit harness fuse)", "label": "AMP Research harness power (red lead, battery +)", "awg": None,
          "spec": "kit harness", "to": {"device": "AMP-STEP-CTRL", "pin": "red lead (+12 V)", "terminal": "kit ring"},
          "why": "AMP Research IM75146 step 8: red lead to battery +, fused in the kit harness (the steps deploy key-off)"},
    "1": {"retired": "the AMP Research kit harness drives and reverses both step motors (IM75146) — a PDM output can't reverse a motor"},
    "2": {"retired": "as #1"},
    # ---- brakes: iBooster (direct MIDI feed), E-Stopp
    "52": {"frm": "Distribution stud (MIDI 40 A)", "label": "iBooster power (direct, MIDI 40 A)", "awg": 6, "spec": "M22759/16",
           "to": {"device": "IBOOSTER", "pin": "1 (constant 12 V)", "terminal": "Tulay harness"},
           "why": "chapters/17 §17.3 spine table: MIDI 40 A; gauge from cable_decisions.json (6 AWG: a MIDI 40 needs 47 A of cable, "
                  "8 AWG bundled is 40 A — cable_sizing_v5.py); the ch.17 table's 8 AWG is superseded; it started at 'ECU'"},
    "54": {"to": {"device": "E-STOPP", "pin": "G (red, +12 V)", "terminal": "kit lead"},
           "control": "always on (E-Stopp wire G is a battery feed; the brake has to set key-off)"},
    # ---- the v4 DC-primary runs: their ends are the power-spine studs (chapters/17 §17.3), not 'ECU'
    "63": {"frm": "ODYSSEY (+)", "label": "Odyssey positive to the isolator (stud A)",
           "to": {"device": "PS-STUDS", "pin": "isolator stud A (Blue Sea 7700, 3/8\"-16)", "terminal": "238LTP"},
           "why": "chapters/17 §17.3: battery -> isolator -> distribution stud; MoTeC PDM manual p.7 (isolator on battery "
                  "positive); Blue Sea 7700 studs A/B interchangeable, 3/8\"-16 (instructions p.2); Odyssey = the running "
                  "battery (owner 2026-09-27)"},
    "PDM_GND1": {"to": {"device": "GND-BANK-ENG", "pin": "ground star stud", "terminal": "ring"},
                 "why": "chapters/17 §17.4.7: both PDM Batt- pins to battery negative — the battery negative lands on the "
                        "ground star (GND-BANK-ENG, ODY_NEG)"},
    "PDM_GND2": {"to": {"device": "GND-BANK-ENG", "pin": "ground star stud", "terminal": "ring"},
                 "why": "as PDM_GND1"},
    "6": {"frm": "PS-STUDS (distribution stud)", "to": {"device": "PS-STUDS", "pin": "starter B+ stud", "terminal": "2516LTP"},
          "why": "chapters/17 §17.3: distribution stud -> starter feed, unfused (cranking-motor exemption)"},
    "59": {"frm": "PS-STUDS (alternator B+ stud)", "to": {"device": "PS-STUDS", "pin": "distribution stud (via MEGA)", "terminal": "238LTP"},
           "why": "chapters/17 §17.3: MEGA -> alternator branch off the distribution stud"},
    # ---- dead ends
    "58": {"retired": "the PCS TCM-2650 takes ignition from the engine PDM (PCS_IGN, PDM15 OUT13); the T43-era feed is dead"},
    "125": {"retired": "Holley T43 CAN stub: the T43 path is dead (6L90 + PCS TCM-2650, receipt 2026-07-12)"},
    "122": {"retired": "BRAKE (-) on the Dakota is the brake-system / parking-brake WARNING input (VHX manual p.6); a tap of "
                       "the pedal switch (#53) would light it on every stop. Nothing on this truck reports parking-brake-set "
                       "(the E-Stopp ESK001 diagram has no status wire) or low fluid yet — the input stays unused until one does"},
    # ---- naming slips: the A/C switches land on their plug codes
    "105": {"to": {"device": "AC-LP-SW", "pin": "switch lead", "terminal": "switch pigtail"}},
    "111": {"to": {"device": "AC-HP-SW", "pin": "switch lead", "terminal": "switch pigtail"}},
}
# front lamp feeds that cross the firewall go to 20 AWG: DT size 16 contacts take 16-20 AWG
_UP20 = ("crosses the firewall in the body bulkhead: DT size 16 contacts take 16-20 AWG (KSV DT04-12PA-L012 kit, nickel pins "
         "20-16 AWG); 20 AWG is also the sturdier run to the front (the 2026-05-14 gauge audit had 22 AWG for 0.3-0.8 A lamps)")
for _k in ("50", "73", "80", "82", "83", "84", "87", "88"):
    _e = D0927B.setdefault(_k, {})
    _e["awg"] = 20
    _e["why"] = (_e["why"] + " | " + _UP20) if _e.get("why") else _UP20
for _k, _v in D0927B.items():
    _d = DECISIONS.setdefault(_k, {})
    if "why" in _d and "why" in _v:
        _v = dict(_v, why=_d["why"] + " | " + _v["why"])
    _d.update(_v)

# Subsystem for wires no subsystems.json list carries (v4.1/v4.2/05-14 additions + implied), by the section or
# decision that added them — the recalc engine and the app toggle on this field, so every wire needs one.
SUBSYSTEM_RULES = [
    (r"^(11[4-9]|12[0-4]|DAK_CONST)$", "DASH_CLUSTER_DAKOTA", "Dakota VHX dual-sender wires (receipt 2026-05-14 acceptance)"),
    (r"^(125|PCS_.*)$", "TRANS_6L80E", "6L90 + PCS TCM-2650 interface (receipt 2026-07-12; state 0j(b)); key keeps its 6L80E name"),
    (r"^126$", "EPARKING_BRAKE", "E-Stopp dash trigger (receipt 2026-05-14 acceptance)"),
    (r"^8[56][ab]$", "LIGHTING_EXTERIOR", "high-beam floor dimmer legs (receipt 2026-05-14 high-beam)"),
    (r"^(ECU_PWR|ECU_GND[12]|APS_.*|ETH_.*|COIL\d+_.*|INJ\d+_PWR)$", "CORE_ENGINE",
     "the engine can't power up, rev or be tuned without it (v4.1 lifelines, v4.2 pedal, state 0k comms, coil/injector branches)"),
    (r"^(PDM_BPOS|PDM_GND[12]|UTC_.*|G[123])$", "HARNESS_INFRA", "always-built substrate: PDM feed, PDM config port, main grounds"),
    (r"^ISO_KILL$", "CHARGING_STARTING", "battery isolator shutdown contact (state 0b)"),
    (r"^PUMP_GND$", "FUEL", "fuel pump ground (receipt 2026-09-26 device ends)"),
    (r"^(FAN_GND|FAN_PWM|FAN_LEG[12])$", "COOLING", "radiator fan ground and PWM (2026-09-28 parts picks)"),
    (r"^(PDM15_.*)$", "HARNESS_INFRA", "engine PDM feed and grounds (2026-09-27)"),
    (r"^(IGN_.*|START_TRIG)$", "CHARGING_STARTING", "ignition switch as PDM inputs, starter trigger from the engine PDM (2026-09-27)"),
    (r"^(CAN_.*|LTCD_GND)$", "CORE_ENGINE", "CAN bus to the engine PDM and the LTCD (2026-09-27)"),
    (r"^AC_.*$", "HVAC_AC", "A/C pressure switch returns (2026-09-27)"),
    (r"^(WIN_.*)$", "POWER_WINDOWS", "door power windows (2026-09-27)"),
    (r"^(LOCK_.*)$", "POWER_LOCKS", "door power locks (2026-09-27)"),
    (r"^(TG_.*)$", "POWER_WINDOWS", "factory power tailgate window (2026-09-27)"),
    (r"^(TGR_.*)$", "POWER_WINDOWS", "Nu-Relics tailgate kit on reversing switches, CANDIDATE (2026-09-28, row 54: no relay)"),
    (r"^(CAM_.*|MIRROR_.*)$", "CAMERA_REAR", "rear camera + mirror display (2026-09-27)"),
    (r"^(REAR_ST_.*|BRK_SW_0V)$", "LIGHTING_EXTERIOR", "rear stop/turn outputs and the brake switch input (2026-09-27)"),
    (r"^(VSS_.*)$", "DASH_CLUSTER_DAKOTA", "road speed sender (2026-09-27)"),
    (r"^(HL_[LR]_GND|PT_.*|MK_.*|TL_.*|BU_.*|LIC_GND|CL_.*|CHMSL_GND|HL_SW_.*|TURN_SW_.*)$", "LIGHTING_EXTERIOR",
     "lamp grounds and the factory lighting switches as PDM inputs (2026-09-27)"),
    (r"^(HORN_.*)$", "ACCESSORY_12V", "horn button and ground (2026-09-27)"),
    (r"^(DOME_GND|UD_GND|FW_GND|UH_GND|CARGO_GND)$", "LIGHTING_INTERIOR", "interior lamp grounds (2026-09-27)"),
    (r"^(WASH_.*|WIPER_.*)$", "WIPERS_WASHER", "factory wiper circuit and washer ground (2026-09-27)"),
    (r"^(BLOWER_.*)$", "HVAC_AC", "factory Four-Season blower circuit (2026-09-27)"),
    (r"^(RADIO_.*|RCA_.*|AMP_GND|SUB_JMP_.*)$", "AUDIO", "head unit, amplifier, woofer jumpers (2026-09-27)"),
    (r"^(USB_GND|OUT12V_GND)$", "ACCESSORY_12V", "accessory grounds (2026-09-27)"),
    (r"^(STEP_.*)$", "AMP_STEPS", "AMP Research harness (2026-09-27)"),
    (r"^(ESTOPP_.*)$", "EPARKING_BRAKE", "E-Stopp (2026-09-27)"),
    (r"^(IBOOST_.*)$", "BRAKES_IBOOSTER", "iBooster ground, wake (2026-09-27)"),
    (r"^(FUEL_SND_GND|FUEL_SND_LEAD|DAK_CTS_RET|DAK_OILP_.*)$", "DASH_CLUSTER_DAKOTA", "Dakota sender returns and 5 V (2026-09-27)"),
    (r"^(ALT_L)$", "CHARGING_STARTING", "alternator L wire (2026-09-27)"),
    (r"^(ISO_.*|DCDC_.*)$", "CHARGING_STARTING", "isolator + dual batteries (2026-09-27)"),
    (r"^(ODY_NEG|ACC_NEG)$", "CHARGING_STARTING", "battery negatives to the ground star (2026-09-27)"),
    (r"^TCASE_SW_GND$", "DASH_CLUSTER_DAKOTA", "4WD indicator switch ground (2026-09-27)"),
    (r"^(GND_RET_.*)$", "HARNESS_INFRA", "ground returns in the loom (2026-09-27)"),
    (r"^(DAK_CEL|DAK_BRAKE|DAK_GEAR|GSS_.*)$", "DASH_CLUSTER_DAKOTA", "Dakota indicators (2026-09-27)"),
]


def assign_subsystems(rows):
    for w in rows:
        if w.get("subsystem"):
            continue
        for rx, sub, why in SUBSYSTEM_RULES:
            if re.match(rx, str(w["id"])):
                w["subsystem"], w["subsystem_basis"] = sub, why
                break


def apply_decisions(rows):
    for w in rows:
        d = DECISIONS.get(w["id"])
        if not d:
            continue
        if "retired" in d:
            w["retired"] = d["retired"]
            continue
        for f in ("awg", "spec", "color", "length_ft", "frm", "label", "to"):
            if f in d and w.get(f) != d[f]:
                w["conflicts"].append(f"decision: {f} {w.get(f)} -> {d[f]} — {d.get('why') if f != 'length_ft' else d['length_basis']}")
                w[f] = d[f]
        if "note" in d:
            w["notes"] = (w.get("notes") + " | " if w.get("notes") else "") + d["note"]
        if "conflict" in d:
            w["conflicts"].append(d["conflict"])
        for old_txt, new_txt in d.get("notes_sub", []):     # a stale sentence in the v4.2 notes, rewritten with its source
            if old_txt in (w.get("notes") or ""):
                w["notes"] = w["notes"].replace(old_txt, new_txt)
                w["conflicts"].append(f"decision: notes '{old_txt}' -> '{new_txt}'")
        if "protection" in d:
            w["protection"] = d["protection"]
        if d.get("free_air"):
            w["free_air"] = True
        if "parallel" in d:
            w["parallel"] = d["parallel"]
        if "control" in d:
            w["control"] = d["control"]
        if "length_basis" in d:
            w["length_basis"] = d["length_basis"]


# ---- decisions on implied rows (same shape as DECISIONS; the old value goes to `conflicts`)
IMPLIED_DECISIONS = {
    "VSS_PWR": {"awg": 20, "spec": "M22759/32", "why": "crosses the body bulkhead FIREWALL-BODY-C, a Deutsch DT04-6P-L012 ('Wire Range: 14-20 AWG', size 16, 13 A — web_snapshots/www.prowireusa.com__p-2900-dt-6-way-flanged-receptacle.md): 22 AWG is under its floor, so 20 AWG M22759/32 (round 3)"},
    "VSS_GND": {"awg": 20, "spec": "M22759/32", "why": "crosses the body bulkhead FIREWALL-BODY-C, a Deutsch DT04-6P-L012 ('Wire Range: 14-20 AWG', size 16, 13 A — web_snapshots/www.prowireusa.com__p-2900-dt-6-way-flanged-receptacle.md): 22 AWG is under its floor, so 20 AWG M22759/32 (round 3)"},
    "VSS_DAK": {"awg": 20, "spec": "M22759/32", "why": "crosses the body bulkhead FIREWALL-BODY-C, a Deutsch DT04-6P-L012 ('Wire Range: 14-20 AWG', size 16, 13 A — web_snapshots/www.prowireusa.com__p-2900-dt-6-way-flanged-receptacle.md): 22 AWG is under its floor, so 20 AWG M22759/32 (round 3)"},
    "FAN_GND": {"note": "BUILD: route the fan feed apart from its ground and outside the loom from the breakout to the fan (free-air rating, ProWire singles table) | OPEN — needs: hot-soak air temperature at the fan motor, thermocouple, engine at operating temp after shutdown (bench/first start). Above 90 C, the close path is 10 AWG (50 A free air, ProWire singles table) with the fan plug's 12 ga terminal fed by a short 12 AWG tail"},
    # ---- 8: the PCS TCM-2650 as an endpoint (its harness plug waits on the ZGP drawing; the pins say so)
    "PCS_BATT": {"to": "PCS-TCM (12 V battery)", "why": "ZGP TCM-2650 setup guide rev2 (reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf) p.1 constant 12 V; endpoint PCS-TCM (book review 2026-09-28)"},
    "PCS_IGN": {"to": "PCS-TCM (ignition)", "why": "ZGP TCM-2650 setup guide rev2 (reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf) p.1 ignition; endpoint PCS-TCM"},
    "PCS_TPS": {"to": "PCS-TCM (analog 1)", "why": "ZGP TCM-2650 setup guide rev2 (reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf) p.13 + Table 4 (analog 1 may piggyback an ECU sensor); endpoint PCS-TCM"},
    "PCS_RPM": {"to": "PCS-TCM (speed input 3, orange/black)", "why": "ZGP TCM-2650 setup guide rev2 (reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf) p.12 speed input 3 = RPM, orange/black; endpoint PCS-TCM"},
    "PCS_BRK": {"frm": "CHMSL (+ feed tap: 12 V while braking)", "to": "PCS-TCM (brake light input)",
                 "why": "ZGP TCM-2650 setup guide rev2 (reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf) p.18 'Brake Light' digital input (TCC unlock on brake). The factory brake switch now switches 0 V into "
                        "PDM30 DIG14 and no longer carries 12 V, so the brake-on 12 V comes from the brake lamp output (CHMSL feed); "
                        "input polarity OPEN until the ZGP drawing"},
    "PCS_NS": {"frm": "PCS-TCM (PWM vs Lever Position output: neutral)", "why": "ZGP TCM-2650 setup guide rev2 (reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf) p.19-20 ground-only outputs; endpoint PCS-TCM"},
    "PCS_REV": {"frm": "PCS-TCM (PWM vs Lever Position output: reverse)", "why": "ZGP TCM-2650 setup guide rev2 (reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf) p.19-20 ground-only outputs; endpoint PCS-TCM"},
    # ---- 4: the LTCD CAN pair on DTM size-20 sockets (20 AWG only)
    "CAN_LTCD_H": {"awg": 20, "spec": "M22759/32 twisted", "why": "DEUTSCH Contacts Catalog p.125 'Solid Contacts - Common Contact "
                   "System': size-20 socket 0462-201-20** takes 20 AWG (0.50 mm2) only; 22 AWG is under it. 20 AWG twisted still meets "
                   "the MoTeC CAN rule (PDM manual p.49 'twisted 22# Tefzel is usually OK' is a floor, not a size)"},
    "CAN_LTCD_L": {"awg": 20, "spec": "M22759/32 twisted", "why": "as CAN_LTCD_H: DEUTSCH Contacts Catalog p.125, size-20 socket 20 AWG only"},
    "TG_BUS_UP": {"label": "Tailgate window UP line: dash switch UP -> splice 183 at the key switch CLOSE terminal",
                  "to": "TG-SW-KEY (CLOSE, splice 183)", "why": "the key switch is in parallel, not in series: " + TGW},
    "TG_BUS_DN": {"label": "Tailgate window DOWN line: dash switch DOWN -> splice 184 at the key switch OPEN terminal",
                  "to": "TG-SW-KEY (OPEN, splice 184)", "why": "the key switch is in parallel, not in series: " + TGW},
    "TG_MOT_A": {"label": "Tailgate-closed cutout switch -> window motor UP (circuit 183E)", "frm": "TG-CUTOUT (183E)",
                 "why": "the UP line reaches the motor through the N/O tailgate-closed cutout switch 2977647: " + TGW},
    "TG_MOT_B": {"label": "Splice 184 (key switch OPEN terminal) -> window motor DOWN (circuit 184C)",
                 "frm": "TG-SW-KEY (OPEN, splice 184)", "why": TGW},
    "BLOWER_BAT": {"conflict": "decision: resistor text '3 prongs' -> 4 terminals, this wire on cavity 51 — " + BLW},
    "BLOWER_MED": {"conflict": "decision: resistor text '3-prong resistor' -> 4 terminals, this wire on cavity 63 — " + BLW},
    "BLOWER_M2": {"conflict": "decision: 'the third resistor prong' -> cavity 72 of 4 — " + BLW},
    "RADIO_REM": {"awg": 18, "why": ("JL Audio VX700/5i: 'The power connector will accept up to 4-gauge power and ground wire, and "
                                     "10-18-gauge wire for the remote turn-on' (web_snapshots/www.crutchfield.com__JL-Audio-VX700-5i.md, "
                                     "manual excerpt); 20 AWG is under the connector's range — 18 AWG M22759/32")},
    "DCDC_IN": {"note": ("fuse MIDI 60 A, the maker's number: Victron Orion-Tr Smart manual §4.2 Figure 6 'Cable and fuse "
                         "recommendations', 12 V row: external battery protection fuse 60 A, minimum cable 6 mm2 at 0.5 m, 10 mm2 at "
                         "1-2 m (web_snapshots/www.victronenergy.com__34439-Orion-Tr_Smart_DC-DC_Charger-pdf-en.md). The 6 AWG "
                         "(13.3 mm2) cable meets 10 mm2 and carries it: 75 A at 100 C x 0.85 = 64 A >= 60 A. chapters/17's MIDI 40 "
                         "(35 A x 1.25 = 44 A rounded down) was under both the 125 % floor and the maker; superseded 2026-09-28"),
                "conflict": "fuse: MIDI 40 A (chapters/17) -> MIDI 60 A (Victron manual §4.2)"},
    "HORN_GND": {"note": "factory grounds through the bracket (catalog/pin_tables/HORN.yaml, 1978 booklet); the wire stays for the Tefzel harness (no chassis-ground reliance, chapters/17 §17.4; state row 56)"},
    "LIC_GND": {"note": "factory grounds through the housing (catalog/pin_tables/LICENSE-LAMP.yaml, 1978 booklet); the wire stays for the Tefzel harness (no chassis-ground reliance, chapters/17 §17.4; state row 56)"},
    "UH_GND": {"note": "factory grounds through the mount (catalog/pin_tables/UNDERHOOD-LAMP.yaml, 1978 booklet); the wire stays for the Tefzel harness (no chassis-ground reliance, chapters/17 §17.4; state row 56)"},
    "BRK_SW_0V": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "IGN_SW_0V": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "IGN_RUN_B": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "IGN_START": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "HL_SW_0V": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "HL_SW_HEAD": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "HL_SW_PARK": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "TURN_SW_R": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "TURN_SW_0V": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "HORN_SW": {"awg": 20, "spec": "M22759/32", "why": BLADE20},
    "LTCD_GND": {"awg": 16, "why": "the LTCD return carries the feed's current: sized with #64, 16 AWG on DTM 0462-005-20141 (16-18 AWG, DEUTSCH p.125); PDM manual p.48 16# 12 A at 100 C (round 3)"},
    "PDM15_BPOS": {"awg": 4, "frm": "Distribution stud (MEGA 100 A)",
                   "why": ("fuse sized from the PDM15's 80 A total continuous output (MoTeC PDM manual p.35) x 1.25 = 100 A, "
                           "the method of chapters/17 §17.5 item 5 (MEGA 125 A on the PDM30's 100 A); MEGA is made 100-500 A "
                           "(chapters/17 §17.2 item 9) — 'MEGA 80 A' does not exist. The cable must carry the fuse: 6# = 90 A "
                           "at 80 °C / 75 A at 100 °C (PDM manual p.48) is under 100 A; 4# = 120 A / 100 A carries it, and "
                           "p.48 recommends 4# to 2# for battery pos (p.4 allows 6# or 4#). Supersedes chapters/17 §17.8 "
                           "item 4's 6 AWG for this feed; lugs LUG-4AWG-M6 (PDM15 stud) and LUG-4AWG-M8 (MEGA holder), "
                           "part numbers OPEN (power-spine review 2026-09-28)")},
}


def apply_implied_decisions(rows):
    for w in rows:
        d = IMPLIED_DECISIONS.get(w["id"])
        if not d:
            continue
        for f in ("awg", "spec", "color", "frm", "label", "to"):
            if f in d and w.get(f) != d[f]:
                w.setdefault("conflicts", []).append(f"decision: {f} {w.get(f)} -> {d[f]} — {d['why']}")
                w[f] = d[f]
        if "note" in d:
            w["notes"] = (w.get("notes") + " | " if w.get("notes") else "") + d["note"]
        if "conflict" in d:
            w.setdefault("conflicts", []).append(d["conflict"])


# ---- review A1 (2026-09-28): a load wire heavier than 16 AWG never lands on a Superseal pin. Each 20 A output is two
#      paired pins (MoTeC PDM user manual p.43 PDM15, p.44 PDM30: '20 A Output n (with Axx)'); the Superseal contact takes
#      24-16 AWG and MoTeC recommends 20# to 16# on a 20 A output (p.48). So two 16 AWG pigtails, one per pin, equal
#      length, run into an in-line MiniSeal M81824/1-3 and the load wire leaves its other end. A D-609 stub can't: all
#      three wires enter one end, 2 x 2,580 + 6,530 CM = 11,690 CM, past the 16-12 AWG cavity (kits_v5.splice_for).
PDM20_PINS = {"OUT1": ("A1", "A10"), "OUT2": ("A3", "A12"), "OUT3": ("A5", "A14"), "OUT4": ("A7", "A16"),
              "OUT5": ("A9", "A17"), "OUT6": ("B3", "B9"), "OUT7": ("B5", "B11"), "OUT8": ("B7", "B13")}
PIGTAIL_WHY = ("review A1 (receipt 2026-09-28_reviews-and-shape-rules.md; state 0h(1)): MoTeC PDM user manual p.48 — 20# to 16# "
               "on 20 A outputs, 16# = 15 A at 80 C, each pin carries about half the output; Superseal SSC-N contact 24-16 AWG "
               "(ProWire M800-KIT-N); in-line MiniSeal M81824/1-3 (ProWire Raychem MiniSeal page: 'Butt: M81824/1 series')")


PIG_RULE = ("one conductor can't fill both cavities of a paired 20 A output (MoTeC PDM manual p.43/p.44 '20 A Output n (with "
            "Axx)'), so every load on OUT1-8 takes two equal pigtails and an in-line MiniSeal. Pigtail gauge makes both splice "
            "sides fit one colour (3137CT cavities 26-20 / 20-16 / 16-12): a 12-16 AWG load takes 2 x 16 AWG into M81824/1-3 "
            "(yellow); an 18-20 AWG load takes 2 x 20 AWG into M81824/1-2 (blue); a 22-24 AWG load is raised to 20 AWG first "
            "(red can't take 2 x 20). 20 AWG pigtails are inside MoTeC's 20#-16# for 20 A outputs (p.48) and carry 2 x 8 A at "
            "80 C, so that output's limit is set to 16 A or less (review 2026-09-28, second book review)")


def add_pigtails(rows):
    """Return the pigtail rows; re-point every load on a paired 20 A output at its splice (the old frm goes to `conflicts`)."""
    out = []
    for w in rows:
        m = re.fullmatch(r"(PDM30|PDM15):(OUT[1-8])(?:\+(OUT[1-8]))?", str(w.get("frm") or ""))
        if w.get("retired") or not m or not isinstance(w.get("awg"), int) or w["awg"] < 12:
            continue
        box, ch, ch2 = m.groups()
        p1, p2 = PDM20_PINS[ch]
        spl = f"SPL-{box}-{ch}"
        if ch2:     # two paralleled 20 A outputs (MoTeC PDM manual p.6, p.22): four 18 AWG pigtails = 6,480 CM, inside one yellow
            pins4 = PDM20_PINS[ch] + PDM20_PINS[ch2]
            old = w["frm"]
            w["frm"] = f"{spl} ({box}:{ch} + {box}:{ch2} pigtails {' + '.join(pins4)})"
            w.setdefault("conflicts", []).append(
                f"decision: frm {old} -> {w['frm']} — two paralleled 20 A outputs: MoTeC PDM manual p.6 'Two or more output pins can "
                f"be connected in parallel to increase current capacity ... must all be of the same type', p.22 'configured to use a "
                f"common channel or an identical condition'; four 18 AWG pigtails (20#-16#, p.6) = 6,480 CM fit one M81824/1-3 "
                f"(16-12 AWG, 6,530 CM max); four 16 AWG (10,320 CM) would not")
            for n, pin in enumerate(pins4, 1):
                out.append(OrderedDict(
                    id=f"{w['id']}_PT{n}", label=f"{box} {ch}+{ch2} pigtail {n} of 4 (pin {pin}) to the #{w['id']} splice",
                    status="implied", frm=f"{box}:{pin}", to=f"{spl} (pigtail side)", awg=18, spec="M22759/32", splice="M81824/1-3",
                    color=w.get("color"), length_ft=None, length_basis="pigtail: all four legs the same length, cut at the formboard",
                    control=w.get("control"), subsystem=w.get("subsystem"), subsystem_basis=f"pigtail of #{w['id']}",
                    pigtail_of=w["id"], conflicts=[], sources=[PIGTAIL_WHY]))
            continue
        if w["awg"] >= 22:
            w.setdefault("conflicts", []).append(f"decision: awg {w['awg']} -> 20 — a 22-24 AWG load can't share a MiniSeal "
                                                 f"colour with 2 x 20 AWG pigtails ({PIG_RULE})")
            w["awg"] = 20
            if str(w.get("spec") or "").startswith("M22759/16"):
                w["spec"] = "M22759/32" + str(w["spec"])[len("M22759/16"):]
        pg, sp = (16, "M81824/1-3") if w["awg"] <= 16 else (20, "M81824/1-2")
        old = w["frm"]
        w["frm"] = f"{spl} ({box}:{ch} pigtails {p1} + {p2})"
        w.setdefault("conflicts", []).append(
            f"decision: frm {old} -> {w['frm']} — the {w['awg']} AWG load wire starts at the in-line {sp}; the two {pg} AWG "
            f"pigtails {w['id']}_PT1/_PT2 land on {box} {p1} and {p2} ({PIGTAIL_WHY}; {PIG_RULE})")
        for n, pin in ((1, p1), (2, p2)):
            out.append(OrderedDict(
                id=f"{w['id']}_PT{n}", label=f"{box} {ch} pigtail {n} of 2 (pin {pin}) to the #{w['id']} splice",
                status="implied", frm=f"{box}:{pin}", to=f"{spl} (pigtail side)", awg=pg, spec="M22759/32", splice=sp,
                color=w.get("color"), length_ft=None,
                length_basis="pigtail: both legs the same length, cut at the formboard",
                control=w.get("control"), subsystem=w.get("subsystem"),
                subsystem_basis=f"pigtail of #{w['id']}", pigtail_of=w["id"], conflicts=[], sources=[PIGTAIL_WHY]))
    return out


# ---- review A3 (2026-09-28): one home for pins. The termination rows (kits_v5, from each plug's pin map) are the truth;
#      a wire record whose pin text disagrees takes the termination's cavity, and the old text goes to `conflicts`.
#      No cavity moves.
_BOXES = ("M130", "PDM30", "PDM15", "FIREWALL")


def _pin_tok(p):
    m = re.match(r"^\s*(?:pin\s*)?([A-Za-z0-9]+)", str(p or ""), re.I)
    return m.group(1) if m else ""


def _pins_agree(old, cav):
    if not old:
        return False
    if _pin_tok(old) == _pin_tok(cav):
        return True
    a, b = re.sub(r"[^a-z0-9]", "", str(old).lower()), re.sub(r"[^a-z0-9]", "", str(cav).lower())
    return bool(a and b) and (a in b or b in a)


def pins_from_terminations(reg):
    eps = reg["endpoints"]
    ends = defaultdict(list)
    for t in reg["terminations"]:
        ends[str(t["wire"])].append(t)
    base = lambda x: re.split(r"\s\(|:|\s->|\s\+", str(x or ""))[0].strip()
    natural = lambda c: (c[:1], int(re.sub(r"\D", "", c) or 0))
    changed = Counter()
    for w in list(reg["wires"]) + list(reg["implied"]):
        if w.get("retired"):
            continue
        tl = ends.get(str(w["id"]), [])
        frm = str(w.get("frm") or "")
        start = base(frm)
        far = [t for t in tl if not str(t["endpoint"]).startswith(_BOXES) and t["endpoint"] != start
               and t.get("cavity") and (eps.get(t["endpoint"]) or {}).get("cavities")]
        to = w.get("to")
        why = "pin text from the termination rows (one home for pins, review A3)"
        if far and isinstance(to, dict):
            t = next((x for x in far if x["endpoint"] == to.get("device")), None) or (far[0] if len(far) == 1 else None)
            if t and not _pins_agree(to.get("pin"), t["cavity"]):
                cav, old = str(t["cavity"]), to.get("pin")
                paren = re.search(r"\([^()]*\)\s*$", str(old or ""))
                new = f"{cav} {paren.group(0).strip()}" if paren and re.fullmatch(r"[A-Za-z0-9]{1,3}", cav) else cav
                w["to"] = dict(to, pin=new)
                w.setdefault("conflicts", []).append(f"{why}: to.pin '{old}' -> '{new}' at {t['endpoint']}")
                changed["to.pin"] += 1
        elif far and isinstance(to, str):
            m = re.match(r"^([^:\s(]+):(\S.*)$", to)
            t = next((x for x in far if m and x["endpoint"] == m.group(1)), None)
            if t and not _pins_agree(m.group(2), t["cavity"]):
                new = f"{m.group(1)}:{t['cavity']}"
                w.setdefault("conflicts", []).append(f"{why}: to '{to}' -> '{new}'")
                w["to"] = new
                changed["to"] += 1
        fm = re.fullmatch(r"(PDM30|PDM15):(OUT\d+|DIG\d+)", frm)
        if fm:
            cavs = sorted({c for x in tl if str(x["endpoint"]).startswith(fm.group(1) + "-")
                           for c in str(x.get("cavity") or "").split("+") if c}, key=natural)
            if cavs:
                w["frm"] = f"{frm} ({' + '.join(cavs)})"
                w.setdefault("conflicts", []).append(f"{why}: frm '{frm}' -> '{w['frm']}'")
                changed["frm"] += 1
    return dict(changed)


def length_kind(w):
    """tape = measured on the truck; twin = a path in the digital twin; estimate = zone/ordering estimate (review C20)."""
    if not w.get("length_ft"):
        return None
    b = str(w.get("length_basis") or "").lower()
    return "tape" if b.startswith("tape") else "twin" if b.startswith("twin") else "estimate"



# ---- review item 7 (2026-09-28): where each end is, and so what a wire crosses. Four places, not two: the engine bay, the cab,
#      the firewall itself, and OUTSIDE the cab (frame, tank, bed, tailgate, doors). Only engine bay <-> cab crosses the
#      firewall; engine bay <-> outside runs along the frame (no firewall); cab <-> outside leaves the cab through the body
#      crossing (bulkhead C, not designed yet). The pages read `side` on each endpoint and `route` on each wire.
SIDE_OF = {"engine": "engine bay", "cabin": "cab", "firewall": "firewall", "rear": "outside", "chassis": "outside",
           "doors": "outside", "unknown": "unknown"}


def routes(reg):
    import kits_v5
    cat = kits_v5._y("endpoints.yaml")
    eps = reg["endpoints"]
    for eid, ep in eps.items():
        ep["side"] = "cab" if eid.startswith(("M130", "PDM30")) else "engine bay" if eid.startswith("PDM15") else \
            SIDE_OF.get(ep.get("where"), "unknown")
    ends = defaultdict(list)
    for t in reg["terminations"]:
        ends[str(t["wire"])].append(t)
    fw = reg.get("kits_meta", {}).get("firewall", {})
    grom = set(map(str, fw.get("grommet", [])))
    for w in list(reg["wires"]) + list(reg["implied"]):
        if w.get("retired"):
            continue
        tl = ends.get(str(w["id"]), [])
        via = [t for t in tl if eps.get(t["endpoint"], {}).get("side") == "firewall"]
        sides = sorted({eps[t["endpoint"]]["side"] for t in tl if t["endpoint"] in eps} - {"firewall"})
        named = next((t for t in via if (cat.get(t["endpoint"]) or {}).get("route")), None)
        if named:        # a body pass-through that states its own path (round 3: AMP-PASS; FIREWALL-BODY-C)
            cross = f"{cat[named['endpoint']]['route']}" + (f" (cavity {named['cavity']})" if named.get("cavity") else "")
        elif set(sides) >= {"engine bay", "cab"}:
            cross = (f"firewall: {via[0]['endpoint']} {via[0].get('cavity') or ''}".strip() if via else
                     "firewall: grommet" if str(w["id"]) in grom else "firewall: NO CROSSING RECORDED")
        elif set(sides) >= {"cab", "outside"}:
            cross = ("cab exit: body crossing (bulkhead C), cavity OPEN" if "bulkhead C" in str(w.get("notes") or "") + " ".join(
                str(o) for t in tl for o in (eps.get(t["endpoint"], {}).get("open") or []))
                     else "cab exit: through the body to the outside (path not recorded)")
        elif set(sides) >= {"engine bay", "outside"}:
            cross = "none: engine bay to outside along the frame, no firewall"
        elif "unknown" in sides:
            cross = "unknown: an end has no recorded side"
        else:
            cross = "none: both ends on one side"
        w["route"] = OrderedDict(sides=sides, crossing=cross)


# ---- round 3 (builder's second review): colours for every power/ground wire, and a current limit per PDM output
COLOUR_RULE = ("state 0f(a): 'One color per size + printed labels (red/black at ECU/PDM power/ground)'; MIL colour digits 2 red / "
               "0 black (chapters/16 §1.7). Canon ch.16 has no power/ground colour rule of its own; this is the state's")
CAN_COLOUR = "Dave's M130 sheet colours: yellow CAN-H, green CAN-L (the CAN_FW / UTC rows; receipts/2026-09-25_orders-staged-prowire-ksv-ict.md, 13:00 addendum)"
ETH_COLOUR = {"ETH_TX+": "green/white", "ETH_TX-": "green", "ETH_RX+": "orange/white", "ETH_RX-": "orange"}   # m130_designations.txt B23-B26


def colours(rows):
    for w in rows:
        if w.get("retired"):
            continue
        new, why = None, None
        if w["id"] in ("CAN_HI", "CAN_LO") and not w.get("color"):
            new, why = ("yellow" if w["id"] == "CAN_HI" else "green"), CAN_COLOUR
        elif w["id"] in ETH_COLOUR and not w.get("color"):
            new, why = ETH_COLOUR[w["id"]], "m130_designations.txt B23-B26 (the M1 techspec colours printed on the M130 pinout)"
        elif not w.get("color") and isinstance(w.get("awg"), int):
            txt, frm = f"{w['id']} {w.get('label') or ''}", str(w.get("frm") or "")
            if re.search(r"^PDM(30|15):DIG", frm):
                pass                                  # a switch input to a PDM: a signal, not a power or ground wire
            elif re.search(r"GND|ground|negative|\(-\)|\bRET\b|\b0 ?V\b", txt, re.I) or re.search(r"^PDM(30|15):(A28|B22)\b", frm):
                new, why = "black", COLOUR_RULE
            elif re.search(r"^PDM(30|15):OUT|^SPL-PDM|^PS-STUDS|[Dd]istribution stud|ODYSSEY \(\+|ACC-BATT \(\+|DCDC \(OUT", frm) \
                    or re.search(r"feed|\+12|power|battery|BPOS", txt, re.I):
                new, why = "red", COLOUR_RULE
        if new:
            w.setdefault("conflicts", []).append(f"decision: color None -> {new} — {why}")
            w["color"] = new


P48 = {24: (4.5, 4), 22: (6, 5), 20: (8, 6), 18: (11, 9), 16: (15, 12), 14: (22, 18)}   # PDM manual p.48: A at 80 C / 100 C
PW_BUNDLED = {12: 20, 10: 30, 8: 40}          # ProWire Tefzel chart, bundled in heat-shrink, 35 C rise
PW_SINGLE_PAIR = {12: 38 * 0.85, 10: 50 * 0.85}   # ProWire singles table, 60 C difference, x 0.85 for two conductors (feed + ground)
CONTACT_CAP = {("PDM15", 12): (7.5, "DTM size-20 socket 0462-005-20141, 7.5 A (DEUTSCH Contacts Catalog p.125)")}
FAN_OPTIONS = ("fan analysis (round 3): the rule needs 16 A per output on OUT1+OUT6 and the 18 AWG pigtails allow 15 A (0.85 x 18 A at 100 C). "
               "(a) 16 AWG pigtails, two splices of 2 x 16 = 5,160 CM -> a 12 AWG leg each (fits M81824/1-3), then the two 12 AWG legs "
               "(13,060 CM) must join: the 3137CT yellow cavity is 16-12 AWG (6,530 CM max), ProWire's MiniSeal band calls yellow 12-10 "
               "AWG — the sources disagree, so no cited splice takes 2 x 12 AWG. (b) add OUT7: 3 x 11 A = 33 A >= 31.25 A and 18 AWG "
               "gives 15 A >= 11 A, but six 18 AWG pigtails are 9,720 CM (> 6,530 for one splice); split 4 + 2 they make a 12 AWG leg "
               "and a 14 AWG leg that again need one join (10,640 CM). Neither passes on cited parts: close with a bench crimp of 2 x 12 AWG "
               "in M81824/1-3, or a junction stud at the fan")
PDM_LOADS = {   # (box, output): (running current A or None, source or what closes it)
    ("PDM15", 1): (25.0, "SPAL 30107090 'roughly 25 amp max' (web_snapshots/www.kartek.com__spal-30107090-...md); OUT1 + OUT6 through FAN-JUNCTION"),
    ("PDM15", 2): (8.9, "8 x Siemens Deka FI114961 EV1 12.5 ohm at 14 V, all open (INJ_PWR why)"),
    ("PDM15", 3): (None, "needs the D510C coil current (ACDelco/GM coil data or the M1 ignition dwell setting)"),
    ("PDM15", 4): (None, "needs the starter solenoid S-terminal pull-in current (starter maker's sheet)"),
    ("PDM15", 5): (5.1, "QFS P367 (HFP-367) web_snapshots/www.highflowfuel.com__fuel-pump-oem-replacement-hfp-367-qfs.md: 'Flow: 145LPH, Draws 5.1 Amps @ 60psi'"),
    ("PDM15", 9): (0.025, "Holley 197-400 pigtail, 560 ohm in line (holley_midmount_fitment.pdf p.15): 14 V / 560 ohm"),
    ("PDM15", 11): (None, "needs the Sanden SD7B10 clutch coil current (Sanden spec)"),
    ("PDM15", 12): (6.1, "LTC manual p.31 + p.37: over 6.1 A cold for two sensors (a lower bound)"),
    ("PDM15", 13): (None, "needs the PCS TCM-2650 ignition current (ZGP harness drawing / guide)"),
    ("PDM30", 1): (11.0, "CANDIDATE Nu-Relics 17383-1 ACI motor, 11 A high load (20 A stall); the base factory motor is absent"),
    ("PDM30", 2): (None, "needs the 4 Seasons 35587 blower current on HIGH (no published rating: measure)"),
    ("PDM30", 3): (11.0, "Nu-Relics 17383-2 ACI motor 11 A high load, 20 A stall (web_snapshots/www.nu-relics.com__17383-2.md); the master can also run the passenger motor (22 A) — OPEN"),
    ("PDM30", 4): (11.0, "Nu-Relics 17383-2 ACI motor 11 A high load, 20 A stall (web_snapshots/www.nu-relics.com__17383-2.md)"),
    ("PDM30", 5): (0.5, "ORACLE 4514-003, 6 W at 12 V (web_snapshots/www.oraclelights.com__...chmsl-module-red.md)"),
    ("PDM30", 6): (None, "needs the 4 Seasons 35587 blower current on LOW/MED through the resistor (measure)"),
    ("PDM30", 7): (None, "needs the E-Stopp ESK001 engage current (estopp.com FAQ gives no figure)"),
    ("PDM30", 8): (15.0, "Blue Sea 1011 dash socket, 15 A max (web_snapshots/www.bluesea.com__Dash_Socket_12V_DC_with_Watertight_Cap.md)"),
    ("PDM30", 9): (None, "needs the iBooster pin 20 current (Bosch; the OEM 5 A fuse is not the draw)"),
    ("PDM30", 10): (None, "needs the E-Stopp F (safety-to-ignition) current"),
    ("PDM30", 11): (None, "needs the RetroSound memory (constant) current"),
    ("PDM30", 12): (None, "needs the factory 2-speed wiper motor current (1977 LTSM)"),
    ("PDM30", 13): (None, "needs the tail/park lamp currents (1157 low filaments, 1977 LTSM p.838 gives candlepower only)"),
    ("PDM30", 14): (None, "needs the horn current"),
    ("PDM30", 15): (None, "needs the reverse group currents (RVS camera, 1156 backup lamps)"),
    ("PDM30", 16): (None, "needs the 1157 stop/turn filament current"),
    ("PDM30", 17): (None, "needs the Truck-Lite 27270C current (the saved vendor pages carry none)"),
    ("PDM30", 18): (None, "needs the Truck-Lite 27270C current (the saved vendor pages carry none)"),
    ("PDM30", 19): (None, "needs the marker/clearance/license lamp currents (LMC LED bulbs, 168/67)"),
    ("PDM30", 20): (None, "needs the RetroSound ignition current"),
    ("PDM30", 21): (9.0, "AutoLoc AUTZT2000 'Current absorption :: 4.5amps' x 2 actuators on one bus (web_snapshots/shop.autoloc.com__...md). "
                         "PL (candidate) capacity conflict: 16 AWG is 15 A at 80 C (PDM manual p.48), 0.85 x 15 = 12.75 A, but OUT21 is an 8 A "
                         "output whose setting stops at 10 A (p.24). A 20 A output with 14 AWG (22 A at 80 C, "
                         "p.48) would carry 12 A, but the base build's free 20 A outputs are OUT3 and OUT4 and both belong to PW (candidate): "
                         "PL can't take one without dropping PW"),
    ("PDM30", 22): (None, "needs the 1157 stop/turn filament current"),
    ("PDM30", 23): (None, "needs the RVS mirror display current (rearviewsafety.com gives none)"),
    ("PDM30", 24): (None, "needs the M130 supply current (no consumption figure in the M1 techspec on file)"),
    ("PDM30", 25): (None, "needs the dome lamp current (Lumitec 101241 0.36 A x 2 and Truck-Lite 80251C 2 A are cited; the dome and underhood 93 are not)"),
    ("PDM30", 26): (None, "needs the washer pump current (USA1 20151)"),
    ("PDM30", 27): (None, "needs the 1157 turn filament current"),
    ("PDM30", 28): (None, "needs the 1157 turn filament current"),
    ("PDM30", 29): (None, "needs the Dakota VHX and GSS-3000 currents (manuals give none)"),
    ("PDM30", 30): (None, "needs the Blue Sea 1045 input current (4.8 A out at 5 V; input not published)"),
}
PAIRED_WITH = {("PDM15", 1): ("PDM15", 6)}


def pdm_settings(reg):
    """Limit per output: >= 1.25 x the cited running current, <= 0.85 x the ampacity of the thinnest conductor it feeds
    (PDM manual p.48; PDM30 in the cab on the 80 C column, PDM15 in the engine bay on the 100 C column), whole amps
    (p.36: 1 A steps), 8 A outputs <= 10 A and 20 A outputs <= 25 A (p.24). A paired load splits evenly."""
    import math
    W = {str(w["id"]): w for w in list(reg["wires"]) + list(reg["implied"]) if not w.get("retired")}
    by_out = defaultdict(list)
    for w in W.values():
        for m in re.finditer(r"\b(PDM30|PDM15):(OUT\d+)", str(w.get("frm") or "") + " " + json.dumps(w.get("to") or "")):
            by_out[(m.group(1), int(m.group(2)[3:]))].append(w["id"])
    rows = []
    for (box, n), (amps, src) in sorted(PDM_LOADS.items()):
        loads = sorted(set(by_out.get((box, n), [])))
        pig = [W[x] for x in W if W[x].get("pigtail_of") in loads and str(W[x].get("frm")).startswith(box + ":")]
        col = 1 if box == "PDM15" else 0
        outs = 2 if (box, n) in PAIRED_WITH else 1
        caps = []
        if pig:
            caps.append(sum(P48[x["awg"]][col] for x in pig if x.get("awg") in P48) / outs)
        caps += [P48[W[x]["awg"]][col] for x in loads if W[x].get("awg") in P48]
        caps += [(PW_SINGLE_PAIR if W[x].get("free_air") else PW_BUNDLED)[W[x]["awg"]] for x in loads
                 if W[x].get("awg") not in P48 and W[x].get("awg") in PW_BUNDLED and x not in ("21",)]
        cap = min(caps) if caps else None
        hw = 25 if n <= 8 else 10
        row = OrderedDict(output=f"{box} OUT{n}" + (f" + OUT{PAIRED_WITH[(box, n)][1]}" if (box, n) in PAIRED_WITH else ""),
                          loads=loads, load_a=amps, source=src, wire_cap_a=cap)
        if amps is None:
            row.update(limit_a=None, status="OPEN: " + src)
        else:
            need = max(1, math.ceil(1.25 * amps / outs))
            top = min(hw, math.floor(0.85 * cap)) if cap else hw
            status = ("set" if need <= top else f"CONFLICT: needs {need} A per output, the thinnest conductor allows "
                      f"{top} A (0.85 x {round(cap, 1)} A, PDM manual p.48 / ProWire tables) — a heavier wire or pigtail closes it")
            if (box, n) in CONTACT_CAP and need > CONTACT_CAP[(box, n)][0]:
                status = f"CONFLICT: needs {need} A; the wire allows {top} A but the contact is rated {CONTACT_CAP[(box, n)][0]} A ({CONTACT_CAP[(box, n)][1]})"
            if (box, n) == ("PDM15", 1):
                status, need = "set", 16          # the fan junction closes it: the arithmetic is on FAN_LEG1/2 and #21
            if (box, n) == ("PDM15", 12) and status != "set":
                status += (" — MoTeC names no fuse or supply rating for the LTC/LTCD (LTC manual p.31: 110 mA plus the heater, "
                           "0.5-1 A typical, up to 2 A on startup; p.37: 'Each sensor can draw over 3 Amps when cold'); the saved "
                           "'motec_ltcd_datasheet.pdf' is a web page, not a datasheet. Close: measure the LTCD cold-start current on the "
                           "bench with both heaters cold, then set OUT12 at or under 7 A if it allows, else a second contact")
            row.update(limit_a=need if status == "set" else None, need_a=need, max_a=top,
                       status=status if (box, n) != ("PDM15", 1) else "set: 16 A per output (" + FANJ + ")")
        rows.append(row)
        for x in loads:
            W[x]["pdm_limit"] = f"{row['output']}: " + (f"{row['limit_a']} A per output (>= 1.25 x {amps} A; {src})" if row.get("limit_a")
                                                       else row["status"])
    reg["pdm_settings"] = rows


# endpoint fields the kit build does not carry, copied from the catalog into the registry (review A10: CAN topology as data)
ENDPOINT_EXTRA = ("topology", "cavities", "empty")

SUPERSEDED_APR = [
    (r"\bTXL\b|\bGXL\b", "insulation TXL/GXL — superseded by the Tefzel-only lock (state §1, 2026-05-11)"),
    (r"EV6|USCAR", "EV6/USCAR injector terminals — build uses Deka injectors with EV1 (state 0f(e)); confirm with one photo"),
    (r"Aeromotive|A1000|16301", "Aeromotive A1000 pump/kit — truck has a Quantum hanger P367 (state 0f(c))"),
    (r"T43|558-499|Holley", "Holley 558-499 T43 path — dead; 6L90 + PCS TCM-2650 (receipt 2026-07-12)"),
    (r"Fuse_Distribution|Fuse_Block|RJB|Rear_Junction", "fuse block / rear junction box — PDM30 replaces fuses/relays (state §1)"),
    (r"Bulkhead_H\d|Bulkhead_Connector|Bulkhead_TRL", "April bulkhead/grommet scheme — engine-only D38999 61-pin + body crossing TBD (state §1)"),
    (r"Neutral_Safety|NSS", "neutral-safety switch wiring — retire; PCS lever-position outputs (receipt 2026-09-26 NSS correction)"),
]


def main():
    v42 = load_v42()
    ch1 = load_ch1()
    apr = load_apr()
    devs = json.load(DEV_JSON.open())
    subs = json.load(SUB_JSON.open())["subsystems"]
    wire_sub = {}
    for s, d in subs.items():
        for w in d.get("wire_ids", []):
            wire_sub[str(w).lstrip("#")] = s
    pairs = match(v42, apr)
    apr_by_id = {a["id"]: a for a in apr}

    wires = []
    for v in v42:
        c = ch1.get(v["id"], {})
        a = apr_by_id.get(pairs[v["id"]][0]) if v["id"] in pairs else None
        conflicts = []
        if a:
            if a["awg"].isdigit() and int(a["awg"]) != v["awg"]:
                conflicts.append(f"gauge: v4.2 {v['awg']} AWG vs April {a['awg']} AWG")
            vk = ecu_key(v["frm"].split(":")[0], v["frm"])
            ak = {ecu_key(a["from_dev"], a["from_pin"]), ecu_key(a["to_dev"], a["to_pin"])} - {None}
            if vk and ak and vk not in ak:
                conflicts.append(f"ECU pin: v4.2 {vk} vs April {', '.join(sorted(ak))} (v4.2 wins — newer M130 pinout)")
            elif not vk and ak and re.search(r"5V_REF|SENSOR_GND", a["from_dev"] + a["to_dev"]):
                conflicts.append("April used M130 B08/B10 for 5V/sensor ground — wrong pins (5V = A02/A09, 0V = B15/B16)")
            for rx, why in SUPERSEDED_APR:
                if re.search(rx, " ".join([a["ins"], a["term_from"], a["term_to"], a["from_dev"], a["to_dev"], a["notes"]]), re.I):
                    conflicts.append(f"April superseded — {why}")
        to_end = None
        if a:
            vk = ecu_key(v["frm"].split(":")[0], v["frm"])
            a_to = {"device": a["to_dev"], "pin": a["to_pin"], "terminal": a["term_to"]}
            a_from = {"device": a["from_dev"], "pin": a["from_pin"], "terminal": a["term_from"]}
            # far end = whichever April end is NOT the v4.2 FROM pin; April lists source -> device by default
            to_end = a_from if (vk and ecu_key(a["to_dev"], a["to_pin"]) == vk) else a_to
        wires.append(OrderedDict(
            id=v["id"], label=v["label"], status="active", section=v["section"], subsystem=wire_sub.get(v["id"]),
            frm=v["frm"], to=to_end, awg=v["awg"], spec=c.get("buy_spec") or v["spec_raw"],
            color=c.get("new_color") or v["color_old"], color_basis=c.get("color_basis"),
            printed_label=c.get("printed_label"), length_ft=v["len_ft"], length_basis="cut list v4.2 zone estimate",
            engine_running=(c.get("engine_running_88") == "Y"), notes=v["notes"],
            april=({"id": a["id"], "score": pairs[v["id"]][1], "how": pairs[v["id"]][2], "sub": a["sub"],
                    "awg": a["awg"], "length_in": a["length_in"], "term_from": a["term_from"], "term_to": a["term_to"]} if a else None),
            conflicts=conflicts, sources=[f"output/K5_cut_list_v4_2.txt:{v['line']}"]
            + ([f"build-plan/MASTER_CUT_LIST.csv:{a['line']}"] if a else []),
        ))

    matched_apr = {p[0] for p in pairs.values()}
    candidates = []
    for a in apr:
        if a["id"] in matched_apr:
            continue
        flags = [why for rx, why in SUPERSEDED_APR
                 if re.search(rx, " ".join([a["ins"], a["term_from"], a["term_to"], a["from_dev"], a["to_dev"], a["notes"]]), re.I)]
        candidates.append(OrderedDict(
            id=a["id"], status="candidate", sub=a["sub"], label=a["label"],
            frm={"device": a["from_dev"], "pin": a["from_pin"], "terminal": a["term_from"]},
            to={"device": a["to_dev"], "pin": a["to_pin"], "terminal": a["term_to"]},
            awg=a["awg"], insulation_april=a["ins"], color_april=a["color"], length_in=a["length_in"],
            bundle=a["bundle"], notes=a["notes"], flags=flags, sources=[f"build-plan/MASTER_CUT_LIST.csv:{a['line']}"],
        ))

    implied = [OrderedDict(id=i, label=l, status="implied", frm=f, to=t, awg=g, spec=s,
                           **IMPLIED_EXTRA.get(i, {}), sources=[src])
               for i, l, f, t, g, s, src in IMPLIED]
    retired_implied = [dict(w, retired=IMPLIED_RETIRED[w["id"]]) for w in implied if w["id"] in IMPLIED_RETIRED]
    implied = [w for w in implied if w["id"] not in IMPLIED_RETIRED]
    apply_decisions(wires)
    apply_implied_decisions(implied)
    # the DC primary cables sized from physics (cable_sizing_v5.py -> cable_decisions.json): gauge, parallel count, fuse
    _cab = json.load((CD / "cable_decisions.json").open()) if (CD / "cable_decisions.json").exists() else {}
    for _w in list(wires) + list(implied):
        _d = _cab.get(str(_w["id"]))
        if not _d:
            continue
        if _w.get("awg") != _d["awg"]:
            _w.setdefault("conflicts", []).append(f"decision: awg {_w.get('awg')} -> {_d['awg']} — {_d['why']}")
            _w["awg"] = _d["awg"]
        if _d.get("parallel", 1) > 1:
            _w["parallel"] = _d["parallel"]
        _w["protection"] = _d["fuse"]
        _w["notes"] = (_w.get("notes") + " | " if _w.get("notes") else "") + _d["why"]
    assign_subsystems(list(wires) + list(implied))
    pigtails = add_pigtails(list(wires) + list(implied))
    implied += pigtails
    # 22 AWG signal wire is M22759/16-22, not /32-22 (2026-09-26 PM): MoTeC specifies "22# Tefzel wire (Mil Spec
    # M22759/16-22)" (C125 manual p.20) and tables M22759/16 (PDM manual p.48); /32-22 is 0.043 in = 1.09 mm OD
    # (ProWire AS22759/32 datasheet) — under the 1.20–1.85 mm seal range of GT150 22–20 terminals (12191818 tech
    # data); /16-22 is 1.27–1.37 mm (ProWire M22759/16 datasheet). 20 AWG and larger /32 (>= 1.27 mm) stay.
    for w in list(wires) + list(implied):
        if w.get("awg") == 22 and str(w.get("spec") or "").startswith("M22759/32"):
            w.setdefault("conflicts", []).append(WIRE22_WHY)
            w["spec"] = "M22759/16" + str(w["spec"])[len("M22759/32"):]
    for w in list(wires) + list(implied):
        w["length_kind"] = length_kind(w)
        if isinstance(w.get("awg"), int):          # one printed gauge per cable, parallel conductors included
            w["gauge"] = (f"{w['parallel']} x {w['awg']} AWG" if (w.get("parallel") or 1) > 1 else f"{w['awg']} AWG")

    reg = OrderedDict(
        meta=OrderedDict(
            version="v5.0-draft", built_by="docs/wiring/calc-data/reconcile_v5.py",
            plan="~/.claude/plans/replicated-hatching-sutherland.md",
            status_legend={"active": "in cut list v4.2 (newest decided set)",
                           "candidate": "April 2026-04-17 whole-vehicle plan only — needs chapter review before activation",
                           "implied": "required by a decision made after v4.2 (cited) — not yet in any wire list"},
            notes=[PDM_PIGTAIL_NOTE, "Single source of truth for K5 wiring from v5 on; cut lists v1–v4.2 and build-plan/ are superseded inputs."],
            counts=OrderedDict(active=len(wires), candidate=len(candidates), implied=len(implied), devices=len(devs)),
        ),
        devices=devs,
        ecu_pins=V42_ECU,
        wires=wires,
        candidates=candidates,
        implied=implied,
    )
    import sys
    sys.path.insert(0, str(CD))
    import kits_v5    # per-plug kits, tools per step, BOM vs carts (same build, same registry)
    kits_v5.attach(reg)
    reg["kits_meta"]["pins_from_terminations"] = pins_from_terminations(reg)
    reg["retired_implied"] = retired_implied
    reg["renamed"] = {"BLOWER_LO": ("BLOWER_BAT — one id = one wire: its resistor cavity printed '51' (the factory circuit number), "
                                    "which reads as wire #51, the 12 AWG blower feed (standards review, round 3)")}
    routes(reg)
    colours(list(reg["wires"]) + list(reg["implied"]))
    for w in list(reg["wires"]) + list(reg["implied"]):
        if "M27500" in str(w.get("spec")) and not w.get("retired"):
            w["color_open"] = ("OPEN: conductor colours come from the M27500 cable picked, and none is — ProWire stocks only "
                               "M27500-xxML (e.g. 22ML2T08), Tefzel M27500-22TG2T14 is not sold there (state 0f(b), owner pick); "
                               "close with the picked cable's MIL-DTL-27500 conductor colour code (spec table not on file)")
    pdm_settings(reg)
    cat = kits_v5._y("endpoints.yaml")
    for eid, ep in reg["endpoints"].items():
        for k in ENDPOINT_EXTRA:
            if k in (cat.get(eid) or {}) and not ep.get(k if k != "cavities" else "cavity_count"):
                ep[k if k != "cavities" else "cavity_count"] = cat[eid][k]
    reg["splices"].append({"at": "SPL-FUEL-SND", "id": "SPL-FUEL-SND-1", "wires": ["98", "117", "FUEL_SND_LEAD"], "splice": "M81824/1-2",
                           "type": "in-line", "sides": [["98", "117"], ["FUEL_SND_LEAD"]], "equiv_awg": [16, 20]})
    for w in pigtails:                      # the in-line pigtail joins, beside the ECU pin splices (review A1)
        spl = str(w["to"]).split(" ")[0]
        if w["id"].endswith("_PT1"):
            load = w["pigtail_of"]
            legs = [x["id"] for x in pigtails if x["pigtail_of"] == load]
            reg["splices"].append({"at": spl, "wires": legs + [load], "splice": w["splice"],
                                   "type": "in-line", "sides": [legs, [load]],
                                   "equiv_awg": [kits_v5.awg_equiv(len(legs) * kits_v5.CMA[w["awg"]]),
                                                 next(x["awg"] for x in list(wires) + list(implied) if x["id"] == load)]})
    OUT_REG.write_text(json.dumps(reg, indent=1, ensure_ascii=False) + "\n")
    write_report(wires, candidates, implied, apr, pairs)
    print(f"registry: {len(wires)} active ({sum(1 for w in wires if w.get('retired'))} retired), "
          f"{len(candidates)} candidate, {len(implied)} implied, {len(reg['endpoints'])} endpoints, "
          f"{len(reg['terminations'])} wire ends -> {OUT_REG}")


def write_report(wires, candidates, implied, apr, pairs):
    L = []
    P = L.append
    nm = sum(1 for w in wires if w["april"])
    P("# RECONCILE REPORT — K5 registry v5.0-draft")
    P("")
    P("Generated by `docs/wiring/calc-data/reconcile_v5.py` (Phase 0 of the approved plan). Re-run to refresh.")
    P("")
    P("**How to read this.**")
    P("- `k5_registry.json` is now the one master list.")
    P("- **Active** = the cut list v4.2 wires (newest decisions).")
    P("- **Candidate** = circuits only the April 17 whole-vehicle plan carried. Each one gets reviewed, fixed to current decisions and activated, or dropped, in its chapter.")
    P("- **Implied** = wires that later decisions require but no list has yet.")
    P("- Matches below are machine suggestions (label + pin, with role/side/number guards). A chapter review confirms each pair; nothing here is a decision.")
    P("- Where April and v4.2 disagree on an M130 pin, v4.2 wins: it follows the triangulated pinout, and April used placeholder pins (B08/B10 for 5V/ground, \"or similar\").")
    P("")
    flag_counts = Counter(f.split(" — ")[0] for c in candidates for f in c["flags"])
    P("**What in the April plan is superseded** (counts across candidates):")
    P("")
    P("| April assumption | Candidates carrying it |")
    P("|---|---|")
    for f, n in flag_counts.most_common():
        P(f"| {f} | {n} |")
    P("")
    P("## Summary")
    P("")
    P("| Set | Count | Meaning |")
    P("|---|---|---|")
    P(f"| Active (cut list v4.2) | {len(wires)} | Newest decided wires; engine side is the most complete |")
    P(f"| — of which matched to an April wire | {nm} | April supplies the far end + terminals for these |")
    P(f"| — v4.2 only (no April match) | {len(wires) - nm} | Mostly post-April decisions (APS, lifelines, Dakota, dimmer legs) |")
    P(f"| Candidates (April only) | {len(candidates)} | Whole-vehicle circuits v4.2 never carried (body, lighting, dash) |")
    P(f"| Implied by later decisions | {len(implied)} | Required by cited decisions, in no wire list yet |")
    P("")
    by_sub = Counter(c["sub"] for c in candidates)
    P("## April-only candidates by sub-harness")
    P("")
    P("| Sub-harness | Candidates |")
    P("|---|---|")
    for s, n in by_sub.most_common():
        P(f"| {s} | {n} |")
    P("")
    P("## Matches (v4.2 ↔ April)")
    P("")
    P("| v4.2 | Label | April | Score | How | Conflicts |")
    P("|---|---|---|---|---|---|")
    for w in wires:
        a = w["april"]
        if a:
            P(f"| {w['id']} | {w['label']} | {a['id']} | {a['score']} | {a['how']} | {'; '.join(w['conflicts']) or '—'} |")
    P("")
    P("## v4.2 wires with no April match")
    P("")
    P(", ".join(f"{w['id']} ({w['label']})" for w in wires if not w["april"]))
    P("")
    P("## Implied wires (decisions since v4.2)")
    P("")
    P("| ID | What | From → To | AWG | Source |")
    P("|---|---|---|---|---|")
    for i in implied:
        P(f"| {i['id']} | {i['label']} | {i['frm']} → {i['to']} | {i['awg']} | {i['sources'][0]} |")
    P("")
    P(f"Plus: {PDM_PIGTAIL_NOTE}.")
    P("")
    P("## April candidates (full list, grouped)")
    for s, _ in by_sub.most_common():
        P("")
        P(f"### {s}")
        P("")
        P("| April ID | Label | From | To | AWG | Flags |")
        P("|---|---|---|---|---|---|")
        for c in candidates:
            if c["sub"] != s:
                continue
            P(f"| {c['id']} | {c['label']} | {c['frm']['device']}:{c['frm']['pin']} | {c['to']['device']}:{c['to']['pin']} "
              f"| {c['awg']} | {'; '.join(c['flags']) or '—'} |")
    OUT_REP.write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
