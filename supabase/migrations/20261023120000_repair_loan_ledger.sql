-- DRAFT (not applied, not merged): secured repair loans as ledger events.
-- Builds on what already exists in prod: work_orders, work_order_quotes,
-- work_order_quote_release_terms, work_order_invoices, work_order_payment_witnesses
-- (append-only, lifecycle_immutable), lending_partners, contributor_trust (beta trust),
-- platform_fee_schedules / all_in_buyer_cost. vehicle_funding_rounds (profit share) is
-- left untouched; this path is a loan, not a share of profit.
-- Additive only: new tables, no renames, no drops.
BEGIN;

-- 1. The "best play": a proposed repair + sale path for one vehicle, with its evidence.
CREATE TABLE IF NOT EXISTS public.vehicle_play_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  play_kind text NOT NULL CHECK (play_kind IN ('repair','documentation','sale_path','combined')),
  title text NOT NULL,
  budget_cents bigint NOT NULL CHECK (budget_cents >= 0),
  est_value_before_cents bigint,
  est_uplift_cents bigint, est_uplift_low_cents bigint, est_uplift_high_cents bigint,
  est_cost_low_cents bigint, est_cost_high_cents bigint,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,  -- effect id, n, CI, q-value, cost sources
  target_platform_key text,                     -- -> platform_fee_schedules.platform_key
  target_reserve_cents bigint,
  target_sale_window daterange,
  created_by_agent boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- 2. The loan. Secured by the car, repaid from the sale (or by maturity).
CREATE TABLE IF NOT EXISTS public.repair_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  play_id uuid REFERENCES public.vehicle_play_proposals(id),
  work_order_id uuid REFERENCES public.work_orders(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  borrower_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  lender_profile_id uuid REFERENCES public.profiles(id),
  lending_partner_id uuid REFERENCES public.lending_partners(id), -- licensed lender of record, if any
  principal_cents bigint NOT NULL CHECK (principal_cents > 0),
  apr_bps int NOT NULL CHECK (apr_bps >= 0),
  origination_fee_cents bigint NOT NULL DEFAULT 0,
  max_ltv_bps int NOT NULL DEFAULT 3000,           -- loan <= 30% of as-is value by default
  as_is_value_cents bigint NOT NULL,               -- from the advisor at origination
  valuation_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  maturity_date date NOT NULL,
  repay_trigger text NOT NULL DEFAULT 'sale_or_maturity' CHECK (repay_trigger IN ('sale_or_maturity','maturity')),
  credit_purpose text NOT NULL CHECK (credit_purpose IN ('consumer','business')), -- drives disclosures
  borrower_state char(2) NOT NULL, lender_state char(2),
  disclosure_version text,                          -- TILA/state disclosure template id
  insurance_proof_obs_id uuid,                      -- vehicle_observations id
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT repair_loans_ltv CHECK (principal_cents * 10000 <= as_is_value_cents * max_ltv_bps)
);

-- 3. Collateral: the lien on the title (or UCC filing), and its release.
CREATE TABLE IF NOT EXISTS public.repair_loan_liens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.repair_loans(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  method text NOT NULL CHECK (method IN ('title_lienholder','title_held_in_escrow','ucc1_financing_statement')),
  jurisdiction char(2) NOT NULL,
  filing_or_title_number text,
  perfected_at timestamptz,
  released_at timestamptz,
  evidence_obs_id uuid,                             -- scan of title / filing receipt
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- 4. Repair escrow: money sits in escrow and is released per milestone,
-- only when receipts + photos match the work order quote.
CREATE TABLE IF NOT EXISTS public.repair_escrow_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.repair_loans(id),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id),
  quote_id uuid REFERENCES public.work_order_quotes(id),   -- release terms live in work_order_quote_release_terms
  seq int NOT NULL,
  label text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  required_evidence jsonb NOT NULL DEFAULT '["invoice_matches_quote","before_after_photos","payment_witness"]'::jsonb,
  escrow_agent text,                                -- licensed third-party escrow / payment processor
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (loan_id, seq)
);

