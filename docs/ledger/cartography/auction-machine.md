# Cartography: the auction machine

Lane 1 (cartographer), 2026-09-30. The per-table map of the auction machine's tables, established from the code and
the live data. Read it with the theory card `docs/ledger/theory/data-machine.md`. The column comments that this map
supports are in `supabase/migrations/20260930190000_describe_auction_machine.sql`.

## How this was measured

- **Data.** Read-only SELECTs against prod (`qkgaybvrernstplzjaam`) on 2026-09-30 between 16:20 and 17:00 UTC, each
  with `statement_timeout = '15s'`. The big tables were sampled with `TABLESAMPLE SYSTEM`, never scanned whole. The
  sample sizes:

  | Table | Sample |
  |---|---|
  | auction_comments | about 21K rows (0.1%) for null rates; 4K rows (0.02%) for match rates |
  | vehicle_images | about 4.8K rows (0.01%) |
  | vehicles | about 5.1K rows (0.5%) |
  | bat_bids | about 25K rows (0.5%) |
  | bat_listings | about 8.9K rows (5%) |
  | auction_events | about 7.1K rows (2%) |
  | bat_user_profiles | about 6.8K rows (1%) |
  | external_identities | about 6.5K rows (1%) |
  | live_auction_sources, market_index_values | whole table |

  Block sampling clusters by insert order, so treat any rate as ±5 points. Row counts are `v_schema_atlas.est_rows`.
- **Code.** Grep of `supabase/functions`, `scripts` and `supabase/migrations` for inserts, upserts, updates and
  triggers, with file:line citations. The live triggers and cron jobs were read from `pg_trigger` and `cron.job`.
- **Terms.**
  - "null" is the sampled null rate. "distinct" is the number of distinct values in the sample, not in the table.
  - "match" is the sampled share of non-null values that find their target row.
  - A column with no writer in the repo but values in prod is drift (production-engineering rule 1). It is marked
    `unknown, needs: <what>` and gets no comment.
- **Privacy.** Only counts and rates appear here. No handles, names, emails or order numbers.

## Scoreboard (in-scope columns that carry a COMMENT)

| Table | Columns in scope | Described before | Described after the migration |
|---|---:|---:|---:|
| auction_comments | 56 | 2 | 38 |
| bat_bids | 16 | 1 | 15 |
| bat_listings | 28 | 0 | 13 |
| bat_user_profiles | 26 | 0 | 16 |
| auction_events | 48 | 3 | 26 |
| external_identities | 14 | 1 | 14 |
| live_auction_sources | 41 | 0 | 13 |
| market_index_values | 11 | 2 | 10 |
| vehicles (auction and location columns) | 21 | 11 | 19 |
| vehicle_images (time and category columns) | 26 | 7 | 11 |
| **Total** | **287** | **27** | **175** |

The migration writes 151 column comments (148 new) and 7 table comments. `auction_events` and `bat_listings` had no
table comment; `auction_comments`, `bat_bids`, `bat_user_profiles`, `external_identities` and `market_index_values`
had a one-line one, which is replaced with grain, times, key and writers. It rewrites 3 column comments that the
data contradicts: `vehicles.gps_latitude` and `vehicles.gps_longitude` (said "from image EXIF"; they are geocoded) and
`market_index_values.components_snapshot`. Every other comment that already existed is left untouched.

## Where the machine's writes come from (live, 2026-09-30)

| Writer | Schedule | Writes |
|---|---|---|
| `bat-live-pull` cron → `bat_live_pull_run(3)` → `extract-bat-core` (`20260930000000_bat_live_pull.sql:227`) | every minute | auction_comments, auction_events, bat_bids (only when a bat_listings row exists), external_identities, vehicles |
| `bat-closed-lots-sync-daily` cron → `bat-closed-lots-sync` | 06:50 UTC daily | bat_listings |
| `bat-live-bids-snapshot` cron → `record_bat_live_bids_snapshot()` | hourly at :07 | market_index_values (index `BAT-LIVE-BIDS`) |
| trigger `trigger_update_user_profile` on auction_comments INSERT | per row | bat_user_profiles |
| trigger `trigger_sync_bat_to_vehicle` on bat_listings | per row | vehicles |

---

## auction_comments: the auction log

| Property | Value |
|---|---|
| Grain | One comment (a bid is also a comment) posted on one auction listing, as read from the listing page. |
| Rows (est.) | 18.4M, and about 99% of them are BaT: in the sample, `platform` is `bat` 99.9%, `cars_and_bids` 0.06%, `sbx_cars` under 0.01%. |
| Event time | `posted_at`. BaT JSON `timestamp` in seconds. When that is missing it falls back to the auction end, then to now(). |
| Ingest time | `created_at`, default now(). `posted_at <= created_at` in 99.95% of the sample. |
| Idempotency key | `UNIQUE (vehicle_id, content_hash)`. Writers also drop rows whose `bat_comment_id` the vehicle already holds (`extract-bat-core/index.ts:2555`). `bat_comment_id` has no unique index; it was unique in the sample (4,821 distinct among 4,822). |
| Writers | `_shared/batAuctionRecord.ts:224` `buildAuctionCommentRows`, called by `extract-bat-core/index.ts:2550` (live) and `scripts/bat-corrections/load_archive_comments.ts:83`; `extract-auction-comments/index.ts:353-649` (older JSON and DOM paths); `extract-cars-and-bids-comments/index.ts:579`; `scripts/bat-bid-backfill.mjs:228`. Updates only: `analyze-comments-fast` (question_classify), `batch-comment-discovery`, `scripts/question-classify-bulk.mjs`, hand-written stance migrations (`20260622220000…`, `20260623020000…`). Re-keying: `merge_into_primary` and `unmerge_vehicle`. |
| Triggers | `trigger_update_user_profile` (writes bat_user_profiles) and `trigger_queue_profile_from_auction_comment` (writes user_profile_queue). |
| FKs out | auction_event_id → auction_events; vehicle_id → vehicles (NOT VALID); external_identity_id and author_external_identity_id → external_identities; author_bat_user_id → bat_users. |

