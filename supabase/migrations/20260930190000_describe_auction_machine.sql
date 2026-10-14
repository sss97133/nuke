-- Describe the auction machine: COMMENT ON only. Evidence: docs/ledger/cartography/auction-machine.md
-- (code citations plus sampled prod data, 2026-09-30). No other DDL, no data changes.
SET lock_timeout = '2s';

-- ============================================================ auction_comments
COMMENT ON TABLE public.auction_comments IS 'The auction log. Grain: one comment (bids are comments) posted on one auction listing, as read from the listing page; ~99% BaT. Event time: posted_at. Ingest time: created_at. Idempotency key: UNIQUE (vehicle_id, content_hash); writers also skip bat_comment_id values the vehicle already holds. Writers: extract-bat-core via _shared/batAuctionRecord.ts (live, every minute through bat-live-pull), extract-auction-comments, extract-cars-and-bids-comments, scripts/bat-bid-backfill.mjs. Map: docs/ledger/cartography/auction-machine.md.';
COMMENT ON COLUMN public.auction_comments.id IS 'Row id (uuid, default gen_random_uuid()).';
COMMENT ON COLUMN public.auction_comments.auction_event_id IS 'The auction listing (auction_events.id) the comment was read from, passed in by the extractor. Null on ~12% of rows (older paths).';
COMMENT ON COLUMN public.auction_comments.vehicle_id IS 'The vehicle (vehicles.id) the listing belongs to. Set by every writer; re-keyed by merge_into_primary / unmerge_vehicle. FK is NOT VALID: ~3% of sampled rows point at missing vehicles.';
COMMENT ON COLUMN public.auction_comments.comment_type IS 'Kind of comment: bid | sold | seller_response | question | observation. Classified by the extractor (_shared/batAuctionRecord.ts) from the BaT type field and text.';
COMMENT ON COLUMN public.auction_comments.posted_at IS 'Event time: when the comment was posted at the source (BaT JSON timestamp, seconds). Falls back to the auction end, then now(), when the source gives none. timestamptz.';
COMMENT ON COLUMN public.auction_comments.sequence_number IS '1-based position of the comment in the page''s comment array at read time. Not stable: it shifts as the thread grows. Set by the extractor. Use bat_comment_id as the stable key.';
COMMENT ON COLUMN public.auction_comments.hours_until_close IS 'Intended: hours from posted_at to the auction end, max(0, end - posted) (extractor). Unit: hours. DEFECTIVE in prod: values reach ~99,000 h and only ~19% of sampled rows agree with auction_events.auction_end_date - posted_at; recompute before use.';
COMMENT ON COLUMN public.auction_comments.author_username IS 'The author''s platform handle, with the "(The Seller)" suffix stripped; ''Unknown'' when absent. Set by the extractor. Names external_identities (platform, handle): 99% of sampled rows match.';
COMMENT ON COLUMN public.auction_comments.author_total_likes IS 'The author''s lifetime like total as BaT showed it at read time (JSON likes). Count. Set by the extractor. A read-time snapshot, not point-in-time.';
COMMENT ON COLUMN public.auction_comments.is_seller IS 'True when the author is the listing''s seller ("(The Seller)" suffix on the author name). Set by the extractor.';
COMMENT ON COLUMN public.auction_comments.comment_text IS 'Comment body as read from the source. Set by the extractor.';
COMMENT ON COLUMN public.auction_comments.word_count IS 'Words in comment_text. Count. Computed by the extractor.';
COMMENT ON COLUMN public.auction_comments.has_question IS 'comment_text contains a question mark. Computed by the extractor.';
COMMENT ON COLUMN public.auction_comments.has_media IS 'The comment carries an image or video. Computed by the extractor.';
COMMENT ON COLUMN public.auction_comments.media_urls IS 'Image and video URLs attached to the comment (BaT JSON images / video oembed). Set by the extractor; null on ~99% of rows.';
COMMENT ON COLUMN public.auction_comments.comment_likes IS 'Likes on this comment (BaT JSON commentLikes; 0 when absent). Count. Set by the extractor. 0 on every sampled row.';
COMMENT ON COLUMN public.auction_comments.bid_amount IS 'Bid amount, set only on bid comments (BaT JSON bidAmount). USD, whole dollars. Set by the extractor.';
COMMENT ON COLUMN public.auction_comments.created_at IS 'Ingest time: when the row landed (default now()).';
COMMENT ON COLUMN public.auction_comments.platform IS 'Source platform slug: bat | cars_and_bids | sbx_cars. Set by the extractor. Pairs with author_username to name external_identities (platform, handle).';
COMMENT ON COLUMN public.auction_comments.source_url IS 'Normalized listing URL the comment was read from. Set by the extractor; part of content_hash.';
COMMENT ON COLUMN public.auction_comments.content_hash IS 'sha256 hex of platform|listing url|sequence_number|posted_at|author|text. With vehicle_id, the idempotency key (UNIQUE). Computed by the extractor.';
COMMENT ON COLUMN public.auction_comments.external_identity_id IS 'The author''s identity (external_identities.id), resolved from (platform, author_username). Set by extract-auction-comments and a 2025-01-31 backfill; null on ~27% of rows.';
COMMENT ON COLUMN public.auction_comments.question_categories IS 'Question classifier output: [{id, l1, l2, score, intent}] against question_taxonomy. Set by analyze-comments-fast (regex) or batch-comment-discovery (LLM).';
COMMENT ON COLUMN public.auction_comments.question_primary_l1 IS 'Top question category (question_taxonomy l1, e.g. mechanical, provenance). Set by the question classifier; null when not a question or unclassified.';
COMMENT ON COLUMN public.auction_comments.question_primary_l2 IS 'Top question subcategory (question_taxonomy l2). Set by the question classifier.';
COMMENT ON COLUMN public.auction_comments.question_classified_at IS 'Ingest-side time: when the question classifier ran on this row. timestamptz. Set by the question classifier.';
COMMENT ON COLUMN public.auction_comments.question_classify_method IS 'Which classifier ran: regex_v1 | regex_v1_low_conf | regex_v1_no_match | llm_gemini_v1. Set by the question classifier.';
COMMENT ON COLUMN public.auction_comments.bat_author_id IS 'BaT''s numeric member id of the author (JSON authorId). Integer. Set by the BaT JSON extractors; null on older DOM-path rows.';
COMMENT ON COLUMN public.auction_comments.bat_comment_id IS 'BaT''s numeric comment id (JSON id): the natural source key; writers skip ids the vehicle already holds. Integer. Unique in samples but no unique index.';
COMMENT ON COLUMN public.auction_comments.bat_author_likes IS 'The author''s like total from BaT JSON authorLikes at read time. Count. Set by the BaT JSON extractors.';
COMMENT ON COLUMN public.auction_comments.likers_count IS 'Number of accounts that liked this comment (length of BaT JSON likers). Count. Set by the BaT JSON extractors.';
COMMENT ON COLUMN public.auction_comments.merged_from_vehicle_id IS 'The duplicate vehicle this row was moved from by merge_into_primary; unmerge_vehicle moves it back. Null otherwise.';
COMMENT ON COLUMN public.auction_comments.stance_scored_at IS 'Ingest-side time: when the rubric stance score was written. timestamptz. Set only by hand-authored scoring migrations (cohort vehicles).';
COMMENT ON COLUMN public.auction_comments.stance_model IS 'Label of the scorer that wrote community_stance_score / condition_polarity (e.g. rubric-v2). Set only by hand-authored scoring migrations.';
COMMENT ON COLUMN public.auction_comments.extracted_claims IS 'Claims the rubric scoring pass extracted from the comment (jsonb array). Set only by hand-authored scoring migrations.';
COMMENT ON COLUMN public.auction_comments.rubric_version IS 'Rubric version the stance scores are anchored to (2 = rubric-v2). Set only by hand-authored scoring migrations.';

