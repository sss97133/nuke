-- Isolated PostgreSQL 17 contract for 20261016200000_sync_local_vision_tags_noop.sql and
-- 20261016201000_user_image_counts.sql. Synthetic rows only.
--   createdb dm_refinement_user_image_counts
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_user_image_counts -f supabase/sql/test_user_image_counts.sql
-- Fixtures: the vehicle_images columns these functions read, its updated_at trigger and user indexes, the API roles,
-- auth.uid() from request.jwt.claims, and the five owner status readers and sync_local_vision_tags as defined live on
-- 2026-10-15 (pg_get_functiondef), with their live grants. A copy of each live reader stays in schema legacy as the
-- direct count.
-- Covered: after the backfill and after every kind of write (single and multi-row inserts, upserts, status, vehicle,
-- source, user, taken_at and created_at changes, supersession, deep-analysis keys added and removed, deletes, a rolled
-- back transaction, compaction, a re-run band), each new reader returns exactly what the live reader returns for the
-- owner, a stranger and a user with no images; the owner gate (is_owner_view, the stream's auth.uid() scope, anon
-- grants) is unchanged; the new tables are not readable through the API roles; rows with no user_id write no counts;
-- the tag push leaves unchanged rows untouched and reports what it reported before.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';  -- production's database and API sessions run in UTC
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.as_uid(p_uid text) RETURNS text LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
   ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS
$$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true $$;

CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text, column_name text, owned_by text, description text,
  do_not_write_directly boolean, write_via text, UNIQUE (table_name, column_name));
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, trim text);
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  session_date date, image_count integer, duration_minutes integer);
CREATE TABLE public.analysis_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(),
  user_id uuid, vehicle_id uuid, image_id uuid, stage text, detail jsonb);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, source text DEFAULT 'user_upload',
  ai_processing_status text DEFAULT 'pending', created_at timestamptz DEFAULT now(), taken_at timestamptz,
  updated_at timestamptz DEFAULT now(), is_superseded boolean DEFAULT false, is_duplicate boolean DEFAULT false,
  ai_scan_metadata jsonb DEFAULT '{}'::jsonb, exif_data jsonb, apple_ml_labels text[], thumbnail_url text,
  medium_url text, image_url text, phash text, work_session_id uuid, image_vehicle_match_status text);
CREATE INDEX idx_vehicle_images_user_sync ON public.vehicle_images (user_id)
  INCLUDE (source, ai_processing_status, vehicle_id, created_at, taken_at);
CREATE INDEX idx_vehicle_images_user_capture_stats ON public.vehicle_images (user_id, source, created_at, taken_at);
CREATE INDEX idx_vehicle_images_user_contrib_day ON public.vehicle_images (user_id, COALESCE(taken_at, created_at));
CREATE INDEX idx_vehicle_images_user_created ON public.vehicle_images (user_id, created_at DESC);
CREATE INDEX idx_vehicle_images_user_taken_at ON public.vehicle_images (user_id, taken_at);
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER update_vehicle_images_updated_at BEFORE UPDATE ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The live definitions of 2026-10-15.
CREATE OR REPLACE FUNCTION public.get_user_sync_status(p_user_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'is_owner_view',   (auth.uid() = p_user_id),
    'synced_total',    count(*) FILTER (WHERE source='capture_relay_ios'),
    'analyzed_total',  count(*) FILTER (WHERE source='capture_relay_ios' AND ai_processing_status='analyzed'),
    'pending_total',   count(*) FILTER (WHERE source='capture_relay_ios' AND ai_processing_status IN ('pending','processing','queued')),
    'filed_total',     count(*) FILTER (WHERE source='capture_relay_ios' AND vehicle_id IS NOT NULL),
    'all_sources_total', count(*),
    'last_synced_at',  max(created_at) FILTER (WHERE source='capture_relay_ios'),
    'last_taken_at',   max(taken_at)  FILTER (WHERE source='capture_relay_ios')
  )
  FROM public.vehicle_images
  WHERE user_id = p_user_id;
