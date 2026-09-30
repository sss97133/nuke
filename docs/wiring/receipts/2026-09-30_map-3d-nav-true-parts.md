# Receipt — MAP tab 3D: navigation, selection, layer GLBs, true-size parts

- **Date:** 2026-09-30
- **Change type:** frontend (the MAP tab's 3D view), plus four part-library GLBs as public files
- **Ask (owner, 2026-09-30, relayed by the pieces lane):** "nav is difficult item selection is difficult. add some nav
  buttons"; the headlights, the fan and the throttle body were "wrong" in the 3D.
- **Reads:** the zone GLBs and `k5-positions.json` already on main (#458); the part-model index's per-end records. The
  part GLBs come from the part library (`~/k5-harness-pull/parts/samples/<end>/<end>.glb`, the same models the index
  lists for HEADLIGHT-L, HEADLIGHT-R, FAN and TB).
- **Unknowns:** none asserted. Two orientation choices are not sourced, and the view labels each "ORIENTATION ASSUMED"
  in the part's tag:
  - the fan's clocking about its axis;
  - the side the throttle body's electronics housing faces. The twin's `tps` anchor says "connector side on the body =
    estimate".

## Files

| File | What |
|---|---|
| `nuke_frontend/src/components/wiring/map/ZoneModels3D.tsx` | the 3D view: zones on demand, layers when published, true-size parts, navigation, picking, tag, object list (edit) |
| `nuke_frontend/src/components/wiring/map/scene3d.ts` | the tables and frames: zones, `LAYERS` (and the zone nodes each hides), `TRUE_PARTS`, views, station boxes, the part matrix (new) |
| `nuke_frontend/src/components/wiring/map/WiringMap.tsx` | passes the end positions and an Escape clear to the 3D view (edit) |
| `nuke_frontend/public/models/part-library/{HEADLIGHT-L,HEADLIGHT-R,FAN,TB}.glb` | 121, 121, 135 and 31 KB (new) |

## Navigation

- **Views:** front, rear, driver side, passenger side, top (front to the left, driver side down, as on the plan), engine
  bay, cab and rear body.
  - The first five frame what is drawn, kept inside the truck's envelope in twin metres (y from -2.97 to +1.86).
  - The zone views frame that zone's station box in twin metres and load its harness if it isn't open. The boxes use
    firewall y -1.46 and cab rear y +0.1 (the plan's stations).
- **Fit:** fit all, fit selection (an end in a zone that isn't open loads that zone first), and reset.
- **Turn, pan and zoom buttons** for trackpads: 15° turns, pans of 12% of the view, zoom ×0.75 / ×1.33.
- **Camera moves:** every move is a 0.5 s eased flight of the camera and its orbit target. The distance is fitted to the
  box's extents across the view, not to a bounding sphere.

## Selection

- **Picking:** a click casts 17 rays in a 12 px disc; hover casts 17 in an 8 px disc. Each ray takes its first visible hit, so
  what is in front still wins. The pick is the selectable hit nearest the pointer. Hover lights what a click would pick
  and names it.
- **Tag:** the picked thing carries a tag with its code and name. A true-size part adds "TRUE SIZE" and its orientation
  note.
- **Object list:** every drawn object, searchable, in four groups: true-size parts, ends, loom segments, other objects.
  A row flies there.
- **Shared selection:** the view uses the workspace's own selection (`?sel=`), so the tree, the tables and the properties
  follow it. Escape clears it.
- **Visitors:** they see results only.
  - Object names drop lane prefixes and working words ("planned", "candidate").
  - The tag shows the public name.

## Layer GLBs (from other lanes)

The view reads `LAYERS` in `scene3d.ts`:
- `k5-frame.glb` (chassis-3d). While it is shown, the zone nodes `CTX-frame-rail-web-driver` and `-passenger` are
  hidden.
- `k5-engine-ls3.glb` (engine-3d). While it is shown, the v4 twin engine's long block, intake, fuel rails and front-drive
  nodes are hidden (`E3_*`, listed by name).
  - `ENGINE_NODES_KEPT` lists the v4 engine nodes still drawn: the devices that carry a harness end, the exhaust and the
    6L90. Move a group into `hides` when a layer draws it.

Each file loads only if a HEAD request answers with something other than the site's page. Neither file is published
yet, so today nothing changes. The frame and engine geometry are those lanes' work; this change only hides the old
nodes while their files are shown.

## True-size parts

Each part is drawn at its end's spot in `k5-positions.json`. Its mount normal is set against the mounting surface and its
maker-up points up, and the placeholder nodes it replaces are hidden. The file frame is glTF Y-up of the part frame:
file (X, Y, Z) = part (x, z, -y), as each `pins.json` says.

| End | Spot | Mount normal (part +Z) → twin | Up (part +Y) → twin | Source |
|---|---|---|---|---|
| HEADLIGHT-L, -R | bucket centre (body model mesh Headlights, ±15 mm); the part origin is the flange back | -y (the lens faces forward) | +z | sourced: the bucket and the maker's up |
| FAN | the hub on the engine side of the core (harness-cad v4) | +y (toward the engine) | +z | axis sourced; clocking **assumed** |
| TB | the `tps` anchor, where the part's plug (-25, -115, 35 mm) sits | +z (bore vertical on the 4-bolt adapter at the 4150 pad, twin engine v3) | +x | bore sourced; housing side **assumed** (the anchor is an estimate) |

- **TB check:** the TB's flange centre lands at twin (0.003, -1.725, 1.113). The twin's own throttle-body base is at
  (0, -1.720, 1.108), which is within 6 mm.
- **Hidden placeholders:** `HEADLIGHT-L`, `HEADLIGHT-R`, `FAN`, and `E3_ThrottleBody_12699160` / `E3_TB_Bore` /
  `E3_TB_MotorHousing` / `E3_TB_Blade`.
- **Keep-out volumes** in the part files are not drawn.
- **GLB checks:** extras stripped, bytes scanned for `blendermcp`, `api_key`, `apikey`, `sketchfab`: clean. No
  textures or images.

## Verification

- `npm run type-check`: exit 0. It checks nothing (the root tsconfig lists no files).
- A scoped `tsc` over the changed files finds 0 new errors. The 7 in `ZoneModels3D.tsx` are R3F's untyped JSX elements
  (lights, `primitive`), the same gap `HarnessView3D.tsx` has.
- `eslint` on the changed files: 0 errors, 0 warnings.
- `npm run build`: exit 0; `check-client-secrets` is clean. Chunk sizes:
  - `ZoneModels3D` 22.2 kB (8.6 kB gzip). It loads only when the 3D view opens.
  - `WiringMap` 85.4 kB.
- Local dev server against the production database, logged out, in headless Chromium (SwiftShader WebGL):
  - each view;
  - fit all with all three zones;
  - each true-size part through the object list, and its tag;
  - hover, a click-pick at the canvas centre (picked TB);
  - Escape, which cleared the selection;
  - the turn, pan and zoom buttons;
  - fit selection on a rear end with only the bay open (it loaded the rear harness and flew there);
  - a phone at 390 px.
- Found and fixed: Escape was lost after a pick. The wiring page's own Escape handler re-rendered the view mid-event, so
  a listener re-added on every render was dropped before it ran. The listener is now added once and reads the latest
  callback.
