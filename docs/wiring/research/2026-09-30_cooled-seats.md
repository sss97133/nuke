# Cooled front seats — 1977 K5 factory buckets (research, 2026-09-30)

- **Ask (owner, 2026-09-29, verbatim):** "instead of being extra annoying I think we have one more thing we can look into
  which would be air-conditioning we can insert a AC pad on the seats not because then we have to worry about HVAC at least
  looking into how would we actually doair condition seats"
- **Read as:** cooled seats from a self-contained pad or insert in each front seat, not cold air ducted from the HVAC box.
  Ducted designs are out in one line: they need a duct from the Four-Season box to each seat, so the HVAC gets designed
  around the seats, which is what the owner wants to avoid.
- **Change type:** research. Nothing was bought and no message was sent. The registry and `endpoints.yaml` are not edited.
  The candidate options are in `calc-data/catalog/options.yaml` (SEAT-TED, SEAT-VENT). The receipt is
  `receipts/2026-09-30_research-cooled-seats.md`.
- **Sources:** web pages are snapshotted to `reference_documents/web_snapshots/` (gitignored), fetched 2026-09-29 through
  Firecrawl at one request per 10 s per host. Nuke database rows are cited by id. Manuals are cited by printed page with
  the PDF page in brackets.
- **Search limit:** this session's web-search allowance ran out early (200 of 200 calls). After that, products were found
  only by following links on pages already fetched. A wider search could turn up a branded fan-only kit with published
  specs. None turned up here.

## 1. The seats today (from the records)

- **They are the factory 1977 bucket seats.** The driver seat sits on a fore-aft adjuster. The passenger seat tips forward
  on a pivot bracket, and a restraint cable holds it to the floor (1977 Light Truck Service Manual p.2D-35 [PDF p.161],
  Fig. 2D-85 and 2D-86, Model 14). The 1987 manual describes the same parts: "Place the seat in its forward position ...
  Allow the seat to tip forward", with the pivot stud, springs and cable in Figure 4 (1987 Light Duty Truck Service Manual
  pp.10A2-3 to 10A2-5 [PDF pp.1280-1282]).
- **The reupholstery is finished, and the seats are back in the cab.** Read from `vehicle_observations` on the K5:
  - 2021-04: the worn original plaid buckets were photographed at the upholstery shop (34750bfd-c8a1-47bb-8a38-9186d6f7c6fc,
    c2d98cdb-2cd5-4f10-8ece-78b186ea3489). A macro of the weave was taken for pattern matching
    (f8d84e4e-8370-42a0-92c5-cf487ecd45ba).
  - 2025-04-07: the plaid cloth was bought, an OEM-pattern beige/orange/black plaid (work record
    d2e34faa-be6f-4c59-abf0-14b3641b76c0). The invoice photo names it 77-7438 (da799c2b-2df7-49de-a259-bf1c15dce248).
  - "Reupholstered plaid buckets, console and maroon door panel in" and "freshly reupholstered tan/orange plaid seats ...
    at the upholstery shop" (82b6946f-3e0f-4efc-953c-dbf3516e4a68, a52685a9-db24-4533-9ea4-069e1bc91cc8). These rows are
    dated 2025-10-31, but both images carry the identical timestamp to the microsecond, so the date is not from the camera.
  - 2026-01-31, camera date in the file's EXIF: the cab interior is being reassembled around the new plaid buckets, with
    the console and carpet in (a4966700-e362-4881-9ca8-c1c78b4c3f1a; also cf21c5fa-27fb-455b-b3f6-2015307b6ddb,
    8f288fe1-c010-4d66-bf48-ae8a116e7603).
  - Nothing later shows the seats. No record says whether the truck has left the shop.
- **What that means for cooling:** the seats are not apart any more. Any pad, fan or module means pulling the finished
  covers (hog rings), cutting the foam, and re-covering.
- **What the covers are made of,** from the photos above: plaid cloth on the seating faces of the cushion and backrest, and
  tan vinyl on the sides, the bands and the whole back of each backrest. Cooling can only come through the plaid. The vinyl
  back is closed, and that decides where the backrest blower draws its air (§4).

