-- Describe user_profile_queue: all 21 columns, none had a COMMENT ON COLUMN (0 of 21 described before, catalog count on
-- prod, 2026-10-07), and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table: 1,393,916 rows on 2026-10-07 11:53Z by exact count (the atlas estimate
-- of 1,093,281 is a stale pg_class.reltuples); the newest row is from 2026-10-07 11:39Z.
--
-- METHOD (read 2026-10-07 11:53-12:25Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon and
--   authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy,
--   information_schema and pg_description. Fill, status, platform, priority, attempts, discovered_via, error shapes (status
--   codes and body starts, URLs and numbers masked), metadata keys, URL and platform pairs and the date windows are exact
--   counts over the whole table (294 MB heap, read only, one scan per query). URL shapes, the trailing-slash twins and the
--   links to vehicles and external_identities come from a 1% block sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007),
--   12,398 rows); the link to auction_comments from a 0.2% block sample (1,138 filled values), because the 1% join
--   exceeded the 10 s timeout; a regex pass over the whole table also exceeded it. What anon and authenticated can read
--   comes from counts under SET LOCAL ROLE in read-only transactions. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 523a27019 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps, docs): the creating migration 20250131_user_profile_queue_system.sql; the live
--   bodies, read with pg_get_functiondef, of the three trigger functions queue_user_profile_from_comment,
--   queue_user_profile_from_identity and queue_user_profile_from_listing and of claim_user_profile_queue_batch (none
--   SECURITY DEFINER), and the trigger definitions on auction_comments, external_identities and bat_listings (pg_trigger);
--   the edge functions process-profile-queue (the worker) and ingest-external-profile; the reader
--   nuke_frontend/src/pages/ClaimExternalIdentity.tsx; 20260929001000 (retired the worker cron job); the prod migration
--   log supabase_migrations.schema_migrations (20260111004906 fix_queue_user_profile_from_comment_trigger and
--   20260314031423 rls_frontend_tables_read_only name the table; the second is not in the repo); cron.job (no command
--   names the table or the worker); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (1 table-level row,
--   owner queue_user_profile_from_identity, from 20261007002507_declare_table_owners_1.sql; no row is added or changed).
-- LIMITS:
--   Shapes and links come from block samples and can miss rare cases. Whether an extraction ever succeeded for a profile
--   is recorded on external_identities, not here. The table holds public site handles and profile URLs of auction-site
--   members, and 3 user ids in metadata: quoted values are platform and status codes, URL shapes with the handle masked,
--   column and function names and counts only; no handle, URL, user id or message body.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Queue for extracting user profile data from external platforms (BaT, Cars & Bids, etc.)".
--   That stays as the opening; the new comment adds the grain, the three queuing triggers, the stopped worker, the
--   duplicate URL spellings, the access and the clocks. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.user_profile_queue IS
'Queue for extracting user profile data from external platforms (BaT, Cars & Bids, etc.): one row per queued extraction of one member profile URL (grain: one queue entry; at most one pending entry per profile_url and platform, by the unique partial index idx_user_profile_queue_unique_pending, and a URL can be queued again after it completes). 1,393,916 rows on 2026-10-07 (the atlas estimate of 1,093,281 is a stale reltuples) for 1,360,247 URL and platform pairs. Filled by three AFTER triggers, all ON CONFLICT DO NOTHING against the pending index (pipeline_registry owner queue_user_profile_from_identity, do_not_write_directly true): trigger_queue_profile_from_auction_comment on auction_comments (insert with an author_username; 727,880 rows, discovered_via comment, priority 50), trigger_queue_profile_from_identity on external_identities (insert or update with a new profile_url, social platforms skipped; 666,031 rows, discovered_via trigger, priority 40) and trigger_queue_profile_from_listing on bat_listings (seller and buyer; 0 rows, because bat_listings carries a seller identity on 4 of 174,722 rows and a buyer identity on none). ingest-external-profile adds or promotes a row when a person asks to claim a profile (5 rows, discovered_via user_request, priority 90). Inflow is still live: 85,851 rows in the 7 days of 2026-10, 80,135 of them on 2026-10-06 from the identity trigger; none in 2026-05 and 2026-06. Nothing drains it: the worker process-profile-queue (claims through claim_user_profile_queue_batch, then calls extract-bat-profile-vehicles and writes the result to external_identities) last claimed a row on 2026-04-25 03:40Z, and its cron job (jobid 335, every 5 minutes, already inactive) was retired by 20260929001000. So 1,355,623 rows (97.3%) are pending with 0 attempts, 38,240 completed (2026-02-28 .. 2026-04-24, all bat), 53 stuck in processing since 2026-03 and 2026-04 (the claim function only reclaims pending rows), and 0 failed. Duplicates: BaT member URLs built from comments end in a slash and those copied from external_identities do not, so the pending index does not see them as one: in a 1% block sample 2,744 of 6,084 pending BaT comment rows (45.1%) have a pending twin without the slash. Prod differs from the creating migration 20250131_user_profile_queue_system.sql: the platform CHECK lists 21 codes, the foreign key from source_vehicle_id to vehicles and the indexes on external_identity_id and locked_at are absent. pg_stat_user_tables counts 105,727 inserts and 0 updates and deletes since its counters began (read 11:53Z). Readers: process-profile-queue (through the claim function), ingest-external-profile and the claim page nuke_frontend/src/pages/ClaimExternalIdentity.tsx, which polls one row by id. Access: RLS is on; the policy allow_authenticated_read_user_profile_queue (SELECT, USING true; from the logged migration 20260314031423 rls_frontend_tables_read_only, not in the repo) lets any signed-in account read every row (1,393,916 counted under SET LOCAL ROLE authenticated, 2026-10-07), including member handles, profile URLs and 3 user ids in metadata; anon holds SELECT but has no policy and reads 0 rows; neither role holds INSERT, UPDATE or DELETE. No write receipts. Clocks: created_at is the queue time, updated_at, last_processed_at, locked_at and completed_at are worker times; nothing records when the profile was seen on the source site.';

