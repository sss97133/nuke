-- establishment_basis_v1: every established facet item and established set grade says what establishes it, from one
-- rule row. No status or grade changes.
--
-- WHY. Lead ruling 2026-11-25 (establishment rule 20261124195500 held until a path up exists): measured live 05:10Z,
-- 1,853 of 1,854 established set grades (486 vehicles) carry a VIN decode, and no car in the fleet has a VIN that a photo
-- read or paper witnesses. A decode of an unwitnessed VIN printed 'established' exactly like paper. The reader now says
-- which: 'VIN decode; VIN from listing text, unwitnessed' vs 'VIN decode; VIN witnessed' vs 'independent sources agree'.
--
-- WHAT.
-- 1. public.establishment_rules + row 'default' and public.vehicle_vin_established(vehicle), moved here from the held
--    20261124195500 (identical definitions; that migration's CREATE IF NOT EXISTS / ON CONFLICT DO NOTHING stay no-ops).
-- 2. public.vehicle_vin_basis(vehicle) -> witnessed | photo_supported | listing_text | record_only | NULL (no VIN).
--    witnessed = vehicle_vin_established under the row; photo_supported = a photo read states the current VIN but the
--    row is not met; listing_text = a listing states it (vehicle_vin_evidence or a field_evidence claim); record_only =
--    nothing but the vehicle record states it.
-- 3. public.establishment_basis(classes, vin_basis, sources, families) -> {code, label, vin, sources, source_families,
--    rule}. code: derived > receipt > vin_decode.<vin_basis> > independent.{readings|mixed|claims}. Labels are
--    vocabulary_labels rows, domain 'establishment_basis'.
-- 4. vehicle_facet_items: every status = 'established' item carries `basis` (facet items, derived items with the keys
--    they read, the location area); `agreement` also carries {sources,
--    source_families} (and a claim with no reading now has an agreement object, read by the kit line of #3844).
-- 5. vehicle_data_sets: every set with grade 'established' carries `basis` (from witness_classes at read time).
-- 6. public.establishment_basis_gauge(): established set grades and vehicles by basis code, and the count resting on an
--    unwitnessed VIN, over public not-deleted vehicles, with counted_at. A partial index keeps it off a full scan.
-- PREDICTED (live 05:10Z): gauge established 1,854 grades / 486 vehicles; established_by_unwitnessed_vin ~1,853 grades /
-- ~485 vehicles; established vehicles with a witnessed VIN 0. Proof car: every established facet item has a basis; no
-- status moves anywhere.
-- REVERT. Redefine both readers without the text marked establishment_basis_v1; the new functions, rows and index can
-- stay (nothing else reads them).
-- Contract: supabase/sql/test_establishment_basis.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- 1. the rule row and the VIN's own grade (as held in 20261124195500) -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.establishment_rules (
  rule_key text PRIMARY KEY,
  rule_version int NOT NULL,
  establish_alone text[] NOT NULL,
  establish_classes text[] NOT NULL,
  establish_min int NOT NULL CHECK (establish_min >= 1),
  establish_min_families int NOT NULL CHECK (establish_min_families >= 1),
  inherits jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- a rule row names only witness classes of evidence_class_rank (as data_set_kind_properties_check does for kinds)
CREATE OR REPLACE FUNCTION public.establishment_rules_check() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.establish_alone || NEW.establish_classes) c
              WHERE NOT EXISTS (SELECT 1 FROM public.evidence_class_rank k WHERE k.class = c AND k.is_witness)) THEN
    RAISE EXCEPTION 'establishment_rules %: every class must be a witness class in evidence_class_rank', NEW.rule_key
      USING ERRCODE = '23503';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS establishment_rules_check ON public.establishment_rules;
CREATE TRIGGER establishment_rules_check BEFORE INSERT OR UPDATE ON public.establishment_rules
  FOR EACH ROW EXECUTE FUNCTION public.establishment_rules_check();

INSERT INTO public.establishment_rules (rule_key, rule_version, establish_alone, establish_classes, establish_min, establish_min_families, inherits, note)
VALUES ('default', 1, '{decode,receipt}', '{decode,receipt,reading_registered}', 2, 2,
        '{"decode": "vin"}'::jsonb,
        'A value is established by one witness of an alone class (a VIN decode, paper), or by establish_min distinct photos '
        'read by establish_min_families registered reader families. A decode inherits the grade of the VIN it decodes '
        '(vehicle_vin_established, same row). Listing and record text are claims. Revert to the pre-row facet behaviour: '
        'add claim and reading_unregistered to establish_classes.')