Most comment `(vehicle_id, sequence_number)` pairs are unique, but about 7% of rows in a 150-vehicle sample share one.
`sequence_number` shifts as a thread grows, and `content_hash` includes it, so older DOM-path rows can duplicate a
comment. Dedup should key on `bat_comment_id` where it is present.

| Column | Meaning | Unit | Writer | Null | Distinct | Names an entity → target (match) |
|---|---|---|---|---|---|---|
| id | Row id | uuid | default | 0 | – | – |
| auction_event_id | The listing this comment was read from | uuid | the caller of buildAuctionCommentRows | 12.1% | 5,354 | auction_events.id (FK). Its vehicle_id equals the comment's in 98.7% |
| vehicle_id | The vehicle | uuid | all writers; re-keyed by merge | 0 | 5,854 | vehicles.id (FK NOT VALID); 96.6% exist |
| comment_type | `bid`/`sold`/`seller_response`/`question`/`observation`. Sample shares: observation 38%, bid 34%, seller_response 14%, question 13%, sold 0.2% | enum text | batAuctionRecord.ts:246 | 0 | 5 | – |
| posted_at | When the comment was posted at the source | timestamptz, **event time** | BaT JSON `timestamp` | 0 | ~all | – |
| sequence_number | 1-based position in the page's comment array at read time. Not stable. | integer | `i+1` | 0 | 384 | – |
| hours_until_close | Documented as `max(0, end − posted)` hours. **Defective in prod:** the median is about 16,500 h and the maximum about 99,000 h. Only 19% of rows match (auction_events end − posted_at). | hours | batAuctionRecord.ts:247 | 0.1% | – | – |
| author_username | The platform handle, with "(The Seller)" stripped | text | all writers | 0 | 12,967 | external_identities(platform, handle): **99.0%** |
| author_type | – | – | no writer | 100% | – | unknown, needs: a writer or a drop |
| author_total_likes | The author's lifetime like total, as shown by BaT when read | count | `c.likes` | 0 | 41 | – |
| is_seller | The author is the listing's seller | bool | "(The Seller)" suffix | 0 | 2 | – |
| comment_text | Comment body | text | all writers | 0 | – | – |
| word_count | Words in comment_text | count | computed | 0 | 343 | – |
| has_question | comment_text contains `?` | bool | computed | 0 | 2 | – |
| has_media | Comment carries an image or video | bool | computed | 0 | 2 | – |
| media_urls | Image and video URLs in the comment | text[] | batAuctionRecord.ts:210 | 99.0% | – | – |
| mentions | – | – | no writer | 100% | – | unknown, needs: a writer or a drop |
| comment_likes | Likes on this comment (`c.commentLikes`). Always 0 in the sample. | count | writers set 0 or `commentLikes` | 0 | 1 | – |
| reply_count, is_flagged, is_leading_bid, bid_increment | – | – | no writer; constant 0/false or null | – | 1 | unknown, needs: a writer or a drop |
| bid_amount | Bid amount, only on bid comments. 99.98% of non-null values sit on `comment_type='bid'`. | USD, whole dollars | `c.bidAmount` | 64.5% | 1,644 | – |
| sentiment, sentiment_score, toxicity_score, expertise_indicators, authenticity_score, expertise_score, influence_score, key_claims, analyzed_at | An older AI analysis pass: sentiment in {neutral, excited, skeptical, bullish, bearish}, sentiment_score −75..85, the other scores 0..100 | – | **no writer in repo** (drift) | 89.1% | – | unknown, needs: the writer that filled 11% of rows |
| raw_html | – | – | none | 100% | – | – |
| created_at | When the row landed | timestamptz, **ingest time** | default now() | 0 | – | – |
| platform | Source platform | enum text (`bat`, `cars_and_bids`, `sbx_cars`) | writers | <0.01% | 3 | external_identities.platform |
| source_url | Normalized listing URL | url | writers | <0.01% | 5,854 | bat_listings.bat_listing_url: 68% of distinct listings, after trailing-slash normalization |
| content_hash | sha256 of `platform|url|seq|posted_at|author|text`; the idempotency key with vehicle_id | hex(64) | batAuctionRecord.ts:248 | <0.01% | – | – |
| author_bat_user_id | – | – | no writer | 100% | – | bat_users.id (FK); unused |
| author_external_identity_id | The author's identity | uuid | **no writer in repo** (drift) | 42.0% | 8,177 | external_identities.id (FK); equals external_identity_id wherever both are set. Needs: the writer |
| external_identity_id | The author's identity, resolved from (platform, author_username) | uuid | extract-auction-comments:612; backfill 20250131 | 26.7% | 10,193 | external_identities.id (FK) |
| question_categories | Scored category matches `[{id,l1,l2,score,intent}]` | jsonb | analyze-comments-fast, batch-comment-discovery | 98.3% | – | question_taxonomy ids |
| question_primary_l1 | Top question category (e.g. mechanical, provenance) | text | same | 92.6% | 10 | question_taxonomy l1 |
| question_primary_l2 | Top question subcategory | text | same | 92.6% | 73 | question_taxonomy l2 |
| question_classified_at | When the classifier ran | timestamptz, ingest time (derived) | same | 90.9% | – | – |
| question_classify_method | `regex_v1`, `regex_v1_low_conf`, `regex_v1_no_match`, `llm_gemini_v1` | enum text | same | 90.9% | 4 | – |
| bat_author_id | BaT's numeric member id of the author | integer | `c.authorId` | 57.3% | 5,786 | none stores it yet; needs `external_identities.platform_user_id` |
| bat_comment_id | BaT's numeric comment id; the natural source key | integer | `c.id` | 57.3% | 9,032 | – (unique candidate) |
| bat_author_likes | Author like total from `c.authorLikes` | count | batAuctionRecord.ts | 57.3% | 2,193 | – |
| likers_count | Number of accounts that liked this comment | count | `c.likers.length` | 57.3% | 37 | – |
| merged_from_vehicle_id | The duplicate vehicle this row was moved from by a merge | uuid | merge_into_primary | ~100% | – | vehicles.id |
| community_stance_score, condition_polarity | (already described) | −1..+1 | stance migrations | ~100% | – | – |
| stance_scored_at | When the rubric score was written | timestamptz, ingest time (derived) | stance migrations | ~100% | – | – |
| stance_model | Scorer label (e.g. rubric-v2) | text | stance migrations | ~100% | – | – |
| extracted_claims | Claims the rubric pass pulled out | jsonb array | stance migrations | ~100% | – | – |
| rubric_version | The rubric version the stance scores are anchored to | smallint | stance migrations | ~100% | – | – |

