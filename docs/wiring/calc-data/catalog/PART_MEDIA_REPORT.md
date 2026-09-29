# Part media — what the site and the build book can show for each piece (2026-09-29)

`part_media.yaml` has one entry for every `parts.yaml` code (159) and every registry endpoint (178): 337 entries. Each
entry gives a photo, a drawing and a 3D model where one exists. Every photo carries a confidence:

- **exact_pn**: the image is of that part number. The file name, label or the maker's page for the part says so.
- **same_family_photo**: the image is a sibling, a candidate replacement, or an unlabelled family image. The note says which.
- **unknown**: no photo can be defended, usually because the registry names no part number.

URLs only. No image, PDF or CAD file is committed.
`nuke_frontend/public/wiring/k5-part-photos.json` is regenerated from the YAML. It keeps only exact_pn photos whose URL
answered a plain request, or was read off the vendor's page, on 2026-09-29.

## Counts

| Group | exact_pn | same_family_photo | unknown | drawings | 3D (STEP) |
|---|---|---|---|---|---|
| (a) Boxes: MoTeC, batteries, isolator, fuses and holders, DC-DC, Dakota, iBooster, E-Stopp, PCS | 38 | 1 | 2 | 30 | 1 |
| (b) Engine sensors and actuators | 38 | 2 | 7 | 3 | 0 |
| (c) Connectors, terminals, seals, wedges, splices, lugs, shrink, pass-throughs | 165 | 10 | 13 | 56 | 48 |
| (d) Cab and body devices | 29 | 14 | 18 | 5 | 0 |
| **All 337** | **270** | **27** | **40** | **94** | **49** |

Parts: 141 exact, 8 family, 10 unknown. Endpoints: 129 exact, 19 family, 30 unknown.

## Sensors picked for this engine (2026-09-29)

The registry named the IAT and the MAP only by their plugs. Both are now picked from the parts bought for the engine:
a Chevrolet Performance 19435106 LS3 long block (naturally aspirated), a Holley intake, and the GM 12699160 throttle body
on a Delmo adapter.

- **MAP: Holley 538-24, 1 bar.** Holley's instructions for both of its LS intake families say "Holley 1bar MAP sensor
  P/N 538-24 is recommended" (199R10689 for the 300-129/130 dual-planes, 199R10690 for the 300-131/132/136/137
  single-planes). It is the GM/Delphi rectangular body with a hose nipple. It bolts up by its two ears, and a hose runs
  to the intake's MAP port. Its plug is the GM/Delphi 1-bar MAP connector (ProWire 1B-MAP-CONN-KIT), not the LS
  crank/MAP Metri-Pack kit. See correction 4.
- **IAT: GM 12160244 (ACDelco 213-243).** It is the LS1 F-body air-box sensor. Its plug, Delphi 15449027, is the housing
  in the registry's ProWire GT150-AIR-TEMP-KIT, so the plug and the GT150 crimper already listed stay. It pushes into a
  GM 24504388 grommet in the air inlet ahead of the throttle body. See correction 3.

## Where the drawings and 3D models come from

| Maker | Free 3D without an account | Drawings |
|---|---|---|
| TE Connectivity: DEUTSCH DT/DTP/DTM, Superseal 1.0, PIDG | Yes: STEP (also IGES, DXF, 3D PDF) for every DEUTSCH housing, wedge, gasket, contact and cavity plug here, both Superseal housings, the Superseal plug and the PIDG splices. The links open in a browser; scripted requests get 403. | Customer drawings on the same pages, often a family drawing (`DT06-08SX-XXXX` style) |
| Victron | Yes: one STEP for the Orion-Tr Smart 360-400 W non-isolated housings, on the product page | Dimension PDF, datasheet |
| Littelfuse | Yes for the MIDI 498 fuse family (signed download links on the page; not linked here). Holders have only 2D prints. | Datasheets and 2D prints |
| MoTeC | No 3D on motec.com.au | Dimension drawings (SVG) and datasheets for the M130, PDM30, PDM15 and LTCD |
| Blue Sea | No 3D | Dimensioned drawings (JPG or PDF) for most parts; pin-out drawing for the 2145 |
| Neutrik (NC5FD-L-1) | 2D DXF only | PDF drawing |
| Amphenol (D38999) | Not checked this pass (the shells already had photos) | M85049/69 boot-adapter PDF |
| Aptiv / Delphi | No 3D found without an account | None linked. Corsa Technic mirrors the customer drawings (`corsa-technic.com/item_dwg/`). |
| Dakota Digital, Holley, AEM, Hella, Rear View Safety, JBL | No 3D | Manuals and datasheets. dakotadigital.com did not answer scripted requests; one Holley and one AEM document sit under hashed file names. |

