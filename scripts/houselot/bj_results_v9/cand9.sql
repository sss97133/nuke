begin; set local statement_timeout='55s'; set local lock_timeout='5s';
-- run agg_houselot_v9_20261024 inputs: the 2,036 cand8 events with no B-J lot (n8a=0), rematched against staged B-J results lots
-- (bj_results_stage_v1_20261024) not yet present as events, sold, same sale window. 9a: year + cc first two title words in lot slug; 9b: every title word.
create table if not exists public.agg_houselot_v1_20261024_cand9 (event_id uuid primary key, from_vehicle_id uuid, title text, title_year int,
  win_lo date, win_hi date, n9a int, n9b int, item_id text, computed_at timestamptz default now());
alter table public.agg_houselot_v1_20261024_cand9 enable row level security;
with f as (
  select c.event_id, c.from_vehicle_id, c.title, c.title_year, c.win_lo, c.win_hi,
    regexp_split_to_array(btrim(lower(regexp_replace(regexp_replace(regexp_replace(c.title,'(?i)(convertible|coupe|hardtop|roadster|sedan|wagon|pickup)ch[a-z]*$','\1'),'^\d{4}\s*',''),'[^A-Za-z0-9]+',' ','g'))),' ') tw
  from public.agg_houselot_v1_20261024_cand8 c where c.n8a=0
), s as (
  select item_id, run_datetime::date d, ' '||regexp_replace(lower(substring(lot_url from '/vehicle/([^/?#]+)')),'[^a-z0-9]+',' ','g')||' ' slug
  from public.bj_results_stage_v1_20261024 where existing_event_id is null and is_sold and price_usd>0 and not coalesce(is_canceled,false)
), q as (
  select f.event_id, s.item_id, not exists (select 1 from unnest(f.tw) w where length(w)>=2 and position(' '||w||' ' in s.slug)=0) allw
  from f join s on s.d >= f.win_lo and s.d < f.win_hi + 1
   and s.slug like ' '||f.title_year||' '||f.tw[1]||' %' and array_length(f.tw,1)>=2 and position(' '||f.tw[2]||' ' in s.slug)>0
), agg as (select event_id, count(*) n9a, count(*) filter (where allw) n9b, (array_agg(item_id) filter (where allw))[1] it from q group by 1)
insert into public.agg_houselot_v1_20261024_cand9 (event_id, from_vehicle_id, title, title_year, win_lo, win_hi, n9a, n9b, item_id)
select f.event_id, f.from_vehicle_id, f.title, f.title_year, f.win_lo, f.win_hi, coalesce(a.n9a,0), coalesce(a.n9b,0), case when a.n9b=1 then a.it end
from f left join agg a using(event_id) on conflict (event_id) do nothing;
commit;
select count(*) n, count(*) filter (where n9a=0) none, count(*) filter (where n9a>0 and n9b=0) words_missing, count(*) filter (where n9b>1) ambiguous, count(*) filter (where n9b=1) uniq from public.agg_houselot_v1_20261024_cand9;
