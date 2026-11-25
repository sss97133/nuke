-- A preview filed to a vehicle is a photo of that vehicle: it enters the reading stages like any filed photo.
--
-- Measured 2026-11-24 (production): 21 owner photos came in on 11-15 through ingest_image_identity_first in
-- processing_mode 'subscription_review' (20261115182056, PR #3545): cached Photos renditions, exif_data.source_rendition
-- contract 'photos_cached_preview_v1', bytes in the project's own storage. That intake must set owner_verified = false
-- (library custody does not say who took the photo), and owner_verified = false derives is_external = true. 14 of them
-- were later filed to one vehicle through the reviewed filing path (approved gate, first read completed, classification
-- present); 7 are unfiled. The stage ledger read is_external as "not this owner's photo" in five functions, so the 14
-- have 0 image_stage_work rows and 0 receipts: image_stage_photo_block answers 'external' for them, and the reconciler,
-- the event enqueue and the claim drop them from their row filters. Neither #3545 nor #3547 gives a reason to keep a
-- filed preview from reading; is_external there records custody of the original, not whose photo it is.
--
-- 1. image_stage_custody_external(is_external, user_id, source, exif_data): is_external as the stage ledger reads it.
--    True for every external photo except an owner's own cached preview: user_id set, source 'iphoto' and rendition
--    contract 'photos_cached_preview_v1' (the only contract the intake admits, and the only one production holds).
-- 2. image_stage_gaps and image_stage_photo_levels pass it to image_stage_photo_block as p_external (signature unchanged),
--    so a filed, approved, first-read preview is a deep_reading gap and the levels name its real block.
-- 3. reconcile_image_stages, enqueue_image_stage_work and claim_image_stage_work admit a row whose is_external is true
--    only when it is filed and the helper says it is not external. An unfiled preview stays out of every stage, the
--    classifier's included, as before: the reviewed intake supplies its first read.
-- The classifier stage is unchanged for previews: a filed preview carries its retained classification, which closes that
-- stage (image_stage_gaps over the 21 on 2026-11-24 returned no classifier row). Not changed: enqueue_first_read (its
-- callers are the insert trigger on ai_processing_status = 'pending' and the provider path's failure retry; a preview
-- lands 'skipped' and is not sent to the provider, its first read is the reviewed classification), image_stage_photo_block,
-- the stage rooms, caps, lanes and claim order. No DDL, index or trigger on vehicle_images; no row of any testimony table.
-- The deep reader applies the same custody rule (scripts/photo-pipeline/deep-stage.mjs custodyExternal, PR #3796, merged
-- first), so a claimed preview is read, not closed with a policy_skip 'external' receipt.
-- Contract: supabase/sql/test_image_stage_preview_eligibility.sql.
-- Revert: supabase/sql/revert_20261124214000_image_stage_preview_eligibility.sql.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '25s';   -- long enough to wait out one reconciler run
select pg_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0));
set local lock_timeout = '3s';

-- The replaced bodies are the ones read from production on 2026-11-24; refuse a body changed since.
-- A replay finds this migration's own bodies and passes (the second md5 of each pair).
do $guard$
declare r record;
begin
  for r in select * from (values
      ('public.image_stage_gaps(uuid[])', '2603ca428eceb41a6f08513326f57008', 'a3f55af9690bdfdb56795c3838eeead0'),
      ('public.image_stage_photo_levels(uuid,uuid)', 'a690d620d07b414631049417588f468e', '0cc83b37709597e32172d3fb0464b17a'),
      ('public.reconcile_image_stages(integer)', '7699c4293e008456fb731a9251d4633e', '3b467cd151aa073bab955c604deffcd8'),
      ('public.enqueue_image_stage_work(uuid[],text)', '700e76f34436e437369193a692bd216b', '8dd14150b907483cfe35aecd5b22fe62'),
      ('public.claim_image_stage_work(text,integer,integer,uuid)', 'f0f94d7e84a2907789c89099eb33a2e7', '1bff5de34a128ea6092e13fcaceb2dfd'),
      ('public.image_stage_photo_block(uuid,text,boolean,boolean,text,boolean,boolean,boolean,boolean,text,text)',
       'e4c179f2a0551904d7f7f2449e5bc4ce', 'e4c179f2a0551904d7f7f2449e5bc4ce')) as t(fn, md5_before, md5_after) loop
    if coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing') not in (r.md5_before, r.md5_after) then
      raise exception '% is not the body this migration replaces (md5 %); review before applying', r.fn,
        coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing');
    end if;
  end loop;
