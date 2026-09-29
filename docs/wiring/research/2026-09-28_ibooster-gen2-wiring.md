# Bosch iBooster Gen 2: wiring, safety-first (2026-09-28)

> **CORRECTION: our unit is a Gen 1, not a Gen 2.**
> - **Order:** the owner asked Calimotive Auto Recycling for **1037123-00-B** on 2023-11-08. Calimotive replied
>   that it is "listed with revision -A but we will ship out a revision B". The order (record obs:a7276b88) was confirmed 2023-11-09 and
>   UPS delivered it 2023-11-13 (owner's Gmail).
> - **Photo:** the controller label in K5 photo `40e5e5f9` (2026-01-31) reads "P/N 1?37123-0?-B … iBooster". It is
>   blurry but consistent.
> - **Part:** 1037123-00-A/B is the Tesla Model S/X **Gen 1** unit: 72 × 72 flange, 320 × 155 × 215 mm, 2 × 26 mm
>   M12x1 ports (`openinverter.org__Bosch_iBooster.md`).
> - **The Gen 2 sections below are superseded where Gen 1 differs.** The pinout, the harness and the wire list are
>   corrected here:
>
> **Gen 1 controller plug** (`www.fastandquiet.com__bosch-ibooster-gen-1-pinout.PDF.md`):
> - Pin 1 (L): always-hot, 40 A.
> - Pin 9 (L): chassis ground.
> - **Pin 17 (M): always-hot, 5 A.** This pin is extra on Gen 1; the medium 2.8 blade takes 1.5–2.5 mm² (evcreate).
> - Pin 20 (S): ignition-switched, 5 A.
> - Pins 2, 22, 8, 23: pedal travel sensor 1, 2, 3, 4. The Gen 1 sensor plug maps sensor pin 1 to controller pin 2,
>   2 to 22, 3 to 8, and 4 to 23. This differs from Gen 2.
> - CAN: vehicle 16/25, yaw 18/10, "not needed for basic operations".
>
> **Harness:** it must be **Tulay's Gen-1** universal harness, since the pedal-sensor plug differs by generation. Its
> loose leads are 4.00 mm² red (40 A), **1.50 mm² red (5 A, always hot)**, 0.50 mm² green (ignition, 5 A) and
> 4.00 mm² black (ground) (`tulayswirewerks.com__bosch-ibooster-gen-1-universal-wire-harness.md`). No Tulay order
> appears in Gmail, so the harness is not bought.
>
> **Corrected wire list, Gen 1.** These are the three existing wires plus one new one:
>
> | Id | Gauge | From | To | Fuse |
> |---|---|---|---|---|
> | #52 IBOOST_PWR | 6 AWG | Odyssey + (battery side of the 7700) | Tulay 4 mm² red, pin 1 | MIDI 40 at the post |
> | **IBOOST_PERM (new)** | 16 AWG | Odyssey + (battery side) | Tulay 1.5 mm² red, pin 17 | 5 A at the post |
> | IBOOST_WAKE | 20 AWG | wake option A or B (§4) | Tulay green, pin 20 | 5 A |
> | IBOOST_GND | 6 AWG | Tulay black, pin 9 | engine ground star | none |
>
> - Parked draw is 250 mA just after ignition-off, then 1.2 mA. Evcreate measured this on a Gen 1, so the figure now
>   applies directly.
> - Registry fixes this implies:
>   - The IBOOSTER device should say Gen 1 (1037123-00-B), not Gen 2.
>   - Add IBOOST_PERM.
>   - Change the harness to Tulay Gen-1.
>   - The fact itself belongs in Nuke as an observation, with the Calimotive order as its source.

Owner: "we barely touched on the ibooster.. very important."

Sources are saved snapshots in `reference_documents/web_snapshots/<file>`, fetched with `calc-data/fetch_sources.py`.
Forum posts are marked as forum posts: they report one builder's measurement, not a maker's specification.

## 1. Connector pinout (Gen 2, 26-way controller plug + 4-way pedal travel sensor plug)

**Controller plug** (`www.fastandquiet.com__bosch-ibooster-gen-2-pinout.PDF.md`, L = large pin, S = small pin):

| Pin | Size | Function | Harness side |
|---|---|---|---|
| 1 | L (4.8 blade) | Always-hot power, 40 A fuse | Tulay red, 4.00 mm², 3 m |
| 9 | L (4.8 blade) | Chassis ground | Tulay black, 4.00 mm², 1 m |
| 20 | S (1.5 blade) | Ignition-switched power, 5 A fuse | Tulay green, 0.50 mm², 3 m |
| 2, 8, 22, 23 | S | Pedal travel sensor 2, 4, 1, 3 | inside the Tulay harness |
| 16 / 25 | S | Vehicle CAN high / low | blind plug |
| 18 / 10 | S | Yaw CAN high / low | blind plug |

- **Unused pins:** "Pins 10,16,18,25 are not needed for basic operations" (fastandquiet PDF). Gen 2 does not use
  pin 17, the second always-hot feed on Gen 1 (`www.evcreate.com__wiring-the-ibooster.md`). So Gen 2 has one power
  pin and one ground pin, and no second feed exists to make redundant.
- **Pedal travel sensor:** it is built onto the booster but "is not internally connected so you need to wire it"
  (evcreate). The sensor plug pins 1, 2, 3, 4 go to controller pins 22, 2, 23, 8 (fastandquiet PDF, evcreate).
  - Tulay's harness has "the iBooster connector and Pedal Travel Sensor connectors … fully assembled", with three
    loose leads: red, green and black (`tulayswirewerks.com__bosch-ibooster-gen-2-universal-wire-harness.md`).
- **Terminals** (`openinverter.org__Bosch_iBooster.md`):
  - Pins 1 and 9: Bosch 1928498807, 2.5–4 mm², "Tesla uses 4 mm²".
  - Signal pins: 1928498705 or 1928498805, 0.35–1.0 mm².
  - Pedal sensor plug: TE MQS 4-way.
- **Undocumented wire:** one builder found an extra small black wire in pin 15 on a used harness. A reply suggests
  a door, brake-light or CAN-ground signal (evcreate installing page, comments). It is not in the Gen 2 pinout.
  Leave pin 15 plugged.

## 2. Standalone (no CAN)

- **What it needs:** the booster runs in "fail-safe standalone mode with no other connections … besides voltage
  supply and chassis ground" (Tulay). In that mode it "just uses the input from the travel pedal sensor" (evcreate).
- **Unit-dependent:** the openinverter wiki lists Renault Zoe/Arkana as "requires CAN … to operate" and the
  Toyota Yaris as needing a BCPM module over LIN. It lists the Tesla Model 3/Y Gen 2 (1044671-xx) with no such
  note. **Read the part number off our unit.**
- **Limitations:** the reports are forum and builder notes, not Bosch.
  - A calibration runs at power-on. If there is no light pressure on the pushrod it fails with a "rattling noise"
    (evcreate installing page; `irate4x4.com__page-17.md`).
  - "Pulsation … at IDLE" is suspected to be the pedal sensor going out of range. The cure is matching "the pedal
    leverage and thus maximum push rod travel" to the booster's travel (evcreate installing page).
  - The assist curve is fixed. "No one has yet hacked the CAN bus to change the default brake characteristic curve"
    (evcreate CAN page).
- **What CAN adds:** "The iBooster is a dual CAN device. Both channels have no termination and run at 500 kbps".
  Pushrod position appears on the yaw bus as byte 3 of 0x38E, 0x40 at rest to 0xC0 fully pressed; the stroke in mm
  appears on the vehicle bus (`www.evcreate.com__ibooster-can-bus.md`). No public command set exists.
- **Recommendation:**
  - Do not join the M1 bus. The LTC ships at 1 Mbps (LTC manual p.8), the iBooster runs at 500 kbps, and it gains
    nothing we need.
  - Blind-plug pins 10, 16, 18 and 25.
  - One Yaris builder needed 120 Ω across each CAN pair to reach failsafe mode (`openinverter.org__viewtopic.php.md`).
    Keep that as a bench fallback only.

## 3. Current, fuse and wire

- **Draw:**
  - Bosch rates the motor at "up to 450 W mechanical", a 9.8–16 V main operating range, and "< 1 A per 10 bar (at
    comfort pedal application)" (`www.bosch-mobility.com__summary-ibooster.md`).
  - One builder measured "up to 36amp in a rapid pedal pump … Sub tenth of a sec. Normal draw is around 7 to 11 amp"
    (forum, `irate4x4.com__page-15.md`).
  - Tesla fuses the main feed at 40 A and the ignition feed at 5 A. Gen 1 draws 250 mA briefly after ignition-off,
    then 1.2 mA (evcreate).
