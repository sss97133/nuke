-- All-in buyer cost: per-platform fee schedules (cited, dated) + estimate components
-- + all_in_buyer_cost(). Purely additive: two new tables, four new functions.
-- Revert: /workspace/nuke-strategy/revert_fee_schedule.sql (drops only these objects).

create table if not exists public.platform_fee_schedules (
  id                    bigserial primary key,
  platform_key          text not null,          -- normalized: lower, [a-z0-9] only (bat, carsandbids, broadarrow, ...)
  platform_name         text not null,
  aliases               text[] not null default '{}',
  channel               text not null default 'standard', -- standard | in_person | online
  effective_from        date,                   -- null = earliest known
  effective_to          date,                   -- exclusive; null = current
  buyer_premium_pct     numeric not null,       -- on hammer up to tier_threshold
  tier_threshold        numeric,                -- null = flat
  buyer_premium_pct_above numeric,
  buyer_premium_min     numeric,
  buyer_premium_cap     numeric,
  currency              text not null default 'USD',
  seller_fee_note       text,
  reported_price_basis  text not null check (reported_price_basis in ('hammer','hammer_plus_premium','mixed')),
  price_basis_evidence  text,                   -- how we know whether Nuke's stored price includes the premium
  source_url            text,
  source_quote          text,
  source_fetched_at     date not null default current_date,
  confidence            numeric not null check (confidence between 0 and 1),
  notes                 text,
  created_at            timestamptz not null default now()
);
comment on table public.platform_fee_schedules is
  'Published buyer premium / fee terms by platform and date range, each row cited. Drives all_in_buyer_cost().';

create table if not exists public.transaction_cost_estimates (
  id            bigserial primary key,
  component     text not null,     -- transport | paperwork | inspection
  applies_to    text not null default 'any', -- any | online_platform | platform_key
  low           numeric, mid numeric, high numeric,
  currency      text not null default 'USD',
  basis         text not null,
  source_url    text,
  source_quote  text,
  source_fetched_at date not null default current_date,
  confidence    numeric not null check (confidence between 0 and 1),
  created_at    timestamptz not null default now()
);
comment on table public.transaction_cost_estimates is
  'Cited estimate components for all-in buyer cost when no receipt exists. Estimates, not observations.';

alter table public.platform_fee_schedules enable row level security;
alter table public.transaction_cost_estimates enable row level security;
create policy platform_fee_schedules_read on public.platform_fee_schedules for select using (true);
create policy transaction_cost_estimates_read on public.transaction_cost_estimates for select using (true);

-- price-basis evidence below = share of stored vehicles.sale_price ($20k-$250k) that are round to $500 raw
-- vs. round only after dividing out the premium (measured 2026-10-22).
insert into public.platform_fee_schedules
 (platform_key, platform_name, aliases, channel, effective_from, effective_to, buyer_premium_pct, tier_threshold, buyer_premium_pct_above,
  buyer_premium_min, buyer_premium_cap, seller_fee_note, reported_price_basis, price_basis_evidence, source_url, source_quote, confidence, notes) values
('bat','Bring a Trailer','{bringatrailer}','standard','2024-01-29',null,5,null,null,250,7500,'$99 listing fee; no other seller fees',
 'hammer','70.6% of 108k stored prices round to $500; 0.3% round after /1.05',
 'https://bringatrailer.com/how-bat-works/','Buyers pay a 5% or 10% fee on top of the final sale price ... minimum fee is $250 ... capped at $7,500 for auctions with a 5% fee',0.9,
 '10% categories (cap $4,000) exist; vehicles default to 5%. Cap raise: https://bringatrailer.com/2024/01/26/bat-site-update-5-buyers-fee-cap-is-7500-as-of-1-29-24/'),
('bat','Bring a Trailer','{bringatrailer}','standard',null,'2024-01-29',5,null,null,250,5000,'$99 listing fee',
 'hammer','see current row','https://bringatrailer.com/2024/01/26/bat-site-update-5-buyers-fee-cap-is-7500-as-of-1-29-24/','5% Buyer''s Fee Cap is $7,500 as of 1/29/24 (previously $5,000)',0.7,
 'Start date of the $5,000 cap not fetched; earlier years assumed same.'),
