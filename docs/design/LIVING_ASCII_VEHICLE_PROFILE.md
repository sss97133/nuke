# Living ASCII Vehicle Profile — Design Spec

## Purpose

The ASCII block is an **intelligent data-con** (data icon) for vehicle profiles: a living interpretation of profile data that breathes a little life and movement into data-heavy pages. It scales to millions of profiles (75k+ today in Supabase) and is driven by:

- **Vehicle** (year, make, model, sale/auction state, price, origin)
- **Local analysis** (`vehicle_intelligence` when available: condition, provenance, rarity)
- **Auction/listing pulse** (when present: current bid, bid count, time left)

It is **generative from data**, not decorative: shape, label, and “pulse” lines all derive from the same profile so the glyph **means** something at a glance.

---

## Data Sources

### 1. Vehicle (profile)

From `vehicles` / `Vehicle` type:

- **Identity**: `year`, `make`, `model`, `series`, `trim`
- **State**: `auction_outcome`, `auction_end_date`, `is_for_sale`, `asking_price`, `sale_price`, `current_bid`, `bid_count`, `high_bid`, `auction_source`
- **Origin**: `profile_origin`, `origin_metadata`

### 2. Vehicle intelligence (local analysis)

From `vehicle_intelligence` (filled by batch-analyze-vehicle, analyze-vehicle-description, etc.):

- **Condition**: `is_running`, `is_driving`, `is_project`, `is_restored`, `modification_level`
- **Authenticity**: `matching_numbers`, `is_original_color`, `replacement_components`
- **Rarity**: `production_number`, `total_production`, `special_edition_name`, `is_limited_edition`
- **Documentation**: `has_service_records`, `has_window_sticker`, `has_owners_manual`
- **Provenance**: `owner_count`, `climate_history`, `original_delivery_dealer`

Frontend does not yet query `vehicle_intelligence` everywhere; the ASCII component accepts it as an **optional** input and uses it when present.

### 3. Auction / listing pulse

From `VehicleHeaderProps.auctionPulse` (or equivalent):

- `current_bid`, `bid_count`, `listing_status`, `end_date`, `view_count`, `comment_count`, `last_bid_at`, etc.

Used for **live** state: subtle motion and “live” line (current bid, bids, or time left).

---

## Interpretation Rules

### Vehicle state (from profile + pulse)

Map to a single **display state** used for both content and motion:

| State           | When                                                                 | ASCII “mood”     | Motion / emphasis      |
|----------------|----------------------------------------------------------------------|-------------------|------------------------|
| `live_auction` | `auction_end_date > now` and listing is active                      | Live, active      | Gentle pulse / glow    |
| `auction_ended`| `auction_outcome` in {sold, reserve_not_met, no_sale, ended}        | Calm, resolved     | Static or very subtle  |
| `for_sale`     | `is_for_sale` and no active auction                                 | For sale          | Static                 |
| `sold`         | outcome = sold or high_bid/sale_price present and ended             | Sold              | Static, “final” frame  |
| `unlisted`     | In DB, no active listing                                            | Dormant           | Minimal or no motion   |

### Shape (body type)

- Prefer `series` / taxonomy if it implies body style (e.g. “Pickup”, “Coupe”, “Cabriolet”).
- Else derive from `model`/`make` heuristics (e.g. “F-150” → truck, “911” → coupe).
- Fallback: `sedan` or a generic silhouette.
- ASCII silhouettes stay simple (sedan / suv / truck / coupe) so they scale and stay legible at small size.

### Brand / identity line

- Always: **year make model** (e.g. “1969 Chevrolet Camaro”).
- Optional short line: platform when relevant (e.g. “BaT”, “C&B”) from `auction_source` or `profile_origin`.

### Pulse / specs line (data-con content)

One line that changes by state and data:

- **Live auction**: “LIVE · $42,000 · 12 bids” (or time-left “2h left”).
- **Auction ended / sold**: “SOLD · $48,500” or “Reserve not met”.
- **For sale**: “$32,000” (asking).
- **Intelligence when present**: e.g. “matching #s · restored”, “1/500”, “single family”, “service history” — pick one short, high-signal phrase.

Rules:

- Prefer at most one line of “pulse” so the glyph stays scannable.
- When both auction and intelligence exist, prefer auction for live/sold; use intelligence for unlisted or when no price is shown.

### Completeness / gaps (optional)

If the page exposes **data gaps** (e.g. from VehicleDataGapsCard or similar):

- **High completeness**: solid frame, full silhouette.
- **Many gaps**: dashed or lighter frame, or a “?” silhouette.
- Can be a separate “completeness” mode or a visual tweak (opacity, border) on the same glyph.

---

## Motion and “Breathing”

- **live_auction**  
  - Gentle loop: e.g. opacity 0.92 ↔ 1 or a very light scale/glow, 2–3 s period.  
  - Optional: subtle blink or underline on “LIVE” or the price line.
- **Other states**  
  - No loop; optional one-off “settle” when state changes (e.g. live → sold).
- Implementation: CSS `animation` + a class that depends on `displayState` (e.g. `living-ascii--live`). No heavy JS animation.

---

## Placement

- **Vehicle profile**
  - **Header**: compact glyph next to or under the main YMM/title so it reads as “this profile, at a glance.”
  - **Dense cards**: e.g. top-right of VehicleDataGapsCard, or as a small “profile icon” in the first column of a facts/evidence block.
- **Lists / cards**
  - Optional: tiny glyph on each row/card (same data, smaller layout) for consistency across 75k+ profiles.

Use one canonical component so the same interpretation and motion rules apply everywhere.

---

## Component API (summary)

- **Required**: `vehicle` (or a minimal slice: `year`, `make`, `model`, plus any of `auction_outcome`, `auction_end_date`, `current_bid`, `bid_count`, `is_for_sale`, `asking_price`, `sale_price`, `high_bid`, `auction_source`, `profile_origin`).
- **Optional**: `vehicleIntelligence` (condition, matching_numbers, production_number, total_production, etc.), `auctionPulse` (current_bid, bid_count, end_date, …), `dataGapsCount` or `completeness` for frame/silhouette tweaks.
- **Optional**: `size` (e.g. `sm` / `md`), `showMotion` (default true for live), `ariaLabel`.

Output: a small block (pre or canvas) that shows:

1. **Shape** — silhouette from body/style + state.
2. **Identity** — year make model (and optionally platform).
3. **Pulse** — one line: live bid, sold price, asking, or intelligence snippet.

All three are generated from the same inputs so the block is a true data-con for that profile.
