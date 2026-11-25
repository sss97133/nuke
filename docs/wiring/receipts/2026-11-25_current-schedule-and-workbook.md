---
id: 2026-11-25_current-schedule-and-workbook
change_type: frontend
scope: WiringPlan navigation, MAP schedule and Excel export
case: docs/ledger/theory/data-machine-cases.md 13.12
---

# One current wiring schedule

The existing typed-row MAP reader owns the current schedule. The manifest-derived
views compute a different harness; their conflicting results were documented in
`research/2026-09-30_map-progressive-disclosure-brief.md`, sections 1–3. The new
schedule and its workbook must consume the same loaded rows, preserving record
identity, design qualification and absent values. No electrical design is changed.

## Source and reader

- `harness_designs` → `harness_endpoints`; `vehicle_wiring_overlays` →
  `vehicle_custom_circuits`; `wire_termination_specs` joins circuit and endpoint.
- `map/useWiringMap.ts` owns current, non-superseded rows. The shared map index
  supplies cross-selection, and vehicle-bound route files supply modeled lengths.
- A modeled length is an estimate, never an as-cut measurement. Missing segments
  or lengths cannot become zero. See chapter 16, section 2, and case 13.12's
  distinction between instance design and physical outcome.
- Design state is distinct from build state and recorded rule checks. A decided
  row is not a certification. See case 13.12 and the existing model-tab receipt
  `2026-10-14_k5-harness-model-tab.md`.

## Change

Use the current record workspace as the entry point. Present its ordinary wiring
schedule directly and retain its linked detail and visual tools. Remove competing
manifest-derived outputs from the primary navigation. Add a real XLSX download
from the same schedule definitions, with ordinary filters, frozen headers, units
and stable row identifiers. Preserve unknowns and keep owner-only evidence and
financial information out of visitor exports.

## Acceptance

Open the wiring page, inspect a wire and its endpoints, filter the schedule, and
download a workbook whose rows match the loaded schedule. Confirm concept versus
decided state and modeled versus measured lengths cannot be confused. Confirm a
visitor export contains no owner-only evidence, calls or financial records.
Verify desktop and phone layout plus exported XLSX structure and row identity.

## Unknowns

None for this presentation/export change. Existing engineering and measurement
holds remain open and are not resolved or released by this work. Historical rule
references `HARNESS_RULES.md` and `RECEIPT_FORMAT.md` are absent from current main
and the retained wiring checkout; the current dated receipt format is used.

## Evidence stage

Implemented and independently reviewed. The browser opened the real vehicle's
schedule and shared route from anonymous permitted reads. Wire 110 showed its
recorded planned estimate and absent measured length; wire 112 retained the full
unresolved cavity text in the row and selected detail. The phone layout retained
ordinary Tab navigation and downloaded the workbook without page overflow.

The actual browser download was re-imported and all three worksheets rendered
for inspection. Native table/filter/freeze, literal-cell, unknown-value and privacy
checks pass; the focused schedule plus adjacent scene/share suite passes 26 tests.
The production build passes. The initial gate found a table-map inference error;
the explicit table type repairs it and the final enforced gate is being recorded.
No electrical design, source testimony, database schema, permissions or purchases
changed. Deployment and live-route acceptance are separate release stages.
