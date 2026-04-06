# WIRE LABEL SCHEDULE — 1977 Chevrolet K5 Blazer

**ECU:** Motec M130 | **PDM:** Motec PDM30 | **Engine:** Delmo Speed LS3 6.2L
**Generated:** 2026-04-04 | **Source:** K5_cut_list.txt, K5_connector_schedule.txt

Labels are printed on heat-shrink tubing (3:1 adhesive-lined, white or clear).
Place each label 1-2" from the connector/terminal at each end.
Both ends carry the circuit ID so any wire is identifiable from either end.

---

## LABEL FORMAT

```
NEAR END (ECU/PDM side):    [PIN] [CIRCUIT_ID] [GAUGE]
FAR END (component side):   [COMPONENT] [CIRCUIT_ID] [GAUGE]
```

Example: Wire #24 (Ignition Coil 1)
- Near end:  `M130:A13 IGN1 20`
- Far end:   `COIL1 DRV IGN1 20`

The gauge suffix helps the builder verify they grabbed the right wire during installation.

---

## COIL/CYLINDER MAPPING NOTE

The Motec M130 uses channel names IGN_LS1-LS8 which do NOT match GM cylinder numbers.
The cut list maps physical coils (Coil 1-8 = Cylinder 1-8) to Motec pins.
Labels below use the PHYSICAL cylinder number (CYL1-CYL8), with the Motec channel
noted in the circuit ID for firmware reference.

LS3 firing order: 1-8-7-2-6-5-4-3
- Driver (left) bank:  Cylinders 1, 3, 5, 7 (front to rear)
- Passenger (right) bank: Cylinders 2, 4, 6, 8 (front to rear)

---

## ENGINE LOOM (27 wires)

### Ignition Coils

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #24 | 20 AWG | WHT/ORG | M130:A13 IGN1 20 | COIL1 DRV IGN1 20 | Cyl 1, driver front |
| #5 | 20 AWG | WHT | M130:A03 IGN3 20 | COIL3 DRV IGN3 20 | Cyl 3, driver mid-front |
| #7 | 20 AWG | WHT/WHT | M130:A04 IGN5 20 | COIL5 DRV IGN5 20 | Cyl 5, driver mid-rear |
| #8 | 20 AWG | WHT/BLK | M130:A05 IGN7 20 | COIL7 DRV IGN7 20 | Cyl 7, driver rear |
| #9 | 20 AWG | WHT/RED | M130:A06 IGN2 20 | COIL2 PASS IGN2 20 | Cyl 2, passenger front |
| #10 | 20 AWG | WHT/BLU | M130:A07 IGN4 20 | COIL4 PASS IGN4 20 | Cyl 4, passenger mid-front |
| #11 | 20 AWG | WHT/YEL | M130:A08 IGN6 20 | COIL6 PASS IGN6 20 | Cyl 6, passenger mid-rear |
| #12 | 20 AWG | WHT/VIO | M130:A12 IGN8 20 | COIL8 PASS IGN8 20 | Cyl 8, passenger rear |

### Fuel Injectors

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #13 | 18 AWG | GRN | M130:A19 INJ1 18 | INJ1 DRV INJ1 18 | Cyl 1, driver front |
| #14 | 18 AWG | GRN/WHT | M130:A20 INJ2 18 | INJ2 PASS INJ2 18 | Cyl 2, passenger front |
| #15 | 18 AWG | GRN/BLK | M130:A21 INJ3 18 | INJ3 DRV INJ3 18 | Cyl 3, driver mid-front |
| #16 | 18 AWG | GRN/RED | M130:A22 INJ4 18 | INJ4 PASS INJ4 18 | Cyl 4, passenger mid-front |
| #17 | 18 AWG | GRN/BLU | M130:A27 INJ5 18 | INJ5 DRV INJ5 18 | Cyl 5, driver mid-rear |
| #18 | 18 AWG | GRN/YEL | M130:A28 INJ6 18 | INJ6 PASS INJ6 18 | Cyl 6, passenger mid-rear |
| #19 | 18 AWG | GRN/VIO | M130:A29 INJ7 18 | INJ7 DRV INJ7 18 | Cyl 7, driver rear |
| #20 | 18 AWG | GRN/ORG | M130:A30 INJ8 18 | INJ8 PASS INJ8 18 | Cyl 8, passenger rear |

