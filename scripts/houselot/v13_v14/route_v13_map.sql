-- agg_houseroute_v13_20261024_map: house + native currency per cited conceptcarz auction page (held v10 events only).
set local statement_timeout='50s';
create table if not exists public.agg_houseroute_v13_20261024_map as
with p as (
  select distinct p.ccev, p.page_title, p.event_month, p.url, p.house page_house
  from public.agg_houseroute_v10_20261024_cand c join public.agg_houseroute_v12_20261024_ccpage p using(ccev)
  where c.decision like 'held%' or (p.house='carlisle' and p.page_title ilike '%auctions america%')),
m as (select p.*,
  case
    when page_house='carlisle' and page_title ilike '%auctions america%' then 'auctions-america'
    when page_house in ('leake','kruse','carlisle') then null              -- routed in v12
    when page_house='barrettjackson' then null                             -- B-J staging gap, not filled
    when page_house is not null then page_house
    when page_title ~* '^coys' then 'coys'
    when page_title ~* '^h ?& ?h' then 'hh-classics'
    when page_title ~* '^historics' then 'historics-uk'
    when page_title ~* '^shannons' then 'shannons-australia'
    when page_title ~* '^midamerica auctions' then 'midamerica-auctions'
    when page_title ~* '^anglia auction' then 'anglia-car-auctions'
    when page_title ~* '^branson collector car auction' then 'branson-auction'
    when page_title ~* '^bonham ' then 'bonhams'
    else null end house,
  case when page_house is null and page_title !~* '^(coys|h ?& ?h|historics|shannons|midamerica auctions|anglia auction|branson collector car auction|bonham )'
       then 'page title names no auction house' end hold_reason
  from p)
select m.*,
  case
    when house is null then null
    when page_title ~* 'monaco|grand palais|retromobile|rétromobile|champs' or house='artcurial' then 'EUR'
    when house in ('coys','hh-classics','historics-uk','anglia-car-auctions') then 'GBP'
    when house='shannons-australia' then 'AUD'
    when house='bonhams' and page_title ~* 'goodwood|beaulieu|collectors motor cars' then 'GBP'
    else 'USD' end native_currency
from m;
alter table public.agg_houseroute_v13_20261024_map enable row level security;
select house, native_currency, hold_reason, count(*) pages from public.agg_houseroute_v13_20261024_map group by 1,2,3 order by 1;
