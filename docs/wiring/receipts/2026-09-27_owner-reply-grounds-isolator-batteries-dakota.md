# Receipt: grounds in the loom, the isolator, both batteries, and the Dakota BRAKE / CHECK ENG / GEAR lamps

- **Date:** 2026-09-27 (night)
- **Change type:** registry design (local toolchain `docs/wiring/calc-data/`) → map rows
- **Amends:** `receipts/2026-09-27_whole-truck-body-circuits.md` (its "Named ground studs" section and the addendum's
  #122 finding)
- **Ask (owner, 2026-09-27):**
  - "we need to know the wiring schematic as priority. theres always a work around eexcept if we forget to run a wire in
    the loom"
  - "dave runs his grounds in the looms ... would be dumb to be grounding to body all the time"
  - "pick the isolator"
  - "we wanted to do an odessey for the running and also a yellow optima for other stuff like accessories"
  - The pedal: "you should be able to figure out what it is based on the number of pins and the shape of the pin block"
  - "the washer pump hasnt been selected for the vehicle up for selection"
  - The blower switch wire count: "you have the part number and can research it"
  - The fuel hanger plug: "if its a crappy one we would change it to milspec as needed"
  - "the t case is manual ... unless we do some fabbing which is possible. it has manual hubs too"
  - "it makes sense youd want brake, check eng and gear to work"

## Measured (registry, `check_plug_ends.py --wires` and plain `check_plug_ends.py`)

| Set | Wires | Right | Incomplete | Wrong |
|---|---|---|---|---|
| Whole truck, v5 + designed, before this batch | 301 | 289 | 12 | 0 |
| Whole truck, v5 + designed, after | 325 | 315 | 10 | 0 |
| Engine-start set, after | 170 | 167 | 3 | 0 |

- **Wire ends (plug-end rules R1–R7):** 792, none failing.
- **Firewall:**
  - Body bulkhead A: 12/12. B: 12/12 (was 7/12). P: 1/4.
  - 61-pin: 58/61, spares c, t, u. The isolator's shutdown wire left it, because the M130 now reads the isolator from a
    splice in the cab.
  - Power grommet: gains GND_RET_CAB.
- **The 10 still open:**
  - The 7 PCS TCM-2650 wires and FUEL_SND_GND, unchanged.
  - COIL_GND and PDM_BPOS: their write-ups don't list them yet (R14), unchanged.
- **Closed by this batch:** PDM_GND1/2, which now land on the ground star's ring list.

## Decided (each row carries its source in the registry)

### Grounds run in the loom
- There are no more body studs. Each zone's returns run in the harness to a ground bank:
  - **GND-BANK-ENG, the ground star.** A stud bank beside the batteries. Both battery negatives, the block (G1), the
    frame (G2) and every engine-bay return land here. It is the only place the harness grounds meet the chassis.
  - **GND-BANK-CAB.** An insulated bus beside the PDM30. It returns through GND_RET_CAB (2 AWG, power grommet).
  - **GND-SPLICE-REAR.** An insulated bus where the rear harness branches. It returns to the cab bank through
    GND_RET_REAR (10 AWG).
- On the map, the 9 old studs (G-FRONT-L/R, G-FIREWALL, G-KICK-L/R, G-ROOF, G-REAR, G-FRAME-REAR, DASH-STAR) are
  superseded and point at their replacement bank. Nothing was deleted.
- Moved ends:
  - The fuel pump ground and the amplifier ground (4 AWG) return to the ground star.
  - The E-Stopp ground returns to the rear bus.
  - The radio ground and the Dakota ground (#123) go to the cab bank.
- Small returns take rings. The heavy ones (battery negatives, G1, G2, the cab return, amplifier, iBooster, DC-DC)
  take lugs on the stud list.

### The isolator: Blue Sea 7700 ML-RBS, on the battery positive
- **Why not the Cartek XR.** The first pick, the Cartek XR, was dropped the same night. Its own instructions (p.3) say
  "designed for motorsport use only and should not be used on road/street vehicles".
- **What MoTeC requires:** the isolator on battery positive, able to take starter current, with "a secondary switch
  that is connected to a shutdown input on the ECU" (PDM user manual p.7). Chapters/17 §17.3 draws the same order:
  battery → isolator → distribution stud.
- **The Blue Sea 7700, from its instructions (saved):**
  - Magnetic latch: "draws no current in ON or OFF state" (p.1).
  - Cranking rating: 1,000 A for 30 s on 2/0 cable (p.1).
  - Studs A and B are interchangeable, 3/8"-16, 140 in-lb max (p.2). The 238LTP lugs fit, which closes the "1/2 in
    isolator stud" unknown.
  - Control leads: red (24 hr power, 10 A min fuse at the battery), black (ground), brown (close), orange (open),
    yellow (LED output). "Use minimum 16 AWG wire for the Control Circuit" (p.2).
  - Lined up at Powerwerx for $322.09.
- **New wires:**
  - ISO_OUT: stud B → distribution stud, 2 AWG. #63 now ends on stud A.
  - ISO_PWR and ISO_GND: the unit's control power and ground, engine bay.
  - To the included 2145 dash switch, through body bulkhead B (16 AWG): ISO_CLOSE, ISO_OPEN, ISO_LED and ISO_SW_PWR
    (a fused 24 hr feed, so the switch can close the isolator again).
- **The shutdown contact (ISO_KILL):**
  - The yellow output grounds the switch's LED while the isolator is closed. The M130's UDIG7 (B14) tees off it in the
    cab.
  - UDIG input per the M1 hardware spec p.9: switchable 3k3 pull-up via a diode to 5 V, programmable trigger level,
    200 V peak. It reads low while the isolator is closed and high when it opens, and the tune stops the engine.

### Batteries
- **Odyssey:** the running battery. It carries #63, ODY_NEG (2 AWG to the ground star), and two fused taps that stay
  live when isolated: the isolator's control power and the dash-switch feed.
- **Optima YellowTop:** the accessory battery.
  - Wires: ACC_NEG (4 AWG to the star) and #32, the amplifier feed through a MIDI 50 A at its post. #32 used to come
    from the distribution stud.
  - It is charged by a Victron Orion-Tr Smart 12/12-30 non-isolated DC-DC charger ($215.05 at Powerwerx).
  - The charger's input comes off the distribution stud, downstream of the isolator. Its engine-running detection
    starts and stops it, so it needs no enable wire.
  - The isolator does not cut the YellowTop. The YellowTop feeds only the amplifier.
- Model and tray for both batteries are set at the mock-up.

### Dakota lamps (owner: "brake, check eng and gear")
- **CHECK ENG:** DAK_CEL runs M130 A32 (OUT_HB4, free since #118 retired) → VHX CHECK ENG (−). The pin is set as the
  warning output in the tune.
- **BRAKE:** DAK_BRAKE runs E-Stopp wire E (green) → VHX BRAKE (−).
  - E-Stopp's troubleshooting page: "The green wire is a low-current switched ground" (about 25 mA, for a brake
    indicator).
  - This corrects the addendum's "the ESK001 diagram has no status wire". On that diagram E is labelled "Ground Sync
    Trigger". #126's plug label is corrected to the button harness.
- **GEAR:** a Dakota GSS-3000.
  - "Connect a wire to 1-WIRE on the GSS-3000 to the GEAR terminal" (manual MAN# 650715:G, saved).
  - The decoder takes +12 V ignition (a second wire on #71's output) and a ground to the cab bank.
  - Its sensor sits on the transmission detent shaft with a 10 ft 3-wire cable. The cable is in the loom as
    GSS_SENS_R/G/B.

### Smaller calls
- **Pedal.** The bought pedal is a GM Gen III truck pedal (15751307 family, 9-cavity plug, 6 wired; the listing now
  sells it as APS130, "9 Terminal").
  - Pins: G APP1 5 V, F APP1 signal, E APP1 low ref, D APP2 low ref, C APP2 signal, B APP2 5 V.
  - The plug is the ICT WPAPP30 pigtail ($26), joined with red MiniSeal splices. The GT150 6-way housing and TPA leave
    the cart change.
  - The pin map is from web sources, so meter the pedal before crimping.
  - The M130 drives the throttle body itself, so the pedal need not match it.
- **Blower.** The A/C resistor has 3 prongs (gmsquarebody threads 5343, 38262, saved), so BLOWER_M2 is added
  (bulkhead B cavity 8). Count the control head's leads when it is out.
- **Washer.** An electric pump in the jar replaces the 1977 cam pump on the wiper motor.
  - Lined up: USA1 85-87 jar kit (20530, $56.90) and pump (20151, $19.95).
  - Confirm the pump is electric before carting.
  - Two wires: #50 and its ground in the loom.
- **Fuel hanger.** The 4 wires are fixed: pump +, pump ground, sender, sender ground. The plug is read when the tank
  is out, and replaced with a sealed milspec-grade 4-way if it is light duty.
- **Transfer case.** A fabricated sealed plunger switch at the shift lever, closed in 4H/4L → VHX 4x4 (−).
  TCASE_SW_GND carries its ground in the loom. The hubs stay a by-hand check.

## Sources saved this batch (gitignored)
- `reference_documents/component_drawings/`: `BlueSea_7700_ML-RBS_Instructions_990180170-006.pdf`,
  `Cartek_Battery_Isolator_XR_Instructions.pdf`.
- `reference_documents/web_snapshots/`: Blue Sea 7700 page, Powerwerx 7700 + Orion pages, Dakota GSS-3000 manual,
  ICT WPAPP30, E-Stopp ESR1-CM / how-to / FAQ / troubleshooting, gmsquarebody threads 5343, 38262 and 26964, and the
  USA1 washer jar and pump pages.

## Open (named close paths)
- **Mock-up:** battery models and trays; the isolator, DC-DC and ground-bank spots; the GSS cable route; the washer jar
  fit.
- **When the parts are out:** the pedal meter check; the blower control-head lead count; the hanger plug; the Orion
  terminal type.
- **Body bulkhead B is full.** The next body crossing needs a third DT 12-way (C key).
- **The map loader still writes design rows directly.** Moving it onto a sanctioned write function is still open.

## Addendum: audio, carts (later the same night)

Owner: "as for the amp and subs we need to price that out and do shopping cart stuff. need to do that for the electric
windows too. and whatever else."

- **Measured after:**
  - Registry: 328 wires, 318 right, 10 incomplete, 0 wrong.
  - Live map, logged out: the same, section by section (Power + grounds 34/35, Engine 106/107, Dash 42/43, Body
    79/79, Lighting front 30/30, Lighting rear 20/20, Powertrain 7/14).
  - Open calls on the map: 1, where the M130 mounts. The owner has said it is not a priority.
- **Woofers corrected to the owner's own call.** On 2026-09-25 he said "we are gonna do jbl 10" compact woofers, an
  amp not sure which and then the appropriate other speakers" (build book, YOUR PICK row 6).
  - A Kicker CompR 12 was written first by mistake. That decision row was superseded by `k5-amp-decided-jbl`, not
    overwritten.
  - The pick is two JBL Club 102SL 10" shallow-mount woofers: 350 W RMS, 2/4 ohm switch, 3.25" deep, in stock at
    Crutchfield for $274.95 each. Crutchfield lists the 102SL as the in-stock replacement for the Club WS1000.
  - Each is set to 4 ohm and the two are paralleled to 2 ohm: SUB-2 plus jumpers SUB_JMP_P/N (10 AWG, per the build
    book's woofer jumper).
- **Amp: Kicker 46CXA660.5**, $449.99. It is rated 65 W × 4 at 4 ohm plus 300 W × 1 at 2 ohm. Crutchfield: "4-gauge
  power and ground leads and an 80-amp fuse recommended", so #32's MIDI at the YellowTop is now 80 A (was 50 A).
- **Speakers:** 2 pairs of Kicker 46CSC654 6.5" coax at $99.99 a pair.
- **Radio: RetroSound Motor 2B for 73-87 C/K** at $346.99, in the Hermosa's place. The Hermosa is out of stock at
  Classic Parts ($279.95).
  - Its manual (saved) lists front, rear and sub pre-outs (p.3), and the same red, yellow and black power leads as the
    Hermosa (p.19-20).
  - New wire RCA_SUB runs from the radio's sub out to the amp's sub input.
- **Carts:** no browser was connected, so the build book's new section "6. Audio, windows, power: lined up Sep 27" has
  14 linked lines, $3,709.19 before shipping and tax. Every price was read from a saved page snapshot.
  - Gmail shows no order for any of them.
  - The window kit is Nu-Relics 17383-2 at $508 plus switch option #201 at $116. It was billed on SW77006 ($1,800,
    paid).
- **Build book decision table updated:** battery (owner's call), disconnect (Blue Sea, with why not Moroso or Cartek)
  and audio (the picks above).

## Addendum 2: Kicker ruled out; carts on the truck's map

Owner: "kicker is not cool... what a brand for a 100k truck.. what are the top brands? not excessive but whats teh a
tier and s tier".

- **Amp and speakers are now JL Audio. The JBL woofers stay (his Sep 25 call).**
  - Amp: JL VX700/5i, 5 channels with DSP, $1,449.99. It has the same layout as before (75 W × 4 + 300 W at 2 ohm).
    Crutchfield: "4-gauge power and ground leads and a 60-amp fuse recommended", so #32's MIDI is 60 A.
  - Speakers: 2 pairs of JL C2-650X at $279.99 a pair.
  - The JL XD700/5v2 is no longer available at Crutchfield.
  - The decision row was superseded again, now as `k5-amp-decided-jl`.
  - Build book section 6 is updated: $5,069.19 across 14 lines.
- **Carts on the truck's map** (the owner's surface: "why are you serving me on claude artifacts when the 77 blazer
  has a profile").
  - PR #359 (merged 09115408) renders a LINED UP rung from `structured_data.listing`: site, part, quantity, the price
    read and when, stock, and the link, with the footer "a listing, not a purchase". Section rollups count LINED UP.
  - 14 LINED UP rows were written through ingest-observation (source `parts-vendor-listing`) onto 23 plug cards.
  - Checked live, logged out, on the AMP, window motor and Odyssey cards.
- **Plug types fixed.** The loader typed plugs from their descriptions first: "switches ground" read as GROUND,
  "cluster" as DISPLAY, and "manufacturING" as RING. It now reads the code first, then description words from a word
  start. This corrected 29 plugs, including the coils, switches, amp, radio and woofers.
- **Measured after:** registry = live map, 328 wires, 318 right, 0 wrong, 10 incomplete. One open call (M130 mount).
