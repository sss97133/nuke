# modification

**Type:** `event_type` value (External Agent Write API v1)
**Routes to:** `vehicle_observations.kind = 'work_record'`, `source_slug = 'agent-submission'`
**Schema:** `docs/api/schemas/v1/modification.json` (v1.1; reuses `service.json` shape with `modification_type` added)

A `modification` event is a deviation from factory specification: an LS swap, a coilover install, a custom paint job, a wheel-and-tire upgrade. Distinct from `service` because the intent is to change what the vehicle IS, not to maintain what it already was.

Modifications are testimony with long half-life — once a vehicle has been modified, that fact persists across all future observations. A condition assessment of a modified vehicle is meaningless without knowing the modification baseline. A future buyer's PPI must reckon with the modification chain. The system stores modifications as `work_record` so they appear on the timeline alongside service, but the `modification_type` field flags them for downstream filters: "show me only stock vehicles", "show me LS-swapped K5s", "show me cars with paint older than the original color".

Form-shape inherits from `service`: `summary`, `narrative`, `zones_touched`, `parts[]`, `decisions[]`, `labor_minutes`, plus `modification_type` and `reverts_to_stock` (boolean — was this an undo of a prior modification?).

See also: `service`, `form-shape`.