-- ── Identity and target ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.user_profile_queue.id IS
'Surrogate key of the queue row, uuid, gen_random_uuid() default, the PRIMARY KEY. 1,393,916 rows (2026-10-07). ingest-external-profile returns it to the claim page, which polls the row by id. Unit: none (uuid). Source: column default. Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.profile_url IS
'Profile page to extract, text NOT NULL; with platform the key of the unique partial index idx_user_profile_queue_unique_pending (one pending row per URL and platform). 1,360,247 distinct URL and platform pairs on 1,393,916 rows (2026-10-07); 33,666 pairs have 2 to 5 rows, 33,618 of them because a completed URL was queued again. Shapes (1% block sample, handle masked): BaT pages built from comments end in a slash (bringatrailer.com/member/<handle>/, built by queue_user_profile_from_comment with encode_uri_component), BaT pages copied from external_identities do not (bringatrailer.com/member/<handle>), so the index misses the pair: 2,744 of 6,084 sampled pending BaT comment rows (45.1%) have a pending twin without the slash. Others: carsandbids.com/users/<handle>, pcarmarket.com/member/<handle>/ (pcarmarket.com/author/<handle>/ when built from a comment) and hagerty.com/marketplace/profile/<id>. Public member pages of auction sites, readable by any signed-in account; none is quoted here. Unit: none (URL). Source: the queuing trigger (built from a comment username, or copied from external_identities.profile_url). Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.platform IS
'Site of the profile, text NOT NULL, default bat, CHECK in 21 codes (bat, cars_and_bids, mecum, barrettjackson, russoandsteele, pcarmarket, sbx, bonhams, rmsothebys, collecting_cars, broad_arrow, gooding, ebay_motors, facebook_marketplace, autotrader, hemmings, classic_com, craigslist, copart, iaai, hagerty). 4 occur (2026-10-07): bat 1,380,869, cars_and_bids 8,357 (all queued 2026-01-22 .. 01-23), pcarmarket 4,316, hagerty 374. Indexed with status (idx_user_profile_queue_platform). The comment trigger maps bringatrailer to bat and queues only bat, cars_and_bids and pcarmarket; the identity trigger copies external_identities.platform. Unit: none (text code). Source: the queuing trigger. Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.username IS
'Handle of the profile owner on the platform, text, filled on every row (2026-10-07): the comment author_username (or bat_username) for comment rows and external_identities.handle for identity rows (equal to the linked identity handle on every row of a 1% block sample). A public site handle, readable by any signed-in account; none is quoted here. Unit: none (text). Source: the queuing trigger. Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.external_identity_id IS
'Identity the profile belongs to: an external_identities.id, foreign key ON DELETE SET NULL (validated). Filled on 1,276,790 rows (91.6%, 2026-10-07): every identity and user_request row and 610,754 of the 727,880 comment rows (the other comments carried no identity). No sampled row points at a deleted identity. process-profile-queue writes the extracted metadata back to this identity. The index on it that the creating migration made is absent on prod. Unit: none (uuid). Source: the identity row, or the comment external_identity_id. Grain: one queue entry. Clock: n/a.';