-- ============================================================ bat_bids
COMMENT ON TABLE public.bat_bids IS 'One bid by one bidder at one amount and time on one BaT lot. Event time: bid_timestamp. Ingest time: created_at. Idempotency key: UNIQUE (bat_listing_id, bat_username, bid_amount, bid_timestamp). Writers: extract-bat-core (source=comment, only when a bat_listings row exists), extract-auction-comments, live sync (source=bid_history). Map: docs/ledger/cartography/auction-machine.md.';
COMMENT ON COLUMN public.bat_bids.id IS 'Row id (uuid).';
COMMENT ON COLUMN public.bat_bids.vehicle_id IS 'The vehicle (vehicles.id). Set by the writer from the listing''s vehicle.';
COMMENT ON COLUMN public.bat_bids.bat_username IS 'Bidder handle (the bid comment''s author_username). Set by the writer. Names external_identities (platform=bat, handle): ~89% of sampled rows match.';
COMMENT ON COLUMN public.bat_bids.external_identity_id IS 'Bidder identity (external_identities.id); its handle equals bat_username wherever set. Set by extract-auction-comments; null on ~14%.';
COMMENT ON COLUMN public.bat_bids.bid_amount IS 'Bid amount. USD, whole dollars. From the bid comment''s bidAmount.';
COMMENT ON COLUMN public.bat_bids.bid_timestamp IS 'Event time: when the bid was placed (the bid comment''s posted_at). timestamptz.';
COMMENT ON COLUMN public.bat_bids.is_winning_bid IS 'The lot''s final bid on a lot that sold. Set by the batch template in 20260215500000_bid_analytics_foundation.sql; false by default.';
COMMENT ON COLUMN public.bat_bids.is_final_bid IS 'The last bid on the lot by bid_timestamp. Set by the batch template in 20260215500000_bid_analytics_foundation.sql; false by default.';
COMMENT ON COLUMN public.bat_bids.source IS 'Where the bid was read: comment (bid comment on the listing page, ~90%) | bid_history (live sync snapshot, ~10%) | manual. Selects what bat_listing_id points at.';
COMMENT ON COLUMN public.bat_bids.bat_comment_id IS 'Dead: pointed at the retired bat_comments table; null on every row. The bid''s comment is found via (vehicle_id, metadata->>''comment_content_hash'') in auction_comments.';
COMMENT ON COLUMN public.bat_bids.auction_event_id IS 'The listing (auction_events.id); every sampled non-null value exists. No FK, no index. Set by extract-bat-core; null on ~24%.';
COMMENT ON COLUMN public.bat_bids.metadata IS 'Provenance. source=comment: {source_url, comment_content_hash, sequence_number, extractor}; comment_content_hash + vehicle_id match auction_comments (vehicle_id, content_hash). Live sync: {source}.';
COMMENT ON COLUMN public.bat_bids.created_at IS 'Ingest time: when the row landed (default now()).';
COMMENT ON COLUMN public.bat_bids.updated_at IS 'Ingest time: last upsert of the row.';

