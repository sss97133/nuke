-- Disposable PG17: reassembly pieces name the part by its catalog row (labor_part_names_v1), never by receipt text.
-- receipt_item_product_card is stubbed over a fixture table (the live reader needs supplier captures and storage).
-- Builds on the fitted-share contract. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_share.sql
RESET ROLE;

CREATE TABLE public._fixture_cards (item_id uuid PRIMARY KEY, catalog_part_id uuid, name text);
CREATE FUNCTION public.receipt_item_product_card(p_item uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('catalog_part_id', c.catalog_part_id, 'name', c.name, 'part_number', 'PN', 'quote_price', 1)
    FROM public._fixture_cards c WHERE c.item_id = p_item
$$;
-- Seat foam (matched, priced) and the radiator (unmatched, no book hours) have catalog rows; the taillight lenses do not.
INSERT INTO _fixture_cards VALUES
  ('c0000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-000000000001', 'Seat Foam, Front Bucket'),
  ('c0000000-0000-0000-0000-000000000053', 'e0000000-0000-0000-0000-000000000002', 'Radiator, 4 Row');

SET test.auth_role = 'anon';
CREATE TEMP TABLE _names_before AS SELECT public._seg('10000000-0000-0000-0000-000000000001', 'reassembly') AS s;
RESET ROLE;
\ir ../migrations/20261124220000_labor_reassembly_part_names.sql
\ir ../migrations/20261124220000_labor_reassembly_part_names.sql

SET test.auth_role = 'anon';
DO $$
DECLARE s jsonb; b jsonb; seat jsonb; rad jsonb; lens jsonb; stripped jsonb;
BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001')->>'logic_version'
                        = 'vehicle_labor_appraisal/20261124220000.1', 'logic version');
  SELECT _names_before.s INTO b FROM _names_before;
  s := public._seg('10000000-0000-0000-0000-000000000001', 'reassembly');
  SELECT x INTO seat FROM jsonb_array_elements(s#>'{reassembly,matched}') x WHERE x->>'item_id' = 'c0000000-0000-0000-0000-000000000009';
  SELECT x INTO rad FROM jsonb_array_elements(s#>'{reassembly,unmatched}') x WHERE x->>'item_id' = 'c0000000-0000-0000-0000-000000000053';
  SELECT x INTO lens FROM jsonb_array_elements(s#>'{reassembly,matched}') x WHERE x->>'operation_code' = 'ELEC-TAILLIGHTS' LIMIT 1;
  PERFORM public.assert(seat->'part' = '{"catalog_part_id":"e0000000-0000-0000-0000-000000000001","name":"Seat Foam, Front Bucket"}'::jsonb,
    format('matched piece named by its catalog row: %s', seat));
  PERFORM public.assert(rad#>>'{part,name}' = 'Radiator, 4 Row', format('unmatched piece named too: %s', rad));
  PERFORM public.assert(NOT (lens ? 'part'), format('no catalog row, no name: %s', lens));
  PERFORM public.assert(NOT (seat->'part' ? 'part_number') AND NOT (seat->'part' ? 'quote_price'), 'only id and name leave the card');
  -- Nothing else moved.
  SELECT jsonb_set(jsonb_set(s, '{reassembly,matched}', (SELECT jsonb_agg(x - 'part' ORDER BY o) FROM jsonb_array_elements(s#>'{reassembly,matched}') WITH ORDINALITY q(x, o))),
                   '{reassembly,unmatched}', (SELECT jsonb_agg(x - 'part' ORDER BY o) FROM jsonb_array_elements(s#>'{reassembly,unmatched}') WITH ORDINALITY q(x, o)))
    INTO stripped;
  PERFORM public.assert(stripped = b, format('reassembly otherwise unchanged: before %s after %s', b, s));
END $$;
RESET ROLE;
\echo vehicle_labor_appraisal_part_names: ok
