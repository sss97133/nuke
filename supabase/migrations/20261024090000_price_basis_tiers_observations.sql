-- Price basis v2: tiered, currency-aware and lot-class-aware fee schedules (Gooding, Bonhams, BaT 10% categories and
-- BaT GBP/EUR caps), plus observation-level basis evidence so a stored price's basis comes from what was observed on
-- the source page when we have it, instead of from the platform convention. Conflicts with a convention are flagged,
-- never overwritten. Additive; legacy price columns (final_price, winning_bid) are never written.
-- Revert: supabase/rollbacks/20261024090000_price_basis_tiers_observations_down.sql

-- ─── Schedule: tiers, lot class, citation date, history flag ────────────────
alter table public.platform_fee_schedule
  add column if not exists tier_floor numeric not null default 0,      -- marginal rate applies to hammer above this (sale currency)
  add column if not exists lot_class text not null default 'any' check (lot_class in ('any','car','motorcycle')),
  add column if not exists cited_on date,                              -- date the source_url was read
  add column if not exists history_verified boolean not null default true; -- false: current schedule applied to past sales unverified
comment on column public.platform_fee_schedule.tier_floor is 'Rows sharing platform/role/currency/lot_class/valid_from form one tiered schedule; each rate applies to the part of the hammer above tier_floor up to the next tier. min/cap are read from the tier_floor=0 row.';

