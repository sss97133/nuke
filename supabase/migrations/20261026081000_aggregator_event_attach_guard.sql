-- Aggregator events (conceptcarz:// archive rows) attach to a vehicle only on a chassis/VIN match or a cited same-lot match.
-- WHY (2026-10-24): orphan-backfill-v1 (an out-of-band February backfill, not in this repo) bound 11,619 conceptcarz rows to
-- vehicles by year + make + price. Price plus date is circular: it pinned at least 10 different cars' results onto the wrong
-- vehicle (run agg_misattach_v1_20261024), and the sale-price sync then copied those prices onto the vehicles.
--
-- RULE (aggregator_event_attach_basis): an event whose source_url starts with conceptcarz:// (or source_platform 'conceptcarz')
-- may carry vehicle_id only when
--   'vin_match': the title's "Chassis#:" value, upper-cased with non-alphanumerics stripped, equals the vehicle's VIN the
--                same way, or one ends with the other and the shorter is at least 6 characters; or
--   'same_lot':  metadata.attach_basis = {"kind":"same_lot","cited_event_id":<uuid>,"lot_number":<text>,"citation":<text>}
--                where the cited event is a different, non-aggregator event on the same vehicle whose source_listing_id or
--                source_url carries that lot number.
-- Price and date never count.
-- ENFORCED by trigger trg_guard_aggregator_event_attach (BEFORE INSERT OR UPDATE OF vehicle_id, source_url, source_platform, metadata):
--   INSERT, a plain vehicle_id re-point, or a row becoming an aggregator row with no basis -> check_violation.
--   A merge carry (merged_from_vehicle_id = old.vehicle_id) with no basis is kept but flagged source_suspect 'vehicle_id'.
--   An UPDATE that leaves an existing aggregator row on its vehicle is not re-judged (the audit flags those).
-- PRICE TRUST: an event flagged source_suspect @> {vehicle_id} is treated like an unverified price in
--   vehicle_sale_price_untrusted / vehicle_sale_price_untrusted_ids and can never vouch for the vehicle's price;
--   sync_vehicle_sale_price_from_verified_event never copies from such an event. No price is moved.
-- Rollback: supabase/rollbacks/20261026081000_aggregator_event_attach_guard_down.sql
-- Test: supabase/sql/test_aggregator_event_attach_guard.sql
SET lock_timeout = '10s';

create or replace function public.aggregator_chassis_norm(p text)
 returns text language sql immutable parallel safe set search_path to '' as $f$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$f$;

create or replace function public.aggregator_event_is_aggregator(p_source_url text, p_source_platform text)
 returns boolean language sql immutable parallel safe set search_path to '' as $f$
  select coalesce(p_source_url, '') ilike 'conceptcarz://%' or coalesce(p_source_platform, '') = 'conceptcarz'
$f$;

create or replace function public.aggregator_chassis_vin_match(p_source_url text, p_vin text)
 returns boolean language sql immutable parallel safe set search_path to '' as $f$
  with n as (select public.aggregator_chassis_norm(substring(p_source_url from '(?i)chassis\s*#\s*:?\s*(.*)$')) ch,
                    public.aggregator_chassis_norm(p_vin) vin)
  select coalesce(ch = vin
      or (length(ch) >= 6 and length(vin) > length(ch) and right(vin, length(ch)) = ch)
      or (length(vin) >= 6 and length(ch) > length(vin) and right(ch, length(vin)) = vin), false)
  from n
$f$;

-- 'not_aggregator' | 'vin_match' | 'same_lot' | NULL (no basis: must not attach)
create or replace function public.aggregator_event_attach_basis(p_event_id uuid, p_vehicle_id uuid, p_source_url text,
    p_source_platform text, p_metadata jsonb)
 returns text language plpgsql stable set search_path to '' as $f$
declare
  v_ab jsonb := p_metadata -> 'attach_basis';
  v_lot text;
  v_cited uuid;
begin
  if not public.aggregator_event_is_aggregator(p_source_url, p_source_platform) then return 'not_aggregator'; end if;
  if p_vehicle_id is null then return 'not_aggregator'; end if;
  if exists (select 1 from public.vehicles v where v.id = p_vehicle_id
             and public.aggregator_chassis_vin_match(p_source_url, v.vin)) then
    return 'vin_match';
  end if;
  if jsonb_typeof(v_ab) = 'object' and v_ab ->> 'kind' = 'same_lot'
     and nullif(btrim(v_ab ->> 'citation'), '') is not null
     and nullif(btrim(v_ab ->> 'lot_number'), '') is not null
     and coalesce(v_ab ->> 'cited_event_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_lot := btrim(v_ab ->> 'lot_number');
    v_cited := (v_ab ->> 'cited_event_id')::uuid;
    if exists (select 1 from public.vehicle_events c
               where c.id = v_cited and c.id is distinct from p_event_id and c.vehicle_id = p_vehicle_id
                 and not public.aggregator_event_is_aggregator(c.source_url, c.source_platform)
                 and (c.source_listing_id = v_lot
                      or c.source_url ~* ('(^|[^0-9a-z])(lot[-_/ #]*)?' || regexp_replace(v_lot, '([^0-9A-Za-z])', '\\\1', 'g') || '([^0-9a-z]|$)'))) then
      return 'same_lot';
    end if;
  end if;
  return null;
end
$f$;

create or replace function public.guard_aggregator_event_attach()
 returns trigger language plpgsql set search_path to '' as $f$
declare
  v_basis text;
begin
  if new.vehicle_id is null or not public.aggregator_event_is_aggregator(new.source_url, new.source_platform) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.vehicle_id is not distinct from old.vehicle_id
     and public.aggregator_event_is_aggregator(old.source_url, old.source_platform) then
    return new;  -- attachment unchanged; existing rows are judged by the audit, not here
  end if;
  v_basis := public.aggregator_event_attach_basis(new.id, new.vehicle_id, new.source_url, new.source_platform, new.metadata);
  if v_basis is not null then return new; end if;
  if tg_op = 'UPDATE' and old.vehicle_id is not null and new.merged_from_vehicle_id is not distinct from old.vehicle_id then
    new.source_suspect := (select array_agg(distinct x order by x) from unnest(coalesce(new.source_suspect, '{}') || array['vehicle_id']) x);
    new.source_suspect_reason := concat_ws('; ', nullif(new.source_suspect_reason, ''),
      'aggregator event carried by a vehicle merge without a chassis/VIN or cited same-lot match');
    new.source_suspect_run_id := coalesce(new.source_suspect_run_id, 'aggregator_attach_guard');
    new.source_suspect_at := coalesce(new.source_suspect_at, now());
    return new;
  end if;
  raise exception 'aggregator event % may attach to vehicle % only on a chassis/VIN match or a cited same-lot match (metadata.attach_basis); price and date are not enough',
    new.id, new.vehicle_id using errcode = 'check_violation';
end
$f$;

drop trigger if exists trg_guard_aggregator_event_attach on public.vehicle_events;
create trigger trg_guard_aggregator_event_attach
  before insert or update of vehicle_id, source_url, source_platform, metadata on public.vehicle_events
  for each row execute function public.guard_aggregator_event_attach();

-- price trust: a wrong-vehicle event is an untrusted price source and never vouches for one
create or replace function public.vehicle_sale_price_untrusted(p_vehicle_id uuid, p_sale_price numeric)
 returns boolean language sql stable parallel safe as $function$
  select p_sale_price is not null and (
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and (pv.price_verification in ('unverified','contradicted') or 'vehicle_id' = any(coalesce(pv.source_suspect, '{}')))
              and pv.final_price = p_sale_price)
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.final_price = p_sale_price and (ok.price_verification is null or ok.price_verification = 'verified')
              and ok.sale_truth_role is distinct from 'duplicate'
              and not ('vehicle_id' = any(coalesce(ok.source_suspect, '{}')))))
    or
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and pv.price_verification = 'verified' and pv.final_price <> p_sale_price
              and not ('vehicle_id' = any(coalesce(pv.source_suspect, '{}'))))
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.price_verification = 'verified' and ok.final_price = p_sale_price
              and not ('vehicle_id' = any(coalesce(ok.source_suspect, '{}')))))
  )
