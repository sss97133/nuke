# inspection

**Type:** `event_type` value (External Agent Write API v1)
**Routes to:** `vehicle_observations.kind = 'condition'`, `source_slug = 'agent-submission'`
**Schema:** `docs/api/schemas/v1/inspection.json` (closed schema — `additionalProperties: false`)

An `inspection` event records a deliberate examination of a vehicle: a pre-purchase inspection, a walk-around, a photo audit, a post-work QC pass, an annual check. Distinct from `service` because no work was performed — only observation.

Required: `summary` and at least one `findings[]` entry. Each finding carries a `system` enum (engine_bay, top_end, bottom_end, undercarriage, interior, wheels, drivetrain, cooling, electrical, fuel, ignition, suspension, brakes, body, other), a `finding` text, a `severity` (`info`/`monitor`/`concern`/`critical`), and an optional `evidence_photo_ref`. Optional rollups: `inspection_type` (pre_purchase, walk_around, photo_audit, post_work_qc, annual_check, incident_report), `inspector_role` (agent_vision, owner_self, shop, third_party_expert), `zones_inspected[]`, `overall_condition` (excellent/good/fair/rough/project/parts_only), `deferred_maintenance_minutes`.

The closed schema is intentional: inspections are checklists. Unknown fields are rejected so that future versions stay explicit. The agent fills the form; it does not redesign it.

A `vision_condition_v1` extraction running over a single photo is one common path to an inspection event — Claude reads the photo, fills the checklist, submits.

See also: `service`, `condition_assessment`, `form-shape`, `vision-fillable`.
