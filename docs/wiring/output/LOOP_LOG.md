# K5 Wiring Diagram — Overnight Loop Log

Goal: a Dave-shippable wiring diagram derived from K5_cut_list_v2.txt and the build manifest, not hand-drawn.

Pipeline: K5_cut_list_v2.txt → `generate_wireviz_yaml.py` → WireViz YAML → Kroki.io → SVG.

Pacing: dynamic self-paced loop, fallback ~25 min wakeup between iterations.

---

## 2026-05-13 — Iteration 0 (first render)
- **Output:** `K5_engine_loom_wireviz.svg` (171 KB, 958 elements)
- **YAML:** `K5_engine_loom_wireviz.yaml`
- **Scope:** ENGINE LOOM (33 wires)
- **Notes:** First time WireViz pipeline run end-to-end on K5 data. Connectors generic, destination pins were P1/P2/Pn placeholders, every wire its own cable. Baseline.

## 2026-05-14 — Iteration 7 (Cover page + TOC + honest gaps section)
- **Output:** `K5_complete_wiring_diagram.pdf` (384 KB, 8 pages) — now with cover page first
- **Cover page (`K5_cover_page.svg`, `K5_cover_page.pdf`):**
  - Header: K5 WIRING DIAGRAM · VIN CCL187Z210370 · LS3 6.2L · M130 + PDM30
  - Client/builder/wiring sub block (Scott / NUKE LTD / Desert Performance)
  - Spec block: Tefzel tier, M130, PDM30, LS3 + Delmo, Holley 300-131, D510C coils
  - TOC table: 7 looms with wires count and feet count per loom (parsed from `K5_cut_list_v2.txt`)
  - **KNOWN GAPS section in red** — surfaces honestly: missing companion grounds/power wires for sensors/coils/injectors; lighting/switch/audio connector PNs unknown; lengths are zone estimates not measured
- **Updated `build_complete_pdf.sh`** to prepend cover page automatically.

