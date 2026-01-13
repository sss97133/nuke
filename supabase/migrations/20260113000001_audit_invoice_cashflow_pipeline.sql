-- =====================================================
-- INVOICE -> CASHFLOW PIPELINE VERIFICATION HELPERS
-- =====================================================
-- Date: 2026-01-13
--
-- Adds a service-role-only RPC to audit:
-- - invoice payment deltas -> cashflow_events(source_type='invoice_payment')
-- - processing health (processed_at / processing_error)
-- - payout backlog (cashflow_payouts pending/partially_paid)
-- - reconciliation: sum(invoice_payment events per invoice) == round(generated_invoices.amount_paid * 100)
--
-- NOTE: `generated_invoices.amount_paid` is the receipt ledger; the trigger logs deltas, so the event sum should match.

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_invoice_cashflow_pipeline(
  p_since TIMESTAMPTZ DEFAULT (NOW() - INTERVAL '30 days'),
  p_limit INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_since TIMESTAMPTZ;
  v_limit INTEGER;
BEGIN
  -- Allow execution from:
  -- - PostgREST with a service_role JWT
  -- - Direct SQL (admin) contexts like the Supabase SQL editor
  v_role := COALESCE(auth.jwt() ->> 'role', '');
  IF v_role <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service_role only';
  END IF;

  v_since := COALESCE(p_since, NOW() - INTERVAL '30 days');
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 25), 200));

  IF to_regclass('public.generated_invoices') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'generated_invoices not found');
  END IF;
  IF to_regclass('public.cashflow_events') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cashflow_events not found');
  END IF;
  IF to_regclass('public.cashflow_payouts') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cashflow_payouts not found');
  END IF;

  RETURN (
    WITH
    inv AS (
      SELECT
        gi.id AS invoice_id,
        gi.business_id AS organization_id,
        gi.invoice_number,
        gi.invoice_date,
        COALESCE(gi.amount_paid, 0)::numeric AS amount_paid_usd,
        ROUND(COALESCE(gi.amount_paid, 0)::numeric * 100.0)::bigint AS expected_cents
      FROM public.generated_invoices gi
      WHERE gi.business_id IS NOT NULL
        AND COALESCE(gi.amount_paid, 0) > 0
        AND (gi.invoice_date IS NULL OR gi.invoice_date >= v_since::date)
    ),
    ev_all AS (
      SELECT
        (e.source_ref)::uuid AS invoice_id,
        COUNT(*)::int AS event_count,
        SUM(e.amount_cents)::bigint AS sum_cents,
        MAX(e.occurred_at) AS last_occurred_at
      FROM public.cashflow_events e
      WHERE e.source_type = 'invoice_payment'
        AND e.source_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      GROUP BY (e.source_ref)::uuid
    ),
    ev_recent AS (
      SELECT *
      FROM public.cashflow_events e
      WHERE e.source_type = 'invoice_payment'
        AND e.occurred_at >= v_since
    ),
    payouts_recent AS (
      SELECT p.*
      FROM public.cashflow_payouts p
      JOIN public.cashflow_events e ON e.id = p.event_id
      WHERE e.source_type = 'invoice_payment'
        AND e.occurred_at >= v_since
    ),
    missing_events AS (
      SELECT
        i.invoice_id,
        i.organization_id,
        i.invoice_number,
        i.invoice_date,
        i.amount_paid_usd,
        i.expected_cents
      FROM inv i
      LEFT JOIN ev_all v ON v.invoice_id = i.invoice_id
      WHERE v.invoice_id IS NULL
      ORDER BY i.invoice_date DESC NULLS LAST
      LIMIT v_limit
    ),
    sum_mismatch AS (
      SELECT
        i.invoice_id,
        i.organization_id,
        i.invoice_number,
        i.invoice_date,
        i.amount_paid_usd,
        i.expected_cents,
        COALESCE(v.sum_cents, 0)::bigint AS event_sum_cents,
        COALESCE(v.event_count, 0)::int AS event_count,
        v.last_occurred_at
      FROM inv i
      LEFT JOIN ev_all v ON v.invoice_id = i.invoice_id
      WHERE v.invoice_id IS NOT NULL
        AND COALESCE(v.sum_cents, 0)::bigint <> i.expected_cents
      ORDER BY v.last_occurred_at DESC NULLS LAST
      LIMIT v_limit
    ),
    unprocessed_events AS (
      SELECT
        e.id AS event_id,
        e.subject_organization_id AS organization_id,
        e.amount_cents,
        e.source_ref,
        e.occurred_at,
        e.processed_at,
        e.processing_error
      FROM ev_recent e
      WHERE e.processed_at IS NULL OR e.processing_error IS NOT NULL
      ORDER BY e.occurred_at DESC
      LIMIT v_limit
    ),
    pending_payouts AS (
      SELECT
        p.id AS payout_id,
        p.event_id,
        p.claim_id,
        p.subject_organization_id AS organization_id,
        p.amount_cents,
        p.paid_cents,
        p.status,
        p.created_at,
        p.updated_at
      FROM payouts_recent p
      WHERE p.status IN ('pending','partially_paid')
      ORDER BY p.created_at DESC
      LIMIT v_limit
    )
    SELECT jsonb_build_object(
      'ok', true,
      'since', v_since,
      'limit', v_limit,
      'counts', jsonb_build_object(
        'invoices_with_amount_paid', (SELECT COUNT(*) FROM inv),
        'invoice_payment_events_recent', (SELECT COUNT(*) FROM ev_recent),
        'invoice_payment_events_unprocessed_or_error_recent', (SELECT COUNT(*) FROM unprocessed_events),
        'invoice_payment_payouts_recent', (SELECT COUNT(*) FROM payouts_recent),
        'invoice_payment_payouts_pending_recent', (SELECT COUNT(*) FROM pending_payouts),
        'invoices_missing_events', (SELECT COUNT(*) FROM missing_events),
        'invoices_sum_mismatch', (SELECT COUNT(*) FROM sum_mismatch)
      ),
      'samples', jsonb_build_object(
        'invoices_missing_events', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM missing_events m), '[]'::jsonb),
        'invoices_sum_mismatch', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM sum_mismatch s), '[]'::jsonb),
        'events_unprocessed_or_error_recent', COALESCE((SELECT jsonb_agg(to_jsonb(u)) FROM unprocessed_events u), '[]'::jsonb),
        'payouts_pending_recent', COALESCE((SELECT jsonb_agg(to_jsonb(pp)) FROM pending_payouts pp), '[]'::jsonb)
      )
    );
  );
END;
$$;

REVOKE ALL ON FUNCTION public.audit_invoice_cashflow_pipeline(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_invoice_cashflow_pipeline(TIMESTAMPTZ, INTEGER) TO service_role;

COMMIT;

