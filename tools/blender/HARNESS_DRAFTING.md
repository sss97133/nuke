### Harness drafting from a Blender vehicle model

This workflow lets us turn your 3D Blazer model into a **measurable harness routing plan** (clip locations, grommet centers, branch breakouts, connector targets).

## 1) Open/import the model
- Open the `.blend`, or import the `.fbx` into Blender.
- Confirm the scene is **true scale** (or note the scale you used).

## 2) Create measurable points (empties)
Create `Empty` objects at the exact locations you care about:
- firewall grommet centers
- clamp/tab points along the fender/core support/frame
- connector targets (headlights, ECU, fuse block, relays, etc.)

Naming convention:
- Marker points must start with **`HP_`**
  - Example: `HP_FIREWALL_GROMMET_MAIN`

## 3) Draw harness paths (curves)
Use Blender curve objects to represent the harness routing path(s).

Naming convention:
- Routes must start with **`HR_`**
  - Example: `HR_ENGINE_MAIN`
  - Example: `HR_FRONT_LIGHTING`

Tip:
- Keep curves close to the sheet metal surface you intend to follow.

## 4) Export CSV/JSON (measurements)
Run:
- `tools/blender/harness_draft_export.py`

This script exports:
- `exports/harness_draft_<timestamp>.csv`
- `exports/harness_draft_<timestamp>.json`

The CSV contains:
- all `HP_*` marker coordinates (world space)
- sampled points along `HR_*` curves at a fixed spacing
- cumulative distance along the route for each sample

## 5) Share back
Upload the exported CSV/JSON to Supabase Storage (or paste the content).
Once we have the exports, we can generate:
- clip spacing plan
- branch breakout distances
- total loom lengths with service loops