-- ============================================================ bat_listings
COMMENT ON TABLE public.bat_listings IS 'The BaT closed-lot catalog. Grain: one BaT listing URL (one lot). Event time: auction_end_date / sale_date (dates). Ingest time: scraped_at. Idempotency key: UNIQUE (bat_listing_url); URL spellings with and without a trailing slash both occur. Writer: bat-closed-lots-sync (daily cron), scripts/bat-keep-fresh.mjs. Stale after 2026-07. Map: docs/ledger/cartography/auction-machine.md.';
COMMENT ON COLUMN public.bat_listings.id IS 'Row id (uuid). bat_bids.bat_listing_id points here when bat_bids.source = comment.';
COMMENT ON COLUMN public.bat_listings.bat_listing_url IS 'The BaT listing URL: the source key (UNIQUE). Set by bat-closed-lots-sync.';
COMMENT ON COLUMN public.bat_listings.auction_end_date IS 'Event time: the day the lot ended (feed sold_text_timestamp or timestamp_end). date. Set by bat-closed-lots-sync.';
COMMENT ON COLUMN public.bat_listings.sale_date IS 'Event time: the sale day; set only when the lot sold (equals auction_end_date). date. Set by bat-closed-lots-sync.';
COMMENT ON COLUMN public.bat_listings.sale_price IS 'Hammer price, set only when the feed says "Sold for" (else null). USD, whole dollars. Set by bat-closed-lots-sync.';
COMMENT ON COLUMN public.bat_listings.final_bid IS 'The feed''s current_bid at close: the hammer price when sold, the high bid otherwise. USD, whole dollars. Set by bat-closed-lots-sync.';
COMMENT ON COLUMN public.bat_listings.seller_username IS 'Seller handle on BaT. Filled by scripts/bat-bid-backfill.mjs where null. Names external_identities (platform=bat, handle): ~85% match.';
COMMENT ON COLUMN public.bat_listings.listing_status IS 'Lot status from the feed: sold | ended (closed, not sold) | active. Set by bat-closed-lots-sync.';
COMMENT ON COLUMN public.bat_listings.scraped_at IS 'Ingest time: when bat-closed-lots-sync last read the lot (now()).';
COMMENT ON COLUMN public.bat_listings.last_updated_at IS 'Ingest time: last change by the sync or backfill scripts.';
COMMENT ON COLUMN public.bat_listings.raw_data IS 'The feed item as read, plus {sync: version}. Set by bat-closed-lots-sync.';
COMMENT ON COLUMN public.bat_listings.created_at IS 'Ingest time: row insert (default now()).';
COMMENT ON COLUMN public.bat_listings.updated_at IS 'Ingest time: last row update.';

