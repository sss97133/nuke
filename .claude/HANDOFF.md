# Handoff — Wiring Harness Builder

## What Was Built

Complete visual wiring harness builder for vehicle electrical layouts. Full implementation across 5 sprints:

### Database (applied to production via Supabase migration)
- 6 new tables: `harness_designs`, `harness_sections`, `harness_endpoints`, `harness_templates`, `electrical_system_catalog`, `motec_pin_maps`
- Extended `wiring_connections` with 13 new columns (from/to endpoint IDs, calculated gauge, voltage drop, fuse rating)
- Seeded: 46 electrical systems, 104 MoTeC pin maps (M130 60-pin, PDM30 34-ch, C125 10-pin), 1 Howard Barton invoice template
- RLS policies on all tables, updated_at triggers

### Frontend (14 new files, 1 modified)
- `harnessTypes.ts` — all TypeScript interfaces
- `harnessConstants.ts` — AWG resistance table, wire color standards, length estimation
- `harnessCalculations.ts` — voltage drop, gauge selection (3% max drop), fuse rating, load summary
- `useHarnessState.ts` — useReducer state management
- `HarnessCanvas.tsx` — SVG canvas with pan/zoom, dot grid background
- `HarnessCanvasNode.tsx` — foreignObject HTML nodes in Win95 style
- `HarnessCanvasEdge.tsx` — cubic bezier wire paths with gauge-proportional stroke
- `HarnessCanvasSectionGroup.tsx` — dashed section group rectangles
- `HarnessToolbar.tsx` — mode buttons, actions, zoom, CHECK completeness toggle
- `HarnessBuilder.tsx` — main orchestrator (persistence, handlers, layout)
- `HarnessSidebar.tsx` — right panel property editor for nodes and connections
- `HarnessLoadSummary.tsx` — bottom bar with live load calculations
- `HarnessSystemsPalette.tsx` — left panel with 46 catalog items grouped by category
- `HarnessCompletenessPanel.tsx` — floating overlay showing % complete + missing items
- `WiringPlan.tsx` — rewritten page shell with template picker + lazy-loaded builder
- `WorkspaceContent.tsx` — added "OPEN HARNESS BUILDER" link in vehicle profile

### What Works
- Template picker: BLANK CANVAS or MOTEC M130 GPR HOT ROD (from Barton invoice)
- SVG canvas: pan, zoom, drag nodes, draw wires port-to-port
- Auto-calculations: wire gauge, color, length, fuse rating on wire creation
- Property editing: full node + connection editors in sidebar
- Live load summary: total amps, alternator/battery sizing, PDM channels, warnings
- Systems palette: click catalog items to add with pre-filled defaults
- Completeness check: % score, missing required/optional items with +ADD
- Persistence: debounced save to Supabase, immediate structural changes
- Keyboard shortcuts: V=select, W=wire, Delete=remove

## What's Not Built
- `seed-harness-from-vehicle` edge function (server-side auto-population from YMM)
- `compute-harness-loads` edge function (server-side authoritative calculation)
- Quote generation from harness design (extend existing `generate-wiring-quote`)
- Section tabs for filtering canvas by harness section
- Undo/redo (action history exists in reducer but no UI)

## Access
- Route: `/vehicle/:vehicleId/wiring`
- Link from vehicle profile: "Wiring Harness" widget -> OPEN HARNESS BUILDER
- Demo vehicle: 1932 Ford Hi-boy Custom Roadster (`92ed231a-ae66-4590-b2c8-ab44a32d5cc6`)
- A design was created via Playwright with the MoTeC template (34 endpoints)

## Known Issues
- User reported wiring page not loading — dev server had died, needed restart
- Auth required — no anonymous access to wiring page

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file
4. Register in `.claude/ACTIVE_AGENTS.md`
