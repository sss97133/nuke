# BHCC Org Profile + Live Vehicles Tab (Closeout)

Date: 2025-12-14  
Owner: Nuke (frontend + org profile UI)  
Scope: BHCC org profile visibility + Vehicles tab reliability + perf/rate-limit stability

## Production URLs (current)
- Frontend (latest prod deploy used for validation): `https://nukefrontend-m67jk0tss-nzero.vercel.app`
- BHCC org profile: `https://nukefrontend-m67jk0tss-nzero.vercel.app/org/bb6253c0-cb83-4d1c-b95c-09c811064af7`

## What was the problem?
1. **Vehicles tab missing** on BHCC org profile.
   - The org page rendered, but the dynamic tab system (org “intelligence”) did not include a `vehicles` tab, so inventory wasn’t discoverable as “Vehicles”.

2. **Vehicles tab could become unstable/noisy** when many vehicles exist.
   - The inventory UI used a per-vehicle thumbnail query approach (hundreds of queries on large orgs), which can trigger rate-limits / request failures and show misleading “CORS blocked” errors in the console.

## What changed (high signal)
### 1) Always show `vehicles` in org tab priority
File: `nuke_frontend/src/services/organizationIntelligenceService.ts`
- `determineTabPriority()` now **always** emits:
  - `overview` (priority 100)
  - `vehicles` (priority 80, badge count when available)
  - plus existing data-driven tabs (`inventory`, `sold`, `service`, etc.) and always-available tabs.
- Added a local `pushUnique()` helper so a tab id is never duplicated.

Result: BHCC (and any dealer) reliably gets a **Vehicles** tab.

### 2) Fix typing + normalize relationship shape in inventory list
File: `nuke_frontend/src/components/organization/EnhancedDealerInventory.tsx`
- Normalized `organization_vehicles.vehicles(...)` join result so it is treated as a single object even if PostgREST/Supabase types surface it as an array.
- Removed TS type mismatch and hardened runtime handling.

### 3) Replace N-per-vehicle thumbnail queries with chunked bulk fetch
File: `nuke_frontend/src/components/organization/EnhancedDealerInventory.tsx`
- Replaced “one thumbnail request per vehicle” with:
  - Collect unique `vehicle_id`s
  - Fetch `vehicle_images` in **chunks** (e.g., 75 ids at a time)
  - Build a `Map<vehicle_id, best_thumbnail_url>`
  - Render list using the map

Result: avoids request storms on large inventories and stabilizes initial page load.

## Verification (done)
On prod:
- Opened BHCC org page and confirmed:
  - Page loads without auth wall
  - **Vehicles tab appears**
  - Vehicles list loads with counts (example observed: **735 vehicles**) and category tabs (Current / For Sale / Sold / All)
  - No mass parallel thumbnail request behavior after chunking

## Notes / Known follow-ups
### Live updates (“profiles appear every couple seconds”)
- `EnhancedDealerInventory` already has:
  - realtime subscription on `organization_vehicles` for that `organization_id`
  - polling fallback (every ~3s)
- If you want to reduce UI noise/log spam: remove/guard `console.log` calls around loading.

### “Failed to load sold vehicles” / data signals analysis
- The org profile console may still show warnings from intelligence/data signal analysis on anon sessions.
- This is non-blocking for Vehicles/Inventory rendering.

## Files changed in this session
- `nuke_frontend/src/services/organizationIntelligenceService.ts`
- `nuke_frontend/src/components/organization/EnhancedDealerInventory.tsx`
- (also accepted in session) `nuke_frontend/src/lib/env.ts`
- (also accepted in session) `nuke_frontend/src/utils/database-audit.ts`

## How to resume next time (pick-up checklist)
1. Confirm BHCC org URL still correct:
   - `bb6253c0-cb83-4d1c-b95c-09c811064af7`
2. If ingestion is running, open Vehicles tab and watch counts increase.
3. If you need faster “every couple seconds” perception:
   - keep polling at 3s, or reduce to 2s (tradeoff: more DB reads)
   - optionally add UI “New vehicles detected” toast on reload diff
4. If thumbnails still look sparse:
   - confirm `vehicle_images.is_primary = true` is being set during imports
   - consider a fallback query for “first image by position” when no primary exists


