#!/usr/bin/env python3
"""Curated 'where on the truck' records for every live registry endpoint -> YAML block `ends:` for catalog/mounts.yaml.

Rules (same as the boxes): plain words first; every reason carries its source; a spot nobody has measured says so.
status: fixed_by_engine (set by the LS3, transmission or transfer case: the part only fits one place)
        decided (the factory spot kept, a bought kit's own spot, a locked row or an owner call)
        proposed (agent pick, owner can replace) | open (needs a call or a measurement) | flag (breaks a maker's rule)
"""
import json, sys
import yaml

WT = "/Users/skylar/.worktrees/part-media"
SWAP = "reference_documents/component_drawings/Swap_Specialties_LS_Installation_Instructions.pdf"
GM60 = "reference_documents/component_drawings/NHTSA_GM_6.0L_Sensor_Locations.pdf"
EROD = "reference_documents/component_drawings/LS3_EROD_Installation_Guide.pdf"
LTSM = "reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf"
ST352 = "reference_documents/wiring_diagram_booklets/ST_352_78_CK_Wiring.pdf"
HFIT = "reference_documents/component_drawings/holley_midmount_fitment.pdf"
DAK = "reference_documents/component_drawings/dakota_digital_vhx_manual.pdf"
AMPR = "reference_documents/component_drawings/amp_research_75146_install.pdf"
STATE = "docs/wiring/K5_WIRING_STATE.md"
REG = "docs/wiring/calc-data/catalog/endpoints.yaml"
BOXES = "docs/wiring/calc-data/catalog/mounts.yaml (boxes)"

ENDS = []


def E(id_, what, where, zone, status, why, open_=None, follows=None):
    r = {"id": id_, "what": what, "where": where, "zone": zone, "status": status}
    if follows:
        r["follows"] = follows
    r["why"] = [{"text": t, "source": s} for t, s in why]
    if open_:
        r["open"] = list(open_)
    ENDS.append(r)


# ------------------------------------------------------------------ the LS3's own sensor bosses
NUMBERING = ("GM numbers a V8's cylinders from the front: 1, 3, 5 and 7 on the left (driver) bank, 2, 4, 6 and 8 on the right.",
             LTSM + " p.518")
E("CKP", "Crank sensor (58x, grey plug)", "Passenger side of the block, behind the starter", "engine", "fixed_by_engine",
  [("\"The sensor is a 3 pin plug located behind the starter on the passenger side of the block. ... 58x engines have a GREY connector.\"", SWAP + " p.5"),
   ("GM's 6.0L (Gen IV) sensor sheet shows the crankshaft sensor on the engine's right-hand view.", GM60 + " p.2, Fig. 2")])
E("CMP", "Cam sensor", "Front of the engine, driver side of the timing cover, mid to upper", "engine", "fixed_by_engine",
  [("\"On 58x engines the factory location is in the front of the block on the mid to upper driver side timing chain cover.\"", SWAP + " p.5"),
   ("GM's 6.0L sensor sheet shows the camshaft sensor on the engine's left-hand view.", GM60 + " p.1, Fig. 1")])
for n, side, bank, cyl, fig in (("1", "Driver", "1", "1, 3, 5, 7", "p.1, Fig. 1 (left-hand view)"), ("2", "Passenger", "2", "2, 4, 6, 8", "p.2, Fig. 2 (right-hand view)")):
    E("KNOCK-" + n, "Knock sensor, bank " + bank, side + " side of the block (bank " + bank + ": cylinders " + cyl + ")", "engine", "fixed_by_engine",
      [("\"Gen 4 58x Located on Side of Block\".", SWAP + " p.4"),
       ("GM's 6.0L sensor sheet shows a knock sensor on this side.", GM60 + " " + fig),
       ("Bank " + bank + " is cylinders " + cyl + ".", SWAP + " p.4 (O2 bank 1 = cylinders 1, 3, 5, 7)"),
       NUMBERING])
E("CLT-ECU", "Coolant temperature sensor for the M130", "Front of the driver-side cylinder head", "engine", "fixed_by_engine",
  [("\"The ECT sensor is located in the front of the driver side cylinder head ... the same location on all LS style engines.\"", SWAP + " p.6"),
   ("GM's 6.0L sensor sheet shows the coolant temperature sensor on the engine's left-hand view.", GM60 + " p.1, Fig. 1")])
E("DAK-CTS", "Dakota temperature sender (SEN-04-5)", "Rear of the passenger-side cylinder head, in its spare port", "engine", "proposed",
  [("\"There is a port in the back of the Passenger head you can use for your Temp Gauge!\" It keeps the gauge sender off the M130's sensor.", SWAP + " p.6"),
   ("The sender is 1/8 NPT, two-wire.", DAK + " p.9 (650314:P)")],
  ["The port's thread against the sender's 1/8 NPT (adapter or not): read it on the head."])
E("OILP-ECU", "Oil pressure sensor for the M130 (Gen IV round 3-pin)", "Upper rear of the engine, in the factory oil pressure port", "engine", "fixed_by_engine",
  [("\"... the existing oil pressure sensor location at the upper rear of the engine ...\"", EROD + " p.7"),
   ("GM's 6.0L sensor sheet shows the oil pressure sensor on the engine's right-hand view.", GM60 + " p.2, Fig. 2")])
E("DAK-OILP", "Dakota oil pressure sender (SEN-03-8)", "Not placed: a tee at the factory oil pressure port, or a port on the oil cooler adapter", "engine", "open",
  [("The factory port is at the upper rear of the engine and already holds the M130's sensor.", EROD + " p.7"),
   ("The Dakota gauge needs its own sender.", DAK + " p.9 (650314:P)")],
  ["Pick the tee or a cooler-adapter port."])
