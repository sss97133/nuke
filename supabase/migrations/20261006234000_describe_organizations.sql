-- Describe organizations: the 84 columns with no COMMENT ON COLUMN (62 of 146 described before, catalog count on prod,
-- 2026-10-06), three corrected column comments and two corrected facts in the table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). The zz_backup_* copies of this table are on lane H's drop list and are not
-- described here.
--
-- METHOD (read 2026-10-06 UTC):
--   Columns, types, defaults, constraints, indexes, policies, grants and existing comments from pg_attribute,
--   pg_constraint, pg_indexes, pg_policy, information_schema and pg_description. Writers from code at origin/main
--   46f8bcbae (supabase/functions, supabase/migrations, database/migrations, scripts, nuke_frontend/src), git history
--   for deleted writers, the 11 triggers on organizations, the body of every live public SQL function that names
--   organizations or the businesses view (64), the triggers and pg_cron jobs that run them, and pipeline_registry
--   (3 rows, owner update_organization_stats; their descriptions are reused for those columns).
--   Fill is measured on the whole table: 5,733 rows, created 2025-11-01 .. 2026-07-25, none in the last 30 days,
--   218 updated in the last 30 days, 4,538 public. "Filled" means non-NULL and, for text, non-blank; booleans count
--   true; json and arrays count non-empty.
-- LIMITS:
--   Attribution is from code and from row stamps (discovered_via, source, enrichment_sources, metadata keys). The
--   St. Barth directory, villa, access.sb and corpus rows were written by scripts partly outside this repo; where no
--   code shows the writer, the comment says it is not established.
--   No values are quoted except categorical codes and stamps: no names, emails, phones, addresses, ids or URLs. Some
--   rows are private car collections, so their contact and location fields can identify a person.
-- CHANGED EXISTING COMMENTS:
--   country: called an ISO 3166-1 alpha-2 code, but 2,130 of 5,663 values are names or other forms.
--   primary_focus: the value list omitted auctions (65 rows) and collection, both allowed by its CHECK.
--   name: called synced from business_name, but no trigger syncs it: NULL on all 699 rows created after 2026-03-21.
--   Table comment: 105 foreign keys come from 92 tables, not 105 tables; 2,575 rows are private car collections,
--   which the grain did not mention.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.organizations IS
'CANONICAL for organization (105 foreign keys from 92 tables reference it, 2026-10-06; businesses was renamed into it, 20260215200000, and the shops and pre-2026-01-29 organizations tables were archived in its favor). The organization entity: one row per organization (grain: one organization): a business (dealer, shop, auction house, publisher, venue, hotel, rental villa) or a private car collection. On 2026-10-06, 2,575 of 5,733 rows are collections (entity_type collection) and 2,116 are in Saint-Barthelemy (country BL). Writers: extract-bat-core (seller organization resolution), classify-organization-type, extract-gaa-classics, link-document-entities, generate-org-due-diligence, the St. Barth concierge scripts, scripts/load-perplexity-orgs.ts, SQL enrich_organization, and undeclared writers (v_schema_atlas); pipeline_registry owner update_organization_stats. Not an event table: created_at is row creation (2025-11-01 .. 2026-07-25).';

-- ── Identity and naming ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.id IS
'Surrogate key of the organization. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by 105 foreign keys from 92 tables (2026-10-06): 56 NO ACTION, 40 ON DELETE CASCADE, 9 SET NULL; one of them is this table (powered_by_org_id). legacy_org_id holds the id an organization had before the 2026-01-29 rebuild. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.business_name IS
'Name the organization trades under, as the creating writer captured it; NOT NULL, 2 .. 183 characters, 5,304 distinct values on 5,733 rows (2026-10-06). On entity_type collection rows it names a private car collection (metadata.collector_bio describes the collector), so it can identify a person. Source: every creating writer: the St. Barth directory and villa scrapers (scripts/concierge), scripts/load-perplexity-orgs.ts, seed-ecr-collections (deleted), the Classic.com and BaT partner indexers, create-org-from-url, onboard-source, extract-gaa-classics, link-document-entities, resolve_organization_from_url() and the web app. Trigger trg_auto_slug_businesses derives slug from it at insert; it feeds search_vector and search_keywords; name holds a one-time copy. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.legal_name IS
'Registered legal name of the business. Source: generate-org-due-diligence (read from the website by a model), enrich_organization(), scripts/sonar-enrich-org.mjs and the web app compliance and editor forms. Filled on 32 of 5,733 rows (2026-10-06). Feeds search_vector and a trigram index on public rows. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.description IS
'Free-text summary of the organization, scraped or model-written: Perplexity batches (scripts/load-perplexity-orgs.ts, 2026-02-28), the collection enrichment, the St. Barth directory and villa scrapers, the access.sb import, generate-org-due-diligence, create-org-from-url, onboard-source and the web app. Filled on 3,337 of 5,733 rows (58.2%, 2026-10-06), up to 1,134 characters; no column records which writer or model produced it. Feeds search_vector. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.source IS
'Creating-writer stamp on newer rows, free text with no CHECK; most rows record provenance in discovered_via instead. Filled on 114 of 5,733 rows (2026-10-06): facebook-saved 75 (the Facebook saved-items importer, scripts/import-fb-saved.mjs and the ingest function), top50_org_mint_2026-07-21 20 (lofficiel-concierge scripts/sql/mint_top50_identity_orgs.sql), web_research_agent_2026-05-23 17, and two single-row stamps (2026-05-07 and 2026-05-23). Rows carrying it were created 2026-03-20 .. 2026-07-21. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.source_id IS
'Identifier of the organization at the source named in source. 73 of its 76 values (2026-10-06) are numeric Facebook ids on facebook-saved rows; the rest are single rows. Written with source by the same writers. Not a foreign key. Unit: none. Grain: one organization. Clock: n/a.';