## bat_bids: one bid per row

| Property | Value |
|---|---|
| Grain | One bid by one bidder at one amount and time on one BaT lot. |
| Rows (est.) | 4.27M |
| Event time | `bid_timestamp`, the posted_at of the bid comment. |
| Ingest time | `created_at`. |
| Idempotency key | `UNIQUE (bat_listing_id, bat_username, bid_amount, bid_timestamp)`. It exists in prod but was created in no migration in the repo (drift). |
| Writers | `extract-bat-core/index.ts:2569-2599` (source=`comment`; only when a bat_listings row matches the URL); `extract-auction-comments/index.ts:831-857`; the live-sync path (source=`bid_history`, `metadata.source=sync_live_auctions`). `is_final_bid` and `is_winning_bid` come from the batch templates in `20260215500000_bid_analytics_foundation.sql`. |
| Triggers | none |

| Column | Meaning | Unit | Writer | Null | Distinct | Names an entity → target (match) |
|---|---|---|---|---|---|---|
| id | Row id | uuid | default | 0 | – | – |
| bat_listing_id | (already described) Polymorphic: bat_listings.id when source=`comment` (90% of rows), vehicle_events.id when source=`bid_history` (10%) | uuid | writers | 0 | 4,499 | bat_listings.id **90.1%** / vehicle_events.id for the rest. Needs a split |
| vehicle_id | The vehicle | uuid | writers | 0 | 4,377 | vehicles.id (FK). Equals bat_listings.vehicle_id in 99.6% |
| bat_user_id | – | – | always null | 100% | – | bat_users.id (FK); unused |
| bat_username | Bidder handle | text | author_username of the bid comment | 0 | 11,891 | external_identities(platform='bat', handle): **88.8%** |
| external_identity_id | Bidder identity | uuid | extract-auction-comments | 13.5% | 11,086 | external_identities.id (FK). Handle equals bat_username in 100% |
| bid_amount | Bid | USD, whole dollars | comment bidAmount | 0 | 3,563 | – |
| bid_timestamp | When the bid was placed | timestamptz, **event time** | the comment's posted_at | 0 | – | – |
| is_winning_bid | The lot's final bid, on a lot that sold | bool | batch template | 0 | 2 | – |
| is_final_bid | The last bid on the lot by bid_timestamp | bool | batch template | 0 | 2 | – |
| source | `comment` (90%) or `bid_history` (10%) | enum text | writers | 0 | 2 | – |
| bat_comment_id | Points at the retired `bat_comments` table | uuid | always null | 100% | – | none: repoint to auction_comments.id |
| auction_event_id | The listing | uuid | extract-bat-core | 23.6% | 2,960 | auction_events.id: **100%** of non-null. No FK, no index |
| metadata | `{source_url, comment_content_hash, sequence_number, extractor}` for comment bids; `{source}` for live sync | jsonb | writers | 0 | – | `comment_content_hash` → auction_comments(vehicle_id, content_hash): **100%** (1,500 of 1,500) |
| created_at | When the row landed | timestamptz, **ingest time** | default | 0 | – | – |
| updated_at | Last upsert | timestamptz, ingest time | default | 0 | – | – |

## bat_listings: the BaT closed-lot catalog

| Property | Value |
|---|---|
| Grain | One BaT listing URL (one lot). |
| Rows (est.) | 157K. The latest `auction_end_date` in the sample is 2026-07-30. From 2026-03 onward most BaT auction_events have no bat_listings row: each month from 2026-03 to 2026-09, fewer than 30% match. |
| Event time | `auction_end_date` (date) and `sale_date` (date, only when sold). |
| Ingest time | `scraped_at`, which is on the same day as `created_at` in 99.9% of rows; then `last_updated_at` and `updated_at`. |
| Idempotency key | `UNIQUE (bat_listing_url)`. 76% of URLs have no trailing slash and 24% have one, so the same lot can land twice under two spellings. |
| Writers | `bat-closed-lots-sync/index.ts:168` (catalogRow :55-71) and `scripts/bat-keep-fresh.mjs:179`, both upserting on the URL; `scripts/bat-bid-backfill.mjs:394` (seller_username). |
| Triggers | `trigger_sync_bat_to_vehicle` (writes vehicles), `trg_sync_bat_listing_to_org_vehicles` and `trigger_queue_profile_from_listing`. |

