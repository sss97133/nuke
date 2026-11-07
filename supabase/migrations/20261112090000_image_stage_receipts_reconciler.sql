-- Per-image versioned stage receipts + reconciler.
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

set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- registry
create table if not exists public.image_pipeline_stages (
  stage text primary key,
  producer text not null,
  required_version integer not null default 1 check (required_version >= 1),
  required boolean not null default false,
  applies_when text not null default 'always' check (applies_when in ('always', 'document_like')),
  max_attempts integer not null default 6 check (max_attempts between 1 and 50),
  legacy_unavailable_key text,
  description text not null
);
comment on table public.image_pipeline_stages is
  'Photo pipeline stages. required=true: the reconciler enqueues images that lack a receipt at required_version. Bump required_version to declare older receipts outdated. Closed list of applicability predicates, no executable SQL.';

insert into public.image_pipeline_stages (stage, producer, required_version, required, applies_when, legacy_unavailable_key, description) values
  ('classifier',  'photo-pipeline-orchestrator', 1, true,  'always',        null,                 'Model image-type classification (the paid stage).'),
  ('exif',        'derive-image-exif',           1, false, 'always',        null,                 'Capture time / GPS from the original bytes. Registered, not yet required: flip required after a canary.'),
  ('engine_bay',  'analyze-engine-bay',          1, false, 'always',        'analyze-engine-bay', 'Engine-bay analysis; #3024 records stage_unavailable when the function is not deployed.'),
  ('receipt_ocr', 'receipt-extract',             1, false, 'document_like', 'receipt-photo-ocr',  'OCR / itemization for receipt-like photos. Not required until the route is verified live.')
on conflict (stage) do nothing;

-- ---------------------------------------------------------------- receipts (append-only)
create table if not exists public.image_stage_receipts (
  id bigint generated always as identity primary key,
  image_id uuid not null references public.vehicle_images(id) on delete cascade,
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
  'Append-only: one row per stage attempt on an image (producer, version, outcome, clock). Outcomes: succeeded, policy_skip (decided not to run), blocked_input (input unusable until it changes), unavailable (stage not deployed), rate_limited (provider said wait), failed. Written only by record_image_stage_receipt().';
comment on column public.image_stage_receipts.producer_version is 'Integer version of the stage producer; compared with image_pipeline_stages.required_version.';
comment on column public.image_stage_receipts.retry_after is 'Earliest next attempt for unavailable / rate_limited; NULL otherwise.';
comment on column public.image_stage_receipts.input_fingerprint is 'Hash of the input the stage read (e.g. file_hash); a changed input makes a blocked_input receipt retryable.';
create index if not exists image_stage_receipts_latest_idx on public.image_stage_receipts (image_id, stage, producer_version desc, attempt desc);

-- ---------------------------------------------------------------- work queue
create table if not exists public.image_stage_work (
  id bigint generated always as identity primary key,
  image_id uuid not null references public.vehicle_images(id) on delete cascade,
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
  'Stage-level requeue written by reconcile_image_stages(); claimed by claim_image_stage_work(). One open item per (image, stage).';
-- idempotency: the reconciler can run any number of times and never double-queues
create unique index if not exists image_stage_work_one_open on public.image_stage_work (image_id, stage) where status in ('queued', 'claimed');
create index if not exists image_stage_work_claim_idx on public.image_stage_work (stage, lane, not_before, id) where status = 'queued';

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
revoke all on public.image_pipeline_stages, public.image_stage_receipts, public.image_stage_work, public.image_stage_reconciler_state from public, anon, authenticated;
grant select on public.image_pipeline_stages, public.image_stage_receipts, public.image_stage_work, public.image_stage_reconciler_state to service_role;

insert into public.platform_config (config_key, config_value, description) values
  ('image_stage_reconciler',
   '{"enabled": false, "live_days": 2, "scan_per_lane": 1000, "max_open": 300, "backfill_share": 0.5, "min_age_minutes": 15}'::jsonb,
   'reconcile_image_stages(): enabled gate, live window, rows scanned per lane per run, cap on open work items, backfill share of each run budget, grace before an upload is considered a gap.')
on conflict (config_key) do nothing;

-- ---------------------------------------------------------------- latest-receipt view
create or replace view public.image_stage_current with (security_invoker = true) as
  select distinct on (image_id, stage) image_id, stage, producer, producer_version, outcome, attempt, observed_at, retry_after, error_class
  from public.image_stage_receipts
  order by image_id, stage, producer_version desc, attempt desc;
comment on view public.image_stage_current is 'Newest receipt per (image, stage) by version then attempt.';
revoke all on public.image_stage_current from public, anon, authenticated;
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
-- true = an output for this stage already exists on the row, so the stage is not paid for again.
-- Classifier shapes seen on live completed rows (parent read-only sample, 2026-11-07 05:05 AST; a sample, not a census):
--   A  classification.classifier_ok = true                      (~60%, newest orchestrator)
--   B  photo_pipeline.receipt.outcome = 'completed'             (orchestrator receipt)
--   C  classification{image_type, confidence} + pipeline_version ('v2' mostly, some 'v1'); no classifier_ok, no receipt
--      (the rest of completed rows; extra keys such as description, is_automotive, detected_text, vin_detected vary)
--   none: no pipeline_version / no classification (~3%) => a real gap.
-- Shape C needs all three: image_type a non-empty string, confidence a JSON number, pipeline_version a non-empty string.
-- A bare classification object without pipeline_version is not evidence of a finished run.
-- Legacy v1 vs required_version: required_version counts receipt versions (image_stage_receipts.producer_version), a
-- different scale from the legacy pipeline_version label. v1 produced the same fields (image_type + confidence) the
-- consumers read, so it is NOT outdated; re-paying the classifier on it would buy no field it lacks. A real quality
-- change is declared by bumping required_version AND writing receipts; legacy evidence never invents a receipt.
-- image_stage_legacy_version() names the legacy producer ('legacy-v1', 'legacy-v2') for reports; it is a read, not a receipt.
create or replace function public.image_stage_legacy_version(p_stage text, p_meta jsonb)
returns text language sql immutable as $$
  select case p_stage
    when 'classifier' then
      case when coalesce(p_meta #>> '{photo_pipeline,receipt,outcome}', '') = 'completed'
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

create or replace function public.image_stage_legacy_evidence(p_stage text, p_meta jsonb, p_exif jsonb)
returns boolean language sql immutable as $$
  select case p_stage
    when 'classifier' then public.image_stage_legacy_version('classifier', p_meta) is not null
    when 'exif' then p_exif is not null and p_exif <> '{}'::jsonb
    else false end
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
--   missing           no receipt at any version and no legacy output
--   outdated          newest receipt is below required_version (and no legacy output)
--   retryable_outcome newest receipt at the required version is unavailable / rate_limited, retry_after has passed and
--                     attempts remain; or a #3024 stage_unavailable marker with no newer receipt
-- Not gaps: succeeded / policy_skip / blocked_input / failed at the required version (typed, not blindly retried;
-- blocked_input becomes retryable by an input change = a new input_fingerprint, handled by the producer writing a new receipt).
create or replace function public.image_stage_gaps(p_image_ids uuid[])
returns table(image_id uuid, stage text, reason text, target_version integer, not_before timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select v.id, s.stage,
         case when c.image_id is null and public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key) then 'retryable_outcome'
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
      (c.image_id is null and (not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data)
                               or public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key)))
      or (c.producer_version < s.required_version and not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data))
      or (c.producer_version >= s.required_version and c.outcome in ('unavailable', 'rate_limited')
          and c.retry_after <= now()
          and c.attempt < s.max_attempts)
    )