-- ── Classification ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.entity_type IS
'Primary classification of the organization. CHECK chk_organizations_entity_type (NOT VALID) allows 53 values, from collection, museum and the dealer kinds through auction_house, restoration_shop, club, registry, marketplace, media, hotel, restaurant, gallery, concierge, fashion, real_estate, historical and publisher to other and uncategorized. Stored 2026-10-06 (31 values): collection 2,575, other 1,662, uncategorized 202, dealer 98, garage 92, auction_house 82, builder 48, restoration_shop 34, fashion 34, performance_shop 31, club 26 and smaller; NULL on 724 rows (the access.sb, St. Barth corpus and Facebook saved-reels imports and other rows created 2026-03-20 .. 2026-07-21). Writers: classify-organization-type, link-document-entities, scripts/load-perplexity-orgs.ts, the concierge villa importers, scripts/sonar-enrich-org.mjs, scripts/stbarth/seed-publishers.mjs and the web app. Trigger trg_sync_business_type derives business_type from it. org_type is a separate digital-twin classification. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.business_type IS
'Coarse business type. CHECK businesses_business_type_check allows 36 values (sole_proprietorship, partnership, llc, corporation, garage, dealership, restoration_shop, performance_shop, body_shop, detailing, mobile_service, specialty_shop, parts_supplier, fabrication, racing_team, auction_house, marketplace, concours, automotive_expo, motorsport_event, rally_event, builder, collection, dealer, forum, club, media, registry, developer, other, hotel, restaurant, beach_club, rental, real_estate, agency). Derived, not testimony: trigger trg_sync_business_type (BEFORE INSERT OR UPDATE OF entity_type, sync_business_type_from_entity_type()) overwrites it from entity_type, so a value a writer passes at insert is replaced, and a NULL or unmapped entity_type gives other. Later direct updates (generate-org-due-diligence, compute_org_behavior_scores(), promote_businesses_to_service_from_portfolio_evidence(), the web app) can move it away from entity_type. Stored 2026-10-06: other 2,654, collection 2,574, dealer 110, garage 92, auction_house 84, builder 48, hotel 39, restoration_shop 34, performance_shop 31, club 26 and 9 rarer values. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.legal_structure IS
'Legal form of the organization. CHECK allows 20 values: individual, sole_proprietorship, partnership, the llc forms (llc, single_member_llc, multi_member_llc, series_llc), the corporation forms (corporation, c_corp, s_corp), the trust forms (revocable, irrevocable, dynasty, charitable remainder), foundation_501c3, social_club_501c7, limited_partnership, family_limited_partnership, family_office and unknown. Filled on 2 of 5,733 rows (llc and sole_proprietorship, on rows created 2026-04-07 .. 2026-05-07); the writer is not established in the repo. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.industry_focus IS
'Industry tags, a text array; default {}. Non-empty on 1,766 of 5,733 rows (30.8%, 2026-10-06), almost all St. Barth directory and villa rows carrying French directory category slugs from scripts/concierge/scrape-directory-stbarth.ts and import-sibarth-villas.ts (tourisme, accommodation, luxury, maison, construction, boutiques, sante, administrations, restaurants-soiree most common); a few English automotive tags from generate-org-due-diligence and enrich_organization(). Free vocabulary in two languages. Feeds search_vector. Unit: none (text[]). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.specializations IS
'What the organization specializes in, a free-text English array; default {}. Non-empty on 377 of 5,733 rows (6.6%, 2026-10-06; NULL on 31): mostly vehicle kinds and makes with case and spelling variants (classic cars and Classic Cars, muscle cars, exotic, Porsche, restoration). Writers: scripts/load-perplexity-orgs.ts (all 202 of its 2026-02-28 phase-one rows), generate-org-due-diligence, enrich_organization(), the sonar-enrich scripts and scripts/classify-pending-businesses.ts. specialty_makes and specialty_eras are the structured digital-twin forms. Feeds search_vector. Unit: none (text[]). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.services_offered IS
'Services the organization offers, a text array; default {}. Non-empty on 1,991 of 5,733 rows (34.7%, 2026-10-06): French directory subcategory slugs on the St. Barth rows (villa-rental, vacation-rental, vetements-et-accessoires, restaurants, taxis most common), English service names elsewhere (Financing, Consignment). Writers: the concierge directory and villa scrapers, scripts/load-perplexity-orgs.ts, generate-org-due-diligence, enrich_organization(), the sonar-enrich scripts and the web_research_agent rows. Free vocabulary in two languages. Feeds search_vector. Unit: none (text[]). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.brands_carried IS
'Vehicle makes the organization sells or services, a free-text array not keyed to a make table. Filled on 202 of 5,733 rows (2026-10-06), all from the scripts/load-perplexity-orgs.ts phase-one batch of 2026-02-28 (Porsche, Ford, Chevrolet, BMW, Ferrari, Mercedes-Benz most common); the sonar-enrich scripts also write it. Unit: none (text[]). Grain: one organization. Clock: as of the batch.';
COMMENT ON COLUMN public.organizations.service_description IS
'Free-text description of the service the organization provides, paired with service_type (declared in database/migrations/20260124_data_lineage_and_org_services.sql). Filled on 3 of 5,733 rows (2026-10-06; created 2026-01-24 .. 2026-05-23); the writer is not established in the repo. Unit: none. Grain: one organization. Clock: n/a.';

