-- analysis_queue orphan reaper (20261124041000)
-- Why: ~44k analysis_queue rows have sat in status 'processing' since spring with no lease (lease_expires_at and
-- lease_token null) and nothing ever requested (request_revision = completed_revision = 0). They were claimed by the
-- pre-lease worker, which never finished them. claim_analysis_queue_batch only reclaims processing rows whose lease
-- expired, so these can never move, and they make the queue look stuck.
-- What this does: analysis_queue_reap_orphans_v1(run, claimed_before, batch, max_batches) backs up every matching row
-- (full row as jsonb) under the run id first, then releases them in batches to the same shape as the existing legacy
-- unrequested rows: status 'pending', worker_id/claimed_at cleared. analysis_queue_reap_revert_v1(run) puts back every
-- released row that nobody has touched since.
-- What this does not do: no work is requested or spent. A released row has request_revision = completed_revision, so
-- claim_analysis_queue_batch still will not claim it until something new is requested through enqueue_analysis_work.
-- Rows with a lease, with unfinished revisions, or claimed after claimed_before are never touched.
-- Revert: SELECT public.analysis_queue_reap_revert_v1('<run id>'); full removal:
--         supabase/sql/revert_20261124041000_analysis_queue_orphan_reaper.sql (revert runs first).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

create table if not exists public.analysis_queue_reap_runs (
  run_id uuid primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('releasing','released','reverted')),
  claimed_before timestamptz not null,
  backed_up int not null default 0,
  released int not null default 0,
  reverted_at timestamptz,
  revert_summary jsonb);

create table if not exists public.analysis_queue_reap_backup (
  run_id uuid not null,
  queue_id uuid not null,
  row_data jsonb not null,
  backed_up_at timestamptz not null default now(),
  released_at timestamptz,
  restored_at timestamptz,
  primary key (run_id, queue_id));

do $$
declare t text;
begin
  foreach t in array array['analysis_queue_reap_runs','analysis_queue_reap_backup'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.analysis_queue_reap_orphans_v1(p_run uuid, p_claimed_before timestamptz,
                                                                 p_batch int default 2000, p_max_batches int default 5)
returns jsonb language plpgsql set search_path = public as $$
declare v_run public.analysis_queue_reap_runs; n int; n_rel int := 0; b int := 0;
begin
  if p_run is null or p_claimed_before is null or p_claimed_before > now() - interval '30 days' then
    raise exception 'run id and a claimed_before at least 30 days old are required';
  end if;
  p_batch := least(greatest(coalesce(p_batch, 2000), 1), 5000);
  p_max_batches := least(greatest(coalesce(p_max_batches, 5), 1), 50);
  select * into v_run from public.analysis_queue_reap_runs where run_id = p_run for update;
  if not found then
    insert into public.analysis_queue_reap_runs (run_id, status, claimed_before) values (p_run, 'releasing', p_claimed_before);
    insert into public.analysis_queue_reap_backup (run_id, queue_id, row_data)
    select p_run, q.id, to_jsonb(q) from public.analysis_queue q
     where q.status = 'processing' and q.lease_expires_at is null and q.lease_token is null
       and q.claimed_at < p_claimed_before and q.request_revision is not distinct from q.completed_revision;
    get diagnostics n = row_count;
    update public.analysis_queue_reap_runs set backed_up = n where run_id = p_run;
    return jsonb_build_object('run_id', p_run, 'backed_up', n, 'released', 0, 'next', 'call again to release in batches');
  elsif v_run.claimed_before is distinct from p_claimed_before then
    raise exception 'run % was started with claimed_before %', p_run, v_run.claimed_before;
  elsif v_run.status <> 'releasing' then
    return jsonb_build_object('run_id', p_run, 'status', v_run.status);
  end if;
  loop
    exit when b >= p_max_batches;
    with c as (
      select q.id from public.analysis_queue_reap_backup k join public.analysis_queue q on q.id = k.queue_id
       where k.run_id = p_run and k.released_at is null
         and q.status = 'processing' and q.lease_expires_at is null and q.lease_token is null
         and q.claimed_at < p_claimed_before and q.request_revision is not distinct from q.completed_revision
       order by q.id limit p_batch for update of q skip locked),
    u as (update public.analysis_queue q set status = 'pending', worker_id = null, claimed_at = null
            from c where q.id = c.id returning q.id)
    update public.analysis_queue_reap_backup k set released_at = now() from u where k.run_id = p_run and k.queue_id = u.id;
    get diagnostics n = row_count;
    b := b + 1;
    n_rel := n_rel + n;
    exit when n < p_batch;
  end loop;
  update public.analysis_queue_reap_runs set released = released + n_rel,
         status = case when n < p_batch then 'released' else status end,
         finished_at = case when n < p_batch then now() end
   where run_id = p_run;
  return jsonb_build_object('run_id', p_run, 'released_this_call', n_rel, 'batches', b,
    'released_total', (select released from public.analysis_queue_reap_runs where run_id = p_run),
    'backed_up', v_run.backed_up, 'done', n < p_batch);
end $$;

create or replace function public.analysis_queue_reap_revert_v1(p_run uuid) returns jsonb
language plpgsql set search_path = public as $$
declare n int; n_skip int;
begin
  if not exists (select 1 from public.analysis_queue_reap_runs where run_id = p_run) then raise exception 'unknown run %', p_run; end if;
  with r as (
    update public.analysis_queue q set status = k.row_data ->> 'status', worker_id = k.row_data ->> 'worker_id',
           claimed_at = (k.row_data ->> 'claimed_at')::timestamptz
      from public.analysis_queue_reap_backup k
     where k.run_id = p_run and k.released_at is not null and k.restored_at is null and q.id = k.queue_id
       and q.status = 'pending' and q.worker_id is null and q.claimed_at is null
       and q.request_revision::text is not distinct from k.row_data ->> 'request_revision'
       and q.completed_revision::text is not distinct from k.row_data ->> 'completed_revision'
    returning q.id)
  update public.analysis_queue_reap_backup k set restored_at = now() from r where k.run_id = p_run and k.queue_id = r.id;
  get diagnostics n = row_count;
  select count(*) into n_skip from public.analysis_queue_reap_backup
   where run_id = p_run and released_at is not null and restored_at is null;
  update public.analysis_queue_reap_runs set status = 'reverted', reverted_at = now(),
         revert_summary = jsonb_build_object('restored', n, 'left_changed_since', n_skip) where run_id = p_run;
  return jsonb_build_object('run_id', p_run, 'restored', n, 'left_changed_since', n_skip);
end $$;

revoke all on function public.analysis_queue_reap_orphans_v1(uuid, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.analysis_queue_reap_revert_v1(uuid) from public, anon, authenticated;
grant execute on function public.analysis_queue_reap_orphans_v1(uuid, timestamptz, integer, integer) to service_role;
grant execute on function public.analysis_queue_reap_revert_v1(uuid) to service_role;

commit;
