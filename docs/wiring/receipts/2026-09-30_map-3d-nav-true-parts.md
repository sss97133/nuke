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

The owner said on 2026-09-30 that the site nav "is overwhelming". So the 3D view's own controls stay minimal and
contextual, inside the 3D view only.

- **Always shown:** one compact picker (FRONT · SIDE · TOP · ENGINE BAY), FIT, MORE and OBJECTS. FIT fits the
  selection, or everything drawn when nothing is selected.
- **Behind MORE:**
  - the other views (REAR, OTHER SIDE, CAB, REAR BODY) and RESET;
  - the harness zones;
  - the layers that are published;
  - turn, zoom and pan buttons for trackpads (15° turns, zoom ×0.75 / ×1.33, pans of 12% of the view);
  - the help line.
- **The object list** stays shut until OBJECTS is pressed.
- **Framing:**
  - Front, side, top and the other direction views frame what is drawn, kept inside the truck's envelope in twin
    metres (y from -2.97 to +1.86).
  - The zone views frame that zone's station box in twin metres and load its harness if it isn't open. The boxes use
    firewall y -1.46 and cab rear y +0.1 (the plan's stations).
  - The first view and RESET frame the open zones.
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

`LAYERS` in `scene3d.ts` is one table. Each file loads only if a HEAD request answers with something other than the site's
page, and each is drawn as published: twin metres, glTF Y-up, the zones' frame.

| Layer | File (lane) | Zone nodes hidden while it is shown |
|---|---|---|
| FRAME | `k5-frame.glb` (chassis-3d, #470) | `CTX-frame-rail-web-driver`, `CTX-frame-rail-web-passenger` |
| SHEET METAL | `k5-front-sheetmetal.glb` (chassis-3d, #470) | `CTX-core-support-face`, `CTX-firewall-face`, `CTX-inner-fender-wall-driver`, `CTX-inner-fender-wall-passenger` |
| ENGINE | `k5-engine-ls3.glb` (engine-3d, #468) | every `E3_*` node except `E3_Starter_DFSR-8715`, `E3_Starter_Solenoid` and `E3_FuelPressReg_asbuilt` (the new engine has no starter or regulator) |

- The harness pass-through runs (`FIREWALL-ENGINE_seg*`, `FIREWALL-CABIN_seg0`) are never hidden.
- The MAP tab doesn't load `k5-blazer.glb`, so its `Under_Frame_Blazer` needs no entry.
- Those lanes' geometry is untouched; this change only hides the old nodes while their files are shown.
- Tested with the three files from #468 and #470, copied locally and not committed.

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
- **On the engine layer:** when the engine layer is drawn, the TB stands on that GLB's `tb_flange` node instead. That is
  twin (0, -1.640, 1.1077), the adapter top 25 mm over `intake_4150_pad`, with the bore along the node's +Y. The tag says
  so. That flange is 85 mm aft of the `tps` anchor the harness is routed to. For the next registry pass, the engine
  lane's TB position and the harness end need to agree.
- **Hidden placeholders:** `HEADLIGHT-L`, `HEADLIGHT-R`, `FAN`, and `E3_ThrottleBody_12699160` / `E3_TB_Bore` /
  `E3_TB_MotorHousing` / `E3_TB_Blade`.
- **Keep-out volumes** in the part files are not drawn.
- **GLB checks:** extras stripped, bytes scanned for `blendermcp`, `api_key`, `apikey`, `sketchfab`: clean. No
  textures or images.

## Wiring page (approved additions, 2026-09-30)

- **The shown tab is in the URL.** Switching tabs writes `?tab=<name>` as a replace (no new history entry), so the
  owner can link to and reload a tab.
  - It is written through the router, so the MAP tab's own `?sel=` writes keep it.
  - A visitor's `?tab=formboard` reads back as `?tab=map`.
  - The visitor gate itself is the lead's (#469). It is unchanged apart from a dev-only `?asOwner=1` preview for the
    owner screenshots. `import.meta.env.DEV` guards it, so a build never honours it.
- **The coverage split** ("N OF 179 ENDS MODELLED IN 3D ▾") opens on click and tap as well as mouse hover. A tap outside
  closes it.
- **The page lands at the top** (`scrollTo(0, 0)` on mount), so the site header stays in view.

## Verification

- `npm run type-check`: exit 0. It checks nothing (the root tsconfig lists no files).
- A scoped `tsc` over the changed files finds 0 new errors. The 7 in `ZoneModels3D.tsx` are R3F's untyped JSX elements
  (lights, `primitive`), the same gap `HarnessView3D.tsx` has.
- `eslint` on the changed files: 0 errors, 0 warnings.
- `npm run build`: exit 0; `check-client-secrets` is clean. Chunk sizes:
  - `ZoneModels3D` 22.8 kB (8.9 kB gzip). It loads only when the 3D view opens.
  - `WiringMap` 85.7 kB; `WiringPlan` 45.0 kB.
- Local dev server against the production database, logged out, in headless Chromium (SwiftShader WebGL):
  - each view;
  - fit all with all three zones;
  - each true-size part through the object list, and its tag;
  - hover, a click-pick at the canvas centre (picked TB);
  - Escape, which cleared the selection;
  - the turn, pan and zoom buttons behind MORE;
  - fit selection on a rear end with only the bay open (it loaded the rear harness and flew there);
  - a phone at 390 px;
  - the visitor tab bar (MAP only), `?tab=formboard` rewritten to `?tab=map`, and the page at scroll 0;
  - the coverage split opened by a click and by a tap;
  - the owner preview: every tab, each switch writing `?tab=`, and a reload keeping it.
- The MAP tab's text, logged out, has 0 "$", 0 "COST" and 0 "M150".
- Found and fixed: Escape was lost after a pick. The wiring page's own Escape handler re-rendered the view mid-event, so
  a listener re-added on every render was dropped before it ran. The listener is now added once and reads the latest
  callback.