-- ── Contact and location (contact data; private where the organization is a person or private collection) ───────

COMMENT ON COLUMN public.organizations.email IS
'Contact email the source published for the organization. Business contact data, private where the organization is a person or a private collection. Source: the St. Barth directory scraper (988 of its 1,255 main rows), scripts/load-perplexity-orgs.ts, generate-org-due-diligence, enrich_organization(), create-org-from-url and the web app forms. Filled on 1,377 of 5,733 rows (24.0%, 2026-10-06; 6 more hold a blank string). No format check. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.phone IS
'Contact phone number(s) the source published, free text with no format (up to 153 characters, sometimes several numbers). Business contact data, private where the organization is a person or a private collection. Source: the St. Barth directory scraper, the access.sb import, scripts/load-perplexity-orgs.ts, generate-org-due-diligence, enrich_organization(), create-org-from-url and the web app forms. Filled on 2,081 of 5,733 rows (36.3%, 2026-10-06). Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.website IS
'Website of the organization as the source gave it (free text, not normalized). Filled on 4,036 of 5,733 rows (70.4%, 2026-10-06), including 1,698 of the 1,701 older collection rows. Source: every creating writer plus create-org-from-url, update-org-from-website, onboard-source, classify-organization-type and resolve_organization_from_url(). Trigger businesses_auto_investigate_zero_inventory fires when it changes on a public row. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.address IS
'Street address, free text (up to 232 characters). Private where the organization is a person or a private collection. Source: the St. Barth directory scraper, the access.sb import, scripts/load-perplexity-orgs.ts, the Classic.com and BaT partner indexers, generate-org-due-diligence, enrich_organization(), create-org-from-url and the web app location picker. Filled on 1,871 of 5,733 rows (32.6%, 2026-10-06). Not geocoded here: latitude and longitude are separate. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.city IS
'City or locality, free text. Filled on 4,769 of 5,733 rows (83.2%, 2026-10-06; 133 more hold a blank string). Source: the creating writers (collection seed, St. Barth scrapers, Perplexity batches, indexers), generate-org-due-diligence, enrich_organization(), update-org-from-website and the web app. Feeds search_vector. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.state IS
'State, province or region, free text: US two-letter codes and names mixed with regions abroad (473 distinct values, 2 .. 59 characters). Filled on 1,988 of 5,733 rows (34.7%, 2026-10-06). Same writers as city. Feeds search_vector and a trigram index on public rows. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.zip_code IS
'Postal code, free text. Filled on 287 of 5,733 rows (5.0%, 2026-10-06). Source: scripts/load-perplexity-orgs.ts, the BaT partner and Classic.com indexers, generate-org-due-diligence, enrich_organization(), create-org-from-url and the web app. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.hours_of_operation IS
'Opening hours, JSON; default {}. Non-empty on 76 of 5,733 rows (2026-10-06; NULL on 7). Two shapes: a sourced object with raw, readable, source, source_url, observed_at, trust and method keys on 66 rows (59 from the access.sb import, method sitemap+jsonld, written 2026-07-04 .. 2026-07-25; 7 from site_jsonld), and day-range keys (mon-fri, sat, sun and similar) on the 10 web_research_agent rows of 2026-05-23; generate-org-due-diligence and scripts/sonar-enrich-org.mjs also write that shape. Unit: none. Grain: one organization. Clock: as of observed_at where present.';
COMMENT ON COLUMN public.organizations.social_links IS
'Social profiles of the organization, a JSON object; default {}. Non-empty on 1,700 of 5,733 rows (29.7%, 2026-10-06). Keys: instagram 1,459, youtube 569, facebook 521, linkedin 142, twitter 116, tiktok 7, plus provenance keys _observed_at and _source (379 rows) and _method (189). Values mix full URLs, @handles and bare handles; they are not keys to external_identities. Writers: enrich_organization(), scripts/load-perplexity-orgs.ts, the sonar-enrich scripts, onboard-source and the concierge social finders (scripts/concierge/deep-social-finder.ts, find-instagram-google.ts). Unit: none. Grain: one organization. Clock: as of _observed_at where present.';
COMMENT ON COLUMN public.organizations.logo_url IS
'Image link for the organization logo. 701 of the 722 filled values (2026-10-06) are http(s) URLs; 21 are placeholder or malformed strings (alt text such as Logo), not links. Writers: generate-org-due-diligence, create-org-from-url, onboard-source, update-org-from-website (_shared/extractBrandAssets.ts), scripts/load-perplexity-orgs.ts, scripts/sonar-enrich-org.mjs, the concierge photo scrapers and the web app. Filled on 12.6% of rows. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.banner_url IS
'Image link for the organization banner or cover image. Filled on 189 of 5,733 rows (3.3%, 2026-10-06), mostly Classic.com-indexed and BaT-partner organizations (171 of them). Writers: generate-org-due-diligence, _shared/extractBrandAssets.ts (update-org-from-website, onboard-source) and scripts/fix-org-profile-issues.js. Unit: none. Grain: one organization. Clock: n/a.';

