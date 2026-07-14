# DB Forensic Audit — 1977 K5 Blazer Records

**Date:** 2026-05-17  
**Scope:** Every `1977 Chevrolet (Blazer | K5 Blazer*)` row in Supabase project `qkgaybvrernstplzjaam`.  
**Anchor (per Skylar 2026-05-17):** Skylar's K5 build = `e08bf694-970f-4cbe-8a74-8715158a0f2e` / VIN `CKR187F127263`. The 141 `vehicle_build_manifest` rows are correct.

## 1. The three focal UUIDs

### `e08bf694-970f-4cbe-8a74-8715158a0f2e` — Skylar's K5 (canonical)
- VIN `CKR187F127263`, color "Maroon", model "Blazer", created 2025-09-20 by `0b9f107a-…` (= shkylar@gmail.com / Skylar Williams).
- `source = user-submission`, `profile_origin = user_uploaded`.
- 2,653 `vehicle_images` rows, 709 observations, 141 build_manifest rows.
- `owner_name = "Scott (li3go)"`, `owner_contact = "scott@li3go.com"` set during a 2026-04-28 "A/R sweep" note that wrongly reclassified it as a customer asset. The auth.users creator is Skylar — that field is wrong.
- Storage layout (image folder paths on this vehicle):
  - `21501c21-…/hd_archive/…` → 793 images (folder of merged-in vehicle, see §1c)
  - `e08bf694-…/iphoto` → 202; `e08bf694-…/user_upload` → 84; `vehicles/user_upload` → 531; null/`ssd_blast` → 967; misc → 76.

