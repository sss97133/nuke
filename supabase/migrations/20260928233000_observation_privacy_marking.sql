-- Observation privacy marking: rows that carry money, receipts or people are owner-only.
-- Skylar, 2026-09-28: option A ("fix it correctly; that data is foundational to financial models").
--
-- WHY (measured 2026-09-28 with the public anon key): anyone could read 619 work_record observations on
-- the K5 (e08bf694, a client build), 602 of them carrying the client's name, invoice numbers, amounts
-- or payment status, 411,718 characters. The only SELECT policy on vehicle_observations showed every
-- kind of every public vehicle's observations to everyone. Money is not only in work_record: on the K5,
-- 28 of 29 'comment' rows are receipts filed under the wrong kind, 64 'specification' rows carry order
-- and billing fields, 17 'provenance' rows are purchase orders with client_billing, and 78 'condition'
-- rows hold text read off photographed receipts.
--
-- WHAT: a row is public (readable by anyone, for a public vehicle) only when its kind is a market or
-- vehicle fact AND none of its fields is a money, receipt or person field, and, for photo analysis,
-- its read text carries no amount or receipt. Everything else is owner-only: the vehicle's user, owner
-- and uploader still see every row, and service_role (server jobs, financial models, the MCP
-- connector) is unaffected. No data changes; nothing is deleted.
--
-- Measured before shipping: on the K5 the rule leaves 4 of 172 money-matching rows public, and those
-- are two vendor list prices in wiring citations and two false hits ("paid labor", "Scottsdale").
-- Platform-wide (0.5% sample) it hides 0% of listing, comment, bid and sale_result rows, 0.01% of
-- media, 0.54% of specification and 2.67% of condition rows.
--
-- NEXT: a masked public read path, so visitors see the work in a build log without the money.
--
-- SCHEMA_LAW pre-mint checklist:
--  1. Search 2026-09-28: no marking or sensitivity function exists for observations; vehicle_observations
--     has no visibility column. vehicle_images has is_sensitive (images only).
--  2. Not a fact class: an access rule.  3. Writes no testimony.  4. One function, zero storage.
--  5. Read-only.  6. No writers.
--  7. CI-applied. The function runs inside a row-security policy as the querying role, so EXECUTE is
--     granted to anon and authenticated explicitly (P0.4 closed new functions by default).

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.observation_is_public(p_kind public.observation_kind, p_data jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice')
     AND COALESCE(p_data::text, '') !~ ('"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url'
                                         '|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd'
                                         '|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due'
                                         '|order_number|order_contents|order|client|correct_owner|prior_owner_id'
                                         '|correct_owner_discovered_person_id|customer_name|client_name|email|phone)"\s*:')
     AND NOT (p_kind IN ('condition', 'media') AND COALESCE(p_data::text, '') ~* '(invoice|receipt|\$\s?[0-9])');
$$;

COMMENT ON FUNCTION public.observation_is_public(public.observation_kind, jsonb) IS
  'The privacy marking for observations: true when the row may be shown to anyone (for a public vehicle). Public kinds: listing, sale_result, comment, bid, specification, condition, media, splice, and only when no field is a money, receipt or person field (invoice_number, line_items, totals, tax, billing, payment, order, client, owner ids, email, phone...) and, for photo analysis, the read text has no amount or receipt. Everything else is owner-only. Used by the vo_authenticated_read policy. 2026-09-28.';

REVOKE ALL ON FUNCTION public.observation_is_public(public.observation_kind, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.observation_is_public(public.observation_kind, jsonb)
  TO anon, authenticated, service_role;

ALTER POLICY vo_authenticated_read ON public.vehicle_observations
  USING (
    EXISTS (
      SELECT 1
      FROM public.vehicles v
      WHERE v.id = vehicle_observations.vehicle_id
        AND (
          v.user_id = (SELECT auth.uid())
          OR v.owner_id = (SELECT auth.uid())
          OR v.uploaded_by = (SELECT auth.uid())
          OR (v.is_public = true
              AND public.observation_is_public(vehicle_observations.kind, vehicle_observations.structured_data))
        )
    )
  );