Hosts that refuse scripted requests but open in a browser: te.com (images, drawings, models) and odysseybattery.com.
The site JSON leaves those out. Photo URLs containing 32 or more hex characters in a row are also left out, because the
pre-commit secret scanner reads them as tokens. Where possible they were replaced with a hash-free copy of the same
image: Lumitec, Diode Dynamics, Moroso, Van's and OER originals, and Summit for AEM.

## What the photos on file got wrong (now fixed or flagged)

- `0498040.M` showed the 80 A MIDI (DigiKey `0498080.M`). Now it shows Littelfuse's 40 A image.
- `30107090` showed SPAL 30107101 (kartek). No photo of the 30107090 itself was found: see the list below.
- `30-2131-100` showed AEM's 30-2130-100 stainless kit. Now it shows Summit's `avm-30-2131-100` image.
- `68054` and `68055`: the old `motec.com.au/hessian` URLs return 404. MoTeC's asset server has them.
- The DEUTSCH contacts are vendor photos. ProWire lists them "by Tristar", and Custom Connector Kits' image label says
  "Aftermarket Equivalent". They are marked same_family_photo, not exact.
- `S02-03-R`: ProWire's page shows an S02-07-R. It is marked same_family_photo.
- The fuel-pressure note: see registry corrections below.

## Registry corrections (for the owner of the registry; not edited here)

1. **12110847 is a Metri-Pack 280 terminal, not Metri-Pack 150.** Delphi's own Metri-Pack catalog
   (`Delphi_150_Metri-Pack_Series.pdf`, "280 TANGLESS FEMALE TERMINALS SEALED") lists 12110847 at 1.0-0.80 mm².
   Custom Connector Kits sells it as a "Metri-Pack 280 ... Tangless Sealed Female Terminal". parts.yaml files it as the
   MP150 terminal for the crank, cam, MAP and knock plugs. ProWire's LS crank/MAP kit uses 12048074 (MP150 female, 20-16)
   in the 12129946 housing.
2. **AEM 30-2131-100 is the brass sensor kit.** AEM's page titles it "100 PSIg Brass Sensor Kit"; 30-2130-100 is the
   "100 PSIg Stainless Sensor Kit". The registry's FUELP text says "316L wetted", which is the 30-2130-100.
3. **IAT: name the sensor GM 12160244 (ACDelco 213-243). The plug stays.** The registry's plug, ProWire
   GT150-AIR-TEMP-KIT, holds Delphi 15449027 (with TPA 15305024, seals 15366022 and terminals 15326266, per ProWire's
   p-1754 page). PT Motorsport sells 15449027 as the "LS1 IAT Sensor Connector". A thirdgen.org LS-swap list gives
   15449027, 13520104 and 15335987 as the no-, half- and full-shroud IAT plugs for 12160244. Amazon lists the sensor as
   "GM Genuine Parts 213-243 (12160244)".
   - Chapter 08 names GM 25036751 (ACDelco 213-190). That is a brass 3/8 NPT sensor with a Metri-Pack plug, and the kit
     does not fit it. Chapter 08 should name 12160244.
   - Add the grommet, GM 24504388. EFI Connection: "used with the LS1 Camaro/Firebird air boxes. An excellent solution
     for engine swaps when a custom air intake is used."
