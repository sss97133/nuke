-- Read-only dry run for data fixes B (20261114100100) and C (20261114100200). Run after 20261114100000 (the read functions, additive)
-- and before B and C. Everything is inside a READ ONLY transaction and rolled back: it cannot write.
--   psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/sql/dryrun_profile_data_fix_20261114.sql
-- 2026-11-09 answers (read-only, against qkgaybvrernstplzjaam with the functions' bodies inlined):
--   B: links_to_insert 3, contributor_rows_to_insert 1, trio_not_unowned_contributor_data 0, chevelle_prefix_matches 1
--   C: owner 3, contributor 43, ambiguous 23, no_evidence 43 (112 vehicles); all 43 contributors public; contributor_private_without_other_tie 0
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';

-- B ----------------------------------------------------------------------------------------------------------------------------------
WITH trio(vehicle_id) AS (VALUES ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid), ('1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid),
                                 ('1b16f3ec-97c6-4826-b1af-89c8c4687e7b'::uuid))
SELECT 'B' AS fix,
  (SELECT count(*) FROM trio WHERE NOT EXISTS (SELECT 1 FROM public.organization_vehicles ov
     WHERE ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' AND ov.vehicle_id = trio.vehicle_id
       AND ov.relationship_type = 'consigner')) AS links_to_insert,
  (SELECT count(*) FROM trio WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_contributors c
     WHERE c.vehicle_id = trio.vehicle_id AND c.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4')) AS contributor_rows_to_insert,
  (SELECT count(*) FROM trio JOIN public.vehicles v ON v.id = trio.vehicle_id
     WHERE v.owner_id IS NOT NULL OR v.entry_type IS DISTINCT FROM 'contributor_data' OR v.deleted_at IS NOT NULL) AS trio_not_unowned_contributor_data,
  (SELECT count(*) FROM public.vehicles
     WHERE id BETWEEN '1b16f3ec-0000-0000-0000-000000000000' AND '1b16f3ec-ffff-ffff-ffff-ffffffffffff') AS chevelle_prefix_matches;

-- C: counts per class over the vehicles fix C looks at ----------------------------------------------------------------------------
WITH dry_c AS (
  SELECT v.id, v.year, v.make, v.model, v.is_public, coalesce(c.ownership_class, 'no_evidence') AS ownership_class, c.confidence,
         c.owner_ids, c.conflict_ids, c.denial_ids,
         coalesce(v.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4', false)
          OR coalesce(v.uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4', false)
          OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id = v.id
                       AND vc.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND coalesce(vc.status, 'active') = 'active') AS keeps_tie
  FROM public.vehicles v
  LEFT JOIN public._profile_ownership_class_v1('0b9f107a-d124-49de-9ded-94698f63c1c4') c ON c.vehicle_id = v.id
  WHERE v.owner_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND v.entry_type = 'owner_claim' AND v.deleted_at IS NULL)
SELECT 'C' AS fix, ownership_class, count(*) AS vehicles,
       count(*) FILTER (WHERE ownership_class = 'contributor' AND is_public IS NOT TRUE AND NOT keeps_tie) AS contributor_private_without_other_tie
FROM dry_c GROUP BY ownership_class ORDER BY ownership_class;

-- Every vehicle with its class and evidence, for review.
WITH dry_c AS (
  SELECT v.id, v.year, v.make, v.model, v.is_public, coalesce(c.ownership_class, 'no_evidence') AS ownership_class, c.confidence,
         c.owner_ids, c.conflict_ids, c.denial_ids,
         coalesce(v.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4', false)
          OR coalesce(v.uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4', false)
          OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id = v.id
                       AND vc.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND coalesce(vc.status, 'active') = 'active') AS keeps_tie
  FROM public.vehicles v
  LEFT JOIN public._profile_ownership_class_v1('0b9f107a-d124-49de-9ded-94698f63c1c4') c ON c.vehicle_id = v.id
  WHERE v.owner_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND v.entry_type = 'owner_claim' AND v.deleted_at IS NULL)
SELECT ownership_class, id, year, make, model, confidence, owner_ids, conflict_ids, denial_ids FROM dry_c ORDER BY ownership_class, year, id;

ROLLBACK;
