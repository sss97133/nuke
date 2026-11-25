-- reported_labor_hours_v1 check: PG17 contract. Chains the gate A test (the 8 labor keys ratified), then applies
-- 20261125163000 twice and drives reported_labor_statement_check through every refusal and one accept per source.
-- Fixture rows below live in a disposable test database only.
\set ON_ERROR_STOP on
\ir test_schema_proposal_key_gate.sql
-- receipt_line_systems as production has it (a key table; three of its 18 live keys are enough here).
CREATE TABLE IF NOT EXISTS public.receipt_line_systems (system_key text PRIMARY KEY, label text NOT NULL, note text,
  created_at timestamptz DEFAULT now(), expects_operation boolean NOT NULL DEFAULT true);
INSERT INTO public.receipt_line_systems (system_key, label, expects_operation) VALUES
  ('engine', 'Engine', true), ('paint', 'Paint', true), ('hardware', 'Hardware', false) ON CONFLICT DO NOTHING;
\ir ../migrations/20261125163000_reported_labor_statement_check.sql
\ir ../migrations/20261125163000_reported_labor_statement_check.sql

-- guardrail-allow(center-key-fk): build_threads.vehicle_id: synthetic fixture table in a disposable test database
CREATE TABLE IF NOT EXISTS public.build_threads (id uuid PRIMARY KEY, vehicle_id uuid, author_handle text);
ALTER TABLE public.build_posts ADD COLUMN IF NOT EXISTS build_thread_id uuid;
ALTER TABLE public.auction_comments ADD COLUMN IF NOT EXISTS vehicle_id uuid, ADD COLUMN IF NOT EXISTS is_seller boolean;
ALTER TABLE public.build_posts ADD COLUMN IF NOT EXISTS author_handle text;
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
INSERT INTO public.vehicles (id, description) VALUES
  ('30000000-0000-0000-0000-000000000001', 'Restored by the owner. I put 1,200 hours into the body and paint over four years. Sold new in Ohio.'),
  ('30000000-0000-0000-0000-000000000002', 'Generated summary. The shop spent 300 hours on the engine.');
UPDATE public.vehicles SET description_generated_at = now() WHERE id = '30000000-0000-0000-0000-000000000002';
INSERT INTO public.build_threads (id, vehicle_id, author_handle) VALUES ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'builder_a');
INSERT INTO public.build_posts (id, content_text, build_thread_id, author_handle) VALUES
  ('32000000-0000-0000-0000-000000000001', 'Update. Rebuilding the motor took about 40-60 hrs of my own time. More soon.', '31000000-0000-0000-0000-000000000001', 'builder_a'),
  ('32000000-0000-0000-0000-000000000002', 'Following along. My own motor took about 80 hrs of evenings to rebuild.', '31000000-0000-0000-0000-000000000001', 'reader_b');
INSERT INTO public.auction_comments (id, comment_text, vehicle_id, is_seller) VALUES
  ('33000000-0000-0000-0000-000000000001', 'Nice car. I had 2500 hours in my 1970 Pontiac GTO without the paint.', '30000000-0000-0000-0000-000000000001', false),
  ('33000000-0000-0000-0000-000000000002', 'Did the LS3 swap last spring, it took me about 40 hours total.', '30000000-0000-0000-0000-000000000001', true),
  ('33000000-0000-0000-0000-000000000003', 'Bidding ends in 2 hours, good luck to all.', '30000000-0000-0000-0000-000000000001', true),
  ('33000000-0000-0000-0000-000000000004', 'Fresh gearbox in it, the T56 hours meter on the dash reads zero now.', '30000000-0000-0000-0000-000000000001', true);