## 2. How a seat is made to feel cool

Every system in this file uses the same seat layout, drawn in Gentherm's patent US 7,966,835 B2 ("Thermal module for
climate-controlled seat assemblies", `patents.google.com__US7966835B2.md`):
- Channels are cut or moulded into the cushion foam, with a passage through the foam from below.
- A scrim covers the channels. Over it sits a distribution layer that "spreads the air ... along the lower surface of the
  covering".
- The cover must pass air: "an air-permeable fabric made of natural and/or synthetic fibers" or "leather ... with small
  openings".
- Air is pushed up through the cover or pulled down away from the body.

The technologies differ in what happens to the air before it reaches you.

1. **Fan ventilation.** A small blower under each cushion and behind each backrest moves cabin air through the pad and the
   cover. The air is not cooled. The seat feels cooler because the hot, damp layer between your back and the seat is carried
   away and sweat can dry. Gentherm describes its "CCS Vent" as delivering "a pleasant, dry and comfortable microclimate on
   the seat surface ... with either push or pull technology" (`gentherm.com__climate-comfort.md`). The air is only as cold as
   the cab: with the truck's A/C running, the blowers draw cooled cabin air from under the seat. On a heat-soaked cab
   they move hot air until the A/C pulls the cab down. **No maker in this file publishes a number for the cooling effect.**
2. **Thermoelectric (Peltier) module.** A solid-state module is put in the air path. Current through it pumps heat from
   the air going to the seat into a second air stream, the waste or exhaust air, which must be ducted away. Reversing the
   current heats instead. Amerigon (now Gentherm), which put these into Cadillacs: "Ambient air is drawn into the system
   from the cabin ... the system's advanced heat pump heats or cools the air ... a highly efficient, solid-state
   thermoelectric device (TED)" (2005 release, `ir.gentherm.com__amerigons-climate-control-seattm-ccstm-system-offered-option.md`).
   The patent shows each module with a main heat exchanger, a waste heat exchanger and a fan.
   - **How much colder:** Katzkin's brochure says its active cooling "reduces the temperature of the intake air by as much
     as 15 degrees". The brochure gives no unit (`katzkintoolbox.com__Degreez2020.md`). No per-setting figure was found.
   - **What it costs in power:** the Sanctum kit asks for "a circuit with a minimum of 15 amps per unit" (one unit is one
     seat) and ships a 15 A inline fuse (§3). At 14 V that circuit is 210 W. That is the circuit's size, not a measured draw.
   - **Where the heat goes:** every watt the module draws ends up as heat in the cab, along with the heat it moves out of
     the seat air. The exhaust duct carries it out under the seat. If the exhaust is not ducted away, "the fan will ingest the
     exhaust preventing proper heating or cooling" (DIY install report, `www.jeepgladiatorforum.com__degreez-heated-and-cooled-seat-install-with-katzkins-leather.26971.md`, forum evidence).
3. **Anything else real:**
   - Liquid cooling. The racing version is a garment, not a seat: an ice chest, a pump and a water-tube shirt. COOLSHIRT
     sells the "Club Cooler System", from $350.00; the 7.5 qt configuration on its page reads $553.00
     (`coolshirt.com__index.md`, `coolshirt.com__7-5qt-club-cooler.md`). It needs ice or a chiller. A chiller is a second
     refrigeration system, which is what the owner wants to avoid, and no seat-insert version was found.
   - Passive gel or phase-change cushions. PRP sells a "3-layer gel infused cushion that has cooling properties"
     (`www.prpseats.com__cooled-and-heated-compatible-seats.md`). It needs no power and publishes no number. It is an
     upholstery choice, not a harness item.
   - Ducted HVAC air to the seats: out, for the reason given at the top.

## 3. Products

The notes under each product give the kit contents, the module size and where it goes, the current, the control, the noise,
the waste heat and condensation, and what the cover must be. "Not published" means the fetched pages say nothing about it.

### Thermoelectric (the kind that cools the air)

