-- Revert of 20261125183500_intake_live_state_session_text.sql: restores the intake_live_state body that
-- 20261125160500 deployed (prosrc sha256 oVg08xAq...). CREATE OR REPLACE keeps grants. Restoring it gives anon a public
-- car's session title and summary again and unbounded limits.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.intake_live_state(p_feed_limit integer DEFAULT 24, p_sessions_limit integer DEFAULT 30)
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
$function$;
