-- Photos filed to a car reach keyed data without anyone pushing them: deep reading and keyed values become two more
-- stages of the per-image stage ledger (20261113110000). Contract: the owner's direction of 2026-11-20 ("its not going
-- from raw image to keyed data plain and simple"; "id rather the rules are built into the db rather than lines of
-- optional text").
--
-- What changes at deploy: the first-read stage (classifier) is judged, claimed, receipted and queued exactly as before,
-- and no photo is a gap for either new stage: the scope row platform_config 'image_stage_deep_reading' is inserted with
-- enabled = false, so no work is queued. What does change is additive reader output: image_stage_coverage() lists two
-- more stages; image_stage_coverage(uuid) gains a levels key and a new logic_version string; assay_photo_reading_flow
-- gains stage_queue.stages and method v3; the landing trigger and the receipt writer call a function that returns 0
-- while the scope is off. A later migration switches the scope on after the reader (--stage deep_reading|keyed_values)
-- is deployed.
--
-- 1. Registry: stages deep_reading (producer photo-pipeline-orchestrator, applies when the photo is filed for reading)
--    and keyed_values (producer ingest-observation-batch, applies when the photo carries a reading the projection can
--    use). Both required = true: image_stage_gaps joins only required stages and claim_image_stage_work re-checks the
--    gap, so work for a stage that is not required is dropped at claim. The canary is bounded by the scope row.
--    New column backfill_daily_cap (null = none; deep_reading 150).
-- 2. image_stage_gaps: the two applies_when values, the shared eligibility (image_stage_photo_block), the scope
--    (image_stage_scope_ok), and what satisfies a stage without a receipt: a deep reading of a reviewed tier
--    (byok_deep_analysis with a scene_type) satisfies deep_reading outright; a thin-tier (automatic) reading goes through the
--    receipt logic (image_stage_reading_is_thin; the tiers are listed by 20261120140000) so raising the stage's version offers
--    it again; a current projected child for the photo's current
--    reading satisfies keyed_values (looked up in vehicle_observations by the existing idx_vobs_image_id_analysis). A
--    keyed_values receipt older than the current reading's parent observation does not close the stage for it.
-- 3. enqueue_image_stage_work(uuid[], text): work is created by the event that makes it due. Called from
--    photo_land_trigger (inside its own protection) and record_image_stage_receipt. It queues only the two new
--    stages: the first read keeps its 15-minute grace and its reconciler.
-- 4. reconcile_image_stages: the backfill lane queues a stage with a backfill_daily_cap only up to what is left of
--    today's cap (image_stage_backfill_cap_left; day = America/Los_Angeles). Gaps over the cap are not counted as gaps
--    for that tick, so they neither stall the cursor nor make every tick rescan the same photos.
-- 5. image_stage_coverage(uuid) gains levels; image_stage_levels(uuid) is the same levels for a whole library, both
--    built on image_stage_photo_levels, so they cannot disagree.
-- 6. assay_photo_reading_flow: the two stages in the stage queue and the reasons deep_reading_stalled and
--    keyed_values_stalled; "passed" then means the chain to keyed data, not the first read alone.
-- No DDL on vehicle_images, no index, no trigger added or changed on it.
-- Revert: supabase/sql/revert_20261120130000_photo_deep_reading_keyed_values_stages.sql.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '25s';   -- long enough to wait out one reconciler run
select pg_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0));
set local lock_timeout = '3s';

-- The replaced bodies are the ones read from production on 2026-11-20; refuse to replace a body someone changed since.
-- A replay finds this migration's own bodies and passes (the second md5 of each pair).
do $guard$
declare r record;
begin
  for r in select * from (values
      ('public.image_stage_gaps(uuid[])', '2190aee1bc568d23a95dcf5f4fd76687', '6d2369e5a0d39198b1c4f7a750781ecb'),
      ('public.image_stage_legacy_evidence(text,jsonb,jsonb,text)', '0ff666f6cc4fc8611737cf73e9c37b29', 'fbba96e6a73479b341a067bd8b59fbd9'),
      ('public.image_stage_legacy_version(text,jsonb)', 'f21e15d0a93aad124a1d078de9e8a053', '14983fe5d168ca3606b4907c47de9da1'),
      ('public.photo_land_trigger()', '307261071b2aa3fef7a83297d63a9638', 'bdb3b709bfdee1138fe76e68457a8650'),
      ('public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)', '8209f1ce4dec11626d2ab8320bc97dac', 'c0c1e66fd6a9b41c126c8b3c4807c719'),
      ('public.reconcile_image_stages(integer)', 'ecc3d3ed7c93eff04c1febf6863d32db', '056eed5153c3886e44414b2cc0327502'),
      ('public.image_stage_coverage(uuid)', 'e92ca8da307520efe9300e70d9ae80c4', 'bd8b5c1961a5ba17c2a38983afceb980'),
      ('public.assay_photo_reading_flow(boolean)', '343829ffb39b394fd302e455bdc86d68', 'e4a01af0fa8f3a93d002d86e431101ae')) as t(fn, md5_before, md5_after) loop
    -- a function that is missing is refused too (a null md5 would otherwise pass "not in")
    if coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing') not in (r.md5_before, r.md5_after) then
      raise exception '% is not the body this migration replaces (md5 %); review before applying', r.fn,
        coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing');
    end if;
  end loop;
end $guard$;

-- ===== 1. registry
alter table public.image_pipeline_stages add column if not exists backfill_daily_cap integer;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'image_pipeline_stages_backfill_daily_cap_check') then
    alter table public.image_pipeline_stages add constraint image_pipeline_stages_backfill_daily_cap_check
      check (backfill_daily_cap is null or backfill_daily_cap >= 0);
  end if;
end $c$;
alter table public.image_pipeline_stages drop constraint if exists image_pipeline_stages_applies_when_check;
alter table public.image_pipeline_stages add constraint image_pipeline_stages_applies_when_check
  check (applies_when = any (array['always', 'document_like', 'filed_for_reading', 'deep_reading_landed']));
comment on column public.image_pipeline_stages.backfill_daily_cap is
  'Most work items of this stage the backfill lane may create per day (America/Los_Angeles day, counting every row not dropped). Null = no cap. The live lane is never capped.';

insert into public.image_pipeline_stages (stage, producer, required_version, required, applies_when, max_attempts, backfill_daily_cap, description) values
  ('deep_reading', 'photo-pipeline-orchestrator', 1, true, 'filed_for_reading', 6, 150,
   'Deep reading of one filed, approved, first-read photo: scene, components and state_observations, stamped as ai_scan_metadata.byok_deep_analysis by the reviewed-analysis intake. Satisfied outright by a reading of a reviewed tier that carries a scene_type; a thin-tier (automatic) reading satisfies it only through a succeeded receipt at the stage''s version, so raising the version offers it again. In scope only per platform_config image_stage_deep_reading.'),
  ('keyed_values', 'ingest-observation-batch', 1, true, 'deep_reading_landed', 6, NULL,
   'Keyed values for a photo whose deep reading landed: the reading''s rust, paint and assembly state projected as registered properties with the photo as witness. Satisfied by a current projected child for the photo''s current reading; closed with a policy_skip receipt naming the projection''s deferral reason when the reading yields none.')
