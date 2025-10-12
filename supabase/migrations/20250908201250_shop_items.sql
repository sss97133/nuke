-- Shop Inventory base table
-- Public schema, non-destructive migration

create table if not exists public.shop_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text,
  brand text,
  model text,
  images text[] default '{}',
  for_sale boolean default false,
  price_cents integer,
  affiliate_url text,
  location_label text,
  quantity integer default 1,
  condition text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_items_owner_idx on public.shop_items(owner_id);
create index if not exists shop_items_for_sale_idx on public.shop_items(for_sale);

-- Updated at trigger
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger shop_items_set_updated_at
before update on public.shop_items
for each row execute function public.set_updated_at();

-- RLS (enable, but leave policies to app to define precisely)
alter table public.shop_items enable row level security;
-- Owner can manage own items
drop policy if exists shop_items_owner_rw on public.shop_items;
create policy shop_items_owner_rw on public.shop_items
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
-- Public read for items marked for_sale (optional; comment out if not desired)
drop policy if exists shop_items_public_read on public.shop_items;
create policy shop_items_public_read on public.shop_items
  for select using (for_sale = true);
