---
id: 2026-09-30_map-status-line-missing-list
date: 2026-09-30
change_type: presentation (the MAP tab's first screen); no wiring value, registry, catalog, index, position file or
  database row changed
scope: nuke_frontend/src/components/wiring/map/WiringMap.tsx (the header's counts become the status line),
  MissingList.tsx (new), useWorkspaceSelection.ts (one optional field on the part-model index type)
status: PR open, not merged
author: claude-opus-5-5 (step 2 of the MAP brief, session ebc425ad)
owner_words: "its kind if like if you walk into a workshop and ALL the tools are already sitting out and ALL the parts
  are there, it doesnt really help you get started you need to ease into it case by case." (2026-09-30)
plan: docs/wiring/research/2026-09-30_map-progressive-disclosure-brief.md, §4 "First screen" and §5 step 2
---

# The MAP tab's first screen: how far along it is, and what's still missing

## What changed
- **The status line.** The header's row of counts ("229 CONNECTORS · 179 PLACED", "532 WIRES · 401 WITH BOTH ENDS",
  the loom segments and "161 OF 179 ENDS MODELLED IN 3D, 128 COMPLETE") is now one sentence in plain words:
  "161 of 179 connection points have a 3D model (128 complete). 131 of 532 wires still have an open end."
  - Its caret opens the split on click or tap (and on mouse hover, as before). The split says what each word counts:
    connection points, 3D model (with the existing shape-source table), complete, open end, loom drawn, and, for the
    owner only, decided.
  - Nothing the old row counted is lost: the line or its split carries each one. The 229 connection points on file
    read as the 179 placed plus 50 more not placed.
  - The copy says drawn and modelled only (brief §7): the records don't say more.
- **"What's still missing"**, a new list directly under the status line and above the workspace, grouped by system in
  the page's section order. Each group header gives its count and its split by kind.
  - Each item names the thing and what closes it, e.g. "KNOCK-1 · Knock sensor, bank 1 · No 3D model: dimensions not
    on file", or "#ETH_RX+ · Ethernet RX+ · Open end: PORT-ETH — cavity not on file".
  - Clicking an item selects it through the workspace's own selection (`useSelection`, `?sel=n:<code>` or
    `?sel=w:<code>`), so the tree, the plan, the 3D, the tables and the properties follow it.
  - Groups fold, and the whole list hides with one button (not remembered, so the next visit opens on it). On a
    desktop the list scrolls inside 34% of the screen height; on a phone, 60%.
- **Unchanged:** the owner gate, the NEEDS YOU strip, the tree, the centre views, the tables, the properties, the
  colourways and the legacy tabs.

## How each count is made (only from what the page already reads)
| Count | From | 2026-09-30 |
|---|---|---|
| Connection points | the ends in `public/wiring/k5-positions.json` (generated 2026-09-29) | 179 |
| With a 3D model | `public/wiring/part-models/index.json` (generated 2026-09-29): the end has at least one model (`coverage()`, as before) | 161 |
| Complete | the index's `ends[code].complete` | 128 |
| Wires | `vehicle_custom_circuits`, live rows | 532 |
| Open end | fewer than two ends in the wire's chain: its `wire_termination_specs` rows at live `harness_endpoints`, else its from/to links. The same test as the old "WITH BOTH ENDS" (401) | 131 |

The list has 18 + 33 + 131 = 182 items, so it reconciles with the line: 179 − 161 with no model, 161 − 128 not complete,
and the 131 open ends. The 50 connection points on file that aren't placed (all concept rows) are not counted, and the
split says so.

## What closes each item
- **No 3D model / 3D model not complete** read the index's own `missing` note on the end. Four patterns, first match
  wins:
  - gauge unknown → "wire gauge not on file";
  - not picked, or not named in the registry → "part not chosen yet";
  - dimension, drawing, size or thread not given → "dimensions not on file";
  - part number not recorded → "part number not on file".

  A note that reads "as KNOCK-1" follows KNOCK-1's note, and a note that matches none of these reads "not modelled
  yet". An incomplete end names each missing piece before its gap ("heat-shrink cap for each stub splice — part not
  chosen yet"). BRAKE-WARN-SW is placed but not in the index, so it reads "not in the part-model index yet".
- **Open end.** The open side is the side that the one end on file isn't on.
  - It reads "cavity not on file" when that side links to a live connection point but has no wire-end row.
  - It reads "connection point not on file" when its link is empty, or points at a row that isn't live.
  - It reads "both ends (from → to) — connection points not on file" when neither end is on one.
  - End names are the wire's own from/to words.
- **Names** are the public names the workspace already uses (`publicName`, `mask`), so there are no amounts, order
  numbers or buying story.