- **Our wires:**
  - #52 (6 AWG, MIDI 40) and IBOOST_GND (6 AWG) are sized for 40 A with margin (receipt
    2026-09-28 DC primary: "47 A of cable needed; 8 AWG bundled is 40").
  - The 40 A fuse matches Tesla and Tulay. A 36 A sub-0.1 s spike does not open a MIDI 40.
  - Keep the Tulay 4 mm² leads short. With 3 m red and 1 m black at 36 A, the leads alone drop about 0.6 V against a
    9.8 V floor; cut them to reach.
- **Open:** a 6 AWG to 4 mm² joint is past a D-609-05 (16–12 AWG), so the butt-splice part is not picked.

## 4. Safety: the isolator

- **The problem:** #52 comes off the distribution stud, downstream of the Blue Sea 7700. The wake comes from PDM30
  OUT9, whose supply is also downstream.
  - If the isolator opens while driving, both pin 1 and pin 20 drop and assist is lost.
  - The isolator can be opened remotely: the registry routes an "ECU-shutdown wire" to the 7700 control.
- **What the driver keeps:** Bosch describes a "mechanical push through" giving "a direct connection between the
  pedal and the master cylinder" when the power net fails.
  - That text reached us only through search summaries of Bosch material, and the Bosch pages we saved do not
    carry it. The citation is not held.
  - Whatever the exact wording, braking without assist means the driver supplies all the force the booster would
    have added, which Bosch rates at up to 6.2 kN. On a K5 that is a hard pedal and a long stop.
