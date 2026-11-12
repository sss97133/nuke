-- Writer gate, fourth piece: a visual_work_v1 record does not carry a number an agent typed.
-- Read on the proof vehicle 2026-11-12 02:27 UTC, 31 current records:
--   21 material lines priced as analyst_range, each with a supplier URL in free text and none
--     of those pages retained (0 in listing_page_snapshots, 0 in catalog_parts.supplier_url);
--   24 labor lines with analyst_range hours and nothing but a sentence behind them;
--   26 records with rate_basis explicit_assumption, a typed hourly rate, while the rate owner
--     resolve_labor_rate() answers from stored rows and says how thin its sample is.
-- Invariant 5: a number is cited from a reader over rows, and an agent's judgment is never
-- seeded into a table. From this migration on:
--   a material analyst_range price cites a stored row: pricing.catalog_part_id (a catalog_parts
--     row whose price_current and currency equal the line's unit price), or
--     pricing.source_snapshot_id (a successful, hashed capture in listing_page_snapshots);
--   a labor line does not use reference.type analyst_range: it cites a labor_operation or a
--     stage_row, or it is unpriced and says so;
--   rate_basis is not explicit_assumption: resolved_default takes the rate owner's answer.
-- Reference and pricing kinds this check does not name are left to the cost fold. Stored rows
-- are not touched or re-checked; the totals they feed change only when a record is rewritten.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

DO $guard$ BEGIN
 IF to_regprocedure('public.visual_work_unsourced_numbers(jsonb)') IS NOT NULL
  OR to_regprocedure('public.visual_work_uncited_keyed_photos(uuid,jsonb)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass
       AND tgname='guard_visual_work_keys_insert' AND NOT tgisinternal)
  OR to_regclass('public.catalog_parts') IS NULL
  OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
       AND table_name='listing_page_snapshots' AND column_name IN ('success','html_sha256'))<>2 THEN
  RAISE EXCEPTION 'visual work key guard owner drifted; inspect current definitions';
 END IF;
END $guard$;

