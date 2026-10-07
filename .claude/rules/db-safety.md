---
paths:
  - "supabase/migrations/**"
  - "supabase/functions/**"
  - "scripts/**/*.sql"
---

# Database Safety Rules

## Statement Timeout
- NEVER `SET statement_timeout` above 120s
- Role defaults: postgres=120s, anon/authenticated/authenticator=15s

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
