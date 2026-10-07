-- Isolated PostgreSQL 17 contract for 20261007020000_ownership_claim_contract.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_ownership_claims_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_ownership_claims_ci -f supabase/sql/test_ownership_claim_contract.sql
-- Fixtures carry the live columns the migration reads (prod, 2026-10-07): vehicle_observations, auction_comments,
-- auction_events, ownership_transfers, vehicle_events, external_identities, observation_properties, observation_sources,
-- schema_proposals (with its live CHECKs) and the observation_kind and transfer_status enums. Phase 2 adds the live
-- comment branch of validate_comment_observation_source() to prove the two gates coexist.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- A statement must be refused with check_violation and a message containing the fragment.
CREATE FUNCTION pg_temp.refused(label text, stmt text, fragment text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN check_violation THEN
    IF position(fragment IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'Contract failed: % was refused for another reason: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS % (refused: %)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

-- Live shapes (the columns the migration and its readers touch) ---------------------------------------------------------
CREATE TYPE public.observation_kind AS ENUM ('listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record',
  'ownership', 'specification', 'provenance', 'valuation', 'condition', 'media', 'social_mention', 'expert_opinion',
  'splice', 'activity', 'offer');
CREATE TYPE public.transfer_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled', 'disputed', 'stalled');
CREATE TABLE public.external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL, handle text NOT NULL,
  created_at timestamptz DEFAULT now(), UNIQUE (platform, handle));
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text, vin text,
  is_public boolean DEFAULT true);
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text, source_url text, outcome text,
  auction_end_date timestamptz,
  seller_external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,
  winning_bidder_external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now());
CREATE INDEX idx_auction_events_vehicle ON public.auction_events (vehicle_id);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE,
  vehicle_id uuid, platform text DEFAULT 'bat', comment_type text, bid_amount numeric, is_seller boolean DEFAULT false,
  posted_at timestamptz, comment_text text,
  external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL);
CREATE INDEX idx_auction_comments_external_identity ON public.auction_comments (external_identity_id);
CREATE TABLE public.ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  from_identity_id uuid REFERENCES public.external_identities(id), to_identity_id uuid REFERENCES public.external_identities(id),
  trigger_table text, trigger_id uuid, status public.transfer_status DEFAULT 'in_progress', sale_date timestamptz,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_platform text,
  seller_external_identity_id uuid, sold_at timestamptz, ended_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.observation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE, base_trust_score numeric(3,2),
  supported_observations public.observation_kind[]);
CREATE TABLE public.observation_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_key text NOT NULL UNIQUE, label text, data_type text,
  namespace text NOT NULL DEFAULT 'pending', category text, applies_to_kinds public.observation_kind[],
  cardinality text, discriminator_key text, verification_scope text, proposed_by_proposal_id uuid,
  created_at timestamptz DEFAULT now(), ratified_at timestamptz, deprecated_at timestamptz);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, observed_at timestamptz NOT NULL,
  ingested_at timestamptz DEFAULT now(), source_id uuid REFERENCES public.observation_sources(id), source_url text,
  source_identifier text, observer_id uuid REFERENCES public.external_identities(id), observer_raw jsonb,
  kind public.observation_kind NOT NULL, content_text text, content_hash text,
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb, confidence_score numeric(3,2),
  is_processed boolean DEFAULT false, processing_metadata jsonb, is_superseded boolean DEFAULT false,
  superseded_by uuid REFERENCES public.vehicle_observations(id), superseded_at timestamptz, extraction_method text,
  merged_from_vehicle_id uuid, rank text NOT NULL DEFAULT 'normal',
  property_id uuid REFERENCES public.observation_properties(id),
  subject_type text NOT NULL DEFAULT 'vehicle', subject_id uuid,
  source_comment_id uuid REFERENCES public.auction_comments(id), source_vehicle_event_id uuid, source_snapshot_id uuid);
CREATE INDEX idx_vehicle_observations_property ON public.vehicle_observations (vehicle_id, property_id)
  WHERE property_id IS NOT NULL AND is_superseded = false;
CREATE TABLE public.schema_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposed_at timestamptz NOT NULL DEFAULT now(),
  proposed_by_user_id uuid, proposed_by_agent_key text, proposal_type text NOT NULL, payload jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb, motivating_observation_ids uuid[], motivating_pending_claim_ids uuid[],
  estimated_scope jsonb, backward_compatibility jsonb, status text NOT NULL DEFAULT 'open', claimed_by_user_id uuid,
  claimed_at timestamptz, resolved_at timestamptz, decision_rationale text, promoted_to_id uuid,
  supersedes_proposal_id uuid REFERENCES public.schema_proposals(id), superseded_by uuid REFERENCES public.schema_proposals(id),
  CONSTRAINT proposer_present CHECK (proposed_by_user_id IS NOT NULL OR proposed_by_agent_key IS NOT NULL),
  CONSTRAINT schema_proposals_status_check CHECK (status = ANY (ARRAY['open', 'under_review', 'approved', 'rejected',
    'needs_changes', 'superseded', 'withdrawn'])),
  CONSTRAINT schema_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY['add_property', 'fork_property',
    'deprecate_property', 'modify_property', 'add_source', 'modify_trust_tier', 'add_observation_kind',
    'add_source_category', 'add_image_attribute', 'add_column', 'add_table'])));
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;

