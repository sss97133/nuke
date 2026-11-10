-- Data fix B: the three Viva! Las Vegas Autos pre-auction cars become Viva inventory, with Skylar recorded as contributor, not owner.
--
-- Approved by Skylar on 2026-11-09 ("link as consigned with me as contributor"). The cars are Viva's consigned pre-auction inventory
-- that Skylar photographed; none had a Viva link (the Chevelle was linked only to Ernies Upholstery, the Porsche and the Corvette to
-- nothing). Resolved by exact id, never by name or prefix (the Chevelle's id prefix 1b16f3ec matched exactly one vehicle on 2026-11-09):
--   7b0e02b9-42af-4998-b27d-69e3459b452b  Porsche 356C Karmann Coupe
--   1e9fdf16-b453-44a9-8b74-46bbe886625a  Chevrolet Corvette "It's Atlas"
--   1b16f3ec-97c6-4826-b1af-89c8c4687e7b  1966 Chevrolet Chevelle SS 396
-- Organization c433d27e-2159-4f8c-b4ae-32a5e44a77cf (Viva! Las Vegas Autos). Contributor 0b9f107a-d124-49de-9ded-94698f63c1c4 (Skylar,
-- username skylar). Profile 13450c45-... is also named Skylar and is a different person: nothing here matches by name.
--
-- What it writes:
--   * organization_vehicles: one row per car, relationship_type 'consigner' (allowed by organization_vehicles_relationship_type_check;
--     the org page shows it as CONSIGNED inventory), status 'active', listing_status 'auction_soon' (pre-auction, not 'for_sale'),
--     start_date NULL (the consignment date is not recorded; photos only say when Skylar saw the car), user_confirmed by Skylar.
--     ON CONFLICT DO NOTHING on (organization_id, vehicle_id, relationship_type).
--   * vehicle_contributors: Skylar as 'photographer' on the Chevelle (the other two already have it); enforce_contributor_evidence
--     admits it because his 21 photos of the car exist. can_sell false.
--   * vehicles: nothing. owner_id stays NULL and entry_type 'contributor_data'; the migration refuses if either has changed.
-- Not touched: the Chevelle's two Ernies links, Viva's stored total_vehicles counter (the org-stats trigger is skipped for these inserts,
-- the counter is a separate known-stale problem), the 46 Dropbox owner links and the Craigslist for_sale links.
-- Effect on access: vehicle_user_has_access gives Viva's active principals access to a vehicle with an active 'consigner' link created
-- by the vehicle's user; these three are private (is_public false), so Viva's staff can now open them. That is what inventory means.
--
-- Backup / undo: every inserted row id is recorded in public.profile_data_fix_backup_20261114 (fix 'B'). To undo:
--   DELETE FROM public.organization_vehicles WHERE id IN (SELECT row_key::uuid FROM public.profile_data_fix_backup_20261114
--     WHERE fix = 'B' AND table_name = 'organization_vehicles' AND action = 'insert');
--   DELETE FROM public.vehicle_contributors WHERE id IN (SELECT row_key::uuid FROM public.profile_data_fix_backup_20261114
--     WHERE fix = 'B' AND table_name = 'vehicle_contributors' AND action = 'insert');
-- Dry run (read-only): supabase/sql/dryrun_profile_data_fix_20261114.sql, section B. 2026-11-09: 3 links to insert, 1 contributor row.
-- Idempotent: a second run inserts nothing and records nothing.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL app.skip_org_stats_trigger = 'on';

CREATE TABLE IF NOT EXISTS public.profile_data_fix_backup_20261114 (
  id bigserial PRIMARY KEY,
  fix text NOT NULL,                 -- 'B' Viva trio links, 'C' owner_claim reclassification
  table_name text NOT NULL,
  row_key text NOT NULL,             -- the row's id (or a column name for a default change)
  action text NOT NULL CHECK (action IN ('insert', 'update', 'alter_default')),
  prior jsonb,                       -- values before the change (NULL for an insert)
  applied jsonb NOT NULL,            -- values the fix wrote
  rule_version text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_data_fix_backup_20261114_once UNIQUE (fix, table_name, row_key, action)
);
COMMENT ON TABLE public.profile_data_fix_backup_20261114 IS
  'Prior values and inserted ids of the 2026-11-14 profile data fixes (B: Viva pre-auction trio linked as consigned inventory; C: owner_claim reclassification of the vehicles whose owner_id was Skylar). One row per changed row; the undo statements are in the migrations'' headers.';
ALTER TABLE public.profile_data_fix_backup_20261114 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_data_fix_backup_20261114 FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.profile_data_fix_backup_20261114_id_seq FROM anon, authenticated;
GRANT ALL ON public.profile_data_fix_backup_20261114 TO service_role;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profile_data_fix_backup_20261114'
                   AND policyname = 'profile_data_fix_backup_20261114_service') THEN
    CREATE POLICY profile_data_fix_backup_20261114_service ON public.profile_data_fix_backup_20261114
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $p$;

