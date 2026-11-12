-- Data fix C: the vehicles whose owner_id is Skylar and whose entry_type is the column default 'owner_claim', reclassified from evidence,
-- and the entry_type default changed so a new record no longer asserts ownership.
--
-- Approved by Skylar on 2026-11-09 ("read-side and clean the rows"). Rule: _profile_ownership_class_v1 (migration 20261116050000), the
-- same rule profile_vehicle_relationships_read_v1 shows, so the read side and the rows agree:
--   owner        a title verification, a purchase record (acquisition book entry, purchase agreement / bill of sale, outgoing payment)
--                or a deal jacket he created                                            -> unchanged (owner_id stays, entry_type stays)
--   contributor  only photos or creating the record, with nothing pointing at ownership, or his own garage statement denying ownership
--                                                                                       -> owner_id NULL, entry_type 'contributor_data'
--   ambiguous    something points at ownership without proving it (sale proceeds, book entries, an ownership fold row, an owner /
--                previously-owned / consigned grant, a typed purchase price or date, an owner statement)       -> unchanged, listed
--   no_evidence  nothing but the owner_id field itself                                   -> unchanged, listed
-- Dry run 2026-11-09 (read-only, 112 vehicles with owner_id = Skylar, entry_type owner_claim, not deleted):
--   owner 3, contributor 43, ambiguous 23, no_evidence 43. The ids of every bucket are in the PR and in
--   supabase/sql/dryrun_profile_data_fix_20261114.sql (section C) recomputes them.
--
-- Only the 43 reviewed contributor ids below are changed, and each only if, at apply time, it still has owner_id = Skylar, entry_type
-- 'owner_claim', is not deleted, _profile_ownership_class_v1 still says 'contributor', and (if private) he keeps another tie to it.
-- Anything else is skipped with a NOTICE.
-- Skylar keeps access to every changed vehicle: all 43 are public, and each still ties to him through user_id / uploaded_by or an active
-- vehicle_contributors role (checked in the dry run: 0 without a tie). He loses vehicles_simple_update_policy edit rights only where
-- owner_id was his sole tie, which is what contributor means.
-- Side effects of the UPDATE: vehicles' row triggers fire as for any edit (edit audit log, updated_at, assignment suggestions, completion,
-- taxonomy queue; trigger_auto_extract_bat_data re-checks 1 of the 43, a BaT vehicle with missing BaT fields). trg_auto_collect_field_evidence
-- does not track owner_id or entry_type, so no field evidence is written.
--
-- Default: vehicles.entry_type DEFAULT 'owner_claim' -> 'contributor_data'. Creating a record is evidence of contributing data, not of
-- owning the car. NULL was considered and rejected: vehicle_profile_read reads coalesce(entry_type, 'owner_claim'), so NULL would still
-- make the creator the owner there. Writers that set entry_type explicitly are unaffected.
--
-- Backup / undo: prior owner_id and entry_type of every changed row, and the prior default, are in public.profile_data_fix_backup_20261114
-- (fix 'C'). To undo:
--   UPDATE public.vehicles v SET owner_id = (b.prior->>'owner_id')::uuid, entry_type = b.prior->>'entry_type'
--     FROM public.profile_data_fix_backup_20261114 b
--     WHERE b.fix = 'C' AND b.table_name = 'vehicles' AND b.action = 'update' AND v.id = b.row_key::uuid;
--   ALTER TABLE public.vehicles ALTER COLUMN entry_type SET DEFAULT 'owner_claim';
-- Idempotent: a second run changes and records nothing (the rows no longer match; the default is already set).
-- Out of scope and untouched: the 46 Dropbox owner links, the Craigslist for_sale links, the owner / ambiguous / no_evidence vehicles.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public._profile_ownership_class_v1(uuid)') IS NULL THEN
    RAISE EXCEPTION 'fix C needs 20261116050000_profile_read_functions_v1 applied first';
  END IF;
  IF to_regclass('public.profile_data_fix_backup_20261114') IS NULL THEN
    RAISE EXCEPTION 'fix C needs 20261116050100_viva_preauction_trio_consigned applied first (it creates the backup table)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4') THEN
    RAISE EXCEPTION 'fix C: profile 0b9f107a-... not found';
  END IF;
END
$guard$;

