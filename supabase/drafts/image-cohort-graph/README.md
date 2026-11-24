# Per-image cohort graph: SQL drafts (NOT APPLIED)

The spec is `docs/library/PHOTO_COHORT_GRAPH.md`. Apply in order, and only after the owner says yes to each step.

| File | What | Writes on apply |
|---|---|---|
| `01_tables.sql` | `image_cohort_edges`, `vehicle_cohort_edges`, two queues, the config flag | DDL plus 1 `platform_config` row |
| `02_derive.sql` | `image_cohort_derive(ids)`, `vehicle_cohort_derive(ids)`, the drains, the backfill enqueuers | functions only |
| `03_triggers_and_cron.sql` | statement-level enqueue triggers, plus 2 pg_cron jobs (every minute, throttled) | triggers and cron rows |
| `04_reader.sql` | `image_cohorts_read(image_id)` for iOS (invoker entry, plus a definer worker in `private`) | functions |
| `revert.sql` | unschedule, drop triggers, then functions, then tables | |

Sizing (2026-11-23):
- native photos: 32,394 (about 65 minutes at 500 a minute);
- vehicles: about 1.5M (about 12.5 hours at 2,000 a minute);
- external photos: no per-image rows, because they inherit their cohorts from the vehicle fold.
