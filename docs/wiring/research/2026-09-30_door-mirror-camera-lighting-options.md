# Door, mirror, camera and lighting add-ons: 1977 K5 (research, 2026-09-30)

- **Ask (owner, 2026-09-29):**
  - "you can only build what you know is there so if you're building something without validated information account for that
    and then you have to kind of rerun the loop of like finding what is the option ... it's not bad if we have multiple options it
    just means that toggling between the options becomes faster"
  - "let's think about the door for a little bit if we wanted to like add like a side camera it hooks into the side mirror even
    like sensors"
  - "ideally in a perfect world like actually billet style side mirrors reproductions from the original style"
  - "there's a lot of space in these gigantic vintage bumpers"
  - "we haven't done any wiring planning headliner planning for the rearview mirror"
  - "on the doors I really like ... the light puddle"
  - "do we still run them through the motec computer ... it seems like we have so many plugs that are open"
  - "if we build it and it's 80% complete we can just toggle it on and off the wiring harness and we see all the huge effects"
- **Scope:** side-mirror cameras, blind-spot sensors, turn/caution lighting in the mirrors, doors and bumpers, door puddle
  lights, a windshield camera, rear-view-mirror screens, the headliner run to the mirror, and billet reproduction mirrors. Also
  the owner's washer correction (§10).
- **Change type:** research, plus candidate options in `calc-data/catalog/options.yaml` (codes MCAM through DGND). Nothing is
  decided. No purchase was made, no message was sent and no account was created.
- **Sources:**
  - Web pages are snapshotted to `reference_documents/web_snapshots/` through Firecrawl, one request per host every 10 s. That
    folder is gitignored. A snapshot is named `<host>__<last path part>.md`. Prices are the page's price on 2026-09-29.
  - Factory documents are cited by PDF page.
  - Registry facts come from `calc-data/k5_registry.json` on main at 4753699d4.

## 0. Where these add-ons run: the M130, a PDM, or their own module

The owner asked whether they run through the MoTeC computer, since "it seems like we have so many plugs that are open". The
facts come from the registry capacity ledger (`k5_registry.json` key `capacity`) and its pin rows.

| Resource | What is open | What it means for add-ons |
|---|---|---|
| M130 (60 pins, 52 used) | AV1, AV4, AT4, UDIG5, UDIG6, INJ_LS1, INJ_LS2, BAT_BAK (`m130_pinout` rows with no wire) | These are engine inputs and injector-type low sides. No add-on here needs an ECU input. The engine computer should not feed body accessories: body loads live on the PDMs (state §1 row 54, "PDM replaces relays") |
| PDM30 outputs (8 × 20 A, 22 × 8 A) | Base + decided use 6 + 21. The spares are OUT3/OUT4 (20 A) and OUT21 (8 A), and the PW and PL candidates take exactly those | The body PDM has no free output once windows and locks go in |
| PDM30 inputs (16) | DIG8, DIG16 | Two switch inputs |
| PDM15 (engine PDM) | OUT8 (20 A), OUT10, OUT12, OUT14, OUT15 (8 A); 13 inputs (DIG1 goes to the BFL candidate) | These are the "open plugs". State row 0ag already recommends moving the PDM15 into the cab (its case is not sealed, MoTeC PDM manual p.35). That would put these spares where the door and mirror add-ons live |
| Door hinge pass-throughs (DT 8-way each side, `DOOR-L-PASS` / `DOOR-R-PASS`) | Base + decided use 2 of 8 (speaker pair). The PL candidate takes 4. Spare: 6, or 2 with PL | This is the real bottleneck for mirror and door add-ons (§9) |

**Recommended control path for every add-on:**
- **Put small loads on existing PDM30 outputs.** Share outputs that follow the same switch position, the way the design
  already groups markers, park/tail, courtesy and backup ("PDM Channel Grouping", `chapters/05-build-manifest.md`). The PDM
  already runs the logic these need. "Outputs are controllable via a combination of switch inputs, CAN messages and logic
  functions", with Flash, Pulse, Set/Reset, Toggle and more, and the limits are programmable in 1 A steps (MoTeC PDM user
  manual PDF p.4).
- **Give each sensor system its own maker's module.** The radar ECU, camera switcher and Mobileye unit are each
  self-contained. The PDM30 gives them power and trigger signals.
- **Keep the MoTeC CAN bus for MoTeC devices.** None of these modules joins it (see §2 and §5).
- **For buttons, use a MoTeC CAN keypad before a PDM input.** A keypad (up to four per PDM, PDM manual PDF p.21) adds
  buttons, for example a camera-view or puddle-lamp override, without using an input.