$function$;
CREATE OR REPLACE FUNCTION public.get_user_capture_stats(p_user_id uuid)
 RETURNS TABLE(total_images integer, uploaded_today integer, analyzed integer, contribution_days integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    base.total_images,
    base.uploaded_today,
    (SELECT coalesce(sum(image_count),0)::integer FROM work_sessions WHERE user_id = p_user_id) AS analyzed,
    base.contribution_days
  FROM (
    SELECT
      count(*)::integer AS total_images,
      count(*) FILTER (
        WHERE vi.created_at::date
              = (now() AT TIME ZONE 'America/Los_Angeles')::date
      )::integer AS uploaded_today,
      count(DISTINCT coalesce(vi.taken_at, vi.created_at)::date)::integer
        AS contribution_days
    FROM vehicle_images vi
    WHERE vi.user_id = p_user_id
      AND vi.source NOT IN (
        'bat_import','bat_listing','external_import',
        'organization_import','scraper','scraped'
      )
  ) base;
$function$;
CREATE OR REPLACE FUNCTION public.get_user_analyzed_count(p_user_id uuid)
 RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT count(*)::bigint
  FROM public.vehicle_images
  WHERE source = 'capture_relay_ios'
    AND user_id = p_user_id
    AND ai_processing_status = 'analyzed';
$function$;
CREATE OR REPLACE FUNCTION public.get_user_producer_signals(p_user_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH ws AS (
    SELECT session_date, duration_minutes
    FROM work_sessions WHERE user_id = p_user_id AND session_date IS NOT NULL
  ),
  days AS (SELECT DISTINCT session_date d FROM ws),
  islands AS (SELECT d, (d - (row_number() OVER (ORDER BY d))::int) grp FROM days),
  runs AS (SELECT grp, count(*) len, max(d) last_d FROM islands GROUP BY grp),
  cap AS (SELECT total_images, uploaded_today FROM get_user_capture_stats(p_user_id) LIMIT 1)
  SELECT jsonb_build_object(
    'last_worked',     (SELECT max(d) FROM days),
    'worked_today',    EXISTS(SELECT 1 FROM days WHERE d = current_date),
    'work_days_total', (SELECT count(*) FROM days),
    'work_days_year',  (SELECT count(*) FROM days WHERE d >= date_trunc('year', now())::date),
    'hours_total',     round((SELECT coalesce(sum(duration_minutes),0) FROM ws) / 60.0),
    'hours_year',      round((SELECT coalesce(sum(duration_minutes),0) FROM ws WHERE session_date >= date_trunc('year', now())::date) / 60.0),
    'current_streak',  coalesce((SELECT len FROM runs WHERE last_d >= current_date - 1 ORDER BY last_d DESC LIMIT 1), 0),
    'longest_streak',  coalesce((SELECT max(len) FROM runs), 0),
    'images_total',    (SELECT total_images FROM cap),
    'images_analyzed', get_user_analyzed_count(p_user_id),
    'images_today',    (SELECT uploaded_today FROM cap),
    'active_today',    (EXISTS(SELECT 1 FROM days WHERE d = current_date)
                        OR coalesce((SELECT uploaded_today FROM cap), 0) > 0)
  )
$function$;
CREATE OR REPLACE FUNCTION public.get_analysis_stream(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 40)
 RETURNS TABLE(image_id uuid, vehicle_id uuid, vehicle text, thumbnail_url text, image_url text, landed_at timestamp with time zone, scene_type text, build_phase text, narrative text, components jsonb, text_regions jsonb, state jsonb, hashed boolean, sessioned boolean, is_duplicate boolean, match_status text, intent text, needs_clarification boolean, attribution_doubt text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    vi.id,
    vi.vehicle_id,
    nullif(trim(concat_ws(' ', v.year, v.make, v.model, v.trim)), '') AS vehicle,
    coalesce(vi.thumbnail_url, vi.medium_url, vi.image_url) AS thumbnail_url,
    vi.image_url,
    vi.updated_at AS landed_at,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type'         AS scene_type,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess'  AS build_phase,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line' AS narrative,
    vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen'     AS components,
    vi.ai_scan_metadata->'byok_deep_analysis'->'text_regions'        AS text_regions,
    vi.ai_scan_metadata->'byok_deep_analysis'->'state_observations'  AS state,
    (vi.phash IS NOT NULL)                  AS hashed,
    (vi.work_session_id IS NOT NULL)        AS sessioned,
    coalesce(vi.is_duplicate, false)        AS is_duplicate,
    vi.image_vehicle_match_status           AS match_status,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' AS intent,
    coalesce((vi.ai_scan_metadata->'byok_deep_analysis'->>'needs_clarification')::boolean, false) AS needs_clarification,
    case
      when vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type' in ('product_screenshot','spreadsheet')
        then 'screen material (saved listing / document), not a frame of the attributed vehicle'
      when vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type' = 'cross_reference'
       and vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' = 'acquisition'
        then 'reference material for a candidate purchase, not the attributed build'
      else null
    end AS attribution_doubt
  FROM vehicle_images vi
  JOIN vehicles v ON v.id = vi.vehicle_id
  WHERE vi.user_id = auth.uid()
    AND vi.ai_scan_metadata ? 'byok_deep_analysis'
    AND coalesce(vi.is_superseded, false) = false
    AND (p_since IS NULL OR vi.updated_at > p_since)
  ORDER BY vi.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 40), 100));