E("OILT", "Oil temperature: GM's oil level and temperature sensor, already in the LS3's oil pan", "Passenger side of the oil pan, on a boss just behind and below the right knock sensor", "engine", "fixed_by_engine",
  [("The engine as bought carries a tan sensor threaded into a boss on the passenger side of the oil pan; the only sensor on top of the engine is the oil pressure sensor at the rear of the valley cover.", "K5 photos 2024-08-24 (vehicle_images 9365b1d0, zoomed) and 2024-08-25 (vehicle_images 8e79c104, the top seen from behind)"),
   ("Gen IV LS3 pans carry a 3-wire oil level and temperature sensor; its port is M20-1.5.", "ebay.com/itm/153376028423 and nzefi.com GM Gen IV LS2/LS3 oil level & temp sensor connector (fetched 2026-09-29); ICT Billet 551413 plug listing, M20-1.5"),
   ("One forum says the pan sensor reads level only and the car models oil temperature, so the part number decides it.", "camaro5.com/forums/showthread.php?t=333771 (search snippet, 2026-09-29)")],
  ["Read the part number off the sensor body: it settles whether it has a temperature element the M130 can read.",
   "The registry names a GT150 2-way plug for OILT; the factory sensor takes a 3-way plug. The registry owner decides.",
   "If it reads level only, a separate oil temperature sensor goes in a tee at the top-rear oil pressure port (with the Dakota sender)."])

# ------------------------------------------------------------------ intake, throttle, fuel, spark
E("MAP", "MAP sensor (Holley 538-24, 1 bar)", "Off the engine, bolted by its two ears near the rear of the intake, on a short vacuum hose to the intake's MAP port", "engine", "proposed",
  [("Holley recommends the 538-24 for both its LS intake families.", "Holley 199R10689 (300-129/130) and 199R10690 (300-131/132/136/137)"),
   ("The 300-129 has a 1/8 NPT MAP port; the 300-131/136 sheet lists only a 3/8 NPT vacuum port.", "Holley 199R10689 and 199R10690, Dimensions"),
   ("MoTeC's Delco MAP drawing gives the pins: A 0 V, B signal, C +5 V.", "MoTeC WD 53000-53003 (drawing X18)")],
  ["Which Holley intake is on the engine (state 0ag(g)) sets the port and the hose barb.", "The bracket spot: read it at the mock-up."])
E("IAT", "Intake air temperature sensor (GM 12160244)", "In the air inlet tube ahead of the throttle body, pushed into a GM 24504388 grommet", "engine", "proposed",
  [("The GM 24504388 grommet \"is used with the LS1 Camaro/Firebird air boxes. An excellent solution for engine swaps when a custom air intake is used.\"", "eficonnection.com, Grommet GM# 24504388"),
   ("12160244 is the sensor that fits the registry's GT150 plug (15449027).", "docs/wiring/calc-data/catalog/part_media.yaml IAT")],
  ["The inlet tube is not built: the hole goes in it once it is."])
E("TB", "Throttle body (GM 12699160)", "On the intake's carburettor flange, through the Delmo 4-bolt adapter", "engine", "decided",
  [("Delmo Speed shipped an \"LS3 4-Bolt Throttle Body Adapter\" in October 2024.", "vehicle_observations parts_purchase (Delmo Speed, 2024-10-02)"),
   ("The 2026-02-01 photo shows the throttle body set on the intake for the mock-up; it is not bolted down.", "vehicle_observations device proof TB (2026-09-27)")],
  ["The mounting bolts were never found (owner)."])
for i in range(1, 9):
    bank = "driver" if i % 2 else "passenger"
    E("INJ-%d" % i, "Injector %d (Siemens Deka FI114961)" % i, "Intake runner for cylinder %d, %s bank, under the fuel rail" % (i, bank), "engine", "fixed_by_engine",
      [NUMBERING,
       ("The Holley receipt includes 534-209 fuel rails, and the owner's photos show the rails on the intake.", STATE + " 0ag(g)")],
      ["Which intake is on the engine (state 0ag(g)): an injector needs a port-EFI intake's boss."])
for i in range(1, 9):
    E("COIL-%d" % i, "Ignition coil %d (ACDelco D510C)" % i, "On the DEL-Stributor bracket at the rear centre of the intake, with the other seven", "engine", "decided",
      [("Coil bracket: DEL-Stributor, central mount, 8 x D510C (locked).", STATE + " §1 row 30"),
       ("The coils mount on the central DEL-Stributor bracket, not the valve covers.", "vehicle_observations device proof COIL-1 (withdrawn row)")],
      ["Which coil sits where in the cluster: read it off the bracket."])
E("RAIL-COIL_PWR", "Coil power rail (16 AWG, daisy-chained)", "Along the coil cluster on the DEL-Stributor bracket", "engine", "proposed",
  [("It is daisy-chained to the 8 coil power pins.", REG + " RAIL-COIL_PWR")], follows="COIL-1")
E("RAIL-INJ_PWR", "Injector power rail (16 AWG, daisy-chained)", "Along the fuel rails, one tap per injector", "engine", "proposed",
  [("It is daisy-chained at the fuel rail to the 8 injector pin 1s.", REG + " RAIL-INJ_PWR")], follows="INJ-1")
E("COIL-GROUND-RINGS", "Ring terminals for the coil grounds", "Back of the cylinder heads, one bolt position on each", "engine", "proposed",
  [("\"This eyelet needs to be fastened to the back of the cylinder head.\"", SWAP + " p.4"),
   ("Dave's sheet runs the coil a and b grounds to a head ring terminal.", REG + " COIL-GROUND-RINGS")],
  ["The bolt and thread at the head set the ring size (RING-SMALL is open)."])
E("FUELP", "Fuel pressure sensor (AEM 30-2131-100, 1/8 NPT)", "Not placed: a 1/8 NPT port on the fuel rail or the regulator", "engine", "open",
  [("The sensor is 1/8 NPT.", REG + " FUELP"),
   ("The spot behind the intake that the DEL-Stributor needs holds the Aeromotive regulator in photo IMG_6531.", STATE + " 0ag(h)")],
  ["Where the regulator ends up decides the port."])
