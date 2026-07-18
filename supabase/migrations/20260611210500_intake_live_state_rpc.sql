-- intake_live_state — single-round-trip read model for the LIVE INTAKE screen
-- (nuke_frontend /intake/live). Watches the BYOK fleet burn (byok-burn-all.sh)
-- fill the timeline: per-vehicle approved/analyzed progress, the most recently
-- analyzed frames, today's work_session rollups, and a 30-min analysis rate.
--
-- Justification (platform-hygiene): no new table, no new edge function. One
-- STABLE SQL function so the screen polls ONE rpc instead of 40+ PostgREST
-- count queries (aggregates are disabled on this project, PGRST123).
--
-- Scope = exactly the burn queue's WHERE clause:
--   source='user_upload' AND vision_gate_status='approved'
-- "analyzed" = ai_scan_metadata ? 'byok_deep_analysis' (the prepare step's own
-- skip marker; last_rerun_at undercounts pre-column verdicts: 353 vs 508).
-- Exposure via SECURITY DEFINER is the same class of data the public /journal
-- page already projects (owner photos + one-line verdicts).

create or replace function public.intake_live_state(
  p_feed_limit int default 24,
  p_sessions_limit int default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
    left join vehicles v on v.id = f.vehicle_id
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
      select vi.id, vi.vehicle_id, vi.image_url, vi.taken_at, vi.last_rerun_at,
             vi.ai_scan_metadata -> 'byok_deep_analysis' as bda
      from vehicle_images vi
      where vi.source = 'user_upload'
        and vi.vision_gate_status = 'approved'
        and vi.last_rerun_at is not null
      order by vi.last_rerun_at desc, vi.id
      limit p_feed_limit
    ) t
    left join vehicles v on v.id = t.vehicle_id
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
      order by ws.created_at desc
      limit p_sessions_limit
    ) s
    left join vehicles v on v.id = s.vehicle_id
  ), '[]'::jsonb)
);
$$;

comment on function public.intake_live_state(int, int) is
  'Read model for /intake/live — fleet burn progress, freshest analyzed frames, today''s work_session rollups. Polled ~every 15s by the owner intake screen.';

grant execute on function public.intake_live_state(int, int) to anon, authenticated, service_role;
