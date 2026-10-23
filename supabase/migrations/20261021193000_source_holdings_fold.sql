-- browse_source_read: what one source holds, by make, model and listing (/browse?source=<slug>), and the fold under it.
-- 2026-10-20, revised three times the same day after review.
--
-- WHY. The Sources board links every row to /browse?source=<slug>; /browse ignored the source and showed the
-- all-sources, confirmed-sales-only make grid, which holds nothing from a marketplace. Owner, 2026-10-20: "this page is
-- just terrible". The page needs one read per source: how much it holds (with the population and the day), which makes
-- and models, and the listings.
--
-- MEASURED 2026-10-20 (prod, read-only, 05:30-08:15Z):
--   * vehicle_events: 807,161 rows under 108 source keys once spellings fold (two auction houses are each spelled with and
--     without a hyphen). One marketplace held 19,710 rows at 05:50Z and 20,098 at 06:40Z; 19,588 of the first
--     sat on a public vehicle with a make, a model and a browsable type, on 18,351 vehicles (some are listed twice).
--     Its 3,733 active rows are listings the source marked active when it read them, not re-checked since; all 16,365
--     ended and sold rows are archived item pages (web-archive captures that ended 2005-2013) that landed in the last 10
--     days: created_at is the landing clock, not the listing's. The vehicles of those captures were being unpublished by
--     another process that morning, so this page's size moves: 7,896 of the marketplace's 20,635 events sat on a public
--     vehicle at 08:00Z, 1,944 of 20,781 at 09:28Z (review read) and 2,015 of 20,855 at 10:12Z (a public vehicle with a
--     make and a model, not deleted, not a non-vehicle listing, a car-like type; read-only prod). The page's size is whatever
--     the fold counted the day it ran, never a figure quoted here.
--   * The listings read as a live join (the source's events joined to vehicles by lower(make), lower(model)) took
--     16.0 s cold for that marketplace's Ford Mustang: the planner estimated 793 Mustang vehicles, there are 13,254
--     (every source's), 21,465 buffer reads. The anon statement_timeout is 15 s. So the page reads a fold. The 60 rows
--     it shows, fetched by primary key (event and vehicle), took 1.1 s cold (145 buffer reads).
--   * 40,041 events say ended, unsold, reserve_not_met, cancelled or bid-goes-on and still carry a final price (32,181)
--     or a close time: the hammer bid or the close clock, not a sale. 102,086 events say sold and carry no final price.
--     A rule that reads a final price or a close time as "sold" first would print those 40,041 as sold, so the status
--     the source wrote decides, and a final price or close time decides only where the status says nothing (40,640
--     events say nothing; 82 of them carry one).
--   * Re-read 2026-10-20 07:05-07:15Z, that marketplace, all 20,537 of its events: 1,227 say active, 106 of them with a
--     metadata listing_ends_at (all ahead) and listing_posted_at; 15,395 say ended and 3,915 sold, 16,681 of those with
--     metadata.archive_url (every one an http(s) web.archive.org capture; every source_url is the live item address);
--     started_at is on none, so a listing date exists only on those 106. The newest 20,000 events of the auction house
--     that writes bid-goes-on: 5,468 bid-goes-on (a result: the car did not sell), 794 listed (7 dated ahead, 291 dated
--     in the past, 496 undated), 118 upcoming (all dated ahead). A second house, all 36,374 of its events: 4,568
--     upcoming, 4,518 dated in the past and 50 ahead. So a result word, and a scheduled word with a past or missing
--     date, are not "live".
--   * Fold cost, local PG17.9, synthetic rows of the shape prod has (1.29M vehicles, 812k events; platform names and counts
--     from prod's event list; date keys in the metadata of about a quarter of the rows, as in a 1% page sample of prod's
--     events read at 09:2xZ in review). This file: 753,320 episodes, 123,474 holdings rows, mv_source_episodes 194 MB,
--     mv_source_holdings 76 MB; first fill 17.5 and 20.6 s, a concurrent refresh 17.4 and 17.8 s (two runs each,
--     10:24-10:27Z, machine load average about 5). The previous definition on a copy of the same rows: 27.6 s and 19.4 s.
--     A third run of the final file at 10:42Z, under a load average of 73 from other work, took 125 s and 116 s: on a
--     shared machine these figures move by a factor of six. (An earlier version of this file measured 8.1 s and 10.8 s on
--     rows without those date keys: not comparable.)
--     Production's duration is not measured here. A read-only calibration in review (prod, 09:2xZ): the fold's plan is a
--     nested loop that probes vehicles_pkey, 0.25 to 0.61 ms a probe (8,339 sampled events joined in 5.08 s; one
--     platform's 20,756 events in 5.17 s), so about 3 to 8 min for the join and an estimated 5 to 10 min for the first
--     fill, against the cron's cap of 20 min (treemap-refresh, the same kind of job, took 221 to 918 s over 7 runs). A
--     fill that reaches the cap fails and leaves the views empty, and the reader says not_folded until the next 10:35 UTC.
--     On the scratch rows a 100-row page of the largest cohort (18,375 episodes) took 76 ms warm and of the marketplace's
--     largest model (1,328 episodes) 37 ms, with the photo gate stubbed to hold a photo row for 70% of the marketplace's
--     vehicles. Until a fold lands, the reader says not_folded.
--   * Real rows, read-only from prod 07:50-08:10Z into a scratch PG17: 100,371 events of 11 platform spellings (10
--     sources) on 82,601 vehicles (the marketplace in full, the block house a 12% block sample, the timed auction its
--     2,780 active events, samples or all of seven more) fold to 68,299 episodes. A recomputation of status, end clock and sort clock from the
--     raw rows, written apart from this file, differs on 0 of them; the fold with 0 and with 2 parallel workers is the
--     same rows. Words to status: bid-goes-on 7,276 to ended (all); active 5,670 to 2,503 active, 1,325 ended (the end
--     had passed), 1,842 unknown (no end clock, idle); upcoming 1,541 to 368 upcoming, 1,173 ended; listed 513 to 503
--     ended, 6 unknown, 4 upcoming. The block-house sample reads Live now 0 (the reviewed version: every bid-goes-on and
--     listed lot), upcoming 186 of 27,069.
--   * Bids and price labels, that marketplace, read 2026-10-20 07:09-07:20Z over all 20,537 of its events: 1,594 ended
--     auctions carry bid_count 0 in the column while metadata.bid_count says 1-88 (where both exist they agree on every
--     sold row), and 2,140 ended rows carry the source's own label "Starting bid" in metadata.end_state.price_label. So a
--     listing row shows the column's bid count, else the capture's own, and passes a price label only when it is
--     "Starting bid", so that an ended card never reads "Current bid".
--
-- REVIEW of the version before this one (prod reads 2026-10-20 06:50-07:00Z), and what this version does about each:
--   * Registry gate. Events on public vehicles come from platforms no registry row covers: 'unknown' 1,964 events, user and
--     owner submissions about 610, deal-jacket OCR 94 (19 sold, with prices), court-record and government-document
--     platforms 17, telegram 2, and 9 owner_private registry sources that hold no event yet. The reviewed version folded all
--     of them and served them to anon with their listing url and sold price. Now an event enters the fold only when its
--     source key belongs to a market-level registry row whose species is a timed or block auction, a dealer, classifieds,
--     an auth-walled marketplace or an aggregator (browse_source_keys()); the reader asks the registry again at every call,
--     so a source demoted after the fold is gone at once. Everything else answers unknown_source and names nothing.
--   * Live is live. The block house's 'bid-goes-on' is 64,958 events and none has an end ahead (44,204 past by sale_ends_on,
--     2,858 with only an auction date past, 17,896 undated); 'listed' 5,042 (4,979 past); only 'upcoming' (1,995) is ahead.
--     A timed auction's 'active' rows not touched for 30-365 days: 1,460; one classifieds site's: 1,736; the marketplace's
--     'active' went 3,784 to 1,205 within 15 minutes (06:45Z to 06:59Z) as its sweep closed listings. So: bid-goes-on is ended (a result,
--     never a sale); active, live and open count only while the row's own end clock is ahead, are ended once it is past,
--     and with no end clock are unknown when the row was not touched for 14 days; listed and upcoming (a lot catalogued for
--     a sale) need a date ahead, and a date that has passed is ended; 'upcoming' is its own class, not Live; the rows shown
--     take their status from the live event, so a listing that closed since the fold reads Ended at once.
--   * One source clock. 204,093 of the block house's 241,471 events have neither ended_at nor started_at, 134,795 of those
--     carry the real date in metadata.sale_ends_on; archived marketplace pages carried the landing day as their listing day.
--     The clock is read over ended_at, started_at and the metadata keys listing_posted_at, listing_ends_at, sale_ends_on,
--     sale_starts_on, auction_date, each behind a date-shaped test and pg_input_is_valid, so a string such as
--     '2026-13-45 99:99' is no clock. The production helper safe_to_timestamptz does the same with an exception block,
--     which a parallel worker cannot run: behind a parallel-safe wrapper it returned NULL for 992 of 11,214 real rows
--     (2026-10-20, scratch PG17, max_parallel_workers_per_gather 2), so it is not used. listed_at is never the landing day;
--     the landing day is recorded_at (also first_seen_at). A date alone ends with that day; the sort clock of an episode
--     the source gave no date is NULL and the episode sorts last in newest.
--   * One key. The Sources board folds five short alias spellings to their market's key and four www.<name>.com spellings
--     to <name> (the alias rows in browse_source_key_map() are mapping data, the one place this file spells a source), and
--     a capture channel to its market (observation_sources.market_slug); the reviewed version did not, so a board row of
--     85 lots opened an empty page and the events of two alias spellings (25 and 38) and of the capture channels (460)
--     were missing from their markets. browse_source_key_map() is that map: on
--     2026-10-20 it equals the key_map of market_sources_read() row for row (234 mappings, plus five identity rows of the
--     seller cohorts, which map to themselves anyway), and no spelling maps to two keys. The board keeps its own copy
--     of the list; pointing market_sources_read() at browse_source_key_map() is the board's follow-up, not done here. A
--     registered source with no events (46 of 80 board rows match none of the 108 event keys: five cohorts of one venue's
--     lots grouped by seller, 255,786 lots, and dealers whose lots carry no event) returns the board's own count in
--     holdings.board.
--   * Prices. The median asked blended live asks with ended and archived prices (priced rows of that marketplace: 1,199
--     active, median $18,000; 14,825 ended, $17,000; 3,915 sold, $9,000). The median is now per status: active, ended and
--     sold, each with its n and the floor of 5. shown_n and shown_median remain, for readers built to the first contract,
--     and mean the active ones only.
--
-- REVIEW of the integrated build (three reviewers, prod reads 2026-10-20 09:20-10:15Z), and what this version does about each:
--   * Version. 20261021140000 was taken on main by another migration (merged 01:53 PT), and its successor 20261021150000 by a
--     second one (merged 03:30 PT, while this file was under review). This file is 20261021193000: above main's newest
--     (20261021180000) and held by no worktree when it was renamed, 03:50 PT. The contract and
--     scripts/ci/migration-versions-unique.sh name it; run that script again just before the push.
--   * Places. A row's location fell back to the source's own metadata text, verbatim. The marketplace's strings, read 10:13Z:
--     8,555, of which 54 are shaped like a phone number and 2 hold an @. Now the text is sent only when it reads as a place:
--     2 to 60 characters, no digit but a trailing five-digit ZIP, none of @ ! # / \ or a control character (8,304 of the 8,555,
--     97.1%, pass), else null. The vehicle's own place still wins and is sent as it is: it fails the same test on 0 of the 423
--     located vehicles of the marketplace's page (10:53Z) and on 0 of the newest 300 events' vehicles of each of 14 platforms.
--     The text the source wrote exists on three of those 14 platforms: 300 of 300 and 300 of 300 pass, and 292 of 296 on the
--     third (the 4 refused end in a foreign postcode, a refusal that costs a place name, not a leak).
--   * Photos. The card photo came from vehicles.primary_image_url, which the photo gate does not see (storage addresses sit
--     there too: 15 of the 66 public vehicles of one platform's newest events, read 10:09Z). It now comes from vehicle_card_images,
--     the gated read the other card surfaces use: its thumbnail, else medium, else full size, and none when the gate shows
--     none. with_image still counts the photo addresses on the record (an http(s) address or a path; "jpg" is none), because a
--     gate probe per vehicle in the fold would read vehicle_images (59M rows, 71 GB) for every vehicle. Read at 10:09Z over
--     960 public vehicles of 6 platforms (newest events), a vehicle had an address on its record exactly when the gate showed
--     it a card photo (0 differ); if the two part, the page shows fewer photos than it counts.
--   * Live. Of the marketplace's 1,515 rows that say active at 10:12Z, 1,121 have no end clock and were last written between
--     2026-10-15 07:54Z and 15:18Z (none idle 14 days yet, so the 14-day rule still reads them as active). Each row now
--     carries checked_at, the event row's last write, so a page can say "live when last checked <day>", not "live now".
--   * Addresses. listing_url is sent only when it is a web address without spaces, as archive_url already was (app
--     pseudo-addresses are about 1.5% of a 25% page sample of prod's events, review read).
--   * Keys. make_key, model_key and the spellings shown are trimmed, as the reader trims what it is asked for (a model stored
--     with a trailing space was a row nobody could open: 3 of 35,553 public vehicles in a 4% page sample, review read).
--   * Name. The page names a source as the Sources board does: the registry's display name without its trailing
--     parenthesis, else the organization's name (the organization is named differently on 5 of the board's 80 rows, read 10:24Z).
--   * Reader. It declares a record, not the view's row type (a row type opens the view when the function compiles, which waits
--     for the first fill's lock: on 1.30M scratch vehicles one call took 2,957 ms of a 25.0 s first fill; with the record the
--     slowest of 60 calls took 51 ms in a 21.3 s fill), and no longer sets a statement_timeout of its own (a function-level
--     setting does not re-arm the running statement); the anon role's 15 s is the cap.
--   * Contract. Bid counts as JSON numbers (prod writes numbers), the reader's own visibility tests, the pinned search_path
--     and an edge source (keys, years, photos, places, addresses, bids) joined the contract; each was shown to fail on a break.
--
-- WHAT.
--   0. Helpers, all in this file, none callable by anon: browse_source_key_map() (the one source key), browse_source_keys()
--      (the keys that may be browsed), browse_source_when() / browse_source_clocks() (the one source clock),
--      browse_source_status() (the one status rule, used by the fold and by the rows shown) and browse_source_sold_price().
--   1. mv_source_episodes: one row per episode (a vehicle_events row of a browsable source on a public vehicle that has a
--      make and a model, is not a non_vehicle_item and is a CAR, TRUCK, SUV, VAN or MINIVAN or untyped;
--      search_vehicles_browse's test). Columns are the keys the page sorts and filters by and the numbers it counts: source
--      key (nslug), the platform spellings, make_key and model_key (trimmed and lower case, so FORD and Ford are one make),
--      year, status, the shown and sold price, whether the vehicle's record carries a photo address (has_image: an http(s)
--      address or a path, before the photo gate), whether the row was read from a saved copy of the page (has_archive:
--      metadata.archive_url is an http or https address), and the clocks. Stored in the order the listing read walks.
--      status, by browse_source_status(): the source's own words decide.
--        sold = 'sold'.  ended = ended, unsold, reserve_not_met, withdrawn, expired, closed, cancelled, bid-goes-on.
--        active, live, open: active while the end clock (ended_at, else metadata listing_ends_at, sale_ends_on or
--        auction_date, a date alone ending at the close of that day) is ahead; ended once it is past; with no end clock,
--        active if the row was touched in the last 14 days, else unknown (the rows shown carry that touch as checked_at).
--        listed, upcoming (a lot catalogued for a sale): ended once the end clock has passed; upcoming while the start clock
--        (started_at, listing_posted_at, sale_starts_on) is ahead, or the word is upcoming and there is no start clock;
--        otherwise active while an end clock is ahead; with no date ahead at all, unknown.
--        Any other word (unknown, pending, completed, none) reads a final price or a sold_at as sold and is otherwise unknown.
--      shown_price = current_price when > 0 (the ask, buy-it-now or current/high bid as the source showed it).
--      sold_price, on sold episodes only: final_price when > 0, else the vehicle row's sale_price when the row says sold
--      and the vehicle's own source has the same key (the basis vehicle_sale_basis gives the market readers).
--      happened_at = the end clock, else the start clock; NULL when the source gave neither, and then the episode sorts
--      last in newest, by when it landed (created_at).
--   2. mv_source_holdings: the episodes counted at three levels with ROLLUP: the source (level 0), its makes (1), its
--      models (2). Keys are trimmed and lower case, so a make spelled two ways is one row, shown as its most common trimmed
--      spelling. Counts: episodes, distinct vehicles, by status (active, upcoming, sold, ended, unknown), vehicles with a
--      photo address on the record (with_image), archived (episodes read from a saved copy of the page); the shown price of active episodes, of ended episodes and
--      the sold price of sold episodes, each with its n and a median that is NULL under 5 (the median floor), whole
--      dollars; year range (1885 to two years ahead; a year outside it is a listing but sets no range); dated_min and dated_max (the earliest and latest listing clock, end else start, among the
--      episodes that carry one: the source's own dates, never the landing day); first and last landing; the fold's clock.
--      Built from mv_source_episodes, so a count and the rows it counts always agree.
--   3. source_holdings_refresh(): refreshes the two in that order inside one transaction, CONCURRENTLY once populated, else
--      plainly. A fold that lands no episodes while vehicle_events holds rows fails (rows landed, not exit 0, is success)
--      and leaves the last good fold in place. service_role only. Cron source-holdings-refresh, 10:35 UTC daily
--      (03:35 Pacific), after refresh-source-target-landed (10:27, 300 s cap) and before the Sources board's
--      market-source-days (10:47). Not 09:45: treemap-refresh (09:10) took up to 918 s in its 6 runs of 2026-10-14 to 19
--      (prod cron.job_run_details, read 2026-10-20) and map-facts-nightly (09:20) has a 25 minute cap, so 09:45 could
--      overlap both. The views start WITH NO DATA: the deploy role's statement_timeout is 10 s, so the first fill is the
--      cron's or an operator's refresh, and until then the reader says status not_folded.
--   4. browse_source_read(): one jsonb, anon-callable. Levels: makes (no make), models (a make), listings (a make and a
--      model). The slug is read through browse_source_key_map(), so a capture channel or a spelling is its market. Source
--      identity from the market's own observation_sources row and its organization, else the Sources board's latest day;
--      the registry is asked at every call: a slug that is not a browsable source is unknown_source, whatever the fold
--      holds. The board's own count for the source (landed lots, population, day) is returned as holdings.board, so a page
--      never says "nothing recorded" beside a board count. A source only the Sources board knows (a venue the registry
--      lacks, or a cohort of one venue's lots, species private_seller) is known by name and board count and holds no rows.
--      Listings page the episodes of one make and model, ordered by newest (the source's own clock; a future end counts as
--      now; no clock sorts last), price or year, and join the live vehicle and event row for the 1-100 rows shown (primary
--      keys): the vehicle must still be public, not deleted and not a non-vehicle listing (the reader tests the whole visibility
--      itself, whatever the fold held), and the row's status, prices, listed and end clocks are derived from the live event by
--      the fold's own rules. total is the fold's count, and p_status filters the fold and then the live status.
--      A listing row keeps its clocks apart. listed_at is the source's own listing date (started_at, else
--      metadata.listing_posted_at, else sale_starts_on) and null when the source gave none (a guess is not a date). ends_at
--      is its end. recorded_at (also sent as first_seen_at) is when the ledger first recorded the row (created_at); it is
--      never a listing date. checked_at is the event row's last write (updated_at): for a listing alive by the source's word
--      with no end clock it is the only evidence that the listing was still alive, so a page says "when last checked", not
--      "now". archive_url is the saved copy of the page the row was read from (metadata.archive_url, http or https only),
--      else null; listing_url is the source's own address (source_url) when it is a web address without spaces, else null.
--      location is the vehicle's own, else the source's text only when it reads as a place (2 to 60 characters, no digit but a
--      trailing five-digit ZIP, none of @ ! # / \ or a control character), else null: a phone number, an e-mail address or a
--      street address is never sent. image_url is the card photo read through the photo gate (vehicle_card_images: thumbnail,
--      else medium, else full size), null when the gate shows none; never vehicles.primary_image_url. source.name is the
--      registry's display name without its trailing parenthesis (the name the Sources board shows), else the organization's.
--      landed_24h and last_landed are live from vehicle_events (events index): every row the source landed, public or not.
--      Extra to the build contract (additive): sold_n beside every sold_median; active_n and ended_n with their medians;
--      the upcoming count; an optional p_status filter on the listings level (active, upcoming, sold, ended, unknown);
--      scope.status; event_id (the vehicle_events row the listing is, so a page keys its rows exactly), recorded_at,
--      first_seen_at, checked_at and archive_url on every listing row; price_label on every listing row
--      (the source's own "Starting bid", else null) and bids that fall back to the capture's own count when the column
--      says 0 or nothing; holdings.board; holdings.archived (listings read from a saved copy of the page), dated_min and
--      dated_max (the earliest and latest listing clock among the source's listings; null when none carries a date).
-- Contract: supabase/sql/test_browse_source_read_contract.sql. Replayable: every statement is idempotent, so a replay
-- never changes a view that exists; to change a definition, a later migration builds the new view beside the old one and
-- moves the reader over, never dropping a live view to edit it.
SET statement_timeout = '8s';
SET lock_timeout = '5s';
BEGIN;

-- 0. Helpers ----------------------------------------------------------------------------------------------------------
-- The one source key. Every platform spelling and every registry slug is reduced to lower-case letters and digits, and
-- then to its market's key: a registry row with a market_slug is a capture channel of that market, and the board's own
-- aliases join the spellings the registry does not carry. Same mapping as the key_map of market_sources_read().
CREATE OR REPLACE FUNCTION public.browse_source_key_map()
RETURNS TABLE (raw_key text, canon_key text)
LANGUAGE sql
STABLE
PARALLEL SAFE
ROWS 250
SET search_path = public, pg_temp
AS $fn$
  SELECT DISTINCT ON (u.raw_key) u.raw_key, u.canon_key
  FROM (
    SELECT 1 AS pri,
           regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS raw_key,
           regexp_replace(lower(o.market_slug), '[^a-z0-9]', '', 'g') AS canon_key
    FROM public.observation_sources o
    WHERE o.slug IS NOT NULL AND o.market_slug IS NOT NULL
    UNION ALL
    -- The board's own alias spellings: mapping data, spelled as the board spells them.
    SELECT 2, a.raw_key, a.canon_key
    FROM (VALUES ('classiccars', 'classiccarscom'),
                 ('bringatrailer', 'bat'),
                 ('hagerty', 'hagertymarketplace'),
                 ('sbx', 'sbxcars'),
                 ('ebay', 'ebaymotors'),
                 ('wwwoldcaronlinecom', 'oldcaronline'),
                 ('wwwvanguardmotorsalescom', 'vanguardmotorsales'),
                 ('wwwgatewayclassiccarscom', 'gatewayclassiccars'),
                 ('wwwvelocityrestorationscom', 'velocityrestorations')) a(raw_key, canon_key)
    UNION ALL
    SELECT 3,
           regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'),
           regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g')
    FROM public.observation_sources o
    WHERE o.slug IS NOT NULL AND o.market_slug IS NULL
  ) u
  WHERE u.raw_key <> '' AND u.canon_key <> ''
  ORDER BY u.raw_key, u.pri, u.canon_key
$fn$;

-- The source keys that may be browsed: a market-level registry row (not a capture channel) whose species is a timed or
-- block auction, a dealer, classifieds, an auth-walled marketplace or an aggregator. No species, owner_private,
-- private_seller and media_forum_video are not browsable: their rows are not a market's listings, or are the owner's.
-- The fold and the reader both ask this, so what is folded and what may be read cannot differ.
CREATE OR REPLACE FUNCTION public.browse_source_keys()
RETURNS TABLE (nslug text)
LANGUAGE sql
STABLE
PARALLEL SAFE
ROWS 120
SET search_path = public, pg_temp
AS $fn$
  SELECT DISTINCT regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g')
  FROM public.observation_sources o
  WHERE o.slug IS NOT NULL
    AND o.market_slug IS NULL
    AND o.species::text IN ('timed_auction', 'block_house', 'dealer', 'classifieds', 'auth_walled_marketplace', 'aggregator')
    AND regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') <> ''
$fn$;

-- One clock from a metadata string. Only a date-shaped string that is a timestamp is read (pg_input_is_valid, then a plain
-- cast: NULL on '2026-13-45 99:99', and no exception block, so no subtransaction and the fold may run in parallel workers;
-- the production helper safe_to_timestamptz is an exception block, which a parallel worker cannot run: through a parallel-
-- safe wrapper it returned NULL for 992 of 11,214 real rows on 2026-10-20), in UTC whatever the session says, and only
-- between 1990 and 2100. A date alone, read as the end of a listing, ends with that day. NULL in, NULL out.
CREATE OR REPLACE FUNCTION public.browse_source_when(p text, p_end boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $fn$
  SELECT CASE WHEN x.t >= timestamptz '1990-01-01 00:00:00+00' AND x.t < timestamptz '2100-01-01 00:00:00+00'
              THEN CASE WHEN p_end AND btrim(p) ~ '^\d{4}-\d{2}-\d{2}$' THEN x.t + interval '1 day' - interval '1 second'
                        ELSE x.t END
         END
  FROM (SELECT CASE WHEN btrim(p) ~ '^\d{4}-\d{2}-\d{2}' AND pg_input_is_valid(btrim(p), 'timestamptz')
                    THEN btrim(p)::timestamptz END AS t) x
$fn$;

-- One source clock per episode: listed_at (started_at, else the posted date, else the sale start), ends_at (ended_at, else
-- the listing end, else the sale end, else the auction day) and happened_at (the end, else the start). NULL when the source
-- gave no date: never the day Nuke recorded it (that is created_at).
CREATE OR REPLACE FUNCTION public.browse_source_clocks(
  p_started timestamptz, p_ended timestamptz, p_meta jsonb,
  OUT listed_at timestamptz, OUT ends_at timestamptz, OUT happened_at timestamptz)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
  SELECT x.l, x.e, coalesce(x.e, x.l)
  FROM (SELECT coalesce(p_started,
                        public.browse_source_when(p_meta ->> 'listing_posted_at'),
                        public.browse_source_when(p_meta ->> 'sale_starts_on')) AS l,
               coalesce(p_ended,
                        public.browse_source_when(p_meta ->> 'listing_ends_at', true),
                        public.browse_source_when(p_meta ->> 'sale_ends_on', true),
                        public.browse_source_when(p_meta ->> 'auction_date', true)) AS e) x
$fn$;

-- The one status rule: the fold counts with it and the page shows it for the rows it shows (with the live event's
-- columns and the live clock). sold, active, upcoming, ended or unknown; see WHAT, 1. A word that says a lot is alive
-- (active, live, open) is believed while the source's end clock is ahead; a scheduled word (listed, upcoming: a lot
-- catalogued for a sale) needs a date ahead; once the end has passed either is ended, a result we may not have.
CREATE OR REPLACE FUNCTION public.browse_source_status(
  p_word text, p_final numeric, p_sold_at timestamptz, p_starts_at timestamptz, p_ends_at timestamptz,
  p_updated_at timestamptz, p_now timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
           WHEN w.word = 'sold' THEN 'sold'
           WHEN w.word IN ('ended', 'unsold', 'reserve_not_met', 'withdrawn', 'expired', 'closed', 'cancelled', 'bid-goes-on')
             THEN 'ended'
           WHEN w.word IN ('active', 'live', 'open') THEN
             CASE WHEN p_ends_at IS NOT NULL THEN (CASE WHEN p_ends_at > p_now THEN 'active' ELSE 'ended' END)
                  WHEN coalesce(p_updated_at > p_now - interval '14 days', false) THEN 'active'
                  ELSE 'unknown'
             END
           WHEN w.word IN ('listed', 'upcoming') THEN
             CASE WHEN p_ends_at IS NOT NULL AND p_ends_at <= p_now THEN 'ended'
                  WHEN p_starts_at > p_now THEN 'upcoming'
                  WHEN p_ends_at IS NULL THEN 'unknown'
                  WHEN w.word = 'upcoming' AND p_starts_at IS NULL THEN 'upcoming'
                  ELSE 'active'
             END
           WHEN p_final > 0 OR p_sold_at IS NOT NULL THEN 'sold'
           ELSE 'unknown'
         END
  FROM (SELECT lower(btrim(coalesce(p_word, ''))) AS word) w
$fn$;

-- What a sold episode sold for: the event's final price, else the vehicle row's own sale price when the row says sold and
-- the vehicle's own source is this source. NULL on any other status.
CREATE OR REPLACE FUNCTION public.browse_source_sold_price(
  p_status text, p_final numeric, p_vehicle_sale_status text, p_vehicle_sale_price integer, p_vehicle_is_this_source boolean)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE WHEN p_status = 'sold' THEN
           coalesce(CASE WHEN p_final > 0 THEN p_final END,
                    CASE WHEN p_vehicle_sale_status = 'sold' AND p_vehicle_sale_price > 0
                              AND coalesce(p_vehicle_is_this_source, false)
                         THEN p_vehicle_sale_price::numeric END)
         END
$fn$;

REVOKE ALL ON FUNCTION public.browse_source_key_map(), public.browse_source_keys(), public.browse_source_when(text, boolean),
  public.browse_source_clocks(timestamptz, timestamptz, jsonb),
  public.browse_source_status(text, numeric, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz),
  public.browse_source_sold_price(text, numeric, text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.browse_source_key_map(), public.browse_source_keys(), public.browse_source_when(text, boolean),
  public.browse_source_clocks(timestamptz, timestamptz, jsonb),
  public.browse_source_status(text, numeric, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz),
  public.browse_source_sold_price(text, numeric, text, integer, boolean) TO service_role;

COMMENT ON FUNCTION public.browse_source_key_map() IS
  'raw_key -> canon_key for every source spelling: lower case, letters and digits only, then the market key (a registry row''s market_slug, else one of the board''s alias spellings, which are mapping data). One canon_key per raw_key. The same mapping as the key_map of market_sources_read() on 2026-10-20. Used by the browse_source fold and reader. Not for anon: it lists the whole registry. 2026-10-20.';
COMMENT ON FUNCTION public.browse_source_keys() IS
  'The source keys that may be browsed: market-level observation_sources rows whose species is timed_auction, block_house, dealer, classifieds, auth_walled_marketplace or aggregator. The fold and browse_source_read() both ask it. 2026-10-20.';
COMMENT ON FUNCTION public.browse_source_when(text, boolean) IS
  'A date-shaped string that is a timestamp, read in UTC (pg_input_is_valid, then a plain cast: no exception block, so parallel safe), between 1990 and 2100; NULL on anything else. With p_end a date alone ends with that day. 2026-10-20.';
COMMENT ON FUNCTION public.browse_source_clocks(timestamptz, timestamptz, jsonb) IS
  '(listed_at, ends_at, happened_at) of one vehicle_events row: started_at, else metadata listing_posted_at, else sale_starts_on; ended_at, else listing_ends_at, else sale_ends_on, else auction_date; happened_at = ends_at, else listed_at. NULL when the source gave no date; never the landing day. 2026-10-20.';
COMMENT ON FUNCTION public.browse_source_status(text, numeric, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) IS
  'sold | active | upcoming | ended | unknown from the source''s event_status, final price, sold_at, start clock, end clock, last update and a clock. sold = sold; ended = ended, unsold, reserve_not_met, withdrawn, expired, closed, cancelled, bid-goes-on (a result, never a sale). active, live, open: active while the end clock is ahead, ended once it has passed, and with no end clock active if the row was updated in the last 14 days, else unknown. listed, upcoming (a lot catalogued for a sale): ended once the end clock has passed; upcoming while the start clock is ahead (the word upcoming with no start clock counts as ahead); otherwise active while an end clock is ahead; with no date ahead at all, unknown. Any other word (unknown, pending, completed, none) is sold when a final price or sold_at exists, else unknown. 2026-10-20.';
COMMENT ON FUNCTION public.browse_source_sold_price(text, numeric, text, integer, boolean) IS
  'The sold price of a sold episode: final_price when > 0, else the vehicle''s sale_price when it is sold and its own source is this source; NULL otherwise. 2026-10-20.';

-- 1. The episodes -----------------------------------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_source_episodes AS
SELECT e.id AS event_id,
       e.vehicle_id,
       k.nslug,
       e.source_platform AS platform,
       lower(btrim(v.make)) AS make_key,
       lower(btrim(v.model)) AS model_key,
       btrim(v.make) AS make,
       btrim(v.model) AS model,
       v.year,
       s.status,
       e.event_status AS status_raw,
       CASE WHEN e.current_price > 0 THEN e.current_price END AS shown_price,
       public.browse_source_sold_price(s.status, e.final_price, v.sale_status, v.sale_price,
                                       coalesce(vk.canon_key, vr.raw_key) = k.nslug) AS sold_price,
       coalesce(v.primary_image_url ~* '^(https?://|/)', false) AS has_image,
       (e.metadata ->> 'archive_url') ~* '^https?://\S+$' AS has_archive,
       e.created_at,
       c.ends_at,
       c.happened_at
FROM public.vehicle_events e
JOIN public.vehicles v ON v.id = e.vehicle_id
CROSS JOIN LATERAL (
  SELECT regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') AS raw_key
) r
LEFT JOIN public.browse_source_key_map() km ON km.raw_key = r.raw_key
CROSS JOIN LATERAL (SELECT coalesce(km.canon_key, r.raw_key) AS nslug) k
JOIN public.browse_source_keys() b ON b.nslug = k.nslug
CROSS JOIN LATERAL (
  SELECT regexp_replace(lower(coalesce(v.source, '')), '[^a-z0-9]', '', 'g') AS raw_key
) vr
LEFT JOIN public.browse_source_key_map() vk ON vk.raw_key = vr.raw_key
CROSS JOIN LATERAL public.browse_source_clocks(e.started_at, e.ended_at, e.metadata) c
CROSS JOIN LATERAL (
  SELECT public.browse_source_status(e.event_status, e.final_price, e.sold_at, c.listed_at, c.ends_at, e.updated_at, now()) AS status
) s
WHERE k.nslug <> ''
  AND v.is_public IS TRUE
  AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  AND v.make IS NOT NULL AND btrim(v.make) <> ''
  AND v.model IS NOT NULL AND btrim(v.model) <> ''
  AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN ('CAR', 'TRUCK', 'SUV', 'VAN', 'MINIVAN'))
ORDER BY k.nslug, lower(btrim(v.make)), lower(btrim(v.model)), c.happened_at DESC NULLS LAST, e.id
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_source_episodes_event ON public.mv_source_episodes (event_id);
CREATE INDEX IF NOT EXISTS mv_source_episodes_cohort
  ON public.mv_source_episodes (nslug, make_key, model_key, happened_at DESC NULLS LAST, event_id);

-- 2. The holdings -----------------------------------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_source_holdings AS
SELECT x.nslug,
       (CASE GROUPING(x.make_key, x.model_key) WHEN 3 THEN 0 WHEN 1 THEN 1 ELSE 2 END)::smallint AS level,
       coalesce(x.make_key, '') AS make_key,
       coalesce(x.model_key, '') AS model_key,
       CASE WHEN GROUPING(x.make_key) = 0 THEN mode() WITHIN GROUP (ORDER BY x.make) END AS make,
       CASE WHEN GROUPING(x.model_key) = 0 THEN mode() WITHIN GROUP (ORDER BY x.model) END AS model,
       array_agg(DISTINCT x.platform ORDER BY x.platform) AS source_slugs,
       count(*) AS episodes,
       count(DISTINCT x.vehicle_id) AS vehicles,
       count(*) FILTER (WHERE x.status = 'active') AS active,
       count(*) FILTER (WHERE x.status = 'upcoming') AS upcoming,
       count(*) FILTER (WHERE x.status = 'sold') AS sold,
       count(*) FILTER (WHERE x.status = 'ended') AS ended,
       count(*) FILTER (WHERE x.status = 'unknown') AS unknown,
       count(DISTINCT x.vehicle_id) FILTER (WHERE x.has_image) AS with_image,
       count(*) FILTER (WHERE x.has_archive) AS archived,
       count(x.shown_price) FILTER (WHERE x.status = 'active') AS active_n,
       CASE WHEN count(x.shown_price) FILTER (WHERE x.status = 'active') >= 5
            THEN round((percentile_cont(0.5) WITHIN GROUP (ORDER BY x.shown_price::double precision)
                        FILTER (WHERE x.status = 'active'))::numeric) END
         AS active_median,
       count(x.shown_price) FILTER (WHERE x.status = 'ended') AS ended_n,
       CASE WHEN count(x.shown_price) FILTER (WHERE x.status = 'ended') >= 5
            THEN round((percentile_cont(0.5) WITHIN GROUP (ORDER BY x.shown_price::double precision)
                        FILTER (WHERE x.status = 'ended'))::numeric) END
         AS ended_median,
       count(x.sold_price) AS sold_n,
       CASE WHEN count(x.sold_price) >= 5
            THEN round((percentile_cont(0.5) WITHIN GROUP (ORDER BY x.sold_price::double precision))::numeric) END
         AS sold_median,
       min(x.year) FILTER (WHERE x.year BETWEEN 1885 AND extract(year FROM now())::int + 2) AS year_min,
       max(x.year) FILTER (WHERE x.year BETWEEN 1885 AND extract(year FROM now())::int + 2) AS year_max,
       min(x.happened_at) AS dated_min,
       max(x.happened_at) AS dated_max,
       min(x.created_at) AS first_seen,
       max(x.created_at) AS last_seen,
       now() AS folded_at
FROM public.mv_source_episodes x
GROUP BY x.nslug, ROLLUP (x.make_key, x.model_key)
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_source_holdings_key ON public.mv_source_holdings (nslug, level, make_key, model_key);

-- Ids and counts of public records, read only through browse_source_read(), which re-tests that a vehicle is still public.
REVOKE ALL ON public.mv_source_episodes, public.mv_source_holdings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_source_episodes, public.mv_source_holdings TO service_role;

COMMENT ON MATERIALIZED VIEW public.mv_source_episodes IS
  'One row per episode (a vehicle_events row) of a browsable source (browse_source_keys(): a market-level registry row of species timed_auction, block_house, dealer, classifieds, auth_walled_marketplace or aggregator) on a public vehicle with a make and a model that is not a non_vehicle_item and is a CAR, TRUCK, SUV, VAN, MINIVAN or untyped; folded from vehicle_events and vehicles by source_holdings_refresh() daily at 10:35 UTC. nslug = browse_source_key_map() of the source_platform: lower case, letters and digits, then the market key; make_key and model_key are trimmed and lower case (make and model the trimmed spelling). status (active, upcoming, sold, ended, unknown) is browse_source_status() at the fold: the source''s own event_status first (bid-goes-on is ended), alive words only while the end clock is ahead; shown_price = current_price > 0; sold_price on sold episodes = final_price > 0, else the vehicle''s sale_price when it is sold and its own source has the same key. ends_at and happened_at are browse_source_clocks(): the source''s own dates, NULL when it gave none, never the landing day (created_at). has_archive is true when metadata archive_url is an http or https address: the row was read from a saved copy of the page. has_image is true when the vehicle''s record carries a photo address, an http or https address or a path (a bare word such as jpg is not one); it is the record before the photo gate, which the reader applies when it shows a photo. Population and day: refreshed_at in the source_holdings_refresh() receipt, folded_at in mv_source_holdings. 2026-10-20.';
COMMENT ON MATERIALIZED VIEW public.mv_source_holdings IS
  'mv_source_episodes counted per source (level 0), source and make (1), source, make and model (2), by ROLLUP over trimmed lower-case keys; make and model show the most common trimmed spelling. episodes, distinct vehicles, active/upcoming/sold/ended/unknown, vehicles with a photo address on the record (with_image, before the photo gate), archived (episodes read from a saved copy of the page: has_archive), the shown price of active episodes (active_n, active_median) and of ended episodes (ended_n, ended_median) and the sold price of sold episodes (sold_n, sold_median), each median whole dollars and NULL under 5 (the median floor); year range (1885 to two years ahead; a year outside it is a listing but sets no range), dated_min and dated_max (the earliest and latest happened_at: the source''s own listing clock, end else start, NULL when no episode carries one), first and last landing, source_slugs (the platform spellings folded in), folded_at. Unique on (nslug, level, make_key, model_key). Read through browse_source_read(). 2026-10-20.';

-- 3. The refresh ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.source_holdings_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  t0 timestamptz := clock_timestamp();
  v text;
  concurrent boolean;
  all_concurrent boolean := true;
  n_episodes bigint;
  n_rows bigint;
BEGIN
  -- The episodes first: the holdings count them. Concurrently needs a populated view and a valid unique index on plain
  -- columns covering every row (the test treemap_refresh_all makes).
  FOREACH v IN ARRAY ARRAY['mv_source_episodes', 'mv_source_holdings'] LOOP
    SELECT c.relispopulated AND EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
    ) INTO concurrent
    FROM pg_class c WHERE c.oid = to_regclass(format('public.%I', v));
    IF concurrent THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', v);
    ELSE
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v);
      all_concurrent := false;
    END IF;
  END LOOP;
  SELECT count(*) INTO n_episodes FROM public.mv_source_episodes;
  SELECT count(*) INTO n_rows FROM public.mv_source_holdings;
  IF n_episodes = 0 AND EXISTS (SELECT 1 FROM public.vehicle_events LIMIT 1) THEN
    RAISE EXCEPTION 'source_holdings_refresh landed no episodes although vehicle_events holds rows; the last fold stays';
  END IF;
  EXECUTE 'ANALYZE public.mv_source_episodes';
  EXECUTE 'ANALYZE public.mv_source_holdings';
  RETURN jsonb_build_object('refreshed_at', now(), 'rows', n_rows, 'episodes', n_episodes,
                            'concurrent', all_concurrent,
                            'seconds', round(extract(epoch FROM (clock_timestamp() - t0))::numeric, 1));
END $fn$;

REVOKE ALL ON FUNCTION public.source_holdings_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_holdings_refresh() TO service_role;

COMMENT ON FUNCTION public.source_holdings_refresh() IS
  'Refreshes mv_source_episodes then mv_source_holdings in one transaction (CONCURRENTLY once populated, else plainly), analyzes both, and returns {refreshed_at, rows (holdings), episodes, concurrent, seconds}. Raises, keeping the last fold, when no episode lands although vehicle_events holds rows. SECURITY DEFINER, service_role only; cron source-holdings-refresh daily at 10:35 UTC with its own statement_timeout. The first fill is this call or that cron: the views are created WITH NO DATA. 2026-10-20.';

-- 4. The reader -------------------------------------------------------------------------------------------------------
-- No SET statement_timeout on the reader: a function-level setting does not re-arm the statement already running (PG 17.9:
-- a function with SET statement_timeout TO '1s' that slept 2.5 s returned after 2.5 s under a caller limit of 15 s), so it would
-- only look like a guard. The cap the page has is the anon role's own statement_timeout, 15 s (pg_roles.rolconfig).
CREATE OR REPLACE FUNCTION public.browse_source_read(
  p_source text,
  p_make text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 60,
  p_sort text DEFAULT 'newest',
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_floor constant integer := 5;
  v_in text := nullif(btrim(p_source), '');
  v_raw text := regexp_replace(lower(coalesce(p_source, '')), '[^a-z0-9]', '', 'g');
  v_n text := '';
  v_make text := nullif(btrim(p_make), '');
  v_model text;
  v_level text;
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 100000);
  v_size integer := CASE WHEN coalesce(p_page_size, 0) < 1 THEN 60 ELSE least(p_page_size, 100) END;
  v_status text := CASE WHEN lower(btrim(p_status)) IN ('active', 'upcoming', 'sold', 'ended', 'unknown')
                        THEN lower(btrim(p_status)) END;
  v_order text;
  v_state text := 'ok';
  v_folded boolean;
  -- identity
  v_id_slug text;
  v_id_name text;
  v_id_category text;
  v_species public.source_species;
  v_base_url text;
  v_org_name text;
  v_logo text;
  v_found_id boolean := false;
  v_browsable boolean := false;
  v_known_only boolean := false;
  v_unit text;
  v_source jsonb;
  v_board jsonb;
  v_vkeys text[];
  -- the fold
  -- A record, not a row type declared from the view: declaring from the view opens it when the function compiles, and that
  -- waits for the exclusive lock the first plain fill holds (one reader call took 2.1 s of a 14.5 s fill on a 1.3M-vehicle
  -- scratch, 2026-10-20 review). A record takes its shape from the SELECT INTO below.
  l0 record;
  v_found_l0 boolean := false;
  v_nmakes bigint := 0;
  v_nmodels bigint := 0;
  v_fold_at timestamptz;
  v_fold_make text;
  v_fold_model text;
  v_slugs text[];
  v_landed bigint := 0;
  v_last timestamptz;
  v_zero jsonb;
  v_holdings jsonb;
  v_scope jsonb;
  v_makes jsonb := '[]'::jsonb;
  v_models jsonb := '[]'::jsonb;
  v_listings jsonb;
BEGIN
  v_model := CASE WHEN v_make IS NULL THEN NULL ELSE nullif(btrim(p_model), '') END;
  v_level := CASE WHEN v_make IS NULL THEN 'makes' WHEN v_model IS NULL THEN 'models' ELSE 'listings' END;
  v_listings := jsonb_build_object('total', 0, 'page', v_page, 'page_size', v_size, 'rows', '[]'::jsonb);
  v_scope := jsonb_build_object('make', v_make, 'model', v_model, 'status', v_status);
  v_zero := jsonb_build_object(
    'episodes', 0, 'vehicles', 0, 'active', 0, 'upcoming', 0, 'sold', 0, 'ended', 0, 'unknown', 0, 'with_image', 0,
    'archived', 0,
    'shown_n', 0, 'shown_median', NULL, 'active_n', 0, 'active_median', NULL, 'ended_n', 0, 'ended_median', NULL,
    'sold_n', 0, 'sold_median', NULL, 'makes', 0, 'models', 0,
    'year_min', NULL, 'year_max', NULL, 'dated_min', NULL, 'dated_max', NULL,
    'first_seen', NULL, 'last_seen', NULL, 'folded_at', NULL,
    'landed_24h', 0, 'last_landed', NULL, 'board', NULL);

  -- Who the source is, asked of the registry at every call. The slug is read through the one source key, so a capture
  -- channel or another spelling is its market. Identity is the market's own observation_sources row and its
  -- organization, else the Sources board's latest day for that key.
  IF v_raw <> '' THEN
    v_n := coalesce((SELECT k.canon_key FROM public.browse_source_key_map() k WHERE k.raw_key = v_raw), v_raw);
    SELECT o.slug, o.display_name, o.category::text, o.species, o.base_url, b.name, b.logo_url
      INTO v_id_slug, v_id_name, v_id_category, v_species, v_base_url, v_org_name, v_logo
    FROM public.observation_sources o
    LEFT JOIN public.organizations b ON b.id = o.business_id
    WHERE o.market_slug IS NULL AND regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') = v_n
    ORDER BY (o.species IS NOT NULL) DESC, o.created_at, o.slug
    LIMIT 1;
    v_found_id := FOUND;
    IF NOT v_found_id THEN
      SELECT m.source_slug, m.display_name, m.category::text, m.species
        INTO v_id_slug, v_id_name, v_id_category, v_species
      FROM public.market_source_days m
      WHERE regexp_replace(lower(m.source_slug), '[^a-z0-9]', '', 'g') = v_n
      ORDER BY m.day DESC
      LIMIT 1;
      v_found_id := FOUND;
    END IF;
    v_browsable := EXISTS (SELECT 1 FROM public.browse_source_keys() k WHERE k.nslug = v_n);
    -- A source only the Sources board knows (a venue the registry lacks, or a cohort of one venue's lots grouped by seller)
    -- is known by name and board count and holds no rows here. A registry row that is not browsable is never this.
    v_known_only := NOT v_browsable AND v_found_id
                    AND coalesce(v_species::text IN ('timed_auction', 'block_house', 'dealer', 'classifieds',
                                                     'auth_walled_marketplace', 'aggregator', 'private_seller'), false);
  END IF;

  -- Not a source the page may show: unknown, whatever the fold holds. Nothing of a source that is not browsable (an
  -- owner's, a media source, one with no species, one the registry does not know) is named, counted or listed.
  IF NOT v_browsable AND NOT v_known_only THEN
    RETURN jsonb_build_object(
      'as_of', now(), 'status', 'unknown_source', 'median_floor', c_floor,
      'source', jsonb_build_object('slug', v_in, 'name', v_in, 'category', NULL, 'species', NULL, 'species_label', NULL,
                                   'unit', 'listings held', 'logo_url', NULL, 'base_url', NULL),
      'holdings', v_zero, 'level', v_level, 'scope', v_scope, 'makes', v_makes, 'models', v_models, 'listings', v_listings);
  END IF;

  SELECT g ->> 'unit' INTO v_unit
  FROM jsonb_array_elements(public.source_species_groups()) g
  WHERE g ->> 'species' = v_species::text
  LIMIT 1;
  v_source := jsonb_build_object(
    'slug', coalesce(v_id_slug, v_in),
    'name', coalesce(nullif(btrim(regexp_replace(v_id_name, '\s*\([^)]*\)\s*$', '')), ''), nullif(btrim(v_id_name), ''),
                     nullif(btrim(v_org_name), ''), v_id_slug, v_in),
    'category', v_id_category,
    'species', v_species,
    'species_label', CASE WHEN v_species IS NULL THEN NULL ELSE public.source_species_label(v_species) END,
    'unit', coalesce(v_unit, 'listings held'),
    'logo_url', v_logo,
    'base_url', v_base_url);

  -- The Sources board's own count for this source: what it holds, when it counted and against what population. A page
  -- with no rows here still says what the board says.
  SELECT jsonb_build_object('day', m.day, 'lots', m.landed_lots, 'landed_at', m.landed_at, 'population', m.population,
                            'population_method', m.population_method, 'population_confidence', m.population_confidence,
                            'population_at', m.population_at)
    INTO v_board
  FROM public.market_source_days m
  WHERE regexp_replace(lower(m.source_slug), '[^a-z0-9]', '', 'g') = v_n
  ORDER BY m.day DESC, m.landed_lots DESC NULLS LAST
  LIMIT 1;
  v_zero := v_zero || jsonb_build_object('board', v_board);

  IF v_known_only THEN
    RETURN jsonb_build_object('as_of', now(), 'status', 'ok', 'median_floor', c_floor, 'source', v_source,
                              'holdings', v_zero, 'level', v_level, 'scope', v_scope,
                              'makes', v_makes, 'models', v_models, 'listings', v_listings);
  END IF;

  -- Not folded yet: the views start empty and the first fill is the cron's or an operator's refresh.
  SELECT coalesce(bool_and(c.relispopulated), false) INTO v_folded
  FROM pg_class c
  WHERE c.oid IN (to_regclass('public.mv_source_holdings'), to_regclass('public.mv_source_episodes'));
  IF NOT v_folded THEN
    RETURN jsonb_build_object('as_of', now(), 'status', 'not_folded', 'median_floor', c_floor, 'source', v_source,
                              'holdings', v_zero, 'level', v_level, 'scope', v_scope,
                              'makes', v_makes, 'models', v_models, 'listings', v_listings);
  END IF;

  SELECT * INTO l0 FROM public.mv_source_holdings h WHERE h.nslug = v_n AND h.level = 0;
  v_found_l0 := FOUND;

  -- Landing is live from the events index: every row the source landed, whether or not its vehicle is public.
  v_slugs := ARRAY(SELECT DISTINCT s FROM unnest(coalesce(l0.source_slugs, '{}'::text[]) || ARRAY[v_in, v_id_slug]) s
                   WHERE s IS NOT NULL AND s <> '');
  SELECT count(*) INTO v_landed FROM public.vehicle_events e
  WHERE e.source_platform = ANY (v_slugs) AND e.created_at >= now() - interval '24 hours';
  SELECT max(x.m) INTO v_last
  FROM unnest(v_slugs) s
  CROSS JOIN LATERAL (SELECT max(e.created_at) AS m FROM public.vehicle_events e WHERE e.source_platform = s) x;

  IF v_found_l0 THEN
    SELECT count(*) FILTER (WHERE h.level = 1), count(*) FILTER (WHERE h.level = 2) INTO v_nmakes, v_nmodels
    FROM public.mv_source_holdings h WHERE h.nslug = v_n AND h.level > 0;
    v_fold_at := l0.folded_at;
  ELSE
    SELECT h.folded_at INTO v_fold_at FROM public.mv_source_holdings h LIMIT 1;
  END IF;
  -- shown_n and shown_median repeat active_n and active_median: the price of what is alive now, never a blend with the
  -- prices of closed listings (readers built to the first contract keep working and now read the defensible number).
  v_holdings := jsonb_build_object(
    'episodes', coalesce(l0.episodes, 0), 'vehicles', coalesce(l0.vehicles, 0), 'active', coalesce(l0.active, 0),
    'upcoming', coalesce(l0.upcoming, 0), 'sold', coalesce(l0.sold, 0), 'ended', coalesce(l0.ended, 0),
    'unknown', coalesce(l0.unknown, 0), 'with_image', coalesce(l0.with_image, 0), 'archived', coalesce(l0.archived, 0),
    'shown_n', coalesce(l0.active_n, 0), 'shown_median', l0.active_median,
    'active_n', coalesce(l0.active_n, 0), 'active_median', l0.active_median,
    'ended_n', coalesce(l0.ended_n, 0), 'ended_median', l0.ended_median,
    'sold_n', coalesce(l0.sold_n, 0), 'sold_median', l0.sold_median, 'makes', v_nmakes, 'models', v_nmodels,
    'year_min', l0.year_min, 'year_max', l0.year_max, 'dated_min', l0.dated_min, 'dated_max', l0.dated_max,
    'first_seen', l0.first_seen, 'last_seen', l0.last_seen,
    'folded_at', v_fold_at, 'landed_24h', v_landed, 'last_landed', v_last, 'board', v_board);

  IF v_found_l0 AND v_make IS NOT NULL THEN
    SELECT h.make INTO v_fold_make FROM public.mv_source_holdings h
    WHERE h.nslug = v_n AND h.level = 1 AND h.make_key = lower(v_make);
    IF v_model IS NOT NULL THEN
      SELECT h.model INTO v_fold_model FROM public.mv_source_holdings h
      WHERE h.nslug = v_n AND h.level = 2 AND h.make_key = lower(v_make) AND h.model_key = lower(v_model);
    END IF;
  END IF;
  v_scope := jsonb_build_object('make', coalesce(v_fold_make, v_make), 'model', coalesce(v_fold_model, v_model),
                                'status', v_status);

  IF v_found_l0 AND v_level = 'makes' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'make', h.make, 'episodes', h.episodes, 'vehicles', h.vehicles, 'active', h.active,
             'upcoming', h.upcoming, 'sold', h.sold, 'ended', h.ended,
             'shown_n', h.active_n, 'shown_median', h.active_median, 'active_n', h.active_n,
             'active_median', h.active_median, 'ended_n', h.ended_n, 'ended_median', h.ended_median,
             'sold_n', h.sold_n, 'sold_median', h.sold_median,
             'with_image', h.with_image, 'year_min', h.year_min, 'year_max', h.year_max,
             'top_models', (SELECT coalesce(jsonb_agg(jsonb_build_object('model', t.model, 'episodes', t.episodes)
                                                      ORDER BY t.episodes DESC, t.model), '[]'::jsonb)
                            FROM (SELECT m.model, m.episodes FROM public.mv_source_holdings m
                                  WHERE m.nslug = h.nslug AND m.level = 2 AND m.make_key = h.make_key
                                  ORDER BY m.episodes DESC, m.model LIMIT 3) t))
             ORDER BY h.episodes DESC, h.make), '[]'::jsonb)
      INTO v_makes
    FROM public.mv_source_holdings h WHERE h.nslug = v_n AND h.level = 1;
  ELSIF v_found_l0 AND v_level = 'models' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'model', h.model, 'episodes', h.episodes, 'vehicles', h.vehicles, 'active', h.active,
             'upcoming', h.upcoming, 'sold', h.sold, 'ended', h.ended,
             'shown_n', h.active_n, 'shown_median', h.active_median, 'active_n', h.active_n,
             'active_median', h.active_median, 'ended_n', h.ended_n, 'ended_median', h.ended_median,
             'sold_n', h.sold_n, 'sold_median', h.sold_median,
             'with_image', h.with_image, 'year_min', h.year_min, 'year_max', h.year_max)
             ORDER BY h.episodes DESC, h.model), '[]'::jsonb)
      INTO v_models
    FROM public.mv_source_holdings h WHERE h.nslug = v_n AND h.level = 2 AND h.make_key = lower(v_make);
  ELSIF v_found_l0 AND v_level = 'listings' THEN
    -- The fold's episodes of this make and model are one contiguous range of mv_source_episodes_cohort. total and the
    -- page come from them; the 1-100 rows shown are joined to the live vehicle and event by primary key, and take their
    -- status, prices and clocks from those live rows (the same rules as the fold), so a listing that closed since the fold
    -- reads Ended and a price is the one the event carries now. An episode with no source date sorts last in newest.
    v_vkeys := ARRAY(SELECT k.raw_key FROM public.browse_source_key_map() k WHERE k.canon_key = v_n) || v_n;
    v_order := CASE lower(btrim(coalesce(p_sort, 'newest')))
      WHEN 'price_desc' THEN 'coalesce(s.sold_price, s.shown_price) DESC NULLS LAST, '
      WHEN 'price_asc' THEN 'coalesce(s.sold_price, s.shown_price) ASC NULLS LAST, '
      WHEN 'year_desc' THEN 's.year DESC NULLS LAST, '
      WHEN 'year_asc' THEN 's.year ASC NULLS LAST, '
      ELSE ''
    END || 'CASE WHEN s.happened_at IS NULL THEN NULL ELSE least(s.happened_at, $8) END DESC NULLS LAST, '
        || 's.created_at DESC, s.event_id';
    EXECUTE format($q$
      WITH c AS (
        SELECT s.* FROM public.mv_source_episodes s
        WHERE s.nslug = $1 AND s.make_key = $2 AND s.model_key = $3 AND ($4::text IS NULL OR s.status = $4)
      ), p AS (
        SELECT s.*, row_number() OVER (ORDER BY %s) AS rn FROM c s
      ), ci AS MATERIALIZED (
        -- The card photo of the vehicles on this page, read through the photo gate (vehicle_card_images: the primary photo the
        -- gate has not hidden), one call for the page. Never vehicles.primary_image_url, which the gate does not see.
        SELECT DISTINCT ON (g.vehicle_id) g.vehicle_id,
               coalesce(nullif(btrim(g.thumbnail_url), ''), nullif(btrim(g.medium_url), ''), nullif(btrim(g.image_url), '')) AS url
        FROM public.vehicle_card_images((SELECT array_agg(DISTINCT q.vehicle_id) FROM p q WHERE q.rn > $6 AND q.rn <= $6 + $7)) g
        ORDER BY g.vehicle_id, g.is_primary DESC NULLS LAST, g.created_at
      )
      SELECT jsonb_build_object(
        'total', (SELECT count(*) FROM c),
        'page', $5::integer,
        'page_size', $7::integer,
        'rows', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
                   'event_id', p.event_id,
                   'vehicle_id', p.vehicle_id,
                   'year', coalesce(v.year, p.year),
                   'make', btrim(v.make),
                   'model', btrim(v.model),
                   'trim', v.trim,
                   'status', ls.status,
                   'status_raw', e.event_status,
                   'shown_price', CASE WHEN e.current_price > 0 THEN e.current_price END,
                   'sold_price', public.browse_source_sold_price(
                                   ls.status, e.final_price, v.sale_status, v.sale_price,
                                   regexp_replace(lower(coalesce(v.source, '')), '[^a-z0-9]', '', 'g') = ANY ($9)),
                   'price_kind', e.metadata ->> 'price_kind',
                   -- bids: the column, else the capture's own count (1,594 of 20,537 events, one marketplace, prod 2026-10-20 07:09-07:20Z).
                   -- price_label: only the source's own "Starting bid" passes (2,140 of those events), so an ended card never reads "Current bid".
                   'price_label', CASE WHEN lower(btrim(e.metadata -> 'end_state' ->> 'price_label')) = 'starting bid'
                                       THEN 'Starting bid' END,
                   'bids', coalesce(nullif(e.bid_count, 0),
                                    -- at most 9 digits, so a junk count cannot overflow the integer cast
                                    CASE WHEN e.metadata ->> 'bid_count' ~ '^[0-9]{1,9}$'
                                         THEN (e.metadata ->> 'bid_count')::integer END,
                                    e.bid_count),
                   'listed_at', lc.listed_at,
                   'recorded_at', e.created_at,
                   'first_seen_at', e.created_at,
                   'checked_at', e.updated_at,
                   'ends_at', lc.ends_at,
                   -- location: the vehicle's own, else the source's text only when it reads as a place (2-60 characters, no digit
                   -- but a trailing five-digit ZIP, none of @ ! # / \ or a control character); a phone number, e-mail address or street
                   -- address is never sent.
                   'location', coalesce(nullif(btrim(v.listing_location), ''),
                                        CASE WHEN jsonb_typeof(e.metadata -> 'location') = 'string'
                                                  AND btrim(e.metadata ->> 'location') ~ '^[^0-9@!#/\\[:cntrl:]]{2,60}( [0-9]{5})?$'
                                             THEN btrim(e.metadata ->> 'location') END),
                   'image_url', ci.url,
                   'listing_url', CASE WHEN e.source_url ~* '^https?://\S+$' THEN e.source_url END,
                   'archive_url', CASE WHEN e.metadata ->> 'archive_url' ~* '^https?://\S+$'
                                       THEN e.metadata ->> 'archive_url' END) ORDER BY p.rn)
          FROM p
          JOIN public.vehicles v ON v.id = p.vehicle_id
                                AND v.is_public IS TRUE AND v.deleted_at IS NULL
                                AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
          JOIN public.vehicle_events e ON e.id = p.event_id
          LEFT JOIN ci ON ci.vehicle_id = p.vehicle_id
          CROSS JOIN LATERAL public.browse_source_clocks(e.started_at, e.ended_at, e.metadata) lc
          CROSS JOIN LATERAL (
            SELECT public.browse_source_status(e.event_status, e.final_price, e.sold_at, lc.listed_at, lc.ends_at,
                                               e.updated_at, now()) AS status
          ) ls
          WHERE p.rn > $6 AND p.rn <= $6 + $7 AND ($4::text IS NULL OR ls.status = $4)), '[]'::jsonb))
    $q$, v_order)
    INTO v_listings
    USING v_n, lower(v_make), lower(v_model), v_status, v_page, ((v_page - 1)::bigint * v_size), v_size,
          coalesce(v_fold_at, now()), v_vkeys;
  END IF;

  RETURN jsonb_build_object('as_of', now(), 'status', v_state, 'median_floor', c_floor, 'source', v_source,
                            'holdings', v_holdings, 'level', v_level, 'scope', v_scope,
                            'makes', v_makes, 'models', v_models, 'listings', v_listings);