-- ============================================================ bat_user_profiles
COMMENT ON TABLE public.bat_user_profiles IS 'Bidder and commenter state, a fold over auction_comments. Grain: one handle (username, not platform-scoped). Ingest time: updated_at. Writers: trigger update_user_profile_from_comment on auction_comments INSERT (counters, last_seen) and scripts/bat-compute-profiles.mjs (everything else; ~0.3% of rows computed). Lifetime aggregates: never feed a past prediction with them (leakage).';
COMMENT ON COLUMN public.bat_user_profiles.username IS 'Handle as it appears in auction_comments.author_username (PK). Names external_identities (platform=bat, handle): ~89% match.';
COMMENT ON COLUMN public.bat_user_profiles.total_comments IS 'Comments by this handle, +1 per auction_comments INSERT (trigger); recomputed by bat-compute-profiles. Count.';
COMMENT ON COLUMN public.bat_user_profiles.total_bids IS 'Bid comments by this handle, +1 per bid comment INSERT (trigger); recomputed by bat-compute-profiles. Count.';
COMMENT ON COLUMN public.bat_user_profiles.total_wins IS 'Lots where this handle placed the max bid (not verified sales). Count. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.avg_bid_amount IS 'Mean bid. USD. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.max_bid_amount IS 'Largest bid. USD. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.min_bid_amount IS 'Smallest bid. USD. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.win_rate IS 'total_wins / unique auctions bid on. Fraction 0-1 (not a percent). Lifetime as of computation. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.typical_price_range IS '{p25, p50, p75} of this handle''s bids. USD. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.bidding_strategy IS 'observer | one_and_done | sniper (>50% of bids in the last 2 h) | early_aggressive | steady. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.avg_likes_received IS 'Mean likes per comment. Count. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.community_trust_score IS 'min(100, max author_total_likes / 10). Scale 0-100. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.first_seen IS 'Derived event time: earliest posted_at seen for the handle. timestamptz. Set by scripts/bat-compute-profiles.mjs.';
COMMENT ON COLUMN public.bat_user_profiles.last_seen IS 'Derived event time: latest posted_at seen for the handle. timestamptz. Set by the trigger on each comment and by bat-compute-profiles.';
COMMENT ON COLUMN public.bat_user_profiles.updated_at IS 'Ingest time: last write to the row.';
COMMENT ON COLUMN public.bat_user_profiles.metadata IS '{first_seen, last_seen, unique_auctions, avg_word_count, bids_last_2h_pct, computed_at} from bat-compute-profiles (replaced on each run), plus stylometric_profile from scripts/user-stylometric-analyzer.mjs. {} on most rows.';

