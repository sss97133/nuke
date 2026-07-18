-- ════════════════════════════════════════════════════════════════════════════
-- backfill_byok_image_observations — Phase 4 (W2) of the image-ecosystem mandate.
-- The deep writer historically wrote ai_scan_metadata + a vehicle_observation per image
-- but NOT the image_observations engine row, so visual search was dark (placed_t2 ~5%).
-- The writer is now fixed forward; this backfills the ~8.6K already-deep-analyzed images
-- from their stored vehicle_observations(analysis_kind='image_deep_byok') verdicts.
--
-- Per-vehicle + idempotent (skips images that already have a caller-byok engine row, and
-- ingest_image_observation itself dedups). Per-vehicle so each call stays under the 120s
-- statement-timeout rule (.claude/rules/db-safety.md). Run one vehicle at a time.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function backfill_byok_image_observations(p_vehicle_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; n int := 0; v_role text; v_bbox jsonb; v_vsig jsonb; v_obs_id uuid;
begin
  for r in
    select distinct on (structured_data->>'image_id')
      (structured_data->>'image_id')::uuid img,
      structured_data sd,
      confidence_score conf
    from vehicle_observations
    where vehicle_id = p_vehicle_id
      and structured_data->>'analysis_kind' = 'image_deep_byok'
      and coalesce(is_superseded, false) = false
      and structured_data->>'image_id' is not null
    order by structured_data->>'image_id', observed_at desc
  loop
    -- already has an active engine row for this writer? skip (avoid churn; idempotent).
    if exists (select 1 from image_observations
               where image_id = r.img and observed_by = 'caller-byok' and is_active) then
      continue;
    end if;

    v_role := case
      when r.sd->>'scene_type' = 'data_plate' then 'vin'
      when r.sd->>'intent' = 'parts_sourcing' or r.sd->>'scene_type' = 'product_screenshot' then 'part'
      else 'subject' end;

    v_obs_id := ingest_image_observation(
      r.img, p_vehicle_id, v_role, coalesce(r.conf, 0.7),
      'caller-byok', 'byok_v3_opus48',
      jsonb_build_object('source','deep_byok_backfill','scene_type', r.sd->>'scene_type','intent', r.sd->>'intent'),
      null,
      jsonb_build_object('writer','deep-image-analysis-byok','backfill', true)
    );

    -- primary subject bbox = highest-confidence localized component, if any
    select (c->'bbox') into v_bbox
    from jsonb_array_elements(coalesce(r.sd->'components_seen', '[]'::jsonb)) c
    where jsonb_typeof(c->'bbox') = 'array'
    order by coalesce((c->>'confidence')::numeric, 0) desc
    limit 1;

    v_vsig := jsonb_strip_nulls(jsonb_build_object(
      'paint_state', r.sd->'state_observations'->>'paint_state',
      'rust',        r.sd->'state_observations'->>'rust_severity',
      'build_phase', r.sd->>'build_phase_guess',
      'camera_azimuth_deg', r.sd->'camera_pose'->>'azimuth_deg',
      'scene_type',  r.sd->>'scene_type'));

    update image_observations
      set bbox = coalesce(v_bbox, bbox),
          visual_signature = v_vsig
      where id = v_obs_id;

    n := n + 1;
  end loop;
  return n;
end; $$;

grant execute on function backfill_byok_image_observations(uuid) to service_role;