| Column | Meaning | Unit | Writer | Null | Distinct | Names an entity → target (match) |
|---|---|---|---|---|---|---|
| id | Row id | uuid | default | 0 | – | – |
| vehicle_id | The vehicle | uuid | set outside the sync function; unknown, needs: the writer | 8.3% | 8,067 | vehicles.id (FK NOT VALID): **91.8%** exist |
| organization_id | – | – | none | 100% | – | organizations.id (FK); unused |
| bat_listing_url | Listing URL; the source key | url | sync | 0 | 8,911 | – (target of others) |
| bat_lot_number | BaT lot number | text | unknown, needs: the writer | 30.6% | 6,125 | – |
| bat_listing_title | – | text | unknown, needs: the writer | 90.6% | – | – |
| auction_start_date | – | date | one-off `end − 7 days` fix | 100% | – | – |
| auction_end_date | When the lot ended | date, **event time** | sync (feed timestamp_end) | 23.4% | 2,499 | – |
| sale_date | Sale date; set only when sold | date, event time | sync | 41.4% | – | – |
| sale_price | Hammer price, set only when the feed says "Sold for" | USD, whole dollars | sync | 39.4% | 1,366 | – |
| reserve_price, starting_bid | – | – | none | 100% | – | – |
| final_bid | The feed's current_bid at close (hammer or high bid) | USD, whole dollars | sync | 0.9% | 1,863 | – |
| seller_username | Seller handle | text | bat-bid-backfill; unknown for the rest | 12.5% | 6,004 | external_identities(bat, handle): **85.3%** |
| buyer_username | Buyer handle | text | unknown, needs: the writer | 33.6% | 5,284 | external_identities(bat, handle): **97.8%** |
| seller_bat_user_id, buyer_bat_user_id, seller_external_identity_id, buyer_external_identity_id | – | uuid | one-off backfills; now null | 100% | – | FKs exist; the columns are empty. See FK candidates |
| comment_count, bid_count, view_count | Legacy counters (view_count is 0 in 99%) | count | unknown, needs: the writer | 0 | – | – |
| listing_status | `sold` (58%), `ended` (42%) or `active` | enum text | sync | 0 | 3 | – |
| scraped_at | When the sync last read it | timestamptz, **ingest time** | sync | 0 | – | – |
| last_updated_at | Last row change by the sync or backfill scripts | timestamptz, ingest time | sync, backfill | 0 | – | – |
| raw_data | The feed item plus `{sync: version}` | jsonb | sync | 0 | – | – |
| created_at, updated_at | Row insert and update | timestamptz, ingest time | default | 0 | – | – |

## bat_user_profiles: bidder and commenter state (a fold over auction_comments)

| Property | Value |
|---|---|
| Grain | One handle (`username`, the PK). Not platform-scoped: the trigger does not filter on platform. |
| Rows (est.) | 689K |
| Event time | none (it is state). `first_seen` and `last_seen` are derived event times. |
| Ingest time | `updated_at`. |
| Idempotency key | PK `username`. |
| Writers | Trigger `update_user_profile_from_comment` on every auction_comments INSERT (total_comments, total_bids, last_seen); `scripts/bat-compute-profiles.mjs:212` (everything else, BaT only); `scripts/user-stylometric-analyzer.mjs:707` (`metadata.stylometric_profile`). |
| Coverage | Only 0.3% of rows (19 of 6,845 sampled) have ever been computed by bat-compute-profiles. For the other 99.7%, only the trigger's counters are set. |
| Leakage | `win_rate`, `total_wins` and every aggregate here are lifetime numbers as of the last computation. **Never feed a past prediction with them** (theory card: point-in-time). |

| Column | Meaning | Unit | Writer | Null or 0 | Names an entity → target (match) |
|---|---|---|---|---|---|
| username | Handle as it appears in auction_comments.author_username | text | trigger, script | 0 | external_identities(bat, handle): **88.6%** |
| total_comments | Comments counted since the trigger existed | count | trigger +1 | 0 | – |
| total_bids | Bid comments counted | count | trigger +1 | 44.6% are 0 | – |
| total_wins | Lots where the user placed the max bid (not verified sales) | count | script | 99.7% | – |
| total_questions, total_answers | Script counts | count | script | ~99.9% | – |
| avg_bid_amount, max_bid_amount, min_bid_amount | Bid stats | USD | script | 99.7% | – |
| win_rate | total_wins ÷ unique auctions bid on | fraction 0–1 (not %) | script | 99.7% | – |
| expertise_score, technical_knowledge, market_knowledge, avg_comment_quality, avg_sentiment, bot_likelihood, shill_flags | – | – | no writer; defaults | 100% | unknown, needs: a writer or a drop |
| preferred_categories | Script output | text[] | script | 99.7% | – |
| typical_price_range | `{p25,p50,p75}` of the user's bids | USD jsonb | script | 99.7% | – |
| bidding_strategy | `observer`/`one_and_done`/`sniper`/`early_aggressive`/`steady` | enum text | script | 99.7% | – |
| avg_likes_received | Script output | count | script | 99.7% | – |
| community_trust_score | min(100, max author_total_likes ÷ 10) | 0–100 | script | 99.9% | – |
| first_seen | Earliest posted_at seen | timestamptz, event time (derived) | script | 99.7% | – |
| last_seen | Latest posted_at seen | timestamptz, event time (derived) | trigger, script | 0 | – |
| updated_at | Last write | timestamptz, ingest time | default | 0 | – |
| metadata | `{first_seen,last_seen,unique_auctions,avg_word_count,bids_last_2h_pct,computed_at,stylometric_profile}` | jsonb | script | 0 (`{}` mostly) | – |

## auction_events: one row per listing (lot) per vehicle