-- What a record states as a number without a stored row behind it. Empty means every number
-- this check knows about is cited.
CREATE FUNCTION public.visual_work_unsourced_numbers(p_doc jsonb)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 WITH mat AS (
  SELECT l.line->'pricing' AS p FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_doc->'materials')='array' THEN p_doc->'materials' ELSE '[]'::jsonb END) l(line)
  WHERE l.line#>>'{pricing,kind}'='analyst_range'),
 unsourced AS (
  SELECT count(*) AS n FROM mat m
  WHERE NOT (coalesce(m.p->>'catalog_part_id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND EXISTS(SELECT 1 FROM public.catalog_parts c WHERE c.id=(m.p->>'catalog_part_id')::uuid
       AND c.price_current IS NOT NULL AND c.currency IS NOT DISTINCT FROM m.p->>'currency'
       AND jsonb_typeof(m.p#>'{unit_price,min}')='number' AND jsonb_typeof(m.p#>'{unit_price,typical}')='number'
       AND jsonb_typeof(m.p#>'{unit_price,max}')='number'
       AND (m.p#>>'{unit_price,min}')::numeric=c.price_current AND (m.p#>>'{unit_price,typical}')::numeric=c.price_current
       AND (m.p#>>'{unit_price,max}')::numeric=c.price_current))
   AND NOT (coalesce(m.p->>'source_snapshot_id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     -- A failed or blocked capture also has a row; only a successful one with a stored hash is a source.
     AND EXISTS(SELECT 1 FROM public.listing_page_snapshots s WHERE s.id=(m.p->>'source_snapshot_id')::uuid
       AND s.success IS TRUE AND s.html_sha256 IS NOT NULL))),
 hours AS (
  SELECT count(*) AS n FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_doc->'operations')='array' THEN p_doc->'operations' ELSE '[]'::jsonb END) l(line)
  WHERE l.line#>>'{reference,type}'='analyst_range')
 SELECT array_remove(ARRAY[
  CASE WHEN (SELECT n FROM unsourced)>0 THEN format('%s material prices with no stored source',(SELECT n FROM unsourced)) END,
  CASE WHEN (SELECT n FROM hours)>0 THEN format('%s labor hour ranges typed as analyst_range',(SELECT n FROM hours)) END,
  CASE WHEN p_doc#>>'{rate_basis,kind}'='explicit_assumption' THEN 'a typed hourly rate (rate_basis explicit_assumption)' END],NULL);
$fn$;
REVOKE ALL ON FUNCTION public.visual_work_unsourced_numbers(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visual_work_unsourced_numbers(jsonb) TO service_role;
COMMENT ON FUNCTION public.visual_work_unsourced_numbers(jsonb) IS
'Numbers a visual_work_v1 record states without a stored row behind them: material analyst_range prices that cite neither a catalog_parts row with the same price and currency (pricing.catalog_part_id) nor a successful, hashed capture (pricing.source_snapshot_id in listing_page_snapshots); labor lines with reference.type analyst_range; and rate_basis explicit_assumption. Empty means every number this check knows about is cited.';

CREATE OR REPLACE FUNCTION public.guard_visual_work_keys()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE missing text[];
BEGIN
 missing:=public.visual_work_unplaced_system_keys(NEW.structured_data);
 IF cardinality(missing)>0 THEN
  -- The writer returns only the message, so the legal moves are in it.
  RAISE EXCEPTION 'unregistered_system_key: %. Use a subject_taxonomy.category already in use, or declare each new key in structured_data.key_proposals as {"kind":"system","key":...,"nearest_existing":<a category in use, or "none">,"reason":...}',
   array_to_string(missing,', ') USING ERRCODE='23514';
 END IF;
 missing:=public.visual_work_unplaced_part_keys(NEW.structured_data);
 IF cardinality(missing)>0 THEN
  RAISE EXCEPTION 'unregistered_part_key: %. Every materials and operations line needs part_key, the part of the vehicle it is about: a subject_taxonomy.subject_key in use (the keyed photo claims on this vehicle use the same keys in structured_data.part_key), "not_a_part" for a consumable or a charge, "cannot_tell", or a new key declared in structured_data.key_proposals as {"kind":"part","key":...,"nearest_existing":<a subject_key in use, or "none">,"reason":...}. physical_material_key stays the line id.',
   array_to_string(missing,', ') USING ERRCODE='23514';
 END IF;
 missing:=public.visual_work_uncited_keyed_photos(NEW.vehicle_id,NEW.structured_data);
 IF cardinality(missing)>0 THEN
  RAISE EXCEPTION 'uncited_keyed_claim: photos %. Each of these photos already has keyed claims on this vehicle, or its entry lists an id that is not one. In its visual_sources entry set keyed_claim_ids to the ids of the claims the record relies on (at least one): vehicle_observations rows of this vehicle, not superseded, with descriptor_id or property_id set, joined to the photo through observation_witnesses.image_id. The caption stays.',
   array_to_string(missing,', ') USING ERRCODE='23514';
 END IF;
 missing:=public.visual_work_unsourced_numbers(NEW.structured_data);
 IF cardinality(missing)>0 THEN
  RAISE EXCEPTION 'unsourced_number: %. A number in a work record is cited from a stored row, not typed. Material price: keep pricing.kind analyst_range only with pricing.catalog_part_id (a catalog_parts row whose price_current and currency equal unit_price min, typical and max) or pricing.source_snapshot_id (a successful capture in listing_page_snapshots); otherwise pricing.kind unpriced. Labor hours: reference.type labor_operation or stage_row, or unpriced. Rate: rate_basis.kind resolved_default with a currency and derivation.',
   array_to_string(missing,'; ') USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.guard_visual_work_keys() FROM PUBLIC,anon,authenticated;
COMMIT;
