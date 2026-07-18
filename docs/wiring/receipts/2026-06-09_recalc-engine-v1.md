# Receipt — k5_harness_calc.py: toggle-driven recalculation engine v1

**Date:** 2026-06-09 · **Change type:** tooling (Skylar directive: plug-and-play recalc, basics-first)

## What
`scripts/k5_harness_calc.py` + `docs/wiring/configs/*.toml` + `docs/wiring/calc-data/` (4-agent extraction: rules, ProWire index, PDM plan, 22-subsystem toggle map). Toggle subsystems → recalculates wires, footage, $, PDM loading + freed channels, nameplate load, trunk bundle ODs, gauge audit; `--diff` between configs.

## Rules used (all cited in source)
SERVER wiringCompute.ts gauge formula (×1.25, ≤3% of 12V, round trip ×2, AWG Ω/ft table); compute_wire_lengths.py allowances; VALIDATED PDM30 ratings 8×20A + 22×8A (MoTeC manual p39); ProWire catalog_parts snapshot pricing (1,248 SKUs, scrape 2026-05-11); subsystems.json from devices.json×cut-list-v3×wire-paths.

## Proof run (baseline → work-truck: audio/windows/locks/steps/camera OFF)
145→121 wires · 882.9→741.9 ft (−141) · $717→$495 (−$222) · PDM 30→22 channels, **frees OUT3/4/9/10/11/20/21/22** (kills the 0-headroom problem for AC) · DOOR_L trunk ⌀0.052"→0 · FW_JUMP ⌀0.553"→0.463".

## Findings the engine surfaced (need Skylar/Dave calls)
1. **41 wires fail the doctrine's own gauge rule** at nameplate amps — incl. all 16 coil/injector drives at 22 AWG (2026-05-14 audit downgraded them; formula at 4A peak says 18 AWG). **Policy needed: does ≤3% Vdrop apply at pulse peak or continuous duty for pulsed loads?** Also: fans 12→10/8, wiper 18→10, amp 8→4, AMP steps 18→10, window motors 16→10/12.
2. Extraction contradictions C1–C6 (calc-data/rules_extracted.md): no existing engine implements companion-wire expansion (undercounts 2–4×); client CAN rule wrongly forces M150; PDM ratings stale in 2 of 3 engines; M130 = 8 analog/7 digital (DOC-06 table stale); two conflicting PDM30 channel plans (2026-04-05 authoritative vs 2026-04-13 spec w/ PDM15); harness spec B02 double-assigned (CMP + backup camera).
3. Bundle-OD rule existed NOWHERE — engine introduces standard packing model (fill 0.65, M22759 nominal ODs flagged VERIFY vs ProWire pages).

## Limits (honest)
Wire registry = cut-list v3 IDs (not yet pure derivation from manifest); v3 still missing #114-126/#85ab/#86ab (prior receipt); gauge audit only where device-name↔wire-label resolves; prices = snapshot not live; "/32-00" gauge-family label cosmetic bug on 0 AWG rows.
