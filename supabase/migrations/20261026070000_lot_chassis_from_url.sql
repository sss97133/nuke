-- Bonhams lot chassis read from the lot URL slug, so identity checks stop comparing cut-short captures.
-- The Bonhams extractor matched "chassis-no-<chassis>" in page text with the separator and a 20-char cap, storing
-- metadata.chassis_number values like "-NO-WPQZZZ93ZDS00084", "-T3-TOURER-CHASSIS-N", "S800" (full: S8001006039).
-- lot_chassis_from_url: full chassis/frame no. from a "...-chassis-no-<x>[-engine-no-...]" slug, upper case, or null.
-- lot_chassis_pick: the slug value when the stored one is missing, a slug fragment, or a cut-short prefix of it.
-- backfill_event_identity_check now compares lot_chassis_pick(metadata chassis, URL chassis) and labels the source.
-- Rollback: supabase/rollbacks/20261026070000_lot_chassis_from_url_down.sql
create or replace function public.lot_chassis_from_url(p_url text)
 returns text language sql immutable parallel safe set search_path to '' as $f$
  with s as (select regexp_replace(regexp_replace(lower(coalesce(p_url,'')), '[?#].*$', ''), '/+$', '') u),
  t as (select regexp_replace(u, '^.*/', '') slug from s),
  m as (select substring(slug from '(?:^|-)(?:chassis|frame)-no-([a-z0-9][a-z0-9-]*?)(?:-engine-no-.*)?$') c from t)
  select case when length(regexp_replace(c, '-', '', 'g')) >= 4 then upper(c) end from m
$f$;

create or replace function public.lot_chassis_pick(p_stored text, p_url_chassis text)
 returns text language sql immutable parallel safe set search_path to '' as $f$
  with n as (select regexp_replace(upper(regexp_replace(coalesce(p_stored,''), '^-?[Nn][Oo]-', '')), '[^A-Z0-9]', '', 'g') p,
                    regexp_replace(upper(coalesce(p_url_chassis,'')), '[^A-Z0-9]', '', 'g') u)
  select case
    when nullif(p_url_chassis,'') is null then nullif(p_stored,'')
    when nullif(p_stored,'') is null then p_url_chassis
    when p_stored ~ '^-' or upper(p_stored) ~ '(CHASSIS|ENGINE)' then p_url_chassis
    when length(p) < length(u) and left(u, length(p)) = p then p_url_chassis
    else p_stored end
  from n
$f$;

revoke all on function public.lot_chassis_from_url(text) from public, anon, authenticated;
revoke all on function public.lot_chassis_pick(text, text) from public, anon, authenticated;

create or replace function public.backfill_event_identity_check(p_run_id text, p_limit int default 5000)
returns int language plpgsql set search_path = '' as $$
declare n int;
begin
  with b as (
    select e.id, v.vin,
      coalesce(nullif(e.metadata->>'chassis_number',''), nullif(e.metadata->>'chassis',''), nullif(e.metadata->>'listing_vin',''), nullif(e.metadata->>'vin','')) stored,
      case when nullif(e.metadata->>'chassis_number','') is not null then 'metadata.chassis_number'
           when nullif(e.metadata->>'chassis','') is not null then 'metadata.chassis'
           when nullif(e.metadata->>'listing_vin','') is not null then 'metadata.listing_vin'
           else 'metadata.vin' end src,
      public.lot_chassis_from_url(e.source_url) url_ch
    from public.vehicle_events e join public.vehicles v on v.id = e.vehicle_id
    where e.identity_check is null and nullif(v.vin,'') is not null
      and (coalesce(nullif(e.metadata->>'chassis_number',''), nullif(e.metadata->>'chassis',''), nullif(e.metadata->>'listing_vin',''), nullif(e.metadata->>'vin','')) is not null
           or public.lot_chassis_from_url(e.source_url) is not null)
    limit p_limit),
  c as (
    select id, vin, public.lot_chassis_pick(stored, url_ch) lot,
      case when stored is not null and public.lot_chassis_pick(stored, url_ch) is not distinct from stored then src
           else 'url_slug.chassis_no' end src
    from b)
  update public.vehicle_events e set
    identity_check = public.event_identity_status(c.lot, c.vin),
    identity_check_lot_id = c.lot, identity_check_vehicle_vin = c.vin,
    identity_check_source = 'event_identity_status_v1:' || c.src,
    identity_check_run_id = p_run_id, identity_check_at = now()
  from c where c.id = e.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.backfill_event_identity_check(text, int) from public, anon, authenticated;