$function$;
CREATE OR REPLACE FUNCTION public.sync_local_vision_tags(p_batch jsonb, p_source text DEFAULT 'blur_app_localstore'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_user        uuid := auth.uid();
  v_received    int;
  v_matched     int;
  v_matched_ids text[];
begin
  if v_user is null then
    raise exception 'sync_local_vision_tags: authentication required';
  end if;
  if jsonb_typeof(p_batch) <> 'array' then
    raise exception 'sync_local_vision_tags: p_batch must be a JSON array';
  end if;
  v_received := jsonb_array_length(p_batch);
  with items as (
    select x.local_id, x.labels,
      case when jsonb_typeof(x.labels) = 'array' then array(select jsonb_array_elements_text(x.labels)) else null end as labels_arr,
      x.is_vehicle, x.is_personal, x.owner_verdict
    from jsonb_to_recordset(p_batch)
      as x(local_id text, labels jsonb, is_vehicle boolean, is_personal boolean, owner_verdict text)
    where x.local_id is not null and x.local_id <> ''
  ),
  upd as (
    update vehicle_images vi
    set
      apple_ml_labels = case
        when (vi.apple_ml_labels is null or cardinality(vi.apple_ml_labels) = 0) and i.labels_arr is not null
        then i.labels_arr else vi.apple_ml_labels end,
      ai_scan_metadata = case
        when coalesce(p_source,'') <> 'blur_app_localstore' and vi.ai_scan_metadata ? 'on_device_vision'
          then vi.ai_scan_metadata
        else jsonb_set(coalesce(vi.ai_scan_metadata, '{}'::jsonb), '{on_device_vision}',
          jsonb_build_object('source', coalesce(p_source, 'blur_app_localstore'), 'labels', coalesce(i.labels, '[]'::jsonb),
            'is_vehicle', i.is_vehicle, 'is_personal', i.is_personal, 'owner_verdict', i.owner_verdict,
            'synced_at', to_jsonb(now())), true) end
    from items i
    where vi.user_id = v_user and vi.exif_data->>'uuid' = i.local_id
    returning i.local_id
  )
  select count(distinct local_id), array_agg(distinct local_id) into v_matched, v_matched_ids from upd;
  begin
    insert into analysis_events (user_id, stage, detail)
    values (v_user, 'tag_sync_batch', jsonb_build_object('received', v_received, 'matched', coalesce(v_matched, 0),
      'source', coalesce(p_source, 'blur_app_localstore'), 'sample_local_id', p_batch->0->>'local_id'));
  exception when others then null;
  end;
  return jsonb_build_object('received', v_received, 'matched', coalesce(v_matched, 0),
    'matched_ids', to_jsonb(coalesce(v_matched_ids, array[]::text[])));
end;
$function$;
-- Live grants: get_analysis_stream to PUBLIC, anon, authenticated, service_role; the rest to authenticated, service_role.
REVOKE ALL ON FUNCTION public.get_user_sync_status(uuid), public.get_user_capture_stats(uuid),
  public.get_user_analyzed_count(uuid), public.get_user_producer_signals(uuid), public.sync_local_vision_tags(jsonb, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_sync_status(uuid), public.get_user_capture_stats(uuid),
  public.get_user_analyzed_count(uuid), public.get_user_producer_signals(uuid), public.sync_local_vision_tags(jsonb, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_analysis_stream(timestamptz, integer) TO anon, authenticated, service_role;

-- legacy.*: the live readers, kept as the direct count to compare against.
CREATE SCHEMA legacy;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['get_user_sync_status(uuid)', 'get_user_capture_stats(uuid)', 'get_user_analyzed_count(uuid)',
                           'get_user_producer_signals(uuid)', 'get_analysis_stream(timestamptz,integer)'] LOOP
    EXECUTE replace(replace(replace(pg_get_functiondef(('public.' || f)::regprocedure),
      'FUNCTION public.', 'FUNCTION legacy.'),
      'FROM get_user_capture_stats(', 'FROM legacy.get_user_capture_stats('),
      'get_user_analyzed_count(p_user_id),', 'legacy.get_user_analyzed_count(p_user_id),');
  END LOOP;
END $$;
CREATE TABLE pg_temp.acl_before AS
  SELECT p.oid::regprocedure::text AS f, p.proacl::text AS acl FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_user_sync_status','get_user_capture_stats',
    'get_user_analyzed_count','get_user_producer_signals','get_analysis_stream','sync_local_vision_tags');

-- Users: owner A, stranger B, C with no images. Vehicles V1 (A), V2 (B).
INSERT INTO public.vehicles VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 1977, 'Chevrolet', 'K5 Blazer', NULL),
  ('b0000000-0000-0000-0000-0000000000b2', 1968, 'Ford', 'Mustang', 'Fastback');
INSERT INTO public.work_sessions (user_id, vehicle_id, session_date, image_count, duration_minutes) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-0000000000a1', current_date - 1, 12, 95),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-0000000000a1', current_date, 4, 30);