on conflict (stage) do update set producer = excluded.producer, required_version = excluded.required_version,
  required = excluded.required, applies_when = excluded.applies_when, max_attempts = excluded.max_attempts,
  backfill_daily_cap = excluded.backfill_daily_cap, description = excluded.description;

-- Scope. Off in this migration: the later migration that turns it on names the canary.
insert into public.platform_config (config_key, config_value, description) values
  ('image_stage_deep_reading',
   '{"enabled": false,
     "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
     "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b", "20d21fb0-4651-4469-a0ba-e751309a1e54"],
     "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}'::jsonb,
   'Scope of the deep_reading and keyed_values stages: enabled, the photo owners in scope (user_ids), the vehicles in scope (vehicle_ids; absent = every vehicle) and vehicles never in scope (exclude_vehicle_ids). Ownership columns on vehicles are not used. Migration 20261120130000.')
on conflict (config_key) do nothing;

-- ===== 2a. shared definitions (pure; no SET so a call inlines into the query that makes it)
-- Why a photo cannot be read now, or null when it can: the conditions the reviewed-analysis intake itself refuses.
create or replace function public.image_stage_photo_block(
  p_vehicle_id uuid, p_gate text, p_is_document boolean, p_doc_flag boolean, p_match text, p_sensitive boolean,
  p_duplicate boolean, p_superseded boolean, p_external boolean, p_url text, p_ai_status text)
returns text language sql immutable as $$
  select case
    when p_duplicate is true then 'duplicate'
    when coalesce(p_superseded, false) then 'superseded'
    when p_sensitive is true then 'sensitive'
    when p_external is true then 'external'
    when p_url is null or p_url !~ '^https?://' then 'no_pixels'
    when p_vehicle_id is null then 'unfiled'
    when coalesce(p_gate, 'approved') <> 'approved' then 'gate'
    when p_is_document is true or p_doc_flag is true then 'document'
    when coalesce(p_match, 'pending') in ('mismatch', 'unrelated') then 'match_status'
    when p_ai_status is distinct from 'completed' then 'no_first_read'
  end $$;

-- In scope per platform_config image_stage_deep_reading (passed in, so a caller reads the row once).
create or replace function public.image_stage_scope_ok(p_cfg jsonb, p_user_id uuid, p_vehicle_id uuid)
returns boolean language sql immutable as $$
  select coalesce(case
    when p_cfg is null or p_user_id is null or p_vehicle_id is null then false
    when p_cfg -> 'enabled' is distinct from 'true'::jsonb then false
    when jsonb_typeof(p_cfg -> 'user_ids') is distinct from 'array' then false
    when not (p_cfg -> 'user_ids' ? p_user_id::text) then false
    when jsonb_typeof(p_cfg -> 'exclude_vehicle_ids') = 'array' and (p_cfg -> 'exclude_vehicle_ids' ? p_vehicle_id::text) then false
    when jsonb_typeof(p_cfg -> 'vehicle_ids') = 'array' then (p_cfg -> 'vehicle_ids' ? p_vehicle_id::text)
    else true end, false) $$;

