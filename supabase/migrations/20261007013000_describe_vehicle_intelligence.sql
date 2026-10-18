-- Describe vehicle_intelligence: the 70 columns with no COMMENT ON COLUMN (6 of 76 described before, catalog count on
-- prod, 2026-10-07) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-07 UTC):
--   Columns, types, defaults, constraints, indexes, policies, grants and existing comments from pg_attribute,
--   pg_constraint, pg_indexes, pg_policy, information_schema and pg_description. Writers from code at origin/main
--   c0caca988 (supabase/functions, supabase/migrations, database/migrations, scripts, nuke_frontend/src, mcp-servers,
--   apps) and git history: the edge function analyze-vehicle-description (added 2026-01-23, deleted 2026-03-09; read
--   at 34d110a38^) and scripts/extract-description-intelligence.py (added 2026-02-14). No live SQL function names the
--   table, no pg_cron job runs a writer, pipeline_registry has no rows for it, and its one trigger only stamps
--   updated_at. The only database object that reads it is the view v_vehicle_intelligence_full.
--   Fill is measured on the whole table: 83,018 rows. "Filled" means non-NULL and, for text, non-blank; json and arrays
--   count non-empty. Every boolean in the table is true or NULL; none is false.
-- LIMITS:
--   The two writers ran by hand and left no run log in the database; their runs are dated by created_at and
--   extraction_version. Every value is a regular-expression hit on seller description text (one row also has an LLM
--   reading). These comments state what each pattern matches, not whether the claims are true.
--   Quoted values are categorical codes and the words the patterns match: no names, contacts, URLs, ids or amounts.
-- CHANGED EXISTING COMMENTS:
--   None of the 6 column comments.
--   Table comment: it said the data came from vehicle descriptions and auction comments; nothing from auction comments
--   was ever written. It now names the grain, the two writer runs, the coverage and the clocks.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_intelligence IS
'Keyword flags and values read from vehicles.description by regular expressions: one row per vehicle (grain: one vehicle; UNIQUE vehicle_id, foreign key to vehicles ON DELETE CASCADE). 83,018 rows (2026-10-07), written in two runs and never updated: 100 on 2026-01-24 by the edge function analyze-vehicle-description (deleted 2026-03-09; 99 regex rows and 1 row with an LLM reading) and 82,918 on 2026-02-14 by scripts/extract-description-intelligence.py (regex only). About 46% of vehicles carry a description over 40 characters (1% block sample of vehicles, 2026-10-07; about 464,000), so the table covers about 18% of them, as of those two days. Each value is a hit on seller wording, a mention rather than a verified fact; booleans are true or NULL, never false. Nothing from auction comments was ever written: the comment columns (seller_disclosures, expert_insights, comparable_sales, condition_concerns, reliability_notes) and the columns added by database/migrations/20260124_expand_intelligence_schema.sql are empty. No writer is scheduled; the only database reader is the view v_vehicle_intelligence_full, which no code reads. Ingest time = extracted_at = created_at; there is no event time, and the description text that was read is not kept.';

-- ── Identity and extraction run ─────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.id IS
'Surrogate key of the row. Unit: none (uuid). Source: gen_random_uuid() default. No foreign key points at it; vehicle_id is the working key (one row per vehicle). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.vehicle_id IS
'Vehicle whose description was read, foreign key to vehicles.id (ON DELETE CASCADE: deleting the vehicle deletes this row) and UNIQUE, so one row per vehicle. Set by both writers: the edge function upserted on it, and the batch script skipped vehicles that already had a row (ON CONFLICT DO NOTHING). Joined by the view v_vehicle_intelligence_full. Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.extracted_at IS
'When the extraction ran: default now() at insert; neither writer passes it, so it equals created_at on every row: 2026-01-24 (100 rows) and 2026-02-14 (82,918 rows). Not when the description was written or published. The description text that was read is not kept, so a later edit of vehicles.description is not reflected. Unit: timestamptz. Grain: one vehicle. Clock: ingest time (extraction run).';
COMMENT ON COLUMN public.vehicle_intelligence.extraction_version IS
'Writer and pattern-set stamp, no CHECK. v1.0: the edge function analyze-vehicle-description (100 rows, 2026-01-24; deleted 2026-03-09). v1.0-batch: scripts/extract-description-intelligence.py (82,918 rows, 2026-02-14), the same Tier 1 patterns plus modification, known-issue and fuel-type patterns. Default v1.0. Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.extraction_confidence IS
'Fixed confidence the writer gave the whole row: 0.60 on the 83,017 regex rows and 0.85 on the one hybrid row (regex plus the LLM tier). A constant per method, not a measure per field or per claim. Unit: probability, numeric(3,2). Grain: one vehicle. Clock: n/a.';