insert into public.platform_fee_schedule (platform, role, fee_kind, rate, min_amount, cap_amount, flat_amount, currency, published_price_basis, valid_from, valid_to, tier_floor, lot_class, cited_on, history_verified, source_url, notes)
select * from (values
  -- Gooding Christie's US live vehicle auctions: published sale prices include premium
  ('gooding','buyer','percent',0.12,null::numeric,null::numeric,null::numeric,'USD','gross_incl_premium'::public.price_basis_t,null::timestamptz,null::timestamptz,0::numeric,'any','2026-10-23'::date,false,'https://bid.goodingco.com/conditions-of-sale','US live vehicle lots: 12% of final bid up to $250,000 (online-only auctions are 10%, not distinguished here)'),
  ('gooding','buyer','percent',0.10,null,null,null,'USD','gross_incl_premium',null,null,250000,'any','2026-10-23',false,'https://www.christies.com/en/help/buying-guide-important-information/financial-information','US live vehicle lots: 10% on the part above $250,000 (schedule effective 2025-08-01; earlier history unverified)'),
  ('gooding','buyer','percent',0.15,null,null,null,'EUR','gross_incl_premium',null,null,0,'any','2026-10-23',false,'https://www.christies.com/en/help/buying-guide-important-information/financial-information','Paris vehicle auctions 15% up to EUR 200,000'),
  ('gooding','buyer','percent',0.125,null,null,null,'EUR','gross_incl_premium',null,null,200000,'any','2026-10-23',false,'https://www.christies.com/en/help/buying-guide-important-information/financial-information','Paris vehicle auctions 12.5% above EUR 200,000'),
  ('gooding','buyer','percent',0.15,null,null,null,'CHF','gross_incl_premium',null,null,0,'any','2026-10-23',false,'https://www.christies.com/en/help/buying-guide-important-information/financial-information','Geneva vehicle auctions 15% up to CHF 200,000'),
  ('gooding','buyer','percent',0.125,null,null,null,'CHF','gross_incl_premium',null,null,200000,'any','2026-10-23',false,'https://www.christies.com/en/help/buying-guide-important-information/financial-information','Geneva vehicle auctions 12.5% above CHF 200,000'),
  -- Bonhams: stored prices are mixed (page evidence shows both hammer and premium-inclusive), so published_price_basis
  -- here describes the schedule only; derivation for Bonhams requires an observation (see price_basis_observation).
  ('bonhams','buyer','percent',0.12,null,null,null,'USD','hammer',null,null,0,'car','2026-10-23',false,'https://www.bonhams.com/how-to-buy/buyers-premium-united-states/','US motor cars: 12% on first $250,000'),
  ('bonhams','buyer','percent',0.10,null,null,null,'USD','hammer',null,null,250000,'car','2026-10-23',false,'https://www.bonhams.com/how-to-buy/buyers-premium-united-states/','US motor cars: 10% above $250,000'),
  ('bonhams','buyer','percent',0.15,null,null,null,'USD','hammer',null,null,0,'motorcycle','2026-10-23',false,'https://www.bonhams.com/how-to-buy/buyers-premium-united-states/','US motorcycles: 15% on first $100,000'),
  ('bonhams','buyer','percent',0.10,null,null,null,'USD','hammer',null,null,100000,'motorcycle','2026-10-23',false,'https://www.bonhams.com/how-to-buy/buyers-premium-united-states/','US motorcycles: 10% above $100,000'),
  ('bonhams','buyer','percent',0.15,null,null,null,'GBP','hammer',null,null,0,'any','2026-10-23',false,'https://www.bonhams.com/how-to-buy/buyers-premium-united-kingdom/','UK motor cars and motorcycles: 15% on first GBP 500,000 (+VAT on premium, not modelled)'),
  ('bonhams','buyer','percent',0.12,null,null,null,'GBP','hammer',null,null,500000,'any','2026-10-23',false,'https://www.bonhams.com/how-to-buy/buyers-premium-united-kingdom/','UK motor cars and motorcycles: 12% above GBP 500,000'),
  ('bonhams','buyer','percent',0.15,null,null,null,'EUR','hammer',null,null,0,'any','2026-10-23',false,'https://www.bonhams.com/how-to-buy/buyers-premium-france-monaco/','France/Monaco/Germany/Zoute motor cars and motorcycles: 15% of hammer (+TVA on premium, not modelled)'),
  ('bonhams','buyer','percent',0.15,null,null,null,'CHF','hammer',null,null,0,'any','2026-10-23',false,'https://images1.bonhams.com/original?src=Images%2Flive%2F2022-06%2F07%2FC-27530-0-1.pdf','Gstaad 2022 catalogue: 15% of hammer on each lot (+Swiss VAT for Swiss-domiciled buyers, not modelled)'),
  -- BaT 10% categories (motorcycles; minibikes, parts, wheels, ATVs, go-karts, tractors not classified yet)
  ('bat','buyer','percent',0.10,250,4000,null,'USD','hammer','2025-06-12 07:00+00',null,0,'motorcycle','2026-10-23',true,'https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','10% / $250 min / $4,000 cap for listings first bid on or after 2025-06-12; sales closing up to ~2 weeks later may still be 5%'),
  -- BaT local-currency caps for EU/UK listings
  ('bat','buyer','percent',0.05,250,7500,null,'EUR','hammer','2025-02-03 08:00+00',null,0,'any','2026-10-23',true,'https://bringatrailer.com/2025/02/03/site-update-new-features-for-international-listings-and-bidders/','EU listings: 5% / EUR 250 min / EUR 7,500 cap'),
  ('bat','buyer','percent',0.05,250,6000,null,'GBP','hammer','2025-02-03 08:00+00',null,0,'any','2026-10-23',true,'https://bringatrailer.com/2025/02/03/site-update-new-features-for-international-listings-and-bidders/','UK listings: 5% / GBP 250 min / GBP 6,000 cap'),
  ('bat','buyer','percent',0.10,250,4000,null,'EUR','hammer','2025-06-12 07:00+00',null,0,'motorcycle','2026-10-23',true,'https://bringatrailer.com/how-bat-works/','EU 10% categories: EUR 4,000 cap'),
  ('bat','buyer','percent',0.10,250,3200,null,'GBP','hammer','2025-06-12 07:00+00',null,0,'motorcycle','2026-10-23',true,'https://bringatrailer.com/uk/','UK 10% categories: GBP 250 min / GBP 3,200 cap'),
  ('bat','seller','flat',null,null,null,99,'EUR',null,'2025-02-03 08:00+00',null,0,'any','2026-10-23',false,'https://bringatrailer.com/2025/02/03/site-update-new-features-for-international-listings-and-bidders/','EU Classic listing fee EUR 99'),
  ('bat','seller','flat',null,null,null,79,'GBP',null,'2025-02-03 08:00+00',null,0,'any','2026-10-23',false,'https://bringatrailer.com/uk/','UK Classic listing fee GBP 79')
) v(platform, role, fee_kind, rate, min_amount, cap_amount, flat_amount, currency, published_price_basis, valid_from, valid_to, tier_floor, lot_class, cited_on, history_verified, source_url, notes)
where not exists (select 1 from public.platform_fee_schedule where platform in ('gooding','bonhams'));


