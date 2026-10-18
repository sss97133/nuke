---
id: 2026-10-15_engine-position
scope: where the LS3 sits in the K5 twin, the engine wire ends placed on it, and the engine-bay route branches redrawn against it
by: system (engineering call)
---

# K5 twin: where the engine really sits

2026-10-15. This is research. It changed no repo file, database row or .blend. It produced two load files:
`mounts_engine_ends.yaml`, the engine ends for `catalog/mounts.yaml`, and `route_branches_3.yaml`, a delta to
`catalog/route_branches.yaml`. The scripts and measurements are kept with the research lane's logs.

Frames:
- **Twin:** +x driver, -y front, +z up, in metres.
- **Engine-local:** millimetres, with the origin on the crank axis at the block's rear (bell) face and +y rearward. This
  is the frame `calc-data/cad/fab/engine_ls3.py` and `calc-data/twin_engine_anchors.json` use.

## Answer

1. **The v2 insert is not 0.15 m too far back. Its rear boxes are 12-15 cm too long.**
   - The v2 cylinder stations (injector boxes, rear pair at y -1.525) sit within 8 mm of where the photos put the real
     ones (-1.517).
   - What pokes into the cab is v2's crude geometry. `K5H_LS3_Block` is the whole 710 mm outline, damper included, so
     its rear face lands at -1.300. Its heads, valve covers and intake run back to -1.33, -1.355 and -1.405.
   - The real block rear face is at about -1.432, and the heads end about -1.45.
   - Moving the whole insert 0.15 m forward would put the cylinders, injectors and accessory drive 14 cm too far
     forward. The drive would then come within 10 mm of the fan boxes.
2. **Correction:** put the true-size engine (`engine_ls3.py`, the source of `k5-engine-ls3.glb`) at root
   **(x 0, y -1.432, z 0.72)**.
   - Against today's `twin_engine_anchors.json` root (0, -1.40, 0.72), that is **dx 0, dy -0.032 m, dz 0, no rotation**.
   - For the v2 K5H insert, the rigid transform the evidence supports is dy +0.008 m, which is effectively none. Replace
     its boxes rather than moving them.
3. **Confidence:**
   - y is medium, about ±30 mm. That splits into ±4 mm across the photo-solve variants, ±13 mm for the recess
     cross-check, and ±30 mm for where the twin's firewall sits against FR88 Fig 2.
   - z is low. No measurement exists, so the v3 physical-constraint value of 0.72 is kept; the firewall features bound
     it weakly to 0.65-0.75.
   - x is 0 (assumed). Rotation: none; the firewall face is vertical in the engine frame to within 0.6°.

## How it was measured

### A. Three owner photos, triangulated against the true-size engine (the main evidence)

- **Photos:** IMG_6530, IMG_6531 and IMG_6532 (iPhone 15 Pro, 24 mm equivalent, 2026-01-31; vehicle_images 92367a72 /
  40e5e5f9 / dff584e9). The fenders are off, and all three show the engine and the firewall.
- **Engine model:** the `engine_ls3.py` values, used as priors with that file's margins:
  - cylinder 8 sits 85 ±12 mm ahead of the block rear face (GM marine LS3 sheet p.3 side outline, scaled);
  - bore spacing is the exact 111.76 mm;
  - fuel rails at x 150 / z 372 ±20;
  - 4150 pad at y -240 ±40;
  - belt plane at -690 ±20;
  - water-pump pulley at (0, 199.6) and alternator at (184, 262), ±8 (Holley 199R11335 belt render, scaled).
- **Picks** were read by eye off gridded crops in a 1200 × 900 frame (±3 px).
  - Engine features: 4 fuel-rail end caps, 8 injector stations (passenger rail in 6530, driver rail in 6532), the TB
    ring, the water-pump pulley and the alternator pulley.
  - Firewall features (two views, 6531 + 6530): the four corners of the owner's open panel on the passenger flat
    face, the round plugged hole beside it, and the domed boss in the centre recess.
- **Solve:** the camera poses and 8 model parameters were solved jointly, then the firewall features were
  triangulated. Three random seeds converge to the same solution. Engine features fit to an RMS of 6.5 px (max 15).

**Results (engine frame):**

