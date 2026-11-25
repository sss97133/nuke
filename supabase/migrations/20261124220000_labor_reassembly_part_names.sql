-- labor_part_names_v1: reassembly pieces name the part by its catalog key, never by the private receipt line text.
--
-- WHY. vehicle_labor_appraisal listed fitted reassembly pieces by receipt item id only, so the profile could not say
-- what was fitted without reading private line text. Measured live 2026-11-24 on the proof vehicle: 30 of 31 pieces
-- (7 of 7 priced, 23 of 24 without book hours) resolve to a catalog_parts row through the existing reader
-- receipt_item_product_card (supplier + part number, retained supplier capture only).
--
-- WHAT CHANGES. Each reassembly matched / unmatched piece carries part: {catalog_part_id, name} from
-- receipt_item_product_card, or no part key when the line has no retained catalog row. No receipt text, price, vendor
-- or date is added. Grain: piece (receipt_items.id) -> catalog_parts.id (computed edge; receipt_items holds no FK to
-- catalog_parts, that is the debt). Recompute: per read; a supplier capture landing names the piece on the next read.
-- Test: supabase/sql/test_vehicle_labor_appraisal_part_names.sql (PG17).
--
-- REVERT. Redefine the function without labor_part_names_v1 (restore the anchor below).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261124214500.1';
$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261124220000.1';
$r$;
  a_list text := $a$          'matched', pieces_matched,
          'unmatched', pieces_unmatched
$a$;
  r_list text := $r$          -- labor_part_names_v1: the catalog row's id and name, never the receipt line's words
          'matched', (SELECT coalesce(jsonb_agg(rp.x || CASE WHEN rc.card IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('part',
                                jsonb_build_object('catalog_part_id', rc.card->'catalog_part_id', 'name', rc.card->'name')) END
                              ORDER BY rp.ord), '[]'::jsonb)
                        FROM jsonb_array_elements(pieces_matched) WITH ORDINALITY AS rp(x, ord)
                        LEFT JOIN LATERAL (SELECT public.receipt_item_product_card(nullif(rp.x->>'item_id', '')::uuid) AS card) rc ON true),
          'unmatched', (SELECT coalesce(jsonb_agg(rp.x || CASE WHEN rc.card IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('part',
                                  jsonb_build_object('catalog_part_id', rc.card->'catalog_part_id', 'name', rc.card->'name')) END
                                ORDER BY rp.ord), '[]'::jsonb)
                          FROM jsonb_array_elements(pieces_unmatched) WITH ORDINALITY AS rp(x, ord)
                          LEFT JOIN LATERAL (SELECT public.receipt_item_product_card(nullif(rp.x->>'item_id', '')::uuid) AS card) rc ON true)
$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_part_names_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_fitted_share_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261124214500; rebase this migration';
  END IF;
  anchors := ARRAY[a_ver, a_list];
  repls := ARRAY[r_ver, r_list];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor part names anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;