-- Refuse if the world is not the reviewed one.
DO $guard$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf') THEN
    RAISE EXCEPTION 'fix B: organization Viva c433d27e-... not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4') THEN
    RAISE EXCEPTION 'fix B: profile 0b9f107a-... not found';
  END IF;
  IF (SELECT count(*) FROM public.vehicles
       WHERE id BETWEEN '1b16f3ec-0000-0000-0000-000000000000' AND '1b16f3ec-ffff-ffff-ffff-ffffffffffff') <> 1 THEN
    RAISE EXCEPTION 'fix B: id prefix 1b16f3ec no longer resolves to exactly one vehicle';
  END IF;
  FOR r IN SELECT t.id, v.id AS found, v.owner_id, v.entry_type, v.deleted_at
           FROM (VALUES ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid), ('1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid),
                        ('1b16f3ec-97c6-4826-b1af-89c8c4687e7b'::uuid)) AS t(id)
           LEFT JOIN public.vehicles v ON v.id = t.id LOOP
    IF r.found IS NULL OR r.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'fix B: vehicle % missing or deleted', r.id;
    END IF;
    IF r.owner_id IS NOT NULL OR r.entry_type IS DISTINCT FROM 'contributor_data' THEN
      RAISE EXCEPTION 'fix B: vehicle % is no longer owner_id NULL / contributor_data (owner %, entry %); review before linking',
        r.id, r.owner_id, r.entry_type;
    END IF;
  END LOOP;
END
$guard$;

WITH trio(vehicle_id) AS (
  VALUES ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid), ('1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid),
         ('1b16f3ec-97c6-4826-b1af-89c8c4687e7b'::uuid)),
ins AS (
  INSERT INTO public.organization_vehicles (
    organization_id, vehicle_id, relationship_type, status, listing_status, start_date, linked_by_user_id, auto_tagged,
    user_confirmed, user_confirmed_by, user_confirmed_at, notes)
  SELECT 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf', trio.vehicle_id, 'consigner', 'active', 'auction_soon', NULL,
         '0b9f107a-d124-49de-9ded-94698f63c1c4', false,
         true, '0b9f107a-d124-49de-9ded-94698f63c1c4', now(),
         'Viva pre-auction consigned inventory, confirmed by Skylar 2026-11-09. Skylar (0b9f107a) is the contributor (photographer), not the owner. Data fix B 20261114100100.'
  FROM trio
  ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING
  RETURNING id, vehicle_id, relationship_type, status, listing_status)
INSERT INTO public.profile_data_fix_backup_20261114 (fix, table_name, row_key, action, prior, applied, rule_version, evidence)
SELECT 'B', 'organization_vehicles', ins.id::text, 'insert', NULL, to_jsonb(ins), 'viva_trio_consigned_v1',
       jsonb_build_object('approved_by', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'approved_on', '2026-11-09',
                          'photos_by_contributor', (SELECT count(*) FROM public.vehicle_images vi
                                                    WHERE vi.vehicle_id = ins.vehicle_id AND vi.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'))
FROM ins
ON CONFLICT (fix, table_name, row_key, action) DO NOTHING;

WITH trio(vehicle_id) AS (
  VALUES ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid), ('1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid),
         ('1b16f3ec-97c6-4826-b1af-89c8c4687e7b'::uuid)),
ins AS (
  INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status, can_sell, notes)
  SELECT trio.vehicle_id, '0b9f107a-d124-49de-9ded-94698f63c1c4', 'photographer', 'active', false,
         'Contributor of photos of Viva consigned inventory; not the owner. Data fix B 20261114100100.'
  FROM trio
  WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_contributors c
                    WHERE c.vehicle_id = trio.vehicle_id AND c.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4')
  ON CONFLICT (vehicle_id, user_id, role) DO NOTHING
  RETURNING id, vehicle_id, user_id, role, status, can_sell)
INSERT INTO public.profile_data_fix_backup_20261114 (fix, table_name, row_key, action, prior, applied, rule_version)
SELECT 'B', 'vehicle_contributors', ins.id::text, 'insert', NULL, to_jsonb(ins), 'viva_trio_consigned_v1' FROM ins
ON CONFLICT (fix, table_name, row_key, action) DO NOTHING;

-- End state, same transaction.
DO $check$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.organization_vehicles ov
  JOIN public.vehicles v ON v.id = ov.vehicle_id
  WHERE ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' AND ov.relationship_type = 'consigner' AND ov.status = 'active'
    AND ov.end_date IS NULL AND ov.user_rejected IS NOT TRUE
    AND v.id IN ('7b0e02b9-42af-4998-b27d-69e3459b452b', '1e9fdf16-b453-44a9-8b74-46bbe886625a', '1b16f3ec-97c6-4826-b1af-89c8c4687e7b')
    AND v.owner_id IS NULL AND v.entry_type = 'contributor_data';
  IF n <> 3 THEN RAISE EXCEPTION 'fix B: expected 3 active Viva consigner links on unowned contributor_data vehicles, found %', n; END IF;
  SELECT count(DISTINCT c.vehicle_id) INTO n FROM public.vehicle_contributors c
  WHERE c.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND coalesce(c.status, 'active') = 'active'
    AND c.role NOT IN ('owner', 'previous_owner', 'consigner', 'seller', 'buyer')
    AND c.vehicle_id IN ('7b0e02b9-42af-4998-b27d-69e3459b452b', '1e9fdf16-b453-44a9-8b74-46bbe886625a', '1b16f3ec-97c6-4826-b1af-89c8c4687e7b');
  IF n <> 3 THEN RAISE EXCEPTION 'fix B: Skylar is not an active non-owner contributor on all three cars (% of 3)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_contributors c
             WHERE c.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND c.role IN ('owner', 'previous_owner')
               AND c.vehicle_id IN ('7b0e02b9-42af-4998-b27d-69e3459b452b', '1e9fdf16-b453-44a9-8b74-46bbe886625a', '1b16f3ec-97c6-4826-b1af-89c8c4687e7b')) THEN
    RAISE EXCEPTION 'fix B: Skylar carries an owner contributor role on one of the three cars';
  END IF;
END
$check$;

COMMIT;
