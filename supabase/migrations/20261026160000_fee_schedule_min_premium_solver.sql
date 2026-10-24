-- Minimum buyer premium support for gross-published schedules.
-- 1. fee_schedule_hammer_from_gross solves hammer = gross - clamp(tiered_pct(hammer), min, cap) exactly.
--    The premium is monotonic in hammer, so: take the pure-percentage solution h; if its premium (gross - h) is
--    under the tier-0 min_amount the min binds and hammer = gross - min; if over cap_amount, hammer = gross - cap.
--    Returns null when gross does not exceed the minimum (no positive hammer exists).
--    Every current min_amount row publishes hammer, so this only changes gross-published schedules that carry a min.
-- 2. A cited minimum must name its currency and source (check constraint; all existing rows pass).
-- 3. Mecum: https://www.mecum.com/faq/ (read 2026-10-24) "Collector Cars/Motorcycles: In Person 10% ...
--    Minimum Buyer Premium: Vehicles $1,000, Motorcycles $500". Mecum's published sold prices 2012-2022 fit the
--    pure 10% (no minimum) on ~97% of sub-$11,000 auto/motorcycle lots (24,528 lots checked against Mecum's own
--    index, run mecum_minprem_fit_20261024), so the minimum is dated from the citation, not back-applied.
--    Row 9 (pure 10%, history_verified) closes at 2026-10-24; new car / motorcycle rows carry the minimum from then.
SET lock_timeout = '5s';

create or replace function public.fee_schedule_hammer_from_gross(p_ids bigint[], p_gross numeric)
returns numeric language sql stable set search_path = public as $$
  with t as (select rate, tier_floor from platform_fee_schedule where id = any(p_ids)),
  lim as (select max(min_amount) filter (where tier_floor = 0) mn, max(cap_amount) filter (where tier_floor = 0) cp
            from platform_fee_schedule where id = any(p_ids)),
  g as (select rate, tier_floor,
               tier_floor + (select sum(t2.rate * greatest(0, least(t.tier_floor, coalesce(t2.nxt, t.tier_floor)) - t2.tier_floor))
                               from (select rate, tier_floor, lead(tier_floor) over (order by tier_floor) nxt from t) t2) g_at_floor
          from t),
  pct as (select tier_floor + (p_gross - g_at_floor) / (1 + rate) h from g where g_at_floor <= p_gross order by tier_floor desc limit 1)
  select case when lim.mn is not null and p_gross <= lim.mn then null
              when lim.mn is not null and p_gross - pct.h < lim.mn then round(p_gross - lim.mn, 2)
              when lim.cp is not null and p_gross - pct.h > lim.cp then round(p_gross - lim.cp, 2)
              else round(pct.h, 2) end
    from pct, lim
$$;

alter table public.platform_fee_schedule drop constraint if exists platform_fee_schedule_min_cited;
alter table public.platform_fee_schedule add constraint platform_fee_schedule_min_cited
  check (min_amount is null or (min_amount >= 0 and currency is not null and source_url is not null)) not valid;
alter table public.platform_fee_schedule validate constraint platform_fee_schedule_min_cited;

update public.platform_fee_schedule set valid_to = '2026-10-24T00:00:00Z',
  notes = notes || ' | closed 2026-10-24: superseded by cited minimum-premium rows (20261026160000)'
 where id = 9 and platform = 'mecum' and valid_to is null;

insert into public.platform_fee_schedule (platform, role, fee_kind, rate, min_amount, currency, published_price_basis,
  valid_from, source_url, notes, tier_floor, lot_class, cited_on, history_verified, sale_type)
select 'mecum', 'buyer', 'percent', 0.1, v.mn, 'USD', 'gross_incl_premium', '2026-10-24T00:00:00Z', 'https://www.mecum.com/faq/',
       'In person 10%; Minimum Buyer Premium: ' || v.lbl || ' (mecum.com/faq read 2026-10-24); hammer = gross - max(0.10*hammer, min)',
       0, v.cls, '2026-10-24', false, 'any'
  from (values ('car', 1000::numeric, 'Vehicles $1,000'), ('motorcycle', 500::numeric, 'Motorcycles $500')) v(cls, mn, lbl)
 where not exists (select 1 from public.platform_fee_schedule f where f.platform = 'mecum' and f.role = 'buyer'
                     and f.lot_class = v.cls and f.valid_from = '2026-10-24T00:00:00Z');