| Property | Value |
|---|---|
| Grain | One auction listing (a source URL) of one vehicle. |
| Rows (est.) | 323K. Sample by source: bat 65%, barrett-jackson 26%, mecum 7%, bonhams 1%, cars_and_bids 0.6%, facebook_marketplace 0.2%. `bringatrailer` and `collecting-cars` also exist in code. |
| Event time | `auction_end_date` (timestamptz), plus `auction_start_date` (99% null). |
| Ingest time | `created_at`, and `scraped_at`, which equals created_at in 99.6%. `updated_at` is the last read; bat-live-pull treats it as the read receipt. |
| Idempotency key | `UNIQUE (vehicle_id, source_url)`. |
| Writers | `extract-bat-core/index.ts:2498-2535` (live, every minute through bat-live-pull); `scripts/sync-live-to-auction-events.ts`; `extract-mecum/index.ts:804`; `extract-barrett-jackson/index.ts:1124`; `extract-cars-and-bids-core/index.ts:1034`; `extract-cab-bids` (bid_history); `scripts/rescrape-pending-vehicles.js` (high_bidder, reserve_gap_pct); `scripts/auction-forensics-analyzer.ts` (broadcast_*, forensics_data). |
| Triggers | `trg_auto_create_transfer_on_auction_close`. |

| Column | Meaning | Unit | Writer | Null | Distinct | Names an entity → target (match) |
|---|---|---|---|---|---|---|
| id | Row id | uuid | default | 0 | – | – |
| vehicle_id | The vehicle | uuid | writers | 0 | – | vehicles.id (FK NOT VALID): **90.1%** exist |
| source | Platform slug (bat, barrett-jackson, mecum, …) | text | writers | 0 | 8 | live_auction_sources.slug: 99.2% (misses: `cars_and_bids` vs `cars-and-bids`, facebook) |
| source_url | Listing URL | url | writers | 0 | ~all | bat_listings.bat_listing_url (bat rows): 54% |
| source_listing_id | Platform listing or lot id | text | writers | 27.2% | – | – |
| lot_number | Lot number | text | writers | 2.7% | – | – |
| auction_start_date | – | timestamptz | rare | 99.1% | – | – |
| auction_end_date | When the lot ends or ended | timestamptz, **event time** | writers | 37.8% | – | – |
| auction_duration_hours | – | – | none | 100% | – | – |
| outcome | `sold` 85%, `reserve_not_met` 14%, `live`, `no_sale`, `bid_to` | enum text | writers | 0 | 5 | – |
| starting_bid, reserve_price, buy_it_now_price, estimate_low, estimate_high | Rare, from auction-house extractors | USD | extractors | ≥99.7% | – | – |
| reserve_disclosed | – | bool | default false | 0 | 1 | – |
| high_bid | Sale price when sold, else the high bid | USD | writers | 27.8% | – | – |
| winning_bid | Hammer price; set only when sold | USD | writers | 31.8% | – | – |
| total_bids | Bid count shown on the page | count | writers | 27.7% | – | – |
| unique_bidders | Distinct bidders | count | writers | 82.0% | – | – |
| bid_history | Bid series (Cars & Bids) | jsonb | extract-cab-bids | – | – | – |
| high_bidder | – | text | rescrape script | 100% | – | – |
| winning_bidder | Winning bidder handle, only when sold | text | extract-bat-core | 44.6% | – | external_identities(bat, handle): **99.8%** |
| seller_name | Seller handle (BaT) | text | extract-bat-core | 28.0% | – | external_identities(bat, handle): **97.7%** |
| seller_type, market_insights, price_vs_estimate_pct, reserve_gap_pct, receipt_data, ai_summary, sentiment_arc, key_moments, top_contributors, broadcast_video_id, broadcast_video_url, broadcast_clip_url | – | – | no writer or rare | ≥98% | – | unknown, needs: a writer or a drop |
| seller_location | Seller location text | text | extractors | 98.0% | – | – |
| page_views | Page views shown by the platform | count | writers | 28.8% | – | – |
| watchers | Watchers shown by the platform | count | writers | 28.9% | – | – |
| comments_count | Comment count shown by the platform | count | writers | 27.9% | – | – |
| scraped_at | First scrape (default now) | timestamptz, **ingest time** | default | 0 | – | – |
| raw_data | `{extractor, listing_details}` | jsonb | writers | – | – | – |
| created_at | Row insert | timestamptz, ingest time | default | 0 | – | – |
| updated_at | Last read or upsert | timestamptz, ingest time | writers | 0 | – | – |
| broadcast_timestamp_start, broadcast_timestamp_end, forensics_data | (already described) | – | forensics script | 100% | – | – |
| merged_from_vehicle_id | The duplicate vehicle this row came from | uuid | merge SQL | ~100% | – | vehicles.id |

## external_identities: the identity entity (platform + handle)

| Property | Value |
|---|---|
| Grain | One handle on one platform. |
| Rows (est.) | 594K. Exact counts: bat 607,317; pcarmarket 4,313; cars_and_bids 818; **carsandbids 387** (the same platform under a second spelling); hagerty 375; others 6. |
| Event time | none (entity). `first_seen_at` and `last_seen_at` are meant as event times but hold ingest times. |
| Ingest time | `created_at`. |
| Idempotency key | `UNIQUE (platform, handle)`. |
| Writers | Upserts on (platform, handle): `extract-bat-core/index.ts:2421`, `extract-auction-comments/index.ts:614`, `extract-cars-and-bids-comments/index.ts:631`, `import-pcarmarket-listing:1153`, `extract-hagerty-listing:1126`, `ingest-external-profile/index.ts:81`; `process-profile-queue/index.ts:74` (metadata); the claim RPCs `approve_external_identity_claim` and `request_external_identity_claim`. |
| Triggers | `trg_upgrade_transfers_on_identity_claim` and `trigger_queue_profile_from_identity`. |
| Claimed | 2 rows have `claimed_by_user_id` and 1 has `user_id`. |

