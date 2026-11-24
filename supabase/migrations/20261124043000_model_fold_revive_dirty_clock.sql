-- Model fold: a revived dead letter starts a fresh dirty clock (20261124043000)
-- Why: reviving a dead row kept its old first_dirty_at, so it skipped the settle window and could trip the backlog assay.
-- What: a new signal on a dead row resets first_dirty_at and reasons, exactly as for a done row.
-- Revert: supabase/sql/revert_20261124043000_model_fold_revive_dirty_clock.sql.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function public.model_fold_absorb_signals(p_limit int) returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  with s as (
    delete from public.model_fold_signal where id in (select id from public.model_fold_signal order by id limit p_limit)
    returning vehicle_id, reason, origin_id, at),
  g as (select vehicle_id, array_agg(distinct reason) reasons, min(at) f, max(at) l,
               coalesce(array_agg(distinct origin_id) filter (where origin_id is not null), '{}') edited
          from s group by vehicle_id)
  insert into public.model_fold_work as w (vehicle_id, priority, reasons, first_dirty_at, dirty_at, next_attempt_at, edited_origins)
  select vehicle_id, 1, reasons, f, l, now(), edited from g
  on conflict (vehicle_id) do update set
    priority = 1,
    edited_origins = (select coalesce(array_agg(distinct x), '{}') from unnest(w.edited_origins || excluded.edited_origins) x),
    reasons = case when w.state in ('done','dead') then excluded.reasons
                   else (select array_agg(distinct x order by x) from unnest(w.reasons || excluded.reasons) x) end,
    first_dirty_at = case when w.state in ('done','dead') then excluded.first_dirty_at else least(w.first_dirty_at, excluded.first_dirty_at) end,
    dirty_at = greatest(w.dirty_at, excluded.dirty_at),
    -- new input revives a dead letter with a fresh attempt budget; a leased row keeps its lease
    state = case when w.state = 'leased' then w.state else 'pending' end,
    attempts = case when w.state = 'dead' then 0 else w.attempts end,
    next_attempt_at = case when w.state in ('done','dead') then now() else w.next_attempt_at end,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.model_fold_absorb_signals(integer) from public, anon, authenticated;

commit;
