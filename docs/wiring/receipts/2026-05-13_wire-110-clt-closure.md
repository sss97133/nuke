---
id: 2026-05-13_wire-110-clt-closure
date: 2026-05-13
change_type: wire_closure
wire_id: "110"
status: PARTIAL — closed where data exists, gaps surfaced
amends: none
---

# Wire #110 — Coolant Temp Sensor (ECU) → M130:B04

First end-to-end wire closure exercise. Pattern: every field cited to a source doc, line number, or measurement record. Anything not citable is flagged `UNKNOWN — needs <action>`.

## Identity

| Field | Value | Source |
|---|---|---|
| Circuit ID | #110 | `K5_cut_list_v2.txt` line 40 |
| Label | "Coolant Temp Sensor (ECU)" | `K5_cut_list_v2.txt` |
| Function | Engine coolant temperature signal to ECU | derived from label + signal type |
| Loom bundle | B3-Front | `K5_harness_build_sheets.md` line 58 |
| Loom section in cut list | ENGINE LOOM | `K5_cut_list_v2.txt` section header |

## Endpoints

**FROM (ECU side):**
| Field | Value | Source |
|---|---|---|
| Device | MoTeC M130 ECU | locked in `K5_WIRING_STATE.md` §1 |
| Connector | M130 Connector B (Superseal 26-pin) | `K5_connector_schedule.txt` line 33 |
| Pin | B04 | `K5_cut_list_v2.txt`, `K5_shopping_list.md`, `K5_harness_build_sheets.md` (3 corroborating sources) |
| Pin function | AN_TEMP3 (Analog Temperature input 3) — CLT | `K5_connector_shopping_list.txt` line 38; `chapters/appendix-g-diagram-requirements-spec.md` line 889 ("CLT B04"); `K5_wire_spec_and_costs.md` Job 1 (M130 has 4 AT inputs on B03-B06) |
| Signal characteristics | 1KΩ internal pull-up to 5V, designed for NTC thermistor | `K5_wire_spec_and_costs.md` Job 1 |

**TO (sensor side):**
| Field | Value | Source |
|---|---|---|
| Device | GM CLT sensor (PN 19236568) | `K5_shopping_list.md` line 33 |
| Sensor type | NTC thermistor, 2-pin Metri-Pack sealed | `K5_shopping_list.md` line 33 |
| Sensor mount location | LS3 driver-side cylinder head (typical location, e.g. front coolant crossover or head boss) | **UNKNOWN — not in any cited doc.** `K5_wire_labels.md` line 80 says "Front of engine" but no specific boss. Needs LS3 service manual citation or measurement. |
| Pigtail PN | WPCTS30 (ICT Billet) | `K5_shopping_list.md` line 33 |
| Pigtail price | $10 | `K5_shopping_list.md` line 33 |

## Wire spec

