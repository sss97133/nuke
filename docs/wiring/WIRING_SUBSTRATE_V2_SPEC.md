# Wiring Substrate v2 — Living Model, Not Documents

**Date:** 2026-06-10 · Skylar directive: "documentation is living, not lawful — we need an entirely new version of our wiring harness comprehension."
**Status:** DESIGN SPEC (v1 artifacts stay in service until v2 ingests them — nothing thrown away).

## The diagnosis

v1 (everything built through today) stores the harness in FILES — cut-list TXT parsed by regex, YAML landmarks, MD rules treated as law, TS files with baked K5 data — and derives documents from them. That's Dave's Excel with better fonts. It violates the platform's own axioms (`MD files ≠ product substrate`; substrate-as-projection). The cost shows up as: receipts to amend receipts, four cut-list versions, pin conflicts living in prose, and a phone that can't touch any of it.

## The model

**Every wiring fact is a DB atom with provenance and state. Every document is a projection. Every input device (phone, desktop, agent) writes observations against the same atoms.**

Entities (reuse existing tables wherever they exist — `vehicle_build_manifest`, `device_pin_maps`, `wire_specifications`, `vehicle_observations`; new rows not new schemas where possible):

- **Device** — the load/source/sensor. Columns it already has + needs: `amps`, `signal_type`, `zone`, `integration`, **`lifecycle_state`** (concept → decided → ordered → in_hand → installed → wired → verified) and **`subsystem`** (the toggle group). A winch is just a device row: `amps=300, integration=direct_battery` → derivation restructures the spine automatically (dual feed/isolator pattern), budget and cost reflow. The "buy the lightbulbs first" problem becomes a procurement VIEW (`WHERE lifecycle_state < 'in_hand'` joined to catalog_parts pricing — supply-side join, already doctrine).
- **Circuit** — derived rows (wire = device × signal-expansion rule), persisted with `derivation_version`, carrying `build_state` (uncut → cut → terminated_a → terminated_b → routed → verified) — this is Dave's "28 of 61 pins" as live data.
- **Decision** — today's receipts become decision rows: `subject, chosen, alternatives, source (skylar_verbal/dave_review/agent_scientific_method), reversible, supersedes`. Receipts remain as the human render.
- **Rule** — split **physics** (Vdrop math, ampacity — stays in code, `harnessDerivation.ts`, tested) from **policy** (3% limit, ×1.25, pulsed-load treatment, color map, pad %) — policy becomes versioned rows the workbench can show and Dave can challenge. "Lawful" dies here: a policy row has provenance and a successor pointer, same as any atom.

## The real-time loop (the tethering answer)

Phone is a capture head, not an app: photo/voice → existing `ingest-observation` path → wiring observation kinds (`part_acquired`, `pin_terminated`, `wire_routed`, `measurement_taken`, `device_added`) → atom state changes → derivation re-runs (the TS engine, already pure and parity-tested) → workbench + sheets re-project. Target: photo-to-schematic-update in seconds. The External Agent Write API (live since 05-03) is the same door for Dave's future agents. Multi-camera/live-stream later = more capture heads on the same door; nothing re-architects.

## What survives v1 (explicitly)

- `harnessDerivation.ts` — the engine IS v2-ready (pure function over device rows; swap its input from baked TS data to the manifest query it already has access to).
- The workbench UI — toggles stop being URL params and become `subsystem` state writes.
- Print generators — become export endpoints over the same derivation output.
- Receipts/landmarks/cut-list v4.1 — one-time ingestion as seed atoms with `source: v1_file_substrate` provenance, then files freeze as archive.

## Build order

1. Migration: ingest v4.1 wires + decisions + landmarks into rows (one script, idempotent).
2. `lifecycle_state` + `build_state` + policy-rule rows (small migrations, justified comments per platform rules).
3. Workbench reads/writes DB (toggle = update, device add = insert) — the drag-drop-watch-cost-change experience.
4. Phone observation kinds wired into ingest-observation (coordinate with the phone-app agent — same observation schema, no parallel pipeline).
5. Pin-28-of-61 build tracker view (circuit build_state board) — Dave's first daily-driver screen.

## What this is for (the business line)

The pro's barrier to entry is $60k of materials + hand-built Excel. Ours is: phone in, harness out. Win the harness, and the ECU-coding territory behind it is standing open.
