-- =====================================================
-- SEED: PEPPA PACK (CONTAINER ONLY)
-- =====================================================
-- IMPORTANT: We do not ship or auto-import copyrighted Peppa Pig images.
-- This pack is a curated container for "peppa vibes" templates that you upload/index
-- with explicit provenance + license (or original creations).
-- Date: 2025-12-15

begin;

insert into public.stream_action_packs (slug, name, description, price_cents, is_active)
values
  ('peppa', 'Peppa Vibes', 'Curated pig/kid-show vibe templates. Upload/index assets with provenance + license.', 0, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  is_active = excluded.is_active,
  updated_at = now();

commit;