\ir ../migrations/20261007020000_ownership_claim_contract.sql

-- Fixtures ----------------------------------------------------------------------------------------------------------------
INSERT INTO public.observation_sources (slug, base_trust_score, supported_observations)
VALUES ('bat', 0.85, ARRAY['listing', 'sale_result', 'comment', 'bid', 'condition', 'specification']::public.observation_kind[]);
-- An image property that is already core, to prove other property rows pass untouched.
INSERT INTO public.observation_properties (property_key, namespace, applies_to_kinds, ratified_at)
VALUES ('image_visible_rust_severity', 'core', ARRAY['condition']::public.observation_kind[], now());
INSERT INTO public.external_identities (platform, handle) VALUES
  ('bat', 'past_owner'), ('bat', 'seller'), ('bat', 'buyer'), ('bat', 'overclaimer'), ('bat', 'spotter'),
  ('bat', 'stranger'), ('bat', 'first_seller'), ('bat', 'family'), ('bat', 'merge_speaker');
CREATE TEMP TABLE who AS SELECT handle, id FROM public.external_identities;
CREATE FUNCTION pg_temp.who(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM who WHERE handle = p $$;

INSERT INTO public.vehicles (id, year, make, model) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1963, 'Austin-Healey', '3000'),
  ('00000000-0000-0000-0000-0000000000a9', 1970, 'Datsun', '240Z'),
  ('00000000-0000-0000-0000-0000000000aa', 1970, 'Datsun', '240Z');
-- The vehicle's recorded sale chain: first_seller -> past_owner (2018), past_owner -> seller (2021), seller -> buyer (2025).
INSERT INTO public.auction_events (id, vehicle_id, source, outcome, auction_end_date, seller_external_identity_id,
  winning_bidder_external_identity_id, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'bat', 'sold',
   '2018-06-20 19:00Z', pg_temp.who('first_seller'), pg_temp.who('past_owner'), '2018-06-21'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'bat', 'sold',
   '2021-11-05 19:00Z', pg_temp.who('past_owner'), pg_temp.who('seller'), '2021-11-06'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'bat', 'sold',
   '2025-12-11 19:00Z', pg_temp.who('seller'), pg_temp.who('buyer'), '2025-12-01'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000a9', 'bat', 'reserve_not_met',
   '2024-03-01 19:00Z', NULL, NULL, '2024-02-20');
INSERT INTO public.ownership_transfers (vehicle_id, from_identity_id, to_identity_id, trigger_table, trigger_id, sale_date, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.who('past_owner'), pg_temp.who('seller'), 'auction_events',
   '00000000-0000-0000-0000-0000000000e2', '2021-11-05 19:00Z', '2021-11-06'),
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.who('seller'), pg_temp.who('buyer'), 'auction_events',
   '00000000-0000-0000-0000-0000000000e3', '2025-12-11 19:00Z', '2025-12-12');
INSERT INTO public.vehicle_events (vehicle_id, source_platform, seller_external_identity_id, sold_at, ended_at, created_at)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'bat', pg_temp.who('seller'), '2025-12-11 19:00Z', '2025-12-11 19:00Z', '2025-12-01');
-- Comments on the 2025 lot. Text is synthetic.
INSERT INTO public.auction_comments (id, auction_event_id, vehicle_id, is_seller, posted_at, comment_text, external_identity_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1',
   false, '2025-12-06 15:00Z', 'Previous owner here. I owned this car from 2018 to 2021 and sold it here.', pg_temp.who('past_owner')),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1',
   true, '2025-12-02 15:00Z', 'Thanks all. I bought it in November 2021 and drove it every summer.', pg_temp.who('seller')),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1',
   false, '2025-12-07 15:00Z', 'I owned this car from 2015 to 2023, longest I kept any car.', pg_temp.who('overclaimer')),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1',
   false, '2025-12-08 15:00Z', 'I have seen this car in person at a show. Lovely.', pg_temp.who('spotter')),
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1',
   false, '2025-12-08 16:00Z', 'Nice car, good luck with the sale.', pg_temp.who('stranger')),
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1',
   false, '2025-12-09 16:00Z', 'This was my dad''s car for years.', pg_temp.who('family')),
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000a9',
   false, '2024-02-25 16:00Z', 'I was the previous owner of this car.', pg_temp.who('merge_speaker'));