| Field | Value | Source |
|---|---|---|
| Gauge | 22 AWG | `K5_cut_list_v2.txt` line 40 |
| Wire spec | M22759/32 Tefzel | `K5_cut_list_v2.txt` (post-Tefzel amendment 2026-05-11) |
| Color | TAN/WHT | `K5_cut_list_v2.txt`; `K5_wire_labels.md` line 80 |
| Color derivation | Function-group convention: temp sensors = TAN base color (cut list uses TAN, TAN/WHT, TAN/BLK for temp circuits #109/#110/#113) | inferred from pattern, not cited |
| Estimated length | 4.6 ft baseline → 5.5 ft with 20% engine bay pad | `K5_cut_list_v2.txt`; `K5_wire_formboard_cuts.csv` line 33 |
| Shielding | NO (analog_temp does not require shielding; only crank/cam/knock do) | `chapters/05-build-manifest.md` §"ECU-Connected Signal Types" |
| Voltage drop concern | None — AT input is high-impedance (no current draw) | `chapters/06-compute-engine.md` wire spec rules |

## Routing path

| Landmark | Description | Distance |
|---|---|---|
| L01 | M130 → FWG-MAIN (firewall grommet, main) | **UNKNOWN — not measured** (`K5_landmarks.yaml` line 16, value is `~`) |
| L02 | FWG-MAIN → intake valley junction | **UNKNOWN — not measured** (`K5_landmarks.yaml` line 17) |
| L03 | Intake valley junction → Cyl 1 coil (DVC front) | **UNKNOWN — not measured** (`K5_landmarks.yaml` line 18) |

Source: `K5_wire_paths.yaml` line 6 — `"110": path: [L01, L02, L03]`

**Routing issue:** path terminates at "Cyl 1 coil (DVC front)" landmark, but actual CTS sensor location is on the cylinder head (front of engine, driver side). L03 is approximate — it puts the wire end in the general front-driver area but not at the specific CTS boss. Either L03 needs redefining or a CTS-specific landmark needs adding to `K5_landmarks.yaml`.

**Length status:** the 4.6 ft figure in the cut list is an ESTIMATE (probably from `harnessConstants.ts` typical zone distance), NOT a measured value. The landmark table is canonical for real length, and every entry is null.

## Termination

**ECU side (M130:B04):**
| Field | Value | Source |
|---|---|---|
| Connector type | MoTeC Superseal 1.0 26-pin | `K5_connector_schedule.txt` line 33 (header), `chapters/appendix-d-k5-build.md` |
| Cavity | B04 | (above) |
| Terminal PN | **UNKNOWN — needs MoTeC datasheet citation** | — |
| Seal PN | **UNKNOWN — needs MoTeC datasheet citation** | — |
| Crimp tool | **UNKNOWN — depends on terminal PN** | — |

**Sensor side:**
| Field | Value | Source |
|---|---|---|
| Connector type | Metri-Pack 150.2 series, 2-pin, sealed | `K5_shopping_list.md` (Metri-Pack 2-pin sealed) — inferred series from GM CLT standard |
| Terminal PN | Female Metri-Pack 150.2 terminals (need PN) | **UNKNOWN — specific Delphi/Aptiv PN needed** |
| Seal PN | Green cable seal (Delphi 15324982 or equivalent) | **UNKNOWN — needs verification** |
| Crimp tool | Metri-Pack 150 series crimper (Delphi 15310879 or generic 14-22 AWG) | **UNKNOWN — needs verification** |
| Pigtail included? | YES — WPCTS30 ICT Billet pigtail includes terminals + seals | `K5_shopping_list.md` line 33 |

If using the WPCTS30 pigtail, builder crimps and seals at the M130 end only; the sensor end is pre-terminated. This simplifies the terminal PN question on the sensor side.

## Sensor ground (companion wire)

`chapters/05-build-manifest.md` §"ECU-Connected Signal Types" specifies `analog_temp = 2 wires` (signal + ground). The cut list only enumerates the signal wire (#110). The expected ground return is:

- 22 AWG, from sensor Pin 2 → M130:B15 (SEN_0V_A) or B16 (SEN_0V_B)
- Color: BLK (sensor ground convention)
- Same length as signal (4.6 ft baseline)

**This second wire is NOT enumerated in `K5_cut_list_v2.txt`.** This is a real cut list gap — the analog_temp signal type's second wire is missing for #110 (and likely all other AT-type circuits: IAT #109, OTS #113, fuel pressure #112 if it's analog_5v).

NOTE: if the WPCTS30 pigtail is a 2-wire pigtail (signal + ground both terminated at the sensor side), then the cut list might be treating the ground wire as bundled-in. Need to verify pigtail specs.

## Fuse

- None. AT input is powered by M130's internal pull-up, no fuse required.
- This is consistent with `K5_pdm30_channel_plan.md` (sensor circuits do not appear in PDM channel list).

## Heat-shrink / labels

| Item | Status | Source |
|---|---|---|
| Wire label both ends | "COOLANT TEMP CLT 22" / "M130:B04 CLT 22" | `K5_wire_labels.md` line 80 |
| Heat-shrink locations along run | **UNKNOWN — no doc enumerates this** | gap |
| Label material | **UNKNOWN — probably Tyco/Raychem heat-shrink with printed text** | — |
| Boot at M130 connector | **UNKNOWN — DR-25 typical for motorsport-spec** | — |

## Open unknowns (the gaps that block 100% closure)

1. **Substrate inconsistency: `K5_connector_schedule.txt` line 50 lists B04 as UNUSED.** Already flagged in `K5_cross_reference_check.md` line 173. The cross-check doc is out of date; needs amendment to mark B04 as AN_TEMP3 / CLT.
2. **Sensor ground wire missing from cut list.** Either it's intentionally bundled with #110 via the pigtail (which the cut list doesn't say), or it's a real omission. Needs resolution.
3. **`K5_landmarks.yaml` L01, L02, L03 all null.** Real wire length cannot be computed; the 4.6 ft is a zone estimate.
4. **L03 destination is "Cyl 1 coil (DVC front)" not CLT location.** Routing path is approximate; needs either L03 redefinition or new CTS-specific landmark.
5. **CTS physical boss location on LS3 not cited.** "Front of engine" is too vague. Needs LS3 service manual page or measurement.
6. **MoTeC Superseal terminal PN unknown.** Required for the terminal order.
7. **Metri-Pack sensor-side terminal/seal PNs unknown** (only matters if NOT using pre-terminated pigtail).
8. **Heat-shrink locations along the run undocumented.**

