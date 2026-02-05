# Where auction/vehicle data is seen and accessed

This doc answers: **where do the extracted fields (chassis, estimate, coachwork, highlights, etc.) show up for users and how can you access them?**

---

## On the website (n-zero.dev)

### 1. **Homepage feed** (`/`)

- **URL:** `https://n-zero.dev/` (or your deployed domain root).
- **What you see:** Cards for vehicles that have `status != 'pending'` and `is_public = true`. Each card shows thumbnail, year/make/model, price signals, etc.
- **Gooding (and other auction) vehicles** appear here **only after** their `vehicles.status` is set to `'active'` (we fixed that so new/backfilled auction imports use `active`).

### 2. **Vehicle profile page** (`/vehicle/:id`) — **main place for full data**

- **URL:** `https://n-zero.dev/vehicle/<vehicle-id>`  
  Example: `https://n-zero.dev/vehicle/550e8400-e29b-41d4-a716-446655440000`
- **What you see:** Full listing data:
  - **Chassis / VIN** (e.g. Gooding chassis `16407` stored as `vin` when no 17-char VIN)
  - **Estimate** (from auction metadata)
  - **Coachwork**, **highlights**, **specifications**, **saleroom addendum**, **auction calendar position**
  - **Images** (all Cloudinary sets we extract)
  - **Link to source** (e.g. Gooding lot URL in header/source section)

**How you get there:** Click any vehicle card on the homepage feed, or open the URL directly if you know the vehicle `id`.

### 3. **Auctions page** (`/auctions`)

- **URL:** `https://n-zero.dev/auctions`
- **What you see:** Auction marketplace view; listings that have an `external_listings` row (and linked `vehicle_id`) can appear here. Clicking a listing goes to the **vehicle profile** at `/vehicle/<vehicle_id>` (or to `/auction/:listingId` for internal listing detail, depending on UX).

### 4. **Search**

- **URL:** `https://n-zero.dev/search`
- **What you see:** Search results can include vehicles by year, make, model, etc. Clicking a result goes to `/vehicle/<id>`.

---

## How to get a vehicle ID so you can open the profile

- **From the UI:** Use the homepage or search; click the vehicle card → the URL in the browser is `/vehicle/<id>`.
- **From the database:**  
  - By Gooding (or any) source URL:
    ```sql
    SELECT id, year, make, model, vin, discovery_url
    FROM vehicles
    WHERE discovery_url ILIKE '%goodingco.com/lot/%'
    ORDER BY created_at DESC
    LIMIT 20;
    ```
  - By chassis if we store it in `vin`:
    ```sql
    SELECT id, year, make, model, vin, discovery_url
    FROM vehicles
    WHERE vin = '16407' OR vin LIKE '%16407%';
    ```

---

## In the database

- **`vehicles`**  
  Core fields: `vin` (chassis when no 17-char VIN), `year`, `make`, `model`, `notes`, `origin_metadata` (JSON: coachwork, estimate, auction_calendar_position, saleroom_addendum, highlights, specs, etc.), `discovery_url`, `status`, `is_public`.

- **`external_listings`**  
  One row per source listing; `metadata` holds platform-specific fields (chassis, coachwork, estimate, saleroom_addendum, auction_calendar_position, etc.). `vehicle_id` links to `vehicles.id`.

So: **on the site, the data is “seen” on the vehicle profile page** (`/vehicle/<id>`), and optionally in the feed and auctions list. **In the backend, it’s stored in `vehicles` and `external_listings`** and is loaded by the vehicle profile API / RPC (e.g. `get_vehicle_profile_data`).
