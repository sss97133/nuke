-- reported_labor_hours_v1 check: PG17 contract. Chains the gate A test (the 8 labor keys ratified), then applies
-- 20261125163000 twice and drives reported_labor_statement_check through every refusal and one accept per source.
-- Fixture rows below live in a disposable test database only.
\set ON_ERROR_STOP on
\ir test_schema_proposal_key_gate.sql
\ir ../migrations/20261125163000_reported_labor_statement_check.sql
\ir ../migrations/20261125163000_reported_labor_statement_check.sql

-- guardrail-allow(center-key-fk): build_threads.vehicle_id: synthetic fixture table in a disposable test database
CREATE TABLE IF NOT EXISTS public.build_threads (id uuid PRIMARY KEY, vehicle_id uuid);
ALTER TABLE public.build_posts ADD COLUMN IF NOT EXISTS build_thread_id uuid;
ALTER TABLE public.auction_comments ADD COLUMN IF NOT EXISTS vehicle_id uuid;
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
INSERT INTO public.vehicles (id, description) VALUES
  ('30000000-0000-0000-0000-000000000001', 'Restored by the owner. I put 1,200 hours into the body and paint over four years. Sold new in Ohio.'),
  ('30000000-0000-0000-0000-000000000002', 'Generated summary. The shop spent 300 hours on the engine.');
UPDATE public.vehicles SET description_generated_at = now() WHERE id = '30000000-0000-0000-0000-000000000002';
INSERT INTO public.build_threads (id, vehicle_id) VALUES ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
INSERT INTO public.build_posts (id, content_text, build_thread_id) VALUES
  ('32000000-0000-0000-0000-000000000001', 'Update. Rebuilding the motor took about 40-60 hrs of my own time. More soon.', '31000000-0000-0000-0000-000000000001');
INSERT INTO public.auction_comments (id, comment_text, vehicle_id) VALUES
  ('33000000-0000-0000-0000-000000000001', 'Nice car. I had 2500 hours in my 1970 Pontiac GTO without the paint.', '30000000-0000-0000-0000-000000000001');

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
  PERFORM pg_temp.ok('31 values, each from its ratified key', (SELECT count(*) FROM public.labor_statement_values) = 31);
  PERFORM pg_temp.ok('time_basis has unknown; system_key has tires and unplaced',
    EXISTS (SELECT 1 FROM public.labor_statement_values WHERE property_key = 'labor_time_basis' AND value = 'unknown')
    AND (SELECT count(*) FROM public.labor_statement_values WHERE property_key = 'labor_system_key' AND value IN ('tires', 'unplaced')) = 2);

  -- accepts, one per source
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q);
  PERFORM pg_temp.ok('description accepted, thousands separator read: ' || r::text, (r->>'ok')::boolean
    AND r->>'source_vehicle_id' = v1::text AND r->>'contract' = 'reported_labor_hours_v1');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, task_q);
  PERFORM pg_temp.ok('build post range accepted, car through the thread: ' || r::text, (r->>'ok')::boolean
    AND r->>'source_vehicle_id' = v1::text);
  r := public.reported_labor_statement_check('auction_comments', ac, q3, 2500, NULL,
         '{"labor_scope":"whole_build","labor_speaker_role":"commenter_other_car","labor_statement_kind":"actual","labor_time_basis":"own","labor_stated_subject":"1970 Pontiac GTO"}');
  PERFORM pg_temp.ok('comment about another car accepted with its stated subject: ' || r::text, (r->>'ok')::boolean);

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
  PERFORM pg_temp.ok('low not printed refused', r->'reasons' ? 'low_not_in_quote');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 200, NULL, ok_q);
  PERFORM pg_temp.ok('a fragment of 1,200 is not a printed figure', r->'reasons' ? 'low_not_in_quote');
  r := public.reported_labor_statement_check('vehicles', v1, q1, NULL, NULL, ok_q);
  PERFORM pg_temp.ok('no low refused', r->'reasons' ? 'low_missing');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 60, 40, task_q);
  PERFORM pg_temp.ok('high below low refused', r->'reasons' ? 'high_below_low');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 80, task_q);
  PERFORM pg_temp.ok('high not printed refused', r->'reasons' ? 'high_not_in_quote');
  r := public.reported_labor_statement_check('build_posts', bp, q2, 40, 60, task_q - 'labor_system_key');
  PERFORM pg_temp.ok('task without a system refused', r->'reasons' ? 'system_key_missing');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q || '{"labor_system_key":"paint"}');
  PERFORM pg_temp.ok('whole build with a system refused', r->'reasons' ? 'system_key_on_whole_build');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q || '{"labor_time_basis":"billed"}');
  PERFORM pg_temp.ok('value outside the ratified list refused', r->'reasons' ? 'qualifier_value_unknown:labor_time_basis');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q || '{"labor_mood":"proud"}');
  PERFORM pg_temp.ok('unknown qualifier key refused', r->'reasons' ? 'qualifier_unknown:labor_mood');
  r := public.reported_labor_statement_check('vehicles', v1, q1, 1200, NULL, ok_q - 'labor_speaker_role');
  PERFORM pg_temp.ok('missing speaker role refused', r->'reasons' ? 'qualifier_missing:labor_speaker_role');
  r := public.reported_labor_statement_check('auction_comments', ac, q3, 2500, NULL, ok_q || '{"labor_stated_subject":"1973 Pontiac Firebird"}');
  PERFORM pg_temp.ok('stated subject not in the quote refused', r->'reasons' ? 'stated_subject_not_in_quote');
  r := public.reported_labor_statement_check('vehicles', v1, repeat('I put 1,200 hours into it. ', 12), 1200, NULL, ok_q);
  PERFORM pg_temp.ok('quote over 300 characters refused', r->'reasons' ? 'quote_too_long');
END $$;

DO $$ BEGIN
  PERFORM pg_temp.ok('anon cannot call the check', NOT has_function_privilege('anon',
    'public.reported_labor_statement_check(text,uuid,text,numeric,numeric,jsonb)', 'EXECUTE'));
  PERFORM pg_temp.ok('anon cannot read the values', NOT has_table_privilege('anon', 'public.labor_statement_values', 'SELECT'));
END $$;
\echo reported_labor_statement_check: ok
