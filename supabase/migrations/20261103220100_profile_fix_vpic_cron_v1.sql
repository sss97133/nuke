create or replace function public.vin_vpic_enqueue_v1(p_limit int default 20, p_owner uuid default '0b9f107a-d124-49de-9ded-94698f63c1c4') returns int
language plpgsql set search_path to 'public','pg_temp' as $f$
declare r record; n int := 0;
begin
  for r in select v.id, upper(btrim(v.vin)) vin, v.year from vehicles v
           where v.owner_id = p_owner and v.merged_into_vehicle_id is null and v.deleted_at is null and v.year >= 1981 and vin_check_digit_ok(v.vin)
             and upper(v.vin) !~ '(123456|000000)$'
             and not exists (select 1 from profile_fix_vpic_queue d where d.vehicle_id = v.id and d.vin = upper(btrim(v.vin)))
           order by v.created_at desc limit p_limit loop
    insert into profile_fix_vpic_queue(vehicle_id, vin, request_id)
    values (r.id, r.vin, net.http_get('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/'||r.vin||'?format=json&modelyear='||r.year));
    n := n + 1;
  end loop;
  return n;
end $f$;
drop function if exists public.vin_vpic_enqueue_v1(int);
revoke all on function public.vin_vpic_enqueue_v1(int,uuid) from public, anon, authenticated;
select cron.schedule('profile-fix-vpic-decode', '23 * * * *', $$select public.vin_vpic_collect_v1(); select public.vin_vpic_enqueue_v1(20);$$);
