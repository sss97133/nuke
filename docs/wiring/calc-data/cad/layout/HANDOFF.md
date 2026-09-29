# Pieces lane handoff (2026-09-29, stopped at the usage limit)

The pieces lane places every K5 harness end, checks each part and each other lane's work against its sources, and
publishes the results for Skylar. This folder keeps the scripts that were only in a session scratchpad: the ends list,
the world positions, the true-size footprints, the layout-page data builder and the parts-library page builder.
Paths inside them are local (the session scratchpad, ~/k5-harness-pull); re-point them before running.

## What's done
- **Ends.** `ends.py` writes the `ends:` list in `docs/wiring/calc-data/catalog/mounts.yaml`: 178 ends, each with a
  status and sources. `pos.py` gives each end a world position (metres, +x driver, -y forward, +z up) with its basis,
  written to `positions.json`.
- **Pages.** The layout page is now owned by layout-ui; it copies these files on every build.
  - K5 Harness Layout: https://claude.ai/artifact/QVLCDvWkF2XJ6DABBodakh
  - K5 Parts Library (six parts in 3D, pin by pin, from `parts_library_build.py`): https://claude.ai/artifact/Uc2jqtPXMJGnS2sehMZRha
  - M130 sample review: https://claude.ai/artifact/QRPb6gWysP14kFNgTLCBFF
  - Engine bay sample in 3D: https://claude.ai/artifact/UhYPPsjVRc1c5PjTKBP9Lf
- **Audited and passed.** Every claim sampled matched its saved source:
  - PRs #413, #416, #417, #420, #421, #422, #423, #426, #428, #430 and #431;
  - harness-cad's bay sample;
  - the parts-library parts: all pin names and wires checked.
- **Found and escalated.**
  - The API key in the public engine-bay GLB (PR #418).
  - The order numbers, amounts and buyer data in public wiring docs (main's redaction branch).
  - The Deutsch seal ranges against the M22759/32 wire diameters (state 0ai).
  - The 13 wires with no firewall crossing: no shell-25 insert has more than 61 size-20 contacts (MILNEC catalog p.B-19).

## The exact step in progress
Reconciling the 22 route landings that sit more than an end's margin from its `pos.py` position (layout-ui's list:
CKP 638 mm, MARKER-LF 514, M130-A 373, ODYSSEY 314, ISOLATOR 262-275, CLT-ECU 205-213, HL-SW 181, TG-SW-KEY 180,
headlights 59, and others). harness-cad was asked for its position and basis for each. Rule end by end: the
better-sourced position wins, then update `pos.py` and the ends map.

## Next actions
1. Finish the 22-landing reconciliation above.
2. Publish harness-cad's per-zone GLBs as they land, after checking each has no "blendermcp" or "api_key" strings.
3. After Skylar's verdict on the six sample parts, restart parts-artist on the rest of batch 1, biggest first.

## Waiting on Skylar
- His verdict on the parts samples.
- The tape items T-01 to T-04 at the fuse-box opening.
- Rotating the Sketchfab key.
- The 13-wire firewall decision, with Dave.
- The second-PDM decision.
- The coil part numbers.
- The questions batched in each lane's research file.
