-- Narrow correction of cross-model aliases on GM truck catalog rows, shaped like 20261030003919 / 20261030051409
-- (K10 Custom).
--
-- Why. cohort_members() builds one word-boundary regex from a profile's canonical name and every alias of its catalog
-- row. resolve_class_price_cohort() and the other exact-alias resolvers file a model under any row listing it. Three
-- catalog rows list names of other trucks:
--   * Chevrolet C10, both rows: the bare trim word "cheyenne". Cheyenne was a trim on every C/K series, the Blazer and
--     the Suburban, so every Chevrolet of the year whose model says Cheyenne joins the C10 year cohort.
--   * GMC K1500 (half-ton 4WD): k20, k25, k2500, k30, k35, k3500. GMC C1500 (half-ton 2WD): c20, c25, c2500, c30, c35,
--     c3500. These are 3/4-ton and one-ton trucks.
--   * GMC Suburban: jimmy, yukon, yukon denali. GMC Jimmy and GMC Yukon have their own rows carrying those names.
--
-- Measured 2026-11-21, read-only.
-- C10 year cohorts. Columns: members; members that enter only through "cheyenne"; of those, how many name another
-- truck (K/V series, C/R 20-30, Blazer, Suburban, 4x4, 3/4 or one ton, Camper Special) and how many say only Cheyenne.
--   1966:   633 members;   1 enters only through "cheyenne" (  0 another truck,   1 Cheyenne only)
--   1971: 1,298 members; 251 (32 + 219)
--   1972: 2,207 members; 616 (124 + 492)
--   1976:   200 members;  54 (36 + 18)
--   1978:   282 members;  48 (31 + 17)
--   113 of them are also members of another live cohort.
-- The "Cheyenne only" trucks are not C10s by default. Of the 906 such trucks (1987 or earlier), 136 have a VIN that
-- decodes: 108 are C10 (C-prefix half-ton), 18 are K10 and 10 are C20 or K20. 1967-71 VINs read C/K + engine + tonnage
-- (CE14..., `vin-decoder.ts`); 1972-80 VINs read C + C/K + engine + tonnage (CKE142Z... = 1972 K10,
-- docs/guides/DEAL_JACKET_IMPORT_GUIDE.md).
-- GMC K1500 year cohorts: 1978, 5 of 41 members are 3/4-ton or one-ton; 1979, 7 of 39; 1983, 8 of 17. A 1983 K2500
-- resolves exactly to K1500 and is priced against that cohort.
-- GMC Suburban 1987 cohort: 45 of 76 members are Jimmys. resolve_class_price_cohort('GMC','Jimmy',1987) picks
-- Suburban.
--
-- What changes:
--   * Only those aliases come off the three rows, compared case-insensitively. The superseded arrays are appended to
--     each row's notes.
--   * "c10 cheyenne", the series-named Cheyenne spellings on K10, K20, K30, C20 and C30, the half-ton GMC spellings,
--     "yukon xl" on Suburban and the Jimmy and Yukon rows stay.
--   * GMC has no 3/4-ton or one-ton catalog row. Its K2500/C2500/K3500 trucks become unresolved (no cohort), and
--     so does a model that says only "Cheyenne". Unresolved is an honest state where the old one was a guess.
-- What does not change: no function body. normalize_vehicle_model, cohort_members, resolve_class_price_cohort,
-- refresh_vehicle_class_price and drain_vehicle_derived_queues are untouched. vehicles.normalized_model keeps its stored
-- values. The live trigger re-derives it only on a write to model, make or year.
-- Dependent folds:
--   * Stored family fits of the families whose names move are withheld through their existing writer, as in the
--     precedent.
--   * Stored class prices whose cohort profile sits on one of these rows are queued for the existing class price drain.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM public.canonical_models
      WHERE id IN ('022cef91-1b4b-406d-9f39-d08072175cbd', '5d4192f0-9d02-497f-b4a9-c890c42414fa')
        AND lower(make) = 'chevrolet' AND canonical_model = 'C10' AND 'c10 cheyenne' = ANY (aliases)) <> 2
     OR NOT EXISTS (SELECT FROM public.canonical_models
       WHERE id = '87fb1e59-3e43-4b01-83ff-d6f679192ccd' AND lower(make) = 'chevrolet' AND canonical_model = 'K10'
         AND 'k10 cheyenne' = ANY (aliases))
     OR NOT EXISTS (SELECT FROM public.canonical_models
       WHERE id = 'ca121299-c4e4-4175-b705-0002d458b7d0' AND lower(make) = 'gmc' AND canonical_model = 'K1500'
         AND 'k1500' = ANY (aliases))
     OR NOT EXISTS (SELECT FROM public.canonical_models
       WHERE id = '0ad28a5e-0e45-4280-935c-f6cff2154c28' AND lower(make) = 'gmc' AND canonical_model = 'C1500'
         AND 'c1500' = ANY (aliases))
     OR NOT EXISTS (SELECT FROM public.canonical_models
       WHERE id = 'fbd96a44-fc26-42e5-aa8e-dc285ee56ff9' AND lower(make) = 'gmc' AND canonical_model = 'Suburban'
         AND 'suburban' = ANY (aliases))
     OR NOT EXISTS (SELECT FROM public.canonical_models
       WHERE id = 'e982bd2c-d8f5-484b-91ac-850f21d764f3' AND lower(make) = 'gmc' AND canonical_model = 'Jimmy'
         AND 'jimmy' = ANY (aliases))
     OR NOT EXISTS (SELECT FROM public.canonical_models
       WHERE id = 'dbba5e0a-19d6-429f-b1b6-3b51626ae8bf' AND lower(make) = 'gmc' AND canonical_model = 'Yukon'
         AND 'yukon' = ANY (aliases)) THEN
    RAISE EXCEPTION 'GM truck alias ownership changed; review before applying';
  END IF;
