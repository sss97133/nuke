# vision-fillable

**Type:** field annotation in the `get_event_checklist` MCP contract
**Canonical doc:** `docs/library/reference/encyclopedia/02-observation-model.md#per-kind-structured_data-shape`

`vision_fillable: true` marks a field that an agent can populate from a single photo (or a small set of photos) without needing additional context, tool calls, or user input. The annotation is one-third of the form-shape's Claude-actionable triplet: `vision_fillable`, `context_fillable`, `tool_fillable`. A field can carry multiple flags — `narrative` is both vision-fillable and context-fillable.

Examples of vision-fillable fields:
- `zones_touched` / `zones_inspected` — the photo shows engine bay, undercarriage, etc.
- `condition_observations[].severity` — visual assessment of leak severity, rust extent, panel damage.
- `findings[].system` — which subsystem the photo depicts.
- `parts[].name` — Claude can identify a visible part.
- `caption` on a media reference — describe what is visible.
- `overall_condition` — coarse rollup the agent can render from a walk-around.

Examples of fields that are NOT vision-fillable: `labor_minutes` (must come from user context), `shop_ref` (context), `vin` (must come from a tool lookup or user input), `correction_of` (must come from a history query).

Annotations are guidance, not gates. The JSON Schema validates the result regardless of how the agent populated it; the checklist tells the agent the cheapest path to a valid submission.

See also: `form-shape`, `service`, `inspection`.
