"""True-size envelopes this lane read for the ends nobody had sized yet, biggest pieces first, one sourced number
at a time, plus the rules the page build needs about which ends are drawn and how.

Same shape as the pieces lane's footprints.py:
  box:  dx = across the truck (world x), dy = along the truck (world y), dz = height, all mm
  disc: d = diameter, t = thickness or length, axis = the world axis the round face looks along
  size: the numbers and where each came from; color: where the colour came from (omit it and the build takes the
        dominant colour of the part_media photo, and says so)
  orient: how it is drawn on the truck (orientation is drawn, not decided, unless the note says why)
REF = reference_documents/ (the repo's local reference library, not committed: vendors' terms apply)."""

REF = "reference_documents/"
WS = REF + "web_snapshots/"
CD = REF + "component_drawings/"

S = [
    # ---- engine bay
    dict(id="HEADLIGHT-L", shape="disc", d=178, t=102.1, axis="y",
         size="7 in round (Truck-Lite LED headlight brochure: '27270C | LED Headlight, 7\" round', " + WS + "www.truck-lite.com__LEDHeadlightBrochure_1.md); "
              "depth 102.1 mm is the body model's own headlight (mesh Headlights, one side: 184.5 x 102.1 x 184.5 mm); Truck-Lite's depth is not read",
         orient="lens facing forward"),
    dict(id="PARK-TURN-LF", shape="box", dx=214.9, dy=56.8, dz=86.3, top="#e7e7e7", side="#e7e7e7",
         size="the body model's own park/turn lamp (mesh Parking_Lights, one side: 214.9 x 56.8 x 86.3 mm); GM 8911486's drawing is not read",
         color="body model material 'Chrome' (0.8 linear grey); the lens is 'Parking_Lights_Glass', no colour set", orient="as in the body model"),
    dict(id="MARKER-LF", shape="box", dx=46.5, dy=42.9, dz=191.9, top="#e7e7e7", side="#e7e7e7",
         size="the body model's own front side marker (mesh Marker_Lights, one side: 46.5 x 42.9 x 191.9 mm); GM 6294015's drawing is not read",
         color="body model material 'Chrome'; the lens 'Marker_Lights_Glass' has no colour set", orient="as in the body model"),
    dict(id="BLOWER-MOTOR", shape="disc", d=77.8, t=127, axis="y",
         size="Four Seasons 35587: 'Diameter: 3 1/16\" (77.8mm)', 'Length: 5\" (127mm)' with the shaft, 'Motor Length: 4 1/4\" (108mm)' (" + WS + "mpparts.com__four-seasons-35587-blower-motor-single-shaft-35587.md)",
         orient="motor axis drawn fore-aft; the factory mounting angle on the Four-Season case is not read"),
    dict(id="FIREWALL-GROMMET", shape="disc", d=67.7, t=28.33, axis="y",
         size="Blue Sea 1003 CableClam: \u00d82.67 in (67.70 mm), 1.12 in (28.33 mm) tall (Blue Sea dimensioned drawing 1003-1, "
              "https://d2pyqm2yd3fw2i.cloudfront.net/files/resources/dimensioned_drawing/1003.pdf, fetched 2026-09-29); one per cable, one drawn",
         orient="flat on the firewall's engine face"),
    dict(id="ISOLATOR", shape="box", dx=51.56, dy=95.25, dz=138.9,
         size="Blue Sea 7700: 3.75 in (95.25 mm) wide, 2.03 in (51.56 mm) deep, 5.47 in (138.9 mm) tall over the studs (" + CD + "BlueSea_7700_ML-RBS_Instructions_990180170-006.pdf p.2, dimension drawing)",
         orient="drawn upright, studs down; which way it faces is not decided"),
    dict(id="FIREWALL-ENGINE", shape="disc", d=48.0, t=31.3, axis="y",
         size="D38999/26 plug, shell 25: coupling ring 1.890 in (48.0 mm), length 1.234 in (31.3 mm), without the M85049/69 adapter and boot (" + CD + "MILNEC_D38999_series_III_catalog.pdf p.B-23, TX06 plug dimensions, shell 25)",
         orient="axis through the firewall"),
    dict(id="FIREWALL-CABIN", shape="box", dx=55.6, dy=32.5, dz=55.6,
         size="D38999/24 jam-nut receptacle, shell 25: square flange 2.188 in (55.6 mm), length 1.280 in (32.5 mm) max (" + CD + "MILNEC_D38999_series_III_catalog.pdf p.B-25, TX07 receptacle dimensions, shell 25)",
         orient="flange on the firewall's cab face"),
    # ---- cab
    dict(id="RADIO", shape="box", dx=100.6, dy=109.2, dz=50.3,
         size="RetroSound Motor-2B: 'Dimensions (Radio Motor) 3.96\"W x 1.98\"H x 4.30\"D' (" + CD + "RetroSound_Motor-2B_User_Manual.pdf, specifications); the face (3.5 x 1.5 x 1.05 in) is not included",
         orient="behind the dash opening, face to the rear"),
    dict(id="ISO-SWITCH", shape="box", dx=25.65, dy=43.7, dz=49.91,
         size="Blue Sea 2145 remote switch: face 1.010 x 1.965 in (25.65 x 49.91 mm), depth 0.595 + 1.125 in (15.10 + 28.58 mm) without the pins (" + CD + "BlueSea_7700_ML-RBS_Instructions_990180170-006.pdf p.2, control switch drawing)",
         orient="face in the dash, looking rearward"),
    dict(id="OUTLET-12V", shape="box", dx=59.8, dy=41.4, dz=42.3,
         size="Blue Sea 1011: flange 2.35 x 1.66 in (59.8 x 42.3 mm), depth 0.19 + 1.44 in (4.9 + 36.5 mm) without the terminals (" + CD + "BlueSea_1011_Dash_Socket_dimensioned_drawing.jpg)",
         orient="face in the dash or console, looking rearward"),
    dict(id="USB-PORT", shape="disc", d=35, t=51.6, axis="y",
         size="Blue Sea 1045: face \u00d835 mm, depth 51.6 mm (" + CD + "BlueSea_1045_Dual_USB_dim.pdf p.1, dwg 980021560-1)",
         orient="face in the dash or console, looking rearward"),
    dict(id="PORT-UTC", shape="box", dx=26, dy=27.2, dz=31,
         size="Neutrik NC5FD-L-1: flange 26.00 x 31.00 mm, overall depth 27.20 mm (" + CD + "Neutrik_NC5FD-L-1_drawing.pdf, dwg 3102 St 10 44)",
         orient="face in the glovebox panel"),
    dict(id="UNDERDASH-LAMPS", shape="box", dx=149.7, dy=28.2, dz=15.3,
         size="Lumitec Mini Rail2: 'Height 5.90in (14.97cm)', 'Width 1.11in (2.82cm)', 'Depth 0.60in (1.53cm)' (" + WS + "www.lumiteclighting.com__mini-rail2-led-utility-light-2.md); part_media rates 101241 a family match",
         orient="drawn lengthwise across the truck under the dash"),
    # ---- doors
    dict(id="lock_actuator_DS", shape="box", dx=19.1, dy=133.4, dz=63.5,
         size="AutoLoc AUTZT2000: 'Length :: 5.25\u201d', 'Width :: 2.5\u201d', 'Height :: 0.75\u201d' (" + WS + "shop.autoloc.com__compact-2-wire-car-door-lock-actuator-heavy-duty-12-volt-motor-13-lbs-power-12v.md)",
         orient="flat inside the door skin, rod along the door"),
    # ---- rear
    dict(id="Tail_Light_Left", shape="box", dx=148.1, dy=146.9, dz=193.6, top="#ec5959", side="#ec5959",
         size="the body model's own tail lamp (mesh Tail_Lights_Main, one side: 148.1 x 146.9 x 193.6 mm); GM 8911029's drawing is not read",
         color="body model lens material 'Tail_Lights_Glass_Front' (0.85, 0.10, 0.10 linear = #ec5959)", orient="as in the body model"),
    dict(id="DOME-LAMP", shape="box", dx=97.2, dy=56.8, dz=20.3, top="#e7e7e7", side="#e7e7e7",
         size="the body model's own dome lamp (mesh Interior_Dome_Light_Blazer: 97.2 x 56.8 x 20.3 mm)",
         color="body model materials 'Chrome' and 'Dome_Light_Glass'", orient="as in the body model"),
    dict(id="AMP-BLOCK", shape="box", dx=51, dy=83.82, dz=44.45,
         size="Blue Sea 2103 PowerPost Plus: 3.300 x 1.750 in (83.82 x 44.45 mm) base, 2.0 in (51 mm) tall to the stud tip (" + CD + "BlueSea_2101-2103_PowerPost_Plus_dim.jpg, dimension A for 2103)",
         orient="drawn on the side panel, stud out; not decided"),
    dict(id="AMP-PASS", shape="disc", d=67.7, t=28.33, axis="z",
         size="Blue Sea 1003 CableClam: \u00d82.67 in (67.70 mm), 1.12 in (28.33 mm) tall (Blue Sea dimensioned drawing 1003-1, "
              "https://d2pyqm2yd3fw2i.cloudfront.net/files/resources/dimensioned_drawing/1003.pdf, fetched 2026-09-29); one per 2 AWG cable, one drawn",
         orient="flat on the rear floor"),
    # ---- under the truck
    dict(id="E-STOPP", shape="box", dx=96, dy=381, dz=51,
         size="E-Stopp actuator housing: 'Length: 15 in (38.1 cm)', 'Width: 3-1/4 in (9.6 cm) (including flanges)', 'Height: 2 in (5.1 cm)' "
              "(estopp.com/products/esk1-sil, Technical Specifications, fetched 2026-09-29); the page's width disagrees with itself "
              "(3-1/4 in is 8.3 cm), so it is drawn at the larger 96 mm; the 12 in cable is not included",
         orient="along the parking-brake cable, fore-aft"),
    dict(id="TRANS-CASE", shape="box", dx=42.7, dy=50.3, dz=39,
         size="Kostal LKS 1.5 16-cavity socket housing 09430010: 39 x 42.7 x 50.3 mm, L x H x W (" + CD + "Kostal_LKS_1_5_Connector_POP.pdf p.2); GM 19303772 is that Kostal LKS 1.5 16-pin plug (docs/wiring/output/K5_connector_shopping_list.txt:63, k5_registry.json wire 125 note)",
         orient="plug facing outboard on the passenger side of the case; lever position not read"),
]