| Column | Meaning | Unit | Writer | Null | Names an entity → target |
|---|---|---|---|---|---|
| id | Row id | uuid | default | 0 | target of 19 FKs |
| platform | Platform slug | text | upserts | 0 | live_auction_sources.slug: needs a spelling map (`bat`, `cars_and_bids`/`carsandbids` vs `cars-and-bids`) |
| handle | Handle as shown on the platform | text | upserts | 0 | – |
| profile_url | Member page URL | url | upserts | 3.6% | – |
| display_name | Display name | text | upserts | 13.0% | – |
| claimed_by_user_id | (already described) | uuid | claim RPCs | ~100% | auth.users (FK) |
| claimed_at | When a claim was approved | timestamptz, ingest time | claim RPCs | ~100% | – |
| claim_confidence | Claim confidence (≥70 auto-approves) | 0–100 | claim RPCs | 0 (all 0) | – |
| first_seen_at | Intended as first sighting. It equals created_at in 95%, and `extract-bat-core` resets it to now() on every upsert (`:2421`), so 9.9% of rows have first_seen_at > last_seen_at. | timestamptz, ingest time | upserts | 0 | – |
| last_seen_at | Last time a writer saw the handle | timestamptz, ingest time | upserts | 0 | – |
| metadata | Profile-extraction output, e.g. listings_found, listing_urls, extracted_at | jsonb | process-profile-queue | 0 (`{}` in 93.5%) | – |
| created_at, updated_at | Row insert and update | timestamptz, ingest time | default | 0 | – |
| user_id | Mirror of claimed_by_user_id (BEFORE trigger) | uuid | trigger | ~100% | auth.users (FK) |

## live_auction_sources: the platform registry

| Property | Value |
|---|---|
| Grain | One auction platform. |
| Rows | 18. All have `is_active=true`, `health_status='healthy'` and `sync_method='polling_scrape'`. |
| Event time | none (configuration). `last_successful_sync` is an ingest time. |
| Ingest time | `created_at` and `updated_at` (trigger). |
| Idempotency key | `UNIQUE (slug)`. |
| Writers | Seed rows (migrations); `bat_live_pull_run()` (`20260930000000_bat_live_pull.sql:256`), which updates only `slug='bat'`: last_successful_sync, consecutive_failures, health_status, last_sync_error, `scraping_config.live_pull`. For the other 17 rows, the health fields are seed values. |

Fields present and constant or null in all 18 rows: supports_websocket, supports_sse, supports_api, requires_*,
websocket_url, sse_url, api_base_url, bid_endpoint, state_endpoint, comments_endpoint, known_anti_bot_measures and
known_rate_limits. These are configuration. They are left undescribed (unknown, needs: a consumer that reads them).

| Column | Meaning | Unit | Writer | Null |
|---|---|---|---|---|
| slug | Platform key (18 distinct) | text | seed | 0 |
| display_name | Human name | text | seed | 0 |
| base_url | Platform root URL | url | seed | 0 |
| organization_id | The platform's organization | uuid | seed | 67% |
| auction_format | `continuous_24_7`, `hybrid`, `live_event_online`, `timed_online` | enum | seed | 0 |
| default_poll_interval_ms | Poll cadence | ms | seed | 0 |
| soft_close_poll_interval_ms, soft_close_window_seconds | Poll cadence inside the soft-close window, and the window length | ms / s | seed | 0 |
| rate_limit_requests_per_minute | Politeness budget | req/min | seed | 0 |
| is_active | Platform is polled | bool | seed | 0 |
| last_successful_sync | Last pass that read a lot (bat only) | timestamptz, ingest time | bat_live_pull_run | 0 |
| last_sync_error | Last error (bat only) | text | bat_live_pull_run | 100% |
| consecutive_failures | Consecutive failed passes (bat only) | count | bat_live_pull_run | 0 |
| health_status | `healthy`/`degraded`/`unhealthy`/`unknown`; live for bat only | enum | bat_live_pull_run | 0 |
| scraping_config | Per-platform config; `live_pull` holds the bat reader's state | jsonb | seed, bat_live_pull_run | 0 |

## market_index_values: daily index series

| Property | Value |
|---|---|
| Grain | One index on one date. |
| Rows | 157 across 11 indexes. BAT-LIVE-BIDS (87 rows, 2026-06-29 → today, hourly). The other 10 stopped on 2026-02-10 or 2026-02-15 (dead since then). |
| Event time | `value_date` (date). |
| Ingest time | `created_at`. |
| Idempotency key | `UNIQUE (index_id, value_date)`. |
| Writers | `record_bat_live_bids_snapshot()` (cron `bat-live-bids-snapshot`, hourly); `calculate-market-indexes/index.ts:392-405` (no live schedule found). |

| Column | Meaning | Unit | Writer | Null |
|---|---|---|---|---|
| index_id | The index | uuid | both | 0 (FK market_indexes) |
| value_date | The day the value is for | date, event time | both | 0 |
| open_value, close_value, high_value, low_value | BAT-LIVE-BIDS: the day's first, latest, max and min hourly sum of live high bids. calculate-market-indexes: all four equal (one value per day). | USD (price indexes); points for MKTV-USD and PROJ-ACT | both | 0 |
| volume | BAT-LIVE-BIDS: live lots with a bid; else the sample count | count | both | 0 |
| components_snapshot | BAT-LIVE-BIDS: `{hourly:{HH:{at,bids,n,by_make}}}`; else `{count}` | jsonb | both | 0 |
| created_at | Row insert | timestamptz, ingest time | default | 0 |

## vehicles: the auction and location columns

`vehicles` is the entity (1.18M rows); these columns are its auction and location state. The event time for the
auction is `auction_end_date`, and the location observation time is `listing_location_observed_at`.

