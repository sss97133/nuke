---
id: 2026-10-27_k5-body-context
change_type: model
scope: nuke_frontend/public/models/k5-body-context.glb and k5-body-hood.glb (new); docs/wiring/calc-data/cad/fab/body_context_blender.py
  (their generator, Blender headless) and k5_body_context_landmarks.json (what it measured); nuke_frontend/src/components/wiring/map/scene3d.ts
  (LAYERS: two new entries, one `hidesIn` key on the firewall entry, one comment line). No harness, registry, catalog, database row
  or .blend file changed.
author: claude (k5 3d body-context lane, lead session 3d831ccf, 2026-10-27)
owner_words: "this is a failure. start over with a better approach and prompt." (2026-10-27, on a MAP 3D with no cab, hood,
  fenders or wheels)
---

# The truck around the parts: body context from the Blazer model

## What changed
- `k5-body-context.glb` (6.53 MiB, 234,590 triangles, 19 meshes under root `k5_body_context`) and `k5-body-hood.glb`
  (0.16 MiB, 6,046 triangles, root `k5_body_hood`). Plain glTF: no Draco, no textures, no extras. Twin metres, glTF Y-up
  `(X, Y, Z) = (x, z, -y)`. Left is the driver side (+x).
- Nodes: `body_cab`, `body_cowl_top`, `body_fender_L/R`, `body_valance`, `body_tub` (tub, cargo floor, tailgate, tail lamps,
  rear bumper), `body_trim_chrome` (mouldings, windshield trim, wipers), `body_glass`, `body_doors_L/R`, `body_interior`,
  `body_wheel_FL/FR/RL/RR` (tyre and rim), `body_axles`, `body_grille`, `body_lamps`, `body_bumper_F`; and in the hood file
  `body_hood`, whose node origin is on its rear edge so a viewer can raise it.
