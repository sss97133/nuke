#!/usr/bin/env python3
"""World position (twin axes: +x driver, -y front, +z up, metres; front axle y=-1.896, rear axle y=0.807) for every end,
with the basis for the number. Engine points come from the twin v3 engine anchors (K5H_E3_Anchors, built on the
LS3 envelope); body points from the TurboSquid 1978 Blazer body (scaled to the 2,703 mm wheelbase); the rest are
placed from the sourced spot in ends.py and say so. Nothing here is tape-measured."""
import importlib.util, json, os

D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ends", os.path.join(D, "ends.py"))
ends = importlib.util.module_from_spec(spec); spec.loader.exec_module(ends)
AN = {k: v for k, v in json.load(open(os.path.join(D, "anchors.json"))).items()}

P = {}
CAT = {}


def put(code, xyz, basis, cat):
    P[code] = {"xyz": [round(float(c), 3) for c in xyz], "basis": basis, "cat": cat}


A = "twin v3 engine anchor"
B = "1978 Blazer body model"
S = "placed from the sourced spot"
C = "candidate spot (not decided)"

# ---- engine, from the v3 anchors
put("CKP", AN["ANCHOR_crank"], A, "sensor")
put("CMP", AN["ANCHOR_cam"], A, "sensor")
put("KNOCK-1", AN["ANCHOR_knock_L"], A, "sensor")
put("KNOCK-2", AN["ANCHOR_knock_R"], A, "sensor")
put("CLT-ECU", AN["ANCHOR_coolant_temp"], A, "sensor")
x, y, z = AN["ANCHOR_coolant_temp"]; put("DAK-CTS", (-x, -1.44, z), S + " (rear of the passenger head)", "sensor")
put("OILP-ECU", AN["ANCHOR_oil_psi"], A, "sensor")
x, y, z = AN["ANCHOR_oil_psi"]; put("DAK-OILP", (x + 0.05, y + 0.03, z), C + " (a tee at the oil pressure port)", "sensor")
put("OILT", (-0.17, -1.67, 0.62), S + " (2024-08-24 photo: passenger side of the pan, just behind and below the right knock sensor at y -1.705; +/-50 mm)", "sensor")
put("MAP", (0.14, -1.50, 1.16), S + " (on a bracket near the rear of the intake)", "sensor")
put("IAT", (0.0, -2.02, 1.24), S + " (in the inlet tube ahead of the throttle body)", "sensor")
put("TB", AN["ANCHOR_tps"], A, "actuator")
for i in range(1, 9):
    put("INJ-%d" % i, AN["ANCHOR_inj_%d" % i], A, "actuator")
    put("COIL-%d" % i, AN["ANCHOR_coil_%d" % i], A, "actuator")
put("FUELP", (0.0, -1.40, 1.12), C + " (rail or regulator port)", "sensor")
put("COIL-GROUND-RINGS", (0.0, -1.42, 1.02), S + " (back of the heads)", "power")
put("ALTERNATOR-SENSE", AN["ANCHOR_alternator"], A, "power")
put("STARTER-S", AN["ANCHOR_starter"], A, "power")
put("AC-CLUTCH", (-0.26, -2.10, 0.80), S + " (Holley's A/C bracket is the passenger side; the twin anchor has it on the driver side)", "actuator")
put("AC-HP-SW", (-0.55, -2.30, 1.00), C + " (liquid line, not plumbed)", "sensor")
put("AC-LP-SW", (-0.62, -1.75, 1.05), C + " (accumulator, not placed)", "sensor")
put("FAN", (0.0, -2.36, 0.95), B + " (radiator core)", "actuator")
put("IBOOSTER", (0.40, -1.52, 1.05), S + " (driver firewall; twin object K5H_iBooster)", "actuator")
put("IBST-DIAG", (0.55, -1.56, 1.14), C, "connector")
put("BRAKE-FLUID-LVL", (0.40, -1.62, 1.18), S + " (in the booster's reservoir)", "sensor")
put("WIDEBAND", AN["ANCHOR_ltcd_candidate_B"], A + " (LTCD candidate B)", "module")
put("HORN", (0.55, -2.50, 0.90), S + " (radiator support; which side is not read)", "actuator")
put("WIPER-MOTOR", (0.0, -1.47, 1.30), S + " (factory wiper hole, under the cowl)", "actuator")
put("WASHER-PUMP", (0.72, -2.15, 1.00), C + " (driver inner fender)", "actuator")
put("BLOWER-MOTOR", (-0.55, -1.56, 1.10), S + " (Four-Season case, passenger firewall)", "actuator")
put("BLOWER-RES", (-0.42, -1.52, 1.18), S + " (on the Four-Season case)", "actuator")
put("UNDERHOOD-LAMP", (0.0, -2.00, 1.30), C + " (under the hood)", "lamp")
put("HEADLIGHT-L", (0.789, -2.52, 1.05), "body model mesh Headlights, bucket centre +/-15 mm", "lamp")
put("HEADLIGHT-R", (-0.789, -2.52, 1.05), "body model mesh Headlights, bucket centre +/-15 mm", "lamp")
put("PARK-TURN-LF", (0.788, -2.555, 0.853), "body model mesh park/turn lamp, centre +/-15 mm", "lamp")
put("PARK-TURN-RF", (-0.788, -2.555, 0.853), "body model mesh park/turn lamp, centre +/-15 mm", "lamp")
put("MARKER-LF", (0.986, -2.386, 0.92), B, "lamp")
put("MARKER-RF", (-0.986, -2.386, 0.92), B, "lamp")

