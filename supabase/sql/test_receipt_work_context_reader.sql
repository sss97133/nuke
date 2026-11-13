-- Contract for 20261113090000_receipt_work_context_reader (run on an empty disposable database; dependencies stubbed here,
-- then the reconciliation migration and the reader are applied with \ir). Asserts: only signed-in callers who may view the
-- vehicle read it (another user and anon get nothing; execute is not granted to anon); frames are only those the caller
-- may see (sensitive, privacy-hold / review-needed, redacted, other-vehicle frames hidden and counted); withdrawn and
-- superseded rows are never current lines; lineage page is null with its reason; printed claims are attributed to the
-- document; photographer, printed performer, custodian and holder are distinct labelled fields; account ids and amounts
-- are masked for untied viewers of a public vehicle; an answer citing a hidden frame does not reveal it; the page-date
-- filter; the revert.
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid, is_public boolean, deleted_at timestamptz);
CREATE TABLE public.vehicle_grants(vehicle_id uuid, user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.vehicle_grants g WHERE g.vehicle_id = p_vehicle AND g.user_id = p_user) $$;
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, taken_at timestamptz, is_duplicate boolean, is_superseded boolean,
  is_sensitive boolean, vision_gate_status text, vehicle_zone text, apple_ml_labels text[], ai_scan_metadata jsonb, work_session_id uuid, is_document boolean,
  redaction_level text DEFAULT 'none', image_url text, thumbnail_url text, photographer_attribution text, documented_by_user_id uuid);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY, vehicle_id uuid, session_date date);
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY, vehicle_id uuid, event_date date);
CREATE TABLE public.receipts(id uuid PRIMARY KEY, user_id uuid, vendor_name text, document_kind text, receipt_date date,
  is_superseded boolean, duplicate_of uuid, source_document_table text, source_document_id uuid);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY, receipt_id uuid, line_number int, description text, part_number text,
  total_price numeric, line_date date, hours numeric, performer text);
CREATE TABLE public.receipt_vehicle_links(id uuid PRIMARY KEY, receipt_id uuid, vehicle_id uuid, user_id uuid, status text, basis text,
  confidence numeric, page_date date, page_date_source text, retired_at timestamptz);
CREATE TABLE public.garage_derivation_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL,
  vehicle_id uuid, user_id uuid, subject_key text, conclusion text, evidence jsonb, superseded_at timestamptz,
  image_ids uuid[], confidence numeric, conclusion_detail jsonb, rationale text, created_at timestamptz DEFAULT now(),
  CONSTRAINT garage_derivation_evidence_kind_check CHECK (kind IN ('scene_label')));
-- (after this point the migrations are applied)
\ir ../migrations/20261111210500_receipt_work_reconciliation.sql
\ir ../migrations/20261113090000_receipt_work_context_reader.sql

DO $$
DECLARE
  V  constant uuid := '00000000-0000-0000-0000-0000000000a1';  -- private vehicle of U
  VP constant uuid := '00000000-0000-0000-0000-0000000000a2';  -- public vehicle of U
  U  constant uuid := '00000000-0000-0000-0000-0000000000b1';  -- owner / uploader / document custodian
  U2 constant uuid := '00000000-0000-0000-0000-0000000000b2';  -- another signed-in user
  UG constant uuid := '00000000-0000-0000-0000-0000000000b3';  -- granted access to V
  R  constant uuid := '00000000-0000-0000-0000-0000000000c1';
  I1 constant uuid := '00000000-0000-0000-0000-0000000000d1';
  I2 constant uuid := '00000000-0000-0000-0000-0000000000d2';
  I3 constant uuid := '00000000-0000-0000-0000-0000000000d3';
  L  constant uuid := '00000000-0000-0000-0000-0000000000e1';
  LP constant uuid := '00000000-0000-0000-0000-0000000000e2';
  F_OK   constant uuid := '00000000-0000-0000-0000-0000000000f1';
  F_SENS constant uuid := '00000000-0000-0000-0000-0000000000f2';
  F_HOLD constant uuid := '00000000-0000-0000-0000-0000000000f3';
  F_RED  constant uuid := '00000000-0000-0000-0000-0000000000f4';
  F_ELSE constant uuid := '00000000-0000-0000-0000-0000000000f5';  -- eligible but on another vehicle
  E1 constant uuid := '00000000-0000-0000-0000-000000000101';
  E1_OLD constant uuid := '00000000-0000-0000-0000-000000000102';
  E2_PRIOR constant uuid := '00000000-0000-0000-0000-000000000103';
  E2_GONE constant uuid := '00000000-0000-0000-0000-000000000104';
  E3 constant uuid := '00000000-0000-0000-0000-000000000105';
  EP constant uuid := '00000000-0000-0000-0000-000000000106';
  Q1 constant uuid := '00000000-0000-0000-0000-000000000201';
  Q3 constant uuid := '00000000-0000-0000-0000-000000000202';
  Q3_OLD constant uuid := '00000000-0000-0000-0000-000000000203';
  out jsonb; line jsonb; ev jsonb; t text;
