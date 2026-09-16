# K5 Blazer — Dimensional Substrate (digital twin source data)

**Purpose:** Single index of every reference document with hard dimensions for the K5 build. Feeds the Blender model. The Blender model is the digital twin. Everything downstream (harness routing, fitment, renders, customer marketing) projects out of the twin.

**Vehicle:** 1977 Chevrolet K5 Blazer · VIN CCL187Z210370
**Status of twin:** `/Users/skylar/k5-harness-pull/1978_Chevrolet_Blazer.blend` exists; frame mesh accuracy not yet verified against factory dims.

---

## 1. Reference document catalog

### 1.1 Frame & chassis (authoritative)

| ID | File | What it gives |
|---|---|---|
| FR-88 | `reference_documents/k5_factory_docs/1988_Blazer_4WD_Frame_Dimensions.pdf` | **Authoritative.** 2-page Mitchell sheet. 2705 mm (106.5") wheelbase. Bottom view + side view + cross-section. Measuring point designations A–N. Tightening torque table. Square-body 73-91 frame is shared, so 77 K5 = same dims within ±2 mm (verify rivet pattern). |
| KLM-Blz | `reference_documents/k5_factory_docs/KLM_1984_Blazer_4WD_CHT-1.jpg` | KLM 1983 chart, K5 4WD 106.5" WB. Underhood view (60" × 67¾" engine bay box, 43⅜" wide at front), bottom view with diagonals (58⅛", 55⅜", 52¾", 40⁵⁄₁₆"), side view heights from datum (14⁷⁄₁₆", 21", 16⅞", 12⅝", 14", 24⅝", 22½", 21¾"). |
| KLM-K10 | `reference_documents/k5_factory_docs/KLM_1984_K10_Shortbed_4WD_CHT-8.jpg` | K10 shortbed 117.5" WB — useful as comparison; K5 is the SWB version. |
| KLM-C10/C20 | `_C10_Longbed_2WD_CHT-3.jpg`, `_C10_Shortbed_2WD_CHT-2.jpg`, `_C20_Longbed_2WD_CHT-4.jpg` | 2WD comparisons; not directly applicable but useful for body-on-frame deltas. |

### 1.2 Body / cab / engine bay (authoritative)

| ID | File | What it gives |
|---|---|---|
| FR-88 p2 | (same PDF as above, page 2) | **Authoritative engine compartment box:** width 1715 mm (top), centerline-to-shock-tower 1102 mm, length firewall→front 1523 mm, diagonal 1957 mm. Plus A-pillar, B-pillar, windshield, door opening, tailgate, cowl & dash diagrams. Wheel alignment specs (caster +8°±.5, camber 1.5°±.5). |
| LMC-Body | `reference_documents/k5_factory_docs/lmc_diagrams/0004336_front-steel-body-parts.png` + `0004337_front-steel-patch-panels.png` + `CC_Front_Patch_Panels_73_87.png` | Parts catalog drawings — show panel topology and part numbers. Not dimensioned but useful for surface modeling. |
| LMC-Cab | `0002453_CC_Door_Inside_Parts_73-87.png`, `0002458_CC_Window_Power_77-87.png` | Door internal parts, window mechanism. |
| LMC-Body | `0003942_CSB_Wheel_Housing_73-87.png`, `0004333_CSB_Interior_Patch_Panels_73-91.png`, `0004356_CSB_Splash_Shields_81-91.png` | Inner fender / wheel housing / splash shield panel topology. |
| LMC-Tail | `0004334_CSB_Tailgate_Supports_73-91.png`, `0004335_CSB_Bed_Floor_Tail_Pans.png`, `0004360_CSB_Tailgate_comp_blzr_73-91.png` | Tailgate + bed floor parts. |
| LMC-Susp | `0004879_rear-suspension.png` | Rear suspension parts diagram. |
| SVC-77 | `reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf` | OEM 77 service manual. May contain additional dim drawings — needs page-by-page audit. |
| SVC-87 | `reference_documents/k5_factory_docs/1987_Light_Duty_Truck_Service_Manual.pdf` | 87 truck manual — overlaps 77 build, has electrical & brake sections. |
| GM-RPO | `reference_documents/k5_factory_docs/GM_RPO_Master_List.pdf` | RPO option codes — useful for matching this VIN's factory build to baseline. |

### 1.3 Drivetrain envelope