- **LeatherSeats.com "Sanctum Automotive Heating & Cooling Seat Ventilation System"** (sold by LeatherSeats.com under its
  own Sanctum brand). **The pick. It fits this truck.**
  - Part number: none published (product page, no SKU).
  - Price: $400.00 per seat, 2026-09-29. "NOTE 1 UNIT = 1 SEAT." (`leatherseats.com__seat-heater-cooler-unit.md`)
  - Kit, from the installation guide (`leatherseats.com__sanctum-heater-cooler-installation-guide.md`): per seat, a TED and a
    centrifugal blower for the cushion and another pair for the backrest, air distribution pads, duct tubing for the outputs
    and exhausts, a control module, a "control switch" with "all six settings: High, Mid, and Low for both the heater and the
    cooler", a unit wiring harness, a power harness, a relay, a 15 A inline fuse, an exhaust bezel that becomes the backrest
    air intake on closed-back seats, and cutting templates.
  - Size: the distribution pad sits in a ⅜ in trench in the foam ("trench out the seat foam ⅜” to allow the distribution
    pad to lay flush"). TED and blower dimensions: not published. The TED goes "as close to the center of the distribution
    pad as possible", on the back or bottom of the seat. "Mounting the TED/Blower assembly may require some fabrication or
    modification to the seat."
  - Current: "a circuit with a minimum of 15 amps per unit"; "rated for a minimum of 15 amps for one unit, or 30 amps for
    two units"; includes a 15 A inline fuse. Current at each of the six settings, and the inrush: not published.
  - Control: the kit's own switch and control module. The maker wires it with the relay on a constant 12 V feed (pin 30),
    triggered from an ignition feed (pin 86). No PWM input, no LIN, no CAN.
  - Noise: not published.
  - Waste heat: "Use included ducting to route exhaust from the TED unit away from the TED and blower assembly."
    Condensation: not addressed.
  - Cover: "These units REQUIRE both PERFORATION and HIGH FLOW MESH FOAM", and "Our TED units are also functional on factory
    upholstery as long as the material is perforated and has some form of flow foam". Open-cell reticulated backing foam is
    sold as an add-on, ½ yard for $40.00.
  - Install: remove the covers, trench the foam, cut the TED output hole through the foam, mount the TED and blower, route
    the exhaust, cut a bezel hole in a closed seat back, bench-test all six settings, re-cover. "This product requires
    advanced knowledge of automotive electrical systems and may require heavy modification or fabrication to the seat."
- **Katzkin DegreeZ.** Katzkin's own rule rules it out here.
  - Part number: listed as MPN "DEGREEZ" (eBay listing 173889532891), not a real part number.
  - Price: $499.99 per seat (`sealeddeals.com__katzkin-degreez-car-heated-cooled-seats-heating-cooling-auto-leather-1-seat.md`),
    or $519.99 plus $25.00 shipping on eBay (`www.ebay.com__173889532891.md`), both 2026-09-29.
  - Kit, per seat: "1 main harness • 1 switch • 1 vent (exhaust or fresh air intake) • 1 fuse parts bag • 2 distribution
    pads • 2 TED's • 2 blowers • 2 universal ductwork".
  - Settings: "3-levels of heat and 3-levels of air conditioned comfort", one switch. Cooling claim: "reduces the
    temperature of the intake air by as much as 15 degrees" (brochure, no unit).
  - Size, current, inrush and noise: not published. It comes with a fuse bag; the fuse rating is not stated.
  - Cover: "Degreez heating and cooling can only be installed on a Katzkin perforated leather interior" (`katzkin.com__degreez.md`),
    and the seller says it needs "reticulated, open cell foam AND perforated leather". Katzkin also says it doesn't sell the
    kits; its installers fit them "while installing your custom leather seats".
  - The truck's plaid cloth is not a Katzkin interior. A Jeep owner reports fitting it under cloth anyway: "works great. sure
    it would be a little better preferrated" (forum evidence).
- **Get New Seats "Universal Heated & Cooled Seat Wiring Kit"** (OEM Gentherm TED seats from Ford and Nissan).
  - Part number: none published (product ID 49878721134808).
  - Price: $649.00 sale, $869.00 regular, 2026-09-29 (`www.getnewseats.com__thermoelectric-heated-cooled-seat-install-retrofit-kit.md`).
  - Kit: "Standalone Computer Module (1) · Complete, Labeled Wiring Harness (1) · Universal Control Switch (1) · Instruction
    Booklet (1)". It runs "factory thermoelectric heating and cooling systems with just a simple 12-volt connection". It
    fits the TED seats of the listed Ford and Nissan models (F-150 2009–2017, Super Duty 2011–2019, Mustang 2015–2026,
    Titan 2016–2021 and others). It does not fit 2018+ F-150 or 2020+ Super Duty seats: "they're only ventilated, not
    thermoelectrically cooled". A single TED "can cost you $150".
  - Why it doesn't fit here: it runs OEM seats, and the truck keeps its 1977 buckets. The only route is moving a donor
    seat's TED modules and pads into the buckets. The module part numbers for that were not found.

### Fan ventilation (moves cabin air, no cooling)

- **Universal seat ventilation kit, unbranded, eBay item 386015618313.**
  - Part number: none (item specifics: "Brand Unbranded", China).
  - Price: $340.00 plus $4.50 shipping, 2026-09-29, for one seat, "3-setting switch ... mesh included" (`www.ebay.com__386015618313.md`).
  - The seller describes itself as a maker of "automobile seat heaters ... and seat ventilation system".
  - Fan count, size, current, noise and cover requirement: not on the page. The seller's description no longer loads
    (HTTP 410).
- **Universal seat ventilation kit, unbranded, eBay item 285252981715.**
  - Part number: none ("Manufacturer Part Number NO", China).
  - Price: $165.00, 2026-09-29, one seat (`www.ebay.com__285252981715.md`).
  - Specs: not on the page.
- **OEM ventilation blower, e.g. Volkswagen 3G0 963 345 "Temperature Controlled Seat Blower Motor".**
  - Price: MSRP $46.22, 2026-09-29 (`parts.vw.com__3g0963345.md`).
  - Why it doesn't fit here: an owner who bench-tested these fans reports "3 leads - 2 for power and one for LIN ... The fans
    will not start turning, unless they are instructed to do so by the LIN (tested)"
    (`www.vwidtalk.com__ventilated-front-seats-mod-retrofit.4712.md`, forum evidence). Neither of our boxes speaks LIN. The
    M130 has no LIN port ("LIN –" for the M130, M1 hardware techspec p.6), and the PDM talks only through its inputs, CAN and
    logic (PDM user manual p.1). Gentherm's own ventilation blowers are OEM-only ("CONTACT US", `gentherm.com__cooling-ventilation.md`).

**Not found (said plainly):**
- A fan-only kit from a named maker with a part number and published specs.
- Current at each setting, inrush, module dimensions or noise for any kit in this file.
- Condensation guidance from either thermoelectric maker.
- NREL's ventilated-seat study: www.nrel.gov no longer resolves (Firecrawl, 2026-09-29).

## 4. The plaid cloth

- **Woven cloth can pass air:** Gentherm's patent names "an air-permeable fabric made of natural and/or synthetic fibers"
  as a cover. The Sanctum page says its units work on factory upholstery that breathes and has "some form of flow foam".
- **The backing decides it.** Cloth inserts are often sewn over a foam or scrim backing. If that backing is closed foam, no
  air gets through, and the inserts would have to be re-sewn over open-cell (reticulated) backing. That takes more 77-7438
  cloth and the upholsterer's time. What backing went into these covers is only known to the upholsterer. Test it before
  buying kits: blow through an offcut of the finished insert, or hold a small fan against the inside of a cover that's
  already off.
- **The vinyl doesn't need to pass air.** It is the sides and backs, not the seating faces.
- **The closed vinyl backrest needs an intake.** Sanctum: "On seats with a fully enclosed backrest cover, the included
  exhaust bezel must be repurposed as an air-intake for the backrest blower" — one bezel hole in the tan vinyl back of each
  seat.

## 5. How it would run in this build

- **Outputs.**
  - Thermoelectric: one 20 A output per seat. Two kits need 30 A ("30 amps for two units"). One 20 A output can be set to
    at most 25 A (PDM user manual p.24), so they can't share one.
  - Fans: one 8 A output shared by both seats. Each kit has its own switch and controller.
- **Room on the PDM30 (registry `capacity`, main at 09c291120).**
  - 20 A outputs: 6 of 8 used. The 2 spare, OUT3 and OUT4, are the power-window candidate's (PW, the owner's open call:
    "yet to decide if we doe electric windows").
  - 8 A outputs: 21 of 22 used. The spare, OUT21, is the lock candidate's (PL). PL already flags OUT21 as too small for it.
  - The candidates already on file ask for 7 outputs against those 3 spares. The PDM30 has no room of its own, and adding
    the seats makes it 9.
  - **What it would take,** because this depends on open calls (pre-flight gate item 5):
    - (a) No power windows: the seats get OUT3 and OUT4 (pins A5+A14 and A7+A16, from the registry's 34_PT1/PT2 and
      35_PT1/PT2).
    - (b) The second PDM in the cab, as `mounts.yaml` recommends for the PDM15: its spares are one 20 A output and four 8 A
      outputs (registry `capacity`). One seat goes on the 20 A output and the other on two 8 A outputs in parallel. The
      manual allows that: "Outputs that are connected in parallel must all be of the same type" (p.6). The 8 A pins take
      24–20 AWG (p.6), and 20 AWG allows 8 A × 0.85 = 6.8 A each (p.48), so that seat's limit drops to 13.6 A. The PDM15
      is rated 80 A in total (p.35), and about 45 A of its loads are known today (registry `pdm_settings`), so run its
      budget first.
    - (c) Move two 20 A loads from the PDM30 to a cab PDM15.
    - If the second PDM stays in the engine bay, the seat feeds can't reach it. Nothing but the 61-pin crosses the firewall,
      and its #20 contacts are too small for these feeds (state rows 0ah and 44).
    - Changing the PDM30 for a PDM32 doesn't solve the thermoelectric pair. It has the same eight 20 A outputs, and only two
      more 8 A outputs (PDM user manual p.1). Those two would carry the fan option.
