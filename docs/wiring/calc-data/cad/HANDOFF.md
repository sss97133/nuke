# K5 harness in CAD (v4): handoff (harness-cad lane, 2026-09-30)

Everything here is a PROPOSAL for Skylar and Dave to confirm. Nothing is taped, and every number carries its source
in the files beside this one.

## NEXT TASK: brake hydraulics and the proportioning-valve switch (from pieces, relaying Skylar)
Skylar, verbatim: "proportioning valve has a sensor on it a one wire situation where if it disconnects it triggers the
brake light on we can wire that and code that ... its mounted on a cross member under the radiator where all the brake
lines go. this should be rendered accurately, all brake lines too."

**Sources pieces found**
- 1977 LTSM PDF p.406, "Testing Electrical Circuit of Combination Valve": disconnect the wire from the switch terminal,
  jumper it to ground, key on, and the warning lamp lights. It is a one-wire switch that grounds the warning lamp.
- His 2021-10-06 teardown photo (vehicle_images 896767b8) shows the original firewall-mounted combination valve with
  its yellow switch plug.
- The 2024-08-29 build log lists a proportioning valve bought (eBay, an inline tube type). Which valve is on the truck
  now, and its part number, are open.
- The valve sits on the front crossmember under the radiator, where all the brake lines meet (owner).

**The job**
1. Model the brake hydraulics as real lines at true size and at a margin, like the looms:
   - the iBooster master cylinder;
   - the valve on the front crossmember under the radiator;
   - each front caliper, through its hose;
   - the rear line along the frame rail to the axle.
2. Use his photos (search `vehicle_observations` for brake lines, hoses and the junction) and the 1977 LTSM brake section.
3. Put the valve's switch on the harness as a new PROPOSED end: one wire to a spare PDM15 input (the bay box, the
   nearest). The registry owner adds the end.
4. One Blender run at a time: usage is being paced.

## State after this session
**Data** (`harness_full.py`; `scene_v4.json` and `routes.json` regenerate and stay out of git)
- 148 parts:
  - 5 parts-lane CAD models: M130-A, PDM30-A, ODYSSEY, ACC-BATT, DCDC;
  - 27 true-size stand-ins, including the 8 coils on the DEL-Stributor ring from PR #434, and the post;
  - 12 twin objects;
  - 102 dashed boxes.
- 7 looms, 316 segments.
- Route checks: 1869 pass, 0 fail, 2 exceptions (H3), 18 flags, and 96 "not run" (the exhaust route aft of y −1.07 is
  unknown).
- Part checks: 138 pass, 47 flags.
- Wires: 0 unrouted, 13 re-homed, 13 open. The open ones are body circuits that used the retired bulkheads. The 61-pin
  is full, and no shell-25 insert helps (MILNEC catalog p.B-19), so they need an owner call.

**Coil ring.** The coils sit on the delstributor lane's ring (PR #434), wired as a split star:
- one Y on the driver side of the post;
- a 4-coil star for each half;
- each half's grounds go to its own head.

The ring sits behind the twin's firewall at the centre, where the real firewall has a deep dish. Those 12 segments are
flagged FIT-FIREWALL, not failed.

**Cab.**
- The PDM30 moved inboard of the 61-pin, outboard of the dish (origin x 0.245).
- The ground bank sits between the PDM30 and the 61-pin plate.
- The dash crossbar moved back to y −1.20.
- The H3 cables sweep behind the dish, and they pass the bend rule (10 × OD).

**Renders** (not committed: they show the licensed body as x-ray)
- Location: `~/k5-harness-pull/renders/v4/`, run at 1920 × 1200, 40 samples, denoised.
- 9 views: `iso_front_left`, `iso_rear_right`, `plan`, `side_driver`, `bay`, `firewall_engine`, `firewall_cab`,
  `rear_quarter`, `underbody`.
- 7 per-loom renders `loom_<id>`: the loom shown bright, the others dimmed.
- Each render has `_labelled.png` (tags and a legend) and `preview_800/`.
- `manifest.json` and `scene_v4_rendered.json` record the data the renders were drawn from.

**GLBs** in `~/k5-harness-pull/glb/v4/`: own geometry only, no Draco, scene extras stripped, 0 credential strings, 0
TurboSquid nodes.
- `k5_harness_v4_bay.glb` 8.6 MB, `_cab` 6.6 MB, `_rear` 2.5 MB.
- `_all` is 13.5 MB, over the 10 MB cap: local only.

**Blend.** `~/k5-harness-pull/K5_harness_workspace_v4.blend`, never over v3. It inherits v3's add-on scene property, so
keep it local.

## For the next Blender run
- Headlights are at x ±0.789 (pieces' ruling) in the data now; this run's renders and GLBs still show ±0.73.
- Unhide the removable top (Exterior_Roof) as an x-ray, so the CHMSL, cargo lamp and top loom don't float.
- In the plan view, four small dark objects sit outside the body (x ±1.34, y −0.43 / +0.22). Identify them in the v4
  .blend and hide them if they aren't truck parts.
- Segment ids gain a `~n` suffix when a channel splits. layout-ui asked for ids that stay stable across runs: key them by
  channel plus break-out nodes.

## Still owed
- The "K5 Harness CAD" artifact and the PR ("K5 wiring: harness in CAD (parts placed, looms sized, illuminated
  renders)", not merged). Both wait until pieces has checked the renders.
- The receipt: `docs/wiring/receipts/2026-09-30_harness-cad-whole-truck.md`.

## Never commit
The .blend files, the TurboSquid body, mesh .npz exports, GLBs, maker images or CAD, or renders of the licensed body.