END $fn$;

REVOKE ALL ON FUNCTION public.browse_source_read(text, text, text, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_source_read(text, text, text, integer, integer, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.browse_source_read(text, text, text, integer, integer, text, text) IS
  'What one source holds, as one jsonb for /browse?source=<slug>: {as_of, status (ok, not_folded, unknown_source), median_floor 5, source {slug, name, category, species, species_label, unit, logo_url, base_url}, holdings {episodes, vehicles, active, upcoming, sold, ended, unknown, with_image, archived, shown_n, shown_median (the active ones: repeats active_n and active_median), active_n, active_median, ended_n, ended_median, sold_n, sold_median, makes, models, year_min, year_max, dated_min, dated_max, first_seen, last_seen, folded_at, landed_24h, last_landed, board {day, lots, landed_at, population, population_method, population_confidence, population_at} (the Sources board''s own count for the source, or null)}, level (makes, models, listings), scope {make, model, status}, makes[], models[], listings {total, page, page_size, rows[]}}. Only a browsable source is answered (browse_source_keys(): a registry market of species timed_auction, block_house, dealer, classifieds, auth_walled_marketplace or aggregator, asked at every call); any other slug, including an owner''s source, a media source, one with no species and one the registry does not know, is unknown_source and names, counts and lists nothing; a source only the Sources board knows (a venue the registry lacks, or a cohort of another venue''s lots, species private_seller) is ok with its name, its board count and no rows. board.lots counts the source''s lots matched against the target list (a coverage measure), which is not holdings.episodes (every listing the source put on a public vehicle with a make and a model): both may be shown, never as one number. The slug is read through browse_source_key_map(): lower case, letters and digits, then its market (an alias spelling of a market is that market, a capture channel is its market). source.name is the registry''s display name without a trailing parenthesis (the name the Sources board shows), else the organization''s name, else the slug. Population: the episodes of public vehicles with a make and a model in mv_source_episodes as folded at holdings.folded_at (daily, 10:35 UTC); landed_24h and last_landed are live and count every row the source landed. archived counts the episodes read from a saved copy of the page (archive_url present); dated_min and dated_max are the earliest and latest listing clock (end, else start) among the episodes, null when none carries a date. Medians are NULL under 5 (median_floor) and are per status: active (the asks and current bids of what is alive), ended (the last or high bid of closed listings) and sold (what they sold for); sold_n is the n of sold_median. Statuses (browse_source_status()): sold, active, upcoming (a catalogued lot whose date is ahead), ended (including bid-goes-on, a result, and anything alive whose end clock has passed) and unknown (alive by its word but with no end clock and no update in 14 days, or no word). Sorts: newest (the source''s own clock: end, else start; none sorts last, by when it landed), price_desc, price_asc, year_desc, year_asc; page size 1-100; p_status active, upcoming, sold, ended or unknown filters the listings level (the fold, then the live status). The rows shown are the live vehicle and event, and a vehicle no longer public is left out; their status, prices and clocks are derived from the live event by the fold''s own rules. Each row carries event_id, the vehicle_events row it is, so a page keys rows exactly. Each row keeps its clocks apart: listed_at is the source''s own listing date (started_at, else metadata listing_posted_at, else sale_starts_on) and is null when the source gave none; ends_at is its end (ended_at, else listing_ends_at, else sale_ends_on, else auction_date; a date alone ends with that day); recorded_at (also sent as first_seen_at) is when the ledger first recorded the row and is never a listing date; checked_at is when the ledger last wrote the row (the event row''s updated_at): for a listing alive by the source''s word with no end clock it is the only evidence that the listing was still alive, so a page says when it was last checked, not that it is live now; archive_url is the saved copy of the page the row was read from (metadata archive_url, http or https only), else null; listing_url is the source''s own address when it is a web address without spaces, else null. bids is the bid count on the event row, else the capture''s own count (metadata bid_count) when the column holds 0 or nothing; null or 0 means none recorded, never that none were made. price_label is ''Starting bid'' when the source itself labelled the price a starting bid, else null: no other word is passed. location is the vehicle''s own place, else the source''s text only when it reads as a place (2 to 60 characters, no digit but a trailing five-digit ZIP, none of @ ! # / \ or a control character), else null: a phone number, an e-mail address or a street address is never sent. image_url is the card photo read through the photo gate (vehicle_card_images: thumbnail, else medium, else full size), null when the gate shows none; it is never vehicles.primary_image_url, which the gate does not see (holdings.with_image counts photo addresses on the record, before the gate). make and model are trimmed. SECURITY DEFINER, anon-callable. 2026-10-20.';

-- 5. The schedule -----------------------------------------------------------------------------------------------------
DO $job$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'source-holdings-refresh';
    PERFORM cron.schedule('source-holdings-refresh', '35 10 * * *',
      $cron$SET statement_timeout = '20min'; SELECT public.source_holdings_refresh();$cron$);
  END IF;
END $job$;

NOTIFY pgrst, 'reload schema';
COMMIT;
