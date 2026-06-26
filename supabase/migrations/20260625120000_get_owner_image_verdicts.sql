-- get_owner_image_verdicts — the iOS local-first interweave read path.
--
-- The rich prod BYOK deep-analysis verdict, PROJECTED (no jsonb-blob egress) and joined
-- to a device photo by the EXACT uuid bridge: vehicle_images.exif_data->>'uuid' equals
-- the PHAsset.localIdentifier the capture relay stamped at upload. The iOS app caches the
-- result in its on-device LocalStore (GRDB) so the "back of the photo" renders the
-- analysis OFFLINE — the cloud verdict ESCALATING DOWN the data-scope axis
-- (global cloud → local instance). Read-only; SECURITY DEFINER scoped to the caller's own
-- rows (auth.uid()). DISTINCT ON keeps the newest verdict if a uuid maps to >1 row.
--
-- Applied to prod 2026-06-25 (was drift before this file; committing per the
-- production-engineering "repo is not prod" rule).

drop function if exists get_owner_image_verdicts(text[]);

create function get_owner_image_verdicts(p_uuids text[])
returns table(
  local_uuid  text,
  vehicle_id  uuid,
  narrative   text,
  intent      text,
  scene_type  text,
  confidence  double precision,
  build_phase text,
  agent_model text,
  analyzed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (vi.exif_data->>'uuid')
    vi.exif_data->>'uuid'                                              as local_uuid,
    vi.vehicle_id,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line'   as narrative,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'intent'              as intent,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type'         as scene_type,
    nullif(vi.ai_scan_metadata->'byok_deep_analysis'->>'confidence','')::double precision as confidence,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess'  as build_phase,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'agent_model'        as agent_model,
    nullif(vi.ai_scan_metadata->'byok_deep_analysis'->>'analyzed_at','')::timestamptz as analyzed_at
  from vehicle_images vi
  where vi.user_id = auth.uid()
    and vi.exif_data->>'uuid' = any(p_uuids)
    and vi.ai_scan_metadata ? 'byok_deep_analysis'
  order by vi.exif_data->>'uuid',
           nullif(vi.ai_scan_metadata->'byok_deep_analysis'->>'analyzed_at','')::timestamptz desc nulls last;
$$;

revoke all on function get_owner_image_verdicts(text[]) from public;
grant execute on function get_owner_image_verdicts(text[]) to authenticated;
