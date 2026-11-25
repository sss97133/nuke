-- Contract for 20261125132000_photo_flow_assay_capture_coverage.sql, on a fresh disposable database.
-- assay_photo_reading_flow v5 counts the landing owner's recent photos that are in no capture set, by why, and fails
-- while a scorable photo is stranded (not_chunked, read_after_plan, scorable_no_candidate past one drain cycle):
--   one photo per bucket: no_pixels, duplicate, image_type_blocked, awaiting_read, awaiting_plan, not_chunked,
--   read_after_plan, scorable_no_candidate; not counted: a photo in a set, a filed photo, another user's, one uploaded
--   40 days ago, a photo covered only by a dry chunk's set;
--   stranded -> status failed with the counts in a reason, and the raising form (the cron's) raises;
--   once each stranded photo is planned into a set -> the reasons are exactly v4's again;
--   every other section equals v4's; replay is a no-op; the revert restores 20261125070000's body by md5.
-- The fixture is the photo reading flow chain (test_image_stage_scan_eligibility_cap.sql, which ends reverted, so
-- 20261125070000 is applied again). Synthetic rows only. -- ALLOW_RAW_TESTIMONY_WRITE (local fixture, never production)
\set ON_ERROR_STOP on
\ir test_image_stage_scan_eligibility_cap.sql
\ir ../migrations/20261125070000_image_stage_scan_eligibility_cap.sql
SELECT pg_temp.ok(pg_temp.md5_of('public.assay_photo_reading_flow(boolean)') = '9451a1281ddaa876dc0ba980aeeaba6d',
  'parent: assay_photo_reading_flow is production''s v4 body (md5)');

-- ===== stand-ins for the capture landing tables the new section reads
-- guardrail-allow(center-key-fk): capture_landing_sets: disposable PG17 stand-in of a live table; only the columns the assay reads
-- guardrail-allow(center-key-fk): capture_document_pages: disposable PG17 stand-in of a live table; only the columns the assay reads
ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS ai_processing_completed_at timestamptz;
CREATE TABLE public.capture_landing_config(id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), user_id uuid NOT NULL);
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), track text NOT NULL DEFAULT 'manual',
  user_id uuid NOT NULL, t_from timestamptz NOT NULL, t_to timestamptz NOT NULL, dry boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'applied', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid NOT NULL REFERENCES capture_landing_chunks(id), set_key text NOT NULL,
  image_ids uuid[] NOT NULL, PRIMARY KEY (chunk_id, set_key));
CREATE TABLE IF NOT EXISTS public.capture_document_pages(image_id uuid, revoked_at timestamptz);
CREATE OR REPLACE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT p_source = 'capture_relay_ios' $$;
INSERT INTO public.capture_landing_config VALUES (1, '00000000-0000-4000-8000-0000000000cc');

-- one photo per case, each on its own day (2019-01-01 .. 2019-01-14, 18:00 UTC); chunks cover [day 08:00Z, +1 day)
CREATE FUNCTION pg_temp.cp(n int, url text DEFAULT 'x.jpg', typ text DEFAULT 'vehicle_exterior', status text DEFAULT 'completed',
  read_ago interval DEFAULT interval '2 hours', extra jsonb DEFAULT '{}') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images(id, user_id, vehicle_id, image_url, created_at, is_duplicate, ai_processing_status, ai_scan_metadata,
                                    taken_at, source, ai_processing_completed_at)
  VALUES (('00000000-0000-4000-8000-0000000c' || lpad(n::text, 4, '0'))::uuid,
          coalesce((extra->>'user')::uuid, '00000000-0000-4000-8000-0000000000cc'), (extra->>'vehicle')::uuid, url,
          coalesce((extra->>'created')::timestamptz, now() - interval '3 hours'), (extra->>'dup')::boolean, status,
          CASE WHEN typ IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('classification', jsonb_build_object('image_type', typ)) END,
          ('2019-01-' || lpad(n::text, 2, '0') || ' 18:00+00')::timestamptz, 'capture_relay_ios',
          CASE WHEN status = 'completed' THEN now() - read_ago END) $$;
CREATE FUNCTION pg_temp.cchunk(n int, ago interval, dry boolean DEFAULT false) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.capture_landing_chunks(user_id, t_from, t_to, dry, created_at)
  VALUES ('00000000-0000-4000-8000-0000000000cc', ('2019-01-' || lpad(n::text, 2, '0') || ' 08:00+00')::timestamptz,
          ('2019-01-' || lpad(n::text, 2, '0') || ' 08:00+00')::timestamptz + interval '1 day', dry, now() - ago) RETURNING id $$;
