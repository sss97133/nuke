-- Per-image versioned stage receipts + reconciler.
--
-- Design and first version: draft #3027 (2026-11-07), which recorded "SQL unexecuted". This version was executed on
-- PostgreSQL 16 with its contract (supabase/sql/test_image_stage_receipts_reconciler.sql) and differs in four ways:
--  * image_pipeline_stages.contract: a pre-receipt reading stands in for a receipt only when it was produced under the
--    stage's current output contract (classifier: classification.v2.prompt_version = 'v98'). Read from production
--    2026-11-10: 8,816 of 26,941 owner images had no classification and 6,737 carried a legacy "other" classification
--    with no v2 block; both are gaps under the contract. Set contract to NULL to accept any finished output.
--  * candidate scans take ids from the partial index idx_vehicle_images_capture_ledger (index-only, ~32k entries) and
--    judge eligibility by primary key; production's plan for that shape was read with EXPLAIN on 2026-11-10.
--  * claim_image_stage_work takes p_user_id, so a reader running on one user's subscription claims only their photos.
--  * image_stage_coverage(): per stage, what is open, what the latest receipts say, and where the reconciler stands.
-- Revert: supabase/sql/revert_20261113110000_image_stage_receipts_reconciler.sql.
--
-- Problem (docs: library coverage 2026-11-07): the photo drain claims only ai_processing_status='pending', and
-- 'completed' / 'skipped' / 'failed' say nothing about which stage actually ran. 1,494 owner rows have no
-- analysis indicator at all; 17,856 lack an indexed deep read. A provider 429 or an undeployed stage
-- (#3024 ai_scan_metadata.stage_unavailable, #3025 photo_pipeline_retry_state / provider breaker) is recorded in
-- places no sweep reads.
--
-- Model, chosen on purpose:
--  * ONE APPEND-ONLY TABLE of relational receipts (image_stage_receipts), not a jsonb column on vehicle_images.
--    A jsonb blob on the hottest public table has no CHECK on outcome/version, rewrites the whole wide row (and its
--    TOAST) on every stage write, is not indexable for "oldest image missing stage X", and overwrites history.
--    Rows give: closed outcome vocabulary (CHECK), FK to a stage registry, one index that answers the reconciler's
--    question, and history (a retry or a new producer version is a new row; nothing is overwritten).
--  * A STAGE REGISTRY (image_pipeline_stages): which stages exist, which are required, the current producer version.
--    Bumping required_version is how "outdated" is declared; no row is blanket-updated.
--  * LEGACY IS NOT FABRICATED. Old rows get no invented receipts. image_stage_legacy_evidence() reads the outputs
--    that already exist (classifier receipt, exif_data, #3024 stage_unavailable) so valid old work is never paid for
--    twice, and a legacy 'unavailable' marker counts as a retryable gap.
--  * A WORK QUEUE (image_stage_work) holding at most one open item per (image, stage), claimed by lane
--    (live / backfill) so new uploads and history are interleaved, never one starving the other.
--  * The reconciler never touches ai_processing_status and never calls a provider. It only enqueues. Disabled by default
--    (platform_config 'image_stage_reconciler'.enabled=false): the cron is a no-op until the owner enables it AND a
--    stage worker consumes image_stage_work.

--
-- Reviewed 2026-11-10 by two independent readers, with the contract executed on PostgreSQL 16; what they found is in
-- this version:
--  * One transaction. CI applies files with psql and no -1, so every statement used to commit on its own, and a lock
--    timeout on a vehicle_images foreign key would have left tables without their revokes. The two foreign keys are
--    added last, under a short lock_timeout, so SHARE ROW EXCLUSIVE on vehicle_images is held only until commit.
--  * service_role holds SELECT only on the four tables (default privileges gave it ALL); the definer functions write.
--  * The paid provider's breaker and retry table gate neither the reconciler nor a claim: the subscription reader never
--    calls that provider, and the breaker was blocking it. Rows are skipped only while a run is in flight.
--  * image_stage_reconciler.user_ids scopes the reconciler to users who have a reader; unclaimed work for other users
--    would otherwise fill max_open and stop the queue.
--  * A claim re-checks privacy eligibility and drops items for photos that became sensitive, personal, duplicate or
--    superseded while queued.
--  * Retryable outcomes past max_attempts are offered again after a day (a reader-wide outage must not retire photos).
--  * A photo the orchestrator policy-skipped is a finished decision, not a gap. A failed stand-in is not a reading.
--  * blocked_input is offered again when the image URL changes (input_fingerprint = md5(image_url)).
--  * The backfill lane walks everything older than the grace period, so a bulk upload larger than the live scan waits
--    minutes, not days.
begin;
set local statement_timeout = '60s';
set local lock_timeout = '2s';

-- ---------------------------------------------------------------- registry
create table if not exists public.image_pipeline_stages (
  stage text primary key,
  producer text not null,
  required_version integer not null default 1 check (required_version >= 1),
  required boolean not null default false,
  applies_when text not null default 'always' check (applies_when in ('always', 'document_like')),
  max_attempts integer not null default 6 check (max_attempts between 1 and 50),
  legacy_unavailable_key text,
  contract text,
  description text not null
);
alter table public.image_pipeline_stages add column if not exists contract text;   -- the 2026-11-07 draft shape lacked it
comment on table public.image_pipeline_stages is
  'Photo pipeline stages. required=true: the reconciler enqueues images that lack a receipt at required_version. Bump required_version to declare older receipts outdated. contract: the output contract a pre-receipt reading must carry to count as done (NULL = any finished output counts). Closed list of applicability predicates, no executable SQL.';
comment on column public.image_pipeline_stages.contract is
  'Output contract an existing (pre-receipt) reading must carry to stand in for a receipt. classifier: the prompt_version in ai_scan_metadata.classification.v2 (v98 on 2026-11-10). NULL accepts any finished output. Read 2026-11-10: of 26,941 owner images in the yield snapshot, 8,816 had no classification and 6,737 carried a legacy "other" classification with no v2 block (mean confidence 0.283); under contract v98 both are gaps, under NULL only the first. Seeded once; a later change by the owner survives a replay of this file.';

insert into public.image_pipeline_stages (stage, producer, required_version, required, applies_when, legacy_unavailable_key, contract, description) values
  ('classifier',  'photo-pipeline-orchestrator', 1, true,  'always',        null,                 'v98', 'First-level reading of one photo under the classifier contract: image type, description, text lines, cited vehicle fields, VIN, angle, document kind. Read by a provider or by a subscription reader posting classification_raw.'),
  ('exif',        'derive-image-exif',           1, false, 'always',        null,                 null,  'Capture time / GPS from the original bytes. Registered, not yet required: flip required after a canary.'),
  ('engine_bay',  'analyze-engine-bay',          1, false, 'always',        'analyze-engine-bay', null,  'Engine-bay analysis; #3024 records stage_unavailable when the function is not deployed.'),
  ('receipt_ocr', 'receipt-extract',             1, false, 'document_like', 'receipt-photo-ocr',  null,  'OCR / itemization for receipt-like photos. Not required until the route is verified live.')
on conflict (stage) do nothing;

-- ---------------------------------------------------------------- receipts (append-only)
-- The foreign keys to vehicle_images are added at the end of this file.
create table if not exists public.image_stage_receipts (
  id bigint generated always as identity primary key,
  image_id uuid not null,
  stage text not null references public.image_pipeline_stages(stage),
  producer text not null,
  producer_version integer not null check (producer_version >= 1),
  outcome text not null check (outcome in ('succeeded', 'policy_skip', 'blocked_input', 'unavailable', 'rate_limited', 'failed')),
  attempt integer not null default 1 check (attempt >= 1),
  observed_at timestamptz not null default now(),
  retry_after timestamptz,
  error_class text,
  http_status integer,
  input_fingerprint text,
  detail jsonb not null default '{}'::jsonb,
  unique (image_id, stage, producer_version, attempt),
  -- a retry time only makes sense for an outcome that can be retried
  constraint stage_receipt_retry_only_retryable check (retry_after is null or outcome in ('unavailable', 'rate_limited')),
  -- every non-success says why, typed (an outage is never an unexplained 'failed')
  constraint stage_receipt_reason_required check (outcome in ('succeeded', 'policy_skip') or error_class is not null),
  constraint stage_receipt_detail_object check (jsonb_typeof(detail) = 'object')
);
comment on table public.image_stage_receipts is
  'Append-only: one row per stage attempt on an image (producer, version, outcome, clock). Outcomes: succeeded, policy_skip (decided not to run), blocked_input (input unusable until it changes), unavailable (transient fault or stage not deployed), rate_limited (compute said wait), failed (not retried). Written only by record_image_stage_receipt(); the service role can read it and nothing else.';
comment on column public.image_stage_receipts.producer_version is 'Integer version of the stage producer; compared with image_pipeline_stages.required_version.';
comment on column public.image_stage_receipts.retry_after is 'Earliest next attempt for unavailable / rate_limited; NULL otherwise.';
comment on column public.image_stage_receipts.input_fingerprint is 'Hash of the input the stage read (readers pass md5(image_url)). A blocked_input receipt is offered again when md5 of the image''s current URL differs.';
create index if not exists image_stage_receipts_latest_idx on public.image_stage_receipts (image_id, stage, producer_version desc, attempt desc);
create index if not exists image_stage_receipts_stage_time_idx on public.image_stage_receipts (stage, observed_at desc);

-- ---------------------------------------------------------------- work queue
create table if not exists public.image_stage_work (
  id bigint generated always as identity primary key,
  image_id uuid not null,
  stage text not null references public.image_pipeline_stages(stage),
  target_version integer not null,
  reason text not null check (reason in ('missing', 'outdated', 'retryable_outcome')),
  lane text not null check (lane in ('live', 'backfill')),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'dropped')),
  not_before timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
comment on table public.image_stage_work is
  'Stage-level requeue written by reconcile_image_stages(); claimed by claim_image_stage_work(). One open item per (image, stage). dropped = the photo stopped being eligible while queued.';
-- idempotency: the reconciler can run any number of times and never double-queues
create unique index if not exists image_stage_work_one_open on public.image_stage_work (image_id, stage) where status in ('queued', 'claimed');
create index if not exists image_stage_work_claim_idx on public.image_stage_work (stage, lane, not_before, id) where status = 'queued';
create index if not exists image_stage_work_image_idx on public.image_stage_work (image_id);

create table if not exists public.image_stage_reconciler_state (
  lane text primary key check (lane in ('live', 'backfill')),
  cursor_created_at timestamptz,
  cursor_id uuid,
  last_run_at timestamptz,
  last_scanned integer,
  last_enqueued integer,
  wrapped_at timestamptz
);
comment on table public.image_stage_reconciler_state is 'Keyset cursor (created_at, id) per lane so a bounded scan resumes exactly where it stopped and never skips ties.';
insert into public.image_stage_reconciler_state (lane) values ('live'), ('backfill') on conflict do nothing;

alter table public.image_pipeline_stages enable row level security;
alter table public.image_stage_receipts enable row level security;
alter table public.image_stage_work enable row level security;
alter table public.image_stage_reconciler_state enable row level security;
-- default privileges in production give service_role ALL on new tables: take it back, then grant reads only
revoke all on public.image_pipeline_stages, public.image_stage_receipts, public.image_stage_work, public.image_stage_reconciler_state from public, anon, authenticated, service_role;
revoke all on sequence public.image_stage_receipts_id_seq, public.image_stage_work_id_seq from public, anon, authenticated, service_role;
grant select on public.image_pipeline_stages, public.image_stage_receipts, public.image_stage_work, public.image_stage_reconciler_state to service_role;

insert into public.platform_config (config_key, config_value, description) values
  ('image_stage_reconciler',
   '{"enabled": false, "live_days": 2, "scan_per_lane": 1000, "max_open": 300, "backfill_share": 0.5, "min_age_minutes": 15}'::jsonb,
   'reconcile_image_stages(): enabled gate; user_ids (array of user uuids that have a reader; absent = every user); live window in days; rows scanned per lane per run; cap on open work items; backfill share of each run budget; grace before an upload is considered a gap.')
on conflict (config_key) do nothing;

-- ---------------------------------------------------------------- latest-receipt view
-- Newest receipt per (image, stage): highest version first; within a version a success or policy skip outranks a later
-- non-success (two workers on one item must not turn a read photo back into work), then the highest attempt.
create or replace view public.image_stage_current with (security_invoker = true) as
  select distinct on (image_id, stage) image_id, stage, producer, producer_version, outcome, attempt, observed_at, retry_after, error_class, input_fingerprint
  from public.image_stage_receipts
  order by image_id, stage, producer_version desc, (outcome in ('succeeded', 'policy_skip')) desc, attempt desc;
comment on view public.image_stage_current is 'Current receipt per (image, stage): highest version; within it a success or policy skip wins, then the highest attempt.';
revoke all on public.image_stage_current from public, anon, authenticated, service_role;
grant select on public.image_stage_current to service_role;

-- ---------------------------------------------------------------- writer for producers
create or replace function public.record_image_stage_receipt(
  p_image_id uuid, p_stage text, p_producer_version integer, p_outcome text,
  p_error_class text default null, p_http_status integer default null, p_retry_after_seconds integer default null,
  p_input_fingerprint text default null, p_detail jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;

-- ---------------------------------------------------------------- legacy evidence (reads, never writes)
-- What an image row already holds for a stage, so finished work is not done twice. Classifier shapes on live rows:
--   current   classification.v2.prompt_version (the contract), classifier_ok true, classifier_receipt
--   receipt   photo_pipeline.receipt.outcome = 'completed', or classifier_ok = true, with no v2 block (thin prompt)
--   legacy C  classification{image_type, confidence} + pipeline_version, no classifier_ok, no receipt
--   skip      the orchestrator decided not to read it: top-level skipped, or photo_pipeline.receipt.outcome = 'policy_skip'
--   stand-in  classification{image_type 'other', confidence 0.2, classifier_ok false}: a failure, never a reading
-- image_stage_legacy_version() names what is there, for reports and for the 'outdated' reason; it is a read, not a receipt.
create or replace function public.image_stage_legacy_version(p_stage text, p_meta jsonb)
returns text language sql immutable as $$
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
$$;

-- true = the row already holds this stage's output, so no receipt is needed.
-- p_contract (image_pipeline_stages.contract): when set, a classifier reading counts only if it was produced under that
-- contract (classification.v2.prompt_version) and was not a failed stand-in; an older finished reading is then reported
-- as 'outdated' by image_stage_gaps. A policy skip counts under any contract: the decision not to read stands.
create or replace function public.image_stage_legacy_evidence(p_stage text, p_meta jsonb, p_exif jsonb, p_contract text default null)
returns boolean language sql immutable as $$
  select coalesce(case p_stage
    when 'classifier' then
      public.image_stage_legacy_version('classifier', p_meta) = 'orchestrator-policy-skip'
      or case when p_contract is null then public.image_stage_legacy_version('classifier', p_meta) is not null
              else coalesce(p_meta #>> '{classification,v2,prompt_version}', '') = p_contract
                   and coalesce(p_meta #>> '{classification,classifier_ok}', 'true') <> 'false'
                   and jsonb_typeof(p_meta #> '{classification,image_type}') = 'string' end
    when 'exif' then p_exif is not null and p_exif <> '{}'::jsonb
    else false end, false)
$$;

-- #3024: ai_scan_metadata.stage_unavailable = [{stage, status:'unavailable', retryable:true, at}] keyed by function name.
create or replace function public.image_stage_legacy_unavailable(p_meta jsonb, p_key text)
returns boolean language sql immutable as $$
  select p_key is not null and exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(p_meta -> 'stage_unavailable') = 'array' then p_meta -> 'stage_unavailable' else '[]'::jsonb end) e
    where e ->> 'stage' = p_key and coalesce((e ->> 'retryable')::boolean, true))
$$;

-- ---------------------------------------------------------------- gap finder (pure read)
-- For a batch of images, which required stages need work and why.
--   missing           no receipt at any version and no finished output on the row
--   outdated          newest receipt is below required_version, or the row holds a finished reading that does not meet
--                     the stage's contract (an older generation's output)
--   retryable_outcome the current receipt at the required version is unavailable / rate_limited and its retry_after has
--                     passed (while attempts remain, or once a day after they run out: an outage is not the photo's
--                     fault); or it is blocked_input and the image URL has changed since; or a #3024 stage_unavailable
--                     marker with no newer receipt
-- Not gaps: succeeded / policy_skip / failed at the required version, and blocked_input while the input is unchanged.
create or replace function public.image_stage_gaps(p_image_ids uuid[])
returns table(image_id uuid, stage text, reason text, target_version integer, not_before timestamptz)
language sql stable set search_path = public, pg_temp as $$
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
$$;

-- ---------------------------------------------------------------- reconciler
-- Eligibility, stated once and repeated verbatim in claim_image_stage_work (a contract test compares the two): a photo
-- with an owner and a URL that is not a duplicate, not sensitive, not external, not superseded and not rejected as
-- personal. A row is skipped only while a pipeline run is in flight on it (status 'processing', started under 30 minutes
-- ago). The paid drain's 'pending' status, its retry rows and its provider breaker are not consulted: they describe one
-- producer, and that producer being down is exactly when this queue is needed.
create or replace function public.reconcile_image_stages(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg jsonb; v_open int; v_budget int; v_live_budget int; v_back_budget int; v_users uuid[];
  v_lane text; v_lane_budget int; v_scan int; v_cand uuid[]; v_ids uuid[]; v_last record; v_enq int;
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

  select count(*) into v_open from public.image_stage_work where status in ('queued', 'claimed');
  v_budget := least(greatest(p_limit, 0), greatest(coalesce((v_cfg ->> 'max_open')::int, 300) - v_open, 0), 500);
  if v_budget = 0 then return jsonb_build_object('skipped', 'queue_full', 'open', v_open); end if;
  -- fair split: new uploads always get their share; whatever live does not use rolls to the backfill
  v_back_budget := floor(v_budget * least(greatest(coalesce((v_cfg ->> 'backfill_share')::numeric, 0.5), 0), 1));
  v_live_budget := v_budget - v_back_budget;
  v_scan := least(greatest(coalesce((v_cfg ->> 'scan_per_lane')::int, 1000), 1), 5000);

  foreach v_lane in array array['live', 'backfill'] loop
    v_lane_budget := case v_lane when 'live' then v_live_budget else v_back_budget + v_carry end;
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
       and v.is_duplicate is not true and v.image_url is not null and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
       and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes');

    with gaps as (
      select g.*, v.created_at from public.image_stage_gaps(v_ids) g join public.vehicle_images v on v.id = g.image_id
      where not exists (select 1 from public.image_stage_work w where w.image_id = g.image_id and w.stage = g.stage and w.status in ('queued', 'claimed'))
      order by case when v_lane = 'live' then extract(epoch from v.created_at) else -extract(epoch from v.created_at) end desc, g.stage
      limit v_lane_budget
    ), ins as (
      insert into public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
      select image_id, stage, target_version, reason, v_lane, not_before from gaps
      on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing
      returning 1
    ) select count(*) into v_enq from ins;

    -- advance the backfill cursor over everything scanned (not only what was enqueued), wrap at the end
    if v_lane = 'backfill' then
      if coalesce(array_length(v_cand, 1), 0) = 0 then
        update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null, wrapped_at = now(), last_run_at = now(), last_scanned = 0, last_enqueued = v_enq where lane = 'backfill';
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
end $$;
comment on function public.reconcile_image_stages(integer) is
  'Finds images missing a required stage, at an outdated version or contract, or with a retryable receipt, and enqueues only that stage. Idempotent (one open item per image+stage), bounded (scan_per_lane, max_open, p_limit<=500), fair (live lane first, backfill oldest-first by cursor, unused live budget rolls over), scoped to platform_config image_stage_reconciler.user_ids when set. No provider calls, no status writes, no dependence on the paid drain''s state. Gated by image_stage_reconciler.enabled.';

-- ---------------------------------------------------------------- claim (for stage workers)
-- p_user_id scopes a claim to one user's photos (a reader running on that user's own subscription reads only theirs).
-- Eligibility is judged again here: an item can wait for hours, and a photo marked sensitive or personal meanwhile must
-- not reach a reader. Items for photos that stopped being eligible are dropped (bounded per call).
create or replace function public.claim_image_stage_work(p_stage text, p_limit integer default 8, p_lease_seconds integer default 300, p_user_id uuid default null)
returns table(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int := least(greatest(p_limit, 1), 25);
begin
  update public.image_stage_work d set status = 'dropped', finished_at = now(), lease_until = null
   where d.id in (
     select w.id from public.image_stage_work w
     left join public.vehicle_images v on v.id = w.image_id
     where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
       and (p_user_id is null or v.user_id = p_user_id or v.id is null)
       and not coalesce(v.is_duplicate is not true and v.image_url is not null and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal', false)
     order by w.id limit 200 for update of w skip locked);
  return query
  with due as (
    select w.id, w.lane,
           row_number() over (partition by w.lane order by case when w.lane = 'live' then -extract(epoch from w.created_at) else extract(epoch from w.created_at) end, w.id) rn
    from public.image_stage_work w
    join public.vehicle_images v on v.id = w.image_id
    where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
      and (p_user_id is null or v.user_id = p_user_id)
      and v.is_duplicate is not true and v.image_url is not null and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
    ), pick as (
      -- interleave: live #1, backfill #1, live #2, ... ; a lane with nothing due simply yields to the other
      select d.id from due d order by d.rn, case when d.lane = 'live' then 0 else 1 end limit v_n
    ), locked as (
      select w.id from public.image_stage_work w where w.id in (select id from pick) and w.status = 'queued' for update skip locked
    ), upd as (
      update public.image_stage_work w set status = 'claimed', lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
      from locked where w.id = locked.id returning w.*
    )
  select u.id, u.image_id, i.image_url, i.user_id, i.vehicle_id, u.lane, u.reason, u.target_version
  from upd u join public.vehicle_images i on i.id = u.image_id;
end $$;

-- expired leases go back to the queue (a crashed worker never strands an item)
create or replace function public.release_expired_image_stage_work()
returns integer language sql security definer set search_path = public, pg_temp as $$
  with r as (update public.image_stage_work set status = 'queued', lease_until = null
              where status = 'claimed' and lease_until < now() returning 1)
  select count(*)::int from r
$$;

-- ---------------------------------------------------------------- coverage (pure read, small tables only)
-- Per stage: the queue (open items by lane and reason, oldest queued, items due now), the current receipt per image by
-- outcome, receipts in the last 6 h and 24 h, and the reconciler's position. Reads image_stage_* only; it does not
-- count images that need no receipt because an existing reading meets the contract (that needs each row's
-- ai_scan_metadata, which only the reconciler's bounded scan reads).
create or replace function public.image_stage_coverage()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'checked_at', now(),
    'enabled', coalesce((select (config_value ->> 'enabled')::boolean from public.platform_config where config_key = 'image_stage_reconciler'), false),
    'user_ids', (select config_value -> 'user_ids' from public.platform_config where config_key = 'image_stage_reconciler'),
    'reconciler', (select coalesce(jsonb_object_agg(lane, jsonb_build_object('cursor_created_at', cursor_created_at, 'last_run_at', last_run_at,
                      'last_scanned', last_scanned, 'last_enqueued', last_enqueued, 'wrapped_at', wrapped_at)), '{}'::jsonb)
                     from public.image_stage_reconciler_state),
    'stages', (select coalesce(jsonb_object_agg(s.stage, jsonb_build_object(
        'required', s.required, 'required_version', s.required_version, 'contract', s.contract, 'producer', s.producer,
        'open', (select jsonb_build_object(
                   'queued', count(*) filter (where w.status = 'queued'),
                   'claimed', count(*) filter (where w.status = 'claimed'),
                   'due_now', count(*) filter (where w.status = 'queued' and w.not_before <= now()),
                   'oldest_queued_at', min(w.created_at) filter (where w.status = 'queued'),
                   'by_lane', coalesce((select jsonb_object_agg(lane, n) from (select w2.lane, count(*) n from public.image_stage_work w2
                                         where w2.stage = s.stage and w2.status in ('queued', 'claimed') group by 1) l), '{}'::jsonb),
                   'by_reason', coalesce((select jsonb_object_agg(reason, n) from (select w3.reason, count(*) n from public.image_stage_work w3
                                           where w3.stage = s.stage and w3.status in ('queued', 'claimed') group by 1) r), '{}'::jsonb))
                 from public.image_stage_work w where w.stage = s.stage and w.status in ('queued', 'claimed')),
        'closed', coalesce((select jsonb_object_agg(status, n) from (select w4.status, count(*) n from public.image_stage_work w4
                                           where w4.stage = s.stage and w4.status in ('done', 'dropped') group by 1) d), '{}'::jsonb),
        'current_receipt_by_outcome', coalesce((select jsonb_object_agg(outcome, n) from (select c.outcome, count(*) n from public.image_stage_current c
                                                where c.stage = s.stage group by 1) o), '{}'::jsonb),
        'out_of_attempts', (select count(*) from public.image_stage_current c where c.stage = s.stage
                             and c.outcome in ('unavailable', 'rate_limited') and c.attempt >= s.max_attempts),
        'receipts_6h', (select count(*) from public.image_stage_receipts r where r.stage = s.stage and r.observed_at > now() - interval '6 hours'),
        'receipts_24h', (select count(*) from public.image_stage_receipts r where r.stage = s.stage and r.observed_at > now() - interval '24 hours'),
        'last_receipt_at', (select max(r.observed_at) from public.image_stage_receipts r where r.stage = s.stage))), '{}'::jsonb)
      from public.image_pipeline_stages s))
$$;
comment on function public.image_stage_coverage() is
  'Per stage: open work (queued, claimed, due now, by lane and reason), closed work (done, dropped), the current receipt per image by outcome, images out of retry attempts, receipts in 6 h and 24 h, and the reconciler cursor and user scope. Reads image_stage_* only. Service role only.';

-- only the service role may call any of these
revoke all on function public.image_stage_coverage() from public, anon, authenticated;
revoke all on function public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.image_stage_gaps(uuid[]) from public, anon, authenticated;
revoke all on function public.reconcile_image_stages(integer) from public, anon, authenticated;
revoke all on function public.claim_image_stage_work(text, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.release_expired_image_stage_work() from public, anon, authenticated;
revoke all on function public.image_stage_legacy_version(text, jsonb), public.image_stage_legacy_evidence(text, jsonb, jsonb, text), public.image_stage_legacy_unavailable(jsonb, text) from public, anon, authenticated;
grant execute on function public.image_stage_coverage(), public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb),
  public.image_stage_gaps(uuid[]), public.reconcile_image_stages(integer), public.claim_image_stage_work(text, integer, integer, uuid),
  public.release_expired_image_stage_work(), public.image_stage_legacy_version(text, jsonb), public.image_stage_legacy_evidence(text, jsonb, jsonb, text), public.image_stage_legacy_unavailable(jsonb, text) to service_role;

-- ---------------------------------------------------------------- cron (inert until platform_config enabled=true)
-- Every 10 minutes on an offset minute (20261112070000 moved jobs off :00/:10/...); the only consumer reads 20 frames
-- per 10 minutes and max_open is 300, so a faster cadence buys nothing.
do $$
declare j bigint;
begin
  if to_regnamespace('cron') is null then return; end if;
  for j in select jobid from cron.job where jobname = 'image-stage-reconciler' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('image-stage-reconciler', '8-59/10 * * * *',
    $c$set statement_timeout = '30s'; select public.release_expired_image_stage_work(); select public.reconcile_image_stages(100)$c$);
end $$;

-- ---------------------------------------------------------------- foreign keys to vehicle_images, last
-- Each takes SHARE ROW EXCLUSIVE on vehicle_images until commit; both tables are empty, so nothing is validated. With
-- lock_timeout 2 s a busy moment fails the whole file cleanly (nothing is left behind) and the deploy is re-run.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'image_stage_receipts_image_id_fkey' and conrelid = 'public.image_stage_receipts'::regclass) then
    alter table public.image_stage_receipts add constraint image_stage_receipts_image_id_fkey foreign key (image_id) references public.vehicle_images(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'image_stage_work_image_id_fkey' and conrelid = 'public.image_stage_work'::regclass) then
    alter table public.image_stage_work add constraint image_stage_work_image_id_fkey foreign key (image_id) references public.vehicle_images(id) on delete cascade;
  end if;
end $$;
commit;