| ID | File | What it gives |
|---|---|---|
| LS3-Marine | `reference_documents/component_drawings/Marine_LS3_6.2L_Specs.pdf` | **Has the envelope drawings.** Long-block dims: front view ~716 mm (28.19") tall × 705 mm (27.75") wide; side view 710 mm (27.95") long. Bore center 111.76 mm. Gen IV V8 dry mass TBD on sheet (real ≈ 415 lb dry). |
| LS3-LB-Spec | `LS3_LS376_Long_Block_Specs_older.pdf` (15 pp) | Performance spec only — bore/stroke/cam/oil. **NO envelope dims.** |
| LS3-LB-Inst-23 | `LS3_LS376_Long_Block_Installation_Guide_2023.pdf` (15 pp) | Install guide — TBD whether it has envelope dims (not yet read). |
| LS3-LB-Inst | `LS3_Long_Block_Installation_Guide.pdf` (15 pp) | Older install guide. TBD. |
| LS3-EROD | `LS3_EROD_Engine_Controller_Kit.pdf`, `LS3_EROD_Installation_Guide.pdf` | EROD package — relevant if running EROD harness/ECU; we're not (Motec M130). |
| LS3-EFI | `LS3_EFI_Crate_Engine_19419862.pdf` | Crate engine spec card. TBD on dims. |
| Canems-LS3 | `Canems_LS3_LS7_harness_diagram.pdf` | Canems harness reference — not for our ECU but pin-map cross-ref. |
| AEM-TA2 | `AEM_TA2_LS3_harness_component_diagram.pdf` | AEM harness layout — same role as Canems. |
| 6L80-Kit | `GM_Supermatic_6L80_Installation_Kit.pdf` (12 pp) | **Just the install kit contents + bolt torques.** No envelope dims. |
| 6L80-Moveras | `Moveras_31AS_6L80_Installation_Manual_Rev1.6.pdf` | Aftermarket install manual — likely has envelope dims (not yet read). |
| 6L80-Holley | `Holley_6L80_6L90_Transmission_Control_558-499.pdf` | Holley control kit — electrical, not dims. |
| 6L80-Sonnax | `Sonnax_6L80_Valve_Body_ZIP_Kit.pdf`, `Sonnax_6L80_Vacuum_Test_Guide.pdf`, `ATSG_6L80_Solenoid_Chart.pdf`, `ATRA_6L50_6L80_6L90_Updates_Webinar.pdf` | Internals reference. Not for envelope. |

### 1.4 What's NOT yet sourced

- **Bosch iBooster footprint** (depth into engine bay, mounting bolt pattern, master cyl reservoir clearance) — Bosch publishes a datasheet; need to pull
- **Specific radiator** — depends on which rad Skylar ran. Need part number first.
- **Accessory drive envelope** (LS3 with A/C — alternator/compressor/PS pump bracket package) — GM PN 19418440/19370820/19418442 install guides
- **Headers** — outlet position determines clearance to firewall / floor. Specific header brand/PN unknown.
- **Motor mounts** — frame-side bracket position determines where the engine actually sits. Unknown brand (Hooker? Pirate? Holley?).

---

## 2. Frame dimension table — extracted from FR-88 (1988 Blazer 4WD)

Wheelbase: **2705 mm (106.5")**
All values in mm. Letter codes match measuring points on FR-88 page 1. Both bottom view (point-to-point, hole edge for holes, center for bolts) and side view (parallel/perpendicular to centerline, lengths center-to-center).

### Bottom view — driver-side longitudinal stations
| Letter | What it marks | Distance from datum (mm) |
|---|---|---|
| A | Center of 15 mm round hole, inside front frame rail | 461 (cross-frame from CL) / 706 (long. station) |
| B | Tip of front leaf spring mount | 332 / 938 |
| C | Tip of rivet, crossmember mount | 463 |
| CD | (combined) | 1582 |
| D | Tip of rivet, crossmember mount | 464 / 1475 |
| E | Tip of bolt, motor mount | 448 / 1587 |
| F | Tip of bolt, leaf spring mount | 366 |
| G | Center of 19×33 mm oval hole | 367 / 1769 (longitudinal pair 952 / 866) |
| H | Center of 16×31 mm oval hole | 337 |
| I | Tip of rivet, exhaust hanger bracket | 305 |
| J | Tip of rivet, 10 mm round hole | 436 |
| K | Center of bolt, leaf spring mount | 575 |
| L / L' | Tip of rivet, tow package rear mount | 489 |
| M | Center of bolt, rear mount | 367 |
| N | Tip of bolt, tow package rear mount | 433 |

### Bottom view — cross-frame widths (between rails or to centerline)
- Front of frame, inside-to-inside: 1587 mm
- At motor-mount station: 705 mm (centerline to one rail) → frame inside width ≈ 1410 mm at engine bay
- At rear leaf-spring crossmember: 1624 mm × 2 references (rail-to-rail)
- Mid-frame after kick-up: 1184 mm
- Rear axle area: 1411 mm (each side reference)

### Side view — heights above datum line (frame profile)
Front to rear, station-by-station (mm above datum):
- Front rail tip: 706
- After front kick-down (just behind A-arm pivot): 938
- Mid-engine bay (level run): 1020 ± (1582 / 1475 indicate frame box outer dims)
- Cab kick-up to ride height: 791 → 961
- Mid-cab level: 286 difference between top and bottom of frame rail
- Rear kick-up to rear axle: 810 → 1093
- Rear axle peak: 382
- Rear of frame (datum to top of rear rail): 1186 → 824

> **Important:** these letter labels need to be matched to a clean diagram before Blender extrusion. The PDF page is the authoritative diagram — keep it open while building.

### Tightening specs (from FR-88 page 1)
- Front suspension anchor plate to knuckle: 65 lb-ft (88 N·m)
- Knuckle-to-lower-ball-joint: 30 lb-ft (40 N·m)
- Knuckle-to-upper-ball-joint: 100 lb-ft (135 N·m)
- Knuckle-to-axle: 114 lb-ft (155 N·m)
- Shock absorber to frame nut: 90 lb-ft (122 N·m)
- Shock absorber to axle: 50 lb-ft (60 N·m)
- Rear leaf spring shackle-to-frame: 65 lb-ft (88 N·m)
- Stabilizer to frame: 70 lb-ft (95 N·m)
- Rear U-bolt nuts: 110 lb-ft (150 N·m)
- Spring-to-axle U-bolt: 150 lb-ft (203 N·m)

---

## 3. Body envelope — engine compartment (from FR-88 page 2)

| Dimension | mm | inches |
|---|---|---|
| Engine bay width across firewall (top-of-fender plane) | 1715 | 67.52" |
| Centerline → inner shock tower (each side) | 1102 | 43.39" |
| Total inner-tower-to-inner-tower | 2204 | 86.77" |
| Length firewall → front (radiator support plane) | 1523 | 59.96" |
| Diagonal (squareness check) | 1957 | 77.05" |
| Cross-front width at front of bay | 1715 | 67.52" |

## 4. KLM-Blz cross-check (1984 Blazer chart)

Underhood view (KLM 1984):
- Front box width: 60" (1524 mm) × 67¾" (1721 mm)
- Front opening width: 43⅜" (1102 mm)
- Diagonals: 77¼" (1962 mm)

Numbers agree with FR-88 within ±10 mm (different measuring conventions). FR-88 is the more precise source.

Underhood view bottom-view side dims:
- Datum heights (front to rear): 14⁷⁄₁₆" (364), 21" (533), 16⅞" (429), 12⅝" (321), 14" (356), 24⅝" (618), 22½" (581), 21¾" (543)
- Longitudinal station gaps: 18¾" (479), 29¼" (743), 11½" (292), 40½" (1029), 32¾" (822), 19⅝" (498), 20½" (521)

---

## 5. LS3 envelope (from LS3-Marine page 3)

Long-block (no headers, no accessory drive, no intake-mounted air filter):
| Dimension | mm | inches |
|---|---|---|
| Length (damper face to bellhousing face, side view) | 710 | 27.95" |
| Width (oil pan to top of intake, front view, includes front accessory drive mounted) | 705 | 27.75" |
| Height (front view, oil pan to top of intake) | 716 | 28.19" |
| Bore center (cyl-to-cyl pitch) | 111.76 | 4.40" |
| Bore × stroke | 103.25 × 92 | 4.065" × 3.622" |
| Dry mass | TBD on sheet | ≈415 lb (industry reference) |

> **Caveat:** Marine LS3 has no headers shown — production manifolds add ≈ 80 mm width per side. With long-tube headers, plan for ≈ 950 mm full bay width occupied at exhaust collector level.

## 6. 6L80E envelope (TBD — need to read 6L80-Moveras)

Industry reference (verify against PDF):
- Length (bellhousing face to tail housing): ~673 mm (26.5") 2WD; longer with 4WD case
- Bellhousing OD: 540 mm (21.25")
- Dry weight: ~225 lb

---

## 7. What the Blender model needs (in this order)

1. **Frame mesh** — extruded from the FR-88 side-view profile, mirrored across centerline, with cross-members at the labeled stations. Wheelbase 2705 mm. *(IN PROGRESS — pending Blender connection)*
2. **Cab + body shell** — block-out from FR-88 page 2 envelope dims (firewall plane, A/B pillars, door opening, tailgate). Detail later from LMC parts diagrams.
3. **Engine bay constraint volume** — the 1715 × 2204 × 1523 mm box from FR-88, with shock tower cutouts at 1102 mm from CL.
4. **Engine envelope** — 710 × 705 × 716 mm box at the motor mount stations (E on the frame chart). Crank centerline sits where motor mounts dictate.
5. **Transmission envelope** — bellhousing OD + length aft of bellhousing face.
6. **Brake booster + master cyl** — Bosch iBooster footprint at firewall H3 location.
7. **Radiator** — at radiator support plane, perpendicular to centerline.
8. **Then**: harness routing, fitment, renders.

---

## 8. Open work

- [ ] Read `LS3_Long_Block_Installation_Guide.pdf` and `LS3_LS376_Long_Block_Installation_Guide_2023.pdf` for any envelope diagrams I missed
- [ ] Read `Moveras_31AS_6L80_Installation_Manual_Rev1.6.pdf` for trans envelope
- [ ] Source Bosch iBooster datasheet
- [ ] Identify motor mount brand → frame mount position
- [ ] Identify header brand → exhaust outlet position
- [ ] Identify radiator → core dims
- [ ] Audit `1977_Light_Truck_Service_Manual.pdf` for additional body/engine bay dim drawings
- [ ] Build the Blender frame mesh (waiting on Blender MCP connection)
