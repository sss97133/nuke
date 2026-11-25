-- Disposable PG17 contract for 20261125031500_receipt_vendor_label_rule (receipt_vendor_public_v2.3). Synthetic rows only.
-- Builds on the vendor-label key contract (which ends with 20261125011500 applied), adds the register's domain column and
-- supply_vendor_domain_verifications as 20261020060000 made them, applies the migration twice, and asserts for an
-- untied caller:
--   * a non-public organisation whose register domain has a 'verified' fetch is named;
--   * a 'not_verified' fetch, a fetch of another domain, or no register row leave it 'Seller not identified';
--   * turning a rule row off stops naming by that rule (both rules);
--   * tied viewers still get the vendor as read; the revert restores 20261125011500's body.
\set ON_ERROR_STOP on
\ir test_receipt_vendor_label_key.sql
RESET ROLE;
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);
ALTER TABLE public.supply_vendors ADD COLUMN IF NOT EXISTS domain text;
CREATE TABLE IF NOT EXISTS public.supply_vendor_domain_verifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_slug text NOT NULL
  REFERENCES public.supply_vendors(vendor_slug), domain text NOT NULL, verdict text NOT NULL);
CREATE TABLE public.def_before AS SELECT md5(pg_get_functiondef('public.receipt_vendor_label(uuid,text,boolean)'::regprocedure)) h;

\ir ../migrations/20261125031500_receipt_vendor_label_rule.sql
\ir ../migrations/20261125031500_receipt_vendor_label_rule.sql

-- The body shop (e001, receipt c1, register slug speedway) is a staged organisation: not public.
UPDATE public.organizations SET is_public = false WHERE id = '00000000-0000-0000-0000-00000000e001';
CREATE FUNCTION pg_temp.anon_label() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; BEGIN
  PERFORM set_config('test.role', 'anon', false); PERFORM set_config('test.uid', '', false);
  SELECT vendor_name INTO v FROM public.receipts_public_summary WHERE id = '00000000-0000-0000-0000-0000000000c1';
  PERFORM set_config('test.role', '', false);
  RETURN v; END $$;
SELECT public.assert(pg_temp.anon_label() = 'Seller not identified', 'staged, no domain: not named');
UPDATE public.supply_vendors SET domain = 'speedway.example' WHERE vendor_slug = 'speedway';
INSERT INTO public.supply_vendor_domain_verifications (vendor_slug, domain, verdict) VALUES ('speedway', 'speedway.example', 'not_verified');
SELECT public.assert(pg_temp.anon_label() = 'Seller not identified', 'a not_verified fetch does not name it');
INSERT INTO public.supply_vendor_domain_verifications (vendor_slug, domain, verdict) VALUES ('speedway', 'other.example', 'verified');
SELECT public.assert(pg_temp.anon_label() = 'Seller not identified', 'a verified fetch of another domain does not name it');
INSERT INTO public.supply_vendor_domain_verifications (vendor_slug, domain, verdict) VALUES ('speedway', 'speedway.example', 'verified');
SELECT public.assert(pg_temp.anon_label() = 'Speedway Parts & Body', 'a verified register domain names it: ' || coalesce(pg_temp.anon_label(), 'null'));
UPDATE public.vendor_label_rules SET enabled = false WHERE rule_key = 'verified_register_domain';
SELECT public.assert(pg_temp.anon_label() = 'Seller not identified', 'rule row off: not named');
UPDATE public.organizations SET is_public = true WHERE id = '00000000-0000-0000-0000-00000000e001';
SELECT public.assert(pg_temp.anon_label() = 'Speedway Parts & Body', 'public organisation named by the other rule');
UPDATE public.vendor_label_rules SET enabled = false WHERE rule_key = 'public_organization';
SELECT public.assert(pg_temp.anon_label() = 'Seller not identified', 'both rule rows off: not named');
UPDATE public.vendor_label_rules SET enabled = true;
SELECT public.assert(public.receipt_vendor_label('00000000-0000-0000-0000-0000000000c1', 'raw vendor string', true) = 'raw vendor string',
                     'tied viewers get the vendor as read');
SELECT public.assert(has_table_privilege('anon', 'public.vendor_label_rules', 'SELECT')
                     AND NOT has_table_privilege('anon', 'public.vendor_label_rules', 'UPDATE'), 'anon reads the rule rows, writes none');
\ir revert_20261125031500_receipt_vendor_label_rule.sql
SELECT public.assert(md5(pg_get_functiondef('public.receipt_vendor_label(uuid,text,boolean)'::regprocedure)) = (SELECT h FROM public.def_before),
                     'revert restores 20261125011500');
SELECT public.assert(to_regclass('public.vendor_label_rules') IS NULL, 'revert drops the rule rows');
\echo receipt_vendor_label_rule: ok
