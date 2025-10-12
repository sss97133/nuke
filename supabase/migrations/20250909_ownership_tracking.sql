-- Ownership tracking schema
-- vehicle_ownerships: captures current and historical owners for each vehicle
-- ownership_transfers: records transfer events (e.g., BAT sale)

begin;

create table if not exists public.vehicle_ownerships (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  role text not null default 'owner', -- owner | custodian | contributor
  is_current boolean not null default true,
  start_date date,
  end_date date,
  proof_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_ownerships_vehicle on public.vehicle_ownerships(vehicle_id);
create index if not exists idx_vehicle_ownerships_owner on public.vehicle_ownerships(owner_profile_id);
create index if not exists idx_vehicle_ownerships_current on public.vehicle_ownerships(vehicle_id, is_current);

create table if not exists public.ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  from_owner_id uuid references public.profiles(id) on delete set null,
  to_owner_id uuid references public.profiles(id) on delete set null,
  transfer_date date not null,
  source text, -- bring_a_trailer, private_sale, etc
  source_url text,
  price numeric,
  proof_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ownership_transfers_vehicle on public.ownership_transfers(vehicle_id);
create index if not exists idx_ownership_transfers_date on public.ownership_transfers(transfer_date desc);

-- RLS
alter table public.vehicle_ownerships enable row level security;
alter table public.ownership_transfers enable row level security;

-- Read policy: public read for public vehicles, owners and contributors read their rows
drop policy if exists vehicle_ownerships_public_read on public.vehicle_ownerships;
create policy vehicle_ownerships_public_read on public.vehicle_ownerships
for select using (
  exists(select 1 from public.vehicles v where v.id = vehicle_id and coalesce(v.is_public, true) = true)
  or owner_profile_id = auth.uid()
);

drop policy if exists ownership_transfers_public_read on public.ownership_transfers;
create policy ownership_transfers_public_read on public.ownership_transfers
for select using (
  exists(select 1 from public.vehicles v where v.id = vehicle_id and coalesce(v.is_public, true) = true)
);

-- Insert/update by authenticated users when they are the vehicle owner or have access level
drop policy if exists vehicle_ownerships_owner_write on public.vehicle_ownerships;
create policy vehicle_ownerships_owner_write on public.vehicle_ownerships
for insert to authenticated with check (
  exists(
    select 1 from public.vehicles v
    where v.id = vehicle_id and v.user_id = auth.uid()
  )
);

drop policy if exists vehicle_ownerships_owner_update on public.vehicle_ownerships;
create policy vehicle_ownerships_owner_update on public.vehicle_ownerships
for update to authenticated using (
  exists(
    select 1 from public.vehicles v where v.id = vehicle_id and v.user_id = auth.uid()
  )
) with check (true);

drop policy if exists ownership_transfers_owner_write on public.ownership_transfers;
create policy ownership_transfers_owner_write on public.ownership_transfers
for insert to authenticated with check (
  exists(select 1 from public.vehicles v where v.id = vehicle_id and v.user_id = auth.uid())
);

-- Keep only one current owner per vehicle via trigger
create or replace function public.set_single_current_owner()
returns trigger language plpgsql as $$
begin
  if NEW.is_current then
    update public.vehicle_ownerships
       set is_current = false, end_date = coalesce(end_date, NEW.start_date)
     where vehicle_id = NEW.vehicle_id and id <> NEW.id and is_current = true;
  end if;
  NEW.updated_at := now();
  return NEW;
end; $$;

create trigger trg_single_current_owner
before insert or update on public.vehicle_ownerships
for each row execute procedure public.set_single_current_owner();

commit;