Result: the picked versions take **no new PDM30 output, no PDM30 input and no M130 pin**. They do change several output
current limits (each option's `limits`) and need door cavities (§9).

## 1. Side-mirror cameras (options MCAM, MCAM-BIL)

| Version | Maker, PN, price (2026-09-29) | Size, power, signal, plug | Route and control | Status |
|---|---|---|---|---|
| **Stick-on camera under the current mirror (pick)** | EchoMaster **PCAM-BS1**, $119.00 each (`catalog.echomaster.com__pcam-bs1.md`) | 26 × 50 × 23 mm; **70 mA**; power "9V-12V DC"; NTSC 648 × 448; 80°; IP67; NTSC composite on a "VIDEO" lead (plug type not stated); leads: red +12 V, black ground, loops for mirror image and parking lines (user manual, `catalog.echomaster.com__index.php__controller=attachment&id_attachment=2113.md`) | Camera under the mirror → door → hinge conduit → cab → switcher (MIRD input 3/4) or the mirror's CH2. Power from the PDM30 OUT23 group (RUN). Shown on the turn signal by the switcher | Validated, with one open item: the manual's 9-12 V rating against a running truck's ~14 V (ask EchoMaster, draft §8.5) |
| **Camera built into a billet mirror** | EchoMaster **PHD5N1**, $159.00 (`catalog.echomaster.com__phd5n1.md`) | AHD 720p or CVBS 480p selectable, 170°, IP67, five mounting housings, 5-pin EchoMaster plug + 20 ft extension, RCA. **Current and body size not published** | Same route. The pocket, lens window and seal are the billet maker's job (BMIR) | Partly validated. It needs BMIR, so it is a separate candidate (`alternative_to: MCAM`) |
| Vehicle-specific mirror caps with cameras (reference only) | EchoMaster FC-GMLD103-MC, $900.00, for 2016-18 Silverado/Sierra: two mirror-cap cameras (70°, IP68) + a four-camera switching interface (`catalog.echomaster.com__fc-gmld103-mc.md`) | — | Shows the integrated approach. It does not fit this truck | Not a candidate |
| "Tesla-style" repeater camera | Tesla Model 3/Y side repeater camera | The camera bolts into the side repeater with two bolts and an O-ring, and is calibrated from the car's own screen, with up to 100 miles of self-calibration (Tesla service manual, `service.tesla.com__GUID-E473ED74-9C48-4106-936F-C6A8806AAF5B.md`). The video is serialized as FPD-Link over coax to the Autopilot computer (Tesla Motors Club thread, `teslamotorsclub.com__tesla-fender-camera-output.301521.md`; forum evidence, not a Tesla document). HW4 parts use new connectors (`www.notebookcheck.net__Tesla-HW4-vs-HW3-…-retrofit.726575.0.md`) | Would need a deserializer and a video converter. It is not a harness option | Not usable. The billet mirror copies its idea with the camera above |

**Signal:** every picked camera and screen is analog CVBS (1 Vp-p, 75 Ω, the RC mirror's input spec). Video is shielded cable by
canon (ch.16 §7.1).

**The hinge:**
- The coax crosses the hinge unbroken inside the door conduit, not through a DT cavity. Its joints sit on the dry cab side.
- Door conduits are listed at Affordable Street Rods: Specialty Power Windows FWC-BA, $75 a pair; XLFWC, $49; Watson Street
  Works TP-NYLON-1/2, $49 (`calc-data/catalog/suppliers/affordablestreetrods.yaml`, 2026-09-29).
- OPEN: the conduit's inside diameter against the coax plus the door bundle.

## 2. Blind-spot and side sensors (options BSM, BSM-SD2)

The K5's bumpers are steel. That rules out the common consumer kits whose makers say they are for plastic bumpers only.

| Version | Maker, PN, price | Specs | Route and control | Status |
|---|---|---|---|---|
| **License-plate radar bar (pick)** | Rydeen **BSS2LPB**, $699.00 (`rydeenmobile.com__bss2lpb.md`) | "Applicable for metal bumper vehicles (pickup trucks)". Bar at the top or bottom of the plate; 52° horizontal; truck 1-80 ft; 9-18 V; **< 100 mA**; radars IP67, "Cables: NOT waterproof". Two LED indicators for the A-pillars, a buzzer, and a GPS antenna that gates alerts above 20 mph | Main unit in the cab. Power from the OUT23 group. Turn inputs tapped from OUT27/OUT28, the optional reverse input from OUT15 (inputs per the BSS1 manual, `rydeenmobile.com__BSS1-Instruction-Manual-1.md`). The bar cable follows the RC plate camera into the body. Speed from its own GPS, so nothing touches the MoTeC CAN | Validated |
| **Commercial side radar** | Sensata **PreView Side Defender II** (SDII87) ×2 + a PreView display (D2002 or G2000). No price published (distributor stock) | 24 GHz FMCW; 9-33 V; **< 0.5 A**; IP69K; 4.90 × 4.06 × 1.28 in; 1.0 lb; Deutsch **DT06-08SA** (1 battery +, 2 ground, 3 CAN H, 4 CAN L, 5 display +, 6 display ground, 8 turn input); J1939 250 kbit/s, not terminated (the product page adds 500); aux output sinks 1 A, "to drive an LED indicator in a side mirror". Mount 23-39 in high and **137-197 in back from the front edge**. "Do not connect ... directly to the vehicle CAN bus", use the display as a one-way gateway. "Intended for commercial use"; the product page calls it "a reliable legacy solution" (`www.sensata.com__preview-side-defender-II-user-manual.md`, `www.sensata.com__preview-side-defender-ii.md`) | Sensors on the rear body sides; their J1939 runs privately to the PreView display | Partly validated. The mount zone is drawn for trucks and buses. Whether a 106.5 in wheelbase Blazer (2,705 mm, state §6 twin scale) has body side 137-197 in back at the right height, clear of metal, is not checked |
| Radar pucks behind the bumper | Rydeen BSS3, $699.00 | 24 GHz, 9-18 V, < 200 mA, "Not applicable with metal bumpers (See BSS2LPB)" (`rydeenmobile.com__bss3-…-system.md`). The BSS1 manual says the same: "only intended for plastic bumpers" | — | Excluded by its maker for this truck |

Parking sensors in the bumpers (ultrasonic) are a different function and were not picked. Rostra's product pages redirected
to a category page with no specifications (`www.rostra.com__backzone-truck-parking-sensor-system.php.md`).

## 3. Turn and caution lighting: mirrors (MTS, MTS-SOG) and bumpers (BML)

### 3.1 Mirror repeaters

| Version | Maker, PN, price | Specs | Control | Status |
|---|---|---|---|---|
| **Sealed 3/4 in LED in the mirror head (pick)** | Grote **MicroNova Dot 49343** amber; no price on grote.com | **0.05 A**; 1 in lamp in a **3/4 in hole**; "extends less than 3/8 in"; .180 bullet or Deutsch versions, PC and P2 (`www.grote.com__49343.md`). The MicroNova family is FMVSS 108 PC-rated clearance/marker (`www.grote.com__47973.md`) and is used here as a supplementary repeater | Splice onto the front turn outputs OUT27/OUT28 (#80/#82). The PDM already flashes them, and hazard lights both (DIG4 + DIG5, registry) | Validated. The stock chrome head takes a drilled hole; a billet head takes a pocket |
| **Signal-on-glass arrow behind the mirror glass** | Example of the part: Boost Auto Parts **T1SOG**, $113.25, "adds an integrated red turn signal on glass" to 2019+ GM tow mirrors (`boostautoparts.com__t1sog.md`) | For a billet head the glass and the LED board are custom. **No supplier found** | Same outputs | Partly validated (`alternative_to: MTS`, `requires: BMIR`) |

### 3.2 Bumper lamps, and the bumper that won't stay put

| Version | Maker, PN, price | Specs | Control | Status |
|---|---|---|---|---|
| **Park/turn lamp set into the front bumper face (pick)** | Truck-Lite **60094Y**, $83.88 each (`www.trucklightparts.com__truck-lite-60094y.md`) | 44-diode amber oval; SAE/DOT front park and turn; **0.55 A turn / 0.08 A park**; 12 V; 3 wires, 16 gauge; sealed; 2.32 × 6.5 in lens; grommet into a **2.5 × 6.75 in cut-out**; Fit 'N Forget S.S. with a PL-3 adapter | Splices on the existing front park/turn feeds (#80/#82 turn, #83/#84 park) in the front lamp loom, so no new output and no crossing. They follow wherever the front loads end up (state 0ah). A DT 3-way at the bumper bracket lets the bumper come off (same family as the lamp research, `research/2026-09-28_lamp-sockets-led-sealed.md`) | Validated. It means cutting the bumper face |
| A bumper with lamps already built in | LMC **38-9896**, "Chrome Bumper w/Fog Lights", 73-80, $463.95: "two 3-3/4 in diameter fog lights" (`www.lmctruck.com__cc-1973-87-custom-chrome-front-bumper-lighted.md`) | Fog lamps, not turn signals. Lamp electrical data not on the page. The listing names pickups and Crew Cab, not the Blazer | A fog output would be new (not designed) | Listed only |
| Small round marker in the bumper | Truck-Lite 10 Series 2.5 in amber, $23.72, **0.1 A**, SAE PC clearance/marker, PL-10 plug (`centrevilletrailer.com__truck-lite-10-series-…-clearancemarker-light.md`) | Marker only, not a turn lamp | Park/marker group | Listed only |

**DRL is not designed.** No DRL-rated lamp was picked, and SAE J2087 (the DRL standard) is paywalled. A DRL would also need its
own output, the bay PDM's.

**Why the bumpers wander, and the fix:**
1. The factory mounts every 1977 truck bumper on "standard bracket and brace to frame mountings" (1977 Light Truck Service
   Manual p.111).
2. The torques are on p.114 (C, P and K models):
   - front bumper 35 ft-lb
   - front bumper bracket and brace 70 ft-lb
   - rear bumper to outer bracket 35 ft-lb
   - rear outer bracket and brace 50 ft-lb
   - license plate bracket 18 ft-lb
3. Replace missing or worn braces and bolts with LMC's Blazer/Suburban kits (`www.lmctruck.com__csb-1973-91-bumper-brace-kits-and-bumper-bolt-kits.md`):
   - front brace kit 30-3769 (73-80), $60.95
   - front bolt kit 30-0190, $16.55
   - rear brace kit 30-3767, $61.95
   - rear bolt kit 30-0192, $19.71
4. Torque to the manual, then lock the position. Witness marks at the least; pinning or doweling the brackets after alignment
   is shop practice, not a cited rule, so it is the builder's call.
5. Lamps in the bumper sit in their own grommets, which isolate shock. Their aim then doesn't depend on the bumper holding
   perfectly.
6. Any radar in or on a bumper has aiming tolerances of ±2° (Sensata, above). A bumper that moves takes a sensor out of spec,
   which is another reason the pick is the plate bar.

## 4. Door puddle lights (options PUD, PUD-MIR)

| Version | Maker, PN, price | Specs | Control | Status |
|---|---|---|---|---|
| **Flush lamp in the door bottom (pick)** | Lumitec **Echo** flush courtesy light, SKU 1122, $39.19-40.99 (`www.apexlighting.com__echo-flush-mount-led-courtesy-light.md`) | 45 lm; **145 mA at 12 V**; IP67; threaded nut; 12 V only; made in USA. A search result for a second listing gave about 45 mA: check the part | Splice onto OUT25, the courtesy group the jamb switches DIG12/DIG13 already drive. A PDM off-delay keeps it lit after the door shuts (Pulse/timer, PDM manual PDF p.4) | Validated |
| **Lamp in the billet mirror's underside** | GM **84408372** LED puddle light kit for exterior mirrors, bowtie logo, $150.94 (MSRP $175.00), a driver + passenger pair for 2019+ GM heated power mirrors with factory puddle lighting (`www.chevypartspros.com__84408372.md`); or a universal 18 mm LED, 12 V, 10 W nominal, 120-140 lm, from $11.99 (`undergroundlighting.com__led-puddle-lights.md`) | GM module size and current not published. A 10 W module is about 0.83 A (10 W / 12 V) | Same output | Partly validated (`requires: BMIR`) |

Door-edge warning lamps and logo projectors were not picked.

**OUT25 is near its wire's limit:**
- Its limit today is 6 A for 4.73 A of incandescent courtesy lamps (registry).
- Two Echo lamps take it to 5.02 A, which needs a 7 A limit at 1.25×.
- That is above 85 % of a 20 AWG lead: 8 A at 80 °C, so 6.8 A (MoTeC PDM manual printed p.48, "Wire Specification" table).
- So either the OUT25 pin lead goes to 18 AWG, or the base lamps go LED as the lamp research already proposes.

## 5. Forward windshield camera (option FWC)

| Version | Maker, PN, price | Specs | Control | Status |
|---|---|---|---|---|
| **Collision and lane warning camera (pick)** | **Mobileye 8 Connect** (4G) with an EyeWatch display. Price not published | From the Technical Installation Guide v3.0, Nov 2023 (`fleetsafe.com.au__Mobileye-8-Connect%E2%84%A2-Technical-Installation-Guide-4G-v3.0.md`):<br>- 10-36 V; full system **1 A at 12 V** (12 W max)<br>- main unit 120 × 78 × 44 mm, 200 g, on a 3 m cable<br>- inputs: BAT+ and ignition each through a 2 A fuse; ground; analog VSS; AUX (both turn signals through diodes); high-beam IHC output<br>- camera 1.2-2.65 m above the road, inside the wiper sweep, within 8 % of vehicle width of centre, roll within 2°<br>- "installation must be carried out by an authorized" installer<br>- "Internet access is mandatory to configure and calibrate" | BAT+ tapped from OUT11 (constant). Ignition from the OUT23 group. Speed from the Dakota VHX SPD OUT (2,000/4,000 PPM, VHX manual p.8, as the endpoints note) as analog VSS, not the MoTeC CAN: Mobileye's CAN reader works from its own vehicle database. AUX through two diodes (not picked) from #80/#82. IHC is not used, because high beams stay on the factory floor dimmer (state §1 row 39) | Validated, with owner terms: an authorized installer and online calibration |
| Recording-only front camera | Brandmotion FullVUE (FVMR-1100) mirror, which has a "Built-In Front Facing Camera with DVR Recording" (`www.brandmotion.com__fullvue-mirror-vision-system.md`) | See §6 | Comes with MIRD-FV | Listed under MIRD-FV |

The main unit sits on the glass behind the mirror, and its 3 m cable shares the HDL route down the A-pillar.

## 6. Rear-view mirror screens (RC decided; options MIRD, MIRD-FV, MIRD-360)

**The decided RC kit:**
- Rear View Safety RVS-7180355-IR, $317.99 (`www.rearviewsafety.com__license-plate-backup-camera-system-rvs-7180355-ir.md`).
  The page now titles it "Past Part #RVS-7180355-IR".
- Mirror: 4.3 in; **"Video Input 2 Channel"**, 1 Vp-p 75 Ω; power "DC 9V - 32V"; **8 W**; 10.55 × 3.15 × 1 in; 800 g.
- Plate camera RVS-0355-IR: 1 × 7.5 × 1 in; 12-24 V ±10 %; IP68; 170°; 33 ft camera cable.
- The box includes a "Power Harness with Two Camera Inputs".
- The 8 W answers RC's open OUT23 current: 0.67 A at 12 V.
- Two items to read on the kit:
  - The same monitor on its own page (RVS-718, $203.55) lists "DC 9V - 18V" (`www.rearviewsafety.com__oem-rear-view-replacement-mirror-monitor.md`).
  - The camera's current is not published.

| Version | Maker, PN, price | Specs | Control | Status |
|---|---|---|---|---|
| **4-camera switcher into the RC mirror's second input (pick)** | PAC **VS41**, $155.94 (list $309.00) at Sonic Electronix (`www.sonicelectronix.com__item-123401-PAC-VS41.md`) | Four CVBS inputs, one output. Input 1 shows when nothing is triggered. Priority by input number. "Positive Input triggers accept input voltages in the range of 2v to 12v"; pulsed or constant triggers (turn signals). "The reverse trigger output will provide a 150 mA 12v (+) trigger". Last view held 3 s (manual, `catalog.archive.pac-audio.com__index.php__controller=attachment&id_attachment=894.md`) | Power from the OUT23 group. Inputs:<br>1 = top-design's roof camera, the default view<br>2 = the FC front camera, on a dash toggle<br>3/4 = the mirror cameras on OUT27/OUT28<br>Output to mirror CH2. CH1 stays the plate camera on reverse, unchanged | Validated, with open items: the 2-12 V trigger range against ~14 V (ask PAC), the VS41's own current, and which RVS harness wire selects CH2 |
| **Full-display streaming mirror** | Brandmotion **FullVUE FVMR-1100**, out of stock, no MSRP shown | 9.66 in, 320 × 1280; 12/24 V; **5 W**; HD-TVI rear camera powered at 5 V from the mirror (IP67, 1080p) on a 30 ft harness; "Video trigger input triggers: No"; a second camera supported; built-in front camera with DVR | It replaces the RC mirror and camera: MIRROR_TRIG and #97 fall away. It cannot take the CVBS cameras or the VS41 | Partly validated. Out of stock, and it changes the decided RC kit, which is the owner's call |
| **360° bird's-eye system on its own dash screen** | Rear View Safety **inView 360 HD** RVS-02-360: $2,161.76 with the 7 in monitor, $2,268.65 with 10.1 in; calibration mat $234.22 | Four 1080p fisheye cameras (up to six); ECU 5.8 × 6.8 × 1.5 in; 8-32 V; **max 25 W**; triggers left/right/reverse/panic at 6-32 V, 0.12-0.63 mA; auto-calibration (`www.rearviewsafety.com__inview-360-hd-around-vehicle-monitoring-systems-rvs-01-360.md`) | Power from the OUT23 group (+2.1 A). Triggers taken directly from OUT27/OUT28/OUT15, which are within 6-32 V. The side cameras go under the mirrors through the doors | Validated specs. It is a second screen, "other screens as like other angles of the vehicle" |
| No-screen premium mirror | Gentex GNTX-R auto-dimming, $500 at Ringbrothers: "Does not work with a camera or as a video display"; 3-wire (`www.ringbrothers.com__gentex-gntx-r-auto-dimming-rearview-mirror-black.md`) | — | — | Listed only |

The DISP candidate (in-cab display, wireless preferred) remains the place for "other screens". The FC front camera is an
existing candidate. MIRD gives it an input.

## 7. Headliner routing to the mirror (option HDL)

**What the 1977 manual says:**
- The inside mirror hangs on a glass-mounted bracket held by one screw, torqued to 45 in-lb (1977 LTSM p.132, "Inside Rear
  View Mirror - Figure 2D-11"; torque on p.187, C and K models).
- The Blazer's removable top bolts to "top-to-header panel attaching brackets" and must clamp "against the steel cab" (p.155).
  So the header over the windshield is steel cab, and the mirror loom runs under its trim.

**Route:**
1. Mirror bracket up to the header.
2. Along the header to the driver A-pillar.
3. Down the pillar to the dash beside the PDM30.

The builder confirms the path on the truck; agents don't decide physical routes (wiring-receipt rule).

**Length estimate:**
- 0.84 m along the header (half of FR-88's 1686 mm windshield width) + 0.60 m down the pillar (FR-88 windshield corner
  dimension) + 0.5 m to the PDM30 zone (its spot is open) = about 1.94 m.
- Add the 15 % body pad (state §1 row 33): about 7.3 ft, rounded up to **8 ft**. An estimate.
- FR-88 is the 1988 Blazer body, the same 1973-91 shell (`output/K5_dimensions_atoms.yaml`).

**What rides it:**
- The RC wires already do: MIRROR_PWR, MIRROR_GND and MIRROR_TRIG. So does CAM_VIDEO ("plate -> body -> cab -> headliner ->
  mirror").
- The Mobileye main-unit cable (FWC).
- top-design's roof-camera lead.

**HDL itself** pulls one spare coax and two 20 AWG conductors now, so a later MIRD or FWC doesn't reopen the headliner.

OPEN: whether this cab has a headliner or a bare header (read on the truck).

## 8. Billet reproduction mirrors (option BMIR)

### 8.1 What the original is

The 1977 manual lists, for C and K models (p.132, p.187):
- a "base mirror" on the door panel at 25 in-lb
- a "West Coast" mirror, lower bracket 20 in-lb and upper bracket 45 in-lb
- a camper mirror, installed like the below-eyeline mirror

The common repro of the base mirror:
- LMC 38-5832 LH / 38-5833 RH chrome, $39.95 each: "exact reproductions of the originals", flat glass. Convex RH is
  38-5825, $39.95. Gasket 38-5811, $2.95; screw and nut "Mirror Mount A" 30-0427, three per mirror; inner brackets
  38-5882/38-5883, $9.25 (`www.lmctruck.com__cc-1973-87-gm-style-reproduction-door-mirror.md`).
- AMD X570-4073-1C "Small Style" chrome, $59.99: head about **5-9/16 × 4-1/2 in**, base about **4-11/16 × 1-1/8 in**,
  includes the bracket, gasket and screws (`www.autometaldirect.com__door-mirror---chrome---small-style---…-truck.md`).

Squarebody owners (`www.gmsquarebody.com__door-mirror-mount.19400.md`, forum):
- The mount is three bolts and the base is contoured to the door skin.
- The screw-and-nut is a riv-nut/molly-type fastener.
- "re-install the mirror braces inside the door. It will prevent the sheetmetal from tearing over time. Part number 38-5883"

**Federal floor:** 49 CFR 571.111 S6.1(b) calls for outside mirrors of unit magnification, "each with not less than 126 cm2 of
reflective surface", on both sides, for trucks of 4,536 kg GVWR or less (`www.ecfr.gov__section-571.111.md`).
- The small head's outline is 5-9/16 × 4-1/2 in = 161 cm² gross, before the bezel and corners.
- A billet design keeps the glass itself at or above 126 cm².

### 8.2 What exists already

| Product | Price (2026-09-29) | Facts | Source |
|---|---|---|---|
| Intek Otto squarebody billet mirrors, sold by Pro Touring Store | **$2,499 raw / $2,799 mirror-polished** (Shopify JSON: 249900 / 279900) | "Direct bolt-on fitment for 1973-1987 Squarebody C/K series Trucks and Blazers"; CNC billet, glass pivots in the housing; "may require drilling/enlarging new holes on some applications"; "Made in USA by Intek Otto". Intek Otto describes its Classic Truck Mirrors as a bolt-on for 73-87 trucks "running small 'sport style' mirrors" that "fit into the factory, OEM gasket" | `protouringstore.com__billet-mirrors-for-1973-1987-squarebody-chevy-trucks.js.md`; `www.intekotto.com__exterior-mirrors.md` |
| Intek Otto Classic Rectangle (universal) | $1,099.00 | adjustable housing and base, convex passenger glass | `azproperformance.com__interk-otto-classic-rectangle-mirrors-csrms.md` |
| Ringbrothers Universal Truck Rectangular Mirror Set | **$1,200 a pair** (+$100 black, +$350 chrome) | 6061 billet; cup 7-7/8 × 5-1/4 in; base 6-1/4 × 1-1/2 in | `www.ringbrothers.com__universal-truck-rectangular-mirror.md` |
| Ringbrothers rectangular billet set | $650 natural / $680 black a pair | cup 5.52 × 3.61 in (128.6 cm² gross: glass under the 126 cm² floor once bezel is taken off) | `www.ringbrothers.com__mirrors.md`; Summit RGB-92000-2200-B (`www.summitracing.com__rgb-92000-2200-b.md`) |
| Eddie Motorsports Kinetic Square | $275.95 each | billet, made in USA, 6.25 × 5.56 × 5.5 in, base 13/16 in, fits either side | `eddiemotorsports.com__kinetic-square-mirror.md` |
| Billet Rides "Universal GM Truck Mirror 73-87 (pair)" | unknown | billetrides.com now serves unrelated content (snapshot 2026-09-29), so the maker's status is unknown | `www.billetrides.com__universal-truck-gm-73-87.md` |

**None of these carries a camera, a turn lamp or a puddle lamp.**

### 8.3 Who could make ours

- **Intek Otto / BBT Fabrications (Mahomet, IL).** "All phases of design and production of our parts are handled in house",
  and the parts started as one-offs for their own builds (`www.bbtfabrications.com__cnc-machining-and-custom-hot-rod-parts.md`).
  They already make a squarebody mirror that fits the OEM gasket, so this is the shortest path to an original-style reproduction
  with pockets. Contact through the form on intekotto.com.
- **Ringbrothers.** A billet mirror maker with a truck-size cup.
- **Online CNC job shops**, from our CAD. They need a finished model, which we don't have yet.

### 8.4 What a producer needs from us (the package)

1. **The original, measured or scanned:**
   - the mirror head, arm and base of the mirror on the truck
   - the door skin where the base sits (the base is contoured)
   - the three-hole pattern and hole sizes
   - the inner brace

   OPEN: which mirror is on the truck today (the base mirror, a below-eyeline or a West Coast mirror). A photo answers it.
   Chrome needs a removable coating before a structured-light scan (3Space: structured light "struggles with both black and
   reflective surfaces", `3space.com__how-much-does-3d-scanning-cost.md`).
2. **The modules to pocket, with their published sizes:**
   - camera: PCAM-BS1 26 × 50 × 23 mm, or PHD5N1 (size not published)
   - turn lamp: Grote 49343, 1 in body in a 3/4 in hole, under 3/8 in proud
   - puddle lamp: GM 84408372 (size not published) or an 18 mm LED
   - the signal-on-glass arrow, if chosen

   Also: the lens window and seal (IP67 camera) and the turn lamp's view to the rear.
3. **The wire exit:**
   - a hollow arm or base to a sealed exit through the door skin
   - a DT 6-way inside the door carrying camera +, turn, puddle and the shared ground
   - the camera coax runs separately
4. **The glass:**
   - flat, unit magnification, at least 126 cm² per side
   - a convex RH is allowed, with the "Objects in Mirror Are Closer Than They Appear" marking, 571.111 S5.4.2
   - heated or not
   - custom partially transmissive glass if MTS-SOG
5. **Material and finish:** 6061-T6 like the makers above; raw, polished, anodized or chrome (the owner's call).
6. **Quantity:** one pair, plus whether a spare glass or a spare pair is wanted.

### 8.5 Budget, and what is still unknown

Published anchors:
- a factory-style repro pair: $79.90 (2 × $39.95)
- a production billet squarebody pair: $2,499-$2,799
- a billet truck pair: $1,200
- modules:
  - cameras: 2 × $119 or 2 × $159
  - puddle modules: $150.94 for the GM pair (the kit is driver + passenger)

Custom work: US 5-axis machining runs $100-200 an hour and 3-axis $35-60, plus setup and programming ("CNC Machining Hourly
Rates 2026", `fabcon.com__cnc-machining-hourly-rate-us.md`). Scanning runs $100-200 an hour, about $100 to over $1,000 a part
(3Space).

**The design hours and machining hours for this mirror are unknown until a producer quotes.** So the budget for the
integrated pair is not stated here. The toggle turns on when the quotes land.

**Drafts, for Skylar to send. None was sent.**

> **To Intek Otto (intekotto.com contact form):** Hi — I'm building a 1977 Chevy K5 Blazer and want a pair of billet mirrors
> that reproduce the original small base mirror (three-screw door mount, contoured base, factory gasket), with three pockets
> built in: a small side camera (about 26 × 50 × 23 mm), a 3/4 in amber turn repeater, and a puddle lamp in the underside, with a
> sealed wire exit through the base. Your squarebody mirror is the closest thing I've found. Could you quote one pair (raw and
> polished), tell me what you'd need from me (a 3D scan, the original mirror, or drawings), and the lead time? — [name, contact]

> **To Ringbrothers (ringbrothers.com contact):** Hi — would you build a custom version of your Universal Truck Rectangular
> Mirror Set for a 1977 K5 Blazer, with a camera pocket and a sealed wire exit, turn repeater and puddle lamp optional? What do
> you need to quote it, and what does a one-off pair cost? — [name, contact]

> **To a scanning service (for example 3Space):** Quote to scan one chrome truck door mirror (head, arm, base) and the door skin
> around its three-screw mount, and deliver STEP files for a billet reproduction. The chrome can be coated. — [name, contact]

> **To EchoMaster:** Your PCAM-BS1 manual lists "Power Supply 9V-12V DC". What is the camera's rated range on a running 12 V
> vehicle (about 14.4 V)? — [name]

> **To PAC (AAMP):** The VS41 manual says positive triggers accept 2-12 V. Are they rated for a running vehicle's 14.4 V turn and
> reverse signals? — [name]

> **To Rear View Safety:** For the RVS-7180355-IR kit: which power-harness wire selects channel 2, what current does the plate
> camera draw, and is the mirror rated 9-32 V (kit page) or 9-18 V (RVS-718 page)? — [name]

## 9. The door hinge: what crosses it (options DGND, and every door add-on's `door_cavities`)

- **Low-current door wires** cross in the DT 8-way (`DOOR-L-PASS` / `DOOR-R-PASS`), whose cavities 7-8 are spare. The DTP
  4-way beside it carries the window power and is full with PW.
- **Each door add-on needs one feed cavity:** MCAM camera +, MTS turn, PUD puddle.
- **Their returns share one door accessory ground** (DGND), so the whole set takes **4 cavities per door**.
- **Grounds stay in the loom**, never to the door skin (state §1 row 56).
- **Fill:** base + decided use 2 of 8. With PL's 4 lock wires the spare is 2, so the set fits only without PL, or with a
  DT 12-way (DT04-12PA / DT06-12SA, 4 more cavities). `options_v5.py` now prints this line in the verdict.
- **The camera coax** crosses in the door conduit beside the DT, unbroken (§1).

## 10. Washer correction (owner, recorded; PR #410 made the WASHER-PUMP end the factory pump)

The owner says the factory wiper motor carries the washer pump, and the manual agrees: "Figure 8-16 shows the assembly of the
washer pump to the wiper motor" (1977 LTSM p.803, Fig. 8-16 "Washer Mechanism Mounting on Wiper"). The C-K motor is "mounted
to the left side of the dash panel inside the engine compartment" (p.131).

**The electrical parts:**
- The 1978 C-K booklet (ST-352-78) fold-out A-1 is the closest year on file. It was read from the page image
  `reference_documents/wiring_diagram_booklets/pages/1978_CK_A1_cab_engine_chassis_main.png` on 2026-09-29.
- It draws the wiper motor block with "PARK SW", "WASH SOL" and the armature, and three connectors:
  - **12004622**, the washer-solenoid 2-way: 18 DK BLU-94 and 18 YEL/BLK-93B.
  - **8917544**, the motor 3-way: 18 LT BLU/BLK-92 (hi), 18 WHT/BLK-91A (lo), 18 YEL/BLK-93A (feed).
  - **8917548**, a 2-way on the park switch: 18 BLK/LT BLU-97 and 18 WHT/BLK-91B. Its use (a pulse-wiper circuit?) is not
    stated.
- The circuit table names 91 low, 92 hi, 93 motor feed, and 94 "Windshield Washer Sw. to Washer" (booklet p.9).
- The 1977 manual's washer diagnosis matches a solenoid fed on one side and grounded by the switch on the other: "Open circuit
  in feed wire to pump solenoid coil"; "Grounded wire from pump solenoid to switch" makes it pump continuously (p.814).
- New-old-stock "GM 2 Way Windshield Wiper Washer Pump Wiring Harness Connector Housing Plug" listings exist ($18.99,
  `www.ebay.com__192684099994.md`). The listing text doesn't print the number, so the booklet stays the source for 12004622.
- OPEN: the 1977 booklet (ST-352-77) is not on file. Confirm 12004622 on the truck's motor.

**The soft tube and pump (LMC 1973-84 wiper and washer page, `www.lmctruck.com__cc-1973-84-windshield-wiper-and-washer.md`):**
- Hoses:
  - Hose, Jar to Pump, 9 ft: **36-4070**, $4.95
  - Hose, Pump to Nozzle, 12 ft: **36-4071**, $4.95
  - Retainer, Washer Hose: 30-1365 (×2)
  - Washer Nozzle, 73-80: 30-1423 (×2)
- Pump and jar:
  - Washer Pump, Chevy GMC **73-77**: **36-4078**, $109.95
  - Washer Pump Repair Kit: 36-4082
  - Washer Jar, 76-84: 36-4092
- Or Classic Parts' "(1973-84) Windshield Washer Hose Kit" **67-865**, $11.95: "Enough of the correct size hose to do complete
  truck from washer jar to squirt nozzles" (`www.classicparts.com__67-865.md`).
- These are repro numbers. **No GM part number for the hose was found.**

**Harness consequence, left to the wiring lane:**
- The generated registry still names the Hella pump (`reconcile_v5.py` writes it into wire 50 and the OUT26 note). Wires 50
  (PDM30 OUT26) and WASH_GND still work as feed and return for the solenoid.
- If the dash switch grounds circuit 94 as the factory did, with 93B spliced to the wiper feed on the engine side, then
  PDM30 **OUT26 and DIG9 come free**. The firewall crossing count is unchanged: 94 crosses where 50 did.
- OPEN: whether the 1977 wash position also starts the wipers. The pump is driven by the wiper gear (p.815: "Disconnect
  electrical harness at wiper motor and hoses at washer pump").

**Substrate correction (receipt `receipts/2026-09-29_substrate-correction-factory-washer-pump.md`):** the pin tables said "The
1978 booklet's motor 12004622 is the 1978 rectangular motor" (WIPER-MOTOR) and put the switch plug on that "rectangular motor"
(WIPER-SW). On the A-1 image, 12004622 labels the washer-solenoid 2-way beside the motor, not the motor. The catalog text
(WASHER-PUMP endpoint and pin table, WIPER-MOTOR, WIPER-SW) is corrected; wire ids and topology are left to the wiring lane.

## 11. Only Skylar can answer

1. **Mirror:**
   - Reproduce the stock small base mirror as it is (about 5-9/16 × 4-1/2 in head), or go bigger?
   - Which finish?
   - Is the mirror on the truck the base mirror? A photo answers this.
2. **Cameras:** stick-on under the current mirrors now (MCAM), or wait for the billet mirrors (MCAM-BIL)?
3. **Blind spot:** the $699 plate bar (BSM), or commercial side radar with its own display (BSM-SD2)?
4. **Windshield:** Mobileye needs an authorized installer and online calibration. Acceptable, or recording only?
5. **Mirror screen:**
   - keep the RVS mirror + VS41 switcher (MIRD)
   - go to a streaming full-display mirror (MIRD-FV, which replaces the decided RC kit)
   - or a 360 system with its own dash screen (MIRD-360)
6. **Bumper:** cut the bumper face for lamps (BML)? Is a DRL wanted?
7. **Locks (PL):** in or out? That decides whether the door set fits the DT 8-way.
8. **Washer switching:** the factory dash switch (frees OUT26 and DIG9), or keep it on the PDM?
9. **Billet:** a budget ceiling, and whether to send the drafts in §8.5.
10. **Plate:** on the bumper or the tailgate (the camera and radar-bar route)? A photo may answer this too.

## 12. Not found, refused, or not checked

- **manuals.plus refused (403)**, so the VS41 manual came from PAC's archive instead.
- **Rostra product pages redirect to category pages** with no specifications.
- **The Rear View Safety 7.3 in multi-display mirror page** (RVS-718-7) now redirects to a clearance list.
- **Prices not published:**
  - Sensata Side Defender II
  - Mobileye 8 Connect
  - Brandmotion FullVUE (out of stock)
  - Grote 49343 on grote.com
- **Current not published:**
  - EchoMaster PHD5N1
  - PAC VS41
  - the RVS plate camera
  - the GM 84408372 puddle module
- **Not verified on this truck:** the door conduit's bore, the header trim, and the mirror type.
