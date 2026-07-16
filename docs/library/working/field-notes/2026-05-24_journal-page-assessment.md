# `/journal` and `/journal/:date` — UI assessment

Date: 2026-05-24. Observer: agent under house. Method: code read + direct curl + SQL probe + MCP project_work_log call. UI not opened in a browser per "assess before showing Skylar" rule.

## Executive verdict — ONE SENTENCE

**BROKEN in production.** The React shell boots, but the `/api/journal/:date` endpoint returns HTTP 404 because no edge function or Vercel handler is wired up to it; the underlying `project_work_log` projection works and has rich content for at least one date (2026-05-03, K10 engine-bay), but a visitor today sees a loading shimmer that flips to "ERROR · fetch failed: 404".

## What's actually happening — the routing chain

1. Browser hits `https://nuke.ag/journal/2026-05-03` → returns 200 (the React app's `index.html`, 3,083 bytes).
2. React mounts `JournalPage` (`nuke_frontend/src/pages/journal/JournalPage.tsx:118`), which fetches `/api/journal/2026-05-03`.
3. Vercel resolves `/api/:path+` (root `vercel.json:52-54`) to `https://qkgaybvrernstplzjaam.functions.supabase.co/mailbox/:path+`.
4. There is no edge function named `mailbox` (`supabase/functions/` only has `agent-email`, `gmail-alert-poller`, `process-alert-email`, `reply-email`, `send-invoice-email` for the "mail" family). The Supabase Functions gateway returns `{"code":"NOT_FOUND","message":"Requested function was not found"}` with HTTP 404.
5. `JournalPage` catches the error and renders `ERROR · fetch failed: 404` in the meta row, no body content.

Same chain breaks `/api/journal` (the index), so `JournalIndex` also renders "ERROR · fetch failed: 404" and the 90-day grid stays empty.

Verified live:
- `curl https://nuke.ag/api/journal/2025-04-07` → 404, 65 bytes, `{"code":"NOT_FOUND",...}`
- `curl https://nuke.ag/api/journal` → 404, same body
- `curl https://qkgaybvrernstplzjaam.functions.supabase.co/mailbox/journal/2025-04-07` → 404, same body
- `curl https://nuke.ag/journal` → 200, 3,083 bytes (React shell)
- `curl https://nuke.ag/journal/2025-04-07` → 200, 3,083 bytes (React shell)

## What the projection engine returns when called correctly

The `project_work_log` tool on `mcp-connector` is healthy and produces well-shaped data. Verified by direct MCP call.

### Test date 1 — 2026-05-03, scoped to K10 (`afcfef94-895f-436b-b66c-acb2e2f46973`, 1979 Chevrolet K10)

The clean demo:

```json
{
  "date": "2026-05-03",
  "audience": "public",
  "confidence": 0.67,
  "observation_count": 4,
  "summary": {
    "photo_count": 4,
    "work_order_count": 0,
    "labor_lines": 0,
    "parts_lines": 0,
    "payment_count": null,
    "receipt_count": 0,
    "receipt_total": 0
  },
  "photos": [
    {
      "id": "64d03ad2-...",
      "url": "https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-photos/unassigned/iphoto_60d/EA2677CB-....jpeg",
      "vehicle_id": "afcfef94-...",
      "taken_at": "2026-05-03T04:04:17Z",
      "atoms": [
        { "attribute": "image.in_progress_work",
          "label": { "task": "engine top-end work, intake manifold off", "stage": "disassembly", ... },
          "confidence": 0.88, "caller_slug": "claude-opus-4-7-via-byok", "caller_base_trust": 0.3 },
        { "attribute": "vehicle.viewpoint", "label": "engine_bay", "confidence": 0.97, ... },
        { "attribute": "image.location_class", "label": "shop", "confidence": 0.78, ... },
        { "attribute": "image.classification", "label": "engine_bay", "confidence": 0.98, ... },
        { "attribute": "image.has_vehicle", "label": true, "confidence": 0.97, ... }
      ]
    },
    /* 3 more, all with similar atom coverage */
  ],
  "work_orders": [],
  "receipts": []
}
```

This is the proof-of-pattern Skylar described: 4 iPhoto photos, each with 5+ atoms attributed by slug and base_trust. Per-photo atom attribution works.

### Test date 2 — 2026-05-03, NO vehicle scope (default page behavior)

This is what the deployed UI WOULD call. Different story:

- `photo_count: 200` (max limit hit)
- Photos are mostly **`bringatrailer.com/wp-content/uploads/...`** auction-listing scrapes whose `taken_at` was backfilled to recent dates — not Skylar's shop. First photo: a 1994 Toyota Supra from BaT.
- `atoms_present_count: 0` across all 200 photos.
- `work_orders[0]` is the **seed row** `00000001-0000-4000-a000-000000000001` ("Custom Exhaust Fabrication — 1983 GMC K2500"), not real shop activity.
- `receipt_count: 0` on the public projection even though density view shows 2 receipts for that day, because the public filter requires `scope_type='vehicle' AND scope_id IS NOT NULL`. None of the 2026-04-06 receipts had a vehicle scope.

If a stranger landed on `/journal/2026-05-03` and the API were wired, they'd see 200 cards of BaT auction photos with no atoms and the K2500 seed work-order — looks like a junk feed.

### Test date 3 — 2025-04-07 (last K5 receipt OCR date), 2024-01-11 (K5 NV DMV title)

Not reachable via the journal density index. `vw_journal_density` is hardcoded to `CURRENT_DATE - 90 days` (read the view def: `WHERE taken_at >= (CURRENT_DATE - '90 days'::interval)`). Today is 2026-05-24, so the index window is 2026-02-23 → 2026-05-24 only. Every K5 receipt OCR span (2021-04-15 → 2025-04-07) is outside the index. You can deep-link to `/journal/2025-04-07` directly, but the day page would still hit the broken API.

I attempted to project_work_log against 2025-04-07 without a vehicle scope and the underlying `vehicle_images` query timed out (60s+) under current DB load — there's heavy contention from BaT scrape ingestion (saw 4+ active `INSERT INTO vehicle_images` queries blocking at `DataFileRead`).

## What's populated, what's NULL/empty (in the underlying substrate)

For 2026-05-03 / K10:
- **photos[].url** — full Supabase Storage URLs, valid (iphoto_60d source bucket).
- **photos[].vehicle_id** — populated for 4/7 photos on this day (3 unassigned).
- **photos[].atoms** — populated with 4-5 atoms each; `caller_slug = 'claude-opus-4-7-via-byok'`; mix of `result_kind` substrate + projection.
- **photos[].angle** — NULL.
- **work_orders / labor / parts / payments / receipts** — all empty for this date.

For 2026-04-06 (highest density day in the 90-day window):
- 200 photos, NONE with atoms.
- 1 work_order — synthetic seed row.
- 2 receipts in density view, 0 after public filter (no vehicle scope).

## What renders well, what would look broken to a visitor

If the API endpoint existed and were wired correctly:

**Renders well** (the K10 scoped case, 2026-05-03):
- 4 engine-bay shots in a clean grid, each captioned with vehicle_id and per-photo atom strip showing attribute/label/caller. This is the demo wedge.

**Renders broken** (the default unscoped case):
- 200 cards of BaT auction photos with no atoms (the bottom of every card would just say "{vehicle_id}" with no attribute strip).
- A single "Custom Exhaust Fabrication — 1983 GMC K2500" work-order row that's literally a seed UUID.
- "EXPENSES" section absent because public scope filter strips all non-vehicle-scoped receipts.

**Renders not at all** (current production):
- The shell loads. The header says "NUKE · JOURNAL · SURFACE: PUBLIC · SUBSTRATE-PROJECTED · 2026-05-03". Below it: `ERROR · fetch failed: 404`. Done.

## Concrete date Skylar can visit that has actual content

**None today.** Two independent blockers:

1. **The `/api/journal/:date` endpoint is not deployed.** Vercel rewrites to a `mailbox` edge function that doesn't exist. This must be fixed before any date works in the browser.
2. **Even after fix, the default no-scope route shows junk.** The page calls without a vehicle_id, gets 200 BaT scrape photos, 0 atoms. Demo-ready only when scoped.

If both are fixed, the URL to point at is:
- `https://nuke.ag/journal/2026-05-03?vehicle_id=afcfef94-895f-436b-b66c-acb2e2f46973` (K10 engine-bay teardown, 4 photos × ~5 atoms, all attributed to `claude-opus-4-7-via-byok`)

But `JournalPage.tsx` doesn't currently read a `vehicle_id` query parameter — it would need a small addition to pass through to `project_work_log`.

## The three things that need to be true for `/journal/:date` to be the demo wedge

1. **An `/api/journal/:date` handler must exist and return the project_work_log envelope.** Either:
   - Add a Vercel rewrite mapping `/api/journal/:date*` → `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/mcp-connector` with a thin Vercel function that wraps the MCP `project_work_log` call (current MCP is JSON-RPC, not REST), OR
   - Ship a tiny dedicated edge function `journal-get` that wraps `project_work_log` and exposes REST shape `{ date, vehicle_id?, audience? }` → the existing JSON shape the page expects.
   - Same for `/api/journal` → wrap a SELECT on `vw_journal_density`.
2. **The default unscoped projection must not surface BaT auction scrapes as "the shop diary."** Either filter `vehicle_images.source IN ('iphoto_60d', 'owner_upload', ...)` server-side in `project_work_log` for `audience='public'`, or require a `vehicle_id` for the public audience and have `/journal/:date` show a vehicle picker if absent. Right now `taken_at` is being backfilled to recent dates from BaT scrapes and pollutes the day view.
3. **The 90-day density view's photo source filter (`source = 'iphoto_60d'`) must align with what actually fills `atoms`.** Today 2026-05-03 is the only day in the window with both iPhoto photos AND populated atoms. If you want a credible demo grid, the projection engine should backfill atoms for the other 14 days in the window that have receipts/payments but no photos with atoms.

## Side findings (not blocking)

- The `project_work_log` LIMIT 200 on `vehicle_images` is a footgun — when unscoped and a noisy date, you get 200 unrelated cards back. Either drop the limit and paginate or pre-filter by `source`.
- `vehicle_images.taken_at` for BaT scrapes is being set to the scrape time (e.g. 2026-04-06T07:45Z for a 1994 Supra listing image). That's wrong — `taken_at` should reflect photo capture time, not ingestion. This pollutes any time-keyed projection (journal, timeline).
- Sync `JournalIndex` description says it's backed by `/api/journal -> vw_journal_density`, which makes the same 404 mistake.
- DB has heavy active load right now from `vehicle_images` inserts — saw 4+ queries blocked at `DataFileRead`. Not journal-related, but worth noting if anyone tries to repro and gets timeouts.
