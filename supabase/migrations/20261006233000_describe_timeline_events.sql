-- Describe timeline_events: the 53 columns with no COMMENT ON COLUMN (9 of 62 described before, catalog count on prod,
-- 2026-10-06) and three corrected facts in the table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-06 UTC):
--   Columns, types, defaults, constraints, indexes, policies and existing comments from pg_attribute, pg_constraint,
--   pg_indexes, pg_policy and pg_description. Writers from code at origin/main 46f8bcbae (supabase/functions,
--   supabase/migrations, scripts, nuke_frontend/src, apps), git history for deleted writers, the 11 triggers on
--   timeline_events, the body of every live public SQL function that names the table (88) and the triggers that run
--   them, pg_cron (no job runs these writers) and pipeline_registry (no timeline_events rows).
--   "Filled" means non-NULL and, for text, non-blank; booleans count true; json and arrays count non-empty.
-- LIMITS:
--   Two populations, because the table is mostly listing-derived and owner rows are under 1% of it:
--   (1) The table: one block sample, TABLESAMPLE SYSTEM (0.5) REPEATABLE (20261006), 6,417 of about 1.22M rows
--       (created 2025-12-02 .. 2026-10-06; 879 created in the last 30 days), cross-checked against ANALYZE statistics
--       (pg_stats, 30,000-row sample, newest created_at in it 2026-09-29). Block sampling clusters rows of similar
--       age, so small table percentages are rough.
--   (2) Rows with a user_id: all 11,245 of them (4 accounts, created 2025-09-07 .. 2026-09-28), read through the
--       user_id index. Most owner-entered columns live here.
--   Exact counts where an index allows it: mileage_at_event, organization_id, work_order_id, labor_hours above 0,
--   is_monetized and the event_date range. No full-table scan was run (1.9 GB heap; the read API stops a statement
--   at 10 s). "Empty everywhere measured" means empty in both populations and in ANALYZE statistics.
--   Writer attribution is from code and from row stamps (source, data_source, source_type, metadata keys). Deleted
--   writers are named from git history; otherwise the comment says the writer is not established.
--   Quoted values are categorical codes only: no names, handles, contacts, URLs, ids or amounts.
-- CHANGED EXISTING COMMENTS:
--   None of the 9 column comments.
--   Table comment: the grain read "one event on one vehicle", but vehicle_id is NULL on 3.3% of rows; the writer list
--   named functions whose inserts the table rejects and left out the largest writers; the event_date range came from
--   a 1% sample and is now read from the event_date index.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.timeline_events IS
'Vehicle history events: one row per dated event, usually on one vehicle: listing, sale, bid, mileage reading, photo day, work, communication (grain: one event). vehicle_id is NULL on 3.3% of rows (2026-10-06 sample): communications, health data and one-photo events for unattributed photos. Event time = event_date, a date whose meaning differs by writer (see that column); 1870-10-15 .. 2034-07-26, with 2,410 rows dated after 2026-10-06 (index read). Ingest time = created_at. Writers by volume (ANALYZE statistics and the 2026-10-06 sample): extract-bat-core (auction results and mileage readings; the live writer), the deleted bat-extract (source bat_import, 2026-01-23 .. 2026-02-16), scripts/map-comments-to-timeline.ts (one event per auction comment, 2026-01-23), create_auction_timeline_event() through trigger track_auction_transitions on the retired external_listings (until 2026-04), trigger trg_auto_group_photos on vehicle_images (photo-day events), then smaller extractors, scripts and the web app. Several code writers cannot insert, because they send CHECK-rejected values or columns the table lacks; the column comments name them. The creating migration calls it immutable history, but RLS lets vehicle owners update and delete rows, and the vehicle and user foreign keys cascade deletes.';