-- Rows that exist before the migration (the backfill counts them). 400 rows for A across 120 days and 8 sources, 30
-- for B, 200 with no user, plus NULL source, NULL created_at, NULL taken_at and both NULL.
INSERT INTO public.vehicle_images (user_id, vehicle_id, source, ai_processing_status, created_at, taken_at, updated_at,
  is_superseded, ai_scan_metadata, exif_data, image_url)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       CASE WHEN n % 3 = 0 THEN NULL ELSE 'a0000000-0000-0000-0000-0000000000a1'::uuid END,
       (ARRAY['capture_relay_ios','capture_relay_ios','capture_relay_ios','iphoto','user_upload','bat_import','scraped',NULL])[1 + n % 8],
       (ARRAY['pending','processing','queued','analyzed','completed','failed',NULL,'skipped'])[1 + (n / 8) % 8],
       timestamptz '2026-06-01 03:00+00' + (n % 120) * interval '1 day' + (n % 7) * interval '3 hours',
       CASE WHEN n % 11 = 0 THEN NULL ELSE timestamptz '2025-12-01 18:00+00' + (n % 90) * interval '1 day' + n * interval '1 minute' END,
       timestamptz '2026-10-01 00:00+00' + n * interval '1 minute',
       n % 17 = 0,
       CASE WHEN n % 5 = 0 THEN jsonb_build_object('byok_deep_analysis', jsonb_build_object('scene_type',
              (ARRAY['engine_bay','product_screenshot','cross_reference','interior'])[1 + n % 4], 'intent',
              (ARRAY['build','acquisition'])[1 + n % 2], 'narrative_one_line', 'frame ' || n))
            ELSE '{}'::jsonb END,
       jsonb_build_object('uuid', 'L' || n),
       'https://images.example/a' || n || '.jpg'
FROM generate_series(1, 400) n;
INSERT INTO public.vehicle_images (user_id, vehicle_id, source, ai_processing_status, created_at, taken_at, updated_at, ai_scan_metadata, exif_data)
SELECT 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'b0000000-0000-0000-0000-0000000000b2',
       CASE WHEN n % 2 = 0 THEN 'capture_relay_ios' ELSE 'iphoto' END, 'analyzed',
       timestamptz '2026-07-01 12:00+00' + n * interval '1 day', timestamptz '2026-06-15 12:00+00' + n * interval '1 day',
       timestamptz '2026-10-02 00:00+00' + n * interval '1 minute',
       CASE WHEN n % 3 = 0 THEN '{"byok_deep_analysis":{"scene_type":"engine_bay"}}'::jsonb ELSE '{}'::jsonb END,
       jsonb_build_object('uuid', 'L' || n)
FROM generate_series(1, 30) n;
INSERT INTO public.vehicle_images (user_id, source, created_at, taken_at)
SELECT NULL, 'bat_import', now() - n * interval '1 hour', now() - n * interval '1 day' FROM generate_series(1, 200) n;
INSERT INTO public.vehicle_images (user_id, vehicle_id, source, ai_processing_status, created_at, taken_at) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'capture_relay_ios', 'pending', NULL, NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'capture_relay_ios', 'analyzed', NULL, '2026-02-03 04:05+00'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-0000000000a1', 'iphoto', NULL,
     ((now() AT TIME ZONE 'America/Los_Angeles')::date + time '12:00') AT TIME ZONE 'UTC', NULL);

