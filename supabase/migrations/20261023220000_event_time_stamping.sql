-- Event time vs upload time.
--
-- created_at is when a row reached Nuke. Code read it as "when it happened", so a camera-roll backlog
-- (274 of 381 recent uploads were taken 30+ days earlier) showed up as current work. These columns
-- carry the event's own clock and how it arrived:
--   occurred_at  the event time (EXIF taken_at, receipt transaction date, work start); null = unknown
--   ingest_kind  'live' | 'backfill' | 'import'; null = no event time, so it can't be told
-- Schema only. Existing rows are NOT backfilled here; the backfill is a separate, reviewed script:
-- supabase/sql/backfill_event_time_20261023.sql (needs Skylar's approval before anyone runs it).

ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS ingest_kind text;
ALTER TABLE public.receipts       ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE public.receipts       ADD COLUMN IF NOT EXISTS ingest_kind text;
ALTER TABLE public.work_orders    ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE public.work_orders    ADD COLUMN IF NOT EXISTS ingest_kind text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicle_images', 'receipts', 'work_orders'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_ingest_kind_check') THEN
      -- NOT VALID: existing rows are all null; skip the full-table scan on these large tables.
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (ingest_kind IN (''live'', ''backfill'', ''import'')) NOT VALID',
                     t, t || '_ingest_kind_check');
    END IF;
    EXECUTE format('COMMENT ON COLUMN public.%I.occurred_at IS %L', t,
      'When the event happened (its own clock). Not created_at, which is upload time. Null = unknown.');
    EXECUTE format('COMMENT ON COLUMN public.%I.ingest_kind IS %L', t,
      'live = arrived within 48h of occurring; backfill = older event arriving late; import = copied from another system; null = undated.');
  END LOOP;
END $$;
