---
id: 2026-09-29_where-each-box-goes
change_type: design_surface
scope: docs/wiring/calc-data/catalog/mounts.yaml, mounts_v5.py, nuke_frontend map panel + status bar
author: claude-opus-5-5 (night shift lead, session ebc425ad)
owner_words: "not sure where the ecu or pdms are suggested to be mounted" / "the body bulk head... not sure what that is" (2026-09-29 ~00:10 PT)
---

# Where each box goes (map panel) + the status bar stops contradicting the map

## What changed
- `calc-data/catalog/mounts.yaml`: 11 boxes (M130, PDM30, PDM15, LTCD, batteries, isolator, DC-DC, 61-pin,
  body pass-through, Dakota box, service ports). Each has a spot in plain words, a status
  (decided 3 · proposed 5 · needs you 1 · breaks a maker rule 2), reasons with sources, alternatives and open items.
- `calc-data/mounts_v5.py` → `nuke_frontend/public/wiring/k5-mounts.json`. The build fails when a reason has no source,
  when a status is outside the set, or when an open or flagged box lists neither what's open nor an alternative.
- Map, whole-truck view: a WHERE EACH BOX GOES list (click a box to see why, the alternatives and what's still open).
- Status bar on the MAP tab: the compute-wiring-overlay chips (ECU M150, 141 devices, 133 wires, $23,590) are hidden.
  They come from the April-era engine and contradict the typed rows the map reads. Other tabs keep them.

## Findings this surfaces (not applied to the registry; they need owner or builder calls)
1. **PDM15 in the engine bay breaks MoTeC's spec table.** The PDM15/PDM30 are magnesium cases with a conformally
   coated board only. The PDM16/PDM32 are the ones with a "rubber seal on lid and connectors" (MoTeC PDM manual p.35).
   Options: PDM15 in the cab beside the PDM30 (recommended), or a PDM16 in the bay (16 outputs, 12 inputs, 100 A,
   Autosport plugs; pp.35–36). Neither is bought (state 0k).
2. **The Victron Orion DC-DC in the engine bay breaks Victron's rule** ("never operate it in a wet environment";
   mount vertical, terminals down, 10 cm clear, never above the battery: manual safety section and §4.1).
3. **The battery corner conflicts with the Four-Season box**: the owner's working position (passenger firewall corner,
   state §4) is where the retained factory A/C box mounts (state §1 row 40). Asked 2026-09-29.
4. **LTCD placement rules** (LTC manual pp.4–5): as far from the exhaust as possible, 100 °C max ambient. The sensors
   go ≥ 1 m downstream of the ports, 10–90° from vertical tip-down, and their plugs are never cut. So the bungs and
   the box sit under the cab.
5. **Twin axis**: +x = driver (Steering_Wheel x +0.26..+0.67). twin_centers K5H_Battery (+0.65, driver) and
   K5H_Alternator (−0.30, passenger) are on the wrong sides. K5H_FWG_MAIN (y −2.90, z 1.9) is misplaced.

## Unknowns (stated on the panel, not guessed)
- What is behind the gold panel on the passenger firewall (decides the M130 plate).
- The LTCD's lead length (manual Appendix C drawing), the bung positions (exhaust not built).
- The exact spot of the firewall plate (after the A/C box and gold-panel answers).