- **PWM fan speed from our boxes: no.**
  - PDM user manual p.28: "Note: Motor speed control is currently not supported." PDM outputs switch on and off.
  - The M130 has PWM half-bridges (4 A RMS, high side 1 kHz; M1 hardware techspec p.11). They are the engine computer's
    pins, and 52 of 60 are used (registry `capacity`), so they stay off the table.
  - Levels come from the kit's own controller. That is how both kits are built anyway.
- **Switch: the kit's own**, in the console or on the seat (owner's call). It needs no PDM input, which matters because the
  PDM30 has only DIG8 and DIG16 left and the auto-start and 4-low candidates want three. If the top-design lane's CANKEY
  candidate (a MoTeC CAN keypad on the dash) is built, one of its buttons could be a master on/off for the seats (PDM user
  manual p.29). The keypad can't pick the kit's six settings, so the kit's switch stays either way.
- **Engine-running interlock, so the seats can't drain the battery.** The seat outputs switch on only when all of these
  are true:
  - RUN is on: PDM30 DIG1 (IGN_RUN_B).
  - START is off: DIG10 (IGN_START).
  - Engine RPM is above cranking speed.
  - The RPM comes from the M130 over CAN. The M1 General stream is base ID 0x640 with engine RPM, 16-bit, at offset 0
    (`DAKOTA_VHX_ARCHITECTURE.md`, compatibility notes, from the VHX manual p.29 and a forum answer).
  - The PDM can read it: "A CAN message contains a 16 bit RPM value ... The resulting channel can be used in conditions to
    turn outputs on when the RPM is above or below pre-set limits" (PDM user manual p.38). Conditions: p.22.
  - MoTeC names this use itself: "Logic functions can be used to selectively turn off systems during low battery voltage
    or engine starting" (p.1).
  - The threshold goes between cranking speed and the tune's idle target. It is set in PDM Manager, not guessed here.
  - With the outputs off, the PDM can drop to standby, 5 mA typical (p.34–35).