-- ── Queue state ─────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.user_profile_queue.status IS
'Queue state, text NOT NULL, default pending, CHECK in (pending, processing, complete, failed). On 2026-10-07: pending 1,355,623 (97.3%), complete 38,240 (2.7%), processing 53, failed 0. process-profile-queue claims pending rows through claim_user_profile_queue_batch (sets processing), then sets complete, or pending again after an error until attempts reach max_attempts (then failed). No row has been claimed since 2026-04-25 03:40Z, and the worker cron job was retired on 2026-09-29, so new rows stay pending. The 53 processing rows were locked 2026-03-03 .. 2026-04-25 and are never reclaimed: the claim function picks only pending rows. Partial index idx_user_profile_queue_status_priority on pending and processing rows. Unit: none (text). Source: column default, claim_user_profile_queue_batch and process-profile-queue. Grain: one queue entry. Clock: as of updated_at.';
COMMENT ON COLUMN public.user_profile_queue.priority IS
'Claim order, integer NOT NULL, default 50, higher first (the claim function orders by priority descending, then created_at). By writer (2026-10-07): 50 on the 727,880 comment rows, 40 on the 666,031 identity rows and 90 on the 5 user_request rows; the listing trigger would write 70 for sellers and 60 for buyers but has added no row. Unit: rank (integer). Source: writer constant. Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.error_message IS
'Error of the last failed attempt, text, written by process-profile-queue and not cleared by a later success. Filled on 82 rows (2026-10-07): 72 complete, 6 processing and 4 pending; each is HTTP and a status code followed by the start of the response of extract-bat-profile-vehicles (an upstream HTML page, a gateway error, an idle timeout, a statement timeout or a function not found). Unit: none (text). Source: process-profile-queue. Grain: one queue entry. Clock: as of last_processed_at.';
COMMENT ON COLUMN public.user_profile_queue.attempts IS
'Claims so far, integer NOT NULL, default 0; claim_user_profile_queue_batch adds 1 on each claim. 0 on 1,355,619 rows, 1 on 38,220, 2 on 73 and 3 on 4 (2026-10-07). A row at max_attempts is no longer claimed. Unit: count. Source: claim_user_profile_queue_batch. Grain: one queue entry. Clock: as of last_processed_at.';
COMMENT ON COLUMN public.user_profile_queue.max_attempts IS
'Claim limit, integer NOT NULL, default 3; 3 on every row (2026-10-07). Unit: count. Source: column default. Grain: one queue entry. Clock: n/a.';