| Feature | y (mm, + = rearward of block rear face) | Behind the passenger flat face |
|---|---|---|
| Passenger firewall flat face (panel corners and plugged hole, mean of 5) | -23.2 (spread -32 to -12) | 0 |
| Cylinder 8 bore centre | -82.0 (prior -85 ±12) | -58.6 |
| Passenger rail rear end cap | -10 | +13 |
| Passenger valve-cover rear-top edge (2 corners) | -4 (corners +25 / -33) | +19 |
| Domed boss in the centre recess (x +55) | +56 | +79 |

- **Sensitivity:** the gap from cylinder 8 to the firewall face stays at 54.3-61.5 mm whether the rail-height,
  rail-spacing, TB or belt-plane priors are tightened, or the TB, water pump or IMG_6532 is dropped. The
  block-rear-to-face figure moves with the cylinder-8 prior: 14.4 mm at 73 and 37.9 mm at 97. One run (dropping the
  alternator) went degenerate (cylinder 8 at -69, belt plane at -743, a recess 138 mm deep). It was excluded.
- **Cross-check against the twin:** placing the flat face at the twin's -1.458 puts the recess boss at -1.379. The
  twin's own centre recess is at -1.366 to -1.380, so the recess depth agrees to within 13 mm.
- **Twin numbers:**
  - Cylinder 8: -1.458 - 0.0586 = **-1.517**.
  - Block rear face: -1.458 + (85 - 58.6)/1000 = -1.432.
  - Passenger valve-cover rear: -1.440 ±0.03.
- **Why one photo is not enough:** freeing the root in the single-view fit (a copy of `docs/wiring/twin/photo_match.py`)
  sends the crank to z 0.41, which is physically impossible. Depth and height trade off in a single view, as the v3
  handoff warned.

### B. Other records

| Evidence | Says | Weight |
|---|---|---|
| GM 2009 "LS3" marine sheet p.3 side outline, re-rendered at 600 dpi | The heads and valve covers end flush with the block rear face. The block is about 510 mm from the rear face to the front-cover joint. **The printed 710 runs from the ring gear's rear edge to the water-pump inlet, not "damper face to bellhousing face".** `K5_DIMENSIONAL_SUBSTRATE.md` §5, `dimensions_v3.json` `envelope_length` and the v2 block box carry that misreading. | Supports the head-rear plane; v2's 710 mm block box is wrong |
| FR88 (1988 Blazer 4WD frame sheet) p.1 via `dimensions.yaml` `fr88.frame.len.E-G` 791 and `len.A-G` 1582 | The frame-side motor-mount bolt E is 791 mm behind A. In the twin that is y -1.7955, using `chassis_frame.params.json` (front-axle anchor ±25 mm, assumed). | The frame half of the chain |
| Owner photos 2024-10-03, LS3 + 6L90 in the bare frame (vehicle_images 2c557913 passenger side, a0ca577c driver side) | Two yellow-zinc bolts on the passenger rail top sit under the cylinder-4 header port and about 50 mm ahead of it. The driver-side bolts sit under ports 1-3. On the corrected engine that is y -1.74 to -1.79; FR88 E is -1.7955. | Independent corroboration within about ±40 mm (perspective, depth difference) |
| Owner verbal 2026-05-06: "ICT Billet LS adapter plates on factory K5 truck mounts" (an older revision of `K5_dimensions_atoms.yaml`). The ICT plate's Amazon order (in Gmail) shows a title truncated to "ICT Billet SBC Vehicle to..." | The swap sits on the factory perches. The plate's part number and fore-aft offset are not on file. | Settles nothing alone |
| Owner photo 2024-08-25, long block from behind (vehicle_images 8e79c104) | The oil-pressure sensor is on the rear of the valley cover, just driver side of centre. The head rear faces carry several bosses. A capped port sits at the top outboard corner of the passenger head's rear face. | Sensor and end spots |
| Frame and sheet-metal pass (`docs/wiring/receipts/2026-09-30_frame-3d.md`) | FR88 Fig 2 puts the cowl points at y -1.429, 3 cm behind the twin's firewall station (-1.46). | The twin firewall's placement is good to about 3 cm |
| v3 handoff (`docs/wiring/twin/HANDOFF.md`) | Bell -1.40 and crank 0.72 were set from physical constraints, with "a tape from the firewall to the bell face on the truck supersedes it". | Superseded in y; z kept |
| 1977 4-view blueprint (scaled at the wheelbase) and the TurboSquid stock-engine mesh | The stock small-block's rear sits at about -1.50 to -1.57. | Low (artwork); not used |