# ---- power: candidate B = GM's own battery spots (LTSM p.122: "battery (right side or auxiliary left side)",
#      "battery tray ... fasten to radiator support"). The working position (passenger firewall corner) sits where the
#      retained Four-Season box mounts, so it is shown as the other candidate in the page text.
FB_ = "candidate: GM's battery tray spot (1977 manual p.122)"
put("ODYSSEY", (-0.62, -2.26, 0.95), FB_ + ", right side at the radiator support", "power")
put("ACC-BATT", (0.62, -2.26, 0.95), FB_ + ", the auxiliary left-side spot", "power")
put("ISOLATOR", (-0.50, -2.18, 1.06), S + " (on the Odyssey positive)", "power")
put("PS-STUDS", (-0.50, -2.04, 1.02), C + " (the distribution stud behind the Odyssey)", "power")
put("GND-BANK-ENG", (-0.68, -2.04, 0.86), C + " (beside the batteries)", "power")
put("DCDC", (0.66, -2.00, 1.06), C + " (driver inner fender behind the YellowTop it charges: flagged, Victron says keep it dry)", "power")
put("PDM15-A", (-0.68, -1.90, 1.02), C + " (engine power box on the passenger inner fender, by the batteries)", "module")
# ---- firewall
put("FIREWALL-ENGINE", (0.50, -1.49, 0.90), S + " (fuse-box hole, engine side)", "connector")
put("FIREWALL-CABIN", (0.50, -1.43, 0.90), S + " (fuse-box hole, cab side)", "connector")
put("FIREWALL-GROMMET", (-0.35, -1.46, 0.92), C + " (factory hole H3, passenger side: the big-cable exception)", "connector")

