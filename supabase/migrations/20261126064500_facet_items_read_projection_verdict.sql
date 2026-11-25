-- retained_projection_verdict_v1 in vehicle_facet_items: a retained listing projection is admitted by its stored
-- verdict when one counts (retained_projection_verdicts_for, 20261126063500), else by the gated live matcher as today.
--
-- WHY. Since 20261126001500 the matcher runs only for a caller who can read the projection's source and its registry
-- row, so anon never admits a retained-listing witness (08eae37e: 8 items lack witnesses anon would otherwise see). The
-- stored verdict is the matcher's answer as the owner, kept only while every input it read is unchanged, and it does
-- not depend on the caller: it is the same answer for anon, a stranger and the owner.
--
-- WHAT. Two anchored edits on the body 20261126001500 leaves (prosrc sha256 XhslPUT5..., computed 2026-11-25 from the
-- live body RPIxtoEH... with that migration's replacement):
--   1. a CTE rpv, before t: (projection_id, admitted) for this car's projection rows in obs_w, one call;
--   2. the projection filter: coalesce(the counted verdict, the gated matcher). A missing or stale verdict is NULL, so
--      the row is decided exactly as before; the gate stays as the fallback's guard (removing it would send every
--      ungraded row back to the 15 s anon matcher while the backfill runs).
-- GUARD. Refuses unless the live body has that hash (or already carries the marker), and each anchor occurs once.
-- Contract runs set nuke.facet_verdict_contract = 'on' to apply on a fixture reader.
-- REVERT. supabase/sql/revert_20261126064500_facet_items_read_projection_verdict.sql
-- TEST. supabase/sql/test_facet_items_read_projection_verdict.sql
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure);
  h text;
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
  def text;
BEGIN
  IF position('retained_projection_verdict_v1' IN d) > 0 THEN RETURN; END IF;
  IF to_regprocedure('public.retained_projection_verdicts_for(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'retained_projection_verdicts_for is not deployed (20261126063500 first)';
  END IF;
  h := encode(sha256(convert_to(d, 'UTF8')), 'base64');
  IF h <> 'XhslPUT5+18DbUYoX3EGlss8OoGbsU0WERs0U+et83I=' AND coalesce(current_setting('nuke.facet_verdict_contract', true), '') <> 'on' THEN
    RAISE EXCEPTION 'vehicle_facet_items body is not the one 20261126001500 leaves (sha256 %); re-read before patching', h;
  END IF;
  IF (length(d) - length(replace(d, cte_anchor, ''))) / length(cte_anchor) <> 1
     OR (length(d) - length(replace(d, gate_anchor, ''))) / length(gate_anchor) <> 1 THEN
    RAISE EXCEPTION 'vehicle_facet_items anchors not found exactly once';
  END IF;
  def := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  def := replace(replace(def, cte_anchor, cte_new), gate_anchor, gate_new);
  EXECUTE def;
END
$patch$;