| Column | Meaning | Unit | Writer | Null | Names an entity → target (match) |
|---|---|---|---|---|---|
| sale_price | (already described) | USD | correct_vehicle_sale_provenance_batch, extractors | 59.0% | – |
| sold_price | (already described) Legacy. Equals sale_price in 100% of the 34 sampled rows where both are set. | USD | older importers | 98.9% | – |
| high_bid | (already described) | USD | extract-bat-core, upsert_live_auction_vehicles, triggers | 73.5% | – |
| bid_count | (already described) | count | triggers | 87.0% | – |
| comment_count | Comment count shown on the source platform | count | unknown, needs: current writer (C&B columns migration; bat_listings trigger?) | 86.4% | – |
| view_count | (already described) | count | – | 99.8% | – |
| auction_end_date | (already described) TEXT: `YYYY-MM-DD` in 96%, ISO with time in 4% | text, event time | extract-bat-core, sync trigger | 75.4% | – |
| auction_outcome | (already described) sold 81%, reserve_not_met 18%, no_sale | enum | extract-bat-core | 73.7% | – |
| listing_url | The source listing URL the vehicle was built from. 29% of sampled rows hold `conceptcarz://event/...` pseudo-URLs (not fetchable). | url | extract-bat-core (insert only) and other extractors | 16.3% | BaT rows: auction_events(vehicle_id, source_url) **89.2%**; bat_listings.bat_listing_url 60.0% |
| state | Two-letter US state in 98.6% of non-null values | text | parseLocation via extract-bat-core; enrich-bulk | 61.1% | none: needs a regions dimension |
| city | City parsed from the listing location | text | parseLocation; enrich-bulk | 60.9% | none: needs a places dimension |
| zip_code | (already described) 5-digit in 99.7% | text | unknown, needs: the writer | 83.8% | zip_to_fips.zip: **88.0%** |
| registration_state | – | – | none | 100% | – |
| bat_location | (already described) raw BaT location | text | extract-bat-core | 78.2% | – |
| listing_location | Cleaned "City, ST" | text | parseLocation; geocode-backfill | 56.9% | – |
| listing_location_raw | Location string as the source printed it | text | parseLocation | 83.6% | – |
| listing_location_source | Who set it: bat, geocoding_cache, bj_event, bat_snapshot_parser, city_geocode_lookup, carsandbids, location_agent_backfill, mecum_event, … (13) | enum text | writers | 76.4% | – |
| listing_location_confidence | Parse confidence | 0–1 | parseLocation | 80.2% | – |
| listing_location_observed_at | When the listing location was read | timestamptz, **ingest time** | parseLocation callers | 78.2% | – |
| gps_latitude, gps_longitude | Coordinates **geocoded from the listing location or venue**, not image EXIF, although the old comment said EXIF. Of rows with coordinates, 100% of those with a listing_location_source come from geocoding or event sources; 57% have no source recorded. | decimal degrees | geocode-backfill.mjs, bat-enrich-from-api.cjs, bonhams-auction-geocode.cjs, refine-fb-listing | 64.7% | – |

## vehicle_images: time and category columns

| Property | Value |
|---|---|
| Grain | One image attached to one vehicle. |
| Rows (est.) | 51.7M. Sample by source: bat_import 90%, external_import 6%, then mecum, gooding, classiccars, craigslist and others. |
| Event time | `taken_at` (capture), but see the warning below. |
| Ingest time | `created_at`. |

**Warning: `taken_at` is mostly ingest time.** 23.9% of sampled rows have `taken_at`. Of those, **99.3% fall on the
same calendar day as `created_at`**. `backfill-images/index.ts:626` writes the listing date, or else today, into it,
and extract-bat-core writes null (`:2201`). Only EXIF-derived values (`derive-image-exif`, `ingest_image_identity_first`)
are true capture times. A backtest that uses `taken_at` as event time will leak.

| Column | Meaning | Unit | Writer | Null | Distinct |
|---|---|---|---|---|---|
| taken_at | Capture time when EXIF-derived; otherwise the listing date or ingest day (see the warning) | timestamptz, event time (contaminated) | derive-image-exif, ingest_image_identity_first, image-intake, backfill-images | 76.1% | – |
| created_at | Row insert | timestamptz, **ingest time** | default now() | 0 | – |
| uploaded_at | Equals created_at in 49% | timestamptz | unknown, needs: the writer that diverges it | 0 | – |
| updated_at | Last row update | timestamptz | trigger/default | 0 | – |
| category | Legacy coarse category: `general` in 99.8%, `exterior`, `interior`, `exterior_body` | text | ingest_image_identity_first (payload or general/reference), auto-sort-photos, image-intake (`work`) | 0 | 4 |
| image_category | Newer category; almost unused | text | import-pcarmarket-listing (`exterior`) | 99.9% | 2 |
| image_type | Constant `general` in the sample | text | default | 0 | 1 |
| angle, angle_confidence, angle_source, document_category, image_medium, source, ai_processing_started_at, ai_processing_completed_at, optimized_at | (already described) | – | – | angle 99.9% | – |
| ai_detected_angle | Angle from the AI appraiser, mapped by SQL | text | 20250128000001 extraction | 99.9% | – |
| vehicle_zone | Zone class from yono-analyze | text | yono-analyze | 99.4% | 13 |
| ai_last_scanned, approved_at, last_rerun_at, organized_at, redacted_at, superseded_at, user_confirmed_vehicle_at, vision_analyzed_at, vision_gate_processed_at, yono_queued_at | Pipeline stamps, ≥99.5% null | timestamptz, ingest time | various | ≥99.5% | – |

---

## FK CANDIDATES

Text columns (and loose uuids) that name another entity. The rates are sampled; the orphans are the estimated rows
that would fail today (rows × miss rate × non-null share). No FK DDL is in this PR. The standard plan for each one is
`ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … NOT VALID` (a brief lock, no scan), then resolve the orphans through
the sanctioned writers, then `VALIDATE CONSTRAINT` (a SHARE UPDATE EXCLUSIVE lock, which does not block writes).
Each gets its own migration with `lock_timeout`.

