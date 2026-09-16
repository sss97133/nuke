# condition_assessment

**Type:** `event_type` value (External Agent Write API v1)
**Routes to:** `vehicle_observations.kind = 'condition'`, `source_slug = 'agent-submission'`
**Schema:** `docs/api/schemas/v1/condition_assessment.json` (v1.1)

A `condition_assessment` event is a rolled-up state report on a vehicle at a moment in time. Distinct from `inspection` because it is a synthesis, not a fresh examination — the agent is composing a current-state summary from prior testimony, photos, owner input, and recent service history rather than walking around the car with a clipboard.

Form-shape includes: `summary`, `narrative`, `as_of_date`, per-system condition ratings (`engine`, `transmission`, `suspension`, `brakes`, `body`, `interior`, `electrical` — each rated `excellent`/`good`/`fair`/`rough`/`project`/`parts_only`), `overall_condition`, `confidence_basis` (how the agent reached this assessment — `photo_audit`/`recent_inspection`/`owner_input`/`shop_records`/`composite`), `known_flaws[]`, `deferred_maintenance_minutes`.

The half-life of a condition assessment is shorter than an inspection's because synthesis decays faster than direct observation. The next service event, the next photo, the next sale changes the assessment. The system treats condition assessments as snapshots — they appear on the timeline at their `as_of_date` and are superseded by newer assessments via the supersession chain rather than overwriting.

See also: `inspection`, `condition`, `form-shape`, contemplation `testimony-and-half-lives.md`.