-- Compare every new reader with legacy for A, B and C, as the owner, a stranger and with no claims.
CREATE FUNCTION pg_temp.check_all(label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  u uuid;
  caller text;
  n_ok integer := 0;
BEGIN
  FOREACH caller IN ARRAY ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ''] LOOP
    PERFORM pg_temp.as_uid(caller);
    FOREACH u IN ARRAY ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                             'cccccccc-cccc-cccc-cccc-cccccccccccc']::uuid[] LOOP
      IF public.get_user_sync_status(u) IS DISTINCT FROM legacy.get_user_sync_status(u) THEN
        RAISE EXCEPTION 'Contract failed: % sync_status for % as "%": new % live %', label, u, caller,
          public.get_user_sync_status(u), legacy.get_user_sync_status(u);
      END IF;
      IF (SELECT to_jsonb(s) FROM public.get_user_capture_stats(u) s)
         IS DISTINCT FROM (SELECT to_jsonb(s) FROM legacy.get_user_capture_stats(u) s) THEN
        RAISE EXCEPTION 'Contract failed: % capture_stats for %: new % live %', label, u,
          (SELECT to_jsonb(s) FROM public.get_user_capture_stats(u) s), (SELECT to_jsonb(s) FROM legacy.get_user_capture_stats(u) s);
      END IF;
      IF (SELECT count(*) FROM public.get_user_capture_stats(u)) <> 1 THEN
        RAISE EXCEPTION 'Contract failed: % capture_stats returns one row', label;
      END IF;
      IF public.get_user_analyzed_count(u) IS DISTINCT FROM legacy.get_user_analyzed_count(u) THEN
        RAISE EXCEPTION 'Contract failed: % analyzed_count for %', label, u;
      END IF;
      IF public.get_user_producer_signals(u) IS DISTINCT FROM legacy.get_user_producer_signals(u) THEN
        RAISE EXCEPTION 'Contract failed: % producer_signals for %: new % live %', label, u,
          public.get_user_producer_signals(u), legacy.get_user_producer_signals(u);
      END IF;
      n_ok := n_ok + 1;
    END LOOP;
    -- the stream: same rows in the same order (p_limit 100 holds every fixture deep read), and a cut at 5 rows
    IF (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.landed_at DESC, s.image_id), '[]') FROM public.get_analysis_stream(NULL, 100) s)
       IS DISTINCT FROM
       (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.landed_at DESC, s.image_id), '[]') FROM legacy.get_analysis_stream(NULL, 100) s) THEN
      RAISE EXCEPTION 'Contract failed: % analysis stream as "%"', label, caller;
    END IF;
    IF (SELECT array_agg(s.landed_at ORDER BY s.landed_at DESC) FROM public.get_analysis_stream(NULL, 5) s)
       IS DISTINCT FROM (SELECT array_agg(s.landed_at ORDER BY s.landed_at DESC) FROM legacy.get_analysis_stream(NULL, 5) s) THEN
      RAISE EXCEPTION 'Contract failed: % analysis stream first 5 as "%"', label, caller;
    END IF;
    IF (SELECT coalesce(jsonb_agg(s.image_id ORDER BY s.landed_at DESC, s.image_id), '[]') FROM public.get_analysis_stream('2026-10-01 03:00+00', 100) s)
       IS DISTINCT FROM
       (SELECT coalesce(jsonb_agg(s.image_id ORDER BY s.landed_at DESC, s.image_id), '[]') FROM legacy.get_analysis_stream('2026-10-01 03:00+00', 100) s) THEN
      RAISE EXCEPTION 'Contract failed: % analysis stream since as "%"', label, caller;
    END IF;
  END LOOP;
  PERFORM pg_temp.as_uid('');
  RAISE NOTICE 'PASS % (% reader comparisons, 9 stream comparisons)', label, n_ok * 4;
END $$;

