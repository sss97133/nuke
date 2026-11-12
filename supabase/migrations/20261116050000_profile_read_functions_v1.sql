-- Profile read functions, version 1: labor, money and vehicle relationships of one user, computed from evidence rows.
--
-- The profile is a view over evidence, not a record someone fills in. A value here counts as computed only when
--   (1) its inputs are evidence rows (source, timestamp, actor), (2) a named, versioned, deterministic function produces it,
--   (3) it returns the evidence ids it used (and a confidence when inferred), (4) nothing is written back, and
--   (5) no evidence gives null / unknown, never a default.
-- Every function below is read-only (STABLE), never calls now(), and orders its arrays, so the same rows give the same answer.
-- The version is in the name; a change of rule is a new function (_v2), never an in-place edit of a _v1 body.
--
--   profile_vendor_name_flags_v1(vendor, user_names)   IMMUTABLE. Why a receipt's vendor name is not trusted (empty array = no flag).
--   profile_labor_read_v1(user)                         work_sessions split into owner-confirmed vs inferred minutes.
--   profile_money_flows_v1(user)                        one row per money fact (receipt, payment event, deal-jacket amount).
--   profile_money_read_v1(user)                         totals per (scope, direction, basis, currency) with evidence ids; flagged rows apart.
--   _profile_vehicle_evidence_v1(user, vehicle)         internal: every evidence row tying the user to a vehicle, with its signal.
--   _profile_ownership_class_v1(user)                   internal: owner / contributor / ambiguous / no_evidence per vehicle.
--   profile_vehicle_relationships_read_v1(user)         per vehicle: roles (owner, contributor, consignment_agent, org inventory,
--                                                       custody) each with confidence and evidence ids.
--
-- Who sees what (row-level security is respected; the definer functions repeat the tables' own gates):
--   * money: SECURITY INVOKER, so receipts / payment_events / deal_jackets policies apply as they are; on top of that only the account
--     itself or the service role gets an answer (anyone else: visible=false, nothing else).
--   * labor: the account itself / service role get the session ids; anyone else gets the totals only (evidence_visible=false),
--     the same aggregate the profile header already shows publicly through get_user_producer_signals.
--   * vehicle relationships: the account itself / service role get every vehicle, conflict and id; anyone else only public, undeleted
--     vehicles, only owner (title-backed), contributor, org inventory and custody roles, counts instead of private ids
--     (organization_vehicles ids stay listed: that table is publicly readable).
--   * the two internal functions are executable by the service role (and the migration owner) only.
--
-- Additive and replay-safe: CREATE OR REPLACE only, no table, policy or data change. Contract: supabase/sql/test_profile_read_functions_v1.sql.
-- Revert: DROP FUNCTION each of the seven functions below.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. Vendor-name flags. A flagged name is kept and shown with its flags, never trusted as a counterparty.
CREATE OR REPLACE FUNCTION public.profile_vendor_name_flags_v1(p_vendor text, p_user_names text[])
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $fn$
  WITH v AS (SELECT btrim(coalesce(p_vendor, '')) AS s),
  names AS (
    SELECT DISTINCT lower(t) AS n
    FROM unnest(coalesce(p_user_names, '{}'::text[])) AS u(name),
         LATERAL regexp_split_to_table(regexp_replace(coalesce(u.name, ''), '[^[:alnum:] ]', ' ', 'g'), '\s+') AS t
    WHERE length(t) >= 3)
  SELECT coalesce(array_agg(f ORDER BY f) FILTER (WHERE f IS NOT NULL), '{}'::text[])
  FROM v, LATERAL (VALUES
    (CASE WHEN v.s = '' THEN 'missing' END),
    (CASE WHEN v.s <> '' AND length(regexp_replace(v.s, '[^[:alpha:]]', '', 'g')) < 3 THEN 'too_few_letters' END),
    (CASE WHEN v.s LIKE '%**%' OR v.s ~ '^[^[:alnum:][:space:]]{2,}' THEN 'markup_noise' END),
    (CASE WHEN v.s ~ '^[^[:alnum:]]*\$' OR v.s ~ '^[^[:alpha:]]*[0-9][^[:alpha:]]*$' THEN 'looks_like_amount' END),
    (CASE WHEN v.s ~* '^[0-9]{1,4}[-/. ]([0-9]{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/. ][0-9]{2,4}$'
          THEN 'looks_like_date' END),
    (CASE WHEN v.s ~* '(important|duplicate|reprint|customer cop|void where|free offer|giveaway|explanation of|^[^[:alnum:]]*purchase[^[:alnum:]]*$)'
          THEN 'boilerplate' END),
    (CASE WHEN EXISTS (SELECT 1 FROM names WHERE lower(v.s) ~ ('\m' || names.n || '\M')) THEN 'names_the_user' END)
  ) AS x(f);
$fn$;
COMMENT ON FUNCTION public.profile_vendor_name_flags_v1(text, text[]) IS
  'v1. Reasons a receipt vendor name is not a trustworthy counterparty: missing, too_few_letters, markup_noise, looks_like_amount, looks_like_date, boilerplate, names_the_user (a word of the account''s own name or username). Empty array = no flag. Deterministic.';

-- 2. Labor: work sessions, owner-confirmed vs inferred, never one "proven" number.
CREATE OR REPLACE FUNCTION public.profile_labor_read_v1(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  WITH viewer AS (
    SELECT coalesce((SELECT auth.uid()) = p_user_id, false) OR coalesce((SELECT auth.role()) = 'service_role', false) AS own),
  ws AS (
    SELECT w.id, w.vehicle_id, w.session_date, w.status, w.session_type, w.intent_source, w.confidence_score, w.created_at,
           CASE WHEN w.duration_minutes > 0 THEN w.duration_minutes END AS minutes,
           CASE WHEN w.owner_confirmed_at IS NOT NULL THEN 'owner_confirmed' ELSE 'inferred' END AS basis
    FROM public.work_sessions w
    WHERE p_user_id IS NOT NULL AND w.user_id = p_user_id),
  by_status AS (
    SELECT basis, jsonb_object_agg(coalesce(status, 'unrecorded'), jsonb_build_object('sessions', n, 'minutes', mins) ORDER BY coalesce(status, 'unrecorded')) AS j
    FROM (SELECT basis, status, count(*) AS n, sum(minutes) AS mins FROM ws GROUP BY basis, status) s GROUP BY basis),
  b AS (
    SELECT ws.basis,
           jsonb_build_object(
             'sessions', count(*),
             'minutes', sum(ws.minutes),
             'hours', round(sum(ws.minutes) / 60.0, 1),
             'sessions_without_duration', count(*) FILTER (WHERE ws.minutes IS NULL),
             'vehicles', count(DISTINCT ws.vehicle_id),
             'first_day', min(ws.session_date),
             'last_day', max(ws.session_date),
             'by_status', (SELECT j FROM by_status WHERE by_status.basis = ws.basis),
             -- inferred sessions carry their producers' own confidence; owner-confirmed ones are testimony of the vehicle's owner
             'confidence', CASE WHEN ws.basis = 'inferred' THEN round(avg(ws.confidence_score), 3) END,
             'evidence_table', 'work_sessions',
             'evidence_ids', CASE WHEN (SELECT own FROM viewer) THEN to_jsonb(array_agg(ws.id ORDER BY ws.session_date, ws.id)) END
           ) AS j,
           max(ws.created_at) AS as_of
    FROM ws GROUP BY ws.basis)
  SELECT jsonb_build_object(
    'function', 'profile_labor_read', 'version', 1, 'user_id', p_user_id,
    'unit', 'minutes',
    'evidence_visible', (SELECT own FROM viewer),
    'owner_confirmed', (SELECT j FROM b WHERE basis = 'owner_confirmed'),
    'inferred', (SELECT j FROM b WHERE basis = 'inferred'),
    'as_of', (SELECT max(as_of) FROM b),
    'rule', 'owner_confirmed = work_sessions.owner_confirmed_at is set; everything else (completed, derived, auto_inferred, ...) is inferred. The two are never added together.');
$fn$;
COMMENT ON FUNCTION public.profile_labor_read_v1(uuid) IS
  'v1. A user''s work sessions as two separate buckets, owner_confirmed and inferred (sessions, minutes, hours, vehicles, by_status, dates, evidence ids). Null bucket = no such session. Session ids only for the account itself or the service role; totals for anyone (same exposure as get_user_producer_signals).';

-- 3. Money flows: one row per money fact. Never mixes bases (receipt total, payment, buyer-paid, net, cost, profit) and never guesses a currency.
CREATE OR REPLACE FUNCTION public.profile_money_flows_v1(p_user_id uuid)
RETURNS TABLE(scope text, evidence_table text, evidence_id uuid, direction text, basis text, amount numeric, currency text,
              occurred_on date, counterparty text, vehicle_id uuid, organization_id uuid, flags text[], trusted boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
  WITH viewer AS (
    SELECT coalesce((SELECT auth.uid()) = p_user_id, false) OR coalesce((SELECT auth.role()) = 'service_role', false) AS own),
  me AS (
    SELECT ARRAY[p.full_name, p.username] AS names FROM public.profiles p WHERE p.id = p_user_id),
  rc AS (
    SELECT r.*, coalesce(r.total_amount, r.total) AS amt,
           CASE WHEN r.vehicle_id IS NOT NULL THEN r.vehicle_id
                WHEN r.scope_type = 'vehicle' AND r.scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN r.scope_id::uuid END AS vid
    FROM public.receipts r
    WHERE r.user_id = p_user_id AND (SELECT own FROM viewer)
      AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL),
  receipt_rows AS (
    SELECT 'personal'::text AS scope, 'receipts'::text AS evidence_table, rc.id AS evidence_id,
           CASE WHEN rc.document_kind::text = 'vehicle_sale' THEN 'in'
                WHEN rc.document_kind::text IN ('tax_form', 'financial_statement', 'letter_notice') THEN 'not_a_flow'
                WHEN rc.document_kind::text IN ('vehicle_transaction', 'insurance_document') OR rc.document_kind IS NULL THEN 'unknown'
                ELSE 'out' END AS direction,
           CASE WHEN rc.document_kind::text = 'vehicle_sale' THEN 'sale_document_total' ELSE 'receipt_total' END AS basis,
           rc.amt AS amount,
           upper(nullif(btrim(rc.currency), '')) AS currency,
           coalesce(rc.receipt_date, rc.transaction_date, rc.purchase_date) AS occurred_on,
           rc.vendor_name AS counterparty, rc.vid AS vehicle_id, NULL::uuid AS organization_id,
           public.profile_vendor_name_flags_v1(rc.vendor_name, (SELECT names FROM me))
             || CASE WHEN rc.amt IS NULL OR rc.amt = 0 OR rc.amount_check::text = 'no_amount' THEN ARRAY['no_amount'] ELSE '{}'::text[] END
             || CASE WHEN rc.amt < 0 THEN ARRAY['negative_amount'] ELSE '{}'::text[] END
             || CASE WHEN rc.amount_check::text = 'implausible' THEN ARRAY['amount_implausible']
                     WHEN rc.amount_check IS NULL OR rc.amount_check::text = 'unchecked' THEN ARRAY['amount_unchecked'] ELSE '{}'::text[] END
             || CASE WHEN nullif(btrim(rc.currency), '') IS NULL THEN ARRAY['currency_unrecorded'] ELSE '{}'::text[] END AS flags
    FROM rc),
  payment_rows AS (
    SELECT 'personal', 'payment_events', pe.id,
           CASE WHEN pe.direction IN ('in', 'out') THEN pe.direction ELSE 'unknown' END,
           'payment', pe.amount_usd,
           'USD',  -- the column is amount_usd: the currency is part of the schema, not a guess
           (pe.paid_at AT TIME ZONE 'UTC')::date,
           pe.counterparty_name,
           CASE WHEN pe.scope_type = 'vehicle' THEN pe.scope_id END,
           coalesce(pe.counterparty_org_id, CASE WHEN pe.scope_type = 'org' THEN pe.scope_id END),
           CASE WHEN pe.source_observation_id IS NULL AND pe.source_url IS NULL THEN ARRAY['unsourced'] ELSE '{}'::text[] END
             || CASE WHEN pe.amount_usd IS NULL OR pe.amount_usd <= 0 THEN ARRAY['no_amount'] ELSE '{}'::text[] END
    FROM public.payment_events pe
    WHERE pe.user_id = p_user_id AND (SELECT own FROM viewer) AND pe.is_superseded IS NOT TRUE),
  -- A deal jacket is the user's own when the user created it; an organization's when it belongs to an organization the user is an
  -- active principal of. Never matched by a name (entity_owner is free text and two profiles are named Skylar).
  my_orgs AS (
    SELECT DISTINCT oc.organization_id FROM public.organization_contributors oc
    WHERE oc.user_id = p_user_id AND oc.status = 'active'
      AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')),
  dj AS (
    SELECT d.*, CASE WHEN d.created_by = p_user_id THEN 'personal' ELSE 'organization' END AS jscope
    FROM public.deal_jackets d
    WHERE (SELECT own FROM viewer)
      AND (d.created_by = p_user_id OR d.organization_id IN (SELECT organization_id FROM my_orgs))),
  jacket_rows AS (
    SELECT dj.jscope, 'deal_jackets', dj.id, x.direction, x.basis, x.amount, NULL::text, x.on_date, NULL::text,
           dj.vehicle_id, dj.organization_id,
           ARRAY['currency_unrecorded'] || CASE WHEN x.amount <= 0 THEN ARRAY['no_amount'] ELSE '{}'::text[] END
    FROM dj CROSS JOIN LATERAL (VALUES
      ('out', 'acquisition_cost', coalesce(dj.total_initial_cost, dj.initial_cost), dj.acquisition_date),
      ('in', 'sale_buyer_paid', coalesce(dj.total_selling_price, dj.sale_price_inc_doc), dj.sold_date),
      ('in', 'sale_net_proceeds', dj.net_auction_proceeds, dj.sold_date),
      ('not_a_flow', 'gross_profit', dj.gross_profit, dj.sold_date)
    ) AS x(direction, basis, amount, on_date)
    WHERE x.amount IS NOT NULL)
  SELECT u.*, cardinality(u.flags) = 0 AS trusted
  FROM (SELECT * FROM receipt_rows UNION ALL SELECT * FROM payment_rows UNION ALL SELECT * FROM jacket_rows) AS u
  ORDER BY u.occurred_on NULLS LAST, u.evidence_table, u.evidence_id, u.basis;
$fn$;
COMMENT ON FUNCTION public.profile_money_flows_v1(uuid) IS
  'v1. One row per money fact of a user: receipts (not superseded, not duplicate), payment_events (not superseded), and each recorded amount of a deal jacket the user created (scope personal) or of an organization the user is an active principal of (scope organization). direction in/out/unknown/not_a_flow; basis receipt_total, sale_document_total, payment, acquisition_cost, sale_buyer_paid, sale_net_proceeds, gross_profit (hammer is not recorded by these tables, so it never appears); currency NULL when unrecorded, never assumed. trusted = no flag. Only the account itself or the service role gets rows; SECURITY INVOKER, so table RLS applies.';

-- 4. Money totals: one total per (scope, direction, basis, currency). Bases and currencies are never added together.
CREATE OR REPLACE FUNCTION public.profile_money_read_v1(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
  WITH viewer AS (
    SELECT coalesce((SELECT auth.uid()) = p_user_id, false) OR coalesce((SELECT auth.role()) = 'service_role', false) AS own),
  f AS (SELECT * FROM public.profile_money_flows_v1(p_user_id)),
  totals AS (
    SELECT jsonb_agg(jsonb_build_object(
             'scope', scope, 'direction', direction, 'basis', basis, 'currency', currency,
             'trusted_amount', trusted_amount, 'trusted_count', trusted_count, 'trusted_ids', trusted_ids,
             'flagged_amount', flagged_amount, 'flagged_count', flagged_count, 'flagged_ids', flagged_ids)
           ORDER BY scope, direction, basis, currency NULLS LAST) AS j
    FROM (SELECT scope, direction, basis, currency,
                 sum(amount) FILTER (WHERE trusted) AS trusted_amount,
                 count(*) FILTER (WHERE trusted) AS trusted_count,
                 coalesce(jsonb_agg(evidence_table || ':' || evidence_id ORDER BY evidence_table, evidence_id) FILTER (WHERE trusted), '[]'::jsonb) AS trusted_ids,
                 sum(amount) FILTER (WHERE NOT trusted) AS flagged_amount,
                 count(*) FILTER (WHERE NOT trusted) AS flagged_count,
                 coalesce(jsonb_agg(evidence_table || ':' || evidence_id ORDER BY evidence_table, evidence_id) FILTER (WHERE NOT trusted), '[]'::jsonb) AS flagged_ids
          FROM f GROUP BY scope, direction, basis, currency) g),
  flag_counts AS (
    SELECT jsonb_object_agg(fl, n ORDER BY fl) AS j
    FROM (SELECT fl, count(*) AS n FROM f, unnest(f.flags) AS fl GROUP BY fl) s),
  untrusted_counterparties AS (
    SELECT jsonb_agg(jsonb_build_object('evidence', evidence_table || ':' || evidence_id, 'counterparty', counterparty,
                                        'amount', amount, 'currency', currency, 'flags', to_jsonb(flags))
                     ORDER BY amount DESC NULLS LAST, evidence_id) AS j
    FROM f WHERE flags && ARRAY['missing', 'too_few_letters', 'markup_noise', 'looks_like_amount', 'looks_like_date',
                                'boilerplate', 'names_the_user', 'amount_implausible'])
  SELECT CASE WHEN NOT (SELECT own FROM viewer) THEN
           jsonb_build_object('function', 'profile_money_read', 'version', 1, 'user_id', p_user_id, 'visible', false,
                              'reason', 'money is shown only to the account itself')
         ELSE jsonb_build_object(
           'function', 'profile_money_read', 'version', 1, 'user_id', p_user_id, 'visible', true,
           'totals', (SELECT j FROM totals),
           'flag_counts', (SELECT j FROM flag_counts),
           'untrusted_counterparties', (SELECT j FROM untrusted_counterparties),
           'rule', 'Totals are per scope, direction, basis and currency; a NULL currency is unrecorded, not USD. trusted_amount sums only rows with no flag; flagged rows are listed, never silently dropped or trusted. Superseded and duplicate receipts and superseded payment events are not flows (their replacements are).')
         END;
$fn$;
COMMENT ON FUNCTION public.profile_money_read_v1(uuid) IS
  'v1. Money of a user as totals per (scope, direction, basis, currency) with trusted and flagged evidence ids, flag counts, and the flagged counterparties. Null totals = no money evidence. Only the account itself or the service role; others get visible=false.';

-- 5. Vehicle relationship evidence (internal). One row per evidence row tying the user to a vehicle, and the signal it carries:
--   owner_title          ownership_verifications approved, title_document, https title           -> owner
--   owner_purchase       the user's acquisition-cost book entry (amount > 0), purchase agreement / bill of sale / title
--                        document the user uploaded, or the user's outgoing payment scoped to the vehicle -> owner
--   owner_deal_jacket    a deal jacket on the vehicle the user created                             -> owner
--                        (a jacket of an organization: org_inventory / org_past_inventory; a jacket with neither: conflict)
--   contribution_photo   the user's photos of the vehicle (vehicle_images.user_id; documented_by_user_id is a device
--                        attribution with no index, left out in v1)                              -> contributor
--   contribution_upload  the user created the vehicle record (uploaded_by / user_id)               -> contributor
--   contribution_work    the user's work sessions on the vehicle                                   -> contributor (labor)
--   denial               the user's own garage statement denying ownership
--   consigned            consignment testimony: statement, consigned grant, consigner contributor role
--   conflict             points at ownership without proving it: sale proceeds received, sale document, other book entries
--                        or citations, an unattributed deal jacket, an ownership fold row, an owner/previously-owned grant, an
--                        owner-type contributor role, an owner statement, a typed purchase price / date on the record
--   org_inventory        an active organization_vehicles link of an inventory type (owner, consigner, current_consignment,
--                        supplier_inventory) not ended or rejected                                   -> organization inventory
--   org_past_inventory   an organization's deal jacket on the vehicle with a sold date             -> past organization inventory
--   org_custody          an active link of a custody type (work_location, storage, service_provider, ...)  -> custody
--   assertion            vehicles.owner_id = user: the claim under test, shown, never used as evidence
CREATE OR REPLACE FUNCTION public._profile_vehicle_evidence_v1(p_user_id uuid, p_vehicle_id uuid DEFAULT NULL)
RETURNS TABLE(vehicle_id uuid, signal text, kind text, evidence_table text, evidence_id uuid, organization_id uuid,
              observed_at timestamptz, confidence numeric, detail jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  WITH ev AS (
    -- title
    SELECT ov.vehicle_id, 'owner_title' AS signal, 'title_verification' AS kind, 'ownership_verifications' AS evidence_table, ov.id AS evidence_id,
           NULL::uuid AS organization_id, coalesce(ov.approved_at, ov.human_reviewed_at, ov.created_at)::timestamptz AS observed_at,
           0.95::numeric AS confidence, jsonb_build_object('status', ov.status) AS detail
    FROM public.ownership_verifications ov
    WHERE ov.user_id = p_user_id AND ov.status = 'approved' AND ov.verification_category = 'title_document'
      AND ov.title_document_url ~ '^https://'
    -- purchase: the user's own documents and payments
    UNION ALL
    SELECT d.vehicle_id, 'owner_purchase', 'purchase_document', 'vehicle_documents', d.id, NULL, d.created_at, 0.8,
           jsonb_build_object('document_type', d.document_type, 'title', d.title, 'amount', d.amount, 'currency', d.currency)
    FROM public.vehicle_documents d
    WHERE d.uploaded_by = p_user_id
      AND ((d.document_type = 'books_decision' AND d.title ~* '^expense:.*acquisition' AND d.amount > 0)
        OR (d.document_type IN ('title', 'bill_of_sale', 'legal_document')
            AND coalesce(d.title, '') ~* '(purchase agreement|bill of sale|certificate of title|^title$)'))
    UNION ALL
    SELECT pe.scope_id, 'owner_purchase', 'purchase_payment', 'payment_events', pe.id, NULL, pe.paid_at, 0.8,
           jsonb_build_object('amount', pe.amount_usd, 'currency', 'USD', 'counterparty', pe.counterparty_name)
    FROM public.payment_events pe
    WHERE pe.user_id = p_user_id AND pe.scope_type = 'vehicle' AND pe.direction = 'out' AND pe.amount_usd > 0
      AND pe.is_superseded IS NOT TRUE
    -- deal jackets: the user's own -> owner; a jacket with no creator and no organization -> conflict; an organization's -> that org's inventory
    UNION ALL
    SELECT dj.vehicle_id,
           CASE WHEN dj.created_by = p_user_id THEN 'owner_deal_jacket'
                WHEN dj.organization_id IS NULL THEN 'conflict'
                WHEN dj.sold_date IS NOT NULL THEN 'org_past_inventory'
                ELSE 'org_inventory' END,
           'deal_jacket', 'deal_jackets', dj.id, dj.organization_id, dj.created_at,
           CASE WHEN dj.created_by = p_user_id THEN 0.85 ELSE 0.6 END,
           jsonb_build_object('deal_type', dj.deal_type, 'acquisition_date', dj.acquisition_date, 'sold_date', dj.sold_date)
    FROM public.deal_jackets dj
    WHERE dj.vehicle_id IS NOT NULL
      AND (dj.created_by = p_user_id
           OR dj.vehicle_id IN (SELECT v.id FROM public.vehicles v WHERE p_user_id IN (v.owner_id, v.user_id, v.uploaded_by))
           OR EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.vehicle_id = dj.vehicle_id AND vi.user_id = p_user_id))
    -- contribution
    UNION ALL
    SELECT vi.vehicle_id, 'contribution_photo', 'photo', 'vehicle_images', vi.id, NULL, coalesce(vi.taken_at, vi.created_at), 0.9,
           NULL
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_user_id AND vi.vehicle_id IS NOT NULL
      AND vi.is_superseded IS NOT TRUE AND vi.is_duplicate IS NOT TRUE
    UNION ALL
    SELECT v.id, 'contribution_upload', 'record_created', 'vehicles', v.id, NULL, v.created_at, 0.7,
           jsonb_build_object('uploaded_by', v.uploaded_by = p_user_id, 'user_id', v.user_id = p_user_id)
    FROM public.vehicles v WHERE p_user_id IN (v.uploaded_by, v.user_id)
    UNION ALL
    SELECT w.vehicle_id, 'contribution_work', 'work_session', 'work_sessions', w.id, NULL, coalesce(w.start_time, w.created_at), 0.8,
           jsonb_build_object('owner_confirmed', w.owner_confirmed_at IS NOT NULL, 'status', w.status)
    FROM public.work_sessions w WHERE w.user_id = p_user_id AND w.vehicle_id IS NOT NULL
    -- the user's own garage statements (owner-input testimony)
    UNION ALL
    SELECT o.vehicle_id,
           CASE WHEN (o.structured_data #>> '{correction,relationship,ownership_denied}')::boolean IS TRUE THEN 'denial'
                WHEN (o.structured_data #> '{correction,relationship,roles}') ? 'consignment' THEN 'consigned'
                ELSE 'conflict' END,
           'owner_statement', 'vehicle_observations', o.id, NULL, o.observed_at, 0.5,
           o.structured_data #> '{correction,relationship}'
    FROM public.vehicle_observations o
    WHERE o.submitted_by_user_id = p_user_id AND o.extraction_method = 'garage_owner_correction_v1'
      AND o.is_superseded IS NOT TRUE AND o.vehicle_id IS NOT NULL
      AND o.structured_data #> '{correction,relationship}' IS NOT NULL
      AND ((o.structured_data #>> '{correction,relationship,ownership_denied}')::boolean IS TRUE
           OR jsonb_array_length(coalesce(o.structured_data #> '{correction,relationship,roles}', '[]'::jsonb)) > 0)
    -- money and paper that point at ownership without proving it
    UNION ALL
    SELECT pe.scope_id, 'conflict', 'sale_proceeds', 'payment_events', pe.id, NULL, pe.paid_at, 0.5,
           jsonb_build_object('amount', pe.amount_usd, 'currency', 'USD', 'description', left(pe.description, 200))
    FROM public.payment_events pe
    WHERE pe.user_id = p_user_id AND pe.scope_type = 'vehicle' AND pe.direction = 'in' AND pe.is_superseded IS NOT TRUE
    UNION ALL
    SELECT coalesce(r.vehicle_id, CASE WHEN r.scope_type = 'vehicle'
             AND r.scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN r.scope_id::uuid END),
           'conflict', 'sale_document', 'receipts', r.id, NULL, coalesce(r.receipt_date, r.transaction_date)::timestamptz, 0.5,
           jsonb_build_object('document_kind', r.document_kind, 'vendor', r.vendor_name)
    FROM public.receipts r
    WHERE r.user_id = p_user_id AND r.document_kind::text IN ('vehicle_sale', 'vehicle_transaction') AND r.duplicate_of IS NULL AND r.is_superseded IS NOT TRUE
    UNION ALL
    SELECT d.vehicle_id, 'conflict', 'book_entry', 'vehicle_documents', d.id, NULL, d.created_at, 0.5,
           jsonb_build_object('document_type', d.document_type, 'title', d.title)
    FROM public.vehicle_documents d
    WHERE d.uploaded_by = p_user_id AND d.document_type IN ('books_decision', 'provenance_citation', 'legal_document')
      AND NOT coalesce((d.document_type = 'books_decision' AND d.title ~* '^expense:.*acquisition' AND d.amount > 0)
            OR (d.document_type = 'legal_document' AND coalesce(d.title, '') ~* '(purchase agreement|bill of sale|certificate of title|^title$)'), false)
    UNION ALL
    SELECT o.vehicle_id, 'conflict', 'ownership_fold', 'vehicle_ownerships', o.id, NULL, o.created_at, 0.5,
           jsonb_build_object('role', o.role, 'ownership_type', o.ownership_type, 'is_current', o.is_current, 'end_date', o.end_date,
                              'verification_id', o.verification_id)
    FROM public.vehicle_ownerships o
    WHERE o.owner_profile_id = p_user_id AND o.superseded_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.ownership_verifications t WHERE t.id = o.verification_id AND t.status = 'approved'
                        AND t.verification_category = 'title_document' AND t.title_document_url ~ '^https://')
    UNION ALL
    SELECT p.vehicle_id, CASE WHEN p.role = 'consigned' THEN 'consigned' ELSE 'conflict' END, 'role_grant',
           'vehicle_user_permissions', p.id, NULL, coalesce(p.granted_at, p.created_at), 0.4,
           jsonb_build_object('role', p.role)
    FROM public.vehicle_user_permissions p
    WHERE p.user_id = p_user_id AND p.revoked_at IS NULL AND coalesce(p.is_active, true)
      AND p.role IN ('owner', 'co_owner', 'previously_owned', 'consigned')
    UNION ALL
    SELECT c.vehicle_id, CASE WHEN c.role = 'consigner' THEN 'consigned' ELSE 'conflict' END, 'contributor_role',
           'vehicle_contributors', c.id, c.organization_id, c.created_at, 0.4, jsonb_build_object('role', c.role, 'status', c.status)
    FROM public.vehicle_contributors c
    WHERE c.user_id = p_user_id AND coalesce(c.status, 'active') = 'active'
      AND c.role IN ('owner', 'previous_owner', 'consigner', 'sales_agent', 'seller', 'buyer')
    UNION ALL
    SELECT v.id, 'conflict', 'typed_purchase_fields', 'vehicles', v.id, NULL, v.created_at, 0.2,
           jsonb_build_object('purchase_price', v.purchase_price, 'purchase_date', v.purchase_date)
    FROM public.vehicles v
    WHERE p_user_id IN (v.owner_id, v.user_id, v.uploaded_by) AND (v.purchase_price > 0 OR v.purchase_date IS NOT NULL)
    UNION ALL
    SELECT v.id, 'assertion', 'owner_id_field', 'vehicles', v.id, NULL, v.created_at, NULL,
           jsonb_build_object('entry_type', v.entry_type)
    FROM public.vehicles v WHERE v.owner_id = p_user_id),
  scoped AS (
    SELECT ev.* FROM ev JOIN public.vehicles v ON v.id = ev.vehicle_id
    WHERE (p_vehicle_id IS NULL OR ev.vehicle_id = p_vehicle_id) AND v.deleted_at IS NULL AND p_user_id IS NOT NULL),
  orgs AS (
    SELECT ov.vehicle_id,
           CASE WHEN ov.relationship_type IN ('owner', 'consigner', 'current_consignment', 'supplier_inventory') THEN 'org_inventory'
                ELSE 'org_custody' END,
           'org_link', 'organization_vehicles', ov.id, ov.organization_id, ov.created_at,
           CASE WHEN ov.user_confirmed IS TRUE THEN 0.9 WHEN ov.auto_tagged IS TRUE THEN 0.4 ELSE 0.6 END,
           jsonb_build_object('relationship_type', ov.relationship_type, 'status', ov.status, 'start_date', ov.start_date,
                              'user_confirmed', ov.user_confirmed, 'auto_tagged', ov.auto_tagged)
    FROM public.organization_vehicles ov
    WHERE ov.vehicle_id IN (SELECT DISTINCT s.vehicle_id FROM scoped s)
      AND ov.status = 'active' AND ov.end_date IS NULL AND ov.user_rejected IS NOT TRUE
      AND ov.relationship_type IN ('owner', 'consigner', 'current_consignment', 'supplier_inventory', 'work_location', 'storage',
                                   'service_provider', 'upholstery', 'painter', 'fabricator', 'transport', 'inspector'))
  SELECT * FROM scoped
  UNION ALL SELECT * FROM orgs
  ORDER BY 1, 2, 4, 5;
$fn$;
COMMENT ON FUNCTION public._profile_vehicle_evidence_v1(uuid, uuid) IS
  'v1, internal (service role / migration owner). Every evidence row tying a user to a vehicle with the signal it carries (owner_title, owner_purchase, owner_deal_jacket, contribution_photo, contribution_upload, contribution_work, denial, consigned, conflict, org_inventory, org_past_inventory, org_custody, assertion). Deleted vehicles excluded. Optional vehicle filter.';

-- 6. Ownership class per vehicle (internal). The rule the data-fix migration of the same day applies, so read and write agree.
--   owner        any owner_* signal
--   contributor  no owner_* signal, a photo or record-creation signal, and either no conflict / consigned signal or the user's own denial
--   no_evidence  no signal but the assertion (and org links)
--   ambiguous    everything else (a conflict or consignment testimony without proof either way)
CREATE OR REPLACE FUNCTION public._profile_ownership_class_v1(p_user_id uuid)
RETURNS TABLE(vehicle_id uuid, ownership_class text, owner_ids jsonb, contribution_count bigint, conflict_ids jsonb, denial_ids jsonb,
              confidence numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  WITH e AS (SELECT * FROM public._profile_vehicle_evidence_v1(p_user_id, NULL)),
  g AS (
    SELECT e.vehicle_id,
           bool_or(e.signal LIKE 'owner\_%') AS has_owner,
           bool_or(e.signal IN ('contribution_photo', 'contribution_upload')) AS has_contribution,
           bool_or(e.signal IN ('conflict', 'consigned')) AS has_conflict,
           bool_or(e.signal = 'denial') AS has_denial,
           max(e.confidence) FILTER (WHERE e.signal LIKE 'owner\_%') AS owner_conf,
           max(e.confidence) FILTER (WHERE e.signal IN ('contribution_photo', 'contribution_upload')) AS contrib_conf,
           coalesce(jsonb_agg(e.evidence_table || ':' || e.evidence_id ORDER BY e.evidence_table, e.evidence_id)
             FILTER (WHERE e.signal LIKE 'owner\_%'), '[]'::jsonb) AS owner_ids,
           count(*) FILTER (WHERE e.signal IN ('contribution_photo', 'contribution_upload')) AS contribution_count,
           coalesce(jsonb_agg(e.evidence_table || ':' || e.evidence_id || ':' || e.kind ORDER BY e.evidence_table, e.evidence_id)
             FILTER (WHERE e.signal IN ('conflict', 'consigned')), '[]'::jsonb) AS conflict_ids,
           coalesce(jsonb_agg(e.evidence_table || ':' || e.evidence_id ORDER BY e.evidence_table, e.evidence_id)
             FILTER (WHERE e.signal = 'denial'), '[]'::jsonb) AS denial_ids
    FROM e WHERE e.signal NOT LIKE 'org\_%' GROUP BY e.vehicle_id)
  SELECT g.vehicle_id,
         CASE WHEN g.has_owner THEN 'owner'
              WHEN g.has_contribution AND (NOT g.has_conflict OR g.has_denial) THEN 'contributor'
              WHEN NOT g.has_contribution AND NOT g.has_conflict AND NOT g.has_denial THEN 'no_evidence'
              ELSE 'ambiguous' END,
         g.owner_ids, g.contribution_count, g.conflict_ids, g.denial_ids,
         CASE WHEN g.has_owner THEN g.owner_conf
              WHEN g.has_contribution AND NOT g.has_conflict THEN g.contrib_conf
              WHEN g.has_contribution AND g.has_denial THEN least(g.contrib_conf, 0.7) END
  FROM g ORDER BY g.vehicle_id;
$fn$;
COMMENT ON FUNCTION public._profile_ownership_class_v1(uuid) IS
  'v1, internal. owner / contributor / ambiguous / no_evidence per vehicle from _profile_vehicle_evidence_v1, with the owner, conflict and denial evidence ids and a confidence (null when ambiguous or no evidence).';

-- 7. Vehicle relationships read.
CREATE OR REPLACE FUNCTION public.profile_vehicle_relationships_read_v1(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  WITH viewer AS (
    SELECT coalesce((SELECT auth.uid()) = p_user_id, false) OR coalesce((SELECT auth.role()) = 'service_role', false) AS own),
  -- A deal jacket is shown only when the account itself may read it (its creator, a public jacket, or an active
  -- member of the jacket's organization for a non-privileged one), mirroring the deal_jackets policies.
  e AS (SELECT ev.* FROM public._profile_vehicle_evidence_v1(p_user_id, NULL) ev
        WHERE ev.evidence_table <> 'deal_jackets'
           OR EXISTS (SELECT 1 FROM public.deal_jackets dj WHERE dj.id = ev.evidence_id
                        AND (dj.created_by = p_user_id OR dj.visibility::text = 'public'
                             OR (dj.visibility::text IN ('org', 'principals')
                                 AND dj.organization_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
                                   WHERE oc.user_id = p_user_id AND oc.status = 'active'
                                     AND oc.role IN ('owner', 'admin', 'co_founder', 'board_member', 'manager', 'employee', 'technician')))))),
  c AS (SELECT * FROM public._profile_ownership_class_v1(p_user_id)),
  roles AS (
    SELECT e.vehicle_id,
           CASE WHEN e.signal LIKE 'owner\_%' THEN 'owner'
                WHEN e.signal LIKE 'contribution\_%' THEN 'contributor'
                WHEN e.signal = 'consigned' THEN 'consignment_agent'
                WHEN e.signal = 'org_inventory' THEN 'organization_inventory'
                WHEN e.signal = 'org_past_inventory' THEN 'organization_past_inventory'
                WHEN e.signal = 'org_custody' THEN 'custody' END AS role,
           e.organization_id,
           max(e.confidence) AS confidence,
           count(*) AS evidence_count,
           jsonb_agg(DISTINCT e.kind ORDER BY e.kind) AS kinds,
           jsonb_agg(e.evidence_table || ':' || e.evidence_id ORDER BY e.evidence_table, e.evidence_id) AS ids,
           bool_and(e.evidence_table = 'organization_vehicles') AS public_ids,
           min(e.observed_at) AS first_at, max(e.observed_at) AS last_at
    FROM e WHERE e.signal NOT IN ('conflict', 'denial', 'assertion')
    GROUP BY 1, 2, 3),
  veh AS (
    SELECT v.id, v.year, v.make, v.model, v.is_public, v.owner_id = p_user_id AS owner_id_is_user, v.entry_type
    FROM public.vehicles v WHERE v.id IN (SELECT DISTINCT e.vehicle_id FROM e)),
  per_vehicle AS (
    SELECT veh.id, veh.year,
           jsonb_build_object(
             'vehicle_id', veh.id, 'year', veh.year, 'make', veh.make, 'model', veh.model,
             -- A visitor sees owner only when a title backs it; a private purchase, payment or jacket stays unresolved.
             'ownership_class', CASE WHEN (SELECT own FROM viewer) THEN c.ownership_class
                                     WHEN c.ownership_class = 'contributor' THEN c.ownership_class
                                     WHEN c.ownership_class = 'owner' AND c.owner_ids::text LIKE '%ownership_verifications:%' THEN 'owner'
                                     ELSE 'unresolved' END,
             'ownership_confidence', CASE WHEN (SELECT own FROM viewer) OR c.ownership_class = 'contributor'
                                            OR (c.ownership_class = 'owner' AND c.owner_ids::text LIKE '%ownership_verifications:%')
                                          THEN c.confidence END,
             'roles', (SELECT jsonb_agg(jsonb_build_object(
                         'role', r.role, 'organization_id', r.organization_id, 'confidence', r.confidence,
                         'evidence_count', r.evidence_count, 'evidence_kinds', r.kinds,
                         'evidence_ids', CASE WHEN (SELECT own FROM viewer) OR r.public_ids THEN
                                           CASE WHEN r.role = 'contributor' AND r.evidence_count > 50
                                                THEN NULL ELSE r.ids END END,
                         'evidence_ids_via', CASE WHEN r.role = 'contributor' AND r.evidence_count > 50 AND (SELECT own FROM viewer)
                                                  THEN '_profile_vehicle_evidence_v1(user, vehicle)' END,
                         'first_at', r.first_at, 'last_at', r.last_at)
                       ORDER BY r.role, r.organization_id NULLS FIRST)
                       FROM roles r WHERE r.vehicle_id = veh.id
                         AND ((SELECT own FROM viewer)
                              OR r.role = 'contributor'
                              -- visitors see an organization role only from a public organization link, never from a jacket
                              OR (r.role IN ('organization_inventory', 'custody') AND r.kinds ? 'org_link')
                              OR (r.role = 'owner' AND r.kinds ? 'title_verification'))),
             'conflicts', CASE WHEN (SELECT own FROM viewer) THEN c.conflict_ids END,
             'denials', CASE WHEN (SELECT own FROM viewer) THEN c.denial_ids END,
             'asserted', CASE WHEN (SELECT own FROM viewer) THEN
                           jsonb_build_object('owner_id_is_user', coalesce(veh.owner_id_is_user, false), 'entry_type', veh.entry_type) END
           ) AS j
    FROM veh LEFT JOIN c ON c.vehicle_id = veh.id
    WHERE (SELECT own FROM viewer) OR veh.is_public IS TRUE)
  SELECT jsonb_build_object(
    'function', 'profile_vehicle_relationships_read', 'version', 1, 'user_id', p_user_id,
    'evidence_visible', (SELECT own FROM viewer),
    'class_counts', (SELECT jsonb_object_agg(k, n ORDER BY k) FROM (
                       SELECT (p.j ->> 'ownership_class') AS k, count(*) AS n FROM per_vehicle p GROUP BY 1) s),
    'vehicles', (SELECT jsonb_agg(p.j ORDER BY p.year NULLS LAST, p.id) FROM per_vehicle p),
    'rule', 'Roles come from evidence rows only (see _profile_vehicle_evidence_v1). vehicles.owner_id and entry_type are shown under asserted and never count as evidence. Owner needs a title, purchase record or own deal jacket; photos or creating the record make a contributor; anything pointing at ownership without proof is a conflict and leaves the vehicle ambiguous.');
$fn$;
COMMENT ON FUNCTION public.profile_vehicle_relationships_read_v1(uuid) IS
  'v1. Per vehicle tied to a user by evidence: ownership_class (owner / contributor / ambiguous / no_evidence), roles (owner, contributor, consignment_agent, organization_inventory, custody) with confidence, evidence kinds and ids. The account itself and the service role see everything; anyone else sees public vehicles, title-backed owner / contributor / organization / custody roles, organization link ids, and unresolved for the rest.';

REVOKE ALL ON FUNCTION public.profile_vendor_name_flags_v1(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_labor_read_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_money_flows_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_money_read_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._profile_vehicle_evidence_v1(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._profile_ownership_class_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_vehicle_relationships_read_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_money_flows_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.profile_money_read_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._profile_vehicle_evidence_v1(uuid, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._profile_ownership_class_v1(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_vendor_name_flags_v1(text, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_labor_read_v1(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_money_flows_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_money_read_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._profile_vehicle_evidence_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._profile_ownership_class_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.profile_vehicle_relationships_read_v1(uuid) TO anon, authenticated, service_role;

-- This migration's own end state, in the same transaction.
DO $check$
BEGIN
  IF has_function_privilege('anon', 'public._profile_vehicle_evidence_v1(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._profile_ownership_class_v1(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.profile_money_read_v1(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.profile_vehicle_relationships_read_v1(uuid)', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.profile_money_read_v1(uuid)'::regprocedure)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.profile_money_flows_v1(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'profile read functions v1: grants or security mode are not the intended ones';
  END IF;
  IF public.profile_vendor_name_flags_v1('***IMPORTANT***', ARRAY['skylar williams']) <> ARRAY['boilerplate', 'markup_noise']
     OR public.profile_vendor_name_flags_v1('Skylar Williams', ARRAY['skylar williams', 'skylar']) <> ARRAY['names_the_user']
     OR public.profile_vendor_name_flags_v1('25-Jul-25', NULL) <> ARRAY['looks_like_date']
     OR public.profile_vendor_name_flags_v1('O''Reilly Auto Parts', ARRAY['skylar williams']) <> '{}'::text[] THEN
    RAISE EXCEPTION 'profile_vendor_name_flags_v1 does not flag the reviewed examples as intended';
  END IF;
END
$check$;

NOTIFY pgrst, 'reload schema';
COMMIT;
