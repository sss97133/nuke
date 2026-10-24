set statement_timeout='55s';
drop table if exists public.agg_houseroute_v10_20261024_cand;
create table public.agg_houseroute_v10_20261024_cand as
with w as (select ccev, min(win_lo) lo, max(win_hi) hi from public.agg_houseroute_v10_20261024_nowin group by 1),
s as (select s.ccev, s.house_platform, count(*) n, count(*) filter (where s.house_sold between w.lo and w.hi) n_in,
        (array_agg(s.citation order by s.house_sold))[1:3] cites
      from public.agg_houseroute_v10_20261024_sib s join w using(ccev) where s.kind='same_lot' and s.house_platform is not null group by 1,2),
agg as (select ccev, count(*) nhouses, sum(n) ncited, max(house_platform) house, max(n_in) n_in, max(n) n, (array_agg(cites))[1] cites from s group by 1)
select x.event_id, x.ccev, x.source_platform old_platform, x.win_lo, x.win_hi, a.house, a.nhouses, a.ncited, a.n_in, a.cites,
 case when a.ccev is null then 'held: no cited sibling lot'
      when a.nhouses>1 then 'held: siblings cite >1 house'
      when a.n<2 then 'held: only 1 cited sibling'
      when a.n_in<a.n then 'held: cited lot outside sale window'
      else 'route' end decision
from public.agg_houseroute_v10_20261024_nowin x left join agg a using(ccev);
select decision, house, count(*) from public.agg_houseroute_v10_20261024_cand group by 1,2 order by 1,3 desc;
