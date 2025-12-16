-- =====================================================
-- SEED: FROG PACK
-- =====================================================
-- Date: 2025-12-15

begin;

insert into public.stream_action_packs (slug, name, description, price_cents, is_active)
values
  ('frog', 'Frog', 'Frog templates and reactions (indexed with provenance + license).', 0, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  is_active = excluded.is_active,
  updated_at = now();

commit;