# ---- cab
put("M130-A", (0.30, -1.40, 0.95), C + " (cab face of the firewall, inboard of the 61-pin)", "module")
put("PDM30-A", (0.10, -1.38, 0.88), C + " (beside the M130, air gap between them)", "module")
put("APS", (0.30, -1.36, 0.82), S + " (driver footwell)", "sensor")
put("BRAKE-SW", (0.44, -1.30, 0.98), S + " (brake pedal bracket)", "switch")
put("FLOOR-DIMMER", (0.66, -1.26, 0.68), S + " (floor, driver's left foot)", "switch")
put("HL-SW", (0.74, -1.02, 1.18), S + " (instrument panel, left of the cluster)", "switch")
put("WIPER-SW", (0.70, -1.02, 1.12), S + " (instrument panel)", "switch")
put("TURN-SW", (0.465, -0.95, 1.27), B + " (in the column under the wheel)", "switch")
put("HORN-SW", (0.465, -0.78, 1.34), B + " (wheel centre)", "switch")
put("IGN-SWITCH", (0.465, -1.24, 1.06), S + " (top of the column jacket, near the front of the dash)", "switch")
put("BLOWER-SW", (0.10, -1.03, 1.22), S + " (control head)", "switch")
put("RADIO", (0.0, -1.03, 1.12), S + " (factory radio opening)", "module")
put("DAKOTA-VHX", (0.60, -1.16, 1.00), S + " (driver side under the dash, within 3 ft of the cluster)", "module")
put("GSS-3000", (0.20, -1.16, 0.96), S + " (under the dash)", "module")
put("PCS-TCM", (-0.30, -1.16, 0.92), C + " (under the dash, passenger side)", "module")
put("PCS-HARNESS-4610", (-0.20, -1.20, 0.85), C, "connector")
put("MIRROR-MON", (0.0, -0.95, 1.78), B + " (windshield header)", "module")
put("OUTLET-12V", (-0.06, -0.92, 0.95), C + " (dash or console)", "power")
put("USB-PORT", (0.06, -0.92, 0.95), C + " (dash or console)", "power")
put("ISO-SWITCH", (0.28, -1.03, 1.05), C + " (dash)", "switch")
put("TG-SW-DASH", (0.38, -1.03, 1.02), S + " (instrument panel)", "switch")
put("TG-SW-MASTER", (0.44, -1.03, 1.02), S + " (instrument panel)", "switch")
put("PORT-ETH", (-0.50, -1.06, 1.12), C + " (glovebox)", "connector")
put("PORT-UTC", (-0.56, -1.06, 1.12), C + " (glovebox)", "connector")
put("GND-BANK-CAB", (0.00, -1.32, 0.84), C + " (beside the PDM30)", "power")
put("DOME-LAMP", (0.0, -0.40, 1.88), B + " (cab roof)", "lamp")
for code, xx in (("CLEARANCE-L", 0.55), ("CLEARANCE-C", 0.0), ("CLEARANCE-R", -0.55)):
    put(code, (xx, -0.86, 1.90), C + " (roof front edge)", "lamp")
put("FOOTWELL-LAMPS", (0.55, -1.22, 0.92), C, "lamp")
put("UNDERDASH-LAMPS", (-0.40, -1.20, 0.98), C, "lamp")

# ---- doors (driver = +x)
for side, s in (("L", 1), ("R", -1)):
    put("DOOR-JAMB-" + side, (s * 0.82, -1.15, 0.86), S + " (front door jamb)", "switch")
    put("DOOR-%s-PASS" % side, (s * 0.86, -1.12, 1.02), C + " (hinge side)", "connector")
    put("DOOR-%s-PASS-P" % side, (s * 0.86, -1.12, 0.92), C + " (hinge side)", "connector")
    put("SPK-F" + side, (s * 0.86, -0.95, 0.80), C + " (door panel, low front)", "audio")
    put("WIN-SW-" + side, (s * 0.80, -0.55, 1.06), S + " (door panel)", "switch")
    put("LOCK-SW-" + side, (s * 0.80, -0.47, 1.06), S + " (door panel)", "switch")
    put("window_motor_" + ("DS" if side == "L" else "PS"), (s * 0.87, -0.62, 1.00), S + " (inside the door)", "actuator")
    put("lock_actuator_" + ("DS" if side == "L" else "PS"), (s * 0.87, -0.20, 1.05), S + " (inside the door, at the latch)", "actuator")

# ---- rear body, tailgate
for side, s in (("Left", 1), ("Right", -1)):
    put("Tail_Light_" + side, (s * 0.95, 1.78, 1.00), B, "lamp")
    put("Backup_Light_" + side, (s * 0.95, 1.78, 0.92), B + " (lower lens of the tail lamp)", "lamp")
    put("MARKER-" + ("LR" if side == "Left" else "RR"), (s * 0.997, 1.60, 0.97), B + " (rear quarter)", "lamp")
