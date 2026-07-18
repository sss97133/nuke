-- get_analysis_stream v2: carry the verdict's own attribution doubt so no surface headlines
-- a frame as a vehicle its reading disclaims (Skylar 2026-07-02: a marketplace screenshot of
-- a candidate K5 rendered as "1977 CHEVROLET K5 BLAZER" while its verdict said "not obviously
-- the subject K5"). Additive columns: intent, needs_clarification, attribution_doubt (computed
-- server-side: product_screenshot/spreadsheet, or cross_reference+acquisition). Return-type
-- change requires drop+create; params unchanged; existing decoders ignore new keys.
-- NOTE: the prior get_analysis_stream body existed only in prod (repo drift) — this migration
-- is also its first repo record. Applied live 2026-07-02.

drop function if exists public.get_analysis_stream(timestamp with time zone, integer);

create function public.get_analysis_stream(p_since timestamp with time zone default null, p_limit integer default 40)
returns table(
  image_id uuid, vehicle_id uuid, vehicle text, thumbnail_url text, image_url text,
  landed_at timestamp with time zone, scene_type text, build_phase text, narrative text,
  components jsonb, text_regions jsonb, state jsonb, hashed boolean, sessioned boolean,
  is_duplicate boolean, match_status text,
  intent text, needs_clarification boolean, attribution_doubt text
)
language sql stable security definer
set search_path to 'public'
as $function$
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

grant execute on function public.get_analysis_stream(timestamp with time zone, integer) to authenticated;

comment on function public.get_analysis_stream(timestamp with time zone, integer) is
  'Live per-frame verdict stream (auth.uid()-scoped). v2 adds intent/needs_clarification/attribution_doubt — a frame whose reading contradicts its attribution carries the doubt so no UI headlines it as the vehicle. Additive; existing decoders unaffected.';
