-- Invoices reach their parties only; contact details in listing text are withheld from readers outside the vehicle.
--
-- A content audit of free-form columns anon or authenticated can read (2026-10-19: 1,290 columns on 690 relations,
-- up to 300 visible rows each, sampled as anon and as a fresh signed-in account, counts only) found:
--   1. generated_invoices (8 invoices: amounts, payment status, html_content with the client's details, notes, payment
--      token column): every row readable by any signed-in account (allow_authenticated_read_generated_invoices, true).
--      Readers: InvoiceManager, VehicleTimeline (invoice badges by event), ComprehensiveWorkOrderReceipt (draft by
--      event), all for the people on the work.
--   2. vehicles.description: 5.5% of anon-visible listing descriptions carry a phone number (82 of 1,500; classiccars.com
--      and eBay Motors dealer lines, some Craigslist private sellers) and 0.9% an e-mail address; origin_metadata carries
--      private (consumer-domain) e-mail addresses in 0.13%. vehicle_row_read and get_vehicle_profile_data return them to
--      every viewer. The listing text is testimony and stays as captured.
--
-- After:
--   * generated_invoices is read by its creator, its technician, the parties of its work order
--     (work_order_is_accessible), insiders of its event's vehicle (vehicle_user_has_access), staff and owners of its
--     business, and the creator of its client record.
--   * text_redact_contact(text) replaces e-mail addresses and phone numbers (the work_order_text_is_personal phone
--     pattern, starting at a word boundary and not followed by a digit) with "[contact through Nuke]". vehicle_row_public_projection(jsonb) is the
--     outsider view of a vehicles row: the five private keys nulled as before, description redacted, e-mail addresses
--     in origin_metadata redacted. vehicle_row_read and get_vehicle_profile_data use it for viewers who are not
--     insiders; insiders see the row as captured.
-- Contract: supabase/sql/test_invoice_party_reads_and_description_redaction.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
DECLARE v_inv text; v_row text; v_profile text;
BEGIN
  SELECT string_agg(polname || ':' || polcmd::text || ':' || coalesce(pg_get_expr(polqual, polrelid), ''), ';' ORDER BY polname)
    INTO v_inv FROM pg_policy WHERE polrelid = 'public.generated_invoices'::regclass;
  IF v_inv IS DISTINCT FROM 'allow_authenticated_read_generated_invoices:r:true' AND v_inv NOT LIKE 'generated_invoices_party_read:r:%' THEN
    RAISE EXCEPTION 'generated_invoices policies drifted from the 2026-10-19 read: %', v_inv;
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v_row FROM pg_proc WHERE oid = to_regprocedure('public.vehicle_row_read(uuid)');
  SELECT prosrc INTO v_profile FROM pg_proc WHERE oid = to_regprocedure('public.get_vehicle_profile_data(uuid)');
  IF v_row IS DISTINCT FROM 'v9AyXs0bf7DTqHbonvDuxagChbclcplB6b9/1rAxKi0=' AND v_row IS DISTINCT FROM 'OfecuDAROe7a+p0OybLnO8kgSE3BFJwRbfRAHVi0x5U=' THEN
    RAISE EXCEPTION 'vehicle_row_read differs from the 2026-10-19 read (%)', v_row;
  END IF;
  IF encode(sha256(convert_to(v_profile, 'UTF8')), 'base64') <> 'gSQbPpb2Dl/WWZOVuJSS1CSCv74x/KPF05NwPf8FI1s='
     AND position('vehicle_row_public_projection' IN v_profile) = 0 THEN
    RAISE EXCEPTION 'get_vehicle_profile_data differs from the 2026-10-19 read';
  END IF;
END $guard$;

-- 1. Invoices: parties only.
DROP POLICY IF EXISTS allow_authenticated_read_generated_invoices ON public.generated_invoices;
DROP POLICY IF EXISTS generated_invoices_party_read ON public.generated_invoices;
CREATE POLICY generated_invoices_party_read ON public.generated_invoices
  FOR SELECT TO authenticated
  USING (
    created_by = (SELECT auth.uid()) OR technician_id = (SELECT auth.uid())
    OR (work_order_id IS NOT NULL AND public.work_order_is_accessible(work_order_id))
    OR EXISTS (SELECT 1 FROM public.timeline_events te
               WHERE te.id = generated_invoices.event_id AND public.vehicle_user_has_access(te.vehicle_id, (SELECT auth.uid())))
    OR (business_id IS NOT NULL AND (
         EXISTS (SELECT 1 FROM public.organization_contributors oc
                 WHERE oc.organization_id = generated_invoices.business_id AND oc.user_id = (SELECT auth.uid())
                   AND oc.status = 'active' AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee'))
         OR EXISTS (SELECT 1 FROM public.business_ownership bo
                    WHERE bo.business_id = generated_invoices.business_id AND bo.owner_id = (SELECT auth.uid()) AND bo.status = 'active')))
    OR (client_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clients c
                                          WHERE c.id = generated_invoices.client_id AND c.created_by = (SELECT auth.uid()))));

-- 2. Contact details in listing text, withheld from outsiders.
CREATE OR REPLACE FUNCTION public.text_redact_contact(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT regexp_replace(regexp_replace(p_text,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g'),
    '(\(\d{3}\)|\m\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])', '[contact through Nuke]', 'g')
$$;
COMMENT ON FUNCTION public.text_redact_contact(text) IS
  'Replaces e-mail addresses and phone numbers with "[contact through Nuke]". Phone pattern: work_order_text_is_personal''s, starting at a word boundary and not followed by a digit. Mirrored by scripts/guardrails/no-pii-exposure.mjs (content mode).';

CREATE OR REPLACE FUNCTION public.vehicle_row_public_projection(p_row jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(m.j -> 'description') = 'string'
              THEN jsonb_set(m.j, '{description}', to_jsonb(public.text_redact_contact(m.j ->> 'description')))
              ELSE m.j END
  FROM (SELECT CASE WHEN jsonb_typeof(r.j -> 'origin_metadata') IN ('object', 'array')
                    THEN jsonb_set(r.j, '{origin_metadata}', regexp_replace((r.j -> 'origin_metadata')::text,
                           '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g')::jsonb)
                    ELSE r.j END AS j
        FROM (SELECT public.jsonb_mask_keys(p_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact']) AS j) r) m
$$;
COMMENT ON FUNCTION public.vehicle_row_public_projection(jsonb) IS
  'A vehicles row as an outsider reads it: owner and purchase keys nulled, contact details redacted from description and from e-mail addresses in origin_metadata.';
GRANT EXECUTE ON FUNCTION public.text_redact_contact(text), public.vehicle_row_public_projection(jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_public boolean;
  v_insider boolean;
BEGIN
  SELECT to_jsonb(v.*),
         coalesce(v.is_public, false),
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  RETURN public.vehicle_row_public_projection(v_row);
END;
$function$;

DO $edit$
DECLARE def text; anchor text; n integer;
BEGIN
  def := pg_get_functiondef('public.get_vehicle_profile_data(uuid)'::regprocedure);
  IF position('vehicle_row_public_projection' IN def) > 0 THEN RETURN; END IF;
  anchor := $a$ELSE public.jsonb_mask_keys(to_jsonb(v.*), ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact'])::json END$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'get_vehicle_profile_data: anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, $r$ELSE public.vehicle_row_public_projection(to_jsonb(v.*))::json END$r$);
END $edit$;

COMMIT;