### Engine Sensors

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #99 | 22 AWG SHLD | BLU/WHT/WHT | M130:B01 CKP 22S | CRANK SENS CKP 22S | Shielded. Rear of block. |
| #101 | 22 AWG SHLD | BLU/WHT/BLK | M130:B02 CMP 22S | CAM SENS CMP 22S | Shielded. Front timing cover. |
| #103 | 22 AWG SHLD | GRY | M130:B07 KS1 22S | KNOCK1 DRV KS1 22S | Shielded. Driver block. |
| #104 | 22 AWG SHLD | GRY/WHT | M130:B13 KS2 22S | KNOCK2 PASS KS2 22S | Shielded. Passenger block. |
| #102 | 22 AWG | VIO | M130:A14 OPS 22 | OIL PRESS OPS 22 | Block, rear driver side |
| #113 | 22 AWG | TAN/BLK | M130:B05 OTS 22 | OIL TEMP OTS 22 | Oil pan or block boss |
| #108 | 22 AWG | VIO/WHT | M130:A15 MAP 22 | MAP SENS MAP 22 | Rear of intake manifold |
| #109 | 22 AWG | TAN | M130:B03 IAT 22 | INTAKE TEMP IAT 22 | Intake runner |
| #110 | 22 AWG | TAN/WHT | M130:B04 CLT 22 | COOLANT TEMP CLT 22 | Front of engine |
| #112 | 22 AWG | VIO/BLK | M130:A16 FPS 22 | FUEL PRESS FPS 22 | Fuel rail, driver side |

### Electronic Throttle Body

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #4 | 18 AWG | ORG | ECU ETB 18 | THROTTLE BODY ETB 18 | Top of intake. See note* |

*ETB is 6-pin. This may represent only the power feed. Additional ETB signal wires (TPS1, TPS2, motor drive) may be unlisted. Verify and label individually when wired.

---

## DASH LOOM (18 wires)

### Driver Door

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #34 | 12 AWG | DK BLU | PDM30:OUT3 WNDL 12 | WIN MTR L WNDL 12 | Window motor, driver |
| #36 | 14 AWG | ORN/YEL | PDM30:DIG WSWM 14 | WIN SW MSTR WSWM 14 | Master window switch |
| #38 | 18 AWG | BLK | PDM30:OUT21 LCKL 18 | LOCK ACT L LCKL 18 | Lock actuator, driver |
| #42 | 18 AWG | ORG/BLK | PDM30:DIG DSWL 18 | DOOR SW L DSWL 18 | Door ajar switch, driver |
| #44 | 18 AWG | ORG/BLU | PDM30:DIG LCKSW 18 | LOCK SW LCKSW 18 | Central lock switch |

### Passenger Door

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #35 | 12 AWG | DK BLU/WHT | PDM30:OUT4 WNDR 12 | WIN MTR R WNDR 12 | Window motor, passenger |
| #37 | 14 AWG | ORN/VIO | PDM30:DIG WSWP 14 | WIN SW PASS WSWP 14 | Passenger window switch |
| #47 | 18 AWG | BLK/WHT | PDM30:OUT22 LCKR 18 | LOCK ACT R LCKR 18 | Lock actuator, passenger |
| #43 | 18 AWG | ORG/RED | PDM30:DIG DSWR 18 | DOOR SW R DSWR 18 | Door ajar switch, passenger |

### Instrument Panel

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #65 | 22 AWG | ORG/RED | PDM30:OUT29 DISP 22 | DISPLAY DISP 22 | Dash display power |
| #71 | 18 AWG | ORN/VIO | PDM30 GAUGE 18 | DAKOTA VHX GAUGE 18 | Dakota Digital cluster |
| #45 | 14 AWG | ORG/YEL | PDM30:DIG BLWR-SW 14 | BLOWER SW BLWR-SW 14 | Blower speed switch |

### Interior Lights

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #67 | 20 AWG | BRN | PDM30:OUT25 DOME 20 | DOME LT DOME 20 | Dome light |
| #68 | 20 AWG | BRN/WHT | PDM30:OUT25 DASH-LED 20 | UNDER-DASH DASH-LED 20 | Under-dash LEDs |
| #69 | 20 AWG | BRN/BLK | PDM30:OUT25 FOOT 20 | FOOTWELL FOOT 20 | Footwell lights |