SELECT pg_temp.check_all('fixture: public is the live definition');
SELECT pg_temp.ok('fixture holds deep reads for A and B, pending and analyzed captures, and an upload today',
  (SELECT count(DISTINCT user_id) FROM public.vehicle_images WHERE ai_scan_metadata ? 'byok_deep_analysis') = 2
  AND (legacy.get_user_sync_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')->>'pending_total')::int > 0
  AND (legacy.get_user_sync_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')->>'analyzed_total')::int > 0
  AND (SELECT uploaded_today FROM legacy.get_user_capture_stats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')) = 1);

\ir ../migrations/20261016200000_sync_local_vision_tags_noop.sql
\ir ../migrations/20261016201000_user_image_counts.sql
SET statement_timeout = '60s';

SELECT pg_temp.ok('grants on the readers and the tag push are unchanged',
  NOT EXISTS (SELECT 1 FROM pg_temp.acl_before b JOIN pg_proc p ON p.oid::regprocedure::text = b.f
              WHERE p.proacl::text IS DISTINCT FROM b.acl)
  AND (SELECT count(*) FROM pg_temp.acl_before) = 6);
SELECT pg_temp.ok('three statement triggers on vehicle_images',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.vehicle_images'::regclass
     AND tgname LIKE 'trg_user_image_counts_%' AND NOT tgisinternal AND (tgtype & 1) = 0) = 3);
SELECT pg_temp.ok('compaction job scheduled every 15 minutes',
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compact-user-image-counts' AND schedule = '*/15 * * * *'));
SELECT pg_temp.ok('both tables registered in pipeline_registry',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name IN ('user_image_counts','user_image_deep_reads') AND column_name IS NULL) = 2);
SELECT pg_temp.ok('the backfill counted every user row and no row without a user',
  (SELECT sum(n_all) FROM public.user_image_counts) = (SELECT count(*) FROM public.vehicle_images WHERE user_id IS NOT NULL)
  AND (SELECT count(*) FROM public.user_image_deep_reads)
      = (SELECT count(*) FROM public.vehicle_images WHERE user_id IS NOT NULL AND is_superseded IS NOT TRUE
           AND ai_scan_metadata ? 'byok_deep_analysis'));
SELECT pg_temp.check_all('after backfill');

-- Owner gate.
SELECT pg_temp.as_uid('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT pg_temp.ok('owner: is_owner_view true, stream holds only the owner''s images',
  (public.get_user_sync_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')->>'is_owner_view')::boolean
  AND (SELECT count(*) FROM public.get_analysis_stream(NULL, 100)) > 0
  AND NOT EXISTS (SELECT 1 FROM public.get_analysis_stream(NULL, 100) s JOIN public.vehicle_images vi ON vi.id = s.image_id
                  WHERE vi.user_id <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
SELECT pg_temp.as_uid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET ROLE authenticated;
SELECT pg_temp.ok('stranger: gets the owner''s counts with is_owner_view false, as before',
  (public.get_user_sync_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')->>'is_owner_view')::boolean = false
  AND (public.get_user_sync_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')->>'all_sources_total')::int = 403);
SELECT pg_temp.ok('stranger: the stream shows only the stranger''s own deep reads',
  (SELECT count(*) FROM public.get_analysis_stream(NULL, 100)) = 10
  AND NOT EXISTS (SELECT 1 FROM public.get_analysis_stream(NULL, 100) s
                  WHERE s.vehicle_id <> 'b0000000-0000-0000-0000-0000000000b2'));
DO $$ BEGIN
  PERFORM count(*) FROM public.user_image_counts;
  RAISE EXCEPTION 'Contract failed: authenticated read user_image_counts';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS authenticated cannot read user_image_counts';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM public.user_image_deep_reads;
  RAISE EXCEPTION 'Contract failed: authenticated read user_image_deep_reads';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS authenticated cannot read user_image_deep_reads';
END $$;
RESET ROLE;
SELECT pg_temp.as_uid('');
SET ROLE anon;
DO $$ BEGIN
  PERFORM public.get_user_sync_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  RAISE EXCEPTION 'Contract failed: anon called get_user_sync_status';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon still cannot call get_user_sync_status';
END $$;
DO $$ BEGIN
  PERFORM public.get_user_capture_stats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  RAISE EXCEPTION 'Contract failed: anon called get_user_capture_stats';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon still cannot call get_user_capture_stats';
END $$;
SELECT pg_temp.ok('anon: get_analysis_stream runs and returns no rows, as before',
  (SELECT count(*) FROM public.get_analysis_stream(NULL, 100)) = 0);
RESET ROLE;

-- Writes after the migration. Each block is its own statement (and transaction) so updated_at moves between them.
INSERT INTO public.vehicle_images (user_id, vehicle_id, source, ai_processing_status, created_at, taken_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'capture_relay_ios', 'pending', now(), now() - interval '2 hours');
INSERT INTO public.vehicle_images (user_id, vehicle_id, source, ai_processing_status, created_at, taken_at, ai_scan_metadata)
SELECT (ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',NULL])[1 + n % 3]::uuid,
       CASE WHEN n % 2 = 0 THEN 'a0000000-0000-0000-0000-0000000000a1'::uuid END,
       (ARRAY['capture_relay_ios','iphoto','scraper'])[1 + n % 3], 'queued',
       ((now() AT TIME ZONE 'America/Los_Angeles')::date + time '09:00') AT TIME ZONE 'UTC' + n * interval '1 minute',
       timestamptz '2027-01-05 10:00+00' + n * interval '1 hour',
       CASE WHEN n % 4 = 0 THEN '{"byok_deep_analysis":{"scene_type":"spreadsheet"}}'::jsonb ELSE '{}'::jsonb END
FROM generate_series(1, 40) n;
SELECT pg_temp.check_all('after inserts');

UPDATE public.vehicle_images SET ai_processing_status = 'analyzed'
WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND source = 'capture_relay_ios' AND ai_processing_status IN ('pending', 'queued');
UPDATE public.vehicle_images SET vehicle_id = 'a0000000-0000-0000-0000-0000000000a1'
WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND vehicle_id IS NULL AND exif_data->>'uuid' IN ('L3', 'L6', 'L9');
UPDATE public.vehicle_images SET source = 'iphoto' WHERE exif_data->>'uuid' IN ('L8', 'L16') AND user_id IS NOT NULL;
SELECT pg_temp.check_all('after status, vehicle and source updates');

-- The latest capture taken_at moves earlier, then away; the latest capture created_at row leaves the user.
UPDATE public.vehicle_images SET taken_at = taken_at - interval '400 days'
WHERE id = (SELECT id FROM public.vehicle_images WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
              AND source = 'capture_relay_ios' ORDER BY taken_at DESC NULLS LAST LIMIT 1);
UPDATE public.vehicle_images SET taken_at = NULL
WHERE id = (SELECT id FROM public.vehicle_images WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
              AND source = 'capture_relay_ios' ORDER BY taken_at DESC NULLS LAST LIMIT 1);
UPDATE public.vehicle_images SET user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
WHERE id = (SELECT id FROM public.vehicle_images WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
              AND source = 'capture_relay_ios' ORDER BY created_at DESC NULLS LAST LIMIT 1);
UPDATE public.vehicle_images SET user_id = NULL WHERE exif_data->>'uuid' IN ('L20', 'L25') AND user_id IS NOT NULL;
UPDATE public.vehicle_images SET user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
WHERE user_id IS NULL AND id IN (SELECT id FROM public.vehicle_images WHERE user_id IS NULL ORDER BY id LIMIT 3);
UPDATE public.vehicle_images SET created_at = created_at - interval '30 days' WHERE exif_data->>'uuid' IN ('L30', 'L31', 'L32');
UPDATE public.vehicle_images SET created_at = NULL WHERE exif_data->>'uuid' = 'L33' AND user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT pg_temp.check_all('after taken_at, user and created_at moves');

UPDATE public.vehicle_images SET is_superseded = true WHERE exif_data->>'uuid' IN ('L10', 'L15') AND user_id IS NOT NULL;
UPDATE public.vehicle_images SET is_superseded = false WHERE exif_data->>'uuid' = 'L85';
UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata - 'byok_deep_analysis' WHERE exif_data->>'uuid' = 'L35';
UPDATE public.vehicle_images
SET ai_scan_metadata = ai_scan_metadata || '{"byok_deep_analysis":{"scene_type":"cross_reference","intent":"acquisition"}}'
WHERE exif_data->>'uuid' IN ('L41', 'L42', 'L43') AND user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE public.vehicle_images SET image_vehicle_match_status = 'confirmed' WHERE exif_data->>'uuid' = 'L50';
SELECT pg_temp.check_all('after supersession and deep-analysis changes');

INSERT INTO public.vehicle_images (id, user_id, source, ai_processing_status, created_at, taken_at)
SELECT id, user_id, source, 'failed', created_at, taken_at FROM public.vehicle_images
WHERE exif_data->>'uuid' IN ('L60', 'L61') AND user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
UNION ALL SELECT gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'capture_relay_ios', 'processing', now(), now()
ON CONFLICT (id) DO UPDATE SET ai_processing_status = excluded.ai_processing_status, source = 'user_upload';
DELETE FROM public.vehicle_images
WHERE id = (SELECT id FROM public.vehicle_images WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
              AND source = 'capture_relay_ios' ORDER BY created_at DESC NULLS LAST LIMIT 1);
DELETE FROM public.vehicle_images WHERE exif_data->>'uuid' IN ('L45', 'L55', 'L65') AND user_id IS NOT NULL;
BEGIN;
UPDATE public.vehicle_images SET source = 'scraped' WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DELETE FROM public.vehicle_images WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
ROLLBACK;
SELECT pg_temp.check_all('after upsert, deletes and a rolled-back transaction');

SELECT pg_temp.ok('rows without a user_id write no counts',
  NOT EXISTS (SELECT 1 FROM public.user_image_counts WHERE user_id IS NULL));
CREATE TABLE pg_temp.before_compact AS SELECT count(*) AS n FROM public.user_image_counts;
SELECT public.compact_user_image_counts();
SELECT pg_temp.ok('compaction leaves one row per key and no all-zero key',
  (SELECT count(*) FROM public.user_image_counts) < (SELECT n FROM pg_temp.before_compact)
  AND NOT EXISTS (SELECT 1 FROM public.user_image_counts GROUP BY user_id, taken_day, created_day HAVING count(*) > 1)
  AND NOT EXISTS (SELECT 1 FROM public.user_image_counts WHERE n_all = 0 AND n_owned = 0 AND n_capture = 0
                    AND n_capture_analyzed = 0 AND n_capture_pending = 0 AND n_capture_filed = 0 AND n_capture_taken = 0));
SELECT pg_temp.check_all('after compaction');
SELECT pg_temp.ok('a second compaction merges nothing',
  (public.compact_user_image_counts()->>'rows_merged')::int = 0);
SELECT public.backfill_user_image_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-01-01', '2026-03-01');
SELECT public.backfill_user_image_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, NULL);
SELECT public.compact_user_image_counts(3);
SELECT pg_temp.check_all('after a re-run band and a bounded compaction');

-- The tag push: matched as before; an unchanged push writes nothing.
CREATE TABLE pg_temp.tag_row AS
  SELECT id FROM public.vehicle_images WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND exif_data->>'uuid' = 'L70';
INSERT INTO public.vehicle_images (user_id, source, exif_data) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'iphoto', '{"uuid":"L70"}');
CREATE TABLE pg_temp.tag_calls (k text PRIMARY KEY, result jsonb, xmin_after text, synced_at text, updated_at timestamptz);
CREATE FUNCTION pg_temp.push(k text, batch jsonb, src text DEFAULT 'blur_app_localstore') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_uid('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  INSERT INTO pg_temp.tag_calls (k, result) VALUES (k, public.sync_local_vision_tags(batch, src));
END $$;
CREATE FUNCTION pg_temp.snap(k text) RETURNS void LANGUAGE sql AS $$
  UPDATE pg_temp.tag_calls c SET xmin_after = vi.xmin::text, synced_at = vi.ai_scan_metadata->'on_device_vision'->>'synced_at',
    updated_at = vi.updated_at
  FROM public.vehicle_images vi WHERE vi.id = (SELECT id FROM pg_temp.tag_row) AND c.k = snap.k $$;
SELECT pg_temp.push('first', '[{"local_id":"L70","labels":["truck","wheel"],"is_vehicle":true,"is_personal":false},{"local_id":"nope"},{"local_id":""}]');
SELECT pg_temp.snap('first');
SELECT pg_temp.push('same', '[{"local_id":"L70","labels":["truck","wheel"],"is_vehicle":true,"is_personal":false},{"local_id":"nope"},{"local_id":""}]');
SELECT pg_temp.snap('same');
SELECT pg_temp.push('changed', '[{"local_id":"L70","labels":["truck","wheel"],"is_vehicle":true,"is_personal":true}]');
SELECT pg_temp.snap('changed');
SELECT pg_temp.push('bulk', '[{"local_id":"L70","labels":["sedan"],"is_vehicle":false}]', 'bulk_backfill');
SELECT pg_temp.snap('bulk');
SELECT pg_temp.ok('tag push reports received, matched and matched_ids as before',
  (SELECT result FROM pg_temp.tag_calls WHERE k = 'first') = '{"received": 3, "matched": 1, "matched_ids": ["L70"]}'::jsonb
  AND (SELECT result FROM pg_temp.tag_calls WHERE k = 'same') = '{"received": 3, "matched": 1, "matched_ids": ["L70"]}'::jsonb
  AND (SELECT result FROM pg_temp.tag_calls WHERE k = 'bulk') = '{"received": 1, "matched": 1, "matched_ids": ["L70"]}'::jsonb);
SELECT pg_temp.ok('first push writes labels and the vision payload',
  (SELECT apple_ml_labels FROM public.vehicle_images WHERE id = (SELECT id FROM pg_temp.tag_row)) = ARRAY['truck','wheel']
  AND (SELECT synced_at FROM pg_temp.tag_calls WHERE k = 'first') IS NOT NULL);
SELECT pg_temp.ok('an identical push leaves the row, its synced_at and updated_at untouched',
  (SELECT xmin_after FROM pg_temp.tag_calls WHERE k = 'same') = (SELECT xmin_after FROM pg_temp.tag_calls WHERE k = 'first')
  AND (SELECT synced_at FROM pg_temp.tag_calls WHERE k = 'same') = (SELECT synced_at FROM pg_temp.tag_calls WHERE k = 'first')
  AND (SELECT updated_at FROM pg_temp.tag_calls WHERE k = 'same') = (SELECT updated_at FROM pg_temp.tag_calls WHERE k = 'first'));
SELECT pg_temp.ok('a changed verdict rewrites the payload and synced_at',
  (SELECT xmin_after FROM pg_temp.tag_calls WHERE k = 'changed') <> (SELECT xmin_after FROM pg_temp.tag_calls WHERE k = 'same')
  AND (SELECT (ai_scan_metadata->'on_device_vision'->>'is_personal')::boolean FROM public.vehicle_images
       WHERE id = (SELECT id FROM pg_temp.tag_row)));
SELECT pg_temp.ok('a bulk push over a live payload with labels set changes nothing',
  (SELECT xmin_after FROM pg_temp.tag_calls WHERE k = 'bulk') = (SELECT xmin_after FROM pg_temp.tag_calls WHERE k = 'changed'));
SELECT pg_temp.ok('the other user''s row with the same local id is not touched',
  (SELECT ai_scan_metadata FROM public.vehicle_images WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     AND exif_data->>'uuid' = 'L70' AND source = 'iphoto') = '{}'::jsonb);
SELECT pg_temp.check_all('after tag pushes');

-- Re-applying the migrations is a no-op for the counts (the band re-run replaces, never adds).
\ir ../migrations/20261016201000_user_image_counts.sql
SET statement_timeout = '60s';
SELECT pg_temp.check_all('after re-applying the counts migration');
SELECT pg_temp.ok('re-apply keeps three triggers and one job',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.vehicle_images'::regclass AND tgname LIKE 'trg_user_image_counts_%') = 3
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'compact-user-image-counts') = 1);
