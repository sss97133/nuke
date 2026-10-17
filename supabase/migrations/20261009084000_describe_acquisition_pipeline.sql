-- Describe acquisition_pipeline: the 55 columns with no COMMENT ON COLUMN (0 of 55 described before, v_schema_atlas
-- on prod, 2026-10-09 08:32Z) and a table comment (there was none). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-09 08:35-08:40Z UTC):
--   Columns, types, defaults, constraints, indexes and triggers from information_schema, pg_constraint, pg_indexes and
--   pg_trigger; fill from count(col) over the whole table (864 rows); categorical counts by group by. Writers from code
--   at origin/main 1572f9267 and git history: supabase/migrations/20260219220000_acquisition_pipeline.sql (table,
--   enums, triggers, advance_acquisition_stage), 20260225000010 (six pg_cron jobs calling discover-cl-muscle-cars and
--   batch-market-proof; none is scheduled on prod, 2026-10-09), 20260226000001 (dedup by discovery_url),
--   20260226000002 (seller_id, cross_post_id), 20260226000003 (seller back-fill); the edge functions
--   discover-cl-muscle-cars and batch-market-proof (deleted 2026-03-09 in 5741560ae; read at 5741560ae^) and
--   market-proof (deleted 2026-03-29 in f39c14bc6; read at 5741560ae^); the live edge functions acquire-vehicle (stage
--   steps), process-cl-queue (vehicle_id, seller_id, seller_contact) and pipeline-dashboard (reader).
--   pipeline_registry has no row for the table (2026-10-09).
-- LIMITS:
--   Rows were inserted on 2026-02-19 (768), 2026-02-25 (94) and 2026-02-26 (2); the last write was 2026-02-27. No
--   scheduled writer remains. The comments state what the writers computed, not whether the estimates were right.
--   Quoted values are stage, priority and writer codes: no names, contacts, URLs, ids or amounts.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.acquisition_pipeline IS
'Buy-side deal funnel for collector cars found on Craigslist: one row per discovered listing (grain: one listing URL; discovery_url is distinct on all rows after the 2026-02-26 dedup). 864 rows (2026-10-09), inserted 2026-02-19 .. 2026-02-26 by the discovery function discover-cl-muscle-cars and an agent batch, scored by market-proof (comparable sales → deal_score, estimated_value, estimated_profit, market_proof_data), advanced through acquisition_stage by acquire-vehicle and advance_acquisition_stage. Stages on 2026-10-09: market_proofed 820, target 34, contacted 8, inspecting 1, discovered 1; no row reached an offer, a purchase or a sale, so every acquisition, shop, resale and money column after offer_amount is empty. The discovery and scoring functions were deleted in 2026-03 and no cron feeds the table; last write 2026-02-27. Stage changes are logged in acquisition_stage_log (trigger trg_acquisition_stage_log). Event time = discovery_date (when our crawler found the listing; the listing''s own post time is not kept); ingest time = created_at. No pipeline_registry owner (2026-10-09).';

-- ── Identity and links ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.id IS
'Surrogate key of the pipeline row. Unit: none (uuid). Source: gen_random_uuid() default. acquisition_stage_log.pipeline_id, market_proof_reports.pipeline_id and pipeline_cross_posts point at it. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.vehicle_id IS
'Vehicle created from the same listing, foreign key to vehicles.id (ON DELETE CASCADE: deleting the vehicle deletes this row). Set after the fact by process-cl-queue, which matches discovery_url to the queue item''s listing_url when vehicle_id is NULL. Filled on 187 of 864 rows (2026-10-09). Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.organization_id IS
'Organization pursuing the deal, foreign key to organizations.id. UNUSED: NULL on all 864 rows (2026-10-09); no writer sets it. Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.seller_id IS
'Seller profile, foreign key to pipeline_sellers.id (ON DELETE SET NULL), from 20260226000002 / 20260226000003 and process-cl-queue (matched on a phone number extracted from the listing). Filled on 9 rows (2026-10-09). Not keyed to external_identities. Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.cross_post_id IS
'Cross-post group, foreign key to pipeline_cross_posts.id (ON DELETE SET NULL): the same car posted in several Craigslist regions, matched by a year:make:model:price fingerprint in 20260226000002. Filled on 156 rows, 47 distinct groups (2026-10-09). A fingerprint match, not a VIN match. Unit: none (uuid). Grain: one listing. Clock: n/a.';