-- ── Capability and pricing (read from websites by generate-org-due-diligence) ───────────────────────────────────

COMMENT ON COLUMN public.organizations.years_in_business IS
'Years the business has operated, as a source stated it, with no as-of date. Source: generate-org-due-diligence (from the website, by model), enrich_organization(), the sonar-enrich scripts. Filled on 26 of 5,733 rows (2026-10-06), 5 .. 50. founded_year is the dated form. Unit: years. Grain: one organization. Clock: as of the extraction (not stored).';
COMMENT ON COLUMN public.organizations.employee_count IS
'Number of employees as a source stated it. Source: generate-org-due-diligence (from the website, by model), enrich_organization(), the sonar-enrich scripts. Filled on 21 of 5,733 rows (2026-10-06), 10 .. 200. Unit: count of people. Grain: one organization. Clock: as of the extraction (not stored).';
COMMENT ON COLUMN public.organizations.accepts_dropoff IS
'Whether the shop accepts vehicle drop-off. Default false; true on 12 of 5,733 rows (2026-10-06; NULL on 4), set by generate-org-due-diligence from the website (2025-12 rows). False means not stated, not confirmed absent. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.offers_mobile_service IS
'Whether the shop offers mobile (on-site) service. Default false; true on no row (2026-10-06; NULL on 4). generate-org-due-diligence would set it from the website. False means not stated. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_lift IS
'Whether the shop has a vehicle lift. Default false; true on 4 of 5,733 rows (2026-10-06), from generate-org-due-diligence and one self-reported row. has_lift_count is the unused count form. False means not stated. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_paint_booth IS
'Whether the shop has a paint booth. Default false; true on 16 of 5,733 rows (2026-10-06), set by generate-org-due-diligence from websites (rows created 2025-12-14 .. 2025-12-26). False means not stated. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_dyno IS
'Whether the shop has a dynamometer. Default false; true on 1 of 5,733 rows (2026-10-06), from generate-org-due-diligence. False means not stated. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_alignment_rack IS
'Whether the shop has a wheel alignment rack. Default false; true on 2 of 5,733 rows (2026-10-06), from generate-org-due-diligence. False means not stated. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.hourly_rate_min IS
'Low end of the posted hourly shop rate. Unit: USD per hour by convention, numeric(10,2). Source: generate-org-due-diligence (from the website). Filled on 5 of 5,733 rows (2026-10-06), 75 .. 150. labor_rate and hourly_rate_cents are the single-rate columns. Grain: one organization. Clock: as of the extraction (not stored).';
COMMENT ON COLUMN public.organizations.hourly_rate_max IS
'High end of the posted hourly shop rate. Unit: USD per hour by convention, numeric(10,2). Source: generate-org-due-diligence (from the website). Filled on 5 of 5,733 rows (2026-10-06), 150 .. 300. Grain: one organization. Clock: as of the extraction (not stored).';
COMMENT ON COLUMN public.organizations.service_radius_miles IS
'Distance the organization travels or serves from its base. Unit: miles. Source: generate-org-due-diligence (from the website). Filled on 5 of 5,733 rows (2026-10-06), 20 .. 50. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.business_license IS
'Business license number. Source: generate-org-due-diligence (asks the model for one if the website mentions it) and the web app compliance form. Filled on 1 of 5,733 rows (2026-10-06). Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.tax_id IS
'Tax identifier (EIN or similar). Source: generate-org-due-diligence (asks the model for one if the website mentions it) and the web app compliance form (MarketplaceComplianceForm). Filled on 1 of 5,733 rows (2026-10-06). Sensitive. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.registration_state IS
'State or jurisdiction where the business is registered. Source: generate-org-due-diligence and the web app compliance form. Filled on 1 of 5,733 rows (2026-10-06). incorporation_jurisdiction is the similar investor field. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.registration_date IS
'Date the business was registered. Source: generate-org-due-diligence and the web app compliance form. Filled on 2 of 5,733 rows (2026-10-06); both values are January 1 dates. Unit: date. Grain: one organization. Clock: event time (registration).';

