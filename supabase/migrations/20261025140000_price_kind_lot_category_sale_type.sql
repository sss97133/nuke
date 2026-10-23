-- Price kind, lot category and sale type as first-class, cited event fields; fee derivation v3 uses them.
-- Additive only. Rollback: supabase/rollbacks/20261025140000_price_kind_lot_category_sale_type_down.sql
--
-- price_kind  : what the stored price IS. 'sale' (a sold price), 'high_bid_unsold' (the top bid on a lot that did not sell,
--               e.g. Mecum "Bid Goes On"), 'estimate' (a pre-sale estimate stored as a price), 'unknown'.
--               Only 'sale' rows get hammer / gross / net components; a high bid is neither a buyer-paid gross nor a hammer.
-- lot_category: the platform's own lot category (BaT: motorcycle, minibike, parts, wheels, atv, go_kart, tractor ... ; else car).
-- sale_type   : 'live' | 'online' | 'unknown' (Gooding Geared Online is online-only, 10% premium, publishes the final bid).
-- Each has a *_source column naming the source field it was read from.

do $$ declare t text; begin
  foreach t in array array['vehicle_events','auction_events'] loop
    execute format('alter table public.%I
      add column if not exists price_kind text check (price_kind in (''sale'',''high_bid_unsold'',''estimate'',''unknown'')),
      add column if not exists price_kind_source text,
      add column if not exists lot_category text check (lot_category in (''car'',''motorcycle'',''minibike'',''parts'',''wheels'',''atv'',''go_kart'',''tractor'',''automobilia'',''other'')),
      add column if not exists lot_category_source text,
      add column if not exists sale_type text check (sale_type in (''live'',''online'',''unknown'')),
      add column if not exists sale_type_source text', t);
  end loop;
end $$;
comment on column public.vehicle_events.price_kind is 'What the stored price is: sale | high_bid_unsold | estimate | unknown. Price components (hammer/gross/net) exist only for sale.';
comment on column public.vehicle_events.lot_category is 'Platform lot category, read from source data (see lot_category_source). Drives fee class via platform_lot_category_class.';
comment on column public.vehicle_events.sale_type is 'live | online | unknown, read from source data (see sale_type_source). Drives fee schedule choice (platform_fee_schedule.sale_type).';

-- fee schedule: sale_type + wider lot_class
alter table public.platform_fee_schedule add column if not exists sale_type text not null default 'any' check (sale_type in ('any','live','online'));
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.platform_fee_schedule'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%lot_class%';
  if c is not null then execute format('alter table public.platform_fee_schedule drop constraint %I', c); end if;
end $$;
alter table public.platform_fee_schedule add constraint platform_fee_schedule_lot_class_check
  check (lot_class in ('any','car','motorcycle','non_car'));

-- which fee class a platform applies to each lot category (cited)
create table if not exists public.platform_lot_category_class (
  platform text not null, lot_category text not null, lot_class text not null, source_url text not null, cited_on date not null,
  primary key (platform, lot_category));
alter table public.platform_lot_category_class enable row level security;
insert into public.platform_lot_category_class values
  ('bat','motorcycle','motorcycle','https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','2026-10-23'),
  ('bat','minibike','non_car','https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','2026-10-23'),
  ('bat','parts','non_car','https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','2026-10-23'),
  ('bat','automobilia','non_car','https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','2026-10-23'),
  ('bat','wheels','non_car','https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','2026-10-23'),
  ('bat','atv','non_car','https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','2026-10-23'),
  ('bat','go_kart','non_car','https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','2026-10-23'),
  ('bat','tractor','non_car','https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','2026-10-23'),
  ('broad_arrow','automobilia','non_car','https://bid.broadarrowauctions.com/conditions-of-sale','2026-10-23'),
  ('broad_arrow','parts','non_car','https://bid.broadarrowauctions.com/conditions-of-sale','2026-10-23'),
  ('broad_arrow','motorcycle','non_car','https://bid.broadarrowauctions.com/conditions-of-sale','2026-10-23'),
  ('gooding','automobilia','non_car','https://bid.goodingco.com/conditions-of-sale','2026-10-23')
on conflict do nothing;

-- new cited schedule rows (lot_class car / non_car or sale_type online, so v1 (any/USD/tier0) never sees them)
insert into public.platform_fee_schedule (platform, role, fee_kind, rate, min_amount, cap_amount, flat_amount, currency, published_price_basis, valid_from, valid_to, tier_floor, lot_class, sale_type, cited_on, history_verified, source_url, notes)
select * from (values
  ('bat','buyer','percent',0.10,250::numeric,4000::numeric,null::numeric,'USD','hammer'::price_basis_t,'2025-06-12 07:00+00'::timestamptz,null::timestamptz,0::numeric,'non_car','any','2026-10-23'::date,true,'https://bringatrailer.com/2025/06/12/bat-site-update-new-buyers-fee-structure-for-parts-automobilia-tractors-motorcycles-and-other-select-categories/','10% categories other than motorcycles: minibikes & scooters, parts & automobilia, wheels, ATVs, go-karts, tractors'),
  ('bat','buyer','percent',0.10,250,4000,null,'EUR','hammer','2025-06-12 07:00+00',null,0,'non_car','any','2026-10-23',true,'https://bringatrailer.com/how-bat-works/','EU 10% categories: EUR 4,000 cap'),
  ('bat','buyer','percent',0.10,250,3200,null,'GBP','hammer','2025-06-12 07:00+00',null,0,'non_car','any','2026-10-23',true,'https://bringatrailer.com/uk/','UK 10% categories: GBP 250 min / GBP 3,200 cap'),
  ('broad_arrow','buyer','percent',0.12,null,null,null,'USD','gross_incl_premium',null,null,0,'car','any','2026-10-23',false,'https://bid.broadarrowauctions.com/conditions-of-sale','motor cars: 12% of the first $250,000 of hammer; results include premium (broadarrowauctions.com results notes)'),
  ('broad_arrow','buyer','percent',0.10,null,null,null,'USD','gross_incl_premium',null,null,250000,'car','any','2026-10-23',false,'https://bid.broadarrowauctions.com/conditions-of-sale','motor cars: 10% of hammer above $250,000'),
  ('broad_arrow','buyer','percent',0.25,null,null,null,'USD','gross_incl_premium',null,null,0,'non_car','any','2026-10-23',false,'https://bid.broadarrowauctions.com/conditions-of-sale','non-motor-car lots (memorabilia, parts, motorcycles ...): 25% (an older press note says 20%)'),
  ('barrettjackson','buyer','percent',0.08,null,null,null,'USD','gross_incl_premium','1971-01-01 00:00+00',null,0,'car','any','2026-10-23',false,'https://www.hagerty.com/media/archived/newcomers-guide-to-barrett-jackson-classic-car-auction/','8% buyer premium (Hagerty 2004 guide; Autoweek); Hot Rod Jul 2008 reports 10% for Scottsdale 2008. valid_to set below'),
  ('barrett-jackson','buyer','percent',0.08,null,null,null,'USD','gross_incl_premium','1971-01-01 00:00+00',null,0,'car','any','2026-10-23',false,'https://www.hagerty.com/media/archived/newcomers-guide-to-barrett-jackson-classic-car-auction/','alias slug of barrettjackson'),
  ('gooding','buyer','percent',0.10,null,null,null,'USD','hammer',null,null,0,'any','online','2026-10-23',false,'https://www.goodingco.com/auction/geared-online-may-2021/','Geared Online (online-only): 10% of final bid; the price shown after "Purchased For" is the final bid, premium excluded'),
  ('gooding','buyer','percent',0.25,null,null,null,'USD','gross_incl_premium',null,null,0,'non_car','any','2026-10-23',false,'https://bid.goodingco.com/conditions-of-sale','automobilia lots: 25%')
) v
where not exists (select 1 from public.platform_fee_schedule f where f.platform = v.column1 and f.lot_class = v.column13 and f.sale_type = v.column14
                    and f.currency = v.column8 and f.tier_floor = v.column12 and f.rate = v.column4);
update public.platform_fee_schedule set valid_to = '2008-01-01 00:00+00'
 where platform in ('barrettjackson','barrett-jackson') and rate = 0.08 and lot_class = 'car' and valid_to is null;

-- observations: a page read that shows status/price but not both hammer and gross
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.price_basis_observation'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.price_basis_observation drop constraint %I', c);
  end loop;
