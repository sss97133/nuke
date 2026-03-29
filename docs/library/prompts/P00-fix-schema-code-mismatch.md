# P00: Fix Schema-Code Mismatch

## Context
Read these before executing:
- `docs/library/technical/engineering-manual/01-intake-pipeline.md` — how import_queue works
- `docs/library/technical/schematics/data-flow.md` — the state machine

## Problem
The `import_queue` table has a CHECK constraint that doesn't match what the code writes.

**Schema allows**: `pending, processing, complete, failed, skipped, duplicate`
**Code writes**: `pending_review`, `pending_strategy` (from `process-import-queue` and `haiku-extraction-worker`)

Records enter states the database doesn't validate. They become ghost records — not failed, not complete, just stuck.

## Scope
One migration. Nothing else.

## Steps

1. Find the existing CHECK constraint on `import_queue.status`:
```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'import_queue'::regclass
AND contype = 'c'
AND pg_get_constraintdef(oid) LIKE '%status%';
```

2. Read the code to find ALL status values actually written. Check these files:
- `supabase/functions/process-import-queue/index.ts`
- `supabase/functions/haiku-extraction-worker/index.ts`
- Any other function that writes to `import_queue.status` (grep for `import_queue` + `status`)

3. Write a migration that drops the old constraint and adds one with all values:
```sql
ALTER TABLE import_queue DROP CONSTRAINT [old_constraint_name];
ALTER TABLE import_queue ADD CONSTRAINT import_queue_status_check
  CHECK (status = ANY(ARRAY[
    'pending', 'processing', 'complete', 'failed', 'skipped', 'duplicate',
    'pending_review', 'pending_strategy'
  ]));
```

4. Check for any records currently stuck in unvalidated states:
```sql
SELECT status, count(*) FROM import_queue GROUP BY status ORDER BY count DESC;
```

## Verify
```sql
-- Constraint exists with all values
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'import_queue'::regclass AND conname = 'import_queue_status_check';

-- No records in unknown states
SELECT status, count(*) FROM import_queue
WHERE status NOT IN ('pending','processing','complete','failed','skipped','duplicate','pending_review','pending_strategy')
GROUP BY status;
-- Should return 0 rows
```

## Anti-Patterns
- Do NOT add new columns. This is a constraint fix only.
- Do NOT change any edge function code. The code is correct; the schema was incomplete.
- Do NOT run UPDATE on existing records. Just fix the constraint.
- Do NOT create a new table. Fix the existing one.

## Library Contribution
After completing: update `docs/library/reference/dictionary/tables.md` — find the `import_queue` entry and add the new valid status values.