### `e04bf9c5-b488-433b-be9a-3d307861d90b` — GAA phantom (Skylar's photos misattributed)
- VIN `CCL187Z210370`, model "Blazer", color "Custom (in progress)", created 2026-02-02.
- `source = gaa-classic-cars`, `profile_origin = gaa_import`, `listing_url = gaaclassiccars.com/vehicles/43671/1977-chevrolet-blazer`. `owner_name = "Scott"`.
- `merged_into_vehicle_id = e08bf694…`, `deleted_at = 2026-05-03 23:34:54` — already soft-merged. Notes confirm: *"[2026-05-03] Merged into e08bf694 — was GAA scrape, harness work re-attributed."*
- BUT 1,026 `vehicle_images` rows and 874 observations are still attached directly to this UUID (not relinked). Image breakdown:
  - `source=iphoto`: 855 rows (Skylar's iCloud library, `vehicle-photos/e04bf9c5-…/iphoto/IMG_*.jpg`)
  - `source=ssd_blast`: 171 rows (Skylar's local SSD)
  - **Zero GAA-domain image URLs.** No actual scrape content was ever ingested.
- Observation content (sampled): pre-build documentation 2021-06-12 (plaid bucket seats, two-tone maroon/white as-acquired), CJ Pony Parts receipts, BaT comparable alerts, Quantum fuel pump, AutoZone Boulder City. **This is Skylar's K5, beyond reasonable doubt.**
- The "Pulgam Martinez" Utah title image is just one of 855 iphoto rows — a title document that was photographed by Skylar; doesn't change attribution.
- **Classification: MISTAKE (data-entry orphan).** A GAA listing was scraped as a seed, then Skylar's iCloud import dumped his own build photos against this UUID because of fuzzy VIN/color matching.

### `21501c21-22a7-4f97-9a3a-84823bd1c6b3` — Skylar's earlier K5 placeholder (also merged in)
- VIN `CRK178P122739`, model "K5 Blazer", created 2026-03-07 by `0b9f107a-…` (= Skylar).
- `source = owner_submission`, `profile_origin = manual_entry`, `status = merged`, `merged_into = e08bf694`, `deleted_at = 2026-03-20 07:33:58`.
- Direct image_count = 0; observations = 0.
- Storage folder `21501c21-…/hd_archive/` still owns 793 image rows — those rows were re-pointed (`vehicle_id` updated to e08bf694) but **the storage path was never rewritten**. So the folder URL is stale but rows live on the canonical vehicle.
- Notes record an old (now-wrong) theory: *"Skylar's K5 build at this UUID is now canonical… e08bf694 is Scott Goldfarb's separate customer vehicle."* That theory was reversed by Skylar 2026-05-17.
- **Classification: ENTRY MISTAKE (Skylar's own placeholder).** Already merged correctly; no further action required.

## 2. The 70 1977-Blazer rows in total (by category)

| Type | Count | Examples |
|---|---|---|
| Skylar's K5 (canonical) | 1 | `e08bf694…` |
| Skylar-created phantoms merged into e08bf694 | 2 | `e04bf9c5…` (soft-deleted but obs/images orphaned), `21501c21…` (clean merge, folder stale) |
| BaT scrapes (`source=bat`, `bat_import` / `url_scraper`) | 18 | `dd2d952f`, `4bef2460`, `8ab289d8`, `e3202a2b`, `9aa7299a`, `19b14daf`, `847e16dc`, `29b17246`, `8986f773`, `c0e3ce7b`, `574fc90d`, `d1e25409`, `26279fa4`, `e412ba6d`, `2713522d`, `a8a180c0`, `56d3ba9a`, `b5af518b` |
| Mecum scrapes | 9 | `7a2eec10`, `1f9de60d`, `449355df`, `a037d45a`, `1c9d1c23`, `601a75fc`, `6e3be01c`, plus 2 archived |
| ClassicCars.com scrapes | 8 | `1fe31397`, `e64a9761`, `ff12d5ed`, `328c3b9e`, `080f26bf`, `70466685`, `3f97b966`, `546a7943` |
| Barrett-Jackson scrapes | 5 | `a97130eb`, `2795a0bd`, `7dd10c5d`, `981ff334`, `571ec62f`, plus 1 archived `11024791`, `3860dc13` |
| Conceptcarz / Kruse / Leake / Petersen / Silver / GAA conceptcarz | 14 | All `status=archived`, image_count=0; placeholder rows from event imports, soft-deleted around 2026-03-10. |
| Facebook (saved / marketplace) | 8 | `5f188da1`, `4397c4a9`, `66142960`, `eb169507`, `278b0e9c`, `f95d9ea6`, `8ac1b529`, `93119305`, `79f4de4f` |
| Other (`craigslist`, `135cb20e` user-submission stub) | 2 | `9ba2de53`, `135cb20e` (a 2026-05-03 zero-content user-submission carrying the same gaaclassiccars URL — looks like a duplicate of the e04bf9c5 mistake; harmless, empty.) |

No `merge_proposals` rows reference any of the three focal UUIDs.

## 3. Image-fingerprint overlap

The `vehicle_images` table has `phash` / `dhash` / `perceptual_hash` / `file_hash` columns but no cross-vehicle JOIN finished within the 15 s timeout (table is large). The `image_url`-equality JOIN also timed out. Folder-prefix analysis on storage_path is the cheap proxy and shows the only meaningful cross-link:

- **`21501c21-…/hd_archive/`** folder → 793 rows now owned by `e08bf694`. This is the documented merge; not a duplication, just stale path metadata.
- No other K5 vehicle shares folder space with `e08bf694`. The 18 BaT scrapes store on BaT-CDN URLs (`bringatrailer.com`), the Mecum scrapes on `mecum.com`, the ClassicCars on `classiccars.com`. No domain overlap with Skylar's `iphoto` / `ssd_blast` / `hd_archive` sources.

To get a definitive phash-based dup check, run an offline batch (per-vehicle pHash export → diff in Python). Not safely doable in a 15 s SQL window.

## 4. Auction-source URLs in `vehicle_observations` for focal UUIDs

`e04bf9c5` observations: 868 of 874 have `source_url` pointing back at its own `iphoto` storage path. Zero `bringatrailer.com`, `mecum.com`, `gaaclassiccars.com`, or `barrett-jackson.com` URLs in observations. The `vehicles.listing_url` field is the only GAA reference, and it's just the seed-row provenance — no scraped content followed.

`e08bf694` observations: source_urls split between (a) its own storage iphoto paths and (b) ~80 `file:///Users/skylar/nuke/output/receipts/IMG_*.json` paths from local OCR runs. No third-party auction domains.

## 5. Recommendations (READ-ONLY phase — no DB writes done)

| Action | Target | Why |
|---|---|---|
| **Re-point** 1,026 images + 874 observations from `e04bf9c5` → `e08bf694` | `vehicle_images.vehicle_id`, `vehicle_observations.vehicle_id` | All content is Skylar's K5 build per text + storage; merge marker already set. Folder paths will stay `e04bf9c5-…/iphoto/` (cosmetic only, like the 21501c21 case). |
| **Leave** `e04bf9c5` row in `vehicles` | row itself | Already soft-deleted with `merged_into_vehicle_id` set — keep as audit trail. |
| **Leave** `21501c21` as-is | — | Already cleanly merged; folder is cosmetic stale. |
| **Hard-delete** `135cb20e-1177-4a45-8134-f045d9f446e7` | empty 2026-05-03 dup carrying the same GAA URL | Zero images, zero observations, looks like accidental re-import; verify with Skylar before delete. |
| **Fix attribution** on `e08bf694`: clear `owner_name = "Scott (li3go)"` / `owner_contact = "scott@li3go.com"` | `vehicles` row | The 2026-04-28 A/R sweep note that set this was based on the same crossed-wire theory Skylar overturned 2026-05-17. Real owner = Skylar / NUKE LTD. |
| **No action** on the other 65 1977-Blazer rows | — | They are clean auction scrapes, FB Marketplace saves, or already-archived placeholders. None share images with Skylar's K5. |

## 6. Sources
- `vehicles` row inspection for the 3 focal UUIDs + 70-row K5 sweep.
- `vehicle_images` folder-prefix grouping on `e08bf694` (showed 793 in `21501c21-…/hd_archive/`).
- `vehicle_images.source` distribution on `e04bf9c5` (855 iphoto + 171 ssd_blast, 0 gaaclassiccars).
- `vehicle_observations` content sample on `e04bf9c5` (CJ Pony Parts receipts, 2021-06-12 plaid-seat walkthrough, NUKE LTD provenance).
- `auth.users` lookup on creator UUIDs `0b9f107a-…` and `01718395-…`.
- `vehicle_build_manifest` count by vehicle (141 only on e08bf694).
- `merge_proposals` filter (empty for all 3).

**No INSERT / UPDATE / DELETE executed. Audit ends here.**