E("ALTERNATOR-SENSE", "Alternator (Holley 197-302), sense plug", "Driver side of the engine, on the Holley mid-mount bracket", "engine", "decided",
  [("\"The Holley driver's side bracket uses standard alternators with 5.46\" bolt spacing.\"", HFIT + " p.15"),
   ("Mounted on the Holley mid-mount drive with the belt on.", "vehicle_observations device proof ALTERNATOR-SENSE")])
E("STARTER-S", "Starter (trigger terminal)", "Passenger side of the block", "engine", "fixed_by_engine",
  [("The crank sensor sits \"behind the starter on the passenger side of the block\", which puts the starter on the passenger side.", SWAP + " p.5")],
  ["The starter model is not recorded."])
E("AC-CLUTCH", "A/C compressor clutch (Sanden SD7)", "Passenger side of the engine, on the Holley mid-mount A/C bracket", "engine", "open",
  [("Holley's mid-mount A/C bracket is the passenger's side bracket.", HFIT + " p.7, p.10"),
   ("The Holley mid-mount A/C bracket is in a box in the truck (kit mix-up being resolved).", STATE + " §1 row 52")],
  ["The bracket is not on the engine yet; its fit with the SD7 is unconfirmed."])
E("AC-HP-SW", "A/C high-pressure switch", "On the A/C liquid line", "engine", "open",
  [("It is the liquid-line switch.", REG + " AC-HP-SW")], ["The A/C lines are not plumbed: the spot follows them."])
E("AC-LP-SW", "A/C low-pressure switch", "On the accumulator", "engine", "open",
  [("It is the accumulator switch.", REG + " AC-LP-SW")], ["The accumulator's spot is not set."])
E("FAN", "Radiator fan (SPAL 30107090, 16 in brushless puller)", "On the engine side of the radiator core", "engine", "decided",
  [("It is a drop-in puller for the radiator.", REG + " FAN")])
E("FAN-JUNCTION", "Fan feed junction (Blue Sea 2103 PowerPost)", "Near the engine power box, where the fan leads break out", "engine", "open",
  [("It joins the two 12 AWG feed legs from the engine power box to the fan's one terminal.", REG + " FAN-JUNCTION")],
  ["It follows the engine power box, which is flagged."], follows="PDM15")
E("IBOOSTER", "Brake booster (Bosch iBooster Gen 1)", "Driver side of the firewall, on the factory booster pad", "engine", "decided",
  [("Installed: driver firewall, factory pad, adapter and custom master cylinder, twin reservoirs.", STATE + " §4 (iBooster footprint, confirmed 2026-06-09)")])
E("IBST-DIAG", "iBooster diagnostic port (DTM 4-way)", "Beside the booster, reachable with the hood up", "engine", "proposed",
  [("A sealed port near the booster for a USB CAN logger.", REG + " IBST-DIAG")])
E("BRAKE-FLUID-LVL", "Brake-fluid level sensor (candidate)", "In the iBooster's fluid reservoir", "engine", "proposed",
  [("The sensor is part of the booster's reservoir.", REG + " BRAKE-FLUID-LVL")], ["It is an option, not decided."])
E("BRAKE-WARN-SW", "Brake warning switch on the proportioning valve (one wire)", "On the proportioning valve, on the front crossmember under the radiator where the brake lines meet", "engine", "proposed",
  [("Owner 2026-09-29: \"proportioning valve has a sensor on it a one wire situtation ... its mounted on a cross member under the radiator where all the brake lines go\".", "owner, 2026-09-29"),
   ("The switch grounds through the valve body: jumpering its wire to ground lights the brake warning lamp.", LTSM + " PDF p.406 (Testing Electrical Circuit of Combination Valve)"),
   ("It is read on the engine PDM15, next to the valve, with no firewall crossing.", REG + " BRAKE-WARN-SW")],
  ["Which valve is on the truck and its part number: read the valve body.", "Its exact spot on the crossmember: from the owner's photos or the brake-line render."])
E("WIDEBAND", "Lambda controller (MoTeC LTCD) and two sensors", "Under the truck, on the inside of a frame rail near the two O2 bungs", "underbody", "proposed",
  [("See the LTCD box.", BOXES + " LTCD")], ["The exhaust is not built, so the bungs are not placed."], follows="LTCD")

# ------------------------------------------------------------------ front lamps, horn, cowl, heater box
E("HEADLIGHT-L", "Left headlight (Truck-Lite 27270C, 7 in round)", "Front, left headlamp bucket; the plug is at the back of the lamp, engine side", "engine", "decided",
  [("Front lighting, C-K models: the headlamp in its bezel.", LTSM + " p.785, Fig. 8-3"),
   ("\"Disconnect wiring harness connector located at rear of unit in engine compartment.\"", LTSM + " p.786")])
E("HEADLIGHT-R", "Right headlight (Truck-Lite 27270C)", "Front, right headlamp bucket; the plug is at the back of the lamp, engine side", "engine", "decided",
  [("Front lighting, C-K models: the headlamp in its bezel.", LTSM + " p.785, Fig. 8-3"),
   ("\"Disconnect wiring harness connector located at rear of unit in engine compartment.\"", LTSM + " p.786")])
for side, s in (("L", "left"), ("R", "right")):
    E("PARK-TURN-%sF" % side, "%s front park/turn lamp (1157)" % s.capitalize(), "Front, %s, the rectangular parking lamp below the headlamp" % s, "engine", "decided",
      [("Front lighting, C-K models: the parking lamp sits below the headlamp.", LTSM + " p.785, Fig. 8-3"),
       ("Parking lamp: \"Remove two screws and parking lamp lens ... Remove housing stud nuts and remove housing with pigtail.\"", LTSM + " p.786")])
    E("MARKER-%sF" % side, "%s front side marker" % s.capitalize(), "Front fender, %s side, the side marker lamp" % s, "engine", "decided",
      [("Front lighting, C-K models: the side marker on the fender.", LTSM + " p.785, Fig. 8-3"),
       ("Front side marker lamp replacement.", LTSM + " p.786")])
