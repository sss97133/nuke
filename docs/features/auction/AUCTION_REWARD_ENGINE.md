# Auction Reward Engine (Participation Incentives)

## Goal

Make last-minute bidding (the final-window “soft close” period) feel like a game without compromising auction correctness. Rewards are **orthogonal** to bid validity and settlement: they should never change what a bid is or who wins; they only grant optional perks/merch/credits.

## Core Concepts

### Campaign
A time-bounded promo tied to a single auction listing (or a set of listings).

- Examples:
  - “First 100 bids under reserve get a shirt”
  - “First bidder to hit reserve gets a reward (but can still be outbid)”
  - “Last-2-minutes bids enter a micro raffle”

### Rule
A deterministic condition evaluated when an event occurs.

- **Event types**:
  - `bid_placed`
  - `reserve_hit`
  - `auction_extended` (soft close reset occurred)
  - `auction_ended`

- **Rule predicates** (examples):
  - Bid is under reserve
  - Bid is within final window (<= `soft_close_window_seconds`)
  - Bid is the first bid on listing
  - Bid causes reserve to be met for the first time
  - Bid count <= 100

### Entitlement (Reward Grant)
An immutable record that a user earned a reward for a specific reason.

- Must be **idempotent**: the same event should not mint duplicates even if we reprocess jobs or re-deliver realtime messages.
- Must be **auditable**: store the triggering event reference and rule that fired.

## Design Requirements

- **Correctness first**: auction state (end time, high bid, bid count) is updated atomically and remains authoritative.
- **Idempotent grants**: `UNIQUE(event_id, rule_id)` or `UNIQUE(listing_id, user_id, rule_id, window_key)` depending on rule semantics.
- **Rate limiting / anti-abuse**:
  - Per-user bid frequency caps in the final window.
  - Eligibility gates (account age, verified payment method).
  - Fraud scoring hooks (IP/device fingerprinting).
- **Configurable** per listing:
  - Enable/disable reward mechanics.
  - Inventory caps (e.g., 100 shirts).
  - Budget caps (credits, prizes).

## Suggested Schema (minimal)

### `auction_reward_campaigns`
- `id` (uuid)
- `listing_id` (uuid, FK `vehicle_listings`)
- `status` (`draft|active|paused|ended`)
- `starts_at`, `ends_at`
- `metadata` (jsonb): copy, terms, shipping restrictions, inventory caps

### `auction_reward_rules`
- `id` (uuid)
- `campaign_id` (uuid)
- `event_type` (text)
- `priority` (int)
- `predicate` (jsonb): declarative rule config (thresholds, caps)
- `reward` (jsonb): what is granted (shirt sku, credit cents, badge)

### `auction_reward_entitlements`
- `id` (uuid)
- `campaign_id`, `rule_id`, `listing_id`, `user_id`
- `trigger_event` (jsonb): bid id, timestamps, reserve transition, etc.
- `status` (`granted|fulfilled|revoked`)
- `created_at`
- Unique constraint per rule semantics:
  - For “reserve hitter reward”: `UNIQUE(listing_id, rule_id)` (only one winner)
  - For “first 100 bids”: `UNIQUE(listing_id, user_id, rule_id)` plus campaign-level counter enforcement

## Execution Points

- **Database function** (preferred): after a bid is accepted and listing state is updated, call an internal function like `evaluate_reward_rules(p_listing_id, p_bid_id)`.
  - Keeps the reward trigger in the same transaction boundary if needed.
  - Can be made best-effort if we want zero risk to bidding (e.g., write a “reward_eval_queue” row).

- **Async worker** (safe default): enqueue reward evaluation with the bid id as payload; worker mints entitlements with idempotent constraints.
  - Failure cannot block bidding.

## UI Hooks

- Surface active campaign copy near the bid UI:
  - “First 100 bids under reserve get a shirt (87/100 remaining)”
  - “Reserve hitter reward available”
- When a user earns something, show a simple banner and add it to “My Rewards”.

## Guardrails

- All reward copy must be explicit that rewards do not guarantee winning.
- Rewards should not create incentives to spam bids (use verification gates + rate limits).


