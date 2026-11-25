-- Disposable PostgreSQL 17 fixture only. Contract for 20261125213500_bat_settlement_rearm.sql:
-- re-pends, through requeue_import_queue_item, only complete/failed settlement items of still-live, ended BaT monitors
-- last attempted before the rule row's cutoff, at most rows_per_minute per call and each item once, with attempts raised
-- to the floor (one fetch); never touches revision items; pauses while a live lot ends within the pause window; posts one
-- drain batch only when it re-armed something; writes its gauge, shown by v_job_health; sets its own job inactive when
-- none is left and the gauge says done; not executable by anon or authenticated.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database only'; END IF; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid $$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL,
  username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET active = coalesce($6, active) WHERE jobid = $1 $$;
CREATE SCHEMA net;
CREATE TABLE net.calls(id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls(url, body) VALUES (url, body) RETURNING id $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://fixture.invalid' $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'fixture-key' $$;

CREATE TABLE public.job_assay_readings(jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms integer,
  attempted_at timestamptz, attempt_error text, refresh_every interval, fresh_for interval, run_started_at timestamptz);
-- v_job_health stand-in with the live view's assay columns (the live CASE lists named jobs, then ELSE NULL).
CREATE VIEW public.v_job_health AS
SELECT j.jobid, j.jobname, j.active,
  CASE WHEN j.jobname = 'bat-live-pull' THEN 'passed'::text ELSE NULL::text END AS assay_status,
  CASE WHEN j.jobname = 'bat-live-pull' THEN '{}'::jsonb ELSE NULL::jsonb END AS assay,
  CASE WHEN NOT j.active THEN 'paused'::text ELSE 'passed'::text END AS health_status
FROM cron.job j;
INSERT INTO cron.job(jobname, schedule, command) VALUES ('bat-live-pull', '* * * * *', 'SELECT 1');

CREATE TABLE public.live_auction_sources(id uuid PRIMARY KEY, slug text UNIQUE, scraping_config jsonb DEFAULT '{}');
-- guardrail-allow(center-key-fk): monitored_auctions: disposable fixture with the live columns the re-arm reads
CREATE TABLE public.monitored_auctions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, external_auction_url text,
  is_live boolean, auction_end_time timestamptz);
CREATE TABLE public.import_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, listing_url text UNIQUE, status text,
  attempts integer, last_attempt_at timestamptz, updated_at timestamptz DEFAULT now(), next_attempt_at timestamptz,
  locked_at timestamptz, locked_by text, revision_detail jsonb, next_action text);
INSERT INTO public.live_auction_sources VALUES
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707','bat','{"live_pull": {"lots_per_run": 8}}'), (gen_random_uuid(),'other','{}');

-- lot name -> (monitor live, monitor end, item source, item status, attempts, item last attempt)
CREATE TEMP TABLE lots(name text, live boolean, ends timestamptz, src uuid, status text, attempts int, attempted timestamptz);
INSERT INTO lots VALUES
 ('failed-old',     true,  now()-interval '3 days',   '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','failed',    5, '2026-11-20'),
 ('complete-old',   true,  now()-interval '2 days',   '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','complete',  1, '2026-11-24'),
 ('complete-old2',  true,  now()-interval '1 day',    '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','complete',  1, '2026-11-24'),
 ('revision-old',   true,  now()-interval '1 day',    '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','revision',  2, '2026-11-24'),
 ('after-fix',      true,  now()-interval '1 day',    '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','complete',  1, '2026-11-25 09:55+00'),
 ('retired',        false, now()-interval '1 day',    '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','failed',    5, '2026-11-20'),
 ('just-closed',    true,  now()-interval '5 minutes','4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','failed',    5, '2026-11-20'),
 ('still-running',  true,  now()+interval '1 day',    '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','failed',    5, '2026-11-20'),
 ('pending',        true,  now()-interval '1 day',    '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','pending',   1, '2026-11-20'),
 ('processing',     true,  now()-interval '1 day',    '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','processing',1, '2026-11-20'),
 ('other-queue',    true,  now()-interval '1 day',    gen_random_uuid(),                    'failed',    5, '2026-11-20');