## Twin geometry now (headless Blender, K5_harness_workspace_v2.blend)

- **v2 insert:**
  - `K5H_LS3_Block`: y -2.010..-1.300, z 0.640-1.060.
  - Heads: -1.980..-1.330.
  - Valve covers: -1.955..-1.355.
  - Intake: -1.905..-1.405.
  - Coils: an 8-grid on top, z to 1.345.
  - Injector stations: -1.860..-1.525, z 1.14-1.20.
  - `K5H_6L80E`: from -1.300.
  - `K5H_CKP`: at y -3.34, outside the body.
- **v3/v4:** v3 and v4 already retire that insert and use (0, -1.40, 0.72). The route studies of 2026-10-15 ran on v2.
- **Firewall (`Under_Main_Blazer`):**
  - Flat vertical face at y -1.458 for z 0.95-1.25 and |x| 0.1-0.6.
  - Centre recess at |x| < 0.1: y -1.366 to -1.380, z 0.85-1.25.
  - Below z 0.9 the toe board slopes back: -1.430 at z 0.85, -1.382 at 0.80, -1.334 at 0.75, -1.286 at 0.70.
  - The top edge is between z 1.25 and 1.30.
- **Radiator support:** side panels at y -2.465. Twin radiator box -2.458..-2.382, fans -2.370..-2.310. FR88
  core-support pads are at -2.527.
- **Hood:** the inner panel is flat at z 1.252 over y -2.40..-1.50; the skin is at 1.30-1.37.
- **Frame:** the TurboSquid frame (rails |x| 0.35-0.45, tops near z 0.68) is not the K5 frame. `k5-frame.glb` (FR88)
  has the rail web at x 0.37-0.42, its top at z 0.82-0.84 at the hump, and E bolts at -1.7955.

## The corrected engine and its clearances

`engine_ls3.py` at the new root, plus the v3 TB, Del-Stributer cluster, starter and 6L90 moved with it. The TB goes onto
the model's `tb_flange`; the rest moves with the bell, dy -0.032.

- **Key extents:**
  - Block rear -1.432.
  - Heads to -1.450 (R) / -1.474 (L).
  - Valve covers to -1.458 / -1.482.
  - Intake to -1.4745.
  - Cylinder 8 at -1.517.
  - Accessory-drive front -2.142.
  - Sump bottom z 0.495.
  - TB top z 1.236.

| Against | Clearance (corrected) | Notes |
|---|---|---|
| Twin firewall flat face (TurboSquid) | Passenger head 8 mm into the face, bell flange top corners up to about 26 mm into the face and toe board. Driver head and cover clear by 14-22 mm. | The twin's recess is only ±0.10 m wide. On the truck the heads sit in a recess about 79 mm deep, so this is the twin's firewall shape, not the engine. |
| Sheet-metal firewall (`k5-front-sheetmetal.glb`: recess x ±0.34, 80 mm deep) | Heads clear by 10.1 (R) / 18.8 (L), intake 16.2, rail R 12.0. The passenger cover touches (0.6 mm), and the photo-scaled shorty headers and assumed down-pipes touch. | At today's root (-1.40) the intake, both covers and rail R intersect it |
| Radiator / fan boxes | 169 mm | The fan positions are twin assumptions |
| Frame rails (FR88 model) | Headers 9.6 / 12.5 mm. The oil pan sits 14.2 mm above crossmember 2. | The headers cut the factory engine-mount bracket boxes; the truck has ICT plates, and the header shapes are photo/assumed. |
| Hood | TB top is 16 mm under the inner panel and 123 mm from the skin | No air cleaner is modelled. The 2024-10-03 photos show one; the 2026-01-31 photos show none. |
| `K5H_iBooster` box | Intersects the driver valve cover | The box position is unverified. The photos show the master cylinder above and outboard of the driver cover's rear. |

## Ends on the corrected engine (`mounts_engine_ends.yaml`)