# part_models.yaml (parts-artist) gives dims in the part's own frame: l along its X, w along Y, h along Z.
# How each part's axes sit on the truck (world x across, y along, z up). Only parts listed here are drawn from it.
MOUNT = {
    "M130-A": {"axes": ("x", "z", "y"),
               "note": "flat on the cab face of the firewall, plugs down (part_models.yaml frame: plugs face -Y); the spot is open"},
    "PDM30-A": {"axes": ("x", "z", "y"),
                "note": "on its own plate facing the cab, plugs down like the M130; the M6 stud stands 17.9 mm proud of the front (not in the box); the spot is open"},
    "PDM15-A": {"axes": ("x", "y", "z"),
                "note": "lying on the passenger inner fender, mounting face down, as the pieces lane drew it; the stud stands 17.9 mm proud (not in the box); the box itself is flagged"},
}

# ends that are the same physical piece as another end, so they are drawn with it
SAME_PIECE = {
    "M130-B": "M130-A", "PDM30-B": "PDM30-A", "PDM30-STUD": "PDM30-A", "PDM15-B": "PDM15-A", "PDM15-STUD": "PDM15-A",
    "FUEL-LEVEL": "FUEL-PUMP", "TG-SW-KEY-REV": "TG-SW-KEY",
    # pos.py puts the backup lamp in the lower lens of the tail lamp: one housing
    "Backup_Light_Left": "Tail_Light_Left", "Backup_Light_Right": "Tail_Light_Right",
}