-- ── Identity, attribution and clocks ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.timeline_events.id IS
'Surrogate key of the event. Unit: none (uuid). Source: gen_random_uuid() default; create_timeline_event_from_work_session() passes one explicitly. Referenced by 8 foreign keys from 8 tables (auction_listing_images, device_attributions, generated_invoices, image_sets, image_tags, timeline_event_comments, work_order_labor, work_order_parts; 2026-10-06); vehicle_images.timeline_event_id also points here, without a foreign key. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.vehicle_id IS
'Vehicle the event belongs to, FK to vehicles.id (ON DELETE CASCADE: deleting a vehicle deletes its events). NULL on 211 of the 6,417 sampled rows (3.3%; ANALYZE statistics 3.2%) and on 10,423 of the 11,245 rows with a user_id: communications (whatsapp_ingest, call_history), health data (apple_health_export) and the one-photo events trg_auto_group_photos creates for photos with no vehicle. Set at insert by every writer; repointed by the vehicle merge functions (merge_duplicate_vehicles, merge_vehicle_into_primary_by_url, merge_craigslist_duplicates_by_image_signature, auto_merge_duplicates_with_notification, rehydrate_profile_merge). The owner RLS policies join through it. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.user_id IS
'Account that created the event, FK to auth.users.id (ON DELETE CASCADE: deleting the account deletes its events). Default auth.uid(), so web app inserts carry the signed-in account and service-role writers leave it NULL unless they pass one; the RLS insert policies require it to equal auth.uid(). Filled on 11,245 rows (index read, 2026-10-06; 4 accounts; created 2025-09-07 .. 2026-09-28), 0.5% of the sample: photo-day events, which take the user_id of the photo that opened them (trg_auto_group_photos, 94% of these rows), web app events and the whatsapp_ingest communications. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.created_at IS
'When the row was written (ingest time). Default now(); extract-bat-core and scripts/map-comments-to-timeline.ts pass the current time explicitly. 2025-12-02 .. 2026-10-06 in the 2026-10-06 sample (879 of 6,417 rows created in the last 30 days); the earliest found is 2025-09-07 (rows with a user_id). Batch backfills share one day: every comment copy carries 2026-01-23. Not the event time: use event_date. Unit: timestamptz. Grain: one event. Clock: ingest time.';
COMMENT ON COLUMN public.timeline_events.updated_at IS
'Last write to the row. Default now(); trigger update_timeline_events_updated_at sets it to now() on every UPDATE, for example when trg_auto_group_photos appends a photo, a merge repoints the vehicle, sync_work_order_to_timeline() rebuilds a receipt or update_timeline_tags_trigger() rewrites manual_tags. Equals created_at on rows never updated. Unit: timestamptz. Grain: one event. Clock: ingest time (last write).';
COMMENT ON COLUMN public.timeline_events.event_date IS
'When the event happened (event time), as a date with no time of day. What it marks depends on the writer: on extract-bat-core auction_sold, auction_reserve_not_met, auction_ended and mileage_reading rows, the auction end date; on its auction_listed rows, the day of the first comment or bid, else the end date minus 7 days (metadata.listed_at holds the moment); on create_auction_timeline_event() rows, the listing sold_at, end_date or start_date, falling back to CURRENT_DATE; on comment copies, the day the comment was posted; on photo-day events, DATE(vehicle_images.taken_at), which on BaT link images was the import day (290 of the 437 sampled photo events with no user_id fall on their created_at day); apply_auction_listing_outcome_to_vehicle_timeline() writes CURRENT_DATE. NOT NULL, no range CHECK: 1870-10-15 .. 2034-07-26, 2,410 rows dated after 2026-10-06, 3 of them more than 30 days ahead (index read, 2026-10-06). Grain: one event. Clock: event time.';