E("HORN", "Horn (factory)", "On the radiator support", "engine", "decided",
  [("The front sheet metal comes off \"with radiator, battery, horn and voltage regulator attached\".", LTSM + " p.121")],
  ["Which side of the support: read it on the truck."])
E("WIPER-MOTOR", "Wiper motor (factory 2-speed)", "On the cowl, engine side of the firewall, at the factory wiper hole", "engine", "decided",
  [("The factory 2-speed wiper motor, its terminal board and park switch.", LTSM + " p.802-803, p.810"),
   ("The factory wiper motor hole is under the cowl.", "nuke_frontend/src/components/wiring/objectTraits.ts factory_holes WP")])
E("WASHER-PUMP", "Washer pump (factory, on the wiper motor)", "On the factory wiper motor at the cowl, engine side; its solenoid takes its own 2-way plug, and soft tube runs jar to pump and pump to nozzles", "engine", "decided",
  [("Owner 2026-09-29: \"the factory wiper does have the washer motor built into it which means we just need to make sure we use the correct connectors in the harness ... the correct soft tube\".", "owner, 2026-09-29"),
   ("Figure 8-16 shows the assembly of the washer pump on the wiper motor.", LTSM + " p.803, Fig. 8-16 (Washer Mechanism Mounting on Wiper)"),
   ("The washer solenoid plugs in with a 2-way connector, 12004622, on circuits 94 (18 DK BLU) and 93B (18 YEL/BLK); the wiper motor's own 3-way is 8917544.", "ST-352-78 1978 C/K wiring booklet, fold-out A-1 'Cab, Engine and Chassis Wiring' (reference_documents/wiring_diagram_booklets/pages/1978_CK_A1_cab_engine_chassis_main.png), the closest year on file to the '77; read at the WASH SOL and WIPER MOTOR callouts"),
   ("Soft tube: LMC 36-4070 (jar to pump, 9 ft) and 36-4071 (pump to nozzle, 12 ft), $4.95 each, or Classic Parts 67-865, a 1973-84 hose kit, $11.95. The 1973-77 replacement pump is LMC 36-4078, $109.95.", "lmctruck.com '1973-84 Windshield Wiper and Washer' and classicparts.com 67-865 (snapshots fetched 2026-09-29)")],
  ["The hose numbers are reproduction parts; no GM hose number was found.",
   "Whether the pump on the truck's own motor still works: bench-test it before buying LMC 36-4078.",
   "The registry still lists the Hella 8TW 004 223-031 pump and tank (wire 50's terminal and the OUT26 current note in reconcile_v5.py); the registry owner re-points them."], follows="WIPER-MOTOR")
E("BLOWER-MOTOR", "Blower motor (4 Seasons 35587)", "In the Four-Season blower-evaporator case, engine side of the passenger firewall", "engine", "decided",
  [("The factory Four-Season housing is kept.", STATE + " §1 row 40"),
   ("The retained A/C box mounts at the passenger firewall corner.", "docs/wiring/receipts/2026-09-29_where-each-box-goes.md, finding 3")])
E("BLOWER-RES", "Blower resistor (factory)", "On the blower-evaporator case, engine side of the passenger firewall", "engine", "decided",
  [("\"The blower motor resistor is located in the blower ... case\"; the relay is \"on the blower side of the blower-evaporator case\".", LTSM + " p.87-88"),
   ("The retained A/C box mounts at the passenger firewall corner.", "docs/wiring/receipts/2026-09-29_where-each-box-goes.md, finding 3")])
E("UNDERHOOD-LAMP", "Underhood lamp", "Not placed: the factory spot was not found in the 1977 manual text", "engine", "open",
  [("The registry has a factory underhood lamp with one feed lead and a 93 bulb.", REG + " UNDERHOOD-LAMP")],
  ["Read the factory spot on the truck, or pick one under the hood."])

# ------------------------------------------------------------------ batteries, power, the engine power box
for k, w in (("ODYSSEY", "Running battery (Odyssey AGM)"), ("ACC-BATT", "Accessory battery (Optima YellowTop)")):
    E(k, w, "Engine bay, in the battery corner (the working position is the passenger firewall corner)", "engine", "open",
      [("See the BATTERIES box.", BOXES + " BATTERIES")], ["The battery corner conflicts with the Four-Season box: see the BATTERIES box."], follows="BATTERIES")
E("ISOLATOR", "Battery isolator (Blue Sea 7700)", "Engine bay, on the Odyssey's positive cable as close to the battery as it fits", "engine", "decided",
  [("See the ISOLATOR box.", BOXES + " ISOLATOR")], follows="ISOLATOR")
E("DCDC", "DC-DC charger (Victron Orion-Tr 12/12-30)", "By the batteries in the current design, which breaks Victron's rule", "engine", "flag",
  [("See the DCDC box.", BOXES + " DCDC")], ["Victron: keep it dry. See the DCDC box."], follows="DCDC")
E("GND-BANK-ENG", "Engine ground star (stud bank)", "Beside the batteries", "engine", "open",
  [("The ground star is a stud bank beside the batteries: both battery negatives, the block and the frame land on it.", STATE + " §1 (grounds run in the loom, 2026-09-27)")],
  ["It follows the batteries, which are open."], follows="BATTERIES")
E("PS-STUDS", "DC primary cable ends", "At the batteries, the isolator, the distribution stud, the starter, the alternator, the block, the frame and the power boxes", "engine", "open",
  [("The DC primary table lists each cable end.", "build book 'DC primary' table; " + STATE + " 0i")],
  ["They follow the batteries and the power boxes."], follows="BATTERIES")
for k, what in (("FUSE-IBOOST_PERM", "In-line fuse, iBooster permanent feed"), ("FUSE-ISO_PWR", "In-line fuse, isolator power"), ("FUSE-ISO_SW_PWR", "In-line fuse, isolator switch power")):
    E(k, what, "At the battery end of its feed, in the battery corner", "engine", "proposed",
      [("A fuse goes at the source end of the wire it protects.", "docs/wiring/research/2026-06-10_power_spine_builders_study.md §2")],
      ["It follows the batteries."], follows="BATTERIES")