-- ── Status, verification and visibility ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.status IS
'Lifecycle status. CHECK allows active, inactive, suspended, for_sale and sold; default active. Stored 2026-10-06: active 5,728, inactive 5. Creating writers set active; the writer of the 5 inactive values is not established. is_active is a separate flag: the 5 inactive rows still have is_active true. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.is_active IS
'Whether the organization is active. Default true; false on 2 of 5,733 rows (2026-10-06). Writers: onboard-source, scripts/load-perplexity-orgs.ts, scripts/discover-dealer-sellers.mjs, scripts/create-forum-orgs.js, scripts/sonar-enrich-org.mjs and the web app intake. Independent of status; the two disagree on 7 rows (5 inactive with is_active true, 2 active with is_active false). Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.is_public IS
'Whether the organization profile is publicly readable. Default true; true on 4,538 of 5,733 rows (79.2%, 2026-10-06). False on most St. Barth directory rows (180 of the 1,226 main ones are public). Read by the public RLS read policies (Anyone views public orgs, Public can view public businesses, Verified businesses are publicly viewable) and trigger businesses_auto_investigate_zero_inventory. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.is_verified IS
'Verification flag, but not evidence that a verification happened: true on 308 of 5,733 rows (2026-10-06), of which 291 are collections seeded by seed-ecr-collections (2026-02-14, since deleted), which set it so the public read policy would show them; the rest are auction houses, concours and a few seeds (scripts/setup-*.js, database/seeds). All 308 keep verification_level unverified and have no verification_date. RLS policy Verified businesses are publicly viewable reads it with is_public. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.verification_level IS
'Verification tier. CHECK allows unverified, basic, premium and elite; default unverified. Stored 2026-10-06: unverified 5,716, basic 12, premium 4, elite 1. Writers: create-org-from-url, scripts/discover-dealer-sellers.mjs, scripts/seed-example-org.js and the web app (CreateOrganization, RestorationIntake). Not tied to is_verified. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.verification_date IS
'When the organization was verified, by name. UNUSED: no writer, and empty on every row (2026-10-06), including the 308 is_verified rows. Unit: timestamptz. Grain: one organization. Clock: event time (verification).';

