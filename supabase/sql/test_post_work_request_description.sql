-- Disposable PG17 only. Proves 20261019234000_post_work_request_description.sql: with work_orders.description NOT NULL (as
-- live), post_work_request records the client's words verbatim as both description and scope_description.
-- Fixture and prior state: the post_work_request contract chain.
\set ON_ERROR_STOP on
\ir test_post_work_request.sql
SELECT NOT (pg_get_functiondef('public.post_work_request(uuid,text,uuid[],jsonb,timestamptz,text)'::regprocedure) ~ 'title, description, scope_description') AS need_desc \gset
\if :need_desc
\ir ../migrations/20261019234000_post_work_request_description.sql
\endif

-- Live shape: description is required.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixture_description_required') THEN
    ALTER TABLE work_orders ADD CONSTRAINT fixture_description_required CHECK (description IS NOT NULL) NOT VALID;
  END IF;
END $$;
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT post_work_request('e7300000-0000-0000-0000-000000000003','The radiator leaks coolant. Replace the cracked windshield.') AS dr \gset
RESET ROLE;
SELECT t_assert((SELECT description='The radiator leaks coolant. Replace the cracked windshield.' AND scope_description=description
  FROM work_orders WHERE id=((:'dr'::jsonb)->>'work_order_id')::uuid),'description NOT NULL: the client''s words verbatim in description and scope_description');
SELECT md5(pg_get_functiondef('public.post_work_request(uuid,text,uuid[],jsonb,timestamptz,text)'::regprocedure)) AS implementation_hash;
