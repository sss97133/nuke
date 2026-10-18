---
id: 2026-10-15_k5-engine-position-and-bay-routes
change_type: substrate_correction
scope: docs/wiring/research/2026-10-15_engine-position.md (new); docs/wiring/calc-data/catalog/mounts.yaml (37 engine end entries); docs/wiring/calc-data/catalog/route_branches.yaml (22 redrawn, 19 added, 2 junctions); nuke_frontend/public/wiring/k5-mounts.json (rebuilt); docs/ledger/theory/data-machine-cases.md (passes 41 to 43, one finding corrected)
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 43: the engine is where the photos put it, and the engine bay routes on it

**Gap (live as anon, 21:32Z).** 56 segments sit on a plug with no position, and 7 of the 8 open plugs are on the
engine: COIL-GROUND-RINGS, DAK-OILP, DAK-CTS, GND-HEAD, ALT-BPLUS, GND-FRAME and FW-BOND. Two route studies had found
the twin's engine "about 15 cm into the cab" and parked every engine-rear point behind a twin fix. Twelve engine-bay
branches were flagged for a redraw after it.

**Finding (research/2026-10-15_engine-position.md).** The engine is not misplaced.
- **Evidence.** Three owner photos (IMG_6530/6531/6532, 2026-01-31, fenders off) were solved jointly against the
  true-size engine already on main (cad/fab/engine_ls3.py). They put cylinder 8's bore centre 58.6 mm ahead of the
  passenger firewall flat face. Across 9 variant solves the gap stays at 54-62 mm.
- **Cross-checks.**
  - The firewall recess depth agrees with the twin to within 13 mm.
  - The bare-frame photos (2024-10-03) put the frame-rail mount bolts within about 4 cm of FR88 bolt E.
- **What actually went wrong.** The v2 insert's cylinders sit within 8 mm of that. Its block box is GM's printed 710 mm
  outline, which runs from the ring gear's rear edge to the water-pump inlet, so its rear face lands at -1.300. The
  real block rear face is at -1.432.
- **The correction.** engine_ls3 at root (0, -1.432, 0.72): dy -0.032 from today's anchors, no rotation. Moving the
  insert 0.15 m forward, as planned, would have put the accessory drive 10 mm from the fans.
- **Confidence.** y medium (±30 mm); z low (0.72 kept, nothing measures it).

**Change:**
- **mounts.yaml.** 37 engine end entries are replaced on the corrected engine.
  - 34 carry a position. They use the live point codes, so the branches already there re-link: K5H_Injector_n,
    K5H_CLT, K5H_OilPress, K5H_OilTemp, K5H_Starter, KS1/KS2, CMP, CKP, THROTTLE_BODY, STARTER, ALT and the rail
    splices.
  - New points: K5H_Coil_1-8, COIL_GND_HEAD_REAR_P, DAK_CTS_HEAD_REAR_P, ALT_BPLUS_STUD and DAK_OILP_TEE.
  - DAK-OILP is a flag: the Del-Stributer plate sits over the factory port, so the tee may not fit (the cooler adapter
    is the alternative).
  - GND-HEAD, GND-FRAME and FW-BOND stay open with no point.
  - The knock sensors and CKP were inside engine_ls3's block; they now sit 5-6 mm proud of it. The old knock points
    fell under the heads.
- **route_branches.yaml (third route study).**
  - 22 branches redrawn under their codes: B05, B06, B07, B10, B12-B19, B21, B23, B24, B25, B40, B63, B64, B65, C10
    and C42.
  - June L08/L09 redrawn where VALLEY moved. VALLEY was above the hood inner panel at z 1.31; it is now over the
    intake front.
  - 17 new branches (K5B_E01-E17) and junction J_ENG_REAR.
  - Clearance: minimum 8.0 mm, exhaust minimum 27.9 mm, no crossings. Confidence: 10 medium, 4 low-medium, 27 low.
  - One rule differs from study 2: inside the photo-measured firewall recess (x ±0.36, z 0.80-1.25), the twin's flat
    face is replaced by a back wall at y -1.379.

**Checked before load:**
- All 174 branches end exactly on their points (within 2 mm) and match their polylines' lengths (within 0.6 in).
- No point code carries two coordinates.
- mounts_v5 lint is clean, and the registry is unchanged.
- The study's shortest-path walk joins 443 / 443 segments whose plugs both have a position. Before: 397 / 399.

**Expected live after the load:**
- Routed segments go from 397 to about 443 of 669.
- Segments on an unplaced plug go from 56 to 12: BAT x4, O2_L x4, UNDERHOOD-LAMP x2, and the open GND-FRAME and
  GND-HEAD/FW-BOND ends.
- The planner re-plans the redrawn routes.

**Open, with what closes them:**
- One tape on the truck: passenger firewall flat face (at the open panel's lower edge) to the passenger head's rear
  face. That settles y to ±5 mm.
- The crank height.
- The ICT plate part number (its Amazon order, in Gmail).
- Whether a DAK-OILP tee clears the Del-Stributer plate.
- MAP, IAT and fuel-pressure ports. Their points still float at their v2 spots above the corrected intake.