-- ── What happened ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.timeline_events.event_type IS
'Kind of event. CHECK timeline_events_event_type_check (NOT VALID, so rows older than the CHECK are not verified) allows 39 values: purchase, sale, registration, inspection, maintenance, repair, modification, accident, insurance_claim, recall, ownership_transfer, lien_change, title_update, mileage_reading, other, pending_analysis, profile_merge, profile_merged, vehicle_added, vin_added, work_completed, service, auction_listed, auction_started, auction_bid_placed, auction_reserve_met, auction_extended, auction_ending_soon, auction_ended, auction_sold, auction_reserve_not_met, photo_session, work_session, payment, communication, parts_received, milestone, daily_movement, health_data. ANALYZE statistics see 17 values: auction_sold 32.5%, auction_listed 21.1%, mileage_reading 13.3%, other 13.2% (mostly the comment copies of scripts/map-comments-to-timeline.ts), pending_analysis 8.2% (photo-day events), auction_bid_placed 6.4%, auction_reserve_not_met 3.2%, then repair, auction_started, auction_ended, communication and daily_movement. Rows with a user_id are 94% pending_analysis, then maintenance and communication. Code that sends discovery (process-cl-queue) or manual_edit (admin-update-vehicle-field) is rejected by the CHECK; batch_image_upload and image_upload, named by a unique index and a delete trigger, are outside it too. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.source IS
'Writer or platform stamp, free text with no CHECK (37 distinct values in ANALYZE statistics). bat 52.8%: extract-bat-core, the comment copies of BaT comments and the bat-multisignal-postprocess repair claims. bat_import 22.5%: the deleted bat-extract (2026-01-23 .. 2026-02-16). photo_upload 8.2%: trg_auto_group_photos. Bring a Trailer 7.6% and Barrettjackson, Pcarmarket, Bonhams, Cars_And_Bids, Classic_Com: create_auction_timeline_event(), which writes Bring a Trailer for the bat platform and initcap of any other external_listings platform. cars_and_bids, sbx_cars and auction: more comment copies (the comment platform). Smaller: bonhams_import (an earlier extract-bonhams; its README still describes these writes), rmsothebys_import (extract-rmsothebys), hagerty_import (extract-hagerty-listing), wayback (the deleted ingest-wayback-vehicle), historics_import (extract-historics-uk), nzero_auction (apply_auction_listing_outcome_to_vehicle_timeline()), call_history, apple_health_export and whatsapp_ingest (writers not in the repo, all created 2026-04-11). On rows with a user_id also ai_agent_detected (the deleted ai-agent-supervisor), ai_consolidated (scripts/consolidate_timeline_events.js), Dropbox Import and other web app labels. The same platform appears under several spellings. NOT NULL. data_source and source_type are separate stamps. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.title IS
'Short headline of the event, generated from a writer template: Sold at Auction, Auction Started and Listed for Sale (create_auction_timeline_event()); BaT sold for, BaT ended and Listed on Bring a Trailer with the lot number (extract-bat-core); Mileage: N miles; N photos from <date> (trg_auto_group_photos rewrites it as photos are added); <commenter>: <comment type> or <commenter> placed bid on comment copies, which carry the public commenter handle. Owner-private on communication rows. NOT NULL. Feeds search_vector at weight A. 4,204 distinct values among the 6,417 sampled rows, 9 .. 76 characters across both populations. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.description IS
'Free-text body of the event: the comment text on comment copies (cut at 2,000 characters by scripts/map-comments-to-timeline.ts); template sentences on auction and mileage rows (Odometer reading captured from listing details.); AI analysis pending on photo-day events; work descriptions on web app rows. Communication rows are owner-private. Filled on 99.4% of the 2026-10-06 sample and 99.9% of the rows with a user_id. Feeds search_vector at weight B. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.event_category IS
'Coarse category. CHECK allows ownership, maintenance, legal, performance, cosmetic and safety. Stored: ownership, set by create_auction_timeline_event() and apply_auction_listing_outcome_to_vehicle_timeline() on every auction event they write (10.7% in ANALYZE statistics), and maintenance (0.7%), from the bat-multisignal-postprocess repair claims; analyze-vehicle-documents and the web app would also write maintenance. Most writers, extract-bat-core included, leave it NULL. Filled on 11.1% of the 2026-10-06 sample and on none of the rows with a user_id. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.activity_type IS
'Unknown meaning: no writer or reader of this column in the repo or in live SQL (activity_type in the code belongs to other tables), no CHECK, and empty everywhere measured (2026-10-06 sample, 11,245 rows with a user_id, ANALYZE statistics). UNUSED. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.mileage_at_event IS
'Odometer reading as of the event. Unit: miles as the source publishes them (no unit column). Source: extract-bat-core mileage_reading rows, which carry the listing mileage dated by the auction end date (all 943 sampled values); analyze-vehicle-documents (receipt mileage), scripts/craigslist-import and scripts/ingest-collective-auto-full.cjs. A seller claim on listing rows, not an inspected reading. Read by get_vehicle_mileage_history() and partial index idx_timeline_events_vehicle_mileage. 182,009 rows filled (index read, 2026-10-06), 1 .. 4,800,000 with outliers present; 14.7% of the sample; 1 of the rows with a user_id. Grain: one event. Clock: as of event_date.';
COMMENT ON COLUMN public.timeline_events.duration_hours IS
'How long the event lasted. Unit: hours, numeric(5,2). Source: create_timeline_event_from_work_session() (work_sessions.duration_minutes divided by 60, rounded to 0.1) and the web app work forms; the call_history import (writer not in the repo) filled it on 3 of the 15 sampled call rows (0 .. 1.6). generate-work-logs, the remaining code writer, is dead. Filled on 0.05% of the 2026-10-06 sample (ANALYZE statistics 0.02%); none of the rows with a user_id. Grain: one event. Clock: n/a.';

