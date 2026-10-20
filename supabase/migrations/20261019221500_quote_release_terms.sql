-- Release terms on quotes. A quote may declare when payment may be released (THEORY decision 7: predicates declared at
-- acceptance, evaluated over evidence). Nothing here moves or authorizes money.
--
--   issue_work_order_quote gains p_release_conditions jsonb DEFAULT NULL (trailing; existing calls unchanged). Vocabulary:
--     customer_completion_sign            the customer's completion acceptance Sign (accept_work_completion)
--     inspector_attestation               findings recorded on an inspection of this job after the quote acceptance
--     installed_parts_witness             an authenticated supporting delivery attestation on this work order
--     photos_in_window                    attached job evidence (attach_job_evidence) captured inside the job window
--     {kind: days_signed, days: 1..90}    that many days since the customer's completion acceptance
--     Given as kind strings or {kind[, days]} objects; normalized to sorted objects, at most one per kind.
--   The quote projector stores them in work_order_quote_release_terms (immutable, one row per quote) and folds them into
--   quote_hash only when present, so quotes without terms keep their exact hash and request key. A change order
--   (issue_change_order) carries its base quote's terms.
--   work_order_release_evaluation uses the accepted quote's declared terms when present (plus quote acceptance, invoice
--     current and invoice settled), else the platform standard predicates; declared_by says which.
-- issue_work_order_quote and project_work_order_quote_event (QUOTE lane) are patched in place on their live definitions
-- at anchors that must each occur once. Contract: supabase/sql/test_quote_release_terms.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_quote_release_terms (
  quote_id uuid PRIMARY KEY REFERENCES public.work_order_quotes(id) ON DELETE RESTRICT,
  conditions jsonb NOT NULL CHECK (jsonb_typeof(conditions) = 'array' AND jsonb_array_length(conditions) BETWEEN 1 AND 5),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.work_order_quote_release_terms IS 'Release conditions a quote version declares (normalized vocabulary), captured in its quote_hash. Immutable. Writer: project_work_order_quote_event.';
ALTER TABLE public.work_order_quote_release_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_quote_release_terms FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.work_order_quote_release_terms TO service_role;
CREATE POLICY release_terms_service_read ON public.work_order_quote_release_terms FOR SELECT TO service_role USING (true);
CREATE TRIGGER release_terms_immutable BEFORE UPDATE OR DELETE ON public.work_order_quote_release_terms
  FOR EACH ROW EXECUTE FUNCTION public.work_order_lifecycle_immutable();
CREATE TRIGGER release_terms_no_truncate BEFORE TRUNCATE ON public.work_order_quote_release_terms
  FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_lifecycle_immutable();

CREATE FUNCTION public.work_order_release_terms_normalize(p_terms jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE t jsonb; res jsonb := '[]'::jsonb; k text; seen text[] := '{}';
BEGIN
  IF p_terms IS NULL OR p_terms = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_terms) <> 'array' OR jsonb_array_length(p_terms) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Release conditions must be an array of 1 to 5 conditions' USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(p_terms) LOOP
    IF jsonb_typeof(t) = 'string' THEN t := jsonb_build_object('kind', t #>> '{}'); END IF;
    k := t->>'kind';
    IF jsonb_typeof(t) <> 'object' OR k IS NULL
      OR k NOT IN ('customer_completion_sign','inspector_attestation','installed_parts_witness','photos_in_window','days_signed')
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(t) x WHERE x NOT IN ('kind','days'))
      OR (k = 'days_signed') <> (t ? 'days')
      OR (k = 'days_signed' AND (jsonb_typeof(t->'days') <> 'number' OR (t->>'days') !~ '^[0-9]+$' OR (t->>'days')::int NOT BETWEEN 1 AND 90)) THEN
      RAISE EXCEPTION 'Unknown or malformed release condition: %', t USING ERRCODE = '22023';
    END IF;
    IF k = ANY (seen) THEN RAISE EXCEPTION 'Release condition % declared twice', k USING ERRCODE = '22023'; END IF;
    seen := seen || k;
    res := res || jsonb_build_array(CASE WHEN k = 'days_signed' THEN jsonb_build_object('kind', k, 'days', (t->>'days')::int) ELSE jsonb_build_object('kind', k) END);
  END LOOP;
  RETURN (SELECT jsonb_agg(x ORDER BY x->>'kind') FROM jsonb_array_elements(res) x);
END $$;

CREATE FUNCTION public.work_order_release_terms_hash_part(p_terms jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_terms IS NULL OR p_terms = 'null'::jsonb THEN '{}'::jsonb
    ELSE jsonb_build_object('release_conditions', public.work_order_release_terms_normalize(p_terms)) END
$$;

CREATE FUNCTION public.record_work_order_quote_release_terms(p_quote_id uuid, p_terms jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_terms IS NULL OR p_terms = 'null'::jsonb THEN RETURN; END IF;
  INSERT INTO public.work_order_quote_release_terms(quote_id, conditions)
  VALUES (p_quote_id, public.work_order_release_terms_normalize(p_terms)) ON CONFLICT (quote_id) DO NOTHING;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['work_order_release_terms_normalize(jsonb)','work_order_release_terms_hash_part(jsonb)','record_work_order_quote_release_terms(uuid,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- Terms a quote version carries: its own, else (for a change order) its base quote's.
CREATE FUNCTION public.work_order_quote_effective_release_terms(p_terms jsonb, p_change_order_base uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_terms IS NOT NULL AND p_terms <> 'null'::jsonb THEN public.work_order_release_terms_normalize(p_terms)
    ELSE (SELECT rt.conditions FROM public.work_order_quote_release_terms rt WHERE rt.quote_id = p_change_order_base) END
$$;
REVOKE ALL ON FUNCTION public.work_order_quote_effective_release_terms(jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_quote_effective_release_terms(jsonb,uuid) TO service_role;

-- Quote projector (live 20261019213000 definition): terms into the hash (only when present) and into their table.
DO $apply$
DECLARE
  def text := pg_get_functiondef('public.project_work_order_quote_event(uuid)'::regprocedure);
  a1 constant text := $a$|| CASE WHEN co_stored IS NOT NULL THEN jsonb_build_object('change_order',co_stored) ELSE '{}'::jsonb END)::text,'UTF8')),'hex');$a$;
  a2 constant text := $a$(e->>'valid_until')::timestamptz,hash,co_stored);$a$;
  terms constant text := $t$public.work_order_quote_effective_release_terms(e->'release_conditions', CASE WHEN co_stored IS NOT NULL THEN cur.id END)$t$;
  a text;
BEGIN
  IF position('work_order_release_terms_hash_part' IN def) > 0 THEN RAISE EXCEPTION 'quote projector already carries release terms'; END IF;
  FOREACH a IN ARRAY ARRAY[a1, a2] LOOP
    IF (length(def) - length(replace(def, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'quote projector anchor not found once: %', a; END IF;
  END LOOP;
  def := replace(def, a1, $r$|| CASE WHEN co_stored IS NOT NULL THEN jsonb_build_object('change_order',co_stored) ELSE '{}'::jsonb END
      || public.work_order_release_terms_hash_part($r$ || terms || $r$))::text,'UTF8')),'hex');$r$);
  def := replace(def, a2, a2 || E'\n    PERFORM public.record_work_order_quote_release_terms(o.id, ' || terms || ');');
  EXECUTE def;