# ends that are pieces of the harness itself, or not a piece at all: they are drawn with the routes
LOOM = {
    "RAIL-COIL_PWR": "a daisy-chained rail inside the engine loom: drawn with the routes",
    "RAIL-INJ_PWR": "a daisy-chained rail inside the engine loom: drawn with the routes",
    "CAN-BUS": "a trunk of the loom, not one piece: drawn with the routes",
    "PCS-HARNESS-4610": "the PCS kit's own harness: drawn with the routes",
    "PCS-HARNESS-4610-CASE": "the kit harness's case ground lead: drawn with the routes",
    "COIL-GROUND-RINGS": "ring terminals on the loom's ground leads: drawn with the routes",
    "PS-STUDS": "the DC primary cable ends: drawn with the cable routes",
    "FIREWALL-BODY-A": "not used: nothing but the 61-pin goes through the firewall (owner and Dave, 2026-09-29)",
    "FIREWALL-BODY-B": "not used: nothing but the 61-pin goes through the firewall (owner and Dave, 2026-09-29)",
    "FIREWALL-BODY-P": "not used: nothing but the 61-pin goes through the firewall (owner and Dave, 2026-09-29)",
}
for _k in ("SPL-PDM15-OUT1", "SPL-PDM15-OUT2", "SPL-PDM15-OUT3", "SPL-PDM15-OUT4", "SPL-PDM15-OUT5", "SPL-PDM15-OUT6",
           "SPL-PDM15-OUT7", "SPL-PDM15-OUT13", "SPL-PDM30-OUT1", "SPL-PDM30-OUT2", "SPL-PDM30-OUT3", "SPL-PDM30-OUT4",
           "SPL-PDM30-OUT5", "SPL-PDM30-OUT6", "SPL-PDM30-OUT7", "SPL-PDM30-OUT8", "SPL-ISO-YEL", "SPL-FUEL-SND"):
    LOOM[_k] = "a splice inside the loom: drawn as a part on its route when the routes land"