-- ── Money ───────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.timeline_events.cost_amount IS
'Money amount attached to the event; on most rows a price, not a cost to the owner. By writer: the sale price on auction_sold rows and the high bid on auction_reserve_not_met and auction_ended rows (extract-bat-core, create_auction_timeline_event(), apply_auction_listing_outcome_to_vehicle_timeline()); the bid on create_auction_timeline_event() auction_bid_placed rows; the job total on work-session events (create_timeline_event_from_work_session()); receipt totals from analyze-vehicle-documents and the web app invoice uploader. The comment copies keep bid amounts in metadata, not here. Unit: USD by convention (see cost_currency), numeric(10,2). Filled on 25.1% of the 2026-10-06 sample (ANALYZE statistics 24.3%) and on 5 of the 11,245 rows with a user_id. Grain: one event. Clock: as of event_date.';
COMMENT ON COLUMN public.timeline_events.cost_currency IS
'Currency of cost_amount; USD is the only stored value. Default USD, so rows with no amount carry it too; extract-bat-core writes NULL when it has no amount (its auction_listed rows), which is the 9.4% NULL in the 2026-10-06 sample (ANALYZE statistics 7.9%). No CHECK. Unit: ISO 4217 code. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.cost_estimate IS
'Estimated cost of the work, by name. UNUSED: no live writer (only the dead generate-work-logs code names it) and empty everywhere measured. Unit: USD by convention. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.is_monetized IS
'Whether the event is billed client work, by name; declared 2025-11-22 beside client_id, with index idx_timeline_events_monetized. UNUSED: default false, no writer, and true on no row (index read, 2026-10-06). Unit: boolean. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.client_id IS
'Client (customer) the work was done for, FK to clients.id; declared 2025-11-22 with the client billing tables. UNUSED: no writer, and empty everywhere measured. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.contract_id IS
'Work contract whose terms apply to the event: generate_invoice_from_event() and calculate_event_tci_with_rates() read it as a work_contracts id, but there is no foreign key. UNUSED: no writer, and empty everywhere measured. Unit: none (uuid). Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.applied_labor_rate IS
'Labor rate applied to the event, by name. UNUSED: no writer or reader of this column in the repo or in live SQL, and empty everywhere measured. Unit: USD per hour by convention, numeric(8,2). Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.applied_shop_rate IS
'Shop rate applied to the event, by name. UNUSED: no writer or reader of this column in the repo or in live SQL, and empty everywhere measured. Unit: USD per hour by convention, numeric(8,2). Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.rate_source IS
'Where the applied rates came from. CHECK allows contract, shop_default, user_default and custom. UNUSED on this table: calculate_event_tci_with_rates() writes its rate_source to event_financial_records, nothing writes this column, and it is empty everywhere measured. Unit: none. Grain: one event. Clock: n/a.';

