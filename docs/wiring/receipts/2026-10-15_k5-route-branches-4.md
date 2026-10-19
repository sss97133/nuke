---
id: 2026-10-15_k5-route-branches-4
change_type: substrate_correction
scope: docs/wiring/calc-data/catalog/route_branches.yaml (27 branches, 2 junctions added); docs/wiring/research/2026-10-15_route-branches-4.md (new)
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 44: the engine's rear trunks, so routes stop going round the front

**Gap (live as anon, 23:12Z, after pass 43).** 93 of 443 routed segments run more than twice their straight line: 54
point pairs and about 246 ft beyond a 1.4x harness path. Most are FIREWALL_61 to the rear of the engine. The graph had
no trunk across the firewall recess, so a coil feed went forward along the driver side to VALLEY at the intake front
and back: 6.0 ft against 2.15 ft straight. The crank sensor rode the PDM15-to-starter branch: 9.5 ft against 2.3 ft.
The route-length refresh into the cut list is held until this is fixed, so the detours don't become cut lengths.

**Change (fourth twin route study, research/2026-10-15_route-branches-4.md).** 27 branches and 2 junctions, all with
new codes. Every one carries at least one live segment on the walk.
- **Engine bay:**
  - K5B_E18, the 61-pin across the recess to J_ENG_REAR (26 point pairs ride it).
  - E19 and E23, down each rear corner to J_ENG_D and J_ENG_P.
  - Runs along the block sides to the knock sensors, coolant temperature, CMP, CKP and oil temperature.
  - MAP, the throttle body, injector 8 and coils 5-8 off J_ENG_REAR.
  - Shortcuts for PDM15 coil power, injectors 1, 2 and 7, the radiator-fan ground and the blower.
- **Cab and doors:**
  - S01, PDM30 to the steering column.
  - S02, the isolator's yellow-lead splice to the M130.
  - S03, the tunnel grommet to the GSS-3000.
  - S04/S05, door boot to lock switch inside each door.

**Result (the study's walk over live branches plus the delta):**
- Segments over 2x go from 93 to 16 (pairs 54 to 13).
- Excess beyond 1.4x on those goes from 245.6 to 56.8 ft (all 443 segments: 344.8 to 164.4 ft).
- 443 / 443 placed segments are still joined.

**Kept over 2x, with reasons:**
- 8 roof pairs (mirror monitor, clearance lamps). The only way up is the A-pillar; the straight line runs through the
  windshield. A roof-local ground would clear them.
- The cargo lamp and CHMSL to the rear ground splice (tape item T-09).
- FIREWALL_BODY_B to the iBooster, because of where the bulkhead sits.
- The right lock switch to the driver actuator, across the cab through both doors.
- The tailgate switch to the motor, through the gate's one pass-through.

**Clearance.**
- 26 of 27 branches clear 10 mm or more. The engine-bay minimum is 10.2 mm.
- S03 rides the tunnel shell 3.4 mm past the grommet, with no crossing.
- The exhaust minimum is 28.3 mm. Nothing crosses the corrected engine or the 6L90.

**Checked before load:**
- 201 branches with no duplicate code.
- Every polyline end is within 2 mm of its point, and every length matches its polyline within 0.6 in.
- mounts lint is clean, and the registry is unchanged.

**Expected live after the load:**
- Routed segments planned shorter than their route stays 0.
- About 70 segments re-route onto the trunks, and their route plans shorten. The planner re-plans them.
- Then re-export route_lengths.json into the registry (next pass).

**Open:**
- E27 ends on the floating MAP point; redraw it when the MAP port is placed.
- The IAT and fuel-pressure ports.
- The roof ground plan and T-09.
