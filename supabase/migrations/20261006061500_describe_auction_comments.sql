-- Describe auction_comments: table purpose with its two clocks, and the 54 undescribed columns (2 of 56 described
-- before: community_stance_score, condition_polarity; those two are left as they are).
-- Lane C (cartographer), night shift 2026-10-05. Comments only.
--
-- EVIDENCE (read 2026-10-06 UTC):
--   Row shape: supabase/functions/_shared/batAuctionRecord.ts buildAuctionCommentRows() (one builder for
--   extract-bat-core v4.1+ and scripts/bat-corrections/load_archive_comments.ts); linkAuctionCommentIdentities()
--   sets external_identity_id before insert (added e96ba7f02, 2026-10-02). Other writers: extract-auction-comments
--   (sets external_identity_id from its handle map), ingest-observation bat live mode through ingest_bat_live_events
--   (20261004182500), retainedIdentity.ts (reads both twins). Analysis columns: analyze-auction-comments (deleted
--   5741560ae, 2026-03-09), scripts/question-classify-bulk.mjs (regex_v1), rubric v2 rescore migrations of 2026-06-22/23.
--   No live SQL function references author_external_identity_id (pg_proc search, 2026-10-06).
--   THE TWIN AUTHOR KEYS (tablesample 0.2%, n=40,293, by created_at month): 2026-01 and 2026-02 rows carry both and
--   they never differ; from 2026-03 only external_identity_id is written (author_external_identity_id 18 of 3,349 in
--   2026-03, 0 after). Rows created 2026-09-27 .. 2026-10-01 (the archive bulk load) carry external_identity_id on
--   about 1%; from 2026-10-02 nearly 100%. Overall fill: author_external_identity_id 58%, external_identity_id 75%.
--   Lane K adjudicates which twin is canonical; this file records the facts only.
--   Sample fill (0.2%, n=38,414): auction_event_id 88%, bat_comment_id 42%, sentiment block 11%, question class 10%;
--   1% sample (n=199,191): author_type, mentions, is_flagged, is_leading_bid, bid_increment, toxicity_score, raw_html,
--   author_bat_user_id, merged_from_vehicle_id all empty; stance/polarity/extracted_claims 1 row.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

COMMENT ON TABLE public.auction_comments IS
'The auction log: one row per comment or bid posted on an auction lot (grain: one comment; BaT 99.7%, Cars and Bids the rest). Append-only by writer contract: upserts ignore duplicates on (vehicle_id, content_hash), and extract-bat-core also skips any bat_comment_id the vehicle already holds. Event time = posted_at (BaT comment timestamp). Ingest time = created_at. Writers: extract-bat-core and scripts/bat-corrections/load_archive_comments.ts through the shared builder batAuctionRecord.ts; ingest-observation for live BaT frames; extract-auction-comments (older). Author keys: external_identity_id is the one current writers set; author_external_identity_id is its twin, written only on rows created before 2026-03.';