34 positions; GND-HEAD, GND-FRAME and FW-BOND stay open. Live point codes are kept, so the branches already attached to
them re-link: `K5H_Injector_n`, `K5H_CLT`, `K5H_OilPress`, `K5H_OilTemp`, `K5H_Starter`, `KS1`, `KS2`, `CMP`, `CKP`,
`THROTTLE_BODY`, `STARTER`, `ALT`, `RAIL_COIL_PWR` and `RAIL_INJ_PWR`. The `mounts_v5` lint is clean over the merged ends.

| End(s) | Point | Twin (m) | Confidence | How |
|---|---|---|---|---|
| INJ-1..8 | K5H_Injector_n | x ±0.132, y -1.876..-1.517, z 1.073 | medium (y) / low (z) | Bore stations from the photo solve |
| COIL-1..8 | K5H_Coil_n (new) | x ±0.033/±0.098, y -1.574 / -1.510, z 1.165 | low | v3 cluster, moved with the bell and lifted 97 mm clear of the intake runners. The Del-Stributer is in no photo on the truck. |
| TB | THROTTLE_BODY | (-0.080, -1.652, 1.148) | low-medium | TPS/motor housing on engine_ls3's pad |
| CLT-ECU | K5H_CLT | (0.190, -1.948, 0.900) | low | Front of the driver head. The alternator covers the nominal spot, so this is the nearest free point. |
| KNOCK-1/2 | KS1 / KS2 | (±0.200, -1.687, 0.765) | low | 5 mm proud of the block surface |
| CMP | CMP | (0.060, -1.972, 0.860) | low | Front cover at cam height. The mid-mount bracket covers the nominal spot, so this is the nearest free point. |
| CKP | CKP | (-0.190, -1.527, 0.755) | low | Block above the starter, passenger side |
| OILP-ECU | K5H_OilPress | (0.020, -1.502, 0.970) | low-medium | Factory port at the rear of the valley (photo 8e79c104) |
| OILT | K5H_OilTemp | (-0.136, -1.642, 0.580) | low | Passenger pan boss |
| STARTER-S | K5H_Starter | (-0.215, -1.547, 0.625) | low-medium | v3 starter, moved with the bell |
| STARTER-BPLUS, GND-BLOCK | STARTER | (-0.220, -1.532, 0.680) | low | Solenoid B+ stud. This point follows the starter, joined to K5H_Starter by K5B_E15. |
| COIL-GROUND-RINGS | COIL_GND_HEAD_REAR_P (new) | (-0.208, -1.445, 0.928) | medium (face) / low (boss) | Passenger head rear face. The driver face (0.208, -1.474, 0.928) is the alternate. |
| DAK-CTS | DAK_CTS_HEAD_REAR_P (new) | (-0.292, -1.445, 1.012) | low-medium | Capped port, passenger head rear top outboard |
| DAK-OILP | DAK_OILP_TEE (new) | (0.040, -1.502, 0.995) | low, **flag** | Tee at the factory port. The Del-Stributer plate sits over the port. Status is flag because mounts_v5 lets no open end carry a position. |
| ALT-BPLUS | ALT_BPLUS_STUD (new) | (0.250, -1.946, 0.982) | low-medium | Alternator rear housing, outboard |
| ALTERNATOR-SENSE | ALT | (0.184, -1.955, 1.058) | low | Sense plug on the alternator's rear top |
| RAIL-INJ_PWR, RAIL-COIL_PWR | splice nodes | (0, -1.800, 1.110), (0, -1.542, 1.210) | low | Graph nodes on the corrected rails and cluster |

## Route branches redrawn (`route_branches_3.yaml`)

The delta to `catalog/route_branches.yaml` contains:
- **24 redrawn**, under the same codes:
  - K5B_B05, B06, B07, B10;
  - the injector rows B12-B19;
  - the knock sensors B21, B23; oil temp B24 (its from-point is now J_BAY_BLOCK_P, since the sensor is on the passenger
    side of the pan); B25;
  - the starter B40; the rail splices B63, B64, B65;
  - C10, C42, L08 and L09.
- **17 new** (K5B_E01-E17): the coil cluster (8 legs off RAIL_COIL_PWR), the head rear points, the oil-pressure tee,
  the alternator B+ and sense plugs, the starter's B+ stud and the crank sensor.
