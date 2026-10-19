-- Disposable PG17 only. Proves 20261020081000_publish_work_order.sql: the customer or vehicle owner publishes an existing
-- job; requirements come from its open operations through the reviewed template (or one skill requirement quoting the
-- operation), operations from its own description only when it has none; names or contact details refuse 'open' and are
-- never quoted; visibility changes only with the Sign; unpublish takes it off the open list and keeps the requirements.
-- Fixture and prior state: the post_work_request chain (client c1 owns public truck V3 and private car V4).
\set ON_ERROR_STOP on
\ir test_post_work_request.sql
\ir ../migrations/20261020081000_publish_work_order.sql

-- Legacy jobs on the client's public truck (no request Sign, visibility unset).
INSERT INTO work_orders(id,vehicle_id,customer_id,status,title,description) VALUES
 ('e7d00000-0000-0000-0000-000000000001','e7300000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-0000000000c1','pending',
  'Exhaust and seat','The exhaust leaks at the manifold. Recover the torn seat.'),
 ('e7d00000-0000-0000-0000-000000000002','e7300000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-0000000000c1','pending',
  'Rust','Fix the cab corner rust. Call me at 702-555-0199.'),
 ('e7d00000-0000-0000-0000-000000000003','e7300000-0000-0000-0000-000000000003',NULL,'in_progress','Drivetrain service','Drivetrain service work'),
 ('e7d00000-0000-0000-0000-000000000004','e7300000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-0000000000c1','completed','Done job','Wash it.');
ALTER TABLE work_order_line_items DROP CONSTRAINT IF EXISTS work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('e7e00000-0000-0000-0000-000000000001','e7d00000-0000-0000-0000-000000000003',1,'replace','Transmission pan gasket replacement','pending'),
 ('e7e00000-0000-0000-0000-000000000002','e7d00000-0000-0000-0000-000000000003',2,'other','Motor mount replacement','in_progress'),
 ('e7e00000-0000-0000-0000-000000000003','e7d00000-0000-0000-0000-000000000003',3,'other','Speedometer cable','complete'),
 ('e7e00000-0000-0000-0000-000000000004','e7d00000-0000-0000-0000-000000000003',4,'other','Ask Bob at bob@example.invalid about the shifter','pending');
CREATE FUNCTION public.pub_rows(p uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM jsonb_array_elements(open_requirements_read(NULL,100,NULL)->'rows') r WHERE r->>'work_order_id' = p::text $$;
GRANT EXECUTE ON FUNCTION public.pub_rows(uuid) TO anon, authenticated;

SELECT t_assert(has_function_privilege('authenticated','publish_work_order(uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','publish_work_order(uuid,text)','EXECUTE')
  AND has_function_privilege('authenticated','unpublish_work_order(uuid)','EXECUTE') AND NOT has_function_privilege('anon','unpublish_work_order(uuid)','EXECUTE'),
  'grants: Signs for signed-in parties only');

SET ROLE authenticated;
-- 1. Refusals.
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT t_assert(t_refused_with($q$SELECT publish_work_order('e7d00000-0000-0000-0000-000000000001','open')$q$,'unavailable'), 'a stranger cannot publish');
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(t_refused_with($q$SELECT publish_work_order('e7d00000-0000-0000-0000-000000000004','open')$q$,'Only an open job'), 'a completed job cannot be published');
SELECT t_assert(t_refused_with($q$SELECT publish_work_order('e7d00000-0000-0000-0000-000000000001','public')$q$,'Visibility'), 'visibility vocabulary');
SELECT t_assert(t_refused_with($q$SELECT publish_work_order('e7d00000-0000-0000-0000-000000000002','open')$q$,'contact'), 'open refused when the description has contact details');

-- 2. A job with no operations: operations quote its description; template requirements; listed.
SELECT publish_work_order('e7d00000-0000-0000-0000-000000000001','open') AS p1 \gset
SELECT t_assert((:'p1'::jsonb) @> '{"visibility":"open","previous_visibility":null,"listed_in_open_requirements":true,"scope_invented":false,
  "payment_authorized":false,"providers_notified":false,"status_changed":false,
  "operations_derived":[{"line_number":1,"text":"The exhaust leaks at the manifold.","basis":"quoted_from_description"},
                        {"line_number":2,"text":"Recover the torn seat.","basis":"quoted_from_description"}]}'
  AND (:'p1'::jsonb)->'requirements_derived' @> '[{"kind":"skill","description":"Exhaust repair and fabrication","basis":"reviewed_template"},
    {"kind":"facility","description":"Vehicle lift","basis":"reviewed_template"},{"kind":"skill","description":"Automotive upholstery","basis":"reviewed_template"}]',
  'operations quoted from the description; reviewed template requirements');
