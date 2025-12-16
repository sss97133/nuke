# Session Wrap-up — Dec 16, 2025

## What we did (shipped)

### 1) Market Segments + Subcategories are real (Supabase-backed)
- Confirmed the “Market Segments” UI in this repo is **React (`nuke_frontend`) + Supabase Postgres**, not SvelteKit/Prisma.
- Verified the backing DB objects exist and are wired correctly:
  - `public.market_segments_index` view (segments + stats) and explicit GRANTs for read access
  - `public.market_segment_subcategories` table with RLS policies
  - `public.market_segment_stats(uuid)` RPC used by the view/tiles

### 2) ROI / “value in play” tracking is already in DB — we surfaced it in UI
- Found existing ROI primitives in Supabase:
  - `public.spend_attributions` (money → work/receipt/cash transaction)
  - `public.get_vehicle_roi_summary(vehicle_id)` (spend vs value delta)
- Added a **Vehicle Investment Summary** UI card that calls `get_vehicle_roi_summary` and shows:
  - Attributed spend
  - Current value / 30d-ago value / delta
  - ROI(30d) and event value impact sum
- Files:
  - `nuke_frontend/src/components/vehicle/VehicleROISummaryCard.tsx`
  - `nuke_frontend/src/pages/VehicleProfile.tsx`

### 3) Split “vehicle transactions” into the pro pattern (stop schema collision)
Problem: the repo had **two different concepts** named `vehicle_transactions` across migrations:
- **Sale facilitation**: Stripe checkout + signing tokens + shipping coordination (edge functions rely on this)
- **Historical purchase/sale log**: transaction events w/ proof + confidence (vehicle financial history)

Fix: created a dedicated table for history events and repaired the UI that was querying a non-existent table.

- Added migration:
  - `supabase/migrations/20251216000004_vehicle_transaction_events_split.sql`
    - Creates `public.vehicle_transaction_events`
    - Adds RLS + grants
    - Updates `public.log_vehicle_transaction(...)` to write to the new table and (best-effort) create a matching `timeline_events` row using the **current** schema columns (`event_category`, `source_type`)
- Fixed UI:
  - `nuke_frontend/src/components/vehicle/TransactionHistory.tsx`
    - Now reads from `vehicle_transaction_events` (previously referenced `vehicle_financial_transactions`, which doesn’t exist in Supabase here)

Important: We did **not** change the sale-facilitation edge functions/tables; the checkout/sign/shipping flow remains on the existing `vehicle_transactions`.

---

## What we should pursue next (prioritized)

### P0 — Make “deal → money → ownership” a single chain (no gaps)
Goal: from a single vehicle page, you can trace:
- Listing/offer accepted → agreement signed → money status (on/off platform) → title transfer → ownership history update → P/L summary.

Concrete work:
- Add an explicit “deal record” (or extend existing listing/offer acceptance) that links to:
  - payment evidence (platform cash ledger transaction OR off-platform payment proof)
  - title transfer (`title_transfers`) and/or ownership history (`vehicle_ownerships`, `ownership_transfers`)
  - the historical transaction event (`vehicle_transaction_events`) for purchase/sale price tracking

### P0 — Unify “transactions history” UX + creation
You now have the read path (`TransactionHistory`) and the ROI card.
Next unlock is write path:
- Add a lightweight “Log purchase/sale” form in the vehicle profile
- Call `public.log_vehicle_transaction(...)`
- Show confidence/proof fields (≈, estimate, proof URL/doc)

### P1 — Vehicle-level P&L that investors trust
Move from “ROI proxy” to a clear “Position” statement:
- **Cost basis** = purchase price + attributed spend + sale expenses
- **Proceeds** = sale price (or current value for unrealized)
- **P/L** = proceeds − cost basis

Implementation approach:
- Keep everything derived from immutable-ish primitives:
  - `vehicle_transaction_events` (purchase/sale events)
  - `spend_attributions` (true spend, with receipts + evidence)
  - `vehicle_price_history`/`vehicles.current_value` (mark)
- Publish as a view/function for UI consumption.

### P1 — Incentives for “auto-report”
Use existing credits/cash primitives to reward verified reporting:
- Bounties for uploading receipts + proof docs + confirmed sale price + title transfer completion
- Tiered trust: higher rewards for verified owners or high-documentation users

### P2 — “ETF-like” and “buy-here-pay-here 2.0” lending products
You already have primitives that are *very close* to “investable products”:
- Market funds (segment ETF shares): `market_funds`, `market_fund_holdings`, `market_fund_buy`
- Vehicle bonds (fixed income): `vehicle_bonds`, `bond_holdings`
- Profit-sharing rounds: `vehicle_funding_rounds`, `profit_share_stakes`

Next step to get “commuter car lending ETF”:
- Add “loan pools” + “loan notes” + repayment events + default tracking
- Use the cash ledger (`cash_transactions`) for interest/principal flows
- Segment/subcategory rules determine pool constituents (like ETF rules)

---

## Final goal (north star)

Build the central “truth + plumbing” layer for the car market:

- **Truth layer**: every vehicle has a verified timeline, ownership history, and financial history backed by evidence.
- **Tracking hub**: every transaction (purchase, spend, sale, financing) is representable—even if money doesn’t flow through us.
- **Money layer**: when money *does* flow through us, it’s ledgered and attributable to work/receipts/ownership changes.
- **Investment layer**: users can invest via:
  - segment funds (ETF-like exposure)
  - fixed-income notes/bonds
  - profit-sharing stakes
  - (next) pooled lending products for specific car archetypes (e.g. commuter lending pools)

In short: **car market Bloomberg + Plaid + cap table + evidence locker**, where “tracking” is the default and incentives make reporting inevitable.