-- ─── Keep v1 derivation on its original rows (USD, single tier, any class), so the in-flight v1 backfill is unaffected ─
create or replace function public.derive_price_components(p_platform text, p_price numeric, p_at timestamptz)
returns table (price_basis public.price_basis_t, hammer_price numeric, hammer_price_source text, hammer_price_confidence text,
  buyer_premium_amount numeric, buyer_premium_rate numeric, buyer_premium_source text, buyer_premium_confidence text,
  gross_price numeric, gross_price_source text, gross_price_confidence text,
  seller_fee_amount numeric, seller_fee_source text, seller_fee_confidence text,
  net_to_owner numeric, net_to_owner_source text, net_to_owner_confidence text)
language plpgsql stable set search_path = public as $$
declare b platform_fee_schedule; s platform_fee_schedule; v_conf text; v_bsrc text; v_ssrc text;
begin
  if p_price is null or p_price <= 0 then return; end if;
  select * into b from platform_fee_schedule f where f.platform = p_platform and f.role = 'buyer' and f.currency = 'USD' and f.lot_class = 'any' and f.tier_floor = 0 and f.platform not in ('gooding','bonhams')
    and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
    order by f.valid_from desc nulls last limit 1;
  if not found then
    price_basis := 'unknown'; return next; return;
  end if;
  v_conf := case when p_at is null then 'schedule_current_sale_undated' else 'schedule_dated' end;
  v_bsrc := 'platform_fee_schedule:' || b.id || ' ' || b.source_url;
  price_basis := b.published_price_basis;
  buyer_premium_rate := b.rate; buyer_premium_source := v_bsrc;
  if b.published_price_basis = 'hammer' then
    hammer_price := p_price; hammer_price_source := 'legacy price column (platform publishes hammer)'; hammer_price_confidence := 'reported';
    buyer_premium_amount := round(p_price * b.rate);
    if b.min_amount is not null then buyer_premium_amount := greatest(buyer_premium_amount, b.min_amount); end if;
    if b.cap_amount is not null then buyer_premium_amount := least(buyer_premium_amount, b.cap_amount); end if;
    buyer_premium_confidence := v_conf;
    gross_price := hammer_price + buyer_premium_amount; gross_price_source := v_bsrc; gross_price_confidence := v_conf;
  else
    gross_price := p_price; gross_price_source := 'legacy price column (platform publishes premium-inclusive)'; gross_price_confidence := 'reported';
    hammer_price := round(p_price / (1 + b.rate)); hammer_price_source := v_bsrc;
    hammer_price_confidence := case when b.cap_amount is null and b.min_amount is null then 'derived_from_gross' else 'derived_from_gross_cap_ignored' end;
    buyer_premium_amount := p_price - hammer_price; buyer_premium_confidence := hammer_price_confidence;
  end if;
  select * into s from platform_fee_schedule f where f.platform = p_platform and f.role = 'seller' and f.currency = 'USD' and f.lot_class = 'any'
    and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
    order by f.valid_from desc nulls last limit 1;
  if found then
    v_ssrc := 'platform_fee_schedule:' || s.id || ' ' || s.source_url;
    seller_fee_amount := case when s.fee_kind = 'flat' then s.flat_amount
      else least(greatest(round(hammer_price * s.rate), coalesce(s.min_amount, 0)), coalesce(s.cap_amount, 'Infinity'::numeric)) end;
    seller_fee_source := v_ssrc; seller_fee_confidence := 'schedule_current_not_dated';
    net_to_owner := hammer_price - seller_fee_amount; net_to_owner_source := v_ssrc;
    net_to_owner_confidence := 'schedule_current_not_dated';
  end if;
  return next;
