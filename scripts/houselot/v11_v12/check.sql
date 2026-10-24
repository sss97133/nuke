set statement_timeout='55s';
select c.decision, p.house page_house, c.house v10_house,
  bool_and(to_date(p.event_month,'FMMonth YYYY') between date_trunc('month',c.win_lo) and c.win_hi) month_in_window, count(*)
from public.agg_houseroute_v10_20261024_cand c left join public.agg_houseroute_v12_20261024_ccpage p using(ccev)
group by 1,2,3 order by 1,5 desc;
