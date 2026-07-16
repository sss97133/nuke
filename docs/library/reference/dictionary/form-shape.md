# form-shape

**Type:** architectural concept
**Canonical doc:** `docs/library/intellectual/contemplations/the-form-is-the-thing.md`
**Schemas:** `docs/api/schemas/v1/`
**Encyclopedia ref:** Chapter 2 (per-kind structured_data shape), Chapter 7 (External Agent Write API).

A form-shape is the contract Claude reads before it writes. Per event type — `service`, `inspection`, `modification`, `note`, `condition_assessment` — the system publishes a JSON Schema (Draft 2020-12) and a per-field checklist. Together they define what the event IS: which fields are required, which are optional, which enums are bounded, which lengths are capped, and where each field's answer comes from (vision, context, tool).

The form-shape is the moat. NUKE is a provenance engine for testimony; vehicles are the immutable entities, observations are the testimony. For five years, observation structure was inherited from the source — a BaT listing has its own fields, a Mecum extraction has its own fields. When the source becomes a vision agent reading a photo, there is no native structure. The form-shape becomes the structure.

A vision agent without a form will hallucinate fields. A vision agent with a form has a checklist and produces composable testimony. The form is enforced both at submission (JSON Schema validates) and at suggestion-time (`get_event_checklist` MCP tool returns per-field guidance). REST and MCP consume the same form-shape; the transport varies, the form does not.

> "The form is the thing. Everything else is plumbing to deliver Claude to it."

See also: `service`, `inspection`, `modification`, `note`, `condition_assessment`, `vision-fillable`.
