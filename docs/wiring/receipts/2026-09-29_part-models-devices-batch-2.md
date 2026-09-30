---
id: 2026-09-29_part-models-devices-batch-2
change_type: research
scope: docs/wiring/calc-data/cad/fab/ (dev_motors.py, dev_engine.py, 17 end scripts), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json
author: claude-opus-5-5 (parts-artist-2 lane, session ebc425ad)
follows: 2026-09-29_part-models-devices-batch-1
owner_words: "we cant buy everything til we make the endpoints in 3d like all the categories of parts even the window regulators all the things" (2026-09-29)
---

# Part models, devices batch 2: 18 ends (motors, mechanisms and engine-bay machines)

## What changed
- `cad/fab/dev_motors.py`: AutoLoc AUTZT2000 lock actuators, the Nu-Relics 17383-2 door regulators and 17383-1 tailgate
  regulator with their ACI motors, the factory tailgate window motor, the E-Stopp ESK001, and a mirror helper for the
  right-hand twins.
- `cad/fab/dev_engine.py`: Holley 197-302 alternator, Sanden 7176 SD7B10 compressor, and the factory or unpicked parts
  (starter, horn, wiper motor with washer pump, blower resistor, AMP Research PowerStep controller and motor).
- Single scripts: IBOOSTER, BLOWER-MOTOR, FAN.
- Ends: IBOOSTER, BLOWER-MOTOR, FAN, lock_actuator_DS, lock_actuator_PS, E-STOPP, window_motor_DS, window_motor_PS,
  TG-MOTOR-ACI, rear_window_motor, ALTERNATOR-SENSE, AC-CLUTCH, STARTER-S, HORN, WIPER-MOTOR + WASHER-PUMP (one piece),
  BLOWER-RES, AMP-STEP-CTRL.

## Sources, per part
- IBOOSTER: EVcreate's Gen 1 dimensions (320 flange to reservoir end, 125 / 90 about the axis, 155 wide, 85 to the ECU),
  openinverter's table (72 x 72 bolts, Ø8.5, cut-out 76.35, 26 mm master cylinder), and the owner's two photos: the
  listing (1037123-00-A) and the booster on the truck (vehicle_images 40e5e5f9, label -B).
- BLOWER-MOTOR: Four Seasons' numbers on the MPParts listing (Ø77.8, 108 motor, 127 with the shaft, 5/16 x 1 in shaft);
  the flange sized off the product photo.
- FAN: SPAL's VA97-ABL322P/N-103A drawing; the 30107090 matches it on its own three published numbers (16 in, 3.10 in
  deep, 17 x 17 in).
- lock_actuator_DS / _PS: AutoLoc's page, 5.25 x 2.5 x 0.75 in.
- E-STOPP: E-Stopp's pages (actuator 15 x 3-1/4 x 2 in via layout-ui; control module 5-1/4 x 3 x 1-3/8 in; 22 mm button;
  about 2 in of travel).
