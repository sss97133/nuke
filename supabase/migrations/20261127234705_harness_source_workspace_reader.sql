-- Source inspection uses the same selected IDs as the existing evaluator.
-- Neither this read nor its content hash is a published construction revision.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE FUNCTION public.harness_source_workspace(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
AS $function$
DECLARE
  source_graph jsonb;
  selected_model jsonb;
  selection jsonb;
  content jsonb;
BEGIN
  -- The stricter existing model visibility rule also excludes anonymous-owner
  -- claims and deleted vehicles. Preserve source RLS and all existing grants.
  IF NOT public.harness_model_visible(p_vehicle_id) THEN RETURN NULL; END IF;
  source_graph := public.harness_schematic_model(p_vehicle_id);
  selected_model := public.harness_model_inputs(p_vehicle_id)->'model';
  IF source_graph IS NULL OR selected_model IS NULL
    OR source_graph->>'contract_version' IS DISTINCT FROM '1'
    OR selected_model->>'contract_version' IS DISTINCT FROM '2'
    OR source_graph->>'vehicle_id' IS DISTINCT FROM p_vehicle_id::text
    OR selected_model->>'vehicle_id' IS DISTINCT FROM p_vehicle_id::text
    OR selected_model->>'selection' IS DISTINCT FROM 'decided_design'
    OR jsonb_typeof(selected_model->'segments') IS DISTINCT FROM 'array'
    OR jsonb_typeof(selected_model->'circuits') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Incompatible harness source or selection contract' USING ERRCODE = '22023';
  END IF;
  selection := jsonb_build_object(
    'owner', 'harness_model_inputs', 'contract_version', 2, 'kind', 'decided_design',
    'segment_ids', coalesce((SELECT jsonb_agg(x->>'id' ORDER BY x->>'id')
      FROM jsonb_array_elements(selected_model->'segments') x), '[]'::jsonb),
    'circuit_ids', coalesce((SELECT jsonb_agg(x->>'id' ORDER BY x->>'id')
      FROM jsonb_array_elements(selected_model->'circuits') x), '[]'::jsonb));
  IF EXISTS (SELECT id FROM jsonb_array_elements_text(selection->'segment_ids') k(id)
    EXCEPT SELECT s->>'id' FROM jsonb_array_elements(source_graph->'segments') s)
    OR EXISTS (SELECT id FROM jsonb_array_elements_text(selection->'circuit_ids') k(id)
    EXCEPT SELECT c->>'id' FROM jsonb_array_elements(source_graph->'circuits') c) THEN
    RAISE EXCEPTION 'Harness selection contains an unavailable source record' USING ERRCODE = '22023';
  END IF;
  content := jsonb_build_object('contract_version', 1, 'vehicle_id', p_vehicle_id,
    'snapshot_kind', 'current_read_not_published_revision',
    'source', source_graph - 'read_at', 'selection', selection);
  RETURN content || jsonb_build_object('read_at', statement_timestamp(),
    'snapshot_hash', md5(content::text));
END;
$function$;

COMMENT ON FUNCTION public.harness_source_workspace(uuid) IS
'Read-only invoker-RLS composition of harness_schematic_model source records and the exact decided-design IDs from harness_model_inputs v2. Selection is not a stored in_current_plan flag, successor resolution, material-revision assessment, evaluation, purchase eligibility or physical completion. snapshot_hash identifies the returned source and membership content, excluding the read clock; it is not a published engineering revision. Does not write source rows or drive a fold.';
REVOKE ALL ON FUNCTION public.harness_source_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_source_workspace(uuid) TO anon, authenticated, service_role;
COMMIT;
