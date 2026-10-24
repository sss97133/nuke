create or replace function public.event_identity_status(p_lot text, p_vin text)
 returns text language sql immutable parallel safe set search_path to '' as $function$
  with n as (select public.vin_chassis_norm(p_lot) l, public.vin_chassis_norm(p_vin) v)
  select case
    when l is null or v is null or length(l) < 4 or length(v) < 4 then 'unknown'
    when l = v then 'match'
    when length(l) >= 5 and length(v) >= 5 and (right(v, length(l)) = l or right(l, length(v)) = v) then 'match'
    else 'mismatch' end
  from n
$function$;
drop function if exists public.vin_identity_norm(text);
-- data: update vehicle_events e set identity_check=b.identity_check, identity_check_source=b.identity_check_source, identity_check_run_id=b.identity_check_run_id, identity_check_at=b.identity_check_at from backup_event_identity_recheck_v3_20261024 b where b.id=e.id;
