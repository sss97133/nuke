-- Disposable PG17: a missing fact item whose photos were re-read blind without a legible result says so
-- (facet_doubt_examined_v1, through vehicle_fact_doubt_examined). Reuses the facet fixture and adds a fixture
-- evidence_judgment_requests table. Proves: a cannot_tell answer puts `examined` on the missing item and replaces the
-- stock "photo of ..." need; not_visible words it differently; the latest answer per key wins; a value answer, a
-- pending or cancelled request and another vehicle's answer add nothing; the quote never leaves the store; the item
-- stays missing; the two as-built transmission keys keep their own branch; a private car is hidden from anon; the
-- patch applies once. Every fixture is synthetic.
\set ON_ERROR_STOP on
\ir test_vehicle_facet_items.sql
RESET ROLE;

CREATE TABLE public.evidence_judgment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, question_kind text, status text, params jsonb,
  answer jsonb, answer_history jsonb, answered_at timestamptz, answer_model text);
ALTER TABLE public.evidence_judgment_requests ENABLE ROW LEVEL SECURITY;

INSERT INTO public.evidence_judgment_requests (vehicle_id, question_kind, status, params, answer, answer_history, answered_at, answer_model) VALUES
 -- heads: an older not_visible, then a cannot_tell read twice (one earlier answer in history): the latest wins
 ('10000000-0000-0000-0000-000000000001', 'fact_doubt', 'answered', '{"origin_ref":"facet_items:engine.current.heads:missing"}',
  '{"outcome":"not_visible","quote":"SECRETQUOTE old","image_ids":["c0000000-0000-0000-0000-000000000009"]}', NULL, '2026-11-01', 'reader-a'),
 ('10000000-0000-0000-0000-000000000001', 'fact_doubt', 'answered', '{"origin_ref":"facet_items:engine.current.heads:missing"}',
  '{"outcome":"cannot_tell","quote":"SECRETQUOTE 2 8H89","image_ids":["c0000000-0000-0000-0000-000000000001","c0000000-0000-0000-0000-000000000002"]}',
  '[{"outcome":"cannot_tell"}]', '2026-11-21', 'reader-b'),
 -- cam: not visible
 ('10000000-0000-0000-0000-000000000001', 'fact_doubt', 'answered', '{"origin_ref":"facet_items:engine.current.cam:missing"}',
  '{"outcome":"not_visible","image_ids":[]}', NULL, '2026-11-21', 'reader-b'),
 -- a value answer, a pending and a cancelled request, another kind, and an as-built transmission key: nothing shown
 ('10000000-0000-0000-0000-000000000001', 'fact_doubt', 'answered', '{"origin_ref":"facet_items:engine.current.induction:missing"}',
  '{"outcome":"value","value":"four-barrel","image_ids":[]}', NULL, '2026-11-21', 'reader-b'),
 ('10000000-0000-0000-0000-000000000001', 'fact_doubt', 'pending', '{"origin_ref":"facet_items:engine.current.block_date:missing"}',
  NULL, NULL, NULL, NULL),
 ('10000000-0000-0000-0000-000000000001', 'fact_doubt', 'cancelled', '{"origin_ref":"facet_items:engine.current.block_date:missing"}',
  '{"outcome":"cannot_tell"}', NULL, '2026-11-21', 'reader-b'),
 ('10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered', '{"origin_ref":"facet_items:engine.current.stroke:missing"}',
  '{"outcome":"cannot_tell"}', NULL, '2026-11-21', 'reader-b'),
 ('10000000-0000-0000-0000-000000000001', 'fact_doubt', 'answered', '{"origin_ref":"facet_items:transmission.as_built.model:missing"}',
  '{"outcome":"cannot_tell","image_ids":[]}', NULL, '2026-11-21', 'reader-b'),
 -- a private car
 ('10000000-0000-0000-0000-000000000004', 'fact_doubt', 'answered', '{"origin_ref":"facet_items:engine.current.heads:missing"}',
  '{"outcome":"cannot_tell","image_ids":[]}', NULL, '2026-11-21', 'reader-b');

\ir ../migrations/20261122070000_facet_fact_doubt_examined.sql
\ir ../migrations/20261122070000_facet_fact_doubt_examined.sql

SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
DO $$
DECLARE item jsonb; d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  PERFORM public.t_assert((length(d) - length(replace(d, 'facet_doubt_examined_v1_end', ''))) / length('facet_doubt_examined_v1_end') = 1,
    'branch patched once');
  item := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.heads');
  PERFORM public.t_assert(item->>'status' = 'missing' AND item->'value' = 'null'::jsonb, format('stays missing; got %s', item));
  PERFORM public.t_assert(item->>'needed' = 'a legible read of the marks already photographed', format('need names the read, not a photo; got %s', item->>'needed'));
  PERFORM public.t_assert(jsonb_array_length(item->'examined') = 1
      AND item#>>'{examined,0,result}' = 'photographed; marks not legible'
      AND item#>>'{examined,0,method}' = 'fact_doubt' AND item#>>'{examined,0,reads}' = '2'
      AND item#>>'{examined,0,reader}' = 'reader-b'
      AND item#>>'{examined,0,witness,id}' = 'c0000000-0000-0000-0000-000000000001'
      AND jsonb_array_length(item#>'{examined,0,witness,ids}') = 2,
    format('latest answer shown with reads and witness; got %s', item->'examined'));
  PERFORM public.t_assert(item::text !~ 'SECRETQUOTE|8H89', 'no words read from the photo leave the store');
  item := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.cam');
  PERFORM public.t_assert(item->>'status' = 'missing' AND item->>'needed' = 'a photo that shows this'
      AND item#>>'{examined,0,result}' = 'not visible in the photos on file', format('not_visible wording; got %s', item));
  item := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.induction');
  PERFORM public.t_assert(item->'examined' IS NULL, 'a value answer is not an examined note');
  item := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.block_date');
  PERFORM public.t_assert(item->'examined' IS NULL AND item->>'needed' NOT LIKE '%already photographed%', 'pending and cancelled requests add nothing');
  item := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.stroke');
  PERFORM public.t_assert(item->'examined' IS NULL, 'another question kind adds nothing');
  PERFORM public.t_assert((SELECT count(*) FROM public.vehicle_fact_doubt_examined('10000000-0000-0000-0000-000000000001')) = 3,
    'helper returns heads, cam and the as-built key');
  PERFORM public.t_assert((SELECT count(*) FROM jsonb_array_elements(public.vehicle_facet_items('10000000-0000-0000-0000-000000000001')->'transmission') x
      WHERE x->>'key' = 'transmission.as_built.model') = 1, 'the as-built transmission item is not duplicated');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.vehicle_fact_doubt_examined('10000000-0000-0000-0000-000000000004')),
    'a private car returns nothing to anon');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.vehicle_fact_doubt_examined('10000000-0000-0000-0000-000000000002')),
    'a car with no doubts returns nothing');
END $$;
RESET ROLE;
\echo facet_doubt_examined: ok
