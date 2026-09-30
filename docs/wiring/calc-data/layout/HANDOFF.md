# K5 Harness Layout: the workspace builder

**Live:** https://claude.ai/artifact/QVLCDvWkF2XJ6DABBodakh, version 20 (2026-09-30), private to the owner. The nuke.ag MAP-tab port is merged and live (#458): https://nuke.ag/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring?tab=map. The next export regeneration ships the status-word scrub (eb8213f25).
The Parts Library, M130 Sample Review and K5 Engine Bay Sample pages are now one-line pointers to it.

**Lane:** layout-ui. **Paused 2026-09-29:** the slot went to the BaT data audit. The pieces lane resumes this lane, first in line.

## Where it stopped

- **Version 13 is live** (2026-09-29): the two fixes the pieces lane asked for are in (tape items off "Needs you"; listing ids never shown as part numbers).
  - Builder: branch `wiring/layout-ui`, 17e12ff14.
  - Screenshots went to the pieces lane (`shots_ws/` in the lane scratchpad). Its go is still pending.
  - To publish: `python3 build.py`, then publish `site/k5_layout.html` to the URL above with `root=site`, passing every file under `site/`.
- **What v13 adds over v12:**
  - Manual view (first tab): each system laid out as a GM service-manual section.
  - Library and 3D completion from `nuke_frontend/public/wiring/part-models/index.json`, read from the audited branch first, then main. That is 47 parts; 23 of 179 ends are modelled.
  - Pins scoped to each end's own pins.json, only the half its wires land on.
  - A quiet "data on this vehicle" panel (read-only database counts, taken at build time).
  - A "needs you" strip with money and hands items only.
  - The firewall plan from #436 as the design state, labelled "proposed, recount pending".
  - Results, not process: no agent names, proposal pills or check counts in the main view.
  - Nuke design-book styling: Arial, Courier New, 2 px borders, square corners.

## Design notes: the service-manual model (owner, 2026-09-29)

- **No page budget.** Each system gets everything a technician needs, at whatever length that takes.
- **Every page is pertinent and well made:** figure, callouts, tables and procedure, with no filler.
- **Built so far:**
  - contents;
  - a general description built only from the data;
  - Fig. n-1 with numbered callouts;
  - the component legend;
  - connector identification: end view, then a CAV/CKT/WIRE/FUNCTION/TO table;
  - the circuit tabulation.
- **v14 (live as version 15, published by the pieces lane):** diagram boxes now size to their text (capped per column), labels and box titles wrap to two lines instead of being cut, a label still longer than two lines shows in full on hover, a cavity named in words is written into its label, and the power-feed circuits carry wire names. Plus, as built by this lane: the wiring diagram, power feeds (pdm_settings), splices, harness specifications per bundle, connector service (terminals, seals, tools by family) and a special-tools plate, plus contents with real page numbers.
- **Still to add:** procedure pages. These are the service steps for each system, from the records: build, test and diagnosis. Where no record exists yet, the procedure is left out rather than written up.
- **One click-through pattern, everywhere:** a click selects. The selection is filled; what links to it is outlined.
- **Photos** show only when they are the exact part.

## The nuke.ag port: approved, waiting for a slot

The lead approved the scope on 2026-09-29. The port goes into the MAP tab only. Don't code until the pieces lane gives the slot.

**Scope:**
- `nuke_frontend/src/components/wiring/map/WiringMap.tsx`: its layout becomes tree, one centre view, properties, linked tables.
- New files beside it:
  - WorkspaceTree.tsx
  - WorkspaceTables.tsx
  - WorkspaceProps.tsx
  - useWorkspaceSelection.ts
  - ZoneModels3D.tsx
  - SchematicBlock.tsx
  - PartLibrary.tsx
  - faceFromRows.ts
- Reused as they are: useWiringMap, useWiringFacts, MountsPanel, PartPhotos, DevicePhoto, WhereOnTruck, ConnectorFaces, FaceSkin, planGeometry, colorways.
- Public files:
  - `public/models/k5-harness-v4-{bay,cab,rear}.glb`: each under 10 MB and scanned for credential strings.
  - `public/wiring/k5-routes.json` and `public/wiring/k5-positions.json`, written from main by `export_site.py` in this folder.

**The lead's answers:**
1. **Rows:** reloaded from main at 8dea1962a.
   - 229 live K5 nodes, BRAKE-WARN-SW included; 7 wires inserted; 44 option rows.
   - Ends for the new wires are held until `wire_termination_specs.wire_number` is nullable. Show those wires with ends pending. Never fabricate ends.
2. **Positions:** ship k5-positions.json now. TODO: move positions into harness_endpoints in the next registry pass.
3. **Tree:** the rows' 8 harness sections.
4. **3D:** open on the 2D plan and fetch each zone GLB on click, bay first.

**The owner's condition:** "the only thing a real other human may see is the results not the in process slop".
- The "needs you" strip, open items, decisions and sources show only to the logged-in owner. Use the profile's existing owner check; don't invent one.
- Logged out, the page shows results only: tree, views, wire and pin lists, coverage.
- Public JSON carries no prices. Free text from the rows is masked when drawn.

**Done means:**
- typecheck and build clean;
- a wiring receipt for this folder (`.claude/rules/wiring-receipt.md`);
- local screenshots of every view plus phone, logged in and logged out.

Then the lead merges and checks it live, logged out.

## Build and check

```
python3 build.py            # snapshots inputs into in/, writes site/k5_layout.html plus site/{v,ph,3d,lib}/
python3 shot_ws.py shots_ws # headless screenshots: manual, every view, dark, phone, data panel
python3 test/interact.py    # clicks through every pane and reports page errors
```

**Inputs:**
- pieces lane: ends.py, pos.py, footprints.py, anchors.json.
- main: k5_registry.json, part_media.yaml, mounts.yaml, parts.yaml, tape_list.yaml, the suppliers files.
- part-model index: the audited branch first, then main.
- harness-cad: routes.json and the bay GLB.
- parts-artist: the samples (GLB, pins.json, params.json).
- this lane: sizes.py, which holds the names, the needs-you items, the firewall plan and the bay findings.

**Guards on every build:**
- Every GLB is scanned for credential strings.
- Order numbers, and marketplace listing numbers named beside an order, are masked.
- Prices stay only in the cost fields.