- **Recommendation:**
  1. Feed #52 from the battery side of the isolator: Odyssey + post, with its own MIDI 40 at the battery. This is
     the same pattern the registry already uses for the isolator's own control feed (ISO_PWR, 10 A at the post).
  2. The wake (pin 20) must also survive an isolator opening. Otherwise fixing the feed alone does nothing.
     - Option A: a 5 A fused tap on the Odyssey + post, switched by the column ignition switch RUN contact. The
       switch is rated for load; the factory switch carried the ignition feed.
     - Option B: keep PDM30 OUT9, and rule in the isolator logic that it never opens with the vehicle moving.
     - This is an owner and Dave call.
  3. Battery-side feeds stay live when the truck is isolated. The fuse at the post protects the cable, and parked
     draw is about 1.2 mA (evcreate, Gen 1 figure).

## 5. Brake lights and brake signals

- **No output for brake lights:** the booster has no brake-light output in standalone mode. Builders "use an extra
  switch in your pedals" (evcreate). Pedal position exists only on CAN.
- **Tesla keeps its own switch:** the Model Y service procedure disconnects "the brake switch electrical connector"
  separately from "the harness connectors from the brake booster assembly"
  (`service.tesla.com__GUID-0CE8F156-….md`, steps 8 and 16).
- **Our design holds:** the factory brake switch goes to PDM30 DIG14 and feeds the brake lights and the brake signal.

## 6. Installation facts that affect wiring

- **Two plugs on the unit:** the harness plug on the controller, and the brake-fluid reservoir level-sensor plug.
  Tesla step 7: "disconnect the brake fluid reservoir electrical connector". The reservoir sensor is not wired in
  the registry. A low-fluid lamp is an option; the Dakota BRAKE (−) input is already taken by the E-Stopp green wire.
- **Sealing:** the kit seals are Ø3.4–3.7 mm on the large pins and Ø1.6–1.9 mm on the small pins
  (fastandquiet, evcreate).
- **Leads:** Tulay's leads are FLRYW. Red 3 m, green 3 m, black 1 m.
- **Flange and pushrod:** they vary by donor (openinverter table). Pushrod travel must match the pedal ratio (evcreate).
- **No vacuum:** the booster has no vacuum or pressure switch.

## Wire list the iBooster needs