COMMENT ON COLUMN public.auction_comments.id IS
'Surrogate key of the comment row. Unit: none (uuid). Source: gen_random_uuid() default. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.auction_event_id IS
'Lot the comment was posted on, FK to auction_events.id (ON DELETE CASCADE). Unit: none. Source: the auction_events row extract-bat-core wrote in the same read. 88% filled (2026-10-06 sample). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.vehicle_id IS
'Vehicle offered in the lot, FK to vehicles.id (NOT VALID, ON DELETE RESTRICT). Part of the idempotency key (vehicle_id, content_hash). Unit: none. Source: the writing extractor. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.comment_type IS
'Kind of comment (CHECK): bid, sold, question, answer, observation, seller_update, seller_response, expert_opinion. The builder writes bid (a BaT bid with an amount), sold (BaT sale record), seller_response (seller author), question (text contains ?), else observation. Unit: none. Source: buildAuctionCommentRows. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.posted_at IS
'When the comment was posted on the source. Unit: timestamptz (UTC). Source: the BaT comments JSON timestamp; when a comment has none the builder falls back to the lot end time, then to the read time, so those rows carry a non-source clock. Range 2014-08-06 .. now. Grain: one comment. Clock: event (BaT comment time).';
COMMENT ON COLUMN public.auction_comments.sequence_number IS
'Position of the comment in the lot thread as read (1 = first). Shifts as a thread grows, so it is not a stable id. Unit: ordinal. Source: buildAuctionCommentRows. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.hours_until_close IS
'Hours from posted_at to the lot end time, floored at 0; 0 when either time is unknown. Unit: hours. Source: buildAuctionCommentRows (end time as known at the read; soft-close extensions after that read are not reflected). Grain: one comment. Clock: derived (from posted_at and the end time).';
COMMENT ON COLUMN public.auction_comments.author_username IS
'Comment author handle as shown on the source, with (The Seller) stripped; Unknown when missing. Names an external_identities row (platform bat, handle). Unit: none. Source: buildAuctionCommentRows. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.author_type IS
'Planned author category. Unit: none. Source: none; empty in a 1% sample (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.author_total_likes IS
'The likes field of the comment in the BaT comments JSON (c.likes), as read. Whether BaT means the author total or this comment is not established; see also comment_likes and bat_author_likes. Unit: count. Source: buildAuctionCommentRows. Grain: one comment. Clock: derived (as of created_at).';
COMMENT ON COLUMN public.auction_comments.is_seller IS
'True when the author is the lot seller (BaT marks the name with (The Seller)). Unit: boolean. Source: buildAuctionCommentRows. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.comment_text IS
'Comment text with HTML tags removed and whitespace collapsed; empty for text-less comments (bids). Unit: none. Source: buildAuctionCommentRows. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.word_count IS
'Number of whitespace-separated words in comment_text. Unit: count. Source: buildAuctionCommentRows. Grain: one comment. Clock: derived.';
COMMENT ON COLUMN public.auction_comments.has_question IS
'True when comment_text contains a question mark. Unit: boolean. Source: buildAuctionCommentRows. Grain: one comment. Clock: derived.';
COMMENT ON COLUMN public.auction_comments.has_media IS
'True when the comment carries an image or video. Unit: boolean. Source: buildAuctionCommentRows (hasImage, hasVideo or media URLs). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.media_urls IS
'URLs of images or videos attached to the comment; NULL when none. Unit: none. Source: buildAuctionCommentRows (commentMediaUrls). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.mentions IS
'Planned list of handles mentioned in the comment. Unit: none. Source: no current writer; empty in a 1% sample (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.comment_likes IS
'Likes on this comment (c.commentLikes in the BaT comments JSON) as read. Unit: count. Source: buildAuctionCommentRows. Grain: one comment. Clock: derived (as of created_at; not refreshed).';
COMMENT ON COLUMN public.auction_comments.reply_count IS
'Replies to the comment. Unit: count. Source: no current writer sets it (default 0); some Cars and Bids scripts did. Grain: one comment. Clock: derived.';
COMMENT ON COLUMN public.auction_comments.is_flagged IS
'Planned moderation flag. Unit: boolean. Source: none; false on every sampled row (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.bid_amount IS
'Bid amount when the comment is a bid; NULL otherwise. Voided bids (bat-bid-canceled) are never bids. Unit: USD (BaT whole dollars). Source: buildAuctionCommentRows (c.bidAmount). Grain: one comment. Clock: n/a (value at posted_at).';
COMMENT ON COLUMN public.auction_comments.is_leading_bid IS
'Planned flag for the bid that led at its moment. Unit: boolean. Source: none; NULL on every sampled row (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.bid_increment IS
'Planned increase over the previous bid. Unit: USD. Source: none; NULL on every sampled row (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.sentiment IS
'AI sentiment label of the comment. Unit: none. Source: analyze-auction-comments (deleted 2026-03-09, 5741560ae); 11% of rows, analyzed 2026-01-20 .. 2026-03-06. Grain: one comment. Clock: derived (as of analyzed_at).';
COMMENT ON COLUMN public.auction_comments.sentiment_score IS
'AI sentiment score of the comment. Unit: score (model scale). Source: analyze-auction-comments (deleted 5741560ae). Grain: one comment. Clock: derived (as of analyzed_at).';
COMMENT ON COLUMN public.auction_comments.toxicity_score IS
'Planned toxicity score. Unit: score. Source: none; NULL on every sampled row (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.expertise_indicators IS
'AI-listed signs of expertise in the comment. Unit: none. Source: analyze-auction-comments (deleted 5741560ae). Grain: one comment. Clock: derived (as of analyzed_at).';
COMMENT ON COLUMN public.auction_comments.authenticity_score IS
'AI score of how authentic the comment reads. Unit: score (model scale). Source: analyze-auction-comments (deleted 5741560ae). Grain: one comment. Clock: derived (as of analyzed_at).';
COMMENT ON COLUMN public.auction_comments.expertise_score IS
'AI score of the expertise the comment shows. Unit: score (model scale). Source: analyze-auction-comments (deleted 5741560ae). Grain: one comment. Clock: derived (as of analyzed_at).';
COMMENT ON COLUMN public.auction_comments.influence_score IS
'AI score of the comment influence on the auction. Unit: score (model scale). Source: analyze-auction-comments (deleted 5741560ae). Uses the whole thread, so it is not point-in-time. Grain: one comment. Clock: derived (as of analyzed_at).';
COMMENT ON COLUMN public.auction_comments.key_claims IS
'AI-extracted factual claims in the comment. Unit: none. Source: analyze-auction-comments (deleted 5741560ae). Grain: one comment. Clock: derived (as of analyzed_at).';
COMMENT ON COLUMN public.auction_comments.raw_html IS
'Planned raw HTML of the comment. Unit: none. Source: none; empty on every sampled row (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.analyzed_at IS
'When analyze-auction-comments scored the comment. Unit: timestamptz (UTC). Source: analyze-auction-comments (deleted 5741560ae); 2026-01-20 .. 2026-03-06. Grain: one comment. Clock: derived (analysis run time).';
COMMENT ON COLUMN public.auction_comments.created_at IS
'When the comment row was inserted. Unit: timestamptz (UTC). Source: default now(). Earliest 2026-01: comments loaded then carry the load date, not first sight; the archive bulk load landed 2026-09-27 .. 2026-09-30. Grain: one comment. Clock: ingest.';
COMMENT ON COLUMN public.auction_comments.platform IS
'Platform of the lot: bat or cars_and_bids. Unit: none. Source: buildAuctionCommentRows writes bat; Cars and Bids extractors write cars_and_bids. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.source_url IS
'Lot page URL the comment was read from (BaT: https://bringatrailer.com/listing/<slug>/). Unit: none. Source: buildAuctionCommentRows. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.content_hash IS
'sha256 of bat|source_url|sequence_number|posted_at|author|text; with vehicle_id the idempotency key. Because it includes sequence_number, a re-read of a grown thread hashes old comments differently; extract-bat-core therefore also skips bat_comment_id values it already holds. Unit: none. Source: buildAuctionCommentRows. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.author_bat_user_id IS
'Author as FK to bat_users.id. Unit: none. Source: none; NULL on every sampled row (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.author_external_identity_id IS
'Author as FK to external_identities.id (auction_comments_author_external_identity_id_fkey). TWIN of external_identity_id: set only on rows created before 2026-03 (2026-01/02 rows always carry both, equal); no current edge function or live SQL function writes it (2026-10-06). 58% filled overall. Lane K decides which twin is canonical. Unit: none. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.external_identity_id IS
'Author as FK to external_identities.id (auction_comments_external_identity_id_fkey). TWIN of author_external_identity_id and the one current writers set: linkAuctionCommentIdentities in batAuctionRecord.ts (extract-bat-core, load_archive_comments.ts; since 2026-10-02) and extract-auction-comments. Rows of the 2026-09-27 .. 2026-10-01 archive load are about 1% filled. 75% filled overall (2026-10-06). Unit: none. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.question_categories IS
'Question taxonomy matches as JSON. Unit: none. Source: scripts/question-classify-bulk.mjs and batch-comment-discovery (regex_v1), 2026-03-27 .. 2026-04-13. Grain: one comment. Clock: derived (as of question_classified_at).';
COMMENT ON COLUMN public.auction_comments.question_primary_l1 IS
'Top-level question category of a question comment. Unit: none. Source: scripts/question-classify-bulk.mjs (regex_v1). Grain: one comment. Clock: derived (as of question_classified_at).';
COMMENT ON COLUMN public.auction_comments.question_primary_l2 IS
'Second-level question category of a question comment. Unit: none. Source: scripts/question-classify-bulk.mjs (regex_v1). Grain: one comment. Clock: derived (as of question_classified_at).';
COMMENT ON COLUMN public.auction_comments.question_classified_at IS
'When the question classifier ran on the comment. Unit: timestamptz (UTC). Source: scripts/question-classify-bulk.mjs; 2026-03-27 .. 2026-04-13. Grain: one comment. Clock: derived (classifier run time).';
COMMENT ON COLUMN public.auction_comments.question_classify_method IS
'Classifier version and result: regex_v1, regex_v1_low_conf, regex_v1_no_match. Unit: none. Source: scripts/question-classify-bulk.mjs. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.bat_author_id IS
'BaT numeric user id of the author (c.authorId in the comments JSON). A stable source key for the person, unlike the handle. Unit: none. Source: buildAuctionCommentRows; 42% filled (rows from the v4.1 builder on). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.bat_comment_id IS
'BaT numeric comment id (the comments JSON id). The source key for idempotent ingest: extract-bat-core never writes a bat_comment_id the vehicle already holds. Unit: none. Source: buildAuctionCommentRows, ingest_bat_live_events; 42% filled. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.bat_author_likes IS
'Author like total from the BaT comments JSON (c.authorLikes) as read. Unit: count. Source: buildAuctionCommentRows. Grain: one comment. Clock: derived (as of created_at; a lifetime number, not point-in-time).';
COMMENT ON COLUMN public.auction_comments.likers_count IS
'Number of users listed as liking the comment (length of c.likers). Unit: count. Source: buildAuctionCommentRows. Grain: one comment. Clock: derived (as of created_at).';
COMMENT ON COLUMN public.auction_comments.merged_from_vehicle_id IS
'Duplicate vehicle this comment was moved from when two vehicles were merged (vehicles.id, no FK). Unit: none. Source: the vehicle merge path; NULL on every sampled row (2026-10-06). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.stance_scored_at IS
'When community_stance_score and condition_polarity were scored. Unit: timestamptz (UTC). Source: BYOK rubric scoring (rubric v2 rescore migrations, 2026-06-22/23); about 1 in 200,000 rows. Grain: one comment. Clock: derived (scoring time).';
COMMENT ON COLUMN public.auction_comments.stance_model IS
'Model that scored community_stance_score and condition_polarity. Unit: none. Source: BYOK rubric scoring. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.auction_comments.extracted_claims IS
'Claims about the car extracted by the rubric scorer, as JSON. Unit: none. Source: BYOK rubric scoring (rubric v2). Grain: one comment. Clock: derived (as of stance_scored_at).';
COMMENT ON COLUMN public.auction_comments.rubric_version IS
'Version of the scoring rubric behind community_stance_score and condition_polarity (v2 decoupled the two axes). Unit: version number. Source: BYOK rubric scoring. Grain: one comment. Clock: n/a.';

COMMIT;
