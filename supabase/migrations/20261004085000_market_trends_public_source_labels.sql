-- Repair the protected-registry lookup of the existing public market-trends reader.
-- Only the canonical source identity/label is projected; operator RLS remains unchanged.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

CREATE VIEW public.v_market_trend_source_labels
WITH (security_barrier=true,security_invoker=false) AS
SELECT sr.id,sr.slug,sr.display_name FROM public.source_registry sr
WHERE sr.slug='bringatrailer';
-- Supabase default table/view privileges can include DML. This projection is SELECT only.
REVOKE ALL ON public.v_market_trend_source_labels FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v_market_trend_source_labels TO anon,authenticated,service_role;
COMMENT ON VIEW public.v_market_trend_source_labels IS
  'Read-only public source label projection for existing get_market_trends: only canonical registered bringatrailer id/slug/display_name. Intentional owner-mediated three-field projection with security barrier and SELECT-only grants; no operator fields, status/freshness claim, source_registry policy/grant change or new canonical source table.';

DO $repair$
DECLARE target oid:='public.get_market_trends(jsonb)'::regprocedure;
  definition text; body text;
  old_lookup text:=$lookup$SELECT id,slug,display_name,extractor_function INTO source_row FROM public.source_registry WHERE slug='bringatrailer';$lookup$;
  new_lookup text:=$lookup$SELECT id,slug,display_name,NULL::text AS extractor_function INTO source_row FROM public.v_market_trend_source_labels WHERE slug='bringatrailer';$lookup$;
  old_receipt text:=$receipt$'observed_writer','extract-bat-core','writer_registry_match',source_row.extractor_function='extract-bat-core',$receipt$;
  new_receipt text:=$receipt$'observed_writer','extract-bat-core','writer_registry_match',source_row.extractor_function='extract-bat-core',
      'registry_metadata_visibility','public_identity_label_only','registry_declared_extractor_visibility','protected_unavailable',$receipt$;
BEGIN
  SELECT pg_get_functiondef(p.oid),p.prosrc INTO definition,body FROM pg_proc p
  WHERE p.oid=target AND NOT p.prosecdef
    AND p.proconfig @> ARRAY['search_path=public, pg_temp','statement_timeout=5s','TimeZone=UTC'];
  IF definition IS NULL OR encode(sha256(convert_to(body,'UTF8')),'base64')<>'MF6SqMAqbiMcwJ1a+ZoT/+eIgBanD9LBlVQrBRQ7uFA='
    OR strpos(body,old_lookup)=0 OR strpos(body,old_receipt)=0 THEN
    RAISE EXCEPTION 'Expected reviewed market-trends invoker body/config before public label repair';
  END IF;
  -- CREATE OR REPLACE preserves existing owner/ACL. Exact guarded substitutions leave
  -- all candidate/member/privacy/clock/cap/legacy behavior and signatures unchanged.
  EXECUTE replace(replace(definition,old_lookup,new_lookup),old_receipt,new_receipt);
END;
$repair$;

SELECT count(*) AS lock_waiters FROM pg_stat_activity WHERE wait_event_type='Lock';
COMMIT;
