-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_private_columns -f this-file.sql
-- Contract for 20261014093000_private_money_columns_owner_only.sql. Synthetic rows only; never production.
-- Starts from the readers contract (its fixture, production's live sources and 20261014073000 applied), then applies
-- the column revoke twice as a non-superuser owner and proves:
--   * a stranger (anon or signed in) cannot select, filter on or '*'-select the owner money columns of either table,
--     and still reads every other column, counts rows and reads the masked readers and views;
--   * the organization's manager and the vehicle's owner cannot select the columns either, and read their money
--     through organization_vehicle_books, vehicle_owner_books, vehicle_row_read and get_vehicle_profile_data;
--   * writes are unchanged: the owner updates the purchase price and an insert returns its id;
--   * the service role keeps every column, and a column added later is not readable until a migration grants it.
\set ON_ERROR_STOP on
\ir test_private_money_readers.sql

-- Prod's write policies on the two tables, for the write checks below.
SET ROLE dm_contract_deployer;
CREATE POLICY vehicles_authenticated_insert ON public.vehicles FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY vehicles_simple_update_policy ON public.vehicles FOR UPDATE
  USING (((SELECT auth.uid()) = uploaded_by) OR ((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id));
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_vehicles_select ON public.organization_vehicles FOR SELECT USING (true);

-- Before: every column, the owner's money included, is readable by a stranger.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
SELECT pg_temp.ok('before: anon selects the cost basis and the purchase price',
  (SELECT cost_basis FROM public.organization_vehicles WHERE id = '40000000-0000-0000-0000-000000000001') = 12000
  AND (SELECT purchase_price FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000001') = 15000);
RESET ROLE;

SET ROLE dm_contract_deployer;
\ir ../migrations/20261014093000_private_money_columns_owner_only.sql
-- A second application changes nothing and passes its own check.
\ir ../migrations/20261014093000_private_money_columns_owner_only.sql

-- denied(sql) is true when the statement fails with insufficient_privilege (42501).
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END $$;

-- 1. Strangers: logged out, then signed in.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
DO $$ BEGIN
  PERFORM pg_temp.ok('anon: the link money columns are denied',
    pg_temp.denied('SELECT cost_basis FROM public.organization_vehicles')
    AND pg_temp.denied('SELECT sale_price FROM public.organization_vehicles')
    AND pg_temp.denied('SELECT asking_price FROM public.organization_vehicles')
    AND pg_temp.denied('SELECT internal_notes FROM public.organization_vehicles')
    AND pg_temp.denied('SELECT * FROM public.organization_vehicles'));
  PERFORM pg_temp.ok('anon: the purchase facts are denied, as a filter and as *',
    pg_temp.denied('SELECT purchase_price FROM public.vehicles')
    AND pg_temp.denied('SELECT purchase_date FROM public.vehicles')
    AND pg_temp.denied('SELECT purchase_location FROM public.vehicles')
    AND pg_temp.denied('SELECT id FROM public.vehicles WHERE purchase_price IS NOT NULL')
    AND pg_temp.denied('SELECT * FROM public.vehicles'));
  PERFORM pg_temp.ok('anon: every other column still reads, rows still count',
    (SELECT count(*) FROM public.vehicles) = 2
    AND (SELECT make FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000001') = 'Chevrolet'
    AND (SELECT notes FROM public.organization_vehicles WHERE id = '40000000-0000-0000-0000-000000000001') = 'External listing: bat'
    AND (SELECT count(*) FROM public.organization_vehicles WHERE listing_status = 'sold') = 1);
  PERFORM pg_temp.ok('anon: the masked readers and the sold proof view still answer',
    public.get_vehicle_profile_data('10000000-0000-0000-0000-000000000001')::jsonb -> 'vehicle' ->> 'make' = 'Chevrolet'
    AND public.vehicle_row_read('10000000-0000-0000-0000-000000000001') -> 'purchase_price' = 'null'::jsonb
    AND (SELECT anchor_label FROM public.vehicle_price_signal(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])) = 'MSRP'
    AND (SELECT sale_price IS NULL AND year = 1972 FROM public.sold_vehicle_proof
         WHERE org_vehicle_id = '40000000-0000-0000-0000-000000000001'));
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('test.auth_role', 'authenticated', false), set_config('test.auth_uid', '20000000-0000-0000-0000-000000000004', false);
SELECT pg_temp.ok('stranger: the same columns are denied, the readers return nothing',
  pg_temp.denied('SELECT cost_basis FROM public.organization_vehicles')
  AND pg_temp.denied('SELECT purchase_price FROM public.vehicles')
  AND pg_temp.denied('SELECT * FROM public.vehicles')
  AND (SELECT count(*) FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000001')) = 0
  AND (SELECT count(*) FROM public.vehicle_owner_books(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])) = 0);

-- 2. The organization's board member, who also owns both vehicles: no direct read, everything through the readers.
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
DO $$ BEGIN
  PERFORM pg_temp.ok('member: direct selects of the money are denied to the owner too',
    pg_temp.denied('SELECT cost_basis FROM public.organization_vehicles')
    AND pg_temp.denied('SELECT purchase_price FROM public.vehicles'));
  PERFORM pg_temp.ok('member: the books reader returns the link money',
    (SELECT cost_basis = 12000 AND sale_price = 18000 AND asking_price = 21000
     FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000001')
     WHERE id = '40000000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.ok('owner: the owner readers return the purchase facts',
    (SELECT sum(purchase_price) FROM public.vehicle_owner_books(ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002']::uuid[])) = 20000
    AND (public.vehicle_row_read('10000000-0000-0000-0000-000000000002') ->> 'purchase_price')::numeric = 5000
    AND (public.get_vehicle_profile_data('10000000-0000-0000-0000-000000000001')::jsonb -> 'vehicle' ->> 'purchase_price')::numeric = 15000);
  PERFORM pg_temp.ok('owner: the sold proof view carries the link sale price to the manager',
    (SELECT sale_price FROM public.sold_vehicle_proof WHERE org_vehicle_id = '40000000-0000-0000-0000-000000000001') = 18000);
END $$;

-- 3. Writes are unchanged: the owner sets the purchase price; a new row returns its id, not its money.
UPDATE public.vehicles SET purchase_price = 16000 WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok('owner: the update landed (read through the owner reader)',
  (SELECT purchase_price FROM public.vehicle_owner_books(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])) = 16000);
SELECT pg_temp.ok('owner: returning the purchase price is denied, returning the id is not',
  pg_temp.denied($q$UPDATE public.vehicles SET purchase_price = 16000 WHERE id = '10000000-0000-0000-0000-000000000001' RETURNING purchase_price$q$)
  AND NOT pg_temp.denied($q$UPDATE public.vehicles SET purchase_price = 16000 WHERE id = '10000000-0000-0000-0000-000000000001' RETURNING id$q$));
SELECT pg_temp.ok('owner: an insert with a purchase price returns its id',
  NOT pg_temp.denied($q$INSERT INTO public.vehicles (id, year, make, model, is_public, owner_id, purchase_price)
    VALUES ('10000000-0000-0000-0000-000000000009', 2001, 'Offline', 'Sample', true, '20000000-0000-0000-0000-000000000001', 1)
    RETURNING id$q$));
RESET ROLE;

-- 4. The service role keeps every column; a column added later stays closed until a migration grants it.
SELECT pg_temp.ok('service role: every column of both tables',
  has_column_privilege('service_role', 'public.vehicles', 'purchase_price', 'SELECT')
  AND has_column_privilege('service_role', 'public.organization_vehicles', 'cost_basis', 'SELECT')
  AND has_table_privilege('service_role', 'public.vehicles', 'SELECT'));
SET ROLE dm_contract_deployer;
ALTER TABLE public.vehicles ADD COLUMN contract_later_column text;
RESET ROLE;
SELECT pg_temp.ok('a column added after the revoke is not readable by anon until granted',
  NOT has_column_privilege('anon', 'public.vehicles', 'contract_later_column', 'SELECT')
  AND has_column_privilege('anon', 'public.vehicles', 'make', 'SELECT'));
