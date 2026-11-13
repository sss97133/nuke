-- Inventory tenure and ownership/title are independent account statements.
-- Extend the existing private correction writer; preserve its authentication,
-- explicit service authorization, idempotency and named supersession contract.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.record_garage_owner_correction(uuid,uuid,uuid,jsonb,text,text,uuid)'::regprocedure);
  old_count text := '(SELECT count(*) FROM jsonb_object_keys(claim))<>6';
  old_keys text := 'ARRAY[''roles'',''ownership_denied'',''title_status'',''disputed'',''start_date'',''end_date'']';
  marker text := '    FOR role_name IN SELECT jsonb_array_elements_text(claim->''roles'') LOOP';
BEGIN
  IF (length(definition)-length(replace(definition,old_count,'')))/length(old_count) <> 1
    OR (length(definition)-length(replace(definition,old_keys,'')))/length(old_keys) <> 1
    OR (length(definition)-length(replace(definition,marker,'')))/length(marker) <> 1 THEN
    RAISE EXCEPTION 'garage correction writer differs from reviewed validation';
  END IF;
  definition := replace(definition,old_count,
    '(SELECT count(*) FROM jsonb_object_keys(claim)) NOT IN (6,7) OR NOT claim ?& ' || old_keys);
  definition := replace(definition,'WHERE NOT k=ANY(' || old_keys || ')',
    'WHERE NOT k=ANY(ARRAY[''roles'',''ownership_denied'',''title_status'',''disputed'',''start_date'',''end_date'',''inventory_status''])');
  definition := replace(definition,marker,$validation$
    IF claim ? 'inventory_status' AND (jsonb_typeof(claim->'inventory_status') IS DISTINCT FROM 'string'
        OR claim->>'inventory_status' NOT IN ('current','previous','unknown')) THEN
      RAISE EXCEPTION 'inventory status must be current, previous or unknown' USING ERRCODE='23514';
    END IF;
$validation$ || marker);
  EXECUTE definition;
END $migration$;
COMMIT;
