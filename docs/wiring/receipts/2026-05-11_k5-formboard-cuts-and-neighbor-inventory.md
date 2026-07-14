---
id: 2026-05-11_k5-formboard-cuts-and-neighbor-inventory
date: 2026-05-11
change_type: artifact_generation
scope: docs/wiring/output/
amends: none
---

# K5 wire form-board cut sheet + neighbor inventory request

## What was produced

Two new artifacts and one generator script in `docs/wiring/output/`:

- `K5_wire_formboard_cuts.csv` — 123 rows, one per wire. Columns: `id, section, label, from, spec, requested_color, available_color, remapped, base_length_ft, pad_pct, cut_length_ft, notes`. Each cut length = base × (1 + pad) rounded to 0.25 ft.
- `K5_wire_neighbor_inventory_request.md` — aggregated by (gauge × available_color), one section per gauge. Includes wire count, raw ft needed, and round-up purchase ft. Used as a checklist when inventorying the neighbor's MIL-spec stock.
- `generate_formboard_artifacts.py` — the parser/generator. Re-run to regenerate after any cut-list change.

## Inputs and citations

1. **`docs/wiring/output/K5_cut_list_v2.txt`** — the 123 canonical wires. Source of `label`, `from`, `spec`, `requested_color`, `base_length_ft`, `notes`.
2. **`docs/wiring/output/K5_wire_spec_and_costs.md`** — source of the 3-color-stripe remap table (M22759/32 only ships in solid + 2-color stripe). Specifically the "Three-Color Stripe Problem" section, remapping 7 (extended to 8) cut-list color codes to real ProWire SKUs.
3. **Tier decision** — Pro/Tefzel, confirmed by Skylar in this session 2026-05-11. Spec doc's Job 2 corroborates: "The cut list v2 header says 'TXL tier.' This is incorrect. The K5 build is Professional tier per Chapter 03."
4. **Length pad policy** — 15% global, 20% engine bay. Reason: route slack + terminal seating + redo headroom. This is an industry-standard cushion; not cited to a specific document. (Skylar approved 2026-05-11; if a different policy lands in HARNESS_RULES.md, regenerate.)

## Claims made

| Claim | Citation |
|---|---|
| 123 wires, 905.4 ft baseline | K5_cut_list_v2.txt header |
| Padded total: 1,049.5 ft | computed = sum(cut_length_ft) from CSV |
| 99 unique (gauge, color) SKUs after remap | computed; pre-remap was ~110 with non-existent 3-stripe codes |
| 3-color stripe codes don't exist in M22759/32 | K5_wire_spec_and_costs.md §"Three-Color Stripe Problem" |
| Engine bay = 20% pad, body = 15% | policy decision this session, not external citation |

## Color remap applied (per spec doc, extended)

| Cut list code | M22759/32 substitute | Wires affected |
|---|---|---|
| ORN/BLK/RED | ORN/RED | #50 |
| ORN/BLK/YEL | ORN/YEL | #54 |
| ORN/BLK/BLU | ORN/BLU | #51 |
| ORN/BLK/BLK | ORN/BLK | #3 |
| ORN/BLK/WHT | ORN/BRN | #2 |
| ORN/WHT/BLK | WHT/ORN | #30b |
| BLU/WHT/WHT | BLU/WHT | #99 (shielded — see unknown #3) |
| BLU/WHT/BLK | BLU/BLK | #101 (shielded — see unknown #3) |

Differentiation maintained via heat-shrink labels at both ends.

## Unknowns

Three open items that do not block form-board mockup but DO block finalizing the purchase order:

1. **Cut list v2 header says "TXL tier."** Spec doc says this is wrong and should read M22759/32 Tefzel (Pro). Cut list should be amended. Out of scope for this receipt — file a separate amendment receipt before regenerating.
2. **Neighbor inventory not yet captured.** Once Skylar walks through next door with `K5_wire_neighbor_inventory_request.md`, subtract his stock from the totals and emit a "gap-only" ProWire order list. That regeneration is a separate receipt.
3. **Shielded 2-conductor cable (22 AWG SHIELDED 2C) for crank/cam/knock sensors** — these are pre-assembled shielded cables (e.g. ProWire's M27500 series), NOT M22759/32 single-conductor. The "color" remap above applied the same logic but the SKU comes from a different catalog. Confirm SKU before ordering shielded.

## What this enables

- Skylar can print the CSV and start measuring/cutting on the form board with whatever Tefzel is available (his neighbor's stock + scrap).
- Each row carries the original cut-list ID so the build manifest can back-fill actual colors used at mockup time.
- Once neighbor inventory lands, the gap-only ProWire order can be generated in one pass with a new receipt.

## Not done

- No connectors, terminals, lugs, ring terminals, heat-shrink, loom, or fuse-block hardware specified. Per Skylar's instruction: copper only; end-connector definition happens after form-board layout.
- No SKU mapping to ProWire part numbers yet (M22759/32-AWG-COLORCODE). Deferred until color reassignment after mockup.