end $$;

-- ─── Observation-level basis evidence ───────────────────────────────────────
-- One row per (event, rule): what a source said the stored price was. kind:
--   observed_page        both hammer and premium-inclusive figures read from the lot page; observed_basis says which one the row stores
--   convention_conflict  the platform convention says gross, but the stored value looks like a round hammer; basis unresolved (flag only)
create table if not exists public.price_basis_observation (
  id bigserial primary key,
  tbl text not null check (tbl in ('vehicle_events','auction_events')),
  event_id uuid not null,                     -- no FK: supersede re-ids events
  kind text not null check (kind in ('observed_page','convention_conflict')),
  observed_basis public.price_basis_t,        -- null when unresolved
  observed_hammer numeric,
  observed_gross numeric,
  currency text,
  stored_price numeric not null,
  evidence text not null,
  source_url text,
  observed_on date,
  rule text not null,
  run_id text not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (tbl, event_id, rule),
  check (kind <> 'observed_page' or (observed_basis is not null and observed_hammer is not null and observed_gross is not null))
);
create index if not exists price_basis_observation_event on public.price_basis_observation(event_id) where superseded_at is null;
alter table public.price_basis_observation enable row level security;
drop policy if exists price_basis_observation_read on public.price_basis_observation;
create policy price_basis_observation_read on public.price_basis_observation for select using (true);

create or replace view public.price_basis_conflicts with (security_invoker = true) as
  select o.tbl, o.event_id, o.rule, o.stored_price, o.evidence, o.run_id
  from public.price_basis_observation o where o.kind = 'convention_conflict' and o.superseded_at is null;

-- ─── Typed fx + conflict columns on events ──────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['vehicle_events','auction_events'] loop
    execute format('alter table public.%I add column if not exists fx_to_usd numeric, add column if not exists fx_to_usd_source text, add column if not exists price_basis_conflict boolean', t);
    execute format($f$comment on column public.%1$I.fx_to_usd is 'USD per unit of the sale currency on the sale date (fx_usd_rate); multiply hammer/gross/net by it for USD. NULL = no rate.'$f$, t);
    execute format($f$comment on column public.%1$I.price_basis_conflict is 'true = stored price conflicts with the platform convention (see price_basis_conflicts); derived columns kept, consumers should exclude or down-weight.'$f$, t);
  end loop;
end $$;

-- ─── Tier math ──────────────────────────────────────────────────────────────
create or replace function public.fee_schedule_premium(p_ids bigint[], p_hammer numeric)
returns numeric language sql stable set search_path = public as $$
  with t as (select rate, tier_floor, min_amount, cap_amount,
               lead(tier_floor) over (order by tier_floor) nxt from platform_fee_schedule where id = any(p_ids)),
  s as (select sum(rate * greatest(0, least(p_hammer, coalesce(nxt, p_hammer)) - tier_floor)) prem,
               max(min_amount) filter (where tier_floor = 0) mn, max(cap_amount) filter (where tier_floor = 0) cp from t)
  select round(least(greatest(prem, coalesce(mn, 0)), coalesce(cp, 'Infinity'::numeric)), 2) from s
$$;

-- inverse for premium-inclusive prices (tiers without min/cap only)
create or replace function public.fee_schedule_hammer_from_gross(p_ids bigint[], p_gross numeric)
returns numeric language sql stable set search_path = public as $$
  with t as (select rate, tier_floor from platform_fee_schedule where id = any(p_ids)),
  g as (select rate, tier_floor, tier_floor + fee_schedule_premium(p_ids, tier_floor) g_at_floor from t)
  select round(tier_floor + (p_gross - g_at_floor) / (1 + rate), 2) from g where g_at_floor <= p_gross order by tier_floor desc limit 1