-- ── Discovery (the listing as found) ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.discovery_source IS
'Platform the listing was found on; default craigslist and craigslist on all 864 rows (2026-10-09). Unit: none (text code). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.discovery_url IS
'URL of the listing as discovered; the working natural key: the discovery function skipped URLs already present, 20260226000001 removed duplicates, and every row is distinct (2026-10-09). Partial btree index idx_pipeline_discovery_url (not unique). process-cl-queue joins on it. Craigslist listings expire, so the URL may no longer resolve. Unit: none (URL text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.discovery_date IS
'When the crawler found the listing: default now(), and discover-cl-muscle-cars passed the run time. Not the listing''s post time, which is not kept. Unit: timestamptz. Grain: one listing. Clock: ingest time (discovery run), the closest this table has to an event time.';
COMMENT ON COLUMN public.acquisition_pipeline.discovered_by IS
'Writer label of the discovering run: discover-cl-muscle-cars (198), claude_agent (117), NULL (549, writer not recorded) on 2026-10-09. Unit: none (text code). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.year IS
'Model year as parsed from the listing title by the discovery writer; range 1958 .. 1991 on all 864 rows (2026-10-09), the window priority encodes. A seller claim, not a decoded VIN. Unit: calendar year. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.make IS
'Make as recorded by the discovery writer (for example Chevrolet, Dodge, Plymouth, Pontiac, Ford; discover-cl-muscle-cars took it from its search term table, not from the vehicle); 11 distinct values (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.model IS
'Model as a hint from the search term or the listing title (for example Camaro, Chevelle, GTO); filled on 829 rows, 74 distinct values (2026-10-09). Not keyed to a model catalog. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.engine IS
'Engine as stated in the listing, when the writer read one. Filled on 13 of 864 rows (2026-10-09). A seller claim. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.transmission IS
'Transmission as stated in the listing. UNUSED: NULL on all 864 rows (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.asking_price IS
'Seller''s asking price from the listing at discovery (discover-cl-muscle-cars: the listing price). Filled on 771 rows (2026-10-09). An ask, never a sale price; not refreshed after discovery. Unit: USD. Grain: one listing. Clock: as of discovery_date.';
COMMENT ON COLUMN public.acquisition_pipeline.location_city IS
'Listing city as read from the listing; discover-cl-muscle-cars left it NULL and other writers filled it. Filled on 666 rows (2026-10-09). Free text, not keyed to a place. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.location_state IS
'Listing state (US state code as written); filled on 666 rows, 30 distinct values (2026-10-09). Not keyed to a place. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.seller_name IS
'Seller name as stated in the listing. UNUSED: NULL on all 864 rows (2026-10-09). Would hold a person''s name. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.seller_contact IS
'Seller contact: a phone number extracted from the listing by process-cl-queue, or the contact method recorded by acquire-vehicle at the contacted step. Private: a person''s contact detail, never shown publicly. Filled on 19 rows (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.notes IS
'Free-text notes: on most rows the listing title as discovered (year and model), with dated lines appended by acquire-vehicle at each stage step. Filled on 589 rows (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.tags IS
'Free-form labels on the row. Filled on 36 rows (2026-10-09); no writer in the repo sets them. Unit: none (text[]). Grain: one listing. Clock: n/a.';

-- ── Pipeline state ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.stage IS
'Funnel position, enum acquisition_stage (discovered → market_proofed → target → contacted → inspecting → offer_made → under_contract → payment_pending → acquired → in_transport → at_shop → validated → reconditioning → photography → listing_prep → listed → under_offer → sold → closed). Default discovered. market-proof set market_proofed; batch-market-proof set target when deal_score met its threshold; acquire-vehicle and advance_acquisition_stage set the later steps. Counts on 2026-10-09: market_proofed 820, target 34, contacted 8, inspecting 1, discovered 1. Each change writes acquisition_stage_log. Unit: none (enum). Grain: one listing. Clock: n/a (see stage_updated_at).';
COMMENT ON COLUMN public.acquisition_pipeline.priority IS
'Buy priority, enum acquisition_priority: primary (1958-1973 muscle and sports cars), secondary (1973-1991), opportunistic (any era, exceptional deal), from the discovery writer''s search term table. Default primary; primary 705, secondary 159 (2026-10-09). Unit: none (enum). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.stage_updated_at IS
'When stage last changed: default now(); the BEFORE UPDATE trigger trg_acquisition_pipeline_updated_at keeps the old value unless stage changes, and acquire-vehicle also sets it. Later than created_at on 863 of 864 rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the stage change).';