- **Fuse: the PDM output is the fuse.** The kit's relay and inline fuse are left out. That follows state §1 ("PDM replaces
  relays") and canon ch.17 §17.8.6 (PDM-switched loads carry no inline fuse).
  - Thermoelectric: limit 15 A per seat, the kit's own fuse rating. By the canon rule (limit ≥ 1.25 × load), that holds up
    to a 12 A measured draw.
  - Fans: limit at 1.25 × the measured total.
  - Motor start-up current "3 to 5 times the steady state current ... is largely ignored by the PDM due to the Output Load
    filtering" (p.28).

### Wire gauge (canon ch.16 §2, ch.17 §17.1)

Rules applied:
- Limit ≤ 0.85 × the wire's rating, and limit ≥ 1.25 × load (ch.17 §17.1.3).
- A wire bundled with others more than 24 in is rated on the bundled chart: ProWire 35 °C rise, 12 AWG 20 A, 14 AWG 15 A,
  18 AWG 10 A, 20 AWG 7 A (ch.16 §2.1, §2.3).
- MoTeC's table, p.48: 20# 8 A, 16# 15 A, 14# 22 A at 80 °C.
- Drop ≤ 3 %, which is 0.42 V at 14 V (ch.16 §2.4).
- Resistance from ProWire's M22759/32 table: 12 AWG 2.02, 18 AWG 6.23, 20 AWG 9.88 Ω/kft
  (`www.prowireusa.com__m22759-32-tefzel-wire.md`). /32 stops at 12 AWG, so 10 AWG is M22759/16 at 1.26 Ω/kft (canon
  ch.16 §1.8).