BEGIN
  INSERT INTO vehicles VALUES (V, U, U, U, false, NULL), (VP, U, U, U, true, NULL);
  INSERT INTO vehicle_grants VALUES (V, UG);
  INSERT INTO receipts VALUES (R, U, 'Classic Industries', 'parts_service', '2025-01-01', false, NULL, 'vehicle_documents', '00000000-0000-0000-0000-0000000000ab');
  INSERT INTO receipt_vehicle_links VALUES (L, R, V, U, 'linked', 'cited_document', 0.9, '2025-01-01', 'receipt_date', NULL),
                                           (LP, R, VP, U, 'linked', 'cited_document', 0.9, '2025-01-01', 'receipt_date', NULL);
  INSERT INTO vehicle_images(id, vehicle_id, taken_at, vision_gate_status, is_sensitive, redaction_level, image_url, thumbnail_url, photographer_attribution, documented_by_user_id) VALUES
    (F_OK,   V, '2025-02-01 10:00Z', 'approved', false, 'none', 'https://x/ok.jpg', 'https://x/ok_t.jpg', 'shot by the owner''s phone', U),
    (F_SENS, V, '2025-02-01 11:00Z', 'approved', true,  'none', 'https://x/sens.jpg', NULL, NULL, U),
    (F_HOLD, V, '2025-02-01 12:00Z', 'review_needed', false, 'none', 'https://x/hold.jpg', NULL, NULL, U),
    (F_RED,  V, '2025-02-01 13:00Z', 'approved', false, 'blur', 'https://x/red.jpg', NULL, NULL, U),
    (F_ELSE, VP, '2025-02-01 14:00Z', 'approved', false, 'none', 'https://x/else.jpg', NULL, NULL, U);
  ev := jsonb_build_object('receipt_id', R, 'link_id', L, 'link_basis', 'cited_document', 'link_confidence', 0.9, 'vendor_name', 'Classic Industries',
        'total_price', 652.99, 'zone_photos_in_window', 2,
        'relationship', jsonb_build_object('kind', 'receipt_time_context', 'status', 'proposed', 'claims_attributed_to', 'document',
                                           'not_asserted', '["independent_corroboration","installation_proof","payment_proof","owner_sign"]'::jsonb),
        'printed_claims', jsonb_build_object('attributed_to', 'document', 'line_date', '2025-01-03', 'hours', 1.5, 'performer', 'JIM (as printed)'),
        'source_custody', jsonb_build_object('custodian_user_id', U, 'source_document_table', 'vehicle_documents', 'source_document_id', '00000000-0000-0000-0000-0000000000ab', 'page', NULL),
        'lineage', jsonb_build_object('receipt_id', R, 'source_document_table', 'vehicle_documents', 'source_document_id', '00000000-0000-0000-0000-0000000000ab', 'page', NULL));
  -- current line 1, with an older superseded version of itself
  INSERT INTO garage_derivation_evidence(id, kind, vehicle_id, user_id, subject_key, conclusion, confidence, image_ids, conclusion_detail, rationale, evidence, superseded_at) VALUES
    (E1_OLD, 'receipt_work_correlation', V, U, 'receipt_item:'||I1, 'undated_line', 0.2, '{}', '{}', 'old', ev || jsonb_build_object('item_id', I1, 'line_number', 1, 'description', 'OLD WORDS'), now()),
    (E1, 'receipt_work_correlation', V, U, 'receipt_item:'||I1, 'install_window_photographed', 0.57, ARRAY[F_OK, F_SENS, F_HOLD, F_RED, F_ELSE],
     '{"zone":"exterior","anchor_date":"2025-01-03","anchor_source":"line_date","days_to_first_photo":29}', 'proposed context: shared time window only',
     ev || jsonb_build_object('item_id', I1, 'line_number', 1, 'description', '70-76 SHAKER HOOD', 'part_number', '15136'), NULL),
  -- line 2: its prior conclusion and the active retraction that withdrew it
    (E2_PRIOR, 'receipt_work_correlation', V, U, 'receipt_item:'||I2, 'receipt_day_photographed', 0.4, ARRAY[F_OK], '{}', 'prior',
     ev || jsonb_build_object('item_id', I2, 'line_number', 2, 'description', 'HOOD PIN KIT'), now()),
    (E2_GONE, 'receipt_work_correlation', V, U, 'receipt_item:'||I2, 'source_withdrawn', 1, '{}', jsonb_build_object('reason', 'line_removed', 'prior_evidence_id', E2_PRIOR),
     'source withdrawn (line_removed)', jsonb_build_object('receipt_id', R, 'item_id', I2, 'link_id', L, 'withdrawn', jsonb_build_object('reason', 'line_removed', 'prior_evidence_id', E2_PRIOR)), NULL),
  -- line 3: claimed question
    (E3, 'receipt_work_correlation', V, U, 'receipt_item:'||I3, 'receipt_day_unphotographed', 0.3, '{}', '{}', 'r3',
     ev || jsonb_build_object('item_id', I3, 'line_number', 3, 'description', 'HOOD SCOOP DECAL'), NULL),
  -- the public vehicle's line
    (EP, 'receipt_work_correlation', VP, U, 'receipt_item:'||I1, 'install_window_photographed', 0.5, ARRAY[F_ELSE, F_OK], '{}', 'rp',
     ev || jsonb_build_object('item_id', I1, 'line_number', 1, 'link_id', LP, 'description', '70-76 SHAKER HOOD'), NULL);
  INSERT INTO evidence_judgment_requests(id, department, question_kind, subject_table, subject_id, vehicle_id, user_id, params, answer_schema, status,
                                         dedupe_key, question_hash, created_at, claimed_at, claimed_by, answered_at, answer, answer_agent, answer_model,
                                         producer_agent, producer_script, producer_version, run_id)
  VALUES (Q1, 'receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', I1, V, U, '{}', '{}', 'answered', 'k1', 'h1', now(), now(), 'worker-a', now(),
          jsonb_build_object('visible', 'yes', 'installed', 'cannot_tell', 'confidence', 0.6, 'image_id', F_SENS, 'quote', 'hood visible'), 'agent-x', 'model-y', 'p', 's', 'v', gen_random_uuid()),
         (Q3, 'receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', I3, V, U, '{}', '{}', 'claimed', 'k3', 'h3', now(), now(), 'worker-b', NULL, NULL, NULL, NULL, 'p', 's', 'v', gen_random_uuid()),
         (Q3_OLD, 'receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', I3, V, U, '{}', '{}', 'cancelled', 'k3o', 'h3o', now() - interval '1 day', NULL, NULL, NULL, NULL, NULL, NULL, 'p', 's', 'v', gen_random_uuid());

  -- execute is not granted to anon
  ASSERT NOT has_function_privilege('anon', 'public.get_vehicle_receipt_work_context(uuid, date)', 'EXECUTE'), 'anon can execute';
  ASSERT has_function_privilege('authenticated', 'public.get_vehicle_receipt_work_context(uuid, date)', 'EXECUTE'), 'authenticated cannot execute';

  -- owner
  PERFORM set_config('test.role', 'authenticated', true); PERFORM set_config('test.uid', U::text, true);
  out := get_vehicle_receipt_work_context(V);
  ASSERT (out ->> 'visible')::boolean AND (out ->> 'tied')::boolean, out::text;
  ASSERT jsonb_array_length(out -> 'lines') = 2, 'current lines: ' || (out -> 'lines')::text;   -- 1 and 3; not the withdrawn 2, not the superseded old 1
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(out -> 'lines') x WHERE x ->> 'conclusion' = 'source_withdrawn'
                     OR x ->> 'evidence_id' IN (E1_OLD::text, E2_PRIOR::text, E2_GONE::text) OR x ->> 'description' = 'OLD WORDS'), 'withdrawn or superseded shown as current';
  ASSERT jsonb_array_length(out -> 'withdrawn') = 1 AND out #>> '{withdrawn,0,reason}' = 'line_removed'
     AND out #>> '{withdrawn,0,status}' = 'withdrawn' AND (out #>> '{withdrawn,0,line_number}')::int = 2
     AND out #>> '{withdrawn,0,prior_conclusion}' = 'receipt_day_photographed', (out -> 'withdrawn')::text;
  SELECT x INTO line FROM jsonb_array_elements(out -> 'lines') x WHERE (x ->> 'line_number')::int = 1;
  ASSERT line ->> 'status' = 'proposed' AND line ->> 'conclusion' = 'install_window_photographed' AND (line ->> 'confidence')::numeric = 0.57, line::text;
  ASSERT line -> 'not_asserted' ? 'installation_proof' AND line -> 'not_asserted' ? 'payment_proof' AND line -> 'not_asserted' ? 'owner_sign', line::text;
  -- frames: only the eligible frame on this vehicle; sensitive, privacy hold, redacted and the other vehicle's frame hidden
  ASSERT jsonb_array_length(line -> 'frames') = 1 AND line #>> '{frames,0,image_id}' = F_OK::text, (line -> 'frames')::text;
  ASSERT (line ->> 'frames_hidden')::int = 4, line::text;
  ASSERT NOT (line::text LIKE '%' || F_SENS::text || '%' OR line::text LIKE '%' || F_HOLD::text || '%' OR line::text LIKE '%' || F_RED::text || '%'
              OR line::text LIKE '%hold.jpg%' OR line::text LIKE '%sens.jpg%'), 'hidden frame leaked: ' || line::text;
  -- lineage, printed claims, distinct labelled people fields
  ASSERT line #> '{lineage,page}' = 'null'::jsonb AND line #>> '{lineage,page_reason}' = 'line-to-page mapping unresolved'
     AND line #>> '{lineage,source_document_table}' = 'vehicle_documents' AND line #>> '{lineage,link_id}' = L::text
     AND line #>> '{lineage,item_id}' = I1::text AND (line #>> '{lineage,line_number}')::int = 1, (line -> 'lineage')::text;
  ASSERT line #>> '{printed,attributed_to}' = 'document' AND line #>> '{printed,performer}' = 'JIM (as printed)' AND (line #>> '{printed,hours}')::numeric = 1.5, (line -> 'printed')::text;
  ASSERT line #>> '{printed_performer,value}' = 'JIM (as printed)' AND line #>> '{printed_performer,label}' LIKE '%document%', line::text;
  ASSERT line #>> '{custodian,user_id}' = U::text AND line #>> '{custodian,label}' LIKE '%custody only%' AND (line #>> '{custodian,masked}')::boolean = false, line::text;
  ASSERT line #>> '{frames,0,photographer,attribution}' = 'shot by the owner''s phone' AND line #>> '{frames,0,photographer,documented_by_user_id}' = U::text, line::text;
  ASSERT (line ->> 'amount')::numeric = 652.99, line::text;
  ASSERT NOT (line::text ~* '"(owner|owned_by|paid_by|payer|installed_by|did_the_work)"'), 'ownership/payment/installation key: ' || line::text;
  -- judgment: answered; the answer cited a hidden frame, which is not revealed
  ASSERT line #>> '{judgment,status}' = 'answered' AND line #>> '{judgment,answer,visible}' = 'yes' AND line #> '{judgment,answer,image_id}' = 'null'::jsonb
     AND line #> '{judgment,holder}' = 'null'::jsonb, (line -> 'judgment')::text;
  SELECT x INTO line FROM jsonb_array_elements(out -> 'lines') x WHERE (x ->> 'line_number')::int = 3;
  ASSERT line #>> '{judgment,status}' = 'claimed' AND line #>> '{judgment,question_id}' = Q3::text AND line #>> '{judgment,holder,claimed_by}' = 'worker-b'
     AND line #>> '{judgment,holder,label}' LIKE '%not a person on the document%' AND line #> '{judgment,answer}' = 'null'::jsonb, (line -> 'judgment')::text;
  -- page date filter
  ASSERT jsonb_array_length(get_vehicle_receipt_work_context(V, '2025-01-01') -> 'lines') = 2, 'page date match';
  ASSERT jsonb_array_length(get_vehicle_receipt_work_context(V, '2025-06-01') -> 'lines') = 0, 'page date miss';

  -- granted access is tied
  PERFORM set_config('test.uid', UG::text, true);
  out := get_vehicle_receipt_work_context(V);
  ASSERT (out ->> 'tied')::boolean AND jsonb_array_length(out -> 'lines') = 2, out::text;

  -- another user: private vehicle reads nothing (RLS-equivalent gate)
  PERFORM set_config('test.uid', U2::text, true);
  out := get_vehicle_receipt_work_context(V);
  ASSERT NOT (out ->> 'visible')::boolean AND out -> 'lines' = '[]'::jsonb AND out -> 'withdrawn' = '[]'::jsonb, 'other user read: ' || out::text;
  ASSERT NOT (out::text LIKE '%SHAKER%' OR out::text LIKE '%' || U::text || '%'), out::text;
  -- another user on the public vehicle: visible, account ids and amount masked, frames still filtered
  out := get_vehicle_receipt_work_context(VP);
  ASSERT (out ->> 'visible')::boolean AND NOT (out ->> 'tied')::boolean AND jsonb_array_length(out -> 'lines') = 1, out::text;
  line := out #> '{lines,0}';
  ASSERT line #> '{custodian,user_id}' = 'null'::jsonb AND (line #>> '{custodian,masked}')::boolean AND line -> 'amount' = 'null'::jsonb, line::text;
  ASSERT jsonb_array_length(line -> 'frames') = 1 AND line #>> '{frames,0,image_id}' = F_ELSE::text AND (line ->> 'frames_hidden')::int = 1
     AND line #> '{frames,0,photographer,documented_by_user_id}' = 'null'::jsonb, line::text;
  ASSERT position(U::text IN out::text) = 0, 'account id leaked to an untied viewer: ' || out::text;

  -- anonymous: nothing even for the public vehicle
  PERFORM set_config('test.role', 'anon', true); PERFORM set_config('test.uid', '', true);
  out := get_vehicle_receipt_work_context(VP);
  ASSERT NOT (out ->> 'visible')::boolean AND out -> 'lines' = '[]'::jsonb, 'anon read: ' || out::text;

  -- a privacy change after the fact hides the frame at read time
  PERFORM set_config('test.role', 'authenticated', true); PERFORM set_config('test.uid', U::text, true);
  UPDATE vehicle_images SET vision_gate_status = 'review_needed' WHERE id = F_OK;
  SELECT x INTO line FROM jsonb_array_elements(get_vehicle_receipt_work_context(V) -> 'lines') x WHERE (x ->> 'line_number')::int = 1;
  ASSERT line -> 'frames' = '[]'::jsonb AND (line ->> 'frames_hidden')::int = 5, line::text;
  RAISE NOTICE 'receipt work context reader: gate, frames, withdrawals, lineage, labelled fields, masks, judgment, page filter';
END $$;

\ir revert_20261113090000_receipt_work_context_reader.sql
DO $$ BEGIN
  ASSERT to_regprocedure('public.get_vehicle_receipt_work_context(uuid, date)') IS NULL, 'revert left the reader';
  ASSERT to_regclass('public.evidence_judgment_requests') IS NOT NULL, 'revert touched the reconciliation tables';
END $$;