$$;

-- ---------------------------------------------------------------- reconciler
create or replace function public.reconcile_image_stages(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' as $$
declare
  v_cfg jsonb; v_open int; v_budget int; v_live_budget int; v_back_budget int;
  v_lane text; v_lane_budget int; v_scan int; v_ids uuid[]; v_last record; v_enq int;
  v_classifier_blocked boolean; v_out jsonb := '{}'::jsonb; v_carry int := 0; v_total int := 0;
begin
  -- one reconciler at a time; a second caller is a no-op rather than a queue of waiters
  if not pg_try_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0)) then return jsonb_build_object('skipped', 'already_running'); end if;
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then return jsonb_build_object('skipped', 'disabled'); end if;

  select count(*) into v_open from public.image_stage_work where status in ('queued', 'claimed');
  v_budget := least(greatest(p_limit, 0), greatest(coalesce((v_cfg ->> 'max_open')::int, 300) - v_open, 0), 500);
  if v_budget = 0 then return jsonb_build_object('skipped', 'queue_full', 'open', v_open); end if;
  -- fair split: new uploads always get their share; whatever live does not use rolls to the backfill
  v_back_budget := floor(v_budget * least(greatest(coalesce((v_cfg ->> 'backfill_share')::numeric, 0.5), 0), 1));
  v_live_budget := v_budget - v_back_budget;
  v_scan := least(greatest(coalesce((v_cfg ->> 'scan_per_lane')::int, 1000), 1), 5000);
  -- the classifier is provider-gated (#3025 breaker): while it cools down do not pile up classifier work
  v_classifier_blocked := exists (select 1 from public.photo_pipeline_provider_state p where p.provider = 'classifier' and p.blocked_until > now());

  foreach v_lane in array array['live', 'backfill'] loop
    v_lane_budget := case v_lane when 'live' then v_live_budget else v_back_budget + v_carry end;
    -- candidate scan: bounded, keyset-paged on (created_at, id); eligibility mirrors claim_photo_pipeline_batch + privacy holds
    if v_lane = 'live' then
      select coalesce(array_agg(x.id), '{}') into v_ids from (
        select v.id from public.vehicle_images v
        where v.created_at >= now() - make_interval(days => coalesce((v_cfg ->> 'live_days')::int, 2))
          and v.created_at <= now() - make_interval(mins => coalesce((v_cfg ->> 'min_age_minutes')::int, 15))
          and v.user_id is not null and v.is_duplicate is not true and v.image_url is not null
          and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false
          and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
          and coalesce(v.ai_processing_status, '') not in ('pending', 'processing')
        order by v.created_at desc, v.id desc limit v_scan) x;
    else
      select coalesce(array_agg(x.id), '{}') into v_ids from (
        select v.id from public.vehicle_images v, public.image_stage_reconciler_state st
        where st.lane = 'backfill'
          and (st.cursor_created_at is null or (v.created_at, v.id) > (st.cursor_created_at, st.cursor_id))
          and v.created_at < now() - make_interval(days => coalesce((v_cfg ->> 'live_days')::int, 2))
          and v.user_id is not null and v.is_duplicate is not true and v.image_url is not null
          and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false
          and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
          and coalesce(v.ai_processing_status, '') not in ('pending', 'processing')
        order by v.created_at asc, v.id asc limit v_scan) x;   -- oldest first
    end if;

    with gaps as (
      select g.*, v.created_at from public.image_stage_gaps(v_ids) g join public.vehicle_images v on v.id = g.image_id
      where not (v_classifier_blocked and g.stage = 'classifier')
        and not exists (select 1 from public.image_stage_work w where w.image_id = g.image_id and w.stage = g.stage and w.status in ('queued', 'claimed'))
        -- #3025: an image still inside its own rate-limit backoff belongs to that path
        and not exists (select 1 from public.photo_pipeline_retry_state r where g.stage = 'classifier' and r.image_id = g.image_id and (r.terminal or r.next_attempt_at > now()))
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
      if coalesce(array_length(v_ids, 1), 0) = 0 then
        update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null, wrapped_at = now(), last_run_at = now(), last_scanned = 0, last_enqueued = v_enq where lane = 'backfill';
      else
        select v.created_at, v.id into v_last from public.vehicle_images v where v.id = any (v_ids) order by v.created_at desc, v.id desc limit 1;
        update public.image_stage_reconciler_state set cursor_created_at = v_last.created_at, cursor_id = v_last.id, last_run_at = now(), last_scanned = array_length(v_ids, 1), last_enqueued = v_enq where lane = 'backfill';
      end if;
    else
      update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = coalesce(array_length(v_ids, 1), 0), last_enqueued = v_enq where lane = 'live';
      v_carry := greatest(v_lane_budget - v_enq, 0);
    end if;
    v_out := v_out || jsonb_build_object(v_lane, jsonb_build_object('scanned', coalesce(array_length(v_ids, 1), 0), 'enqueued', v_enq, 'budget', v_lane_budget));
    v_total := v_total + v_enq;
  end loop;
  return v_out || jsonb_build_object('enqueued', v_total, 'open_before', v_open, 'classifier_blocked', v_classifier_blocked);
end $$;
comment on function public.reconcile_image_stages(integer) is
  'Finds images missing a required stage, at an outdated version, or with a retryable unavailable/rate_limited receipt and enqueues only that stage. Idempotent (one open item per image+stage), bounded (scan_per_lane, max_open, p_limit<=500), fair (live lane first, backfill oldest-first, unused live budget rolls over). No provider calls, no status writes. Gated by platform_config image_stage_reconciler.enabled.';

-- ---------------------------------------------------------------- claim (for stage workers)
create or replace function public.claim_image_stage_work(p_stage text, p_limit integer default 8, p_lease_seconds integer default 300)
returns table(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int := least(greatest(p_limit, 1), 25);
begin
  if p_stage = 'classifier' and exists (select 1 from public.photo_pipeline_provider_state p where p.provider = 'classifier' and p.blocked_until > now()) then return; end if;
  return query
  with due as (
    select w.id, w.lane,
           row_number() over (partition by w.lane order by case when w.lane = 'live' then -extract(epoch from w.created_at) else extract(epoch from w.created_at) end, w.id) rn
    from public.image_stage_work w
    where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
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

-- only the service role may call any of these
revoke all on function public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.image_stage_gaps(uuid[]) from public, anon, authenticated;
revoke all on function public.reconcile_image_stages(integer) from public, anon, authenticated;
revoke all on function public.claim_image_stage_work(text, integer, integer) from public, anon, authenticated;
revoke all on function public.release_expired_image_stage_work() from public, anon, authenticated;
revoke all on function public.image_stage_legacy_version(text, jsonb), public.image_stage_legacy_evidence(text, jsonb, jsonb), public.image_stage_legacy_unavailable(jsonb, text) from public, anon, authenticated;
grant execute on function public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb),
  public.image_stage_gaps(uuid[]), public.reconcile_image_stages(integer), public.claim_image_stage_work(text, integer, integer),
  public.release_expired_image_stage_work(), public.image_stage_legacy_version(text, jsonb), public.image_stage_legacy_evidence(text, jsonb, jsonb), public.image_stage_legacy_unavailable(jsonb, text) to service_role;

-- ---------------------------------------------------------------- cron (inert until platform_config enabled=true)
select cron.schedule('image-stage-reconciler', '*/5 * * * *',
  $c$set statement_timeout = '30s'; select public.release_expired_image_stage_work(); select public.reconcile_image_stages(100)$c$);
