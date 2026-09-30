# Receipt — MAP tab as one engineering workspace (results for everyone, records for the owner)

- **Date:** 2026-09-29
- **Change type:** frontend layout, read-only view over the typed rows plus the vehicle's public design files
- **Ask (owner, 2026-09-29, relayed by the pieces lane):** "imagine a zuken engineer looks at the software and data
  presentation"; "the only thing a real other human may see is the results not the in process slop"; "if a part
  doesnt have its 3d then the endpoint isnt complete". The lead approved the scope on 2026-09-29 (the port section of
  `docs/wiring/calc-data/layout/HANDOFF.md` on `wiring/layout-ui`): the MAP tab only.
- **Data it reads:** the typed rows through `useWiringMap` (unchanged; public read for public vehicles), and three
  public files, each checked against the vehicle id it carries:
  - `nuke_frontend/public/wiring/k5-positions.json`: 179 end positions with margins, part footprints and cavity faces.
  - `nuke_frontend/public/wiring/k5-routes.json`: 316 loom segments with outer diameter, length ± margin and wires.
  - `nuke_frontend/public/wiring/part-models/index.json`: the part-model index already on main (#445, #443). The
    page reads it as served; no count is copied into code.
- **Unknowns:** none for this change. The page asserts no spec, gauge, pin or position of its own; it draws the rows
  and files as they are. What they leave open shows as open ("ENDS PENDING", "NO 3D MODEL YET", "NOT DECIDED").

## Route

`/vehicle/:id/wiring?tab=map`. Deep links: `&view=plan|3d|face|sch|lib&sel=<id>` with `n:<connector>`, `w:<wire>`,
`p:<connector>|<cavity>`, `s:<segment>`, `d:<device>`, `y:<section>` and `k:<call>`. The older `&node=` and `&call=`
still open.

## Files

| File | What |
|---|---|
| `nuke_frontend/src/components/wiring/map/WiringMap.tsx` | the workspace frame: headline counts, tree, one centre view, properties, linked tables; phone stacks the panes and opens the tree as a drawer; the owner's layer (edit) |
| `.../map/useWorkspaceSelection.ts` | public files (by vehicle id), an index over the rows, the selection in the URL, what each selection links to, 3D coverage, masking (new) |
| `.../map/WorkspaceTree.tsx` | harness section, then device, then connector, then cavity, with search; opens to the selection (new) |
| `.../map/WorkspaceViews.tsx` | the plan (looms at true outer diameter, parts at true size and colour) and the connector face (new) |
| `.../map/ZoneModels3D.tsx` | harness-cad's routed harness by zone (engine bay first), loaded only when the 3D view opens (new) |
| `.../map/SchematicBlock.tsx` | a section's schematic: sources, pass-throughs, loads (new) |
| `.../map/PartLibrary.tsx` | every part in the part-model index (185 after #443): maker, maker part number, source of shape, size, ends (new) |
| `.../map/WorkspaceTables.tsx` | wire list, pin list, connectors; calls and decisions for the owner (new) |
| `.../map/WorkspaceProps.tsx` | the selection's attributes: 3D model, part number, position, wires, route (new) |
| `.../map/ownerLayer.ts` | `needsOwner(call)`: the one rule for which calls are the owner's (new) |
| `.../map/MountsPanel.tsx` | `WhereOnTruck` takes `showWhy` and `showStatus`, and `DevicePhoto` takes `captionOf`: reasons, sources and the status pill show to the owner only (edit) |
| `nuke_frontend/src/pages/vehicle-profile/WiringWidgetLink.tsx` | a visitor's link from the profile to the MAP tab, with the wire count; renders nothing without wiring rows (new) |
| `nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx` | shows that link to anyone the owner tools are hidden from (edit) |
| `nuke_frontend/src/pages/WiringPlan.tsx` | the tab bar scrolls sideways on a phone, so the MAP tab is reachable (edit) |
| `nuke_frontend/public/models/k5-harness-v4-{bay,cab,rear}.glb` | 8.6, 6.5 and 2.5 MB (new) |
| `nuke_frontend/public/wiring/k5-positions.json`, `k5-routes.json` | 53 KB and 121 KB (new) |

The two JSON files and the GLBs are written by the layout builder's `--export-site` step
(`docs/wiring/calc-data/layout/export_site.py` on `wiring/layout-ui`) from main's rows, harness-cad's routes and the
part-model index. TODO: the end positions move into `harness_endpoints` in the next registry pass.

## Who sees what

- **Everyone:** the tree, the five views, the properties, the wire list, the pin list, the connectors and the 3D
  coverage. Names are shown without their buying story (`publicName`: where a part was lined up, what it cost, when
  it was ordered and through whom are cut), and amounts, order and listing numbers are masked where text is drawn.
- **The owner only** (`useVehiclePermissions(...).isOwner`, the profile's `isRowOwner`): the NEEDS YOU strip, the
  calls and decisions table, and the records card on a connector, wire or call (proof ladder, evidence, rule checks,
  notes, sources), the proof rollup, and where each box goes with its reasons. The profile's other flag,
  `vehicle.ownership_verified`, is not used: it belongs to the vehicle, not the viewer, so it would open the owner's
  layer to a logged-out visitor.
- **Status words are the owner's; results are public.** A visitor sees no decision status anywhere:
  - no WHERE ON THE TRUCK status pill;
  - no decided/concept on a wire;
  - no DECIDED counts in the strip, a section, or the at-rest table;
  - no ENDS PENDING, and no ENDS column in the wire list;
  - no dashed concept wires on the schematic.

  Names, device names, photo captions and cavity labels also drop status asides and clauses: "(CANDIDATE)",
  "— the candidate", "locked 2026-05-14", ", candidate alternative to …".
- **NEEDS YOU keeps only the calls the owner makes.** That is kinds money, hands, legal and credentials
  (`ownerLayer.ts`, `needsOwner`). Owner 2026-09-29: "engineering calls are made by the system". The rows still carry
  engineering kinds (architecture 62, part_choice 4, placement 2, policy 1), so the strip shows nothing until the
  reclassify pass writes the owner's kinds.
- `?asOwner=1` previews the owner's layer on the dev server only (`import.meta.env.DEV`). The production bundle does
  not contain it.

## 3D coverage

The page reads main's part-model index as served, so the count moves as part batches merge. At main `b69bb0fec`
(after #456) it reads "161 of 179 ends modelled in 3D, 126 complete". Each end counts once, at the weakest source of
shape among its models, so an assumed shape never counts as a sourced one.

- The index carries its own split (`ends_by_shape_basis`), and the page shows it:
  - maker drawing 40;
  - datasheet dims 36;
  - scaled from photo 39;
  - twin object 11;
  - not sourced 35.
- That is 115 ends from a sourced shape and 46 from an assumed one. 18 ends have no model yet.
- The same split, computed from the index's parts, matches. The page computes it that way only when the index doesn't
  carry one.
- "Complete" means the index lists nothing missing for the end.

## Privacy checks on the public files

- The JSON files and the GLB JSON chunks were scanned for `$` amounts, "order", "invoice", eBay and Amazon, "seller",
  email addresses and people's names: 0 hits.
- The GLB node extras keep only `id`, `endpoint`, `route`, `members` and `od_mm`. The `status` and `model` notes
  were dropped, because one of them named a person.
- The GLB bytes were scanned for `blendermcp`, `api_key`, `apikey` and `sketchfab`: 0 hits. Each GLB is under 10 MB.
- 14 live node names in `harness_endpoints` carry purchase stories: prices, vendors, order dates, and in one case a
  person's name. The page cuts these when it draws, but the rows themselves are public. They should be superseded
  with plain names through the sanctioned writer, and the story kept as observations.

## Scope notes

- **No `faceFromRows.ts`.** The connector face is drawn from the part models' cavity coordinates in
  `k5-positions.json`, or as a cavity list when a connector has none. `FaceSkin` stays as it is on the CONNECTORS
  tab, because its model covers only 4 connectors of the older derivation.
- **The wiring page still opens on FORMBOARD.** The profile link goes straight to `?tab=map`.

## Known gaps (shown, not hidden)

- Wires whose ends wait on `wire_termination_specs.wire_number` becoming nullable show "PENDING". No ends are made up.
- A cavity's working note (for example "pin order OPEN until …") is cut from its label. The note stays on the row.
- R3F's JSX elements (the lights, `primitive`) are untyped in this repo's TypeScript setup, the same as in
  `HarnessView3D.tsx`.
- The 3D view frames the whole zone, so it opens small. It does not zoom to the selection yet.

## Verification

- `npm run type-check`: exit 0. This script checks nothing (the root tsconfig lists no files). A scoped
  `tsc --noEmit` over the changed files and what they import finds 137 errors:
  - 5 in `ZoneModels3D.tsx`. These are R3F's untyped JSX elements, the same gap that gives `HarnessView3D.tsx` 36.
  - 0 in the other new files.
  - 132 in files this change does not touch, or on lines it does not touch.
- `eslint` on the MAP folder and `WiringWidgetLink.tsx`: 0 errors. There are 2 warnings, both hardcoded `#fff` on
  untouched lines of `MountsPanel.tsx`.
- `npm run build`: exit 0; `check-client-secrets` is clean. Chunk sizes:
  - `WiringPlan` 44.5 kB (14.0 kB gzip).
  - `WiringMap` 85.1 kB (26.2 kB gzip).
  - `ZoneModels3D` 2.8 kB. It pulls three.js only when the 3D view opens.
- Local dev server against the production database, logged out and as the owner preview:
  - desktop 1600 × 1000 and phone 390 × 844;
  - the plan at rest and with a selection, 3D engine bay, connector face, schematic, library, the coverage split and
    the pin list;
  - the owner's calls table with a call's card;
  - the profile's visitor link, which opens the MAP tab.
- The counts above were recomputed from the files with a separate script, and they match.
- Status scan: 13 views logged out, reading the page text plus the SVG titles and labels. It found:
  - 0 status words (decided, concept, pending, proposed, candidate, locked, needs you, open calls and the rest);
  - 0 dashed schematic wires.

  The same 13 views as the owner show them.
- The screenshots stay local, because the owner frames show his records.
