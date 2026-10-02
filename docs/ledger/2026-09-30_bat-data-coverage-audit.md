# BaT data coverage audit (2026-09-30)

Measured 2026-09-29 22:32Z – 09-30 00:30Z by the data-audit agent for the lead. Everything below is
read-only except the re-queue and the live-lot sample in §6. Counts are exact unless marked "sample" (a 10%
systematic sample: every 10th lot of the archive, 26,475 lots, 23,841 of them cars). All times UTC.

## The answer

**Closed auctions are coming in; live auctions and the analysis are not.**

- Of BaT's **238,650 car lots** (2014-07-30 → 2026-09-27), **234,907 (98.4%)** leave a trace in prod,
  **232,925 (97.6%)** have a vehicle row, **216,595 (90.8%)** have their auction event, and about **95.8%**
  of the archive's comment and bid rows are present (sample).
- **Live auctions: 1 of 1,187** live BaT lots has comments, bids, a VIN or more than one photo. That one is
  the SL500, read by hand at 22:28Z. Nothing reads a live lot's page, so the market board prices lots with
  no comments, no bid history and no mileage.
- **Analysis stopped in the spring.** Per-lot comment analysis last ran on 2026-02-15, per-comment sentiment
  on 03-06 and analysis_signals on 04-14. `vehicle_pulse` has 0 rows. The per-lot bid series stopped on
  2026-07-22. None of the roughly 2.9M comments loaded on 09-28 and 09-29 has been analysed.
