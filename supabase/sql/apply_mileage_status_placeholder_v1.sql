begin; set local statement_timeout='170s'; set local lock_timeout='30s';
with c as (
  select v.id, v.mileage, coalesce(v.canonical_platform,'null') plat, coalesce(v.listing_url, v.discovery_url) url
  from public.vehicles v
  where v.mileage = any(array[99999,999999,9999999,123456,1234567,12345,1234,111111,1111111,11111,222222,333333,444444,555555,666666,777777,888888])
    and v.status <> 'active'
    and (v.canonical_platform in ('ebay-motors','craigslist','classiccars-com','facebook-marketplace','facebook-saved')
         or (v.canonical_platform is null and coalesce(v.listing_url,v.discovery_url,'') ~* '(ebay\.com|craigslist\.org|classiccars\.com|facebook\.com)'))
    and not exists (select 1 from public.mileage_value_status s where s.vehicle_id=v.id and s.field='vehicles.mileage' and s.superseded_at is null)
), ins as (
  insert into public.mileage_value_status (vehicle_id, field, value, status, reason, source_url, evidence, run_id, old_vehicle_mileage)
  select id, 'vehicles.mileage', mileage, 'suspect', 'placeholder_sentinel', url,
    'rule placeholder_sentinel_v1 (odometerText.ts isPlaceholderMileage): value '||mileage||' in sentinel set {99999,999999,9999999,123456,1234567,12345,1234,11111,111111,1111111,222222..888888} on inactive classified listing ('||plat||'); status only, vehicles.mileage unchanged',
    'mileage_status_placeholder_v1_20261024', mileage
  from c on conflict do nothing returning value)
select count(*), value from ins group by 2 order by 1 desc
; commit;