-- ── Acquisition and ownership ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.acquisition_year IS
'Year the seller says the vehicle was acquired: the first match of acquired, purchased or bought (by the seller) (in) followed by a four-digit year in the description (the batch script keeps 1900 .. 2026; the edge function had no bound), or the LLM tier. Filled on 11,998 rows (14.5%; 1907 .. 2026, 2026-10-07). Read by v_vehicle_intelligence_full. A seller statement, not a title record. Unit: calendar year. Grain: one vehicle. Clock: event time (acquisition, as stated).';
COMMENT ON COLUMN public.vehicle_intelligence.acquisition_source IS
'How the seller acquired the vehicle (private, dealer, bat, estate, auction or family, by the creating file database/migrations/20260124_create_vehicle_intelligence.sql). UNUSED: only the LLM tier of the deleted edge function could write it, and its one LLM row has none; empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.previous_bat_sale_url IS
'Despite the name, not a URL: both writers store the literal word mentioned when the description says the vehicle was sold, listed or purchased on BaT or Bring a Trailer, and nothing otherwise. 1,368 rows (1.6%), one distinct value (2026-10-07). It records a mention, not which listing. Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.previous_bat_sale_price IS
'Price of an earlier BaT sale of the vehicle, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: USD by name (integer). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.owner_count IS
'Number of owners the description mentions: the first of the patterns one, single, 1st or first owner (1) through five, 5th or fifth owner (5) that matches anywhere in the text, so first owner wins even when a later owner is also mentioned; or the LLM tier. 4,126 rows (5.0%): 1 on 1,976, 2 on 1,728, 3 on 359, 4 on 57, 5 on 6 (2026-10-07). Read by v_vehicle_intelligence_full. A mention, not a title chain. Unit: count of owners. Grain: one vehicle. Clock: as of the description.';
COMMENT ON COLUMN public.vehicle_intelligence.notable_owner IS
'A notable owner named in the description (the LLM prompt asks for ownership.notable_owner). UNUSED: only the LLM tier could write it; empty on all rows (2026-10-07). Would name a person. Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.is_single_family IS
'Whether the vehicle stayed in one family, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: boolean. Grain: one vehicle. Clock: n/a.';

