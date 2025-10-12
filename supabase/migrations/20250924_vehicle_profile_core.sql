-- Vehicle Profile core structures to support dynamic fields and image optimization
-- Created: 2025-09-24

-- 1) Dynamic vehicle data table used by DynamicVehicleFields
create table if not exists public.vehicle_dynamic_data (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  field_name text not null,
  field_value text not null,
  field_type text not null default 'text', -- text | number | date | boolean | url
  field_category text not null default 'other', -- specs | pricing | history | maintenance | legal | other
  display_order int not null default 0,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_vehicle_dynamic_data_vehicle on public.vehicle_dynamic_data(vehicle_id);
create index if not exists idx_vehicle_dynamic_data_category on public.vehicle_dynamic_data(field_category);
create index if not exists idx_vehicle_dynamic_data_name on public.vehicle_dynamic_data(field_name);

-- RLS (enable and allow owners/contributors)
alter table public.vehicle_dynamic_data enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'vehicle_dynamic_data' and policyname = 'vehicle_dynamic_data_read'
  ) then
    create policy vehicle_dynamic_data_read on public.vehicle_dynamic_data
      for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'vehicle_dynamic_data' and policyname = 'vehicle_dynamic_data_write_owner_or_contributor'
  ) then
    create policy vehicle_dynamic_data_write_owner_or_contributor on public.vehicle_dynamic_data
      for insert
      with check (
        exists (
          select 1 from public.vehicles v
          where v.id = vehicle_id
            and (
              v.user_id = auth.uid()
              or exists (
                select 1 from public.vehicle_contributors vc
                where vc.vehicle_id = vehicle_id and vc.user_id = auth.uid()
              )
            )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'vehicle_dynamic_data' and policyname = 'vehicle_dynamic_data_update_owner_or_contributor'
  ) then
    create policy vehicle_dynamic_data_update_owner_or_contributor on public.vehicle_dynamic_data
      for update
      using (
        exists (
          select 1 from public.vehicles v
          where v.id = vehicle_id
            and (
              v.user_id = auth.uid()
              or exists (
                select 1 from public.vehicle_contributors vc
                where vc.vehicle_id = vehicle_id and vc.user_id = auth.uid()
              )
            )
        )
      );
  end if;
end $$;

-- 2) Ensure image optimization columns exist on vehicle_images
alter table public.vehicle_images
  add column if not exists thumbnail_url text,
  add column if not exists medium_url text,
  add column if not exists large_url text,
  add column if not exists optimization_status text;

-- 3) Ownership verification base table (if missing)
create table if not exists public.ownership_verifications (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending', -- pending | approved | rejected
  documents jsonb,
  reviewed_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ownership_verifications enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ownership_verifications' and policyname = 'ownership_verifications_read_own_vehicle'
  ) then
    create policy ownership_verifications_read_own_vehicle on public.ownership_verifications
      for select
      using (
        vehicle_id in (select id from public.vehicles where user_id = auth.uid())
        or user_id = auth.uid()
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ownership_verifications' and policyname = 'ownership_verifications_insert_self'
  ) then
    create policy ownership_verifications_insert_self on public.ownership_verifications
      for insert
      with check (user_id = auth.uid());
  end if;
end $$;