-- ── Market proof (computed by market-proof from comparable sales) ───────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.deal_score IS
'Deal score 0-100 computed by market-proof (deleted 2026-03-29) from estimated net profit, ROI and comparable count (40 when profit or ROI was unknown, penalized for few comps). 20 on 453 rows, 40 on 190, 50 on 97, 60 on 60, 70 on 36, 80 on 10, 90 on 5 (2026-10-09). A heuristic of that function, not a calibrated probability. Unit: score 0-100. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.market_proof_data IS
'Full market-proof result: analyzed_at, comp_min, comp_max, comp_p25, comp_p75, comp_sample, condition_tier, cost_to_ready, cost_breakdown, cost_notes, discount_to_market, match_strategy, net_profit, roi_pct, target_sale_price, total_investment, recommendation, risk_factors (859 rows; 4 rows carry an earlier, shorter shape; 1 NULL, 2026-10-09). The typed columns comp_*, estimated_value and estimated_profit are copies of fields in it. Unit: none (jsonb; amounts in USD). Grain: one listing. Clock: analyzed_at inside is the computation time.';
COMMENT ON COLUMN public.acquisition_pipeline.comp_count IS
'Number of comparable sold vehicles market-proof matched (match_strategy in market_proof_data); filled on 863 rows, range 0 .. 200 (2026-10-09). Unit: count of comparables. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.comp_median IS
'Median sale price of the comparables market-proof matched. Filled on 860 rows (2026-10-09). Unit: USD. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.comp_avg IS
'Mean sale price of the comparables market-proof matched. Filled on 860 rows (2026-10-09). Unit: USD. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.estimated_value IS
'market-proof target resale price for the car after reconditioning (market_proof_data.target_sale_price; equal on all 669 rows where both are filled). Filled on 673 rows (2026-10-09). An estimate, not an appraisal. Unit: USD. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.estimated_profit IS
'market-proof estimated net profit: target resale price minus asking price and estimated cost to ready (market_proof_data.net_profit; equal on all 669 rows where both are filled). Filled on 673 rows (2026-10-09). An estimate. Unit: USD. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.confidence_score IS
'Confidence of the market proof, set by market-proof from comp_count only: 85 for 10 or more comparables, 70 for 5-9, 55 for 3-4, 30 below. 85 on 841 rows, 70 on 17, 55 on 2, 30 on 3, NULL on 1 (2026-10-09). Unit: score 0-100 (four levels). Grain: one listing. Clock: as of market_proof_data.analyzed_at.';

