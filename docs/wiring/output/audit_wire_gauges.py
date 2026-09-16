#!/usr/bin/env python3
"""
Derive correct wire gauge for every wire in K5_cut_list_v2.txt per chapter 6 doctrine:
  gauge from amperage + length + 3% Vdrop max + 25% safety margin.

Outputs a table comparing current spec vs derived gauge, flags over/under-sized.
"""
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent
CUT_LIST = ROOT / "K5_cut_list_v2.txt"

# AWG resistance (Ω per 1000 ft @ 20°C, copper)
AWG_OHMS_PER_KFT = {
    24: 25.67, 22: 16.14, 20: 10.15, 18: 6.385, 16: 4.016,
    14: 2.525, 12: 1.588, 10: 0.9989, 8: 0.6282, 6: 0.3951,
    4: 0.2485, 2: 0.1563, 1: 0.1239, 0: 0.0983
}

# Continuous-ampacity (single conductor in bundle, 105°C insulation, per NEC/SAE J1128)
AWG_AMPACITY = {
    24: 2.1, 22: 3.0, 20: 5.0, 18: 7.5, 16: 10, 14: 15, 12: 20,
    10: 30, 8: 50, 6: 65, 4: 95, 2: 130, 1: 150, 0: 190
}

VDROP_PCT = 0.03    # 3% max per chapter 6
SYSTEM_V = 13.5     # nominal alt voltage
SAFETY_MARGIN = 1.25  # 25% per chapter 6