-- ============================================================ auction_events
COMMENT ON TABLE public.auction_events IS 'One auction listing (lot) of one vehicle. Event time: auction_end_date. Ingest time: created_at (scraped_at is the same); updated_at is the last read (bat-live-pull''s read receipt). Idempotency key: UNIQUE (vehicle_id, source_url). Writers: extract-bat-core (live, via bat-live-pull), extract-mecum, extract-barrett-jackson, extract-cars-and-bids-core, scripts/sync-live-to-auction-events.ts. Map: docs/ledger/cartography/auction-machine.md.';
COMMENT ON COLUMN public.auction_events.id IS 'Row id (uuid). Referenced by auction_comments.auction_event_id and bat_bids.auction_event_id.';
COMMENT ON COLUMN public.auction_events.vehicle_id IS 'The vehicle (vehicles.id). Set by the extractor. FK is NOT VALID: ~10% of sampled rows point at missing vehicles.';
COMMENT ON COLUMN public.auction_events.source IS 'Platform slug: bat | barrett-jackson | mecum | bonhams | cars_and_bids | facebook_marketplace | bringatrailer | collecting-cars | pcarmarket. Set by the extractor. Mostly matches live_auction_sources.slug (spellings differ for C&B, bringatrailer).';
COMMENT ON COLUMN public.auction_events.source_url IS 'Listing URL at the source; with vehicle_id, the idempotency key. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.source_listing_id IS 'Platform listing or lot id (BaT: the lot number). Set by the extractor.';
COMMENT ON COLUMN public.auction_events.lot_number IS 'Lot number as the platform prints it. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.auction_end_date IS 'Event time: when the lot ends or ended. timestamptz. Set by the extractor from the listing page.';
COMMENT ON COLUMN public.auction_events.outcome IS 'sold | reserve_not_met | live | no_sale | bid_to | listed. Set by the extractor; trg_auto_create_transfer_on_auction_close fires on it.';
COMMENT ON COLUMN public.auction_events.high_bid IS 'The sale price when sold, else the highest bid seen. USD, whole dollars. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.winning_bid IS 'Hammer price, set only when sold. USD, whole dollars. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.total_bids IS 'Bid count the platform shows. Count. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.unique_bidders IS 'Distinct bidders on the lot. Count. Set by the extractor; null on ~82%.';
COMMENT ON COLUMN public.auction_events.winning_bidder IS 'Winning bidder''s handle, set only when sold. Set by extract-bat-core. Names external_identities (platform=bat, handle): ~99.8% of BaT rows match.';
COMMENT ON COLUMN public.auction_events.seller_name IS 'Seller''s handle on the platform (BaT username). Set by extract-bat-core. Names external_identities (platform=bat, handle): ~98% of BaT rows match.';
COMMENT ON COLUMN public.auction_events.page_views IS 'Page views the platform shows at read time. Count. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.watchers IS 'Watchers the platform shows at read time. Count. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.comments_count IS 'Comment count the platform shows at read time. Count. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.scraped_at IS 'Ingest time: first scrape (default now(); equals created_at on ~99.6% of rows).';
COMMENT ON COLUMN public.auction_events.raw_data IS 'Extractor provenance and page details, e.g. {extractor, listing_details}. Set by the extractor.';
COMMENT ON COLUMN public.auction_events.created_at IS 'Ingest time: row insert (default now()).';
COMMENT ON COLUMN public.auction_events.updated_at IS 'Ingest time: last read/upsert of the row. bat_live_pull_run counts a lot as read when this moves past its dispatch.';
COMMENT ON COLUMN public.auction_events.merged_from_vehicle_id IS 'The duplicate vehicle this row was moved from by merge_into_primary. Null otherwise.';
COMMENT ON COLUMN public.auction_events.bid_history IS 'Bid series read from the platform (Cars & Bids). jsonb. Set by extract-cab-bids.';

-- ============================================================ external_identities
COMMENT ON TABLE public.external_identities IS 'The identity entity: one handle on one platform (bat ~98%). Idempotency key: UNIQUE (platform, handle). Ingest time: created_at. Writers: upserts on (platform, handle) by extract-bat-core, extract-auction-comments, extract-cars-and-bids-comments, import-pcarmarket-listing, extract-hagerty-listing, ingest-external-profile; claim RPCs. Extend this; never mint a parallel identity table.';
COMMENT ON COLUMN public.external_identities.id IS 'Row id (uuid); the key 19 tables point at.';
COMMENT ON COLUMN public.external_identities.platform IS 'Platform slug: bat | pcarmarket | cars_and_bids | carsandbids (same platform, second spelling) | hagerty | instagram | sbxcars | classic_com | x. Set by the upserting extractor.';
COMMENT ON COLUMN public.external_identities.handle IS 'The handle as the platform shows it. With platform, UNIQUE. Set by the upserting extractor.';
COMMENT ON COLUMN public.external_identities.profile_url IS 'The member profile page URL. Set by the upserting extractor.';
COMMENT ON COLUMN public.external_identities.display_name IS 'Display name shown by the platform. Set by the upserting extractor.';
COMMENT ON COLUMN public.external_identities.claimed_at IS 'Ingest time: when a claim was approved (approve_external_identity_claim / auto-approval).';
COMMENT ON COLUMN public.external_identities.claim_confidence IS 'Confidence that the claimant owns the handle. Integer 0-100; >= 70 auto-approves. Set by the claim RPCs.';
COMMENT ON COLUMN public.external_identities.first_seen_at IS 'Intended: first sighting. Actually ingest time: default now(), and extract-bat-core resets it to now() on every upsert, so it can exceed last_seen_at. Not an event time.';
COMMENT ON COLUMN public.external_identities.last_seen_at IS 'Ingest time: the last time a writer saw the handle.';
COMMENT ON COLUMN public.external_identities.metadata IS 'Profile-extraction output, e.g. {listings_found, listing_urls, extracted_at}; dedup annotations {duplicate_of, canonical_handle}. Written by process-profile-queue and dedup SQL. {} on most rows.';
COMMENT ON COLUMN public.external_identities.created_at IS 'Ingest time: row insert (default now()).';
COMMENT ON COLUMN public.external_identities.updated_at IS 'Ingest time: last row update.';
COMMENT ON COLUMN public.external_identities.user_id IS 'Mirror of claimed_by_user_id, kept in sync by the BEFORE trigger sync_external_identity_user_id_trigger.';