## 2026-05-17 — Iteration 11 (engine loom END CONDITION MET: 33→55 wires, all addendums included)
- **Output:** `K5_engine_loom_wireviz_v16.svg` (341 KB) — supersedes v15 (intermediate v15 had section-name-mismatch bug — short-form section names didn't match the ADDENDUM_TO_LOOM map; fixed in v16)
- **Wires:** 55 total (33 main + 19 sensor companions + 3 bus rails). The 3 bus rails (`#INJ_PWR`, `#COIL_PWR`, `#COIL_GND`) now render with `PDM30:OUT?` and `ENGINE BLOCK` source-pin labels — the `?` is the cut-list-acknowledged TBD on the PDM channel assignment, surfaced honestly in the diagram instead of dropped silently.
- **Generator changes:**
  1. Source pattern extended to accept `PDM30:OUT?` (TBD placeholder) — render-honest about a known unknown rather than hide it
  2. `ADDENDUM_TO_LOOM` map corrected to use short section names (`LOW_SIDE_DRIVE`, `LOGIC_COIL_DRIVE`) — `section_pat` captures up to the first paren, so the map keys must match the truncated form
- **Combined PDF rebuilt:** `K5_complete_wiring_diagram.pdf` (384 KB, 8 pages) on v16 engine page.
- **Pin conflict A14 still flagged** in YAML header — unchanged.

## **LOOP STOPPED — READY FOR REVIEW**

The loop's end condition is met. Engine loom shows all 33 main wires with real connector groupings and connector PNs where known (`MoTeC Superseal A 34-pin`, `WPCKP40 GM 12615626` etc.). Sensor companions consolidated into the right device connectors. Bus rails surfaced with honest TBD markers.

Reason for stopping the loop here rather than continuing:

Today's conversation reframed the work. Skylar surfaced that the diagram loop has been producing **artifacts in folders** when the actual goal is **rows in the database**. The cut list `K5_cut_list_v2.txt` is currently a flat text file; the engine loom SVG/PDF is downstream rendering. The architecturally correct move — which six audit agents are currently producing the inputs for — is to ingest the cut list into `wire_specifications` rows on `vehicles.id = e08bf694`, then render diagrams as a view OVER the table, not from the text file. That's the next move when the audit synthesis lands.

Continuing the loop would produce more SVGs of marginal value when the real value is shifting to substrate ingestion. Stopping here.

## 2026-05-17 — Iteration 10 (engine loom addendum companions folded in: 33→52 wires)
- **Output:** `K5_engine_loom_wireviz_v14.svg` (322 KB) — supersedes v10/v11/v12/v13 (v11–v13 had parser bugs documented inline below)
- **Generator changes:**
  1. New `ADDENDUM_TO_LOOM` map: folds 6 cut-list addendum sections (analog_temp grounds, analog_5V refs, crank/cam shielded companions, knock companions, injector +12V rail, coil power/ground rails) into the ENGINE LOOM render. 22 sensor companion wires now appear in the diagram.
  2. Parser rewrite: source pin detected by regex (`M130:[AB]\d+`, `PDM30:OUT\d+`, `ENGINE BLOCK`, `STAR GND DASH`, etc.) so single-space label/source pairs (e.g. `#99g CKP Sensor Ground (conductor 2 of #99 shielded 2C cable) M130:B15`) parse correctly. v11 failed on these — emitted bogus `CKP_Sensor_Ground_conductor_2_of_99_shielded_2C_cable_M130` source connector.
  3. Companion routing: wire IDs matching `^\d+[grs]$` look up the parent wire's destination device and route to it with a pin hint (`g`→GND, `r`→+5V, `s`→GND for shield drain). Sensor companion wires now consolidate onto the same `Crank_Position_Sensor` / `MAP_Sensor` / etc. connectors as their main signal wire, instead of creating separate `CKP_Sensor_Ground` ghost connectors. v13 hit `IAT_Sensor_Ground is not in connectors` WireViz error — fixed in v14 by applying the same companion-aware logic in the connection-emit loop.
- **Combined PDF rebuilt:** `K5_complete_wiring_diagram.pdf` (384 KB, 8 pages) now carries engine loom v14.
- **Engine loom completeness:** all 33 main wires + 22 sensor companions = 55 expected; renderer shows 52 (3 unmatched — likely the `INJ_PWR` / `COIL_PWR` / `COIL_GND` bus rails whose source/destination tokens don't yet match the source-pin regex). Followup: extend regex or accept these as known limitations.
- **Pin conflict A14 still flagged** in YAML header — unchanged from iter 8.

## 2026-05-17 — Iteration 9 (VIN correction propagated to all 7 looms + combined PDF)
- **Outputs (v4 across 6 looms + v10 engine + cover page):**
  - `K5_exterior___body_wireviz_v4.svg/.yaml` (27 wires, 161 KB)
  - `K5_interior___dash_wireviz_v4.svg/.yaml` (18 wires, 112 KB)
  - `K5_chassis___underbody_wireviz_v4.svg/.yaml` (12 wires, 78 KB)
  - `K5_audio_wireviz_v4.svg/.yaml` (13 wires, 82 KB)
  - `K5_power___comm_wireviz_v4.svg/.yaml` (4 wires, 24 KB)
  - `K5_misc_wireviz_v4.svg/.yaml` (16 wires, 101 KB)
  - `K5_cover_page.svg` — VIN line corrected
- **Combined PDF rebuilt:** `K5_complete_wiring_diagram.pdf` (384 KB, 8 pages) — now consistently shows `VIN CKR187F127263` across cover + all 7 looms.
- **Pin-conflict detector ran clean on the other 6 looms** — only the engine loom surfaced the M130:A14 conflict already identified iter 8.
- **`build_complete_pdf.sh` updated** to point at v10/v4 filenames.
- Side-channel quality MD from iter 8 was deleted (per Skylar's feedback that correction artifacts belong as field audit history in the DB, not as stacked .md files). Generator's YAML header comment is the only ephemeral surface for the A14 conflict — no persistent slop.

## 2026-05-17 — Iteration 8 (VIN correction + pin-conflict detector)
- **Output:** `K5_engine_loom_wireviz_v10.svg` (238 KB), `K5_engine_loom_wireviz_v10.yaml` (12.1 KB)
- **Quality report:** `K5_diagram_quality_report.md` (NEW) — central place to track substrate inconsistencies the diagram cannot resolve on its own.
- **Generator changes:**
  1. VIN in metadata: `CCL187Z210370` → **`CKR187F127263`** per Skylar's 2026-05-17 confirmation that vehicle_id `e08bf694-…` is canonical, not `e04bf9c5-…`. All future renders carry the corrected VIN.
  2. **Pin-conflict detector** added to `build_yaml()`. Counts source-pin assignments excluding (a) PDM30 outputs (legitimate fan-out — one channel feeds many loads) and (b) known shared returns (M130:B15, B16, A02, A09 — sensor 0V/5V rails). Any M130 input pin assigned to ≥2 signal wires is surfaced as a `!! SUBSTRATE INCONSISTENCY` block at the top of the YAML.
- **Conflict surfaced this iter:** `M130:A14` assigned to BOTH `#4c ETB TPS1 Signal` AND `#102 Oil Pressure Sensor (ECU)`. Connector schedule says A14 is UNUSED — three-way disagreement. **Status: OPEN.** Resolution needs MoTeC pin map cross-check; logged in quality report with three possible fix paths.
- **Why this matters:** v1–v9 silently rendered the conflict because WireViz happily draws both connections. Future renders now have a header banner alerting the reader. Substrate fix not applied inline (wiring-receipt-rule: surface, don't silently fix).
- **Loop status:** still inside docs/wiring/output/. Generator + cut list + new quality report only. No receipts overwritten, no K5_WIRING_STATE.md touched.

## Parallel: ignition switch research (background agent, completed mid-iter 8)
- Receipt `2026-05-17_ignition-switch-trq-swa77344-research.md` (outside output/) confirms TRQ SWA77344 = correct 9-pin K5 column ignition switch; SMP US-14 was wrong (Jeep CJ part). The 9 pins are NOT PRNDL — PRNDL gating is mechanical in 1977. 6L80E reports PRNDL via CAN through internal TCM.
- **Impact on diagram loop:** when INTERIOR/DASH loom regenerates (#40 wire), the connector type should switch from generic to "9-blade column ignition — TRQ SWA77344 (mates GM 1990084 column)". Deferred — substrate edit needed first in K5_cut_list_v2.txt / K5_connector_shopping_list.txt before re-render.

## **READY FOR REVIEW**

The diagram is at the state Dave can react to. Every wire in `K5_cut_list_v2.txt` is rendered. Cover page identifies the build, names the gaps. The structural and substrate work is done; further iteration requires:
- Physical measurement of L01-L30 landmarks on the vehicle (populate `K5_landmarks.yaml`)
- Architectural decision on companion wires (pigtail-bundled vs separate cut list IDs)
- Vendor doc lookup for non-engine connector PNs
- Dave's review feedback on what to fix structurally

Stopping the auto-iterate loop here. Skylar opens `K5_complete_wiring_diagram.pdf`, reads `LOOP_LOG.md`, decides next move.

## 2026-05-14 — Iteration 6 (Title-block metadata on every page)
- **Outputs (7/7 looms, all v7/v3/v2):**
  - `K5_engine_loom_wireviz_v7.svg`
  - `K5_exterior___body_wireviz_v3.svg`
  - `K5_interior___dash_wireviz_v3.svg`
  - `K5_chassis___underbody_wireviz_v3.svg`
  - `K5_audio_wireviz_v2.svg`
  - `K5_power___comm_wireviz_v3.svg`
  - `K5_misc_wireviz_v2.svg`
- **Combined PDF rebuilt:** `K5_complete_wiring_diagram.pdf` (256 KB, 7 pages) — `build_complete_pdf.sh` updated.
- **Change:** every page now has a WireViz `metadata` block — title (loom name), part number (K5-<loom-slug>), description (vehicle ID + VIN + ECU + PDM + wire count + spec tier + builder + wiring sub + generation date), revision tag. `options` block sets font and color mode. Dave can pick up any page and know what he's looking at without context.
- **Title text:** "1977 Chevrolet K5 Blazer · VIN CCL187Z210370 · LS3 6.2L · MoTeC M130 + PDM30. {N} wires from K5_cut_list_v2.txt. Wire spec: M22759/32 Tefzel (Pro tier). Builder: NUKE LTD. Wiring: Desert Performance."

## 2026-05-14 — Iteration 5 (COMBINED MULTI-PAGE PDF)
- **Output:** `K5_complete_wiring_diagram.pdf` (265 KB, 7 pages, one per loom)
- **Toolchain:** `rsvg-convert` (SVG → PDF per loom) + `pdfunite` (concat). Both via homebrew.
- **Reproducible:** `build_complete_pdf.sh` — re-run after regenerating any loom YAML.
- **Page order:** Engine → Exterior/Body → Interior/Dash → Chassis/Underbody → Audio → Power/Comm → Misc.
- **This is the canonical Dave-shippable deliverable.** Every wire in `K5_cut_list_v2.txt` is in this PDF, with real connector PNs where they exist in `K5_connector_shopping_list.txt` and "(PN unknown)" elsewhere. No invented data.

## 2026-05-14 — Iteration 4 (ALL 7 LOOMS RENDERING — full build coverage)
- **Outputs (7/7 looms, ~123 wires total):**
  - `K5_engine_loom_wireviz_v6.svg` (230 KB, 33 wires)
  - `K5_exterior___body_wireviz_v2.svg` (159 KB, 27 wires)
  - `K5_interior___dash_wireviz_v2.svg` (112 KB, 18 wires)
  - `K5_chassis___underbody_wireviz_v2.svg` (77 KB, 12 wires)
  - `K5_audio_wireviz.svg` (81 KB, 13 wires) — NEW
  - `K5_power___comm_wireviz_v2.svg` (25 KB, 4 wires)
  - `K5_misc_wireviz.svg` (100 KB, 16 wires) — NEW
- **Generator fixes:**
  - **AUDIO consolidation:** `AMP CH1+`, `CH1-`, `CH2+`/`-`, ..., `SUB+`/`-` all consolidate to a single `AMP` connector with pins `CH1p, CH1n, CH2p, CH2n, ..., SUBp, SUBn`. Speaker destinations consolidated too: `Speaker Front Left (+)` and `(-)` become one `Speaker_Front_Left` connector with 2 pins. Subwoofer similarly.
  - **Source/dest collision:** wires that go from `ECU` and ALSO label themselves `ECU` (e.g. #60) created duplicate YAML keys. Destinations whose `safe_id` matches a source ID now get a `_TARGET` suffix.
  - **Special char pin labels:** + and - characters in pin names converted to p / n suffix (e.g. `AMP:CH1+` → connector AMP pin `CH1p`).
- **Milestone:** every wire in K5_cut_list_v2.txt now renders through the WireViz pipeline. The 1-loom baseline from iter 0 is now full build coverage.
- **Next priorities (deferred):**
  - Combine all 7 looms into a single multi-page PDF
  - Quality pass on wire labels (add wire IDs visible on each cable)
  - Address the systemic cut-list gap: missing companion ground/power wires for analog sensors, coils, injectors
  - Length unit declaration (currently bare numbers; WireViz default may be meters not feet)

## 2026-05-14 — Iteration 3 (multi-loom expansion + numeric pin fix)
- **Outputs (5 looms rendered):**
  - `K5_engine_loom_wireviz_v5.svg` (230 KB, 33 wires)
  - `K5_exterior___body_wireviz.svg` (159 KB, 27 wires) — NEW
  - `K5_interior___dash_wireviz.svg` (112 KB, 18 wires) — NEW
  - `K5_chassis___underbody_wireviz.svg` (77 KB, 12 wires) — NEW
  - `K5_power___comm_wireviz.svg` (25 KB, 4 wires) — NEW
- **Generator fix:** numeric pin labels (e.g. ECU pin "33") were emitted as bare integers, then as digit-only strings — both crashed WireViz. Now prefixed with `P` (P33, P39, P40, etc.) when all-digit. The fix preserved engine loom output (v5 == v4 byte-identical).
- **Coverage:** 5/7 looms × ~94 wires now rendered as canonical WireViz diagrams. Previously: 1/7 loom × 33 wires.
- **Failed (deferred to iter 4):**
  - **AUDIO:** `AMP CH1+`, `AMP CH1-`, `AMP CH2+` etc. all collapse to the same safe-id (`AMP_CH1`, `AMP_CH2`) — WireViz drops the duplicate. Fix: consolidate AMP_CHN+/- pairs into one AMP connector with pins `CH1p, CH1n, CH2p, CH2n`.
  - **MISC:** "ECU" appears as both source connector AND destination device (wires self-referencing ECU) — key collision drops one. Fix: append `_T` suffix to destination IDs when they collide with source IDs.

## 2026-05-13 — Iteration 2 (shielded sensor cables)
- **Output:** `K5_engine_loom_wireviz_v3.svg` (230 KB, 1,186 elements; +228 vs v2)
- **YAML:** `K5_engine_loom_wireviz_v3.yaml`
- **Changes:**
  - Crank (#99), Cam (#101), Knock B1 (#103), Knock B2 (#104) now render as 2-conductor shielded cables with `shield: true` and visible drain. Colors: WH (signal) + BK (ground) per M27500 convention. Note in each cable's notes explains the cut list color (e.g. "BLU/WHT") is a bundle ID not a wire color.
  - CAN twisted pair (#62) marked `wirecount: 2`, colors WH/GN per ISO 11898.
  - 22 AWG M27500-style designation added in cable notes for shielded.
- **Known gaps (deferred):**
  - Conductor 2 of shielded cables not connected to anything (cut list has only 1 entry per shielded wire — the second conductor's destination not enumerated)
  - Length unit may be wrong — feet passed without `length_unit` declaration; WireViz default may be meters

## 2026-05-13 — Iteration 1 (real connector PNs)
- **Output:** `K5_engine_loom_wireviz_v2.svg` (218 KB)
- **YAML:** `K5_engine_loom_wireviz_v2.yaml`
- **Scope:** ENGINE LOOM (33 wires)
- **Changes:**
  - Source connectors (M130:A, M130:B, PDM30) now type as "MoTeC Superseal" with MoTeC #65044 reference where applicable
  - Destination connectors lookup against `K5_connector_shopping_list.txt` — coils, injectors, crank, cam, knock, CTS, OPS, ETB, MAP all now show real PNs + pigtail (WPCOL40, WPINJ40, WPCKP40, etc.)
  - Destination pinlabels are real (+12V, GND, SIG, +5V, MotorA/MotorB/TPS1/TPS2, etc.) instead of P1/P2/Pn
  - ETB wires map to MotorA/MotorB/TPS1/TPS2/+5V/GND by label keyword
  - Each cylinder coil and injector is its own destination connector (8 separate Coil_1..8, 8 separate Injector_1..8) instead of one grouped node
- **Known gaps surfaced (not fixed this iter):**
  - Cut list under-enumerates: coils need +12V power + ground + IGBT control wires not in cut list (only signal shown)
  - Same for injectors: power wire (+12V) not in cut list, only control
  - Analog sensors (CTS, MAP, OPS, IAT, OTS, FPS) missing ground returns + 5V references (where applicable) in cut list
  - IAT, Oil Temp, Fuel Pressure connector PNs all "TBD" in shopping list — couldn't cite