CREATE TEMP TABLE fix_c_reviewed (vehicle_id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO fix_c_reviewed (vehicle_id) VALUES
  ('043c6d8b-c81e-420a-9d20-77cf3385fc2a'),  -- 1973 Dodge Charger 318
  ('06d4eb9b-74af-49a8-af7c-75aeb5abfe27'),  -- 1980 Chevrolet C10
  ('0ec2c1ef-de57-45a8-b594-ef534e26cf6f'),  -- 1967 Chevrolet C10 SWB
  ('1511336a-daa0-48ef-bcb3-15720474e602'),  -- 2005 Ferrari 360 Spider
  ('16387b47-c684-4cc1-b5bd-b4064cc6277e'),  -- 1964 Jaguar XKE 4.2
  ('1fe01b00-b61b-47e3-b539-d3b81731c26b'),  -- 1969 Chevrolet C10
  ('20d21fb0-4651-4469-a0ba-e751309a1e54'),  -- 1973 Pontiac Firebird
  ('2789fa29-1823-467c-a84b-857f552c340f'),  -- 1989 GMC jimmy k5
  ('2cb63055-b80e-4145-b4c7-7af72081fa0c'),  -- 1971 Chevrolet C10 SWB 402
  ('2e60f268-c54b-4e5b-ac03-2ead0a85de38'),  -- 1985 Chevrolet K10 SWB
  ('319c8829-076a-4b01-9ec2-e9e9b204390e'),  -- 1959 Chevrolet 3100 SWB
  ('4470c7b9-bbbc-4627-b908-3fc0567a68e7'),  -- 1979 Chevrolet Silverado C10
  ('46502e12-881e-4181-92a4-f9278c9e37de'),  -- 1982 GMC K2500 LWB
  ('48875fce-7b71-48f5-ac36-bcaf12f50fd0'),  -- 1966 Chevrolet C10
  ('50dd2f1a-01de-4f26-9729-c38a82b7c1bb'),  -- 1973 GMC Jimmy
  ('5a1deb95-4b67-4cc3-9575-23bb5b180693'),  -- 1983 GMC K1500
  ('5c4972dc-072e-4349-98b2-781b44106840'),  -- 1973 None Thing
  ('5dbbb59a-1c93-428d-a4e9-27f5638020e5'),  -- 1968 Ford Mustang
  ('710dc2a3-ce4c-4189-a51b-a2d2d41480d6'),  -- 1974 Ford Bronco 351w
  ('7c1f5fda-aab2-44fb-9b91-664a5dcdc0c0'),  -- 1976 Chevrolet C20
  ('8cb16949-6818-4b98-8bea-39633f6a33ba'),  -- 1972 GMC C30 Longhorn
  ('9d50d8a5-3a38-4358-929e-d9b8c7677ae1'),  -- 1968 Chevrolet C10
  ('a621f67e-67c8-457a-bf2b-41c53efe9a73'),  -- 1979 GMC K15 SWB
  ('a8c62a6d-f6e1-42fb-808d-d8a73677dc71'),  -- 1972 Chevrolet K10 LWB
  ('ab3f91b3-1104-45e2-8dc7-8c241eb1516e'),  -- 1967 Porsche 912
  ('ac070808-4cbd-4d03-9c39-2ec5b0f0708c'),  -- 1968 Ford Mustang
  ('acef5364-7430-480c-875b-ab1f38f2c53f'),  -- 1970 Mercedes Benz 280 Sl
  ('afcfef94-895f-436b-b66c-acb2e2f46973'),  -- 1979 Chevrolet K10
  ('b5a0c58a-6915-499b-ba5d-63c42fb6a91f'),  -- 1985 Chevrolet Suburban
  ('b5a24e45-7171-4296-b13b-032e9f959eb8'),  -- 1987 Chevrolet V3500 Dually
  ('b987278a-64ab-44ae-8342-37557b79f73e'),  -- 1968 Porsche 911
  ('bde2f96d-115a-4b10-9272-2030048529e4'),  -- 1931 Austin Hot Rod
  ('c3819d9c-342e-4743-9500-e27a8f574818'),  -- 1988 Chevrolet V3500
  ('c6189023-ab62-4ca8-9bb0-94511a30f037'),  -- 1971 Ford Bronco
  ('ca42fb87-2a18-4ca7-8ebc-39bcbdaef7a6'),  -- 1973 Chevrolet C30
  ('cf566074-901c-47b4-8612-ca3a2ff8cfb1'),  -- 1967 Pontiac GTO
  ('d29a8779-6815-42b9-a20f-c835742d6080'),  -- 1965 Chevrolet Corvette
  ('d45c3f01-3dd6-4120-9860-f4536138efb3'),  -- 1963 Harley-Davidson Shovelhead
  ('d5ec0923-fc83-4ed1-b094-6cfb14713e4c'),  -- 1978 Chevrolet K20 LWB
  ('e0bcd7fe-ebf1-49ed-8756-1d6ba761d911'),  -- 1987 GMC V15 LWB
  ('e8a9c558-a930-4e55-9e5c-4a2711cab081'),  -- 1972 Chevrolet K10 SWB
  ('f375f605-6700-4d08-9f65-45860c4466a6'),  -- 1971 GMC K15 Suburban
  ('f6e64a4f-6f74-4234-8174-5a7f8dbdafab');  -- 1980 Chevrolet K30 Crew Cab

-- Classify now, with the same rule the read side uses.
CREATE TEMP TABLE fix_c_plan ON COMMIT DROP AS
SELECT r.vehicle_id, v.owner_id, v.entry_type, v.deleted_at, c.ownership_class, c.contribution_count, c.conflict_ids, c.denial_ids,
       c.confidence,
       (v.owner_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND v.entry_type = 'owner_claim' AND v.deleted_at IS NULL
        AND c.ownership_class = 'contributor'
        -- never strand him: a private vehicle changes only if he keeps a tie that still lets him open it
        AND (v.is_public IS TRUE OR v.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' OR v.uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4'
             OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id = v.id
                          AND vc.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND coalesce(vc.status, 'active') = 'active'))) IS TRUE AS act
