-- AI credit ledger: DB-enforced idempotency for Stripe top-ups.
--
-- The stripe-webhook records each Stripe event.id as the ledger row `ref` and
-- skips events whose id is already present (app-level alreadyProcessed check).
-- That SELECT-then-INSERT leaves a thin TOCTOU window: two concurrent deliveries
-- of the same checkout.session.completed (Stripe's at-least-once retry) could both
-- pass and double-credit. This partial UNIQUE index makes idempotency a DB
-- guarantee — the second insert raises 23505, which creditCents() swallows as
-- "already processed". Scoped to topups only (settle rows reuse ref='settle').
--
-- Applied 2026-06-23 alongside the live-Stripe cutover. Idempotent (IF NOT EXISTS);
-- ai_credit_ledger had zero rows at apply time, so no backfill/dedup was needed.
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_ledger_topup_ref_uniq
  ON public.ai_credit_ledger (ref)
  WHERE entry_type = 'topup' AND ref IS NOT NULL;