end $$;
alter table public.price_basis_observation add column if not exists observed_status text, add column if not exists observed_price numeric;
alter table public.price_basis_observation
  add constraint price_basis_observation_kind_check check (kind in ('observed_page','convention_conflict','observed_page_status','pattern_resolution')),
  add constraint price_basis_observation_observed_page_check check (kind <> 'observed_page' or (observed_basis is not null and observed_hammer is not null and observed_gross is not null)),
  add constraint price_basis_observation_status_check check (kind <> 'observed_page_status' or (observed_status is not null and source_url is not null));
comment on column public.price_basis_observation.kind is 'observed_page: both figures read from the lot page | convention_conflict: stored price fits no convention (flag) | observed_page_status: the lot page shows the result status and one price | pattern_resolution: a cited rule that explains a convention_conflict (supersedes it)';

-- ─── Derivation v3: price kind, lot category -> fee class, sale type ─────────
create or replace function public.derive_price_components_v3(p_tbl text, p_event_id uuid, p_platform text, p_price numeric,
  p_at timestamptz, p_currency text, p_lot_category text, p_sale_type text, p_price_kind text, p_lot_class text default null)
returns table (price_basis public.price_basis_t, hammer_price numeric, hammer_price_source text, hammer_price_confidence text,
  buyer_premium_amount numeric, buyer_premium_rate numeric, buyer_premium_source text, buyer_premium_confidence text,
  gross_price numeric, gross_price_source text, gross_price_confidence text,
  seller_fee_amount numeric, seller_fee_source text, seller_fee_confidence text,
  net_to_owner numeric, net_to_owner_source text, net_to_owner_confidence text,
  fx_to_usd numeric, fx_to_usd_source text, price_basis_conflict boolean)
