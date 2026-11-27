-- DRAFT — NOT APPLIED. Do not move into supabase/migrations/ without Skylar's explicit yes.
-- Model registry: one place that says which model does which task, what it costs,
-- how it scored on the frozen gold set, and when it was promoted or retired.
--
-- Design notes
-- * Additive only: new tables + functions. Nothing existing is altered or dropped.
-- * Service-role only. RLS on, no policies for anon/authenticated.
-- * Cost tracking reuses public.llm_cost_tracking (provider, model, task, caller,
--   input_tokens, output_tokens, cost_cents, duration_ms). Shadow calls are written
--   there with caller = 'shadow:<task>' so the budget check below can sum them.
-- * No spend happens because of this file. Candidates are inert until a human sets
--   approved_by and moves them to 'shadow'.

begin;

-- ---------------------------------------------------------------- tasks
create table if not exists public.model_tasks (
  task                 text primary key,                -- e.g. 'photo_classify'
  description          text not null,
  modality             text not null check (modality in ('vision','text','document','embedding','on_device')),
  output_schema_ref    text,                            -- prompt/schema version the scorer expects
  min_gold_cases       int  not null default 200,       -- promotion needs at least this many scored cases
  privacy_critical     boolean not null default false,  -- privacy recall may never regress
  noninferiority_pts   numeric not null default 1.0,    -- accuracy margin (percentage points) for "equal accuracy"
  cheaper_factor       numeric not null default 0.70,   -- "significantly cheaper" = cost <= 70% of active
  max_latency_factor   numeric not null default 1.50,   -- p95 latency may grow at most 1.5x
  quality_floor_model  text,                            -- optional policy floor (e.g. Claude callers floored at sonnet-5-5)
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------- registry
create table if not exists public.model_registry (
  id                   uuid primary key default gen_random_uuid(),
  task                 text not null references public.model_tasks(task),
  provider             text not null check (provider in ('openai','anthropic','google','xai','mistral','ollama','modal','apple','claude_cli','local')),
  model                text not null,                   -- API id as sent, e.g. 'gpt-6-luna'
  version              text,                            -- pinned snapshot when the provider has one, e.g. 'gpt-4.1-mini-2025-04-14'
  status               text not null default 'candidate'
                       check (status in ('candidate','shadow','active','fallback','retired')),
  fallback_rank        int,                             -- 1 = first fallback when active fails; null unless status='fallback'
  params               jsonb not null default '{}'::jsonb, -- reasoning effort, max_tokens, image detail, temperature
  price_input_per_mtok  numeric,                        -- USD, list price at time of entry
  price_output_per_mtok numeric,
  price_per_page        numeric,                        -- for per-page OCR APIs
  price_source_url     text,
  price_checked_at     date,
  est_cost_per_call_usd numeric,                        -- from eval runs (measured tokens), else estimate
  eval_accuracy        numeric,                         -- latest gold-set score, 0..1
  eval_privacy_recall  numeric,
  eval_p95_latency_ms  int,
  eval_run_id          uuid,
  shadow_agreement     numeric,                         -- agreement with active on the live shadow sample
  provider_deprecated_at date,                          -- provider announced deprecation
  provider_shutdown_at   date,                          -- provider stops serving (resolver skips on/after this)
  discovered_by        text,                            -- 'provider-watch' | 'manual'
  approved_by          text,                            -- required before status leaves 'candidate'
  approved_at          timestamptz,
  promoted_at          timestamptz,
  retired_at           timestamptz,
  retired_reason       text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists model_registry_identity
  on public.model_registry (task, provider, model, coalesce(version, ''));

-- exactly one active model per task
create unique index if not exists model_registry_one_active
  on public.model_registry (task) where status = 'active';
create unique index if not exists model_registry_fallback_rank
  on public.model_registry (task, fallback_rank) where status = 'fallback';

-- leaving 'candidate' requires a human approval
alter table public.model_registry drop constraint if exists model_registry_approval_gate;
alter table public.model_registry add constraint model_registry_approval_gate
  check (status in ('candidate','retired') or approved_by is not null);

-- ---------------------------------------------------------------- history
create table if not exists public.model_registry_events (
  id          bigint generated always as identity primary key,
  registry_id uuid not null references public.model_registry(id),
  task        text not null,
  from_status text,
  to_status   text not null,
  reason      text not null,
  actor       text not null,             -- 'skylar', 'provider-watch', 'resolver-auto-retire'
  evidence    jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);

-- ---------------------------------------------------------------- shadow budget
create table if not exists public.model_shadow_budget (
  task              text primary key references public.model_tasks(task),
  sample_pct        numeric not null default 0 check (sample_pct >= 0 and sample_pct <= 5),   -- hard max 5%
  monthly_cap_usd   numeric not null default 0 check (monthly_cap_usd >= 0 and monthly_cap_usd <= 25), -- hard max $25
  enabled           boolean not null default false,
  approved_by       text,
  updated_at        timestamptz not null default now(),
  check (not enabled or approved_by is not null)
);

-- ---------------------------------------------------------------- helpers

-- Month-to-date shadow spend for a task, from the existing cost ledger.
create or replace function public.model_shadow_spend_usd(p_task text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0) / 100.0
  from public.llm_cost_tracking
  where caller = 'shadow:' || p_task
    and created_at >= date_trunc('month', now());
$$;

-- The resolver. Every edge function calls this (via resolveModel.ts, cached 60s).
-- Returns the active model, then fallbacks in rank order, skipping anything past
-- its provider shutdown date. Also returns at most one shadow model when the
-- task's shadow budget is enabled and not yet spent; the caller still rolls the
-- sample_pct dice locally so the DB is not hit per request.
create or replace function public.resolve_model(p_task text)
returns table (role text, provider text, model text, version text, params jsonb,
               price_input_per_mtok numeric, price_output_per_mtok numeric, price_per_page numeric,
               shadow_sample_pct numeric)
language sql stable security definer set search_path = public as $$
  with live as (
    select r.* from public.model_registry r
    where r.task = p_task
      and (r.provider_shutdown_at is null or r.provider_shutdown_at > current_date)
  ),
  budget as (
    select b.sample_pct
    from public.model_shadow_budget b
    where b.task = p_task and b.enabled
      and public.model_shadow_spend_usd(p_task) < b.monthly_cap_usd
  )
  select role, provider, model, version, params, price_input_per_mtok, price_output_per_mtok, price_per_page, shadow_sample_pct
  from (
    select 0 as ord, 'active'::text as role, provider, model, version, params, price_input_per_mtok, price_output_per_mtok, price_per_page, null::numeric as shadow_sample_pct
    from live where status = 'active'
    union all
    select fallback_rank, 'fallback', provider, model, version, params, price_input_per_mtok, price_output_per_mtok, price_per_page, null
    from live where status = 'fallback'
    union all
    select 1000, 'shadow', s.provider, s.model, s.version, s.params, s.price_input_per_mtok, s.price_output_per_mtok, s.price_per_page, b.sample_pct
    from (select * from live where status = 'shadow' order by approved_at desc limit 1) s cross join budget b
  ) x
  order by ord;
$$;

-- Promotion rule, as a pure check. Returns (ok, reason). Does not change anything.
-- ok when, on the same frozen gold set:
--   (a) candidate accuracy >= active accuracy AND candidate cost <= active cost, or
--   (b) candidate accuracy >= active accuracy - noninferiority_pts AND cost <= cheaper_factor * active cost;
-- and always: enough gold cases, privacy recall not lower (privacy-critical tasks),
-- p95 latency within max_latency_factor, and shadow agreement measured.
create or replace function public.model_promotion_check(p_candidate uuid)
returns table (ok boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare c public.model_registry; a public.model_registry; t public.model_tasks; n int;
begin
  select * into c from public.model_registry where id = p_candidate;
  if not found then return query select false, 'candidate not found'; return; end if;
  select * into t from public.model_tasks where task = c.task;
  select * into a from public.model_registry where task = c.task and status = 'active';
  if not found then return query select (c.eval_accuracy is not null), 'no active model: first activation needs approval only'; return; end if;
  if c.eval_run_id is null or a.eval_run_id is null then return query select false, 'both models need a gold-set run'; return; end if;
  select count(*) into n from public.model_eval_results where run_id = c.eval_run_id;
  if n < t.min_gold_cases then return query select false, format('only %s gold cases (< %s)', n, t.min_gold_cases); return; end if;
  if t.privacy_critical and coalesce(c.eval_privacy_recall,0) < coalesce(a.eval_privacy_recall,0) then
    return query select false, 'privacy recall regressed'; return; end if;
  if c.eval_p95_latency_ms > a.eval_p95_latency_ms * t.max_latency_factor then
    return query select false, 'p95 latency too high'; return; end if;
  if c.shadow_agreement is null then return query select false, 'no shadow sample yet'; return; end if;
  if c.eval_accuracy >= a.eval_accuracy and c.est_cost_per_call_usd <= a.est_cost_per_call_usd then
    return query select true, 'better-or-equal accuracy at equal or lower cost'; return; end if;
  if c.eval_accuracy >= a.eval_accuracy - t.noninferiority_pts/100.0
     and c.est_cost_per_call_usd <= a.est_cost_per_call_usd * t.cheaper_factor then
    return query select true, 'equal accuracy (within margin) and significantly cheaper'; return; end if;
  return query select false, 'does not beat active on accuracy/cost';
end $$;

-- Promote: requires the check to pass AND a named human. Old active becomes fallback rank 1.
create or replace function public.model_promote(p_candidate uuid, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare chk record; c public.model_registry; old_active uuid;
begin
  if p_actor is null or p_actor = '' then raise exception 'promotion needs a named approver'; end if;
  select * into chk from public.model_promotion_check(p_candidate);
  if not chk.ok then raise exception 'promotion refused: %', chk.reason; end if;
  select * into c from public.model_registry where id = p_candidate for update;
  select id into old_active from public.model_registry where task = c.task and status = 'active' for update;
  if old_active is not null then
    -- two-step shift so the partial unique index on (task, fallback_rank) never sees a transient duplicate
    update public.model_registry set fallback_rank = -(fallback_rank + 1) where task = c.task and status = 'fallback';
    update public.model_registry set fallback_rank = -fallback_rank where task = c.task and status = 'fallback' and fallback_rank < 0;
    update public.model_registry set status = 'fallback', fallback_rank = 1, updated_at = now() where id = old_active;
    insert into public.model_registry_events(registry_id, task, from_status, to_status, reason, actor)
      values (old_active, c.task, 'active', 'fallback', 'superseded by ' || c.model, p_actor);
  end if;
  update public.model_registry set status = 'active', fallback_rank = null, promoted_at = now(), updated_at = now(),
    approved_by = coalesce(approved_by, p_actor), approved_at = coalesce(approved_at, now())
  where id = p_candidate;
  insert into public.model_registry_events(registry_id, task, from_status, to_status, reason, actor, evidence)
    values (p_candidate, c.task, c.status, 'active', chk.reason, p_actor,
            jsonb_build_object('accuracy', c.eval_accuracy, 'cost_per_call', c.est_cost_per_call_usd, 'run', c.eval_run_id));
end $$;

-- Auto-retire: run daily (and by provider-watch). Anything past provider shutdown is retired.
-- If the retired row was active, the best fallback is promoted to active automatically
-- (that keeps the pipeline running; it is the only automatic status change into 'active').
create or replace function public.model_retire_expired()
returns int language plpgsql security definer set search_path = public as $$
declare r record; nxt uuid; k int := 0;
begin
  for r in select * from public.model_registry
           where status <> 'retired' and provider_shutdown_at is not null and provider_shutdown_at <= current_date
           for update loop
    update public.model_registry set status = 'retired', fallback_rank = null, retired_at = now(),
      retired_reason = 'provider shutdown ' || r.provider_shutdown_at, updated_at = now() where id = r.id;
    insert into public.model_registry_events(registry_id, task, from_status, to_status, reason, actor)
      values (r.id, r.task, r.status, 'retired', 'provider shutdown ' || r.provider_shutdown_at, 'resolver-auto-retire');
    if r.status = 'active' then
      select id into nxt from public.model_registry where task = r.task and status = 'fallback' order by fallback_rank limit 1;
      if nxt is not null then
        update public.model_registry set status = 'active', fallback_rank = null, promoted_at = now(), updated_at = now() where id = nxt;
        update public.model_registry set fallback_rank = -(fallback_rank - 1) where task = r.task and status = 'fallback';
        update public.model_registry set fallback_rank = -fallback_rank where task = r.task and status = 'fallback' and fallback_rank < 0;
        insert into public.model_registry_events(registry_id, task, from_status, to_status, reason, actor)
          values (nxt, r.task, 'fallback', 'active', 'active model shut down by provider', 'resolver-auto-retire');
      end if;
    end if;
    k := k + 1;
  end loop;
  return k;
end $$;

-- Weekly provider-watch writes here; never spends, never activates.
create or replace function public.model_queue_candidate(p_task text, p_provider text, p_model text, p_version text,
  p_price_in numeric, p_price_out numeric, p_price_url text, p_notes text)
returns uuid language sql security definer set search_path = public as $$
  insert into public.model_registry (task, provider, model, version, status, price_input_per_mtok, price_output_per_mtok,
                                     price_source_url, price_checked_at, discovered_by, notes)
  values (p_task, p_provider, p_model, p_version, 'candidate', p_price_in, p_price_out, p_price_url, current_date, 'provider-watch', p_notes)
  on conflict (task, provider, model, coalesce(version, '')) do update
    set price_input_per_mtok = excluded.price_input_per_mtok, price_output_per_mtok = excluded.price_output_per_mtok,
        price_checked_at = current_date, updated_at = now()
  returning id;
$$;

alter table public.model_tasks          enable row level security;
alter table public.model_registry       enable row level security;
alter table public.model_registry_events enable row level security;
alter table public.model_shadow_budget  enable row level security;
revoke all on public.model_tasks, public.model_registry, public.model_registry_events, public.model_shadow_budget from anon, authenticated;
revoke execute on function public.resolve_model(text), public.model_promote(uuid,text), public.model_retire_expired(),
  public.model_queue_candidate(text,text,text,text,numeric,numeric,text,text), public.model_promotion_check(uuid),
  public.model_shadow_spend_usd(text) from public, anon, authenticated;

commit;
