-- Restores derive_price_components_v3 as defined in 20261025140000.
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