put("LICENSE-LAMP", (0.0, 1.96, 0.68), C + " (plate on the bumper or the tailgate: not read)", "lamp")
put("Backup_Camera", (0.0, 1.96, 0.74), C + " (at the plate)", "sensor")
put("CHMSL", (0.0, 1.80, 1.86), C + " (rear edge of the top)", "lamp")
put("CARGO-LAMP", (0.0, 1.30, 1.86), C + " (cargo roof)", "lamp")
put("TG-SW-KEY", (0.0, 1.87, 1.10), S + " (tailgate key lock)", "switch")
put("TG-SW-KEY-REV", (0.04, 1.87, 1.10), S, "switch")
put("TG-CUTOUT", (0.80, 1.86, 0.74), S + " (tailgate edge)", "switch")
put("TG-MOTOR-ACI", (0.0, 1.84, 0.95), S + " (inside the tailgate)", "actuator")
put("rear_window_motor", (-0.04, 1.84, 0.95), S, "actuator")
put("SUB", (0.80, 1.48, 1.00), S + " (owner: behind the rear wheel well, in the side panel, on a built structure)", "audio")
put("SUB-2", (-0.80, 1.48, 1.00), S + " (owner: behind the rear wheel well, in the side panel; the factory spare carrier sits here)", "audio")
put("AMP", (0.78, 1.20, 1.18), C + " (above the left wheel well, sharing the left sub's structure)", "audio")
put("AMP-BLOCK", (0.72, 1.32, 1.18), C + " (beside the amp)", "power")
put("AMP-PASS", (0.55, 1.30, 0.70), C + " (rear floor over the frame rail)", "connector")
put("SPK-RL", (0.84, 0.10, 1.12), C + " (rear side panel beside the rear seat)", "audio")
put("SPK-RR", (-0.84, 0.10, 1.12), C + " (rear side panel beside the rear seat)", "audio")
put("GND-SPLICE-REAR", (0.55, 1.50, 0.74), C + " (inside the rear body)", "power")

# ---- underbody (rail at x = +/-0.40 in the render)
put("FUEL-PUMP", (0.10, 1.30, 0.83), S + " (hanger in the top of the body model's own tank: y 0.95-1.71, z 0.51-0.83)", "actuator")
put("FUEL-LEVEL", (0.03, 1.30, 0.83), S + " (on the hanger in the top of the tank)", "sensor")
put("SPL-FUEL-SND", (0.10, 1.24, 0.86), S + " (above the tank lid)", "connector")
put("VSS-SENDER", (0.0, -0.66, 0.55), S + " (NP205 speedometer drive; twin object K5H_VSS)", "sensor")
put("TCASE-4WD-SW", (0.20, -0.55, 0.76), C + " (at the shift lever)", "switch")
put("TRANS-CASE", AN["ANCHOR_trans_6L90"], A + " (6L90 case)", "connector")
put("PCS-HARNESS-4610-CASE", (-0.10, -0.80, 0.60), S, "connector")
put("GSS-SENSOR", (0.15, -0.95, 0.55), C + " (detent shaft)", "sensor")
put("E-STOPP", (0.30, 0.95, 0.62), S + " (on the parking-brake cable; twin object K5H_EStopp_Actuator)", "actuator")
put("AMP-STEP-CTRL", (0.80, -0.60, 0.45), C + " (by a step motor)", "module")

# ---- dropped / follows-a-box items are drawn at the thing they follow
FOLLOW = {}
for e in ends.ENDS:
    if e["id"] not in P and e.get("follows"):
        FOLLOW[e["id"]] = e["follows"]
BOX_AT = {"PDM15": "PDM15-A", "PDM30": "PDM30-A", "M130": "M130-A", "BATTERIES": "ODYSSEY", "ISOLATOR": "ISOLATOR",
          "FIREWALL-61": "FIREWALL-ENGINE", "BODY-PASS": "FIREWALL-ENGINE", "REAR-CONN": "AMP-PASS", "SERVICE": "PORT-ETH",
          "LTCD": "WIDEBAND", "DAKOTA": "DAKOTA-VHX", "DCDC": "DCDC"}
for code, box in FOLLOW.items():
    tgt = BOX_AT.get(box, box)
    if tgt in P:
        P[code] = {"xyz": P[tgt]["xyz"], "basis": "grouped with " + tgt, "cat": "harness", "grouped": tgt}

missing = [e["id"] for e in ends.ENDS if e["id"] not in P]
if __name__ == "__main__":
    print("placed", len(P), "missing", missing)
    json.dump(P, open(os.path.join(D, "positions.json"), "w"), indent=0)
