# K5 twin, engine bay v3 — handoff (2026-09-29)

Branch `wiring/twin-real-engine`, worktree `~/.worktrees/k5-twin`. Blender file `~/k5-harness-pull/K5_harness_workspace_v3.blend`
(new; v2 untouched). Everything here is reproducible from the scripts in this folder.

## What is built

`build_engine_v3.py` (run headless against v2, saves v3) replaces the v2 atom engine (grey box + eight circles) with a
dimension-built LS3 + the parts that are actually on the truck in the 2026-01-31 photos (IMG_6531/6530/6532):

| Part | How it is built | Confidence |
|---|---|---|
| LS3 long block: crankcase, two 45° banks, heads, valve covers (black, no coils), valley cover, front/rear covers, oil pan | bore spacing 111.76, bore 103.25, stroke 92, envelope 710×716×705 (GM marine sheet); deck 9.240 in, cam 4.914 in (GM); block length 610 derived; head/cover/pan sizes estimated | published core, estimated skin |
| Holley LS3 street single-plane intake + 8 runners + port flanges | pad 5.42 in above the valley flange, 4150 flange, port 2.50×1.15 in (Holley 199R10690); valley flange height derived (225 mm) | published heights, derived base |
| Delmo 4-bolt adapter + GM/Hitachi 12699160 DBW throttle body (92 mm bore, vertical) | manifest (purchased); stack height photo-fitted | photo |
| Holley EFI rails + 8 injectors in the intake bosses | photo; rail offset photo-fitted | photo |
| Del-Stributer plate + 8× D510C coils, rear centre above the bellhousing | Delmo order #5068 (bought 2025-11-03); Delmo install photos | photo (Delmo), assignment unknown |
| Holley mid-mount: water-pump manifold, damper, crank/WP pulleys, alternator (driver, high), Type II PS pump (passenger, low), tensioner, idler, belt; SD7 compressor as *planned* (driver, low) | Holley 199R11485 kit contents; sides from the truck photos; sizes photo-scaled | photo |
| Starter (passenger rear, low) | GM LS layout; manifest DFSR-8715 | published side |
| Mid-length headers, collectors, tail pipes, O2 bungs (*candidate*) | photo; bung per MoTeC LTCD manual (10–90° to vertical tip-down, ≥1 m from the ports) | candidate |
| 6L90 bell + case + pan, case connector anchor | Holley 199R12431: connector on the passenger's rear side | published side |
| LTCD box, two *candidate* spots | MoTeC LTCD manual: as far from the exhaust as possible, ≤100 °C ambient, holes 32 mm | candidate |
| 31+ plug anchors (`ANCHOR_*`, provenance in custom props) | `docs/wiring/calc-data/twin_engine_anchors.json` | per anchor |

The whole engine hangs from `K5H_Engine_v3_root` at (0, Y_BELL, Z_CRANK) = (0, −1.40, 0.72): bell face 6 cm ahead
of the firewall's upper face (body verts at y −1.46), crank at 0.72 so the shallow pan clears the axle tubes and the
throttle body top (1.19) stays under the hood. Physical constraints, not a measurement; a tape from the firewall to
the bell face on the truck supersedes it (change `--ybell/--zcrank` and rebuild).

## Axis convention and side corrections

Measured on the TurboSquid body in v2: `Steering_Wheel` x +0.263..+0.666, `Door_Left_*` and `Interior_Seat_Front_Left`
at +x, `Wheel_Front_Left` y −2.31..−1.48 → **+x = driver, −y = front, z up**. Objects whose side changes in v3:

- `K5H_Battery`: mirrored to x ≈ −0.65 (passenger firewall corner = owner working position, state §4). v2 had it driver-side.
- Alternator: v2 `K5H_Alternator` at x −0.30 (passenger) retired; `E3_Alternator_197-302` at +0.227 (driver), as in all three photos.
- Nothing else changes side (M130/PDM30 −0.45 passenger, starter passenger, iBooster driver, knock/O2/exhaust per bank).
- Retired v2 engine objects (50) live in collection `K5H_v2_retired_engine`, hidden, not deleted. `twin_centers.json` is
  untouched; `twin_engine_anchors.json` supersedes its engine entries (K5H_LS3_Block…K5H_Injector_8, K5H_CKP/CMP/CLT/
  IAT/KS1/KS2/MAP/OilPress/OilTemp/FuelPress, K5H_Alternator, K5H_AC_Compressor, K5H_Starter, K5H_O2_D/P, K5H_6L80E,
  K5H_Coil_1-8, K5H_DEL_Bracket) and the battery x sign.

## Photo match (IMG_6531)

