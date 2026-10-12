-- Describe properties: all 35 columns, none had a COMMENT ON COLUMN (0 of 35 described before, atlas read
-- 2026-10-12 08:30Z). The table comment (20261006073000_table_purpose_live_tables.sql) is replaced: it named one loader,
-- and 905 of the 1,278 rows come from sources that loader never reads. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 1,278 rows on 2026-10-12 08:36Z by exact count,
-- 0 inserts, 0 updates and 0 deletes since the statistics counters began; the newest row was created 2026-07-20.
--
-- METHOD (read 2026-10-12 08:36-08:38Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, the anon SELECT grant, inbound foreign keys and
--   existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and
--   pg_description; null fractions and distinct counts from pg_stats; the live body of update_property_search_vector().
--   Row counts and fill per discovered_via, property_type, listing_type, price_period, price_currency and status; the
--   metadata and specs key sets per source; source_url hosts; external_id shapes (digits masked); where
--   metadata.canonical_villa_id points; clock ranges. All are exact counts over the whole table. "Filled" means non-NULL
--   (for search_keywords: a non-empty array; for specs and metadata: not {}).
--   Writers from code at origin/main f581dbea8 (supabase/functions, supabase/migrations, scripts, nuke_frontend; the
--   discovered_via values searched as text): scripts/concierge/migrate-villas-to-properties.ts copies lofficiel-concierge
--   villa rows from businesses (written by scripts/concierge/import-sibarth-villas.ts from the Sibarth API) and upserts
--   on (property_type, source_url). No code in this repo writes the wimco_sitemap_jsonld, edenrock_index_umbraco,
--   lebarth_nextdata, elan or lofficiel-yacht-recon-2026-07 rows; their writer is Unknown. pipeline_registry: no row.
-- LIMITS:
--   pg_stat_user_tables counters began at an unrecorded time. Quoted values are source labels, codes, key names, hosts,
--   counts and clocks only: no address, coordinate, contact, price or property name.
-- CHANGED EXISTING COMMENTS:
--   COMMENT ON TABLE: was 'Concierge property entity (villas and venues) ... Loaded by
--   scripts/concierge/migrate-villas-to-properties.ts; rows 2026-01-30 .. 2026-07-20; no row writes since the statistics
--   reset.' Now it names every source, the yachts, the cross-source identity link and the writer gap.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.properties IS
'Concierge property entity (L''Officiel concierge): one row per villa or yacht listing as published by one agency or operator (grain: one source listing; the same villa can appear once per agency). 1,278 rows (2026-10-12): 1,211 villas from five villa agencies (wimco_sitemap_jsonld 388, sibarth 364, edenrock_index_umbraco 264, lebarth_nextdata 186, elan 9) and 67 yachts from lofficiel-yacht-recon-2026-07, created 2026-01-30 .. 2026-07-20. Cross-agency identity is carried only in metadata.canonical_villa_id (927 rows, 319 distinct ids, 608 pointing at an existing properties row), not by a key. Writers: scripts/concierge/migrate-villas-to-properties.ts created the sibarth and elan rows from businesses in 2026-01/02 (their description equals the tagline and their search_keywords are the Sibarth importer''s), but no row now carries that script''s metadata keys (migrated_from_business_id, original_metadata) or its discovered_via value (sibarth.com): a writer not in this repo rewrote them (their latest write is 2026-07-21) and created the other 905 rows; which writer is Unknown. No pipeline_registry row. RLS on with no policy, so anon and authenticated read no rows. Keyed to by property_images, community_events, villa_calendar_crawls and villa_availability_observations. Ingest time = created_at; updated_at is rewritten by the search-vector trigger on every write.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.id IS
'Surrogate key of the property listing, uuid, gen_random_uuid() default, the PRIMARY KEY. 1,278 values (2026-10-12). Four tables key to it (property_images, community_events, villa_calendar_crawls, villa_availability_observations). Unit: none (uuid). Source: column default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.name IS
'Display name of the villa or yacht as the source publishes it, text, NOT NULL; migrate-villas-to-properties.ts strips a leading "Villa ". Not unique: about 55% distinct by pg_stats (2026-10-12), because one villa appears once per agency and agencies reuse names. Unit: none (text). Source: the listing agency''s page or API. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.slug IS
'URL slug of the listing, text, nullable, UNIQUE. Filled on all 1,278 rows, all lower-case kebab (2026-10-12); migrate-villas-to-properties.ts derives it from the source slug or the name. Unit: none (text). Source: writer-derived. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.external_id IS
'The listing''s identifier at its source, text, nullable, no unique constraint. Filled and distinct on all 1,278 rows (2026-10-12). Shapes by source: sibarth a bare integer (the Sibarth API id), wimco_sitemap_jsonld wimco:<n>, lebarth_nextdata lebarth:<n>, edenrock_index_umbraco edenrock:<uuid>, yachts <operator>-<id or name>. The writer''s dedupe key when source_url is missing. Unit: none (text). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.source_url IS
'URL of the listing page at its source, text, nullable; unique together with property_type (index uq_properties_villa_source_url, the upsert target of migrate-villas-to-properties.ts). Filled and distinct on all 1,278 rows (2026-10-12). Hosts: www.wimco.com 388, sibarth.com 364, www.edenrockvillarental.com 264, www.lebarthvillas.com 186, www.edmiston.com 29, www.canados-stbarth.com 21, masterski-pilou.com 17, www.elanvillarental.com 9. Unit: none (URL). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.discovered_via IS
'Which capture produced the row, text, nullable. Six values on all 1,278 rows (2026-10-12): wimco_sitemap_jsonld 388, sibarth 364, edenrock_index_umbraco 264, lebarth_nextdata 186, lofficiel-yacht-recon-2026-07 67, elan 9. migrate-villas-to-properties.ts copies businesses.discovered_via (sibarth.com from the Sibarth importer); no row here carries that value, so the sibarth rows were relabelled by a writer outside this repo (Unknown which). Unit: none (code). Source: the writing capture. Grain: one source listing. Clock: n/a.';

-- ── Type and listing ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.property_type IS
'Kind of property as text, nullable, no CHECK: villa 1,211 and yacht 67 (2026-10-12). Part of the (property_type, source_url) unique key. Duplicates property_type_id where that is filled. Unit: none (code). Source: writer. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.property_type_id IS
'The property type as a key, uuid, nullable, FOREIGN KEY to property_types. Filled on 440 rows (2026-10-12): 373 villa (the sibarth and elan rows) and 67 yacht; NULL on all 838 wimco, edenrock and lebarth rows, whose type is only in property_type. Unit: none (uuid). Source: migrate-villas-to-properties.ts (property_types slug villa) for the sibarth and elan rows; the yacht writer is Unknown. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.listing_type IS
'What the listing offers, text, default rental, no CHECK: rental 1,206, charter 29, day_charter 17, sale 26 (21 yachts, 5 sibarth villas) (2026-10-12). Unit: none (code). Source: the listing agency via the writer. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.status IS
'Listing state, text, default active, no CHECK: active on 1,277 rows and inactive on 1 edenrock row (2026-10-12). Whether active means still listed at the source on a given day is not recorded; no writer refreshes it. Unit: none (code). Source: writer default. Grain: one source listing. Clock: n/a (no as-of time).';
COMMENT ON COLUMN public.properties.is_public IS
'Whether the listing may be shown, boolean, default true: true on 1,277 rows, false on the 1 inactive edenrock row (2026-10-12). No RLS policy reads it (the table has RLS on and no policy). Unit: none (boolean). Source: writer default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.is_featured IS
'Editorial feature flag, boolean, default false. false on all 1,278 rows (2026-10-12). Unit: none (boolean). Source: column default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.owner_org_id IS
'The agency or owner organization of the listing, uuid, nullable, FOREIGN KEY to organizations. NULL on all 1,278 rows (2026-10-12). migrate-villas-to-properties.ts looks up a businesses id here, which the organizations key would refuse; the agency is recorded only as text in metadata.agency. Unit: none (uuid). Source: none in practice. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.owner_user_id IS
'The user who owns the listing, uuid, nullable, no foreign key. NULL on all 1,278 rows (2026-10-12); no writer sets it. Unit: none (uuid). Source: none. Grain: one source listing. Clock: n/a.';

-- ── Text ────────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.description IS
'Marketing description from the source, text, nullable. Filled on 1,050 rows (82.2%, 2026-10-12); NULL on every lebarth_nextdata and elan row. migrate-villas-to-properties.ts copies the tagline here: description equals tagline on 342 sibarth and elan rows. Unit: none (text). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.tagline IS
'One-line marketing tagline, text, nullable. Filled on 351 rows (2026-10-12), all from sibarth; the other sources carry none. Unit: none (text). Source: the Sibarth API via businesses.metadata.tagline. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.search_keywords IS
'Search terms for the listing, text array, default {}. Non-empty on 400 rows (2026-10-12): all 373 sibarth and elan rows (copied from businesses.search_keywords as import-sibarth-villas.ts builds them: name, villa, sibarth, region, st barth, luxury, rental or for sale, tagline; all 364 sibarth rows contain sibarth and st barth) and 27 yachts. Feeds search_vector. Unit: none (text array). Source: import-sibarth-villas.ts via migrate-villas-to-properties.ts; yacht writer Unknown. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.search_vector IS
'Full-text search vector, tsvector, maintained by trigger trigger_property_search_vector (BEFORE INSERT OR UPDATE, function update_property_search_vector): to_tsvector(''english'', name, description, tagline, region, city and search_keywords). Filled on all 1,278 rows (2026-10-12). Derived; never write it directly. Unit: none (tsvector). Source: trigger. Grain: one source listing. Clock: n/a.';

-- ── Location ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.address IS
'Street address, text, nullable. NULL on all 1,278 rows (2026-10-12); no writer sets it. Unit: none (text). Source: none. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.city IS
'Locality as the source names it (St Barth quarters such as Pointe Milou or Gustavia; also Saint-Martin places), text, nullable, free text with spelling variants. Filled on 1,201 rows (94.0%, 2026-10-12), and equal to region on all 1,201. Unit: none (place name). Source: the listing agency (sibarth: the API region field, copied to both city and region). Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.region IS
'Region as the source names it, text, nullable. For villas the writers copy the locality into both city and region, so it adds no level above city; filled on 1,268 rows (2026-10-12), equal to city on all 1,201 rows that have a city. Unit: none (place name). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.country IS
'Country code, text, default BL (Saint-Barthelemy): BL on all 1,249 filled rows; NULL on 29 (2026-10-12). A default, not a per-listing observation: it does not prove the property is in BL. Unit: ISO 3166-1 alpha-2 code. Source: column default or writer. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.postal_code IS
'Postal code, text, nullable. NULL on all 1,278 rows (2026-10-12); no writer sets it. Unit: none. Source: none. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.latitude IS
'Latitude of the listing as the source publishes it, numeric(10,8), nullable. Filled on 938 rows (2026-10-12): every wimco, sibarth and lebarth row; NULL on all edenrock, elan and yacht rows. Source-published map points, not surveyed positions. Unit: decimal degrees (WGS84 assumed; the datum is not recorded). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.longitude IS
'Longitude of the listing as the source publishes it, numeric(11,8), nullable. Filled on the same 938 rows as latitude (2026-10-12). Unit: decimal degrees (WGS84 assumed; the datum is not recorded). Source: the listing agency. Grain: one source listing. Clock: n/a.';

-- ── Specs and price ─────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.specs IS
'Physical specification of the property as the source states it, jsonb object, default {}. Not {} on all 1,278 rows (2026-10-12). Keys differ by source: villas bedrooms_min and bedrooms_max everywhere, plus bathrooms, capacity, amenities (wimco, lebarth), sleeps, facilities, room_details, tier (edenrock), rents_as, check_in, check_out, min_nights (lebarth); yachts loa_m, loa_ft, beam_m, draft_m, cabins, guests, builder, year_built, year_refit, gross_tonnage, hull_material and others. Attributed claims of the agency; units are in the key names where stated (_m metres, _ft feet, _kn knots, _kg, _liters). Unit: per key. Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.base_price IS
'Lowest advertised price, numeric(12,2), nullable, in price_currency per price_period. Filled on 789 rows (2026-10-12): wimco 388 (per night), sibarth 359 rentals (per week; the low end of the published range), and 42 yachts; NULL on every edenrock, lebarth and elan row and on the sale listings. An asking rate at capture, not a booking. Unit: price_currency per price_period. Source: the listing agency. Grain: one source listing. Clock: capture time, not recorded per row.';
COMMENT ON COLUMN public.properties.price_currency IS
'Currency of base_price, text, default USD: USD 1,235, EUR 18 (yacht charters), NULL 25 (2026-10-12). Filled by default on rows with no price, so it does not prove a USD price exists. Unit: ISO 4217 code. Source: the listing agency or column default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.price_period IS
'Period base_price covers, text, default week, no CHECK: week 843, night 388 (all wimco), day 17 (day charters), sale 5, NULL 25 (2026-10-12). Filled by default on rows with no price. Unit: none (code). Source: the listing agency or column default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.min_booking_period IS
'Minimum booking length, integer, nullable, unit not declared. NULL on all 1,278 rows (2026-10-12); lebarth carries min_nights in specs instead. Unit: Unknown (not declared). Source: none. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.sale_price IS
'Asking price of a listing for sale, numeric(14,2), nullable. NULL on all 1,278 rows (2026-10-12), including the 26 sale listings. Unit: sale_price_currency. Source: none in practice. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.sale_price_currency IS
'Currency of sale_price, text, default USD. USD on all 1,278 rows by default (2026-10-12), although no sale_price is filled. Unit: ISO 4217 code. Source: column default. Grain: one source listing. Clock: n/a.';

-- ── Metadata and clocks ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.metadata IS
'Capture and identity envelope, jsonb object, default {}. Not {} on all 1,278 rows (2026-10-12). Keys by source: agency on every villa source; canonical_villa_id, aliases, identity and candidate_match on the villa agencies except elan (the cross-agency identity resolution: 927 rows carry canonical_villa_id, 319 distinct, 608 pointing at an existing properties row; not a foreign key); project and scraped_at (sibarth, elan); ingested_at (wimco); observed_at, method, trust, source, is_superseded, superseded_by and availability_observations (edenrock); price_quarantine (elan); for yachts provenance_class, source_operator, price_raw, rate_options, ais, catalog_reference and others. Some yacht rows hold an operator contact; read it masked. Unit: none (jsonb). Source: the writing capture. Grain: one source listing. Clock: per-key capture clocks (scraped_at, ingested_at, observed_at) where present.';
COMMENT ON COLUMN public.properties.created_at IS
'When the row was inserted, timestamptz, default now(). Range 2026-01-30 .. 2026-07-20 (2026-10-12): sibarth and elan 2026-01-30 .. 02-18, yachts 2026-07-05 .. 07-06, wimco 2026-07-19, edenrock and lebarth 2026-07-20. Unit: timestamptz. Source: column default. Grain: one source listing. Clock: ingest time.';
COMMENT ON COLUMN public.properties.updated_at IS
'When the row was last written, timestamptz, default now(); set to now() on every insert and update by update_property_search_vector(). Later than created_at on all 1,278 rows (2026-10-12); latest 2026-07-21. A write clock, not a source observation time. Unit: timestamptz. Source: trigger. Grain: one source listing. Clock: writer time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.properties'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'properties: every column has a comment';
  ELSE
    RAISE NOTICE 'properties columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
