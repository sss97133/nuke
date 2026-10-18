-- user_sites.organization_location_id: which organization_locations point a phone site is, so the phone's upload gate
-- (the iOS SiteStore reads user_sites) and the organization model (organization_locations, which
-- auto_tag_organization_from_gps reads) name a place in one registry.
--
-- Measured 2026-10-15: the owner's 3 user_sites rows (two named SITE 01, one SITE 02) carry no organization or place
-- key, and the four place registries (user_sites, known_places, organization_locations, organizations coordinates)
-- are joined nowhere. Nullable, no backfill: which point a site is, the user says. A radius overlap is not that
-- statement: one of his sites is 1,771 m wide and covers four of his organizations' points, his home and his other
-- site.
-- The pointer names a place; it grants no membership. The table's owner-only policy (user_sites_owner_all) covers it.
-- The iOS app selects named columns and inserts without this one, so it is unaffected.
-- Contract: supabase/sql/test_gps_org_tag_proposes_pending.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.user_sites
  ADD COLUMN IF NOT EXISTS organization_location_id uuid REFERENCES public.organization_locations (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.user_sites.organization_location_id IS
  'The organization_locations point this site is, as the user states it; null until stated. Names a place, grants no '
  'membership. Shared with the organization model so the phone gate and organization GPS evidence use one registry.';

COMMIT;