### Accessories

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #70 | 18 AWG | ORN/YEL | PDM30:OUT30 USB 18 | USB PORT USB 18 | USB charging port |
| #72 | 14 AWG | ORN/ORG | PDM30:OUT8 CIG 14 | 12V OUTLET CIG 14 | Cigarette lighter |

### Blower Motor (Direct Run)

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #51 | 12 AWG | ORN/BLK/BLU | PDM30:OUT6 BLWR 12 | BLOWER MTR BLWR 12 | Heater blower motor |

---

## FRONT LIGHTING LOOM (11 wires)

### Driver Side Front

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #85 | 16 AWG | LT GRN | PDM30:OUT17 HDL-L 16 | HEADLIGHT L HDL-L 16 | LED headlight, driver |
| #80 | 18 AWG | LT BLU | PDM30:OUT27 TRN-FL 18 | TURN SIG FL TRN-FL 18 | Turn signal, front left |
| #83 | 18 AWG | BRN/RED | PDM30:OUT13 PRK-FL 18 | PARK LT FL PRK-FL 18 | Parking light, front left |
| #87 | 18 AWG | BRN/YEL | PDM30:OUT19 MKR-FL 18 | MARKER FL MKR-FL 18 | Side marker, front left |

### Passenger Side Front

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #86 | 16 AWG | LT GRN/WHT | PDM30:OUT18 HDL-R 16 | HEADLIGHT R HDL-R 16 | LED headlight, passenger |
| #82 | 18 AWG | DK BLU | PDM30:OUT28 TRN-FR 18 | TURN SIG FR TRN-FR 18 | Turn signal, front right |
| #84 | 18 AWG | BRN/BLU | PDM30:OUT13 PRK-FR 18 | PARK LT FR PRK-FR 18 | Parking light, front right |
| #88 | 18 AWG | BRN/VIO | PDM30:OUT19 MKR-FR 18 | MARKER FR MKR-FR 18 | Side marker, front right |

### Center Front

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #48 | 14 AWG | ORN/ORG | PDM30:OUT14 HORN 14 | HORN HORN 14 | Horn |
| #49 | 14 AWG | PPL | PDM30:OUT12 WIPE 14 | WIPER MTR WIPE 14 | Windshield wiper motor |
| #50 | 18 AWG | ORN/BLK/RED | PDM30:OUT26 WASH 18 | WASHER PMP WASH 18 | Washer pump |

---

## REAR LOOM (17 wires)

### Tail Lights

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #81 | 18 AWG | BRN/BLK | PDM30:OUT13 TAIL-L 18 | TAIL LT L TAIL-L 18 | Tail light, left |
| #75 | 18 AWG | BRN/YEL | PDM30:OUT13 TAIL-R 18 | TAIL LT R TAIL-R 18 | Tail light, right |

### Backup / Third Brake / Camera

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #89 | 18 AWG | BRN/ORG | PDM30:OUT15 BKP-L 18 | BACKUP L BKP-L 18 | Backup light, left |
| #76 | 18 AWG | BRN/VIO | PDM30:OUT15 BKP-R 18 | BACKUP R BKP-R 18 | Backup light, right |
| #93 | 18 AWG | BRN/RED | PDM30:OUT15 3BRK 18 | 3RD BRAKE 3BRK 18 | Third brake light |
| #97 | 20 AWG | BLU/WHT | PDM30:OUT15 RCAM 20 | REAR CAM RCAM 20 | Rear backup camera |

### Rear Side Markers

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #77 | 18 AWG | BRN/ORG | PDM30:OUT19 MKR-RL 18 | MARKER RL MKR-RL 18 | Side marker, rear left |
| #78 | 18 AWG | BRN | PDM30:OUT19 MKR-RR 18 | MARKER RR MKR-RR 18 | Side marker, rear right |

### License Plate

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #92 | 18 AWG | BRN/BLK | PDM30:OUT19 LIC 18 | LICENSE LT LIC 18 | License plate light |

