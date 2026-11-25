-- get_image_deep_analysis + intake_live_state: a SECURITY DEFINER reader returns a row about a photo only where the
-- photo is shown publicly, to the photo's uploader, or to a caller tied to the photo's vehicle; and names a vehicle only
-- where the vehicle is public and undeleted, or the caller is tied to it.
--
-- DEFECT (measured 2026-11-25 on production, read-only, with anon request claims; counts only):
--   Both functions are SECURITY DEFINER, owned by postgres (BYPASSRLS), and EXECUTE is granted to anon. Neither body
--   tested the caller, so the photo policies of vehicle_images never applied.
--   * get_image_deep_analysis(p_image_id): of the 3,904 user_upload photos holding ai_scan_metadata.byok_deep_analysis,
--     745 fail the shown test below (26 unfiled); anon read the analysis of every one by id.
--   * intake_live_state(): its feed (newest 30, as /intake/live asks) carried 16 photos that fail the shown test; its
--     fleet (49 vehicles) named 2 vehicles that are not public or are deleted. sessions_today read work_sessions, which
--     anon cannot read directly (every SELECT policy needs auth.uid()); 461 of 1,925 sessions sit on non-public vehicles
--     (0 sessions today).
--
-- THE TEST (the one #3868 put on image_descriptions, plus is_sensitive). Keys: vehicle_images.id ->
-- vehicle_images_public.id (same row), vehicle_images.vehicle_id -> vehicles.id.
--   (a) shown: the photo's vehicle_images_public row passes public.vehicle_image_gallery_eligible, is_sensitive is false,
--       and its vehicle is_public = true AND deleted_at IS NULL. is_sensitive is tested here because these bodies run as
--       postgres, so the vehicle_images SELECT policy that withholds sensitive photos from a public car does not apply
--       (the gallery function tests is_sensitive only on the pending branch). 5 analyzed photos on production are
--       approved, sensitive and on a public car. The view overload is the anon-safe one (#2293).
--   (b) uploader: auth.uid() IS NOT NULL AND vehicle_images.user_id = auth.uid() (an unfiled photo reaches only this).
--   (c) tied: public.vehicle_viewer_tied(vehicle_images.vehicle_id). It is false for anon and for a NULL vehicle, and
--       true for service_role, which keeps every row.
--   A vehicle is named (fleet entry, vehicle_name, session) only when it is_public AND deleted_at IS NULL, or
--   vehicle_viewer_tied. A session is also listed to its own author (work_sessions.user_id = auth.uid()).
--
-- WHAT CHANGES. Only the WHERE of each read and the vehicle join; the selected columns, their order, the
-- arguments, return types, language, volatility (get_image_deep_analysis VOLATILE, intake_live_state STABLE), SECURITY
-- DEFINER, search_path ('' and public) and grants are unchanged (CREATE OR REPLACE keeps grants). The feed test is
-- inside the subquery, before LIMIT, so a caller still gets the newest p_feed_limit frames it may see.
-- analyzed_last_30m stays a fleet-wide count (a number, no row about a photo). fleet totals still count every
-- approved upload of a listed vehicle.
--
-- GUARD. One DO block: it refuses unless each live body is the one read 2026-11-25 (sha256 of prosrc) or already
-- carries this version's marker, so a concurrent rewrite is never overwritten, and a refused body changes nothing.
-- REVERT. supabase/sql/revert_20261125160500_definer_readers_visibility.sql restores both live bodies.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.proname, encode(sha256(convert_to(p.prosrc, 'UTF8')), 'base64') AS h, p.prosrc
             FROM pg_proc p
            WHERE p.oid IN (to_regprocedure('public.get_image_deep_analysis(uuid)'),
                            to_regprocedure('public.intake_live_state(integer,integer)'))
  LOOP
    CONTINUE WHEN position('definer_readers_visibility_v1' IN r.prosrc) > 0;
    IF NOT ((r.proname = 'get_image_deep_analysis' AND r.h = '3LWE/TnS8lwWQRuopztBD9HARireMredZGpW1BDMsd0=')
         OR (r.proname = 'intake_live_state' AND r.h = 'Sqe+TWsshVt5lgwtN0YjIebdzO6frcvmI5bjZwnBh5M=')) THEN
      RAISE EXCEPTION '% differs from the body read 2026-11-25 (%); not changing it', r.proname, r.h;
    END IF;
  END LOOP;

  EXECUTE $ddl1$CREATE OR REPLACE FUNCTION public.get_image_deep_analysis(p_image_id uuid)
 RETURNS TABLE(image_id uuid, narrative text, intent text, intent_confidence numeric, scene_type text, build_phase text, place_hint text, confidence numeric, agent_model text, agent_notes text, analyzed_at timestamp with time zone, paint_state text, rust_severity text, completeness text, damage_callouts jsonb, components jsonb, open_questions jsonb, needs_review boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 -- definer_readers_visibility_v1: shown, uploader or tied (20261125160500)
 SELECT vi.id,b->>'narrative_one_line',b->>'intent',nullif(b->>'intent_confidence','')::numeric,
  b->>'scene_type',b->>'build_phase_guess',b->'presence'->>'place_hint',nullif(b->>'confidence','')::numeric,
  b->>'agent_model',b->>'agent_notes',nullif(b->>'analyzed_at','')::timestamptz,
  b->'state_observations'->>'paint_state',b->'state_observations'->>'rust_severity',
  b->'state_observations'->>'completeness',b->'state_observations'->'damage_callouts',
  b->'components_seen',b->'open_questions',nullif(b->>'needs_review','')::boolean
 FROM public.vehicle_images vi
 CROSS JOIN LATERAL(SELECT vi.ai_scan_metadata->'byok_deep_analysis' AS b) j
 WHERE vi.id=p_image_id AND vi.ai_scan_metadata ? 'byok_deep_analysis'
   AND (coalesce(b->>'prompt_version','')<>'reviewed_image_analysis_v1' OR EXISTS(
     SELECT 1 FROM public.image_observations io WHERE io.image_id=vi.id AND io.is_active
       AND io.observed_by='caller-byok' AND io.agent_version='reviewed_image_analysis_v1'
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=b->>'observation_id'
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,image_url}'=vi.image_url
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,vehicle_id}'=vi.vehicle_id::text))
   AND (
     coalesce((
       SELECT true
       FROM public.vehicle_images_public vip
       JOIN public.vehicles v ON v.id = vip.vehicle_id
       WHERE vip.id = vi.id
         AND coalesce(vip.is_sensitive, false) = false
         AND v.is_public = true
         AND v.deleted_at IS NULL
         AND public.vehicle_image_gallery_eligible(vip)), false)
     OR ((SELECT auth.uid()) IS NOT NULL AND vi.user_id = (SELECT auth.uid()))
     OR public.vehicle_viewer_tied(vi.vehicle_id));
$function$$ddl1$;

  EXECUTE $ddl2$CREATE OR REPLACE FUNCTION public.intake_live_state(p_feed_limit integer DEFAULT 24, p_sessions_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- definer_readers_visibility_v1: photos shown, uploader's or tied; vehicles public and undeleted or tied (20261125160500)
select jsonb_build_object(
  'server_time', now(),

  -- per-vehicle burn progress (approved-analyzed / approved-total)
  'fleet', coalesce((
    select jsonb_agg(jsonb_build_object(
        'vehicle_id', f.vehicle_id,
        'vehicle_name', nullif(trim(concat_ws(' ', v.year::text, v.make, v.model)), ''),
        'total', f.total,
        'analyzed', f.analyzed,
        'last_analyzed_at', f.last_analyzed_at
      ) order by f.total desc)
    from (
      select vi.vehicle_id,
             count(*)::int as total,
             (count(*) filter (where vi.ai_scan_metadata ? 'byok_deep_analysis'))::int as analyzed,
             max(vi.last_rerun_at) as last_analyzed_at
      from vehicle_images vi
      where vi.source = 'user_upload'
        and vi.vision_gate_status = 'approved'
        and vi.vehicle_id is not null
      group by vi.vehicle_id
    ) f
    join vehicles v on v.id = f.vehicle_id
    where (v.is_public = true and v.deleted_at is null) or public.vehicle_viewer_tied(v.id)
  ), '[]'::jsonb),

  -- frames analyzed in the last 30 minutes (ETA rate basis)
  'analyzed_last_30m', (
    select count(*)::int
    from vehicle_images vi
    where vi.source = 'user_upload'
      and vi.vision_gate_status = 'approved'
      and vi.last_rerun_at >= now() - interval '30 minutes'
  ),

  -- most recently analyzed frames, newest first
  'feed', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'vehicle_id', t.vehicle_id,
        'vehicle_name', nullif(trim(concat_ws(' ', v.year::text, v.make, v.model)), ''),
        'image_url', t.image_url,
        'taken_at', t.taken_at,
        'analyzed_at', t.last_rerun_at,
        'line', t.bda ->> 'narrative_one_line',
        'scene_type', t.bda ->> 'scene_type',
        'build_phase', t.bda ->> 'build_phase_guess',
        'intent', t.bda ->> 'intent',
        'confidence', t.bda ->> 'confidence'
      ) order by t.last_rerun_at desc, t.id)
    from (
      select k.id, k.vehicle_id, fi.image_url, fi.taken_at, k.last_rerun_at,
             fi.ai_scan_metadata -> 'byok_deep_analysis' as bda
      from (
      -- newest first, then the caller test row by row until p_feed_limit pass: OFFSET 0 keeps the test above the
      -- sort, so it runs on the newest frames only, not on every analysed frame; the outer ORDER BY repeats the
      -- inner keys, so the planner adds no second sort and the order is stated, not assumed. The analysis jsonb is
      -- read after the limit (fi), for the frames returned only.
      select c.id, c.vehicle_id, c.last_rerun_at
      from (
        select vi.id, vi.vehicle_id, vi.user_id, vi.last_rerun_at
        from vehicle_images vi
        where vi.source = 'user_upload'
          and vi.vision_gate_status = 'approved'
          and vi.last_rerun_at is not null
        order by vi.last_rerun_at desc, vi.id
        offset 0
      ) c
      -- a scalar subquery (one row at most: vip.id is the photo's key), not EXISTS, so the planner cannot hash it into
      -- a test of every photo in the table (PG17 chose that on a 10k-row fixture: 12 ms -> 115 ms)
      where coalesce((
              select true
              from vehicle_images_public vip
              join vehicles pv on pv.id = vip.vehicle_id
              where vip.id = c.id
                and coalesce(vip.is_sensitive, false) = false
                and pv.is_public = true
                and pv.deleted_at is null
                and public.vehicle_image_gallery_eligible(vip)), false)
         or ((select auth.uid()) is not null and c.user_id = (select auth.uid()))
         or public.vehicle_viewer_tied(c.vehicle_id)
      order by c.last_rerun_at desc, c.id
      limit p_feed_limit
      ) k
      join vehicle_images fi on fi.id = k.id
    ) t
    left join vehicles v on v.id = t.vehicle_id
      and ((v.is_public = true and v.deleted_at is null) or public.vehicle_viewer_tied(v.id))
  ), '[]'::jsonb),

  -- work_session rollups created today (America/Los_Angeles day)
  'sessions_today', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'vehicle_id', s.vehicle_id,
        'vehicle_name', nullif(trim(concat_ws(' ', v.year::text, v.make, v.model)), ''),
        'session_date', s.session_date,
        'title', s.title,
        'image_count', s.image_count,
        'summary', left(coalesce(s.work_description, ''), 220),
        'created_at', s.created_at
      ) order by s.created_at desc)
    from (
      select ws.id, ws.vehicle_id, ws.session_date, ws.title, ws.image_count,
             ws.work_description, ws.created_at
      from work_sessions ws
      where (ws.created_at at time zone 'America/Los_Angeles')::date
          = (now() at time zone 'America/Los_Angeles')::date
        and (
          exists (
            select 1 from vehicles sv
            where sv.id = ws.vehicle_id and sv.is_public = true and sv.deleted_at is null)
          or ((select auth.uid()) is not null and ws.user_id = (select auth.uid()))
          or public.vehicle_viewer_tied(ws.vehicle_id))
      order by ws.created_at desc
      limit p_sessions_limit
    ) s
    left join vehicles v on v.id = s.vehicle_id
      and ((v.is_public = true and v.deleted_at is null) or public.vehicle_viewer_tied(v.id))
  ), '[]'::jsonb)
);
$function$$ddl2$;
END
$guard$;