-- ── Enrichment and inventory sync ───────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.enrichment_status IS
'Stage of profile enrichment, free text with no CHECK; default stub. Stored 2026-10-06 (13 values): stub 2,969, enriched 1,938, site_held_agency_listing 349, site_verified 263, site_held_brand_global 71, partial 40, site_unreachable 29, site_dead 27, site_held_name_drift 22, site_held_mismatch 21, pending 2, unverified 1, complete 1. Writers: scripts/load-perplexity-orgs.ts (enriched), the sonar-enrich scripts, enrich_organization() (no caller in the repo); the site_* website-check values come from a writer not established in this repo (St. Barth rows). Unit: none. Grain: one organization. Clock: as of last_enriched_at.';
COMMENT ON COLUMN public.organizations.last_enriched_at IS
'When the profile was last enriched. Filled on 3,657 of 5,733 rows (63.8%, 2026-10-06), 2026-01-30 .. 2026-07-20. Writers: scripts/load-perplexity-orgs.ts, the sonar-enrich scripts, the concierge enrichers and enrich_organization(). Unit: timestamptz. Grain: one organization. Clock: ingest time (last enrichment).';
COMMENT ON COLUMN public.organizations.enrichment_sources IS
'Where enrichment data came from, a text array. Filled on 3,872 of 5,733 rows (67.5%, 2026-10-06). Elements: perplexity 1,866, web-discovery 916, access-sb 496, and own_website:<domain> entries naming the organization site. Writers: scripts/load-perplexity-orgs.ts, the sonar-enrich scripts, the concierge scripts and enrich_organization(). Unit: none (text[]). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.inventory_url IS
'Link to the organization vehicle inventory page. Filled on 213 of 5,733 rows (3.7%, 2026-10-06), 201 of them from the scripts/load-perplexity-orgs.ts phase-one batch (2026-02-28); also the sonar-enrich scripts, scripts/tbtfw-inventory-now.ts, scripts/ai-extraction-architect.ts and scripts/ingest-otto-markt-delmo.js. Classic.com rows keep it in metadata.inventory_url instead. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.total_inventory IS
'Number of vehicles in the organization inventory at the last sync. Default 0; above 0 on 1,484 of 5,733 rows (2026-10-06), 0 .. 1,676, 1,463 of them collections whose count scrape-ecr-collection-inventory (deleted 2026-03-31; run by scripts/ecr-inventory-backfill.sh) took from the Exclusive Car Registry collection page; dealer inventory scrapers and other writers fill the remaining 21. Not recomputed from linked vehicles. Unit: count of vehicles. Grain: one organization. Clock: as of last_inventory_sync.';
COMMENT ON COLUMN public.organizations.last_inventory_sync IS
'When the inventory was last synced. Filled on 1,700 of 5,733 rows (29.7%, 2026-10-06), values 2025-12-02 .. 2026-02-16: scrape-ecr-collection-inventory on collections (deleted 2026-03-31) and the dealer inventory scrapers on scraper rows. Nothing has synced since. Unit: timestamptz. Grain: one organization. Clock: ingest time (last sync).';
COMMENT ON COLUMN public.organizations.scrape_source_id IS
'Inventory scrape source the organization is synced from, by name a scrape_sources id; no foreign key here (scrape_sources has its own organization key). Filled on 11 of 5,733 rows (2026-10-06), all dealer-scraper rows created 2025-12-02. Unit: none (uuid). Grain: one organization. Clock: n/a.';