### Cab Clearance Lights

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #79 | 18 AWG | BRN/WHT | PDM30:OUT19 CLR-L 18 | CAB CLR L CLR-L 18 | Cab clearance, left |
| #90 | 18 AWG | BRN | PDM30:OUT19 CLR-C 18 | CAB CLR C CLR-C 18 | Cab clearance, center |
| #91 | 18 AWG | BRN/WHT | PDM30:OUT19 CLR-R 18 | CAB CLR R CLR-R 18 | Cab clearance, right |

### Fuel System

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #66 | 10 AWG | ORN/BLU | RELAY FPMP 10 | FUEL PUMP FPMP 10 | Fuel pump power (relay to tank) |
| #98 | 20 AWG | ORN/RED | ECU FLVL 20 | FUEL SENDR FLVL 20 | Fuel level sender |

### Other Rear Runs

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #54 | 14 AWG | ORN/BLK/YEL | PDM30:OUT7 EBRK 14 | E-PARK BRK EBRK 14 | Electric parking brake |
| #74 | 20 AWG | BRN/BLU | PDM30:OUT25 CARGO 20 | CARGO LT CARGO 20 | Cargo/bed light |

---

## CHASSIS / UNDERBODY LOOM (10 wires)

### Radiator / Front Engine Bay

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #21 | 12 AWG | ORN/WHT | PDM30:OUT1 FAN1 12 | RAD FAN 1 FAN1 12 | Radiator fan primary |
| #22 | 12 AWG | ORN/BLK | PDM30:OUT2 FAN2 12 | RAD FAN 2 FAN2 12 | Radiator fan secondary |
| #25 | 14 AWG | ORN/BLU | PDM30:OUT5 EWP 14 | WATER PMP EWP 14 | Electric water pump |
| #23 | 18 AWG | ORN/RED | PDM30:OUT16 ACCOMP 18 | A/C COMP ACCOMP 18 | A/C compressor clutch |

### AMP Research Power Steps

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #1 | 14 AWG | ORN/BLK | PDM30:OUT9 STEP-L 14 | AMP STEP L STEP-L 14 | Power step, driver |
| #2 | 14 AWG | ORN/BLK/WHT | PDM30:OUT10 STEP-R 14 | AMP STEP R STEP-R 14 | Power step, passenger |
| #3 | 14 AWG | ORN/BLK/BLK | PDM30:OUT11 STEP-C 14 | AMP CTRL STEP-C 14 | Step controller |

### Exhaust / Drivetrain Sensors

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #100 | 22 AWG | ORN/BLU | ECU VSS 22 | VEH SPD SENS VSS 22 | Vehicle speed sensor |
| #106 | 22 AWG | VIO/BLU | ECU WBO2-1 22 | WB O2 BNK1 WBO2-1 22 | Wideband O2 sensor 1 |
| #107 | 22 AWG | VIO/BLU/WHT | ECU WBO2-2 22 | WB O2 BNK2 WBO2-2 22 | Wideband O2 sensor 2 |

### Lambda Controller

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #64 | 20 AWG | ORN/BLK | PDM30:OUT24 WB-PWR 20 | LAMBDA CTRL WB-PWR 20 | Wideband controller power |

---

## AUDIO LOOM (8 wires)

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #31 | 18 AWG | ORN/BLK | PDM30:OUT20 RADIO 18 | HEAD UNIT RADIO 18 | Radio/head unit power |
| #26 | 18 AWG | ORN/YEL | AMP SPK-FL 18 | SPKR FR-L SPK-FL 18 | Front left speaker |
| #27 | 18 AWG | ORN/VIO | AMP SPK-FR 18 | SPKR FR-R SPK-FR 18 | Front right speaker |
| #28 | 18 AWG | ORN/ORG | AMP SPK-RL 18 | SPKR RR-L SPK-RL 18 | Rear left speaker |
| #29 | 18 AWG | ORN | AMP SPK-RR 18 | SPKR RR-R SPK-RR 18 | Rear right speaker |
| #30 | 14 AWG | ORN/WHT | AMP SUB 14 | SUBWOOFER SUB 14 | Subwoofer |
| #32 | 8 AWG | ORN/RED | BATT AMP-PWR 8 | AMPLIFIER AMP-PWR 8 | Amplifier power (fused) |
| #96 | 22 AWG | ORN/BLK | ECU AMP-RLY 22 | AMP RELAY AMP-RLY 22 | Amplifier remote turn-on |

