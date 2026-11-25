-- Cached image property projection: the source reading becomes a keyed edge.
--
-- Rows: vehicle_observations, extraction_method cached_byok_property_projection_v1 (property keys
-- image_visible_paint_stage / image_visible_rust_severity / image_visible_assembly_state). Each holds its source
-- reading (an image_deep_byok condition row) only in structured_data.source_observation_id; the typed column
-- vehicle_observations.source_observation_id (FK vehicle_observations_source_observation_id_fkey) is NULL on all of them.
-- Measured 2026-11-25 01:30 PT: 14,033 current rows on 29 vehicles, column set on 0; proof vehicle 20d21fb0 776 rows.
--
-- Why the column was never set, and why it cannot be set in place:
--   validate_retained_listing_property_source (trigger trg_retained_listing_property_source_insert/_update) fires on any
--   row with a non-null source_observation_id. On INSERT it fell through to 'unsupported retained property' for the image
--   keys; on UPDATE it refuses NULL -> value with 'retained source links are assigned only on insert'. That UPDATE rule
--   stays: the existing rows get the key only as successors.
--
-- This migration:
--   1. validate_retained_listing_property_source gains a branch for the projection: the column must equal
--      structured_data.source_observation_id, and that row must be the current image_deep_byok condition reading of the
--      same vehicle and photo whose state_observations value the child carries. A forged or stale parent is refused.
--   2. ingest_cached_image_property_batch writes the column on insert. A re-sent claim whose row was re-landed by (3)
--      is a duplicate of that successor, not a conflict.
--   3. supersede_untyped_cached_image_properties(vehicle, limit): service role only. For each current projection row of the
--      vehicle with the column NULL, it inserts a successor identical to it except the column (set from its own
--      structured_data), a new knowledge clock and content_hash = sha256(old content_hash || ':typed_source_v1'), then
--      supersedes the old row pointing superseded_by at the successor. The insert passes branch (1); the witness comes from
--      trg_project_observation_image_witness as for any child.
-- The edge function ingest-observation sets the column on the single route (same commit); the job path that calls (3) is
-- scripts/deep-image-analysis-byok.mjs project-cached (photo-keys.yml step=properties).
--   4. get_field_provenance and vehicle_canonical admit a keyed projection row on the terms they admitted it untyped.
-- All four are patched by anchor on their live definitions, refused if any changed since 2026-11-25.
-- A call of (3) is bounded by its caller (project-cached aborts it at 40 s) and the role's statement_timeout.
-- Contracts: supabase/sql/test_cached_image_projection_source_key.sql (guard, writer, batch),
-- test_cached_image_projection_keyed_provenance.sql (get_field_provenance),
-- test_cached_image_projection_keyed_canonical.sql (vehicle_canonical).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard_branch$
DECLARE d text;
 anchor text := $a$  IF NEW.extraction_method='retained_listing_reported_work_v1' OR NEW.structured_data->>'analysis_kind'='retained_reported_work' THEN$a$;
 branch text := $b$  -- image_property_projection_source_key_v1: a cached image property projection names its source reading
  IF NEW.extraction_method='cached_byok_property_projection_v1' OR NEW.structured_data->>'analysis_kind'='image_property_projection' THEN
    SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
    IF NOT FOUND OR p.is_superseded IS TRUE OR p.vehicle_id IS DISTINCT FROM NEW.vehicle_id
      OR p.kind::text IS DISTINCT FROM 'condition' OR NEW.kind::text IS DISTINCT FROM 'condition'
      OR p.structured_data->>'analysis_kind' IS DISTINCT FROM 'image_deep_byok'
      OR NEW.extraction_method IS DISTINCT FROM 'cached_byok_property_projection_v1'
      OR NEW.structured_data->>'analysis_kind' IS DISTINCT FROM 'image_property_projection'
      OR NEW.structured_data->>'source_observation_id' IS DISTINCT FROM p.id::text
      OR NEW.raw_source_ref IS DISTINCT FROM 'vehicle_observations:'||p.id::text
      OR NEW.structured_data->>'image_id' IS DISTINCT FROM p.structured_data->>'image_id'
      OR coalesce(NEW.structured_data->>'property_key','') NOT IN ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state')
      OR NOT EXISTS (SELECT 1 FROM public.observation_properties r WHERE r.id=NEW.property_id
        AND r.property_key=NEW.structured_data->>'property_key')
      OR jsonb_typeof(NEW.structured_data->(NEW.structured_data->>'property_key')) IS DISTINCT FROM 'string'
      OR NEW.structured_data->(NEW.structured_data->>'property_key') IS DISTINCT FROM
        p.structured_data->'state_observations'->(CASE NEW.structured_data->>'property_key'
          WHEN 'image_visible_rust_severity' THEN 'rust_severity'
          WHEN 'image_visible_paint_stage' THEN 'paint_state' ELSE 'completeness' END) THEN
      RAISE EXCEPTION 'image property projection must name its current source reading' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
