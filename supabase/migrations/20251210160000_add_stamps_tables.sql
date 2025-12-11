-- Stamps tables for mailbox stamp book and burns

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table if not exists public.stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  org_id uuid,
  sku text,
  name text,
  art_url text,
  rarity text,
  face_value_cents integer default 0,
  remaining_uses integer not null default 1,
  is_burned boolean not null default false,
  burned_at timestamptz,
  is_listed boolean not null default false,
  list_price_cents integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_stamps_user_active on public.stamps(user_id) where is_burned = false;
create index if not exists idx_stamps_listed on public.stamps(is_listed) where is_listed = true and is_burned = false;

create table if not exists public.stamp_spends (
  id uuid primary key default gen_random_uuid(),
  stamp_id uuid references public.stamps(id) on delete cascade,
  user_id uuid references auth.users(id),
  vehicle_id uuid,
  message_id uuid,
  amount_cents integer default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.stamp_trades (
  id uuid primary key default gen_random_uuid(),
  stamp_id uuid references public.stamps(id) on delete cascade,
  seller_id uuid references auth.users(id),
  buyer_id uuid references auth.users(id),
  price_cents integer,
  created_at timestamptz not null default now()
);