-- ── Service, modification and documentation ─────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.last_service_year IS
'Year of the last service the description mentions, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: calendar year. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.last_service_mileage IS
'Odometer reading at the last service the description mentions, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: miles by convention (integer). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.has_recent_service IS
'Whether the last service was within 2 years, by the creating file. UNUSED: no writer; empty on all rows (2026-10-07). Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.is_modified IS
'True when the description contains modified, upgraded, aftermarket, custom, swap or swapped (scripts/extract-description-intelligence.py; the edge function Tier 1 had no such pattern), or when the LLM tier said so (1 row). NULL otherwise and never false, so NULL does not mean stock. 32,303 rows (38.9%, 2026-10-07). A keyword hit: custom also matches phrases such as custom interior. Read by v_vehicle_intelligence_full. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.modification_level IS
'Coarse level the batch script assigned when is_modified matched: extensive when the description also names an engine swap, LS swap, turbo, supercharger, wide body, full custom or extensive modification; else moderate when it names performance, exhaust, intake, suspension, lowered, coilovers, big brakes or a tune; else mild. 32,302 rows: moderate 20,827, mild 8,648, extensive 2,827 (2026-10-07). The creating file also lists stock, which no writer sets; no CHECK. Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.parts_replaced IS
'Text fragments that follow replace or replaced in the description, a JSON array of strings: the batch script keeps up to 10 fragments of 3 .. 150 characters, the edge function kept every fragment of 3 .. 200 characters. Default []. Non-empty on 26,261 rows (31.6%; 1.62 fragments on average, 2026-10-07). Seller wording, not parts records and not keyed to a parts catalog. Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.has_service_records IS
'True when the description mentions service records, maintenance records or service history, or records reaching back to a year (see service_records_from_year); NULL otherwise, never false. 13,165 rows (15.9%, 2026-10-07). Read by v_vehicle_intelligence_full. A seller mention, not proof that the records exist. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.service_records_from_year IS
'Year the service records reach back to, from service record(s) (dating) (back) to or from a four-digit year in the description; it also sets has_service_records. 742 rows (0.9%; 1959 .. 2025, 2026-10-07). Unit: calendar year. Grain: one vehicle. Clock: event time (as stated).';
COMMENT ON COLUMN public.vehicle_intelligence.has_window_sticker IS
'True when the description mentions a window sticker or Monroney label; NULL otherwise, never false. 6,708 rows (8.1%, 2026-10-07). A mention, not a scanned document. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.has_owners_manual IS
'True when the description mentions an owners manual or any book or books (one pattern covers both), so service books and other books count; NULL otherwise, never false. 2,888 rows (3.5%, 2026-10-07). has_books is never written. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.has_books IS
'Whether books come with the vehicle, by name. UNUSED: no writer, because the pattern for books sets has_owners_manual instead; empty on all rows (2026-10-07). Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.has_tools IS
'True when the description mentions a tool roll, tool kit or tools; NULL otherwise, never false. 5,259 rows (6.3%, 2026-10-07). Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.has_spare_key IS
'True when the description mentions a spare key; NULL otherwise, never false. 48 rows (0.06%, 2026-10-07). Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.documentation_list IS
'List of documents that come with the vehicle, by name. UNUSED: default [], no writer, empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';

-- ── Condition ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.is_running IS
'True when the description says running and driving or runs and drives; the same match sets is_driving. NULL otherwise, never false. 886 rows (1.1%, 2026-10-07), the same rows as is_driving. Unit: boolean. Grain: one vehicle. Clock: as of the description.';
COMMENT ON COLUMN public.vehicle_intelligence.is_driving IS
'True when the description says running and driving or runs and drives; always set together with is_running, never on its own. NULL otherwise, never false. 886 rows (1.1%, 2026-10-07). Unit: boolean. Grain: one vehicle. Clock: as of the description.';
COMMENT ON COLUMN public.vehicle_intelligence.is_project IS
'True when the description contains project, barn find, needs work, non-running or not running; NULL otherwise, never false. 3,747 rows (4.5%, 2026-10-07), 418 of them also is_restored. Any use of the word project counts, including a finished one. Unit: boolean. Grain: one vehicle. Clock: as of the description.';
COMMENT ON COLUMN public.vehicle_intelligence.is_restored IS
'True when the description contains restored, restoration, frame-off or rotisserie; NULL otherwise, never false. 8,006 rows (9.6%, 2026-10-07). Any mention counts, including partial or planned work. Read by v_vehicle_intelligence_full. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.restoration_year IS
'Year of the restoration, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: calendar year. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.known_issues IS
'Seller-stated issues, a JSON array of strings: the batch script keeps up to 5 fragments that follow known issue(s) or noted:, or needs, requiring or requires; the LLM tier would add condition.known_issues. Default []. Non-empty on 14,031 rows (16.9%, 2026-10-07). Seller wording, not an inspection. Unit: none. Grain: one vehicle. Clock: as of the description.';
COMMENT ON COLUMN public.vehicle_intelligence.seller_condition_notes IS
'Seller condition notes from the LLM tier (condition.seller_notes). UNUSED: the one LLM row has none; default [], empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';