Run lengths are **estimates**, and two legs of each are the agent's own unmeasured allowances:
- The PDM30 is at the driver-side dash (`mounts.yaml`; its exact spot is open).
- Driver seat: down the kick panel (about 0.5 m, unmeasured), back half the 940 mm door opening
  (`cad/dimensions.yaml` fr88.body.door.F-C), inboard and up to the plug (about 0.3 m, unmeasured), plus the build's 12 in
  service loop (canon ch.18 §4). That is 1.57 m, plus the 15 % body pad (state §1): **6 ft**.
- Passenger seat: the same, plus the 1746 mm crossing under the dash between the hinge pillars (fr88.body.apillar.A-B):
  **12.5 ft**. A route across the tunnel under the carpet would be shorter but isn't measured.
- The receipt proposes a tape item (T-16) that replaces these with measured runs.

| Circuit | Wire | Why | 3 % drop holds up to |
|---|---|---|---|
| Thermoelectric, PDM 20 A output pins | 2 × 16 AWG /32 pigtails to an M81824/1-3 splice | the 20 A outputs take 20–16 AWG per pin (p.6); same pattern as every other 20 A output (state 0ac) | — |
| Thermoelectric feed and ground, driver | 12 AWG M22759/32 | bundled 20 A × 0.85 = 17 A ≥ 15 A limit | 17.3 A (12 ft loop) |
| Thermoelectric feed and ground, passenger | 12 AWG M22759/32 | as above | **8.3 A** (25 ft loop). 10 AWG holds to 13.3 A, but the DTP size-12 contact takes only 14–12 AWG (parts.yaml 0460-204-12141). Measure first. |
| Fans, PDM 8 A output pin | 20 AWG /32 pigtail | 8 A outputs take 24–20 AWG (p.6); 8 A × 0.85 = 6.8 A ceiling; a pigtail is under the 24 in bundling threshold | — |
| Fans, feed and ground to each seat | 18 AWG M22759/32 | drop, not current | 5.6 A driver, 2.7 A passenger (per seat) |

So the thermoelectric passenger feed can't be closed on paper. Its gauge waits for the kit's measured current on the
bench. That is the "calculate first, cut last" order (state §2).

### Seat disconnect, sealed, from families already in the build