('carsandbids','Cars & Bids','{cnb,carsbids}','standard','2025-02-25',null,5,null,null,250,7500,'Listing is free; sellers receive 100% of sale price',
 'hammer','64.2% of 15k stored prices round to $500; 0.3% round after /1.05',
 'https://carsandbids.com/faq/','buyers pay a 5% buyer''s fee to Cars & Bids. The buyer''s fee has a minimum of $250, and a maximum of $7,500.',0.9,null),
('carsandbids','Cars & Bids','{cnb,carsbids}','standard',null,'2025-02-25',4.5,null,null,225,4500,'Listing free',
 'hammer','see current row','https://www.theautopian.com/cars-bids-raises-its-buyer-fees-post-layoffs-to-match-bring-a-trailer/','changed from 4.5% ($225 min, $4,500 cap) to 5% ($250 min, $7,500 cap) effective Feb 25 2025',0.75,null),
('pcarmarket','PCarMarket','{pcar}','standard',null,null,5,null,null,500,7500,null,
 'hammer','81.7% of 4.4k stored prices round to $500','https://www.pcarmarket.com/buyer-agreement','5% of the winning bid, $500 minimum, $7,500 maximum',0.7,'Historical changes not fetched.'),
('collectingcars','Collecting Cars','{}','standard',null,null,6,null,null,1000,10000,null,
 'hammer','68.3% of 435 stored prices round to $500','https://collectingcars.com/faqs','6% buyer''s premium ... $1,000 minimum and $10,000 maximum (USD); GBP £1,000/£6,000 plus VAT',0.7,'UK lots add VAT on the fee (7.2% effective). Historical changes not fetched.'),
('mecum','Mecum Auctions','{mecumauctions}','in_person',null,null,10,null,null,1000,null,null,
 'mixed','47.8% round raw, 51.2% round after /1.10: about half of stored Mecum prices already include the 10% premium',
 'https://www.mecum.com/faq/','Collector Cars/Motorcycles: In Person 10%, Telephone 12%, Internet 12%. Minimum Buyer Premium: Vehicles $1,000',0.75,'Channel usually unknown; in_person assumed.'),
('mecum','Mecum Auctions','{mecumauctions}','online',null,null,12,null,null,1000,null,null,
 'mixed','see in_person row','https://www.mecum.com/faq/','Telephone 12% / Internet 12%',0.75,null),
('barrettjackson','Barrett-Jackson','{bj,barrett}','in_person',null,null,10,null,null,null,null,null,
 'mixed','43.6% round raw, 46.4% round after /1.10: about half of stored prices include the 10% premium',
 'https://barrettjacksoncdn.azureedge.net/staging/forms/12994.pdf','Scottsdale 2025 Bidder Agreement: 10% buyer''s premium on vehicles on-site; 12% telephone/internet/proxy',0.75,'Pre-2025 years assumed same.'),
('barrettjackson','Barrett-Jackson','{bj,barrett}','online',null,null,12,null,null,null,null,null,
 'mixed','see in_person row','https://barrettjacksoncdn.azureedge.net/staging/forms/12994.pdf','12% telephone, internet or proxy',0.75,null),
('broadarrow','Broad Arrow Auctions','{broadarrowauctions}','standard','2022-01-01',null,12,250000,10,null,null,null,
 'hammer_plus_premium','73.2% of 1k stored prices round to $500 only after /1.12; Broad Arrow publishes results including premium',
 'https://fliphtml5.com/kfgkh/daup/Broad_Arrow_Auctions_-_Monterey_Jet_Center_2023_-_Friday_-_Catalog/284/',
 'standard Buyer''s Premium is: (i) if the Lot is a motor car, then the sum of twelve percent (12%) of the first $250,000 of the Hammer Price and ten percent (10%) of the amount by which the Hammer Price exceeds $250,000',0.9,
 'Results note: "All prices are listed in USD and include the applicable buyer''s premium" (broadarrowauctions.com news). EMEA: 15%/12.5% + VAT.'),
('rmsothebys','RM Sotheby''s','{rm,rmsotheby}','standard',null,null,12,250000,10,null,null,null,
 'mixed','63.1% round raw, 17.2% round after /1.12','https://rmsothebys.com/auctions/mo26/bidder-info/','Cars: 12% on a hammer price up to $250,000 10% on any balance over $250,000',0.8,'US sales; same terms on az25/mi25 pages.'),
