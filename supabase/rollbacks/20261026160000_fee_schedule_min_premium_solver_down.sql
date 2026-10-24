-- Down for 20261026160000_fee_schedule_min_premium_solver: restore the pure-percentage solver and reopen Mecum row 9.
-- The cited minimum rows are kept (never hard-delete) but closed so they never match.
SET lock_timeout = '5s';
create or replace function public.fee_schedule_hammer_from_gross(p_ids bigint[], p_gross numeric)
returns numeric language sql stable set search_path = public as $$
  with t as (select rate, tier_floor from platform_fee_schedule where id = any(p_ids)),
  g as (select rate, tier_floor, tier_floor + fee_schedule_premium(p_ids, tier_floor) g_at_floor from t)
  select round(tier_floor + (p_gross - g_at_floor) / (1 + rate), 2) from g where g_at_floor <= p_gross order by tier_floor desc limit 1
$$;
update public.platform_fee_schedule set valid_to = valid_from, notes = notes || ' | closed by rollback 20261026160000'
 where platform = 'mecum' and valid_from = '2026-10-24T00:00:00Z' and cited_on = '2026-10-24' and valid_to is null;
update public.platform_fee_schedule set valid_to = null where id = 9 and platform = 'mecum';
alter table public.platform_fee_schedule drop constraint if exists platform_fee_schedule_min_cited;