-- ── Provenance and climate ──────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.registration_states IS
'States the vehicle was registered in, by name. UNUSED: default [], no writer, empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.original_delivery_dealer IS
'Dealer that delivered the vehicle new, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.original_delivery_location IS
'Place where the vehicle was delivered new, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.climate_history IS
'Climate the vehicle lived in (dry, mixed, winter or coastal, by the creating file). UNUSED: no writer; empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.rust_belt_exposure IS
'Whether the vehicle spent time in the rust belt, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.is_rust_free IS
'True when the description says rust-free, rust free, no rust or zero rust; NULL otherwise, never false. 669 rows (0.8%, 2026-10-07). Read by v_vehicle_intelligence_full. A seller claim. Unit: boolean. Grain: one vehicle. Clock: as of the description.';
COMMENT ON COLUMN public.vehicle_intelligence.is_california_car IS
'True when the description says California car, CA car or remained (registered) in California; NULL otherwise, never false. 768 rows (0.9%, 2026-10-07). A seller phrase, not a registration record. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.never_winter_driven IS
'True when the description says never seen snow, dry climate, never driven or used in winter, or garaged winters; NULL otherwise, never false. 22 rows (0.03%, 2026-10-07). Unit: boolean. Grain: one vehicle. Clock: n/a.';

-- ── Authenticity ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.matching_numbers IS
'True when the description says numbers matching or matching numbers, or when the LLM tier said so; NULL otherwise, never false. 3,410 rows (4.1%, 2026-10-07). A seller claim, not a verified match. Read by v_vehicle_intelligence_full. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.matching_components IS
'Components that match the factory record, for a partial match, by the creating file. UNUSED: default [], no writer, empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.is_repainted IS
'True when the description contains refinished in, repainted, respray or new paint, or when the LLM tier said so; NULL otherwise, never false. 25,082 rows (30.2%, 2026-10-07). The pattern matches any refinished in phrase, so wheels or trim refinished in a color also count. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.repaint_color IS
'Color of the repaint, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.repaint_year IS
'Year of the repaint, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: calendar year. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.is_original_color IS
'True when the description says original color or paint, factory color or paint, or born with; NULL otherwise, never false. 1,676 rows (2.0%, 2026-10-07), 665 of them also is_repainted, as when a car was refinished in its original color. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.replacement_components IS
'Non-original components, from the LLM tier (authenticity.replacement_components). UNUSED: the one LLM row has none; default [], empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.authenticity_notes IS
'Notes on originality, by name. UNUSED: default [], no writer, empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';

-- ── Awards and rarity ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.is_concours_quality IS
'True when the description contains the word concours; NULL otherwise, never false. 921 rows (1.1%, 2026-10-07). A mention of the word, not a judged result. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.is_show_winner IS
'True when the regex filled awards, that is when the description names NCRS Top Flight, Bloomington Gold or PCA; NULL otherwise, never false. 579 rows (0.7%, 2026-10-07). Any mention of PCA counts as an award. The one LLM row has awards but no flag. Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.production_number IS
'The N of a #N of M or N/M pattern in the description, or the LLM tier. Filled on 32,177 rows (38.8%, 2026-10-07), but these are mostly not production numbers: the most common pairs with total_production are tire sizes (205/55 on 1,025 rows, 235/75 on 1,001), production_number exceeds total_production on 27,827 rows, and the maximum is 437,984,124. Not usable as a build number without re-extraction. Unit: count. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.total_production IS
'Claimed production total: the N of one of (only) N, replaced by the M of a #N of M or N/M pattern when that also matches, or the LLM tier. Filled on 34,263 rows (41.3%; median 60, maximum 23,212,896, 2026-10-07), mostly tire aspect ratios and other fractions (see production_number). Read by v_vehicle_intelligence_full. Unit: count. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.special_edition_name IS
'Name of the special edition, by name. UNUSED: no writer; empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.is_limited_edition IS
'True when the description says limited edition, special edition or anniversary edition; NULL otherwise, never false. 945 rows (1.1%, 2026-10-07). Unit: boolean. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.rarity_notes IS
'Rarity notes from the LLM tier (rarity.notes). UNUSED: the one LLM row has none; default [], empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';

