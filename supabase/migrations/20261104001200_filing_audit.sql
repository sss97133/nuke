-- 20261104001200_filing_audit.sql  (applied live 2026-11-03 ~10:30-11:00 PM PT; not committed)
-- 1) audit verdicts table
create table if not exists public.photo_filing_audit(
  id bigserial primary key, image_id uuid not null, run_id text, vehicle_id uuid,
  verdict text check (verdict in ('correct','wrong','unclear','pending')), reason text,
  method text default 'agent_vision_contact_sheet_v1', audited_at timestamptz default now(), audit_batch text);

-- 2) ongoing vision-verification queue + daily sampler
create table if not exists public.auto_filing_audit_queue(
  id bigserial primary key, image_id uuid not null, vehicle_id uuid, source text, run_id text,
  queued_at timestamptz default now(),
  status text default 'pending' check (status in ('pending','correct','wrong','unclear')),
  reason text, verified_at timestamptz, unique(image_id,run_id));

create or replace function public.sample_auto_filings_for_audit(p_since timestamptz default now()-interval '1 day', p_per_run int default 10)
returns int language plpgsql set statement_timeout='9s' as $f$
declare n int;
begin
 with c as (
  select l.target_pk::uuid image_id, (l.after#>>'{}')::uuid vehicle_id, 'profile_fix_log' src, l.run_id::text run_id
  from profile_fix_log l where l.at>=p_since and l.target_table='vehicle_images' and l.column_name='vehicle_id'
    and l.reverted_at is null and l.after<>'null'::jsonb
  union all
  select k.image_id, k.vehicle_id, 'capture_set_links', k.run_id::text from capture_set_links k where k.created_at>=p_since),
 r as (select *, row_number() over (partition by run_id, vehicle_id order by random()) rn from c)
 insert into auto_filing_audit_queue(image_id,vehicle_id,source,run_id)
 select image_id,vehicle_id,src,run_id from r where rn<=p_per_run on conflict do nothing;
 get diagnostics n=row_count; return n;
end $f$;

select cron.schedule('auto_filing_audit_daily','15 13 * * *',$$select public.sample_auto_filings_for_audit()$$);  -- 5:15 AM PT

-- 3) HARD visual-verification pre-step for any auto-file / repoint run
-- visual verification hard gate v1
create table if not exists public.filing_run_gate(
  run_id text primary key, planned_n int not null, required_n int not null,
  correct int default 0, wrong int default 0, unclear int default 0,
  error_rate numeric, passed boolean default false, evaluated_at timestamptz, note text);

create or replace function public.filing_gate_enqueue(p_run text, p_items jsonb) returns jsonb
language plpgsql as $f$
declare n int; req int; q int;
begin
  n := jsonb_array_length(p_items); req := least(10,n);
  insert into auto_filing_audit_queue(image_id,vehicle_id,source,run_id)
  select (e->>'image_id')::uuid,(e->>'vehicle_id')::uuid,'pre_gate',p_run
  from (select e from jsonb_array_elements(p_items) e order by random() limit req) s
  on conflict do nothing;
  get diagnostics q=row_count;
  insert into filing_run_gate(run_id,planned_n,required_n,note) values(p_run,n,req,'awaiting visual verification')
  on conflict (run_id) do update set planned_n=excluded.planned_n, required_n=excluded.required_n, passed=false, note='re-enqueued';
  return jsonb_build_object('run',p_run,'planned',n,'required',req,'queued',q);
end $f$;

create or replace function public.filing_gate_eval(p_run text) returns jsonb
language plpgsql as $f$
declare g filing_run_gate; c int; w int; u int; er numeric; ok boolean;
begin
  select * into g from filing_run_gate where run_id=p_run;
  if not found then return jsonb_build_object('run',p_run,'passed',false,'why','no gate row: call filing_gate_enqueue first'); end if;
  select count(*) filter (where status='correct'),count(*) filter (where status='wrong'),count(*) filter (where status='unclear')
    into c,w,u from auto_filing_audit_queue where run_id=p_run and source='pre_gate';
  er := case when c+w>0 then w::numeric/(c+w) end;
  ok := (c+w+u) >= g.required_n and (c+w) > 0 and er <= 0.05;
  update filing_run_gate set correct=c,wrong=w,unclear=u,error_rate=er,passed=ok,evaluated_at=now(),
    note=case when ok then 'passed' when (c+w+u)<g.required_n then 'insufficient verified sample' else 'ABORT: error rate > 5%' end
  where run_id=p_run;
  return jsonb_build_object('run',p_run,'passed',ok,'correct',c,'wrong',w,'unclear',u,'error_rate',er,'required',g.required_n);
end $f$;

create or replace function public._filing_gate_check() returns trigger
language plpgsql as $f$
begin
  if TG_TABLE_NAME='profile_fix_log' then
    if NEW.target_table<>'vehicle_images' or NEW.column_name<>'vehicle_id' or NEW.after is null or NEW.after='null'::jsonb then return NEW; end if;
  end if;
  if not exists (select 1 from filing_run_gate where run_id=NEW.run_id::text and passed) then
    raise exception 'filing visual gate: run % has no passed visual verification (>=min(10,n) sampled, <=5%% wrong). Use filing_gate_enqueue + verify + filing_gate_eval.', NEW.run_id;
  end if;
  return NEW;
end $f$;

drop trigger if exists trg_filing_gate on public.capture_set_links;
create trigger trg_filing_gate before insert on public.capture_set_links for each row execute function public._filing_gate_check();
drop trigger if exists trg_filing_gate on public.profile_fix_log;
create trigger trg_filing_gate before insert on public.profile_fix_log for each row execute function public._filing_gate_check();

-- Revert: drop trigger trg_filing_gate on capture_set_links; drop trigger trg_filing_gate on profile_fix_log;
--         select cron.unschedule('auto_filing_audit_daily');  (tables can stay; they only hold audit data)
