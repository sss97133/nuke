-- Revert of 20261120130000_photo_deep_reading_keyed_values_stages.sql: every replaced function goes back to the body
-- production held on 2026-11-20 (read with pg_get_functiondef before the change), and what was added is removed.
-- The two reading stages' work items are deleted (a queue, rebuilt by the reconciler). Their receipts are the ledger's
-- append-only history: if any exist, the two registry rows stay as inert rows (required = false) together with the
-- widened applies_when check and the backfill_daily_cap column, and a NOTICE says so; with none, the rows, the check and
-- the column go too. The scope row platform_config 'image_stage_deep_reading' is removed.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '25s';
select pg_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0));
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.image_stage_legacy_version(p_stage text, p_meta jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_stage
    when 'classifier' then
      case when coalesce(p_meta #>> '{photo_pipeline,receipt,outcome}', '') = 'policy_skip'
                or jsonb_typeof(p_meta -> 'skipped') = 'string'
             then 'orchestrator-policy-skip'
           when coalesce(p_meta #>> '{classification,classifier_ok}', '') = 'false'
             then null
           when coalesce(p_meta #>> '{photo_pipeline,receipt,outcome}', '') = 'completed'
                or coalesce(p_meta #>> '{classification,classifier_ok}', '') = 'true'
             then 'orchestrator-receipt'
           when jsonb_typeof(p_meta -> 'classification') = 'object'
                and jsonb_typeof(p_meta #> '{classification,image_type}') = 'string'
                and btrim(p_meta #>> '{classification,image_type}') <> ''
                and jsonb_typeof(p_meta #> '{classification,confidence}') = 'number'
                and jsonb_typeof(p_meta -> 'pipeline_version') = 'string'
                and btrim(p_meta ->> 'pipeline_version') <> ''
             then 'legacy-' || btrim(p_meta ->> 'pipeline_version')
           else null end
    else null end
$function$;

CREATE OR REPLACE FUNCTION public.image_stage_legacy_evidence(p_stage text, p_meta jsonb, p_exif jsonb, p_contract text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(case p_stage
    when 'classifier' then
      public.image_stage_legacy_version('classifier', p_meta) = 'orchestrator-policy-skip'
      or case when p_contract is null then public.image_stage_legacy_version('classifier', p_meta) is not null
              else coalesce(p_meta #>> '{classification,v2,prompt_version}', '') = p_contract
                   and coalesce(p_meta #>> '{classification,classifier_ok}', 'true') <> 'false'
                   and jsonb_typeof(p_meta #> '{classification,image_type}') = 'string' end
    when 'exif' then p_exif is not null and p_exif <> '{}'::jsonb
    else false end, false)
$function$;

CREATE OR REPLACE FUNCTION public.image_stage_gaps(p_image_ids uuid[])
 RETURNS TABLE(image_id uuid, stage text, reason text, target_version integer, not_before timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select v.id, s.stage,
         case when c.image_id is null and public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key) then 'retryable_outcome'
              when c.image_id is null and public.image_stage_legacy_version(s.stage, v.ai_scan_metadata) is not null then 'outdated'
              when c.image_id is null then 'missing'
              when c.producer_version < s.required_version then 'outdated'
              else 'retryable_outcome' end,
         s.required_version,
         greatest(now(), coalesce(c.retry_after, now()))
  from public.vehicle_images v
  join public.image_pipeline_stages s on s.required
  left join public.image_stage_current c on c.image_id = v.id and c.stage = s.stage
  where v.id = any (p_image_ids)
    and (s.applies_when = 'always'
         or (s.applies_when = 'document_like' and coalesce(v.ai_scan_metadata #>> '{classification,image_type}', '') in ('receipt', 'document', 'invoice', 'text_document')))
    and (
      (c.image_id is null and (not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data, s.contract)
                               or public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key)))
      or (c.producer_version < s.required_version and not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data, s.contract))
      or (c.producer_version >= s.required_version and c.outcome in ('unavailable', 'rate_limited')
          and c.retry_after <= now()
          and (c.attempt < s.max_attempts or c.observed_at < now() - interval '1 day'))
      or (c.producer_version >= s.required_version and c.outcome = 'blocked_input'
          and c.input_fingerprint is not null and c.input_fingerprint <> md5(coalesce(v.image_url, '')))
    )
$function$;

CREATE OR REPLACE FUNCTION public.photo_land_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- A deep-result-only update changes camera testimony, not the classifier.
  -- Keep classifier/filing transitions on the original full landing path.
  PERFORM public.photo_land_classification(NEW.id,
    OLD.ai_processing_status IS DISTINCT FROM 'completed'
    OR OLD.ai_scan_metadata->'classification' IS DISTINCT FROM NEW.ai_scan_metadata->'classification'
    OR OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id
    OR OLD.vision_gate_status IS DISTINCT FROM NEW.vision_gate_status);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'photo_land_trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_image_stage_receipt(p_image_id uuid, p_stage text, p_producer_version integer, p_outcome text, p_error_class text DEFAULT NULL::text, p_http_status integer DEFAULT NULL::integer, p_retry_after_seconds integer DEFAULT NULL::integer, p_input_fingerprint text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_producer text; v_attempt int; v_id bigint;
begin
  select producer into v_producer from public.image_pipeline_stages where stage = p_stage;
  if v_producer is null then raise exception 'unknown stage %', p_stage; end if;
  -- serialize attempts for one (image, stage, version) so concurrent producers get distinct attempt numbers
  perform pg_advisory_xact_lock(hashtextextended(p_image_id::text || ':' || p_stage || ':' || p_producer_version, 0));
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.image_stage_receipts
   where image_id = p_image_id and stage = p_stage and producer_version = p_producer_version;
  insert into public.image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, retry_after, error_class, http_status, input_fingerprint, detail)
  values (p_image_id, p_stage, v_producer, p_producer_version, p_outcome, v_attempt,
          case when p_outcome in ('unavailable', 'rate_limited') then now() + make_interval(secs => least(greatest(coalesce(p_retry_after_seconds, 300), 0), 86400)) end,
          p_error_class, p_http_status, p_input_fingerprint, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  -- close the open work item for this stage, if any
  update public.image_stage_work set status = 'done', finished_at = now(), lease_until = null
   where image_id = p_image_id and stage = p_stage and status in ('queued', 'claimed');
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.reconcile_image_stages(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cfg jsonb; v_open int; v_budget int; v_live_budget int; v_back_budget int; v_users uuid[];
  v_lane text; v_lane_budget int; v_scan int; v_cand uuid[]; v_ids uuid[]; v_last record; v_enq int;
  v_ready int; v_mark int; v_max int; v_gaps int; v_taken_id uuid; v_taken_at timestamptz;
  v_out jsonb := '{}'::jsonb; v_carry int := 0; v_total int := 0;
begin
  -- one reconciler at a time; a second caller is a no-op rather than a queue of waiters
  if not pg_try_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0)) then return jsonb_build_object('skipped', 'already_running'); end if;
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then return jsonb_build_object('skipped', 'disabled'); end if;
  -- users who have a reader; absent or not an array = every user
  if jsonb_typeof(v_cfg -> 'user_ids') = 'array' then
    select coalesce(array_agg(x::uuid), '{}') into v_users from jsonb_array_elements_text(v_cfg -> 'user_ids') x;
  end if;

  v_max := coalesce((v_cfg ->> 'max_open')::int, 300);
  -- refill mark: a JSON number of 1 or more; anything else (absent, 0, negative, text) means "refill whenever there is room"
  v_mark := case when jsonb_typeof(v_cfg -> 'refill_below') = 'number' and (v_cfg ->> 'refill_below')::numeric >= 1
                      and (v_cfg ->> 'refill_below')::numeric < 2147483647 then floor((v_cfg ->> 'refill_below')::numeric)::int end;
  -- open = everything queued or claimed (the cap); ready = what a reader could claim now (the refill mark)
  select count(*), count(*) filter (where status = 'queued' and not_before <= now()) into v_open, v_ready
    from public.image_stage_work where status in ('queued', 'claimed');
  v_budget := least(greatest(p_limit, 0), greatest(v_max - v_open, 0), 500);
  if v_budget = 0 then
    -- a tick at a real cap still ran: the watch on last_run_at must not read a full queue as a stopped reconciler
    if p_limit > 0 and v_max > 0 then update public.image_stage_reconciler_state set last_run_at = now(); end if;
    return jsonb_build_object('skipped', 'queue_full', 'open', v_open);
  end if;
  -- fair split: new uploads always get their share; whatever live does not use rolls to the backfill
  v_back_budget := floor(v_budget * least(greatest(coalesce((v_cfg ->> 'backfill_share')::numeric, 0.5), 0), 1));
  v_live_budget := v_budget - v_back_budget;
  v_scan := least(greatest(coalesce((v_cfg ->> 'scan_per_lane')::int, 1000), 1), 5000);

  foreach v_lane in array array['live', 'backfill'] loop
    v_lane_budget := case v_lane when 'live' then v_live_budget else v_back_budget + v_carry end;
    -- The backfill refills in batches: while a reader still has refill_below items it could claim, the scan (which reads
    -- each candidate's ai_scan_metadata) is skipped. The live lane above runs on every tick, so a new upload never
    -- waits for the backlog to drain.
    if v_lane = 'backfill' and v_mark is not null and v_ready >= v_mark then
      update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = 0, last_enqueued = 0 where lane = 'backfill';
      v_out := v_out || jsonb_build_object('backfill', jsonb_build_object('skipped', 'queue_ok', 'ready', v_ready, 'refill_below', v_mark));
      continue;
    end if;
    -- Two steps, read from production's plan on 2026-11-10: (1) candidate ids by (created_at, id) from the partial index
    -- idx_vehicle_images_capture_ledger (user_id IS NOT NULL, INCLUDE id, created_at: an index-only scan of ~32k entries),
    -- (2) eligibility judged on at most v_scan rows by primary key. The cursor advances over candidates, not over the
    -- eligible subset, so ineligible rows are never rescanned.
    if v_lane = 'live' then
      -- newest uploads past the grace period, inside the live window
      select coalesce(array_agg(x.id), '{}') into v_cand from (
        select c.id from public.vehicle_images c
        where c.user_id is not null and (v_users is null or c.user_id = any (v_users))
          and c.created_at >= now() - make_interval(days => coalesce((v_cfg ->> 'live_days')::int, 2))
          and c.created_at <= now() - make_interval(mins => coalesce((v_cfg ->> 'min_age_minutes')::int, 15))
        order by c.created_at desc, c.id desc limit v_scan) x;
    else
      -- everything past the grace period, oldest first, by cursor; overlaps the live window on purpose so a bulk upload
      -- larger than the live scan is still reached within one pass (the one-open-item index prevents double queuing)
      select coalesce(array_agg(x.id), '{}') into v_cand from (
        select c.id from public.vehicle_images c, public.image_stage_reconciler_state st
        where st.lane = 'backfill'
          and c.user_id is not null and (v_users is null or c.user_id = any (v_users))
          and (st.cursor_created_at is null or (c.created_at, c.id) > (st.cursor_created_at, st.cursor_id))
          and c.created_at <= now() - make_interval(mins => coalesce((v_cfg ->> 'min_age_minutes')::int, 15))
        order by c.created_at asc, c.id asc limit v_scan) x;
    end if;
    select coalesce(array_agg(v.id), '{}') into v_ids
      from public.vehicle_images v
     where v.id = any (v_cand)
       and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
       and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes');

    -- every gap among the scanned rows, in the lane's order (live: newest first; backfill: oldest first, as the scan
    -- and the cursor order them); the first v_lane_budget are queued
    with gaps as materialized (
      select g.image_id, g.stage, g.target_version, g.reason, g.not_before, v.created_at,
             row_number() over (order by case when v_lane = 'live' then v.created_at end desc nulls last,
                                         case when v_lane = 'live' then null else v.created_at end asc nulls last,
                                         v.id, g.stage) as rn
        from public.image_stage_gaps(v_ids) g join public.vehicle_images v on v.id = g.image_id
       where not exists (select 1 from public.image_stage_work w where w.image_id = g.image_id and w.stage = g.stage and w.status in ('queued', 'claimed'))
    ), ins as (
      insert into public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
      select image_id, stage, target_version, reason, v_lane, not_before from gaps where rn <= v_lane_budget
      on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing
      returning 1
    ), taken as (
      -- the last photo all of whose gaps fit in the budget
      select g2.image_id, g2.created_at from gaps g2 group by g2.image_id, g2.created_at
      having max(g2.rn) <= v_lane_budget order by max(g2.rn) desc limit 1
    ) select (select count(*) from ins), (select count(*) from gaps), (select image_id from taken), (select created_at from taken)
        into v_enq, v_gaps, v_taken_id, v_taken_at;

    -- Advance the backfill cursor.
    --   nothing left to scan, or a short scan with every gap queued: the pass is over, start again from the oldest
    --   more gaps found than queued: stop at the last photo whose gaps were all queued, so the rest are the first thing
    --     the next scan sees instead of waiting for a whole pass (2026-11-10: two runs scanned 200 and queued 100 each)
    --   otherwise: pass everything scanned, so pages of ineligible or already-read rows are never rescanned
    if v_lane = 'backfill' then
      if coalesce(array_length(v_cand, 1), 0) = 0 then
        update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null, wrapped_at = now(), last_run_at = now(), last_scanned = 0, last_enqueued = v_enq where lane = 'backfill';
      elsif v_gaps > greatest(v_lane_budget, 0) then
        if v_taken_id is not null then
          update public.image_stage_reconciler_state set cursor_created_at = v_taken_at, cursor_id = v_taken_id, last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
        else
          -- no room for even the first photo's gaps: the cursor stays where it is
          update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
        end if;
      elsif array_length(v_cand, 1) < v_scan then
        update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null, wrapped_at = now(), last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
      else
        select v.created_at, v.id into v_last from public.vehicle_images v where v.id = any (v_cand) order by v.created_at desc, v.id desc limit 1;
        update public.image_stage_reconciler_state set cursor_created_at = v_last.created_at, cursor_id = v_last.id, last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
      end if;
    else
      update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = coalesce(array_length(v_cand, 1), 0), last_enqueued = v_enq where lane = 'live';
      v_carry := greatest(v_lane_budget - v_enq, 0);
    end if;
    v_out := v_out || jsonb_build_object(v_lane, jsonb_build_object('scanned', coalesce(array_length(v_cand, 1), 0), 'eligible', coalesce(array_length(v_ids, 1), 0), 'enqueued', v_enq, 'budget', v_lane_budget));
    v_total := v_total + v_enq;
  end loop;
  return v_out || jsonb_build_object('enqueued', v_total, 'open_before', v_open, 'users', coalesce(to_jsonb(v_users), 'null'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.image_stage_coverage(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.assay_photo_reading_flow(p_raise boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_queue_wait  constant interval := interval '6 hours';
  c_pending_cap constant integer  := 20000;
  c_reader_dry  constant interval := interval '2 hours';   -- a reader that takes photos and reads none for this long
  c_reader_fresh constant interval := interval '40 minutes';  -- the heartbeat watch's own freshness window
  -- a refusal by the provider (no credit, no quota, no key), as photo_pipeline_note_failure classes it
  c_refusals    constant text[]   := ARRAY['classifier_rate_limited', 'provider_cooldown', 'classifier_usage_budget_exceeded', 'classifier_key_missing'];
  v_cfg jsonb; v_cut timestamptz := '-infinity';
  v_total bigint; v_by_version jsonb; v_last_read timestamptz; v_desc_6h bigint; v_desc_24h bigint; v_by_producer jsonb;
  v_deep_total bigint; v_deep_72h bigint; v_deep_last timestamptz; v_placed_by_producer jsonb;
  v_pending bigint; v_claimable bigint; v_backoff bigint; v_parked bigint; v_waiting bigint; v_oldest_waiting timestamptz;
  v_terminal bigint; v_given_up bigint; v_terminal_by_class jsonb;
  v_provider jsonb; v_last_provider_ok timestamptz; v_calls_24h bigint; v_ok_24h bigint; v_ok_6h bigint;
  v_readers jsonb; v_reader_accepted_6h bigint; v_live_6h boolean; v_reasons text[] := '{}'; v_out jsonb;
  v_dry record; v_scfg jsonb; v_stage jsonb := NULL; v_stage_on boolean := false; v_stage_due bigint := 0; v_stage_oldest_due timestamptz;
  v_stage_claimed bigint := 0; v_stage_receipts_6h bigint := 0; v_stage_ok_6h bigint := 0; v_stage_last_receipt timestamptz; v_stage_last_run timestamptz;
BEGIN
  IF coalesce(auth.role(), 'postgres') NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'assay_photo_reading_flow: service admission required' USING ERRCODE = '42501';
  END IF;

  -- Population: every vehicle_images row with a user_id, from the signed counters (no vehicle_images scan).
  SELECT coalesce(sum(n_all), 0) INTO v_total FROM user_image_counts;

  -- Classifier level. The landing fold writes one classifier_v2 image_descriptions row per image, on its first
  -- reading only, stamped with the prompt version that read it. So these rows count first readings: an image first
  -- read under an older version keeps that stamp when re-read, and a re-read adds no row. Coverage by version is a
  -- diagnostic; the alarm below does not depend on a version.
  SELECT coalesce(jsonb_object_agg(ver, n), '{}'::jsonb) INTO v_by_version
    FROM (SELECT coalesce(source_version, 'unknown') AS ver, count(DISTINCT image_id) AS n
            FROM image_descriptions WHERE description_type = 'classifier_v2' GROUP BY 1) t;
  SELECT max(created_at),
         count(*) FILTER (WHERE created_at > now() - c_queue_wait),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours')
    INTO v_last_read, v_desc_6h, v_desc_24h
    FROM image_descriptions
   WHERE description_type = 'classifier_v2';
  SELECT coalesce(jsonb_object_agg(producer, n), '{}'::jsonb) INTO v_by_producer
    FROM (SELECT coalesce(evidence ->> 'model', 'unknown') AS producer, count(*) AS n
            FROM image_descriptions
           WHERE description_type = 'classifier_v2' AND created_at > now() - interval '72 hours'
           GROUP BY 1) p;

  -- Deep level, reported only: images carrying a deep verdict, and every producer that placed an image_observations
  -- row in 72 h (caller-byok is the reviewed deep reading). A deep reading says nothing about the classifier queue.
  SELECT count(*) INTO v_deep_total FROM user_image_deep_reads;
  SELECT coalesce(jsonb_object_agg(o.observed_by, o.n), '{}'::jsonb),
         coalesce(sum(o.n) FILTER (WHERE o.observed_by = 'caller-byok'), 0),
         max(o.last_at) FILTER (WHERE o.observed_by = 'caller-byok')
    INTO v_placed_by_producer, v_deep_72h, v_deep_last
    FROM (SELECT coalesce(observed_by, 'unknown') AS observed_by, count(*) AS n, max(observed_at) AS last_at
            FROM image_observations
           WHERE observed_at > now() - interval '72 hours'
           GROUP BY 1) o;

  -- Queue: user-owned pending photos (partial index idx_vehicle_images_pending_user), judged as
  -- claim_photo_pipeline_batch judges them, oldest first so a capped sample keeps the longest-waiting rows.
  --   claimable  the next drain tick would take it
  --   backoff    it has a retry row that is not terminal and not yet due
  --   parked     older than the claim's cut while platform_config photo_pipeline_backlog.enabled is false
  --   waiting    claimable or in backoff, and created more than 6 h ago
  SELECT config_value INTO v_cfg FROM platform_config WHERE config_key = 'photo_pipeline_backlog';
  IF v_cfg IS NOT NULL AND coalesce((v_cfg ->> 'enabled')::boolean, true) = false THEN
    v_cut := now() - make_interval(days => coalesce((v_cfg ->> 'recent_days')::int, 14));
  END IF;
  SELECT count(*),
         count(*) FILTER (WHERE q.live AND q.due),
         count(*) FILTER (WHERE q.live AND NOT q.due),
         count(*) FILTER (WHERE q.parked)
    INTO v_pending, v_claimable, v_backoff, v_parked
    FROM (SELECT v.created_at,
                 (v.is_duplicate = false AND v.image_url IS NOT NULL AND v.created_at >= v_cut AND r.terminal IS NOT TRUE
                  AND (r.image_id IS NULL OR r.next_attempt_at IS NOT NULL)) AS live,
                 (r.image_id IS NULL OR r.next_attempt_at <= now()) AS due,
                 (v.is_duplicate = false AND v.image_url IS NOT NULL AND v.created_at < v_cut AND r.terminal IS NOT TRUE) AS parked
            FROM vehicle_images v
            LEFT JOIN photo_pipeline_retry_state r ON r.image_id = v.id
           WHERE v.ai_processing_status = 'pending' AND v.user_id IS NOT NULL
           ORDER BY v.created_at ASC
           LIMIT c_pending_cap) q;
  -- Waiting: judged before the cap, so parked, duplicate or terminal rows at the old end of the queue cannot fill the
  -- sample and hide newer photos that are actionable and have waited.
  SELECT count(*), min(w.created_at)
    INTO v_waiting, v_oldest_waiting
    FROM (SELECT v.created_at
            FROM vehicle_images v
            LEFT JOIN photo_pipeline_retry_state r ON r.image_id = v.id
           WHERE v.ai_processing_status = 'pending' AND v.user_id IS NOT NULL
             AND v.is_duplicate = false AND v.image_url IS NOT NULL
             AND v.created_at >= v_cut AND v.created_at < now() - c_queue_wait
             AND r.terminal IS NOT TRUE AND (r.image_id IS NULL OR r.next_attempt_at IS NOT NULL)
           ORDER BY v.created_at ASC
           LIMIT c_pending_cap) w;

  -- Given up: photos whose retries ran out. A provider refusal is not a fault of the photo, so those need reopening.
  SELECT count(*),
         count(*) FILTER (WHERE last_error_class = ANY (c_refusals)
                                OR (last_http_status IN (401, 402, 403, 429) AND last_error_class LIKE 'classifier%')
                                OR rate_limited_attempts >= 12)
    INTO v_terminal, v_given_up
    FROM photo_pipeline_retry_state WHERE terminal;
  SELECT coalesce(jsonb_object_agg(cls, n), '{}'::jsonb) INTO v_terminal_by_class
    FROM (SELECT coalesce(last_error_class, 'unknown') || coalesce(' ' || last_http_status::text, '') AS cls, count(*) AS n
            FROM photo_pipeline_retry_state WHERE terminal GROUP BY 1) c;

  -- Provider: the breaker row and what the spend log says the paid classifier last did. Both writers put the HTTP
  -- status in task; google_block rows repeat a google row and are not calls.
  SELECT to_jsonb(s) INTO v_provider FROM photo_pipeline_provider_state s WHERE s.provider = 'classifier';
  SELECT max(created_at) FILTER (WHERE task = '200'),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND provider <> 'google_block'),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND task = '200'),
         count(*) FILTER (WHERE created_at > now() - c_queue_wait AND task = '200')
    INTO v_last_provider_ok, v_calls_24h, v_ok_24h, v_ok_6h
    FROM llm_cost_tracking
   WHERE caller = 'photo-pipeline-orchestrator';

  -- Readers: the subscription readers' last heartbeat (record_reader_heartbeat), and what the frame reader accepted
  -- if that heartbeat is inside the window.
  SELECT coalesce(jsonb_object_agg(a.jobname, jsonb_build_object('heartbeat_at', a.assayed_at, 'reading', a.reading)), '{}'::jsonb),
         coalesce(max(CASE WHEN a.jobname = 'subscription-frame-classifier' AND a.assayed_at > now() - c_queue_wait
                            AND jsonb_typeof(a.reading -> 'accepted') = 'number' THEN (a.reading ->> 'accepted')::numeric END), 0)::bigint
    INTO v_readers, v_reader_accepted_6h
    FROM job_assay_readings a
   WHERE a.jobname IN ('subscription-frame-classifier', 'subscription-document-reader');

  -- Stage ledger (migration 20261113110000), when it is deployed: the classifier stage's queue and receipts.
  IF to_regclass('public.image_stage_work') IS NOT NULL AND to_regclass('public.image_stage_receipts') IS NOT NULL THEN
    SELECT config_value INTO v_scfg FROM platform_config WHERE config_key = 'image_stage_reconciler';
    v_stage_on := coalesce((v_scfg ->> 'enabled')::boolean, false);
    SELECT count(*) FILTER (WHERE status = 'queued' AND not_before <= now()),
           min(created_at) FILTER (WHERE status = 'queued' AND not_before <= now()),
           count(*) FILTER (WHERE status = 'claimed')
      INTO v_stage_due, v_stage_oldest_due, v_stage_claimed
      FROM image_stage_work WHERE stage = 'classifier' AND status IN ('queued', 'claimed');
    SELECT count(*) FILTER (WHERE observed_at > now() - c_queue_wait),
           count(*) FILTER (WHERE observed_at > now() - c_queue_wait AND outcome = 'succeeded'),
           max(observed_at)
      INTO v_stage_receipts_6h, v_stage_ok_6h, v_stage_last_receipt
      FROM image_stage_receipts WHERE stage = 'classifier' AND observed_at > now() - interval '7 days';
    SELECT max(last_run_at) INTO v_stage_last_run FROM image_stage_reconciler_state;
    v_stage := jsonb_build_object('enabled', v_stage_on, 'user_ids', v_scfg -> 'user_ids', 'due_now', v_stage_due,
      'oldest_due_queued_at', v_stage_oldest_due, 'claimed', v_stage_claimed, 'receipts_6h', v_stage_receipts_6h,
      'succeeded_6h', v_stage_ok_6h, 'last_receipt_at', v_stage_last_receipt, 'reconciler_last_run_at', v_stage_last_run);
  END IF;

  -- A classifier reading landed in the window if a record of an accepted reading says so: a first reading's
  -- description row, the frame reader reporting accepted frames, or a succeeded stage receipt. A paid call answering
  -- HTTP 200 is not one: the status is logged before the answer is parsed and validated, so 200s with unusable output
  -- would keep a stalled queue looking healthy. It stays in the reading as provider telemetry.
  v_live_6h := v_desc_6h > 0 OR v_reader_accepted_6h > 0 OR v_stage_ok_6h > 0;

  IF v_waiting > 0 AND NOT v_live_6h THEN
    v_reasons := v_reasons || format('%s pending photos have waited over 6 h (oldest since %s; %s claimable now, %s backing off) and no classifier reading landed in 6 h',
                                     v_waiting, to_char(v_oldest_waiting, 'YYYY-MM-DD HH24:MI'), v_claimable, v_backoff);
  END IF;
  IF v_given_up > 0 THEN
    v_reasons := v_reasons || format('%s photos were given up on after the provider refused them (no credit, quota or key); they are not retried until reopened',
                                     v_given_up);
  END IF;
  -- A reader that reports in but reads nothing. reader-heartbeat.mjs carries zero_read_since / zero_read_fires across
  -- fires in which the reader took photos and read none; the heartbeat watch only checks that a row arrived.
  FOR v_dry IN
    SELECT a.jobname, a.reading ->> 'zero_read_since' AS since, a.reading ->> 'zero_read_fires' AS fires,
           coalesce(a.reading -> 'error_classes', '{}'::jsonb) AS classes
      FROM job_assay_readings a
     WHERE a.jobname IN ('subscription-frame-classifier', 'subscription-document-reader')
       AND a.assayed_at > now() - c_reader_fresh
       AND jsonb_typeof(a.reading -> 'frames') = 'number' AND (a.reading ->> 'frames')::numeric > 0
       AND jsonb_typeof(a.reading -> 'read') = 'number' AND (a.reading ->> 'read')::numeric = 0
       AND jsonb_typeof(a.reading -> 'zero_read_fires') = 'number' AND (a.reading ->> 'zero_read_fires')::numeric >= 3
       AND (a.reading ->> 'zero_read_since') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
     ORDER BY a.jobname
  LOOP
    IF v_dry.since::timestamptz < now() - c_reader_dry THEN
      v_reasons := v_reasons || format('%s has taken photos and read none since %s (%s runs); failures by type: %s',
                                       v_dry.jobname, to_char(v_dry.since::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), v_dry.fires,
                                       left(v_dry.classes::text, 300));
    END IF;
  END LOOP;
  -- The stage queue, once switched on: work is due and nobody has written a receipt, or the reconciler stopped running.
  IF v_stage_on AND v_stage_due > 0 AND v_stage_oldest_due < now() - c_queue_wait AND v_stage_receipts_6h = 0 THEN
    v_reasons := v_reasons || format('%s photos are due in the classifier stage queue (oldest queued %s) and no receipt was written in 6 h',
                                     v_stage_due, to_char(v_stage_oldest_due AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'));
  END IF;
  IF v_stage_on AND (v_stage_last_run IS NULL OR v_stage_last_run < now() - interval '1 hour') THEN
    v_reasons := v_reasons || format('the stage reconciler is switched on but last ran %s',
                                     coalesce(to_char(v_stage_last_run AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), 'never'));
  END IF;

  v_out := jsonb_build_object(
    'status', CASE WHEN cardinality(v_reasons) = 0 THEN 'passed' ELSE 'failed' END,
    'reasons', to_jsonb(v_reasons),
    'checked_at', now(),
    'method', 'assay_photo_reading_flow v2',
    'population', 'vehicle_images rows with a user_id, every status (user_image_counts.n_all); listing photos are outside this assay',
    'classifier', jsonb_build_object(
      'image_rows_total', v_total,
      'images_first_read_by_prompt_version', v_by_version,
      'note', 'first readings only: a re-read adds no row and keeps the first version; the total includes duplicates, skipped and non-vehicle rows that are never read',
      'last_first_reading_at', v_last_read,
      'first_readings_6h', v_desc_6h, 'first_readings_24h', v_desc_24h,
      'first_readings_72h_by_producer', v_by_producer,
      'reading_landed_6h', v_live_6h),
    'deep', jsonb_build_object(
      'images_with_verdict', v_deep_total,
      'reviewed_readings_72h', v_deep_72h,
      'last_reviewed_reading_at', v_deep_last,
      'image_observations_72h_by_producer', v_placed_by_producer),
    'queue', jsonb_build_object(
      'pending_user_photos', v_pending,
      'sample_capped_at', c_pending_cap,
      'claimable_now', v_claimable,
      'backing_off', v_backoff,
      'parked_by_backlog_switch', v_parked,
      'waiting_over_6h', v_waiting,
      'oldest_waiting_since', v_oldest_waiting,
      'terminal_retry_rows', v_terminal,
      'terminal_by_error', v_terminal_by_class,
      'given_up_after_provider_refusal', v_given_up),
    'provider', jsonb_build_object(
      'breaker', v_provider,
      'last_success_at', v_last_provider_ok,
      'calls_24h', v_calls_24h,
      'successes_24h', v_ok_24h,
      'successes_6h', v_ok_6h,
      'note', 'HTTP 200 is logged before the answer is validated; it is telemetry, not a reading'),
    'readers', v_readers,
    'stage_queue', v_stage);

  IF p_raise AND cardinality(v_reasons) > 0 THEN
    RAISE EXCEPTION 'photo reading stalled: %', array_to_string(v_reasons, '; ');
  END IF;
  RETURN v_out;
END $function$;

drop function if exists public.image_stage_levels(uuid);
drop function if exists public.image_stage_levels_json(uuid);
drop function if exists public.image_stage_level_counts(uuid, uuid);
drop function if exists public.image_stage_photo_levels(uuid, uuid);
drop function if exists public.enqueue_image_stage_work(uuid[], text);
drop function if exists public.image_stage_backfill_cap_left(text);
drop function if exists public.image_stage_keyed_child_exists(uuid, uuid);
drop function if exists public.image_stage_keyed_parent_at(uuid, uuid, uuid);
drop function if exists public.image_stage_keyed_parent_exists(uuid, uuid, uuid);
drop function if exists public.image_stage_reading_observation_id(jsonb);
drop function if exists public.image_stage_scope_ok(jsonb, uuid, uuid);
drop function if exists public.image_stage_photo_block(uuid, text, boolean, boolean, text, boolean, boolean, boolean, boolean, text, text);

delete from public.image_stage_work where stage in ('deep_reading', 'keyed_values');
delete from public.platform_config where config_key = 'image_stage_deep_reading';
do $r$
begin
  if exists (select 1 from public.image_stage_receipts where stage in ('deep_reading', 'keyed_values')) then
    update public.image_pipeline_stages set required = false where stage in ('deep_reading', 'keyed_values');
    raise notice 'receipts exist for deep_reading or keyed_values: the two stage rows are kept, not required, and so are the widened applies_when check and backfill_daily_cap';
  else
    delete from public.image_pipeline_stages where stage in ('deep_reading', 'keyed_values');
    alter table public.image_pipeline_stages drop constraint if exists image_pipeline_stages_applies_when_check;
    alter table public.image_pipeline_stages add constraint image_pipeline_stages_applies_when_check check (applies_when = any (array['always', 'document_like']));
    alter table public.image_pipeline_stages drop column if exists backfill_daily_cap;
  end if;
end $r$;
commit;