for _k in ("FUSE-IBOOST_PERM", "FUSE-ISO_PWR", "FUSE-ISO_SW_PWR", "FUSE-DAK_CONST", "FUSE-PCS_BATT", "FUSE-TRANS_BATT"):
    LOOM[_k] = "an in-line fuse holder in the loom: drawn on its route when the routes land"

# system for the ends with no wire of their own in the registry (the kit harness carries them)
SYSTEM = {"TRANS-CASE": "Transmission", "PCS-TCM": "Transmission"}

# what to read next for an end that is not drawn (shown in the page's "Not drawn yet" table)
TODO = {
    "INJ-1": "length 60 mm is read (Siemens Deka: 'Long Style ... (60mm)'); the body diameter is not, so it is not drawn",
    "CHMSL": "only the length is read (ORACLE: 'Length: 7 inches'); height and depth are not",
    "FUEL-PUMP": "the hanger is 12 in from its top plate to the bottom of the pump housing (highflowfuel.com Q&A for QFS-H882); the plate diameter is not read",
    "WASHER-PUMP": "the factory washer pump rides on the wiper motor (main #410); part_media still names a Hella pump",
}
for _k in ("CKP", "CMP", "KNOCK-1", "CLT-ECU", "OILP-ECU", "IAT", "AC-LP-SW"):
    TODO[_k] = "GM and ACDelco publish no dimensions on their parts pages (parts.chevrolet.com, read 2026-09-29); read the sensor or a GM drawing"
for _k in ("DAK-CTS", "DAK-OILP", "VSS-SENDER", "GSS-3000", "GSS-SENSOR", "DAKOTA-VHX"):
    TODO[_k] = "Dakota Digital's manuals on file give no case dimensions; Summit's pages refuse scripted reads"
for _k in ("DOOR-L-PASS", "DOOR-R-PASS"):
    TODO[_k] = "face 1.435 x 1.000 in (36.45 x 25.40 mm) is read (" + CD + "TE_DT04-08PX-XXXX_figure1-front-view_screenshot_2026-09-28.jpg); the length is not"
for _k in ("DOOR-L-PASS-P", "DOOR-R-PASS-P", "IBST-DIAG"):
    TODO[_k] = "TE's drawing only opens in a browser (te.com refuses scripted reads); the size is not read"
for _k in ("HORN", "WIPER-MOTOR", "BLOWER-RES", "UNDERHOOD-LAMP", "BRAKE-SW", "FLOOR-DIMMER", "TURN-SW", "HORN-SW", "WIPER-SW", "BLOWER-SW",
           "DOOR-JAMB-L", "DOOR-JAMB-R", "LICENSE-LAMP", "TG-CUTOUT", "rear_window_motor", "LOCK-SW-L"):
    TODO[_k] = "factory part with no part number recorded: read the number off the part, then its size"
