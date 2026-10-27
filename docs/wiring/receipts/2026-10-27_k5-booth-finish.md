# K5 firewall, core support and inner fender: the finish as the cab left the paint booth (2026-10-27)

Amends: `2026-10-26_k5-firewall-3d.md`, `2026-10-26_k5-core-support-3d.md`, `2026-10-26_k5-inner-fender-sds.md` (materials
only; no geometry changed). Owner's ask, 2026-10-27: "make it look like the videos i sent when it was in the paint booth".

## What changed
1. **Firewall paint** (`firewall_blender.py`, material `firewall_paint`): base colour linear (0.235, 0.048, 0.042), metallic
   0.15, roughness 0.48, clear coat 1.0 at roughness 0.04 (was (0.20, 0.035, 0.04), metallic 0, roughness 0.42, coat 0.3
   at 0.2). Exported as `KHR_materials_clearcoat`, which the MAP viewer's loader turns into a physical material.
2. **Core support and inner fender** (`core_support_blender.py` material `gloss_black`, `inner_fender_sds.py`
   `gloss_black`): gloss black, base (0.016, 0.016, 0.017), roughness 0.32, clear coat 0.8 at 0.08 (were satin dark grey
   0.11-0.13, roughness 0.35-0.38). Rubber cushions unchanged.
3. **Viewer reflections** (`ZoneModels3D.tsx`, `Studio`): the reflection environment is now a paint booth built in the page
   (`boothScene`): a 7 x 9 x 3.6 m light-grey room, white ceiling with three rows of six fluorescent panels, a slanted
   panel row where the ceiling meets each wall, tall wall panels, a low panel row 0.55 m off the floor, light concrete
   floor and a dark filter wall at the far end. It replaces three's `RoomEnvironment` (studio, intensity 0.85); the key
   and fill lights drop from 1.6 / 0.5 to 0.7 / 0.25 and ambient from 0.15 to 0.05 so the booth does the lighting.

## Sources
- The owner's clips of the cab in the booth, 2025-02-08 15:31 to 17:42 and 2025-02-09 12:35 to 14:33 PT (iPhone 15 Pro,
  his Photos library, iCloud originals; 16 short clips fetched with osxphotos, not committed): sealer, base and clear
  stages; the clear-coat passes IMG_4396 to IMG_4410 are the reference for the finish. Still frames in
  `scratchpad/sm/ref/booth/`.
- The same session's photos already in Nuke, `vehicle_images` for vehicle `e08bf694-970f-4cbe-8a74-8715158a0f2e`,
  stage `clearcoated` / `primed` (ids a2be14e6, 60924f16, db145c89, 0e4bbfa4, 3bf4b9cc and their re-uploads), taken
  2025-01-16 and 2025-01-24, the bed, doors and hood in the same booth.
- Paint colour: pixels of the firewall face in IMG_4410 (frame at 3.6 s, 1080 x 1920) that read red; by brightness decile,
  darkest tenth sRGB (55, 19, 23), middle (140, 79, 72), brightest tenth (197, 152, 139); in linear light (0.038, 0.007,
  0.008), (0.262, 0.078, 0.065), (0.556, 0.314, 0.258). The base colour is set a little under the middle so that the booth
  light on it lands near the middle; the brightest tenth is the clear's reflection of the panels, not pigment.
- Booth layout: owner-cab 03-13 and the clips (ceiling panel rows, slanted corner rows, tall wall panels, filter wall,
  green glass-block wall on one side). The low wall row is an **assumption** (not visible in the clips, see Unknowns).

## Check
Local build of the MAP tab, logged out, ENGINE BAY view with INNER FENDER, FIREWALL and CORE SUPPORT switched on through
MORE: `scratchpad/sm/out/booth/local4.png` (wide) and `local4z.png` (zoomed), 22 model files at 200, 0 console errors.
Live check after deploy with `scratchpad/sm/live-map-shot.mjs`.

## Unknowns
- **Core support and inner fender colour on the truck**: gloss black is the lead's read of the owner's bay photos (the
  loose repro skirt is black e-coat; the mounted support reads black). If they are body colour, the two `gloss_black`
  materials take the firewall values. Needs: the owner's word or a photo of the painted support.
- **Metallic flake** cannot be carried in glTF; metallic 0.15 under the clear is the stand-in. Needs nothing; a design
  limit.
- **Wet vs cured clear**: the clips show the clear minutes after spraying (roughness near 0). Cured and buffed clear is
  close to that; orange peel is not modelled.
- **Low wall light row**: assumed so a vertical face mirrors a bright row from the viewer's elevated camera, as the
  clips' low camera sees the ceiling rows. Needs: nothing for the look; a photo of the booth's lower walls would settle
  whether it is real.