-- A perfect claim's structured_data for a comment; NULL arguments are omitted keys.
CREATE FUNCTION pg_temp.sd(p_comment uuid, p_rel text, p_prec text, p_basis text, p_quote text,
  p_se text DEFAULT NULL, p_sl text DEFAULT NULL, p_ee text DEFAULT NULL, p_el text DEFAULT NULL,
  p_detail text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'analysis_kind', 'comment_atom', 'is_inferred', true, 'claim_type', 'ownership_claim',
    'claim_contract', 'ownership_claim_v1', 'statement_kind', 'assertion', 'subject_scope', 'vehicle',
    'trust_tier', 'T3', 'detector', 'claims_regex_v4:contract_test',
    'ownership_relation', p_rel, 'relation_detail', p_detail,
    'speaker_identity_id', c.external_identity_id::text, 'source_comment_id', c.id::text,
    'source_lot_id', c.auction_event_id::text,
    'window_precision', p_prec, 'window_basis', p_basis, 'window_quote', p_quote,
    'window_start_earliest', p_se, 'window_start_latest', p_sl, 'window_end_earliest', p_ee, 'window_end_latest', p_el))
  FROM public.auction_comments c WHERE c.id = p_comment
$$;
-- The INSERT for a claim. p_property: NULL means the ratified ownership_relation row; p_no_property forces NULL.
CREATE FUNCTION pg_temp.claim_stmt(p_comment uuid, p_observer uuid, p_sd jsonb, p_kind text DEFAULT 'comment',
  p_property uuid DEFAULT NULL, p_no_property boolean DEFAULT false, p_content text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO public.vehicle_observations (vehicle_id, observed_at, source_id, kind, content_text,
      structured_data, confidence_score, observer_id, source_comment_id, property_id, extraction_method)
    VALUES (%L, %L, %L, %L::public.observation_kind, %L, %L::jsonb, 0.60, %L, %L, %L, 'claims_regex_v4')$f$,
    c.vehicle_id, c.posted_at, (SELECT id FROM public.observation_sources WHERE slug = 'bat'), p_kind,
    coalesce(p_content, p_sd->>'window_quote', left(c.comment_text, 14)), p_sd, p_observer, c.id,
    CASE WHEN p_no_property THEN NULL
         ELSE coalesce(p_property, (SELECT id FROM public.observation_properties WHERE property_key = 'ownership_relation')) END)
  FROM public.auction_comments c WHERE c.id = p_comment
$$;
CREATE FUNCTION pg_temp.claim(p_comment uuid, p_sd jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  EXECUTE pg_temp.claim_stmt(p_comment, (SELECT external_identity_id FROM public.auction_comments WHERE id = p_comment), p_sd)
    || ' RETURNING id' INTO v;
  RETURN v;
END $$;

-- Phase 1: the gate on its own ----------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the proposal row is open, add_property ownership_relation, proposal vocabulary unchanged',
  (SELECT count(*) = 1 AND bool_and(status = 'open' AND proposal_type = 'add_property'
     AND payload->>'property_key' = 'ownership_relation')
   FROM public.schema_proposals WHERE proposed_by_agent_key = 'claude-opus-5-5-ownership-claims')
  AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'schema_proposals_proposal_type_check')
      LIKE '%add_column%');

SELECT pg_temp.refused('a perfect claim before the property is ratified',
  pg_temp.claim_stmt('00000000-0000-0000-0000-0000000000c1', pg_temp.who('past_owner'),
    pg_temp.sd('00000000-0000-0000-0000-0000000000c1', 'owner_past', 'year', 'source_explicit', 'from 2018 to 2021',
      '2018-01-01', '2018-12-31', '2021-01-01', '2021-12-31'), 'comment', NULL, true),
  'not admitted until the ownership_relation property is ratified');

