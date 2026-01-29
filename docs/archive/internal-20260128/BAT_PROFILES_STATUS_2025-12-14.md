# BaT profiles: “show all the data” fixes + what’s next (2025-12-14)

This doc captures what we shipped to make **Bring a Trailer (BaT) source vehicle profiles** feel “live” and stop showing empty/buggy UI.

## What we shipped

### Live auction “pulse” in the vehicle header
- **Goal**: Make `div.vehicle-price-header` feel bustling for live auctions (price, countdown, bids, watchers, views, comments, last-bid age) and prioritize bidding actions when live.
- **Change**:
  - Vehicle profile now derives an `auctionPulse` from `external_listings` + `auction_comments` and passes it to the header.
  - Header renders badges for BaT platform + auction status + timer + bid/watch/view/comment telemetry.
  - Auction badge rendering no longer depends on `listing_status === 'active'` only; it can infer “live” from a **future `end_date`** even when status is `unknown`.
- **Files**:
  - `nuke_frontend/src/pages/VehicleProfile.tsx`
  - `nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx`

### BaT images appear immediately (even before backfill) + one-click import
- **Goal**: Stop “No images yet” on scraped/BaT vehicles; show listing images immediately and allow importing into `vehicle_images`.
- **Change**:
  - `ImageGallery` can display **fallback listing images** (read-only) when `vehicle_images` is empty.
  - Adds **Import images from listing** action that inserts URLs into `vehicle_images`.
  - Prevents synthetic fallback image ids (`ext_*`) from triggering DB lookups and producing 400 spam.
- **Files**:
  - `nuke_frontend/src/components/images/ImageGallery.tsx`
  - `nuke_frontend/src/components/images/SensitiveImageOverlay.tsx`

### Fix production “hard crash” regressions
- **TDZ crash (`Cannot access 'G' before initialization`)**: fixed by moving session state above callbacks that reference it (and avoiding hook-order issues).
- **`useMemo is not defined`**: fixed by importing `useMemo` where used.
- **Result**: Vehicle pages render again in production.
- **Files**:
  - `nuke_frontend/src/components/images/ImageGallery.tsx`
  - `nuke_frontend/src/pages/CursorHomepage.tsx`

### Backend guardrails so BaT profiles don’t “miss data”
- **RPC resilience**: fixed `get_vehicle_profile_data` ordering so it doesn’t crash on a non-existent column.
- **Auto-backfill + sync**:
  - Backfills missing `external_listings` rows for BaT-imported vehicles
  - Periodically syncs active BaT listings (bid/watch/view/status) via `sync-bat-listing`
- **Files**:
  - `supabase/migrations/fix_vehicle_profile_rpc_vehicle_documents_ordering.sql`
  - `supabase/migrations/bat_external_listings_autobackfill_and_sync_cron.sql`
  - `supabase/functions/sync-bat-listing/index.ts`

### Reduce noisy console errors (non-fatal)
- **Mailbox badge JSON parse**: some deployments may return `index.html` for `/api/*` (200 HTML). We now **guard `response.json()` by `content-type`** to avoid `Unexpected token '<'` noise.
- **Missing `get_vehicle_documents` RPC**: fallback to querying `vehicle_documents` + `reference_documents` when the RPC is not deployed (404).
- **Timeline activity**: calendar heatmap counts activity using `COALESCE(taken_at, created_at)` for photos, and fetches auction comment dates without fragile joins.
- **Files**:
  - `nuke_frontend/src/components/VehicleMailbox/MailboxNotificationBadge.tsx`
  - `nuke_frontend/src/hooks/useVehicleMailbox.ts`
  - `nuke_frontend/src/services/referenceDocumentService.ts`
  - `nuke_frontend/src/components/VehicleTimeline.tsx`

### Prevent cross-vehicle RPC cache bleed
- **Problem**: navigating between profiles could reuse `window.__vehicleProfileRpcData` from the previous vehicle.
- **Fix**: tag the cache with `vehicle_id` and only read it when it matches; clear cache at start of load to avoid stale cross-vehicle state.
- **File**:
  - `nuke_frontend/src/pages/VehicleProfile.tsx`

## Current production status (as of this doc)
- `n-zero.dev/vehicle/b4892ba2-c650-45aa-818a-43e3e458ba0b`:
  - renders without crashes
  - shows BaT auction header pulse (BaT + bids + timer badges)
  - shows BaT images immediately and allows import
  - no longer spams 400s from synthetic `ext_*` ids

## What we should address next (recommended)

### 1) Mailbox API routes: either deploy them, or feature-flag them
Right now the UI assumes `/api/vehicles/:id/mailbox` exists. In static deployments it may not.
- **Option A**: implement Vercel serverless routes for `/api/vehicles/*` used by mailbox.
- **Option B**: feature-flag mailbox badge + mailbox fetches when those routes are absent.

### 2) Auction activity “proof” and timeline receipts
We have the data to make the timeline feel like a daily research partner:
- **Heatmap**: split counts by type (bids vs comments vs photos) and color days accordingly.
- **Daily receipt**: generate a concise “daily auction receipt” summary (bids, notable comments, momentum) and pin today’s receipt open when live.

### 3) Reliability + observability for ingestion
To make “all BaT profiles show all the data” consistently:
- Add health dashboards / alerts for:
  - vehicles missing `external_listings` rows
  - active auctions not synced in the last N minutes
  - vehicles with `origin_metadata.image_urls` but no `vehicle_images` rows
- Add a one-click “re-sync listing” action on the vehicle page (admin/owner).

### 4) Normalize BaT images into `vehicle_images` automatically
Fallback display is good, but importing should ideally be automatic:
- background job to import/dedupe scraped images into `vehicle_images`
- store attribution + source URL + hash for dedupe