-- 5. One append-only event log for the whole deal.
CREATE TABLE IF NOT EXISTS public.repair_loan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.repair_loans(id),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event_type text NOT NULL CHECK (event_type IN (
    'proposed','terms_offered','disclosures_delivered','borrower_signed','lender_committed',
    'lien_perfected','insurance_verified','escrow_funded',
    'shop_assigned','work_started','receipt_submitted','photos_submitted',
    'receipt_audit_passed','receipt_audit_failed','milestone_released','change_order',
    'work_completed','sale_scheduled','reserve_set','sale_result','no_sale','relisted',
    'settlement_received','waterfall_paid','lien_released',
    'payment_late','default_notice','collateral_sold','loan_closed')),
  actor_profile_id uuid REFERENCES public.profiles(id),
  milestone_id uuid REFERENCES public.repair_escrow_milestones(id),
  amount_cents bigint,
  refs jsonb NOT NULL DEFAULT '{}'::jsonb,          -- invoice_id, payment_witness_id, observation ids, image ids, vehicle_event_id
  audit jsonb,                                      -- for receipt_audit_*: line-by-line match vs quote, photo checks
  prev_hash text, event_hash text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS repair_loan_events_loan_idx ON public.repair_loan_events(loan_id, seq);

-- 6. Sale proceeds waterfall (who gets paid, in what order).
CREATE TABLE IF NOT EXISTS public.repair_loan_waterfall_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.repair_loans(id),
  settlement_event_id uuid NOT NULL REFERENCES public.repair_loan_events(id),
  rank int NOT NULL,           -- 1 platform/seller fees, 2 lender principal, 3 lender interest+fees, 4 unpaid shop balance, 5 owner remainder
  payee_kind text NOT NULL CHECK (payee_kind IN ('platform','lender','shop','owner','escrow_agent','other')),
  payee_profile_id uuid REFERENCES public.profiles(id),
  payee_organization_id uuid,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (settlement_event_id, rank, payee_kind)
);

-- Append-only, same rule as the work-order lifecycle tables.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['vehicle_play_proposals','repair_loans','repair_loan_liens',
    'repair_escrow_milestones','repair_loan_events','repair_loan_waterfall_lines'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lifecycle_immutable ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lifecycle_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.work_order_lifecycle_immutable()', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP; END $$;

-- Parties see their own deals.
CREATE POLICY repair_loans_party_read ON public.repair_loans FOR SELECT
  USING (auth.uid() IN (borrower_profile_id, lender_profile_id));
CREATE POLICY repair_loan_events_party_read ON public.repair_loan_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.repair_loans l WHERE l.id = loan_id AND auth.uid() IN (l.borrower_profile_id, l.lender_profile_id)));

-- Current state of each loan, derived from events (state is never stored, only replayed).
CREATE OR REPLACE VIEW public.v_repair_loan_state AS
SELECT l.id loan_id, l.vehicle_id, l.principal_cents,
  (SELECT e.event_type FROM public.repair_loan_events e WHERE e.loan_id=l.id ORDER BY e.seq DESC LIMIT 1) last_event,
  COALESCE((SELECT sum(amount_cents) FROM public.repair_loan_events e WHERE e.loan_id=l.id AND e.event_type='escrow_funded'),0) escrow_in_cents,
  COALESCE((SELECT sum(amount_cents) FROM public.repair_loan_events e WHERE e.loan_id=l.id AND e.event_type='milestone_released'),0) escrow_out_cents,
  EXISTS (SELECT 1 FROM public.repair_loan_liens x WHERE x.loan_id=l.id AND x.perfected_at IS NOT NULL AND x.released_at IS NULL) lien_active,
  COALESCE((SELECT sum(w.amount_cents) FROM public.repair_loan_waterfall_lines w WHERE w.loan_id=l.id AND w.payee_kind='lender'),0) repaid_to_lender_cents
FROM public.repair_loans l;

-- Trust: reuse contributor_trust (Beta alpha/beta). Outcomes that update it:
--   shop:      receipt_audit_passed (+alpha) / receipt_audit_failed or late work_completed (+beta), family 'shop_delivery'
--   borrower:  loan_closed paid in full (+alpha) / default_notice (+beta), family 'borrower_repayment'
--   owner est: sale_result within advisor 80% band (+alpha) / outside (+beta), family 'owner_claims'
-- Applied by a job, not here, so this migration writes nothing to contributor_trust.
COMMENT ON TABLE public.repair_loan_events IS 'Append-only lifecycle of a secured repair loan; feeds contributor_trust families shop_delivery, borrower_repayment, owner_claims.';
COMMIT;