$b$;
BEGIN
 d := pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure);
 IF encode(sha256(convert_to(d,'UTF8')),'base64') IS DISTINCT FROM 'Oonr0vrXAn5C9lGFRZgKW95LAfKc9RygAeKxPuhKQl0='
  OR (length(d)-length(replace(d,anchor,'')))/length(anchor) <> 1 THEN
  RAISE EXCEPTION 'validate_retained_listing_property_source changed since 2026-11-25; re-read it before adding the image projection branch';
 END IF;
 EXECUTE replace(d, anchor, branch||anchor);
END $guard_branch$;

DO $batch_key$
DECLARE d text;
 old_columns text := 'agent_tier,agent_model,agent_cost_cents,extraction_method,raw_source_ref,property_id,analysis_deferred)';
 old_values text := $v$score,factors,nullif(c->>'agent_tier',''),c->>'agent_model',0,c->>'extraction_method',c->>'raw_source_ref',p.id,true$v$;
 old_conflict text := $v$OR o.content_hash IS DISTINCT FROM c->>'content_hash') THEN$v$;
 old_readback text := $v$AND o.source_identifier=c.claim->>'source_identifier' AND o.content_hash=c.claim->>'content_hash'$v$;
BEGIN
 d := pg_get_functiondef('public.ingest_cached_image_property_batch(jsonb)'::regprocedure);
 IF encode(sha256(convert_to(d,'UTF8')),'base64') IS DISTINCT FROM 'ZzQm8ueqs/6tWfiZ/JojBwfqMPGvrqJs+kXWTdQkqf8='
  OR (length(d)-length(replace(d,old_columns,'')))/length(old_columns) <> 1
  OR (length(d)-length(replace(d,old_values,'')))/length(old_values) <> 1
  OR (length(d)-length(replace(d,old_conflict,'')))/length(old_conflict) <> 1
  OR (length(d)-length(replace(d,old_readback,'')))/length(old_readback) <> 1 THEN
  RAISE EXCEPTION 'ingest_cached_image_property_batch changed since 2026-11-25; re-read it before keying its source column';
 END IF;
 d := replace(d, old_columns, 'agent_tier,agent_model,agent_cost_cents,extraction_method,raw_source_ref,property_id,analysis_deferred,source_observation_id)');
 d := replace(d, old_values, old_values||$v$,(c->'structured_data'->>'source_observation_id')::uuid$v$);
 -- a row re-landed by supersede_untyped_cached_image_properties keeps the identity and carries the successor hash
 d := replace(d, old_conflict, $v$OR (o.content_hash IS DISTINCT FROM c->>'content_hash'
         AND o.content_hash IS DISTINCT FROM encode(sha256(convert_to((c->>'content_hash')||':typed_source_v1','UTF8')),'hex'))) THEN$v$);
 d := replace(d, old_readback, $v$AND o.source_identifier=c.claim->>'source_identifier'
    AND o.content_hash IN (c.claim->>'content_hash',encode(sha256(convert_to((c.claim->>'content_hash')||':typed_source_v1','UTF8')),'hex'))$v$);
 EXECUTE d;