-- ── Community intelligence (never written) ──────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.comparable_sales IS
'Comparable sales cited in auction comments, by the creating file (community intelligence). UNUSED: no writer ever read comments into this table; default [], empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.condition_concerns IS
'Condition concerns raised in auction comments, by the creating file. UNUSED: no writer; default [], empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.reliability_notes IS
'Reliability notes from auction comments, by the creating file. UNUSED: no writer; default [], empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';

-- ── Raw extraction and row clocks ───────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.raw_tier1_extraction IS
'The Tier 1 regex findings for the row as one JSON object, kept for reprocessing; its keys are the typed column names that matched. The batch rows store parts_replaced, known_issues and awards inside it as JSON-encoded strings; the edge-function rows store arrays. {} on 1,328 rows (2026-10-07): 1,262 batch rows whose only finding was a fuel type, which the script wrote to vehicles.fuel_type instead of this table, and 66 edge-function rows with no finding. Unit: none. Grain: one vehicle. Clock: as of extracted_at.';
COMMENT ON COLUMN public.vehicle_intelligence.raw_tier2_extraction IS
'The LLM tier output (claude-3-haiku-20240307 in the deleted analyze-vehicle-description), a JSON object with keys acquisition, authenticity, awards, condition, modifications, ownership, rarity and service_events. Filled on 1 row (2026-01-24, extraction_method hybrid); NULL on the rest. Unit: none. Grain: one vehicle. Clock: as of extracted_at.';
COMMENT ON COLUMN public.vehicle_intelligence.created_at IS
'When the row was inserted: default now(), equal to extracted_at on every row: 2026-01-24 (100 rows) and 2026-02-14 (82,918 rows). Unit: timestamptz. Grain: one vehicle. Clock: ingest time.';
COMMENT ON COLUMN public.vehicle_intelligence.updated_at IS
'Last write to the row: default now(), and trigger vehicle_intelligence_updated_at sets now() on every UPDATE. No row has been updated: it equals created_at on all 83,018 rows (2026-10-07). Unit: timestamptz. Grain: one vehicle. Clock: ingest time (last write).';

-- ── Columns added by 20260124_expand_intelligence_schema.sql (never written) ────────────────────────────────────

COMMENT ON COLUMN public.vehicle_intelligence.numbers_extracted IS
'Numbers in the description (mileage, prices, years, production numbers) as structured data, by database/migrations/20260124_expand_intelligence_schema.sql. UNUSED: default {}, no writer, empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.parts_mentioned IS
'Parts named in the description, by the same expansion file. UNUSED: default {}, no writer, empty on all rows (2026-10-07); the view v_vehicle_intelligence_full still selects it. Unit: none (text[]). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.locations_mentioned IS
'Places named in the description, as an array of {name, type (city, state or country), context} by the same expansion file. UNUSED: default [], no writer, empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.people_mentioned IS
'People named in the description, as an array of {name, role (owner, shop, dealer or celebrity)} by the same expansion file. UNUSED: default [], no writer, empty on all rows (2026-10-07). Would name people. Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.key_dates IS
'Dated events in the description, as an array of {date, description, type (service, sale or registration)} by the same expansion file. UNUSED: default [], no writer, empty on all rows (2026-10-07). Unit: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.notable_claims IS
'Notable claims made in the description, by the same expansion file. UNUSED: default {}, no writer, empty on all rows (2026-10-07). Unit: none (text[]). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_intelligence.service_shops IS
'Shops that serviced the vehicle, by the same expansion file. UNUSED: default {}, no writer, empty on all rows (2026-10-07); the view v_vehicle_intelligence_full still selects it. Would name businesses. Unit: none (text[]). Grain: one vehicle. Clock: n/a.';

-- A column added between this PR and its deploy must not block the deploy: report, never raise.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_intelligence'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_intelligence: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_intelligence columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
