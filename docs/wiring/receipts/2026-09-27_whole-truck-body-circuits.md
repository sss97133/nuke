# Receipt — The whole truck: every body wire gets a far end, a ground and a command path

- **Date:** 2026-09-27 (evening)
- **Change type:** registry design (local toolchain `docs/wiring/calc-data/`) → map rows; one decided call (T3)
- **Ask (owner, 2026-09-27):** "work on the whole truck" — after "i want you wiring in the factory switches and modules
  and figure out how they work in a can bus motec computer too … perfect union of vintage and modern" and "you can
  choose the parts … i can tell u to replace later".
- **Follows:** `receipts/2026-09-27_wires-right-engine-start-doors-camera.md` (on main, #355).

## Measured (registry, `check_plug_ends.py --wires` and plain `check_plug_ends.py`)

| Set | Wires | Right (every rule passes) | Incomplete (something open) | Wrong (a rule fails) |
|---|---|---|---|---|
| Whole truck, v5 + designed — before this batch | 249 | 100 | 108 | 41 |
| Whole truck, v5 + designed — after | 301 | 289 | 12 | 0 |
| Engine-start set — before / after | 144 / 147 | 91 / 142 | — | 0 / 0 |

- **Live check:** nuke.ag, K5 wiring MAP tab, logged out, after the load. The section rollups read:

  | Section | Right | Wrong | Incomplete | Of |
  |---|---|---|---|---|
  | Power + grounds | 17 | 0 | 3 | 20 |
  | Engine | 106 | 0 | 1 | 107 |
  | Dash / cabin | 33 | 0 | 1 | 34 |
  | Body | 76 | 0 | 0 | 76 |
  | Lighting front | 30 | 0 | 0 | 30 |
  | Lighting rear | 20 | 0 | 0 | 20 |
  | Powertrain / chassis | 7 | 0 | 7 | 14 |

  That is 289 right, 0 wrong and 12 incomplete, the same as the registry.
- Wire ends (plug-end rules R1–R7): 730, none failing.
- Firewall:
  - Body bulkhead: A 12/12, B 7/12, P 1/4.
  - 61-pin: 59/61 (spares c, u). It gained the 3 Dakota sender wires below.
  - Power grommet: ECU_GND1/2, PDM_GND1/2, PDM_BPOS.
- The 12 still open:
  - 7 PCS TCM-2650 wires: the harness drawing and the TCM's mount are unknown (ZGP drawing, order #9501).
  - 3 power-spine write-ups: PDM_BPOS and PDM_GND1/2 have no stud lug in the write-ups yet.
  - #COIL_GND: the rail may duplicate the per-coil head rings.
  - FUEL_SND_GND: the Quantum hanger's connector is a bench read.
- **Map rows:**
  - 218 live nodes on the design.
  - 56 April duplicate nodes superseded by their master node. The aliases are identity only.
  - 11 nodes blocked by decided calls.
  - The April concept wires went from 243 to 156 live:
    - 48 superseded as carried by a v5 wire on the same two plugs, counted only when v5 has at least as many wires
      there as April did.
    - The rest were ruled out by a locked or decided call.
  - The remaining 156 wait for section review. They include items v5 does not have yet: power mirrors, the MIL lamp to
    the Dakota CHECK ENG input, the antenna, GPS, the keyless module and the cab-to-frame strap G4.

## What was decided (each row carries its source in the registry)

### Factory switches: the ones with a separate common become PDM30 inputs

- **The rule:** each switch sits between its DIG pin and the PDM's 0V (chapters/17 §17.7.7). PDM30 A_28 and B_22 are
  0V (MoTeC PDM manual p.47).
- **What moved to A28:** the switch commons (ignition, headlight, turn/hazard, brake) now go to A28, as a spliced 0V
  bus. Before, they went to a kick-panel stud, which misread §17.7.7.
- **PDM30 inputs now:**

  | Input | Job |
  |---|---|
  | DIG1 | ignition RUN |
  | DIG2 | headlight PARK |
  | DIG3 | headlight HEAD |
  | DIG4 | turn left-front output (#33) |
  | DIG5 | turn right-front output |
  | DIG6 | horn button |
  | DIG7 | blower HI (#45) |
  | DIG8 | spare |
  | DIG9 | washer (#46) |
  | DIG10 | START |
  | DIG11 | PCS neutral |
  | DIG12 / DIG13 | door jambs (#42/#43) |
  | DIG14 | brake |
  | DIG15 | reverse |
  | DIG16 | spare |

- **Hazard:** reads as DIG4 + DIG5 together. The column's turn and hazard feeds are both on 0V, and the hazard contact
  joins all four outputs to its feed. Hazard feed = the brown wire in the column connector; the white stop input goes
  unused (1977 Light Truck Service Manual p.783–784). #41 (hazard flasher) is retired: the PDM makes the flash.

### Factory circuits kept whole, with a PDM output as the fused feed

- **Wiper (1977 manual p.803):** the dash switch is a grounding type. It grounds motor terminals 1 and 3 (WIPER_T1,
  WIPER_T3), and the park switch in the gearbox holds the ground until park.
  - #49 (PDM30 OUT12) feeds the center terminal.
  - The motor grounds through its strap (WIPER_GND).
  - The channel plan's wiper inputs DIG7/DIG8 are not needed.
- **Four-Season blower (1977 manual p.87–88):** the resistor sits on the evaporator case, and HI ran through a blower
  relay fed through its own fuse.
  - #51 (OUT6) feeds the control-head switch.
  - LOW and MED run through the resistor (BLOWER_LO/MED/MOT).
  - HI becomes PDM30 OUT2 → motor (BLOWER_HI), switched by the control head's HI contact on DIG7. That replaces the
    relay; row 54 says PDM replaces relays. OUT2 was freed when the second radiator fan was retired.
  - The motor is the 4 Seasons 35587 ordered 2026-09-24.
- **Headlights (floor dimmer, locked 2026-05-14):** OUT17/OUT18 feed the dimmer COMMON. LOW and HIGH go to the
  Truck-Lite 27270C lamps.
  - Each blade takes one lead: the 2–3 wires on a blade join in a D-609-05 first (kit: 3).
  - Dimmer outputs are the light blue and tan wires (1977 manual p.780).
  - #121 (Dakota HIGH (+)) now starts at the dimmer's HIGH blade.

### Front, rear and interior lamps

- Park/turn (1157), markers, horn, washer and underhood lamp have far ends. Every lamp and device has its own ground.
- The factory front marker grounded through the turn filament, which made it flash opposite (1977 manual p.780). A
  direct ground keeps LEDs steady.
- The cab clearance lamps, license lamp, cargo lamp, dome, under-dash and footwell lamps have far ends and grounds.
  Their commands follow the channel plan (DIG2 park group, DIG12/13 courtesy group).

### Named ground studs

Body returns go to the nearest named stud (chapters/17 §17.4.4). The exact spot on each is set at the formboard.

| Stud | Where |
|---|---|
| G-FRONT-L / G-FRONT-R | core support |
| G-FIREWALL | the G3 engine-strap stud, engine side |
| G-KICK-L / G-KICK-R | kick panels |
| G-ROOF | steel cab roof |
| G-REAR | rear body |
| G-FRAME-REAR | frame boss near the tank |

The spine grounds (PDM15, LTCD, iBooster, AMP Research harness) go to BAT- (the star).

### Body firewall crossing

Decided for you, replaceable: `k5-body-firewall-crossing-decided`, T3.

- **Why a separate crossing:** body circuits may not use the 61-pin, which carries engine signals only (state row 50,
  Dave). A second 61-pin is also out (row 53). So body circuits cross in their own Deutsch bulkhead.
- **The parts:**

  | Bulkhead | Part | Contacts |
  |---|---|---|
  | A | DT04-12PA-L012 flanged 12-way | size 16, 16–20 AWG |
  | B | DT 12-way, B key | size 16, 16–20 AWG |
  | P | DTP04-4P-L012 flanged 4-way | size 12, 12–14 AWG |

  - KSV sells the DT04-12PA-L012 kit, nickel pins 20–16 AWG.
  - The DTP04-4P-L012 and its size 12 contacts are in ProWire's catalog (catalog_parts).
- **The rule check:** R12 now passes a crossing wire only in a named cavity whose contacts take its gauge.
- **Gauge change:** 8 front lamp feeds that cross (#50, #73, #80, #82, #83, #84, #87, #88) go from 22 to 20 AWG. That is
  the smallest wire DT size 16 contacts take, and it is the sturdier run to the front. The 2026-05-14 gauge audit had
  set 22 AWG for these 0.3–0.8 A lamps.

### Audio, steps, brakes, gauges

- **Audio:** RetroSound Hermosa (appendix D) → Kicker 5-channel amp → speakers.
  - Head unit power, per the Hermosa manual p.16 (saved at `reference_documents/component_drawings/RetroSound_Hermosa_Manual.pdf`):
    red ignition = #31 on OUT20; yellow constant = RADIO_CONST on OUT11; black ground to the dash star; blue/white amp
    turn-on → amp REM.
  - Signal: front and rear RCA line outs. The Hermosa has no separate sub out.
  - The amp is fed direct from a MIDI 40–50 A (#32, chapters/17 §17.3) and grounded 4 AWG to the frame.
  - The door speakers pass through the door DT 12-ways, now 10/12.
  - The amp model is not picked. The saved CXA400.1 is a mono amp.
- **AMP Research steps:** the kit harness drives and reverses both motors (IM75146).
  - Its red lead goes to battery + with the kit fuse (#3), and its black lead to battery −.
  - The triggers tap the door jamb lines.
  - #1 and #2 are retired.
- **iBooster** (installed, driver firewall):
  - #52 = 8 AWG from a MIDI 40 A to pin 1.
  - Ignition to pin 20 from PDM30 OUT9, set to 5 A (chapters/17 §17.3).
  - Ground to the star.
- **E-Stopp ESK001** (ESK001 wiring diagram):
  - G, red +12 V: #54 on OUT7, always on.
  - F, blue safety to ignition: OUT10.
  - H, black ground: the frame.
  - E, green button: #126.
- **Dakota VHX** (manual p.6): each wire lands on its named terminal.
  - #39 = the park/tail feed to DIM (+) ("connect to tail light circuit"). It started at "ECU".
  - #55 = the NP205 4WD indicator switch to 4x4 (−). It pointed at an M130 input with no pin.
  - #123 = VHX GROUND to the dash star.
- **Dakota senders were missing wires** (found by reconciling the April rows). The gauge-feed lock (T1, 2026-05-14)
  names the Dakota SEN-04-5 and SEN-03-8. The Dakota manual 650314:P p.9 gives their wiring:

  | Sender | Harness | New wires |
  |---|---|---|
  | SEN-04-5 temp | two wires: WTR SND and WTR − | DAK_CTS_RET |
  | SEN-03-8 oil | three wires plus a shield: white OIL SND, red OIL + (5 V), black and shield OIL − | DAK_OILP_5V, DAK_OILP_GND |

  - v5 carried one wire for each sender and called them "factory GM" senders.
  - The three new wires take 61-pin cavities i, a and t.
  - The fuel sender gets a return to FUEL − (FUEL_SND_GND). The manual recommends a twisted pair to the sender.

### Retired, with the reason on each row

| Wire | Reason |
|---|---|
| #1, #2 | step motors: the kit harness drives them |
| #40 | ignition switch to the ECU: there is no M130 ignition pin |
| #41 | hazard flasher: the PDM makes the flash |
| #56 | neutral safety: PCS_NS does the job |
| #58 | T43-era transmission controller feed |
| #125 | T43 CAN stub: the T43 path is dead, receipt 2026-07-12 |

## Checker fixes (they changed what counts as right)

- **Far end:** a wire's far end is never its own start. The old picker reported, for example, COIL-1 as the far end
  of a coil ground that runs to the head ring, which made engine rows falsely right.
- **Stud pins:** a ring or lug on a stud is its own pin.
- **Named ends:** implied wires are judged on their full FROM string.
- **Retired relays:** the command check passes when the redesigned wire records what now switches the load.
- **Grommet:** the April direct-feed list had put #51, #48, #49, #6, #59, #63 and #52 in the power grommet. The first
  three now cross in the body bulkhead or stay in the cab. The last four run battery-corner to battery-corner in the
  engine bay (chapters/17 §17.3).
- **Loader fixes:**
  - A wire starts at the plug its record names.
  - A 20 A output's second pin is no longer taken as the far end. BLOWER_HI had loaded as PDM30-A → PDM30-A.
  - A decided call is never re-opened. The unique slug had stopped the load with HTTP 409.
  - Every subsystem now maps to a map section.

## Open (named close paths)

- DT 12-way housings, wedges and size 16 contacts: confirm the listing (KSV or ProWire), and the B-key part number.
- The washer pump: the factory 1977 pump is cam-driven on the wiper motor (Fig. 8-16). Read which pump the truck has.
- The blower control head's speed-lead count (bench).
- Ring terminal part numbers for the studs (RING-SMALL, open since 2026-09-26).
- The amp model.
- The battery isolator: unselected (state 0b); the MoTeC rule is isolate everything, with an aux contact.
- The 243 April concept rows: retire the ones v5 now covers or a locked decision kills.

## Addendum (later the same evening)

Owner asked: "is dc primary done. is dakota digital gauges and its little box figured out, could i now query you on any
piece of the wiring and youd know the answer and it be fact based". He then sent five eBay links.

- **Alternator control wire added (ALT_L):**
  - Runs PDM15 OUT9 → the 197-400 pigtail's L lead. It is on in RUN, commanded over CAN from PDM30 DIG1.
  - Holley's mid-mount fitment guide p.15 says to connect L to switched voltage on in RUN, with a charge lamp or
    560 ohm in line, and that "Holley's part # 197-400 already has the resistor in line".
  - Before this, the alternator had no control wire in the registry.
- **#122 retired.** The Dakota BRAKE (−) terminal is the brake-system / parking-brake warning input (VHX manual p.6), so a
  tap of the pedal switch would light it on every stop.
  - Nothing on the truck reports parking-brake-set or low fluid yet. The E-Stopp ESK001 diagram has no status wire.
  - The terminal stays unused, and the DAKOTA-VHX endpoint lists every unused terminal with its reason.
- **Proof of purchase from the owner's links:** five parts are now BOUGHT on the map. Each fact went through
  ingest-observation with the order record, which was read from his eBay Purchases page.

  | Part | Order date | eBay order | Total |
  |---|---|---|---|
  | Throttle body 12699160 | 2024-08-26 | order record obs:9a9e1387 | $••• |
  | 8× Siemens Deka FI114961 injectors | 2024-08-26 | order record obs:f86d4da6 | $••• |
  | 8× GM 12611424 coils | 2024-08-26 | order record obs:a7ed8806 | $••• |
  | Square-body LS-swap DBW pedal | 2025-04-02 | order record obs:273ef61a | $••• |
  | QFS-H882-367 hanger + sending unit | 2024-09-25 | order record obs:0739da53 | $••• |

  - The live cards read "BOUGHT · THE OWNER'S WORDS". Installed stays unproven.
  - **Finding:** the pedal he bought is not the GM 10379038 that the APS pin map was drawn from. Read the pedal's
    connector and OE number at the bench before that plug is crimped.