DO $$
DECLARE r jsonb;
  ok_q jsonb := '{"labor_scope":"whole_build","labor_speaker_role":"owner_seller","labor_statement_kind":"actual","labor_time_basis":"own"}';
  task_q jsonb := '{"labor_scope":"task","labor_system_key":"engine","labor_speaker_role":"owner_seller","labor_statement_kind":"actual","labor_time_basis":"own"}';
  v1 uuid := '30000000-0000-0000-0000-000000000001';
  q1 text := 'I put 1,200 hours into the body and paint over four years';
  bp uuid := '32000000-0000-0000-0000-000000000001';
  q2 text := 'Rebuilding the motor took about 40-60 hrs of my own time';
  ac uuid := '33000000-0000-0000-0000-000000000001';
  q3 text := 'I had 2500 hours in my 1970 Pontiac GTO without the paint';
BEGIN
  PERFORM pg_temp.ok('14 prose values: 13 from the ratified keys, unknown from the open superseding proposal',
    (SELECT count(*) FROM public.labor_statement_values WHERE system_key IS NULL) = 14
    AND EXISTS (SELECT 1 FROM public.labor_statement_values l JOIN public.schema_proposals p ON p.id = l.proposal_id
                 WHERE l.property_key = 'labor_speaker_role' AND l.value = 'unknown' AND p.proposal_type = 'modify_property' AND p.status = 'open'));
  PERFORM pg_temp.ok('time_basis has unknown', EXISTS (SELECT 1 FROM public.labor_statement_values WHERE property_key = 'labor_time_basis' AND value = 'unknown'));
  PERFORM pg_temp.ok('tires is a receipt system key now', EXISTS (SELECT 1 FROM public.receipt_line_systems WHERE system_key = 'tires'));
  PERFORM pg_temp.ok('system values are exactly the receipt_line_systems keys, each by FK',
    (SELECT array_agg(value ORDER BY value) FROM public.labor_statement_values WHERE property_key = 'labor_system_key')
    = (SELECT array_agg(system_key ORDER BY system_key) FROM public.receipt_line_systems)
    AND NOT EXISTS (SELECT 1 FROM public.labor_statement_values WHERE property_key = 'labor_system_key' AND system_key IS DISTINCT FROM value));
  PERFORM pg_temp.ok('unplaced is not a system', NOT EXISTS (SELECT 1 FROM public.labor_statement_values WHERE value = 'unplaced'));
  PERFORM pg_temp.ok('one open superseding proposal for the system key text', (
    SELECT count(*) FROM public.schema_proposals p JOIN public.observation_properties o ON o.property_key = 'labor_system_key'
     WHERE p.proposal_type = 'modify_property' AND p.status = 'open' AND p.supersedes_proposal_id = o.proposed_by_proposal_id
       AND p.payload ->> 'values_from' = 'receipt_line_systems.system_key') = 1);
  PERFORM pg_temp.ok('the ratified system key text is untouched', (SELECT description FROM public.observation_properties
     WHERE property_key = 'labor_system_key') LIKE '%unplaced%');

  -- accepts, one per source
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q);
  PERFORM pg_temp.ok('description accepted, thousands separator read, listing text is the seller: ' || r::text, (r->>'ok')::boolean
    AND r->>'page_vehicle_id' = v1::text AND r->>'contract' = 'reported_labor_hours_v1' AND r->>'speaker_role' = 'owner_seller'
    AND NOT (r ? 'source_vehicle_id') AND NOT (r ? 'subject_vehicle_id'));
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, task_q);
  PERFORM pg_temp.ok('build post range accepted, page car through the thread, thread author is owner_seller: ' || r::text,
    (r->>'ok')::boolean AND r->>'page_vehicle_id' = v1::text AND r->>'speaker_role' = 'owner_seller');
  r := public.reported_labor_statement_check('build_posts', '32000000-0000-0000-0000-000000000002',
         'My own motor took about 80 hrs of evenings to rebuild', 80, NULL, task_q);
  PERFORM pg_temp.ok('another member''s post: role unknown whatever the reader said: ' || r::text,
    (r->>'ok')::boolean AND r->>'speaker_role' = 'unknown' AND r->>'speaker_role_read' = 'owner_seller');
  r := public.reported_labor_statement_check('auction_comments', ac, q3, 2500, NULL,
         '{"labor_scope":"whole_build","labor_speaker_role":"commenter_other_car","labor_statement_kind":"actual","labor_time_basis":"own","labor_stated_subject":"1970 Pontiac GTO"}');
  PERFORM pg_temp.ok('comment about another car: accepted, commenter_other_car from the quote, page car is not the subject: ' || r::text,
    (r->>'ok')::boolean AND r->>'speaker_role' = 'commenter_other_car' AND r->>'page_vehicle_id' = v1::text);
  r := public.reported_labor_statement_check('auction_comments', ac, q3, 2500, NULL, ok_q);
  PERFORM pg_temp.ok('a non-seller commenter read as owner_seller is unknown', (r->>'ok')::boolean AND r->>'speaker_role' = 'unknown');
  r := public.reported_labor_statement_check('auction_comments', ac, q3, 1970, NULL, ok_q);
  PERFORM pg_temp.ok('the model year is not the hours (2500 hours in my 1970 GTO)', r->'reasons' ? 'low_not_at_term');
  r := public.reported_labor_statement_check('auction_comments', '33000000-0000-0000-0000-000000000002',
         'Did the LS3 swap last spring, it took me about 40 hours total', 3, NULL, task_q);
  PERFORM pg_temp.ok('the 3 in LS3 is not the hours', r->'reasons' ? 'low_not_at_term');
  r := public.reported_labor_statement_check('auction_comments', '33000000-0000-0000-0000-000000000002',
         'Did the LS3 swap last spring, it took me about 40 hours total', 40, NULL, task_q);
  PERFORM pg_temp.ok('the figure at the term is: 40 hours, seller comment is owner_seller: ' || r::text,
    (r->>'ok')::boolean AND r->>'speaker_role' = 'owner_seller');
  r := public.reported_labor_statement_check('auction_comments', '33000000-0000-0000-0000-000000000003',
         'Bidding ends in 2 hours, good luck to all', 2, NULL, ok_q);
  PERFORM pg_temp.ok('time left is not labor', r->'reasons' ? 'quote_time_phrase');
  r := public.reported_labor_statement_check('auction_comments', '33000000-0000-0000-0000-000000000004',
         'the T56 hours meter on the dash reads zero now', 56, NULL, task_q);
  PERFORM pg_temp.ok('a number glued to letters is not a figure (T56 hours)', r->'reasons' ? 'low_not_at_term');

  -- refusals
  r := public.reported_labor_statement_check('vehicles', '30000000-0000-0000-0000-000000000002', 'The shop spent 300 hours on the engine', 300, NULL, ok_q);
  PERFORM pg_temp.ok('generated description refused', r->'reasons' ? 'row_generated');
  r := public.reported_labor_statement_check('vehicle_observations', v1, q1, 1200, NULL, ok_q);
  PERFORM pg_temp.ok('source table not allowed', r->'reasons' ? 'source_not_allowed');
  r := public.reported_labor_statement_check('vehicles', '30000000-0000-0000-0000-0000000000ff', q1, 1200, NULL, ok_q);
  PERFORM pg_temp.ok('missing row refused', r->'reasons' ? 'row_missing');
  r := public.reported_labor_statement_check('vehicles', v1, '1,200 hours', 1200, NULL, ok_q);
  PERFORM pg_temp.ok('short quote refused (rule row floor)', r->'reasons' ? 'quote_too_short');
  r := public.reported_labor_statement_check('vehicles', v1, 'Restored by the owner. I put 1,200', 1200, NULL, ok_q);
  PERFORM pg_temp.ok('quote with no hour term refused', r->'reasons' ? 'quote_no_term');
  r := public.reported_labor_statement_check('vehicles', v1, 'put 1,200 hours into the body and paint over four year', 1200, NULL, ok_q);
  PERFORM pg_temp.ok('quote cut inside a word refused', r->'reasons' ? 'quote_not_in_row');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1300, NULL, ok_q);
  PERFORM pg_temp.ok('low not printed refused', r->'reasons' ? 'low_not_at_term');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 200, NULL, ok_q);
  PERFORM pg_temp.ok('a fragment of 1,200 is not a printed figure', r->'reasons' ? 'low_not_at_term');
  r := public.reported_labor_statement_check('vehicles', v1, q1, NULL, NULL, ok_q);
  PERFORM pg_temp.ok('no low refused', r->'reasons' ? 'low_missing');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 60, 40, task_q);
  PERFORM pg_temp.ok('high below low refused', r->'reasons' ? 'high_below_low');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 80, task_q);
  PERFORM pg_temp.ok('high not printed refused', r->'reasons' ? 'high_not_at_term');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, task_q - 'labor_system_key');
  PERFORM pg_temp.ok('task without a system refused', r->'reasons' ? 'system_key_missing');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q || '{"labor_system_key":"paint"}');
  PERFORM pg_temp.ok('whole build with a system refused', r->'reasons' ? 'system_key_on_whole_build');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, (task_q - 'labor_system_key') || '{"labor_system_key":"unplaced"}');
  PERFORM pg_temp.ok('unplaced refused as a system', r->'reasons' ? 'qualifier_value_unknown:labor_system_key');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, (task_q - 'labor_system_key') || '{"labor_system_key":"tires"}');
  PERFORM pg_temp.ok('tires accepted as a system: ' || r::text, (r->>'ok')::boolean);
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, (task_q - 'labor_system_key') || '{"labor_system_key_null_reason":"names_no_one_system"}');
  PERFORM pg_temp.ok('task with a null system and its reason accepted: ' || r::text, (r->>'ok')::boolean);
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, task_q || '{"labor_system_key_null_reason":"names_no_one_system"}');
  PERFORM pg_temp.ok('a system and a null reason together refused', r->'reasons' ? 'system_key_and_null_reason');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, (task_q - 'labor_system_key') || '{"labor_system_key_null_reason":"too_hard"}');
  PERFORM pg_temp.ok('a null reason outside its table refused', r->'reasons' ? 'qualifier_value_unknown:labor_system_key_null_reason');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q || '{"labor_system_key_null_reason":"names_no_one_system"}');
  PERFORM pg_temp.ok('whole build with a null reason refused', r->'reasons' ? 'system_key_on_whole_build');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q || '{"labor_time_basis":"billed"}');
  PERFORM pg_temp.ok('value outside the ratified list refused', r->'reasons' ? 'qualifier_value_unknown:labor_time_basis');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q || '{"labor_mood":"proud"}');
  PERFORM pg_temp.ok('unknown qualifier key refused', r->'reasons' ? 'qualifier_unknown:labor_mood');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q - 'labor_statement_kind');
  PERFORM pg_temp.ok('missing statement kind refused', r->'reasons' ? 'qualifier_missing:labor_statement_kind');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q - 'labor_speaker_role');
  PERFORM pg_temp.ok('no reader role: derived from the source', (r->>'ok')::boolean AND r->>'speaker_role' = 'owner_seller');
  r := public.reported_labor_statement_check('auction_comments', ac, q3, 2500, NULL, ok_q || '{"labor_stated_subject":"1973 Pontiac Firebird"}');
  PERFORM pg_temp.ok('stated subject not in the quote refused', r->'reasons' ? 'stated_subject_not_in_quote');
  r := public.reported_labor_statement_check('vehicles', v1, repeat('I put 1,200 hours into it. ', 12), 1200, NULL, ok_q);
  PERFORM pg_temp.ok('quote over 300 characters refused', r->'reasons' ? 'quote_too_long');
