-- ============================================================================================
--  BACKFILL — occurred_at / ingest_kind for existing rows.          *** DO NOT RUN UNREVIEWED ***
--  Requires Skylar's explicit approval. Not a migration; nothing applies this automatically.
--  Prerequisite: migration 20261023220050_event_time_stamping.sql applied.
-- ============================================================================================
-- Rules (same as supabase/functions/_shared/eventTime.ts):
--   occurred_at = the row's own event clock, never created_at; future clocks (>48h ahead) ignored.
--   ingest_kind = 'import' for imported sources, else 'backfill' if created_at - occurred_at > 48h,
--                 else 'live'; null when there is no event clock.
-- Only rows where occurred_at IS NULL are touched, in batches, so it is resumable and idempotent.
-- Preview first:  run the SELECT counts at the bottom, inside the same transaction, then ROLLBACK.

BEGIN;
SET LOCAL statement_timeout = '0';

-- vehicle_images: EXIF taken_at. Legacy importers copied the import clock into taken_at, so imported
-- rows are marked 'import' (their clock is the source system's, not a camera's).
UPDATE public.vehicle_images vi SET
  occurred_at = vi.taken_at,
  ingest_kind = CASE
    WHEN vi.source ILIKE '%import%' OR vi.imported_by IS NOT NULL OR vi.is_external IS TRUE THEN 'import'
    WHEN vi.created_at - vi.taken_at > interval '48 hours' THEN 'backfill'
    ELSE 'live' END
WHERE vi.occurred_at IS NULL AND vi.taken_at IS NOT NULL
  AND vi.taken_at <= vi.created_at + interval '48 hours';

-- receipts: transaction, then receipt, then purchase date (noon UTC, a date has no time).
UPDATE public.receipts r SET
  occurred_at = (coalesce(r.transaction_date, r.receipt_date, r.purchase_date)::timestamp + interval '12 hours') AT TIME ZONE 'UTC',
  ingest_kind = CASE
    WHEN coalesce(r.upload_date, r.created_at) - ((coalesce(r.transaction_date, r.receipt_date, r.purchase_date)::timestamp + interval '12 hours') AT TIME ZONE 'UTC') > interval '48 hours'
      THEN 'backfill' ELSE 'live' END
WHERE r.occurred_at IS NULL AND coalesce(r.transaction_date, r.receipt_date, r.purchase_date) IS NOT NULL;

-- work_orders: when work actually started (or was scheduled to); request-only rows stay null.
UPDATE public.work_orders w SET
  occurred_at = coalesce(w.actual_start, w.started_at, w.scheduled_start),
  ingest_kind = CASE WHEN w.created_at - coalesce(w.actual_start, w.started_at, w.scheduled_start) > interval '48 hours'
                     THEN 'backfill' ELSE 'live' END
WHERE w.occurred_at IS NULL AND coalesce(w.actual_start, w.started_at, w.scheduled_start) IS NOT NULL;

-- Review before deciding:
SELECT 'vehicle_images' t, ingest_kind, count(*) FROM public.vehicle_images GROUP BY 2
UNION ALL SELECT 'receipts', ingest_kind, count(*) FROM public.receipts GROUP BY 2
UNION ALL SELECT 'work_orders', ingest_kind, count(*) FROM public.work_orders GROUP BY 2;

-- Default is to undo. Change to COMMIT only with Skylar's approval.
ROLLBACK;
