# Live Auctions: Stability and Scale (4k–10k)

**Last updated:** 2026-02-02

## Goal

- **Target:** 4k–10k live auctions at a time.
- **Stable:** Cron every 15 min; UI and portfolio stats use the same source of truth.

## What Was Done (2026-02-02)

1. **UI/stats parity**
   - `sync-live-auctions` now sets `sale_status = 'auction_live'` on vehicles when upserting live auctions, and clears it when marking auctions ended.
   - Portfolio and homepage count active auctions with `sale_status = 'auction_live'`; that count now matches the synced set.

2. **Schema**
   - Migration `20260202_vehicles_sale_status_auction_live.sql`: `vehicles.sale_status` allows `'auction_live'` and `'ended'` (and existing values).

3. **Scale**
   - Collecting Cars: paginated Typesense fetch (250 per page, up to 40 pages) so we can grow toward 4k–10k live from CC alone.

4. **Status endpoint**
   - `POST {action: "status"}` returns `sale_status_live_count` in addition to `total_active` (by `auction_status`).

5. **Cron**
   - Job `sync-live-auctions` runs every 15 minutes; timeout increased to 300s for paginated CC.

## Deploy Checklist

1. **Supabase**
   - Run migrations (including `20260202_vehicles_sale_status_auction_live.sql` and `20260202_sync_live_auctions_cron.sql` if not already).
   - Deploy edge function:  
     `supabase functions deploy sync-live-auctions --no-verify-jwt`
   - Ensure pg_cron has the job (or re-run the cron migration).

2. **Optional: cron auth**
   - If the function should require auth, set `app.settings.service_role_key` or `app.service_role_key` in the DB so the cron sends a Bearer token. If you leave the function as no-verify-jwt, cron can call without a key.

3. **Verify**
   - Call `POST /functions/v1/sync-live-auctions` with `{"action": "sync"}` once.
   - Call with `{"action": "status"}` and confirm `total_active` and `sale_status_live_count` increase after sync.

## Sources

| Platform           | Method              | Scale / notes                          |
|--------------------|---------------------|----------------------------------------|
| BaT                | Page JSON scrape    | All active in one page                 |
| Collecting Cars    | Typesense API       | Paginated, up to 10k (250×40 pages)   |
| Cars & Bids       | Firecrawl           | Credit-dependent; may fail             |

## Agent / Session Notes

- **ACTIVE_AGENTS.md** “Live BaT Auctions | 126” was from `auction_status = 'active'` only; after this change, sync also sets `sale_status = 'auction_live'`, so dashboard and portfolio “live” counts align.
- For 4k–10k: rely on BaT + Collecting Cars (paginated); C&B is best-effort. Add more platforms (e.g. Hagerty, PCarMarket) if needed.