- ALTERNATOR-SENSE: scaled off Holley's Mid-Mount dimension page (same 197-302 alternator), bolts from the 20-185 guide.
- AC-CLUTCH: Sanden (MEI) catalogue row 7176 (112 mm PV6 pulley, ear mount, T1 lead); the body sized off a listing photo.
- Not sourced (assumed envelopes, each marked red, with the arrangement from the maker's photo or the manual):
  window_motor_DS / _PS and TG-MOTOR-ACI (Nu-Relics publishes no size), rear_window_motor, STARTER-S (not picked), HORN,
  WIPER-MOTOR + WASHER-PUMP (1977 LTSM p.803 Figs. 8-16 / 8-17 for the arrangement), BLOWER-RES, AMP-STEP-CTRL.

## Findings
- **iBooster generation: Gen 1.** The registry's order record and the controller label in the owner's photo on the truck
  both read 1037123-00-B; openinverter lists 1037123-00-A and -B as Gen 1 (Tesla Model S / X). K5_WIRING_STATE.md
  agrees (corrected to Gen 1 in PR #449).
- On the truck the Tesla reservoir is replaced by **two billet reservoirs** on the master cylinder, and the booster sits
  on a flat firewall adapter plate; the reservoirs' part number is not recorded. They are drawn as the photo shows them.
- The Holley mid-mount parts list names its own SD7 compressor (199-102); the registry's compressor is the Sanden 7176.
  Which one is on the truck is to be confirmed.

## Sources tried for the not-sourced ends (none gave a size)
- window_motor_DS / _PS (Nu-Relics 17383-2) and TG-MOTOR-ACI (17383-1):
  - Nu-Relics' 17383-2 and 17383-1 pages: kit contents and the ACI motor's currents, no size.
  - Nu-Relics' install sheets 17380 and 17780 (one page each): door photos marked "4 Mounting Holes", "Idler Track
    Welded In" and "Lower Stop Welded In", no size.
  - 1977 LTSM p.141-142, Fig. 2D-34 (power window regulator, motor and connector): "do not drill hole closer than
    1/2 in to edge" and a No. 10-12 x 3/4 screw, no regulator size.
  - 1987 LDTSM, regulator replacement: a 3.1 mm drill hole, no regulator size.
  - For the tailgate, 1977 LTSM p.150-151, Figs. 2D-58 / 2D-59 (endgate latch, regulator and motor removal): a 1/8 in
    hole through the sector gear and back plate to lock the lift arms, no regulator or motor size.
  - The twin's door and tailgate (K5_harness_workspace_v4.blend): shells with no inner panel, so they bound the
    regulator and do not size it. Below the belt the door shell is 1052 long x 764 tall, 150-160 thick from the outer
    skin to its inner face at heights 700-1150 mm (101 at the belt), with 892 x 456 glass; the drawn 510 x 460 x 60
    regulator fits inside it. The tailgate shell is 1708 wide with 1515 x 523 glass.
  - Scaled photo: the Nu-Relics photos hold no object of known size and the part has no sourced dimension to scale from.
- rear_window_motor (factory tailgate window motor): the registry names its 1978 GM connector 6288909 (2-way, UP-1 /
  DN-2) and no motor part number; 1977 LTSM p.150-151 (Figs. 2D-58 / 2D-59) gives the removal steps and no size.
- HORN: the registry names no horn part number, only the factory 1-way connector 12004267 (circuit 29) and the core
  support location. LMC's catalogue (text in the database, catalog source ccComplete.pdf) sells 36-2150 / 36-2152
  standard low / high horns for 1973-87 with no size.
- WIPER-MOTOR + WASHER-PUMP: 1977 LTSM p.803 Figs. 8-16 / 8-17 and p.811-819 (arrangement, end-play specs, no size).
- BLOWER-RES: RockAuto's 1977 K5 Blazer 350 listing names the GM number for A/C without the heavy-duty heater:
  336403 (Four Seasons 20083, SMP RU67, Wells 3A1044, UMP BMR11, Holstein 2BMR0020). Their spec tables give 4 male
  blade terminals and a bolt-on mount, no size. Dorman's and Four Seasons' own sites answer a direct fetch with a bot
  check (ShieldSquare, Cloudflare).
- AMP-STEP-CTRL: AMP Research install guide 75146: motor screws (4 mm hex, 36 in-lb) and two 11 in cable ties for the
  controller, no controller size.
- STARTER-S: not picked, kept as it is.

## Unknowns (in the parts, not guessed)
- Nu-Relics regulators and ACI motors: every size assumed (margins 60 and 100 mm). Measure the kits on arrival.
- The starter is not picked; the factory horn, wiper motor, blower resistor and tailgate motor have no part number or
  drawing on file; the AMP Research K5 kit is not in hand.
- Basis mix over the 18 ends (17 pieces): 2 maker drawing (FAN; ALTERNATOR-SENSE scaled off Holley's drawing), 5
  datasheet dimensions, 1 scaled from photo, 9 not sourced. Of their 183 dimensions: 51 maker, 7 scaled, 51 photo, 2 design and
  72 assumed.
