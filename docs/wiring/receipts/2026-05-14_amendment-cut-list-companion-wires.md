---
id: 2026-05-14_amendment-cut-list-companion-wires
date: 2026-05-14
change_type: substrate_amendment
scope: docs/wiring/output/K5_cut_list_v2.txt
status: APPLIED
amends: 2026-05-14_decision-companion-ground-wires (proposal accepted by Skylar "ok yeah do all")
---

# Cut list amended — 22 companion wires added per Option B

## Decision applied

Skylar accepted Option B from `2026-05-14_decision-companion-ground-wires.md` and extended the scope to cover injector and coil power feeds as raised in `2026-05-14_wire-13-injector1-closure.json` substrate_inconsistencies. Companion wires are now enumerated with the naming convention:

- `Ng` — ground return for signal wire `N`
- `Nr` — 5V reference companion for signal wire `N` (analog_5v sensors only)
- `Ns` — shield drain for shielded signal wire `N`
- `INJ_PWR`, `COIL_PWR`, `COIL_GND` — bus rails (not parented to a specific signal wire)

## Wires added (22 total)

### analog_temp companion grounds (3 wires)
- `#109g` — IAT ground → M130:B15 (SEN_0V_A, paired with AT1 pullup to SEN_5V_A per p17)
- `#110g` — CLT ground → M130:B16 (SEN_0V_B, paired with AT2 pullup to SEN_5V_B per p17)
- `#113g` — OTS ground → M130:B15 (SEN_0V_A, paired with AT3 pullup to SEN_5V_A per p17)

### analog_5v companion grounds + 5V refs (6 wires)
- `#102g`, `#102r` — Oil Pressure Sensor (ground + 5V ref)
- `#108g`, `#108r` — MAP Sensor (ground + 5V ref)
- `#112g`, `#112r` — Fuel Pressure Sensor (ground + 5V ref)

5V ref pairing follows the AT convention extended to AV: SEN_5V_A (M130:A02) used for sensors whose ground goes to SEN_0V_A; SEN_5V_B (M130:A09) used for sensors whose ground goes to SEN_0V_B. This is convention-based — the M130 PDF doesn't enforce strict pairing for AV inputs.

### ecu_crank_cam shielded companions (6 wires)
- `#99g`, `#99r`, `#99s` — CKP companion ground (conductor 2 of shielded 2C cable), 5V reference, shield drain
- `#101g`, `#101r`, `#101s` — CMP companion ground, 5V reference, shield drain

The shielded 2C cable physically has 2 conductors plus a foil/braid shield. Conductor 1 is the signal (#99/#101). Conductor 2 is the ground return — assigned `Ng` even though it's bundled in the same cable. The shield drain wire is `Ns`. All three trace into the same cable jacket but are 3 distinct conductors that need separate terminations at the M130 end.

### piezoelectric knock companions (4 wires)
- `#103g`, `#103s` — Knock Bank 1 ground (conductor 2) + shield drain
- `#104g`, `#104s` — Knock Bank 2 ground (conductor 2) + shield drain

Knock sensors are 2-pin (signal + ground) with no 5V supply — no `Nr` wire.

### power rails (3 wires)
- `#INJ_PWR` — Injector +12V rail (16 AWG RED, from PDM30 to fuel-rail injector daisy-chain start)
- `#COIL_PWR` — Coil +12V rail (14 AWG RED, from PDM30 to DEL-Stributor bracket)
- `#COIL_GND` — Coil ground rail (14 AWG BLK, from bracket to engine block ground stud)

For coils, each D510C is 4-pin (+12V, GND1, SIG, GND2). The cut list signal wires (#5, #7, #8, #9, #10, #11, #12, #24) cover SIG. The companion rails cover +12V (#COIL_PWR) and the ground bus (#COIL_GND). The "GND2" (IGBT/tach ground) is a secondary ground typically jumpered at the bracket — not enumerated separately.

For injectors, each WPINJ40 is 2-pin (+12V, ECU_LS). Signal wires (#13-#20) cover ECU_LS. `#INJ_PWR` is the +12V rail; daisy-chained at the fuel rail via the pigtails.

## Updated totals

- Wires before: 123
- Wires added: 22
- **Wires after: 145**
- KPI denominator: 145 × 14 fields = **2,030 cells** (up from 1,722)

The first 3 closure receipts (#110, #109, #13) will be amended in follow-up edits to cite the new companion wire IDs instead of leaving them as `unknown — needs architectural decision`.

## What this doesn't do

- **PDM channel assignments for `#INJ_PWR` and `#COIL_PWR` / `#COIL_GND` are still TBD.** `K5_pdm30_channel_plan.md` needs review to identify the correct PDM30 channels.
- **WireViz YAML / SVG regeneration deferred.** The generator currently doesn't render the addendum section. Adding companion wires to the diagram is a separate task — the generator needs to know how to bundle a signal wire with its `g`/`r`/`s` companions in the same cable group.
- **`chapters/05-build-manifest.md` convention documentation** — pending separate edit to chapter 5 noting the `g/r/s` suffix system.
- **Existing closure receipts** still cite the `unknown` for their companion wires — pending follow-up edit.

## Authoritative sources for the new wire IDs

- AT pullup pairing → SEN_0V termination: `motec_m1_hardware_techspec.pdf` p17 (M130 Connector B pinout, "1k Pull up to SEN_5V_A/B" column)
- Signal type wire counts: `chapters/05-build-manifest.md` §"ECU-Connected Signal Types"
- Pigtail PNs supplying both sensor terminations: `K5_connector_shopping_list.txt`
- ETB precedent (already enumerates 6 wires for all 6 pins): `K5_cut_list_v2.txt:10-15`

## Status of substrate_inconsistencies in existing receipts

After this amendment:
- `2026-05-13_wire-110-clt-closure.json` substrate_inconsistencies[1] ("analog_temp = 2 wires but cut list has 1") → **RESOLVED** by adding #110g
- `2026-05-14_wire-109-iat-closure.json` substrate_inconsistencies[1] (same pattern) → **RESOLVED** by adding #109g
- `2026-05-14_wire-13-injector1-closure.json` substrate_inconsistencies[0] ("low_side_drive = 2 wires") → **PARTIALLY RESOLVED** by adding #INJ_PWR (PDM channel still TBD)