# Per-device peak current (A) — from substrate citations or industry typicals
# Wires keyed by label pattern (regex, case-insensitive match)
CURRENT_MAP = [
    # ── ECU CONTROL / SIGNAL WIRES (essentially no current) ──
    (r"ETB TAC Motor",          2.5,    "Throttle motor pulses, 90mm ETB GM 12605109 typical"),
    (r"ETB TPS",                0.005,  "TPS analog signal, 5V × 1MΩ load = µA"),
    (r"ETB 5V Reference",       0.030,  "5V ref shared, ~30mA"),
    (r"ETB Signal Ground",      0.030,  "Same as 5V return"),
    (r"Ignition Coil",          0.5,    "Logic coil drive — IGBT gate + pull-in, ~500mA peak per D510C"),
    (r"Fuel Injector",          0.83,   "LS3 saturated injector ~14.5Ω, I=12V/14.5=0.83A peak (no peak/hold)"),
    (r"Crank Position",         0.020,  "Hall effect 58X CKP, ~20mA at +5V"),
    (r"Cam Position",           0.020,  "Hall effect CMP, ~20mA at +5V"),
    (r"Knock Sensor",           0.001,  "Piezoelectric, µA"),
    (r"MAP Sensor",             0.020,  "Bosch 3-pin sensor, ~20mA"),
    (r"\bIAT\b|Intake Air Temp",    0.005,  "NTC thermistor + 1k pullup, ~5mA"),
    (r"Coolant Temp",           0.005,  "Same as IAT"),
    (r"Oil Pressure",           0.020,  "Analog 3-wire sensor"),
    (r"Oil Temp",               0.005,  "Thermistor"),
    (r"Fuel Pressure",          0.020,  "Analog 3-wire"),
    (r"Wideband.*Lambda|Wideband O2",  0.5,  "LTCD controller power"),

    # ── INPUT SWITCHES (essentially no current — pull-up signal) ──
    (r"Turn Signal Switch",     0.005, "Switch sinking PDM input via 10kΩ pullup"),
    (r"Headlight Switch",       0.005, ""),
    (r"Wiper.Washer Switch",    0.005, ""),
    (r"Brake Light Switch",     0.005, ""),
    (r"Window Switch",          0.005, ""),
    (r"Door Switch",            0.005, ""),
    (r"Lock Switch",            0.005, ""),
    (r"Blower Speed",           0.005, ""),
    (r"Ignition Switch",        0.005, ""),
    (r"Hazard Flasher",         0.005, "Trigger signal"),
    (r"Reverse Light Switch",   0.005, ""),
    (r"Neutral Safety",         0.005, ""),
    (r"Transfer Case Indicator", 0.005, ""),

    # ── PDM-CONTROLLED LOADS (real current) ──
    (r"Horn",                   8.0,   "Twin-horn typical 4-8A each"),
    (r"Windshield Wiper Motor", 5.0,   "Continuous ~4A, peak 15A — use 5A continuous baseline"),
    (r"Washer Pump",            2.0,   "Typical washer pump"),
    (r"Electric Parking Brake|E-Stopp",  5.0, "E-Stopp ESK001"),
    (r"Tail Light",             0.8,   "United Pacific CTL7387LED, ~0.8A per side"),
    (r"Backup Light",           0.8,   "LED reverse, ~0.8A"),
    (r"Third Brake Light",      0.5,   "Center high-mount LED"),
    (r"Side Marker",            0.3,   "LED marker, ~0.3A each"),
    (r"Cab Clearance Light",    0.3,   "LED, ~0.3A"),
    (r"License Plate Light",    0.3,   "LED"),
    (r"Turn Signal.*Front|Turn Signal.*Right Front|Turn Signal.*Left Front", 0.5, "LED turn ~0.5A"),
    (r"Parking Light",          0.3,   "LED parking ~0.3A"),
    (r"LED Headlight",          3.0,   "Truck-Lite 27270C ~3A high+low combined"),
    (r"Dome Light|Under-Dash LED|Footwell|Underhood Light|Cargo.Bed Light", 0.5, "LED interior ~0.5A each"),
    (r"USB Charging Port",      2.0,   "USB-C PD low-end"),
    (r"Dakota Digital",         0.5,   "Cluster typical"),
    (r"Display/Dash",           0.5,   ""),
    (r"Cigarette Lighter|12V Outlet", 10.0, "Lighter/12V accessory rated 10-15A"),

    # ── MOTORS — use CONTINUOUS running current, not peak/inrush.
    # SAE J1128 ampacity is rated continuous; inrush is brief and handled by margin.
    # Intermittent-duty loads (<1 min per 10 min) can use next-smaller gauge per J1128.
    (r"Radiator Fan",           15.0,  "Spal 14\" fan continuous when on (continuous duty)"),
    (r"Electric Water Pump",    12.0,  "Bosch/Pierburg continuous duty"),
    (r"Heater Blower",          13.0,  "Aftermarket blower running current ~13A continuous (NOT 20A peak/inrush). Continuous duty."),
    (r"Power Window Motor",     5.0,   "Nu-Relics running ~5A; intermittent (~3s per cycle) — wire ampacity dominates"),
    (r"Power Lock Actuator",    3.0,   "Dorman 746-014 momentary (<1s) — intermittent, wire ampacity allows derate"),
    (r"AMP Research Step",      4.0,   "PowerStep motor ~4A during deploy (~2s) — intermittent"),
    (r"AMP Research Controller", 0.5,  "Controller signal"),

    # ── DIRECT-WIRED HIGH-CURRENT (NOT on PDM). Order matters: relays/coils before main loads ──
    (r"Fuel Pump Relay",        0.2,   "Relay coil"),
    (r"Fuel Pump",              35.0,  "Aeromotive A1000 35A peak per appendix-d"),
    (r"iBooster Relay|Bosch iBooster Relay",  0.2,  "Relay coil"),
    (r"Bosch.*iBooster|iBooster", 40.0, "iBooster 40A peak per appendix-d"),
    (r"Amplifier(?!\sRelay)",   30.0,  "Kicker amp ~30A per appendix-d. amplifier relay is signal"),
    (r"Amplifier Relay",        0.2,   "Relay coil"),
    (r"Alternator",             220.0, "Mechman 220A output (8 AWG works because it's PEAK; sustained <100A)"),
    (r"Starter Motor",          200.0, "Peak cranking ~200A momentary"),
    (r"Battery Disconnect",     190.0, "Master cut, all alternator+accessory current"),
    (r"Bosch V4 Electric Brake Booste", 40.0, "iBooster (same as iBooster Relay)"),

    # ── SPEAKERS (audio amp output, not power) ──
    (r"Speaker.*Front",         5.0,   "100W per channel typical, 8Ω → 3.5A RMS"),
    (r"Speaker.*Rear",          5.0,   ""),
    (r"Subwoofer",              15.0,  "300W to 4Ω sub → 8.7A RMS"),
    (r"Radio/Head Unit",        2.0,   "Head unit power"),

    # ── COMMS / LOW POWER ──
    (r"CAN Bus",                0.020, "Differential pair, transceivers µA"),
    (r"Vehicle Speed Sensor",   0.020, "Hall VSS"),
    (r"Wideband O2 Sensor",     2.0,   "Heater current via LTCD, 2A heater typical"),
    (r"Fuel Pump Relay",        0.2,   "Relay coil"),
    (r"A/C Compressor Clutch",  4.0,   "Clutch coil typical"),
    (r"A/C Pressure Switch",    0.005, "Switch signal"),
    (r"Fuel Level Sender",      0.020, "Resistive sender + pullup"),
    (r"ECU",                    1.0,   "ECU power total (vague entry, low)"),
    (r"Power Distribution Module", 0.5, "PDM control signal"),
    (r"Transmission Controller", 1.0,  "T43 TCM power"),
    (r"Rear Backup Camera",     0.3,   "USB-style camera"),
    (r"Firewall grommet",       0.0,   "Pass-through, not a load"),

    # ── BUS RAILS ──
    (r"Injector \+12V Rail",    8.0,   "8 injectors × 0.83A peak = 6.6A; simultaneous fire ~50% = 3.3A; use 8A conservative"),
    (r"Coil \+12V Rail",        8.0,   "8 coils × 0.5A peak; not all simultaneous"),
    (r"Coil Ground Rail",       8.0,   "Same as power rail"),
]

