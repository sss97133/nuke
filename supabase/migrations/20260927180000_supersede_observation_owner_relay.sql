-- supersede_observation_relay: the owner's corrections can arrive through his own agent.
--
-- WHY: owner, 2026-09-27 (agent session on the K5 wiring): "you can rewrite the supersede_observation as needed.
-- im inputing from here. more importantly the data is surfacing and its our imperfect rules blocking".
-- The owner corrects facts in conversation with his agent ("throttle body likely never installed", "any proof of
-- purchase?"). The corrected row lands through ingest-observation, but the supersession primitive
-- (supersede_observation, 20260709140000) only accepts an app session (auth.uid()), so the wrong predecessor stayed
-- live next to its correction. The truth surfaced; the rule kept it from landing.
--
-- WHAT: a twin of supersede_observation that ONLY the service role can execute: the owner's own server-side agent,
-- which holds the service key and could already write the row directly. It must name the owner (p_actor_id) and the
-- channel (p_via). The named owner must pass the same ownership union as the app path. Each relayed supersession is
-- logged in reattribution_audit (observation-to-observation lineage with actor and reason, already used for merges).
--
-- The app path (supersede_observation, auth.uid() only) is untouched. The 2026-07-09 rule stands: a caller-supplied
-- id is never accepted from an authenticated user. Authenticated and anon have no EXECUTE on the relay, and the
-- function also refuses any caller whose JWT role is not service_role.
--
-- Unchanged semantics: idempotent; the successor must exist on the same vehicle; no testimony is written here
-- (successors come through ingest-observation).
--
-- SCHEMA_LAW: no new table or column. The audit reuses reattribution_audit (observation_type 'observation', old ->
-- new row, actor, reason). An ALTER on vehicle_observations was tried and dropped: on the busy table it could not take
-- its lock inside the statement timeout. One new function, because the existing one could not take a caller-named
-- actor without widening the app path.
-- Verified in a rolled-back transaction before merge:
--   - The relay succeeds and logs the actor and channel in reattribution_audit.
--   - The relay is refused without an actor, without a channel, or when it names a non-owner.
--   - An authenticated user, the owner included, and anon cannot execute it.
--   - supersede_observation(uuid, uuid) and its grants are unchanged.

set lock_timeout = '10s';

create function public.supersede_observation_relay(
  p_original_id  uuid,
  p_successor_id uuid,
  p_actor_id     uuid,
  p_via          text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle_id   uuid;
  v_superseded   boolean;
  v_existing_by  uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'supersede_observation_relay: service role only';
  end if;
  if p_actor_id is null then
    raise exception 'supersede_observation_relay: name the owner who ordered it (p_actor_id)';
  end if;
  if p_via is null or length(trim(p_via)) < 3 then
    raise exception 'supersede_observation_relay: name the channel it came through (p_via)';
  end if;

  if p_original_id is null or p_successor_id is null then
    raise exception 'supersede_observation_relay: original and successor are both required';
  end if;

  if p_original_id = p_successor_id then
    raise exception 'supersede_observation_relay: an observation cannot supersede itself';
  end if;

  select vehicle_id, is_superseded, superseded_by
    into v_vehicle_id, v_superseded, v_existing_by
    from vehicle_observations where id = p_original_id;

  if not found then
    raise exception 'supersede_observation_relay: original observation % not found', p_original_id;
  end if;

  perform 1 from vehicle_observations
    where id = p_successor_id
      and vehicle_id is not distinct from v_vehicle_id;
  if not found then
    raise exception 'supersede_observation_relay: successor % missing, or not on the same vehicle', p_successor_id;
  end if;

  -- the named owner must own or contribute to the vehicle (same union as supersede_observation)
  if v_vehicle_id is null or not exists (
        select 1 from vehicles v
          where v.id = v_vehicle_id
            and (v.owner_id = p_actor_id or v.user_id = p_actor_id or v.uploaded_by = p_actor_id)
        union
        select 1 from vehicle_ownerships o
          where o.vehicle_id = v_vehicle_id and o.owner_profile_id = p_actor_id and o.is_current = true
        union
        select 1 from ownership_verifications ov
          where ov.vehicle_id = v_vehicle_id and ov.user_id = p_actor_id and ov.status = 'approved'
        union
        select 1 from vehicle_contributors vc
          where vc.vehicle_id = v_vehicle_id and vc.user_id = p_actor_id
      ) then
    raise exception 'supersede_observation_relay: % does not own or contribute to the vehicle of %', p_actor_id, p_original_id;
  end if;

  -- idempotent: a retry after a partial failure is a no-op
  if v_superseded is true then
    return jsonb_build_object(
      'superseded', true, 'already', true,
      'original_id', p_original_id, 'superseded_by', v_existing_by);
  end if;

  update vehicle_observations
     set is_superseded       = true,
         superseded_by       = p_successor_id,
         superseded_at       = now(),
         lineage_chain       = array_append(coalesce(lineage_chain, array[]::uuid[]), p_successor_id)
   where id = p_original_id;

  insert into reattribution_audit (observation_type, old_observation_id, old_vehicle_id,
                                   new_observation_id, new_vehicle_id, reason, actor_user_id)
  values ('observation', p_original_id, v_vehicle_id, p_successor_id, v_vehicle_id,
          'superseded via ' || trim(p_via), p_actor_id);

  return jsonb_build_object(
    'superseded', true, 'already', false,
    'original_id', p_original_id, 'superseded_by', p_successor_id,
    'actor', p_actor_id, 'via', trim(p_via));
end;
$$;

revoke all on function public.supersede_observation_relay(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.supersede_observation_relay(uuid, uuid, uuid, text) to service_role;

comment on function public.supersede_observation_relay(uuid, uuid, uuid, text) is
  'Service-role-only twin of supersede_observation: the owner''s own agent relays the owner''s supersession. Must name '
  'the owner (checked against the same ownership union) and the channel; logs actor + channel in reattribution_audit. '
  'Idempotent, non-destructive, writes no testimony. The app path stays supersede_observation (auth.uid() only).';
