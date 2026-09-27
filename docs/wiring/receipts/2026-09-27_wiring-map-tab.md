# Receipt — Wiring MAP tab (every wire end, one target at a time)

- **Date:** 2026-09-27
- **Change type:** frontend feature, read-only view over typed rows
- **Ask (owner, 2026-09-27):** "a visual map where me and an ai can work on a per target basis so that context
  stays per unit but we can leave things open ended ... the calls not made become part of that incomplete endpoint
  map" and "it belongs as rows and columns not raw text". Approved plan, build step 2: the map reads rows, draws
  plugs and calls with status colours, and opens the target card.
- **Data it reads:** `supabase/migrations/20260927030100_wiring_map_typed_rows.sql` (#348) and
  `20260927040100_wiring_map_supersession_keys.sql` (#349). Live rows only (`is_superseded = false`). Public read
  for public vehicles, as the rest of the wiring page.

## Route

`/vehicle/:id/wiring?tab=map`, the 8th tab on the existing wiring page. Deep links: `&sec=<section>&node=<code>&call=<slug>&cw=<colorway>`.

## Files

| File | What |
|---|---|
| `nuke_frontend/src/components/wiring/map/useWiringMap.ts` | reads plugs (`harness_endpoints`), wires (`vehicle_custom_circuits`), wire ends (`wire_termination_specs`), calls (`wiring_decisions` + alternatives + links) (new) |
| `nuke_frontend/src/components/wiring/map/WiringMap.tsx` | the tab: section strip with rollups, plan with plugs at twin positions, open calls, unplaced plugs, target card (new) |
| `nuke_frontend/src/components/wiring/planGeometry.tsx` | the truck plan projection + outline, moved out of PlanView2D so both views draw the same truck (new) |
| `nuke_frontend/src/components/wiring/PlanView2D.tsx` | uses planGeometry; behaviour unchanged (edit) |
| `nuke_frontend/src/pages/WiringPlan.tsx` | MAP tab (key 8); unused `WireSpec` import dropped (edit) |
| `nuke_frontend/src/components/wiring/connector-inspector/useBuildState.ts` | reads and writes the live wire row only, now that superseded rows share a circuit code (edit) |

## What the screen shows

- **Section strip:** per harness section, plugs done / total and wires (concept count). TRUCK shows all.
- **Plan:** each placed plug at its digital-twin position. Filled = decided, outline = concept; border colour =
  work status. Clusters fan out; one label per cluster.
- **Open calls:** the 8 `wiring_decisions` rows with a `decision_kind`, with option counts.
- **Not placed yet:** plugs with no position, per section.
- **Target card (plug):** type, status, who, position source, part/kit, note, source + trust; every wire at the
  plug, found through its wire ends (so an ECU-to-device wire through the 61-pin appears at the device) with its
  path M130/PDM → firewall → device, the cavity at this plug, and the evidence (paper, lined up / bought /
  installed) on click.
- **Target card (call):** options (not ranked until the placement step), what it is coupled with.

## Known gaps (shown, not hidden)

- The header strip (DEVICES / WIRES / LENGTH / COST) comes from the older overlay compute, not these rows, and
  disagrees with them. Not changed here.
- April concept wires overlap some engine-harness wires (e.g. `ENG-W052 CRANK_SIG-` and `#99g crank 0 V` at CKP).
  Each shows as its own row; settling which is which is per-target work.
- Placement options carry no cost or rank yet (build step 4).
- 189 of 220 plugs have no position.

## Verification

- `tsc --noEmit`: 0 errors. `eslint` on the changed files: 0 errors, 5 warnings (3 fast-refresh notes on
  planGeometry's shared constants, 2 hardcoded colours already in WiringPlan). `npm run build`: built in 11.93s,
  `WiringMap` chunk 17.28 kB.
- Local dev server against the production database, logged out:
  - TRUCK: 220 plugs, 8 open calls.
  - ENGINE: 3/47 plugs done, 137 wires (33 concept).
  - CKP card lists #99 crank signal (cavity 1), #99g crank 0 V (cavity 2) and #99r crank 6.3 V (cavity 3), each on
    the path M130-B → FIREWALL-CABIN → FIREWALL-ENGINE → CKP, plus the April concept `ENG-W052`.