-- Ratification (the curator's act on approval).
INSERT INTO public.observation_properties (property_key, label, data_type, namespace, category, applies_to_kinds,
  cardinality, discriminator_key, verification_scope, ratified_at)
VALUES ('ownership_relation', 'Ownership relation stated in testimony', 'enum', 'core', 'provenance',
  ARRAY['comment']::public.observation_kind[], 'multi', 'speaker_identity_id', 'instance', now());

CREATE TEMP TABLE claims (name text PRIMARY KEY, id uuid);
INSERT INTO claims VALUES
  ('past_owner', pg_temp.claim('00000000-0000-0000-0000-0000000000c1',
    pg_temp.sd('00000000-0000-0000-0000-0000000000c1', 'owner_past', 'year', 'source_explicit', 'from 2018 to 2021',
      '2018-01-01', '2018-12-31', '2021-01-01', '2021-12-31'))),
  ('seller', pg_temp.claim('00000000-0000-0000-0000-0000000000c2',
    pg_temp.sd('00000000-0000-0000-0000-0000000000c2', 'owner_current', 'month', 'source_explicit', 'in November 2021',
      '2021-11-01', '2021-11-30', NULL, NULL, 'seller'))),
  ('overclaimer', pg_temp.claim('00000000-0000-0000-0000-0000000000c4',
    pg_temp.sd('00000000-0000-0000-0000-0000000000c4', 'owner_past', 'year', 'source_explicit', 'from 2015 to 2023',
      '2015-01-01', '2015-12-31', '2023-01-01', '2023-12-31'))),
  ('spotter', pg_temp.claim('00000000-0000-0000-0000-0000000000c5',
    pg_temp.sd('00000000-0000-0000-0000-0000000000c5', 'bystander', 'none', 'none', NULL))),
  ('family', pg_temp.claim('00000000-0000-0000-0000-0000000000c7',
    pg_temp.sd('00000000-0000-0000-0000-0000000000c7', 'family', 'none', 'none', NULL, NULL, NULL, NULL, NULL, 'parent')));
SELECT pg_temp.ok('five perfect claims are admitted after ratification',
  (SELECT count(*) FROM claims WHERE id IS NOT NULL) = 5);

-- Attacks. Each is refused with check_violation and its own message.
CREATE FUNCTION pg_temp.base() RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.sd('00000000-0000-0000-0000-0000000000c1', 'owner_past', 'year', 'source_explicit', 'from 2018 to 2021',
    '2018-01-01', '2018-12-31', '2021-01-01', '2021-12-31') $$;
CREATE FUNCTION pg_temp.attack(p_sd jsonb, p_observer text DEFAULT 'past_owner', p_kind text DEFAULT 'comment',
  p_no_property boolean DEFAULT false, p_comment uuid DEFAULT '00000000-0000-0000-0000-0000000000c1') RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.claim_stmt(p_comment, pg_temp.who(p_observer), p_sd, p_kind, NULL, p_no_property) $$;

SELECT pg_temp.refused('another identity speaking through the comment', pg_temp.attack(pg_temp.base(), 'stranger'),
  'keyed author');
SELECT pg_temp.refused('a claim with no speaker', replace(pg_temp.attack(pg_temp.base()),
  quote_literal(pg_temp.who('past_owner')::text), 'NULL'), 'with its source comment and speaker');
SELECT pg_temp.refused('a claim landed as kind ownership', pg_temp.attack(pg_temp.base(), 'past_owner', 'ownership'),
  'is a comment atom on property ownership_relation');
SELECT pg_temp.refused('a claim with no property row', pg_temp.attack(pg_temp.base(), 'past_owner', 'comment', true),
  'is a comment atom on property ownership_relation');
SELECT pg_temp.refused('a relation outside the vocabulary',
  pg_temp.attack(pg_temp.base() || '{"ownership_relation": "owner"}'), 'ownership_relation is outside');
SELECT pg_temp.refused('a detail outside the vocabulary',
  pg_temp.attack(pg_temp.base() || '{"relation_detail": "cousin_in_law"}'), 'relation_detail is outside');
SELECT pg_temp.refused('a null detail instead of an omitted one',
  pg_temp.attack(pg_temp.base() || '{"relation_detail": null}'), 'relation_detail is outside');
SELECT pg_temp.refused('a non-seller speaking as the seller',
  pg_temp.attack(pg_temp.base() || '{"ownership_relation": "owner_current", "relation_detail": "seller"}'),
  'only the lot''s flagged seller');
SELECT pg_temp.refused('the flagged seller claiming past ownership of its own lot',
  pg_temp.attack(pg_temp.sd('00000000-0000-0000-0000-0000000000c2', 'owner_past', 'none', 'none', NULL), 'seller',
    'comment', false, '00000000-0000-0000-0000-0000000000c2'), 'cannot claim past ownership');
SELECT pg_temp.refused('window words that are not in the comment',
  pg_temp.attack(pg_temp.base() || '{"window_quote": "from 2017 to 2021"}'), 'exact source words');
SELECT pg_temp.refused('a window that ends after the statement',
  pg_temp.attack(pg_temp.base() || '{"window_end_latest": "2026-01-01"}'), 'not after the statement');
SELECT pg_temp.refused('a start whose earliest bound is after its latest',
  pg_temp.attack(pg_temp.base() || '{"window_start_earliest": "2019-01-01"}'), 'must be ordered');
SELECT pg_temp.refused('an unpaired bound',
  pg_temp.attack(pg_temp.base() - 'window_start_latest'), 'a window bound is a pair');
SELECT pg_temp.refused('a dated window with no bounds',
  pg_temp.attack(pg_temp.base() - ARRAY['window_start_earliest', 'window_start_latest', 'window_end_earliest',
    'window_end_latest']), 'states at least one bound');
SELECT pg_temp.refused('no window yet a bound',
  pg_temp.attack(pg_temp.base() || '{"window_precision": "none", "window_basis": "none"}'), 'carries no bounds');
SELECT pg_temp.refused('an impossible date',
  pg_temp.attack(pg_temp.base() || '{"window_start_latest": "2018-02-30"}'), 'is not an ISO date');
SELECT pg_temp.refused('a precision outside the vocabulary',
  pg_temp.attack(pg_temp.base() || '{"window_precision": "season"}'), 'outside its vocabulary');
SELECT pg_temp.refused('a speaker key that differs from observer_id',
  pg_temp.attack(pg_temp.base() || jsonb_build_object('speaker_identity_id', pg_temp.who('stranger')::text)),
  'disagree with contract');
SELECT pg_temp.refused('a lot key that is not the comment''s lot',
  pg_temp.attack(pg_temp.base() || '{"source_lot_id": "00000000-0000-0000-0000-0000000000e2"}'), 'disagree with contract');
SELECT pg_temp.refused('an inferred claim that calls itself T1',
  pg_temp.attack(pg_temp.base() || '{"trust_tier": "T1"}'), 'disagree with contract');
SELECT pg_temp.refused('a claim with no detector', pg_temp.attack(pg_temp.base() - 'detector'), 'disagree with contract');
SELECT pg_temp.refused('a window length that is not a pair of whole days',
  pg_temp.attack(pg_temp.base() || '{"window_length_days_min": 400, "window_length_days_max": 300}'), 'window length');
SELECT pg_temp.refused('a plain comment atom that names someone other than its author',
  format($f$INSERT INTO public.vehicle_observations (vehicle_id, observed_at, source_id, kind, content_text, structured_data,
      confidence_score, observer_id, source_comment_id)
    VALUES ('00000000-0000-0000-0000-0000000000a1', '2025-12-08 16:00Z', %L, 'comment', 'Nice car',
      '{"analysis_kind": "comment_atom", "is_inferred": true}', 0.5, %L, '00000000-0000-0000-0000-0000000000c6')$f$,
    (SELECT id FROM public.observation_sources WHERE slug = 'bat'), pg_temp.who('spotter')),
  'observer must be the comment''s author');

-- Rows that are not ownership claims pass untouched.
INSERT INTO public.vehicle_observations (vehicle_id, observed_at, source_id, kind, content_text, structured_data,
  confidence_score, source_comment_id)
VALUES ('00000000-0000-0000-0000-0000000000a1', '2025-12-08 16:00Z', (SELECT id FROM public.observation_sources WHERE slug = 'bat'),
  'comment', 'Nice car', '{"analysis_kind": "comment_atom", "is_inferred": true, "claim_type": "ownership_claim"}', 0.5,
  '00000000-0000-0000-0000-0000000000c6');
INSERT INTO public.vehicle_observations (vehicle_id, observed_at, source_id, kind, content_text, structured_data,
  confidence_score, observer_id, source_comment_id)
VALUES ('00000000-0000-0000-0000-0000000000a1', '2025-12-08 16:00Z', (SELECT id FROM public.observation_sources WHERE slug = 'bat'),
  'comment', 'Nice car', '{"analysis_kind": "comment_atom", "is_inferred": true}', 0.5, pg_temp.who('stranger'),
  '00000000-0000-0000-0000-0000000000c6');
INSERT INTO public.vehicle_observations (vehicle_id, observed_at, source_id, kind, structured_data, property_id)
VALUES ('00000000-0000-0000-0000-0000000000a1', '2025-12-01', (SELECT id FROM public.observation_sources WHERE slug = 'bat'),
  'condition', '{"image_visible_rust_severity": "surface", "image_id": "00000000-0000-0000-0000-00000000f001"}',
  (SELECT id FROM public.observation_properties WHERE property_key = 'image_visible_rust_severity'));
INSERT INTO public.vehicle_observations (vehicle_id, observed_at, source_id, kind, structured_data)
VALUES ('00000000-0000-0000-0000-0000000000a1', '2025-12-01', (SELECT id FROM public.observation_sources WHERE slug = 'bat'),
  'listing', '{"title": "1963 roadster"}');
SELECT pg_temp.ok('a refinery atom, an atom naming its author, an image property and a listing all pass',
  (SELECT count(*) FROM public.vehicle_observations WHERE NOT (structured_data ? 'ownership_relation')) = 4);

-- The immutability guard.
SELECT pg_temp.refused('rewriting a claim''s window',
  format('UPDATE public.vehicle_observations SET structured_data = structured_data || %L WHERE id = %L',
    '{"window_end_latest": "2022-12-31"}', (SELECT id FROM claims WHERE name = 'past_owner')), 'immutable testimony');
SELECT pg_temp.refused('reattributing a claim to another speaker',
  format('UPDATE public.vehicle_observations SET observer_id = %L WHERE id = %L', pg_temp.who('stranger'),
    (SELECT id FROM claims WHERE name = 'past_owner')), 'immutable testimony');
SELECT pg_temp.refused('rewriting a claim''s quote',
  format('UPDATE public.vehicle_observations SET content_text = %L WHERE id = %L', 'from 2018',
    (SELECT id FROM claims WHERE name = 'past_owner')), 'immutable testimony');
SELECT pg_temp.refused('moving a claim to another vehicle without a merge',
  format('UPDATE public.vehicle_observations SET vehicle_id = %L WHERE id = %L', '00000000-0000-0000-0000-0000000000aa',
    (SELECT id FROM claims WHERE name = 'past_owner')), 'immutable testimony');
SELECT pg_temp.refused('turning a plain atom into a claim by update',
  format('UPDATE public.vehicle_observations SET structured_data = structured_data || %L WHERE content_text = %L AND observer_id IS NULL',
    '{"ownership_relation": "owner_past", "claim_contract": "ownership_claim_v1"}', 'Nice car'), 'cannot become an ownership claim');
UPDATE public.vehicle_observations SET is_processed = true, processing_metadata = '{"pass": 1}'
WHERE id = (SELECT id FROM claims WHERE name = 'spotter');
SELECT pg_temp.ok('processing state may change on a claim',
  (SELECT is_processed FROM public.vehicle_observations WHERE id = (SELECT id FROM claims WHERE name = 'spotter')));

-- A vehicle merge relinks the lot, its comment and the claim in place (merge_vehicles_into order: comments, then
-- observations). merged_from_vehicle_id names the old vehicle.
INSERT INTO claims VALUES ('merge', pg_temp.claim('00000000-0000-0000-0000-0000000000c9',
  pg_temp.sd('00000000-0000-0000-0000-0000000000c9', 'owner_past', 'none', 'none', NULL)));
UPDATE public.auction_events SET vehicle_id = '00000000-0000-0000-0000-0000000000aa'
WHERE id = '00000000-0000-0000-0000-0000000000e9';
UPDATE public.auction_comments SET vehicle_id = '00000000-0000-0000-0000-0000000000aa'
WHERE id = '00000000-0000-0000-0000-0000000000c9';
UPDATE public.vehicle_observations
SET vehicle_id = '00000000-0000-0000-0000-0000000000aa', merged_from_vehicle_id = '00000000-0000-0000-0000-0000000000a9'
WHERE id = (SELECT id FROM claims WHERE name = 'merge');
SELECT pg_temp.ok('a merge relinks a claim in place',
  (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000aa' FROM public.vehicle_observations
   WHERE id = (SELECT id FROM claims WHERE name = 'merge')));

-- The relation fold ----------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE r19 AS SELECT * FROM public.identity_vehicle_relation(pg_temp.who('past_owner'),
  '00000000-0000-0000-0000-0000000000a1', '2019-06-01');
SELECT pg_temp.ok('past owner: buyer of 2018, seller of 2021, transferor (from the 2021 lot) and the claim',
  (SELECT string_agg(relation, ',' ORDER BY relation) FROM r19) = 'buyer,claimed_owner_past,seller,transferor');
SELECT pg_temp.ok('in mid-2019 the record makes the holding possible, and certain only if the claim is true',
  (SELECT bool_and(possible_at) FROM r19)
  AND (SELECT bool_and(NOT certain_at) FROM r19 WHERE NOT provisional)
  AND (SELECT certain_at FROM r19 WHERE relation = 'claimed_owner_past'));
SELECT pg_temp.ok('buyer bounds: from the 2018 close until at the latest the 2021 sale',
  (SELECT valid_from_latest = '2018-06-20' AND valid_to_latest = '2021-11-05' FROM r19 WHERE relation = 'buyer'));
SELECT pg_temp.ok('seller bounds: after the 2018 sale, until the 2021 close; the transfer names its lot',
  (SELECT valid_from_earliest = '2018-06-20' AND valid_to_earliest = '2021-11-05' AND valid_to_latest = '2021-11-05'
   FROM r19 WHERE relation = 'seller')
  AND (SELECT derived_from_id = '00000000-0000-0000-0000-0000000000e2' FROM r19 WHERE relation = 'transferor'));
SELECT pg_temp.ok('on the 2021 close day the seller of record certainly held it',
  (SELECT certain_at FROM public.identity_vehicle_relation(pg_temp.who('past_owner'),
     '00000000-0000-0000-0000-0000000000a1', '2021-11-05') WHERE relation = 'seller'));
SELECT pg_temp.ok('in 2023 nothing places the past owner on the vehicle',
  NOT EXISTS (SELECT 1 FROM public.identity_vehicle_relation(pg_temp.who('past_owner'),
    '00000000-0000-0000-0000-0000000000a1', '2023-01-01') WHERE possible_at));
SELECT pg_temp.ok('point in time: known by 2020, only the 2018 win exists and it is open-ended',
  (SELECT count(*) = 1 AND bool_and(relation = 'buyer' AND valid_to_latest IS NULL)
   FROM public.identity_vehicle_relation(pg_temp.who('past_owner'), '00000000-0000-0000-0000-0000000000a1',
     '2019-06-01', '2020-01-01')));
SELECT pg_temp.ok('the 2025 seller: buyer in 2021, seller, transferor, listing seller and the claim',
  (SELECT string_agg(relation, ',' ORDER BY relation) FROM public.identity_vehicle_relation(pg_temp.who('seller'),
     '00000000-0000-0000-0000-0000000000a1', '2024-01-01'))
  = 'buyer,claimed_owner_current,listing_seller,seller,transferee,transferor');
SELECT pg_temp.ok('a stranger has no relation', NOT EXISTS (SELECT 1 FROM public.identity_vehicle_relation(
  pg_temp.who('stranger'), '00000000-0000-0000-0000-0000000000a1')));

-- Corroboration ----------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE c_past AS SELECT * FROM public.ownership_claim_corroboration((SELECT id FROM claims WHERE name = 'past_owner'));
SELECT pg_temp.ok('past owner: party to both lots, won at the stated start, sold at the stated end, no contradiction',
  (SELECT string_agg(rule, ',' ORDER BY rule) FROM c_past)
  = 'keyed_party_before_statement,keyed_party_before_statement,sold_lot_at_window_end,won_lot_at_window_start'
  AND (SELECT bool_and(verdict = 'corroborates' AND informative) FROM c_past));
SELECT pg_temp.ok('overclaimer: two sales by other people inside the stated 2015-2023 tenure contradict it',
  (SELECT count(*) = 2 AND bool_and(verdict = 'contradicts' AND rule = 'third_party_sale_inside_window')
   FROM public.ownership_claim_corroboration((SELECT id FROM claims WHERE name = 'overclaimer'))));
SELECT pg_temp.ok('seller: the own-lot key agrees but is not informative; the 2021 win corroborates the stated start',
  (SELECT string_agg(rule || ':' || informative, ',' ORDER BY rule)
   FROM public.ownership_claim_corroboration((SELECT id FROM claims WHERE name = 'seller')))
  = 'own_lot_seller_key:false,won_lot_at_window_start:true');
SELECT pg_temp.ok('a sighting has no keyed rule in v1',
  NOT EXISTS (SELECT 1 FROM public.ownership_claim_corroboration((SELECT id FROM claims WHERE name = 'spotter'))));
SELECT pg_temp.ok('point in time: before the claim was recorded there is nothing to grade',
  NOT EXISTS (SELECT 1 FROM public.ownership_claim_corroboration((SELECT id FROM claims WHERE name = 'past_owner'), '2025-01-01')));

-- The per-identity record --------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('past owner: one claim, corroborated, calibration 2/3',
  (SELECT claims_total = 1 AND claims_evaluable = 1 AND corroborated = 1 AND contradicted = 0 AND calibration = 0.6667
     AND basis->>'record' = 'resolved'
   FROM public.identity_claim_calibration(pg_temp.who('past_owner'))));
SELECT pg_temp.ok('overclaimer: one claim, contradicted, calibration 1/3',
  (SELECT contradicted = 1 AND corroborated = 0 AND calibration = 0.3333
   FROM public.identity_claim_calibration(pg_temp.who('overclaimer'))));
SELECT pg_temp.ok('the seller is graded on the informative rule only: corroborated by the 2021 win',
  (SELECT corroborated = 1 AND calibration = 0.6667 FROM public.identity_claim_calibration(pg_temp.who('seller'))));
SELECT pg_temp.ok('a spotter has a claim but no resolved record: NULL, not a neutral score',
  (SELECT claims_total = 1 AND claims_evaluable = 0 AND calibration IS NULL AND basis->>'record' = 'no_resolved_claims'
   FROM public.identity_claim_calibration(pg_temp.who('spotter'))));
SELECT pg_temp.ok('a stranger has no claims: NULL',
  (SELECT claims_total = 0 AND calibration IS NULL AND basis->>'record' = 'no_claims'
   FROM public.identity_claim_calibration(pg_temp.who('stranger'))));
SELECT pg_temp.ok('point in time: before the past owner spoke, the record is empty',
  (SELECT claims_total = 0 AND calibration IS NULL
   FROM public.identity_claim_calibration(pg_temp.who('past_owner'), '2025-12-01')));

-- The weight -------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('claim_weight: priors stand when there is no record',
  public.claim_weight('owner_past', NULL) = 0.70 AND public.claim_weight('owner_current', NULL) = 0.70
  AND public.claim_weight('dealer', NULL) = 0.65 AND public.claim_weight('shop', NULL) = 0.55
  AND public.claim_weight('family', NULL) = 0.50 AND public.claim_weight('bystander', NULL) = 0.39);
SELECT pg_temp.ok('claim_weight: the record scales the prior and stays within 0.05 .. 0.95',
  public.claim_weight('owner_past', 0.6667) = 0.9334 AND public.claim_weight('bystander', 0.3333) = 0.2600
  AND public.claim_weight('owner_past', 0) = 0.1750 AND public.claim_weight('owner_current', 1) = 0.95
  AND public.claim_weight('owner_past', 0.5) = 0.70);
SELECT pg_temp.ok('claim_weight: an unknown relation has no weight', public.claim_weight('neighbor', 0.5) IS NULL);
DO $$ BEGIN
  PERFORM public.claim_weight('owner_past', 1.2);
  RAISE EXCEPTION 'Contract failed: a calibration above 1 was accepted';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS claim_weight refuses a calibration outside 0..1';
END $$;

-- Privileges -----------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the readers are service-role only',
  NOT has_function_privilege('anon', 'public.identity_vehicle_relation(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ownership_claim_corroboration(uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.identity_claim_calibration(uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_weight(text,numeric)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.identity_vehicle_relation(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.identity_claim_calibration(uuid,timestamptz)', 'EXECUTE'));