for k in ("PDM15-A", "PDM15-B", "PDM15-STUD"):
    E(k, "Engine power box (MoTeC PDM15), " + {"PDM15-A": "plug A", "PDM15-B": "plug B", "PDM15-STUD": "battery stud"}[k],
      "In the engine bay in the current design, which breaks MoTeC's spec", "engine", "flag",
      [("See the PDM15 box: the PDM15 case is not sealed.", BOXES + " PDM15")], ["A sealed PDM16 or PDM32 in the bay, or the box moves to the cab."], follows="PDM15")
for k in ("SPL-PDM15-OUT1", "SPL-PDM15-OUT2", "SPL-PDM15-OUT3", "SPL-PDM15-OUT4", "SPL-PDM15-OUT5", "SPL-PDM15-OUT6", "SPL-PDM15-OUT7", "SPL-PDM15-OUT13"):
    E(k, "Pigtail splice at the engine power box (" + k.split("-")[-1] + ")", "At the engine power box's plug", "engine", "open",
      [("The splice sits a hand-width from the plug it serves.", REG + " " + k)], ["It moves with the engine power box."], follows="PDM15")

# ------------------------------------------------------------------ firewall crossings
for k in ("FIREWALL-ENGINE", "FIREWALL-CABIN"):
    E(k, "61-pin firewall connector, " + ("engine side (plug, pins)" if k == "FIREWALL-ENGINE" else "cab side (receptacle, sockets)"),
      "Driver side, in the original fuse-box hole, on a CNC'd adapter plate", "firewall", "decided",
      [("See the FIREWALL-61 box (owner call 2026-09-29).", BOXES + " FIREWALL-61"),
       ("The original fuse block punch-out is a 4 in hole at the driver kick panel.", "nuke_frontend/src/components/wiring/objectTraits.ts factory_holes FB")], follows="FIREWALL-61")
for k in ("FIREWALL-BODY-A", "FIREWALL-BODY-B", "FIREWALL-BODY-P"):
    E(k, "Deutsch body bulkhead " + k[-1], "Not used: nothing but the 61-pin goes through the firewall", "firewall", "flag",
      [("See the BODY-PASS box (Dave's rule, 2026-09-29).", BOXES + " BODY-PASS")],
      ["Its wires need a new path: the engine power box, the 61-pin, or a round bulkhead."], follows="BODY-PASS")
E("FIREWALL-BODY-C", "Speed sender cab exit (Deutsch DT 6-way)", "Floor or kick panel near the transfer case", "firewall", "open",
  [("It is the speed sender's cab exit; the hole is set at the mock-up.", REG + " FIREWALL-BODY-C")],
  ["The owner allows round bulkheads only; this is a rectangular DT. It could join the rear connector."], follows="REAR-CONN")
E("FIREWALL-GROMMET", "Power pass-through (battery feed and ground cables)", "Firewall, beside the batteries", "firewall", "open",
  [("These cables are too big for the 61-pin: its #20 contacts take 20-24 AWG.", STATE + " §1 row 43"),
   ("One CableClam per 2 AWG cable today.", REG + " FIREWALL-GROMMET")],
  ["Nothing but the 61-pin goes through the firewall (Dave), so the big cables need a ruled exception or another path."])

# ------------------------------------------------------------------ cab: boxes and their harness parts
for k, box in (("M130-A", "M130"), ("M130-B", "M130")):
    E(k, "Engine computer (MoTeC M130), plug " + k[-1], "Cab side, close to the 61-pin", "cab", "open",
      [("See the M130 box.", BOXES + " M130")], ["The spot follows the M130 box."], follows=box)
for k in ("PDM30-A", "PDM30-B", "PDM30-STUD"):
    E(k, "Body power box (MoTeC PDM30), " + {"PDM30-A": "plug A", "PDM30-B": "plug B", "PDM30-STUD": "battery stud"}[k],
      "Cab, in open air on its own plate near the M130", "cab", "open", [("See the PDM30 box.", BOXES + " PDM30")], ["The spot follows the PDM30 box."], follows="PDM30")
for k in ("SPL-PDM30-OUT1", "SPL-PDM30-OUT2", "SPL-PDM30-OUT3", "SPL-PDM30-OUT4", "SPL-PDM30-OUT5", "SPL-PDM30-OUT6", "SPL-PDM30-OUT7", "SPL-PDM30-OUT8"):
    E(k, "Pigtail splice at the body power box (" + k.split("-")[-1] + ")", "At the PDM30's plug", "cab", "open",
      [("The splice joins the paired output pins to one feed at the PDM30.", REG + " " + k)], ["It moves with the PDM30."], follows="PDM30")
E("GND-BANK-CAB", "Cab ground bank (insulated stud bus)", "Beside the PDM30", "cab", "open",
  [("Every cab return lands here and goes back to the ground star.", REG + " GND-BANK-CAB; " + STATE + " §1 (grounds in the loom)")], ["It follows the PDM30."], follows="PDM30")
for k in ("FUSE-DAK_CONST", "FUSE-PCS_BATT", "FUSE-TRANS_BATT"):
    E(k, "In-line fuse, " + k.split("-", 1)[1], "At the source end of its feed", "cab", "proposed",
      [("A fuse goes at the source end of the wire it protects.", "docs/wiring/research/2026-06-10_power_spine_builders_study.md §2")], ["The source end follows the power box that feeds it."], follows="PDM30")
E("PORT-ETH", "M130 laptop port (panel RJ45)", "Cab, under the dash or in the glovebox", "cab", "proposed", [("See the SERVICE box.", BOXES + " SERVICE")], follows="SERVICE")
E("PORT-UTC", "PDM config port (5-pin XLR)", "Cab, under the dash or in the glovebox", "cab", "proposed", [("See the SERVICE box.", BOXES + " SERVICE")], follows="SERVICE")
E("CAN-BUS", "CAN bus trunk", "M130 to PDM30 to the 61-pin to the engine power box to the LTCD, with the UTC stub", "cab", "open",
  [("The trunk order and the 100 ohm ends.", "MoTeC PDM user manual p.49-50; " + REG + " CAN-BUS")], ["It follows the boxes it links."], follows="M130")