-- ── Work, provider and place ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.timeline_events.labor_hours IS
'Labor time of the work. Unit: hours. Above 0 on 312 rows (partial-index read, 2026-10-06; 0.25 .. 40): 189 ai_agent_detected maintenance events (the deleted ai-agent-supervisor, 2025-10-16), 72 ai_consolidated (scripts/consolidate_timeline_events.js, 2025-10-16), 34 work_session events linked to work orders (2026-03-26 .. 2026-04-07, writer not established) and 17 from an early generate-work-logs (2025-11-02). The AI rows hold model estimates from photos, not clocked time. analyze-vehicle-documents would write receipt labor hours. Read by the labor and ROI functions and partial index timeline_events_vehicle_labor. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.work_started IS
'When the work began. Source: bat-multisignal-postprocess (2026-01-13 .. 2026-03-29, deleted) wrote midnight UTC of the prior auction date when a vehicle had one; no measured row has it. Empty everywhere measured. Unit: timestamptz. Grain: one event. Clock: event time (start).';
COMMENT ON COLUMN public.timeline_events.work_completed IS
'When the work was finished. Source: bat-multisignal-postprocess (2026-01-13 .. 2026-03-29, deleted) wrote midnight UTC of the listing date after which a claimed repair was described, so the value is an upper bound, not a completion time. The web app timeline reads it. Filled on the 39 sampled repair claims (0.6% of the 2026-10-06 sample; 2020-01-21 .. 2026-01-26) and about 0.7% in ANALYZE statistics; none of the rows with a user_id. Unit: timestamptz. Grain: one event. Clock: event time (upper bound).';
COMMENT ON COLUMN public.timeline_events.work_order_id IS
'Work order the event documents, FK to work_orders.id (ON DELETE SET NULL); declared in 20251214000020_spend_attribution_ledger. sync_work_order_to_timeline() finds the event by it and rebuilds the receipt in metadata. Filled on 37 rows (index read, 2026-10-06): 34 work_session events (2026-03-26 .. 2026-04-07) and 3 work_order service events (2026-02-04 .. 2026-03-28). The writer that set it is not established in the repo. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.organization_id IS
'Organization involved in the event (shop, dealer), FK to organizations.id (ON DELETE SET NULL). Set by trigger trg_link_org_from_timeline_event (fuzzy match of service_provider_name against the businesses view, similarity above 0.5), auto_link_gps_organizations() (no caller), scripts/link-orgs-from-work-category.js, scripts/backfill-image-gps-and-orgs.js and web app imports. Triggers trg_link_org_from_timeline_event and trg_create_org_timeline_from_vehicle copy the link into organization_vehicles and business_timeline_events. Filled on 91 rows (index read, 2026-10-06): 60 forensic_image_bundle maintenance events (2025-12-05, writer not established), 17 from an early generate-work-logs (2025-11-02) and 14 ai_consolidated. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.service_provider_name IS
'Name of the shop or person who did the work, free text; not an organization key (organization_id is). Source: analyze-vehicle-documents (receipt shop name), the web app bundle review and receipt screens, scripts/link-orgs-from-work-category.js and scripts/backfill-image-gps-and-orgs.js; auto_link_gps_organizations() (no caller) would copy a matched organization name. Trigger trg_link_org_from_timeline_event fuzzy-matches it to fill organization_id. Filled on 121 of the 11,245 rows with a user_id: 60 photo-day events (values set 2025-12-04 .. 2026-04-11, writer not established), 60 ai_consolidated and 1 document event; none in the 2026-10-06 sample. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.service_provider_type IS
'Kind of provider. CHECK allows dealer, independent_shop, mobile_mechanic, diy, specialty_shop, tire_shop, body_shop, detailer and other. On the rows with a user_id: diy 8, independent_shop 5, specialty_shop 1 (web app work events of 2025-10-31 and 2025-11-23). analyze-vehicle-documents writes independent_shop. ANALYZE statistics see only independent_shop (0.01%). Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.location_name IS
'Name of the place where the event happened (a shop or venue name), free text. Source: analyze-vehicle-documents (shop location from a receipt), scripts/backfill-image-gps-and-orgs.js, scripts/ingest-collective-auto-full.cjs. Feeds search_vector at weight C. Filled on 1 of the 11,245 rows with a user_id, none in the 2026-10-06 sample, about 0.01% in ANALYZE statistics. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.location_address IS
'Street address of the event location, by name; declared in 20250831100000_enhance_timeline_events. UNUSED on prod: only scripts/ingest-collective-auto-full.cjs names it, and it is empty everywhere measured. An address would be owner-private. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.location_coordinates IS
'Coordinates of the event location, by name (point; axis order not declared); declared in 20250831100000_enhance_timeline_events. UNUSED: no writer or reader in the repo or in live SQL, and empty everywhere measured. Unit: none. Grain: one event. Clock: n/a.';

