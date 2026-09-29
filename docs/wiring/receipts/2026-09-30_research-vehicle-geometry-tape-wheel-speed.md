---
id: 2026-09-30_research-vehicle-geometry-tape-wheel-speed
amends: 2026-09-30_research-vehicle-geometry
change_type: research
scope: docs/wiring/calc-data/cad/tape_list.yaml (4 items added, T-16 to T-19; T-01 to T-15 unchanged)
author: claude-opus-5-5 (geometry-scan lane, session ebc425ad)
asked_by: wheel-speed lane, 2026-09-29 ("Measurements the wheel-speed candidates need, for your calc-data/cad/tape_list.yaml")
---

# Tape list: four wheel-speed measurements added (19 items now)

## What changed
- **T-16 (P2):** front hub-and-disc and knuckle, each side. Measures the inboard barrel OD and free length,
  whether the disc is cast or bolted, the axial space to the knuckle and dust shield, the spindle nuts (count,
  thread, bolt circle) and the caliper-bracket bolt spacing. By caliper, ±0.5 mm.
- **T-17 (P2):** brake-hose bracket and hose free length, steering lock left and right, and knuckle position at
  full droop and bump, ±10 mm.
- **T-18 (P2):** tyre size off the sidewall.
- **T-19 (P3, only if four-wheel sensing is picked):** diff-cover bolt count, axle flange OD, and the rear caliper
  bracket plate outline.

## Sources
- The design these feed: `docs/wiring/research/2026-09-30_wheel-speed-sensors.md` s.3.1, 3.3 and 4.1-4.3, on the
  wheel-speed lane's branch (not yet on main).
- The 1977 LTSM pages that lane cites, checked against the extracted page text:
  - hub end play ".001 to .010 inch", PDF pp.305-306;
  - "Torque spindle nuts to 25 ft. lbs. (K10, 20)", p.307;
  - brake pipe "Clearance of .75" must be maintained", p.398;
  - hose "twisted or kinked" / "severe twist", pp.414 and 417.

## Unknowns
All of these are measurements on the truck. None blocks the geometry work; they wait on the wheel-speed option,
which is a candidate and not decided.
