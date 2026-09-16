# DEAL FLOW / TRADING — theory card

**The model:** Deal flow is evidence-in, transfer-out: auction/marketplace outcomes land as measurements (`auction_events`, `bat_listings`, `payment_events`), and a DB trigger — `auto_create_transfer_on_auction_close` on `auction_events.outcome→'sold'` — fires `transfer-automator` async via pg_net to seed an `ownership_transfers` row. Everything downstream (transfer state, milestones, Stripe money-in) is a projection of those stored measurements; labels and statuses are computed at render, never baked in. The in-app bidding/exchange/trading capability was RETIRED 2026-03 — there is no live trading engine, only observation of external markets plus ownership-transfer plumbing.

**The invariant(s):**
- Label = projection of measurement. Store the (claim, source, time, trust) tuple; never hard-code a categorical verdict into schema. Every number carries source DNA `(amount, source, method, observed_at, trust)`.
- Never show a price you can't defend — block with "not priced yet", never an honest-low guess. Comps don't price builds.
- Payment facts are enumerated from `payment_events`, never asked ("who paid you?" is a query, not a question).
- Idempotency everywhere: the transfer trigger skips already-sold rows; `stripe-webhook` records each Stripe event id in `ai_credit_ledger.ref` and skips duplicates.
- `hammer_predictions` is a dormant LEDGER with an open prediction maturing **2026-07-15** — do NOT archive `predict-hammer-price` before then.

**Canonical entrypoints:**
- Create transfer on sale → `auto_create_transfer_on_auction_close` trigger (migration `20260226220000_transfer_automation.sql`) → `transfer-automator` edge fn
- Transfer state read / advance → `transfer-status-api` / `transfer-advance`
- Transfer storage → `ownership_transfers` + `transfer_milestones` tables
- Payment facts → `payment_events` table
- Stripe checkout (API subscription) → `create-api-access-checkout`; (credits/cash) → `create-checkout`
- Stripe event handling → `stripe-webhook` (deploy `--no-verify-jwt`; verifies Stripe signature, credits via `_shared/aiCredits.ts`)
- Payment-method setup → `setup-payment-method`
- API keys → `api-keys-manage` + `api_keys` table
- Deal contacts → `deal_contacts` table
- Deal jackets / doc forensics → `deal-jacket-pipeline` (dormant; reactivate cron if needed)

**Do NOT:** Resurrect the retired trading suite — `place-bid-with-deposit` (frontend `auctionPaymentService.ts` still calls it: known-broken, don't "fix" by redeploying), `execute-auto-buy`, `place-market-order`, `trading`, `paper-trade-autopilot`, `api-v1-exchange`, `update-exchange-prices`. Don't use `create-vehicle-transaction-checkout` (its table was DROPPED — runtime-broken) or `stripe-checkout` (orphan deploy). Don't write to dropped exchange tables (`vehicle_transactions`, `user_wallets`, `auction_bids`, ...). Don't use `backfill_transfers_for_sold_auctions` except as manual repair. Don't mint a new valuation/comps path — the organs exist (5 build waves; see `docs/features/ask-nuke/THEORY.md`).

**Before you build here:** Read `docs/ledger/CAPABILITY_MAP.md` (DEAL FLOW / MONEY section) before minting ANY function or table. For anything valuation/comps/auction-shaped, read `docs/features/ask-nuke/THEORY.md` first — the system was built five times; revive, never re-derive. Check `docs/ledger/ledger.json` verdicts (DEAD/HALF-BUILT names look plausible but are traps).