---

## CAN BACKBONE (1 twisted pair)

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #62a | 22 AWG TP | WHT/GRN | M130:B17 CAN-H 22 | PDM30:B26 CAN-H 22 | CAN High, 120 ohm term each end |
| #62b | 22 AWG TP | GRN/WHT | M130:B18 CAN-L 22 | PDM30:B25 CAN-L 22 | CAN Low, 120 ohm term each end |

---

## POWER DISTRIBUTION (7 cables)

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| — | 6 AWG | RED | BATT+ PDM-FEED 6 | PDM30:C01 PDM-FEED 6 | Battery to PDM30 M6 stud, 80A MEGA fuse |
| — | 6 AWG | BLK | BATT- PDM-GND 6 | PDM30:A26+B18 PDM-GND 6 | Battery ground to PDM30 (both pins) |
| #6 | 4 AWG | ORN | BATT+ STRT 4 | STARTER STRT 4 | Starter motor cable |
| #59 | 8 AWG | ORN/VIO | ALT CHRG 8 | BATT+ CHRG 8 | Alternator to battery, fusible link |
| #63 | 4 AWG | ORN/WHT | BATT+ DISC 4 | KILL SW DISC 4 | Battery master disconnect |
| — | 16 AWG | RED/WHT | PDM30 ECU-PWR 16 | M130:A26 ECU-PWR 16 | M130 battery positive |
| — | 16 AWG | BLK | STAR GND ECU-GND 16 | M130:A10+A11 ECU-GND 16 | M130 battery negative (both pins) |

---

## SWITCH INPUTS (6 wires)

These connect dash/column switches to PDM30 digital inputs.

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #33 | 18 AWG | ORN/BLU | PDM30:DIG TRNSW 18 | TURN SW TRNSW 18 | Turn signal switch |
| #39 | 14 AWG | ORN/ORG | PDM30:DIG HDSW 14 | HEADLT SW HDSW 14 | Headlight switch |
| #46 | 18 AWG | ORN/VIO | PDM30:DIG WIPSW 18 | WIPER SW WIPSW 18 | Wiper/washer switch |
| #53 | 22 AWG | ORN/WHT | PDM30:DIG BRKSW 22 | BRAKE SW BRKSW 22 | Brake light switch (pedal) |
| #40 | 14 AWG | ORN | PDM30:DIG IGNSW 14 | IGN SW IGNSW 14 | Ignition switch |
| #41 | 18 AWG | ORN/WHT | PDM30:DIG HAZ 18 | HAZARD SW HAZ 18 | Hazard flasher switch |

---

## MISCELLANEOUS / STANDALONE (10 wires)

### Transmission / Drivetrain

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #55 | 16 AWG | ORN/BLK | PDM30:DIG TCASE 16 | XFER CASE TCASE 16 | Transfer case indicator |
| #56 | 14 AWG | ORN/RED | PDM30:DIG NSS 14 | NEUTRAL SW NSS 14 | Neutral safety switch |
| #57 | 18 AWG | ORN/BLU | PDM30:DIG REV-SW 18 | REVERSE SW REV-SW 18 | Reverse light switch |
| #58 | 20 AWG | ORN/YEL | PDM30:OUT23 TCM 20 | TRANS CTRL TCM 20 | 6L80E transmission controller |

### Engine Bay Misc

| Wire# | Gauge | Color | Near-End Label | Far-End Label | Notes |
|-------|-------|-------|---------------|---------------|-------|
| #52 | 10 AWG | ORN | RELAY IBST-PWR 10 | IBOOSTER IBST-PWR 10 | Bosch iBooster power (relay-controlled) |
| #95 | 22 AWG | ORN/WHT | PDM30 IBST-RLY 22 | IBST RELAY IBST-RLY 22 | iBooster relay coil control |
| #94 | 22 AWG | ORN | PDM30 FPMP-RLY 22 | FP RELAY FPMP-RLY 22 | Fuel pump relay coil control |
| #60 | 20 AWG | ORN/ORG | IGN SW ECU-IGN 20 | M130 ECU-IGN 20 | ECU ignition-switched power |
| #61 | 22 AWG | ORN | IGN SW PDM-IGN 22 | PDM30 PDM-IGN 22 | PDM30 ignition-switched power |
| #73 | 20 AWG | BRN/RED | PDM30:OUT25 HOOD 20 | UNDERHOOD LT HOOD 20 | Underhood work light |
| #105 | 22 AWG | ORN/YEL | ECU AC-LO 22 | A/C LO SW AC-LO 22 | A/C low pressure switch |
| #111 | 22 AWG | ORN/VIO | ECU AC-HI 22 | A/C HI SW AC-HI 22 | A/C high pressure switch |