language plpgsql stable set search_path = public as $$
declare v_cur text := upper(coalesce(p_currency, 'USD')); v_class text; v_st text := coalesce(p_sale_type, 'unknown');
  pick record; ids bigint[]; b platform_fee_schedule; s platform_fee_schedule; o price_basis_observation; v_conf text; v_bsrc text;
begin
  if p_price is null or p_price <= 0 then return; end if;
  -- a high bid, an estimate or an unclassified price is not a sale: no hammer / gross / net (one row of nulls clears stale values)
  if p_price_kind is distinct from 'sale' then return next; return; end if;
  v_class := coalesce(p_lot_class, (select m.lot_class from platform_lot_category_class m where m.platform = p_platform and m.lot_category = p_lot_category), 'car');
  select r.rate, r.rate_date, r.source into pick from fx_usd_rate(v_cur, p_at::date) r limit 1;
  if found then fx_to_usd := pick.rate; fx_to_usd_source := pick.source || ' (' || pick.rate_date || ')'; end if;
  select * into o from price_basis_observation x where x.tbl = p_tbl and x.event_id = p_event_id and x.superseded_at is null
     and x.kind in ('observed_page','convention_conflict')
    order by (x.kind = 'observed_page') desc, x.id desc limit 1;
  price_basis_conflict := case when o.id is not null and o.kind = 'convention_conflict' then true end;

  -- one schedule set: exact sale type, then exact lot class, then newest valid_from
  select f.lot_class, f.valid_from, f.sale_type into pick from platform_fee_schedule f
   where f.platform = p_platform and f.role = 'buyer' and upper(f.currency) = v_cur and f.lot_class in (v_class, 'any')
     and f.sale_type in (v_st, 'any')
     and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
   order by (f.sale_type = v_st) desc, (f.lot_class = v_class) desc, f.valid_from desc nulls last limit 1;
  if found then
    select array_agg(f.id order by f.tier_floor) into ids from platform_fee_schedule f
     where f.platform = p_platform and f.role = 'buyer' and upper(f.currency) = v_cur and f.lot_class = pick.lot_class
       and f.sale_type = pick.sale_type and f.valid_from is not distinct from pick.valid_from;
    select * into b from platform_fee_schedule where id = ids[1];
    v_bsrc := 'platform_fee_schedule:' || array_to_string(ids, ',') || ' ' || b.source_url;
    v_conf := case when not b.history_verified then 'schedule_current_history_unverified'
                   when p_at is null then 'schedule_current_sale_undated' else 'schedule_dated' end;
  end if;

  if o.id is not null and o.kind = 'observed_page' then
    price_basis := o.observed_basis;
    hammer_price := o.observed_hammer; hammer_price_source := 'price_basis_observation:' || o.id || ' ' || coalesce(o.source_url, ''); hammer_price_confidence := 'observed';
    gross_price := o.observed_gross; gross_price_source := hammer_price_source; gross_price_confidence := 'observed';
    buyer_premium_amount := o.observed_gross - o.observed_hammer; buyer_premium_source := hammer_price_source; buyer_premium_confidence := 'observed';
    buyer_premium_rate := round(buyer_premium_amount / nullif(o.observed_hammer, 0), 4);
  elsif ids is null then
    price_basis := 'unknown'; return next; return;
  elsif p_platform = 'bonhams' then
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

-- v2 keeps its exact behaviour: it only ever sees sale_type any and its original lot classes
create or replace function public.derive_price_components_v2(p_tbl text, p_event_id uuid, p_platform text, p_price numeric,
  p_at timestamptz, p_currency text, p_lot_class text)
returns table (price_basis public.price_basis_t, hammer_price numeric, hammer_price_source text, hammer_price_confidence text,
  buyer_premium_amount numeric, buyer_premium_rate numeric, buyer_premium_source text, buyer_premium_confidence text,
  gross_price numeric, gross_price_source text, gross_price_confidence text,
  seller_fee_amount numeric, seller_fee_source text, seller_fee_confidence text,
  net_to_owner numeric, net_to_owner_source text, net_to_owner_confidence text,
  fx_to_usd numeric, fx_to_usd_source text, price_basis_conflict boolean)
