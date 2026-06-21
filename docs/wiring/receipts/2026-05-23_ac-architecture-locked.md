---
date: 2026-05-23
change_type: architectural_decision
scope: K5 air conditioning subsystem
amends: null
---

# K5 AC architecture — locked decisions

## What changed

Air conditioning architecture moves from open-question into locked-decision territory after a conversation with Skylar on 2026-05-23. Factory K5 Four-Season Air Conditioning is retained as the visual chassis; internals upgraded; control logic moves to MoTeC M130 + PDM channels and deletes the 1977 amplifier board.

## Decisions locked

| Decision | Source / citation |
|---|---|
| **Factory K5 Four-Season housing retained** — firewall-mounted blower+evaporator assembly + underdash heater distributor + control head/vents stay as visible chassis | 1977 Light Truck Service Manual pp. 47-50, 56, 83-84; Skylar verbal 2026-05-23 |
| **AC control logic = M130 + PDM, NOT factory amplifier board** — evap thermistor → M130 analog input; trinary pressure switch → M130 digital inputs; PDM channel switches compressor clutch; PDM channel switches condenser fan | Skylar verbal 2026-05-23 ("I approve of the Motec-driven control logic") |
| **R134a refrigerant** (not R12) | Standard for any modern retrofit; Sanden SD7H15 datasheet — system already locked to R134a-compatible compressor via Holley 20-185 mid-mount |
| **Hidden performance upgrade slate approved** — parallel-flow aluminum condenser, electric condenser fan (SPAL or equivalent), parallel-flow microchannel evap core if fits factory housing, TXV or VOV in place of factory orifice tube, fresh HNBR drier, barrier hose + HNBR seals throughout, trinary pressure switch | Skylar verbal 2026-05-23 ("I really like your approach we need to start seeing the parts list") |
| **Insulation: COMPLETE** — Lizard Skin / Hushmat-class treatment on roof, firewall, floor already done. Do NOT spec insulation in any future build sheets — it is finished work, not open work | Skylar verbal 2026-05-23 ("I've already insulated the vehicle"); confirm via K5 vehicle photos (vehicle_id `e08bf694-970f-4cbe-8a74-8715158a0f2e`) |

## Sub-decisions still open

1. **Blower control path** — factory 3-speed rotary + resistor pack (zero PDM channels, factory aesthetic) vs. brushless PWM blower via PDM channel (better airflow, lose factory rotary feel). Pending Skylar input.
2. **PDM topology** — single PDM30 (current locked spec, 200A bus, 30/30 channels per appendix-d, no headroom for AC) vs. dual PDM15 (400A total bus, distributed engine-bay + cabin, adds AC channels without consolidation). Skylar raised dual-PDM15 advantage 2026-05-23; not yet locked.
3. **PDM physical location** — asserted "under dash passenger" in §4 conflicts with factory underdash heater distributor + mode doors + ducting. Needs physical measurement.
4. **M130 physical location** — asserted "passenger firewall, centered vertically" in §4 conflicts with engine-bay-side factory blower+evap assembly. Needs physical measurement; likely candidates are driver firewall, passenger kick panel (cabin-side), driver kick panel.

## Open measurement targets (vision)

- Factory K5 Four-Season blower+evap assembly footprint on engine-bay side of firewall
- Factory K5 underdash heater distributor assembly footprint
- Sources: K5 vehicle photos in `vehicle_images` for vehicle_id `e08bf694-970f-4cbe-8a74-8715158a0f2e`; service manual schematic pp. 49-50 may have scale info
- Process: DeepSeek vision on photo + known-reference scale → footprint polygon → feed into M130/PDM placement decision

## Open parts research

Spawned parts-research agent 2026-05-23 to source specific PNs + prices + product images for:
- Parallel-flow condenser sized for K5 envelope
- SPAL 16" pusher fan
- Trinary pressure switch
- R134a/HNBR receiver-drier with sight glass
- VOV and TXV options
- Microchannel evap core for factory housing
- Barrier hose + fittings kit
- HNBR o-ring kit
- Optional PWM blower motor
- Optional cabin temp sensor

Results to be filed into `K5_shopping_list.md` once received.

## What this does NOT change

- Wire spec (Tefzel only — locked 2026-05-11)
- ECU choice (M130 — locked, derived per chapter 06)
- Compressor (Sanden SD7 via Holley 20-185 — locked)
- Connector deferral (no PNs proposed until after formboard — locked 2026-05-11)

## Cited substrate

- `docs/wiring/K5_WIRING_STATE.md` (this update amends §1 locked decisions; §3 open questions #4 still active pending PDM topology resolution; §4 unknowns for M130 + PDM placement remain)
- `reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf` pp. 47-50, 56, 58, 60, 83-84
- `reference_documents/component_drawings/Sanden_SD7_Service_Manual.pdf` p.32 (electric fan recommendation for retrofits in hot climates)
- `reference_documents/component_drawings/Holley_20-185_Mid_Mount_Install_Guide.pdf` (locked accessory drive)