-- ── Receipt and record fields ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.timeline_events.invoice_number IS
'Invoice or receipt number of the work. Source: analyze-vehicle-documents (receipt extraction) and the web app invoice uploader (SmartInvoiceUploader). Empty everywhere measured. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.receipt_data IS
'Structured receipt fields of the work, a JSON object; default {}. analyze-vehicle-documents writes invoice_number, labor_hours, labor_rate, labor_cost, parts_cost, subtotal, tax_amount, payment_method, technician_name, shop_phone, shop_email and warranty_info; the web app invoice uploader writes its own shape. Contact details and amounts here would be owner-private. Empty everywhere measured. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.warranty_info IS
'Warranty terms of the work, JSON; analyze-vehicle-documents writes an object with a terms key. Declared in 20250831100000_enhance_timeline_events. Empty everywhere measured. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.parts_used IS
'Parts used in the work, by name: an array of JSON part records per its declaring migration 20250831100000_enhance_timeline_events. UNUSED: no writer in the repo or in live SQL, and empty everywhere measured. Part detail lives in work_order_parts, parts_mentioned and metadata. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.parts_mentioned IS
'Part names mentioned for the event, a free-text array; default {}. Not keyed to catalog_parts. Source: bat-multisignal-postprocess (one claimed repair item per BaT repair claim, 2026-01-13 .. 2026-03-29, deleted), analyze-vehicle-documents (parts replaced on a receipt), the web app work-memory capture. Non-empty on 0.6% of the 2026-10-06 sample (the 39 repair claims) and on 24 of the 11,245 rows with a user_id. Unit: none (text[]). Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.tools_mentioned IS
'Tool names mentioned for the event, by name. UNUSED: default {}, no writer, and non-empty on no row measured. Unit: none (text[]). Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.verification_documents IS
'Receipts, invoices or photos that verify the event, by name: an array of JSON per 20250831100000_enhance_timeline_events. UNUSED: no writer or reader, and empty everywhere measured. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.is_insurance_claim IS
'Whether the event was an insurance claim, by name. UNUSED: default false, no writer, and true on no row measured. Unit: boolean. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.insurance_claim_number IS
'Insurance claim number, by name. UNUSED: no writer, and empty everywhere measured. A claim number would be owner-private. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.next_service_due_date IS
'Date the next service is due after this event, by name. UNUSED: no writer, and empty everywhere measured. Unit: date. Grain: one event. Clock: n/a (a planned date).';
COMMENT ON COLUMN public.timeline_events.next_service_due_mileage IS
'Odometer reading at which the next service is due, by name. UNUSED: no writer, and empty everywhere measured. Unit: miles. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.quality_justification IS
'Text justifying quality_rating. Source: generate-work-logs, dead since 2026-07-06 by the code notes, whose insert also omits the NOT NULL source column. Empty everywhere measured. Unit: none. Grain: one event. Clock: n/a.';