## What "closed end-to-end" would mean for #110

Of the 14 fields a closed wire needs, **6 are cited and locked, 8 have gaps**:

| Field | Status |
|---|---|
| Circuit ID | ✓ |
| ECU pin & function | ✓ |
| Signal type & wire count rule | ✓ |
| Gauge & spec & color | ✓ |
| Shielding | ✓ |
| Fuse | ✓ (N/A) |
| Routing landmarks | ✗ (path defined, distances unmeasured) |
| Total length | ✗ (estimate, not measured) |
| Sensor PN | ✓ |
| Sensor physical location | ✗ (vague) |
| ECU terminal PN | ✗ |
| Sensor terminal PN | ✗ (pigtail covers it, but pigtail dual-wire confirmation needed) |
| Companion ground wire | ✗ (missing from cut list) |
| Heat-shrink locations | ✗ |

**This is the actual state.** One wire, partially closed, gaps surfaced. The pattern: **6/14 fields are real; 8/14 are gaps that the substrate hasn't yet captured.** If this ratio holds across the 123 wires, the build is roughly 43% specified.

## To make this wire fully closed

1. Update `K5_cross_reference_check.md` and `K5_connector_schedule.txt` to mark B04 as AN_TEMP3 / CLT (not UNUSED). (Substrate correction.)
2. Measure L01, L02, L03 on the actual vehicle. (Physical work.)
3. Decide if the sensor ground wire belongs in the cut list as a separate ID, or document the pigtail's 2-wire termination. (Architectural decision.)
4. Add an LS3-specific CTS boss landmark and re-route #110 through it. (Substrate addition.)
5. Cite the MoTeC Superseal terminal PN from the MoTeC datasheet. (Read M130 PDF.)
6. Confirm WPCTS30 pigtail terminates both pins (likely yes) — if so, sensor side is closed via pigtail purchase. (Vendor verification.)
7. Add heat-shrink location convention to the build sheet. (Decision needed.)

Estimated effort to close 100%: ~30 min of substrate updates + one tape-measure session on the truck for L01-L03.

## Implication for the rest of the build

The wire-closure ratio (6/14) is the unit of measure for the build's true completeness. The earlier "110 wires / 805 ft" appendix-d figure is real but every wire has gaps like this one. **The real KPI isn't wire count — it's closed-field count across all wires.** If we want to be 95% closed across 123 wires × 14 fields = 1,722 field cells, that's the work scope.

## What I'm NOT going to do

- Generate a similar receipt for #109, #112, #113 in the same turn. (One wire end-to-end was the task.)
- Speculate on the MoTeC terminal PN. (Read the PDF or don't write it.)
- Pick the LS3 CTS boss location from training data. (Cite or stop.)