TODO.update({
    "PCS-TCM": "PCS's TCM-2650 pages and setup guide on file give no case size",
    "window_motor_DS": "Nu-Relics' 17383-2 page and instructions on file give no motor size",
    "TG-MOTOR-ACI": "Nu-Relics' 17383-1 page and instructions on file give no motor size",
    "APS": "the eBay listing on file gives no pedal size",
    "TCASE-4WD-SW": "Torque King's QU30048 page on file gives no size",
    "CLEARANCE-L": "LMC's 36-4481 page on file gives no size",
    "HL-SW": "USA1's 16603 page on file gives no size",
    "IGN-SWITCH": "OER's 1990096 listing gives only a 5 x 5 x 2 in shipping size",
    "WIN-SW-L": "Nu-Relics' 201 page on file gives no size",
    "TG-SW-DASH": "Motor City K5's page gives only a 2 x 0.5 x 2 in package size",
    "TG-SW-MASTER": "Nu-Relics #121: no page or drawing on file",
    "TG-SW-KEY": "factory 8900713: no drawing on file",
    "MAP": "Holley's pages on file give no sensor size",
    "FUELP": "AEM's 30-2131-100 sensor data sheet gives only the calibration (documents.aemelectronics.com, read 2026-09-29)",
    "AC-HP-SW": "Vintage Air's page gives only the 3/8-24 thread",
    "PORT-ETH": "ProWire's page gives only the 1 m cable length",
    "FIREWALL-BODY-C": "a DT04-6P: TE's drawing only opens in a browser; its spot also waits on the rear connector",
})
for _k in ("GND-BANK-ENG", "GND-BANK-CAB", "GND-SPLICE-REAR", "AMP-STEP-CTRL", "BRAKE-FLUID-LVL", "STARTER-S", "OILT"):
    TODO[_k] = "the part is not picked or its number is not recorded, so there is no size to read"

# photos for ends whose part_media photo host refuses scripted downloads, from a page verified to be that exact part
PHOTO = {
    "IGN-SWITCH": {"file": REF + "product_images/1990096.jpg",
                   "page": "https://www.camarodepot.ca/oer-1969-2002-chevrolet-pontiac-ignition-switch-tilt-wheel-1990096",
                   "fetched": "2026-09-28", "confidence": "exact_pn",
                   "note": "camarodepot.ca's image for OER 1990096 (reference_documents/product_images/sources.json); part_media's classicindustries.com photo refuses scripted downloads"},
}

# context drawn from the body model (outline only), and the open calls that ride on it
CONTEXT_MESHES = [
    ("Interior_Spare_Tire_Carrier", "Spare-tire carrier (body model)", "the factory carrier in the right rear corner"),
]
SPARE_CALL = {"text": "Open owner question: does the spare tire stay inside the right rear? The factory carrier fills that corner at stations 116 to 139 in "
                      "(body model mesh Interior_Spare_Tire_Carrier), where the right woofer (SUB-2) is drawn. The right sub needs the spare moved, or another spot.",
              "source": "pieces lane layout note (v3 page, 2026-09-29), kept at the pieces lane's request; body model mesh bbox"}
CALLS = {"SUB": [SPARE_CALL], "SUB-2": [SPARE_CALL], "ctx:Interior_Spare_Tire_Carrier": [SPARE_CALL]}

# prices are testimony with a short half-life: older than this is marked stale on the page (a display rule, not a fact)
STALE_DAYS = 30
BUILDER_NOTE = ("The repo names Desert Performance as the harness builder (.claude/rules/wiring-receipt.md: 'the builder (Dave / Desert Performance)'). "
                "No part has a build owner assigned yet.")
REFERRAL = "Referral or commission path: not set. That is a business decision for main and Skylar; the page links vendor pages only and has no cart or checkout."

# the margin for ends placed on the body model
BODY_MARGIN = {"mm": 30, "cls": "body",
               "text": "\u00b130 mm across the truck and along the wheelbase: the twin lane measured the body model against GM's sheet: wheelbase 2.6 mm short of "
                       "2,705 mm, windshield glass 17 mm wider than 1,686 mm, frame rails 25 to 30 mm outboard of the sheet's points "
                       "(docs/wiring/twin/body_check_v3.json, branch wiring/twin-real-engine, 2026-09-29). Fore-aft at the firewall the body model is "
                       "uncertain by about \u00b1100 mm (harness-cad's engine-bay sample, 2026-09-29: the passenger head pokes through it by up to 18 mm); "
                       "tape items T-05, T-06 and T-14 calibrate it"}