-- ── Acquisition, shop and validation (acquire-vehicle steps; empty on every row) ─────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.offer_amount IS
'Offer made to the seller, set by acquire-vehicle at offer_made. UNUSED so far: NULL on all 864 rows (2026-10-09). Unit: USD. Grain: one listing. Clock: as of offer_date.';
COMMENT ON COLUMN public.acquisition_pipeline.offer_date IS
'When the offer was recorded (acquire-vehicle writes the call time at offer_made). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step), standing in for the offer event.';
COMMENT ON COLUMN public.acquisition_pipeline.purchase_price IS
'Agreed purchase price, set by acquire-vehicle at under_contract. NULL on all rows (2026-10-09). Input to the generated total_investment and gross_profit. Unit: USD. Grain: one listing. Clock: as of purchase_date.';
COMMENT ON COLUMN public.acquisition_pipeline.purchase_date IS
'When the contract was recorded (acquire-vehicle writes the call time at under_contract). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step), standing in for the purchase event.';
COMMENT ON COLUMN public.acquisition_pipeline.title_status IS
'Title status stated at under_contract (free text from the acquire-vehicle caller). NULL on all rows (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.partner_shop_id IS
'Partner shop the car goes to, set by acquire-vehicle at inspecting or at_shop (a partner_shops id looked up by shop name; no foreign key). NULL on all rows (2026-10-09). Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.shop_arrival_date IS
'When arrival at the shop was recorded (acquire-vehicle writes the call time at at_shop). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step).';
COMMENT ON COLUMN public.acquisition_pipeline.inspection_report IS
'Inspection findings passed to acquire-vehicle at validated. NULL on all rows (2026-10-09). Unit: none (jsonb). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.repair_estimate IS
'Estimated repair cost passed to acquire-vehicle at validated. NULL on all rows (2026-10-09). Input to total_investment and gross_profit. Unit: USD. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.authentication_result IS
'Authentication or provenance check result passed to acquire-vehicle at validated. NULL on all rows (2026-10-09). Unit: none (jsonb). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.numbers_matching_verified IS
'Whether numbers-matching was verified at validated (acquire-vehicle numbers_matching). NULL on all rows (2026-10-09). Unit: boolean. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.reconditioning_cost IS
'Reconditioning spend; acquire-vehicle at acquired adds any total_cost above purchase price and repair estimate here. NULL on all rows (2026-10-09). Input to total_investment and gross_profit. Unit: USD. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.reconditioning_items IS
'Reconditioning line items, shape [{item, cost, vendor, status}] per 20260219220000. UNUSED: NULL on all rows, no writer in the repo (2026-10-09). Unit: none (jsonb). Grain: one listing. Clock: n/a.';

-- ── Resale (acquire-vehicle steps; empty on every row) ──────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.listing_platform IS
'Platform the car was relisted on for resale (for example bat, cab), set by acquire-vehicle at listed. NULL on all rows (2026-10-09). Unit: none (text code). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.listing_url_resale IS
'URL of the resale listing, set by acquire-vehicle at listed. NULL on all rows (2026-10-09). Unit: none (URL text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.listing_date IS
'When the resale listing was recorded (acquire-vehicle writes the call time at listed). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step).';
COMMENT ON COLUMN public.acquisition_pipeline.sale_price IS
'Resale price, set by acquire-vehicle at sold. NULL on all rows (2026-10-09). Input to gross_profit. Unit: USD. Grain: one listing. Clock: as of sale_date.';
COMMENT ON COLUMN public.acquisition_pipeline.sale_date IS
'When the resale was recorded (acquire-vehicle writes the call time at sold). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step), standing in for the sale event.';
COMMENT ON COLUMN public.acquisition_pipeline.buyer_info IS
'Buyer details passed to acquire-vehicle at sold. Private: would hold a person''s details. NULL on all rows (2026-10-09). Unit: none (jsonb). Grain: one listing. Clock: n/a.';

-- ── Generated financials ────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.total_investment IS
'GENERATED ALWAYS (stored): coalesce(purchase_price, 0) + coalesce(reconditioning_cost, 0) + coalesce(repair_estimate, 0). 0 on all 864 rows because no row has those inputs (2026-10-09); 0 means no inputs, not a zero-cost car. market_proof_data.total_investment is a separate estimate. Unit: USD. Grain: one listing. Clock: n/a (recomputed on every write).';
COMMENT ON COLUMN public.acquisition_pipeline.gross_profit IS
'GENERATED ALWAYS (stored): coalesce(sale_price, 0) - coalesce(purchase_price, 0) - coalesce(reconditioning_cost, 0) - coalesce(repair_estimate, 0). 0 on all 864 rows (2026-10-09) because no row has a sale or purchase; 0 means no inputs. The view acquisition_pipeline_stats sums it for sold rows only. Unit: USD. Grain: one listing. Clock: n/a (recomputed on every write).';

-- ── Row clocks ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.created_at IS
'When the row was inserted: default now(); 2026-02-19 (768), 2026-02-25 (94), 2026-02-26 (2) (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time.';
COMMENT ON COLUMN public.acquisition_pipeline.updated_at IS
'When the row last changed: default now() and set by the BEFORE UPDATE trigger trg_acquisition_pipeline_updated_at; latest 2026-02-27 (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (last edit).';

-- A column added between this PR and its deploy must not block the deploy: report, never raise.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.acquisition_pipeline'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'acquisition_pipeline: every column has a comment';
  ELSE
    RAISE NOTICE 'acquisition_pipeline columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