| Id (suggested) | Gauge | From | To | Fuse | Status |
|---|---|---|---|---|---|
| #52 IBOOST_PWR | 6 AWG | Odyssey + post (battery side of the 7700) | Tulay red 4 mm² lead, pin 1 | MIDI 40 at the post | exists; **move source from the distribution stud** |
| IBOOST_WAKE | 20 AWG | Option A: key-switched 5 A tap off Odyssey +. Option B: PDM30 OUT9 | Tulay green 0.5 mm², pin 20 | 5 A | exists; source is the owner's call |
| IBOOST_GND | 6 AWG | Tulay black 4 mm², pin 9 | engine ground star | none | exists |
| pedal sensor ×4 | inside the Tulay harness | sensor 1–4 | controller 22, 2, 23, 8 | none | in the harness, no loom wire |
| CAN 10/16/18/25 | none | blind plugs | | | none |
| brake-fluid level (optional) | 20 AWG pair | reservoir sensor | a PDM input or lamp | none | new, optional |

## Open
- The part number of our unit (1044671-xx or other), from the label or photos. Some donors need CAN.
- The 6 AWG to 4 mm² butt-splice part.
- The wake source, Option A or B.
- A first-party Bosch citation for the push-through fallback.
- The pedal ratio against the pushrod travel, at the bench.
- The reservoir sensor connector part number.

---

# Addendum: the "jailbroken" controller (2026-09-28)

Owner: "the ibooster is worth researching to integrate the powerful board it has. its been jailbroken by others."

## A1. What is public about its CAN
- **Two buses, no termination, 500 kbps:** "The iBooster is a dual CAN device. Both channels have no termination
  and run at 500 kbps" (`www.evcreate.com__ibooster-can-bus.md`). The Gen 2 pins are vehicle CAN 16/25 and yaw
  (private) CAN 18/10 (fastandquiet PDF).
- **Tesla Model 3, status only** (`raw.githubusercontent.com__Model3CAN.dbc.md`, joshwardell/model3dbc):
  - `BO_ 925 ID39DIBST_status: 5 ChassisBus` is ID 0x39D, 5 bytes. It carries:
    - `IBST_driverBrakeApply`: NOT_INIT_OR_OFF / BRAKES_NOT_APPLIED / DRIVER_APPLYING_BRAKES / FAULT. This is a brake-pressed signal.
    - `IBST_iBoosterStatus`: OFF, INIT, FAILURE, DIAGNOSTIC, ACTIVE_GOOD_CHECK, READY, ACTUATION.
    - `IBST_internalState`, which includes EXTERNAL_BRAKE_REQUEST and LOCAL_BRAKE_REQUEST.
    - `IBST_sInputRodDriver`: input-rod travel in mm, 0.015625 mm/bit, offset −5.
    - `IBST_statusChecksum` (8 bit) and `IBST_statusCounter` (4 bit).
  - **The message that makes the booster enter EXTERNAL_BRAKE_REQUEST is not in the public DBC.**
- **Tesla/Honda yaw bus:** only 0x38E and 0x38F were seen. Byte 3 of 0x38E is rod position, 0x40 at rest to 0xC0
  fully pressed (evcreate CAN page).
- **VW (e-Golf/MQB):** 0x300 carries rod position (16 bit, offset −1200). 0x3C0 terminal-15 status and 0x6C0
  gateway wake are the car's messages. A "private CAN" of 4 messages feeds VW's pressure-accumulator "smart
  actuator" (`openinverter.org__viewtopic.php__p=82361.md`).
- **GM-coded units (Chevy Volt/Bolt)** — the most complete public command set, posted in evcreate's comments by a
  builder using openpilot's GM definitions:
  - `BO_ 789 iBoosterFrictionBrakeCmd` (0x315) has `FrictionBrakeCmd`, `FrictionBrakeMode`, a `RollingCounter`
    and a 16-bit `FrictionBrakeChecksum`.
  - `BO_ 368 iBoosterFrictionBrakeStatus` (0x170) has `FrictionBrakePressure`.
  - `BO_ 560 iBoosterRegen` and pedal position/torque messages exist (evcreate CAN page).
- **Counters and checksums:** both the Tesla status and the GM command carry a rolling counter and checksum. A
  controller that commands the booster must generate them. Whether the booster drops to failsafe when they are
  wrong is not documented publicly.