-- ── Derived counters ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.total_vehicles IS
'Count of organization_vehicles rows for the organization. Owner: update_organization_stats (pipeline_registry): recounted by triggers trg_update_org_stats_on_vehicle, trg_update_org_stats_on_image and trg_update_org_stats_on_event on every organization_vehicles, organization_images or business_timeline_events insert or delete for the organization; bulk recompute refresh_org_total_vehicles(). Derived, never testimony. Above 0 on 315 of 5,733 rows (2026-10-06), up to 141,174. Unit: count of vehicles. Grain: one organization. Clock: derived (as of the last child write).';
COMMENT ON COLUMN public.organizations.total_images IS
'Count of organization_images rows for the organization. Owner: update_organization_stats (pipeline_registry), recounted by the same triggers on any child insert or delete. Derived, never testimony. Above 0 on 6 of 5,733 rows (2026-10-06). Unit: count of images. Grain: one organization. Clock: derived (as of the last child write).';
COMMENT ON COLUMN public.organizations.total_events IS
'Count of business_timeline_events rows whose business_id is the organization. Owner: update_organization_stats (pipeline_registry), recounted by the same triggers on any child insert or delete. Derived, never testimony. Above 0 on 505 of 5,733 rows (2026-10-06), up to 708, mostly St. Barth rows. Unit: count of events. Grain: one organization. Clock: derived (as of the last child write).';
COMMENT ON COLUMN public.organizations.total_vehicles_worked IS
'Count of active business_vehicle_fleet rows for the organization (trigger trigger_update_business_stats on business_vehicle_fleet, update_business_stats()). On collections these are the cars scrape-ecr-collection-inventory placed in the fleet. Derived. Above 0 on 1,455 of 5,733 rows (2026-10-06), all collections, up to 145. Unit: count of vehicles. Grain: one organization. Clock: derived (as of the last fleet write).';
COMMENT ON COLUMN public.organizations.total_listings IS
'Count of bat_listings rows whose organization_id is this organization, written by update_organization_profile_stats() (the web app calls it) and backfill_organization_profile_stats() (no caller). Its query is a UNION ALL of two counts, and SELECT INTO keeps only the first row. Default 0; above 0 on 2 of 5,733 rows (2026-10-06), up to 23. Unit: count of listings. Grain: one organization. Clock: derived (as of the last stats run).';
COMMENT ON COLUMN public.organizations.total_bids IS
'Count of auction_bids placed by users who are contributors of the organization, written by update_organization_profile_stats() and backfill_organization_profile_stats(). Default 0; 0 on every row (2026-10-06). Unit: count of bids. Grain: one organization. Clock: derived (as of the last stats run).';
COMMENT ON COLUMN public.organizations.total_comments IS
'Count of bat_comments by external identities claimed by contributors of the organization, written by update_organization_profile_stats() and backfill_organization_profile_stats(). Default 0; 0 on every row (2026-10-06). Unit: count of comments. Grain: one organization. Clock: derived (as of the last stats run).';
COMMENT ON COLUMN public.organizations.total_auction_wins IS
'Count of sold bat_listings whose organization_id is this organization, written by update_organization_profile_stats() and backfill_organization_profile_stats(). Default 0; above 0 on 1 of 5,733 rows (2026-10-06), up to 17. Unit: count of listings. Grain: one organization. Clock: derived (as of the last stats run).';
COMMENT ON COLUMN public.organizations.total_success_stories IS
'Count of success_stories rows for the organization, written by update_organization_profile_stats() and backfill_organization_profile_stats(). Default 0; 0 on every row (2026-10-06). Unit: count of stories. Grain: one organization. Clock: derived (as of the last stats run).';
COMMENT ON COLUMN public.organizations.member_since IS
'First known platform activity of the organization, despite the name: update_organization_profile_stats() and backfill_organization_profile_stats() write the earliest of its created_at, its first organization_vehicles link, its first bat_listings auction start and its first contributor, else created_at. Filled on 188 of 5,733 rows (2026-10-06; values 2016-07-12 .. 2025-12-21), mostly the Classic.com-indexed and BaT-partner organizations. Not a membership date at any source. Unit: timestamptz. Grain: one organization. Clock: derived (event time of the earliest activity).';
COMMENT ON COLUMN public.organizations.total_projects_completed IS
'Number of completed projects, by name. UNUSED: default 0, no writer, 0 on every row (2026-10-06). total_projects and total_documented_jobs are the described counterparts. Unit: count. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.average_project_rating IS
'Average rating of the organization projects, by name. UNUSED: default 0, no writer, 0 on every row (2026-10-06). Unit: rating, numeric(3,2). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.total_reviews IS
'Number of reviews of the organization, by name. UNUSED: default 0, no writer, 0 on every row (2026-10-06). Unit: count. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.repeat_customer_rate IS
'Share of repeat customers, by name. UNUSED: default 0, no writer, 0 on every row (2026-10-06). repeat_customer_count is the described count. Unit: percent by convention, numeric(5,2). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.on_time_completion_rate IS
'Share of projects completed on time, by name. UNUSED: default 0, no writer, 0 on every row (2026-10-06). project_completion_rate is the described counterpart. Unit: percent by convention, numeric(5,2). Grain: one organization. Clock: n/a.';

-- ── Money and sale of the organization itself ───────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.estimated_value IS
'Estimated value of the organization itself, by name. UNUSED: only the web app editor form and a stats reader name it; empty on every row (2026-10-06). Unit: USD by convention, numeric(15,2). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.current_value IS
'Unknown meaning beyond the name (a value of the organization, beside the trading columns is_tradable and stock_symbol; method and unit not defined). UNUSED: readers exist (feed-query, mcp-connector, universal-search, the web profile) but no writer, and it is empty on every row (2026-10-06). Unit: not defined, numeric(12,2). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.is_for_sale IS
'Whether the organization itself is for sale, by name. UNUSED: default false, true on no row (2026-10-06). Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.asking_price IS
'Asking price for the organization itself, by name. UNUSED: empty on every row (2026-10-06); the readers that name asking_price read other tables. Unit: USD by convention, numeric(15,2). Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.parking_rate_per_day IS
'Daily parking or storage rate, by name. UNUSED: no writer, and empty on every row (2026-10-06). Unit: USD per day by convention, numeric(10,2). Grain: one organization. Clock: n/a.';

