-- cascade_technician_evidence(vehicle_id) — connect the analyzed photo corpus to the
-- ALREADY-BUILT worth-proof engine (technician_worth_proof / vehicle_full_picture).
-- The cascade that feeds technician_work_evidence ran ONCE (session 9fcdd38f backfill,
-- 22 rows) and stopped, so technician_worth_proof was computing a master's underclaim off
-- 11 hours. This feeds it from the real corpus: one evidence row per LABOR work-day, with
-- the burst-clustered intent-gated minutes (the defensible labor I corrected), attributed
-- to Skylar — or to Ernie on days the labor is dominantly at his upholstery shop (GPS
-- place_hint). UNCONFIRMED (source_method tags it; the human still signs value per the $410
-- rule). Idempotent (one row per vehicle+day+source). Per-vehicle so it stays under timeout.
create or replace function cascade_technician_evidence(p_vehicle_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_skylar uuid := 'd44915d3-f908-424d-8afa-a6a4a1067257';  -- canonical: user-linked Skylar ($160), not the $85 dup
  v_ernie  uuid := '58029815-e901-4f6e-832d-048d0e0fa5c2';
  n int;
begin
  with labor as (
    select vi.id img, vi.taken_at::date d, vi.taken_at ts,
           (vi.ai_scan_metadata->'byok_deep_analysis'->'presence'->>'place_hint') place
    from vehicle_images vi
    where vi.vehicle_id = p_vehicle_id and vi.is_external = false and vi.vision_gate_status = 'approved'
      and vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' = 'labor'
      and (vi.ai_scan_metadata->'byok_deep_analysis'->>'intent_confidence')::numeric >= 0.6
      and vi.taken_at is not null
  ),
  day_agg as (
    select d, (array_agg(img order by ts))[1] rep_img,
           avg((place = 'ernies_upholstery')::int) ernie_frac
    from labor group by d
  ),
  ins as (
    insert into technician_work_evidence
      (technician_id, derived_from_image_id, vehicle_id, observed_at, duration_minutes,
       operation, source_method, source_model, confidence)
    select
      case when da.ernie_frac > 0.5 then v_ernie else v_skylar end,
      da.rep_img, p_vehicle_id, ws.session_date, ws.duration_minutes,
      ws.work_type, 'worth_proof_cascade_2026-06-17', 'claude-opus-4-8-byok', 0.7
    from work_sessions ws
    join day_agg da on da.d = ws.session_date
    where ws.vehicle_id = p_vehicle_id
      and ws.owner_confirmed_at is null and ws.owner_confirmed_by is null
      and coalesce(ws.duration_minutes, 0) > 0
      and not exists (select 1 from technician_work_evidence twe
        where twe.vehicle_id = p_vehicle_id and twe.observed_at::date = ws.session_date
          and twe.source_method = 'worth_proof_cascade_2026-06-17')
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;
grant execute on function cascade_technician_evidence(uuid) to service_role;