GAUGE_PARSE = re.compile(r"(\d+)\s+AWG")

def lookup_current(label):
    for pattern, current, note in CURRENT_MAP:
        if re.search(pattern, label, re.IGNORECASE):
            return current, note
    return None, None

def derive_gauge(current_a, length_ft, vdrop_pct=VDROP_PCT, sys_v=SYSTEM_V):
    """Return smallest AWG that satisfies both ampacity (with margin) and Vdrop."""
    if current_a <= 0:
        return 22, "no current → minimum signal-wire gauge"
    vdrop_max = sys_v * vdrop_pct
    r_max = vdrop_max / current_a / (length_ft / 1000)  # Ω/1000ft max
    # Find smallest AWG (highest number) whose R/kft ≤ r_max AND ampacity ≥ current × SAFETY_MARGIN
    needed_ampacity = current_a * SAFETY_MARGIN
    candidates = []
    for awg in sorted(AWG_OHMS_PER_KFT.keys(), reverse=True):  # 24 → 0
        r_kft = AWG_OHMS_PER_KFT[awg]
        ampacity = AWG_AMPACITY[awg]
        if r_kft <= r_max and ampacity >= needed_ampacity:
            return awg, f"I={current_a}A, L={length_ft:.1f}ft, R={r_kft:.2f}Ω/kft, drop={current_a*r_kft*length_ft/1000:.2f}V"
    return 0, "exceeds 0 AWG capacity"

# Parse cut list (reusing logic from earlier)
gap_pat = re.compile(r"\s{2,}")
len_pat = re.compile(r"^([\d.]+)ft$")
section_pat = re.compile(r">>\s+(.+?)\s+\(")

def parse_cut_list():
    wires = []
    current_section = None
    for line in CUT_LIST.read_text().splitlines():
        sec = section_pat.search(line)
        if sec:
            current_section = sec.group(1).strip()
            continue
        if not line.startswith("#") or line.startswith("# ") or line.startswith("#    LABEL"):
            continue
        body = re.sub(r"(\S)\s(\d+\.\d+ft)", r"\1  \2", line[1:].rstrip())
        parts = gap_pat.split(body)
        length_idx = None
        for i in range(1, len(parts)):
            m = len_pat.match(parts[i].strip())
            if m and i >= 4:
                length_idx = i
                length = float(m.group(1))
                break
        if length_idx is None:
            continue
        head = parts[0].strip()
        sp = head.find(" ")
        if sp > 0:
            wid, label_prefix = head[:sp], head[sp+1:].strip()
        else:
            wid, label_prefix = head, ""
        label_rest = " ".join(parts[1:length_idx - 3]).strip()
        label = (label_prefix + " " + label_rest).strip() if label_prefix else label_rest
        spec = parts[length_idx - 2].strip()
        m = GAUGE_PARSE.match(spec)
        gauge = int(m.group(1)) if m else 0
        wires.append({"id": wid, "section": current_section, "label": label, "gauge": gauge, "length": length, "spec": spec})
    return wires

if __name__ == "__main__":
    wires = parse_cut_list()
    print(f"Audited {len(wires)} wires from K5_cut_list_v2.txt\n")
    print(f"{'ID':<5} {'SECTION':<22} {'LABEL':<32} {'CUR':<7} {'LEN':<5} {'CURR':<5} {'DRVD':<5} {'STATUS'}")
    print("-" * 130)

    oversized = []
    undersized = []
    no_match = []
    correct = []
    total_oversize_ft = defaultdict(float)  # (current, derived) → ft

    for w in wires:
        I, note = lookup_current(w["label"])
        if I is None:
            no_match.append(w)
            print(f"{w['id']:<5} {w['section'][:22]:<22} {w['label'][:32]:<32} {w['gauge']:<3}AWG {w['length']:<5} ----  ----  NO MATCH")
            continue
        derived, calc = derive_gauge(I, w["length"])
        diff = derived - w["gauge"]
        status = "OK"
        if diff >= 2:
            status = f"OVER (-{diff}g)"
            oversized.append((w, I, derived, calc))
            total_oversize_ft[(w['gauge'], derived)] += w['length']
        elif diff <= -1:
            status = f"UNDER (+{-diff}g)"
            undersized.append((w, I, derived, calc))
        else:
            correct.append(w)
        print(f"{w['id']:<5} {w['section'][:22]:<22} {w['label'][:32]:<32} {w['gauge']:<3}AWG {w['length']:<5.1f} {I:<5}A  {derived:<5}AWG  {status}")

    print()
    print(f"Summary: {len(correct)} correct  ·  {len(oversized)} oversized (≥2 gauges)  ·  {len(undersized)} undersized  ·  {len(no_match)} no-match (need current data)")
    print()
    print("Oversize hotspots (ft of wire that could downsize):")
    for (cur_g, drvd_g), ft in sorted(total_oversize_ft.items(), key=lambda x: -x[1])[:8]:
        print(f"  {cur_g} AWG → {drvd_g} AWG: {ft:.1f} ft")
