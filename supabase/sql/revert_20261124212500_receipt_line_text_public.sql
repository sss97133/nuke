-- Revert 20261124212500_receipt_line_text_public: the two readers return line text and performer as read to every
-- caller again. Re-opens what the migration closed; run only to back the change out.
SET statement_timeout = '60s';
SET lock_timeout = '5s';

DO $revert$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure);
  d := replace(d, 'public.receipt_line_text_for_viewer(public.receipt_line_strip_list_price(x.description), false)',
                  'public.receipt_line_strip_list_price(x.description)');
  IF position('receipt_line_text_for_viewer' IN d) > 0 THEN RAISE EXCEPTION 'vehicle_build_reconstruction: unexpected wrapper left'; END IF;
  EXECUTE d;
  d := pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure);
  d := replace(d, '''description'', public.receipt_line_text_for_viewer(i.description, (SELECT tied FROM gate)),', '''description'', i.description,');
  d := replace(d, '''performer'', CASE WHEN (SELECT tied FROM gate) THEN i.performer END,', '''performer'', i.performer,');
  IF position('receipt_line_text_for_viewer' IN d) > 0 THEN RAISE EXCEPTION 'get_vehicle_day_documents: unexpected wrapper left'; END IF;
  EXECUTE d;
END
$revert$;
DROP FUNCTION IF EXISTS public.receipt_line_text_for_viewer(text, boolean);
