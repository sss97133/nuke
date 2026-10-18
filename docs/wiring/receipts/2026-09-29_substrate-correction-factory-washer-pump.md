---
id: 2026-09-29_substrate-correction-factory-washer-pump
date: 2026-09-29
change_type: substrate_correction
scope: calc-data/catalog/endpoints.yaml WASHER-PUMP (device, sources); calc-data/catalog/pin_tables/WASHER-PUMP.yaml; the 12004622 lines in pin_tables/WIPER-MOTOR.yaml and pin_tables/WIPER-SW.yaml
status: FILED (catalog text corrected; wire ids and topology untouched, left to the wiring lane)
follows: PR #410 (mounts.yaml WASHER-PUMP end made the factory pump, decided; open "the factory washer connector and soft-tube part numbers are not recorded yet")
---

# Correction: the washer is the factory pump on the wiper motor, with its own 2-way connector and soft tube

## Claims being corrected
1. `endpoints.yaml` WASHER-PUMP and `pin_tables/WASHER-PUMP.yaml` named a "Hella 8TW 004 223-031 12 V washer pump in the
   Hella 8TW 003 248-001 1.5 l tank".
2. `pin_tables/WIPER-MOTOR.yaml` said the factory pump on the gear box "is left unwired ... The electric pump in the jar
   (WASHER-PUMP) replaces it".
3. It also said "The 1978 booklet's motor 12004622 is the 1978 rectangular motor, not this one". The same misreading sat in
   `pin_tables/WIPER-SW.yaml`.

## Evidence
- **Owner, 2026-09-29:** "the factory wiper does have the washer motor built into it which means we just need to make sure
  we use the correct connectors in the harness ... the correct soft tube" (quoted in PR #410).
- **1977 Light Truck Service Manual:**
  - p.803: "Figure 8-16 shows the assembly of the washer pump to the wiper motor" (Fig. 8-16, "Washer Mechanism Mounting on
    Wiper").
  - p.814: washer diagnosis, "Open circuit in feed wire to pump solenoid coil"; "Grounded wire from pump solenoid to switch"
    means it pumps continuously.
  - p.815: "Disconnect electrical harness at wiper motor and hoses at washer pump".
  - p.131: the C-K motor is "mounted to the left side of the dash panel inside the engine compartment".
- **1978 C-K wiring booklet ST-352-78, fold-out A-1** (the closest year on file). Read from the page image
  `reference_documents/wiring_diagram_booklets/pages/1978_CK_A1_cab_engine_chassis_main.png` on 2026-09-29.
  - The wiper motor block draws "PARK SW", "WASH SOL" and the armature, with terminals 1/2/3.
  - Connectors:
    - **12004622:** a 2-way at the washer solenoid, 18 DK BLU-94 and 18 YEL/BLK-93B.
    - **8917544:** a 3-way at the motor, 18 LT BLU/BLK-92, 18 WHT/BLK-91A, 18 YEL/BLK-93A.
    - **8917548:** a 2-way at the park switch, 97 and 91B.
  - Circuit table p.9: 91 "Windshield Wiper - Low", 92 "- Hi", 93 "Windshield Wiper Motor Feed", 94 "Windshield Washer Sw.
    to Washer".
- **Soft tube and pump** (repro numbers; no GM hose number found):
  - LMC (`web_snapshots/www.lmctruck.com__cc-1973-84-windshield-wiper-and-washer.md`, 2026-09-29):
    - 36-4070 Hose, Jar to Pump, 9 ft, $4.95
    - 36-4071 Hose, Pump to Nozzle, 12 ft, $4.95
    - 30-1365 hose retainer (×2)
    - 30-1423 washer nozzle, 73-80 (×2)
    - 36-4078 Washer Pump, Chevy GMC 73-77, $109.95
    - 36-4082 pump repair kit
    - 36-4092 washer jar, 76-84
  - Classic Parts 67-865 "(1973-84) Windshield Washer Hose Kit", $11.95 (`web_snapshots/www.classicparts.com__67-865.md`).
- **Connector availability:** NOS "GM 2 Way Windshield Wiper Washer Pump Wiring Harness Connector Housing Plug", US $18.99
  (`web_snapshots/www.ebay.com__192684099994.md`). The listing text does not print the number, so 12004622 stays cited to the
  booklet.

## What changed (text only)
- **`endpoints.yaml` WASHER-PUMP:** the device is now the factory pump on the wiper gear box with its 12004622 solenoid
  connector. Sources are the manual, the booklet and the owner. The Hella page is kept as the retired source.
- **`pin_tables/WASHER-PUMP.yaml`:**
  - device, mate (12004622) and pin labels
  - wire 50 lands on the 93B (feed) cavity and WASH_GND on the 94 cavity
  - the note, the soft-tube numbers and the open items
  - the Hella pump and tank move to `retired_alternative`
- **`pin_tables/WIPER-MOTOR.yaml` and `WIPER-SW.yaml`:** the pump is the build's washer, and 12004622 is the washer-solenoid
  connector, not a motor. The superseded words are quoted in place.

## Not changed (the wiring lane's, per the pieces lane 2026-09-29)
- **Topology.** Wires 50 (PDM30 OUT26) and WASH_GND (to GND-BANK-ENG) still feed and return the solenoid, with the dash
  washer contact read on DIG9 (#46). That works for the solenoid. The factory way, the dash switch grounding 94 with 93B
  spliced to the motor feed, frees PDM30 **OUT26 and DIG9** and keeps the firewall crossing count, since 94 crosses where 50
  did.
- **`reconcile_v5.py`.** It still writes "Hella 8JD 008 151-021 plug" as wire 50's terminal and the Hella current as the
  OUT26 limit gap (lines around 1203 and 1784). That regenerates into the registry until it is re-pointed.
- **`mounts.yaml`.** The WASHER-PUMP `open` line ("connector and soft-tube part numbers are not recorded yet") can close
  with the numbers above.
- **`part_media.yaml`.** It holds Hella media for WASHER-PUMP. It belongs to the part-media lane.

## Open unknowns
- **12004622 on the 1977 motor.** Needs the motor in hand read, or the 1977 booklet ST-352-77 (not on file).
- **Solenoid coil current.** Needs a bench reading before a PDM limit.
- **Whether the 1977 dash switch's wash position also runs the wipers.** The pump only pumps while the wiper gear turns
  (p.814-815). Needs the switch read, or the 1977 booklet.
