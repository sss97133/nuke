---
paths:
  - "supabase/migrations/**"
  - "supabase/functions/**"
  - "scripts/**/*.sql"
---

# Database Safety Rules

## Statement Timeout
- NEVER raise `statement_timeout`; narrow the query instead
- Role defaults, read from `pg_roles` on 2026-10-14: postgres=10s (`idle_in_transaction_session_timeout` 15s),
  anon=15s, authenticated=15s, authenticator=60s (`lock_timeout` 8s). `scripts/data/q.sh` runs as postgres.

## Batched Writes
- NEVER run unbounded UPDATE/DELETE on vehicles, vehicle_images, import_queue
- Batch in 1,000-row chunks with `pg_sleep(0.1)` between batches
- Single statements over 60s must be batched

## Lock Awareness
- After EVERY SQL write: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`
- If > 0, you caused a lock cascade. Stop and investigate.
- Before DDL: `SELECT count(*) FROM pg_stat_activity WHERE state='active' AND query ILIKE '%tablename%';` — if > 2, WAIT

## PostgREST
- If you break PostgREST (PGRST002): `NOTIFY pgrst, 'reload schema';`
- No DDL while long UPDATE is running — causes AccessExclusive lock cascades

## Duplicate Queries
- Before `count(*)` or heavy SELECTs: `SELECT left(query,80) FROM pg_stat_activity WHERE state='active' AND pid != pg_backend_pid();`

## Testimony
Testimony is the rows that record what was observed, by whom, from what source and when:
`vehicle_events`, `vehicle_observations`, `vehicle_images`, `auction_comments`, `vehicle_timeline`,
`merge_proposals`, `merge_deleted_rows`, `observation_discoveries`, `comment_discoveries` and
`description_discoveries`.
- NEVER `DELETE` or `TRUNCATE` them, and never `UPDATE` a value in place. Supersede: set `is_superseded`,
  write the new row, point `superseded_by` at it.
- ANY cleanup of misattributed data goes through `unmerge_vehicle()` or `reattribute_observation()`. If neither
  fits the case, stop and report it; do not improvise with DELETE, and do not delete when a stub-creation
  path is blocked (fix the trigger instead).
- Call `merge_into_primary()` only with an approved `merge_proposals` row (`status = 'approved'`,
  `ai_decision = 'merge'`).
- Keep `merged_from_vehicle_id` populated on anything moved across vehicles.
- Why: on 2026-05-01 an agent deleted a wrongly merged auction event instead of relinking it to a stub vehicle,
  and orphaned a real vehicle's history for good. Background: `docs/library/intellectual/contemplations/the-trust-invariant.md`.