-- ============================================================ live_auction_sources
COMMENT ON COLUMN public.live_auction_sources.slug IS 'Platform key (UNIQUE), e.g. bat, mecum, cars-and-bids. Seeded by migration.';
COMMENT ON COLUMN public.live_auction_sources.display_name IS 'Human-readable platform name. Seeded by migration.';
COMMENT ON COLUMN public.live_auction_sources.base_url IS 'Platform root URL. Seeded by migration.';
COMMENT ON COLUMN public.live_auction_sources.organization_id IS 'The platform''s organization (organizations.id), where known. Seeded by migration.';
COMMENT ON COLUMN public.live_auction_sources.auction_format IS 'continuous_24_7 | hybrid | live_event_online | timed_online. Seeded by migration.';
COMMENT ON COLUMN public.live_auction_sources.default_poll_interval_ms IS 'Default poll cadence. Milliseconds. Seeded by migration.';
COMMENT ON COLUMN public.live_auction_sources.rate_limit_requests_per_minute IS 'Politeness budget for requests to the platform. Requests per minute. Seeded by migration.';
COMMENT ON COLUMN public.live_auction_sources.is_active IS 'The platform is meant to be polled. Seeded by migration.';
COMMENT ON COLUMN public.live_auction_sources.last_successful_sync IS 'Ingest time: last pass that read at least one lot. Live only for slug=bat (bat_live_pull_run); other rows hold seed values.';
COMMENT ON COLUMN public.live_auction_sources.last_sync_error IS 'Last error of the reader. Live only for slug=bat (bat_live_pull_run).';
COMMENT ON COLUMN public.live_auction_sources.consecutive_failures IS 'Consecutive failed passes. Count. Live only for slug=bat (bat_live_pull_run resets it on a read).';
COMMENT ON COLUMN public.live_auction_sources.health_status IS 'healthy | degraded | unhealthy | unknown. Live only for slug=bat (bat_live_pull_run); other rows hold seed values.';
COMMENT ON COLUMN public.live_auction_sources.scraping_config IS 'Per-platform reader config (jsonb). For bat, live_pull holds the reader''s state (last_run, rest_probes), written by bat_live_pull_run.';

-- ============================================================ market_index_values
COMMENT ON TABLE public.market_index_values IS 'Daily index series. Grain: one index on one date. Event time: value_date. Ingest time: created_at. Idempotency key: UNIQUE (index_id, value_date). Writers: record_bat_live_bids_snapshot() (hourly cron, index BAT-LIVE-BIDS) and calculate-market-indexes (other indexes; none written since 2026-02-15).';
COMMENT ON COLUMN public.market_index_values.index_id IS 'The index (market_indexes.id).';
COMMENT ON COLUMN public.market_index_values.value_date IS 'Event time: the day the value is for. date.';
COMMENT ON COLUMN public.market_index_values.open_value IS 'BAT-LIVE-BIDS: the day''s first hourly sum of live BaT high bids. Other indexes: the single daily value. Units of the index (USD for price indexes).';
COMMENT ON COLUMN public.market_index_values.close_value IS 'BAT-LIVE-BIDS: the latest hourly sum of live BaT high bids. Other indexes: the single daily value. Units of the index (USD for price indexes).';
COMMENT ON COLUMN public.market_index_values.high_value IS 'BAT-LIVE-BIDS: the day''s greatest hourly sum. Other indexes: the single daily value. Units of the index.';
COMMENT ON COLUMN public.market_index_values.low_value IS 'BAT-LIVE-BIDS: the day''s least hourly sum. Other indexes: the single daily value. Units of the index.';
COMMENT ON COLUMN public.market_index_values.volume IS 'BAT-LIVE-BIDS: live lots with a bid at the latest snapshot. Other indexes: vehicles in the sample. Count.';
COMMENT ON COLUMN public.market_index_values.components_snapshot IS 'BAT-LIVE-BIDS: {hourly: {HH: {at, bids, n, by_make}}}, written by record_bat_live_bids_snapshot(). Other indexes: {count}, written by calculate-market-indexes.';
COMMENT ON COLUMN public.market_index_values.created_at IS 'Ingest time: row insert (default now()).';