---

## CIRCUIT ID MASTER LIST

Quick reference for all circuit IDs used on labels, sorted alphabetically.

| Circuit ID | Full Name | Wire# |
|-----------|-----------|-------|
| AC-HI | A/C High Pressure Switch | #111 |
| AC-LO | A/C Low Pressure Switch | #105 |
| ACCOMP | A/C Compressor Clutch | #23 |
| AMP-PWR | Amplifier Power | #32 |
| AMP-RLY | Amplifier Relay | #96 |
| BKP-L | Backup Light Left | #89 |
| BKP-R | Backup Light Right | #76 |
| BLWR | Blower Motor | #51 |
| BLWR-SW | Blower Speed Switch | #45 |
| BRKSW | Brake Light Switch | #53 |
| CAN-H | CAN Bus High | #62a |
| CAN-L | CAN Bus Low | #62b |
| CARGO | Cargo/Bed Light | #74 |
| CHRG | Alternator Charge | #59 |
| CIG | Cigarette Lighter / 12V | #72 |
| CKP | Crank Position Sensor | #99 |
| CLR-C | Cab Clearance Center | #90 |
| CLR-L | Cab Clearance Left | #79 |
| CLR-R | Cab Clearance Right | #91 |
| CLT | Coolant Temperature Sensor | #110 |
| CMP | Cam Position Sensor | #101 |
| DASH-LED | Under-Dash LED Lights | #68 |
| DISC | Battery Disconnect | #63 |
| DISP | Display/Dash | #65 |
| DOME | Dome Light | #67 |
| DSWR | Door Switch Right | #43 |
| DSWL | Door Switch Left | #42 |
| EBRK | Electric Parking Brake | #54 |
| ECU-GND | M130 Ground | — |
| ECU-IGN | ECU Ignition Power | #60 |
| ECU-PWR | M130 Battery Power | — |
| ETB | Electronic Throttle Body | #4 |
| EWP | Electric Water Pump | #25 |
| FAN1 | Radiator Fan 1 | #21 |
| FAN2 | Radiator Fan 2 | #22 |
| FLVL | Fuel Level Sender | #98 |
| FOOT | Footwell Lights | #69 |
| FPMP | Fuel Pump | #66 |
| FPMP-RLY | Fuel Pump Relay | #94 |
| FPS | Fuel Pressure Sensor | #112 |
| GAUGE | Dakota Digital Gauge | #71 |
| HAZ | Hazard Flasher | #41 |
| HDL-L | LED Headlight Left | #85 |
| HDL-R | LED Headlight Right | #86 |
| HDSW | Headlight Switch | #39 |
| HOOD | Underhood Light | #73 |
| HORN | Horn | #48 |
| IAT | Intake Air Temperature | #109 |
| IBST-PWR | iBooster Power | #52 |
| IBST-RLY | iBooster Relay | #95 |
| IGN1 | Ignition Coil Cyl 1 | #24 |
| IGN2 | Ignition Coil Cyl 2 | #9 |
| IGN3 | Ignition Coil Cyl 3 | #5 |
| IGN4 | Ignition Coil Cyl 4 | #10 |
| IGN5 | Ignition Coil Cyl 5 | #7 |
| IGN6 | Ignition Coil Cyl 6 | #11 |
| IGN7 | Ignition Coil Cyl 7 | #8 |
| IGN8 | Ignition Coil Cyl 8 | #12 |
| IGNSW | Ignition Switch | #40 |
| INJ1 | Fuel Injector Cyl 1 | #13 |
| INJ2 | Fuel Injector Cyl 2 | #14 |
| INJ3 | Fuel Injector Cyl 3 | #15 |
| INJ4 | Fuel Injector Cyl 4 | #16 |
| INJ5 | Fuel Injector Cyl 5 | #17 |
| INJ6 | Fuel Injector Cyl 6 | #18 |
| INJ7 | Fuel Injector Cyl 7 | #19 |
| INJ8 | Fuel Injector Cyl 8 | #20 |
| KS1 | Knock Sensor Bank 1 | #103 |
| KS2 | Knock Sensor Bank 2 | #104 |
| LCKL | Lock Actuator Left | #38 |
| LCKR | Lock Actuator Right | #47 |
| LCKSW | Lock Switch | #44 |
| LIC | License Plate Light | #92 |
| MAP | MAP Sensor | #108 |
| MKR-FL | Marker Front Left | #87 |
| MKR-FR | Marker Front Right | #88 |
| MKR-RL | Marker Rear Left | #77 |
| MKR-RR | Marker Rear Right | #78 |
| NSS | Neutral Safety Switch | #56 |
| OPS | Oil Pressure Sensor | #102 |
| OTS | Oil Temperature Sensor | #113 |
| PDM-FEED | PDM30 Main Feed | — |
| PDM-GND | PDM30 Ground | — |
| PDM-IGN | PDM Ignition Power | #61 |
| PRK-FL | Parking Light Front Left | #83 |
| PRK-FR | Parking Light Front Right | #84 |
| RADIO | Radio/Head Unit | #31 |
| RCAM | Rear Backup Camera | #97 |
| REV-SW | Reverse Light Switch | #57 |
| SPK-FL | Speaker Front Left | #26 |
| SPK-FR | Speaker Front Right | #27 |
| SPK-RL | Speaker Rear Left | #28 |
| SPK-RR | Speaker Rear Right | #29 |
| STEP-C | AMP Research Controller | #3 |
| STEP-L | AMP Research Step Left | #1 |
| STEP-R | AMP Research Step Right | #2 |
| STRT | Starter Motor | #6 |
| SUB | Subwoofer | #30 |
| TAIL-L | Tail Light Left | #81 |
| TAIL-R | Tail Light Right | #75 |
| TCASE | Transfer Case Indicator | #55 |
| TCM | Transmission Controller | #58 |
| TRN-FL | Turn Signal Front Left | #80 |
| TRN-FR | Turn Signal Front Right | #82 |
| TRNSW | Turn Signal Switch | #33 |
| USB | USB Charging Port | #70 |
| VSS | Vehicle Speed Sensor | #100 |
| WASH | Washer Pump | #50 |
| WB-PWR | Wideband Lambda Controller | #64 |
| WBO2-1 | Wideband O2 Sensor 1 | #106 |
| WBO2-2 | Wideband O2 Sensor 2 | #107 |
| WIPE | Windshield Wiper Motor | #49 |
| WIPSW | Wiper/Washer Switch | #46 |
| WNDL | Window Motor Left | #34 |
| WNDR | Window Motor Right | #35 |
| WSWM | Window Switch Master | #36 |
| WSWP | Window Switch Passenger | #37 |
| 3BRK | Third Brake Light | #93 |

---

## LABEL PRINTING NOTES

1. **Material:** Use 3:1 adhesive-lined heat shrink, white or clear over white print. Brady BMP21-PLUS or Brother P-Touch are suitable. Minimum 3/16" diameter tubing for 22-18 AWG, 1/4" for 16-14 AWG, 3/8" for 12-10 AWG, 1/2" for 8-4 AWG.

2. **Placement:** Slide label onto wire BEFORE crimping the terminal. Shrink in place 1-2" from the connector. For shielded cables, label goes on the outer jacket, not on individual conductors.

3. **Durability:** Engine loom labels must survive 250F+ sustained temperature. Use military-spec heat shrink (Raychem ATUM or Canfield TMS) for engine bay. Standard labels are fine for interior/cab wires.

4. **Redundancy:** Each wire has a unique color code AND a label at each end. If a label is ever unreadable, the color code identifies the wire from the cut list.

5. **Shielded cables** get a suffix "S" on the gauge (e.g., "22S") to visually distinguish them from standard wires of the same gauge.

6. **Total labels to print:** 226 (113 wires x 2 ends). Print a spare set for the bench reference binder.
