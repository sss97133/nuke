---
paths:
  - "docs/wiring/**"
---

# Wiring Receipt Rule

## ⛔ PRE-FLIGHT GATE — run BEFORE producing any wiring artifact

This gate exists because an agent kept producing before grounding (2026-06-18) and the builder (Dave / Desert Performance) shredded every output. Before you write, draw, or spec ANYTHING wiring:

1. Read `docs/wiring/K5_WIRING_STATE.md` §1-4 (locked decisions · principles · open questions · measurement unknowns). Do not re-propose anything locked.
2. Read the relevant **competence canon chapter**: `chapters/16-wire-and-protection-canon.md` (wire/gauge/terminations/OCP-at-the-wire), `chapters/17-power-architecture-ecu-pdm.md` (power topology/isolator/star-ground/ECU/PDM), `chapters/18-construction-and-segmentation.md` (twist/formboard/firewall segmentation).
3. `python3 scripts/library_search.py "<term>"` for every spec/PN/pin — cite doc+page. NEVER recall a spec from training data.
4. Every number traces to a source OR is marked `{unknown, needs:<action>}`. No bare numbers.
5. If it depends on an OPEN owner decision (M130 mount side, firewall-overflow resolution, wake element, 1/0 sourcing) — state the dependency and STOP. Do not invent it.
6. Self-check **"would Dave shred this?"**: cited not vibed · calculate-first-cut-last · parallel-skinny not fat-slug · crimped not soldered · engine-only firewall · Dave's vocabulary (TPS not ETB, oil PSI not OPS) · scoped not explosive-diarrhea.
7. Defer the experiential layer (twist pitch, crimp feel, on-vehicle length verify, final cut, physical mounts) to the builder as a marked unknown — never assert it COMPLETE.

Why: memory `feedback_competence_lives_in_substrate_ground_first.md`. The competence is already ~70-80% in our substrate; the only failure mode is not reading it first.

---

This rule applies to any work touching:
- `docs/wiring/**`
- `nuke_frontend/src/components/wiring/**`
- `supabase/functions/compute-wiring-overlay/**`
- `supabase/functions/generate-cut-list/**`
- `supabase/functions/generate-connector-schedule/**`
- `supabase/functions/generate-wiring-bom/**`
- Any migration with `wiring`, `harness`, `pin_map`, `build_manifest` in the filename
- Any row insert/update on wiring tables: `device_pin_maps`, `factory_harness_circuits`, `wire_specifications`, `connector_specifications`, `vehicle_wiring_overlays`, `vehicle_build_manifest`, `vehicle_custom_circuits`, `upgrade_templates`

## The rule

**No receipt, no change.** Before modifying anything in the scope above, produce a receipt in `docs/wiring/receipts/YYYY-MM-DD_<slug>.md` following the schema in `docs/wiring/RECEIPT_FORMAT.md`.

If the receipt's `unknowns` block is non-empty, execution is blocked. Resolve by:
- Physical measurement on the truck (Skylar has access)
- Looking it up in the K5 knowledge index (`docs/wiring/K5_KNOWLEDGE_INDEX.md`) or research library (`docs/wiring/research/`)
- Asking Skylar directly
- Launching a research receipt (`change_type: research`) to produce the missing evidence

Do NOT hallucinate the unknown to make it empty. That defeats the whole point.

## Required citations

Every claim in a receipt must cite one of:

1. **HARNESS_RULES.md** rule IDs (R1-R15, T1-T5, E1-E7, C1-C6, K1-K6) — binary constraints
2. **`objectTraits.ts`** — per-Blender-object physical traits (material, pierceability, factory_holes, ground_points, channels, thermal)
3. **`WIRING_SYSTEM_KNOWLEDGE.md`** — reference data (pin maps, part numbers, tier system, engineering decisions)
4. **`docs/wiring/research/*.md`** — sourced research packets (k5-body-grounds, dakota-digital-vhx-motec-integration, etc.)
5. **K5 knowledge index** — 399 indexed docs, queried via `k5KnowledgeIndex.ts`
6. **Physical measurement** — with date + who measured + method

No claim without a citation. "Because it looks right" is not a citation.

## Read first, always

Before starting any wiring work, read these files in order:

1. `docs/wiring/HARNESS_RULES.md` — the spec / the prompt
2. `docs/wiring/RECEIPT_FORMAT.md` — the contract you must produce
3. `docs/wiring/WIRING_SYSTEM_KNOWLEDGE.md` — reference data
4. `nuke_frontend/src/components/wiring/objectTraits.ts` — the K5 trait table
5. The research directory for any topic you're about to touch: `docs/wiring/research/`
6. `docs/wiring/LOCAL_DEV.md` if Supabase is paused / working locally

## Scope discipline

- Don't conflate tabs. FORMBOARD is the manufacturing print. SCHEMATICS is the circuit diagram. They are not the same.
- Don't invent constraints. If HARNESS_RULES.md doesn't enumerate the rule you think exists, it doesn't exist. Propose an addition to HARNESS_RULES.md as a separate receipt (`scope: spec`) — don't silently apply it.
- Don't route on hunches. Routing decisions consult `objectTraits.ts`. If the object you're routing near has no trait entry, that's the real blocker — add the trait entry first, then route.

## The builder is the expert

Skylar and Desert Performance are the authorities on this build. The agent is a research assistant with file access. The agent may:

- Read docs and synthesize them into receipts
- Write code that uses the trait data
- Plumb pipes (fix RPCs, add transforms, regenerate views)
- Validate constraint math

The agent may NOT:

- Decide a wire's actual physical route on the truck without confirmation
- Substitute for hands-on K5/Motec experience
- Make creative wiring decisions without checking `objectTraits.ts` for the traited constraint
- Populate wiring tables with data not sourced from a T1 authority (manufacturer, service manual, validated invoice) or a physical measurement

## Canonical references

- Spec: `docs/wiring/HARNESS_RULES.md`
- Receipt format: `docs/wiring/RECEIPT_FORMAT.md`
- Trait table: `nuke_frontend/src/components/wiring/objectTraits.ts`
- Knowledge: `docs/wiring/WIRING_SYSTEM_KNOWLEDGE.md`
- Research: `docs/wiring/research/`
- Local dev: `docs/wiring/LOCAL_DEV.md`
- K5 index: `nuke_frontend/public/data/k5-knowledge-index.json` + `k5KnowledgeIndex.ts`

## Receipt filing

```
docs/wiring/receipts/
  YYYY-MM-DD_<slug>.md         -- one receipt per logical change
  YYYY-MM-DD_research-<slug>.md -- research receipts (evidence-producing)
```

Never overwrite a prior receipt. Amendments create a new receipt with `amends: <prior-id>` set. The chain is the audit trail.
