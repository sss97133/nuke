-- Reading tiers: what an automatic photo reading may say, and what replaces it. Contract: the lead's decision of 2026-11-20 on
-- PR 3610 (the measurement is in the pull request text), built on the keyed-values migration 20261120130000.
--
-- Why: no live consumer of a deep reading filters on who made it (vehicle_build_reconstruction, vehicle_part_installation_evidence,
-- get_vehicle_parts_ledger, get_image_deep_analysis and others take any reviewed_image_analysis_v1 observation or the photo's
-- byok_deep_analysis stamp), and a reading that lands today is final. The automatic reader is two passes of one model over pixels:
-- only closed values both passes agree on can be checked, so only those may enter the ledger from it, the database enforces that at
-- the one intake, and an automatic reading is never the last word on a photo.
--
-- What changes at deploy: nothing for a reviewed producer (its tier is listed, so every check it passes today is unchanged and
-- nothing more is asked of it). A reading whose agent_tier is not listed is thin and is now held to the thin shape. The scope row
-- platform_config 'image_stage_deep_reading' stays enabled = false, so no automatic reading is queued; no consumer is edited.
--
-- What a thin reading is in the database: one vehicle_observations row with its witness, and later the keyed values projected from
-- it. It is not stamped on the photo, it places no image_observations row and it picks no cover. Measured 2026-11-20: 36 live SQL
-- functions (pg_proc, schema public) and 36 code files on main (fc85b8d25; tests and docs excluded) mention
-- ai_scan_metadata.byok_deep_analysis, and for several the stamp's presence alone selects, scores or writes (the cover, the exterior
-- anchors of match_image_to_vehicle_by_clip, the duplicate keeper, a day's work minutes, the attribution worklist); none of them
-- asks who made the reading. A reading that is not stamped cannot be mistaken for a reviewed one by any of them, including the ones
-- nobody has listed. The image_observations row is a vote on whose car the photo shows, fed to the attribution queue by its own
-- trigger; the automatic reader checks no identity, so it casts none.
--
-- 1. platform_config 'image_reading_tiers' (ON CONFLICT DO NOTHING: a replay never overwrites a later edit): reviewed_tiers, and
--    automatic.admits (the closed values the automatic reader may post). No counts are typed into it.
-- 2. image_reading_tier_is_reviewed(text, boolean) and image_reading_thin_violation(jsonb, jsonb): the one definition of the tier
--    test and of the thin shape (service_role only). With the row missing (or no reviewed_tiers array) every NEW reading is thin: a
--    reviewed producer is then refused loudly (thin_review_asserts_unchecked_field), never trusted silently; the insert here is what
--    keeps that from happening. Readings already stored are then treated as reviewed: nothing is displaced or superseded.
--    Also image_reading_tier_is_automatic(text) (a reading already stored is automatic only when its tier is the config row's
--    automatic.tier: every other stored reading is protected) and image_reading_thin_envelope_violation(jsonb, jsonb) (the review
--    envelope of a thin reading is closed too). Open questions of a thin reading name only values of a closed vocabulary, at most 8.
-- 3. guard_reviewed_image_analysis(): the same body plus Rule 1 (a thin reading carries only the thin shape and envelope,
--    thin_review_asserts_unchecked_field) and Rule 2 (a thin reading is refused on a photo that carries a deep-reading stamp, or
--    that holds a current reading that is not positively the automatic tier, thin_review_over_reviewed). Both after every existing
--    check; every existing error word is kept.
-- 4. project_reviewed_image_analysis(uuid): for a reviewed reading the same body plus Rule 3 (a reading that lands supersedes every
--    current automatic-tier reading of the photo and its current keyed children, in the projection's transaction; a reviewed,
--    unlisted or tierless reading is never touched). For a thin reading: Rule 2 again, Rule 3 for the automatic readings older than
--    itself (the ledger's order: ingested_at, then id), and nothing else: no stamp, no image_observations row, no cover. The answer
--    says thin_tier = true and carries no image_observation_id. Calling it again for the same thin reading does nothing more.
-- Revert: supabase/sql/revert_20261120140000_image_reading_tiers.sql (restores both bodies; leaves the config row).
begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

-- The replaced bodies are the ones read from production on 2026-11-20; refuse to replace a body someone changed since.
-- A replay finds this migration's own bodies and passes (the second md5 of each pair).
do $guard$
declare r record;
begin
  for r in select * from (values
      ('public.guard_reviewed_image_analysis()', '4cce782e45863596f359e44bf1c602a6', 'd3b859b91864aedd4c7e2146a188ea60'),
      ('public.project_reviewed_image_analysis(uuid)', 'c5d8f9b483490c82c90b23e7fc0cb042', '9e53ed7082465cc63f5f937fe224a54d')) as t(fn, md5_before, md5_after) loop
    -- a function that is missing is refused too (a null md5 would otherwise pass "not in")
    if coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing') not in (r.md5_before, r.md5_after) then
      raise exception '% is not the body this migration replaces (md5 %); review before applying', r.fn,
        coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing');
    end if;
  end loop;
end $guard$;

-- The config row: tiers found on 2026-11-20 on live reviewed_image_analysis_v1 observations (read through image_observations and
-- primary-key lookups) and on the owner's photo stamps (ai_scan_metadata.byok_deep_analysis.agent_tier), and every tier a producer
-- in the repo writes: 'caller-byok subscription' (scripts/daily-receipt/reviewed-image-batch.ts), 'caller-byok' (the older stamp
-- writers scripts/daily-receipt/process-photo.mjs, process-photo-cascade.mjs, analyze-capture-photos.mjs; 12,103 live stamps),
-- 'interactive subscription session' and 'interactive assistant session' (live observations posted by agent sessions). The automatic
-- reader's own tier, 'subscription automatic', is deliberately not listed.
insert into public.platform_config (config_key, config_value, description) values
  ('image_reading_tiers',
   $cfg${"reviewed_tiers": ["caller-byok", "caller-byok subscription", "interactive assistant session", "interactive subscription session"],
         "automatic": {"tier": "subscription automatic",
                       "admits": {"scene_type": ["undercarriage", "engine_bay", "body_exterior", "body_interior", "wheel_assembly"],
                                  "rust_severity": ["surface"],
                                  "paint_state": []},
                       "basis": "PR 3610: measurement of 2026-11-20 in the pull request text"}}$cfg$::jsonb,
   'Reading tiers of the reviewed-analysis intake. reviewed_tiers: agent_tier values whose readings are checked as before and may not be displaced by an automatic one. Every other tier is thin: it may carry only automatic.admits (closed values) and the fixed shape of image_reading_thin_violation, it is stored as its observation and keyed values only (no stamp on the photo, no search row, no cover), and a later reading replaces it. A later migration that raises the admitted set cites its measurement. Migration 20261120140000.')
on conflict (config_key) do nothing;

-- ===== 1. the tier test and the thin shape: one definition each (the guard, the projection and the contract tests all call these)
-- Is this reading tier a reviewed one? Listed in platform_config 'image_reading_tiers', config_value.reviewed_tiers, or no tier at all
-- (a legacy reading with no agent_tier counts as reviewed; an empty string, not a trimmed one, is "no tier", as the guard's own check
-- reads it). Anything else is thin: an unlisted tier. With the row missing, or no reviewed_tiers array in it, the answer is
-- p_if_no_config: false for a reading being posted (every new reading is then held to the thin shape: a reviewed producer is refused
-- loudly, never trusted silently; the insert below is what keeps that from happening), true for a reading already on a photo (with no
-- tier list nothing already stored is called thin, so nothing is displaced or superseded). Reads the config row once per call.
create or replace function public.image_reading_tier_is_reviewed(p_tier text, p_if_no_config boolean default false)
returns boolean language sql stable set search_path to 'public', 'pg_temp' as $$
  select case when coalesce(p_tier, '') = '' then true
              else coalesce((select case when jsonb_typeof(c.config_value -> 'reviewed_tiers') = 'array'
                                         then (c.config_value -> 'reviewed_tiers') ? p_tier end
                               from public.platform_config c where c.config_key = 'image_reading_tiers'), p_if_no_config) end $$;

-- Is a reading ALREADY STORED an automatic one? Only the tier the config row names as automatic.tier is: a stored reading with any
-- other tier (reviewed, unlisted, or none) is never displaced (Rule 2) and never superseded (Rule 3), so editing or damaging the
-- reviewed_tiers list cannot turn stored testimony into something a thin reading replaces. No row, or no automatic.tier: nothing
-- stored is automatic.
create or replace function public.image_reading_tier_is_automatic(p_tier text)
returns boolean language sql stable set search_path to 'public', 'pg_temp' as $$
  select coalesce(p_tier, '') <> '' and coalesce((select c.config_value -> 'automatic' ->> 'tier' = p_tier
                                                    from public.platform_config c where c.config_key = 'image_reading_tiers'), false) $$;

-- What the review envelope of a thin-tier reading may carry besides structured_data (a thin reading is closed values only, here too):
-- extraction_metadata keys, reviewer_provenance keys, numeric or null durations and costs, the one cost_basis sentence the reader
-- writes, and a witness that is the photo itself. Null when allowed, else the first path that is not. Total: never raises.
create or replace function public.image_reading_thin_envelope_violation(m jsonb, v jsonb)
returns text language plpgsql immutable set search_path to 'pg_catalog' as $$
declare
  k text; p jsonb := m -> 'reviewer_provenance';
  c_basis constant text := 'Owner subscription via the claude CLI; nothing is billed per photo. The CLI''s notional cost and token counts are kept in the stage receipt, not here. agent_duration_ms is the photo''s wall-clock (download, both reads, any retry).';
begin
  if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(p) is distinct from 'object' then return 'envelope'; end if;
  for k in select jsonb_object_keys(m) loop
    if k <> all (array['review_hash','reviewed_image','reviewer_provenance','prior_analysis']) then return 'extraction_metadata.' || left(k, 40); end if;
  end loop;
  for k in select jsonb_object_keys(p) loop
    if k <> all (array['agent_model','agent_tier','extraction_method','run_id','agent_duration_ms','agent_cost_cents','cost_basis']) then
      return 'reviewer_provenance.' || left(k, 40); end if;
  end loop;
  if p -> 'agent_duration_ms' is not null and jsonb_typeof(p -> 'agent_duration_ms') not in ('number','null') then return 'agent_duration_ms'; end if;
  if p -> 'agent_cost_cents' is not null and jsonb_typeof(p -> 'agent_cost_cents') not in ('number','null') then return 'agent_cost_cents'; end if;
  if p -> 'cost_basis' is not null and p -> 'cost_basis' <> 'null'::jsonb and p -> 'cost_basis' is distinct from to_jsonb(c_basis) then return 'cost_basis'; end if;
  if v -> 'witness_image_id' is not null and v -> 'witness_image_id' is distinct from v -> 'image_id' then return 'witness_image_id'; end if;
  return null;
end $$;

-- What a thin-tier reading may not carry: null when the shape is allowed, else the first path that is not (a short word). v is the
-- reading as the intake stores it (structured_data); p_admits is image_reading_tiers.automatic.admits (field name -> array of admitted
-- values; a missing field, a non-array or a missing object admits nothing beyond 'unknown'). Total: no cast, so it never raises.
create or replace function public.image_reading_thin_violation(v jsonb, p_admits jsonb)
returns text language plpgsql immutable set search_path to 'pg_catalog' as $$
declare
  scene text; rust text; paint text; q jsonb; k text;
  c_method constant text := 'automatic two-pass read; no pose measured';
  c_notes constant text := 'Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier.';
  -- the closed vocabulary a question may name: every value the verdict contract allows for scene_type, rust_severity, paint_state and
  -- completeness (supabase/functions/_shared/byokImageVerdict.mjs; the reader derives its own list from the same grammar and its test
  -- pins it to this one). off_property is one of them: this intake's own projection below places such a scene as 'subject'.
  c_vocab constant text[] := array['unknown','engine_bay','body_exterior','body_interior','undercarriage','receipt_document','data_plate','hand_drawn_diagram',
    'shop_context','fabrication_in_progress','paint_booth','wheel_assembly','road_test','off_property','cross_reference','product_screenshot','spreadsheet',
    'none','surface','pitting','perforation','bare_metal','primer','sealer','base','clear','aged','stripped','partial','assembled'];
  m text[];
  c_q1 constant text := '^Two independent reads of this photo disagree on (scene_type|rust_severity|paint_state|completeness): [a-z_]+ vs [a-z_]+; posted as unknown\.$';
  c_q2 constant text := '^Both reads say (scene_type|rust_severity|paint_state|completeness) is [a-z_]+; this reader may not post that value yet\.$';
begin
  if jsonb_typeof(v) is distinct from 'object' then return 'shape'; end if;
  -- no key outside the closed list (the intake's own keys, confidence and needs_review included)
  for k in select jsonb_object_keys(v) loop
    if k <> all (array['scene_type','state_observations','build_phase_guess','intent','intent_confidence','needs_clarification','context_complete',
                       'components_seen','text_regions','damage_localized','workshop_signals','presence','camera_pose','narrative_one_line',
                       'open_questions','agent_notes','confidence','needs_review',
                       'image_id','vehicle_id','analysis_kind','witness_image_id','is_inferred']) then return 'key:' || left(k, 40); end if;
  end loop;
  for k in select jsonb_object_keys(case when jsonb_typeof(v -> 'state_observations') = 'object' then v -> 'state_observations' else '{}'::jsonb end) loop
    if k <> all (array['rust_severity','paint_state','completeness','damage_callouts']) then return 'state_observations.' || left(k, 40); end if;
  end loop;
  for k in select jsonb_object_keys(case when jsonb_typeof(v -> 'workshop_signals') = 'object' then v -> 'workshop_signals' else '{}'::jsonb end) loop
    if k <> all (array['tools_visible','fixturing','weld_quality','lighting']) then return 'workshop_signals.' || left(k, 40); end if;
  end loop;
  for k in select jsonb_object_keys(case when jsonb_typeof(v -> 'presence') = 'object' then v -> 'presence' else '{}'::jsonb end) loop
    if k <> all (array['person','dog','place_hint']) then return 'presence.' || left(k, 40); end if;
  end loop;
  for k in select jsonb_object_keys(case when jsonb_typeof(v -> 'camera_pose') = 'object' then v -> 'camera_pose' else '{}'::jsonb end) loop
    if k <> all (array['method','framing','azimuth_deg','elevation_deg','distance_est','exif_present']) then return 'camera_pose.' || left(k, 40); end if;
  end loop;
  -- closed values: 'unknown', or a value the database admits for the automatic reader
  if jsonb_typeof(v -> 'scene_type') is distinct from 'string' then return 'scene_type'; end if;
  scene := v ->> 'scene_type';
  if scene <> 'unknown' and not coalesce(jsonb_typeof(p_admits -> 'scene_type') = 'array' and (p_admits -> 'scene_type') ? scene, false) then return 'scene_type'; end if;
  if jsonb_typeof(v #> '{state_observations,rust_severity}') is distinct from 'string' then return 'rust_severity'; end if;
  rust := v #>> '{state_observations,rust_severity}';
  if rust <> 'unknown' and not coalesce(jsonb_typeof(p_admits -> 'rust_severity') = 'array' and (p_admits -> 'rust_severity') ? rust, false) then return 'rust_severity'; end if;
  if jsonb_typeof(v #> '{state_observations,paint_state}') is distinct from 'string' then return 'paint_state'; end if;
  paint := v #>> '{state_observations,paint_state}';
  if paint <> 'unknown' and not coalesce(jsonb_typeof(p_admits -> 'paint_state') = 'array' and (p_admits -> 'paint_state') ? paint, false) then return 'paint_state'; end if;
  -- a reading that cannot name its scene asserts no state
  if scene = 'unknown' and (rust <> 'unknown' or paint <> 'unknown') then return 'state_without_scene'; end if;
  if v #> '{state_observations,completeness}' is distinct from '"unknown"'::jsonb then return 'completeness'; end if;
  q := v #> '{state_observations,damage_callouts}';
  if q is not null and q <> '[]'::jsonb then return 'damage_callouts'; end if;
  -- what this reader does not read
  if v -> 'build_phase_guess' is distinct from '"unknown"'::jsonb then return 'build_phase_guess'; end if;
  if v -> 'intent' is distinct from '"unknown"'::jsonb then return 'intent'; end if;
  if v -> 'intent_confidence' is distinct from '0'::jsonb then return 'intent_confidence'; end if;
  if v -> 'needs_clarification' is distinct from 'true'::jsonb then return 'needs_clarification'; end if;
  if v -> 'context_complete' is not null and v -> 'context_complete' <> 'false'::jsonb then return 'context_complete'; end if;
  if v -> 'components_seen' is distinct from '[]'::jsonb then return 'components_seen'; end if;
  if v -> 'text_regions' is not null and v -> 'text_regions' <> '[]'::jsonb then return 'text_regions'; end if;
  if v -> 'damage_localized' is not null and v -> 'damage_localized' <> '[]'::jsonb then return 'damage_localized'; end if;
  if v #> '{workshop_signals,tools_visible}' is distinct from '[]'::jsonb then return 'tools_visible'; end if;
  if v #> '{workshop_signals,fixturing}' is distinct from '"unknown"'::jsonb then return 'fixturing'; end if;
  if v #> '{workshop_signals,lighting}' is distinct from '"unknown"'::jsonb then return 'lighting'; end if;
  if v #> '{workshop_signals,weld_quality}' is not null then return 'weld_quality'; end if;
  if jsonb_typeof(v #> '{presence,person}') is distinct from 'boolean' then return 'person'; end if;
  if v #> '{presence,dog}' is not null and v #> '{presence,dog}' <> 'false'::jsonb then return 'dog'; end if;
  if v #> '{presence,place_hint}' is not null and v #> '{presence,place_hint}' <> 'null'::jsonb then return 'place_hint'; end if;
  if v #> '{camera_pose,method}' is distinct from to_jsonb(c_method) then return 'camera_method'; end if;
  if v #> '{camera_pose,framing}' is distinct from '"unknown"'::jsonb then return 'camera_framing'; end if;
  for k in select unnest(array['azimuth_deg','elevation_deg','distance_est','exif_present']) loop
    if v #> array['camera_pose', k] is not null and v #> array['camera_pose', k] <> 'null'::jsonb then return 'camera_' || k; end if;
  end loop;
  if v -> 'narrative_one_line' is distinct from to_jsonb('Automatic read: scene ' || scene || '; rust ' || rust || '; paint ' || paint || '.') then return 'narrative'; end if;
  if v -> 'open_questions' is not null then
    if jsonb_typeof(v -> 'open_questions') is distinct from 'array' then return 'open_questions'; end if;
    if jsonb_array_length(v -> 'open_questions') > 8 then return 'open_questions'; end if;
    if exists (select 1 from jsonb_array_elements(v -> 'open_questions') e
                where jsonb_typeof(e) is distinct from 'string' or not ((e #>> '{}') ~ c_q1 or (e #>> '{}') ~ c_q2)) then return 'open_questions'; end if;
    -- the tokens of a question are values of the closed vocabulary, never words of the reader's own
    for k in select e #>> '{}' from jsonb_array_elements(v -> 'open_questions') e loop
      m := regexp_match(k, ': ([a-z_]+) vs ([a-z_]+); posted as');
      if m is null then m := regexp_match(k, ' is ([a-z_]+); this reader may not'); end if;
      if m is null or exists (select 1 from unnest(m) t where t <> all (c_vocab)) then return 'open_questions'; end if;
    end loop;
  end if;
  if v -> 'agent_notes' is not null and v -> 'agent_notes' <> to_jsonb(c_notes) then return 'agent_notes'; end if;
  if v -> 'needs_review' is not null and jsonb_typeof(v -> 'needs_review') is distinct from 'boolean' then return 'needs_review'; end if;
  return null;
end $$;

-- ===== 2. the intake's two functions (bodies read from production on 2026-11-20 plus the tier rules; settings exactly as live)
CREATE OR REPLACE FUNCTION public.guard_reviewed_image_analysis()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i public.vehicle_images%ROWTYPE;
  s jsonb := NEW.extraction_metadata->'reviewed_image';
  v jsonb := NEW.structured_data;
  p jsonb := NEW.extraction_metadata->'reviewer_provenance';
  thin_why text;
BEGIN
  IF NEW.extraction_method IS DISTINCT FROM 'reviewed_image_analysis_v1' THEN RETURN NEW; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'review_requires_service_role' USING ERRCODE='42501'; END IF;
  IF NEW.kind::text <> 'condition' OR NEW.analysis_deferred IS DISTINCT FROM true
     OR NEW.extractor_id IS NOT NULL
     OR NEW.is_superseded IS TRUE OR NEW.property_id IS NOT NULL
     OR v->>'analysis_kind' IS DISTINCT FROM 'image_deep_byok'
     OR v->>'is_inferred' IS DISTINCT FROM 'true'
     OR NEW.raw_source_ref IS DISTINCT FROM 'vehicle_images:' || (v->>'image_id')
     OR NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE id=NEW.source_id AND slug='photo_pipeline')
     OR NEW.source_identifier IS DISTINCT FROM 'reviewed_image_analysis_v1:' || (v->>'image_id') || ':' || (NEW.extraction_metadata->>'review_hash')
     OR coalesce(NEW.extraction_metadata->>'review_hash','') !~ '^[0-9a-f]{64}$'
     OR coalesce(s->>'reviewed_sha256','') !~ '^[0-9a-f]{64}$'
     OR coalesce(s->>'reviewed_url','') !~ '^https://'
     OR NEW.source_url IS DISTINCT FROM s->>'image_url'
     OR NEW.observed_at IS DISTINCT FROM (s->>'reviewed_at')::timestamptz
     OR NEW.observed_at > now() + interval '5 minutes'
     OR coalesce(NEW.agent_model,'')='' OR NEW.agent_model IS DISTINCT FROM p->>'agent_model'
     OR coalesce(NEW.agent_tier,'')='' OR NEW.agent_tier IS DISTINCT FROM p->>'agent_tier'
     OR coalesce(p->>'extraction_method','')='' OR coalesce(p->>'run_id','')=''
     OR v->>'vehicle_id' IS DISTINCT FROM NEW.vehicle_id::text
     OR jsonb_typeof(v->'camera_pose') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v->'state_observations') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v->'components_seen') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v->'workshop_signals') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v->'presence') IS DISTINCT FROM 'object'
     OR coalesce(v->>'scene_type','')='' OR coalesce(v->>'build_phase_guess','')=''
     OR coalesce(v->>'intent','')='' OR jsonb_typeof(v->'confidence') IS DISTINCT FROM 'number'
     OR (v->>'confidence')::numeric NOT BETWEEN 0 AND 1
     OR NEW.confidence_score IS NULL OR NEW.confidence_score NOT BETWEEN 0 AND 0.6
     OR NEW.content_text IS DISTINCT FROM v->>'narrative_one_line' THEN
    RAISE EXCEPTION 'invalid_review_observation' USING ERRCODE='23514';
  END IF;
  SELECT * INTO i FROM public.vehicle_images WHERE id=(v->>'image_id')::uuid FOR SHARE;
  IF NOT FOUND OR i.vehicle_id IS DISTINCT FROM NEW.vehicle_id OR i.image_url IS DISTINCT FROM s->>'image_url'
     OR i.updated_at IS DISTINCT FROM (s->>'expected_updated_at')::timestamptz THEN
    RAISE EXCEPTION 'review_source_changed' USING ERRCODE='23514';
  END IF;
  IF i.is_sensitive IS TRUE OR i.is_superseded IS TRUE OR i.is_duplicate IS TRUE
     OR i.is_document IS TRUE OR i.doc_flag IS TRUE
     OR coalesce(i.vision_gate_status::text,'approved') <> 'approved'
     OR coalesce(i.image_vehicle_match_status,'pending') IN ('mismatch','unrelated') THEN
    RAISE EXCEPTION 'review_source_withdrawn' USING ERRCODE='23514';
  END IF;
  -- Reading tiers (20261120140000; platform_config 'image_reading_tiers'). Every check above holds for every tier. A reading whose
  -- agent_tier is not a reviewed tier (a thin one: the automatic reader, or any tier nobody has listed) may carry only the closed
  -- values the database admits for it (Rule 1) and never displaces a reading that is not thin (Rule 2). A reviewed-tier reading
  -- is checked as before and nothing more.
  IF NOT public.image_reading_tier_is_reviewed(NEW.agent_tier) THEN
    thin_why := public.image_reading_thin_violation(v,
      (SELECT c.config_value->'automatic'->'admits' FROM public.platform_config c WHERE c.config_key='image_reading_tiers'));
    thin_why := coalesce(thin_why, public.image_reading_thin_envelope_violation(NEW.extraction_metadata, v));
    IF thin_why IS NOT NULL THEN
      RAISE EXCEPTION 'thin_review_asserts_unchecked_field' USING ERRCODE='23514', DETAIL=thin_why;
    END IF;
    -- the photo carries a deep-reading stamp (ai_scan_metadata.byok_deep_analysis: only a reading that is not thin is ever stamped, see
    -- project_reviewed_image_analysis, so a stamp of any tier or none is someone else's reading), or a current reading of this photo
    -- (found by idx_vobs_image_id_analysis) exists whose tier is not the automatic one (reviewed, unlisted, or none: a legacy reading).
    -- A stored reading is protected unless it is positively the automatic tier, so a missing or edited config row never lets a thin
    -- reading displace one
    IF jsonb_typeof(i.ai_scan_metadata->'byok_deep_analysis')='object'
       OR EXISTS (SELECT 1 FROM (SELECT q.kind, q.is_superseded, q.agent_tier FROM public.vehicle_observations q
                   WHERE q.structured_data->>'image_id'=i.id::text AND q.structured_data->>'analysis_kind'='image_deep_byok' OFFSET 0) o
                  WHERE o.kind::text='condition' AND o.is_superseded IS NOT TRUE
                    AND NOT public.image_reading_tier_is_automatic(o.agent_tier)) THEN
      RAISE EXCEPTION 'thin_review_over_reviewed' USING ERRCODE='23514';
    END IF;
  END IF;
  -- The previous complete result survives even for a legacy cache that never
  -- retained an observation pointer. This is a before-image, not owner testimony.
  NEW.extraction_metadata := NEW.extraction_metadata || jsonb_build_object(
    'prior_analysis', i.ai_scan_metadata->'byok_deep_analysis');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_reviewed_image_analysis(p_observation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  i public.vehicle_images%ROWTYPE;
  after_i public.vehicle_images%ROWTYPE;
  s jsonb; p jsonb; a jsonb; cover jsonb; replay boolean;
  placed_id uuid; placed_vehicle uuid; placed_role text; reference_scene boolean;
  thin_new boolean; prev_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'review_requires_service_role' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.extraction_method IS DISTINCT FROM 'reviewed_image_analysis_v1'
     OR o.extractor_id IS NOT NULL
     OR o.kind::text <> 'condition' OR o.is_superseded IS TRUE OR o.analysis_deferred IS DISTINCT FROM true
     OR o.structured_data->>'analysis_kind' IS DISTINCT FROM 'image_deep_byok'
     OR NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE id=o.source_id AND slug='photo_pipeline') THEN
    RAISE EXCEPTION 'review_observation_not_eligible' USING ERRCODE='23514';
  END IF;
  s := o.extraction_metadata->'reviewed_image';
  p := o.extraction_metadata->'reviewer_provenance';
  SELECT * INTO i FROM public.vehicle_images WHERE id=(o.structured_data->>'image_id')::uuid FOR UPDATE;
  IF NOT FOUND OR i.vehicle_id IS DISTINCT FROM o.vehicle_id OR i.image_url IS DISTINCT FROM s->>'image_url'
     OR NOT EXISTS (SELECT 1 FROM public.observation_witnesses w WHERE w.observation_id=o.id AND w.image_id=i.id AND w.witness_role='derived') THEN
    RAISE EXCEPTION 'review_source_changed' USING ERRCODE='23514';
  END IF;
  IF i.is_sensitive IS TRUE OR i.is_superseded IS TRUE OR i.is_duplicate IS TRUE
     OR i.is_document IS TRUE OR i.doc_flag IS TRUE
     OR coalesce(i.vision_gate_status::text,'approved') <> 'approved'
     OR coalesce(i.image_vehicle_match_status,'pending') IN ('mismatch','unrelated') THEN
    RAISE EXCEPTION 'review_source_withdrawn' USING ERRCODE='23514';
  END IF;
  replay := i.ai_scan_metadata->'byok_deep_analysis'->>'observation_id'=o.id::text;
  thin_new := NOT public.image_reading_tier_is_reviewed(o.agent_tier);
  IF EXISTS(SELECT 1 FROM public.image_observations io WHERE io.image_id=i.id
    AND io.observed_by='caller-byok' AND io.agent_version='reviewed_image_analysis_v1'
    AND io.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=o.id::text
    AND io.confidence_basis#>>'{reviewed_image_analysis_v1,state}'='withdrawn') THEN
    RAISE EXCEPTION 'review_source_previously_withdrawn' USING ERRCODE='23514';
  END IF;
  IF thin_new THEN
    -- Reading tiers (20261120140000). A thin-tier reading (the automatic reader's, or any tier nobody has listed) is its observation
    -- and, later, the keyed values projected from it. Nothing else is written for it: no stamp on the photo
    -- (ai_scan_metadata.byok_deep_analysis means "a reviewed reading exists" to everything that reads it, and readers select, score
    -- and write on its presence alone), no search/convergence row (the reader checked no identity, so it casts no vote on whose car
    -- this is) and no cover. The photo row is not written, so there is no updated_at to hold and nothing to replay: calling this again
    -- for the same observation finds nothing left to do, whatever has touched the photo since.
    -- Rule 2 again, here: the insert was admitted when no other reading stood, and one may have landed since.
    IF jsonb_typeof(i.ai_scan_metadata->'byok_deep_analysis')='object'
       OR EXISTS (SELECT 1 FROM (SELECT q.id, q.kind, q.is_superseded, q.agent_tier FROM public.vehicle_observations q
                   WHERE q.structured_data->>'image_id'=i.id::text AND q.structured_data->>'analysis_kind'='image_deep_byok' OFFSET 0) x
                  WHERE x.id<>o.id AND x.kind::text='condition' AND x.is_superseded IS NOT TRUE
                    AND NOT public.image_reading_tier_is_automatic(x.agent_tier)) THEN
      RAISE EXCEPTION 'thin_review_over_reviewed' USING ERRCODE='23514';
    END IF;
  ELSIF replay IS NOT TRUE THEN
    IF i.updated_at IS DISTINCT FROM (s->>'expected_updated_at')::timestamptz
       OR i.ai_scan_metadata->'byok_deep_analysis' IS DISTINCT FROM o.extraction_metadata->'prior_analysis' THEN
      -- Missing key and JSON null are equivalent only for an absent prior result.
      IF i.updated_at IS DISTINCT FROM (s->>'expected_updated_at')::timestamptz
         OR coalesce(i.ai_scan_metadata->'byok_deep_analysis','null'::jsonb) IS DISTINCT FROM o.extraction_metadata->'prior_analysis' THEN
        RAISE EXCEPTION 'review_source_changed' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF thin_new OR replay IS NOT TRUE THEN
    -- Reading tiers (20261120140000, Rule 3): a reading that lands replaces every current automatic-tier reading this intake made of
    -- the photo, and every current keyed child projected from one (a child names its parent in structured_data.source_observation_id):
    -- superseded by this observation, the way supersede_observation writes it (that function needs an owner session; this is a rule
    -- of the intake, done here, in the projection's transaction, so a refused projection undoes it). Testimony is superseded, never
    -- edited or deleted. Only a reading whose tier is positively the automatic one is replaced (image_reading_tier_is_automatic):
    -- a reviewed, unlisted or tierless reading is never touched, and with no config row none is superseded. Never itself, and not on
    -- a replay of a reviewed reading (the first projection did it).
    -- A thin landing replaces only readings older than itself in the ledger's own order, the order image_stage_reading_parent uses
    -- to name a photo's current reading (ingested_at, newest first; a tie goes to the lowest id): so however many automatic readings
    -- were posted and in whatever order they are projected, the newest one stands alone at the end and none is superseded by an
    -- older one.
    SELECT coalesce(array_agg(p.id), '{}') INTO prev_ids
      FROM (SELECT q.id, q.kind, q.is_superseded, q.vehicle_id, q.agent_tier, q.extraction_method, q.ingested_at FROM public.vehicle_observations q
             WHERE q.structured_data->>'image_id'=i.id::text AND q.structured_data->>'analysis_kind'='image_deep_byok' OFFSET 0) p
     WHERE p.id<>o.id AND p.kind::text='condition' AND p.is_superseded IS NOT TRUE AND p.vehicle_id IS NOT DISTINCT FROM o.vehicle_id
       AND p.extraction_method='reviewed_image_analysis_v1' AND public.image_reading_tier_is_automatic(p.agent_tier)
       AND (NOT thin_new OR (coalesce(p.ingested_at,'-infinity'::timestamptz), o.id) < (coalesce(o.ingested_at,'-infinity'::timestamptz), p.id));
    IF cardinality(prev_ids)>0 THEN
      UPDATE public.vehicle_observations SET is_superseded=true, superseded_by=o.id, superseded_at=now(),
        lineage_chain=array_append(coalesce(lineage_chain,ARRAY[]::uuid[]),o.id)
       WHERE id=ANY(prev_ids) AND is_superseded IS NOT TRUE;
      UPDATE public.vehicle_observations SET is_superseded=true, superseded_by=o.id, superseded_at=now(),
        lineage_chain=array_append(coalesce(lineage_chain,ARRAY[]::uuid[]),o.id)
       WHERE structured_data->>'image_id'=i.id::text AND structured_data->>'analysis_kind'='image_property_projection'
         AND is_superseded IS NOT TRUE
         AND structured_data->>'source_observation_id'=ANY(ARRAY(SELECT x::text FROM unnest(prev_ids) x));
    END IF;
  END IF;
  IF thin_new THEN
    -- projection_duplicate is null: nothing of the photo is written, so a second call cannot be told from the first
    RETURN jsonb_build_object('success',true,'observation_id',o.id,'image_id',i.id,'vehicle_id',o.vehicle_id,
      'projection_duplicate',NULL,'image_observation_id',NULL,'search_vehicle_id',NULL,
      'cover',jsonb_build_object('vehicle_id',o.vehicle_id,'changed',false,'reason','thin_tier_reading'),
      'thin_tier',true,'superseded_readings',cardinality(prev_ids),'model_calls',0);
  END IF;
  IF replay IS NOT TRUE THEN
    a := o.structured_data - ARRAY['image_id','vehicle_id','analysis_kind','witness_image_id','is_inferred'];
    a := a || jsonb_build_object('analyzed_at',s->>'reviewed_at','prompt_version','reviewed_image_analysis_v1',
      'observation_id',o.id,'source_identifier',o.source_identifier,'vehicle_id',o.vehicle_id,
      'agent_model',o.agent_model,'agent_tier',o.agent_tier,'extraction_method',p->>'extraction_method',
      'run_id',p->>'run_id','agent_duration_ms',p->'agent_duration_ms',
      'agent_cost_cents',p->'agent_cost_cents','cost_basis',p->>'cost_basis');
    UPDATE public.vehicle_images SET ai_scan_metadata=coalesce(ai_scan_metadata,'{}'::jsonb) || jsonb_build_object('byok_deep_analysis',a)
      WHERE id=i.id AND vehicle_id=o.vehicle_id AND image_url=s->>'image_url'
        AND updated_at=(s->>'expected_updated_at')::timestamptz RETURNING * INTO after_i;
    IF NOT FOUND OR after_i.vehicle_id IS DISTINCT FROM i.vehicle_id OR after_i.image_url IS DISTINCT FROM i.image_url
       OR after_i.vision_gate_status IS DISTINCT FROM i.vision_gate_status THEN
      -- In particular, an existing hint guard may attempt to unfile an image.
      -- Refuse/roll back its whole projection transaction, never bypass it.
      RAISE EXCEPTION 'review_source_changed_during_projection' USING ERRCODE='23514';
    END IF;
  END IF;
  -- The canonical deep-analysis path includes the existing search/convergence
  -- row, not just its BYOK cache and timeline observation. Keep this in the same
  -- source-locked transaction: a failed placement rolls back the projection.
  -- The role describes this frame. Reference/unknown scenes do not assert that
  -- the photographed object is the vehicle; a body/detail reading is never a
  -- high-confidence identity vote merely because a review was completed.
  reference_scene := coalesce(o.structured_data->>'scene_type','unknown') NOT IN
    ('body_exterior','body_interior','engine_bay','undercarriage','data_plate',
     'wheel_assembly','fabrication_in_progress','paint_booth','road_test','off_property');
  placed_vehicle := CASE WHEN reference_scene THEN NULL ELSE o.vehicle_id END;
  placed_role := CASE WHEN reference_scene THEN 'incidental'
    WHEN o.structured_data->>'scene_type' IN ('body_exterior','road_test','off_property') THEN 'subject'
    ELSE 'part' END;
  placed_id := public.ingest_image_observation(i.id, placed_vehicle, placed_role,
    least(greatest(coalesce(o.confidence_score,0),0),0.6), 'caller-byok','reviewed_image_analysis_v1',
    jsonb_build_object('reviewed_image_analysis_v1',jsonb_build_object(
      'observation_id',o.id,'source_identifier',o.source_identifier,'vehicle_id',o.vehicle_id,
      'image_url',s->>'image_url','reviewed_url',s->>'reviewed_url',
      'reviewed_sha256',s->>'reviewed_sha256','reviewed_at',s->>'reviewed_at',
      'scene_type',o.structured_data->>'scene_type',
      'evidence_role',CASE WHEN reference_scene THEN 'reference' ELSE 'physical_observation' END)),
    false, jsonb_build_object('method','reviewed_image_analysis_v1'));
  IF placed_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.image_observations io
    WHERE io.id=placed_id AND io.image_id=i.id AND io.vehicle_id IS NOT DISTINCT FROM placed_vehicle
      AND io.is_active AND io.observed_by='caller-byok' AND io.agent_version='reviewed_image_analysis_v1'
      AND io.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=o.id::text
      AND io.confidence_basis#>>'{reviewed_image_analysis_v1,image_url}'=i.image_url) THEN
    RAISE EXCEPTION 'review_search_projection_not_persisted' USING ERRCODE='23514';
  END IF;
  cover := public.recompute_vehicle_primary_image(o.vehicle_id);
  RETURN jsonb_build_object('success',true,'observation_id',o.id,'image_id',i.id,'vehicle_id',o.vehicle_id,
    'projection_duplicate',coalesce(replay,false),'image_observation_id',placed_id,
    'search_vehicle_id',placed_vehicle,'cover',cover,'model_calls',0);
END;
$function$;

-- ===== grants: service role only. The guard and the projection keep their existing grants (CREATE OR REPLACE keeps them).
revoke all on function public.image_reading_tier_is_reviewed(text, boolean) from public, anon, authenticated;
revoke all on function public.image_reading_thin_violation(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.image_reading_tier_is_automatic(text) from public, anon, authenticated;
revoke all on function public.image_reading_thin_envelope_violation(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.image_reading_tier_is_reviewed(text, boolean), public.image_reading_thin_violation(jsonb, jsonb),
  public.image_reading_tier_is_automatic(text), public.image_reading_thin_envelope_violation(jsonb, jsonb) to service_role;

commit;