# ---------------------------------------------------------------- workspace: names, decisions and findings
# display names for the registry's subsystem codes (the code stays the id; these are labels)
SUB_NAME = {"CORE_ENGINE": "Engine management", "LIGHTING_EXTERIOR": "Exterior lighting", "POWER_WINDOWS": "Power windows",
            "DASH_CLUSTER_DAKOTA": "Instrument cluster (Dakota)", "CHARGING_STARTING": "Charging and starting", "AUDIO": "Audio",
            "TRANS_6L90": "Transmission (6L90)", "HVAC_AC": "Heating and A/C", "HARNESS_INFRA": "Power distribution and grounds",
            "BRAKES_IBOOSTER": "Brakes (iBooster)", "COOLING": "Cooling", "ACCESSORY_12V": "12 V accessories",
            "LIGHTING_INTERIOR": "Interior lighting", "WIPERS_WASHER": "Wipers and washer", "POWER_LOCKS": "Power locks",
            "CAMERA_REAR": "Rear camera", "EPARKING_BRAKE": "Electric parking brake", "AMP_STEPS": "Power steps",
            "FUEL": "Fuel", "DOME_COURTESY": "Dome and courtesy lamps"}

# registry plug-family codes, in words
FAMILY_WORD = {"ssc": "TE Superseal 1.0", "miniseal": "Raychem MiniSeal splice", "kit_terminal": "Maker's plug kit",
               "gm_blade": "GM blade terminal (Packard 56 / factory plug)", "ev1": "EV1 injector plug", "dt": "Deutsch DT", "dtp": "Deutsch DTP",
               "dtm": "Deutsch DTM", "lug": "Ring lug on a stud", "ring_small": "Small ring terminal", "mp150": "Delphi Metri-Pack 150",
               "gt150": "Delphi GT 150", "screw_terminal": "Screw terminal", "d38999_20": "MIL-DTL-38999 Series III, size 20 contacts",
               "xlr_solder": "XLR, solder cups", "te_amp_plug": "TE AMP plug", "contura": "Carling Contura switch", "open": "Not picked yet",
               "none": "No plug (wire to wire)"}

# ends that are one physical device with another end (the tree groups them; drawing is unchanged)
DEVICE = {"M130-A": ("M130", "MoTeC M130 engine computer"), "PDM30-A": ("PDM30", "MoTeC PDM30 power module, cab"),
          "PDM15-A": ("PDM15", "MoTeC PDM15 power module, engine bay"),
          "FIREWALL-CABIN": ("61-PIN", "61-pin firewall connector pair (D38999 shell 25, insert 61)")}
DEVICE_MEMBER = {"FIREWALL-ENGINE": "FIREWALL-CABIN"}

# what needs Skylar's money or hands (the pieces lane, 2026-09-29: engineering calls are the system's, not his or a builder's)
DECISIONS_SRC = "pieces lane, 2026-09-29 (money and hands only)"
DECISIONS = [
    {"n": 1, "title": "Proportioning valve part number", "who": "Skylar", "need": "hands",
     "text": "Which proportioning valve is on the truck (part number off the valve body).", "rel": ["c:BRAKE-WARN-SW"],
     "rel_note": "Its warning switch is BRAKE-WARN-SW: one wire to a PDM15 input, the valve body as the ground return."},
    {"n": 2, "title": "Engine-bay power box (PDM32)", "who": "Skylar", "need": "money",
     "text": "Buy the sealed PDM32 for the engine bay once the ends it feeds are modelled in 3D. It takes the 13 loads that have no firewall path.",
     "rel": ["c:PDM15-A"], "rel_note": "Firewall plan (docs/wiring/research/2026-09-30_firewall-allocation.md): proposed, recount pending."},
    {"n": 3, "title": "Rotate the flagged key", "who": "Skylar", "need": "hands", "text": "Rotate the key flagged on 2026-09-29, if it is not done yet.", "rel": [],
     "rel_note": "Not a harness record."},
]