| # | Source column | Target | Sampled match | Est. orphans | Plan |
|---|---|---|---:|---:|---|
| 1 | bat_bids.auction_event_id | auction_events.id | **100%** (7,334/7,334 non-null) | ~0 (1M null) | Index `bat_bids(auction_event_id)` first (none exists; 4.3M rows, CONCURRENTLY). Then FK NOT VALID → VALIDATE. Backfill the 24% null from metadata.source_url + vehicle_id. |
| 2 | bat_bids.(vehicle_id, metadata->>'comment_content_hash') | auction_comments(vehicle_id, content_hash) | **100%** (1,500/1,500) | ~0 | Add `bat_bids.auction_comment_id uuid`, backfill through that lookup, then FK NOT VALID → VALIDATE. Drop the dead `bat_comment_id` (100% null, points at the retired bat_comments). Index the new column. |
| 3 | auction_comments.(platform, author_username) | external_identities(platform, handle) | **99.0%** (3,931/3,972) | ~190K | Target unique exists. Backfill `external_identity_id` (73% filled) for the rest by upsert through the identity writer. Then either FK the uuid (it exists) or add a composite FK NOT VALID. Needs a full `(platform, author_username)` index (today there is a bat-only partial one). |
| 4 | auction_events.winning_bidder (BaT rows) | external_identities(platform='bat', handle) | **99.8%** (1,798/1,801) | ~0.3K | Add `winning_bidder_identity_id uuid`, backfill, FK NOT VALID → VALIDATE, and index. |
| 5 | auction_events.seller_name (BaT rows) | external_identities(platform='bat', handle) | **97.7%** (2,249/2,303) | ~4K | Same as #4 with `seller_identity_id`. |
| 6 | bat_listings.buyer_username | external_identities(bat, handle) | 97.8% (220/225) | ~2K | The FK column `buyer_external_identity_id` already exists but is 100% null. Backfill, then VALIDATE the existing FK. |
| 7 | bat_bids.bat_username | external_identities(bat, handle) | 88.8% (8,705/9,807) | ~480K | Backfill `external_identity_id` (86.5% filled; 100% consistent where set). The rest are handles never upserted into identities, so create them through the identity writer first. |
| 8 | bat_user_profiles.username | external_identities(bat, handle) | 88.6% (2,005/2,263) | ~79K | Add `external_identity_id`; profiles should key on the identity, not the text handle (it is platform-blind). |
| 9 | bat_listings.seller_username | external_identities(bat, handle) | 85.3% (617/723) | ~20K | As #6, with `seller_external_identity_id` (exists, 100% null). |
| 10 | vehicles.listing_url (BaT) | auction_events(vehicle_id, source_url) | 89.2% (584/655) | – | Not an FK. Replace with `vehicles.primary_auction_event_id`, or derive it. 29% of listing_url values are `conceptcarz://event/...` pseudo-URLs. |
| 11 | vehicles.zip_code | zip_to_fips.zip | 88.0% (683/776) | ~23K | zip_to_fips needs a UNIQUE on zip first (only a plain index was seen). Then FK NOT VALID and clean the orphans. |
| 12 | auction_events.source | live_auction_sources.slug | 99.2% | ~2.5K | Spelling map first (`cars_and_bids` → `cars-and-bids`, `bringatrailer` → `bat`). Add `source_id uuid`, backfill, FK. The same map fixes external_identities.platform (`carsandbids`). |
| 13 | bat_bids.bat_listing_id | bat_listings.id (source=comment) / vehicle_events.id (source=bid_history) | 90.1% / 9.9% | – | Polymorphic: split into `bat_listing_id` (FK bat_listings) and `vehicle_event_id` (FK vehicle_events), then VALIDATE each. |
| 14 | auction_comments.vehicle_id | vehicles.id (FK exists NOT VALID) | 96.6% | ~625K | Orphans come from vehicle deletes and merges. Re-key them through merge_into_primary, then VALIDATE. |
| 15 | bat_listings.vehicle_id | vehicles.id (FK exists NOT VALID) | 91.8% | ~12K | Same as #14. |
| 16 | auction_events.vehicle_id | vehicles.id (FK exists NOT VALID) | 90.1% | ~32K | Same as #14. |
| 17 | auction_comments.source_url | bat_listings.bat_listing_url | 68% of distinct listings (after slash normalization) | – | Not an FK: bat_listings is stale after 2026-07. Normalize the URL spellings in bat_listings first (24% have a trailing slash). |
| 18 | auction_comments.bat_author_id | none | – | – | Add `external_identities.platform_user_id` (BaT's numeric member id), then key on it; handles can change, ids cannot. |
| 19 | vehicles.state, vehicles.city | none (no regions or places dimension) | 98.6% state shape is XX | – | Needs a places dimension before any key. |

## What could not be established (unknown, needs)

- **Writers missing from the repo (drift).**
  - auction_comments: author_external_identity_id (58% filled), and the sentiment and score family (11%).
  - bat_listings: vehicle_id, bat_lot_number, buyer_username, bat_listing_title, and the comment_count, bid_count and
    view_count values.
  - vehicles: zip_code (16%) and comment_count.
  - bat_bids: the unique index on the upsert key was created outside migrations.
  - Needs: a `pg_stat_statements` or trigger-log trace of who writes these columns.
- **`auction_comments.hours_until_close`.** The code says `max(0, end − posted)`, but prod values run to 99K hours.
  Needs: which writer or backfill produced them, and a recompute from `auction_events.auction_end_date − posted_at`.
- **`vehicle_images.uploaded_at`.** It differs from created_at in 51% of rows, and no writer that sets it differently
  was found.
- **The live_auction_sources capability flags.** No consumer was found that reads them.
- **Exact row counts** for the big tables are atlas estimates. The sample rates carry block-sampling error of about
  ±5 points.