END $apply$;

-- issue_work_order_quote: trailing p_release_conditions, into the request key (only when present) and the envelope.
DO $apply$
DECLARE
  def text := pg_get_functiondef('public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid)'::regprocedure);
  a1 constant text := $a$p_supersedes_quote_id uuid DEFAULT NULL::uuid)$a$;
  a2 constant text := $a$p_valid_until)::text);$a$;
  a3 constant text := $a$'valid_until',p_valid_until,'issued_by_role',issuer_role,$a$;
  a text;
BEGIN
  FOREACH a IN ARRAY ARRAY[a1, a2, a3] LOOP
    IF (length(def) - length(replace(def, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'issue_work_order_quote anchor not found once: %', a; END IF;
  END LOOP;
  def := replace(def, a1, $r$p_supersedes_quote_id uuid DEFAULT NULL::uuid, p_release_conditions jsonb DEFAULT NULL::jsonb)$r$);
  def := replace(def, a2, $r$p_valid_until)::text || COALESCE(public.work_order_release_terms_normalize(p_release_conditions)::text, ''));$r$);
  def := replace(def, a3, $r$'valid_until',p_valid_until,'release_conditions',public.work_order_release_terms_normalize(p_release_conditions),'issued_by_role',issuer_role,$r$);
  DROP FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid);
  EXECUTE def;