FROM fix_c_reviewed r
LEFT JOIN public.vehicles v ON v.id = r.vehicle_id
LEFT JOIN public._profile_ownership_class_v1('0b9f107a-d124-49de-9ded-94698f63c1c4') c ON c.vehicle_id = r.vehicle_id;

DO $notice$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM fix_c_plan WHERE NOT act ORDER BY vehicle_id LOOP
    RAISE NOTICE 'fix C skips %: owner_id %, entry_type %, deleted %, class now %', r.vehicle_id, r.owner_id, r.entry_type,
      r.deleted_at IS NOT NULL, r.ownership_class;
  END LOOP;
END
$notice$;

INSERT INTO public.profile_data_fix_backup_20261114 (fix, table_name, row_key, action, prior, applied, rule_version, evidence)
SELECT 'C', 'vehicles', p.vehicle_id::text, 'update',
       jsonb_build_object('owner_id', p.owner_id, 'entry_type', p.entry_type),
       jsonb_build_object('owner_id', NULL, 'entry_type', 'contributor_data'),
       '_profile_ownership_class_v1',
       jsonb_build_object('ownership_class', p.ownership_class, 'confidence', p.confidence, 'contribution_rows', p.contribution_count,
                          'conflicts', p.conflict_ids, 'denials', p.denial_ids)
FROM fix_c_plan p WHERE p.act
ON CONFLICT (fix, table_name, row_key, action) DO NOTHING;

UPDATE public.vehicles v
SET owner_id = NULL, entry_type = 'contributor_data'
FROM fix_c_plan p
WHERE p.act AND v.id = p.vehicle_id
  AND v.owner_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND v.entry_type = 'owner_claim';

-- The default stops asserting ownership.
INSERT INTO public.profile_data_fix_backup_20261114 (fix, table_name, row_key, action, prior, applied, rule_version)
SELECT 'C', 'vehicles', 'entry_type', 'alter_default',
       jsonb_build_object('default', pg_get_expr(d.adbin, d.adrelid)), jsonb_build_object('default', '''contributor_data''::text'),
       'entry_type_default_v1'
FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
WHERE d.adrelid = 'public.vehicles'::regclass AND a.attname = 'entry_type'
  AND pg_get_expr(d.adbin, d.adrelid) <> '''contributor_data''::text'
ON CONFLICT (fix, table_name, row_key, action) DO NOTHING;
ALTER TABLE public.vehicles ALTER COLUMN entry_type SET DEFAULT 'contributor_data';
COMMENT ON COLUMN public.vehicles.entry_type IS
  'How the record entered, never proof of ownership: contributor_data (default since 2026-11-14: creating a record is contributing data), owner_claim (the creator says they own it; testimony), title_verified, disputed. Ownership is computed from evidence by _profile_ownership_class_v1 / profile_vehicle_relationships_read_v1.';

-- End state, same transaction.
DO $check$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM fix_c_plan p JOIN public.vehicles v ON v.id = p.vehicle_id
  WHERE p.act AND (v.owner_id IS NOT NULL OR v.entry_type <> 'contributor_data');
  IF n > 0 THEN RAISE EXCEPTION 'fix C: % planned vehicles were not reclassified', n; END IF;
  SELECT count(*) INTO n FROM fix_c_plan p
  WHERE p.act AND NOT EXISTS (SELECT 1 FROM public.profile_data_fix_backup_20261114 b
                              WHERE b.fix = 'C' AND b.table_name = 'vehicles' AND b.action = 'update' AND b.row_key = p.vehicle_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'fix C: % changed vehicles have no backup row', n; END IF;
  SELECT count(*) INTO n FROM public.vehicles v
  WHERE v.owner_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND v.id IN (SELECT vehicle_id FROM fix_c_plan WHERE act);
  IF n > 0 THEN RAISE EXCEPTION 'fix C: Skylar is still owner_id on % reclassified vehicles', n; END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'public.vehicles'::regclass AND a.attname = 'entry_type') IS DISTINCT FROM '''contributor_data''::text' THEN
    RAISE EXCEPTION 'fix C: vehicles.entry_type default is not contributor_data';
  END IF;
  RAISE NOTICE 'fix C: % of % reviewed vehicles reclassified to contributor in this run',
    (SELECT count(*) FROM fix_c_plan WHERE act), (SELECT count(*) FROM fix_c_plan);
END
$check$;

COMMIT;