INSERT INTO public.monitored_auctions(source_id, external_auction_url, is_live, auction_end_time)
  SELECT 'c8bb42ac-6d09-4453-bb0b-11a8689f5707', 'https://bringatrailer.com/listing/'||name, live, ends FROM lots;
INSERT INTO public.import_queue(source_id, listing_url, status, attempts, last_attempt_at, updated_at, next_action)
  SELECT src, 'https://bringatrailer.com/listing/'||name||'/', status, attempts, attempted, attempted,
         CASE WHEN status='revision' THEN 'reparse_retained' END FROM lots;
INSERT INTO public.monitored_auctions(source_id, external_auction_url, is_live, auction_end_time)
  SELECT id, 'https://bringatrailer.com/listing/other-source', true, now()-interval '1 day' FROM public.live_auction_sources WHERE slug='other';
INSERT INTO public.import_queue(source_id, listing_url, status, attempts, last_attempt_at)
  VALUES ('4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37','https://bringatrailer.com/listing/other-source/','failed',5,'2026-11-20');

\ir ../migrations/20261125213500_bat_settlement_rearm.sql
\ir ../migrations/20261125213500_bat_settlement_rearm.sql

DO $$
DECLARE r jsonb; s text;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname='bat-settlement-rearm' AND schedule='* * * * *' AND active
        AND command LIKE '%bat_settlement_rearm()%') <> 1 THEN RAISE EXCEPTION 'job not scheduled once'; END IF;
  IF (SELECT scraping_config #>> '{live_pull,settle_rearm,rows_per_minute}' FROM public.live_auction_sources WHERE slug='bat') <> '10'
     OR (SELECT scraping_config #>> '{live_pull,lots_per_run}' FROM public.live_auction_sources WHERE slug='bat') <> '8' THEN
    RAISE EXCEPTION 'rule row not written, or other live_pull keys lost';
  END IF;
  -- a 2-row rate for the test
  UPDATE public.live_auction_sources SET scraping_config = jsonb_set(scraping_config, '{live_pull,settle_rearm,rows_per_minute}', '2') WHERE slug='bat';

  -- a live lot ends within the pause window: nothing re-armed, gauge paused_closing
  INSERT INTO public.monitored_auctions(source_id, external_auction_url, is_live, auction_end_time)
    VALUES ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', 'https://bringatrailer.com/listing/closing-now', true, now() + interval '4 minutes');
  r := public.bat_settlement_rearm();
  IF r->>'status' <> 'paused_closing' OR (r->>'rearmed_this_run')::int <> 0 OR (SELECT count(*) FROM net.calls) <> 0 THEN
    RAISE EXCEPTION 'did not pause while a lot closes: %', r;
  END IF;
  DELETE FROM public.monitored_auctions WHERE external_auction_url LIKE '%/closing-now';

  -- first call, rate 2: the two newest-ended qualifying items
  r := public.bat_settlement_rearm();
  IF (r->>'rearmed_this_run')::int <> 2 OR (r->>'left')::int <> 1 OR r->>'status' <> 'running' THEN RAISE EXCEPTION 'first call %', r; END IF;
  SELECT string_agg(split_part(listing_url,'/',5), ',' ORDER BY listing_url) INTO s FROM public.import_queue
   WHERE status='pending' AND revision_detail ? 'requeued';
  IF s <> 'complete-old,complete-old2' THEN RAISE EXCEPTION 'first call re-armed %', s; END IF;
  IF NOT (SELECT active FROM cron.job WHERE jobname='bat-settlement-rearm') THEN RAISE EXCEPTION 'job stopped with items left'; END IF;
  IF EXISTS (SELECT 1 FROM public.import_queue WHERE revision_detail ? 'requeued'
             AND (attempts <> 7 OR next_attempt_at IS NOT NULL OR locked_at IS NOT NULL
                  OR revision_detail #>> '{requeued,from_status}' <> 'complete' OR revision_detail #>> '{requeued,attempts_before}' <> '1')) THEN
    RAISE EXCEPTION 'attempts not raised to the floor, row not claimable, or history not kept';
  END IF;
  IF (SELECT count(*) FROM net.calls) <> 1
     OR (SELECT body FROM net.calls) <> '{"batch_size": 2, "source_id": "4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37"}'::jsonb
     OR (SELECT url FROM net.calls) <> 'https://fixture.invalid/functions/v1/process-import-queue' THEN
    RAISE EXCEPTION 'drain post wrong';
  END IF;
  IF (SELECT assay_status FROM public.v_job_health WHERE jobname='bat-settlement-rearm') <> 'running'
     OR (SELECT assay->>'rearmed_total' FROM public.v_job_health WHERE jobname='bat-settlement-rearm') <> '2'
     OR (SELECT assay_status FROM public.v_job_health WHERE jobname='bat-live-pull') <> 'passed' THEN
    RAISE EXCEPTION 'gauge not shown in v_job_health, or a named assay changed';
  END IF;

  -- the drain claims them (stamps last_attempt_at = now) and the reads complete without retiring the monitor
  UPDATE public.import_queue SET status='complete', attempts=8, last_attempt_at=now(), updated_at=now() WHERE status='pending' AND revision_detail ? 'requeued';

  -- second call: only failed-old is left; the job goes inactive and the gauge says done
  r := public.bat_settlement_rearm();
  IF (r->>'rearmed_this_run')::int <> 1 OR (r->>'left')::int <> 0 OR r->>'status' <> 'done' THEN RAISE EXCEPTION 'second call %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_queue WHERE listing_url LIKE '%/failed-old/' AND status='pending' AND attempts=7) THEN
    RAISE EXCEPTION 'failed-old not re-armed at the floor';
  END IF;
  IF (SELECT active FROM cron.job WHERE jobname='bat-settlement-rearm') THEN RAISE EXCEPTION 'job still active when none left'; END IF;
  IF (SELECT health_status || '/' || assay_status FROM public.v_job_health WHERE jobname='bat-settlement-rearm') <> 'paused/done' THEN
    RAISE EXCEPTION 'v_job_health does not say done';
  END IF;
  UPDATE public.import_queue SET status='failed', attempts=8, last_attempt_at=now() WHERE listing_url LIKE '%/failed-old/';

  r := public.bat_settlement_rearm();
  IF (r->>'rearmed_this_run')::int <> 0 OR (SELECT count(*) FROM net.calls) <> 2 THEN RAISE EXCEPTION 'empty call posted or re-armed: %', r; END IF;

  -- never touched
  SELECT string_agg(split_part(listing_url,'/',5)||'='||status||'/'||coalesce(revision_detail::text,'-'), ',' ORDER BY listing_url) INTO s FROM public.import_queue
   WHERE split_part(listing_url,'/',5) IN ('after-fix','retired','just-closed','still-running','pending','processing','other-queue','other-source','revision-old');
  IF s <> 'after-fix=complete/-,just-closed=failed/-,other-queue=failed/-,other-source=failed/-,pending=pending/-,processing=processing/-,retired=failed/-,revision-old=revision/-,still-running=failed/-' THEN
    RAISE EXCEPTION 'excluded rows changed: %', s;
  END IF;
  IF public.requeue_import_queue_item((SELECT id FROM public.import_queue WHERE listing_url LIKE '%/revision-old/'), 'test', 0) THEN
    RAISE EXCEPTION 'the writer re-pended a revision item';
  END IF;
END $$;

-- malformed rule row: refuse, do not guess
UPDATE public.live_auction_sources SET scraping_config = jsonb_set(scraping_config, '{live_pull,settle_rearm,rows_per_minute}', '"ten"') WHERE slug='bat';
DO $$ BEGIN
  PERFORM public.bat_settlement_rearm();
  RAISE EXCEPTION 'malformed rule row accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'bat_settlement_rearm: rule row%' THEN RAISE; END IF;
END $$;

DO $$ BEGIN
  IF has_function_privilege('anon', 'public.bat_settlement_rearm()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.bat_settlement_rearm()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.requeue_import_queue_item(uuid,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.requeue_import_queue_item(uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon or authenticated can execute the re-arm or the writer';
  END IF;
END $$;
SELECT 'test_bat_settlement_rearm PASS';
