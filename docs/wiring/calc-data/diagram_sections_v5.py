"""diagram_sections_v5.py — the section plan the wiring-diagram sheets are drawn to (read by diagram_v5.build).

One row per sheet: (section, key, title, layout, plugs) — plugs is a regex, or a list of regexes when the order
matters (pages split in that order, e.g. driver door then passenger door). Sections are the live map's harness sections
(load_map_rows.SUB2SECTION: engine, power_spine, comms, dash_cabin, body_convenience, lighting_front,
lighting_rear, powertrain_chassis). layout 'engine' = plugs on the engine side of the firewall: plugs left, the
crossing (61-pin face or body bulkhead cavity strips) in the middle, the cab computers right. layout 'cab' = plugs in
the cab, the bed or on the chassis: plugs left; computers, ground banks, bulkhead strips and off-sheet tags right.
A plug is drawn on the one sheet that owns it; every other sheet that reaches it ends the run in an arrow tag
'→ <plug> <cavity> · sheet 1-N'. diagram_v5.build prints the plugs no sheet owns; that list must stay empty.
"""

# plugs drawn by power_v5 (DC primary sheet, then the ground distribution sheet, appended after these sheets):
# runs that reach them end in a tag naming that sheet; the wires with no plug of their own on these sheets (studs,
# ground banks, PDM feeds, M130 power and grounds) are drawn there, not here (lead's call 2026-09-28)
POWER_PLUGS = {"ODYSSEY": 0, "ACC-BATT": 0, "ISOLATOR": 0, "DCDC": 0}

SECTION_HEAD = {
    "engine": "ENGINE HARNESS", "power_spine": "POWER AND GROUNDS", "comms": "COMMS — CAN BUS AND LAPTOP PORTS",
    "dash_cabin": "DASH AND CAB", "body_convenience": "BODY AND CONVENIENCE", "lighting_front": "LIGHTING — FRONT",
    "lighting_rear": "LIGHTING — REAR AND ROOF", "powertrain_chassis": "POWERTRAIN AND CHASSIS",
}