CREATE FUNCTION pg_temp.cset(n int, chunk uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.capture_landing_sets VALUES (chunk, 'set:' || n, ARRAY[('00000000-0000-4000-8000-0000000c' || lpad(n::text, 4, '0'))::uuid]) $$;

SELECT pg_temp.cp(1, url => '');                                            -- no_pixels
SELECT pg_temp.cp(2, extra => '{"dup":true}');                              -- duplicate
SELECT pg_temp.cp(3, typ => 'other');                                       -- image_type_blocked
SELECT pg_temp.cp(4, typ => NULL, status => 'processing');                  -- awaiting_read
SELECT pg_temp.cp(5, read_ago => interval '5 minutes'); SELECT pg_temp.cchunk(5, interval '2 hours');   -- awaiting_plan
SELECT pg_temp.cp(6);                                                       -- not_chunked
SELECT pg_temp.cp(7, read_ago => interval '1 hour'); SELECT pg_temp.cchunk(7, interval '2 hours');      -- read_after_plan
SELECT pg_temp.cp(8); SELECT pg_temp.cchunk(8, interval '1 hour');          -- scorable_no_candidate
SELECT pg_temp.cp(9); SELECT pg_temp.cset(9, pg_temp.cchunk(9, interval '1 hour'));                     -- in a set: not counted
SELECT pg_temp.cp(10, extra => '{"vehicle":"00000000-0000-4000-8000-0000000000c3"}');                   -- filed: not counted
SELECT pg_temp.cp(11, extra => '{"user":"00000000-0000-4000-8000-0000000000dd"}');                      -- another user: not counted
SELECT pg_temp.cp(12, extra => jsonb_build_object('created', now() - interval '40 days'));               -- 40 days old: not counted
SELECT pg_temp.cp(13); SELECT pg_temp.cset(13, pg_temp.cchunk(13, interval '1 hour', dry => true));    -- only a dry set: counted below
SELECT pg_temp.cchunk(13, interval '1 hour');

SELECT assay_photo_reading_flow(false) AS v4 \gset

-- ===== apply
\ir ../migrations/20261125132000_photo_flow_assay_capture_coverage.sql
SELECT pg_temp.ok(pg_temp.md5_of('public.assay_photo_reading_flow(boolean)') = '7e538364bb81721ab810b816ace059a1', 'migration lands v5 (md5)');
SELECT assay_photo_reading_flow(false) AS v5 \gset
SELECT pg_temp.ok((:'v5')::jsonb #> '{capture_sets,by_reason}' = '{"no_pixels":1,"duplicate":1,"image_type_blocked":1,"awaiting_read":1,
    "awaiting_plan":1,"not_chunked":1,"read_after_plan":1,"scorable_no_candidate":2}'::jsonb
  AND ((:'v5')::jsonb #>> '{capture_sets,stuck}')::int = 4,
  'by_reason: one photo per bucket, the dry-only set counts as no set (scorable_no_candidate 2); set, filed, other user and 40-day-old photos are not counted; stuck 4');
SELECT pg_temp.ok((:'v5')::jsonb ->> 'status' = 'failed' AND (:'v5')::jsonb ->> 'method' = 'assay_photo_reading_flow v5'
  AND ((:'v5')::jsonb -> 'reasons') @> to_jsonb(ARRAY['4 scorable photos uploaded in 30 days are in no capture set and no job will plan them again (not_chunked 1, read_after_plan 1, scorable_no_candidate 2)']),
  'stranded photos: failed, with the counts in a reason');
SELECT pg_temp.ok(((:'v5')::jsonb - 'reasons' - 'status' - 'method' - 'checked_at' - 'capture_sets')
                  = ((:'v4')::jsonb - 'reasons' - 'status' - 'method' - 'checked_at'),
  'every other section equals v4''s');
SELECT pg_temp.raises($$SELECT assay_photo_reading_flow()$$, 'the raising form (cron photo-reading-flow-watch) raises, so v_job_health shows it');

-- ===== the drain plans each stranded photo into a set: v4's reasons again
SELECT pg_temp.cset(6, pg_temp.cchunk(6, interval '0 minutes'));
SELECT pg_temp.cset(7, pg_temp.cchunk(7, interval '0 minutes'));
SELECT pg_temp.cset(8, (SELECT id FROM capture_landing_chunks WHERE t_from = '2019-01-08 08:00+00' LIMIT 1));
SELECT pg_temp.cset(13, (SELECT id FROM capture_landing_chunks WHERE t_from = '2019-01-13 08:00+00' AND NOT dry LIMIT 1));
SELECT assay_photo_reading_flow(false) AS v5b \gset
SELECT pg_temp.ok(((:'v5b')::jsonb #>> '{capture_sets,stuck}')::int = 0
  AND (:'v5b')::jsonb -> 'reasons' = (:'v4')::jsonb -> 'reasons' AND (:'v5b')::jsonb ->> 'status' = (:'v4')::jsonb ->> 'status'
  AND NOT ((:'v5b')::jsonb #> '{capture_sets,by_reason}' ?| ARRAY['not_chunked', 'read_after_plan', 'scorable_no_candidate']),
  'nothing stranded: the reasons and status are v4''s');

-- ===== replay and revert
\ir ../migrations/20261125132000_photo_flow_assay_capture_coverage.sql
SELECT pg_temp.ok(pg_temp.md5_of('public.assay_photo_reading_flow(boolean)') = '7e538364bb81721ab810b816ace059a1', 'replay: same body');
\ir revert_20261125132000_photo_flow_assay_capture_coverage.sql
SELECT pg_temp.ok(pg_temp.md5_of('public.assay_photo_reading_flow(boolean)') = '9451a1281ddaa876dc0ba980aeeaba6d'
  AND NOT (assay_photo_reading_flow(false) ? 'capture_sets'), 'revert: v4 body by md5, no capture_sets section');
\echo 'photo flow assay capture coverage contract passed'