$$;

-- ─── Derivation v2 ──────────────────────────────────────────────────────────
create or replace function public.derive_price_components_v2(p_tbl text, p_event_id uuid, p_platform text, p_price numeric,
  p_at timestamptz, p_currency text, p_lot_class text)
returns table (price_basis public.price_basis_t, hammer_price numeric, hammer_price_source text, hammer_price_confidence text,
  buyer_premium_amount numeric, buyer_premium_rate numeric, buyer_premium_source text, buyer_premium_confidence text,
  gross_price numeric, gross_price_source text, gross_price_confidence text,
  seller_fee_amount numeric, seller_fee_source text, seller_fee_confidence text,
  net_to_owner numeric, net_to_owner_source text, net_to_owner_confidence text,
  fx_to_usd numeric, fx_to_usd_source text, price_basis_conflict boolean)
language plpgsql stable set search_path = public as $$
declare v_cur text := upper(coalesce(p_currency, 'USD')); v_class text := coalesce(p_lot_class, 'car');
  pick record; ids bigint[]; b platform_fee_schedule; s platform_fee_schedule; o price_basis_observation; v_conf text; v_bsrc text;
begin
  if p_price is null or p_price <= 0 then return; end if;
  select r.rate, r.rate_date, r.source into pick from fx_usd_rate(v_cur, p_at::date) r limit 1;
  if found then fx_to_usd := pick.rate; fx_to_usd_source := pick.source || ' (' || pick.rate_date || ')'; end if;
  select * into o from price_basis_observation x where x.tbl = p_tbl and x.event_id = p_event_id and x.superseded_at is null
    order by (x.kind = 'observed_page') desc, x.id desc limit 1;
  price_basis_conflict := case when o.id is not null and o.kind = 'convention_conflict' then true end;

  -- pick one schedule set: exact lot class first, then newest valid_from
  select f.lot_class, f.valid_from into pick from platform_fee_schedule f
   where f.platform = p_platform and f.role = 'buyer' and upper(f.currency) = v_cur and f.lot_class in (v_class, 'any')
     and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
   order by (f.lot_class = v_class) desc, f.valid_from desc nulls last limit 1;
  if found then
    select array_agg(f.id order by f.tier_floor) into ids from platform_fee_schedule f
     where f.platform = p_platform and f.role = 'buyer' and upper(f.currency) = v_cur and f.lot_class = pick.lot_class
       and f.valid_from is not distinct from pick.valid_from;
    select * into b from platform_fee_schedule where id = ids[1];
    v_bsrc := 'platform_fee_schedule:' || array_to_string(ids, ',') || ' ' || b.source_url;
    v_conf := case when not b.history_verified then 'schedule_current_history_unverified'
                   when p_at is null then 'schedule_current_sale_undated' else 'schedule_dated' end;
  end if;

  if o.id is not null and o.kind = 'observed_page' then
    -- the page told us both figures: use them, cite the observation
    price_basis := o.observed_basis;
    hammer_price := o.observed_hammer; hammer_price_source := 'price_basis_observation:' || o.id || ' ' || coalesce(o.source_url, ''); hammer_price_confidence := 'observed';
    gross_price := o.observed_gross; gross_price_source := hammer_price_source; gross_price_confidence := 'observed';
    buyer_premium_amount := o.observed_gross - o.observed_hammer; buyer_premium_source := hammer_price_source; buyer_premium_confidence := 'observed';
    buyer_premium_rate := round(buyer_premium_amount / nullif(o.observed_hammer, 0), 4);
  elsif ids is null then
    price_basis := 'unknown'; return next; return;
  elsif p_platform = 'bonhams' then
    -- Bonhams rows are stored on mixed bases; without an observation the basis is unknown (schedule is known, basis is not)
    price_basis := 'unknown'; return next; return;
  elsif b.published_price_basis = 'hammer' then
    price_basis := 'hammer';
    hammer_price := p_price; hammer_price_source := 'legacy price column (platform publishes hammer)'; hammer_price_confidence := 'reported';
    buyer_premium_amount := fee_schedule_premium(ids, p_price); buyer_premium_source := v_bsrc; buyer_premium_confidence := v_conf;
    buyer_premium_rate := case when array_length(ids, 1) = 1 then b.rate else round(buyer_premium_amount / p_price, 4) end;
    gross_price := hammer_price + buyer_premium_amount; gross_price_source := v_bsrc; gross_price_confidence := v_conf;
  else
    price_basis := 'gross_incl_premium';
    gross_price := p_price; gross_price_source := 'legacy price column (platform publishes premium-inclusive)'; gross_price_confidence := 'reported';
    hammer_price := fee_schedule_hammer_from_gross(ids, p_price); hammer_price_source := v_bsrc;
    hammer_price_confidence := case when price_basis_conflict then 'derived_from_gross_convention_conflict' else 'derived_from_gross_' || v_conf end;
    buyer_premium_amount := p_price - hammer_price; buyer_premium_source := v_bsrc; buyer_premium_confidence := hammer_price_confidence;
    buyer_premium_rate := round(buyer_premium_amount / nullif(hammer_price, 0), 4);
  end if;

  select * into s from platform_fee_schedule f where f.platform = p_platform and f.role = 'seller' and upper(f.currency) = v_cur
    and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
    order by f.valid_from desc nulls last limit 1;
  if found and hammer_price is not null then
    seller_fee_amount := case when s.fee_kind = 'flat' then s.flat_amount
      else least(greatest(round(hammer_price * s.rate), coalesce(s.min_amount, 0)), coalesce(s.cap_amount, 'Infinity'::numeric)) end;
    seller_fee_source := 'platform_fee_schedule:' || s.id || ' ' || s.source_url; seller_fee_confidence := 'schedule_current_not_dated';
    net_to_owner := hammer_price - seller_fee_amount; net_to_owner_source := seller_fee_source; net_to_owner_confidence := seller_fee_confidence;
  end if;
  return next;
