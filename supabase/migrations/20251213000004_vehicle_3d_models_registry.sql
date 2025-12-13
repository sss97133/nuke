-- Registry table for 3D vehicle models stored in Supabase Storage.
-- This is the "in the system" index the chat/AI can query to pull a model automatically.
--
-- Design goals:
-- - Keep Storage private by default.
-- - Allow public catalog models to be referenced (is_public=true), without exposing user uploads.
-- - Support vehicle-specific overrides (vehicle_id) as well as make/model/year matching.
-- - Idempotent + safe for `supabase db reset`.

begin;

create table if not exists public.vehicle_3d_models (
  id uuid primary key default gen_random_uuid(),

  -- If set, this model is the preferred model for a specific vehicle profile.
  vehicle_id uuid references public.vehicles(id) on delete cascade,

  -- Optional matching fields for catalog lookups (make/model/year)
  year integer,
  make text,
  model text,

  -- Storage location
  bucket text not null default 'vehicle-models',
  object_path text not null,
  format text not null default 'fbx' check (format in ('fbx', 'glb', 'gltf', 'blend', 'other')),

  -- Visibility and provenance
  is_public boolean not null default false,
  source text,
  metadata jsonb not null default '{}'::jsonb,

  created_by uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_3d_models_vehicle_id_created_at
  on public.vehicle_3d_models (vehicle_id, created_at desc);

create index if not exists idx_vehicle_3d_models_make_model_year_created_at
  on public.vehicle_3d_models (make, model, year, created_at desc);

-- Best-effort updated_at trigger (helper exists in multiple migrations in this repo)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists vehicle_3d_models_set_updated_at on public.vehicle_3d_models;
    create trigger vehicle_3d_models_set_updated_at
      before update on public.vehicle_3d_models
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.vehicle_3d_models enable row level security;

-- Policies:
-- - Public catalog is readable by any authenticated user.
-- - Private entries are only readable/manageable by their creator (for now).
drop policy if exists vehicle_3d_models_select on public.vehicle_3d_models;
create policy vehicle_3d_models_select on public.vehicle_3d_models
  for select
  using (
    auth.role() = 'authenticated'
    and (is_public = true or created_by = auth.uid())
  );

drop policy if exists vehicle_3d_models_insert on public.vehicle_3d_models;
create policy vehicle_3d_models_insert on public.vehicle_3d_models
  for insert
  with check (
    auth.role() = 'authenticated'
    and created_by = auth.uid()
  );

drop policy if exists vehicle_3d_models_update on public.vehicle_3d_models;
create policy vehicle_3d_models_update on public.vehicle_3d_models
  for update
  using (auth.role() = 'authenticated' and created_by = auth.uid())
  with check (auth.role() = 'authenticated' and created_by = auth.uid());

drop policy if exists vehicle_3d_models_delete on public.vehicle_3d_models;
create policy vehicle_3d_models_delete on public.vehicle_3d_models
  for delete
  using (auth.role() = 'authenticated' and created_by = auth.uid());

commit;


