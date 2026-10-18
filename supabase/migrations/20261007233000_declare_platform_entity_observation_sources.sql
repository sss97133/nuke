-- 20261007233000_declare_platform_entity_observation_sources.sql
--
-- Declare the platform entity: public.observation_sources becomes the table behind the abstract need 'platform entity'
-- (stack_substrates), and its 17 undescribed columns and its table comment are written. No row of testimony is written, no
-- table is created, no key is added (the keys follow the alias rows of PR #798, one table at a time, per the memo).
-- From docs/proposals/2026-10-07-platform-entity.md (PR #795, merged 7fe5cd890): "do not mint; declare observation_sources".
--
-- WHY. 'platform entity' is missing in 3 of 65 stacks (S25 venue close clocks, S46 cross-platform people, SC the platform
-- page; all at the key layer), and the registry rule (stack_substrates comment, 20261007014500) moves every stack that
-- names a substrate the moment its table is declared. The memo measured which of four source tables the writers' platform
-- text actually matches (1% / 5% / 0.1% samples, 2026-10-07 11:50Z): observation_sources.slug on 67% of
-- vehicles.platform_source values, 91% of vehicle_events.source_platform, 100% of auction_comments.platform, 82% of
-- external_listings.platform and 96% of vehicle_location_observations.source_platform; source_registry.slug on 49%, 22%,
-- 0%, 5% and 13%. The remaining mismatch is spelling variants, proposed as alias rows in #798 (owner approval).
--
-- EVIDENCE (read-only, prod, 2026-10-07 12:05-12:12Z, scripts/data/q.sh): 192 rows created 2026-01-24 .. 2026-10-05;
--   PRIMARY KEY id, UNIQUE slug, FK business_id -> organizations ON DELETE SET NULL (79 rows); 7 tables key to it
--   (vehicle_observations.source_id, pending_claims.source_id, coverage_targets.source_id, observation_extractors.source_id,
--   source_census.source_id, agent_registrations.observation_source_id, source_registry.observation_source_id); 2 inserts and
--   1 update since the statistics reset, 3,302,811 index scans; no trigger; RLS on with one policy
--   (allow_authenticated_read_observation_sources, SELECT, authenticated): anon reads 0 rows. category: 13 of the 15
--   source_category values used (registry 37, marketplace 30, auction 27, dealer 16, internal 15, forum 13, documentation 13,
--   shop 13, social_media 11, owner 10, aggregator 5, museum 1, agent 1; media and event unused). Fills of 192: display_name
--   192, base_url 113, url_patterns 10, base_trust_score 192 (22 at the default 0.50; 0.10 .. 1.00), trust_factors non-empty
--   65, supported_observations 175, requires_auth true 6, rate_limit_per_hour 1, makes_covered 1, years_covered 1,
--   regions_covered 2, notes 186, business_id 79, tier 183 (1: 46, 2: 52, 3: 61, 4: 24), decay_half_life_days 133,
--   veracity 177, consecration 177. Five separator-variant slug pairs exist as separate rows (broad-arrow/broad_arrow,
--   cars-and-bids/cars_and_bids, classic-driver/classicdriver, dupont-registry/dupontregistry, er-classics/erclassics).
--   Writers on main: migrations, fn_schema_proposal_apply (add_source branch, 20261007100000), evaluate_agent_tier (tier),
--   and the K5 ingest scripts (scripts/ingest_k5_*.py, owner-run). Readers: ingest, ingest-observation, api-v1-observations,
--   api-v1-events, api-v1-agent-register, extract-bat-core, mcp-connector, onboard-source and 56 other files.
--
-- WHAT. 1. stack_substrates 'platform entity': declared_table = 'observation_sources', declared_at, declared_by, note
--   appended (guarded: only while undeclared). 2. COMMENT ON TABLE and COMMENT ON COLUMN for the 17 columns with no
--   comment (id, slug, display_name, category, base_url, url_patterns, base_trust_score, trust_factors,
--   supported_observations, requires_auth, rate_limit_per_hour, makes_covered, years_covered, regions_covered, notes,
--   created_at, updated_at); the 5 existing comments (business_id, tier, decay_half_life_days, veracity, consecration) are
--   untouched. 3. pipeline_registry table row: write_via extended with the declaration (guarded). 4. NOTICEs with the
--   three stacks' coverage after the declaration when the registry functions exist.
--
-- LIMITS. Structural: coverage reads the table as present by rows (192 > 0). The platform text columns are not keyed yet
--   (alias rows first: #798, owner approval; then NOT VALID keys one table per migration with a per-writer read). The five
--   variant pairs are kept (toolbox rule) until a fold resolves siblings. anon cannot read the table, so a public platform
--   page (SC) needs a read policy decision first. Readers of url_patterns and supported_observations were not traced
--   function by function.
--
-- CHANGED EXISTING COMMENTS. Table comment replaced; it said "Registry of data sources. Add new auction houses, forums, or
--   other sources here." (kept in substance). No column comment changed.
--
-- CONTRACT. supabase/sql/test_platform_entity_declaration.sql (PostgreSQL 17, synthetic rows, CI job metric-fold-health-contract).
-- MEASURED BEFORE (12:10Z): v_stacks S25 0/2, S46 0/2, SC 1/5; 'platform entity' missing in 3 stacks; substrates declared
--   1 of 61; observation_sources described 5 of 22.
-- EXPECTED AFTER: S25 1/2, S46 1/2, SC 2/5; missing in 0 stacks; declared 2 of 61; described 22 of 22.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- 1. The declaration ------------------------------------------------------------------------------------------------------
UPDATE public.stack_substrates
SET declared_table = 'observation_sources',
    declared_at    = now(),
    declared_by    = 'migration 20261007233000 (lead session skylar-64, Claude Fable 5.1), from docs/proposals/2026-10-07-platform-entity.md (PR #795)',
    note           = note || ' Declared 2026-10-07: observation_sources (192 sources, key slug; 7 tables key to it). The platform text columns (vehicles.platform_source, vehicle_events.source_platform, auction_comments.platform, external_listings.platform, vehicle_location_observations.source_platform) match its slug on 67-100% of sampled rows; the rest are spellings proposed as alias rows (#798), after which NOT VALID keys follow one table at a time. source_registry and live_auction_sources are configuration tables that key to it.'
WHERE substrate = 'platform entity' AND declared_table IS NULL;

-- 2. Comments ---------------------------------------------------------------------------------------------------------------
COMMENT ON TABLE public.observation_sources IS
'The platform entity: one row per source an observation can come from (grain: one source; PRIMARY KEY id, UNIQUE slug), with its category, trust and coverage. 192 rows on 2026-10-07, created 2026-01-24 .. 2026-10-05: registry 37, marketplace 30, auction 27, dealer 16, internal 15, forum 13, documentation 13, shop 13, social_media 11, owner 10, aggregator 5, museum 1, agent 1 (the source_category values media and event are unused). Declared on 2026-10-07 as the table behind stack_substrates ''platform entity'' (migration 20261007233000, from docs/proposals/2026-10-07-platform-entity.md): its slug matches the writers'' platform text on 67-100% of sampled rows (vehicles.platform_source 67%, vehicle_events.source_platform 91%, auction_comments.platform 100%, external_listings.platform 82%, vehicle_location_observations.source_platform 96%); the rest are spellings proposed as alias rows (#798: bringatrailer, barrettjackson, classiccars, user-submission). Five separator-variant pairs exist as separate rows (broad-arrow/broad_arrow, cars-and-bids/cars_and_bids, classic-driver/classicdriver, dupont-registry/dupontregistry, er-classics/erclassics), kept until a fold resolves siblings to one platform. Keys to it: vehicle_observations.source_id, pending_claims.source_id, coverage_targets.source_id, observation_extractors.source_id, source_census.source_id, agent_registrations.observation_source_id, source_registry.observation_source_id. Writers: migrations, fn_schema_proposal_apply (add_source proposals), evaluate_agent_tier (agent tier), the owner-run K5 ingest scripts; 2 inserts and 1 update since the statistics reset; 3,302,811 index scans (ingest and the API read it on every observation). Access: RLS on; policy allow_authenticated_read_observation_sources (SELECT) for authenticated; anon reads 0 rows; service_role and postgres read all. Registry: pipeline_registry table-level row (owned_by supabase/migrations). Clock: created_at and updated_at are row clocks; a source''s trust is as of its last update.';
COMMENT ON COLUMN public.observation_sources.id IS
'Surrogate key of the source; the id that vehicle_observations.source_id, pending_claims.source_id, coverage_targets.source_id, observation_extractors.source_id, source_census.source_id, agent_registrations.observation_source_id and source_registry.observation_source_id reference. Unit: none (uuid). Source: gen_random_uuid() default. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.slug IS
'Machine name of the source, UNIQUE (observation_sources_slug_key), lower case with hyphens or underscores (both occur: five separator-variant pairs are separate rows). The value the platform text columns are meant to carry (vehicles.platform_source, vehicle_events.source_platform, auction_comments.platform, external_listings.platform, vehicle_location_observations.source_platform; matched on 67-100% of sampled rows, 2026-10-07). Filled on all 192 rows. Unit: none (code). Source: the migration or add_source proposal that registered the row. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.display_name IS
'Human name of the source (Bring a Trailer, ClassicCars.com). NOT NULL; filled on all 192 rows (2026-10-07). Unit: none (text). Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.category IS
'Kind of source: source_category enum (auction, marketplace, forum, social_media, registry, shop, documentation, owner, aggregator, media, event, internal, dealer, museum, agent). NOT NULL. 13 values used on 192 rows (2026-10-07): registry 37, marketplace 30, auction 27, dealer 16, internal 15, forum 13, documentation 13, shop 13, social_media 11, owner 10, aggregator 5, museum 1, agent 1; media and event unused. Unit: none (enum). Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.base_url IS
'Home URL of the source. Filled on 113 of 192 rows (2026-10-07); NULL for internal, agent and owner sources that have no site. Unit: none (URL). Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.url_patterns IS
'URL patterns a listing or page URL matches to be attributed to this source. Filled on 10 of 192 rows (2026-10-07). Unit: none (text[] of patterns). Source: registration (fn_schema_proposal_apply copies the proposal''s url_patterns array). Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.base_trust_score IS
'Starting trust for testimony from this source before per-row factors, 0..1 with two decimals (numeric(3,2)); default 0.50. Filled on all 192 rows (2026-10-07): 0.10 .. 1.00, 22 rows at the default. Companion fields: trust_factors, tier, veracity, consecration, decay_half_life_days. Unit: probability-like score 0..1. Source: registration; evaluate_agent_tier adjusts agent sources. Grain: one source. Clock: as of updated_at.';
COMMENT ON COLUMN public.observation_sources.trust_factors IS
'Named adjustments to the base trust, free-shape jsonb (default {}). Non-empty on 65 of 192 rows (2026-10-07). Unit: none (jsonb object). Source: registration (fn_schema_proposal_apply requires an object). Grain: one source. Clock: as of updated_at.';
COMMENT ON COLUMN public.observation_sources.supported_observations IS
'Observation kinds this source is declared to emit: observation_kind[] (listing, sale_result, comment, bid, sighting, work_record, ownership, specification, provenance, valuation, condition, media, social_mention, expert_opinion, splice, activity, offer). Filled on 175 of 192 rows (2026-10-07). A declared capability, not a count of what arrived. Unit: none (enum array). Source: registration (fn_schema_proposal_apply copies the proposal''s array). Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.requires_auth IS
'Whether reading the source needs a signed-in session on its site. Default false; true on 6 of 192 rows (2026-10-07). Unit: none (boolean). Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.rate_limit_per_hour IS
'Requests per hour the source tolerates, as declared at registration. Filled on 1 of 192 rows (2026-10-07). Unit: requests per hour. Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.makes_covered IS
'Vehicle makes the source covers, as declared. Filled on 1 of 192 rows (2026-10-07). Unit: none (text[]). Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.years_covered IS
'Model years the source covers, as declared. Filled on 1 of 192 rows (2026-10-07). Unit: model years (int4range). Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.regions_covered IS
'Regions the source covers, as declared. Filled on 2 of 192 rows (2026-10-07). Unit: none (text[]). Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.notes IS
'Free text about the source: what it is, its trust reasoning, and the spelling aliases its rows carry elsewhere (bat: bringatrailer; cars-and-bids: cars_and_bids, carsandbids). Filled on 186 of 192 rows (2026-10-07). Unit: none (text). Source: registration. Grain: one source. Clock: n/a.';
COMMENT ON COLUMN public.observation_sources.created_at IS
'When the row was registered: default now(). 2026-01-24 .. 2026-10-05 on the 192 rows (2026-10-07). Unit: timestamptz. Source: column default. Grain: one source. Clock: ingest time of the registration.';
COMMENT ON COLUMN public.observation_sources.updated_at IS
'When the row was last written: default now(), set by the writer (no update trigger on the table). Latest 2026-10-05 (2026-10-07). Unit: timestamptz. Source: the writer. Grain: one source. Clock: ingest time of the last write.';

-- 3. Registry -------------------------------------------------------------------------------------------------------------
UPDATE public.pipeline_registry
SET write_via = write_via || ' Declared as the platform entity (stack_substrates ''platform entity'', migration 20261007233000); alias spellings arrive as add_source proposals (#798); NOT VALID keys from the platform text columns follow one table at a time.',
    updated_at = now()
WHERE table_name = 'observation_sources' AND column_name IS NULL
  AND write_via NOT LIKE '%platform entity%';

-- 4. Read the effect where the registry functions exist (skipped in the isolated contract) ---------------------------------
DO $$
DECLARE r record; n integer;
BEGIN
  IF to_regprocedure('public.stack_coverage(text)') IS NOT NULL THEN
    FOR r IN SELECT stack_id, coverage, n_present, n_needs FROM public.stack_coverage(NULL) WHERE stack_id IN ('S25', 'S46', 'SC') ORDER BY stack_id LOOP
      RAISE NOTICE '% after the declaration: coverage % (% of %)', r.stack_id, r.coverage, r.n_present, r.n_needs;
    END LOOP;
  END IF;
  IF to_regclass('public.v_stacks') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.v_stacks WHERE 'platform entity' = ANY (needs_missing);
    RAISE NOTICE 'stacks still missing the platform entity: % (3 before)', n;
  END IF;
END $$;

COMMIT;