- **2 junctions:** VALLEY moves from (0, -1.655, 1.31), which is above the hood inner panel, to (0, -1.86, 1.13) over
  the intake front. J_ENG_REAR is new, at (0, -1.44, 1.12) behind the coil cluster.
- Every polyline end sits on its point's coordinates.

**Method.** A 10 mm grid planner works over the twin body plus the corrected engine and the FR88 frame:
- **Free space:** at least 10 mm from every mesh and at least 28 mm from the headers and down-pipes, below the hood
  inner panel, A* weighted toward 35 mm, then line-of-sight simplified.
- **Hand routes:** the injector rows (along each rail's outboard side, as in study 1) and the cab-side C10/C42.
- **Measuring:** the nearest mesh to the polyline every 10 mm, with the end's own device excluded within 60 mm, as in
  study 2. The 25.4 mm exhaust keep-out is measured away from device ends. No segment passes through a mesh.
- **Recess envelope:** inside x ±0.36, z 0.80-1.25 the twin's flat firewall face (and its cab-side shells) is replaced
  by a back wall at y -1.379, the photo-measured recess depth. Without it, the head rear points are unreachable in the
  twin.

**Result:**
- No branch crosses a mesh.
- **Clearance minimum: 8.0 mm** (K5B_B07, CMP, against the mid-mount bracket). Next are 8.2 mm (B23, TurboSquid
  frame), 8.4 mm (B25, Del-Stributer plate) and 8.6 mm (E17, alternator). 7 branches are under 10 mm and 38 under
  25.4 mm, almost all hugging the part they run along.
- **Exhaust minimum: 27.9 mm** (K5B_B21, driver header) and 28.6 mm (B23).
- **Confidence:** 10 medium, 4 low-medium, 27 low.
- **Length:** 439.6 in in all (343.6 redrawn, 96.0 new).

**Left as they are:**
- K5B_B08 (IAT, not moved; 60 mm), B11 (fuel pressure, not moved; 149 mm), B20/B22 (79 mm).
- K5B_C24: 21.8 mm from the estimated 6L90 bell, no crossing. An earlier count without the end-device exclusion called
  it a crossing.
- L15: the BAT end is unplaced, so it cannot route either way.

**Walk** (the route_harness_segments rule over the live branches plus this delta, on the live segments' plug points):

| | Before | After |
|---|---|---|
| Routable segments joined | 397 / 399 (GND_BANK_ENG–STARTER and ISOLATOR–STARTER had no branch) | 443 / 443 |
| Segments on an unplaced point | 56 | 12 |
| Segments whose plugs share a point | 62 | 62 |

The 12 still unplaced are all an unplaced point, not a missing branch:
- the Odyssey's BAT (4);
- the wideband's O2_L (4);
- UNDERHOOD-LAMP (2);
- GND-FRAME and GND-HEAD / FW-BOND (open ends).

## Open questions, and what closes them

1. **Top: one tape on the truck.** Measure fore-aft from the passenger firewall flat face (at the lower edge of the
   open panel) to the passenger cylinder head's rear face, and from the face to the bellhousing flange top. That
   settles y to ±5 mm (tape list T-05/T-06).
2. Crank height: the crank centre (damper bolt) above the frame rail top at the motor-mount bolts. This settles z.
3. The ICT plate's part number (from its Amazon order, in Gmail) and ICT's stated fore-aft offset. That closes the
   frame chain independently of the photos.
4. The Del-Stributer cluster's real height and spot, and whether its plate clears the factory oil-pressure port. This
   decides DAK-OILP and moves the 8 coil points.
5. The twin's firewall recess is too narrow. Model the measured recess (79 mm deep, at least as wide as the valve
   covers) or adopt the sheet-metal firewall.
6. MAP_SENSOR (z 1.28, above the hood inner panel), K5H_FuelPress (z 1.25, 15 cm above the corrected rail) and
   K5H_IAT keep their v2 spots, because their ends are open. Place them on the corrected intake once their ports are
   known.
7. The header and down-pipe shapes are photo/assumed and cut the FR88 frame's factory mount brackets. Photograph the
   driver mount from below.
