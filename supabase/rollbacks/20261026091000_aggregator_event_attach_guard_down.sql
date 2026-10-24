-- Rollback of 20261026091000_aggregator_event_attach_guard: drop the guard trigger and its functions, restore the
-- untrusted-price function/view (no source_suspect leg) and the sync trigger body from 20261026080000.
-- Data flags written by run agg_attach_audit_v1_20261024 are reverted separately: supabase/sql/revert_agg_attach_audit_v1_20261024.sql
SET lock_timeout = '10s';
drop trigger if exists trg_guard_aggregator_event_attach on public.vehicle_events;
drop function if exists public.guard_aggregator_event_attach();
drop function if exists public.aggregator_event_attach_basis(uuid, uuid, text, text, jsonb);
drop function if exists public.aggregator_chassis_vin_match(text, text);
drop function if exists public.aggregator_event_is_aggregator(text, text);
drop function if exists public.aggregator_chassis_norm(text);

CREATE OR REPLACE FUNCTION public.vehicle_sale_price_untrusted(p_vehicle_id uuid, p_sale_price numeric)
 RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $function$
  select p_sale_price is not null and (
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and pv.price_verification in ('unverified','contradicted') and pv.final_price = p_sale_price)
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.final_price = p_sale_price and (ok.price_verification is null or ok.price_verification = 'verified')
              and ok.sale_truth_role is distinct from 'duplicate'))
    or
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and pv.price_verification = 'verified' and pv.final_price <> p_sale_price)
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.price_verification = 'verified' and ok.final_price = p_sale_price))
  )
$function$;

CREATE OR REPLACE VIEW public.vehicle_sale_price_untrusted_ids AS
 WITH cand AS MATERIALIZED (SELECT DISTINCT pv.vehicle_id FROM vehicle_events pv WHERE pv.price_verification IS NOT NULL)
 SELECT v.id AS vehicle_id
   FROM cand c JOIN vehicles v ON v.id = c.vehicle_id JOIN vehicle_events ev ON ev.vehicle_id = c.vehicle_id
  WHERE v.sale_price IS NOT NULL
  GROUP BY v.id, v.sale_price
 HAVING (COALESCE(bool_or(ev.price_verification = ANY (ARRAY['unverified','contradicted']) AND ev.final_price = v.sale_price::numeric), false)
         AND NOT COALESCE(bool_or(ev.final_price = v.sale_price::numeric AND (ev.price_verification IS NULL OR ev.price_verification = 'verified') AND ev.sale_truth_role IS DISTINCT FROM 'duplicate'), false))
     OR (COALESCE(bool_or(ev.price_verification = 'verified' AND ev.final_price <> v.sale_price::numeric), false)
         AND NOT COALESCE(bool_or(ev.price_verification = 'verified' AND ev.final_price = v.sale_price::numeric), false));

CREATE OR REPLACE FUNCTION public.sync_vehicle_sale_price_from_verified_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_latest vehicle_events%rowtype;
  v_price  integer;
  v_cur    integer;
  v_status text;
  v_cur_ccy text;
  v_ccy    text;
  v_cur_date date;
  v_evd    date;
begin
  if new.vehicle_id is null or new.price_verification is distinct from 'verified' or new.event_status is distinct from 'sold' then
    return null;
  end if;

  select * into v_latest
  from vehicle_events e
  where e.vehicle_id = new.vehicle_id
    and e.price_verification = 'verified'
    and e.event_status = 'sold'
    and e.final_price > 0
    and coalesce(e.sale_truth_role, '') <> 'duplicate'
    and coalesce(e.sold_at, e.ended_at) is not null
    -- identity held: an event whose lot is not confirmed as this vehicle never sets its sale (2026-10-24, Maserati d2111229)
    and coalesce(e.identity_check, '') <> 'mismatch'
    and not ('vehicle_id' = any (coalesce(e.source_suspect, '{}'::text[])))
  order by coalesce(e.sold_at, e.ended_at) desc, e.price_verification_at desc nulls last
  limit 1;

  if not found or v_latest.id <> new.id
     or v_latest.price_verification_source is null then
    return null;
  end if;

  -- non-USD sales are written natively (sale_price + sale_price_currency) and converted to sale_price_usd at the
  -- sale-date fx_rates rate by correct_vehicle_sale_provenance_batch; with no rate within 7 days, leave the row alone
  v_evd := (coalesce(v_latest.sold_at, v_latest.ended_at) at time zone 'UTC')::date;
  v_ccy := upper(coalesce(v_latest.currency_code, 'USD'));
  if v_ccy <> 'USD' and (false or not exists (
       select 1 from fx_rates f where f.base_currency = v_ccy and f.quote_currency = 'USD'
         and f.rate_date <= v_evd
         and f.rate_date >= v_evd - 7)) then
    return null;
  end if;

  v_price := round(v_latest.final_price)::integer;
  select sale_price, sale_status, upper(coalesce(sale_price_currency, 'USD')), sale_date
    into v_cur, v_status, v_cur_ccy, v_cur_date from vehicles where id = new.vehicle_id;
  -- the vehicle already carries a newer sale: an older verified event never overwrites it
  if v_cur_date > v_evd then
    return null;
  end if;
  if v_cur is not distinct from v_price and v_status is not distinct from 'sold' and v_cur_ccy = v_ccy then
    return null;
  end if;

  perform correct_vehicle_sale_provenance_batch(
    jsonb_build_array(jsonb_build_object(
      'vehicle_id', new.vehicle_id,
      'reason', 'latest verified sold event ' || v_latest.id,
      'source', jsonb_build_object('type', 'verified_vehicle_event', 'ref', v_latest.price_verification_source,
                                   'event_id', v_latest.id, 'run_id', v_latest.price_verification_run_id),
      'corrections', jsonb_build_object(
        'sale_price', jsonb_build_object('value', v_price),
        'sale_status', jsonb_build_object('value', 'sold'),
        'sale_date', jsonb_build_object('value', v_evd))
        || case when v_cur_ccy <> v_ccy then jsonb_build_object('sale_price_currency', jsonb_build_object('value', v_ccy))
                else '{}'::jsonb end)),
    'trigger:sync_vehicle_sale_price_from_verified_event',
    'sale_price follows the latest verified sold event');
  return null;
end;
$function$;
