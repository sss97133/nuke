-- Fix: vehicle_3d_models.created_by was defined NOT NULL but the FK uses ON DELETE SET NULL.
-- That combination prevents deleting auth.users rows (it would violate NOT NULL).
-- Make the column nullable while keeping the default of auth.uid().

begin;

do $$
begin
  if to_regclass('public.vehicle_3d_models') is null then
    raise notice 'Skipping vehicle_3d_models created_by fix: table does not exist.';
    return;
  end if;

  alter table public.vehicle_3d_models
    alter column created_by drop not null;
end
$$;

commit;


