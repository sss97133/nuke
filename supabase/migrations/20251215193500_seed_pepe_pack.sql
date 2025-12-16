-- =====================================================
-- SEED: PEPE PACK
-- =====================================================
-- Date: 2025-12-15
--
-- Note: This seeds ONLY the pack container. Assets are indexed separately with
-- provenance + license; we do not ship copyrighted images in migrations.

begin;

insert into public.stream_action_packs (slug, name, description, price_cents, is_active)
values
  ('pepe', 'Pepe (Frog)', 'Pepe-style frog templates/reactions. Index assets with provenance + license.', 0, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  is_active = excluded.is_active,
  updated_at = now();

commit;


