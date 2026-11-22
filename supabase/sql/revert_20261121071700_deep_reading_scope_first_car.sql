-- Revert of 20261121071700 (deep reading and keyed values on for one car): turns the reading scope off, then puts the
-- one snippet back in each of the two readers. Two transactions, the switch first, so the scope can always be turned
-- off: a reader that has drifted since refuses only its own restore.
--   The scope row: exactly this migration's row goes back to the row 20261120130000 inserted; any other row that is on
--   (a later migration widened it) is only switched off, its other keys kept; a row that is off is left alone.
--   A reader that does not carry the marker is left alone; one that carries it but no longer holds the patched snippet
--   exactly once is refused.
-- Not undone: readings and keyed values already written (testimony is superseded, never deleted) and stage items
-- already queued (with the scope off they are no longer gaps; the claim drops them). An item a reader has already
-- claimed is read to its end.
-- Apply as a migration through CI, never by hand.

-- ===== 1. the scope, off
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $do$
declare
  v_old jsonb;
  v_off constant jsonb := '{"enabled": false,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b", "20d21fb0-4651-4469-a0ba-e751309a1e54"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}';
  v_on constant jsonb := '{"enabled": true, "max_open": 1,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}';
begin
  select config_value into v_old from public.platform_config where config_key = 'image_stage_deep_reading' for update;
  if not found then
    raise notice 'platform_config image_stage_deep_reading is missing; nothing to switch off';
  elsif v_old = v_on then
    update public.platform_config set config_value = v_off, updated_at = now() where config_key = 'image_stage_deep_reading';
  elsif v_old -> 'enabled' = 'true'::jsonb then
    update public.platform_config set config_value = v_old || '{"enabled": false}'::jsonb, updated_at = now()
     where config_key = 'image_stage_deep_reading';
    raise notice 'the reading scope was not the row 20261121071700 wrote; switched off, its other keys kept';
  else
    raise notice 'the reading scope is already off; left as it is';
  end if;
end $do$;

commit;

-- ===== 2. the two readers, as they were
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $do$
declare
  v_def text;
  v_n int;
  v_shots_old text := $snip$        AND ob.kind::text = 'condition' AND ob.is_superseded IS FALSE AND ob.source_id IS NOT NULL
      ORDER BY ob.observed_at DESC NULLS LAST, ob.id LIMIT 1) o$snip$;
  v_shots_new text := $snip$        AND ob.kind::text = 'condition' AND ob.is_superseded IS FALSE AND ob.source_id IS NOT NULL
        AND public.image_reading_tier_is_reviewed(ob.agent_tier, true)  -- (20261121071700) a thin reading's tools were not read
      ORDER BY ob.observed_at DESC NULLS LAST, ob.id LIMIT 1) o$snip$;
  v_prof_old text := $snip$          AND ob.kind::text = 'condition' AND ob.is_superseded IS FALSE AND ob.source_id IS NOT NULL
        LIMIT 50) o$snip$;
  v_prof_new text := $snip$          AND ob.kind::text = 'condition' AND ob.is_superseded IS FALSE AND ob.source_id IS NOT NULL
          AND public.image_reading_tier_is_reviewed(ob.agent_tier, true)  -- (20261121071700) a thin reading's tools were not read
        LIMIT 50) o$snip$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.oid = to_regprocedure('public.user_tool_action_shots_read(uuid,text,integer)');
  if v_def is null or position('(20261121071700)' in v_def) = 0 then
    raise notice 'user_tool_action_shots_read does not carry 20261121071700; nothing to revert';
  else
    v_n := (length(v_def) - length(replace(v_def, v_shots_new, ''))) / length(v_shots_new);
    if v_n <> 1 then raise exception 'user_tool_action_shots_read no longer holds the 20261121071700 snippet once (n=%); refusing', v_n; end if;
    execute replace(v_def, v_shots_new, v_shots_old);
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.oid = to_regprocedure('public.provider_profile_read(uuid,uuid)');
  if v_def is null or position('(20261121071700)' in v_def) = 0 then
    raise notice 'provider_profile_read does not carry 20261121071700; nothing to revert';
  else
    v_n := (length(v_def) - length(replace(v_def, v_prof_new, ''))) / length(v_prof_new);
    if v_n <> 1 then raise exception 'provider_profile_read no longer holds the 20261121071700 snippet once (n=%); refusing', v_n; end if;
    execute replace(v_def, v_prof_new, v_prof_old);
  end if;
end $do$;

commit;