- **First fix: a scheduled pull of every live lot** through the existing `extract-bat-core` (§7). It was
  measured on 14 live lots, and the migration is ready and paused
  (`supabase/migrations/20260930000000_bat_live_pull.sql`, draft PR #450). It must wait for two reader fixes;
  without them, each read mislabels a running auction and truncates its end time.

## 1. The target, and where the number comes from

| Figure | Value | Source |
|---|---|---|
| Every BaT lot, all kinds | 264,745 | local archive `scripts/data/bat-archive.duckdb`, table `lots` (built 09-24→09-28 from BaT's listings-filter catalog and every lot page; last close 2026-09-27) |
| Car lots (the loaders' scope) | **238,650** (185,349 sold) | same, `lots.kind = 'car'`; also `~/nuke-logs/bat-missing-0928/slugs_car.txt` |
| Out of scope, by the 09-28 decision | 13,079 motorcycles, 11,039 parts, 1,977 other | same |
| Comments and bids on car lots | 12,890,002 comments, 6,594,131 bids | archive `lot_stats` |
| Prod vehicles carrying a `bat_auction_url` | 232,868 (232,363 live) | `select count(*) … from vehicles` (exact) |

"225,000 listings" appears in no record, session or log I could find. The recorded figures closest to it
are 238,650 car lots and 232,868 vehicles with a BaT URL. This report measures against the 238,650.

The loaders finished:
- `ag.nuke.bat-missing-loader` wrote `DONE` at 2026-09-29 16:07Z. It read 33,381 distinct lots: 33,123 ok
  and 258 failed (163 quality-gate rejects, 89 VINs held by another row, 6 other), writing 2,483,430
  comment rows.
- `ag.nuke.bat-gap-loader` wrote `DONE` at 14:35Z: 6,659 lots, 6,622 ok and 37 failed (duplicate key on
  update), writing 436,931 comment rows.

Neither loader is stuck, so there was nothing to restart.

## 2. Coverage per stage (car lots)

| Stage | Made it | Didn't | Why the gap | Method |
|---|---|---|---|---|
| In BaT's catalog | 238,650 | — | — | archive |
| Any trace in prod (a vehicle by URL, an `auction_events` row or a `vehicle_events` row) | 234,907 (98.4%) | **3,743** | §4.2: VIN-linked relistings the 09-28 plan counted as present and never read, plus 225 reader failures (§4.2 counts 3,829 with no vehicle and no auction event; 86 of those have a `vehicle_events` row) | exact, per-slug join |
| Page fetched into prod `listing_page_snapshots` (388,115 successful BaT snapshots covering 253,323 URLs) | 97.3% | 2.7% | the archive holds all 264,745 pages locally; the prod copy is a second store | sample |
| Vehicle row reachable by URL | 232,925 (97.6%) | 5,725 | 5,253 of these were not on the 09-28 to-do list: the plan counted them as linked to an existing car (by VIN or sale match for the absent ones, §4.2) | exact |
| … with 2+ live vehicles for the same lot | 3,350 | — | duplicate cars | exact |
| Auction event for the lot (`auction_events`, on any vehicle) | 216,595 (90.8%) | **22,055** | 18,226 have a vehicle but no event (older importers); 3,829 have neither | exact |
| … outcome agrees with BaT | sold 166,068 of 167,256 (99.3%), same price 97.3%; unsold 48,707 of 49,339 | 870 stale (`bid_to`/`live`), 91 wrongly sold | — | exact |
| Comment and bid rows, vehicles with a lot (expected = archive comments + bids over every lot mapped to the vehicle) | 95.8% of 2,029,566 expected rows | 70.9% of lots complete, 24.1% at 50–95%, 1.3% under 50%, 4 with none | mostly the seller's media-only posts (empty text, skipped by the reader) and comments posted after prod's read; in lots that fall short, bids are about 97% present | sample |
| … over 105% | 861 lots (3.7%) | — | about 6% exact duplicates; the rest are comments from the car's other lots | sample |
| Bids as their own rows | stored as `auction_comments.comment_type = 'bid'`; `bat_bids` is legacy (58% of lots' vehicles) | — | — | sample |
| Photos | 97.7% of vehicles have photos; 95.6% have at least 90% of the lot's gallery | 530 none, 272 under half | — | sample |
| VIN on the vehicle | 90.1% | — | the archive itself has a VIN for 81.7% of car lots | sample |
| Sale result on the vehicle (single-lot vehicles, BaT sold) | 159,952 of 166,428 exact vs the catalog (96.1%); 3,422 more equal the lot's own sale record | 3,054 differ from both | §4.5 | exact |
| Sale result in `vehicle_events` (read by the cohort terminal) | 159,670 of 185,349 sold lots (86.1%) have a priced `sold` event | **25,673** | 18,063 read `ended` with no price, 1,051 still read `active`, 6,559 have no row; 1,757 unsold lots read `sold` | exact |
| Comment analysis (`comment_discoveries` / `vehicle_sentiment`) | 52.9% of lots' vehicles | 47.1% | last run 2026-02-15 / 02-07 | sample |
| Per-comment sentiment | about 2.27M of about 20M BaT rows (11%) | 89% | last `analyzed_at` 2026-03-06 | 1% TABLESAMPLE |
| Price band (`hammer_predictions`) | live lots only: 943 of 1,187 | — | written hourly by `ag.nuke.market-live-bands` since 09-27 | exact |
| Pulse (`vehicle_pulse`) | 0 rows | all | the arbiter's triggers and sweep were never deployed (demo core, 2026-06-22) | exact |
| Bid-velocity series (`bat_bids` source `bid_history`) | about 487K snapshots, 2026-02-19 → 07-22 | none since 07-22 | §4.1 | 5% sample |

**Live lots at 22:5xZ (1,187):**

| | Lots |
|---|---|
| Comments | 1 |
| VIN | 1 |
| More than one photo | 1 |
| `auction_events` row | 1 |
| Price band | 943 |
| Current bid | 1,153 |
| `vehicle_pulse` row | 0 |

Comments inserted after the loaders stopped (16:07Z): 1,285 in the 18:00 hour (9 settled lots) and 48 at
22:28Z (the SL500).

**Motorcycles, parts and other lots** (out of scope): a vehicle row for 43.8%, 23.1% and 60.8%; an
auction event for 78.9%, 28.7% and 80.4%.

## 3. How the steady state works today

For closed lots, settlement works:

- `sync-live-auctions` (every 15 min) writes a thin row for each live lot: title, current bid, end time,
  thumbnail.
- `bat-closed-lots-sync` (daily at 06:50) queues the closed lots in `import_queue`.
- `bat-settlement-drain` (every 5 min, 10 lots per run) calls `extract-bat-core`, which writes the event,
  comments, bids, VIN and photos.

`v_bat_settlement_probe` shows the sync queuing and the drain finishing:

| Lots ended | Queued | Drained | Settled sold | Settled unsold | Unsettled |
|---|---|---|---|---|---|
| 09-25 | 187 | 179 | 150 | 29 | 0 |
| 09-26 | 144 | 141 | 121 | 19 | 1 |
| 09-27 | 73 | 71 | 55 | 16 | 0 |
| 09-28 | 207 | 202 | 156 | 31 | 15 |

`bat_listings` is being written: 173,217 rows, 611 in the last 7 days, the latest at 09-29 06:50. The
atlas's "read-only" label for it is stale. Two defects in this path are covered in §4.1 (items 3 and 4).

## 4. The leaks

### 4.1 Silent failures (the job succeeds; no rows, or wrong rows)

**Since this audit** (deployed by CI on 2026-09-29, each run a success; not yet re-measured):
- **#446 (23:48:40Z)** stops item 3, the settlement double-write.
- **#447 (23:51:57Z)** retires item 1's snapshot path.
- **#448 (23:56:10Z)** fixes item 2's resolver and skips comments already held by BaT id.

Re-measure item 3 on the lots settled after the 09-30 06:50Z sync, and item 2 once lots are within 6 h of
closing again, from about 11:00Z.

Every BaT job in `v_job_health` reads `succeeded`, because success only means the HTTP call was sent.

1. **The live bid series records nothing.** `sync-live-auctions` → `recordBidSnapshots` looks for
   `vehicle_events` rows that are `active`. PostgREST caps the read at 1,000 rows, and all 1,000 are stale
   `active` events from March–September (2,922 exist, 2,912 of them past their end date), so no live lot
   matches. The function logs show 46 of 46 runs between 12:00 and 23:30Z: "URL matched: 0", "Recorded 0
   BaT bid snapshots", "Updated 0 vehicle_events rows". The last snapshot is from 2026-07-22.
2. **The 6-hour comment trigger fails.** `sync-live-auctions` fires `extract-auction-comments` for 10 lots
   ending within 6 h, fire-and-forget with `.catch(() => {})`. On 09-29 there were 368 × HTTP 500 and 205
   × 200. The error is "Missing vehicle_id (and could not resolve …)" (399 times): the resolver looks up
   `bat_auction_url` and `discovery_url`, but live rows fill only `listing_url` (1,187 of 1,187; 1 has a
   `discovery_url`). The same 10 lots retry every 15 min: `2022-ferrari-812-gts-42` was tried 26 times.
   A separate 122 errors are "Failed to parse comments JSON array".
3. **The settlement path writes every comment twice.** `process-import-queue` calls `extract-bat-core`
   (which writes comments and bids), then fires `extract-auction-comments`, which writes them again under a
   different `content_hash`. Both copies carry `bat_comment_id`, and no key covers
   (vehicle_id, bat_comment_id). On the latest 150 settled lots: 14,549 rows for 9,238 distinct comments,
   so 36.5% of rows are duplicates. About 600 lots have gone through this path since 09-27, which puts it
   at roughly 21K duplicate rows (estimate). The loaders called `extract-bat-core` directly and are
   unaffected.
4. **The URL filter skips real cars.** `validate_import_url()` (BEFORE INSERT on `import_queue`) marks
   `skipped` any URL containing the substring `art`, `sign`, `book`, `poster` or `telephone`. That catches
   aston-m**art**in, d**art**, ab**art**h, sm**art** and **art**ura. In the catalog it matches 2,552 car
   lots (1.1%). 18 settlement rows have been auto-skipped since 09-27: 10 cars (8 Aston Martins, a Dodge
   Dart Swinger and an Abarth), a Ducati Paul Smart, a go-kart, and the rest real signs.
5. **The heartbeat is down.** `pipeline-heartbeat` (486) has failed 8 times in a row on a statement
   timeout.
6. **A cron gap.** On 09-29 between 07:00 and 09:30Z no job ran: 9 of 96 `sync-live-auctions` runs are
   missing, and several functions logged 504 IDLE_TIMEOUT at 07:02Z.

### 4.2 Why 3,829 car lots are absent (no vehicle by URL and no event)

- 3,590 were never read. `gen_missing.sql` treated them as present because the 09-28 plan linked them by
  VIN or sale match to a car already in prod: 1,894 `vin`, 1,691 `vin+sale_match`, 5 `sale_match`. They
  are relistings, so the car exists but that auction (its event, comments, bids and result) was never
  recorded.
- 225 are reader failures: 134 quality-gate rejects (mostly non-cars such as "experience" lots), 87 VINs
  held by a deleted row (fixed by the bat-data lane's VIN-guard migration, not yet pushed), 4 other.
- 14 were on the to-do list with no reader result.

By year the absent lots run 318 / 534 / 598 / 587 / 355 / 1,258 for 2021–2026. The archive holds 181,880
comments, 103,096 bids and 3,004 sold results for them.

### 4.3 `bat_quarantine` (375K rows, none resolved)

Of about 375K rows, 0 are resolved. By field:

| Field | Rows | Vehicles | What it is | Still live |
|---|---|---|---|---|
| transmission | 195,657 | 113,201 | "4-Speed Automatic" vs "Four-Speed Automatic": formatting | noise |
| model | 36,005 | 16,928 | proposer bug "-Benz 560SL" vs "560SL" | noise |
| interior_color | 25,034 | 12,792 | "black" vs "Black Leather" | noise (the proposal is richer) |
| sale_status | 21,886 | 21,830 | "available" vs "sold" | 21,495 have been corrected since; the rows are stale |
| color | 20,469 | 10,988 | "Black Over" (garbage) vs "Black" | the proposal is right |
| high_bid | 17,084 | 10,531 | real disagreements | 4,679 vehicles still hold the old value |
| mileage | 15,170 | 9,417 | includes "17" vs "17000" (k units) | 6,333 still hold the old value |
| sale_price | 14,925 | 9,179 | real disagreements | 3,363 still hold the old value (the corrections pass cited BaT's record) |
| bat_views | 13,799 | 13,028 | an existing 0 counts as a value | 1,061 still hold 0 |
| make | 12,897 | 6,721 | "Mercedes-Benz" vs "Mercedes" | noise |
| engine_size | 12,422 | 7,763 | "5.7L V8" vs "5.7-Liter V8" | noise |
| (null field) | 12,789 | 111 | whole-record quarantine | — |

The cause: `batUpsertWithProvenance.valuesMatch` compares by lower-cased equality, so every re-read files
the same pairs again. Roughly 80% of the table is formatting noise.

### 4.4 `bat_extraction_queue`

This queue is retired. It has 325,356 rows (the atlas estimate of 603,046 is stale). Its last completion
was 2026-07-28.

| Status | Rows | Breakdown |
|---|---|---|
| complete | 275,011 | — |
| skipped | 43,405 | 39,211 comment URLs, 4,174 non-vehicle |
| failed | 6,305 | 3,354 quality gate, 1,434 duplicate insert, 412 missing images, 236 rate-limited, … |
| pending | 635 | idle since July |

Of the open rows, 3,478 failed rows and 605 pending rows point at lots that have since been loaded by other paths. The rest
overlap with §4.2 and §4.5.

### 4.5 Data that landed wrong

- **False sales.** 1,468 single-URL car vehicles read `sold` although their BaT lot did not sell.
  - 1,165 are explained: a same-VIN relisting sold, 1,133 of them at that exact price.
  - 143 took a same-day, same-price sale from a different lot. Example: 1972 El Camino `01939db6` reads
    sold $16,250 on 2022-04-20, citing `1965-corvette-kelsey-hayes-knock-off-wheels`, a parts lot. The
    link came from the 09-27 corrections pass's sale match.
  - 160 are unexplained.
- **`vehicle_events` is stale.** It disagrees with BaT on 25,673 sold car lots and marks 1,757 unsold lots
  sold (782 at the high bid). `get_make_model_terminal` (the /cohort market page) reads this table, while
  `auction_events` agrees with BaT 99.3% of the time.
- **Duplicate cars.** 3,350 car lots have 2+ live vehicles, and 3,578 lots have events on 2+ vehicles.
- **A live bid can go backwards.** The SL500's lot page had $8,888 from 22:20Z. The 22:30Z sync from BaT's
  /auctions/ page wrote $7,900 over it, and the 22:45Z sync wrote $8,888.
- **Live lots carry a sale price.** 1,164 of 1,204 live BaT rows have `canonical_sold_price` set (the SL500:
  7,900), while none reads `sold`. Readers of `canonical_sold_price` present a running bid as a sale.
- **A read of a running lot writes the wrong state** (measured in §6, on 14 lots, while their auctions ran):
  - `auction_events.outcome` = `bid_to` for all 14. For a reserve lot below its reserve, the reader also
    writes `reserve_not_met` into `auction_events` and `vehicles.auction_outcome`, per its code.
  - `vehicles.auction_end_date` is superseded from the timestamp to the bare date through the chokepoint.
    At 00:04Z the logged-out board had dropped the 2006 Tundra (`1b5cb8be`, ending 09-30 18:23Z); its end
    read as 09-30 00:00, already past. Two others showed an end of 10-01 00:00. The 15-minute sync restores
    the timestamp, and the next read truncates it again, adding one more correction record each time.

### 4.6 Running lots written as ended: the 15 rows

15 `auction_events` rows read `bid_to` on lots that haven't ended. They are the SL500 (read 22:28Z) and my 14
sample lots (23:47–23:49Z):

  - `683145ab-e951-45fd-b186-63c8bbc3a1c3` 1999-mercedes-benz-sl500-347, ends 2026-09-30 17:31Z
  - `07e67aa8-fdfa-4b91-9371-d2e5e4237b64` 2006-toyota-tundra-77, ends 2026-09-30 18:23Z
  - `dceb73dd-764f-4278-b5ca-980487f8e9d9` 2008-bmw-328i-convertible-34, ends 2026-09-30 19:40Z
  - `95b589d8-5c5d-40c0-8dd1-ecf0168f0670` 2001-suzuki-carry-pickup-4wd-5-speed-3, ends 2026-09-30 20:59Z
  - `0551d335-1f35-4a46-918c-05d4207c335c` 2015-ferrari-458-speciale-40, ends 2026-10-01 17:10Z
  - `8751a4c0-3a1c-4c13-a1b2-714def5e6072` 1969-lincoln-continental-mark-iii-19, ends 2026-10-01 19:16Z
  - `4fce884c-6103-4673-8ce9-975608bd94a9` 1997-toyota-rav4-22, ends 2026-10-01 20:11Z
  - `8d0c13c4-6306-4d21-99f7-7f59f97d7c55` 2003-chevrolet-s-10-37, ends 2026-10-01 20:51Z
  - `0f5f6148-37d7-470e-89f9-206265d87c2f` 2008-lamborghini-murcielago-lp640-roadster-16, ends 2026-10-02 17:00Z
  - `b86a17e5-fd37-44d7-a39e-5e5c9bc37944` 2001-plymouth-prowler-57, ends 2026-10-03 18:11Z
  - `7ae36754-1753-449b-abac-85d99024cb9a` 1975-honda-cb200t-13, ends 2026-10-03 19:09Z
  - `82c21964-98f8-426e-b5be-c0b4aa771a0c` 1961-scootacar-mk1, ends 2026-10-04 17:44Z
  - `3007b540-d023-4488-b599-9509aaf2057f` 2001-toyota-tundra-31, ends 2026-10-05 18:45Z
  - `6300566d-df29-4012-bb89-3ae8f9742a4b` 2009-smart-fortwo-cabrio-6, ends 2026-10-05 18:58Z
  - `734bb780-ef7c-4352-a012-7507203bf3ce` 2005-jeep-wrangler-310, ends 2026-10-06 17:47Z

**1. Do they fix themselves? Yes, 14 of 15, when each lot is settled.**
- The reader upserts `auction_events` with `onConflict: "vehicle_id,source_url"`, the unique index
  `idx_auction_events_vehicle_source_url`.
- `source_url` is `canonicalUrl(input)`: no trailing slash, no query. The drain passes the catalog URL
  with a trailing slash, which canonicalises to the same key.
- So the settlement read rewrites the same row (same id) with the closed page's outcome, high bid and
  winning bid.
- None of the 15 has an `import_queue` row, so bat-closed-lots-sync can queue each after its close (the
  sync runs at 06:50Z and covers the previous day's closes).

Caveats:
- **Not yet shown through the drain.** No lot read mid-auction has been settled through the drain yet.
  - The first will be the 2000 Cobra R: event `cff75f24-33e5-43ea-ae20-058962d47db6`, read 09-29 11:23Z,
    closed 18:53Z. It still reads `bid_to` $85,000, and it has no queue row yet.
  - The 09-30 06:50Z sync should queue it. Check after about 07:15Z:
    `select outcome, winning_bid, updated_at from auction_events where id = 'cff75f24-33e5-43ea-ae20-058962d47db6'`.
- **History.** Of 3,521 BaT event rows created before their lot closed, 1,947 were rewritten after the
  close (the same row: created < end < updated). 1,559 never were, and 1,106 of those still read `bid_to`:
  lots nobody read after the close.
- **The exception.** The 2009 Smart fortwo (`6300566d`) won't heal. `validate_import_url` will auto-skip
  its settlement queue row ("smart" contains "art", §4.1 item 4), so the drain never reads it. It heals only
  if P4 lands before the 10-06 06:50Z sync, or if it is re-read through `extract-bat-core` after 10-05
  18:58Z.
- **The motorcycle** (1975 Honda CB200T, `7ae36754`) heals if the reader's quality gate accepts it at
  settlement; untested.

**2. Who reads `auction_events.outcome`, and does any of them take future-dated rows?** Nobody counts these
rows as results. No DB reader filters on the end date, but none counts `bid_to` either.
- **DB functions:**
  - `get_auction_comps` and `get_comps_scored` take `outcome = 'sold' AND winning_bid > 0` only.
  - `backfill_transfers_for_sold_auctions` takes `outcome = 'sold'` only.
  - `queue_bat_backfill_vehicles` is unscheduled. It flags a `sale_price` whose event isn't `sold`, and
    live rows have no `sale_price`.
  - `get_user_reconciliation` reads the owner's own lots, and only their counts and end dates.
  - `mark_active_auctions` reads `ae.ends_at`, a column `auction_events` doesn't have; it's dead.
- **Not readers at all:** the market board (`market_pulse_live`: vehicles and hammer_predictions), the
  cohort terminal (`get_make_model_terminal`: vehicle_events) and the band backtests (the local archive).
- **The vehicle page's auction band** (`auctionSequence.ts`) joins the outcome with
  `vehicle_events.event_status`. All 15 have an `active` vehicle_events row, so "bid_to active" classifies
  as `live`, which is correct.
  - Its regex tests `reserve_not_met` before `live`, though. A reserve lot read mid-auction would show
    "reserve not met". That's P0a.
- **`ValueProvenancePopup`** lists the raw outcome ("bid to"). It opens from the VehicleHeader price, whose
  row has been display:none since 2026-03-21. I didn't check the live page for another way in.
- **Counts over outcomes** (this audit's §2 and any coverage probe) treat the 15 as unsold until they close.

**3. No SQL write proposed.**
- No sanctioned writer covers `auction_events`. `retire_rows` allows only `auction_comments`, and
  `correct_vehicle_event_link` covers `vehicle_events`. The reader is this table's writer, and it rewrites
  these rows at settlement.
- To correct them before they close: ship P0a (outcome `live` for a running lot), then re-read the 15 URLs
  through `extract-bat-core`. Each upsert rewrites its own row to `live`.
- For the Smart, P4 as well.

## 5. The temperature

**What "cold" is today.** The homepage board (`nuke_frontend/src/pages/market/MarketPulse.tsx`) computes

> ratio = current bid ÷ (band middle × the share of the final price that comparable cars have usually
> reached at this many hours left)

and tags it cold at ≤ 0.8×, hot at ≥ 1.25×, with no verdict past 120 h. The inputs:

- **Band:** `hammer_predictions` model 31, priced once per lot from the local archive using title-only
  features (`scripts/market/live-bands.sql`). Mileage counts only when the title states it.
- **Curve:** measured on 36,700 sales, in `market_pulse_live()`.
- **Current bid:** BaT's /auctions/ page, read every 15 min. It can lag the lot page (see §4.5).

**Backtest.** I replayed the same rule on 69,295 sold car lots (2024-09-01..2026-09-27), each priced only
from earlier sales (`band_backtest`), with the bid as of 24 h before the close. Cold lots finished above
their band middle 11.3% of the time, "in line" lots 40.9% and hot lots 86.8% (48 h: 13.2 / 40.3 / 82.9%).
As a forecast of "will it finish above or below the middle of its comps", the tag holds up. But that
measures price against comparable sales, not demand.

**The SL500 (`f8c68f0e`).** The ratio was 7,900 ÷ (17,500 × 0.572) = 0.79, so "Cold". The band middle of
$17,500 is for all R129 SL500s, 745 comps; the car's 110,000 miles never reach the band because the title
doesn't state them. At the true bid of $8,888 the board reads 0.89, "in line". Everything that says demand
was left out: 48 comments, 29 bids from 13 bidders, 586 watchers, 3,825 views, no reserve. None of it is
stored for live lots.

The lead compared it with 389 past SL500 lots on BaT at 19 h or more before the close: median 23 bids
(p75 32) and median 11 bidders. On activity, then, this lot ran above typical while the board called it cold.

**Engagement adds signal the tag misses.** Split each price tag by where the lot's comments so far rank
against its peers (same price tier, same hours left), then look at the share that finished above the
middle, at 24 h:

| Tag | Bottom third of comments | Top third |
|---|---|---|
| cold | 7.9% | 16.7% |
| in line | 29.9% | 52.6% |
| hot | 74.4% | 93.0% |

Ranking by bidders gives the same pattern (cold 7.6 → 16.7%, in line 30.9 → 50.7%). The "in line" group,
about a third of lots, gets no tag today, and it is where engagement matters most.

**A second "cold".** `compute-vehicle-valuation` scores heat by adding points, so 0 points reads "cold".
716,517 of 757,227 `nuke_estimates` (94.6%) are cold, and 486,820 of them score 0: nothing was measured.
It also checks `sale_status` for `'live'`/`'active'`, but BaT live rows are `'auction_live'`, so a live
lot never gets its +30. The feed's grid card prints the label, so "COLD" is what a car shows when nothing
was measured.

**Proposal: two readings, each with its basis, and "not measured" when an input is missing.**

1. **Price vs comps** (today's tag, renamed): "bidding under comps 0.8×", not "cold". It shows only when
   the bid is at most 30 min old (from the lot page when one has been read), the band has at least 5
   effective comps, and fewer than 120 h are left. Otherwise it says "not measured" and gives the reason.
2. **Demand** (the temperature): where this lot's engagement ranks among sold lots at the same hours-left
   mark and price tier, using unique bidders so far, bids in the last 24 h and comments per hour.
   - Reference distributions come from the archive's 20.8M timestamped comments and bids.
   - Watchers and views are current-only values, so they sit alongside as context.
   - It needs no new table. Once a lot page has been read, `auction_comments` (with `posted_at` and
     `comment_type = 'bid'`) is the full bid and comment series.
   - Ship it only after a backtest: the top and bottom fifths at 48, 24, 12 and 6 h must separate
     finishing above and below the band middle, with the price ratio held fixed.
3. **UI:** the board, the vehicle page and the feed show "not measured" instead of "cold" when those
   inputs are absent. `computeHeatScore` returns null, not "cold", when it had no inputs.

**What it takes.** Every live lot's page has to be read during the auction. That is the live pull in §7:
about 4,000 reads a day, measured and ready as a migration.

## 6. What I changed

The lead allowed re-queueing through the existing queue. I did that once, measured before and after, and
stopped part-way on a defect.

- **Before, 23:14:40Z.** The 1,212 absent 2026 car lots (§4.2, minus known reader failures) had 0
  `auction_events`, 0 vehicles by URL, 255 rows already in `import_queue` under the old BaT source (201
  skipped, 52 failed, 1 pending, 1 complete; left untouched) and 0 settlement rows.
- **Profile (forced rollback).** 10 rows took 49 ms; the triggers cost 1.2 ms a row.
- **Insert, 23:15:41Z.** 957 rows went into `import_queue` with the settlement `source_id`, priority 1
  (below the daily settlement's 10, so new closings drain first), status `pending`, and `raw_data.source`
  `data-audit-2026-09-29`. 13 were auto-skipped by the `%art%` filter (§4.1 item 4); being my own rows, I
  set those back to `pending`. Lock waiters: 0.
- **After two drain runs, 23:28:20Z.** 20 lots read: 20 `auction_events` (17 sold, matching the archive's
  17) and 1,301 distinct comment and bid rows, against the archive's 1,281 plus the sold markers. They also
  carry 886 duplicate rows from defect §4.1 item 3.
- **Held, 23:26:36Z.** So as not to add about 35–40K more duplicates, I set the other 937 rows to
  `pending_review`, with the reason in `error_message`; `claim_import_queue_batch` takes only `pending`.
  #446 has since deployed (23:48:40Z). Releasing a first 10 at 00:08Z was refused by the permission check,
  so the release is the lead's. To release them:

  ```sql
  update import_queue set status = 'pending', error_message = null
   where raw_data->>'source' = 'data-audit-2026-09-29' and status = 'pending_review';
  ```

**The live-lot sample (for §7), 2026-09-29 23:46Z – 09-30 00:03Z.** I read 14 live no-reserve lots through
the deployed `extract-bat-core` (`{"url", "prefer_snapshot": false}`), one at a time, 2 s apart. They were
picked from the logged-out board across bid levels: 7 end in 12–48 h and 7 beyond 48 h. At 23:4xZ no lot
ended within 12 h, because BaT's closes cluster in the US afternoon. No-reserve lots were chosen so the
reader couldn't write `reserve_not_met` onto a running car.

| Measure | First read (23:47–23:49Z) | Re-read (23:51–23:53Z) |
|---|---|---|
| Succeeded | 14 of 14 | 14 of 14 |
| Wall time p50 (max) | 9.3 s (11.1 s) | 3.8 s (5.1 s) |
| Reader phases after the BaT fetch, p50 | 7.9 s (vehicle_write 4.75 s; timeline 0.72; images 0.58; comments 0.54) | 2.4 s (vehicle_write 0.78 s) |
| BaT fetch p50 | 0.60 s | 0.63 s |
| DB exec for the pass (`pg_stat_statements` delta, all activity) | 20.1 s over 5,214 statements, ≤ 1.4 s a lot | 3.8 s over 2,020, ≤ 0.27 s a lot |
| Rows written | +341 comments (90 bids), +2,159 image links, +14 `auction_events`, +14 `vehicle_events`, +42 `timeline_events`, +14 observations; 12 lots gained a VIN | +2 comments, nothing else |
| `bids_written` (`bat_bids`) | 0: no `bat_listings` row | 0 |
| Duplicate comment rows | 0 | 0 |
| REST p50 afterwards (anon, 10 samples) | 0.209 s (0.210 s before) | 0.207 s |

- **Third read of 3 lots, 00:02Z.** This came after the 00:00Z sync had put the precise end times back.
  Wall 4.6–8.7 s, vehicle_write 1.2–1.6 s. Each read truncated the end time again: a second correction
  record per lot, and at 00:04Z the Tundra was off the logged-out board (§4.5). The 00:15Z sync puts them
  back.
- **Left behind.** 14 `auction_events` rows read `bid_to` until each lot's settlement read sets its result.

## 7. The live pull: first in the plan

The live card's percentile and activity need every live lot's comments and bids during the auction. Today
nothing collects them. The pull reads them through the existing, sanctioned `extract-bat-core` on a
schedule.

- **Migration:** `supabase/migrations/20260930000000_bat_live_pull.sql`, on branch `bat/live-pull-cron`,
  draft PR #450. For the lead to ship; I have not applied it, and both jobs are created paused.
- **Lots:** every live BaT row on the board, 1,213–1,258 on the night of 09-29. At that time 428 ended in
  12–48 h, 784 beyond 48 h (401 beyond 120 h) and none within 12 h.
- **Priority:** lots ending within 48 h first (never-read, then soonest end), then the rest.
- **Cadence:**
  - first read at once;
  - every 24 h while more than 48 h are left;
  - every 6 h from 48 h to 12 h;
  - hourly in the last 12 h.

  About 24 reads a lot. With about 170 lots closing a day (169 over 08-28..09-26 in the archive), that is
  about 4,000 reads a day. The first pass
  over the current board takes about 7 h, with the 48 h lots done in the first 2.5 h.
- **Throttle:** 3 lots a run, a run every minute, a ceiling of 180 an hour. A pass is at most 3 reads of
  about 4–11 s each, so it finishes well inside the minute. The run also skips when any lot dispatched in
  the last 150 s hasn't been read yet, so passes never overlap. BaT fetches run at 3 a minute (the BaT
  row's limit is 20).
- **Load, from the sample:**
  - DB exec ≈ 170 first reads × 1.4 s + about 3,900 re-reads × 0.27 s ≈ 22 min a day.
  - The dispatcher itself, rehearsed in a forced rollback: 14 ms a run, 74 ms for the schedule sync every
    5th minute, 858 ms for the one-time initial sync of 1,258 lots.
  - REST p50 didn't move at one read per 11 s: 0.210 → 0.209 → 0.207 s.
  - Rows: about 185 on a lot's first read (24 comments, 154 image links, 6 events, timeline rows and
    observations), then new comments only. Settlement would write the same rows at the close anyway, so
    the pull moves them into the auction week rather than adding to them.
- **Pause rule:** as the loader's. Every run fires one REST probe (GET `vehicles?select=id&limit=1`,
  timed from dispatch to the pg_net response row) and keeps the last 10. When their p50 is above 2 s the
  run dispatches nothing, and the health row reads `degraded` with the reason.
- **Success check, rows landed rather than exit 0:**
  - Each run accounts the previous pass. A lot counts as read when its `auction_events` row was written
    after dispatch, and rows landed = new `auction_comments`. Both go into the health row
    (`live_auction_sources` 'bat': `last_run`, `last_successful_sync`, `consecutive_failures`,
    `health_status`).
  - `bat-live-pull-check` (every 15 min) fails, so it shows in `v_job_health` with the counts in
    `last_error`, when:
    - fewer than half the lots dispatched 10–70 min ago were read;
    - 30+ reads in 3 h landed 0 comment rows;
    - 25+ lots are 2 h overdue;
    - the pull hasn't run for 10 min, or has stayed paused for 2 h.
- **The `bat_listings` precondition:** not handled. 0 of 1,213 live lots have a `bat_listings` row, so bids
  stay comment-only during the auction (`auction_comments.comment_type = 'bid'`, with amount, time and
  bidder, which is what the card needs). `bat_bids` receives them at settlement, when bat-closed-lots-sync
  creates the row.
  - That settlement path covers only recent closes. Of the car lots that ended 08-01..09-27, 450 of 8,848
    (5.1%) have a `bat_listings` row; for all 2026 closes it is 44.7%, and for every car lot 56.6%. Lots
    without one get no `bat_bids` rows from any reader.
- **Reader preconditions, which block enabling** (§4.5; `extract-bat-core`, bat-data lane):
  1. Write `auction_events.outcome = 'live'` while the end time is in the future, and leave
     `vehicles.auction_outcome` alone.
  2. Stop superseding `vehicles.auction_end_date` with the date-only value (compare at date level, or write
     `auction_end_at`).

  Without them, every scheduled read mislabels the auction and truncates its end time: about 4,000
  bad corrections a day, and lots ending the same day vanishing from the board.
- **Existing tables only** (SCHEMA_LAW §1): `monitored_auctions` (per-lot schedule, dormant since
  2026-02-18) and `live_auction_sources` (the health row). No new table.

With the pull running, two broken hooks become redundant:
- sync-live-auctions' 6-hour `extract-auction-comments` trigger (§4.1 item 2);
- the 15-minute `bat_bids` snapshots (§4.1 item 1). The comments carry every bid with its exact time.

Retire both rather than fix them.

## 8. The fix plan (in priority order)

| # | Fix | Expected yield | Risk | Owner |
|---|---|---|---|---|
| P0a | `extract-bat-core`: a lot whose end time is in the future is `live`. Write `auction_events.outcome = 'live'` (not `bid_to` / `reserve_not_met`) and leave `vehicles.auction_outcome` alone | running auctions stop being written as ended | low: one condition | bat-data |
| P0b | `extract-bat-core`: don't supersede `vehicles.auction_end_date` with the date-only value (compare at date level, or write `auction_end_at`) | ends the per-read truncation and correction records; lots ending today stay on the board | low | bat-data |
| **P0** | **The live pull** (§7): ship `20260930000000_bat_live_pull.sql` (PR #450), enable both jobs after P0a and P0b | comments and bids for all ~1,200 live lots (today 1); about 4,000 reads a day, ≈ 22 min of DB exec a day; the live card and the §5 demand reading become computable | medium: new steady load; paused by REST p50 > 2 s; checked into `v_job_health` | the lead ships; bat-data owns the reader |
| P1 | Settlement double-write: **deployed as #446** (23:48:40Z). Left to do: re-measure on the 09-30 settlement, retire the duplicates with `retire_rows`, then release the 937 held rows (SQL in §6; release 10 first and check they land without duplicates) | stops about 36% duplicate rows on every settled lot (≈150–250 lots/day); about 21K rows to retire (estimate) plus 886 from §6 | low | bat-data; the release is the lead's (my release was refused by the permission check) |
| P2 | Bid snapshots **retired (#447)**; the 6-hour trigger's resolver **fixed (#448)**. Once P0 runs, the trigger only duplicates P0's last-hours reads, and #448's BaT-id rule keeps them from duplicating rows; keep it or retire it | 0 rows a run replaced; 368 HTTP 500s a day gone (to verify from about 11:00Z) | low | bat-data |
| P3 | Re-read the 3,604 absent car lots (957 queued in §6: 20 done, 937 held behind P1; 255 need their old rows reset; 2,392 older ones not queued) | about 3,600 auction events, about 180K comments + 103K bids, 3,000 sold results | low once P1 lands | bat-data |
| P4 | `validate_import_url`: whole-word keywords, or skip the check for bringatrailer.com (the reader classifies non-vehicles itself); re-queue the skipped settlement rows | about 1% of closing car lots (2–3 a day) plus 18 skipped since 09-27 | low | bat-data |
| P5 | Settle `vehicle_events` from `auction_events` (which agrees with BaT 99.3%) through a sanctioned writer: 18,063 `ended` without price, 1,051 stale `active`, 1,757 false `sold`; close the 2,912 past-due `active` rows | the /cohort terminal gains about 25.7K sales and loses about 1.8K false ones | medium: bulk write; profile first; needs a writer | bat-data (writer) + market-home (reader) |
| P6 | `canonical_sold_price` stays null until a sale; today 1,164 of 1,204 live rows carry their running bid there | no running bid read as a sale price | low | bat-data |
| P7 | Write the missing `auction_events` for 18,226 lots that have a vehicle but no event (re-read or derive) | 18K events for the timeline bands and comment links | low | bat-data |
| P8 | Quarantine: normalisers in `valuesMatch` (number words, L/-Liter, 0 as empty for counts), fix the make/model split in the proposer, then a resolution pass (needs a sanctioned writer for `bat_quarantine.resolved`); adjudicate mileage (6,333) and high_bid (4,679) | about 80% less noise; about 11K live field disputes surfaced | low / medium | bat-data |
| P9 | False sales: 143 same-day same-price matches (and 160 unexplained) via `correct_vehicle_sale_provenance_batch` | about 150–300 wrong comps removed | low | bat-data |
| P10 | UI: "not measured" instead of "cold" (board tag semantics; `computeHeatScore` returns null without inputs; the feed card) | stops about 487K cars reading "cold" on no data | low | market-home (not running; the lead assigns) |
| P11 | Demand reading (§5): archive reference distributions, backtest, then ship on P0's data | a defensible temperature | medium | market-home, after P0 |
| P12 | Re-run comment analysis on the comments loaded since February | analysis for the about 47% of lots with none | cost: LLM spend (Skylar decides) | market-home / deal |
| P13 | Fix `pipeline-heartbeat` (8 consecutive timeouts) | the alarm that should have caught §4.1 | low | setup / lead |

The order matters:
- P0a and P0b before P0 is enabled;
- P1 before P3 releases any more rows;
- P0 running before P11 can be backtested on live lots.

## Appendix: method and queries

Prod was read with `scripts/data/q.sh`, with `statement_timeout` at most 60 s and 1 s pacing between
chunks. The archive was read with `duckdb -readonly`. Working files are in `~/nuke-logs/bat-coverage-0929/`
(not in git).

**Vehicles per slug, full pass** (265 chunks of 1,000 slugs, 4 URL variants on 3 indexed columns, as in
`scripts/bat-corrections/export_live_by_slugs.sh`): 246,866 rows.

```sql
WITH s AS (SELECT unnest(ARRAY[...slugs]::text[]) slug),
u AS (SELECT slug, x.url FROM s, LATERAL unnest(ARRAY['https://bringatrailer.com/listing/'||slug,
      'https://bringatrailer.com/listing/'||slug||'/', 'http://bringatrailer.com/listing/'||slug,
      'http://bringatrailer.com/listing/'||slug||'/']) x(url)),
m AS (SELECT u.slug, v.id FROM u JOIN vehicles v ON v.bat_auction_url = u.url
      UNION SELECT u.slug, v.id FROM u JOIN vehicles v ON v.listing_url = u.url
      UNION SELECT u.slug, v.id FROM u JOIN vehicles v ON v.discovery_url = u.url)
SELECT m.slug, v.id, v.deleted_at IS NOT NULL del, v.merged_into_vehicle_id IS NOT NULL mrg,
       v.sale_status, v.sale_price FROM m JOIN vehicles v ON v.id = m.id;
```

**Events.** Every BaT `auction_events` row (240,954) and `vehicle_events` row (278,007) was paged by `id`
(40,000 a page) and joined to archive slugs locally on `regexp_extract(source_url, '/listing/([^/?#]+)')`.

**Sample stage pass** (every 10th archive lot, 133 chunks of 200). For each lot's vehicle: the successful
snapshot count, the `auction_events` row for that lot's URL, and `count(*)` from `auction_comments`,
`bat_bids` and `vehicle_images`, plus whether `comment_discoveries`, `vehicle_sentiment` and
`hammer_predictions` rows exist. Expected comment rows = the sum of archive `n_comments + n_bids` over
every lot mapped to the vehicle, and each vehicle's counted rows are capped at that expected figure.

**Live lots.**

```sql
SELECT count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM auction_comments c WHERE c.vehicle_id = v.id)) …
  FROM vehicles v
 WHERE sale_status = 'auction_live' AND platform_source = 'bringatrailer'
   AND auction_end_date::timestamptz > now();
```

**Duplicates on settled lots.**

```sql
WITH q AS (SELECT listing_url, vehicle_id FROM import_queue
            WHERE source_id = '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37' AND status = 'complete'
            ORDER BY processed_at DESC LIMIT 150)
SELECT count(*), count(DISTINCT (q.listing_url, c.author_username, c.posted_at, c.comment_type))
  FROM q JOIN auction_comments c ON c.vehicle_id = q.vehicle_id
   AND regexp_replace(c.source_url, '/$', '') = regexp_replace(q.listing_url, '/$', '');
```

**Backtest.** Archive `band_backtest` (n_eff ≥ 5, sold cars) joined to `events` before the checkpoint,
using the curve points from `market_pulse_live()` and the 0.8 / 1.25 thresholds from `MarketPulse.tsx`.
Terciles of comments and bidders so far are taken within the same checkpoint and price tier.

**Function logs.** `function_edge_logs` and `function_logs` for 2026-09-29, read through the Supabase log
query.

**Live-lot sample.** `~/nuke-logs/bat-coverage-0929/live-sample/`: `probe.sh` (anon REST p50, 10 samples
2 s apart), `counts.sh` (rows per vehicle before and after), `pss.sh` (`pg_stat_statements` totals) and
`pass.sh` (sequential `extract-bat-core` calls, 2 s apart). DB exec per pass is the `pg_stat_statements`
delta across the pass. That covers every statement cluster-wide, so it is an upper bound.

**Migration rehearsal.** Every statement of `20260930000000_bat_live_pull.sql` ran with `EXECUTE` inside one
`DO` block. The block then called `bat_live_pull_run(0)` twice and `bat_live_pull_run(0, true)` once, called
`bat_live_pull_check()`, and ended in `RAISE EXCEPTION`. Afterwards cron.job had no `bat-live-pull%` rows,
there were no `bat_live_pull%` functions, the `bat` `scraping_config` was `{}` and there were 211
`monitored_auctions` rows, all as before.