SET ROLE service_role;
DO $$
DECLARE v_past uuid := (SELECT id FROM public.external_identities WHERE handle = 'past_owner');
BEGIN
  IF (SELECT count(*) FROM public.identity_vehicle_relation(v_past, '00000000-0000-0000-0000-0000000000a1')) <> 4
     OR (SELECT calibration FROM public.identity_claim_calibration(v_past)) IS DISTINCT FROM 0.6667
     OR public.claim_weight('owner_past', 0.6667) IS DISTINCT FROM 0.9334 THEN
    RAISE EXCEPTION 'Contract failed: service_role cannot read the fold, the record or the weight';
  END IF;
  RAISE NOTICE 'PASS service_role reads the fold, the rule, the record and the weight';
END $$;
RESET ROLE;

-- Phase 2: coexistence with the live comment gate -----------------------------------------------------------------------------
-- The comment branch of validate_comment_observation_source() as live on 2026-10-07 (its sale-episode branch is not
-- exercised here), with the live trigger names, so it fires first by name order.
CREATE FUNCTION public.validate_comment_observation_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  c public.auction_comments%ROWTYPE;
BEGIN
  IF NEW.source_comment_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.source_comment_id IS NOT NULL THEN
      RAISE EXCEPTION 'a sourced comment claim cannot lose its source link' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM public.auction_comments WHERE id = NEW.source_comment_id FOR SHARE;
  IF NOT FOUND OR c.vehicle_id IS NULL OR NEW.vehicle_id IS DISTINCT FROM c.vehicle_id
    OR c.posted_at IS NULL OR c.bid_amount IS NOT NULL OR c.comment_type = 'bid'
    OR nullif(btrim(c.comment_text), '') IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.auction_events ae WHERE ae.id = c.auction_event_id AND ae.vehicle_id = c.vehicle_id)
    OR NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = c.vehicle_id AND v.is_public IS TRUE) THEN
    RAISE EXCEPTION 'invalid public comment source relation' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind::text IS DISTINCT FROM 'comment' OR NEW.observed_at IS DISTINCT FROM c.posted_at
    OR NEW.confidence_score IS NULL OR NEW.confidence_score < 0 OR NEW.confidence_score > 0.6
    OR NEW.structured_data->'is_inferred' IS DISTINCT FROM 'true'::jsonb
    OR nullif(btrim(NEW.content_text), '') IS NULL OR strpos(c.comment_text, NEW.content_text) = 0 THEN
    RAISE EXCEPTION 'comment claim must retain exact source quote, event clock and inferred qualification' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER trg_validate_comment_observation_source_insert