END $apply$;
REVOKE ALL ON FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid,jsonb) TO authenticated;
COMMENT ON FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid,jsonb) IS 'Sign: an eligible provider issues the next quote version (lines, scope snapshot, deposit request, validity) with optional release conditions captured in the quote hash. No payment, no messaging.';

CREATE OR REPLACE FUNCTION public.work_order_release_evaluation(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  qs jsonb := public.work_order_quote_state(p_work_order_id);
  comp jsonb := public.work_order_completion_overlay(p_work_order_id, '{}'::jsonb);
  inv public.work_order_invoices%ROWTYPE;
  rec jsonb := public.work_order_invoice_reconciliation(p_work_order_id);
  accepted boolean := qs#>>'{acceptance,state}' = 'accepted';
  accepted_at timestamptz := (qs#>>'{acceptance,signed_at}')::timestamptz;
  terms jsonb;
  t jsonb;
  win jsonb;
  ref text;
  declared jsonb := '[]'::jsonb;
  conditions jsonb;
  acc_at timestamptz := (comp#>>'{customer_acceptance_sign,signed_at}')::timestamptz;
BEGIN
  SELECT * INTO inv FROM public.work_order_current_invoice(p_work_order_id);
  IF accepted THEN
    SELECT rt.conditions INTO terms FROM public.work_order_quote_release_terms rt WHERE rt.quote_id = (qs#>>'{acceptance,quote_id}')::uuid;
  END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(COALESCE(terms, '[]'::jsonb)) LOOP
    ref := NULL;
    IF t->>'kind' = 'customer_completion_sign' THEN
      ref := CASE WHEN comp->>'customer_acceptance' = 'established' THEN 'completion_acceptance:' || (comp#>>'{customer_acceptance_sign,acceptance_id}') END;
    ELSIF t->>'kind' = 'inspector_attestation' THEN
      SELECT 'inspection_findings:' || o.id INTO ref FROM public.work_orders c
        JOIN public.vehicle_observations o ON o.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'owner-input')
          AND o.source_identifier = 'inspection_findings:' || c.id::text AND o.kind = 'work_record' AND o.is_superseded IS FALSE
          AND o.extraction_method = 'inspection_findings_sign_v1' AND o.vehicle_id = c.vehicle_id
        WHERE (c.parent_work_order_id = p_work_order_id OR (c.id = p_work_order_id AND c.scope_category = 'inspection'))
          AND o.observed_at >= accepted_at
        ORDER BY o.observed_at DESC LIMIT 1;
    ELSIF t->>'kind' = 'installed_parts_witness' THEN
      SELECT 'delivery_attestation:' || a.id INTO ref FROM public.work_order_resource_attestations a
        JOIN public.vehicle_observations s ON s.id = a.id AND s.is_superseded IS FALSE AND s.submitted_by_user_id = a.attestor_user_id
        WHERE a.work_order_id = p_work_order_id AND a.attestation_kind = 'delivery' AND a.verdict = 'supports'
        ORDER BY s.observed_at DESC LIMIT 1;
    ELSIF t->>'kind' = 'photos_in_window' THEN
      win := public.work_order_evidence_window(p_work_order_id);
      SELECT 'evidence_attachment:' || ea.id INTO ref FROM public.work_order_evidence_attachments ea
        JOIN public.vehicle_observations s ON s.id = ea.id AND s.is_superseded IS FALSE
        JOIN public.work_order_evidence_images ei ON ei.attachment_id = ea.id
        JOIN public.vehicle_images vi ON vi.id = ei.image_id
        WHERE ea.work_order_id = p_work_order_id
          AND COALESCE(vi.taken_at, vi.created_at) BETWEEN (win->>'from')::timestamptz AND (win->>'until')::timestamptz
        ORDER BY ea.attached_at DESC LIMIT 1;
    ELSIF t->>'kind' = 'days_signed' THEN
      ref := CASE WHEN acc_at IS NOT NULL AND acc_at + make_interval(days => (t->>'days')::int) <= statement_timestamp()
        THEN 'completion_acceptance_signed_at+' || (t->>'days') || 'd' END;
    END IF;
    declared := declared || jsonb_build_array(jsonb_build_object('key', t->>'kind', 'met', ref IS NOT NULL, 'declared', true,
      'basis', COALESCE(ref, CASE t->>'kind'
        WHEN 'customer_completion_sign' THEN 'no customer completion acceptance'
        WHEN 'inspector_attestation' THEN 'no inspection findings recorded after the quote acceptance'
        WHEN 'installed_parts_witness' THEN 'no authenticated supporting delivery attestation'
        WHEN 'photos_in_window' THEN 'no attached evidence captured inside the job window'
        ELSE CASE WHEN acc_at IS NULL THEN 'no customer completion acceptance' ELSE 'held until ' || (acc_at + make_interval(days => (t->>'days')::int))::text END END))
      || CASE WHEN t ? 'days' THEN jsonb_build_object('days', t->'days') ELSE '{}'::jsonb END);
  END LOOP;
  IF terms IS NOT NULL THEN
    conditions := jsonb_build_array(jsonb_build_object('key', 'quote_accepted_by_customer', 'met', true,
        'basis', 'quote_acceptance:' || (qs#>>'{acceptance,acceptance_id}')))
      || declared
      || jsonb_build_array(jsonb_build_object('key', 'invoice_current', 'met', inv.id IS NOT NULL,
          'basis', COALESCE('invoice:' || inv.id::text || ':v' || inv.version::text, 'no invoice')),
        jsonb_build_object('key', 'invoice_settled_by_payee_witness', 'met', rec->>'state' = 'paid',
          'basis', COALESCE('reconciliation:' || (rec->>'state'), 'no invoice')));
  ELSE
    conditions := jsonb_build_array(
      jsonb_build_object('key', 'quote_accepted_by_customer', 'met', accepted,
        'basis', CASE WHEN accepted THEN 'quote_acceptance:' || (qs#>>'{acceptance,acceptance_id}') ELSE 'no current customer quote acceptance' END),
      jsonb_build_object('key', 'completion_attested_by_provider', 'met', comp->'provider_attestation' <> 'null'::jsonb,
        'basis', COALESCE('completion_attestation:' || (comp#>>'{provider_attestation,completion_id}'), 'no current provider completion attestation')),
      jsonb_build_object('key', 'completion_accepted_by_customer', 'met', comp->>'customer_acceptance' = 'established',
        'basis', COALESCE('completion_acceptance:' || (comp#>>'{customer_acceptance_sign,acceptance_id}'), 'no customer completion acceptance')),
      jsonb_build_object('key', 'invoice_current', 'met', inv.id IS NOT NULL,
        'basis', COALESCE('invoice:' || inv.id::text || ':v' || inv.version::text, 'no invoice')),
      jsonb_build_object('key', 'invoice_settled_by_payee_witness', 'met', rec->>'state' = 'paid',
        'basis', COALESCE('reconciliation:' || (rec->>'state'), 'no invoice')));
  END IF;
  RETURN jsonb_build_object('conditions', conditions,
    'met', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(conditions) c WHERE (c->>'met')::boolean IS NOT TRUE),
    'declared_by', CASE WHEN terms IS NOT NULL THEN 'accepted_quote' ELSE 'platform_standard' END,
    'declared_terms', terms,
    'basis', jsonb_build_array(CASE WHEN terms IS NOT NULL
        THEN 'predicates: declared on accepted quote ' || (qs#>>'{acceptance,quote_id}') || ' v' || (qs#>>'{acceptance,quote_version}') || ', captured in its quote hash'
        ELSE 'predicates: platform standard; the accepted quote declares no release terms' END,
      'declared_at_acceptance: ' || COALESCE(qs#>>'{acceptance,acceptance_id}', 'none'),
      'evaluated_over: quote, completion, inspection, delivery, evidence, invoice and payment witness Sign records at as_of'),
    'payment_authorized', false, 'disbursement', 'not_performed');
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
