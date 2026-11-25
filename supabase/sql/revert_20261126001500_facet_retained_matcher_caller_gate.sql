-- Revert of 20261126001500_facet_retained_matcher_caller_gate: puts the bare matcher call back in vehicle_facet_items
-- (the anchor the migration replaced), leaving every other line of the live body as it is.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $revert$
DECLARE
  d text;
  anchor constant text := $a$
         OR public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id))$a$;
  gated constant text := $g$
         OR (EXISTS (SELECT 1 FROM public.vehicle_observations gp JOIN public.observation_sources gs ON gs.id = gp.source_id
                     WHERE gp.id = o.source_observation_id) -- retained_matcher_caller_gate_v1
             AND public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id)))$g$;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('retained_matcher_caller_gate_v1' IN d) = 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, gated, ''))) / length(gated) <> 1 THEN
    RAISE EXCEPTION 'vehicle_facet_items: the gated matcher call is not found exactly once; revert by hand from the migration';
  END IF;
  EXECUTE replace(d, gated, anchor);
END
$revert$;
