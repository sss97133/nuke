-- Contract for 20261124195700_establishment_basis (empty disposable PG17). vehicle_facet_items is a stub holding the live
-- anchor text verbatim (its read behaviour is the dry run in the PR); vehicle_data_sets is a small working stub with the
-- live anchors, so its basis is checked for real. Asserts: vehicle_vin_basis per VIN standing (paper witnessed, one photo
-- read photo_supported, listing row listing_text, record only, no VIN NULL, unreadable NULL); establishment_basis codes,
-- labels and rule; both readers patched once; the set basis only on established grades; the gauge counts; idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.evidence_class_rank') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon;
CREATE TABLE public.evidence_class_rank (class text PRIMARY KEY, rank int, is_witness boolean NOT NULL, note text);
INSERT INTO public.evidence_class_rank VALUES ('decode', 0, true, ''), ('receipt', 1, true, ''), ('reading_registered', 2, true, ''),
  ('claim', 3, true, ''), ('reading_unregistered', 4, true, ''), ('mentioned', 5, true, ''), ('record', NULL, false, '');
CREATE TABLE public.vocabulary_labels (domain text, code text, label text CHECK (btrim(label) <> ''), note text, PRIMARY KEY (domain, code));
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, vin text, is_public boolean, deleted_at timestamptz);
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id), field_name text,
  proposed_value text, source_type text, status text, raw_extraction_data jsonb, extraction_context text);
CREATE TABLE public.vehicle_vin_evidence (id bigserial PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles (id), vin_value text, retired_at timestamptz);
CREATE TABLE public.data_set_member_grades (vehicle_id uuid REFERENCES public.vehicles (id), set_id uuid, set_kind text, grade text, witness_classes text[],
  n_witnesses int, PRIMARY KEY (vehicle_id, set_id));
CREATE FUNCTION public.data_set_can_read_vehicle(p_vehicle uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle AND v.is_public AND v.deleted_at IS NULL) $f$;

INSERT INTO public.vehicles VALUES
 ('00000000-0000-0000-0000-00000000000a', '2W87Z3N100001', true, NULL),   -- VIN on paper
 ('00000000-0000-0000-0000-00000000000b', '2W87Z3N100002', true, NULL),   -- VIN read on one photo
 ('00000000-0000-0000-0000-00000000000c', '2W87Z3N100003', true, NULL),   -- VIN in a listing row
 ('00000000-0000-0000-0000-00000000000d', '2W87Z3N100004', true, NULL),   -- VIN on the record only (decode rows only)
 ('00000000-0000-0000-0000-00000000000e', NULL, true, NULL),              -- no VIN
 ('00000000-0000-0000-0000-00000000000f', '2W87Z3N100006', false, NULL);  -- not public
-- fixtures: field_evidence and listing rows the VIN standing reads (disposable database only)
INSERT INTO public.field_evidence (vehicle_id, field_name, proposed_value, source_type, status, raw_extraction_data, extraction_context) VALUES
 ('00000000-0000-0000-0000-00000000000a', 'vin', '2w87z3n100001 ', 'invoice', 'accepted', '{}', NULL),
 ('00000000-0000-0000-0000-00000000000b', 'vin', '2W87Z3N100002', 'ai_visual', 'accepted', '{"image_id": "10000000-0000-0000-0000-000000000001"}', NULL),
 ('00000000-0000-0000-0000-00000000000d', 'vin', '2W87Z3N100004', 'gm_vin_chart', 'pending', '{}', NULL),
 ('00000000-0000-0000-0000-00000000000d', 'vin', '2W87Z3N100004', 'invoice', 'accepted', '{}', 'vin_decode_gm_chart_v1 via observation-writer'),
 ('00000000-0000-0000-0000-00000000000f', 'vin', '2W87Z3N100006', 'invoice', 'accepted', '{}', NULL);
INSERT INTO public.vehicle_vin_evidence (vehicle_id, vin_value, retired_at) VALUES
 ('00000000-0000-0000-0000-00000000000c', '2W87Z3N100003', NULL),
 ('00000000-0000-0000-0000-00000000000d', '2W87Z3N100004', now());       -- retired: does not count