SHEET_PLAN = [
    ("engine", "sensors", "Engine sensors", "engine",
     r"^(CKP|CMP|MAP|IAT|CLT-ECU|OILP-ECU|OILT|KNOCK-\d|FUELP|DAK-CTS|DAK-OILP)$"),
    ("engine", "coils", "Ignition coils", "engine", r"^COIL-\d$"),
    ("engine", "injectors", "Fuel injectors", "engine", r"^INJ-\d$"),
    ("engine", "throttle", "Throttle body, lambda module, alternator, starter, fan and A/C", "engine",
     r"^(TB|WIDEBAND|ALTERNATOR-SENSE|STARTER-S|FAN|AC-CLUTCH|AC-HP-SW|AC-LP-SW)$"),
    # the CAN trunk crosses the 61-pin: engine layout, the cab plugs drawn in the right-hand column; the trunk's
    # wires are drawn here too where another sheet owns their plug (the LTCD leg, the 61-pin leg)
    ("comms", "data", "CAN bus trunk and laptop ports", "engine", r"^(CAN-BUS|PORT-ETH|PORT-UTC)$",
     r"^(62|CAN_.+|UTC_.+|ETH_.+)$"),
    ("lighting_front", "front-lamps", "Headlights, park/turn lamps, front markers, horn and underhood lamp", "engine",
     r"^(HEADLIGHT-[LR]|PARK-TURN-[LR]F|MARKER-[LR]F|HORN|UNDERHOOD-LAMP)$"),
    ("body_convenience", "front-body", "Wiper motor, washer pump and blower (engine side of the firewall)", "engine",
     r"^(WIPER-MOTOR|WASHER-PUMP|BLOWER-MOTOR|BLOWER-RES)$"),
    ("powertrain_chassis", "booster", "Brake booster", "engine", r"^IBOOSTER$"),
    ("dash_cabin", "switches", "Ignition, isolator, light, turn, brake and horn switches", "cab",
     r"^(IGN-SWITCH|ISO-SWITCH|SPL-ISO-YEL|HL-SW|FLOOR-DIMMER|TURN-SW|BRAKE-SW|HORN-SW)$"),
    ("dash_cabin", "dash", "Wiper and blower switches, gas pedal, radio, outlet and USB port", "cab",
     r"^(WIPER-SW|BLOWER-SW|APS|RADIO|OUTLET-12V|USB-PORT)$"),
    ("body_convenience", "doors", "Doors: windows, locks and speakers", "cab",
     ["^DOOR-L-PASS-P$", "^DOOR-L-PASS$", "^WIN-SW-L$", "^LOCK-SW-L$", "^window_motor_DS$", "^lock_actuator_DS$", "^SPK-FL$",
      "^DOOR-R-PASS-P$", "^DOOR-R-PASS$", "^WIN-SW-R$", "^LOCK-SW-R$", "^window_motor_PS$", "^lock_actuator_PS$", "^SPK-FR$"]),
    ("body_convenience", "tailgate-camera", "Tailgate window and rear camera", "cab",
     r"^(TG-SW-DASH|TG-SW-KEY|TG-CUTOUT|rear_window_motor|TG-MOTOR-ACI|TG-SW-MASTER|TG-SW-KEY-REV|Backup_Camera|MIRROR-MON)$"),
    ("body_convenience", "interior", "Dome, courtesy and cargo lamps, door jambs and power steps", "cab",
     r"^(DOME-LAMP|FOOTWELL-LAMPS|UNDERDASH-LAMPS|CARGO-LAMP|DOOR-JAMB-[LR]|AMP-STEP-CTRL)$"),
    ("body_convenience", "audio", "Amplifier, woofers and rear speakers", "cab", r"^(AMP|AMP-BLOCK|SUB|SUB-2|SPK-R[LR])$"),
    ("body_convenience", "fuel", "Fuel pump and fuel level sender", "cab", r"^(FUEL-PUMP|FUEL-LEVEL)$"),
    ("lighting_rear", "rear-lamps", "Tail, stop, backup, third brake, license and rear markers; cab roof clearance lamps",
     "cab", r"^(Tail_Light_(Left|Right)|Backup_Light_(Left|Right)|CHMSL|LICENSE-LAMP|MARKER-[LR]R|CLEARANCE-[LCR])$"),
    ("powertrain_chassis", "chassis", "Transfer-case switch, speed sender, gear sender and parking brake", "cab",
     r"^(TCASE-4WD-SW|VSS|VSS-SENDER|GSS-3000|GSS-SENSOR|E-STOPP|PCS-TCM)$"),
]

# the computers: drawn on every sheet a run reaches them, pins named from the MoTeC designation files
COMPUTERS = ("M130-A", "M130-B", "PDM30-A", "PDM30-B", "PDM15-A", "PDM15-B", "DAKOTA-VHX")
ENGINE_COMPUTERS = ("PDM15-A", "PDM15-B")
# junctions: ground banks, studs, rails — drawn where a run reaches them
JUNCTIONS = ("GND-BANK-ENG", "PS-STUDS", "RAIL-COIL_PWR", "RAIL-INJ_PWR", "COIL-GROUND-RINGS", "PDM15-STUD",
             "PDM30-STUD", "GND-BANK-CAB", "GND-SPLICE-REAR", "FAN-JUNCTION")
CAB_JUNCTIONS = ("PDM30-STUD", "GND-BANK-CAB", "GND-SPLICE-REAR")
# crossings: the 61-pin (engine circuits only), the body bulkheads, the grommet for the big feeds
CROSSINGS = ("FIREWALL-ENGINE", "FIREWALL-CABIN", "FIREWALL-BODY-A", "FIREWALL-BODY-B", "FIREWALL-BODY-P",
             "FIREWALL-BODY-C", "AMP-PASS", "FIREWALL-GROMMET")
# the sheet that carries a wire with no plug end of its own (junction to junction, or computer only)
JUNCTION_HOME = {"RAIL-COIL_PWR": "coils", "COIL-GROUND-RINGS": "coils", "RAIL-INJ_PWR": "injectors", "FAN-JUNCTION": "throttle"}
WIRE_HOME = [(r"^PCS_", "chassis"), (r"^COIL_GND$", "coils"), (r"^ECU_", "power"), (r"^(ETH_|UTC_|CAN_|62$)", "data")]
