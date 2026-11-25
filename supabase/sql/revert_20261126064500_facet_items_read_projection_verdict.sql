-- Revert of 20261126064500_facet_items_read_projection_verdict: vehicle_facet_items back to the body 20261126001500
-- leaves (the gated live matcher only), byte for byte. Idempotent.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $revert$
DECLARE
  d text := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  cte_anchor constant text := $a$),

-- Every testimony row: item key, raw value, comparison kind, class, source key (one per independent source),
-- reader family (independence of readers), clock and the source as returned.
t AS ($a$;
  cte_new constant text := $a$),

-- retained_projection_verdict_v1: this car's stored retained-listing verdicts that still count (one call)
rpv AS MATERIALIZED (
  SELECT r.projection_id, r.admitted
    FROM public.retained_projection_verdicts_for(ARRAY(SELECT ow.id FROM obs_w ow
                                                         WHERE ow.method = 'retained_listing_property_projection_v1')) r
),

-- Every testimony row: item key, raw value, comparison kind, class, source key (one per independent source),
-- reader family (independence of readers), clock and the source as returned.
t AS ($a$;
  gate_anchor constant text := $a$         OR (EXISTS (SELECT 1 FROM public.vehicle_observations gp JOIN public.observation_sources gs ON gs.id = gp.source_id
                     WHERE gp.id = o.source_observation_id) -- retained_matcher_caller_gate_v1
             AND public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id)))$a$;
  gate_new constant text := $a$         OR coalesce((SELECT rpv.admitted FROM rpv WHERE rpv.projection_id = o.id), -- retained_projection_verdict_v1
                     (EXISTS (SELECT 1 FROM public.vehicle_observations gp JOIN public.observation_sources gs ON gs.id = gp.source_id
                              WHERE gp.id = o.source_observation_id) -- retained_matcher_caller_gate_v1
                      AND public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id))))$a$;
BEGIN
  IF position('retained_projection_verdict_v1' IN d) = 0 THEN RETURN; END IF;
  IF position(cte_new IN d) = 0 OR position(gate_new IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_facet_items carries the marker but not the edits 20261126064500 made; re-read before reverting';
  END IF;
  EXECUTE replace(replace(d, gate_new, gate_anchor), cte_new, cte_anchor);
END
$revert$;