E("SPL-ISO-YEL", "Isolator switch lamp-wire splice", "Behind the isolator's dash switch", "cab", "proposed",
  [("The M130 shutdown tap joins the switch's yellow wire here.", REG + " SPL-ISO-YEL")], follows="ISOLATOR")
E("ISO-SWITCH", "Isolator dash switch (Blue Sea 2145)", "Cab, on the dash", "cab", "decided",
  [("See the ISOLATOR box: the dash switch goes in the cab.", BOXES + " ISOLATOR")], ["The exact dash spot is not picked."], follows="ISOLATOR")

# ------------------------------------------------------------------ cab: factory controls
E("APS", "Accelerator pedal (DBW)", "Driver footwell, on the firewall where the factory pedal was", "cab", "decided",
  [("The pedal bought is sold as '72-98 C10 Square Body OBS LS Swap DBW', a bolt-in for this body.", REG + " APS (eBay listing)")])
E("BRAKE-SW", "Brake light switch (factory)", "At the brake pedal, on the pedal bracket", "cab", "decided",
  [("The stoplamp switch is adjusted at the brake pedal.", LTSM + " p.408, Fig. 5-13"),
   ("Stoplamp switch: see Section 5 (Brakes).", LTSM + " p.790")])
E("FLOOR-DIMMER", "Headlamp dimmer switch (factory floor switch)", "On the floor under the upper left corner of the floor mat, at the driver's left foot", "cab", "decided",
  [("Headlamp beam selector switch: \"Fold back upper left corner of the floor mat and remove two screws retaining switch to the floor pan.\"", LTSM + " p.787"),
   ("Dimmer switch diagnosis and wiring.", LTSM + " p.779-780")])
E("HL-SW", "Headlight switch (factory push-pull)", "Instrument panel, behind the cluster, knob through the dash", "cab", "decided",
  [("Light switch removal: \"Reaching up behind instrument cluster, depress shaft retaining button and remove switch knob and rod.\"", LTSM + " p.787")])
E("TURN-SW", "Turn and hazard switch (factory)", "In the steering column; its plug is at the column connector under the dash", "cab", "decided",
  [("The turn signal switch is in the steering column, wired through the column connector.", LTSM + " p.783-784"),
   ("The hazard switch is a push-pull \"on the right side of the steering column\".", LTSM + " p.802")])
E("HORN-SW", "Horn button (factory)", "Steering wheel centre, grounding through the column", "cab", "decided",
  [("The horn button cap on the steering wheel.", LTSM + " p.227-228")])
E("IGN-SWITCH", "Ignition switch (factory)", "On top of the steering column jacket, near the front of the dash", "cab", "decided",
  [("\"The ignition switch is mounted on top of the column ... jacket near the front of the dash\" (C and K Series).", LTSM + " p.241")])
E("WIPER-SW", "Wiper and washer switch (factory)", "Instrument panel", "cab", "decided",
  [("The factory wiper/washer dash switch grounds through its mounting.", LTSM + " p.803")])
E("BLOWER-SW", "Blower switch (factory Four-Season control head)", "Instrument panel, in the heater and A/C control head", "cab", "decided",
  [("The Four-Season system's blower switch and control.", LTSM + " p.87-88"),
   ("The factory Four-Season housing is kept.", STATE + " §1 row 40")])
E("DAKOTA-VHX", "Gauge control box (Dakota VHX)", "Cab, driver side under the dash, within 3 ft of the cluster", "cab", "decided",
  [("See the DAKOTA box.", BOXES + " DAKOTA"),
   ("\"Mount the control box within reach of the supplied networking cable (approximately three (3) feet).\"", DAK + " p.4")], follows="DAKOTA")
E("RADIO", "Radio (RetroSound Motor 2B)", "Instrument panel, in the factory radio opening", "cab", "decided",
  [("The RetroSound unit is made for 1973-87 C/K trucks.", REG + " RADIO")])
E("GSS-3000", "Gear shift sender decoder (Dakota GSS-3000)", "Under the dash", "cab", "proposed",
  [("The decoder goes under the dash; its sensor sits on the transmission.", REG + " GSS-3000 (Dakota GSS-3000 MAN# 650715:G)")])
E("PCS-TCM", "Transmission controller (PCS TCM-2650)", "Cab, under the dash (spot not picked)", "cab", "open",
  [("The kit harness runs from the controller in the cab to the case connector.", REG + " PCS-HARNESS-4610-CASE")], ["Pick the spot, dry and away from heat."])
E("PCS-HARNESS-4610", "Transmission controller harness (PCS TCM-4610 kit)", "From the controller in the cab to the 6L90 case connector", "cab", "open",
  [("The kit harness plugs into the controller and runs to the case.", REG + " PCS-HARNESS-4610")], ["It follows the controller."], follows="PCS-TCM")
E("MIRROR-MON", "Mirror monitor (Rear View Safety kit)", "Windshield, in place of the rear-view mirror", "cab", "decided",
  [("The kit's replacement rear-view mirror carries the display.", REG + " MIRROR-MON")])
for k, w in (("OUTLET-12V", "12 V outlet"), ("USB-PORT", "USB charging port")):
    E(k, w, "Not placed: dash or console", "cab", "open", [("The registry has the outlet but no spot.", REG + " " + k)], ["Pick the spot."])
for k, s in (("CLEARANCE-L", "left"), ("CLEARANCE-C", "centre"), ("CLEARANCE-R", "right")):
    E(k, "Roof clearance lamp, " + s, "Cab roof, " + s, "cab", "open",
      [("The registry has three cab-roof clearance lamps.", REG + " " + k),
       ("Clearance and identification lamp installations are in the factory figures.", LTSM + " p.787 (\"Refer to Figures 8-7 through 8-10 for clearance, license plate and identification lamp installations\")")],
      ["The K5 has a removable top: where on it the lamps sit is not set."])
