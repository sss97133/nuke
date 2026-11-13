-- The scoreboard for photo readings on one vehicle: rule 7's measure, as an overload of the
-- existing coverage reader. image_stage_coverage() counts flow (queued, claimed, receipts) for
-- the library. The photo direction says the measure is what the model gained: witnessed
-- observations that are keyed, connected and proven, with repeats folded. Until now that was a
-- hand-written query each time (scripts/photo-pipeline/keys-dry-run/fold.sql, one method).
--   witnessed  current observations of the vehicle with an observation_witnesses row
--   keyed      of those, property_id or descriptor_id set
--   folded     keyed rows grouped by key, part, side, value and the photo's capture day
--              (vehicle_images.taken_at of the witnessed photo; a row with no capture time
--              folds with nothing and is counted)
--   connected  keyed rows that share a fold with another row, or that a current work record
--              cites in visual_sources[].keyed_claim_ids
--   proven     zero by construction: no store records reader agreement, a receipt's support
--              or the owner's decision on a claim. Reported as zero, not left out.
-- Why per vehicle and not the library: measured on production 2026-11-12. The library form (every
-- witness row joined to its observation) was cancelled twice by the 10 s statement timeout:
-- observation_witnesses holds 39,952 rows and each one is a separate read in a 12 GB table. The
-- vehicle form reads by vehicle_id and returned inside the limit on the proof vehicle (its
-- counts are in the case ledger, C17, with their read time). A library total needs a stored
-- fold; it is not built here and the no-argument reader is left exactly as it was.
-- Read-only. No new table, trigger or reader of photos; the name is the existing one.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

DO $guard$ BEGIN
 IF to_regprocedure('public.image_stage_coverage()') IS NULL
  OR to_regprocedure('public.image_stage_coverage(uuid)') IS NOT NULL
  OR to_regclass('public.observation_witnesses') IS NULL OR to_regclass('public.schema_proposals') IS NULL THEN
  RAISE EXCEPTION 'coverage reader owner drifted; inspect current definitions';
 END IF;
END $guard$;

CREATE FUNCTION public.image_stage_coverage(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 WITH wo AS MATERIALIZED (
  SELECT o.id,o.descriptor_id,o.property_id,o.extraction_method,
   -- The fold's day is the photo's capture day, read from the witnessed photo. An observation's own
   -- observed_at mixes capture, review and recording clocks (a projected property carries the time
   -- its source reading was recorded), so it is never used as the capture day. Unknown stays unknown.
   (SELECT (min(i.taken_at) AT TIME ZONE 'UTC')::date FROM public.observation_witnesses w
     JOIN public.vehicle_images i ON i.id=w.image_id
     WHERE w.observation_id=o.id AND i.taken_at IS NOT NULL AND isfinite(i.taken_at)) AS capture_day,
   CASE WHEN o.descriptor_id IS NOT NULL OR o.property_id IS NOT NULL THEN o.structured_data->>'part_key' END AS part_key,
   CASE WHEN o.descriptor_id IS NOT NULL OR o.property_id IS NOT NULL THEN o.structured_data->>'part_side' END AS part_side,
   CASE WHEN o.property_id IS NOT NULL THEN o.structured_data->>p.property_key END AS val
  FROM public.vehicle_observations o
  LEFT JOIN public.observation_properties p ON p.id=o.property_id
  WHERE o.vehicle_id=p_vehicle_id AND o.is_superseded IS NOT TRUE
   AND EXISTS(SELECT 1 FROM public.observation_witnesses w WHERE w.observation_id=o.id)),
 keyed AS MATERIALIZED (SELECT * FROM wo WHERE descriptor_id IS NOT NULL OR property_id IS NOT NULL),
 folds AS (
  -- A keyed row whose photo has no capture time folds with nothing: it is its own claim.
  SELECT coalesce(descriptor_id,property_id) AS key_id,part_key,part_side,val,capture_day,count(*) AS n,array_agg(id) AS ids
  FROM keyed WHERE capture_day IS NOT NULL GROUP BY 1,2,3,4,5
  UNION ALL
  SELECT coalesce(descriptor_id,property_id),part_key,part_side,val,NULL::date,1,ARRAY[id]
  FROM keyed WHERE capture_day IS NULL),
 in_fold AS (SELECT unnest(ids) AS id FROM folds WHERE n>=2),
 cited AS (
  SELECT DISTINCT c.value#>>'{}' AS id
  FROM public.vehicle_observations r
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.structured_data->'visual_sources')='array'
     THEN r.structured_data->'visual_sources' ELSE '[]'::jsonb END) v
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.value->'keyed_claim_ids')='array'
     THEN v.value->'keyed_claim_ids' ELSE '[]'::jsonb END) c
  WHERE r.vehicle_id=p_vehicle_id AND r.kind='work_record' AND r.is_superseded IS FALSE
   AND r.structured_data->>'contract'='visual_work_v1'),
 connected AS (
  SELECT k.id,k.id::text IN (SELECT id FROM cited) AS is_cited FROM keyed k
  WHERE k.id IN (SELECT id FROM in_fold) OR k.id::text IN (SELECT id FROM cited))
 SELECT jsonb_build_object(
  'checked_at',statement_timestamp(),'vehicle_id',p_vehicle_id,
  'logic_version','image_stage_coverage(vehicle)/20261116042000',
  'model_gain',jsonb_build_object(
   'measure','photo direction rule 7: keyed, connected, proven, repeats folded',
   'photos',(SELECT count(*) FROM public.vehicle_images i WHERE i.vehicle_id=p_vehicle_id),
   'photos_witnessed',(SELECT count(DISTINCT w.image_id) FROM public.observation_witnesses w JOIN wo ON wo.id=w.observation_id),
   'witnessed_observations',(SELECT count(*) FROM wo),
   'keyed',(SELECT count(*) FROM keyed),
   'unkeyed',(SELECT count(*) FROM wo)-(SELECT count(*) FROM keyed),
   'keyed_with_unknown_capture_day',(SELECT count(*) FROM keyed WHERE capture_day IS NULL),
   'folded_claims',(SELECT count(*) FROM folds),
   'claims_carried_by_2plus_rows',(SELECT count(*) FROM folds WHERE n>=2),
   'connected_rows',(SELECT count(*) FROM connected),
   'cited_by_a_work_record',(SELECT count(*) FROM connected WHERE is_cited),
   'proven',0,
   'proven_basis','no store records reader agreement, receipt support or an owner decision on a claim',
   'unkeyed_by_method',coalesce((SELECT jsonb_object_agg(m,n) FROM (
      SELECT coalesce(extraction_method,'(none)') AS m,count(*) AS n FROM wo
      WHERE descriptor_id IS NULL AND property_id IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x),'{}'::jsonb),
   'open_proposals_citing_a_witnessed_reading',(SELECT count(*) FROM public.schema_proposals sp
      WHERE sp.status IN ('open','under_review','needs_changes')
       AND EXISTS(SELECT 1 FROM wo WHERE wo.id=ANY(sp.motivating_observation_ids)))));
$fn$;
REVOKE ALL ON FUNCTION public.image_stage_coverage(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.image_stage_coverage(uuid) TO service_role;
COMMENT ON FUNCTION public.image_stage_coverage(uuid) IS
'One vehicle''s photo readings by the photo direction''s measure: photos, witnessed observations, keyed, folded claims, connected rows (sharing a fold or cited by a current work record), proven (zero by construction), the unkeyed rows by method and the open schema proposals that cite a witnessed reading. The library form is not computed: it exceeds the statement timeout. Service role only.';
COMMIT;
