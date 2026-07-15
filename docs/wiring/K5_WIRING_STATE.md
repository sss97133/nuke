# K5 Wiring — Current State

> **Skylar has been working on this for months. Any agent starting a K5 wiring session must read this file first.** It captures decisions, open questions, failed approaches, and active workspace so you do not start from zero.

**Vehicle:** 1977 Chevrolet K5 Blazer · VIN **CKR187F127263** · LS3 6.2L · MoTeC M130 + PDM30
**Vehicle ID (canonical):** `e08bf694-970f-4cbe-8a74-8715158a0f2e` per Skylar's direct verbal correction 2026-05-17 ("it's the 7263 VIN that's the correct VIN"). All 141 `vehicle_build_manifest` rows are CORRECTLY attached to this vehicle. Earlier sessions wrote `appendix-d-k5-build.md` with the wrong VIN (`CCL187Z210370` / `e04bf9c5`); needs amendment.
**Roles:** Skylar = owner + builder (NUKE LTD). Scott = client + soon-to-be-owner (purchases on completion).
**Client:** Scott (scott@li3go.com). **Builder:** NUKE LTD, 676 Wells Rd, Boulder City NV 89005. **Wiring sub:** Desert Performance (same address).
**Build value:** $119,543 cumulative invoices Oct 2023 → Mar 2025 (SW77002, SW77003, SW77005, SW77006). This is a paid client build, not a project.

**Last updated:** 2026-06-10

---

## 1. DECISIONS LOCKED IN

These are settled. Do not re-propose alternatives unless Skylar reopens.