## A2. What people have made it do
- **Proven by many builders:** standalone failsafe boost from power, ground and the pedal sensor alone (Tulay,
  evcreate, irate4x4).
- **Proven by reading only:** rod position and brake-applied states on CAN (evcreate, model3dbc, VW thread). This
  is the basis for regen triggering and a CAN brake signal.
- **Commanded braking:**
  - A GM-coded Volt booster runs under openpilot's friction-brake command on a Citroën conversion (evcreate comments).
    It is the builder's project; no result is published.
  - SGH Innovations sells a commercial iBooster controller ECU, V1 and V2 for Gen 2. Search summaries describe it
    as for "autonomous braking and film/tv stunt applications" and hill hold, and say that "you cannot adjust brake
    pedal feel or the amount of brake assist with this controller".
  - **Their page returned 500 twice through Firecrawl and is not held. These claims are unverified here.**
- **Not shown anywhere found:** changing the assist curve or pedal feel. "No one has yet hacked the CAN bus to
  change the default brake characteristic curve" (evcreate).
  - In reply to "Did anyone already manage to get the ibooster to work on can-input only?", the answer was
    "Unfortunately not that I am aware of" (evcreate comments).
- **Not found:** an iBooster driver in ZombieVerter (EVBMW's open VCU). The ZombieVerter support threads mention
  the Yaris "Brake Control Power Module" as the booster's backup power, not control.

## A3. Boards, and whether our MoTeC can do it
- **What builders used:** openpilot/panda hardware for the GM command (evcreate comments), and SGH's commercial ECU.
  No open-source firmware that commands a Tesla Gen 2 was found.
- **M130:**
  - It has **one** CAN bus (M1 hardware techspec p.6: "CAN 2.0B 1" for the M130; pins B17/B18, M130 datasheet p.5).
  - The M1 family has "Definable CAN speeds, timeouts, transmit, and receive messaging … implemented in the CanComms
    libraries which are incorporated into scripts by the application developer" (techspec p.15). So custom messages
    with counters and checksums need a package or a developer script, not a user setting.
  - That one bus already carries the M130 → PDM30 → PDM15 → LTC trunk. The LTC ships at 1 Mbps (LTC manual p.8)
    and the booster runs at 500 kbps. All devices on a bus must share one bitrate (PDM manual p.24).
- **PDM:**
  - It can run at 250 kbps, 500 kbps or 1 Mbps (manual p.33).
  - It receives CAN to control outputs, and transmits "4 messages, 8 bytes per message", at 20 Hz standard or
    50 Hz user-defined (manual p.39).
  - It cannot compute a rolling checksum. It could only *read* 0x39D (brake applied), and only if it shared the
    booster's bus.
- **Conclusion:** active control needs a separate CAN node on its own 500 kbps bus. The M130 cannot host that bus.
  The PDM is too limited to command it.

## A4. What it would need in our harness
- **Read-only first step:** a twisted pair from iBooster pins 16/25 (vehicle CAN) to a logger or node, 120 Ω at
  each end, since the booster has none (evcreate). This is a separate 500 kbps bus, not the M1 trunk.
- **Active control later:** the same pair plus a controller node (location open: cab, near the PDM30), its power
  and ground, and possibly the yaw pair 18/10.
- **Pedal sensor:** the four pedal-sensor signals already run inside the Tulay harness to the controller. Tapping
  them for a second reader is not recommended: they are the booster's own safety input.

## A5. Risk and a sane first step
- **What the projects keep:** all of them keep the booster's own failsafe (pedal sensor → assist) and the mechanical
  pushrod path; the pushrod link is not held in a first-party Bosch source (see §4). No project found removes them.
- **Step 1, now:** standalone only, as wired in the table above. The battery-side feed and wake fix from §4 is the
  real safety item.
- **Step 2:** read-only CAN on pins 16/25 with a USB logger. Confirm 0x39D and decode the brake-applied and rod
  signals on our unit. Nothing is transmitted.
- **Step 3, only if wanted:** active requests (hill hold, auto-hold) through a dedicated node, after the unit's part
  number and command message are confirmed. The Tesla command is not public today. **Owner and Dave decision;
  brakes are safety-critical.**

## Addendum open items
- The command message that drives EXTERNAL_BRAKE_REQUEST on a Tesla Gen 2 is not public.
- Whether a bad counter or checksum makes it fall back to failsafe is not documented.
- SGH Innovations' controller page could not be saved.
- The bitrate our M1 bus actually runs at is not recorded in the wiring docs.

## A6. "Jailbroken": what is proven, what is claimed, what is unknown (second pass)

**Proven, with a named source:**
- **Standalone boost on the Tesla Gen 1:** power + ground + pedal sensor, pin 20 ignition, pin 17 always-hot.
  EVcreate (Lars) runs a Tesla Model S 1037123-00-B in a 1967 Volvo Amazon (`www.evcreate.com__installing-the-ibooster.md`,
  `www.evcreate.com__wiring-the-ibooster.md`). The Tulay and fastandquiet harness vendors document the same.
- **Reading the booster:**
  - Two buses, unterminated, 500 kbps.
  - Yaw bus 0x38E byte 3 carries rod position, 0x40 at rest to 0xC0 fully pressed (`www.evcreate.com__ibooster-can-bus.md`).
  - On the vehicle bus, evcreate decoded "Brake input stroke in mm" using Tesla's `tesla_models.dbc`. The message
    ID was not printed.
- **Tesla Model 3 (Gen 2) status decode:** 0x39D `IBST_status`, which carries brake-applied, status, internal state,
  rod travel in mm, an 8-bit checksum and a 4-bit counter. It is public in joshwardell/model3dbc
  (`raw.githubusercontent.com__Model3CAN.dbc.md`).
- **Tesla Model S (Gen 1):** openpilot's `tesla_can.dbc` has `BO_ 522 BrakeMessage` (0x20A) with `driverBrakeStatus`
  APPLIED / NOT_APPLIED, but no sending module is named (`raw.githubusercontent.com__tesla_can.dbc.md`).
  **Whether our Gen 1 unit transmits it is unknown until logged.**

**Claimed, not verified here:**
- **Commanded braking on GM-coded boosters:** a Chevy Volt booster runs under openpilot's friction-brake command,
  0x315 with a rolling counter and a 16-bit checksum. This is posted in evcreate's comments; no outcome is published.
- **SGH Innovations' commercial controller:** V1 and V2 are sold for autonomous braking, stunt work and hill hold.
  The page could not be saved.
- **"Regen blending":** the Bosch/VW design intent. VW's cars use a separate pressure-accumulator module on a
  private CAN (openinverter VAG thread). No retrofit has published it working.

**Unknown or not found:**
- **Reflashed firmware:** no firmware or bootloader for the iBooster controller was found. Public
  "jailbreaking" means sniffing and replaying CAN, not reprogramming the board.
- **A published Tesla command that forces EXTERNAL_BRAKE_REQUEST.** The state exists in the Model 3 DBC; the request
  does not.
- **Any iBooster driver in Damien Maguire's (EVBMW) GitHub or ZombieVerter:** searches found his Stm32-vcu and
  ZombieVerter work, but no iBooster module.
- **Whether a wrong counter or checksum drops the booster to failsafe or to fault.**
- **Adjusting the assist curve:** "No one has yet hacked the CAN bus to change the default brake characteristic
  curve" (evcreate).

**Can the M130 be the controller later?**
- **Not on a second bus.** The M1 hardware techspec (p.6) lists "CAN 2.0B" at **1** for the M130 and M150/M170-class
  units at 3.
- The M1 family offers "Definable CAN speeds, timeouts, transmit, and receive messaging … implemented in the
  CanComms libraries which are incorporated into scripts by the application developer" (techspec p.15).
- So an M130 could only talk to the booster by putting it on its single bus. That bus is the M130 → PDM30 → PDM15
  → LTC trunk, and every device on it must share one bitrate (PDM manual p.24; the LTC ships at 1 Mbps, LTC manual
  p.8; the booster is fixed at 500 kbps).
- Any rolling counter or checksum would need a CanComms script from a MoTeC developer.
- **Recommendation:** read-only logging with a USB-CAN tool first. If active control is ever wanted, use a dedicated
  node on its own 500 kbps bus, or an M1 unit with 3 buses. **Do not put the brake booster on the engine trunk.**