INSERT INTO public.data_set_member_grades VALUES
 ('00000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'vin_series', 'established', '{decode}', 1),
 ('00000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'vin_series', 'established', '{decode}', 1),
 ('00000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'vin_engine', 'established', '{decode,claim}', 2),
 ('00000000-0000-0000-0000-00000000000d', gen_random_uuid(), 'trans_type', 'established', '{reading_registered}', 2),
 ('00000000-0000-0000-0000-00000000000d', gen_random_uuid(), 'paint_code', 'supported', '{claim}', 1),
 ('00000000-0000-0000-0000-00000000000f', gen_random_uuid(), 'vin_series', 'established', '{decode}', 1);

CREATE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid, p_dimension text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $function$
SELECT '{}'::jsonb /* live anchor text (after 20261124195300):
),
ranked AS (

         bool_or(r.cls = 'reading') AS has_reading,
a.nraw, a.nread, a.nimg, a.nfam_read,
    'agreement', CASE WHEN nread > 0 THEN jsonb_build_object('readings', nread, 'photos', nimg, 'families', nfam_read) END,
         WHEN x.doc->>'status' <> 'established' THEN to_jsonb(f.needed) END) AS doc
  FROM derived x JOIN defs f ON f.key = x.key
    'needed', CASE WHEN a.status <> 'established' THEN 'photos with camera GPS, or a dated listing location' END) AS doc
    'status', CASE WHEN a.area IS NULL THEN 'missing' ELSE a.status END, 'sources', '[]'::jsonb,
*/
$function$;
CREATE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_vehicle_id IS NULL THEN
    RETURN NULL;
  END IF;
  WITH mine AS (SELECT 1 AS one),
  sets AS (SELECT g.set_kind, g.grade, g.witness_classes, g.n_witnesses FROM public.data_set_member_grades g WHERE g.vehicle_id = p_vehicle_id)
  SELECT jsonb_agg(jsonb_build_object('set_kind', sets.set_kind, 'grade', sets.grade, 'witnesses', sets.n_witnesses, 'one', mine.one) ORDER BY sets.set_kind)
    INTO v_out FROM sets CROSS JOIN mine;
  RETURN v_out;
END
$function$;

\ir ../migrations/20261124195700_establishment_basis.sql
\ir ../migrations/20261124195700_establishment_basis.sql

DO $$
DECLARE d text; j jsonb; g jsonb; n int;
BEGIN
  -- each reader patched once
  d := pg_get_functiondef('public.vehicle_facet_items(uuid, text)'::regprocedure);
  n := (length(d) - length(replace(d, 'establishment_basis_v1', ''))) / length('establishment_basis_v1');
  IF n <> 7 THEN RAISE EXCEPTION 'vehicle_facet_items: % markers, want 7 (one per anchor)', n; END IF;
  d := pg_get_functiondef('public.vehicle_data_sets(uuid)'::regprocedure);
  n := (length(d) - length(replace(d, 'establishment_basis_v1', ''))) / length('establishment_basis_v1');
  IF n <> 1 THEN RAISE EXCEPTION 'vehicle_data_sets: % markers, want 1', n; END IF;

  -- where the VIN stands
  IF public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000a') IS DISTINCT FROM 'witnessed' THEN RAISE EXCEPTION 'paper VIN: %', public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000a'); END IF;
  IF public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000b') IS DISTINCT FROM 'photo_supported' THEN RAISE EXCEPTION 'one photo read: %', public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000b'); END IF;
  IF public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000c') IS DISTINCT FROM 'listing_text' THEN RAISE EXCEPTION 'listing row: %', public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000c'); END IF;
  IF public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000d') IS DISTINCT FROM 'record_only' THEN RAISE EXCEPTION 'decode rows + retired listing: %', public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000d'); END IF;
  IF public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000e') IS NOT NULL THEN RAISE EXCEPTION 'no VIN must be NULL'; END IF;
  IF public.vehicle_vin_basis('00000000-0000-0000-0000-00000000000f') IS NOT NULL THEN RAISE EXCEPTION 'unreadable vehicle must be NULL'; END IF;

  -- the basis codes, from the rule row
  IF public.establishment_basis('{decode}', 'listing_text', 1, 1)->>'code' <> 'vin_decode.listing_text'
     OR public.establishment_basis('{decode}', 'listing_text', 1, 1)->>'label' <> 'VIN decode; VIN from listing text, unwitnessed'
     OR public.establishment_basis('{decode}', 'listing_text', 1, 1)->>'rule' <> 'establishment_rules/default/1'
     OR public.establishment_basis('{decode}', 'listing_text', 1, 1)->>'vin' <> 'listing_text' THEN
    RAISE EXCEPTION 'decode basis: %', public.establishment_basis('{decode}', 'listing_text', 1, 1); END IF;
  IF public.establishment_basis('{decode,receipt}', 'listing_text', 2, 2)->>'code' <> 'receipt'
     OR public.establishment_basis('{decode,receipt}', 'listing_text', 2, 2) ? 'vin' THEN RAISE EXCEPTION 'paper outranks the decode'; END IF;
  IF public.establishment_basis('{decode}', NULL, 1, 1)->>'code' <> 'vin_decode.no_vin' THEN RAISE EXCEPTION 'decode without VIN'; END IF;
  IF public.establishment_basis('{claim}', NULL, 2, 2)->>'code' <> 'independent.claims' THEN RAISE EXCEPTION 'claims'; END IF;
  IF public.establishment_basis('{claim,reading}', NULL, 3, 2)->>'code' <> 'independent.mixed' THEN RAISE EXCEPTION 'mixed'; END IF;
  IF public.establishment_basis('{reading_registered}', NULL, 2, 2)->>'code' <> 'independent.readings' THEN RAISE EXCEPTION 'readings'; END IF;
  IF public.establishment_basis('{derived}', NULL, NULL, NULL)->>'code' <> 'derived' THEN RAISE EXCEPTION 'derived'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['derived', 'receipt', 'vin_decode.witnessed', 'vin_decode.photo_supported', 'vin_decode.listing_text',
               'vin_decode.record_only', 'vin_decode.no_vin', 'independent.readings', 'independent.mixed', 'independent.claims']) c
              WHERE NOT EXISTS (SELECT 1 FROM public.vocabulary_labels l WHERE l.domain = 'establishment_basis' AND l.code = c)) THEN
    RAISE EXCEPTION 'a basis code has no label'; END IF;

  -- the set grade reader: basis on established grades only, everything else unchanged
  j := public.vehicle_data_sets('00000000-0000-0000-0000-00000000000d');
  IF (SELECT count(*) FROM jsonb_array_elements(j) s WHERE s ? 'basis' AND s->'basis' <> 'null') <> 1
     OR (SELECT s->'basis'->>'code' FROM jsonb_array_elements(j) s WHERE s->>'set_kind' = 'trans_type') <> 'independent.readings' THEN
    RAISE EXCEPTION 'vehicle_data_sets d: %', j; END IF;
  j := public.vehicle_data_sets('00000000-0000-0000-0000-00000000000c');
  IF (SELECT s->'basis'->>'code' FROM jsonb_array_elements(j) s WHERE s->>'set_kind' = 'vin_engine') <> 'vin_decode.listing_text' THEN
    RAISE EXCEPTION 'vehicle_data_sets c: %', j; END IF;
  IF (SELECT s->>'one' FROM jsonb_array_elements(j) s LIMIT 1) <> '1' THEN RAISE EXCEPTION 'reader body lost: %', j; END IF;

  -- the gauge: public vehicles only (f is not public), 4 established grades on 3 vehicles, 3 on an unwitnessed VIN
  g := public.establishment_basis_gauge();
  IF (g->'established'->>'grades')::int <> 4 OR (g->'established'->>'vehicles')::int <> 3
     OR (g->'established_by_unwitnessed_vin'->>'grades')::int <> 2 OR (g->'established_by_unwitnessed_vin'->>'vehicles')::int <> 1
     OR (g->>'established_vehicles_with_witnessed_vin')::int <> 1
     OR (g->'by_basis'->'vin_decode.witnessed'->>'grades')::int <> 1
     OR (g->'by_basis'->'independent.readings'->>'grades')::int <> 1 THEN
    RAISE EXCEPTION 'gauge: %', g; END IF;

  -- the rule row refuses a class that is not a witness class
  BEGIN
    UPDATE public.establishment_rules SET establish_alone = '{record}' WHERE rule_key = 'default';
    RAISE EXCEPTION 'rule row accepted a non-witness class';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
\echo establishment_basis: ok
