# Transfer System — Cross-Department Brief
**From:** VP Deal Flow
**Date:** 2026-02-26
**Priority:** High — active deals are going untracked, revenue is leaking

---

## Situation

A deal recently happened outside the system. Investigating why surfaced the full picture.

The **backend is almost entirely built and working**. The gap is the user-facing layer — operators have no dashboard, buyers/sellers have no page to act on, and when a deal closes nobody gets notified. Result: 30,642 transfers seeded, all stalled at step 1 (`agreement_reached`), 23,854 milestones now overdue.

---

## What's Already Built (Do Not Rebuild)

| Layer | What Exists | Status |
|---|---|---|
| `ownership_transfers` | Core transfer record — 30K rows | Working |
| `transfer_milestones` | 553K milestone rows, 18 per transfer | Working |
| `transfer-automator` | Seeds transfers on auction close (DB trigger) | Working |
| `transfer-advance` | Advances milestones — manual, AI signal, email, SMS | Deployed, not wired to UI |
| `transfer-status-api` | Read-only state endpoint for UI consumption | Working |
| `transfer-email-webhook` | Incoming email → `transfer-advance` | Deployed |
| `transfer-sms-webhook` | Incoming SMS → `transfer-advance` | Deployed |
| Staleness sweep cron | Every 4h marks overdue milestones | Active |
| VehicleHeader transfer badge | Shows status/progress on vehicle profile | Just shipped |
| `vehicle_transactions` | Stripe checkout + DocuSign signing | Exists, 0 rows |

---

## The Problem: Two Parallel Systems

There are **two transaction systems** that were built independently and never connected:

**System A: `ownership_transfers`** (newer, process-oriented)
- Tracks the full post-sale process: deposit → payment → inspection → title → delivery
- AI-powered milestone classification from email/SMS
- Per-transfer inbox email (`t-{id}@nuke.ag`)
- 30K rows, all stuck at step 1

**System B: `vehicle_transactions`** (Stripe-oriented)
- Handles facilitation fee payment via Stripe Checkout
- DocuSign purchase agreement + bill of sale
- Buyer/seller sign tokens
- 0 rows — never used in production

These need to be **connected**, not run in parallel. The Stripe/signing flow (System B) should be a milestone within the transfer process (System A), not a separate thing.

---

## What Each Department Needs to Do

### VP Platform — Build the UI
Three screens needed, in priority order:

**1. Operator Transfer Dashboard** (internal, auth-gated)
- Route: `/transfers` or inside dealer/admin area
- List view: all `in_progress` transfers, sorted by overdue milestones
- Per-transfer detail: milestone checklist with quick-advance buttons
- Calls `transfer-status-api` for reads, `transfer-advance:advance_manual` for writes
- Party info: seller handle, buyer handle, whether they've claimed their identity

**2. Buyer/Seller Transfer Page** (external, token-accessible, no login required)
- Route: `/t/{transfer_id}` or `/transfer/{token}`
- Shows: the car, current step, what action is needed from them right now
- One action at a time: "I sent the deposit" → `transfer-advance:ingest_signal`
- Inline text box for free-form updates → AI classifies → advances milestone
- No auth wall — accessible via unique link sent via email/SMS

**3. "Log a Deal" Entry Point** (for private sales that don't go through auctions)
- Simple form: vehicle ID, agreed price, buyer info, seller info, deal date
- Calls `transfer-automator:seed_from_listing`
- This is what was missing for the "recent missed deal"

**Existing components to leverage:**
- `VehicleMailbox` — has messaging infrastructure, could surface transfer comms
- `TitleTransferApproval.tsx` — reads from old `title_transfers` table, needs to be migrated/replaced
- `vehicleTransactionService.ts` — has `createVehicleTransaction()` → Stripe, needs to connect to `ownership_transfers`

---

### CFO — Fee Architecture
The fee machinery exists in `vehicle_transactions` (Stripe session, facilitation_fee_pct, facilitation_fee_amount) but it's disconnected from the transfer process.

**Decision needed:**
- What milestone triggers the facilitation fee? Recommendation: `deposit_confirmed` (money has moved, we've facilitated)
- What's the fee structure? `vehicle_transactions.facilitation_fee_pct` is the field — currently nullable
- Should we collect via Stripe Checkout (already built in `stripe-checkout` function) or invoice?

**Revenue at stake:** 30,642 in-progress transfers. Even at 1% facilitation on median ~$40K deals = ~$12M in potential fee events sitting uncaptured.

---

### CTO — Architecture Decisions

**1. Reconcile the two systems**
`ownership_transfers` should be the source of truth for process state.
`vehicle_transactions` should become the fee/payment record that gets created at the `payment_confirmed` milestone — not a parallel flow.

Suggested approach:
- Add `ownership_transfer_id` FK to `vehicle_transactions`
- When `payment_confirmed` milestone fires → create `vehicle_transactions` row + trigger Stripe checkout for facilitation fee

**2. Token-based access for buyer/seller transfer page**
`ownership_transfers` has `inbox_email` but no access token for the web page. Options:
- Add `buyer_access_token` / `seller_access_token` UUID columns to `ownership_transfers`
- Or use the existing `buyer_sign_token` / `seller_sign_token` from `vehicle_transactions`
Recommendation: add tokens to `ownership_transfers` directly so the page works before fee collection happens.

**3. Seed notification**
When `transfer-automator` seeds a transfer, it needs to fire an outbound notification. The SMS/email infrastructure exists but outbound isn't wired.
`transfer-email-webhook` + `transfer-sms-webhook` handle *inbound*. Need a `notify-transfer-parties` function or extend `transfer-automator` to send on seed.

---

### VP Deal Flow (me) — Will Handle
- Connect `transfer-automator` seed → outbound notification
- Wire the private sale trigger so the "Log a Deal" entry point fires `seed_from_listing`
- Define facilitation fee milestone + connect to `stripe-checkout`
- Coordinate across departments once decisions are made on fee structure and token approach

---

## Recommended Sequence

1. **CTO** decides: token approach + system reconciliation plan (how `vehicle_transactions` connects to `ownership_transfers`)
2. **CFO** decides: fee milestone, fee structure
3. **VP Platform** builds operator dashboard first (no token complexity, internal only)
4. **VP Deal Flow** wires seed notification + private sale entry
5. **VP Platform** builds buyer/seller transfer page (after tokens are defined)

---

## Quick Win Available Now

The "Log a Deal" flow (point 3 above) is a single form + one API call. No architectural decisions needed. Any department can pick this up immediately to prevent future missed deals like the one that triggered this brief.

---

## Questions for the Room

1. Do we want buyers/sellers to be able to log in and see ALL their transfers, or is token-per-transfer sufficient?
2. Is `TitleTransferApproval.tsx` (reads from old `title_transfers` table) still used anywhere? If not, should be removed to avoid confusion.
3. Should `VehicleMailbox` surface transfer communications, or should the transfer page be its own standalone thing?

---
*Brief prepared by VP Deal Flow, 2026-02-26*
