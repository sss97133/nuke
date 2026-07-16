-- ============================================================================
-- Close 3 wide-open RLS holes found by independent audit (2026-07-05 night):
-- vehicles, qb_transactions, receipts all had a USING(true) "public read"
-- policy that ORs (PERMISSIVE) against every other, correctly-scoped policy
-- on the same table — meaning the correct policies were being fully defeated.
-- Highest blast radius: vehicles (323,830 rows, incl. VIN, on is_public=false
-- rows readable by anon). Verified live before touching anything.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. vehicles — "Anyone can view auction pricing dashboard"
--
-- Origin: supabase/migrations/20251203_auction_outcome_disclosure.sql. That
-- migration built a `auction_pricing_dashboard` VIEW (id, vehicle label,
-- auction_outcome, sale_price, high_bid, bat_auction_url, a computed
-- price_display, and a data_quality_check debug string like "ERROR: RNM but
-- has sale_price") — an internal QA tool for auditing auction-price
-- disclosure accuracy, not a public feature. It never touches VIN, title, or
-- any identifying field. Nothing in nuke_frontend/src or supabase/functions
-- references `auction_pricing_dashboard` — it has zero consumers, confirmed
-- by grep. The mistake: whoever wrote it added
--   CREATE POLICY "Anyone can view auction pricing dashboard"
--     ON vehicles FOR SELECT USING (true);
-- directly on the BASE TABLE (probably intending to gate the view, or
-- copy-pasted a "make it visible" policy without realizing PERMISSIVE
-- policies OR together). This has silently overridden the correct policies
-- vehicles_public_select (is_public = true) and vehicles_private_select
-- (owner/uploader/contributor match) for ~7 months: every SELECT on
-- vehicles by any role, including anon, matched USING(true) and got the row
-- regardless of is_public. Confirmed live: anon could read all 323,830
-- is_public=false rows including VIN.
--
-- Fix: just drop the bad policy. vehicles_public_select and
-- vehicles_private_select already correctly implement "the pattern every
-- other table uses" — no replacement policy is needed. The
-- auction_pricing_dashboard view still works fine for anyone with a
-- legitimate reason to query it (service_role, or an owner viewing their own
-- rows) — it just no longer bypasses privacy for everyone else.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view auction pricing dashboard" ON vehicles;


-- ----------------------------------------------------------------------------
-- 2. qb_transactions — "Public read"
--
-- QuickBooks-synced bookkeeping transactions (vendor_name, total_amount,
-- memo, line_account_name, doc_number, category, organization_id,
-- vehicle_id...) — Skylar's own business financial ledger data, ingested by
-- scripts/qb-load-transactions.mjs and scripts/bridge-invoice-to-qb.mjs,
-- both of which use SUPABASE_SERVICE_ROLE_KEY. Confirmed by grep: zero
-- references to `qb_transactions` anywhere in nuke_frontend/src or
-- supabase/functions — no frontend or edge-function feature reads this
-- table today. The "Service write" policy (ALL, service_role) already gives
-- the ingestion scripts everything they need; "Public read" (true) served no
-- product purpose and just leaked every transaction, including amounts and
-- memos, to anon.
--
-- Fix: drop it. No replacement needed — there is no legitimate non-service
-- consumer today. If/when an authenticated owner-facing bookkeeping view
-- ships, it should get its own narrow, auth.uid()-scoped policy then.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public read" ON qb_transactions;


-- ----------------------------------------------------------------------------
-- 3. receipts — "Anyone views receipts"
--
-- receipts already has a correct, narrow set of owner-scoped policies
-- ("Users can view own receipts": user_id = auth.uid(); "Users can view
-- vehicle receipts": vehicle's uploaded_by = auth.uid() or user_id match;
-- receipts_insert/update/delete: created_by = auth.uid()) — same pattern as
-- payment_events' fix tonight (#265). But "Anyone views receipts"
-- USING(true) ORs against all of them and opens every column of every row —
-- including card_last4 and card_holder (confirmed live: real last-4 digits
-- readable by anon) — to anyone, for every receipt in the system, private
-- vehicle or not.
--
-- UNLIKE qb_transactions, receipts has a real, live, anon-facing consumer:
-- the vehicle profile page renders for every visitor (WorkspaceContent.tsx,
-- no owner gate at the page level) and two of its cards query `receipts`
-- directly assuming public readability:
--   - useInvestmentLedger.ts: id, vendor_name, total, receipt_date,
--     invoice_number  (filtered by vehicle_id + status='processed')
--   - VehicleLedgerDocumentsCard.tsx: id, source_document_id,
--     processing_status, vendor_name, total, currency, created_at
--     (filtered by scope_type='vehicle' + scope_id=vehicleId)
-- Dropping the wide policy outright would go dark for every non-owner
-- visitor on every PUBLIC vehicle profile — a real regression to a shipping
-- feature, not just closing a hole.
--
-- Fix: drop the wide table policy (base table reverts to owner-only, closing
-- the PII leak completely), and add a narrow, hardcoded-safe VIEW that
-- exposes only the non-sensitive columns those two call sites actually use,
-- for receipts attached to a vehicle that is_public = true. The view
-- intentionally does NOT set security_invoker (so it does not depend on, or
-- get re-opened by, whatever RLS the base table has later) — its own WHERE
-- clause is the entire access-control boundary, and its column list simply
-- never includes card_last4 / card_holder / vendor_address / raw_extraction
-- / raw_json / file_url etc., so no policy change on the base table can ever
-- leak them through this view. security_barrier=true stops the planner from
-- pushing caller-supplied filters ahead of that WHERE clause.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone views receipts" ON receipts;

DROP VIEW IF EXISTS receipts_public_summary;

CREATE VIEW receipts_public_summary WITH (security_barrier = true) AS
SELECT
  r.id,
  r.vehicle_id,
  r.scope_type,
  r.scope_id,
  r.source_document_id,
  r.source_document_table,
  r.vendor_name,
  r.total,
  r.total_amount,
  r.currency,
  r.receipt_date,
  r.transaction_date,
  r.purchase_date,
  r.invoice_number,
  r.transaction_number,
  r.processing_status,
  r.status,
  r.created_at
FROM receipts r
JOIN vehicles v
  ON v.id = r.vehicle_id
  OR (r.scope_type = 'vehicle' AND v.id::text = r.scope_id)
WHERE v.is_public = true;

REVOKE ALL ON receipts_public_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON receipts_public_summary TO anon, authenticated;

COMMENT ON VIEW receipts_public_summary IS
  'Safe, column-limited public view of receipts for is_public=true vehicles only. Backs the vehicle-profile Investment Ledger + Ledger Documents cards for anon/non-owner visitors. Never exposes card_last4/card_holder/vendor_address/raw_extraction/file_url — those stay behind the owner-only base-table policies.';