BEFORE INSERT ON public.vehicle_observations FOR EACH ROW WHEN (NEW.source_comment_id IS NOT NULL)
EXECUTE FUNCTION public.validate_comment_observation_source();
CREATE TRIGGER trg_validate_comment_observation_source_update
BEFORE UPDATE OF source_comment_id, vehicle_id, kind, content_text, observed_at, confidence_score, structured_data
ON public.vehicle_observations FOR EACH ROW WHEN (OLD.source_comment_id IS NOT NULL OR NEW.source_comment_id IS NOT NULL)
EXECUTE FUNCTION public.validate_comment_observation_source();

INSERT INTO claims VALUES ('past_owner_again', pg_temp.claim('00000000-0000-0000-0000-0000000000c1',
  pg_temp.sd('00000000-0000-0000-0000-0000000000c1', 'owner_past', 'none', 'none', NULL) || '{"detector": "second_pass"}'));
SELECT pg_temp.ok('with both gates installed, a perfect claim is still admitted',
  (SELECT id IS NOT NULL FROM claims WHERE name = 'past_owner_again'));
SELECT pg_temp.refused('with both gates installed, a claim quoting words not in the comment',
  pg_temp.claim_stmt('00000000-0000-0000-0000-0000000000c1', pg_temp.who('past_owner'), pg_temp.base(), 'comment', NULL,
    false, 'I owned this car forever'), 'exact source quote');
UPDATE public.vehicle_observations
SET is_superseded = true, superseded_by = (SELECT id FROM claims WHERE name = 'past_owner_again'), superseded_at = now()
WHERE id = (SELECT id FROM claims WHERE name = 'past_owner');
SELECT pg_temp.ok('a claim is superseded, not rewritten, and the fold stops reading it',
  (SELECT is_superseded FROM public.vehicle_observations WHERE id = (SELECT id FROM claims WHERE name = 'past_owner'))
  AND (SELECT count(*) FROM public.identity_vehicle_relation(pg_temp.who('past_owner'),
         '00000000-0000-0000-0000-0000000000a1') WHERE relation = 'claimed_owner_past') = 1);

DO $$ BEGIN RAISE NOTICE 'ownership claim contract: all checks passed'; END $$;