- **The seal decides the housing version.** Deutsch's "WIRE SEALING RANGE" table gives two seals per contact size (Deutsch
  DT/DTM/DTP datasheet, https://www.farnell.com/datasheets/628276.pdf printed p.5 [PDF p.3], snapshot
  `www.farnell.com__628276.md`):

  | Contact size | N-seal (standard) | E-seal (reduced) |
  |---|---|---|
  | #16 (DT) | .088–.145 in (2.24–3.68 mm) | .053–.120 in (1.35–3.05 mm) |
  | #12 (DTP) | .134–.170 in (3.40–4.32 mm) | .097–.158 in (2.46–4.01 mm) |

  - The E-seal is the "C015 modification", which "offers a reduced diameter insert cavity allowing for a proper seal with
    smaller wire insulation" and "is also referred to as an 'E' seal" (Deutsch DT family catalog p.23 [PDF p.7],
    `reference_documents/component_drawings/DEUTSCH_DT_DTM_DTP_Catalog.pdf`).
  - The same datasheet's front-page summary ("DTP ... Seals on .097” to .170 dia. (2.46mm to 4.32mm)", PDF p.2) spans both
    seals, so it can't be read as one housing's range.
  - The part numbers in the catalog and below are the standard (N-seal) parts. The E-seal part numbers are not on file
    (OPEN: vendor page).
- **Thermoelectric: Deutsch DTP 2-way, E-seal version.**
  - Floor/harness side: DTP04-2P with wedge WP-2P and size-12 pins 0460-204-12141. Seat side: DTP06-2S with WP-2S and
    sockets 0462-203-12141 (`www.customconnectorkits.com__dtp04-2p.md`, `__dtp06-2s.md`; $4.29 and $3.29 each,
    2026-09-29, standard seal).
  - Rated 25 A per contact on 12 AWG (datasheet p.5, contact table).
  - 12 AWG /32 is 2.62 mm nominal (ProWire table). That is inside the E-seal (2.46–4.01 mm) and under the standard seal's
    3.40 mm minimum, so the seat plugs must be the E-seal version.
- **Fans: Deutsch DT 2-way, E-seal version.** DT04-2P with W2P, DT06-2S with W2S, size-16 contacts 0460-202-16141 and
  0462-201-16141 (20–16 AWG; 10 A test current on 18 AWG, datasheet p.5). 18 AWG /32 is 1.52 mm: inside the E-seal
  (1.35–3.05 mm), under the standard seal's 2.24 mm.
- **Which side gets pins:** pins on the harness side and sockets on the seat side follow the door pass-throughs in
  `endpoints.yaml`. With the engine-running interlock, the harness side is dead whenever the engine is off. Pins versus
  sockets on the live side stays the builder's call, as in the lamp research.
- **Plug location:** the seat half goes on the seat frame, the floor half P-clipped under the seat. Leave a service loop
  that covers the driver adjuster's travel and the passenger seat's tip-forward. Neither travel is measured.
- **The kit's switch cable** needs its own break for seat removal if the switch goes in the console. Either use the kit's
  own switch plug in the dry cab, or re-pin it into a DT alongside the power plug once the kit is in hand and its pin count
  and gauge are known.

### Floor route to the cab harness

- From each seat plug, forward along the floor under the carpet, then up the kick panel to the PDM at the driver-side dash.
- The passenger run crosses under the dash with the cab harness.
- Keep the loom clear of the seat bolts, the driver adjuster rails and the passenger pivot and restraint cable.
- The builder confirms the path on the truck (wiring-receipt rule: agents don't decide a wire's physical route).
- The carpet is already in (photo a4966700-e362-4881-9ca8-c1c78b4c3f1a), so it gets lifted along the route.

### Budget checks before this is decided

- PDM30 total: 100 A continuous (p.35). The load currents on file add to 86.7 A (registry `pdm_settings`). Many of those
  loads are momentary (windows, locks, tailgate, outlet), and the blower HIGH current is still unmeasured. 30 A of seats
  would be the biggest continuous load added, so the budget needs the measured blower and seat currents.
- The alternator is the Holley 197-302, 150 A (state 0e(f)). The load budget hasn't been rerun since the April
  `pdm_power_budget.md`, which is stale. Add the seats' 30 A limit when it is.

## 6. Recommendation

**Thermoelectric seats: two Sanctum kits, one per bucket.** Keep fans only (SEAT-VENT) as the toggle.