4. **MAP: name the sensor Holley 538-24, and change its plug.** Chapter 08's GM 55573248 takes a Bosch-style plug
   (ProWire 68104), and 12592525 is a 3-bar LSA/LS9 sensor. The registry's LS-CRANK-CONN-KIT fits the LS Gen III/IV MAP
   body, not the GM/Delphi rectangular body that Holley recommends for its intakes.
   - Plug: ProWire 1B-MAP-CONN-KIT, "keyed and colored for use with 1 bar GM/Delphi map sensors": Delphi 12020403
     body, 3 x 12089307 Weather Pack pins (20-22 ga), 3 x 15324985 seals. It replaces the MAP's LS-CRANK-CONN-KIT and
     the cart's 68104. The MAP `per_end` (12110847 / 15324976) goes with it.
   - Crimper: the pins are Weather Pack. tools.yaml lists only the Metri-Pack 150/280 tool (12155975). ProWire lists
     Weather Pack crimpers, for example p-1987, "terminal crimper Metri-Pack / Weather Pack".
   - Pins: MoTeC's Delco MAP drawing (X18, WD 53000-53003) gives A 0 V, B signal, C +5 V. That matches Dave's order
     (1 0 V, 2 signal, 3 5 V) and closes the registry's "OPEN until a GM end view is cited".
   - Hose: a barb for the intake's MAP port and a short vacuum hose. The 300-129 has a 1/8 NPT MAP port. The 300-131/136
     sheet lists only a 3/8 NPT vacuum port. See correction 8.
5. **Missing wedgelocks.** The DT 2-way (FUEL-LEVEL) needs W2P/W2S and the DTP 2-way (FUEL-PUMP) needs WP-2P/WP-2S. Neither
   pair is in parts.yaml.
6. **Seal sizes on 22 AWG.** Delphi's catalog gives 15324976 (loose 12089678) 1.60-2.15 mm and 15324974 (12048087)
   1.29-1.70 mm. 22 AWG M22759/32 is 1.09 mm OD, under both.
7. 4-1437284-3 is a TE part (TE's page), though ProWire's page credits Aptiv.
8. **Which Holley intake is on the engine is still open.** The sources disagree:
   - The Holley receipt lists 300-129. Holley's 199R10689 calls that the "LS3 Dual-Plane Intake Manifold, Carbureted",
     with a 4150 flange and a 1/8 NPT MAP port. Holley does make LS dual-planes (300-129 and 300-130).
   - The state doc says 300-131, from the install doc.
   - The photos show a single-plane with injector bosses. In Holley's LS3 line that is the 300-136 port-EFI
     single-plane, which takes rail kit 534-218 (199R10690).
   - The receipt's 534-209 rails are Holley's rails for LS factory intakes (JEGS: "Fits LS1, LS2, LS3, LS6 & L99 Factory
     Intakes").

   The MAP pick holds for all three. Only the hose fitting depends on which intake it is.

## Pieces with no exact photo

No photo can be defended because no part number is recorded: the factory brake-light, floor-dimmer, turn, horn,
wiper and blower switches; both door-jamb switches; the horn; the wiper motor; the blower resistor; the tailgate motor
and tailgate cutout switch; the license and underhood lamps; the starter; the brake-fluid level sensor; the AMP
Research controller; both lock rockers; the three ground banks; the coil ground rings; the CAN terminators; and the
open or retired lugs.

A part number is recorded but no exact photo was found:
- SPAL 30107090 fan
- Holley 197-302 alternator (the maker image sits under a 40-hex file name)
- Dakota VHX control box (the photo shows the gauge cluster)
- Hella 8TW 004 223-031 washer pump
- GM 8900713 tailgate key switch
- Nu-Relics #121 single switch
- The factory lamp sockets (candidate replacements are shown)
- RetroSound radio face (the variant is not recorded)
- The oil temperature sensor (the ECT is shown). The sensor follows the oil cooler's port, and the build log's
  oil-cooler line does not name the part.
- The DEUTSCH contacts (vendor equivalents are shown)

## How it was made

Makers were tried first. When a maker's own photo could not be reached, the photo is a distributor's photo of the same
part number. Other sources used:
- the gitignored web snapshots already on file
- the `catalog_parts` ProWire rows in the database
- ProWire's sitemap
- Shopify product JSON (Custom Connector Kits, Retro Manufacturing, E-Stopp)
- Firecrawl, for te.com, bluesea.com, Littelfuse, ProWire and eBay

Requests went out one at a time: 10 s apart per host, 22 s for ProWire. A host was dropped at its first 403.
The photos on file (`reference_documents/product_images/sources.json`) were carried over, not re-researched, except
where a maker photo was already in hand or the on-file photo was the wrong part.