| Kind | What closes it | Items |
|---|---|---|
| No 3D model (18) | dimensions not on file | 13 |
| | part not chosen yet | 3 |
| | part number not on file | 1 |
| | not in the part-model index yet | 1 |
| 3D model not complete (33 ends, 40 missing pieces) | part not chosen yet | 28 |
| | dimensions not on file | 7 |
| | wire gauge not on file | 3 |
| | part number not on file | 1 |
| | not modelled yet (PS-STUDS: the AMP Research kit's own ring) | 1 |
| Open end (131) | connection point not on file (one end) | 70 |
| | both ends not on a connection point | 51 |
| | cavity not on file (one end) | 10 |

## Owner layer (the existing gate, nothing new)
- The gate is `useVehiclePermissions`'s owner check, plus the existing dev-only `?asOwner=1` preview. A build never
  honours the preview (`import.meta.env.DEV`).
- **Visitors** see the status line, the list and the short phrases.
- **The owner** also sees:
  - the index's full note under the selected item (the why and its sources);
  - the split's "DECIDED (OWNER)" row (394 of 532 on 2026-09-30), which replaces the old header's owner-only
    DECIDED count.

## Findings for the registry pass (not changed here)
1. **Concept wires and retired ends.** 115 of the 131 open-end wires are concept rows (BC-W…, dash-cabin-W…, LF-W…,
   LR-W…, PTC-W…, ENG-W07x).
   - Their links point at 89 distinct `harness_endpoints` rows, all superseded, all in the same design. This was read
     by id through the public API, logged out, on 2026-09-30.
   - Relinking those wires to the live connection points, or retiring them, closes most of the list.
2. **The 16 decided wires with an open end:**
   - Ten have no wire-end row at the far end:
     - G1 and G2 at GND-BANK-ENG;
     - UTC_CANH and UTC_CANL at PORT-UTC;
     - ETH_RX± and ETH_TX± at PORT-ETH;
     - IBST_CAN_H and IBST_CAN_L at IBST-DIAG.
   - #6, #59, G3 and ISO_OUT run stud to stud on PS-STUDS. Each has one wire-end row (its cavity reads
     "stud, lug … + …") and no link for its second end.
   - #126's dash-button end and COIL_GND's engine-block end have no link.
3. **BRAKE-WARN-SW** is in `k5-positions.json` but not in the part-model index of 2026-09-29, so the index needs a
   rebuild after the 2026-09-30 brake-warn receipt.
4. **From/to text.** Some `from_component` / `to_component` values are a record written as text
   (`{'device': …, 'pin': …, 'terminal': …}`). The list reads the device and pin out of them; structured fields
   would be cleaner.

## Unknowns
None. The change counts the records as they are and asserts no wiring value. Every phrase comes from a record or from
the index's own note.

## Verification
- **`cd nuke_frontend && npm ci && npm run type-check && npm run build`:** all exit 0. `check-client-secrets` is clean
  (source and dist).
  - `type-check` checks nothing (the root tsconfig lists no files).
  - A scoped `tsc` over the changed files finds 0 errors in them. The 10 it reports are in files this change doesn't
    touch: `ZoneModels3D.tsx` (R3F's untyped JSX) and `MountsPanel.tsx` (untyped JSON).
- **`eslint`** on the changed files: 0 errors, 0 warnings.
- **Chunk sizes:** `WiringMap` 92.7 kB (was 85.7), `WiringPlan` 45.0 kB (unchanged).
- **Local dev server against production, logged out, headless Chromium at 1440 × 900 and 390 × 844:**
  - The status line reads the sentence above.
  - The list header reads 182 (18 without a 3D model, 33 with a model not complete, 131 wires with an open end).
  - It shows 8 groups: POWER + GROUNDS 17, ENGINE 22, COMMS 1, DASH / CABIN 41, BODY 40, LIGHTING FRONT 16,
    LIGHTING REAR 21, POWERTRAIN / CHASSIS 24.
  - All 182 rows were read one by one.
  - KNOCK-1 → `?sel=n:KNOCK-1`: the row is lit, and the properties show the connector with "NO 3D MODEL YET".
  - #ETH_RX+ → `?sel=w:ETH_RX+`, and the plan lights its route.
  - The split opens on click, and on tap on the phone.
  - Hide empties the list and show brings back all 182.
  - On the phone the page is 390 px wide with no sideways scroll.
  - The page text has 0 "$", 0 "COST" and 0 "M150". No owner note and no NEEDS YOU show logged out.
  - The owner preview shows the index note under the selected item and the DECIDED row.
- **Vercel preview for the branch, logged out:** the result is in the PR description.