END $$;

-- Negative cases (lead ruling 2026-11-25): a statement lands as the writer will land it, vehicle_id NULL with the car
-- in structured_data.source_vehicle_id, and never reaches the two public readers that read every work_record row on a
-- car. Both readers are their production definitions (pg_get_viewdef / pg_get_functiondef, read 2026-11-25).
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true, ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_id uuid, ADD COLUMN IF NOT EXISTS owner_id uuid, ADD COLUMN IF NOT EXISTS uploaded_by uuid;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.public_text(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULL ELSE left(btrim(p), 300) END $$;
-- guardrail-allow(center-key-fk): vehicle_observations.id: the table's own primary key, not a reference (fixture stub)
CREATE TABLE IF NOT EXISTS public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id), kind public.observation_kind NOT NULL, observed_at timestamptz DEFAULT now(),
  is_superseded boolean DEFAULT false, structured_data jsonb);
CREATE VIEW public.proj_disposition AS
SELECT id AS vehicle_id,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM vehicle_observations o
              WHERE ((o.vehicle_id = v.id) AND (o.kind = 'sale_result'::observation_kind) AND (COALESCE(o.is_superseded, false) = false) AND (COALESCE((o.structured_data ->> 'outcome'::text), 'sold'::text) <> 'fell_through'::text)))) THEN 'sold'::text
            WHEN (EXISTS ( SELECT 1
               FROM vehicle_observations o
              WHERE ((o.vehicle_id = v.id) AND (o.kind = 'sale_result'::observation_kind) AND ((o.structured_data ->> 'outcome'::text) = 'fell_through'::text)))) THEN 'deal_fell_through'::text
            WHEN (EXISTS ( SELECT 1
               FROM vehicle_observations o
              WHERE ((o.vehicle_id = v.id) AND (o.kind = 'listing'::observation_kind) AND (NOT (EXISTS ( SELECT 1
                       FROM vehicle_observations o2
                      WHERE ((o2.vehicle_id = v.id) AND (o2.kind = 'sale_result'::observation_kind) AND (o2.observed_at >= o.observed_at)))))))) THEN 'listed'::text
            WHEN (EXISTS ( SELECT 1
               FROM vehicle_observations o
              WHERE ((o.vehicle_id = v.id) AND (o.kind = 'provenance'::observation_kind) AND ((o.structured_data ->> 'kind'::text) = 'contract_build'::text)))) THEN 'contract_build'::text
            WHEN (EXISTS ( SELECT 1
               FROM vehicle_observations o
              WHERE ((o.vehicle_id = v.id) AND (o.kind = 'work_record'::observation_kind)))) THEN 'in_progress'::text
            WHEN (EXISTS ( SELECT 1
               FROM vehicle_observations o
              WHERE ((o.vehicle_id = v.id) AND (o.kind = 'ownership'::observation_kind)))) THEN 'acquired_idle'::text
            ELSE 'unknown'::text
        END AS disposition,
    ( SELECT max(vehicle_observations.observed_at) AS max
           FROM vehicle_observations
          WHERE ((vehicle_observations.vehicle_id = v.id) AND (vehicle_observations.kind = ANY (ARRAY['sale_result'::observation_kind, 'listing'::observation_kind, 'ownership'::observation_kind, 'work_record'::observation_kind, 'provenance'::observation_kind])))) AS as_of
   FROM vehicles v;
CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid)
 RETURNS TABLE(observation_id uuid, done_on date, item text, category text, supplier text, labor_minutes numeric, build_stage text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$;
  SELECT o.id,
         COALESCE(CASE WHEN o.structured_data->>'transaction_date' ~ '^\d{4}-\d{2}-\d{2}'
                       THEN left(o.structured_data->>'transaction_date', 10)::date END,
                  o.observed_at::date),
         public.public_text(COALESCE(o.structured_data->>'item', o.structured_data->>'task',
                                     o.structured_data->>'title', o.structured_data->>'work_performed')),
         public.public_text(o.structured_data->>'category'),
         public.public_text(o.structured_data->>'supplier'),
         CASE WHEN o.structured_data->>'labor_minutes' ~ '^\d+(\.\d+)?$'
              THEN (o.structured_data->>'labor_minutes')::numeric END,
         public.public_text(COALESCE(o.structured_data->>'build_stage', o.structured_data->>'phase'))
  FROM public.vehicle_observations o
  JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE o.vehicle_id = p_vehicle_id
    AND o.kind = 'work_record'
    AND o.is_superseded IS NOT TRUE
    AND COALESCE(o.structured_data->>'contract','') <> 'visual_work_v1'
    AND jsonb_typeof(o.structured_data) = 'object'
    AND NOT (o.structured_data ?| ARRAY['receipt_id', 'invoice_number', 'file_url'])
    AND COALESCE(o.structured_data->>'subject', '') <> 'client_invoice'
    AND COALESCE(o.structured_data->>'item', o.structured_data->>'task', o.structured_data->>'title',
                 o.structured_data->>'work_performed', o.structured_data->>'category') IS NOT NULL
    AND v.deleted_at IS NULL
    AND (v.is_public = true
         OR v.user_id = (SELECT auth.uid())
         OR v.owner_id = (SELECT auth.uid())
         OR v.uploaded_by = (SELECT auth.uid()))
  ORDER BY 2 DESC NULLS LAST, 1;
$function$;
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
INSERT INTO public.vehicle_observations (vehicle_id, kind, structured_data) VALUES
  (NULL, 'work_record', jsonb_build_object('contract', 'reported_labor_hours_v1', 'page_vehicle_id', '30000000-0000-0000-0000-000000000001',
    'source_table', 'auction_comments', 'source_row_id', '33000000-0000-0000-0000-000000000001', 'labor_scope', 'whole_build',
    'labor_speaker_role', 'commenter_other_car', 'labor_stated_subject', '1970 Pontiac GTO', 'task', 'the other car''s build'));
DO $$
DECLARE v1 uuid := '30000000-0000-0000-0000-000000000001';
BEGIN
  PERFORM pg_temp.ok('a commenter_other_car statement reaches no car', NOT EXISTS (
    SELECT 1 FROM public.vehicle_observations WHERE structured_data ->> 'contract' = 'reported_labor_hours_v1' AND vehicle_id IS NOT NULL));
  PERFORM pg_temp.ok('statement row: proj_disposition unchanged',
    (SELECT disposition FROM public.proj_disposition WHERE vehicle_id = v1) = 'unknown');
  PERFORM pg_temp.ok('statement row: not on the public build log', NOT EXISTS (SELECT 1 FROM public.vehicle_build_log_public(v1)));
  -- control: the same row with vehicle_id set reaches both, so the fixtures are sensitive to it
  UPDATE public.vehicle_observations SET vehicle_id = v1 WHERE structured_data ->> 'contract' = 'reported_labor_hours_v1';
  PERFORM pg_temp.ok('control: with vehicle_id set it would mark the car in_progress',
    (SELECT disposition FROM public.proj_disposition WHERE vehicle_id = v1) = 'in_progress');
  PERFORM pg_temp.ok('control: with vehicle_id set it would print on the build log', EXISTS (SELECT 1 FROM public.vehicle_build_log_public(v1)));
  UPDATE public.vehicle_observations SET vehicle_id = NULL WHERE structured_data ->> 'contract' = 'reported_labor_hours_v1';
END $$;

DO $$ BEGIN
  PERFORM pg_temp.ok('anon cannot call the check', NOT has_function_privilege('anon',
    'public.reported_labor_statement_check(text,uuid,text,numeric,numeric,jsonb)', 'EXECUTE'));
  PERFORM pg_temp.ok('anon cannot read the values', NOT has_table_privilege('anon', 'public.labor_statement_values', 'SELECT'));
END $$;
\echo reported_labor_statement_check: ok
