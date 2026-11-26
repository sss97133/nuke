-- Exact owner-only projection of an existing harness observation. No new witness
-- store, public payload change, base grants, artifact URLs or RLS bypass.
-- Receipt: docs/wiring/receipts/2026-11-25_owner-evidence-reader.md
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.harness_evidence_witness(p_vehicle_id uuid, p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = '' AS $fn$
BEGIN
  -- Explicit false also refuses tokens without a nonanonymous qualification.
  IF auth.uid() IS NULL OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated'
    OR auth.jwt()->>'is_anonymous' IS DISTINCT FROM 'false' THEN
    RETURN NULL;
  END IF;
  RETURN (
    WITH owner_vehicle AS MATERIALIZED (
      SELECT v.id FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
        AND (v.user_id = auth.uid() OR v.owner_id = auth.uid())
    ), witness AS MATERIALIZED (
      SELECT o.* FROM public.vehicle_observations o JOIN owner_vehicle v ON v.id = o.vehicle_id
      WHERE o.id = p_observation_id AND o.kind::text = 'specification'
        AND o.structured_data->>'domain' = 'wiring'
    ), edges AS MATERIALIZED (
      SELECT e.id, e.observation_id, e.row_kind, e.row_id, e.field, e.relation,
        CASE WHEN target.is_superseded IS TRUE THEN 'superseded' WHEN target.is_superseded IS FALSE THEN 'current_record' ELSE 'not_recorded' END AS target_revision
      FROM public.harness_evidence e JOIN witness o ON o.id = e.observation_id AND o.vehicle_id = e.vehicle_id
      JOIN LATERAL (
        SELECT s.is_superseded FROM public.harness_signals s WHERE e.row_kind='signal' AND s.id=e.row_id AND s.vehicle_id=e.vehicle_id
        UNION ALL SELECT n.is_superseded FROM public.harness_nets n WHERE e.row_kind='net' AND n.id=e.row_id AND n.vehicle_id=e.vehicle_id
        UNION ALL SELECT s.is_superseded FROM public.harness_segments s WHERE e.row_kind='segment' AND s.id=e.row_id AND s.vehicle_id=e.vehicle_id
        UNION ALL SELECT t.is_superseded FROM public.wire_termination_specs t
          JOIN public.harness_endpoints ep ON ep.id=t.endpoint_id JOIN public.harness_designs d ON d.id=ep.design_id AND d.vehicle_id=t.vehicle_id
          WHERE e.row_kind='termination' AND t.id=e.row_id AND t.vehicle_id=e.vehicle_id
            AND (t.circuit_id IS NULL OR EXISTS(SELECT 1 FROM public.vehicle_custom_circuits c
              JOIN public.vehicle_wiring_overlays ov ON ov.id=c.overlay_id WHERE c.id=t.circuit_id AND ov.vehicle_id=t.vehicle_id))
        UNION ALL SELECT ep.is_superseded FROM public.harness_endpoints ep JOIN public.harness_designs d ON d.id=ep.design_id
          WHERE e.row_kind='endpoint' AND ep.id=e.row_id AND d.vehicle_id=e.vehicle_id
      ) target ON true
    )
    SELECT jsonb_build_object(
      'schema_version', 1, 'visibility', 'vehicle_owner', 'vehicle_id', o.vehicle_id, 'observation_id', o.id,
      'kind', o.kind, 'observed_at', o.observed_at, 'ingested_at', o.ingested_at,
      'content_text', o.content_text, 'citation_excerpt', o.citation_excerpt, 'citation_page_number', o.citation_page_number,
      'citation_document_id', o.citation_document_id, 'citation_secure_document_id', o.citation_secure_document_id,
      'citation_publication_id', o.citation_publication_id,
      'source_url', CASE WHEN o.source_url ~ '^https://[^[:space:]]+$' THEN o.source_url END,
      'source', CASE WHEN src.id IS NOT NULL THEN jsonb_build_object('id',src.id,'display_name',src.display_name,
        'category',src.category,'base_trust_score',src.base_trust_score,'updated_at',src.updated_at) END,
      'confidence', o.confidence, 'confidence_score', o.confidence_score, 'extraction_method', o.extraction_method,
      'historical', coalesce(o.is_superseded,false) OR o.superseded_by IS NOT NULL,
      'is_superseded', o.is_superseded, 'superseded_at', o.superseded_at,
      'superseded_by', successor.id,
      'successor_visibility', CASE WHEN o.superseded_by IS NULL THEN 'none_recorded'
        WHEN successor.id IS NULL THEN 'unavailable' ELSE 'same_vehicle_record' END,
      'claim', (SELECT coalesce(jsonb_object_agg(item.key,item.value),'{}'::jsonb)
        FROM jsonb_each(o.structured_data) item
        WHERE item.key IN ('property_key','row_field','value','state','citation') AND jsonb_typeof(item.value)='string'),
      'evidence_edges', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM edges e)
    ) FROM witness o
    LEFT JOIN public.observation_sources src ON src.id=o.source_id
    LEFT JOIN public.vehicle_observations successor ON successor.id=o.superseded_by AND successor.vehicle_id=o.vehicle_id
    WHERE EXISTS (SELECT 1 FROM edges)
  );
END;
$fn$;
COMMENT ON FUNCTION public.harness_evidence_witness(uuid,uuid) IS
  'Owner-only exact wiring witness reached through valid same-vehicle harness_evidence. Invoker RLS; nonanonymous authenticated caller; historical testimony remains historical. No artifact signing or construction approval.';
REVOKE ALL ON FUNCTION public.harness_evidence_witness(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.harness_evidence_witness(uuid,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