- Left out of the context file: the TurboSquid underbody (`Under_Main_Blazer`, `Under_Engine_Simple`, `Under_Frame_Blazer`),
  the removable rear top and tailgate glass (the top is off in the owner's booth and bay photos), the spare, seat belts, rear
  trim panels and the rear bench (his is unknown).
- Paint: `firewall_paint` on the body (the firewall lane's PBR: base linear (0.30, 0.055, 0.035), metallic 0.65, roughness
  0.32, clearcoat 1.0 at 0.02), `roof_white` on the roof (faces centred above z 1.85 with normal z over 0.6; 412
  triangles), `chrome` (metallic 1.0, roughness 0.15) on bumpers, grille and trim, `rubber` on tyres, `primer` (0.18,
  0.18, 0.19, roughness 0.6) on the axles, `glass` and `lamp_glass` as alpha-blended. 14 materials, all named.
- MAP tab LAYERS: `body` (TRUCK BODY) and `hood` (HOOD), both `off: true`. `body` hides the CTX stand-ins the audit lists and
  the sheetmetal file's radiator, firewall and inner-fender boxes. The firewall entry gains `hidesIn: { body: ['body_cowl_top'] }`
  because the Blazer's cowl strip sits 65-73 mm above that layer's pinch seam and plenum (audit, model against model).
- Two derivations the audit proposed and this makes: the dash and interior are bisected at y -1.43 (the firewall layer's dash
  face is y -1.46; the Blazer's dash reaches -1.4786), and the TurboSquid axle tubes, diffs, hubs, knuckle housings and tie rods
  are kept as `body_axles` (84 loose parts on the axle lines, picked by position: within 0.12 m of an axle station, centre z
  0.25-0.55, under 0.28 m long) so that hiding the TurboSquid frame does not leave the wheels floating.

## Reproduce
`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P docs/wiring/calc-data/cad/fab/body_context_blender.py -- nuke_frontend/public/models`
reads `k5-blazer.glb` from the same folder and rewrites both files and `k5_body_context_landmarks.json`. Two runs give
byte-identical files (sha256 of the context file 3f2a01f3..., of the hood 4b24d121...).

## Measured (read back from the exported files, not from the Blender session)
| Check | Result | Source and error |
|---|---|---|
| Triangles, both files | 234,590 + 6,046 = 240,636 (brief: under about 250k) | accessor index counts |
| Size, both files | 6,845,428 + 167,100 B = 7.0 MB (brief: about 12 MB) | file sizes |
| Front axle | tyre centre y -1.8955, +0.5 mm against `front_axle_y` -1.896 in `chassis_frame.params.json` | mesh extent, float32 (about 0.1 mm) |
| Rear axle | tyre centre y 0.8069, -2.1 mm against `rear_axle_y_by_this_frame` 0.809 | same; the params record that the twin wheelbase is 2 mm short of FR-88's 2705 |
| Ground | lowest tyre vertex z -0.0105, 0.0 mm against the brief | same |
| Tyre radius | 0.4062 from the z extent, +0.2 mm against 0.406 (the lugs make the fore-aft extent 0.4143) | same |
| Tyre centre height | z 0.3957 on all four | same |
| Bay volume (x within +-0.55, y -2.45..-1.45, z 0.55..1.30) | no vertex of any body-context node inside it, and no triangle's bounding box touches it (fender lips included: they sit at |x| over 0.80) | every triangle of every node, in the twin frame |
| Hood against the same volume | no vertex inside; 8 of 5,390 triangles have bounding boxes that reach 7-17 mm into the top of it (z 1.293-1.317 at y about -2.45, the front of the volume), which is the hood being the lid of the bay | same |
| Hood hinge | origin at y -1.2409, z 1.3593 (the rear-edge vertices' lowest z); the audit read y -1.241, z about 1.37 | **assumed** as the hinge line; the model has no pivot |
| Cowl strip | 182 triangles, y -1.552..-1.323, z 1.305..1.379 | the audit's rule: cab-upper faces forward of y -1.33 and below z 1.40 |

The stance deltas check that the body and the frame agree. They do not prove the truck's real ride height: the frame's rail
height was set to the Blazer's own frame (params note, 0.500 against 0.496), and the real lift height and tyre size are not
recorded (vehicle_observations aa5bff91 says there is a lift, with no figure).

## Licence of the source model (established from the repo and the vendor page; not settled)
- Source: TurboSquid product 1764639, "1978 Chevrolet Blazer" by APEC_True, listed 2021-07, USD 99
  (https://www.turbosquid.com/3d-models/1978chevroletblazer-3d-model-1764639).
- What the repo records: `2026-06-09_3d-model-v2-digital-twin.md` says it was "bought Dec 2024" and, in the same file, that
  the order came from a Gmail order dated 2026-04-30; the two dates disagree. The licence tier bought is not recorded anywhere
  in `docs/`. `k5-blazer.glb` entered the public repo in commit fcd059c60 (2026-06-21, "chore: deploy to production") and
  is served at nuke.ag/models/k5-blazer.glb, so the original is already public.
- What the vendor page shows today (read 2026-10-27, so these are current terms, not necessarily those at purchase): "GM
  License - Official Licensed Product" and "Royalty Free License - Editorial Uses Only", with paid enhanced tiers above that.
- Not established: whether either tier allows a modified copy to be served as a public download from nuke.ag. The two new
  files are derived from the model, so they sit under the same question as the file already published. Both layers stay `off`
  and the credit line is in the `body` entry. If the terms rule it out, the generator's input is the only file to replace.

## Not done, on purpose
- **The cowl slot.** With the firewall layer drawn and `body_cowl_top` hidden, a 45-70 mm slot opens between the Blazer's
  windshield base (glass bottom z 1.353) and the firewall plenum (1.27-1.30), and interior shows through it. The audit's fix
  pulls the cab upper, glass and wiper vertices below z 1.45 down by up to 0.065 m, and asks for a camera-matched overlay on
  two photos and the owner's sign-off first. Not applied.
- **Core-support corner posts.** `fender_flange_L/R` in `k5-core-support.glb` stand about 151 mm over the fender with the
  hood on (core-support lane).
- **Viewer.** `body` and `hood` as context (rays pass through to the harness, no OBJECTS rows, doors and glass faded in the cab
  zone) needs a `context` flag on `LayerDef` in the viewer code, which the viewer lane owns. Until then the body blocks picks
  on the harness behind it, so the layer stays off.
- With `body` on and `firewall` off, `body` still hides `CTX-firewall-face` and `CTX-toe-board` as the audit lists, and the
  Blazer's own firewall is not in the file, so the bay has no firewall surface. Turn both on together.

## Check
Cycles proofs of exactly these files with the existing frame, engine, firewall, inner-fender and core-support files are in the
private build log (front 3/4 with the hood off and on, bay close-up, side at stance, from below, rear 3/4). Type check:
`npm run type-check` in `nuke_frontend` passes at its baseline of 439 errors in 142 files, none in `scene3d.ts`. Live
check after deploy: the two files return 200 from nuke.ag/models and the layers appear in MORE.
