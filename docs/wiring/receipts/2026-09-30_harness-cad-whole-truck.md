---
id: 2026-09-30_harness-cad-whole-truck
change_type: research
scope: docs/wiring/twin/{harness_cad,harness_graph,harness_full,margins_v4,export_twin_meshes,build_harness_v4,label_v4}.py (new); docs/wiring/calc-data/cad/ (new: margins.yaml, parts.yaml, routes.yaml, routes.json, scene_v4.json, part_colors.json, positions_v3.json, HANDOFF.md)
author: claude-opus-5-5 (harness-cad lane, session ebc425ad)
owner_words: "illuminating the wiring system by changing the opacity of the other subjects" / no "incorrect size wires and random arbitrary dots ... go towards CAD" / "figure out your margin of error ... by actually knowing the vehicle" (2026-09-29)
---

# The K5 harness in CAD: parts placed, looms sized from their wires, rules checked (work in progress)

## What changed
- `margins.yaml` compares published dimensions with the twin: the 1988 frame and body sheet, the 1977 LTSM, and the
  Mitchell engine compartment. Each row has its source, delta and verdict. Each zone gets a working tolerance.
  - Frame: ±5 mm.
  - Body shell: ±15 mm.
  - Firewall: ±100 mm, inconclusive until tapes T-14, T-05 and T-06.
- `parts.yaml` places all 142 physical ends at their sourced spots (or a proposed one, with its reason) and records
  size, colour, model and checks for each.
  - Model tiers: parts-lane CAD, sourced stand-in, twin object, or dashed (size not sourced).
  - Checks per part: body interference against the twin, overlaps, exhaust clearance, and the spare-tire carrier.
- `harness_graph.py` defines channels along the structure. Wires cross zones only at the 61-pin, H3 (the exception) and
  the round floor pass-throughs.
  - Structure followed: inner-fender edges, core support, cowl seam, the firewall's cab face above the toe board, dash
    crossbar, sill, door hinges, rear floor edge, and the frame rails' outboard web (from the probed rail profile).
- `harness_full.py` routes every registry wire over those channels. Each channel is sized from its wires with
  `sqrt(sum d^2 / 0.65)`, taking ODs from the ProWire tables.
  - Routes are filleted to AC 43.13-1B 11-96 aa.
  - Clamps are spaced per ABYC E-11: 18 in, and 12 in near heat.
  - Rule checks: the exhaust at 1 in (objectTraits), the fan and belt at 25 mm, no DC over the intake, nothing under
    the pan, the firewall crossings, service loops and clamps.
  - Output: `routes.yaml` (the per-loom audit) and `routes.json` (the layout page).

## Counts (this run)
- **Parts:** 146 in all.
  - 5 parts-lane models: M130-A, PDM30-A, ODYSSEY, ACC-BATT, DCDC.
  - 18 sourced stand-ins.
  - 20 twin objects.
  - 101 dashed.
- **Route checks:** 1886 pass, 0 fail, 2 exceptions (H3), 6 flags.
  - 96 more are "not run": the exhaust route aft of y −1.07 is unknown.
- **Wires:**
  - 0 unrouted.
  - 13 re-homed to the other PDM.
  - 13 open (see below).
  - 4 through H3.
  - 28 registry rows have no endpoints.

## Owner decisions this depends on (not made here)
- **The 13 open wires need a new home.** They are the floor dimmer to the headlights, the wiper switch leads, the blower
  switch leads and the isolator's dash switch.
  - They used the retired bulkheads A/B. The 61-pin already holds 58 of its 61 contacts.
  - A denser insert won't help: shell 25 tops out at 25-61's 61 × #20, and a #20 contact does not take 16/18 AWG
    (MILNEC D38999 catalog p.B-19).
  - The choice between a re-home over CAN and a second round connector is Skylar's and Dave's.
- The M130/PDM30 placement, the battery corner, the bay box model (PDM32 proposed) and the H3 exception all remain open
  (mounts.yaml).

## Unknowns (marked in the files, not guessed)
- The real firewall line against the twin (T-14/T-05/T-06), the under-dash space (T-04), the rear double wall (T-07), and
  the exhaust route aft of y −1.07.
- 101 part sizes.
- The DC-DC and amp terminal spots on their cases.
- Whether the boots are straight or 90° (the parts lane holds this).
- All lengths are twin paths, not tape.

## Not in this commit
The renders, the GLBs, the .blend, the mesh exports and anything from the licensed body model.