E("DOME-LAMP", "Dome lamp", "Roof, inside", "cab", "decided",
  [("The dome and courtesy lamp circuits switch on the ground side.", LTSM + " p.833")])
for side, s in (("L", "driver"), ("R", "passenger")):
    E("DOOR-JAMB-" + side, "Door jamb switch, " + s + " (factory pin switch)", "In the " + s + " front door jamb", "cab", "decided",
      [("The jamb switches are in the ground side of the dome and courtesy lamp circuits.", LTSM + " p.833")])
E("FOOTWELL-LAMPS", "Footwell lamps (Lumitec Mini Rail2)", "Under the dash, one in each footwell", "cab", "proposed", [("An owner-chosen LED strip.", REG + " FOOTWELL-LAMPS")])
E("UNDERDASH-LAMPS", "Under-dash lamps (Lumitec Mini Rail2)", "Under the dash", "cab", "proposed", [("An owner-chosen LED strip.", REG + " UNDERDASH-LAMPS")])
E("TG-SW-DASH", "Tailgate window switch (factory dash switch)", "Instrument panel", "cab", "decided",
  [("Power rear window: the dash switch.", ST352 + " p.16, sheet A-4")])
E("TG-SW-MASTER", "Tailgate window master switch (Nu-Relics #121)", "Instrument panel", "cab", "decided",
  [("The Nu-Relics reverse-polarity dash switch (option #121).", REG + " TG-SW-MASTER")])

# ------------------------------------------------------------------ doors
for side, s in (("L", "driver"), ("R", "passenger")):
    E("DOOR-%s-PASS" % side, s.capitalize() + " door pass-through (locks and speaker, DT 8-way)", "At the " + s + " door's hinge side, body to door", "doors", "proposed",
      [("The DT 8-way that carries the locks and the speaker across the hinge.", REG + " DOOR-%s-PASS" % side)])
    E("DOOR-%s-PASS-P" % side, s.capitalize() + " door pass-through (window power, DTP 4-way)", "At the " + s + " door's hinge side, body to door", "doors", "proposed",
      [("The DTP 4-way that carries the window power across the hinge.", REG + " DOOR-%s-PASS-P" % side)])
    E("LOCK-SW-" + side, s.capitalize() + " lock rocker", "In the " + s + " door panel", "doors", "decided", [("The Nu-Relics door switch panel.", "nu-relics.com 17383-2; " + REG + " WIN-SW-" + side)])
    E("WIN-SW-" + side, s.capitalize() + " window switch panel (Nu-Relics 17383-2)", "In the " + s + " door panel", "doors", "decided", [("The Nu-Relics door switch panel.", "nu-relics.com 17383-2")])
    E("lock_actuator_" + ("DS" if side == "L" else "PS"), s.capitalize() + " door lock actuator (AutoLoc AUTZT2000)", "Inside the " + s + " door, on the lock rod", "doors", "decided", [("The AutoLoc 2-wire actuator.", "autoloc.com AUTZT2000")])
    E("window_motor_" + ("DS" if side == "L" else "PS"), s.capitalize() + " window motor (Nu-Relics 17383-2)", "Inside the " + s + " door, on the regulator", "doors", "decided", [("The Nu-Relics regulator and motor.", "nu-relics.com 17383-2")])
    E("SPK-F" + side, s.capitalize() + " door speaker (JL Audio C2-650X)", "In the " + s + " door", "doors", "proposed", [("The registry puts the front speakers in the doors.", REG + " SPK-F" + side)])

# ------------------------------------------------------------------ rear body, tailgate, tank
for side, s in (("Left", "left"), ("Right", "right")):
    E("Tail_Light_" + side, s.capitalize() + " tail lamp (1157)", "Rear corner, " + s + ": the tail combination lamp (grey plug)", "rear", "decided",
      [("Rear lighting, C-K 06-14 models: tail combination lamp (gray), back-up lamp (white), marker lamp (cream).", LTSM + " p.788, Fig. 8-6")])
    E("Backup_Light_" + side, s.capitalize() + " backup lamp", "Rear corner, " + s + ": the back-up lamp (white plug)", "rear", "decided",
      [("Rear lighting, C-K 06-14 models: back-up lamp (white).", LTSM + " p.788, Fig. 8-6")])
    E("MARKER-" + ("LR" if side == "Left" else "RR"), s.capitalize() + " rear side marker", "Rear quarter, " + s + ": the marker lamp (cream plug)", "rear", "decided",
      [("Rear lighting, C-K 06-14 models: marker lamp (cream).", LTSM + " p.788, Fig. 8-6")])
E("LICENSE-LAMP", "License plate lamp (factory)", "At the rear license plate", "rear", "decided",
  [("License plate lamp installations are in the factory figures.", LTSM + " p.787")], ["Read on the truck whether the plate sits on the bumper or the tailgate."])
E("Backup_Camera", "Backup camera (Rear View Safety RVS-7180355-IR)", "At the rear license plate", "rear", "decided", [("A license-plate camera.", REG + " Backup_Camera")])
E("CHMSL", "Third brake light (ORACLE 4514-003, 7 in)", "Not placed: top of the tailgate or rear edge of the top", "rear", "open", [("The registry has the lamp but no spot.", REG + " CHMSL")], ["Pick the spot."])
E("CARGO-LAMP", "Cargo lamp (Truck-Lite 80251C)", "Not placed: cargo area", "rear", "open", [("The registry has the lamp but no spot.", REG + " CARGO-LAMP")], ["Pick the spot."])
E("FUEL-PUMP", "Fuel pump (QFS-H882 hanger, P367 pump)", "In the fuel tank, on the hanger", "rear", "decided",
  [("The pump is on the Quantum hanger that replaces the tank unit.", REG + " FUEL-PUMP"),
   ("The factory tank unit comes out of the tank through its cam-ring opening.", LTSM + " p.533")])
