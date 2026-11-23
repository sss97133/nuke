-- Revert 20261123220000_deep_reading_scope_owner_filed.sql.
-- Restores the first-car scope (Mustang 67127bcb only, max_open 1).
-- Does not delete observations, receipts, or queue rows. Photos already
-- deep-read stay as they are; new work for other cars stops being in scope.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $do$
declare
  v_old jsonb;
  v_from constant jsonb := '{"enabled": true, "max_open": 1,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}';
  v_to constant jsonb := '{"enabled": true, "max_open": 5,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}';
begin
  select config_value into v_old from public.platform_config
    where config_key = 'image_stage_deep_reading' for update;
  if not found then
    raise exception 'platform_config image_stage_deep_reading is missing';
  end if;
  if v_old = v_from then
    raise notice 'deep-reading scope already the first-car row; left as it is';
  elsif v_old is distinct from v_to then
    raise exception 'platform_config image_stage_deep_reading is not the owner-filed row this revert expects; refusing: %', v_old;
  else
    update public.platform_config
       set config_value = v_from, updated_at = now()
     where config_key = 'image_stage_deep_reading';
  end if;
end $do$;

commit;