$function$;

create or replace view public.vehicle_sale_price_untrusted_ids as
 with cand as materialized (
   select distinct pv.vehicle_id from public.vehicle_events pv
   where pv.price_verification is not null or 'vehicle_id' = any(coalesce(pv.source_suspect, '{}'))
 )
 select v.id as vehicle_id
   from cand c
   join public.vehicles v on v.id = c.vehicle_id
   join public.vehicle_events ev on ev.vehicle_id = c.vehicle_id
  where v.sale_price is not null
  group by v.id, v.sale_price
 having (coalesce(bool_or((ev.price_verification = any (array['unverified','contradicted']) or 'vehicle_id' = any(coalesce(ev.source_suspect, '{}')))
                          and ev.final_price = v.sale_price::numeric), false)
         and not coalesce(bool_or(ev.final_price = v.sale_price::numeric
                          and (ev.price_verification is null or ev.price_verification = 'verified')
                          and ev.sale_truth_role is distinct from 'duplicate'
                          and not ('vehicle_id' = any(coalesce(ev.source_suspect, '{}')))), false))
     or (coalesce(bool_or(ev.price_verification = 'verified' and ev.final_price <> v.sale_price::numeric
                          and not ('vehicle_id' = any(coalesce(ev.source_suspect, '{}')))), false)
         and not coalesce(bool_or(ev.price_verification = 'verified' and ev.final_price = v.sale_price::numeric
                          and not ('vehicle_id' = any(coalesce(ev.source_suspect, '{}')))), false));

-- the sale-price sync never copies from an event flagged as attached to the wrong vehicle
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
  if new.vehicle_id is null or new.price_verification is distinct from 'verified' or new.event_status is distinct from 'sold'
     or 'vehicle_id' = any(coalesce(new.source_suspect, '{}')) then
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