-- ============================================================ vehicles (auction and location columns)
COMMENT ON COLUMN public.vehicles.listing_url IS 'The source listing URL the vehicle was built from; set on insert by extract-bat-core and other extractors, kept on update. Some rows hold conceptcarz://event/... pseudo-URLs (not fetchable). For BaT, matches auction_events (vehicle_id, source_url) on ~89% of sampled rows.';
COMMENT ON COLUMN public.vehicles.state IS 'US state, two-letter code in ~99% of values, parsed from the listing location (_shared/parseLocation via extract-bat-core) or reverse-geocoded by enrich-bulk. Text.';
COMMENT ON COLUMN public.vehicles.city IS 'City parsed from the listing location (_shared/parseLocation via extract-bat-core) or reverse-geocoded by enrich-bulk. Text.';
COMMENT ON COLUMN public.vehicles.listing_location IS 'Cleaned "City, ST" location of the listing. Set by _shared/parseLocation callers (extract-bat-core) and scripts/geocode-backfill.mjs.';
COMMENT ON COLUMN public.vehicles.listing_location_raw IS 'Location string exactly as the source printed it. Set by _shared/parseLocation callers.';
COMMENT ON COLUMN public.vehicles.listing_location_source IS 'Who set listing_location: bat | geocoding_cache | bj_event | bat_snapshot_parser | city_geocode_lookup | carsandbids | location_agent_backfill | mecum_event | geocode_backfill | ... Set with listing_location.';
COMMENT ON COLUMN public.vehicles.listing_location_confidence IS 'Confidence of the location parse. Real 0-1. Set by _shared/parseLocation callers.';
COMMENT ON COLUMN public.vehicles.listing_location_observed_at IS 'Ingest time: when the listing location was read. timestamptz. Set by _shared/parseLocation callers.';
COMMENT ON COLUMN public.vehicles.gps_latitude IS 'Latitude geocoded from the listing location or auction venue (scripts/geocode-backfill.mjs, bat-enrich-from-api.cjs, bonhams-auction-geocode.cjs, refine-fb-listing), not image EXIF. Decimal degrees.';
COMMENT ON COLUMN public.vehicles.gps_longitude IS 'Longitude geocoded from the listing location or auction venue (scripts/geocode-backfill.mjs, bat-enrich-from-api.cjs, bonhams-auction-geocode.cjs, refine-fb-listing), not image EXIF. Decimal degrees.';

-- ============================================================ vehicle_images (time and category columns)
COMMENT ON COLUMN public.vehicle_images.taken_at IS 'Intended event time: when the photo was captured (EXIF DateTimeOriginal via derive-image-exif / ingest_image_identity_first). CONTAMINATED: backfill-images writes the listing date or today, and ~99% of sampled non-null values fall on the created_at day. Trust only EXIF-derived values.';
COMMENT ON COLUMN public.vehicle_images.created_at IS 'Ingest time: row insert (default now()).';
COMMENT ON COLUMN public.vehicle_images.category IS 'Legacy coarse category: general (~99.8%) | exterior | interior | exterior_body | reference | work | documentation. Set by ingest_image_identity_first (payload, else general/reference), image-intake (work), auto-sort-photos.';
COMMENT ON COLUMN public.vehicle_images.image_category IS 'Newer category column, almost unused (~0.1% set; e.g. exterior from import-pcarmarket-listing).';
