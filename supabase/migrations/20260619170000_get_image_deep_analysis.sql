-- get_image_deep_analysis — read path for the FULL byok deep-analysis verdict.
-- The richest layer of per-image data (narrative, the model's reasoning, state
-- observations, components-with-confidence, open questions) lives in
-- vehicle_images.ai_scan_metadata->'byok_deep_analysis' but had NO RPC surfacing
-- it. The app's evidence rail only had thin scene/phase/intent label facets.
-- This exposes the depth so the photo drill can render the actual verdict.
-- Additive + read-only: nothing called it before, so it can't break live reads.
create or replace function public.get_image_deep_analysis(p_image_id uuid)
returns table(
  image_id uuid,
  narrative text,
  intent text,
  intent_confidence numeric,
  scene_type text,
  build_phase text,
  place_hint text,
  confidence numeric,
  agent_model text,
  agent_notes text,
  analyzed_at timestamptz,
  paint_state text,
  rust_severity text,
  completeness text,
  damage_callouts jsonb,
  components jsonb,
  open_questions jsonb,
  needs_review boolean
)
language sql
security definer
set search_path to ''
as $$
  select
    vi.id,
    b->>'narrative_one_line',
    b->>'intent',
    nullif(b->>'intent_confidence','')::numeric,
    b->>'scene_type',
    b->>'build_phase_guess',
    b->'presence'->>'place_hint',
    nullif(b->>'confidence','')::numeric,
    b->>'agent_model',
    b->>'agent_notes',
    nullif(b->>'analyzed_at','')::timestamptz,
    b->'state_observations'->>'paint_state',
    b->'state_observations'->>'rust_severity',
    b->'state_observations'->>'completeness',
    b->'state_observations'->'damage_callouts',
    b->'components_seen',
    b->'open_questions',
    nullif(b->>'needs_review','')::boolean
  from public.vehicle_images vi
  cross join lateral (select vi.ai_scan_metadata->'byok_deep_analysis' as b) j
  where vi.id = p_image_id
    and vi.ai_scan_metadata ? 'byok_deep_analysis';
$$;

grant execute on function public.get_image_deep_analysis(uuid) to anon, authenticated, service_role;

comment on function public.get_image_deep_analysis(uuid) is
  'Surfaces the full byok_deep_analysis verdict (narrative, agent reasoning, state observations, components+confidence, open questions) for one image. Feeds the iOS photo evidence rail depth. Added 2026-06-19.';