END $guard$;

WITH drop_alias(id, alias) AS (VALUES
  ('022cef91-1b4b-406d-9f39-d08072175cbd'::uuid, 'cheyenne'), ('5d4192f0-9d02-497f-b4a9-c890c42414fa'::uuid, 'cheyenne'),
  ('ca121299-c4e4-4175-b705-0002d458b7d0'::uuid, 'k20'), ('ca121299-c4e4-4175-b705-0002d458b7d0'::uuid, 'k25'),
  ('ca121299-c4e4-4175-b705-0002d458b7d0'::uuid, 'k2500'), ('ca121299-c4e4-4175-b705-0002d458b7d0'::uuid, 'k30'),
  ('ca121299-c4e4-4175-b705-0002d458b7d0'::uuid, 'k35'), ('ca121299-c4e4-4175-b705-0002d458b7d0'::uuid, 'k3500'),
  ('0ad28a5e-0e45-4280-935c-f6cff2154c28'::uuid, 'c20'), ('0ad28a5e-0e45-4280-935c-f6cff2154c28'::uuid, 'c25'),
  ('0ad28a5e-0e45-4280-935c-f6cff2154c28'::uuid, 'c2500'), ('0ad28a5e-0e45-4280-935c-f6cff2154c28'::uuid, 'c30'),
  ('0ad28a5e-0e45-4280-935c-f6cff2154c28'::uuid, 'c35'), ('0ad28a5e-0e45-4280-935c-f6cff2154c28'::uuid, 'c3500'),
  ('fbd96a44-fc26-42e5-aa8e-dc285ee56ff9'::uuid, 'jimmy'), ('fbd96a44-fc26-42e5-aa8e-dc285ee56ff9'::uuid, 'yukon'),
  ('fbd96a44-fc26-42e5-aa8e-dc285ee56ff9'::uuid, 'yukon denali')),
per_row AS (SELECT id, array_agg(alias) AS gone FROM drop_alias GROUP BY id)
UPDATE public.canonical_models c
SET notes = concat_ws(E'\n', nullif(c.notes, ''),
      '[GM truck cross-model alias separation] Superseded aliases: ' || to_jsonb(c.aliases)::text),
    aliases = ARRAY(SELECT a FROM unnest(c.aliases) WITH ORDINALITY u(a, i) WHERE lower(a) <> ALL (r.gone) ORDER BY i)