SELECT t_assert(pub_rows('e7d00000-0000-0000-0000-000000000001') = jsonb_array_length((:'p1'::jsonb)->'requirements_derived'), 'every derived requirement is listed open');
RESET ROLE;
SELECT t_assert((SELECT bool_and(li.source_observation_id IS NOT NULL AND li.basis_field = 'description' AND li.basis_excerpt = li.task_description)
  FROM work_order_line_items li WHERE li.work_order_id = 'e7d00000-0000-0000-0000-000000000001'), 'derived operations carry the sanctioned provenance');
SET ROLE authenticated;
SELECT publish_work_order('e7d00000-0000-0000-0000-000000000001','open') AS p1b \gset
SELECT t_assert((:'p1b'::jsonb)->'operations_derived' = '[]'::jsonb AND (:'p1b'::jsonb)->'requirements_derived' = '[]'::jsonb
  AND ((:'p1b'::jsonb)->>'requirements_total')::int = jsonb_array_length((:'p1'::jsonb)->'requirements_derived'), 'publishing again adds nothing');

-- 3. Contact-laden job: invite_only allowed, nothing quoted, not listed.
SELECT publish_work_order('e7d00000-0000-0000-0000-000000000002','invite_only') AS p2 \gset
SELECT t_assert((:'p2'::jsonb) @> '{"visibility":"invite_only","listed_in_open_requirements":false,"operations_derived":[],"requirements_derived":[]}'
  AND (:'p2'::jsonb)->'skipped' @> '[{"reason":"description holds names or contact details; no operations derived"}]'
  AND pub_rows('e7d00000-0000-0000-0000-000000000002') = 0, 'invite_only: no contact text quoted, not listed');

-- 4. A job with operations, published by the vehicle owner (no customer): open operations only, personal operation skipped.
SELECT publish_work_order('e7d00000-0000-0000-0000-000000000003','open') AS p3 \gset
SELECT t_assert((:'p3'::jsonb) @> '{"visibility":"open","operations_derived":[],"skipped":[{"line_item_id":"e7e00000-0000-0000-0000-000000000004","reason":"operation text holds names or contact details"}]}'
  AND (:'p3'::jsonb)->'requirements_derived' @> '[{"line_item_id":"e7e00000-0000-0000-0000-000000000001","kind":"skill"},
    {"line_item_id":"e7e00000-0000-0000-0000-000000000002","kind":"skill","description":"Motor mount replacement","basis":"operation_text"}]'
  AND NOT (:'p3'::jsonb)::text ~ '(e7e00000-0000-0000-0000-000000000003|bob@example)', 'open operations get requirements; completed and contact-laden ones do not');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM work_order_resource_requirements r WHERE r.work_order_id = 'e7d00000-0000-0000-0000-000000000003'
  AND r.basis_excerpt = 'Motor mount replacement') = 1, 'the requirement quotes its operation');
SET ROLE authenticated;

-- 5. Unpublish keeps requirements and leaves the open list; visibility never changes without the Sign.
SELECT unpublish_work_order('e7d00000-0000-0000-0000-000000000001') AS u1 \gset
SELECT t_assert((:'u1'::jsonb) @> '{"visibility":"invite_only","previous_visibility":"open","requirements_kept":true}'
  AND pub_rows('e7d00000-0000-0000-0000-000000000001') = 0, 'unpublished: off the open list');
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT t_assert(t_refused_with($q$SELECT unpublish_work_order('e7d00000-0000-0000-0000-000000000003')$q$,'unavailable'), 'a stranger cannot unpublish');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM work_order_resource_requirements WHERE work_order_id = 'e7d00000-0000-0000-0000-000000000001')
  = jsonb_array_length((:'p1'::jsonb)->'requirements_derived'), 'requirements kept as testimony');
SELECT t_assert(t_refused_with($q$UPDATE work_orders SET request_visibility='open' WHERE id='e7d00000-0000-0000-0000-000000000001'$q$,'immutable'),
  'a direct visibility change without the Sign is refused');
SELECT t_assert((SELECT count(*) FROM vehicle_observations WHERE extraction_method = 'work_order_publication_sign_v1'
  AND source_identifier LIKE 'work_order_publication:%') = 5, 'each publish/unpublish recorded a Sign observation');