('gooding','Gooding Christie''s','{goodingco,goodingandcompany}','standard','2025-08-01',null,12,250000,10,null,null,null,
 'mixed','50.2% round raw, 27.6% after /1.12, 23.3% after /1.10','https://www.christies.com/en/help/buying-guide-important-information/financial-information',
 'COMPLETE BUYER''S PREMIUM SCHEDULE FOR GOODING CHRISTIE''S (Effective 1 August 2025) US Vehicle Live Auctions 12.0% up to $250,000, 10.0% above',0.85,'Online-only auctions 10% flat.'),
('gooding','Gooding & Company','{goodingco,goodingandcompany}','standard',null,'2025-08-01',12,250000,10,null,null,null,
 'mixed','see current row','https://bid.goodingco.com/conditions-of-sale','Live Auctions in the U.S.: 12% of the final bid price up to $250,000 ... 10% on the remainder',0.6,
 'Pre-Aug-2025 terms taken from current conditions page; 23% of stored prices fit a 10% flat premium, so older sales likely used 10%.'),
('bonhams','Bonhams','{bonhamscars}','standard',null,null,12,250000,10,null,null,null,
 'hammer','97.6% of 12k stored prices round to $500 raw','https://www.bonhams.com/how-to-buy/buyers-premium-united-states/','US motor cars: 12% on the first $250,000 and 10% above',0.65,
 'Fetched via search summary; motorcycles 15%. Non-US sales differ.');

insert into public.transaction_cost_estimates (component, applies_to, low, mid, high, basis, source_url, source_quote, confidence) values
('transport','any',900,1900,2400,'Cross-country (2,500-3,000 mi): open $900-1,500, enclosed $1,400-2,400; mid = enclosed midpoint. Origin/destination unknown.',
 'https://www.uship.com/blog/tips/cross-country-car-shipping-costs-2025/','open transport averages $0.60-$0.80 per mile ... enclosed $0.90-$1.25 per mile',0.35),
('paperwork','online_platform',198,198,297,'Online-auction title/escrow service (KeySavvy SafePay); +$99 if seller has a loan.',
 'https://carsandbids.com/faq/','Buyers pay just $198. If the vehicle has a loan, there is an additional $99 charge',0.5),
('inspection','any',300,700,1500,'Pre-purchase inspection; $500-1,000 typical for a classic Porsche.',
 'https://vintageexcellence.com/pre-purchase-inspections','$500 in-shop and $700 local travel',0.4);

create or replace function public.platform_key_norm(p text) returns text
language sql immutable as $$ select nullif(regexp_replace(lower(coalesce(p,'')),'[^a-z0-9]','','g'),'') $$;

create or replace function public.platform_buyer_premium(p_hammer numeric, s public.platform_fee_schedules)
returns numeric language sql immutable as $$
  select round(least(coalesce(s.buyer_premium_cap, 'infinity'::numeric), greatest(coalesce(s.buyer_premium_min,0),
    case when s.tier_threshold is null then p_hammer*s.buyer_premium_pct/100
         else least(p_hammer,s.tier_threshold)*s.buyer_premium_pct/100
            + greatest(p_hammer-s.tier_threshold,0)*coalesce(s.buyer_premium_pct_above,s.buyer_premium_pct)/100 end)), 2)
$$;

create or replace function public._roundness(x numeric) returns int language sql immutable as $$
  select case when x % 5000 = 0 then 5 when x % 2500 = 0 then 4 when x % 1000 = 0 then 3 when x % 500 = 0 then 2 when x % 250 = 0 then 1 else 0 end $$;

-- All-in buyer cost for one sale event. Components that are unknown stay null.
create or replace function public.all_in_buyer_cost(p_event_id uuid, p_sales_tax_rate numeric default null)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  e record; s public.platform_fee_schedules; k text; price numeric; hammer numeric; prem numeric;
  basis text; basis_conf numeric; cand numeric; cand10 numeric; alt_rate numeric; online boolean;
  tr record; pw record; insp record; rcpt numeric; rcpt_n int; tax numeric;
  known numeric; est_low numeric; est_mid numeric; est_high numeric;