-- ── Stamps, tags and payloads ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.timeline_events.data_source IS
'Second writer stamp, free text with no CHECK. Default user_input, which most writers leave in place (44.6% in ANALYZE statistics, including the bat_import, photo-day and create_auction_timeline_event() rows), so user_input here does not mean a person entered the row. Set explicitly: extract-bat-core 35.6%; bat_description 19.5%, the scripts/map-comments-to-timeline.ts copies of auction comments, not listing descriptions; call_history and healthkit (writers not in the repo); auction_scheduler (apply_auction_listing_outcome_to_vehicle_timeline()); ai_extraction (analyze-vehicle-documents); ai_auto and receipt on a few web app rows. 6 rows with a user_id hold a listing URL instead of a stamp. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.source_type IS
'Kind of record the event comes from. CHECK timeline_events_source_type_check (NOT VALID) allows user_input, service_record, government_record, insurance_record, dealer_record, manufacturer_recall, inspection_report, receipt, system, healthkit, imessage, contacts and call_history. Default user_input, which most writers leave in place. ANALYZE statistics: system 36.4% (extract-bat-core, bat-multisignal-postprocess, the call_history import), user_input 33.2%, service_record 19.5% (the auction comment copies, which are not service records), dealer_record 10.7% (create_auction_timeline_event(), apply_auction_listing_outcome_to_vehicle_timeline(), the web app Dropbox import), then healthkit, imessage (the whatsapp_ingest rows) and receipt. Code that sends photo_session (auto-create-bundle-events) or image (create-work-session-from-evidence) is rejected by the CHECK. NOT NULL. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.confidence_score IS
'Writer-assigned confidence in the event, 0 .. 100 (CHECK). A fixed constant per writer, not a measured probability: 85 on extract-bat-core auction rows, 90 on its mileage readings and on the comment copies, 95 on create_auction_timeline_event() and apply_auction_listing_outcome_to_vehicle_timeline() sales, 35 on the bat-multisignal-postprocess repair claims, 65 on the wayback rows, and the default 50 on bat_import, photo-day and most web app rows. ANALYZE statistics: 50 at 33.3%, 90 at 32.9%, 85 at 22.3%, 95 at 10.7%, 35 at 0.7%. update_timeline_event_confidence() could change it but has no caller. Unit: score 0 .. 100. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.metadata IS
'Writer-specific attributes, a JSON object; default {}. Keys by writer: extract-bat-core source_url (with vehicle, type and date, its idempotency key), lot_number, seller_username, buyer_username, reserve_status, sale_price, high_bid, bid_count, comment_count, listed_at and listed_at_source, occurred_at and occurred_at_source (the exact close); create_auction_timeline_event() listing_id, platform, listing_url, auction_data and affects_value plus the transition payload; comment copies auction_comment_id (the auction_comments row), content_hash, author_username, bid_amount, posted_at and other comment fields; photo-day events photo_count, needs_ai_analysis, device_fingerprint, created_at and last_photo_added; repair claims dedupe_key, needs_receipt, window_after, window_before, auction_event_id and extraction; work order events the receipt sync_work_order_to_timeline() builds. Communication and manual rows carry owner-private fields. Handles and ids inside are text, not foreign keys. Unit: none. Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.image_urls IS
'Links shown with the event. On photo-day events (trg_auto_group_photos) the vehicle_images.image_url of each photo added that day, up to 389 on one event among the rows with a user_id. On create_auction_timeline_event() rows it holds the listing URL, not an image (518 of the 664 sampled dealer_record rows with a value). Also written by the web app and import scripts. Filled on 17.7% of the 2026-10-06 sample and 96.8% of the 11,245 rows with a user_id. Unit: none (text[] of URLs). Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.automated_tags IS
'Tags from automated analysis, by name. UNUSED: default {}, no live writer (only the dead generate-work-logs code names it), and non-empty on no row measured. Unit: none (text[]). Grain: one event. Clock: n/a.';
COMMENT ON COLUMN public.timeline_events.manual_tags IS
'Tags people put on the event photos: trigger trigger_update_timeline_tags on image_tags (update_timeline_tags_trigger()) rewrites it as the distinct tag_name values of the image_tags rows that carry this event id. Default {}; non-empty on no row measured. Unit: none (text[]). Grain: one event. Clock: derived (as of the last image_tags write).';
COMMENT ON COLUMN public.timeline_events.photo_analysis IS
'Aggregated analysis of the event photos, a JSON object; default {}. Source: backfill_photo_analysis(), which has no caller in the repo or pg_cron. Non-empty on 1 of the 11,245 rows with a user_id and on no sampled row. Unit: none. Grain: one event. Clock: derived (as of the backfill).';

-- A column added between this PR and its deploy must not block the deploy: report, never raise.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.timeline_events'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'timeline_events: every column has a comment';
  ELSE
    RAISE NOTICE 'timeline_events columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