-- ── Digital-twin capacity fields with no writer ─────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.max_concurrent_projects IS
'How many projects the shop can run at once, by name (digital-twin capacity field, with bay_count and sq_footage). UNUSED: no writer, and empty on every row (2026-10-06). Unit: count. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_lift_count IS
'Number of vehicle lifts, by name (digital-twin capacity field). UNUSED: default 0, no writer, 0 on every row (2026-10-06). has_lift is the boolean form. Unit: count. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_upholstery IS
'Whether the shop does upholstery in house, by name (digital-twin capability flag). UNUSED: default false, no writer, true on no row (2026-10-06). Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_climate_storage IS
'Whether the organization offers climate-controlled storage, by name (digital-twin capability flag). UNUSED: default false, no writer, true on no row (2026-10-06). Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_media_blasting IS
'Whether the shop does media blasting, by name (digital-twin capability flag). UNUSED: default false, no writer, true on no row (2026-10-06). Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_rotisserie IS
'Whether the shop has a body rotisserie, by name (digital-twin capability flag). UNUSED: default false, no writer, true on no row (2026-10-06). Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.has_frame_jig IS
'Whether the shop has a frame jig, by name (digital-twin capability flag). Default false; true on 1 of 5,733 rows (a Facebook saved-items row created 2026-03-20); that writer is not established in the repo. Unit: boolean. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.typical_project_range_low_cents IS
'Low end of a typical project price, by name (digital-twin pricing field). UNUSED: no writer, and empty on every row (2026-10-06). Unit: US cents by name. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.typical_project_range_high_cents IS
'High end of a typical project price, by name (digital-twin pricing field). UNUSED: no writer, and empty on every row (2026-10-06). Unit: US cents by name. Grain: one organization. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.created_at IS
'When the row was created (ingest time). Default now(); kept from the businesses table when it was renamed into this one (20260215200000). 2025-11-01 .. 2026-07-25 on 2026-10-06; no row was created in the 30 days before. Batch imports share a day, for example 2026-01-30 (St. Barth directory and villas), 2026-02-28 (Perplexity batch) and 2026-07-04 (access.sb). Unit: timestamptz. Grain: one organization. Clock: ingest time.';
COMMENT ON COLUMN public.organizations.updated_at IS
'Last write as recorded by the writer: no trigger maintains it, so only writers that set it (the stats triggers and functions, enrich_organization(), the web app and most scripts) move it, and a write that omits it leaves it stale. 2025-12-02 .. 2026-10-06; 218 rows moved in the 30 days before 2026-10-06. Unit: timestamptz. Grain: one organization. Clock: ingest time (last recorded write).';

-- ── Corrected existing comments ─────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.country IS
'Country as the source states it, default US, no CHECK: two-letter codes on 3,533 of the 5,663 filled rows (ISO 3166-1 alpha-2 such as BL 2,116, US 937, GB, FR, DE, plus the non-ISO UK on 26) mixed with full names and other forms on the rest (United States 501, USA 398, United Kingdom 148, Germany 100 and more), 2026-10-06. Normalize before comparing. Unit: none. Grain: one organization. Clock: n/a.';
COMMENT ON COLUMN public.organizations.primary_focus IS
'Primary business focus. CHECK businesses_primary_focus_check allows service, inventory, collection, auctions and mixed (or NULL). Stored 2026-10-06: mixed 2,481, service 157, auctions 65, inventory 6; NULL on the other 3,024 rows. Written by compute_and_store_primary_focus(), which trigger_update_primary_focus() runs when receipts or non-system timeline_events land for the organization. Its organizations branch tests the old table name businesses, so trigger auto_update_primary_focus_on_businesses does nothing on this table since the 2026-02-15 rename. Unit: none. Grain: one organization. Clock: derived (as of the last recompute).';
COMMENT ON COLUMN public.organizations.name IS
'Display or trade name used by the digital-twin views. Copied from business_name once, for every row created before 2026-03-22; no trigger keeps the two in step: NULL on all 699 rows created 2026-03-22 .. 2026-07-25 and different from business_name on 11 others (2026-10-06). Read business_name where name is NULL. Unit: none. Grain: one organization. Clock: n/a.';

-- A column added between this PR and its deploy must not block the deploy: report, never raise.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.organizations'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'organizations: every column has a comment';
  ELSE
    RAISE NOTICE 'organizations columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