ON CONFLICT (rule_key) DO NOTHING;

ALTER TABLE public.establishment_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS establishment_rules_read ON public.establishment_rules;
CREATE POLICY establishment_rules_read ON public.establishment_rules FOR SELECT USING (true);
GRANT SELECT ON public.establishment_rules TO anon, authenticated, service_role;
COMMENT ON TABLE public.establishment_rules IS
  'When a value is established: alone classes, counted classes, minimum photos and reader families, and what a class '
  'inherits its grade from. Read by establishment_basis and vehicle_vin_established (20261124195700).';

CREATE OR REPLACE FUNCTION public.vehicle_vin_established(p_vehicle uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path TO 'public'
AS $f$
  WITH e AS (SELECT * FROM public.establishment_rules WHERE rule_key = 'default'),
  v AS (SELECT x.id, upper(btrim(x.vin)) AS vin FROM public.vehicles x WHERE x.id = p_vehicle AND nullif(btrim(x.vin), '') IS NOT NULL),
  -- The VIN's own witnesses: field_evidence rows stating the current VIN. A decode never witnesses its own VIN.
  w AS (
    SELECT CASE WHEN f.source_type IN ('quickbooks', 'invoice', 'email_receipt', 'receipt') THEN 'receipt'
                WHEN f.raw_extraction_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'reading_unregistered'
                ELSE 'claim' END AS cls,
           coalesce('img:' || CASE WHEN f.raw_extraction_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                   THEN f.raw_extraction_data->>'image_id' END, 'fe:' || f.id) AS wkey,
           NULL::text AS fam
      FROM v JOIN public.field_evidence f ON f.vehicle_id = v.id
     WHERE f.field_name = 'vin' AND f.status IN ('accepted', 'conflicted', 'pending')
       AND upper(btrim(f.proposed_value)) = v.vin
       AND coalesce(f.source_type, '') NOT IN ('system_update', 'vehicle_record', 'nhtsa_vin_decode', 'nhtsa_vpic', 'gm_vin_chart')
       AND coalesce(f.extraction_context, '') NOT LIKE 'vin\_decode\_% via observation-writer%')
  SELECT coalesce((
    SELECT bool_or(w.cls = ANY (e.establish_alone))
           OR (count(DISTINCT w.wkey) FILTER (WHERE w.cls = ANY (e.establish_classes)) >= e.establish_min
               AND count(DISTINCT w.fam) FILTER (WHERE w.cls = ANY (e.establish_classes)) >= e.establish_min_families)
      FROM w CROSS JOIN e GROUP BY e.establish_min, e.establish_min_families), false)
$f$;
REVOKE ALL ON FUNCTION public.vehicle_vin_established(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_vin_established(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_vin_established(uuid) IS
  'True when the current VIN is established under establishment_rules ''default'' by its own witnesses. 20261124195700.';

-- 2. where the VIN stands -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_vin_basis(p_vehicle uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
  WITH v AS (SELECT x.id, upper(btrim(x.vin)) AS vin FROM public.vehicles x
              WHERE x.id = p_vehicle AND nullif(btrim(x.vin), '') IS NOT NULL
                AND public.data_set_can_read_vehicle(p_vehicle)),
  fe AS (SELECT f.source_type, f.raw_extraction_data->>'image_id' AS image_id
           FROM v JOIN public.field_evidence f ON f.vehicle_id = v.id
          WHERE f.field_name = 'vin' AND f.status IN ('accepted', 'conflicted', 'pending')
            AND upper(btrim(f.proposed_value)) = v.vin
            AND coalesce(f.source_type, '') NOT IN ('system_update', 'vehicle_record', 'nhtsa_vin_decode', 'nhtsa_vpic', 'gm_vin_chart')
            AND coalesce(f.extraction_context, '') NOT LIKE 'vin\_decode\_% via observation-writer%')
  SELECT CASE
           WHEN public.vehicle_vin_established(v.id) THEN 'witnessed'
           WHEN EXISTS (SELECT 1 FROM fe WHERE fe.image_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN 'photo_supported'
           WHEN EXISTS (SELECT 1 FROM fe)
             OR EXISTS (SELECT 1 FROM public.vehicle_vin_evidence e
                         WHERE e.vehicle_id = v.id AND e.retired_at IS NULL AND upper(btrim(e.vin_value)) = v.vin) THEN 'listing_text'
           ELSE 'record_only' END
    FROM v
$f$;
REVOKE ALL ON FUNCTION public.vehicle_vin_basis(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_vin_basis(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_vin_basis(uuid) IS
  'witnessed | photo_supported | listing_text | record_only for the current VIN under establishment_rules ''default''; '
  'NULL when there is no VIN or the caller cannot read the vehicle. 20261124195700.';

-- 3. the basis of an established value, from the same row --------------------------------------------------------
INSERT INTO public.vocabulary_labels (domain, code, label, note) VALUES
  ('establishment_basis', 'derived', 'computed from established inputs', 'an equation over items that are each established; their basis is on them'),
  ('establishment_basis', 'receipt', 'paper states it', 'a receipt or document (alone class)'),
  ('establishment_basis', 'vin_decode.witnessed', 'VIN decode; VIN witnessed', 'the VIN is established by a photo read or paper'),
  ('establishment_basis', 'vin_decode.photo_supported', 'VIN decode; VIN read from a photo, not yet established',
   'one photo reading states the VIN; the rule row wants a second object or paper'),
  ('establishment_basis', 'vin_decode.listing_text', 'VIN decode; VIN from listing text, unwitnessed',
   'only listing text states the VIN; no photo read or paper'),
  ('establishment_basis', 'vin_decode.record_only', 'VIN decode; VIN on the vehicle record only, unwitnessed',
   'nothing but the vehicle record states the VIN'),
  ('establishment_basis', 'vin_decode.no_vin', 'decode; no VIN on the vehicle record', 'a decode row with no current VIN'),
  ('establishment_basis', 'independent.readings', 'independent photo readings agree', 'two or more photos, two or more families'),
  ('establishment_basis', 'independent.mixed', 'photo readings and listing text agree', 'independent sources, some text only'),
  ('establishment_basis', 'independent.claims', 'independent listing texts agree; no photo read or paper',
   'two or more text sources from two or more families')
ON CONFLICT (domain, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.establishment_basis(p_classes text[], p_vin_basis text, p_sources int, p_families int)
RETURNS jsonb LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object('code', x.code, 'label', coalesce(vl.label, x.code), 'vin', x.vin,
           'sources', p_sources, 'source_families', p_families,
           'rule', 'establishment_rules/' || e.rule_key || '/' || e.rule_version))
    FROM public.establishment_rules e
   CROSS JOIN LATERAL (
     SELECT CASE WHEN 'derived' = ANY (p_classes) THEN 'derived'
                 WHEN 'receipt' = ANY (p_classes) THEN 'receipt'
                 WHEN 'decode' = ANY (p_classes) THEN 'vin_decode.' || coalesce(p_vin_basis, 'no_vin')
                 WHEN EXISTS (SELECT 1 FROM unnest(p_classes) c WHERE c LIKE 'reading%') AND 'claim' = ANY (p_classes) THEN 'independent.mixed'
                 WHEN EXISTS (SELECT 1 FROM unnest(p_classes) c WHERE c LIKE 'reading%') THEN 'independent.readings'
                 ELSE 'independent.claims' END AS code,
            CASE WHEN NOT (p_classes && '{receipt,derived}') AND 'decode' = ANY (p_classes) THEN coalesce(p_vin_basis, 'no_vin') END AS vin) x
    LEFT JOIN public.vocabulary_labels vl ON vl.domain = 'establishment_basis' AND vl.code = x.code
   WHERE e.rule_key = 'default'
$f$;
REVOKE ALL ON FUNCTION public.establishment_basis(text[], text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.establishment_basis(text[], text, int, int) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.establishment_basis(text[], text, int, int) IS
  'What establishes a value, from its witness classes and the VIN''s standing (vehicle_vin_basis): receipt > '
  'vin_decode.<vin> > independent.{readings|mixed|claims}. Labels: vocabulary_labels domain establishment_basis. 20261124195700.';

-- 4 + 5. the readers --------------------------------------------------------------------------------------------
DO $t$ BEGIN
  IF to_regtype('public._eb_pair') IS NULL THEN CREATE TYPE public._eb_pair AS (a text, r text); END IF;
END $t$;

DO $patch$
DECLARE d text; p public._eb_pair; n int;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid, text)'::regprocedure);
  IF position('establishment_basis_v1' IN d) = 0 THEN
    FOREACH p IN ARRAY ARRAY[
      ROW($a$),
ranked AS (
$a$, $a$),
-- establishment_basis_v1: where the VIN stands, once per call (vehicle_vin_basis)
eb_vin AS MATERIALIZED (SELECT public.vehicle_vin_basis((SELECT v.id FROM v)) AS vin),
ranked AS (
$a$),
      ROW($a$         bool_or(r.cls = 'reading') AS has_reading,
$a$, $a$         bool_or(r.cls = 'reading') AS has_reading,
         array_agg(DISTINCT r.cls) FILTER (WHERE r.cls <> 'record') AS wclasses, /* establishment_basis_v1 */
$a$),
      ROW($a$a.nraw, a.nread, a.nimg, a.nfam_read,
$a$, $a$a.nraw, a.nread, a.nimg, a.nfam_read,
         a.wclasses, a.nind, a.nfam, /* establishment_basis_v1 */
$a$),
      ROW($a$    'agreement', CASE WHEN nread > 0 THEN jsonb_build_object('readings', nread, 'photos', nimg, 'families', nfam_read) END,
$a$, $a$    'agreement', CASE WHEN nread > 0 THEN jsonb_build_object('readings', nread, 'photos', nimg, 'families', nfam_read, 'sources', nind, 'source_families', nfam)
                      WHEN nind > 0 THEN jsonb_build_object('sources', nind, 'source_families', nfam) END,
    -- establishment_basis_v1: what establishes it, from the rule row
    'basis', CASE WHEN status = 'established' THEN public.establishment_basis(wclasses, (SELECT eb.vin FROM eb_vin eb), nind::int, nfam::int) END,
$a$),
      ROW($a$         WHEN x.doc->>'status' <> 'established' THEN to_jsonb(f.needed) END) AS doc
  FROM derived x JOIN defs f ON f.key = x.key
$a$, $a$         WHEN x.doc->>'status' <> 'established' THEN to_jsonb(f.needed) END)
    -- establishment_basis_v1: a derived item is established by its inputs; their basis is on them
    || CASE WHEN x.doc->>'status' = 'established' THEN jsonb_build_object('basis', jsonb_strip_nulls(
         public.establishment_basis('{derived}', NULL, NULL, NULL) || jsonb_build_object('reads', x.doc->'equation'->'reads')))
       ELSE '{}'::jsonb END AS doc
  FROM derived x JOIN defs f ON f.key = x.key
$a$),
      ROW($a$    'needed', CASE WHEN a.status <> 'established' THEN 'photos with camera GPS, or a dated listing location' END) AS doc
$a$, $a$    'needed', CASE WHEN a.status <> 'established' THEN 'photos with camera GPS, or a dated listing location' END,
    -- establishment_basis_v1
    'basis', CASE WHEN a.status = 'established' THEN public.establishment_basis(
      (SELECT array_agg(DISTINCT s->>'class') FROM jsonb_array_elements(a.sources) s WHERE s->>'class' <> 'record'),
      NULL, (SELECT count(*)::int FROM loc_area_sources), NULL) END) AS doc
$a$),
      ROW($a$    'status', CASE WHEN a.area IS NULL THEN 'missing' ELSE a.status END, 'sources', '[]'::jsonb,
$a$, $a$    'status', CASE WHEN a.area IS NULL THEN 'missing' ELSE a.status END, 'sources', '[]'::jsonb,
    -- establishment_basis_v1: the map draws the established area
    'basis', CASE WHEN a.area IS NOT NULL AND a.status = 'established' THEN jsonb_strip_nulls(
      public.establishment_basis('{derived}', NULL, NULL, NULL) || jsonb_build_object('reads', jsonb_build_array('location.current.area'))) END,
$a$)
    ]::public._eb_pair[] LOOP
      n := (length(d) - length(replace(d, p.a, ''))) / length(p.a);
      IF n <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items: anchor found % times: %', n, left(p.a, 70); END IF;
      d := replace(d, p.a, p.r);
    END LOOP;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.vehicle_data_sets(uuid)'::regprocedure);
  IF position('establishment_basis_v1' IN d) = 0 THEN
    FOREACH p IN ARRAY ARRAY[
      ROW($a$DECLARE v_out jsonb;$a$, $a$DECLARE v_out jsonb; v_vin_basis text; /* establishment_basis_v1 */$a$),
      ROW($a$  END IF;
  WITH mine AS ($a$, $a$  END IF;
  v_vin_basis := public.vehicle_vin_basis(p_vehicle_id);
  WITH mine AS ($a$),
      ROW($a$'witnesses', sets.n_witnesses, $a$, $a$'witnesses', sets.n_witnesses, 'basis', CASE WHEN sets.grade = 'established' THEN public.establishment_basis(sets.witness_classes, v_vin_basis, sets.n_witnesses, NULL) END, $a$)
    ]::public._eb_pair[] LOOP
      n := (length(d) - length(replace(d, p.a, ''))) / length(p.a);
      IF n <> 1 THEN RAISE EXCEPTION 'vehicle_data_sets: anchor found % times: %', n, left(p.a, 70); END IF;
      d := replace(d, p.a, p.r);
    END LOOP;
    EXECUTE d;
  END IF;
END $patch$;
DROP TYPE IF EXISTS public._eb_pair;

-- 6. the public gauge -------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS data_set_member_grades_established_idx
  ON public.data_set_member_grades (vehicle_id) INCLUDE (witness_classes) WHERE grade = 'established';

CREATE OR REPLACE FUNCTION public.establishment_basis_gauge()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '8s'
AS $f$
  WITH g AS (
    SELECT g.vehicle_id, g.witness_classes
      FROM public.data_set_member_grades g
      JOIN public.vehicles pv ON pv.id = g.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
     WHERE g.grade = 'established'),
  vb AS (SELECT d.vehicle_id, public.vehicle_vin_basis(d.vehicle_id) AS vin FROM (SELECT DISTINCT g.vehicle_id FROM g) d),
  c AS (SELECT g.vehicle_id, public.establishment_basis(g.witness_classes, vb.vin, NULL, NULL)->>'code' AS code
          FROM g JOIN vb USING (vehicle_id)),
  by_code AS (SELECT c.code, count(*) AS n, count(DISTINCT c.vehicle_id) AS veh FROM c GROUP BY c.code)
  SELECT jsonb_build_object(
    'question', 'How many established set grades rest on a VIN decode whose VIN no photo read or paper witnesses?',
    'established_by_unwitnessed_vin', jsonb_build_object(
       'grades', (SELECT count(*) FROM c WHERE c.code LIKE 'vin\_decode.%' AND c.code <> 'vin_decode.witnessed'),
       'vehicles', (SELECT count(DISTINCT c.vehicle_id) FROM c WHERE c.code LIKE 'vin\_decode.%' AND c.code <> 'vin_decode.witnessed')),
    'established', jsonb_build_object('grades', (SELECT count(*) FROM c), 'vehicles', (SELECT count(DISTINCT c.vehicle_id) FROM c)),
    'established_vehicles_with_witnessed_vin', (SELECT count(*) FROM vb WHERE vb.vin = 'witnessed'),
    'by_basis', (SELECT coalesce(jsonb_object_agg(b.code, jsonb_build_object('grades', b.n, 'vehicles', b.veh)), '{}'::jsonb) FROM by_code b),
    'population', 'public, not deleted vehicles holding an established data set grade (data_set_member_grades)',
    'rule', (SELECT 'establishment_rules/' || e.rule_key || '/' || e.rule_version FROM public.establishment_rules e WHERE e.rule_key = 'default'),
    'counted_at', now())
$f$;
REVOKE ALL ON FUNCTION public.establishment_basis_gauge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.establishment_basis_gauge() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.establishment_basis_gauge() IS
  'Public gauge: established set grades by basis (establishment_basis) and how many rest on an unwitnessed VIN. 20261124195700.';