FROM per_row r
WHERE c.id = r.id AND EXISTS (SELECT FROM unnest(c.aliases) a WHERE lower(a) = ANY (r.gone));

-- Families whose names move (emulated over mv_model_family_names, 2026-11-21). Withhold the stored fit of every
-- family that loses the wrong names or gains 10 or more vehicles:
--   * Chevrolet C10 loses 584 vehicles; Chevrolet Pickup gains 46.
--   * GMC K1500 loses 169 and GMC C1500 loses 122. GMC Sierra gains 63, GMC Pickup 38 and GMC Suburban 10.
--   * GMC Suburban loses 172 "Yukon Denali" vehicles to Yukon.
-- Families that gain fewer keep their fit: Chevrolet C1500, Custom, C20, K10, K20, C30, C2500 and 3500.
DO $invalidate$
DECLARE r record;
BEGIN
  FOR r IN SELECT brand, family_key FROM public.family_price_change
    WHERE ((brand = 'Chevrolet' AND family_key IN ('022cef91-1b4b-406d-9f39-d08072175cbd',
              '00000000-0000-4000-b000-000000001928'))
        OR (brand = 'GMC' AND family_key IN ('ca121299-c4e4-4175-b705-0002d458b7d0',
              '0ad28a5e-0e45-4280-935c-f6cff2154c28', '041a628a-b9c3-45ba-b2a8-68eeb0c297f5',
              '7fb39b95-f3e6-4937-b08d-89f8bde41639', 'fbd96a44-fc26-42e5-aa8e-dc285ee56ff9',
              'dbba5e0a-19d6-429f-b1b6-3b51626ae8bf')))
      AND method IS DISTINCT FROM 'identity_membership_changed_v1'
  LOOP
    PERFORM public.record_family_price_index(jsonb_build_object(
      'brand', r.brand, 'family_key', r.family_key, 'fitted_at', now(),
      'period_kind', NULL, 'series', '[]'::jsonb,
      'change', jsonb_build_object('change_12m', NULL, 'lo', NULL, 'hi', NULL,
        'n_last12', 0, 'n_prior12', 0, 'verdict', 'too few to tell',
        'method', 'identity_membership_changed_v1',
        'ref_car', jsonb_build_object('basis', 'Cross-model alias membership corrected; awaiting a new fit'),
        'pairs', NULL, 'rs_change', NULL, 'rs_lo', NULL, 'rs_hi', NULL, 'chips', '[]'::jsonb)));
  END LOOP;
END $invalidate$;

-- Stored class prices priced from one of these cohorts are stale; hand them to the existing drain (20261121110000).
DO $requeue$
BEGIN
  IF to_regclass('public.vehicle_class_price_recompute_queue') IS NOT NULL
     AND to_regclass('public.vehicle_class_price') IS NOT NULL THEN
    INSERT INTO public.vehicle_class_price_recompute_queue (vehicle_id, queued_at, reason)
    SELECT p.vehicle_id, now(), 'cohort_membership_changed'
      FROM public.vehicle_class_price p
      JOIN public.make_model_profiles m ON m.subject_id = p.cohort_subject_id
     WHERE m.canonical_model_id IN ('022cef91-1b4b-406d-9f39-d08072175cbd', '5d4192f0-9d02-497f-b4a9-c890c42414fa',
       'ca121299-c4e4-4175-b705-0002d458b7d0', '0ad28a5e-0e45-4280-935c-f6cff2154c28',
       'fbd96a44-fc26-42e5-aa8e-dc285ee56ff9')
    ON CONFLICT (vehicle_id) DO NOTHING;
  END IF;
END $requeue$;

DO $locks$
BEGIN
 IF EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock') THEN
  RAISE EXCEPTION 'Lock wait detected after alias correction; rollback and investigate';
 END IF;
END $locks$;
COMMIT;
