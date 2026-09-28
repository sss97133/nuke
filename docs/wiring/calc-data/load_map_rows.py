#!/usr/bin/env python3
"""Fill the wiring map's typed rows for the K5 (migration 20260927030100_wiring_map_typed_rows.sql).

Rows, not text (owner 2026-09-27). Reuses the tables the v2 wiring design names:
  harness_endpoints          one node per plug / device / splice / stud on the map (design 'K5' harness)
  vehicle_custom_circuits    one row per wire; ends link to their node + cavity; June rows superseded
  wire_termination_specs     one row per wire end: circuit + node + cavity, terminal / seal / tool
  wiring_decisions (+ alternatives, links)   the open calls, their recorded options and what they're coupled with

Sources are what the rows come from: 'k5_registry v5 @ <sha>' (the master list, whose facts are checked in
vehicle_observations 'k5-wiring:*'), or 'April 2026 whole-truck plan' for the 243 unreviewed wires (design_status
'concept'). trust T3 throughout: these are design records; T1/T2 come from the owner and documents via observations.
Idempotent: existing live rows (same code / circuit + derivation / slug) are left alone.

Usage: dotenvx run -- python3 load_map_rows.py [--dry-run]
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import yaml

CD = Path(__file__).resolve().parent
REPO = CD.parents[2]
K5 = "e08bf694-970f-4cbe-8a74-8715158a0f2e"
DESIGN = "0655a49b-0115-4027-aea1-20fc4911046b"          # harness_designs '1977 Chevrolet Blazer Harness'
OVERLAY = "eafee5c6-c105-4148-be9c-61cca0bc2377"          # vehicle_wiring_overlays (K5)
DRY = "--dry-run" in sys.argv

SHA = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
SRC_V5 = f"k5_registry v5 @ {SHA}"
SRC_APRIL = "April 2026 whole-truck plan (candidate, unreviewed)"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")

SUB2SECTION = {
    "CORE_ENGINE": "engine", "TRANS_6L80E": "powertrain_chassis", "FUEL": "powertrain_chassis",
    "CHARGING_STARTING": "power_spine", "HARNESS_INFRA": "power_spine",
    "LIGHTING_INTERIOR": "body_convenience", "POWER_WINDOWS": "body_convenience", "WIPERS_WASHER": "body_convenience",
    "AUDIO": "body_convenience", "DASH_CLUSTER_DAKOTA": "dash_cabin", "HVAC_AC": "dash_cabin",
    "POWER_LOCKS": "body_convenience", "CAMERA_REAR": "body_convenience", "BRAKES_IBOOSTER": "dash_cabin",
    # 2026-09-27: subsystems that had no section (their wires sat outside every rollup)
    "ACCESSORY_12V": "body_convenience", "AMP_STEPS": "body_convenience", "DOME_COURTESY": "body_convenience",
    "EPARKING_BRAKE": "powertrain_chassis", "COOLING": "engine",
}
APRIL2SECTION = {"engine-harness": "engine", "dash-cabin": "dash_cabin", "body-convenience": "body_convenience",
                 "lighting-front": "lighting_front", "lighting-rear": "lighting_rear", "powertrain-chassis": "powertrain_chassis"}
REAR = re.compile(r"TAIL|REAR|BRAKE|BACKUP|REVERSE|LICENSE|3RD|THIRD|TRAILER", re.I)
FAMILIES = {"ssc", "d38999_20", "gt150", "mp150", "ev1", "kit_terminal", "te_amp_plug", "ring_small", "lug", "miniseal",
            "solder_sleeve", "xlr_solder",
            "dt", "dtp", "dtm", "gm_blade", "screw_terminal", "contura"}   # admitted by migration 20260929010000


def endpoint_type(code, device=""):
    """The plug's kind: its code decides first, the description only when the code says nothing (2026-09-27: the
    description-first read typed the amplifier GROUND from 'power and ground', the coils DISPLAY from 'cluster')."""
    rules = ((r"^M130|^ECU|CONTROLLER|MODULE|TCM|LTCD|-CTRL\b", "ecu"),   # OILP-ECU / CLT-ECU are sensors (2026-09-28) (r"^PDM|FUSE ?BLOCK|DISTRIBUTION|PS-STUD", "power_distribution"),
             (r"FIREWALL|BULKHEAD|PORT-|CAN-BUS|CONNECTOR|XLR|RJ45", "connector"), (r"GROUND|GND|STAR(?!T)|RING", "ground"),
             (r"SPLICE|RAIL", "splice"), (r"RELAY", "relay"), (r"FUSE", "fuse"),
             (r"BATTER|ALTERNATOR|GENERATOR", "power_source"),
             (r"SWITCH|IGN-SW|DIMMER|BUTTON|(^|-)SW(-|$)", "switch"),
             (r"DAKOTA-VHX|GAUGE|CLUSTER|DISPLAY|TACH|SPEEDO|RADIO|MIRROR-MON", "display"),
             (r"SENSOR|SENDER|CKP|CMP|MAP|CLT|OILP|OILT|IAT|KNOCK|APS|VSS|WIDEBAND|LAMBDA|FUEL-LEVEL|DAK-", "sensor"),
             (r"COIL|INJ|MOTOR|PUMP|FAN|LIGHT|LAMP|SOLENOID|HORN|TB$|THROTTLE|WIPER|BLOWER|SPEAKER|AMP|SUB|WOOFER|SPK|ACTUATOR", "actuator"))
    for rx, t in rules:                           # the code, as written
        if re.search(rx, str(code).upper()):
            return t
    for rx, t in rules:                           # then words of the description, from a word start ('manufactuRING' is not a ring)
        if re.search(rf"\b(?:{rx})", str(device).upper()):
            return t
    return "custom"


# Digital-twin anchors (nuke_frontend/src/components/wiring/k5LandmarkPaths.ts DEFAULT_POSITIONS, from
# K5_landmarks_blender_derived.yaml). Only nodes that sit on an anchor get a position; the anchor's own caveat
# travels with it. Everything else stays unplaced (NULL) -- the map draws it in its section's tray.
ANCHORS = {
    "M130": ((-0.45, -1.44, 1.05), "A1 passenger firewall (ASSERTED — the M130 location is an open call)"),
    "PDM30": ((-0.45, -1.28, 0.82), "A2 under dash passenger (ASSERTED)"),
    "FWG_MAIN": ((-0.35, -1.46, 0.90), "A3 firewall hole H3 @ probed firewall plane"),
    "VALLEY": ((0.0, -1.655, 1.31), "intake valley junction"),
    "COIL1": ((0.065, -1.825, 1.31), "cyl 1 coil @ DEL-Stributor bracket"),
    "COIL2": ((-0.065, -1.825, 1.31), "cyl 2 coil @ bracket"),
    "THROTTLE_BODY": ((0.0, -1.95, 0.984), "90mm DBW"),
    "MAP_SENSOR": ((0.0, -1.455, 1.28), "MAP"),
    "CKP": ((-0.12, -2.00, 0.65), "front timing cover (Gen IV)"),
    "CMP": ((0.0, -1.97, 0.87), "cam sensor"),
    "KS1": ((0.27, -1.655, 0.77), "knock, driver block"),
    "KS2": ((-0.27, -1.655, 0.77), "knock, passenger block"),
    "BRAKE_SW": ((0.42, -1.30, 0.70), "brake switch (pedal box)"),
    "STEER_COL": ((0.50, -1.20, 0.95), "steering column"),
    "DASH_CLUSTER": ((0.62, -1.24, 1.05), "headlight-switch dash region"),
    "FUEL_TANK": ((0.15, 1.45, 0.62), "tank sender/pump"),
    "TUNNEL_6L80E": ((0.17, -0.95, 0.62), "6L80E switches via tunnel grommet"),
    "O2_L": ((0.36, -1.00, 0.53), "driver exhaust bung"),
    "TAIL_CLUSTER": ((0.0, 1.78, 0.985), "tail lights"),
}
NODE_ANCHOR = {
    "M130-A": "M130", "M130-B": "M130", "PORT-ETH": "M130", "CAN-BUS": "M130", "PORT-UTC": "PDM30",
    "PDM30-A": "PDM30", "PDM30-B": "PDM30", "PDM30-STUD": "PDM30",
    "FIREWALL-ENGINE": "FWG_MAIN", "FIREWALL-CABIN": "FWG_MAIN",
    "CKP": "CKP", "CMP": "CMP", "KNOCK-1": "KS1", "KNOCK-2": "KS2", "MAP": "MAP_SENSOR", "TB": "THROTTLE_BODY",
    "COIL-1": "COIL1", "COIL-2": "COIL2", "APS": "BRAKE_SW", "IGN-SWITCH": "STEER_COL", "DAKOTA-VHX": "DASH_CLUSTER",
    "FUEL-PUMP": "FUEL_TANK", "FUEL-LEVEL": "FUEL_TANK", "VSS": "TUNNEL_6L80E", "WIDEBAND": "O2_L",
}
# coils 3-8 sit in the same DEL-Stributor cluster as coils 1-2 (odd with 1, even with 2): approximate, and said so
for n in range(3, 9):
    NODE_ANCHOR[f"COIL-{n}"] = "COIL1" if n % 2 else "COIL2"


# master plugs replaced by another node (superseded_by points at the replacement)
REPLACED_NODES = {"G-FRONT-L": "GND-BANK-ENG", "G-FRONT-R": "GND-BANK-ENG", "G-FIREWALL": "GND-BANK-ENG",
                  "G-FRAME-REAR": "GND-BANK-ENG", "G-KICK-L": "GND-BANK-CAB", "G-KICK-R": "GND-BANK-CAB",
                  "G-ROOF": "GND-BANK-CAB", "DASH-STAR": "GND-BANK-CAB", "G-REAR": "GND-SPLICE-REAR",
                  # April parts a later decision replaced (state §1 / 0x): the P367 pump, one fan, the Blue Sea 7700, the
                  # Gen 2 iBooster, the PDMs instead of a fuse block, the factory brake switch
                  "Aeromotive_A1000": "FUEL-PUMP", "Radiator_Fan_2": "FAN", "RBD190_Disconnect": "ISOLATOR",
                  "Bosch_iBooster_Gen1": "IBOOSTER", "Main_Fuse_Distribution_Block": "PDM30-A",
                  "nurelics_fusebox_feed": "PDM30-A", "Brake_Light_Switch_Wilwood_340-3930": "BRAKE-SW"}


# April device names that are the SAME physical part as a master-list node (identity, not just function):
# their wires attach to the master node and no second node is drawn (each fact once). Anything less certain
# stays its own node for section-by-section review (e.g. April's Aeromotive A1000 is not the P367 the owner has).
ALIASES = {**{f"Fuel_Injector_{i}": f"INJ-{i}" for i in range(1, 9)},
           **{f"Ignition_Coil_{i}": f"COIL-{i}" for i in range(1, 9)},
           "Crank_Position_Sensor": "CKP", "Electronic_Throttle_Body": "TB",
           "M130_Connector_A": "M130-A", "M130_Connector_B": "M130-B", "Wideband_Lambda_Controller": "WIDEBAND",
           "COIL_RAIL_12V": "RAIL-COIL_PWR", "INJ_RAIL_12V": "RAIL-INJ_PWR",
           "DAKOTA_SEN-03-8": "DAK-OILP", "SEN-03-8_oil_sensor": "DAK-OILP", "SEN-04-5_coolant_sensor": "DAK-CTS",
           "Dakota_VHX_Control_Box": "DAKOTA-VHX", "Ignition_Switch_5pos": "IGN-SWITCH",
           # 2026-09-27 whole truck: the April device names and the power-spine words land on the plug codes
           "Horn": "HORN", "Washer_Pump": "WASHER-PUMP", "Wiper_Motor": "WIPER-MOTOR", "HVAC_Blower_Motor": "BLOWER-MOTOR",
           "Turn_Signal_Switch": "TURN-SW", "E_Stopp_Controller": "E-STOPP", "Side_Marker_L": "MARKER-LR",
           "Side_Marker_R": "MARKER-RR", "Third brake light (CHMSL)": "CHMSL", "Brake light switch (factory, pedal)": "BRAKE-SW",
           "BAT-": "GND-BANK-ENG", "Distribution stud": "PS-STUDS", "Ignition_Switch": "IGN-SWITCH",
           "head ring terminal": "COIL-GROUND-RINGS", "COIL_PWR rail splice": "RAIL-COIL_PWR",
           "INJ_PWR rail splice": "RAIL-INJ_PWR", "PDM15 battery stud": "PDM15-STUD",
           "Headlight_L": "HEADLIGHT-L", "Headlight_R": "HEADLIGHT-R",
           # 2026-09-27 whole truck: April device names that are the same physical part as a new master node
           "Floor_Dimmer_Switch_Beam_Selector": "FLOOR-DIMMER", "Floor_Dimmer_Switch": "FLOOR-DIMMER",
           "Headlight_Switch": "HL-SW", "HVAC_Blower_Speed_Switch": "BLOWER-SW", "Wiper_Washer_Switch": "WIPER-SW",
           "Dome_Light": "DOME-LAMP", "Footwell_Lights": "FOOTWELL-LAMPS", "Under_Dash_LED_Lights": "UNDERDASH-LAMPS",
           "Cigarette_Lighter_12V_Outlet": "OUTLET-12V", "USB_Charging_Port": "USB-PORT",
           "Cab_Clearance_Light_Left": "CLEARANCE-L", "Cab_Clearance_Light_Center": "CLEARANCE-C",
           "Cab_Clearance_Light_Right": "CLEARANCE-R", "Transfer_Case_Indicator": "TCASE-4WD-SW",
           "E_Stopp_Dash_Switch": "E-STOPP", "Door_Pin_Switch_Driver_junction": "DOOR-JAMB-L",
           "G5_kick_panel_stud": "GND-BANK-CAB", "G3_firewall_stud_star": "GND-BANK-ENG",
           "iBooster_ECU": "IBOOSTER", "iBooster_pedal_sensor_conn": "IBOOSTER",
           "CAN_Bus_Junction": "CAN-BUS", "CAN_Termination_Resistor_M130": "CAN-BUS", "CAN_Termination_Resistor_PDM": "CAN-BUS",
           "M130_ConnB_B17_CAN-H": "M130-B", "M130_ConnB_B17_CAN-L": "M130-B", "M130_ConnB_CAN": "M130-B",
           "PDM30_CAN": "PDM30-B", "PDM30_CAN_H": "PDM30-B", "PDM30_CAN_L": "PDM30-B", "PDM30_BATT_FEED": "PDM30-STUD",
           "PDM30_INPUT_ACC": "PDM30-A", "PDM30_INPUT_IGN": "PDM30-A", "PDM30_INPUT_IGN2": "PDM30-A",
           "PDM30_INPUT_START": "PDM30-A", "PDM30_IGN_ACC_FEED": "PDM30-A", "PDM30_OUT_HDLT": "PDM30-A",
           "PDM30_OUT_MARKERS": "PDM30-A", "PDM30_OUT_COURTESY": "PDM30-B", "PDM30_OUT_ACC_12V": "PDM30-B",
           "amp": "AMP", "hermosa": "RADIO", "hermosa_red": "RADIO", "hermosa_yellow": "RADIO",
           "powerstep_controller": "AMP-STEP-CTRL", "door_pin_switch_DS": "DOOR-JAMB-L", "door_pin_switch_PS": "DOOR-JAMB-R",
           "G5_kick": "GND-BANK-CAB", "G8_tailgate": "GND-SPLICE-REAR",
           "speaker_FR_DS_door_plus": "SPK-FL", "speaker_FR_DS_door_minus": "SPK-FL",
           "speaker_FR_PS_door_plus": "SPK-FR", "speaker_FR_PS_door_minus": "SPK-FR",
           "speaker_RR_DS_quarter_plus": "SPK-RL", "speaker_RR_DS_quarter_minus": "SPK-RL",
           "speaker_RR_PS_quarter_plus": "SPK-RR", "speaker_RR_PS_quarter_minus": "SPK-RR", "sub_CompR12": "SUB",
           # 2026-09-28 (owner: "why does the oil pressure sensor miss its plug... what about the starter connector"): April
           # rows still drawn beside the plug that is the same part
           "Starter_Motor": "STARTER-S", "STARTER_TRIG": "STARTER-S", "Alternator": "ALTERNATOR-SENSE",
           "Radiator_Fan_1": "FAN", "GM_Fuel_Sender": "FUEL-LEVEL", "License_Plate_Light": "LICENSE-LAMP",
           "Third_Brake_Light": "CHMSL", "Cargo_Bed_Light": "CARGO-LAMP", "Park_Turn_L": "PARK-TURN-LF",
           "Park_Turn_R": "PARK-TURN-RF", "window_switch_driver": "WIN-SW-L", "window_switch_pass": "WIN-SW-R",
           "Battery_Positive_Post": "ODYSSEY", "battery_pos": "ODYSSEY", "Battery_Negative_Post": "GND-BANK-ENG",
           "battery_neg": "GND-BANK-ENG", "Chassis_Star": "GND-BANK-ENG", "STAR_BAT_CHASSIS": "GND-BANK-ENG",
           "STAR_BAT_ENG": "GND-BANK-ENG", "STAR_ENG_FRAME": "GND-BANK-ENG", "COIL_GND_STAR_ECM_HEAD": "COIL-GROUND-RINGS",
           "amp_fuse_holder": "ACC-BATT", "amp_remote_in": "AMP", "courtesy_underdash": "UNDERDASH-LAMPS"}


ALIAS_N = {re.sub(r"[^a-z0-9]", "", k.lower()): v for k, v in ALIASES.items()}


# Every other plug with a component object in the twin: that object's world-space bounding-box centre, dumped from
# ~/k5-harness-pull/K5_harness_workspace_v2.blend into twin_centers.json (2026-09-28; same frame as ANCHORS: the CMP, MAP,
# knock and M130 anchors match the dump to the millimetre). Owner: "the missing sensors is annoying".
TWIN_OBJ = {"CLT-ECU": "K5H_CLT", "IAT": "K5H_IAT", "OILP-ECU": "K5H_OilPress", "OILT": "K5H_OilTemp", "FUELP": "K5H_FuelPress",
            "ALTERNATOR-SENSE": "K5H_Alternator", "STARTER-S": "K5H_Starter", "ODYSSEY": "K5H_Battery", "FAN": "K5H_RadFan_1",
            "AC-CLUTCH": "K5H_AC_Compressor", "IBOOSTER": "K5H_iBooster", "VSS-SENDER": "K5H_VSS", "E-STOPP": "K5H_EStopp_Actuator",
            "SUB": "K5H_Subwoofer", "AMP": "K5H_Amplifier", "TCASE-4WD-SW": "K5H_TransferCase", "PCS-TCM": "K5H_6L80E",
            **{f"INJ-{i}": f"K5H_Injector_{i}" for i in range(1, 9)}}
_TC = Path(__file__).with_name("twin_centers.json")
TWIN_POS = json.load(open(_TC)) if _TC.exists() else {}


def position(code):
    a = NODE_ANCHOR.get(code)
    if not a and TWIN_OBJ.get(code) in TWIN_POS:
        x, y, z = TWIN_POS[TWIN_OBJ[code]]
        return {"pos_x_m": x, "pos_y_m": y, "pos_z_m": z,
                "pos_source": f"digital-twin object {TWIN_OBJ[code]} centre (K5_harness_workspace_v2.blend, twin_centers.json)"}
    if not a:
        return {}
    (x, y, z), note = ANCHORS[a]
    approx = code.startswith("COIL-") and code not in ("COIL-1", "COIL-2")
    return {"pos_x_m": x, "pos_y_m": y, "pos_z_m": z,
            "pos_source": f"digital-twin anchor {a}: {note}" + (" — approximate, same coil cluster" if approx else "")
                          + " (k5LandmarkPaths.ts DEFAULT_POSITIONS)"}


class API:
    def __init__(self):
        self.url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
        self.key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not (self.url and self.key):
            sys.exit("SUPABASE URL / service role key missing (run under dotenvx from the repo root)")

    def _req(self, method, path, body=None, prefer=None):
        h = {"Authorization": f"Bearer {self.key}", "apikey": self.key, "Content-Type": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}", data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            sys.exit(f"{method} {path[:80]} -> HTTP {e.code}: {e.read()[:400].decode(errors='ignore')}")

    def get(self, table, query):
        return self._req("GET", f"{table}?{query}")

    def insert(self, table, rows):
        """Bulk insert; PostgREST wants every row in a batch to carry the same keys, so fill the gaps with null."""
        keys = sorted({k for r in rows for k in r})
        rows = [{k: r.get(k) for k in keys} for r in rows]
        out = []
        for i in range(0, len(rows), 200):
            out += self._req("POST", table, rows[i:i + 200], prefer="return=representation") or []
        return out

    def patch(self, table, query, body):
        return self._req("PATCH", f"{table}?{query}", body, prefer="return=minimal")


PLAN = "--plan" in sys.argv       # compute what would change against the live rows; write nothing


def main():
    reg = json.load(open(CD / "k5_registry.json"))
    tools = yaml.safe_load(open(CD / "catalog" / "tools.yaml"))
    import kits_v5 as K
    wires = {str(w["id"]): w for w in reg["wires"] if not w.get("retired")}
    wires.update({str(w["id"]): w for w in reg["implied"]})
    eps, terms, cands = reg["endpoints"], reg["terminations"], reg["candidates"]

    # ------------------------------------------------ nodes: v5 endpoints + April candidate devices
    nodes = {}
    for eid, e in eps.items():
        fam = e.get("family") if e.get("family") in FAMILIES else "unknown"
        wl = [wires.get(str(w)) for w in (e.get("wires") or []) if isinstance(e.get("wires"), list) and str(w) in wires]
        secs = Counter(SUB2SECTION.get(w.get("subsystem")) for w in wl if w and SUB2SECTION.get(w.get("subsystem")))
        section = ("comms" if eid in ("CAN-BUS", "PORT-UTC", "PORT-ETH") else "engine" if eid in ("PDM15-A", "PDM15-B")
                   else (secs.most_common(1)[0][0] if secs else None))
        if section is None and any(w and w.get("subsystem") == "LIGHTING_EXTERIOR" for w in wl):
            section = "lighting_rear" if REAR.search(f"{eid} {e.get('device')}") or re.search(r"CHMSL|brake light", f"{eid} {e.get('device')}", re.I) else "lighting_front"
        if section is None and e.get("where") == "engine":
            section = "engine"
        if section is None and e.get("where") == "chassis":
            section = "powertrain_chassis"
        if section is None and e.get("where") in ("cabin", "rear"):
            section = "body_convenience" if e.get("where") == "rear" or re.search(r"door|lock|window|mirror|camera", str(e.get("device")), re.I) else "dash_cabin"
        dos = reg["dossiers"].get(eid)
        nodes[eid] = {
            "design_id": DESIGN, "code": eid, "name": K.BOOK_TITLE.get(eid, str(e.get("device") or eid))[:200],
            "endpoint_type": endpoint_type(eid, str(e.get("device") or "")), "family": fam,
            "harness_section": section, "location_zone": e.get("where"),
            "part_number": ",".join(str(k) for k in (e.get("kit") or {})) or None,
            "design_status": "decided" if e.get("kit") or fam not in ("unknown",) else "concept",
            "work_status": ("done" if dos and dos.get("status") == "design-complete" else "open"),
            "notes": (e.get("note") or None), "source": SRC_V5, "method": "registry loader", "observed_at": NOW, "trust": "T3",
            **position(eid),
        }
    for c in cands:
        for end in ("frm", "to"):
            d = c.get(end) if isinstance(c.get(end), dict) else {}
            dev = str(d.get("device") or "").strip()
            if not dev or dev in nodes or dev in ALIASES or dev in REPLACED_NODES:
                continue
            nodes[dev] = {
                "design_id": DESIGN, "code": dev, "name": dev.replace("_", " ")[:200], "endpoint_type": endpoint_type(dev),
                "family": "unknown", "harness_section": APRIL2SECTION.get(c.get("sub")), "location_zone": None,
                "design_status": "concept", "work_status": "open", "notes": None,
                "source": SRC_APRIL, "method": "registry loader (candidate)", "observed_at": NOW, "trust": "T3",
            }

    # ------------------------------------------------ wires (v5 decided + April concept)
    v5_circuits = []
    ends_of = {}
    for t in terms:
        ends_of.setdefault(str(t["wire"]), []).append(t)
    for wid, w in wires.items():
        tl = ends_of.get(wid, [])
        def _code(x):
            b = re.split(r"\s\(|:|\s->|\s\+", str(x or ""))[0].strip()
            return ALIAS_N.get(re.sub(r"[^a-z0-9]", "", b.lower())) or (b if b in eps else None)
        fc = _code(w.get("frm"))
        tc = _code(w["to"].get("device") if isinstance(w.get("to"), dict) else w.get("to"))
        # the start is the plug the record names, else the ECU/PDM pin; a wire whose start plug has no write-up still
        # starts there (2026-09-27: dual-pin PDM outputs had both pins taken as the two ends)
        src_end = (next((t for t in tl if fc and t["endpoint"] == fc), None)
                   or next((t for t in tl if str(t["endpoint"]).startswith(("M130", "PDM30", "PDM15"))), None))
        if src_end is None and not fc:
            src_end = next((t for t in tl if t["endpoint"] != tc), None) if tc else (tl[0] if tl else None)
        # the far end is the device, not an inline connector the wire passes through, nor another pin of the start
        dst_end = (next((t for t in tl if tc and t["endpoint"] == tc and t is not src_end), None)
                   or next((t for t in tl if (src_end is None or t["endpoint"] != src_end["endpoint"]) and t["endpoint"] != fc
                            and not str(t["endpoint"]).startswith("FIREWALL")), None))
        sec = SUB2SECTION.get(w.get("subsystem"))
        if w.get("subsystem") == "LIGHTING_EXTERIOR":
            sec = "lighting_rear" if REAR.search(str(w.get("label") or "")) else "lighting_front"
        awg = w.get("awg") if isinstance(w.get("awg"), int) else None
        v5_circuits.append({
            "overlay_id": OVERLAY, "circuit_code": wid, "circuit_name": K.dave_name(w)[:200], "wire_color": w.get("color"),
            "system_category": str(w.get("subsystem") or "UNASSIGNED"),
            "wire_gauge_awg": awg, "wire_type": w.get("spec"), "is_shielded": "M27500" in str(w.get("spec")),
            "from_component": str(w.get("frm") or "")[:200] or "(not recorded)", "to_component": str(w.get("to") or "")[:200] or "(not recorded)",
            "_from": src_end["endpoint"] if src_end else fc, "from_cavity": src_end.get("cavity") if src_end else None,
            "_to": dst_end["endpoint"] if dst_end else (tc if tc and tc != fc else None),
            "to_cavity": dst_end.get("cavity") if dst_end else None,
            "planned_length_ft": w.get("length_ft") if isinstance(w.get("length_ft"), (int, float)) else None,
            "build_state": "uncut", "derivation_version": "k5_registry_v5", "design_status": "decided",
            "notes": "; ".join(x for x in (w.get("notes"), f"switched by: {w['control']}" if w.get("control") else None) if x)[:1000] or None,
            "harness_section": sec, "source": SRC_V5, "method": "registry loader", "observed_at": NOW, "trust": "T3",
        })
    april_circuits = []
    for c in cands:
        f = c.get("frm") if isinstance(c.get("frm"), dict) else {}
        t = c.get("to") if isinstance(c.get("to"), dict) else {}
        awg = int(c["awg"]) if str(c.get("awg") or "").isdigit() else None
        april_circuits.append({
            "overlay_id": OVERLAY, "circuit_code": c["id"], "circuit_name": str(c.get("label") or c["id"])[:200],
            "wire_color": c.get("color_april"), "wire_gauge_awg": awg, "wire_type": c.get("insulation_april"),
            "system_category": str(c.get("sub") or "UNASSIGNED"),
            "from_component": f.get("device") or "(not recorded)", "from_pin": str(f.get("pin") or "")[:120] or None,
            "to_component": t.get("device") or "(not recorded)", "to_pin": str(t.get("pin") or "")[:120] or None,
            "_from": ALIASES.get(f.get("device"), f.get("device")), "_to": ALIASES.get(t.get("device"), t.get("device")),
            "planned_length_ft": round(float(c["length_in"]) / 12, 2) if str(c.get("length_in") or "").replace(".", "", 1).isdigit() else None,
            "notes": (c.get("notes") or None), "build_state": "uncut", "derivation_version": "april_2026_candidate",
            "design_status": "concept", "harness_section": APRIL2SECTION.get(c.get("sub")),
            "source": SRC_APRIL, "method": "registry loader (candidate)", "observed_at": NOW, "trust": "T3",
        })

    # ------------------------------------------------ the open calls (plan 2026-09-26 decision sheet)
    calls = [
        ("k5-m130-location", "Where the M130 mounts", "placement"),
        ("k5-second-pdm", "Second PDM and the channel split", "architecture"),
        ("k5-battery-isolator", "Battery isolator", "part_choice"),
        ("k5-battery", "Battery", "part_choice"),
        ("k5-body-firewall-crossing", "How the body harness crosses the firewall", "placement"),
        ("k5-speed-source", "Speed source (trans output vs corrected for 4-Lo)", "architecture"),
        ("k5-gauge-feed", "Gauge feed: dual senders vs CAN to the Dakota", "architecture"),
        ("k5-amp", "Amplifier", "part_choice"),
    ]
    # options only where a record names them (no invented alternatives)
    alternatives = {
        "k5-m130-location": [
            ("cab_passenger_firewall", "Cab, passenger side of the firewall", "cab",
             "K5_WIRING_STATE.md §3 (M130 mount position — passenger firewall per this file)"),
            ("cab_dash", "Cab, under the dash", "cab", "K5_WIRING_STATE.md §3 (devices.json says 'dash')"),
            ("engine_bay", "Engine bay", "engine",
             "K5_WIRING_STATE.md row 46 (if the M130 mounts engine-bay side, +6 bulkhead crossings)"),
        ],
        "k5-gauge-feed": [
            ("dual_sender", "Dual senders (locked 05-14)", None, "K5_WIRING_STATE.md 0c"),
            ("bim_efi_can", "BIM-EFI-1 reading the M1 CAN stream", None, "K5_WIRING_STATE.md 0c"),
        ],
    }
    links = [  # (call, relation, other call or node code, note, source, trust)
        ("k5-m130-location", "coupled_with", "FIREWALL-ENGINE", "which wires cross the 61-pin depends on where the M130 sits",
         "K5_WIRING_STATE.md row 46", "T3"),
        ("k5-m130-location", "coupled_with", "k5-body-firewall-crossing",
         "in-engine vs under-dash mounting affects the 61-pin and the whole body wiring assembly", "owner 2026-09-27", "T1"),
        ("k5-second-pdm", "coupled_with", "PDM30-A", "channel split", "plan 2026-09-26 decision sheet", "T3"),
        ("k5-gauge-feed", "coupled_with", "DAKOTA-VHX", "senders vs CAN", "K5_WIRING_STATE.md 0c", "T3"),
        ("k5-speed-source", "coupled_with", "VSS", "6L90 output ≠ road speed in NP205 low 1.96:1", "K5_WIRING_STATE.md 0f", "T3"),
    ]

    print(f"nodes {len(nodes)} (v5 {len(eps)}, April devices {len(nodes) - len(eps)}) · wires v5 {len(v5_circuits)} + April {len(april_circuits)}"
          f" · wire ends {len(terms)} · calls {len(calls)} · options {sum(len(v) for v in alternatives.values())} · links {len(links)}")
    print("  nodes by section:", dict(Counter(n["harness_section"] for n in nodes.values())))
    print("  nodes by type:", dict(Counter(n["endpoint_type"] for n in nodes.values())))
    print("  placed on a twin anchor:", sum(1 for n in nodes.values() if n.get("pos_x_m") is not None), "of", len(nodes))
    # April concept rows the v5 design now carries (a v5 wire on the same two plugs) or a locked decision rules out
    # (R13 in WIRE_CHECKS.json) leave the map; the rest stay as concept for section-by-section review (2026-09-27)
    def _unit(code):
        # the ECU/PDM connectors and studs count as one box; April pseudo-nodes (M130_HB_spare, PDM30_OUT_*) stay themselves
        if not code or code not in eps:
            return code or None
        return ("PDM30" if code.startswith("PDM30") else "PDM15" if code.startswith("PDM15")
                else "M130" if code.startswith("M130") else code)
    v5_pair = {}
    for c in v5_circuits:
        pts = {_unit(c.get("_from")), _unit(c.get("_to"))} | {_unit(t["endpoint"]) for t in ends_of.get(c["circuit_code"], [])
                                                              if not str(t["endpoint"]).startswith("FIREWALL")}
        pts.discard(None)
        for p1 in pts:
            for p2 in pts:
                if p1 < p2:
                    v5_pair.setdefault((p1, p2), []).append(c["circuit_code"])
    apr_on_pair = Counter(tuple(sorted((_unit(c["_from"]) or "", _unit(c["_to"]) or ""))) for c in april_circuits)
    try:
        r13 = {x["wire"]: x["rules"]["R13 locked"][1] for x in json.load(open(CD / "WIRE_CHECKS.json"))["wires"]
               if x["kind"] == "april" and x["rules"].get("R13 locked", ("PASS",))[0] == "FAIL"}
    except FileNotFoundError:
        r13 = {}
    april_fate = {}
    for c in april_circuits:
        key = tuple(sorted((_unit(c["_from"]) or "", _unit(c["_to"]) or "")))
        if c["circuit_code"] in r13:
            april_fate[c["circuit_code"]] = ("dead", r13[c["circuit_code"]])
        elif all(key) and key in v5_pair and apr_on_pair[key] <= len(v5_pair[key]):
            # carried only when v5 has at least as many wires on the two plugs as April did (a pair with more April wires
            # than v5 wires may hold a function v5 lacks — the Dakota sender returns were one): the rest wait for review
            april_fate[c["circuit_code"]] = ("covered", v5_pair[key][0])
    if "--fates" in sys.argv:
        lab = {c["circuit_code"]: (c["circuit_name"], c["_from"], c["_to"]) for c in april_circuits}
        for k, (f, why) in sorted(april_fate.items()):
            print(f"    {f:8s} {k:22s} {lab[k][0][:28]:28s} {str(lab[k][1])[:26]:26s} -> {str(lab[k][2])[:26]:26s} | {why[:70]}")
    print(f"  April concept rows leaving the map: {sum(1 for f, _ in april_fate.values() if f == 'covered')} carried by a v5 wire, "
          f"{sum(1 for f, _ in april_fate.values() if f == 'dead')} ruled out by a locked decision")
    if DRY:
        return

    api = API()
    # locked decisions: a node that a decided wiring_decisions row blocks (wiring_decision_links 'blocks') is dead data.
    # It is never loaded again, and neither is any wire or wire end on it (owner 2026-09-27: "our methods are not
    # being enforced"; receipt 2026-09-27_locked-decisions-enforced.md)
    decided = [r["id"] for r in api.get("wiring_decisions", f"select=id&vehicle_id=eq.{K5}&status=eq.decided&is_superseded=eq.false") or []]
    blocked_ids = [r["endpoint_id"] for r in (api.get("wiring_decision_links",
                   f"select=endpoint_id&relation=eq.blocks&endpoint_id=not.is.null&decision_id=in.({','.join(decided)})") if decided else [])]
    blocked = {r["code"] for r in (api.get("harness_endpoints", f"select=code&id=in.({','.join(blocked_ids)})") if blocked_ids else [])}
    if blocked:
        print(f"locked decisions block {len(blocked)} node(s); not loaded: {', '.join(sorted(blocked))}")
    # nodes
    NODE_KEYS = ("name", "endpoint_type", "family", "harness_section", "part_number", "notes", "design_status", "pos_x_m", "pos_y_m", "pos_source")
    live_n = api.get("harness_endpoints", "select=id,code,work_status,assignee," + ",".join(NODE_KEYS)
                     + f"&design_id=eq.{DESIGN}&is_superseded=eq.false&code=not.is.null&limit=5000") or []
    have = {r["code"]: r["id"] for r in live_n}
    # rows with no code are function-level placeholders from an earlier generator ("Headlights (Low Beam)", "Starter
    # Motor"): the plug rows carry those facts now. Superseded, never deleted (2026-09-28)
    nocode = api.get("harness_endpoints", f"select=id,name&design_id=eq.{DESIGN}&is_superseded=eq.false&code=is.null&limit=500") or []
    for r in nocode:
        if PLAN:
            print(f"   - placeholder '{r['name']}' leaves the map (no code; the plug rows carry it)")
        else:
            api.patch("harness_endpoints", f"id=eq.{r['id']}&is_superseded=eq.false",
                      {"is_superseded": True, "source": f"function-level placeholder with no plug code; superseded by the plug rows (k5_registry v5 @ {SHA})"})
    changed_n = [(r, nodes[r["code"]]) for r in live_n if r["code"] in nodes and r["code"] not in blocked
                 and any((r.get(k) or None) != (nodes[r["code"]].get(k) or None) for k in NODE_KEYS)]
    new_nodes = [n for c, n in nodes.items() if c not in have and c not in blocked]
    if PLAN:
        print(f"PLAN nodes: {len(new_nodes)} new, {len(changed_n)} changed -> superseded + reinserted")
        for r, n in changed_n[:12]:
            print("   ~", r["code"], {k: (r.get(k), n.get(k)) for k in NODE_KEYS if (r.get(k) or None) != (n.get(k) or None)})
    else:
        for r, n in changed_n:
            api.patch("harness_endpoints", f"id=eq.{r['id']}&is_superseded=eq.false", {"is_superseded": True})
        reins = [dict(n, work_status=(n.get("work_status") if n.get("work_status") == "done" else r.get("work_status") or "open"),
                      assignee=r.get("assignee")) for r, n in changed_n]
        for r in api.insert("harness_endpoints", new_nodes + reins):
            have[r["code"]] = r["id"]
        for r, n in changed_n:
            api.patch("harness_endpoints", f"id=eq.{r['id']}", {"superseded_by": have[n["code"]]})
    # April duplicates loaded before the alias table: superseded by the master node they duplicate
    n_alias = 0
    for dup, master in ALIASES.items():
        if dup in have and master in have and not PLAN:
            api.patch("harness_endpoints", f"id=eq.{have[dup]}&is_superseded=eq.false",
                      {"is_superseded": True, "superseded_by": have[master],
                       "source": f"{SRC_APRIL}; same part as {master} (alias, k5_registry v5 @ {SHA})"})
            del have[dup]
            n_alias += 1
    # plugs that left the design: superseded (pointing at their replacement when there is one), never deleted. The body
    # ground studs became ground banks in the loom (owner 2026-09-27: "dave runs his grounds in the looms")
    gone = dict(REPLACED_NODES)
    for code in (reg.get("retired_endpoints") or {}):
        gone.setdefault(code, None)
    n_gone = 0
    for code, succ in sorted(gone.items()):
        if code not in have or code in nodes:
            continue
        why = f"replaced by {succ}" if succ else (reg.get("retired_endpoints") or {}).get(code)
        if PLAN:
            print(f"   - {code} leaves the map ({why})")
        else:
            body = {"is_superseded": True, "source": f"left the design: {why} (k5_registry v5 @ {SHA})"}
            if succ and succ in have:
                body["superseded_by"] = have[succ]
            api.patch("harness_endpoints", f"id=eq.{have[code]}&is_superseded=eq.false", body)
            del have[code]
        n_gone += 1
    print(f"nodes: {len(new_nodes)} inserted, {len(changed_n)} changed (superseded + reinserted), {n_alias} April duplicates "
          f"superseded by their master node, "
          f"{n_gone} left the design, {len(have)} live")
    # wires. Supersede, never overwrite: the June rows are marked replaced FIRST (uniqueness applies to live rows
    # only, migration 20260927040100), then the current rows go in, then each June row points at its successor.
    WIRE_KEYS = ("circuit_name", "from_component", "to_component", "wire_gauge_awg", "wire_color", "wire_type", "system_category",
                 "from_cavity", "to_cavity", "planned_length_ft", "notes", "harness_section")
    live = api.get("vehicle_custom_circuits",
                   "select=id,circuit_code,derivation_version,build_state,from_endpoint_id,to_endpoint_id," + ",".join(WIRE_KEYS)
                   + f"&overlay_id=eq.{OVERLAY}&is_superseded=eq.false&limit=5000") or []
    have_c = {(r["circuit_code"], r["derivation_version"]): r["id"] for r in live}
    # v5 rows the registry changed (supersede + insert, bench progress carried) or retired (supersede, no successor)
    reg_v5 = {c["circuit_code"]: c for c in v5_circuits}
    def _sig(c):
        return tuple((c.get(k) if not isinstance(c.get(k), float) else round(c.get(k), 2)) or None for k in WIRE_KEYS) + (
            have.get(c.get("_from")) if "_from" in c else c.get("from_endpoint_id"),
            have.get(c.get("_to")) if "_to" in c else c.get("to_endpoint_id"))
    changed_c = [r for r in live if r["derivation_version"] == "k5_registry_v5" and r["circuit_code"] in reg_v5
                 and _sig(r) != _sig(reg_v5[r["circuit_code"]])]
    retired_c = [r for r in live if r["derivation_version"] == "k5_registry_v5" and r["circuit_code"] not in reg_v5]
    if PLAN:
        print(f"PLAN wires: {len(changed_c)} changed -> superseded + reinserted, {len(retired_c)} retired: "
              f"{', '.join(r['circuit_code'] for r in retired_c)}")
        for r in changed_c[:10]:
            c = reg_v5[r["circuit_code"]]
            print("   ~", r["circuit_code"], {k: (r.get(k), c.get(k)) for k in WIRE_KEYS if (r.get(k) or None) != (c.get(k) or None)})
        print(f"PLAN new v5 wires: {sum(1 for c in v5_circuits if (c['circuit_code'], 'k5_registry_v5') not in have_c)}")
        return
    old_ids = [r["id"] for r in changed_c + retired_c]
    for r in changed_c + retired_c:
        api.patch("vehicle_custom_circuits", f"id=eq.{r['id']}&is_superseded=eq.false",
                  {"is_superseded": True} if r in changed_c else {"is_superseded": True,
                                                                "source": f"retired in k5_registry v5 @ {SHA}"})
        del have_c[(r["circuit_code"], r["derivation_version"])]
    carry_v5 = {r["circuit_code"]: r.get("build_state") for r in changed_c}
    for i in range(0, len(old_ids), 80):   # their wire ends go with them; the new rows get fresh ends below
        api.patch("wire_termination_specs", f"circuit_id=in.({','.join(old_ids[i:i + 80])})&is_superseded=eq.false", {"is_superseded": True})
    june = [r for r in live if r["derivation_version"] not in ("k5_registry_v5", "april_2026_candidate")]
    v5_codes = {c["circuit_code"] for c in v5_circuits}
    v5_lower = {c.lower(): c for c in v5_codes}
    june_succ_code = {r["id"]: (r["circuit_code"] if r["circuit_code"] in v5_codes else v5_lower.get(str(r["circuit_code"]).lower()))
                      for r in june}
    carry = {june_succ_code[r["id"]]: r.get("build_state") for r in june if june_succ_code[r["id"]]}
    for r in june:
        api.patch("vehicle_custom_circuits", f"id=eq.{r['id']}&is_superseded=eq.false",
                  {"is_superseded": True, "source": (f"superseded by k5_registry v5 @ {SHA}" if june_succ_code[r["id"]]
                                                     else f"retired: not in k5_registry v5 @ {SHA}")})
    rows = []
    for c in v5_circuits + april_circuits:
        if (c["circuit_code"], c["derivation_version"]) in have_c or c["_from"] in blocked or c["_to"] in blocked:
            continue
        if c["derivation_version"] == "april_2026_candidate" and c["circuit_code"] in april_fate:
            continue
        row = {k: v for k, v in c.items() if not k.startswith("_")}
        row["from_endpoint_id"], row["to_endpoint_id"] = have.get(c["_from"]), have.get(c["_to"])
        if c["derivation_version"] == "k5_registry_v5" and carry.get(c["circuit_code"]):
            row["build_state"] = carry[c["circuit_code"]]          # bench progress carries over
        if c["derivation_version"] == "k5_registry_v5" and carry_v5.get(c["circuit_code"]):
            row["build_state"] = carry_v5[c["circuit_code"]]
        rows.append(row)
    for r in api.insert("vehicle_custom_circuits", rows):
        have_c[(r["circuit_code"], r["derivation_version"])] = r["id"]
    n_sup = n_ret = 0
    for r in june:
        code = june_succ_code[r["id"]]
        succ = have_c.get((code, "k5_registry_v5")) if code else None
        if succ:
            api.patch("vehicle_custom_circuits", f"id=eq.{r['id']}", {"superseded_by": succ})
            n_sup += 1
        else:
            n_ret += 1
    for r in changed_c:
        api.patch("vehicle_custom_circuits", f"id=eq.{r['id']}", {"superseded_by": have_c[(r["circuit_code"], "k5_registry_v5")]})
    n_cov = n_dead = 0
    for code_, (fate, why) in april_fate.items():
        rid = have_c.get((code_, "april_2026_candidate"))
        if not rid:
            continue
        body = ({"is_superseded": True, "superseded_by": have_c.get((why, "k5_registry_v5")),
                 "source": f"{SRC_APRIL}; carried by v5 #{why} on the same two plugs (k5_registry v5 @ {SHA})"} if fate == "covered"
                else {"is_superseded": True, "source": f"{SRC_APRIL}; retired: {why} (k5_registry v5 @ {SHA})"})
        api.patch("vehicle_custom_circuits", f"id=eq.{rid}&is_superseded=eq.false", body)
        del have_c[(code_, "april_2026_candidate")]
        n_cov += fate == "covered"
        n_dead += fate == "dead"
    print(f"April concept rows: {n_cov} carried by a v5 wire, {n_dead} ruled out by a locked decision — superseded")
    print(f"wires: {len(rows)} inserted ({len(changed_c)} of them replace changed rows) · {len(retired_c)} retired · "
          f"June rows: {n_sup} superseded by their v5 row, {n_ret} retired (not in the master)")
    # wire ends
    live_t = api.get("wire_termination_specs", f"select=circuit_id,endpoint_id&vehicle_id=eq.{K5}&is_superseded=eq.false&circuit_id=not.is.null") or []
    have_t = {(r["circuit_id"], r["endpoint_id"]) for r in live_t}
    fam_tool = {}
    for tid, tdef in (tools or {}).items():
        for p in (tdef.get("for") or []):
            fam_tool.setdefault(str(p), tdef.get("pn") or tid)
    trows = []
    for t in terms:
        cid, nid = have_c.get((str(t["wire"]), "k5_registry_v5")), have.get(t["endpoint"])
        if not cid or not nid or (cid, nid) in have_t:
            continue
        have_t.add((cid, nid))
        codes = [x for x in str(t.get("part") or "").split(" + ") if x]
        trows.append({
            "vehicle_id": K5, "circuit_id": cid, "endpoint_id": nid, "wire_code": str(t["wire"]), "cavity": t.get("cavity"),
            "endpoint_side": "source" if str(t["endpoint"]).startswith(("M130", "PDM30", "PDM15")) else "device",
            "connector_family": t.get("family"), "terminal_contact_pn": codes[0] if codes else None,
            "pin_seal_pn": codes[1] if len(codes) > 1 else None,
            "crimp_tool_pn": fam_tool.get(codes[0]) if codes else None, "qty_needed": 1,
            "notes": "doubled over at the terminal (MoTeC C125 p.21)" if t.get("doubled") else None,
            "source": f"k5-wiring:{t['endpoint']}:#{t['wire']} end" if t["endpoint"] in reg["dossiers"] else SRC_V5,
            "method": "registry loader", "observed_at": NOW, "trust": "T3",
        })
    if "--with-ends" in sys.argv:
        api.insert("wire_termination_specs", trows)
        # ends the registry no longer has (e.g. a wire the engine PDM now keeps inside the engine bay leaves the 61-pin)
        want = {(have_c.get((str(t["wire"]), "k5_registry_v5")), have.get(t["endpoint"])) for t in terms}
        v5_ids = {cid for (code, dv), cid in have_c.items() if dv == "k5_registry_v5"}
        stale = [r for r in (api.get("wire_termination_specs", f"select=id,circuit_id,endpoint_id&vehicle_id=eq.{K5}"
                                     f"&is_superseded=eq.false&circuit_id=not.is.null&limit=5000") or [])
                 if r["circuit_id"] in v5_ids and (r["circuit_id"], r["endpoint_id"]) not in want]
        for i in range(0, len(stale), 80):
            api.patch("wire_termination_specs", f"id=in.({','.join(r['id'] for r in stale[i:i + 80])})", {"is_superseded": True})
        print(f"wire ends: {len(trows)} inserted, {len(stale)} retired (no longer in the registry)")
    else:
        print(f"wire ends: {len(trows)} ready, held until wire_termination_specs.wire_number is nullable (--with-ends)")
    # rule-check results per wire (check_plug_ends.py --wires -> WIRE_CHECKS.json), replaced in place
    if "--checks" in sys.argv:
        wc = json.load(open(CD / "WIRE_CHECKS.json"))
        ver = f"check_plug_ends R8-R14 @ {SHA}"
        n_ck = 0
        for x in wc["wires"]:
            dv = "april_2026_candidate" if x["kind"] == "april" else "k5_registry_v5"
            cid = have_c.get((x["wire"], dv))
            if cid:
                api.patch("vehicle_custom_circuits", f"id=eq.{cid}", {"checks": x["rules"], "checks_version": ver, "checked_at": NOW})
                n_ck += 1
        print(f"checks: written on {n_ck} wires")
    # calls, options, links
    all_d = api.get("wiring_decisions", f"select=id,slug,is_superseded&vehicle_id=eq.{K5}") or []
    live_d = {r["slug"]: r["id"] for r in all_d if not r["is_superseded"]}
    # a call that was decided since (its open row superseded by '<slug>-decided') is never re-opened: the slug is unique
    # table-wide, and the decided row carries it now (2026-09-27 fix: the loader re-inserted k5-second-pdm -> HTTP 409)
    have_slug = {r["slug"] for r in all_d}
    drows = [{"vehicle_id": K5, "slug": s, "subject": subj, "status": "open", "decision_kind": kind, "work_status": "open",
              "receipt_path": "docs/wiring/K5_WIRING_STATE.md",
              "source": "plan 2026-09-26 decision sheet (~/.claude/plans/vivid-hugging-globe.md)", "method": "registry loader",
              "observed_at": NOW, "trust": "T3"} for s, subj, kind in calls if s not in have_slug]
    for r in api.insert("wiring_decisions", drows):
        live_d[r["slug"]] = r["id"]
    arows = []
    for slug, opts in alternatives.items():
        did = live_d.get(slug)
        if not did:
            continue                                   # decided since: its options live on the decided row
        existing = {r["key"] for r in api.get("wiring_decision_alternatives", f"select=key&decision_id=eq.{did}&is_superseded=eq.false") or []}
        arows += [{"decision_id": did, "key": k, "label": lab, "zone": z, "source": src, "method": "registry loader",
                   "observed_at": NOW, "trust": "T3"} for k, lab, z, src in opts if k not in existing]
    api.insert("wiring_decision_alternatives", arows)
    lrows = []
    for slug, rel, other, note, src, trust in links:
        did = live_d.get(slug)
        if not did:
            continue
        row = {"decision_id": did, "relation": rel, "note": note, "source": src, "trust": trust}
        if other not in live_d and f"{other}-decided" in live_d:
            other = f"{other}-decided"                   # the call was decided since: link to the decided row
        if other in live_d:
            row["other_decision_id"] = live_d[other]
        elif other in have:
            row["endpoint_id"] = have[other]
        else:
            print(f"link skipped: {slug} -> {other} (not on the map)")
            continue
        lrows.append(row)
    existing_l = api.get("wiring_decision_links", f"select=decision_id,relation,other_decision_id,endpoint_id&decision_id=in.({','.join(live_d.values())})") or []
    seen = {(r["decision_id"], r["relation"], r.get("other_decision_id") or r.get("endpoint_id")) for r in existing_l}
    lrows = [r for r in lrows if (r["decision_id"], r["relation"], r.get("other_decision_id") or r.get("endpoint_id")) not in seen]
    api.insert("wiring_decision_links", lrows)
    print(f"calls: {len(drows)} inserted · options {len(arows)} · links {len(lrows)}")

    # ------------------------------------------------ options (variants): one decision row per option, coupled to its plugs
    # options_v5.py writes reg['options'] (catalog/options.yaml). status: base/decided -> decided · candidate -> candidate
    # (needs_owner) · rejected -> rejected. A status change supersedes the live row; nothing is deleted.
    STATUS = {"base": ("decided", "decided"), "decided": ("decided", "decided"),
              "candidate": ("candidate", "needs_owner"), "rejected": ("rejected", "decided")}
    all_d = api.get("wiring_decisions", f"select=id,slug,status,is_superseded&vehicle_id=eq.{K5}") or []
    have_slug = {r["slug"] for r in all_d}
    n_new = n_sup = n_link = 0
    ep_by_wire = {}
    for eid, e in eps.items():
        for w in (e.get("wires") or []):
            ep_by_wire.setdefault(str(w), set()).add(eid)
    for code, o in (reg.get("options") or {}).items():
        st, work = STATUS[o["status"]]
        base = f"opt-{code.lower()}"
        live = [r for r in all_d if not r["is_superseded"] and re.match(rf"^{re.escape(base)}(-|$)", r["slug"])]
        cur = live[0] if live else None
        if cur and cur["status"] == st:
            did = cur["id"]
        else:
            slug = next(s_ for s_ in (base, f"{base}-{st}", f"{base}-{st}-{NOW[:10]}") if s_ not in have_slug)
            row = {"vehicle_id": K5, "slug": slug, "subject": f"Option {code}: {o['name']}", "status": st,
                   "decision_kind": "architecture", "work_status": work, "receipt_path": "docs/wiring/calc-data/OPTIONS.md",
                   "source": (o.get("source") or "")[:400], "method": "options_v5 (catalog/options.yaml)", "observed_at": NOW,
                   "trust": "T1" if "owner" in (o.get("source") or "") else "T3",
                   "decided_on": (NOW[:10] if st == "decided" else None)}
            if PLAN:
                print(f"PLAN option {code}: would insert {slug} ({st}/{work})" + (f", superseding {cur['slug']} ({cur['status']})" if cur else ""))
                continue
            ins = api.insert("wiring_decisions", [row])
            did = ins[0]["id"] if ins else None
            n_new += 1
            if cur and did:
                api.patch("wiring_decisions", f"id=eq.{cur['id']}", {"is_superseded": True, "superseded_by": did})
                n_sup += 1
        if not did:
            continue
        plugs = sorted({e for w in o.get("wires") or [] for e in ep_by_wire.get(str(w), ())} & set(have))
        existing_l = {r["endpoint_id"] for r in (api.get("wiring_decision_links", f"select=endpoint_id&decision_id=eq.{did}&relation=eq.coupled_with") or [])}
        lrows = [{"decision_id": did, "relation": "coupled_with", "endpoint_id": have[e],
                  "note": f"plug carries option {code}", "source": "options_v5 (registry wires -> plugs)", "trust": "T3"}
                 for e in plugs if have[e] not in existing_l]
        if PLAN:
            print(f"PLAN option {code}: {len(plugs)} plugs, {len(lrows)} new links")
            continue
        api.insert("wiring_decision_links", lrows)
        n_link += len(lrows)
    print(f"options: {len(reg.get('options') or {})} · rows inserted {n_new} · superseded {n_sup} · plug links {n_link}")


if __name__ == "__main__":
    main()