`photo_match.py`: camera pose + five photo-scaled dims fitted by least squares (root fixed at the physical position);
`photo_match_IMG6531.json` has the pose and every residual. Result: acceptance set (TB bore 2 px, driver rail rear
3 / front 29, passenger rail rear 10 / front 52, alternator pulley 27, iBooster 36 px) → **max 52 px, RMS 27 px of
1200 (4.3 % / 2.3 %), over the 24 px target**. The valve-cover corners sit 80–128 px off, and the fitted dims ran to
their bounds, which says the estimated head/valve-cover/rail geometry is the limiting error (≈5–10 cm), not the
camera. The twin's chassis also does not reproduce the photo's tires/rails/cowl within ~10 cm under one pinhole camera
(the twin firewall is only 0.44 m ahead of the front axle). So: comparison renders are the *same viewpoint within a
few %*, not a registration. The labelled real photo uses direct pixel picks for the visible plugs
(`picks_IMG6531.json`) and the twin projection only for hidden plugs (marked `~`).

## Files

- `docs/wiring/twin/`: `build_engine_v3.py`, `render_twin.py`, `photo_match.py`, `compose.py`, `label_photo.py`,
  `export_glb.py`, `dimensions_v3.json` (every dimension with source + confidence), `photo_match_IMG6531.json`,
  `picks_IMG6531.json`, `MANIFEST.md` (sources + licences), this file.
- `docs/wiring/calc-data/twin_engine_anchors.json` (new; supersedes the engine entries of `twin_centers.json`).
- `docs/wiring/output/twin/`: `IMG6531_labelled.jpg`, `compare_IMG6531_side_by_side.png`, `twin_photo_match_IMG6531.png`,
  `twin_enginebay_top(_labelled).png`, `twin_iso_passenger_front(_labelled).png`, `twin_firewall_face.png`, `*_anchors2d.json`.
- `nuke_frontend/public/models/k5-enginebay.glb` (Draco, ~0.25 MB, nodes = object names, anchor provenance as extras).
  Not wired into React.

## Open unknowns (listed, not guessed)

1. Engine fore-aft and height on the frame: physical-constraint placement; needs one tape measurement (firewall → bell
   face; frame rail top → crank centreline or pan rail).
2. Knock sensor stations (Gen IV block sides: side known, station estimated); coolant-temp boss (LS: left head front,
   typical, unverified); oil-PSI boss (rear top of block, typical, unverified; the Del-Stributer plate sits nearby).
3. MAP and IAT mounting spots (intake has a 3/8 NPT vacuum port per Holley; nothing recorded); TB connector clock position.
4. Coil-to-cylinder assignment on the Del-Stributer bracket (numbered by position only).
5. O2 bungs and LTCD box: candidates only; sensor lead length not in the LTCD manual text.
6. Intake part number: photo = Holley single-plane with port-injector bosses + Holley EFI rails; repo doc
   `18-deep-image-analysis.md` says shipment 766317 had "300-129 LS3 intake, 534-209 fuel rails"; the state doc's gloss
   "300-129 (dual-plane)" is wrong (no Holley LS dual-plane; the photo shows one plenum with radiating runners). The
   300-131/136 sheet's dimensions apply either way. Manifest rows "Gen V truck intake + Delmo adapter" (assumed) are
   contradicted by the photos.
7. Manifest rows stale vs. photos: alternator (Powermaster 37293 vs the Holley unit on the truck), coil positions (on the
   valve covers), Davies Craig EWP "if equipped" (the mechanical Holley pump is on), A/C compressor SD508 vs the SD7.
8. State §4 "CKP AND CMP on the front timing cover": the crank sensor is in the block above the starter (right rear);
   only the cam sensor is in the front cover (lsenginediy signals guide). Not edited in place; for the state file.
9. Aeromotive regulator: in IMG_6531 it is at the FRONT centre of the intake above the water-pump manifold, not in the
   Del-Stributer's rear-centre spot (my milestone-1 message said the opposite; corrected).
10. Holley's own mid-mount render (199R11485 p.1) shows the alternator on the image-left of a front view, i.e. the
    passenger side; all three truck photos put it driver-side. The twin follows the truck.

## Live Blender

The blender-mcp session (127.0.0.1:9876) had unsaved changes in the open TurboSquid file (`bpy.data.is_dirty=True`)
at 01:45, so v3 was NOT opened there. To do it by hand: File → Open `~/k5-harness-pull/K5_harness_workspace_v3.blend`,
select collection `K5H_Engine_v3`, View → Frame Selected; `scratchpad/open_v3_live.py` does the same through the socket
once the live file is saved or reverted.

## Next step

Measure firewall→bell face and rail-top→crank on the truck (two tape numbers), rebuild with `--ybell/--zcrank`, re-run
`photo_match.py` with the root fixed, and the labels move with it. Then wire the GLB into the site's 3D view.