language sql stable set search_path = public as $$
  select * from public.derive_price_components_v3(p_tbl, p_event_id, p_platform, p_price, p_at, p_currency, null, 'live', 'sale', coalesce(p_lot_class, 'car'))
$$;

-- ─── Backfill v3: queue keyed by run; backs up into price_basis_backup_v2 so revert_price_basis_run_v2(run) restores it ─
create table if not exists public.price_basis_backfill_queue_v3 (
  tbl text not null check (tbl in ('vehicle_events','auction_events')), id uuid not null, run_id text not null,
  done_at timestamptz, primary key (run_id, tbl, id));
create index if not exists price_basis_backfill_queue_v3_todo on public.price_basis_backfill_queue_v3(run_id, tbl) where done_at is null;
alter table public.price_basis_backfill_queue_v3 enable row level security;

create or replace function public.backfill_price_basis_batch_v3(p_tbl text, p_run_id text, p_limit int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare n int; cols constant text := 'price_basis, hammer_price, hammer_price_source, hammer_price_confidence, buyer_premium_amount, buyer_premium_rate, buyer_premium_source, buyer_premium_confidence, gross_price, gross_price_source, gross_price_confidence, seller_fee_amount, seller_fee_source, seller_fee_confidence, net_to_owner, net_to_owner_source, net_to_owner_confidence, fx_to_usd, fx_to_usd_source, price_basis_conflict';
  v_price text; v_plat text; v_at text; v_cur text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 2000 then raise exception 'backfill_price_basis_batch_v3: batch size must be 1..2000'; end if;
  if p_run_id is null then raise exception 'backfill_price_basis_batch_v3: run_id required'; end if;
  if p_tbl = 'vehicle_events' then v_price := 'e.final_price'; v_plat := 'e.source_platform'; v_at := 'coalesce(e.sold_at, e.ended_at)';
  elsif p_tbl = 'auction_events' then v_price := 'e.winning_bid'; v_plat := 'e.source'; v_at := 'e.auction_end_date';
  else raise exception 'backfill_price_basis_batch_v3: unknown table %', p_tbl; end if;
  execute format($q$
    with q as (select id from price_basis_backfill_queue_v3 where run_id = $1 and tbl = $2 and done_at is null limit $3 for update skip locked),
    bk as (insert into price_basis_backup_v2 (run_id, tbl, id, old)
           select $1, $2, e.id, jsonb_build_object('price_basis', e.price_basis, 'hammer_price', e.hammer_price, 'hammer_price_source', e.hammer_price_source, 'hammer_price_confidence', e.hammer_price_confidence, 'buyer_premium_amount', e.buyer_premium_amount, 'buyer_premium_rate', e.buyer_premium_rate, 'buyer_premium_source', e.buyer_premium_source, 'buyer_premium_confidence', e.buyer_premium_confidence, 'gross_price', e.gross_price, 'gross_price_source', e.gross_price_source, 'gross_price_confidence', e.gross_price_confidence, 'seller_fee_amount', e.seller_fee_amount, 'seller_fee_source', e.seller_fee_source, 'seller_fee_confidence', e.seller_fee_confidence, 'net_to_owner', e.net_to_owner, 'net_to_owner_source', e.net_to_owner_source, 'net_to_owner_confidence', e.net_to_owner_confidence, 'fx_to_usd', e.fx_to_usd, 'fx_to_usd_source', e.fx_to_usd_source, 'price_basis_conflict', e.price_basis_conflict, 'price_basis_run_id', e.price_basis_run_id)
           from %1$I e join q on q.id = e.id on conflict do nothing),
    u as (update %1$I e set (%2$s, price_basis_run_id)
            = (select d.price_basis, d.hammer_price, d.hammer_price_source, d.hammer_price_confidence, d.buyer_premium_amount, d.buyer_premium_rate, d.buyer_premium_source, d.buyer_premium_confidence, d.gross_price, d.gross_price_source, d.gross_price_confidence, d.seller_fee_amount, d.seller_fee_source, d.seller_fee_confidence, d.net_to_owner, d.net_to_owner_source, d.net_to_owner_confidence, d.fx_to_usd, d.fx_to_usd_source, d.price_basis_conflict, $1
               from (select 1) one left join lateral derive_price_components_v3($2, e.id, %3$s, %4$s, %5$s, e.currency_code, e.lot_category, e.sale_type, coalesce(e.price_kind, 'sale')) d on true)
          from q where e.id = q.id returning e.id)
    update price_basis_backfill_queue_v3 b set done_at = now() from q where b.run_id = $1 and b.tbl = $2 and b.id = q.id
  $q$, p_tbl, cols, v_plat, v_price, v_at) using p_run_id, p_tbl, p_limit;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.backfill_price_basis_batch_v3(text, text, int) from public, anon, authenticated;
