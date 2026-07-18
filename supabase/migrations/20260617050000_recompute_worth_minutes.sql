-- recompute_worth_minutes(vehicle_id) — the SQL twin of build-day.mjs's labor-minute logic,
-- for fleet-wide backfill of the worth-proof WITHOUT re-running the Opus day-synthesis.
-- Replaces span-inflated stored labor with TRUE temporal burst clustering (gap>45min breaks
-- a burst; lone frame=15min; burst=span+10min; clamped [15,480]). Only intent=labor frames
-- at conf>=0.6 (the $410 gate), only on analyzed+approved days, only non-owner-confirmed
-- sessions (signed value is preserved). Per-vehicle (vehicle_id-indexed) so it stays under
-- the statement timeout — the corpus-wide CTE times out; this does not.
--
-- One-time sweep (2026-06-17): fleet non-confirmed labor 35,194min/$33,887 -> 16,262min/$7,067
-- across 475 sessions — ~$27K of phantom span-inflated labor removed. Going forward the byok
-- cron's build-day keeps new days accurate; re-run this only after a bulk re-analysis.
create or replace function recompute_worth_minutes(p_vehicle_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with lf as (
    select vi.taken_at::date d, vi.taken_at ts,
      extract(epoch from (vi.taken_at - lag(vi.taken_at) over (partition by vi.taken_at::date order by vi.taken_at)))/60 gap
    from vehicle_images vi
    where vi.vehicle_id = p_vehicle_id and vi.is_external = false and vi.vision_gate_status = 'approved'
      and vi.source is distinct from 'imessage' and vi.taken_at is not null
      and vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' = 'labor'
      and (vi.ai_scan_metadata->'byok_deep_analysis'->>'intent_confidence')::numeric >= 0.6 ),
  b as (select d, ts, sum((gap is null or gap > 45)::int) over (partition by d order by ts) burst from lf),
  -- v3 per Worth Engine calibration spec (2026-05-23): GREATEST(span, n_photos × 5min) + 10min trailing
  bd as (select d, burst,
           greatest(round(extract(epoch from (max(ts) - min(ts)))/60), count(*) * 5) + 10 mins
         from b group by d, burst),
  dm as (select d, least(480, sum(mins))::int labor_minutes from bd group by d),
  ad as (select distinct taken_at::date d from vehicle_images
         where vehicle_id = p_vehicle_id and is_external = false and vision_gate_status = 'approved'
           and ai_scan_metadata ? 'byok_deep_analysis' and taken_at is not null),
  upd as (
    update work_sessions ws set
      duration_minutes = coalesce(dm.labor_minutes, 0),
      total_labor_cost = round(coalesce(dm.labor_minutes, 0)/60.0 * 85, 2),
      total_job_cost   = round(coalesce(dm.labor_minutes, 0)/60.0 * 85 + coalesce(ws.total_parts_cost, 0), 2),
      metadata = jsonb_set(coalesce(ws.metadata, '{}'::jsonb), '{labor_minutes_recomputed_at}', to_jsonb(now()::text))
    from ad left join dm on dm.d = ad.d
    where ws.vehicle_id = p_vehicle_id and ws.session_date = ad.d
      and ws.owner_confirmed_at is null and ws.owner_confirmed_by is null
    returning 1)
  select count(*) into n from upd; return n;
end $$;
grant execute on function recompute_worth_minutes(uuid) to service_role;
