-- v11: allow cited "true mileage unknown" (TMU) odometer claims in auction_event_listing_mileage.
-- Additive: relaxes NOT NULL on mileage_at_listing only for TMU rows (enforced by check).
-- Revert: supabase/sql/revert_shadow_v11.sql
alter table public.auction_event_listing_mileage alter column mileage_at_listing drop not null;
alter table public.auction_event_listing_mileage add column if not exists mileage_tmu boolean not null default false;
alter table public.auction_event_listing_mileage
  add constraint auction_event_listing_mileage_value_or_tmu
  check (mileage_at_listing is not null or (mileage_tmu and mileage_claim is not null));
comment on column public.auction_event_listing_mileage.mileage_tmu is
  'true when the cited listing text states true mileage unknown / odometer replaced or absent; mileage_at_listing is then null';