end $$;

-- ─── Backfill v2: its own queue (keyed by run), backs up any row it re-derives ─
create table if not exists public.price_basis_backfill_queue_v2 (
  tbl text not null check (tbl in ('vehicle_events','auction_events')),
  id uuid not null,
  run_id text not null,
  lot_class text,
  currency text,
  done_at timestamptz,
  primary key (run_id, tbl, id)
);
create index if not exists price_basis_backfill_queue_v2_todo on public.price_basis_backfill_queue_v2(run_id, tbl) where done_at is null;
alter table public.price_basis_backfill_queue_v2 enable row level security;

create table if not exists public.price_basis_backup_v2 (
  run_id text not null, tbl text not null, id uuid not null, old jsonb not null, backed_up_at timestamptz not null default now(),
  primary key (run_id, tbl, id)
);
alter table public.price_basis_backup_v2 enable row level security;

create or replace function public.backfill_price_basis_batch_v2(p_tbl text, p_run_id text, p_limit int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare n int; cols constant text := 'price_basis, hammer_price, hammer_price_source, hammer_price_confidence, buyer_premium_amount, buyer_premium_rate, buyer_premium_source, buyer_premium_confidence, gross_price, gross_price_source, gross_price_confidence, seller_fee_amount, seller_fee_source, seller_fee_confidence, net_to_owner, net_to_owner_source, net_to_owner_confidence, fx_to_usd, fx_to_usd_source, price_basis_conflict';
  v_price text; v_plat text; v_at text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'backfill_price_basis_batch_v2: batch size must be 1..500'; end if;
  if p_run_id is null then raise exception 'backfill_price_basis_batch_v2: run_id required'; end if;
  if p_tbl = 'vehicle_events' then v_price := 'e.final_price'; v_plat := 'e.source_platform'; v_at := 'coalesce(e.sold_at, e.ended_at)';
  elsif p_tbl = 'auction_events' then v_price := 'e.winning_bid'; v_plat := 'e.source'; v_at := 'e.auction_end_date';
  else raise exception 'backfill_price_basis_batch_v2: unknown table %', p_tbl; end if;
  execute format($q$
    with q as (select id, lot_class, currency from price_basis_backfill_queue_v2 where run_id = $1 and tbl = $2 and done_at is null limit $3 for update skip locked),
    bk as (insert into price_basis_backup_v2 (run_id, tbl, id, old)
           select $1, $2, e.id, jsonb_build_object('price_basis', e.price_basis, 'hammer_price', e.hammer_price, 'hammer_price_source', e.hammer_price_source, 'hammer_price_confidence', e.hammer_price_confidence, 'buyer_premium_amount', e.buyer_premium_amount, 'buyer_premium_rate', e.buyer_premium_rate, 'buyer_premium_source', e.buyer_premium_source, 'buyer_premium_confidence', e.buyer_premium_confidence, 'gross_price', e.gross_price, 'gross_price_source', e.gross_price_source, 'gross_price_confidence', e.gross_price_confidence, 'seller_fee_amount', e.seller_fee_amount, 'seller_fee_source', e.seller_fee_source, 'seller_fee_confidence', e.seller_fee_confidence, 'net_to_owner', e.net_to_owner, 'net_to_owner_source', e.net_to_owner_source, 'net_to_owner_confidence', e.net_to_owner_confidence, 'fx_to_usd', e.fx_to_usd, 'fx_to_usd_source', e.fx_to_usd_source, 'price_basis_conflict', e.price_basis_conflict, 'price_basis_run_id', e.price_basis_run_id)
           from %1$I e join q on q.id = e.id on conflict do nothing),
    u as (update %1$I e set (%2$s, price_basis_run_id)
            = (select d.*, $1 from derive_price_components_v2($2, e.id, %3$s, %4$s, %5$s, q.currency, q.lot_class) d)
          from q where e.id = q.id returning e.id)
    update price_basis_backfill_queue_v2 b set done_at = now() from q where b.run_id = $1 and b.tbl = $2 and b.id = q.id
  $q$, p_tbl, cols, v_plat, v_price, v_at) using p_run_id, p_tbl, p_limit;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.backfill_price_basis_batch_v2(text, text, int) from public, anon, authenticated;

-- exact restore of a v2 run from its backup
create or replace function public.revert_price_basis_run_v2(p_run_id text)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; m int; t text;
begin
  foreach t in array array['vehicle_events','auction_events'] loop
    execute format($q$
      update %1$I e set (price_basis, hammer_price, hammer_price_source, hammer_price_confidence, buyer_premium_amount, buyer_premium_rate, buyer_premium_source, buyer_premium_confidence, gross_price, gross_price_source, gross_price_confidence, seller_fee_amount, seller_fee_source, seller_fee_confidence, net_to_owner, net_to_owner_source, net_to_owner_confidence, fx_to_usd, fx_to_usd_source, price_basis_conflict, price_basis_run_id)
      = (select r.price_basis, r.hammer_price, r.hammer_price_source, r.hammer_price_confidence, r.buyer_premium_amount, r.buyer_premium_rate, r.buyer_premium_source, r.buyer_premium_confidence, r.gross_price, r.gross_price_source, r.gross_price_confidence, r.seller_fee_amount, r.seller_fee_source, r.seller_fee_confidence, r.net_to_owner, r.net_to_owner_source, r.net_to_owner_confidence, r.fx_to_usd, r.fx_to_usd_source, r.price_basis_conflict, r.price_basis_run_id
         from jsonb_populate_record(null::%1$I, b.old) r)
      from price_basis_backup_v2 b where b.run_id = $1 and b.tbl = %1$L and b.id = e.id and e.price_basis_run_id = $1
    $q$, t) using p_run_id;
    get diagnostics m = row_count; n := n + m;
  end loop;
  update price_basis_observation set superseded_at = now() where run_id = p_run_id and superseded_at is null;
  return n;
end $$;
revoke all on function public.revert_price_basis_run_v2(text) from public, anon, authenticated;
