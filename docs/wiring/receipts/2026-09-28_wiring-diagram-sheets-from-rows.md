# Receipt: wiring diagram sheets drawn from the registry (GM booklet style)

- **Date:** 2026-09-28
- **Change type:** toolchain (`docs/wiring/calc-data/diagram_v5.py`) + manual pages 1-6 … 1-11
- **Follows:** `receipts/2026-09-28_options-capacity-readiness.md`
- **Ask (owner, 2026-09-28):** "should we consider looking at schematics?"; "my hope is if you say youre done, i can open
  your work like a pdf of a scanned 1977 repair manual ... just the 2.0 version where its click through and i see the
  actual parts"; "how does this go from chat to actual schematics and directions we use to actually build the harness."

## What exists already (not redrawn by hand again)
- `scripts/generate_schematic_pages.py` (2026-06-09): six sheets transcribed by hand from cut list v4 — stale (Holley T43
  era, v4 wires) and not data-driven; `output/K5_S2_*` engine sheets (2026-04) likewise. Kept as evidence.
- The GM reference: `reference_documents/wiring_diagram_booklets/ST_352_78_CK_Wiring.pdf` sheets A-1/A-2 (2448 × 836 pt
  foldouts): devices seen from the plug with cavity marks; wires as orthogonal runs labelled gauge colour-circuit
  ("18 BRN-9F"); in-line connectors as cavity strips; ground symbols; part numbers at the plugs.

## What was built
- `calc-data/diagram_v5.py` — draws sheets **from `k5_registry.json` rows only**: plug boxes with cavity marks and
  Dave's names, the 61-pin as a cavity strip ordered by where the runs arrive, cab computers with one row per pin
  (shared pins merged with a count), engine-bay junctions (rails, ground star, studs, engine PDM) in their own column
  below the bulkhead rows, runs in three channels (plug → junction, → bulkhead, bulkhead → computer). A wire end without
  a cavity draws dashed and is stamped OPEN; a run to a computer with no bulkhead cavity says so on the run.
  Book lint applies (no codes, no repo paths, no machine values). Tabloid landscape.
- Sheet plan (engine harness): 1-6 sensors · 1-7 coils · 1-8 injectors · 1-9 throttle body, engine PDM, charging, CAN ·
  1-10/1-11 front lamps, horn, wipers, blower, brake booster, fuel pump (engine side of the body harness). `build()`
  prints any engine plug on no sheet; today: none.
- `manual_v5.py` appends the sheets to `K5_Harness_Manual.pdf` and the contents page: 11 pages.

## Measured (2026-09-28)
| sheet | circuits | stamped OPEN |
|---|---|---|
| 1-6 engine sensors | 26 | 0 |
| 1-7 ignition coils | 32 | 0 |
| 1-8 fuel injectors | 16 | 0 |
| 1-9 throttle body, engine PDM, charging, CAN | 25 | 18 |
| 1-10, 1-11 front body devices on the engine side | 44 | 35 |

The OPEN counts are the data, not the drawing: the power-spine, A/C, isolator, battery and front-lamp plugs have no
device-side cavity in the registry yet (their ends are lugs, studs or unread plugs), so their rows print as ○ and their
labels stack on one row. Reading those plugs' pin tables (finish-line item 1a) is what clears them.

## Open (named close paths)
- Body-side sections (dash, body, lighting rear, powertrain) need their own sheet plans; the generator takes a column
  plan per section.
- Splices are drawn as junction rows, not as dots on the run the GM way; a splice symbol needs the splice position from
  the formboard.
- The app: the same SVGs with links from circuit numbers and plugs to the map cards (the "2.0" click-through).
