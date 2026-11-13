-- A finite, source-scoped identity replay and ongoing arrivals in existing owners.
-- Preserve the generic record replay, its receipts and all existing job limits.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $seed_patch$
DECLARE f text;before text;after text;
BEGIN
 f:=pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure);
 IF position('mccormick_identity_replay_v1' IN f)=0 THEN
  IF md5(f)<>'8a9e56d93a580b3e51caf1cbacbe8d0a' THEN RAISE EXCEPTION 'Retained replay owner changed';END IF;
  before:='vehicles_finished integer:=0;';
  after:=before||E'\nmc jsonb;mc_sources uuid[];mc_cutoff timestamptz;mc_upper uuid;mc_room integer;mc_limit integer;mc_seeded integer;';
  IF (length(f)-length(replace(f,before,'')))/length(before)<>1 THEN RAISE EXCEPTION 'Replay declaration anchor changed';END IF;
  f:=replace(f,before,after);
  before:='IF NOT FOUND THEN RETURN 0;END IF;';
  after:=before||$phase$
 -- mccormick_identity_replay_v1: one finite chosen-source pass interleaved with the
 -- preserved generic pass. Four identity keys is this admitted profile's ceiling.
 IF jsonb_typeof(coalesce(s.record_replay->'source_replays','{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Source replay map changed';END IF;
 mc:=s.record_replay#>'{source_replays,mccormicks_identity_v1}';
 IF mc IS NOT NULL AND (mc->>'method' IS DISTINCT FROM 'mccormick_identity_replay_v1'
  OR mc->>'source_id' IS DISTINCT FROM '006f01c3-e5fb-44f5-ab40-e55b0654de1c'
  OR mc->>'max_work_per_source' IS DISTINCT FROM '4'
  OR (mc ? 'yield_to_generic' AND jsonb_typeof(mc->'yield_to_generic')<>'boolean')) THEN
  RAISE EXCEPTION 'McCormick replay checkpoint changed';END IF;
 IF mc IS NOT NULL AND mc->>'completed_at' IS NULL AND mc->'yield_to_generic'='true'::jsonb THEN
  mc:=mc||jsonb_build_object('yield_to_generic',false);
  s.record_replay:=s.record_replay||jsonb_build_object('source_replays',
   (s.record_replay->'source_replays')||jsonb_build_object('mccormicks_identity_v1',mc));
  UPDATE public.retained_listing_property_replay SET record_replay=s.record_replay WHERE id;
  -- Continue through the unchanged generic pass on alternate eligible calls.
 ELSIF mc IS NULL OR mc->>'completed_at' IS NULL THEN
  SELECT 500-count(*) INTO mc_room FROM public.retained_listing_property_work WHERE status IN('pending','claimed');
  IF mc_room<4 THEN RETURN 0;END IF;
  mc_limit:=least(25,mc_room/4);
  IF mc IS NULL THEN
   mc_cutoff:=statement_timestamp();
   SELECT o.id INTO mc_upper FROM public.vehicle_observations o
    WHERE o.source_id='006f01c3-e5fb-44f5-ab40-e55b0654de1c'
     AND o.kind='listing' AND o.property_id IS NULL AND o.ingested_at<=mc_cutoff
    ORDER BY o.id DESC LIMIT 1;
   mc:=jsonb_build_object('method','mccormick_identity_replay_v1',
    'source_id','006f01c3-e5fb-44f5-ab40-e55b0654de1c','started_at',clock_timestamp(),
    'source_ingested_before',mc_cutoff,'upper_source_id',mc_upper,'after_source_id','00000000-0000-0000-0000-000000000000',
    'source_keys_seen',0,'work_seeded',0,'completed_at',NULL,
    'scope','retained_listing_observations; current eligibility is rechecked at enqueue, admission and read',
    'keys',jsonb_build_array('year','make','model','vin'),'max_work_per_source',4);
  END IF;
  IF mc->>'method' IS DISTINCT FROM 'mccormick_identity_replay_v1'
   OR mc->>'source_id' IS DISTINCT FROM '006f01c3-e5fb-44f5-ab40-e55b0654de1c'
   OR mc->>'max_work_per_source' IS DISTINCT FROM '4' THEN RAISE EXCEPTION 'McCormick replay checkpoint changed';END IF;
  mc_cutoff:=(mc->>'source_ingested_before')::timestamptz;
  mc_upper:=(mc->>'upper_source_id')::uuid;
  IF NOT isfinite(mc_cutoff) OR mc_cutoff>statement_timestamp() THEN RAISE EXCEPTION 'Invalid McCormick replay clock';END IF;
  SELECT array_agg(x.id ORDER BY x.id) INTO mc_sources FROM(
   SELECT o.id FROM public.vehicle_observations o
   WHERE o.source_id='006f01c3-e5fb-44f5-ab40-e55b0654de1c' AND o.kind='listing' AND o.property_id IS NULL
    AND o.ingested_at<=mc_cutoff AND o.id>(mc->>'after_source_id')::uuid AND o.id<=mc_upper
   ORDER BY o.id LIMIT mc_limit)x;
  mc_seeded:=public.enqueue_retained_listing_properties(mc_sources);
  IF mc_seeded IS NULL OR mc_seeded<0 OR mc_seeded>4*coalesce(cardinality(mc_sources),0) THEN RAISE EXCEPTION 'McCormick admitted profile exceeded four identity keys';END IF;
  mc:=mc||jsonb_build_object('after_source_id',coalesce(mc_sources[cardinality(mc_sources)]::text,mc->>'after_source_id'),
   'source_keys_seen',(mc->>'source_keys_seen')::bigint+coalesce(cardinality(mc_sources),0),
   'work_seeded',(mc->>'work_seeded')::bigint+mc_seeded,'last_seed_at',clock_timestamp(),
   'pending_capacity_at_dispatch',mc_room,'last_source_limit',mc_limit,'yield_to_generic',true,
   'completed_at',CASE WHEN coalesce(cardinality(mc_sources),0)<mc_limit OR mc_sources[cardinality(mc_sources)]=mc_upper THEN clock_timestamp() END);
  UPDATE public.retained_listing_property_replay SET record_replay=coalesce(record_replay,'{}'::jsonb)||
   jsonb_build_object('source_replays',coalesce(record_replay->'source_replays','{}'::jsonb)||
    jsonb_build_object('mccormicks_identity_v1',mc)) WHERE id;
  RETURN coalesce(cardinality(mc_sources),0);
 END IF;
$phase$;
  IF (length(f)-length(replace(f,before,'')))/length(before)<>1 THEN RAISE EXCEPTION 'Replay entry anchor changed';END IF;
  EXECUTE replace(f,before,after);
 END IF;
END $seed_patch$;
DO $arrival_patch$
DECLARE t text;predicate text;
BEGIN
 SELECT pg_get_triggerdef(oid) INTO t FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='retained_listing_property_intake';
 IF position('mccormick_html_v1' IN t)=0 THEN
  IF md5(t)<>'d3cc56aedcbb6f295d7f63ada15367ed' THEN RAISE EXCEPTION 'Retained arrival owner changed';END IF;
  predicate:=substring(t FROM position(' WHEN ' IN t)+6 FOR position(' EXECUTE FUNCTION ' IN t)-position(' WHEN ' IN t)-6);
  IF predicate IS NULL OR left(predicate,1)<>'(' THEN RAISE EXCEPTION 'Arrival predicate missing';END IF;
  EXECUTE 'CREATE OR REPLACE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW WHEN ('||
   predicate||' OR (new.kind=''listing''::public.observation_kind AND new.source_id=''006f01c3-e5fb-44f5-ab40-e55b0654de1c''::uuid AND new.extraction_method=''mccormick_html_v1'')) EXECUTE FUNCTION public.trg_enqueue_retained_listing_properties()';
 END IF;
END $arrival_patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
