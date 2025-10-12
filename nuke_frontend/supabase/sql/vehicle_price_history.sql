-- Vehicle Price History Table
-- Stores historical price points to enable trend analysis

create table if not exists public.vehicle_price_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  price_type text not null check (price_type in ('msrp','purchase','current','asking','sale')),
  value numeric not null,
  source text not null default 'vehicles',
  as_of timestamptz not null default now(),
  confidence integer not null default 80,
  created_at timestamptz not null default now()
);

create index if not exists idx_vph_vehicle_as_of on public.vehicle_price_history(vehicle_id, as_of desc);
create index if not exists idx_vph_vehicle_type on public.vehicle_price_history(vehicle_id, price_type);