-- The observation a photo's reading came from (null when the stamp carries no uuid).
create or replace function public.image_stage_reading_observation_id(p_meta jsonb)
returns uuid language sql immutable as $$
  select case when (p_meta #>> '{byok_deep_analysis,observation_id}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (p_meta #>> '{byok_deep_analysis,observation_id}')::uuid end $$;

-- The reading a photo holds, found where the projection finds it (projectImageProperties): a current image_deep_byok
-- condition observation of this photo and vehicle, by (image_id, analysis_kind) on idx_vobs_image_id_analysis. The stamp's
-- observation id (byok_deep_analysis.observation_id) is preferred when it names such an observation; many older readings
-- carry no id in the stamp, and some photos hold the observation without any stamp, so the observation is the evidence and
-- the stamp is not required. Newest ingested_at otherwise. No row = the projection has no parent to work from.
create or replace function public.image_stage_reading_parent(p_image_id uuid, p_vehicle_id uuid, p_stamp_observation_id uuid)
returns table (id uuid, ingested_at timestamptz) language sql stable as $$
  -- (OFFSET 0 fences the index lookup: without it the planner chose the vehicle's whole condition-observation list per photo,
  -- measured 2026-11-20 as a timeout on 6,000 photos; fenced, 3,000 photos took 0.8 s.)
  select o.id, o.ingested_at from (
     select o2.id, o2.kind, o2.is_superseded, o2.vehicle_id, o2.ingested_at from public.vehicle_observations o2
      where o2.structured_data ->> 'image_id' = p_image_id::text and o2.structured_data ->> 'analysis_kind' = 'image_deep_byok'
      offset 0) o
   where o.kind = 'condition' and o.is_superseded is not true
     and o.vehicle_id = p_vehicle_id
   order by (o.id = p_stamp_observation_id) desc nulls last, o.ingested_at desc nulls last, o.id
   limit 1 $$;

-- A current projected child for this photo's current reading. Uses idx_vobs_image_id_analysis (image_id, analysis_kind).
create or replace function public.image_stage_keyed_child_exists(p_image_id uuid, p_observation_id uuid)
returns boolean language sql stable as $$
  select p_observation_id is not null and exists (
    select 1 from public.vehicle_observations o
     where o.structured_data ->> 'image_id' = p_image_id::text
       and o.structured_data ->> 'analysis_kind' = 'image_property_projection'
       and o.is_superseded is not true
       and o.structured_data ->> 'source_observation_id' = p_observation_id::text) $$;

-- Is a reading's tier thin? (A thin reading is an automatic one: it satisfies deep_reading only through a stage receipt, so a raise of
-- the stage's version offers it again; a reviewed-tier reading satisfies the stage outright.) The tiers are listed in platform_config
-- 'image_reading_tiers' (config_value.reviewed_tiers, inserted by 20261120140000); a tier that is not listed is thin. No tier at all =
-- a legacy reading = reviewed. This migration must stand alone, so while that row is missing (or has no reviewed_tiers array) only the
-- reader's own literal tier, 'subscription automatic', is thin: no reviewed reading is ever re-offered because a config row is absent.
-- Own function, dropped by this migration's own revert; the intake's guard uses its own, stricter, helper (20261120140000).
create or replace function public.image_stage_reading_is_thin(p_tier text)
returns boolean language sql stable set search_path to 'public', 'pg_temp' as $$
  select case when coalesce(p_tier, '') = '' then false
              else coalesce((select case when jsonb_typeof(c.config_value -> 'reviewed_tiers') = 'array'
                                         then not (c.config_value -> 'reviewed_tiers' ? p_tier)
                                         else p_tier = 'subscription automatic' end
                               from public.platform_config c where c.config_key = 'image_reading_tiers'),
                            p_tier = 'subscription automatic') end $$;

-- What is left of a stage's backfill cap today (America/Los_Angeles); null when the stage has none.
create or replace function public.image_stage_backfill_cap_left(p_stage text)
returns integer language sql stable set search_path to 'public', 'pg_temp' as $$
  select case when s.backfill_daily_cap is null then null
              else greatest(s.backfill_daily_cap - (
                select count(*) from public.image_stage_work w
                 where w.stage = s.stage and w.lane = 'backfill' and w.status <> 'dropped'
                   and w.created_at >= date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'), 0)::int end
    from public.image_pipeline_stages s where s.stage = p_stage $$;

-- Room left for one of the two reading stages in the queue, so they cannot fill it and stop the first read being queued:
-- platform_config image_stage_deep_reading.max_open (default 100) per stage, counted over that stage's open items.
-- Null for any other stage (the first read is held only by the reconciler's own max_open).
create or replace function public.image_stage_stage_room(p_stage text)
returns integer language sql stable set search_path to 'public', 'pg_temp' as $$
  select case when s.applies_when in ('filed_for_reading', 'deep_reading_landed') then
           greatest(coalesce((select (pc.config_value ->> 'max_open')::int from public.platform_config pc
                               where pc.config_key = 'image_stage_deep_reading' and jsonb_typeof(pc.config_value -> 'max_open') = 'number'), 100)
                    - (select count(*) from public.image_stage_work w where w.stage = s.stage and w.status in ('queued', 'claimed')), 0)::int end
    from public.image_pipeline_stages s where s.stage = p_stage $$;

-- ===== 2b. what satisfies a stage without a receipt
create or replace function public.image_stage_legacy_evidence(p_stage text, p_meta jsonb, p_exif jsonb, p_contract text DEFAULT NULL::text)
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
    -- a deep reading, whoever made it: the reviewed-analysis intake stamps byok_deep_analysis with a scene_type
    when 'deep_reading' then jsonb_typeof(p_meta -> 'byok_deep_analysis') = 'object'
      and jsonb_typeof(p_meta #> '{byok_deep_analysis,scene_type}') = 'string'
      and btrim(p_meta #>> '{byok_deep_analysis,scene_type}') <> ''
    else false end, false)
$function$;

create or replace function public.image_stage_legacy_version(p_stage text, p_meta jsonb)
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
    when 'deep_reading' then
      case when public.image_stage_legacy_evidence('deep_reading', p_meta, null, null) then 'legacy-byok-deep-analysis' end
    else null end
$function$;

-- ===== 2c. the gap finder
-- Unchanged for stages 'always' and 'document_like'. A stage applying 'filed_for_reading' or 'deep_reading_landed' is a
-- gap only for a photo that is filed, approved, first-read, not a document, not sensitive and so on (the same
-- conditions the intake refuses) and in scope per image_stage_deep_reading. The keyed_values lookup is in this
-- function, not in the immutable legacy helpers, because it reads other tables. The reading's observation (kp) is looked up, not
-- taken from the stamp: a photo that holds the observation but no stamp is not read again, and a stamp without an observation id
-- still has its keyed values found.
create or replace function public.image_stage_gaps(p_image_ids uuid[])
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
              when s.applies_when = 'deep_reading_landed' and c.outcome in ('succeeded', 'policy_skip') then 'outdated'
              else 'retryable_outcome' end,
         s.required_version,
         greatest(now(), coalesce(c.retry_after, now()))
  from public.vehicle_images v
  join public.image_pipeline_stages s on s.required
  left join public.image_stage_current c on c.image_id = v.id and c.stage = s.stage
  -- the reading the photo holds, as an observation (only looked up for the two reading stages)
  left join lateral (select p.id, p.ingested_at from public.image_stage_reading_parent(v.id, v.vehicle_id, public.image_stage_reading_observation_id(v.ai_scan_metadata)) p
                      where s.applies_when in ('filed_for_reading', 'deep_reading_landed')) kp on true
  -- What the reading is and who made it (reading tiers, 20261120140000): a reading satisfies deep_reading outright only when it is
  -- not thin tier. rd.le = a reading exists (the stamp); rd.thin = its tier is thin (the observation's agent_tier, else the stamp's;
  -- no tier at all = a legacy reading = reviewed). ev = the stamp as evidence for this stage, a thin reading not counting for deep_reading.
  left join lateral (select public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data, s.contract) as le,
                            case when s.applies_when = 'filed_for_reading' then public.image_stage_reading_is_thin(
                              coalesce((select o.agent_tier from public.vehicle_observations o where o.id = kp.id), v.ai_scan_metadata #>> '{byok_deep_analysis,agent_tier}')) else false end as thin) rd on true
  -- the newest receipt of this stage whatever its outcome (image_stage_current prefers a closing one)
  left join lateral (select r.outcome, r.observed_at, r.retry_after, r.attempt from public.image_stage_receipts r
                      where s.applies_when = 'deep_reading_landed' and r.image_id = v.id and r.stage = s.stage and r.producer_version >= s.required_version
                      order by r.observed_at desc, r.id desc limit 1) lr on true
  where v.id = any (p_image_ids)
    and (s.applies_when = 'always'
         or (s.applies_when = 'document_like' and coalesce(v.ai_scan_metadata #>> '{classification,image_type}', '') in ('receipt', 'document', 'invoice', 'text_document'))
         or (s.applies_when in ('filed_for_reading', 'deep_reading_landed')
             and public.image_stage_photo_block(v.vehicle_id, v.vision_gate_status::text, v.is_document, v.doc_flag, v.image_vehicle_match_status,
                   v.is_sensitive, v.is_duplicate, v.is_superseded, v.is_external, v.image_url, v.ai_processing_status) is null
             and public.image_stage_scope_ok((select pc.config_value from public.platform_config pc where pc.config_key = 'image_stage_deep_reading'), v.user_id, v.vehicle_id)
             and (s.applies_when = 'filed_for_reading' or kp.id is not null)))
    -- satisfied without a receipt: a deep reading of a reviewed tier exists (a stamp with a scene_type, or the reading's own
    -- observation, whatever any receipt says), or a projected child exists for the current reading. A thin-tier reading is not
    -- that: it goes through the receipt logic below (a succeeded receipt at the stage's version closes it; raising the version
    -- offers it again)
    and not (s.applies_when = 'filed_for_reading' and (kp.id is not null or rd.le) and not rd.thin)
    and not (s.applies_when = 'deep_reading_landed' and public.image_stage_keyed_child_exists(v.id, kp.id))
    and (
      (c.image_id is null and (not (rd.le and not rd.thin)
                               or public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key)))
      or (c.producer_version < s.required_version and not (rd.le and not rd.thin))
      or (c.producer_version >= s.required_version and c.outcome in ('unavailable', 'rate_limited')
          and c.retry_after <= now()
          and (c.attempt < s.max_attempts or c.observed_at < now() - interval '1 day'))
      or (c.producer_version >= s.required_version and c.outcome = 'blocked_input'
          and c.input_fingerprint is not null and c.input_fingerprint <> md5(coalesce(v.image_url, '')))
      -- A keyed_values receipt that predates the current reading (a re-read photo) closed the stage for the old reading. It
      -- reopens the stage only while no later receipt answers for the current reading: a later failed or blocked receipt
      -- closes it (as it does for any stage), a later unavailable or rate_limited one follows its own retry_after and attempt limit.
      or (s.applies_when = 'deep_reading_landed' and c.producer_version >= s.required_version and c.outcome in ('succeeded', 'policy_skip')
          and kp.ingested_at > c.observed_at
          and (lr.observed_at < kp.ingested_at
               or (lr.outcome in ('unavailable', 'rate_limited') and lr.retry_after <= now()
                   and (lr.attempt < s.max_attempts or lr.observed_at < now() - interval '1 day'))))
    )
$function$;

-- ===== 3. work is created by the event that makes it due
-- Only the two reading stages: the first read keeps its 15-minute grace and its reconciler. Never raises: it runs
-- inside triggers on photo updates.
create or replace function public.enqueue_image_stage_work(p_image_ids uuid[], p_lane text default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cfg jsonb; v_scope jsonb; v_users uuid[]; v_max int; v_open int; v_live_days int; v_n int := 0;
begin
  if p_image_ids is null or coalesce(array_length(p_image_ids, 1), 0) = 0 then return 0; end if;
  if p_lane is not null and p_lane not in ('live', 'backfill') then return 0; end if;
  -- with the reading scope off there is nothing to find: no gap for either stage exists (the cheapest exit, first)
  select config_value into v_scope from public.platform_config where config_key = 'image_stage_deep_reading';
  if v_scope is null or v_scope -> 'enabled' is distinct from 'true'::jsonb then return 0; end if;
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then return 0; end if;
  if jsonb_typeof(v_cfg -> 'user_ids') = 'array' then
    select coalesce(array_agg(x::uuid), '{}') into v_users from jsonb_array_elements_text(v_cfg -> 'user_ids') x;
  end if;
  v_max := coalesce((v_cfg ->> 'max_open')::int, 300);
  select count(*) into v_open from public.image_stage_work where status in ('queued', 'claimed');
  if v_open >= v_max then return 0; end if;
  v_live_days := coalesce((v_cfg ->> 'live_days')::int, 2);

  with ids as (
    -- the reconciler's own row eligibility
    select v.id, v.created_at from public.vehicle_images v
     where v.id = any (p_image_ids)
       and (v_users is null or v.user_id = any (v_users))
       and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true
       and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
       and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes')
  ), gaps0 as (
    select g.image_id, g.stage, g.target_version, g.reason, g.not_before, i.created_at,
           coalesce(p_lane, case when i.created_at >= now() - make_interval(days => v_live_days) then 'live' else 'backfill' end) as lane
      from public.image_stage_gaps(array(select id from ids)) g
      join ids i on i.id = g.image_id
      join public.image_pipeline_stages s on s.stage = g.stage and s.applies_when in ('filed_for_reading', 'deep_reading_landed')
     where not exists (select 1 from public.image_stage_work w where w.image_id = g.image_id and w.stage = g.stage and w.status in ('queued', 'claimed'))
  ), capped as (
    select g0.*, c.cap_left, c.stage_room, row_number() over (partition by g0.stage, g0.lane order by g0.created_at, g0.image_id) as stage_rn,
           row_number() over (partition by g0.stage order by case g0.lane when 'live' then 0 else 1 end, g0.created_at, g0.image_id) as stage_all_rn
      from gaps0 g0
      left join lateral (select case when g0.lane = 'backfill' then public.image_stage_backfill_cap_left(g0.stage) end as cap_left,
                                public.image_stage_stage_room(g0.stage) as stage_room) c on true
  ), room as (
    select cp.*, row_number() over (order by case cp.lane when 'live' then 0 else 1 end, cp.created_at, cp.image_id, cp.stage) as rn
      from capped cp where (cp.cap_left is null or cp.stage_rn <= cp.cap_left) and (cp.stage_room is null or cp.stage_all_rn <= cp.stage_room)
  ), ins as (
    insert into public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
    select image_id, stage, target_version, reason, lane, not_before from room where rn <= v_max - v_open
    on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing
    returning 1
  ) select count(*) into v_n from ins;
  return v_n;
exception when others then
  raise warning 'enqueue_image_stage_work failed: %', sqlerrm;
  return 0;
end $$;
comment on function public.enqueue_image_stage_work(uuid[], text) is
  'Creates the deep_reading and keyed_values work the moment a photo is due for it: one open item per gap, none when the stage ledger or the reading scope is off or the queue is at max_open, backfill-lane inserts held to the stage''s backfill_daily_cap. Never raises (returns 0 with a WARNING). Called by photo_land_trigger and record_image_stage_receipt; the reconciler stays the net. Migration 20261120130000.';

-- photo_land_trigger: the landing is unchanged; the enqueue runs inside its own block, so a failure there cannot undo or
-- skip the classification it follows.
create or replace function public.photo_land_trigger()
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
  -- The event that makes deep reading or keyed values due (first read landed, reading landed or changed, photo filed,
  -- gate changed): queue it now, not when a timer next scans.
  -- (a photo with no owner or no vehicle can never be due, so it costs nothing here.) A statement_timeout cancel is not
  -- caught by WHEN OTHERS in PL/pgSQL; the enqueue is one id's gap lookup, and with the scope off it returns at its first read.
  IF NEW.user_id IS NOT NULL AND NEW.vehicle_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_image_stage_work(ARRAY[NEW.id]);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'photo_land_trigger: enqueue_image_stage_work failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'photo_land_trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

-- record_image_stage_receipt: same signature and return; a closed item may make the next stage due.
create or replace function public.record_image_stage_receipt(p_image_id uuid, p_stage text, p_producer_version integer, p_outcome text, p_error_class text DEFAULT NULL::text, p_http_status integer DEFAULT NULL::integer, p_retry_after_seconds integer DEFAULT NULL::integer, p_input_fingerprint text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb)
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
  -- a finished or deliberately closed stage can make the next one due (a reading landed: keyed values)
  if p_outcome in ('succeeded', 'policy_skip') then
    begin
      perform public.enqueue_image_stage_work(array[p_image_id]);
    exception when others then
      raise warning 'record_image_stage_receipt: enqueue_image_stage_work failed for %: %', p_image_id, sqlerrm;
    end;
  end if;
  return v_id;
end $function$;

-- ===== 4. reconciler: the backfill daily cap
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

    with gaps0 as materialized (
      select g.image_id, g.stage, g.target_version, g.reason, g.not_before, v.created_at
        from public.image_stage_gaps(v_ids) g join public.vehicle_images v on v.id = g.image_id
       where not exists (select 1 from public.image_stage_work w where w.image_id = g.image_id and w.stage = g.stage and w.status in ('queued', 'claimed'))
    ), capped as (
      -- A stage with a backfill_daily_cap is queued in the backfill lane only up to what is left of today's cap. A gap over
      -- the cap is not counted as a gap this tick (it never reaches v_gaps or the cursor rule below), so skipped photos
      -- neither hold the cursor back nor make every tick rescan them; the cursor passes them and the next pass, or the
      -- event enqueue, finds them. The live lane is never capped.
      -- A reading stage is also held to its own room in the queue (image_stage_stage_room), so the two cannot fill max_open and
      -- stop the first read being queued.
      select g0.*, c.cap_left, c.stage_room, row_number() over (partition by g0.stage order by g0.created_at asc, g0.image_id) as stage_rn
        from gaps0 g0
        left join (select s.stage, case when v_lane = 'backfill' then public.image_stage_backfill_cap_left(s.stage) end as cap_left,
                          public.image_stage_stage_room(s.stage) as stage_room
                     from public.image_pipeline_stages s) c on c.stage = g0.stage
    ), gaps as materialized (
      -- every gap among the scanned rows, in the lane's order (live: newest first; backfill: oldest first, as the scan
      -- and the cursor order them); the first v_lane_budget are queued
      select cp.image_id, cp.stage, cp.target_version, cp.reason, cp.not_before, cp.created_at,
             row_number() over (order by case when v_lane = 'live' then cp.created_at end desc nulls last,
                                         case when v_lane = 'live' then null else cp.created_at end asc nulls last,
                                         cp.image_id, cp.stage) as rn
        from capped cp where (cp.cap_left is null or cp.stage_rn <= cp.cap_left) and (cp.stage_room is null or cp.stage_rn <= cp.stage_room)
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

-- ===== 5. the levels: one definition per level, per photo
-- One row per photo (not duplicate, not superseded) of a vehicle (p_vehicle_id), or of a user's whole library (p_user_id,
-- p_vehicle_id null): every photo, whoever owns it, of each vehicle that holds one of the user's photos, plus the user's
-- unfiled photos. So the library's row for a vehicle is that vehicle's own count, and photos with no owner are counted in both.
-- "Automatic" is decided by the stage receipt, never by the text of a reading. A keyed value is a current
-- (is_superseded = false, as idx_vehicle_observations_property is partial on it) observation with a property_id, on a vehicle
-- that holds the photos, with the photo as witness; it is found from the vehicle side (that index) and joined to the
-- witnesses, never by a primary-key probe per witness (19,736 of them cost 8 s on 2026-11-20). The reading a photo holds is
-- looked up as the gap finder looks it up (image_stage_reading_parent), for photos that are not refused, so a state here is
-- the state the gap finder sees. deep_state and keyed_state say where a photo is: done, queued, claimed, unqueued (a gap nobody
-- queued), retrying, closed_no_value (policy_skip), receipt_without_result (succeeded, yet no reading or no keyed value for
-- the current reading), given_up (failed or blocked), not_eligible, out_of_scope, no_reading (keyed_values only).
create or replace function public.image_stage_photo_levels(p_user_id uuid, p_vehicle_id uuid)
returns table (
  image_id uuid, vehicle_id uuid, created_at timestamptz,
  with_pixels boolean, first_read boolean, has_embedding boolean, filed boolean, gate_approved boolean, gate_undecided boolean,
  deep_read boolean, deep_automatic boolean, keyed boolean, keyed_values integer, keyed_automatic boolean,
  waiting_deep boolean, waiting_keyed boolean, oldest_waiting_at timestamptz,
  first_keyed_at timestamptz, deep_work_at timestamptz, keyed_receipt_at timestamptz,
  obs_id uuid, block text, in_scope boolean, deep_state text, deep_detail text, keyed_state text, keyed_detail text)
language sql stable set search_path to '' as $$
  with cfg as (select pc.config_value as c from public.platform_config pc where pc.config_key = 'image_stage_deep_reading'),
  base as (
    select v.id, v.vehicle_id, v.user_id, v.created_at, v.image_url, v.ai_processing_status,
           v.vision_gate_status::text as gate, v.image_vehicle_match_status as match_status,
           public.image_stage_legacy_evidence('deep_reading', v.ai_scan_metadata, null, null) as has_reading,
           public.image_stage_reading_observation_id(v.ai_scan_metadata) as stamp_obs,
           v.ai_scan_metadata #>> '{byok_deep_analysis,agent_tier}' as stamp_tier,
           public.image_stage_photo_block(v.vehicle_id, v.vision_gate_status::text, v.is_document, v.doc_flag, v.image_vehicle_match_status,
                                          v.is_sensitive, v.is_duplicate, v.is_superseded, v.is_external, v.image_url, v.ai_processing_status) as block
      from public.vehicle_images v
     where p_vehicle_id is not null and v.vehicle_id = p_vehicle_id
       and v.is_duplicate is not true and coalesce(v.is_superseded, false) = false
    union all
    select v.id, v.vehicle_id, v.user_id, v.created_at, v.image_url, v.ai_processing_status,
           v.vision_gate_status::text, v.image_vehicle_match_status,
           public.image_stage_legacy_evidence('deep_reading', v.ai_scan_metadata, null, null),
           public.image_stage_reading_observation_id(v.ai_scan_metadata),
           v.ai_scan_metadata #>> '{byok_deep_analysis,agent_tier}',
           public.image_stage_photo_block(v.vehicle_id, v.vision_gate_status::text, v.is_document, v.doc_flag, v.image_vehicle_match_status,
                                          v.is_sensitive, v.is_duplicate, v.is_superseded, v.is_external, v.image_url, v.ai_processing_status)
      from public.vehicle_images v
     where p_vehicle_id is null and p_user_id is not null and v.user_id = p_user_id and v.vehicle_id is null
       and v.is_duplicate is not true and coalesce(v.is_superseded, false) = false
    union all
    select v.id, v.vehicle_id, v.user_id, v.created_at, v.image_url, v.ai_processing_status,
           v.vision_gate_status::text, v.image_vehicle_match_status,
           public.image_stage_legacy_evidence('deep_reading', v.ai_scan_metadata, null, null),
           public.image_stage_reading_observation_id(v.ai_scan_metadata),
           v.ai_scan_metadata #>> '{byok_deep_analysis,agent_tier}',
           public.image_stage_photo_block(v.vehicle_id, v.vision_gate_status::text, v.is_document, v.doc_flag, v.image_vehicle_match_status,
                                          v.is_sensitive, v.is_duplicate, v.is_superseded, v.is_external, v.image_url, v.ai_processing_status)
      from public.vehicle_images v
     where p_vehicle_id is null and p_user_id is not null
       -- an array, not a semi-join: the planner reads this as an index scan on vehicle_id (a join seq-scans 65 M rows)
       and v.vehicle_id = any (array(select distinct x.vehicle_id from public.vehicle_images x where x.user_id = p_user_id and x.vehicle_id is not null))
       and v.is_duplicate is not true and coalesce(v.is_superseded, false) = false
  ), kv as (
    select ow.image_id, count(distinct o.id)::int as n, min(o.ingested_at) filter (where o.extraction_method = 'cached_byok_property_projection_v1') as first_at
      from public.vehicle_observations o
      join public.observation_witnesses ow on ow.observation_id = o.id
     where o.vehicle_id in (select b.vehicle_id from base b where b.vehicle_id is not null)
       and o.property_id is not null and o.is_superseded = false
       and ow.image_id in (select b.id from base b)
     group by ow.image_id
  ), raw as (
    select j.*, kv.n as kv_n, kv.first_at as kv_first_at, par.id as par_id, par.ingested_at as par_at,
           (select o.agent_tier from public.vehicle_observations o where o.id = par.id) as par_tier,
           rd.outcome as rd_outcome, rd.error_class as rd_error, rd.detail as rd_detail, rd.producer_version as rd_ver,
           (select s2.required_version from public.image_pipeline_stages s2 where s2.stage = 'deep_reading') as deep_req,
           kr.outcome as kr_outcome, kr.error_class as kr_error, kr.detail as kr_detail, kr.observed_at as kr_at,
           klr.outcome as klr_outcome, klr.error_class as klr_error, klr.observed_at as klr_at,
           dopen.status as dopen_status, dopen.created_at as dopen_at, kopen.status as kopen_status, kopen.created_at as kopen_at, dw.first_at as dw_at,
           (par.id is not null and public.image_stage_keyed_child_exists(j.id, par.id)) as child,
           public.image_stage_scope_ok((select cfg.c from cfg), j.user_id, j.vehicle_id) as scope_ok,
           exists (select 1 from public.image_observations io where io.image_id = j.id and io.is_active and io.embedding_clip_vitb32 is not null) as embedded
      from base j
      left join kv on kv.image_id = j.id
      left join lateral (select p.id, p.ingested_at from public.image_stage_reading_parent(j.id, j.vehicle_id, j.stamp_obs) p where j.block is null) par on true
      left join lateral (select r.outcome, r.error_class, r.detail, r.producer_version from public.image_stage_receipts r
                          where r.image_id = j.id and r.stage = 'deep_reading'
                          order by r.producer_version desc, (r.outcome in ('succeeded', 'policy_skip')) desc, r.attempt desc limit 1) rd on true
      left join lateral (select r.outcome, r.error_class, r.detail, r.observed_at from public.image_stage_receipts r
                          where r.image_id = j.id and r.stage = 'keyed_values'
                          order by r.producer_version desc, (r.outcome in ('succeeded', 'policy_skip')) desc, r.attempt desc limit 1) kr on true
      left join lateral (select r.outcome, r.error_class, r.observed_at from public.image_stage_receipts r
                          where r.image_id = j.id and r.stage = 'keyed_values'
                          order by r.observed_at desc, r.id desc limit 1) klr on true
      left join lateral (select w.status, w.created_at from public.image_stage_work w
                          where w.image_id = j.id and w.stage = 'deep_reading' and w.status in ('queued', 'claimed') limit 1) dopen on true
      left join lateral (select w.status, w.created_at from public.image_stage_work w
                          where w.image_id = j.id and w.stage = 'keyed_values' and w.status in ('queued', 'claimed') limit 1) kopen on true
      -- the work that produced the reading: items that were done, not ones dropped at claim
      left join lateral (select min(w.created_at) as first_at from public.image_stage_work w
                          where w.image_id = j.id and w.stage = 'deep_reading' and w.status = 'done') dw on true
  ), st as (
    -- the receipt that speaks for the current reading: a closing keyed_values receipt older than the reading's observation
    -- was written for an earlier reading, so the newest receipt answers instead (as the gap finder reads it)
    select r.*, (r.kr_outcome in ('succeeded', 'policy_skip') and r.par_at > r.kr_at) as kr_stale,
           (r.has_reading or r.par_id is not null) as deep_read_z,
           -- a thin-tier (automatic) reading is done for deep_reading only through a closing receipt at the stage's version, as the
           -- gap finder reads it (image_stage_reading_is_thin; a reading with no tier at all is a legacy one, reviewed)
           ((r.has_reading or r.par_id is not null)
            and public.image_stage_reading_is_thin(coalesce(r.par_tier, r.stamp_tier))
            and not (r.rd_outcome in ('succeeded', 'policy_skip') and r.rd_ver >= r.deep_req)) as thin_open
      from raw r
  )
  select j.id, j.vehicle_id, j.created_at,
         coalesce(j.image_url ~ '^https?://', false),
         coalesce(j.ai_processing_status = 'completed', false),
         j.embedded,
         j.vehicle_id is not null,
         j.vehicle_id is not null and j.gate = 'approved',
         j.vehicle_id is not null and j.gate is null,
         j.deep_read_z,
         j.deep_read_z and coalesce(j.rd_outcome = 'succeeded', false),
         coalesce(j.kv_n, 0) > 0,
         coalesce(j.kv_n, 0),
         coalesce(j.kv_n, 0) > 0 and coalesce(j.kr_outcome = 'succeeded', false) and not coalesce(j.kr_stale, false),
         j.dopen_status is not null,
         j.kopen_status is not null,
         least(j.dopen_at, j.kopen_at),
         j.kv_first_at,
         j.dw_at,
         case when j.kr_outcome = 'succeeded' then j.kr_at end,
         j.par_id,
         j.block,
         j.scope_ok,
         case when j.deep_read_z and not j.thin_open then 'done'
              when j.block is not null or j.user_id is null then 'not_eligible'
              when not j.scope_ok then 'out_of_scope'
              when j.dopen_status is not null then j.dopen_status
              when j.thin_open and j.rd_outcome in ('succeeded', 'policy_skip') and j.rd_ver < j.deep_req then 'unqueued'
              when j.rd_outcome = 'policy_skip' then 'closed_no_value'
              when j.rd_outcome = 'succeeded' then 'receipt_without_result'
              when j.rd_outcome in ('blocked_input', 'failed') then 'given_up'
              when j.rd_outcome is not null then 'retrying'
              else 'unqueued' end,
         case when j.deep_read_z and not j.thin_open then null
              when j.block is not null then j.block
              when j.user_id is null then 'no_owner'
              when not j.scope_ok or j.dopen_status is not null then null
              when j.thin_open and j.rd_outcome in ('succeeded', 'policy_skip') and j.rd_ver < j.deep_req then null
              when j.rd_outcome = 'policy_skip' then coalesce(j.rd_detail ->> 'skipped', j.rd_detail ->> 'reason', 'unspecified')
              when j.rd_outcome is not null then coalesce(j.rd_error, 'unspecified') end,
         case when j.child then 'done'
              when j.block is not null then case when j.deep_read_z then 'not_eligible' else 'no_reading' end
              when j.par_id is null then 'no_reading'
              when j.user_id is null then 'not_eligible'
              when not j.scope_ok then 'out_of_scope'
              when j.kopen_status is not null then j.kopen_status
              when j.kr_stale and j.klr_at < j.par_at then 'unqueued'
              when j.kr_outcome = 'policy_skip' and not j.kr_stale then 'closed_no_value'
              when j.kr_outcome = 'succeeded' and not j.kr_stale then 'receipt_without_result'
              when (case when j.kr_stale then j.klr_outcome else j.kr_outcome end) in ('blocked_input', 'failed') then 'given_up'
              when j.kr_outcome is not null then 'retrying'
              else 'unqueued' end,
         case when j.child then null
              when j.block is not null then case when j.deep_read_z then j.block end
              when j.par_id is null then null
              when j.user_id is null then 'no_owner'
              when not j.scope_ok or j.kopen_status is not null then null
              when j.kr_outcome = 'policy_skip' and not j.kr_stale then coalesce(j.kr_detail ->> 'skipped', j.kr_detail ->> 'reason', 'unspecified')
              when j.kr_stale then case when j.klr_at >= j.par_at then coalesce(j.klr_error, 'unspecified') end
              when j.kr_outcome is not null then coalesce(j.kr_error, 'unspecified') end
    from st j
$$;

-- The counts of those levels, one row per vehicle (null = unfiled photos).
create or replace function public.image_stage_level_counts(p_user_id uuid, p_vehicle_id uuid)
returns table (
  vehicle_id uuid, landed integer, with_pixels integer, first_read integer, has_embedding integer, filed integer, gate_approved integer, gate_undecided integer,
  deep_read integer, deep_read_automatic integer, deep_read_by_hand integer,
  keyed_photos integer, keyed_automatic integer, keyed_by_hand integer, keyed_values integer,
  waiting_deep integer, waiting_keyed integer, unqueued_deep integer, unqueued_keyed integer, oldest_waiting_at timestamptz, newest_photo_at timestamptz)
language sql stable set search_path to '' as $$
  select l.vehicle_id,
         count(*)::int,
         (count(*) filter (where l.with_pixels))::int,
         (count(*) filter (where l.first_read))::int,
         (count(*) filter (where l.has_embedding))::int,
         (count(*) filter (where l.filed))::int,
         (count(*) filter (where l.gate_approved))::int,
         (count(*) filter (where l.gate_undecided))::int,
         (count(*) filter (where l.deep_read))::int,
         (count(*) filter (where l.deep_automatic))::int,
         (count(*) filter (where l.deep_read and not l.deep_automatic))::int,
         (count(*) filter (where l.keyed))::int,
         (count(*) filter (where l.keyed_automatic))::int,
         (count(*) filter (where l.keyed and not l.keyed_automatic))::int,
         coalesce(sum(l.keyed_values), 0)::int,
         (count(*) filter (where l.waiting_deep))::int,
         (count(*) filter (where l.waiting_keyed))::int,
         (count(*) filter (where l.deep_state = 'unqueued'))::int,
         (count(*) filter (where l.keyed_state = 'unqueued'))::int,
         min(l.oldest_waiting_at),
         max(l.created_at)
    from public.image_stage_photo_levels(p_user_id, p_vehicle_id) l
   group by l.vehicle_id
$$;

-- levels, as the object image_stage_coverage(uuid) returns.
create or replace function public.image_stage_levels_json(p_vehicle_id uuid)
returns jsonb language sql stable set search_path to '' as $$
  with pl as materialized (select l.* from public.image_stage_photo_levels(null, p_vehicle_id) l),
  c as (select * from public.image_stage_level_counts(null, p_vehicle_id)),
  -- what is left to do, per stage and photo: the states of image_stage_photo_levels (a photo that is done is not waiting)
  ws as (
    select 'deep_reading'::text as stage, l.deep_state as st, l.deep_detail as dt from pl l where l.deep_state <> 'done'
    union all
    select 'keyed_values', l.keyed_state, l.keyed_detail from pl l where l.keyed_state <> 'done'
  ), stages as (select unnest(array['deep_reading', 'keyed_values']) as stage)
  select jsonb_build_object(
    'population', 'photos filed to this vehicle, whoever owns them, not duplicate and not superseded',
    'photos', coalesce((select landed from c), 0),
    'with_pixels', coalesce((select with_pixels from c), 0),
    'first_read', coalesce((select first_read from c), 0),
    'deep_read', jsonb_build_object('total', coalesce((select deep_read from c), 0),
      'automatic', coalesce((select deep_read_automatic from c), 0), 'by_hand', coalesce((select deep_read_by_hand from c), 0)),
    'keyed', jsonb_build_object('photos', coalesce((select keyed_photos from c), 0), 'automatic', coalesce((select keyed_automatic from c), 0),
      'by_hand', coalesce((select keyed_by_hand from c), 0), 'values', coalesce((select keyed_values from c), 0),
      'basis', 'photos with a current registered-property value witnessed by the photo (a descriptor-only value is not counted here; model_gain.keyed counts both kinds, every photo row, once per observation); values = those witnessed values summed over photos; by_hand = not made by a succeeded receipt for the current reading'),
    'waiting', (select jsonb_object_agg(s.stage, jsonb_build_object(
        'queued', (select count(*) from ws where ws.stage = s.stage and ws.st = 'queued'),
        'claimed', (select count(*) from ws where ws.stage = s.stage and ws.st = 'claimed'),
        'unqueued', (select count(*) from ws where ws.stage = s.stage and ws.st = 'unqueued'),
        'retrying', jsonb_build_object('photos', (select count(*) from ws where ws.stage = s.stage and ws.st = 'retrying'),
          'commonest_error_class', (select x.dt from (select ws.dt, count(*) n from ws where ws.stage = s.stage and ws.st = 'retrying' group by 1 order by 2 desc, 1 limit 1) x)),
        'given_up', (select count(*) from ws where ws.stage = s.stage and ws.st = 'given_up'),
        'receipt_without_result', (select count(*) from ws where ws.stage = s.stage and ws.st = 'receipt_without_result'),
        'closed_no_value', jsonb_build_object('photos', (select count(*) from ws where ws.stage = s.stage and ws.st = 'closed_no_value'),
          'by_reason', coalesce((select jsonb_object_agg(x.dt, x.n) from (select ws.dt, count(*) n from ws where ws.stage = s.stage and ws.st = 'closed_no_value' group by 1) x), '{}'::jsonb)),
        'not_eligible', jsonb_build_object('photos', (select count(*) from ws where ws.stage = s.stage and ws.st = 'not_eligible'),
          'by_condition', coalesce((select jsonb_object_agg(x.dt, x.n) from (select ws.dt, count(*) n from ws where ws.stage = s.stage and ws.st = 'not_eligible' group by 1) x), '{}'::jsonb)),
        'out_of_scope', (select count(*) from ws where ws.stage = s.stage and ws.st = 'out_of_scope'),
        'no_reading', (select count(*) from ws where ws.stage = s.stage and ws.st = 'no_reading'))) from stages s),
    'timing', (select jsonb_build_object(
        'photos_measured', count(*) filter (where keyed_automatic),
        'basis', 'automatic photos only: from the photo''s created_at to the first value the projection wrote for it, and from the first deep_reading item that finished to the keyed_values receipt',
        'photo_to_first_keyed_value_minutes', jsonb_build_object(
          'median', round((percentile_cont(0.5) within group (order by extract(epoch from first_keyed_at - created_at) / 60) filter (where keyed_automatic))::numeric, 1),
          'p90', round((percentile_cont(0.9) within group (order by extract(epoch from first_keyed_at - created_at) / 60) filter (where keyed_automatic))::numeric, 1)),
        'deep_reading_queued_to_keyed_receipt_minutes', jsonb_build_object(
          'median', round((percentile_cont(0.5) within group (order by extract(epoch from keyed_receipt_at - deep_work_at) / 60) filter (where keyed_automatic and deep_work_at is not null))::numeric, 1),
          'p90', round((percentile_cont(0.9) within group (order by extract(epoch from keyed_receipt_at - deep_work_at) / 60) filter (where keyed_automatic and deep_work_at is not null))::numeric, 1)))
      from pl)
  )
$$;

-- The same counts for a whole library: one row per vehicle that holds this user's photos, and one (vehicle_id null) for
-- the unfiled ones. The caller is the user themself, or the service role.
create or replace function public.image_stage_levels(p_user_id uuid)
returns table (
  vehicle_id uuid, landed integer, with_pixels integer, first_read integer, has_embedding integer, filed integer, gate_approved integer, gate_undecided integer,
  deep_read_automatic integer, deep_read_by_hand integer, keyed_automatic integer, keyed_by_hand integer,
  waiting_deep integer, waiting_keyed integer, unqueued_deep integer, unqueued_keyed integer, oldest_waiting_at timestamptz, newest_photo_at timestamptz)
language plpgsql stable security definer set search_path to '' as $$
begin
  if coalesce(auth.role(), 'postgres') not in ('service_role', 'postgres') and auth.uid() is distinct from p_user_id then
    raise exception 'image_stage_levels: only the owner of the photos or the service role may read them' using errcode = '42501';
  end if;
  return query
    select c.vehicle_id, c.landed, c.with_pixels, c.first_read, c.has_embedding, c.filed, c.gate_approved, c.gate_undecided,
           c.deep_read_automatic, c.deep_read_by_hand, c.keyed_automatic, c.keyed_by_hand,
           c.waiting_deep, c.waiting_keyed, c.unqueued_deep, c.unqueued_keyed, c.oldest_waiting_at, c.newest_photo_at
      from public.image_stage_level_counts(p_user_id, null) c
     order by c.vehicle_id nulls last;
end $$;
comment on function public.image_stage_levels(uuid) is
  'Where a user''s data is, per vehicle (null = unfiled): photos landed, with pixels, first-read, embedded, filed, gate-approved, deep-read and keyed (automatic by a succeeded stage receipt, by hand otherwise), and what waits (waiting = queued or claimed; unqueued = a gap no work item exists for yet). Every photo of a vehicle that holds one of the user''s, whoever owns it. Same definitions as image_stage_coverage(vehicle).levels (image_stage_photo_levels). Migration 20261120130000.';

-- image_stage_coverage(uuid): levels beside model_gain (kept as it was)
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
  'logic_version','image_stage_coverage(vehicle)/20261120130000',
  'levels',public.image_stage_levels_json(p_vehicle_id),
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

-- ===== 7. the flow watch
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
  v_scope_on boolean := false; v_rs record; v_stages jsonb := '{}'::jsonb; v_rs_reasons text[] := '{}';
  v_rs_due bigint; v_rs_oldest timestamptz; v_rs_claimed bigint; v_rs_receipts_6h bigint; v_rs_closed_6h bigint; v_rs_last timestamptz;
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
    -- The two reading stages (20261120130000): what is due, what was written, and whether the chain to keyed data moves.
    -- Work that has been due for longer than the queue wait with no succeeded or closed receipt in the same window is a
    -- stall named by its stage; a receipt that only says the reader failed does not count as the stage moving.
    -- (only while the reading scope is on: with it off, work left in the queue is waiting to be dropped, not stalled)
    SELECT coalesce(config_value -> 'enabled' = 'true'::jsonb, false) INTO v_scope_on FROM platform_config WHERE config_key = 'image_stage_deep_reading';
    v_scope_on := coalesce(v_scope_on, false);
    FOR v_rs IN SELECT s.stage FROM image_pipeline_stages s WHERE s.applies_when IN ('filed_for_reading', 'deep_reading_landed') ORDER BY s.stage LOOP
      SELECT count(*) FILTER (WHERE status = 'queued' AND not_before <= now()),
             min(created_at) FILTER (WHERE status = 'queued' AND not_before <= now()),
             count(*) FILTER (WHERE status = 'claimed')
        INTO v_rs_due, v_rs_oldest, v_rs_claimed
        FROM image_stage_work WHERE stage = v_rs.stage AND status IN ('queued', 'claimed');
      SELECT count(*) FILTER (WHERE observed_at > now() - c_queue_wait),
             count(*) FILTER (WHERE observed_at > now() - c_queue_wait AND outcome IN ('succeeded', 'policy_skip')),
             max(observed_at)
        INTO v_rs_receipts_6h, v_rs_closed_6h, v_rs_last
        FROM image_stage_receipts WHERE stage = v_rs.stage AND observed_at > now() - interval '7 days';
      v_stages := v_stages || jsonb_build_object(v_rs.stage, jsonb_build_object('due_now', v_rs_due, 'oldest_due_queued_at', v_rs_oldest,
        'claimed', v_rs_claimed, 'receipts_6h', v_rs_receipts_6h, 'succeeded_or_closed_6h', v_rs_closed_6h, 'last_receipt_at', v_rs_last));
      IF v_stage_on AND v_scope_on AND v_rs_due > 0 AND v_rs_oldest < now() - c_queue_wait AND v_rs_closed_6h = 0 THEN
        v_rs_reasons := v_rs_reasons || format('%s_stalled: %s photos are due in the %s stage queue (oldest queued %s) and no receipt succeeded or closed one in 6 h',
                                               v_rs.stage, v_rs_due, v_rs.stage, to_char(v_rs_oldest AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'));
      END IF;
    END LOOP;
    v_stage := v_stage || jsonb_build_object('stages', v_stages);
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
  v_reasons := v_reasons || v_rs_reasons;

  v_out := jsonb_build_object(
    'status', CASE WHEN cardinality(v_reasons) = 0 THEN 'passed' ELSE 'failed' END,
    'reasons', to_jsonb(v_reasons),
    'checked_at', now(),
    'method', 'assay_photo_reading_flow v3',
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

-- ===== grants: service role only, except the owner's own levels
revoke all on function public.enqueue_image_stage_work(uuid[], text) from public, anon, authenticated;
revoke all on function public.image_stage_backfill_cap_left(text) from public, anon, authenticated;
revoke all on function public.image_stage_photo_block(uuid, text, boolean, boolean, text, boolean, boolean, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.image_stage_scope_ok(jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.image_stage_reading_observation_id(jsonb) from public, anon, authenticated;
revoke all on function public.image_stage_reading_parent(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.image_stage_stage_room(text) from public, anon, authenticated;
revoke all on function public.image_stage_keyed_child_exists(uuid, uuid) from public, anon, authenticated;
revoke all on function public.image_stage_reading_is_thin(text) from public, anon, authenticated;
revoke all on function public.image_stage_photo_levels(uuid, uuid) from public, anon, authenticated;
revoke all on function public.image_stage_level_counts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.image_stage_levels_json(uuid) from public, anon, authenticated;
revoke all on function public.image_stage_levels(uuid) from public, anon;
grant execute on function public.enqueue_image_stage_work(uuid[], text), public.image_stage_backfill_cap_left(text),
  public.image_stage_photo_block(uuid, text, boolean, boolean, text, boolean, boolean, boolean, boolean, text, text),
  public.image_stage_scope_ok(jsonb, uuid, uuid), public.image_stage_reading_observation_id(jsonb),
  public.image_stage_reading_parent(uuid, uuid, uuid), public.image_stage_stage_room(text), public.image_stage_keyed_child_exists(uuid, uuid),
  public.image_stage_reading_is_thin(text),
  public.image_stage_photo_levels(uuid, uuid), public.image_stage_level_counts(uuid, uuid), public.image_stage_levels_json(uuid),
  public.image_stage_levels(uuid) to service_role;
grant execute on function public.image_stage_levels(uuid) to authenticated;

commit;