# the firewall plan (docs/wiring/research/2026-09-30_firewall-allocation.md, merged in #436): the design state, not a question
FIREWALL_PLAN = {
    "label": "proposed, recount pending",
    "why_label": "It stays proposed until the recount with future add-ons picks between the 61-contact insert (25-61) and the 128-contact one (25-35).",
    "insert": "D38999/24WJ61SN receptacle and /26WJ61PN plug, insert 25-61 (61 size-20 contacts)",
    "fill": [["Engine management (M130 to the engine)", 50], ["Dakota gauge senders", 5], ["CAN", 2], ["Fan PWM command", 1],
             ["Isolator remote switch (ISO_SW_PWR, ISO_CLOSE, ISO_OPEN)", 3]],
    "total": "61 of 61",
    "summary": "The 61-pin carries 50 engine-management wires, 5 Dakota gauge senders, 2 CAN wires, the fan PWM command and the isolator switch's 3 wires: 61 of 61.",
    "upgrade_short": "The upgrade path is the same shell with insert 25-35, 128 contacts.",
    "upgrade": "Same shell, plate and hole with insert 25-35: 128 size-22D contacts (D38999/24WJ35SN, /26WJ35PN); about 70 cavities stay spare. "
               "The ETB motor pair (20 AWG) needs its own answer there.",
    "moved": ["85a", "85b", "86a", "86b", "WIPER_T1", "WIPER_T3", "BLOWER_BAT", "BLOWER_MED", "BLOWER_M2", "ISO_CLOSE", "ISO_OPEN", "ISO_LED", "ISO_SW_PWR"],
    "moved_text": "The 13 wires with no firewall path become cab switch inputs driving engine-bay PDM outputs over CAN; the bay box is a sealed PDM32. "
                  "The isolator switch's 3 copper wires take the 61-pin's 3 spares; its state lead (ISO_LED) reaches the dash over CAN.",
    "source": "docs/wiring/research/2026-09-30_firewall-allocation.md (main, #436)",
}

# what harness-cad's engine-bay sample found (the K5 Engine Bay Sample page, 2026-09-29), kept here when that page retires
BAY_SRC = "harness-cad, K5 Engine Bay Sample page (2026-09-29)"
BAY_FINDINGS = [
    ("The 61-pin may hit the iBooster: in the model the plate overlaps the booster by about 62 x 48 mm on the engine side. Neither position is "
     "measured yet; tape items T-01 to T-04 settle it.", ["c:FIREWALL-ENGINE", "c:IBOOSTER"]),
    ("The body model's firewall is uncertain by about ±100 mm, front to back; the passenger head pokes through it by up to 18 mm. The published "
     "Mitchell dimensions and tape items T-05, T-06 and T-14 calibrate it.", []),
    ("A sealed PDM32 in the bay takes 4 AWG at most: its power input is a 1-pin Autosport for 6 or 4 AWG (MoTeC PDM manual p.42), so the 2 AWG bay "
     "feed would drop to 4 AWG.", ["c:PDM15-A"]),
    ("Six runs pass within 150 mm of the exhaust: the starter feed, block ground, amp feed and ground, the H3 pair and the engine trunk. Each gets "
     "DR-25 and heat sleeve, clamped every 12 in.", []),
    ("The amp cables to the back ride the outside of the driver frame rail, because the exhaust tail runs inside that rail's channel.", []),
    ("Still drawn as outlines in the bay model: the distribution stud, the ground star and the iBooster, until their sizes are sourced; the coils "
     "are in a placeholder grid until the DEL-Stributor circle replaces it.", ["c:IBOOSTER"]),
]
BAY_STATS = [("Rule checks", "395 pass, 0 fail", "bend radius, exhaust gap, clamp spacing, fan and belt clearance; the power pair through H3 is the labelled exception"),
             ("DC primary", "15 cables", "ProWire diameters: 2 AWG 9.85 mm, 4 AWG 7.92 mm, 6 AWG 6.35 mm"),
             ("Engine loom trunk", "54 wires, 12.7 mm", "from the 61-pin down to single 1.3 mm drops"),
             ("Clamps", "79", "every 18 in or less (ABYC E-11), 12 in near the exhaust")]
