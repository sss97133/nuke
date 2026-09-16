-- THE BUILD (before/after) becomes an owner STATEMENT, not a min/max(taken_at) guess.
-- The auto-guess paired indefensible frames (a 2016 interior shot vs a 2026 VIN
-- data-plate), so both ends are now owner-designated. This generalizes
-- set_vehicle_before_image to either role; testimony is superseded, never deleted.
create or replace function public.set_vehicle_build_image(
  p_vehicle_id uuid, p_image_id uuid, p_role text
) returns jsonb
  language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_owns boolean; v_source uuid; v_obs uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'auth_required'); end if;
  if p_role not in ('before_image','after_image') then
    return jsonb_build_object('ok', false, 'error', 'bad_role');
  end if;
  select (
    exists(select 1 from vehicle_ownerships where vehicle_id=p_vehicle_id and owner_profile_id=v_uid and is_current=true)
    or exists(select 1 from vehicles where id=p_vehicle_id and (user_id=v_uid or owner_id=v_uid))
  ) into v_owns;
  if not coalesce(v_owns,false) then return jsonb_build_object('ok', false, 'error', 'not_owner'); end if;
  if not exists(select 1 from vehicle_images where id=p_image_id and vehicle_id=p_vehicle_id) then
    return jsonb_build_object('ok', false, 'error', 'image_mismatch');
  end if;
  -- Supersede any prior owner-designated frame for this role (testimony is never deleted).
  update vehicle_observations set is_superseded=true, superseded_at=now()
   where vehicle_id=p_vehicle_id and kind='media'
     and structured_data->>'role'=p_role and is_superseded is not true;
  select id into v_source from observation_sources where slug='owner-input';
  insert into vehicle_observations (
    vehicle_id, observed_at, source_id, kind, content_hash, structured_data,
    confidence, confidence_score, submitted_by_user_id, observer_raw
  ) values (
    p_vehicle_id, now(), v_source, 'media',
    md5(p_role||'|'||p_vehicle_id::text||'|'||p_image_id::text||'|'||clock_timestamp()::text),
    jsonb_build_object('role',p_role,'image_id',p_image_id::text,'authored','user_interaction'),
    'high', 0.95, v_uid, jsonb_build_object('user_id', v_uid)
  ) returning id into v_obs;
  return jsonb_build_object('ok', true, 'observation_id', v_obs, 'image_id', p_image_id, 'role', p_role);
end;
$function$;

grant execute on function public.set_vehicle_build_image(uuid, uuid, text) to authenticated;
