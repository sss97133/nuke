set statement_timeout='55s';
drop table if exists public.agg_houselot_v15_20261024_gate;
create table public.agg_houselot_v15_20261024_gate as
with c as (
  select c.*, e.source_suspect, e.price_verification pv, e.event_status es, e.currency_code ec, e.vehicle_id cur_vid,
    he.event_status hs, he.identity_check hic, he.source_suspect hss, he.vehicle_id hvid_now, he.currency_code hc, he.final_price hp2,
    coalesce(he.sold_at,he.ended_at)::date hd,
    case when upper(coalesce(he.currency_code,'USD'))='USD' then 1::numeric else (select r.rate from public.fx_rates r where r.provider='ecb' and r.base_currency=upper(he.currency_code) and r.quote_currency='USD' and r.rate_date<=coalesce(he.sold_at,he.ended_at)::date and r.rate_date>=coalesce(he.sold_at,he.ended_at)::date-7 order by r.rate_date desc limit 1) end hfx,
    case when upper(coalesce(e.currency_code,'USD'))='USD' then 1::numeric else (select r.rate from public.fx_rates r where r.provider='ecb' and r.base_currency=upper(e.currency_code) and r.quote_currency='USD' and r.rate_date<=coalesce(e.sold_at,e.ended_at,he.sold_at)::date and r.rate_date>=coalesce(e.sold_at,e.ended_at,he.sold_at)::date-7 order by r.rate_date desc limit 1) end efx,
    case when he.source_platform='mecum' and btrim(he.source_listing_id) !~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$' then null else nullif(btrim(he.source_listing_id),'') end lot1,
    he.lot_number, he.lot_number_source_url,
    tv.deleted_at, tv.status tvs, tv.merged_into_vehicle_id tvm, tv.created_at tvc, tv.year tvy, coalesce(tv.data_quality_flags ? 'year_suspect',false) ysus,
    (select count(*) from public.agg_houselot_v15_20261024_cand x where x.cited_event_id=c.cited_event_id) k,
    exists (select 1 from public.vehicle_events r where r.vehicle_id=c.to_vehicle_id and r.extraction_run_id='rm_ingest_v1_20261024') rmv,
    exists (select 1 from public.vehicle_events d where d.vehicle_id=c.to_vehicle_id and d.id<>c.cited_event_id and d.final_price=c.cc_price and d.source_url not like 'conceptcarz:%' and c.cc_price<>c.house_price) dupprice,
    (select coalesce(array_agg(distinct replace(m[1],' ','') order by replace(m[1],' ','')),'{}') from regexp_matches(regexp_replace(lower(c.title),'(\d)[ -](\d)\s*l\M','\1.\2l','g'),'\m(hemi|sohc|dohc|boss|supercharged|[0-9]{3}(?=[ -]*(?:ci|cid|cu|cubic)\M)|[0-9]\.[0-9] ?l)\M','g') m) eng_cc,
    (select coalesce(array_agg(distinct replace(m[1],' ','') order by replace(m[1],' ','')),'{}') from regexp_matches(regexp_replace(lower(substring(c.cited_url from '(?i)/(?:lots?|vehicle)/(?:\d+/)?([^/?#]+)')),'(\d)[ -](\d)\s*l\M','\1.\2l','g'),'\m(hemi|sohc|dohc|boss|supercharged|[0-9]{3}(?=[ -]*(?:ci|cid|cu|cubic)\M)|[0-9]\.[0-9] ?l)\M','g') m) eng_h,
    (select coalesce(array_agg(distinct m[1]),'{}') from regexp_matches(lower(c.title),'\m(convertible|coupe|hardtop|roadster|sedan|wagon|pickup|fastback|cabriolet|spider|spyder|targa|truck)\M','g') m) body_cc,
    (select coalesce(array_agg(distinct m[1]),'{}') from regexp_matches(lower(c.cited_url),'\m(convertible|coupe|hardtop|roadster|sedan|wagon|pickup|fastback|cabriolet|spider|spyder|targa|truck)\M','g') m) body_h
  from public.agg_houselot_v15_20261024_cand c
  join public.vehicle_events e on e.id=c.event_id
  left join public.vehicle_events he on he.id=c.cited_event_id
  left join public.vehicles tv on tv.id=c.to_vehicle_id
)
select c.*, coalesce(lot1, case when lot_number_source_url is not null then nullif(btrim(lot_number),'') end, substring(cited_url from '(?i)bonhams\.com/auction/\d+/lot/([0-9A-Za-z]+)/')) lot,
 case
  when house is null then 'h00 no lot data held for house' when n_cand=0 then 'h01 no lot at new house'
  when n_cand>1 then 'h02 >1 lot at new house'
  when not bodyonly then 'h03 non-body title word missing'
  when cur_vid<>from_vehicle_id then 'h04 event moved since routing'
  when not ('vehicle_id'=any(coalesce(source_suspect,'{}'))) then 'h05 event not flagged'
  when pv='contradicted' or (pv='verified' and es='sold') then 'h06 event verified/contradicted'
  when k>1 then 'h07 lot claimed by >1 event'
  when hvid_now is distinct from to_vehicle_id or coalesce(hic,'')='mismatch' or 'vehicle_id'=any(coalesce(hss,'{}')) then 'h08 house identity not confirmed'
  when deleted_at is not null or tvs='merged' or tvm is not null then 'h09 target not live'
  when tvc>='2026-10-24' or rmv then 'h10 target new or rm_ingest'
  when ysus or tvy<>title_year then 'h11 year suspect/mismatch'
  when coalesce(lot1, case when lot_number_source_url is not null then nullif(btrim(lot_number),'') end, substring(cited_url from '(?i)bonhams\.com/auction/\d+/lot/([0-9A-Za-z]+)/')) is null then 'h12 no cited lot number'
  when hs is distinct from 'sold' or hp2 is null or cc_price is null then 'h13 house not sold/no price'
  when hfx is null or efx is null then 'h14 no sale-date FX rate'
  when abs(cc_price*efx-hp2*hfx)/greatest(hp2*hfx,1)>0.20 then 'h15 price >20% apart'
  when dupprice then 'h16 cc price equals another sale'
  when cardinality(body_cc)>0 and cardinality(body_h)>0 and not (body_cc && body_h) then 'h17 body conflict'
  when eng_cc<>eng_h then 'h18 engine one-sided/different (needs v2 evidence)'
  else 'ok' end reason
from c;
alter table public.agg_houselot_v15_20261024_gate enable row level security;
select reason, count(*) from public.agg_houselot_v15_20261024_gate group by 1 order by 1;