E("FUEL-LEVEL", "Fuel level sender (on the QFS-H882 hanger)", "In the fuel tank, on the hanger", "rear", "decided",
  [("The sender is part of the hanger.", REG + " FUEL-LEVEL")])
E("SPL-FUEL-SND", "Fuel sender signal splice", "Above the tank lid", "rear", "proposed", [("The M130 and Dakota taps join the sender lead here.", REG + " SPL-FUEL-SND")])
E("VSS-SENDER", "Speed sender (Dakota SEN-01-5)", "On the NP205 transfer case's speedometer drive", "underbody", "fixed_by_engine",
  [("The sender threads on the speedometer drive (7/8-18 GM thread).", DAK + " p.8; " + REG + " VSS-SENDER")])
E("TG-SW-KEY", "Tailgate key switch (factory 8900713)", "In the tailgate, at the key lock", "rear", "decided", [("Power rear window: the key switch in the tailgate.", ST352 + " p.16, sheet A-4")])
E("TG-SW-KEY-REV", "Tailgate key switch as the second reversing switch", "In the tailgate, at the key lock", "rear", "decided", [("Power rear window: the key switch.", ST352 + " p.16, sheet A-4")], follows="TG-SW-KEY")
E("TG-CUTOUT", "Tailgate-closed cutout switch", "At the tailgate", "rear", "decided", [("Power rear window: the tailgate cutout switch in the window-up line.", ST352 + " p.16, sheet A-4")])
E("TG-MOTOR-ACI", "Tailgate window motor (Nu-Relics 17383-1, ACI)", "Inside the tailgate, on the window regulator", "rear", "decided", [("The Nu-Relics tailgate regulator with the ACI motor.", REG + " TG-MOTOR-ACI")])
E("rear_window_motor", "Tailgate window motor (factory position)", "Inside the tailgate, on the window regulator", "rear", "decided", [("Power rear window: the motor in the tailgate.", ST352 + " p.16, sheet A-4")])
for k, w in (("AMP", "Amplifier (JL Audio VX700/5i)"), ("AMP-BLOCK", "Amplifier power block"), ("SPK-RL", "Left rear speaker"), ("SPK-RR", "Right rear speaker"), ("SUB", "Woofer 1 (JBL Club 102SL)"), ("SUB-2", "Woofer 2 (JBL Club 102SL)")):
    E(k, w, "Rear cargo area (spot not picked)", "rear", "open", [("The registry has it in the rear but no spot.", REG + " " + k)], ["The audio layout is not designed."])
E("GND-SPLICE-REAR", "Rear ground bus", "Inside the rear body, where the rear harness branches", "rear", "proposed", [("The rear returns land here and go back to the cab bank.", REG + " GND-SPLICE-REAR")])
E("AMP-PASS", "Amplifier cable pass-through (one CableClam per 2 AWG cable)", "Rear floor, near the amplifier", "rear", "proposed",
  [("The amplifier's 2 AWG feed and ground run from the engine bay to the bed.", "docs/wiring/calc-data/cable_decisions.json #32, AMP_GND"),
   ("Runs to the back of the truck go along the frame rail: \"the frame is the stiffest, coolest, most protected real estate on the truck.\"", "docs/wiring/research/2026-06-10_power_spine_builders_study.md §1.2")],
  ["The owner allows round bulkheads only; a cable clamp for 2 AWG power is a separate question."])

# ------------------------------------------------------------------ chassis
E("AMP-STEP-CTRL", "Power step controller (AMP Research kit)", "Not placed: under the body near a step motor", "underbody", "open",
  [("The guide on file is for the 2011-14 Silverado kit, which ties the controller \"to the motor support arm next to the battery\".", AMPR + " p.6")],
  ["The K5 kit's own guide is not on file."])
E("E-STOPP", "Electric parking brake (E-Stopp ESK001)", "Under the body on the parking-brake cable; dash button in the cab", "underbody", "proposed",
  [("The actuator pulls the parking-brake cable; the kit includes a dash button.", REG + " E-STOPP")], ["The spot on the cable is set at the mock-up."])
E("GSS-SENSOR", "Gear position sensor (GSS-3000)", "On the transmission's detent shaft: a plate on the pan, a rod to the shift arm", "underbody", "fixed_by_engine",
  [("The sensor mounts on the detent shaft.", REG + " GSS-SENSOR (Dakota GSS-3000)")])
E("PCS-HARNESS-4610-CASE", "Transmission harness case ground", "At the 6L90 case", "underbody", "fixed_by_engine",
  [("The kit's case ground lead lands on the case.", REG + " PCS-HARNESS-4610-CASE (Holley 558-499 p.3)")])
E("TCASE-4WD-SW", "4WD indicator switch (fabricated plunger switch)", "At the transfer-case shift lever, on a bracket", "underbody", "proposed",
  [("A sealed plunger switch on a bracket at the shift lever (owner 2026-09-27).", REG + " TCASE-4WD-SW")])
E("TRANS-CASE", "6L90 case connector (Kostal 16-way)", "On the 6L90 case: its only external connector", "underbody", "fixed_by_engine",
  [("The 6L90's only external connector carries the solenoids and sensors.", REG + " TRANS-CASE")])


def main():
    import yaml as Y
    live = json.load(open(WT + "/docs/wiring/calc-data/k5_registry.json"))["endpoints"]
    ids = [e["id"] for e in ENDS]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    unknown = sorted(set(ids) - set(live))
    missing = sorted(set(live) - set(ids))
    print("ends:", len(ENDS), "| live endpoints:", len(live), "| duplicates:", dup, "| unknown ids:", unknown, "| missing:", missing)
    from collections import Counter
    print(Counter(e["status"] for e in ENDS))
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
        txt = Y.safe_dump(ENDS, sort_keys=False, allow_unicode=True, width=150, default_flow_style=False)
        txt = "\n".join(("  " + ln) if ln else ln for ln in txt.splitlines())
        open(out, "w").write(txt + "\n")
        print("wrote", out)


if __name__ == "__main__":
    main()
