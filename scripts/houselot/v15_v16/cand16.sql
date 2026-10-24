-- run agg_houselot_v16_20261024 inputs: the 9 held events whose cited conceptcarz page names a Barrett-Jackson sale (ccev 1289 Scottsdale Jan 2014,
-- 388 Palm Beach Apr 2004, 389 Petersen Jun 2004). Those three sales are already staged (bj_results_v1_20261024, event slugs scottsdale-2014,
-- palm-beach-2004, petersen-museum-2004); the v10 windows were too narrow. Lots are matched by the cited sale (event slug) instead of the date window.
begin; set local statement_timeout='55s';
create table if not exists public.agg_houselot_v16_20261024_cand9 (event_id uuid primary key, from_vehicle_id uuid, title text, title_year int,
  win_lo date, win_hi date, n9a int, n9b int, item_id text, bj_slug text, ccev text, cc_url text, computed_at timestamptz default now());
alter table public.agg_houselot_v16_20261024_cand9 enable row level security;
with f as (
  select c.event_id, n.from_vehicle_id, n.title, n.title_year, c.ccev, p.url cc_url,
    case c.ccev when '1289' then 'scottsdale-2014' when '388' then 'palm-beach-2004' when '389' then 'petersen-museum-2004' end slug,
    regexp_split_to_array(btrim(lower(regexp_replace(regexp_replace(regexp_replace(n.title,'(?i)(convertible|coupe|hardtop|roadster|sedan|wagon|pickup)ch[a-z]*$','\1'),'^\d{4}\s*',''),'[^A-Za-z0-9]+',' ','g'))),' ') tw
  from public.agg_houseroute_v10_20261024_cand c join public.agg_houseroute_v10_20261024_nowin n on n.event_id=c.event_id
  join public.agg_houseroute_v12_20261024_ccpage p on p.ccev=c.ccev
  where c.decision like 'held%' and p.house='barrettjackson'
), s as (
  select item_id, event_slug, year, run_datetime::date d, ' '||lower(regexp_replace(coalesce(title,''),'[^A-Za-z0-9]+',' ','g'))||' ' st
  from public.bj_results_stage_v1_20261024 where event_slug in ('scottsdale-2014','palm-beach-2004','petersen-museum-2004')
), q as (
  select f.event_id, s.item_id, not exists (select 1 from unnest(f.tw) w where length(w)>=2 and position(' '||w||' ' in s.st)=0) allw
  from f join s on s.event_slug=f.slug and s.year=f.title_year and position(' '||f.tw[1]||' ' in s.st)>0
), w as (select event_slug, min(d) lo, max(d) hi from s group by 1),
agg as (select event_id, count(*) n9a, count(*) filter (where allw) n9b, (array_agg(item_id) filter (where allw))[1] it from q group by 1)
insert into public.agg_houselot_v16_20261024_cand9 (event_id, from_vehicle_id, title, title_year, win_lo, win_hi, n9a, n9b, item_id, bj_slug, ccev, cc_url)
select f.event_id, f.from_vehicle_id, f.title, f.title_year, w.lo, w.hi, coalesce(a.n9a,0), coalesce(a.n9b,0), case when a.n9b=1 then a.it end, f.slug, f.ccev, f.cc_url
from f join w on w.event_slug=f.slug left join agg a using(event_id) on conflict (event_id) do nothing;
commit;
select c.title, c.bj_slug, c.n9a, c.n9b, s.lot_number, s.price_usd, s.existing_event_id is not null existing, s.vin from public.agg_houselot_v16_20261024_cand9 c left join public.bj_results_stage_v1_20261024 s using(item_id) order by 2,1;