end $guard$;

-- 1. custody as the stage ledger reads it. No vehicle, part or state vocabulary: the intake's own contract value only.
create or replace function public.image_stage_custody_external(p_is_external boolean, p_user_id uuid, p_source text, p_exif jsonb)
 returns boolean
 language sql
 immutable
 parallel safe
as $function$
  select case
    when p_is_external is not true then false
    -- the owner's own cached Photos preview (20261115182056): is_external records that the original is not held, not
    -- that the photo is someone else's
    when p_user_id is not null and p_source = 'iphoto'
         and p_exif -> 'source_rendition' ->> 'contract' = 'photos_cached_preview_v1' then false
    else true
  end $function$;
comment on function public.image_stage_custody_external(boolean, uuid, text, jsonb) is
  'is_external as the image stage ledger reads it: true for an external photo, false for the owner''s own cached Photos preview (user_id set, source iphoto, exif_data.source_rendition.contract photos_cached_preview_v1; 20261115182056), which is is_external only because the intake cannot claim the original. Passed to image_stage_photo_block as p_external and used by the reconciler, the enqueue and the claim for filed rows (20261124214000).';
revoke all on function public.image_stage_custody_external(boolean, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.image_stage_custody_external(boolean, uuid, text, jsonb) to service_role;

-- 2. and 3. the five bodies as production held them, with only the is_external lines changed

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
  -- not thin tier. rd.le = the photo carries a stamp with a scene. A stamp is never a thin reading's (the intake stamps only a
  -- reading that is not thin, and refuses a thin one over any stamp), so a stamped photo is read, whoever stamped it. rd.thin = no
  -- such stamp, and the reading the photo holds as an observation is thin tier (no tier at all = a legacy reading = reviewed).
  left join lateral (select public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data, s.contract) as le,
                            case when s.applies_when = 'filed_for_reading'
                                      and not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data, s.contract)
                                 then public.image_stage_reading_is_thin((select o.agent_tier from public.vehicle_observations o where o.id = kp.id))
                                 else false end as thin) rd on true
  -- the newest receipt of this stage whatever its outcome (image_stage_current prefers a closing one)
  left join lateral (select r.outcome, r.observed_at, r.retry_after, r.attempt from public.image_stage_receipts r
                      where s.applies_when = 'deep_reading_landed' and r.image_id = v.id and r.stage = s.stage and r.producer_version >= s.required_version
                      order by r.observed_at desc, r.id desc limit 1) lr on true
  where v.id = any (p_image_ids)
    and (s.applies_when = 'always'
         or (s.applies_when = 'document_like' and coalesce(v.ai_scan_metadata #>> '{classification,image_type}', '') in ('receipt', 'document', 'invoice', 'text_document'))
         or (s.applies_when in ('filed_for_reading', 'deep_reading_landed')
             and public.image_stage_photo_block(v.vehicle_id, v.vision_gate_status::text, v.is_document, v.doc_flag, v.image_vehicle_match_status,
                   v.is_sensitive, v.is_duplicate, v.is_superseded, public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data), v.image_url, v.ai_processing_status) is null
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
$function$
;

CREATE OR REPLACE FUNCTION public.image_stage_photo_levels(p_user_id uuid, p_vehicle_id uuid)
 RETURNS TABLE(image_id uuid, vehicle_id uuid, created_at timestamp with time zone, with_pixels boolean, first_read boolean, has_embedding boolean, filed boolean, gate_approved boolean, gate_undecided boolean, deep_read boolean, deep_automatic boolean, keyed boolean, keyed_values integer, keyed_automatic boolean, waiting_deep boolean, waiting_keyed boolean, oldest_waiting_at timestamp with time zone, first_keyed_at timestamp with time zone, deep_work_at timestamp with time zone, keyed_receipt_at timestamp with time zone, obs_id uuid, block text, in_scope boolean, deep_state text, deep_detail text, keyed_state text, keyed_detail text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with cfg as (select pc.config_value as c from public.platform_config pc where pc.config_key = 'image_stage_deep_reading'),
  base as (
    select v.id, v.vehicle_id, v.user_id, v.created_at, v.image_url, v.ai_processing_status,
           v.vision_gate_status::text as gate, v.image_vehicle_match_status as match_status,
           public.image_stage_legacy_evidence('deep_reading', v.ai_scan_metadata, null, null) as has_reading,
           public.image_stage_reading_observation_id(v.ai_scan_metadata) as stamp_obs,
           public.image_stage_photo_block(v.vehicle_id, v.vision_gate_status::text, v.is_document, v.doc_flag, v.image_vehicle_match_status,
                                          v.is_sensitive, v.is_duplicate, v.is_superseded, public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data), v.image_url, v.ai_processing_status) as block
      from public.vehicle_images v
     where p_vehicle_id is not null and v.vehicle_id = p_vehicle_id
       and v.is_duplicate is not true and coalesce(v.is_superseded, false) = false
    union all
    select v.id, v.vehicle_id, v.user_id, v.created_at, v.image_url, v.ai_processing_status,
           v.vision_gate_status::text, v.image_vehicle_match_status,
           public.image_stage_legacy_evidence('deep_reading', v.ai_scan_metadata, null, null),
           public.image_stage_reading_observation_id(v.ai_scan_metadata),
           public.image_stage_photo_block(v.vehicle_id, v.vision_gate_status::text, v.is_document, v.doc_flag, v.image_vehicle_match_status,
                                          v.is_sensitive, v.is_duplicate, v.is_superseded, public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data), v.image_url, v.ai_processing_status)
      from public.vehicle_images v
     where p_vehicle_id is null and p_user_id is not null and v.user_id = p_user_id and v.vehicle_id is null
       and v.is_duplicate is not true and coalesce(v.is_superseded, false) = false
    union all
    select v.id, v.vehicle_id, v.user_id, v.created_at, v.image_url, v.ai_processing_status,
           v.vision_gate_status::text, v.image_vehicle_match_status,
           public.image_stage_legacy_evidence('deep_reading', v.ai_scan_metadata, null, null),
           public.image_stage_reading_observation_id(v.ai_scan_metadata),
           public.image_stage_photo_block(v.vehicle_id, v.vision_gate_status::text, v.is_document, v.doc_flag, v.image_vehicle_match_status,
                                          v.is_sensitive, v.is_duplicate, v.is_superseded, public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data), v.image_url, v.ai_processing_status)
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
           kr.outcome as kr_outcome, kr.error_class as kr_error, kr.detail as kr_detail, kr.observed_at as kr_at, kr.producer_version as kr_ver,
           (select s3.required_version from public.image_pipeline_stages s3 where s3.stage = 'keyed_values') as keyed_req,
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
      left join lateral (select r.outcome, r.error_class, r.detail, r.observed_at, r.producer_version from public.image_stage_receipts r
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
           -- gap finder reads it (image_stage_reading_is_thin; a reading with no tier at all is a legacy one, reviewed). A stamped
           -- photo (has_reading) is never thin: the intake stamps only a reading that is not thin
           (not r.has_reading and r.par_id is not null
            and public.image_stage_reading_is_thin(r.par_tier)
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
              when j.rd_outcome is not null and j.rd_ver < j.deep_req then 'unqueued'
              when j.rd_outcome = 'policy_skip' then 'closed_no_value'
              when j.rd_outcome = 'succeeded' then 'receipt_without_result'
              when j.rd_outcome in ('blocked_input', 'failed') then 'given_up'
              when j.rd_outcome is not null then 'retrying'
              else 'unqueued' end,
         case when j.deep_read_z and not j.thin_open then null
              when j.block is not null then j.block
              when j.user_id is null then 'no_owner'
              when not j.scope_ok or j.dopen_status is not null then null
              when j.rd_outcome is not null and j.rd_ver < j.deep_req then null
              when j.rd_outcome = 'policy_skip' then coalesce(j.rd_detail ->> 'skipped', j.rd_detail ->> 'reason', 'unspecified')
              when j.rd_outcome is not null then coalesce(j.rd_error, 'unspecified') end,
         case when j.child then 'done'
              when j.block is not null then case when j.deep_read_z then 'not_eligible' else 'no_reading' end
              when j.par_id is null then 'no_reading'
              when j.user_id is null then 'not_eligible'
              when not j.scope_ok then 'out_of_scope'
              when j.kopen_status is not null then j.kopen_status
              when j.kr_outcome is not null and j.kr_ver < j.keyed_req then 'unqueued'
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
              when j.kr_outcome is not null and j.kr_ver < j.keyed_req then null
              when j.kr_outcome = 'policy_skip' and not j.kr_stale then coalesce(j.kr_detail ->> 'skipped', j.kr_detail ->> 'reason', 'unspecified')
              when j.kr_stale then case when j.klr_at >= j.par_at then coalesce(j.klr_error, 'unspecified') end
              when j.kr_outcome is not null then coalesce(j.kr_error, 'unspecified') end
    from st j
$function$
;

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
      -- and the filed, approved photos landed within live_due_days that have not reached the end of the chain (no closing
      -- keyed_values receipt): a photo that became due after its live window (filed days after it landed, a reading scope
      -- widened after its first read, or its filing event found the stage room full) is new to the reader and is not left
      -- to the backfill cursor (20261124210000; measured 2026-11-24: one such photo, three days old, had only the cursor).
      -- Read from the capture-ledger index (vehicle_id and vision_gate_status are included columns): 0.7 s for the
      -- owner's 30,414 rows.
      select coalesce(array_agg(distinct y.id), '{}') into v_cand from (
        select unnest(v_cand) as id
        union
        select d.id from (
          select c.id from public.vehicle_images c
          where c.user_id is not null and (v_users is null or c.user_id = any (v_users))
            and c.vehicle_id is not null and coalesce(c.vision_gate_status::text, 'approved') = 'approved'
            and c.created_at >= now() - make_interval(days => greatest(coalesce((v_cfg ->> 'live_due_days')::int, 14), 0))
            and c.created_at <= now() - make_interval(mins => coalesce((v_cfg ->> 'min_age_minutes')::int, 15))
            and not exists (select 1 from public.image_stage_receipts r where r.image_id = c.id and r.stage = 'keyed_values'
                              and r.outcome in ('succeeded', 'policy_skip'))
          order by c.created_at desc, c.id desc limit v_scan) d) y;
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
       and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and (v.is_external is not true or (v.vehicle_id is not null and not public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data))) and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
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
end $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_image_stage_work(p_image_ids uuid[], p_lane text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and (v.is_external is not true or (v.vehicle_id is not null and not public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data)))
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
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_image_stage_work(p_stage text, p_limit integer DEFAULT 8, p_lease_seconds integer DEFAULT 300, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n int := least(greatest(p_limit, 1), 25);
begin
  update public.image_stage_work d set status = 'dropped', finished_at = now(), lease_until = null
   where d.id in (
     select w.id from public.image_stage_work w
     left join public.vehicle_images v on v.id = w.image_id
     where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
       and (p_user_id is null or v.user_id = p_user_id or v.id is null)
       and not coalesce(v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and (v.is_external is not true or (v.vehicle_id is not null and not public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data))) and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal', false)
     order by w.id limit 200 for update of w skip locked);
  return query
  with due as (
    select w.id, w.lane,
           row_number() over (partition by w.lane order by case when w.lane = 'live' then -extract(epoch from w.created_at) else extract(epoch from w.created_at) end, w.id) rn
    from public.image_stage_work w
    join public.vehicle_images v on v.id = w.image_id
    where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
      and (p_user_id is null or v.user_id = p_user_id)
      and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and (v.is_external is not true or (v.vehicle_id is not null and not public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data))) and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
      -- a pipeline run is in flight on the photo (the reconciler's own rule): leave the item queued until it ends or goes stale
      and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes')
    ), pick as (
      -- interleave: live #1, backfill #1, live #2, ... ; a lane with nothing due simply yields to the other
      select d.id from due d order by d.rn, case when d.lane = 'live' then 0 else 1 end limit v_n
    ), locked as (
      select w.id, w.image_id from public.image_stage_work w where w.id in (select id from pick) and w.status = 'queued' for update skip locked
    ), still as (
      -- another path may have read the photo while the item waited (the paid drain, a hand run, a receipt that was
      -- written after its lease ran out): judge the gap again on the few picked rows, so a read is never spent twice
      select g.image_id from public.image_stage_gaps(array(select l.image_id from locked l)) g where g.stage = p_stage
    ), upd as (
      update public.image_stage_work w
         set status = case when l.image_id in (select s.image_id from still s) then 'claimed' else 'dropped' end,
             lease_until = case when l.image_id in (select s.image_id from still s) then now() + make_interval(secs => greatest(p_lease_seconds, 30)) end,
             finished_at = case when l.image_id in (select s.image_id from still s) then null else now() end
      from locked l where w.id = l.id returning w.*
    )
  select u.id, u.image_id, i.image_url, i.user_id, i.vehicle_id, u.lane, u.reason, u.target_version
  from upd u join public.vehicle_images i on i.id = u.image_id
  where u.status = 'claimed';
end $function$
;

commit;
