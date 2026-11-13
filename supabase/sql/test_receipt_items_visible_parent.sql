-- Disposable local PG17 only: the production shape has RLS and SELECT grants,
-- but no receipt_items read policy. Reproduce that failure before the repair.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int/10000<>17 THEN
  RAISE EXCEPTION 'Disposable PG17 database required';
 END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('test.auth_uid',true),'')::uuid $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE public.receipts(id uuid PRIMARY KEY,user_id uuid,delegate_id uuid,is_superseded boolean DEFAULT false);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY,receipt_id uuid REFERENCES public.receipts,description text);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_parent_reader ON public.receipts FOR SELECT TO authenticated
 USING (user_id=auth.uid() OR delegate_id=auth.uid());
GRANT SELECT ON public.receipts,public.receipt_items TO authenticated,anon;
CREATE FUNCTION public.t_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label;
END $$;
INSERT INTO public.receipts VALUES
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',false),
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',NULL,false),
 ('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',NULL,true);
INSERT INTO public.receipt_items VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Fixture part'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Other account part'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','Historic line');
SET ROLE authenticated;
SELECT set_config('test.auth_uid','20000000-0000-4000-8000-000000000001',false);
SELECT t_assert((SELECT count(*)=2 FROM receipts) AND (SELECT count(*)=0 FROM receipt_items),
 'reproduce visible receipt headers with hidden parsed lines');
RESET ROLE;
\ir ../migrations/20261030223007_receipt_items_visible_parent.sql
SET ROLE authenticated;
SELECT t_assert((SELECT count(*)=2 FROM receipt_items)
 AND NOT EXISTS(SELECT FROM receipt_items WHERE description='Other account part'),
 'owner reads its own current and historic lines only');
SELECT set_config('test.auth_uid','20000000-0000-4000-8000-000000000002',false);
SELECT t_assert((SELECT count(*)=1 FROM receipt_items) AND (SELECT description='Other account part' FROM receipt_items),
 'other account has no cross-account line disclosure');
SELECT set_config('test.auth_uid','20000000-0000-4000-8000-000000000003',false);
SELECT t_assert((SELECT count(*)=1 FROM receipt_items), 'existing parent delegate can read that parent line');
RESET ROLE;
UPDATE public.receipts SET delegate_id=NULL WHERE id='10000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT t_assert((SELECT count(*)=0 FROM receipt_items), 'withdrawing parent access immediately withdraws line access');
SELECT set_config('test.auth_uid','20000000-0000-4000-8000-000000000004',false);
SELECT t_assert((SELECT count(*)=0 FROM receipt_items), 'an unrelated signed-in account cannot read lines');
SET ROLE anon;
SELECT set_config('test.auth_uid','',false);
SELECT t_assert((SELECT count(*)=0 FROM receipt_items), 'anonymous line reads remain denied');
RESET ROLE;
SELECT t_assert(NOT has_table_privilege('authenticated','receipt_items','INSERT')
 AND NOT has_table_privilege('authenticated','receipt_items','UPDATE')
 AND NOT has_table_privilege('authenticated','receipt_items','DELETE'), 'repair adds no line write authority');