begin
  select ev.id, ev.vehicle_id, ev.final_price, ev.sold_at, ev.source_platform, ev.source_url, v.canonical_platform
    into e from vehicle_events ev left join vehicles v on v.id = ev.vehicle_id where ev.id = p_event_id;
  if not found then return null; end if;
  price := e.final_price;
  k := platform_key_norm(coalesce(e.source_platform, e.canonical_platform));
  select * into s from platform_fee_schedules f
   where (f.platform_key = k or k = any(f.aliases))
     and (f.effective_from is null or e.sold_at is null or e.sold_at::date >= f.effective_from)
     and (f.effective_to is null or e.sold_at is null or e.sold_at::date < f.effective_to)
     and f.channel in ('standard','in_person')
   order by f.effective_from desc nulls last limit 1;

  if price is null or price <= 0 then
    return jsonb_build_object('event_id', e.id, 'vehicle_id', e.vehicle_id, 'all_in_cost', null, 'reason', 'no recorded price');
  end if;

  if s.id is null then
    hammer := price; prem := null; basis := 'unknown_platform'; basis_conf := 0.3;
  else
    -- invert: hammer that would produce this price if it already includes the premium
    cand := case when s.tier_threshold is null or price <= s.tier_threshold*(1+s.buyer_premium_pct/100)
                 then price/(1+s.buyer_premium_pct/100)
                 else (price - s.tier_threshold*s.buyer_premium_pct/100 + s.tier_threshold*coalesce(s.buyer_premium_pct_above,s.buyer_premium_pct)/100)
                      /(1+coalesce(s.buyer_premium_pct_above,s.buyer_premium_pct)/100) end;
    if s.buyer_premium_min is not null and cand*s.buyer_premium_pct/100 < s.buyer_premium_min then cand := price - s.buyer_premium_min; end if;
    if s.buyer_premium_cap is not null and price - cand > s.buyer_premium_cap then cand := price - s.buyer_premium_cap; end if;
    if s.reported_price_basis = 'hammer' then
      basis := 'hammer'; basis_conf := s.confidence; hammer := price;
    elsif s.reported_price_basis = 'hammer_plus_premium' then
      basis := 'hammer_plus_premium'; hammer := round(cand);
      basis_conf := case when abs(round(cand/250)*250 - cand) < 1.01 then 0.95 else 0.7 end;
    else
      -- mixed: pick the reading whose hammer lands on the rounder bid increment.
      -- Try the dated schedule first, then a flat 10% (the long-standing live-auction rate).
      cand10 := price / 1.10;
      if abs(round(cand) - cand) < 1.01 and _roundness(round(cand)) > _roundness(price) then
        basis := 'hammer_plus_premium'; hammer := round(cand); basis_conf := 0.8;
      elsif abs(round(cand10) - cand10) < 1.01 and _roundness(round(cand10)) > _roundness(price) then
        basis := 'hammer_plus_premium'; hammer := round(cand10); basis_conf := 0.6; alt_rate := 10;
      else
        basis := 'hammer'; hammer := price; basis_conf := case when _roundness(price) >= 2 then 0.7 else 0.4 end;
      end if;
    end if;
    prem := case when alt_rate is not null then price - hammer else platform_buyer_premium(hammer, s) end;
  end if;

  online := k in ('bat','bringatrailer','carsandbids','pcarmarket','collectingcars');
  select * into tr from transaction_cost_estimates where component='transport' order by id limit 1;
  select * into pw from transaction_cost_estimates where component='paperwork' and online and applies_to='online_platform' order by id limit 1;
  select * into insp from transaction_cost_estimates where component='inspection' order by id limit 1;
  select sum(coalesce(r.total, r.total_amount)), count(*) into rcpt, rcpt_n from receipts r
   where r.vehicle_id = e.vehicle_id and coalesce(r.is_superseded,false) = false and e.sold_at is not null
     and coalesce(r.receipt_date, r.transaction_date) between e.sold_at::date and e.sold_at::date + 90;
  if rcpt_n = 0 then rcpt := null; end if;
  tax := case when p_sales_tax_rate is not null then round((hammer + coalesce(prem,0)) * p_sales_tax_rate, 2) end;

  known := hammer + coalesce(prem,0) + coalesce(rcpt,0) + coalesce(tax,0);
  est_low  := known + coalesce(tr.low,0)  + coalesce(pw.low,0);
  est_mid  := known + coalesce(tr.mid,0)  + coalesce(pw.mid,0);
  est_high := known + coalesce(tr.high,0) + coalesce(pw.high,0) + coalesce(insp.high,0);

  return jsonb_build_object(
    'event_id', e.id, 'vehicle_id', e.vehicle_id, 'sold_at', e.sold_at, 'platform_key', k, 'source_url', e.source_url,
    'stored_price', price,
    'stored_price_basis', basis, 'stored_price_basis_confidence', basis_conf,
    'stored_price_includes_premium', basis = 'hammer_plus_premium',
    'hammer', hammer,
    'components', jsonb_build_array(
      jsonb_build_object('item','hammer','amount',hammer,'kind', case when basis='hammer_plus_premium' then 'derived' else 'observed' end,
        'confidence', basis_conf, 'source_url', e.source_url),
      jsonb_build_object('item','buyer_premium','amount',prem,'kind','computed_from_published_schedule',
        'rate', case when s.id is null then null else jsonb_build_object('pct',s.buyer_premium_pct,'tier_threshold',s.tier_threshold,
          'pct_above',s.buyer_premium_pct_above,'min',s.buyer_premium_min,'cap',s.buyer_premium_cap,'channel',s.channel,
          'effective_from',s.effective_from,'effective_to',s.effective_to) end,
        'confidence', s.confidence, 'source_url', s.source_url, 'source_quote', s.source_quote,
        'note', case when s.id is null then 'no fee schedule for platform' when alt_rate is not null then 'stored price fits hammer + flat 10% premium; rate inferred from the price, not the dated schedule' when s.channel='in_person' then 'in-person rate assumed; online bids pay more' end),
      jsonb_build_object('item','sales_tax','amount',tax,'kind', case when tax is null then 'unknown' else 'computed_from_given_rate' end,
        'note','depends on buyer state; pass p_sales_tax_rate'),
      jsonb_build_object('item','post_sale_work_receipts','amount',rcpt,'kind', case when rcpt is null then 'unknown' else 'observed_receipts' end,
        'receipt_count', rcpt_n, 'window','sale date to +90 days'),
      jsonb_build_object('item','transport','amount',null,'estimate',jsonb_build_object('low',tr.low,'mid',tr.mid,'high',tr.high),
        'kind','estimate','confidence',tr.confidence,'basis',tr.basis,'source_url',tr.source_url),
      jsonb_build_object('item','paperwork_title','amount',null,
        'estimate', case when pw.id is null then null else jsonb_build_object('low',pw.low,'mid',pw.mid,'high',pw.high) end,
        'kind', case when pw.id is null then 'unknown' else 'estimate' end,'confidence',pw.confidence,'basis',pw.basis,'source_url',pw.source_url),
      jsonb_build_object('item','inspection_ppi','amount',null,'estimate',jsonb_build_object('low',insp.low,'mid',insp.mid,'high',insp.high),
        'kind','estimate_optional','confidence',insp.confidence,'basis',insp.basis,'source_url',insp.source_url)
    ),
    'all_in_cost', jsonb_build_object(
      'known', known, 'known_includes', 'hammer + buyer premium' || case when rcpt is not null then ' + receipts' else '' end || case when tax is not null then ' + sales tax' else '' end,
      'estimated_low', est_low, 'estimated_mid', est_mid, 'estimated_high', est_high,
      'estimate_note','adds transport and paperwork estimates; high adds PPI. Sales tax excluded unless a rate is given.')
  );
end $$;

-- Latest live (non-duplicate, non-ask) sold event for each vehicle.
create or replace function public.all_in_buyer_cost_for_vehicles(p_vehicle_ids uuid[], p_sales_tax_rate numeric default null)
returns table(vehicle_id uuid, all_in jsonb) language sql stable set search_path = public, pg_temp as $$
  select x.vehicle_id, all_in_buyer_cost(x.id, p_sales_tax_rate)
  from (select distinct on (ev.vehicle_id) ev.vehicle_id, ev.id
          from vehicle_events ev
         where ev.vehicle_id = any(p_vehicle_ids) and ev.final_price > 0 and ev.event_status = 'sold'
           and coalesce(ev.sale_truth_role,'') not in ('duplicate','ask')
         order by ev.vehicle_id, ev.sold_at desc nulls last) x
$$;

grant select on public.platform_fee_schedules, public.transaction_cost_estimates to anon, authenticated, service_role;
grant execute on function public.all_in_buyer_cost(uuid, numeric), public.all_in_buyer_cost_for_vehicles(uuid[], numeric),
  public.platform_key_norm(text), public._roundness(numeric), public.platform_buyer_premium(numeric, public.platform_fee_schedules) to anon, authenticated, service_role;
