-- The lane's scoreboard for work records: one reader that says, for a vehicle, which current
-- visual_work_v1 records the writer gate would refuse if they were written today, and why.
-- It calls the same four functions the insert trigger calls, so the report and the gate cannot
-- disagree. "Is this vehicle's work log done" becomes this query instead of an agent's opinion.
-- Read on the proof vehicle 2026-11-12 10:14 UTC with those functions by hand: 31 current
-- records; 18 fail system keys, 26 part keys, 23 citations, 26 numbers; 2 pass all four.
-- Read-only: no row, grant on a table, trigger or stored result is added or changed.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

DO $guard$ BEGIN
 IF to_regprocedure('public.visual_work_gate_report(uuid)') IS NOT NULL
  OR to_regprocedure('public.visual_work_unplaced_system_keys(jsonb)') IS NULL
  OR to_regprocedure('public.visual_work_unplaced_part_keys(jsonb)') IS NULL
  OR to_regprocedure('public.visual_work_uncited_keyed_photos(uuid,jsonb)') IS NULL
  OR to_regprocedure('public.visual_work_unsourced_numbers(jsonb)') IS NULL THEN
  RAISE EXCEPTION 'visual work gate owner drifted; inspect current definitions';
 END IF;
END $guard$;

CREATE FUNCTION public.visual_work_gate_report(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 WITH recs AS (
  SELECT o.id,o.ingested_at,o.structured_data AS sd
  FROM public.vehicle_observations o
  WHERE o.vehicle_id=p_vehicle_id AND o.kind='work_record' AND o.is_superseded IS FALSE
   AND (o.extraction_method='visual_work_v1' OR o.structured_data->>'contract'='visual_work_v1')),
 chk AS (
  SELECT r.id,r.ingested_at,r.sd,
   public.visual_work_unplaced_system_keys(r.sd) AS system_keys,
   public.visual_work_unplaced_part_keys(r.sd) AS part_keys,
   public.visual_work_uncited_keyed_photos(p_vehicle_id,r.sd) AS uncited_photos,
   public.visual_work_unsourced_numbers(r.sd) AS unsourced_numbers
  FROM recs r),
 scored AS (
  SELECT c.*,cardinality(c.system_keys)=0 AND cardinality(c.part_keys)=0
    AND cardinality(c.uncited_photos)=0 AND cardinality(c.unsourced_numbers)=0 AS passes
  FROM chk c)
 SELECT jsonb_build_object(
  'as_of',statement_timestamp(),'vehicle_id',p_vehicle_id,
  'logic_version','visual_work_gate_report/20261116040000',
  'records',count(*),'passing',count(*) FILTER (WHERE passes),'failing',count(*) FILTER (WHERE NOT passes),
  'failing_by_check',jsonb_build_object(
    'unregistered_system_key',count(*) FILTER (WHERE cardinality(system_keys)>0),
    'unregistered_part_key',count(*) FILTER (WHERE cardinality(part_keys)>0),
    'uncited_keyed_claim',count(*) FILTER (WHERE cardinality(uncited_photos)>0),
    'unsourced_number',count(*) FILTER (WHERE cardinality(unsourced_numbers)>0)),
  -- A draft the record declares is admitted by the gate; it is still a wait, so it is counted.
  'declared_drafts',coalesce(sum(CASE WHEN jsonb_typeof(sd->'key_proposals')='array'
     THEN jsonb_array_length(sd->'key_proposals') ELSE 0 END),0),
  'newest_record_at',max(ingested_at),
  'failing_records',coalesce(jsonb_agg(jsonb_build_object(
     'observation_id',id,'title',left(sd->>'title',120),'written_at',ingested_at,
     'unregistered_system_key',to_jsonb(system_keys),'unregistered_part_key',to_jsonb(part_keys),
     'uncited_keyed_claim',to_jsonb(uncited_photos),'unsourced_number',to_jsonb(unsourced_numbers))
     ORDER BY sd->>'title',id) FILTER (WHERE NOT passes),'[]'::jsonb))
 FROM scored;
$fn$;
REVOKE ALL ON FUNCTION public.visual_work_gate_report(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visual_work_gate_report(uuid) TO service_role;
COMMENT ON FUNCTION public.visual_work_gate_report(uuid) IS
'Scoreboard for one vehicle''s current visual_work_v1 records: how many the writer gate (guard_visual_work_keys) would admit if written today, how many it would refuse per check, the drafts declared in key_proposals, and for each failing record the exact keys, photos and numbers at fault. Calls the same four functions as the trigger. Service role only: titles are not passed through the public text filter.';
COMMIT;
