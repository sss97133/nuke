# service

**Type:** `event_type` value (External Agent Write API v1)
**Routes to:** `vehicle_observations.kind = 'work_record'`, `source_slug = 'shop'`
**Schema:** `docs/api/schemas/v1/service.json`

A `service` event is a wrench-time session — work performed on a specific vehicle on a specific day. It is the canonical event type for owner-trust testimony about what was done to a car: parts removed, parts installed, conditions discovered, decisions made, time spent.

The form-shape is intentionally rich. Required: a `summary` headline. Optional but encouraged: `narrative` (long-form), `zones_touched` (engine_bay, drivetrain, etc.), `work_performed[]`, `work_planned[]`, `parts[]` with status (`needed`/`ordered`/`installed`/`considered_rejected`), `decisions[]` with question and outcome, `condition_observations[]` with severity (`info`/`monitor`/`concern`/`critical`), `labor_minutes`, `shop_ref`.

A service event with `condition_observations` is testimony plus inspection — the agent records what it touched AND what it noticed while touching. Those condition findings appear on the timeline as separate atoms attributed to the same session.

A service event submitted by an authenticated owner or shop carries source slug `shop` (high trust). Submitted via REST `POST /v1/events` or MCP `submit_vehicle_event`. Both surfaces consume the same JSON Schema.

See also: `modification`, `inspection`, `form-shape`.