| Decision | Locked | Source |
|---|---|---|
| Wire spec: **Tefzel only** (no TXL, no marine substitute for 4 AWG) | 2026-05-11 | Skylar verbal: "ONLY TEFZEL" |
| 12–22 AWG: M22759/32 | 2026-05-11 | `K5_wire_spec_and_costs.md` Job 3 |
| 4–10 AWG: M22759/16 | 2026-05-11 | M22759/32 maxes at 12 AWG; LS3-Marine spec |
| Supplier: ProWire USA (primary), RaceSpec (reference pricing) | 2026-04-05 | `K5_wire_spec_and_costs.md` |
| ECU: MoTeC M130 (34+26 Superseal) | locked | `motec_m1_hardware_techspec.pdf` |
| PDM: MoTeC PDM30 | locked | confirmed throughout docs |
| Engine: GM LS3 6.2L Gen-IV | locked | `Marine_LS3_6.2L_Specs.pdf` |
| Intake: Holley 300-131 | locked | install doc IMG_9324 |
| Throttle body: 90mm DBW (GM 12605109) | locked | per cut list ETB wires |
| Coil bracket: DEL-Stributor, central mount, 8× D510C | locked | `K5_coil_mapping.md`, cut list note |
| Brake booster: Bosch iBooster Gen 2 (Tesla salvage + Tulay connector) | locked | `chapters/appendix-d-k5-build.md` |
| Fuel sender: GM 0–90 ohm → AV input + 270 Ω pull-up | locked | `K5_wire_spec_and_costs.md` Job 1 |
| Length pad on cuts: 15% body, 20% engine bay | 2026-05-11 | Skylar approved in receipt |
| Color reassignment allowed at mockup time (heat-shrink labels carry circuit ID) | 2026-05-11 | Skylar verbal |
| 3-color stripe codes remap to 2-color (M22759/32 doesn't ship 3-stripe) | 2026-05-11 | `K5_wire_spec_and_costs.md` §"Three-Color Stripe Problem" |
| Dakota Digital VHX dual-sender wiring — 11 wires added to cut list (#114-#124) | 2026-05-14 | `receipts/2026-05-14_acceptance-three-decisions.md`; sub-decisions on tach/VSS/high-beam still open |
| 6L80E TCU = Holley 558-499 T43 standalone module; CAN extension #125 added | 2026-05-14 | `receipts/2026-05-14_acceptance-three-decisions.md` |
| E-Stopp ESK001 trigger = dash latching button; wire #126 added | 2026-05-14 | `receipts/2026-05-14_acceptance-three-decisions.md` |
| High-beam topology = factory floor dimmer (PDM30:OUT17/18 → dimmer common → low/high outputs to headlights); +4 wires #85a/#85b/#86a/#86b | 2026-05-14 | `receipts/2026-05-14_decision-high-beam-floor-dimmer.md` (agent decision per Skylar "use the scientific method") |
| AC architecture: factory K5 Four-Season housing retained (visible chassis), control logic moves to M130 + PDM (factory 1977 amplifier board deleted), R134a refrigerant, hidden performance upgrades approved (PFA condenser, electric condenser fan, microchannel evap if fits, TXV/VOV, fresh drier, barrier hose, HNBR seals, trinary switch) | 2026-05-23 | `receipts/2026-05-23_ac-architecture-locked.md` |
| K5 insulation = COMPLETE (roof, firewall, floor). Do NOT spec in future build sheets — it is finished work | 2026-05-23 | Skylar verbal; receipt `2026-05-23_ac-architecture-locked.md` |
| AV pin shuffle: ETB keeps A14/A17 (TPS1/TPS2); #102 OPS moved A14→A25 (AV5); rule = newer decision wins pins. Cut list v4 (162 wires, 1098.2 ft) lands the 17 accepted-but-missing 2026-05-14 wires (#114-#126, #85a/b, #86a/b) | 2026-06-09 | `receipts/2026-06-09_cut-list-v4.md` (agent decision per high-beam scientific-method precedent, reversible by Skylar) |
| **Firewall bulkhead = D38999 61-way CONFIRMED** (receptacle D38999/24WJ61SN + plug D38999/26WJ61PN, insert 25-61, M39029 #20 contacts, 20–24 AWG only). Supersedes the 2026-05-11 connector-deferral **for this connector only** — device-end connectors remain deferred. Cavity map on `output/connector-sheets/K5_connector_FIREWALL_D38999.svg`: 61/61 used, 0 spare, **8 wires OVERFLOW** (OPS/FPS companions, #100, #60, #114/#115) — resolution (rail consolidation vs 2nd bulkhead vs grommet) is an OPEN Skylar call. Spec PN "26WA98SN" (2026-04-13) is malformed/stale | 2026-06-10 | Skylar instruction 2026-06-10; `receipts/2026-06-10_connector-build-sheets.md` |
| **Cut list v4.1 (168 wires, 1122.5 ft) — ECU lifelines + PDM30 battery feed.** v4 had NO M130 power/ground wires (ECU could never power on). Adds #ECU_PWR (A26, 16 AWG — Superseal cavity max), #ECU_GND1/2 (A10/A11, 2× 16 AWG equal length), #PDM_BPOS (M6 stud, 0 AWG single OR 2× 4 AWG parallel — Skylar picks), #PDM_GND1/2 (A26/B18, 2× 20 AWG per PDM manual p.5). **No #ECU_IGNSW — M130 has no ignition/wake pin (techspec pp.16-18); wake = switched BAT_POS upstream; switching element = OPEN decision.** #60/#61 superseded-pending-retirement. EE-audit PDM30_BAT+/BAT- FAILs remediated | 2026-06-10 | `receipts/2026-06-10_cut-list-v4.1-ecu-lifelines.md` |
| **Engine-start minimum config** (`configs/k5_engine_start_minimum.toml` + `output/K5_ENGINE_START_MINIMUM.md`): 82-wire ordered build list that cranks + runs the LS3 + shows gauges. Calc diff vs baseline: 145→73 calc wires, 877.5→312.2 ft, PDM 30→5 channels (25 freed). ~~APS pedal flagged: NO wires exist~~ → closed by v4.2 same day (minimum now 88 wires) | 2026-06-10 | owner goal statement 2026-06-10; calc run in `K5_ENGINE_START_MINIMUM.md` |
| **Cut list v4.2 (174 wires, 1143.5 ft) — APS pedal wires landed.** The DBW pedal (GM 10379038, `gm_aps_6pin`, dual-track analog 5V — two independent tracks, each signal+5V+0V) had ZERO wires in every prior version; engine could crank/idle but never rev. Adds #APS_T1_SIG (B21/AV7), #APS_T1_5V (A02 SEN_5V0_A), #APS_T1_GND (B15 SEN_0V_A), #APS_T2_SIG (B22/AV8), #APS_T2_5V (A09 SEN_5V0_B), #APS_T2_GND (B16 SEN_0V_B) — tracks split across the two 5V rails with letter-paired grounds (techspec pp.16-17) so one rail fault can't take both tracks. AV6/B20 left free for #98 fuel level. 22 AWG M22759/32, dash-zone 3.5 ft estimates (L19 proxy, `needs_rederivation`). gm_aps_6pin per-cavity map OPEN (connector-time). If M130 mounts engine-bay side, +6 bulkhead crossings on the 8-wire D38999 overflow | 2026-06-10 | `receipts/2026-06-10_cut-list-v4.2-aps-pedal.md` |
| **Wiring COMPETENCE CANON = chapters 16/17/18** (16 wire+protection · 17 power+ECU/PDM · 18 construction+segmentation). Cited atomic rules consolidated from substrate; the cited-or-marked-UNKNOWN discipline applied to KNOWLEDGE. **PRE-FLIGHT GATE** (in `.claude/rules/wiring-*`): before ANY wiring artifact, read state §1-4 + the relevant canon chapter + `library_search` every spec, cite or mark unknown, stop on owner-only decisions, self-check "would Dave shred this?". This row exists because an agent kept producing before grounding. | 2026-06-18 | `receipts/2026-06-18_wiring-competence-canon.md`; workflows `wf_f053b1be-683` + `wf_b2accc9b-ab3` |
| **DC-primary topology = battery → isolator → distribution stud → branches.** Starter feed UNFUSED (ABYC cranking-motor exemption); isolator must isolate battery from PDM + starter + alternator with a secondary contact to an ECU shutdown input (MoTeC requirement). Star ground: single reference, power grounds vs sensor 0V separate, no daisy chains. **CORRECTED 2026-07-12: "E-Stopp isolator" was a mislabel — E-Stopp ESK001 is the electric PARKING BRAKE actuator (#54), NOT a battery disconnect. The isolator DEVICE IS UNSELECTED, and the ECU-shutdown wire is absent from cut list v4.2 (assign a free UDIG B08-B11/B14). See receipt 2026-07-12_certification-machinery-four-artifacts.md F2.** | 2026-06-18 (corrected 2026-07-12) | `research/2026-06-10_power_spine_builders_study.md` §2/§4; ch.17; receipt 2026-07-12 |
| **DC-primary gauge: 2 AWG primaries (Dave) OR 2×4 AWG /16 parallel (spine study).** Dave runs 2 AWG to starter solenoid + alternator off the stud (brief-crank duty). Substrate-sourced alternative = 2×4 AWG /16 equal-length parallel (≈1 AWG). **CORRECTED 2026-06-19:** the cut-list "0 AWG /16" (#6/#59/#63) is **BUILDABLE** — M22759/16 is made 24 AWG→2/0 (= M22759/16-01) per ProWire/Thermax, Jaycor, NASA NEPP; it is NOT an impossible spec (prior claim was wrong, propagated by me). So the real choice is 0 AWG /16 single vs 2×4 AWG /16 parallel vs Dave's 2 AWG single. Reconcile to Dave's number at mockup. | 2026-06-18 (corrected 2026-06-19) | Dave verbal via Skylar; `ch.16 §1.4/§4`; `receipts/2026-06-19_canon-external-ingestion.md` |
| **Engine-only firewall.** The D38999 carries ENGINE signals only (20-24 AWG). Body circuits (A/C clutch #23, washer #50, underhood light #73, parking #83/#84, markers #87/#88, turn #80/#82) move to the body/front-lighting harness — which FREES the cavities that resolve the row-43 8-wire overflow. Dave correction. | 2026-06-18 | Dave via Skylar 2026-06-18; ch.18 segmentation |
| **Dave's vocabulary is the deliverable standard.** TPS not ETB, oil PSI not OPS, coolant temp not CLT, crank/cam sensor not CKP/CMP. His Excel pinout (`~/Downloads/M130 ECU Overland Bronco.xlsx`) is the format oracle; deliverables are clean spreadsheets, not schematic art. | 2026-06-18 | Dave via Skylar 2026-06-18 |

## 2. DESIGN PRINCIPLES (Skylar's stated rules — apply to every decision)

- **High-power = multiple skinny conductors in parallel** rather than one fat slug. NOT YET ENCODED in cut list — current cut list still has 4/8/10 AWG single runs. Open task to reconcile.
- **Calculate maximum distance first → prototype with one-color wire at max length → verify on vehicle → cut to size.** Dave's method, accepted by Skylar 2026-05-12.
- **Connectors are deferred until after formboard layout.** Do NOT propose connector lists, mating PNs, or terminal counts before the formboard is built and verified. Skylar's explicit instruction 2026-05-11.
- **Every claim cites a source.** Position, dimension, gauge, color, length — each must trace to a doc, source line, measurement, or marked unknown. No inventing.
- **2D done right.** ~~Skylar does NOT want 3D rendering.~~ **SUPERSEDED 2026-06-09 by Skylar's direct instruction**: build the harness in CAD as a 3D-accurate render of the truck. The 3D model serves Dave's method (derives landmark max-lengths + formboard transfer views); it does not replace on-vehicle verification. See `receipts/2026-06-09_3d-cad-model-and-derived-landmarks.md`. The 2D polyline-truth principle still governs: every length is a polyline around obstacles, now measured in 3D.
- **Memory is agent-layer; substrate lives in DB.** Vehicle facts, wire atoms, dimensional data → Nuke DB or YAML files with provenance. Agent memory only holds pickup instructions and behavioral rules.

## 3. OPEN ARCHITECTURAL QUESTIONS

Several of my earlier "open questions" were already answered by the library — corrected below.

**Answered by library:**
- ~~Endpoint definition~~ → `chapters/05-build-manifest.md`: each device has pin count + signal type + connector type. The endpoint is the connector pin (cavity). Wire count derives from signal type (e.g. `analog_5v` = 3 wires, `analog_temp` = 2 wires, `low_side_drive` = 2, `logic_coil_drive` = 4).
- ~~ECU choice~~ → `chapters/06-compute-engine.md`: M130 is *derived* not chosen. Compute engine evaluates I/O against device manifest; M130 fits this build (8 inj + 8 ign + 4 digital used vs M130's 8/8/7 capacity), saves $2,000 over M150.
- ~~Direct-wired vs PDM~~ → `chapters/05-build-manifest.md` §"Direct-Wired Devices": alternator, starter, battery disconnect, fuel pump (Aeromotive A1000, 35A), iBooster (40A peak), amplifier (30A) are all NOT PDM. All sensors powered from ECU 5V ref directly.

**Still open:**
0a. **TRANS CORRECTED 2026-07-12 (Skylar verbal at close): the transmission is a 6L90, NOT 6L80E** — every prior doc/DB row saying 6L80E is wrong; audit `vehicle_build_manifest` + appendix-d next session. Ruling below SURVIVES (TCM-2650 supports 6L80E/6L90E/6L50; the cited diesel install was a 6L90; Holley dead for both). Verify call = "4WD-output **6L90** T43 OS." ~~6L80E CAN-MASTER HOLE~~ → **RULED 2026-07-12: PCS TCM-2650** (pending 2 free verifications: PCS 4WD-output/T43-OS support; MoTeC USA/JRR whether their T43 GMLAN runs on M130). Holley 558-499 is DEAD for this truck — requires a Terminator X Max engine ECU AND **explicitly does not support 4WD** (K5 = NP205 4x4); the locked 2026-05-14 row was never buildable. PCS = private 2-node GMLAN to the internal T43 (M130 bus untouched); RPM feed = spare A33/HB5 tach-mirror; TPS tee off A14; #125 repurposes as the PCS stub; F3 loose wires home in the PCS harness. Fallback only: 4L80E + US Shift (~$4.5-8.5k). See `receipts/2026-07-12_6l80e-can-master-ruling.md`.
0b. **Battery isolator UNSELECTED** (E-Stopp mislabel corrected in §1) + ECU-shutdown wire missing. See receipt 2026-07-12 F2.
0d. **COMMS CIRCUITS ABSENT (found 2026-07-12):** cut list v4.2 has NO way to talk to either computer. (a) PDM30 config requires the **MoTeC UTC #61059** USB-to-CAN adapter (PDM manual p.48; "not compatible with MoTeC CAN cable") + a CAN service connector (DTM-4 style: 12V/GND/CAN-H/CAN-L) spliced to trunk #62 — NEW order item, no prior list had it. (b) M130 tuning requires **Ethernet B23-B26** (techspec; Dave's Bronco wires it) — zero Ethernet wires exist in the cut list; add 2 twisted pairs B23-B26 → RJ45 service point, cabin-side. (c) CAN termination MAP needed before splicing (trunk says 120Ω each end; PDM manual short-bus rule allows single-resistor <2m; internal terminators unverified — ohm H-L unpowered). Next cut-list rev: comms group.
0c. **Dakota gauge-feed fork:** locked dual-sender (11 wires) vs **BIM-EFI-1 mode F13** reading the M1 General CAN stream (0x640) — tach/speed/coolant/oil-PSI/fuel over 2 wires, deletes 5 wires + duplicate senders. Prereqs: #98 needs an AV pin (proposal B20/AV6); 4-node CAN termination plan; Dakota power/ground must be 18 AWG. NOT unlocked — evidence in `DAKOTA_VHX_ARCHITECTURE.md`; Skylar decides.
1. **Engine harness ↔ body harness boundary location.** Grommet? Bulkhead connector? Service split? Chapter 13 routing model uses zone-to-trunk auto-routing — implies grommet/trunk transitions, but doesn't specify the physical join method.
2. **Sub-harness join method.** Solder + heat-shrink (permanent)? Bulkhead connector (serviceable)? Raychem ES-type splice? Affects rebuildability and field repair.
3. ~~Vehicle ID reconciliation~~ → **RESOLVED 2026-05-17 by Skylar's direct correction.** `e08bf694` / VIN `CKR187F127263` IS the K5. The 141 build_manifest rows are on the right vehicle. Earlier confusion was caused by appendix-d's wrong VIN. **Remaining work:** (a) amend `chapters/appendix-d-k5-build.md` with correct VIN; (b) ~~audit what `e04bf9c5` actually is~~ → **ANSWERED + bleed SEVERED 2026-06-11**: e04bf9c5 = GAA listing 43671, a DIFFERENT physical 1977 Blazer (2WD / 383 stroker / 700R4 / NMVTIS-branded title) that had `owner_id`=Skylar from fuzzy matching — link severed, intake matcher patched, 25 testimony rows relinked with lineage. ~~Open remainder~~ → **DRAINED 2026-06-11 (Skylar's go: "reappropriation of all of my images")**: all 888 images + 1,299 observations relinked e04bf9c5 → e08bf694 via `relink_testimony()` with per-row lineage + audit, evidence basis `output/limbo_888_evidence.csv` (841 strong / 46 weak / 1 by filename lineage); e04bf9c5 now holds only intentional stays (298 gate-rejected/hash-twin images + 32 superseded obs). 17 metadata defects (swapped/NULL taken_at+GPS) repaired from stored-original EXIF. The K5's photo corpus lives entirely on e08bf694. Receipts: `receipts/2026-06-11_k5-doppelganger-reattribution.md` + `receipts/2026-06-11_reappropriation-complete.md`.
4. **PDM30 is at 30/30 capacity per appendix-d.** No expansion headroom. Any new device requires PDM15 add-on OR load consolidation.
~~5. 6L80E TCU architecture~~ → **RESOLVED 2026-05-14** (Holley 558-499 T43). See acceptance receipt.
~~6. E-Stopp trigger~~ → **RESOLVED 2026-05-14** (dash button). See acceptance receipt.
~~7. Dakota dual-sender wires~~ → **RESOLVED 2026-05-14** (11 wires enumerated). Three sub-decisions remain open below.

**All Dakota sub-decisions resolved 2026-05-14:**

~~5. #116 Dakota tach~~ → M130:A31 (OUT_HB3 spare half-bridge). Trade-off: M1 GPR firmware config required at tune.
~~6. #118 Dakota VSS~~ → M130:A32 (OUT_HB4 spare half-bridge). M130 mirrors input VSS to Dakota.
~~7. #121 Dakota high beam tap~~ → #85b (floor dimmer high-out).

**M130 spare half-bridges remaining:** A33 (OUT_HB5), A34 (OUT_HB6). Available for future provisioning — winch trigger, auxiliary lighting, retract step override, etc. Per Skylar's "provisioning for future" intent.

## 4. OPEN MEASUREMENT UNKNOWNS (need physical work on the truck)

From `K5_DIMENSIONAL_SUBSTRATE.md` and gaps surfaced in this session:

- M130 mount position — STILL OPEN, sharpened 2026-06-09: as-built photos show it NOT mounted; passenger firewall carries a gold heat-shield panel (contents unknown — ask Skylar); `devices.json` says "dash" vs this file's "passenger firewall". MoTeC constraints: splash-protected, 85°C ceiling, 60–80mm connector clearance — cabin side favored. See receipt `2026-06-09_as-built-photo-survey-corrections.md`.
- PDM30 mount position (asserted "under dash passenger" — no measurement). 2026-06-09: runs hot; closed pocket disqualified — needs ventilation + CAN heat-soak validation.
- Battery location — **WORKING POSITION 2026-06-10: PASSENGER firewall corner, per Skylar's stated goal ("battery, ECU, PDM and the essential pinout so we can turn on the engine").** Owner-stated working position, NOT a measurement; no tray installed (2026-01-31 photos). Prior driver-front belief was POISONED (different blue carbureted squarebody, misattributed 2026-02-03 telegram batch). **L14/L15 are stale (driver-side derivation) — mirror-flip + re-derive in the Blender twin before cutting battery-relative wires.** See `receipts/2026-06-10_cut-list-v4.1-ecu-lifelines.md` §5.
- ~~iBooster footprint~~ → CONFIRMED INSTALLED 2026-06-09: driver firewall, factory pad, adapter + custom MC, twin reservoirs (DB images 40e5e5f9/dff584e9); footprint photogrammetry-measurable. Pigtail unterminated.
- ~~CKP at bellhousing rear~~ → CORRECTED 2026-06-09: LS3 is Gen IV — CKP AND CMP on FRONT timing cover (BOM PNs 12615626/12591720 corroborate). L10 re-derived 32.5". Gen III rear-mount pattern was stale.
- Accessory drive: as-built = **CVF Racing (BANDO 6PK1930), alternator LOW DRIVER, no A/C compressor fitted** — contradicts atoms' "Holley Mid-Mount confirmed". Scan/measure the CVF drive for the model.
- Throttle body: photos show 4150-flange TB + drum cleaner vs locked "90mm DBW GM 12605109" — confirm actual DBW plan (Q2 to Skylar).
- Radiator real top-down dimensions (only K5 28"×18" front-view was found; top-down core thickness assumed ~3")
- Motor mount fore-aft offset from firewall (frame point E is at frame station 1587mm, but no atom for frame-to-body offset)
- Firewall actual top-down shape (treated as flat line; has brake booster bulge, MC area, A/C box)
- Inner fender well curves (treated as flat rectangle)
- LS3 sensor boss positions on engine (crank rear, cam front, oil pressure on galley)
- Holley 300-131 head bolt pattern (so intake position is derivable, not guessed)

## 5. FAILED APPROACHES (do not repeat)

| Approach | Why rejected | Date |
|---|---|---|
| `K5-order-list.csv` (310 SKUs, $9,900.70, 40 vendors) | Dave: "explosive diarrhea" — wrong M130 mating connector PN, two layers of assumption | pre-2026-05-11 |
| Generic TXL hot-rod shopping list pitched as starting point | Skylar: "confident stupidity" | 2026-05-11 |
| "Multiple skinny conductors" pitched as if my own concept | Skylar's principle, I rebadged it | 2026-05-11 |
| Generic MoTeC = Raychem Spec 55 lecture (Skylar's K5 is Tefzel M22759/32, not Spec 55) | Wrong substrate, not what's spec'd | 2026-05-11 |
| Naive empty-rectangle workspace HTML | "sticker board, not a workspace" — no landmarks, no routes | 2026-05-11 |
| Inventing iBooster position at fb_x=31 | I made it up, position is an open unknown | 2026-05-12 |
| Drawing radiator at 3"×44" (lifted directly from FormboardCanvas stylization) | FormboardCanvas value is a layout placeholder, not real radiator dims (real is ~28"×3" top-down) | 2026-05-13 |
| Engine block centered with arbitrary 200mm setback | Setback should be derived from motor mount frame station, not chosen | 2026-05-13 |
| Auto-generated "proof packet" pitched as the right deliverable for Dave | Dave wants 1:1 formboard, not more paper | 2026-05-12 |

## 6. ACTIVE WORKSPACE

**Primary live surface (2026-06-10): the HARNESS WORKBENCH** — WORKBENCH tab (key `6`) at `/vehicle/:vehicleId/wiring` in nuke_frontend. Toggle the 18 toggleable subsystems (+ MECHANICAL_GAUGES alternate) and the whole harness re-derives client-side: live cut list (162-wire v4 registry incl. DOC-05 companions), D38999/M130/PDM30 connector faces (R1–R6 cavity rules), PDM channel loading + freed channels, alternator budget ladder, footage/cost. Engine: `harnessDerivation.ts` (pure, synchronous; data baked from `calc-data/subsystems.json`, `K5_landmarks_blender_derived.yaml`, `K5_wire_paths.yaml`, `K5_cut_list_v4.txt`). Parity vs `scripts/k5_harness_calc.py` asserted by 16-test vitest suite (`__tests__/harnessDerivation.parity.test.ts`). Toggles persist in URL (`?wb=FUEL,AUDIO&mg=1`). **The python generators (`k5_harness_calc.py`, `generate_connector_build_sheets.py`, pinout/cut-plan emitters) remain the print-export path** — paper build sheets for the bench; the workbench is where configuration decisions get explored. Receipts: `2026-06-10_harness-workbench-tab.md`, `2026-06-10_live-harness-workbench.md`; proof `output/workbench_proof.png`.

**Geometry substrate (2026-06-09): the digital twin** — `~/k5-harness-pull/K5_harness_workspace_v2.blend` (TurboSquid 1978 Blazer #1764639, scale verified 2,703 vs 2,705 mm wheelbase, + atom-built `K5H_*` engine-bay/electrical insert + L01–L30 landmark polylines + color-coded loom trunks). Renders in `docs/wiring/output/blender/` (`K5_harness_iso/enginebay_top/underbody/cab_dash/formboard_top.png`). Orange components = position unverified (A1–A8 ledger); green = grommets. Derived landmarks: `K5_landmarks_blender_derived.yaml` (30/30 valued, v2) → `K5_computed_lengths.csv` (113 wires, 913.8 ft) → `K5_PROTOTYPE_CUT_PLAN.md` + `K5_MATERIALS_FORMBOARD.md`. Blender MCP addon drives it from Claude sessions. **Recalc engine (2026-06-09): `scripts/k5_harness_calc.py` — toggle subsystems in `docs/wiring/configs/*.toml`, get wires/ft/$/PDM/bundle-OD diffs; data in `calc-data/`; receipt `2026-06-09_recalc-engine-v1.md`.** A from-primitives model built earlier on 2026-06-09 was rejected by Skylar and deleted (receipt `2026-06-09_3d-model-v2-digital-twin.md`). NOTE: prior routed-harness work (`formboard/K5_routed_harness.blend`, `model_analysis.json`) was lost to an SSD sweep ~May 3 — v2 recreates it.

**Prior:** `docs/wiring/output/K5_endpoint_workspace.html` — drag-and-drop endpoint placer + waypoint-routed wire drawer + 1:1 scale + engine outline overlay. Open in browser. Skylar has placed engine-bay endpoints (image saved in session 2026-05-12).

**Secondary (mature, in nuke_frontend):** `FormboardCanvas.tsx` (2,552 LOC) routed at `/vehicle/:vehicleId/wiring`. 1:1 pegboard 200"×96", real connector dims, save-to-DB. Skylar has not used this — preference is to enrich the HTML workspace instead per 2026-05-13.

**Per-endpoint detail (mature):** `WiringDetailPanel.tsx` shows wire/gauge/color/source per device.

**Engine schematic SVGs:** `K5_S2_engine_schematic_v2_p1.svg`, `_v2_p2.svg`, `_P1_ignition_coils.svg`, `_P2_fuel_injectors.svg`, `_P3_engine_sensors.svg` — these exist; quality unverified.

## 7. SUBSTRATE FILES (these are the ground truth)

**Read in this order at session start:**

**The doctrine layer (read first — these tell you HOW the system works):**
1. **This file** — current state
2. `docs/wiring/chapters/appendix-d-k5-build.md` — THIS SPECIFIC BUILD: client, vehicle ID, components, invoices, what's computed, what's left
3. `docs/wiring/chapters/01-workshop-model.md` — "The Harness Is Derived, Not Designed" doctrine
4. `docs/wiring/chapters/05-build-manifest.md` — signal type classification, PDM channel grouping, direct-wired vs PDM
5. `docs/wiring/chapters/06-compute-engine.md` — `computeOverlay(devices) → harness`. Pure function. ECU model derived from I/O.
6. `docs/wiring/chapters/13-canvas.md` — canvas vision: 4 base layers, zone-trunk auto-routing
7. `docs/library/technical/wiring-software-landscape.md` — tool tier eval (RapidHarness, EZ Wire, harness.design, Splice CAD, WireViz), integration strategy
8. `docs/library/LIBRARIAN.md` — library contribution rules

**The data layer:**
9. `docs/wiring/output/K5_dimensions_atoms.yaml` — 56KB of cited dimensional atoms (frame, body, LS3, intake)
10. `docs/wiring/output/K5_DIMENSIONAL_SUBSTRATE.md` — index of every dimensional reference doc
11. `docs/wiring/output/K5_landmarks.yaml` — L01–L25 named routing landmarks
12. `docs/wiring/output/K5_wire_paths.yaml` — per-wire-ID landmark traversal
13. `docs/wiring/output/K5_cut_list_v4_2.txt` — 174 wires, 1143.5 ft (v4.1 + 2026-06-10 APS pedal addendum; supersedes v4.1 — see `receipts/2026-06-10_cut-list-v4.2-aps-pedal.md`). NOTE: calc engine + workbench still parse v3/v4 registries — the 6 lifeline wires (v4.1) and 6 APS wires (v4.2) are not yet in `calc-data/subsystems.json` (which still lists APS in known_gaps); reconcile at next regen.
14. `docs/wiring/output/K5_wire_spec_and_costs.md` — Tefzel pricing, 3-stripe remap, fuel sender analysis
15. `docs/wiring/output/K5_pdm30_channel_plan.md` — PDM channel assignments
16. `vehicle_build_manifest` DB table — 115 devices, 347 endpoints (canonical for compute engine)

**The code layer:**
17. `nuke_frontend/src/components/wiring/overlayCompute.ts` — `computeOverlay()` pure function
18. `nuke_frontend/src/components/wiring/objectTraits.ts` — pierceability, thermal, factory holes, ground points
19. `nuke_frontend/src/components/wiring/FormboardCanvas.tsx` — partial canvas implementation (2,552 LOC)
20. `supabase/functions/compute-wiring-overlay/` — server twin

**Receipts directory:** `docs/wiring/receipts/` — every change should have one. Format is informal until `RECEIPT_FORMAT.md` is written (currently a gap).

**Mil-spec protocol references (added 2026-05-21):**

21. `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md` — the heat-shrink stack protocol, M23053 family, SCL/DR-25/solder-sleeve layering, AS85049 backshells, AS81765 transition boots, MoTeC Superseal built-up boot practice, 1977 GM factory protocol for body-side wiring. **Read this before specifying any termination or splice.**
22. `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md` — verified D38999 + Superseal + M39029 contact PNs, crimp tooling cross-reference.
23. `docs/wiring/reference/motec/VALIDATION_REPORT.md` — M130 + PDM30 pinout validated against official MoTeC datasheets.

**The librarian (added 2026-05-22) — entry barrier for vanilla agents:**

24. `docs/library/_extracted/manifest.json` — index over 92 PDFs in `reference_documents/`. 75 MB of per-page extracted text across 4 GM service manuals (1973, 1977, 1981, 1987), 5 supplements (1974-1980 light truck), 3 wiring booklets (1978 + 1985 CK + 1988 complete), frame dimensions, RPO codes, 60+ component datasheets.
25. **`scripts/library_search.py`** — search the library by keyword. Returns cited pages with line-level excerpts. **Use BEFORE making any wiring observation that should cite factory documentation.** Examples:
    - `python3 scripts/library_search.py "grommet"` → finds firewall grommet sizing in Aeroflow MAP install + LS3 EROD harness routing
    - `python3 scripts/library_search.py "harness clip" --limit 5` → finds 1987 service manual harness routing at pages 589-590
    - `python3 scripts/library_search.py "M130 mount"` → wherever it's cited in component datasheets
26. **`database/migrations/20260522_reference_documents_substrate.sql`** — staged (DB down at 2026-05-22 evening). Lands `reference_documents` + `document_pages` tables + tsvector full-text search + `v_library_search` view + adds `citation_document_id/page_number/excerpt` columns to `vehicle_observations` for structured citations (dual-mode with legacy string citations).
27. **`database/migrations/20260522_observation_witnesses.sql`** — staged. Lands the image-as-witness layer per the 2026-05-22 architecture conversation. Observations link to specific `vehicle_images` with `witness_role` (primary/context/supersession/derived) + `capture_method` (live_streaming = strongest, photo_with_exif, photo_no_exif, composite). The `v_observation_attestation` view rolls up to a tier (attested_strong / attested_weak / contextualized_only / unwitnessed).
28. **`scripts/library_ingest_to_db.py`** — runs after the substrate migrations apply. Reads manifest.json + per-page text files, INSERTs into reference_documents + document_pages. Idempotent via file_hash.

The librarian is the apprenticeship's entry barrier. A vanilla agent that doesn't search the library before making a wiring claim fails the citation_required edge. An agent that searches well and cites carefully builds reputation. Per 2026-05-22 conversation: the DB is FACTS; authentication is live images; the library is searchable index, not pre-extracted truth.

**Schema proposals — 2026-05-22 institution workout:** 12 proposals filed, audited, remediated, applied.
- **4 withdrawn** (self-audit found false-merge violations — jsonb stacks that collapsed N atomic claims into 1 cell): `wire_termination_a_protocol`, `wire_termination_b_protocol`, `wire_label_text`, `wire_routing_landmarks`.
- **7 add_property approved → observation_properties**: `wire_termination_a_inner_seal_pn` + `_b_inner_seal_pn` (SCL inner seal at each end), `wire_termination_a_outer_cover_pn` + `_b_outer_cover_pn` (DR-25 outer cover), `wire_label_a_text` + `_b_text` (printed sleeve text per IPC/WHMA-A-620), `loom_outer_jacket_pn` (loom-cardinality, discriminator_key='loom').
- **1 add_observation_kind approved → enum value 'splice' added** to `observation_kind`. Open design questions on whether splices live in `vehicle_observations` with structured_data carrying input/output wire arrays OR in a separate `splices` entity table; decision deferred to whoever ingests the K5's 4 known Y-splices (coil distribution, injector distribution, BAT_NEG bus, ETB connector).
- **Approval biology now closes the loop:** `database/migrations/20260522_schema_proposal_approval_trigger.sql` added `fn_schema_proposal_review_handler()` — AFTER INSERT trigger on `schema_proposal_reviews` that counts distinct approves vs per-type quorum (1 for add_property/source/category/kind, 2 for fork_property/modify_trust_tier), promotes the proposal to `status='approved'`, and runs `fn_schema_proposal_apply()` which inserts the new observation_property row (or runs `ALTER TYPE ADD VALUE` for kinds). The handbook §6 promise is now backed by biology.
- **Wiring substrate coverage** went from 7 properties to 13 (excluding splice). Next pass to ingest values for the new properties: read MoTeC datasheet pages for Superseal terminal seals + read invoices/build sheets for the actual DR-25/SCL PNs used on each wire's terminations. None of those values are in the substrate yet — only the slots are.

## 8. REVIEWER FEEDBACK

- **Dave (neighbor, has Tefzel spools, motorsport experience)** — shredded `K5-order-list.csv` as "explosive diarrhea." Caught wrong M130 mating connector PN. Prescribed remedy: lay it out 1:1 on a formboard. Method: max-length first, prototype with one color, verify on vehicle, then cut.
- **Scott (visited 2026-05-10)** — "all empty, shit, not showing data." Two outside expert rejections of the current state.

## 9. NEXT CONCRETE STEPS

**Pulled from `chapters/appendix-d-k5-build.md` §"What's Left"** — the canonical work list (not invented by me):

1. **Validate PDM30 pin map** — still scaffolded (39 pins), needs MoTeC PDM30 wiring manual. Without this, the connector schedule is asserted not verified — which is exactly what Dave caught in his "explosive diarrhea" review.
2. **Physical measurements on vehicle** — every wire length is currently estimated from zone distances. Need actual measurements per circuit. This is the work Dave's formboard prescription is designed to do.
3. **Harness routing** — currently conceptual (engine loom, dash loom, rear loom). Needs physical routing plan that captures real paths around obstacles, real grommet selections, real trunk locations.
4. **ECU programming** — M1 firmware configuration, I/O assignments, sensor calibration.
5. **PDM programming** — channel assignments, current limits, soft-start profiles, grouped-load logic. PDM30 is at 30/30 capacity per appendix-d.

**Additionally from this session's discoveries:**

6. **Vehicle ID reconciliation** — `e04bf9c5` (docs) vs `e08bf694` (DB build_manifest). One must be retired before any DB write.
7. **Resolve cut list vs build manifest device count** — appendix-d says 110 wires / 805 ft; `K5_cut_list_v2` says 123 wires / 905 ft. Cut list is later iteration with added devices — confirm what was added and rerun compute engine.
8. **Reconcile "high-power = many skinny conductors" principle vs cut list** — cut list still has 4/8/10 AWG single runs (§2 principle says parallel skinny). Either principle changes or cut list does.
9. **Replace `K5_endpoint_workspace.html` with a canvas-chapter-13-compliant renderer** — vehicle outline + zone grid + factory archaeological + upgrade overlay + component markers, fed by `computeOverlay()` output. NOT another drag-drop sticker board.

## 10. WHAT THIS FILE DOES NOT CONTAIN

- Specific wire data (lives in `K5_cut_list_v2.txt`)
- Pin assignments (lives in `K5_pdm30_channel_plan.md` and ECU pin maps in DB table `device_pin_maps`)
- Connector PNs (deferred; do not propose)
- Step-by-step build instructions (live in `K5_harness_build_sheets_v2.md`)

This file is the **agent's pickup state**. Substrate lives in the files §7 lists.

## 11. UPDATE PROTOCOL

When this session adds a decision, closes an unknown, or rejects an approach:
- Edit the relevant section here (§1 decisions, §3 open questions, §4 unknowns, §5 failed approaches)
- File a receipt in `docs/wiring/receipts/YYYY-MM-DD_<slug>.md` citing what changed
- Update §6 if active workspace changes

This is the single source for "where the K5 wiring is." If a future session disagrees with what's in here, that's the conversation to have BEFORE rebuilding anything.
