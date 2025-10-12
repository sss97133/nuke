# Pricing Signal Architecture

This document outlines the incremental pricing signal system for the Discover and Vehicle pages. It is intentionally simple to start (Phase 1) and designed to evolve into a robust, provenance‑aware signal (Phases 2–4).

## Phase 1 — Minimal, reliable client signal (implemented)

- Source: `vehicles` table fields only.
- Primary price selection (first available):
  1. ASK (is_for_sale && asking_price)
  2. SOLD (sale_price)
  3. EST (current_value)
  4. PAID (purchase_price)
  5. MSRP (msrp)
- Delta anchor preference:
  - Prefer purchase_price; else msrp.
- Display:
  - Two 8pt chips (Win95 style): `LABEL: $amount` and `↑/↓ pct`.
- Implementation:
  - `src/services/priceSignalService.ts` for helpers
  - `src/components/feed/DiscoveryFeed.tsx` selects price fields and attaches to `metadata`
  - `src/components/feed/ContentCard.tsx` renders chips for vehicle items
  - `src/components/feed/DiscoveryHighlights.tsx` renders chips for Recently Added vehicles

## Phase 2 — Consistent server signal via RPC

Introduce a Postgres function that normalizes price signal across the app and consolidates sources.

- Proposed function: `vehicle_price_signal(vehicle_ids uuid[]) returns table (...)`
- Inputs: list of vehicle IDs
- Logic (incremental):
  1. Read `vehicles` fields (asking/current/sale/purchase/msrp)
  2. Read latest sale from `timeline_events` where event_type in ('ownership_transfer','auction_sale')
  3. If `vehicle_listing_archives` has recent `final_sale_price`, prefer most recent
  4. Choose primary label/amount, compute anchor and delta (same rules as Phase 1)
  5. Compute `confidence` from available sources (see below)
  6. Return `sources` provenance (array of text)

- Suggested return columns (implemented):
```
vehicle_id uuid,
primary_label text,          -- ASK|SOLD|EST|PAID|MSRP
primary_value numeric,
anchor_label text,           -- PURCHASE|MSRP
anchor_value numeric,
delta_amount numeric,
delta_pct numeric,
confidence integer,          -- 0..100
sources text[],              -- e.g. {'vehicles.asking_price','timeline_events.sale','listing_archive.sale'}
missing_fields text[],       -- e.g. {'purchase_price','msrp','current_value','asking_price'}
updated_at timestamptz
```

- Confidence draft:
  - +40 when primary is SOLD with date <= 365d, +25 when ASK or EST present
  - +10 if purchase_price exists, +5 if msrp exists
  - +10 if listing archive provides sale corroboration
  - +10 if there are >10 images (documentation quality proxy)
  - Cap at 95

## Phase 3 — Price history for trend (implemented)

Add storage for historical points to enable time‑based trend chips.

- Table: `vehicle_price_history`
```
id uuid pk,
vehicle_id uuid,
price_type text,             -- ask|sold|est|purchase|msrp
value numeric,
source text,                 -- vehicles, timeline_events, listing_archive
as_of timestamptz,
confidence integer,
created_at timestamptz default now()
```
- Ingestion:
  - Appends when:
    - vehicle price fields change (UI saves and CSV import write to history)
    - optional DB trigger appends automatically on `vehicles` updates
    - sale timeline event is created (`TimelineEventService.createBATAuctionEvent`)
    - listing archive ingests a sale
- Trend calculation:
  - Compare latest vs previous of same `price_type`
  - Fallback: latest primary vs last anchor

## Phase 4 — UI surfacing (in progress)

- Discover:
  - Vehicle cards show primary price + delta (%); optional compact market band when `current_value` exists.
- Vehicle profile:
  - `VehicleHeader.tsx`: add tiny trend chip (e.g., `↑4.2% 30d`)
  - Price History modal: list of historical points with provenance (implemented)
  - Price Analysis panel: primary/anchor/delta/confidence/sources, sparkline, deep links to Bulk Price Editor (implemented)

## Security & performance

- Respect RLS; the RPC should only expose fields already available to the caller.
- Batch calls: accept `uuid[]` to compute signals for many vehicles at once.
- Cache at service layer or via materialized view if needed.

## Future sources

- External marketplaces (auction feeds)
- Appraiser overrides (human verified)
- AI condition analysis (from image tags) as a minor modifier

## Testing checklist

- Vehicles with only `msrp` → show MSRP, no delta
- Vehicles with `purchase_price` and `current_value` → show EST + delta
- Vehicles with `asking_price` → show ASK + delta (vs purchase or msrp)
- Vehicles with `sale_price` → show SOLD, delta vs purchase or msrp
- No price fields → show no chips

## Admin tools (for manual updates)

- Bulk Price Editor (`/admin/price-editor`): filters (Missing MSRP/Purchase/Current, For Sale w/o Asking, Sold but For Sale), quick actions, writes history on save.
- CSV Price Import (`/admin/price-import`): dry-run, batch update price fields, writes history.

## Triggers

- `supabase/sql/vehicle_price_history_trigger.sql` adds a DB trigger to log history on `vehicles` updates (msrp, purchase_price, current_value, asking_price, sale_price). Apply to enable automatic logging.

## File references

- `src/services/priceSignalService.ts`
- `src/components/feed/DiscoveryFeed.tsx`
- `src/components/feed/ContentCard.tsx`
- `src/components/feed/DiscoveryHighlights.tsx`