END $batch_key$;

-- guardrail-allow(testimony-write): supersede_untyped_cached_image_properties: a supersession writer. The successor keeps the row's identity (source_identifier), which ingest-observation cannot re-land (unique_observation would answer duplicate with the untyped row), and the in-place key is refused by validate_retained_listing_property_source; it writes a successor and supersedes, never changes a value.

-- The source reading a projection row names, as a uuid (NULL when it names none or a malformed one).
CREATE FUNCTION public.cached_image_projection_parent_id(p_data jsonb)
RETURNS uuid LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$ SELECT CASE WHEN p_data->>'source_observation_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN (p_data->>'source_observation_id')::uuid END $$;
REVOKE ALL ON FUNCTION public.cached_image_projection_parent_id(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cached_image_projection_parent_id(jsonb) TO service_role;

CREATE FUNCTION public.supersede_untyped_cached_image_properties(p_vehicle_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET lock_timeout TO '5s'
AS $function$
DECLARE
  c public.vehicle_observations%ROWTYPE;
  successor uuid;
  done integer := 0;
  held integer := 0;
  remaining integer := 0;
  refused integer := 0;
  refusals jsonb := '{}';
  candidate uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'supersede_untyped_cached_image_properties: service role only' USING ERRCODE='42501';
  END IF;
  IF p_vehicle_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'supersede_untyped_cached_image_properties: one vehicle, limit 1..500' USING ERRCODE='22023';
  END IF;
  FOR candidate IN
    SELECT o.id FROM public.vehicle_observations o
     WHERE o.vehicle_id = p_vehicle_id AND o.is_superseded = false
       AND o.property_id IN (SELECT r.id FROM public.observation_properties r WHERE r.property_key IN
         ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state'))
       AND o.extraction_method = 'cached_byok_property_projection_v1' AND o.source_observation_id IS NULL
       -- a child whose reading is no longer current is not re-keyed: retracting it is the reading successor's work
       AND EXISTS (SELECT 1 FROM public.vehicle_observations p
                    WHERE p.id = public.cached_image_projection_parent_id(o.structured_data) AND p.is_superseded IS NOT TRUE)
     ORDER BY o.id
  LOOP
    EXIT WHEN done >= p_limit;
    -- one row at a time: a row another writer holds is passed over, and a row the guard refuses is counted and left
    -- (its refusal does not undo the others, and the next call goes on past it)
    SELECT * INTO c FROM public.vehicle_observations
     WHERE id = candidate AND is_superseded = false AND source_observation_id IS NULL FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    BEGIN
      successor := gen_random_uuid();
      INSERT INTO public.vehicle_observations
      SELECT (jsonb_populate_record(NULL::public.vehicle_observations, to_jsonb(c) || jsonb_build_object(
        'id', successor, 'ingested_at', now(),
        'content_hash', encode(sha256(convert_to(c.content_hash||':typed_source_v1','UTF8')),'hex'),
        'source_observation_id', c.structured_data->>'source_observation_id',
        'is_superseded', false, 'superseded_by', NULL, 'superseded_at', NULL, 'lineage_chain', NULL))).*;
      UPDATE public.vehicle_observations
         SET is_superseded = true, superseded_by = successor, superseded_at = now(),
             lineage_chain = array_append(coalesce(lineage_chain, ARRAY[]::uuid[]), successor)
       WHERE id = c.id;
      done := done + 1;
    EXCEPTION WHEN check_violation OR foreign_key_violation OR unique_violation THEN
      refused := refused + 1;
      refusals := jsonb_set(refusals, ARRAY[SQLSTATE], to_jsonb(coalesce((refusals->>SQLSTATE)::int, 0) + 1));
    END;
  END LOOP;
  -- left after this call: rows still to re-land (source current) and rows held (source superseded or missing)
  SELECT count(*) FILTER (WHERE p.id IS NOT NULL), count(*) FILTER (WHERE p.id IS NULL) INTO remaining, held
    FROM public.vehicle_observations o
    LEFT JOIN public.vehicle_observations p
      ON p.id = public.cached_image_projection_parent_id(o.structured_data) AND p.is_superseded IS NOT TRUE
   WHERE o.vehicle_id = p_vehicle_id AND o.is_superseded = false
     AND o.property_id IN (SELECT r.id FROM public.observation_properties r WHERE r.property_key IN
       ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state'))
     AND o.extraction_method = 'cached_byok_property_projection_v1' AND o.source_observation_id IS NULL;
  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'succeeded', done, 'refused', refused, 'refused_by_sqlstate', refusals,
    'held_source_not_current', held, 'remaining', remaining);
END
$function$;

REVOKE ALL ON FUNCTION public.supersede_untyped_cached_image_properties(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_untyped_cached_image_properties(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.supersede_untyped_cached_image_properties(uuid, integer) IS
 'Re-lands one vehicle''s current cached image property projections (cached_byok_property_projection_v1) that lack the typed source_observation_id: a successor identical but for that column, a new ingested_at and content_hash sha256(old || '':typed_source_v1''), and the old row superseded by it. Rows whose source reading is superseded or missing are left and counted held_source_not_current; remaining counts the rows still to re-land after the call. One row at a time: a row the guard refuses is left and counted by SQLSTATE (refused, refused_by_sqlstate) without undoing the others. Service role only; at most p_limit (1..500) successors a call; returns succeeded, refused, refused_by_sqlstate, held_source_not_current, remaining. Caller: scripts/deep-image-analysis-byok.mjs project-cached.';

-- 4. The two readers that drop any row with source_observation_id set unless a retained-listing matcher admits it
--    (prod scan 2026-11-25 02:20 PT of pg_proc, pg_views, pg_matviews, pg_policies for 'source_observation_id IS NULL':
--    only these two read vehicle_observations that way). Without (4) every re-landed or newly keyed projection row would
--    leave them: proof car 20d21fb0, read-only simulation with the key set, 0 of 776 rows passed either filter.
--    Each reader admits a keyed projection row on the same terms it admitted the untyped one, nothing wider:
--    get_field_provenance already gates every projection row on its source reading (the `a` join: current, public,
--    same vehicle and photo, value equal); the new disjunct only requires the key to be that same reading.
--    vehicle_canonical never tested the reading of an untyped row; the new disjunct requires the key to be the
--    image_deep_byok reading of the same vehicle and photo that structured_data names (776 of 776 on the proof car).
--    Whether canonical should also require a public reading (75 of 776 proof readings pass observation_is_public) is a
--    visibility change, not this fix; it is on the board as a question.
--    A contract database that carries neither reader (the writer contract) sets nuke.contract_without_readers = on;
--    production never does, and an absent reader there refuses the migration.
DO $reader_provenance$
DECLARE s text; d text;
 anchor text := $a$ AND (o.source_observation_id IS NULL OR EXISTS (SELECT FROM public.vehicle_observations dp WHERE dp.id=o.source_observation_id AND ($a$;
 keyed text := $k$ AND (o.source_observation_id IS NULL OR (o.extraction_method='cached_byok_property_projection_v1' AND o.source_observation_id=a.id) OR EXISTS (SELECT FROM public.vehicle_observations dp WHERE dp.id=o.source_observation_id AND ($k$;
BEGIN
 IF to_regprocedure('public.get_field_provenance(uuid,text)') IS NULL THEN
  IF current_setting('nuke.contract_without_readers', true) = 'on' THEN RETURN; END IF;
  RAISE EXCEPTION 'get_field_provenance is missing; it must admit keyed image projections before they are keyed';
 END IF;
 SELECT p.prosrc INTO s FROM pg_proc p WHERE p.oid = 'public.get_field_provenance(uuid,text)'::regprocedure;
 d := pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure);
 -- the live body (20261125175500), read 2026-11-25 02:20 PT
 IF encode(sha256(convert_to(s,'UTF8')),'hex') IS DISTINCT FROM 'f9fa67c39786adb2872c2836766a19b74f891b31d0fa0f31a56c750f02bc025a'
  OR (length(d)-length(replace(d,anchor,'')))/length(anchor) <> 1 THEN
  RAISE EXCEPTION 'get_field_provenance changed since 2026-11-25 02:20 PT; re-read it before admitting keyed image projections';
 END IF;
 EXECUTE replace(d, anchor, keyed);
END $reader_provenance$;

DO $reader_canonical$
DECLARE d text; path text := current_setting('search_path'); shape_before text; shape_after text;
 anchor text := $a$((o.source_observation_id IS NULL) OR (EXISTS ( SELECT$a$;
 keyed text := $k$((o.source_observation_id IS NULL) OR ((o.extraction_method = 'cached_byok_property_projection_v1'::text) AND (EXISTS ( SELECT 1
                   FROM vehicle_observations xp
                  WHERE ((xp.id = o.source_observation_id) AND (xp.vehicle_id = o.vehicle_id) AND ((xp.structured_data ->> 'analysis_kind'::text) = 'image_deep_byok'::text) AND ((xp.structured_data ->> 'image_id'::text) = (o.structured_data ->> 'image_id'::text)) AND ((o.structured_data ->> 'source_observation_id'::text) = (xp.id)::text))))) OR (EXISTS ( SELECT$k$;
BEGIN
 IF to_regclass('public.vehicle_canonical') IS NULL THEN
  IF current_setting('nuke.contract_without_readers', true) = 'on' THEN RETURN; END IF;
  RAISE EXCEPTION 'vehicle_canonical is missing; it must admit keyed image projections before they are keyed';
 END IF;
 -- the fingerprint 20261122003000 names: plain pg_get_viewdef printed with search_path = public
 PERFORM set_config('search_path', 'public', true);
 d := pg_get_viewdef('public.vehicle_canonical'::regclass);
 IF md5(d) IS DISTINCT FROM '4d1a2e57a880181691e5bd8eb0c30002' OR (length(d)-length(replace(d,anchor,'')))/length(anchor) <> 1 THEN
  RAISE EXCEPTION 'vehicle_canonical changed since 2026-11-25 (md5 %); re-read it before admitting keyed image projections', md5(d);
 END IF;
 SELECT concat_ws(E'\n', pg_get_userbyid(c.relowner), coalesce(c.reloptions::text,'-'), coalesce(c.relacl::text,'-'),
          coalesce(obj_description(c.oid,'pg_class'),'-'),
          (SELECT string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod), ', ' ORDER BY a.attnum)
             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
   INTO shape_before FROM pg_class c WHERE c.oid = 'public.vehicle_canonical'::regclass;
 EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS ' || replace(d, anchor, keyed);
 SELECT concat_ws(E'\n', pg_get_userbyid(c.relowner), coalesce(c.reloptions::text,'-'), coalesce(c.relacl::text,'-'),
          coalesce(obj_description(c.oid,'pg_class'),'-'),
          (SELECT string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod), ', ' ORDER BY a.attnum)
             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
   INTO shape_after FROM pg_class c WHERE c.oid = 'public.vehicle_canonical'::regclass;
 IF shape_after IS DISTINCT FROM shape_before
  OR strpos(pg_get_viewdef('public.vehicle_canonical'::regclass), 'cached_byok_property_projection_v1') = 0 THEN
  RAISE EXCEPTION 'vehicle_canonical replace changed its owner, options, grants, comment or columns, or lost the branch';
 END IF;
 PERFORM set_config('search_path', path, true);
END $reader_canonical$;

NOTIFY pgrst, 'reload schema';
COMMIT;
