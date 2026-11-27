-- DRAFT — NOT APPLIED. Eval harness storage: a frozen gold set built only from
-- already-verified facts, and per-run, per-case results. Running an eval is a
-- separate, explicitly approved step (see README "Spend").

begin;

-- A gold set is frozen: once frozen_at is set, its cases never change. New labels
-- go into a new version, so every score is comparable to the run it is compared with.
create table if not exists public.model_gold_sets (
  id          uuid primary key default gen_random_uuid(),
  task        text not null references public.model_tasks(task),
  version     int  not null,
  description text not null,
  selection_sql text not null,          -- the exact query that picked the cases (audit trail)
  case_count  int  not null default 0,
  frozen_at   timestamptz,
  frozen_by   text,
  created_at  timestamptz not null default now(),
  unique (task, version)
);

create table if not exists public.model_gold_cases (
  id            uuid primary key default gen_random_uuid(),
  gold_set_id   uuid not null references public.model_gold_sets(id),
  image_id      uuid,                   -- vehicle_images.id when the input is a photo
  input_ref     jsonb not null,         -- {storage_path} or {text_ref}; never a signed URL
  expected      jsonb not null,         -- e.g. {"vehicle_id": "...", "is_vehicle": true, "vin": "...", "private": true}
  label_source  text not null check (label_source in (
                  'human_filed_vehicle',      -- vehicle_images.user_confirmed_vehicle = true (user_confirmed_vehicle_by set)
                  'vin_checksum_match',       -- VIN read on a vin_plate photo == vehicles.vin, ISO 3779 check digit valid
                  'human_privacy_verdict',    -- privacy decision made by Skylar in review (capture_privacy_promote_log / manual)
                  'human_relabel',            -- explicit correction in the app
                  'skylar_review_batch')),    -- one-off labelling session (see README decision 3)
  label_ref     jsonb not null,         -- pointer to the row that proves the label
  privacy_case  boolean not null default false,
  hard_case     boolean not null default false,
  unique (gold_set_id, image_id)
);

create or replace function public.model_gold_set_freeze(p_set uuid, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.model_gold_sets
     set frozen_at = now(), frozen_by = p_actor,
         case_count = (select count(*) from public.model_gold_cases where gold_set_id = p_set)
   where id = p_set and frozen_at is null;
  if not found then raise exception 'gold set % missing or already frozen', p_set; end if;
end $$;

create or replace function public.model_gold_cases_guard() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.model_gold_sets s where s.id = coalesce(new.gold_set_id, old.gold_set_id) and s.frozen_at is not null) then
    raise exception 'gold set is frozen';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists model_gold_cases_frozen on public.model_gold_cases;
create trigger model_gold_cases_frozen before insert or update or delete on public.model_gold_cases
  for each row execute function public.model_gold_cases_guard();

create table if not exists public.model_eval_runs (
  id            uuid primary key default gen_random_uuid(),
  registry_id   uuid not null references public.model_registry(id),
  gold_set_id   uuid not null references public.model_gold_sets(id),
  prompt_version text not null,
  budget_usd    numeric not null check (budget_usd <= 5),    -- hard cap per run
  approved_by   text not null,                             -- no run without a named approver
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  cases_scored  int,
  accuracy      numeric,          -- primary metric for the task (see README scorers)
  privacy_recall numeric,
  cost_usd      numeric,          -- measured from provider usage, not estimated
  cost_per_call_usd numeric,
  p50_latency_ms int,
  p95_latency_ms int,
  error_rate    numeric,
  stopped_reason text             -- 'complete' | 'budget' | 'error_rate' | 'manual'
);

create table if not exists public.model_eval_results (
  run_id        uuid not null references public.model_eval_runs(id),
  case_id       uuid not null references public.model_gold_cases(id),
  output        jsonb,
  correct       boolean,
  field_scores  jsonb,            -- per-field correctness, e.g. {"is_vehicle":1,"vehicle":0,"vin":1}
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric,
  latency_ms    int,
  error_class   text,
  primary key (run_id, case_id)
);

-- Writes a finished run's scores onto the registry row so model_promotion_check can read them.
create or replace function public.model_eval_finish(p_run uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select run_id,
         count(*) filter (where correct is not null) n,
         avg(case when correct then 1 else 0 end) filter (where correct is not null) acc,
         sum(cost_usd) cost,
         percentile_cont(0.5) within group (order by latency_ms) p50,
         percentile_cont(0.95) within group (order by latency_ms) p95,
         avg(case when error_class is not null then 1 else 0 end) err
    into r from public.model_eval_results where run_id = p_run group by run_id;
  update public.model_eval_runs set finished_at = now(), cases_scored = r.n, accuracy = r.acc, cost_usd = r.cost,
    cost_per_call_usd = r.cost / nullif(r.n, 0), p50_latency_ms = r.p50, p95_latency_ms = r.p95, error_rate = r.err,
    privacy_recall = (select avg(case when er.correct then 1 else 0 end) from public.model_eval_results er
                      join public.model_gold_cases gc on gc.id = er.case_id
                      where er.run_id = p_run and gc.privacy_case and (gc.expected->>'private')::boolean),
    stopped_reason = coalesce(stopped_reason, 'complete')
  where id = p_run;
  update public.model_registry m set eval_run_id = p_run, eval_accuracy = e.accuracy, eval_privacy_recall = e.privacy_recall,
    eval_p95_latency_ms = e.p95_latency_ms, est_cost_per_call_usd = e.cost_per_call_usd, updated_at = now()
  from public.model_eval_runs e where e.id = p_run and m.id = e.registry_id;
end $$;

alter table public.model_gold_sets    enable row level security;
alter table public.model_gold_cases   enable row level security;
alter table public.model_eval_runs    enable row level security;
alter table public.model_eval_results enable row level security;
revoke all on public.model_gold_sets, public.model_gold_cases, public.model_eval_runs, public.model_eval_results from anon, authenticated;
revoke execute on function public.model_gold_set_freeze(uuid,text), public.model_eval_finish(uuid) from public, anon, authenticated;

-- Gold-set selection queries (run read-only first to see counts; insert only after a yes).
-- photo_classify / photo_vehicle_match:
--   select vi.id, vi.vehicle_id, vi.user_confirmed_vehicle_by
--   from public.vehicle_images vi
--   where vi.user_confirmed_vehicle and vi.user_confirmed_vehicle_by is not null
--   order by md5(vi.id::text) limit 400;          -- deterministic sample
-- vin_read:
--   select vi.id, v.vin from public.vehicle_images vi join public.vehicles v on v.id = vi.vehicle_id
--   where vi.vehicle_vin is not null and upper(vi.vehicle_vin) = upper(v.vin) and length(v.vin) = 17
--   order by md5(vi.id::text) limit 300;          -- add check-digit validation in the loader
-- privacy:
--   human verdicts only (capture_privacy_promote_log rows with a human actor, or a Skylar review batch).
--   Machine flags (vehicle_images.is_sensitive) are NOT gold: planner stats show is_sensitive=true on ~0.0003% of rows.

commit;