-- ── Where the profile was found ─────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.user_profile_queue.discovered_via IS
'Path that queued the row, text, no CHECK, filled on every row (2026-10-07): comment 727,880 (trigger_queue_profile_from_auction_comment, AFTER INSERT on auction_comments with an author_username), trigger 666,031 (trigger_queue_profile_from_identity, AFTER INSERT OR UPDATE on external_identities when profile_url is set and changed) and user_request 5 (ingest-external-profile inserts the row or relabels a pending one). seller and buyer, which queue_user_profile_from_listing on bat_listings writes, occur on no row. Unit: none (text). Source: the writer. Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.source_vehicle_id IS
'Vehicle of the comment that surfaced the profile (auction_comments.vehicle_id), uuid. Filled on 727,874 rows (52.2%, 2026-10-07): 727,873 comment rows and 1 user_request row. The creating migration declared a foreign key to vehicles ON DELETE SET NULL; it is absent on prod, and in a 1% block sample 260 of 6,282 filled values (4.1%) point at a vehicle that no longer exists. Unit: none (uuid). Source: queue_user_profile_from_comment. Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.source_comment_id IS
'Comment that surfaced the profile: an auction_comments.id (the creating migration also allowed bat_comments), no foreign key. Filled on 727,881 rows (52.2%, 2026-10-07): every comment row and 1 user_request row. In a 0.2% block sample 8 of 1,138 values (0.7%) point at a comment no longer in auction_comments. Unit: none (uuid). Source: queue_user_profile_from_comment. Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.source_listing_id IS
'Listing that surfaced a seller or buyer profile (queue_user_profile_from_listing writes bat_listings.id), uuid, no foreign key. NULL on all 1,393,916 rows (100%, 2026-10-07): that trigger has added no row (see discovered_via). Unit: none (uuid). Source: none so far. Grain: one queue entry. Clock: n/a.';
COMMENT ON COLUMN public.user_profile_queue.metadata IS
'Hints for the worker, a JSON object, default {}. {} on 1,393,913 rows; on 3 rows (2026-10-07) it carries notify_user_id, the account ingest-external-profile asks to notify when the extraction completes (a user id, not quoted here); process-profile-queue reads it. Unit: none (jsonb). Source: ingest-external-profile. Grain: one queue entry. Clock: n/a.';

-- ── Clocks and locks ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.user_profile_queue.created_at IS
'When the row was queued: NOT NULL, default now(). Range 2026-01-09 20:32Z .. 2026-10-07 11:39Z (read 11:53Z); by month 2026-01 857,170, 02 147,096, 03 117,187, 04 29,618, 05 and 06 none, 07 48,153, 08 12, 09 108,829, 10 (7 days) 85,851, of which 80,135 on 2026-10-06 (79,782 from the identity trigger). It follows writes to auction_comments and external_identities, not when the profile appeared on the site. Unit: timestamptz. Source: column default. Grain: one queue entry. Clock: ingest time.';
COMMENT ON COLUMN public.user_profile_queue.updated_at IS
'When the row was last changed: NOT NULL, default now(); no trigger, so only claim_user_profile_queue_batch and process-profile-queue move it (ingest-external-profile updates a pending row without setting it). Later than created_at on 38,297 rows (2026-10-07), 2026-02-28 19:49Z .. 2026-04-25 03:43Z; equal to created_at on the other 1,355,619. Unit: timestamptz. Source: the worker and the claim function. Grain: one queue entry. Clock: worker time of the last change.';
COMMENT ON COLUMN public.user_profile_queue.completed_at IS
'When process-profile-queue marked the row complete. Filled on the 38,240 complete rows (2.7%, 2026-10-07), 2026-02-28 19:49Z .. 2026-04-24 04:03Z; NULL elsewhere. Unit: timestamptz. Source: process-profile-queue. Grain: one queue entry. Clock: worker time of completion.';
COMMENT ON COLUMN public.user_profile_queue.last_processed_at IS
'When the row was last claimed, set to now() by claim_user_profile_queue_batch. Filled on 38,297 rows (2.7%, 2026-10-07), 2026-02-28 19:48Z .. 2026-04-25 03:40Z; NULL on every row never claimed. Unit: timestamptz. Source: claim_user_profile_queue_batch. Grain: one queue entry. Clock: claim time.';
COMMENT ON COLUMN public.user_profile_queue.locked_at IS
'When the current claim began. The claim function treats a lock older than its p_lock_duration_minutes (default 20) as expired, but only on pending rows. Filled on the 53 processing rows (2026-10-07), 2026-03-03 08:55Z .. 2026-04-25 03:40Z; the worker clears it on completion or error. The index on it that the creating migration made is absent on prod. Unit: timestamptz. Source: claim_user_profile_queue_batch. Grain: one queue entry. Clock: claim time.';
COMMENT ON COLUMN public.user_profile_queue.locked_by IS
'Name of the claimer: process-profile-queue on the 53 processing rows (2026-10-07), NULL elsewhere. Unit: none (text). Source: claim_user_profile_queue_batch constant. Grain: one queue entry. Clock: n/a.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.user_profile_queue'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'user_profile_queue: every column has a comment';
  ELSE
    RAISE NOTICE 'user_profile_queue columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