- It is the only one of the three that cools the air. Fans move cabin air, and liquid cooling needs ice or a second A/C.
- It is self-contained: nothing is ducted from the HVAC, as the owner asked.
- Of the thermoelectric kits, it is the only one sold to anyone. It comes with written steps for any seat, including closed
  backs. Katzkin's kit is locked to Katzkin leather, and the Get New Seats route needs a donor OEM seat's modules.
- It also heats, on the same switch, at no extra wiring.
- It costs $400.00 per seat (2026-09-29). Upholstery labour is extra and not quoted. One DIY report puts a similar
  thermoelectric kit at "8-10 hours on seat removal and degreez install" for one seat (forum evidence).
- It holds only if these four checks come back right:
  - The plaid inserts breathe (§4).
  - Two cab PDM outputs are found (§5 a–c).
  - The bench current closes the passenger feed gauge.
  - A thermoelectric module and blower fit inside or behind the thin 1977 backrest. The back's depth is not measured.
- If any check fails, fans are the fallback: one 8 A output and 18 AWG. But no fan kit with published specs was found.

## 7. What the upholsterer does, and when

When: in one visit, with both kits in hand, before the cab harness is laced. The seat feeds' gauge depends on the step 8
measurement.

1. Remove the seats.
   - Driver: the adjuster-to-floor bolts.
   - Passenger: tip it forward, unbolt the restraint cable, the spring retaining bracket and the lower bracket (1987 manual
     p.10A2-3).
2. Pull the covers. Note which listing wires the pads will cover. The guide allows floating one listing attachment.
3. Check the plaid inserts' backing (§4). If it's closed foam, re-sew the inserts over reticulated backing.
4. Trench the cushion and backrest foam ⅜ in for the pads. Cut the TED output holes through the foam, and through the seat
   base where needed.
5. Mount each TED and blower. Cushion: under the seat, on a bracket to the frame. Backrest: inside the back if it fits,
   otherwise under the seat with a duct up.
6. Duct every exhaust down and out, away from the intakes. Keep it off the rear passengers' feet if possible.
7. Cut the intake bezel hole in each vinyl seat back (kit template).
8. Bench-test all six settings on 12–14 V before closing. We clamp-meter each setting and the start-up current at this
   step, and listen for noise.
9. Re-cover and hog-ring.
10. Mount the control module under the seat. Crimp the DTP06-2S onto the kit's power leads. Leave out the kit's relay and
    fuse (§5).
11. Fit the switches where the owner picks.

## 8. Questions only the owner can answer

1. Cooled seats at all, and which: thermoelectric (cools the air and heats, $400 a seat, 15 A a seat) or fans only (cabin
   air, $165–$340 a seat, low current)?
2. Power windows, yes or no? The answer decides whether the seats get PDM30 OUT3/OUT4 or wait on a cab PDM (§5).
3. OK to reopen the finished seats? Kits need the covers off, the foam cut and a bezel hole in each vinyl seat back. And if
   the plaid's backing doesn't breathe, OK to re-sew the inserts with more 77-7438 cloth?
4. Where do the switches go: the console or the seat?
5. Is the truck still at the upholstery shop, and does the upholsterer know what backing is under the plaid?

## 9. Drafts for the owner to send (not sent)

**To the upholstery shop:**
> On the plaid buckets you finished for the K5: what did you laminate or sew behind the plaid inserts (foam type and
> thickness, or scrim)? We're looking at adding heated/cooled seat kits (a TED module and blower under each cushion and in
> each backrest, air pads under the covers). That would mean pulling the covers, trenching the foam ⅜ in, cutting a small
> intake bezel into each vinyl seat back, and re-covering. Can you do it, and what would you charge? If the backing blocks
> air, what would re-sewing the inserts over open-cell backing take?

**To LeatherSeats.com (Sanctum):**
> For the Sanctum heating and cooling seat kit, can you send (1) the current draw at each of the six settings and at
> switch-on, (2) the TED/blower assembly dimensions for the cushion and backrest units, (3) a noise figure if you have
> one, (4) whether it works under woven cloth over open-cell backing with no perforation, (5) whether a cushion unit can
> run alone, and (6) the wire gauge of the kit's power harness?
