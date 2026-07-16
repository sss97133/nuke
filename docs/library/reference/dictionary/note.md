# note

**Type:** `event_type` value (External Agent Write API v1)
**Routes to:** `vehicle_observations.kind = 'comment'`, `source_slug = 'agent-submission'`
**Schema:** `docs/api/schemas/v1/note.json`

A `note` event is the escape hatch. When an agent has something to say about a vehicle that doesn't fit `service` (no wrench was turned), `inspection` (no examination was performed), `modification` (nothing was changed), or `condition_assessment` (no rollup was rendered), it submits a `note`.

Form-shape is minimal: required `summary` (1–280 chars, headline-shaped) and optional `narrative` (≤32K, long-form body). No required structure beyond that. The note lands as a `comment` observation on the vehicle timeline with full agent attribution.

Notes carry lower implicit trust than the structured event types because they cannot be cross-referenced field-by-field. They are preserved testimony, not composable testimony. Use them when you have something true to say but no shape exists for it; if you find yourself submitting many notes of the same shape, that shape needs to become a real event type with its own JSON Schema.

See also: `service`, `inspection`, `form-shape`.
