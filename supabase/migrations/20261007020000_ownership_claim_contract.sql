-- Ownership claims from auction comments: the claim contract, the relation fold, corroboration, the per-identity record
-- and the claim weight. Case: data-machine-cases.md §13.3 (owner, 2026-10-07 00:40Z): "BaT comments already hold people
-- claiming they owned a car at a certain date: find those examples, block that time out, and pursue it."
-- DRAFT for the lead's shape review. The proposal row below is 'open'. Nothing here writes a claim, and the admission
-- gate refuses every ownership claim until the ownership_relation property is ratified (step 2).
--
-- MEASURED (prod, read-only through scripts/data/q.sh, 2026-10-07 00:38Z .. 00:53Z). The memo with the method, the
-- precision table and the example ids is outside the repo because it quotes comment fragments:
-- ~/nuke-logs/claims-20261007/CLAIMS-MEASURE.md.
--   Six independent 0.5% block samples of auction_comments (TABLESAMPLE SYSTEM REPEATABLE, seeds 20261007, 7, 11, 23,
--   37, 41): 594,971 rows, 383,868 of them BaT comments with text that are not bids (64.5%). The table holds about
--   19,982,792 rows (pg_class estimate), so the samples cover 3.0%.
--   A 12-pattern regex family matched 3,599 of the 383,868 (0.94%). Reading 145 matches (89 to tune on one sample,
--   56 to validate on another) gave: the lot's flagged seller describing their own tenure 30/30; a sighting or
--   recollection 12/12; "I was the previous owner of this car" 6/6; "I owned this car ..." 5/5; "I sold this car ..."
--   3/4; family 8/8; "I was the second owner" without "of this" 1/6 (usually another car). Dropped after tuning
--   because they mostly describe the speaker's other car: "I bought it ..." 0/8, "I had this exact ..." 0/6,
--   "owned it for ..." 1/8.
--   Estimated claims about the lot's own vehicle: 119,500, or 0.93% of text comments (95% sampling interval 115,000 ..
--   124,000; 102,000 with every pattern at its Wilson lower bound). By relation: the seller's own tenure 104,700;
--   sighting 7,900; past owner 4,600; family 2,000; shop 270.
--   Windows: 15.8% of matches state a year, month or range; 9.3% a time relative to the comment; 1.0% a decade.
--   Of 48 true claims in the validation read, 18 state a window and the parser recovered 11 of them.
--   Keys on the matched comments today: author 100% (external_identity_id), lot 94.3% (auction_event_id),
--   vehicle 100%.
--   Corroboration of the 95 true claims read: 30 of 38 flagged-seller claims have their own lot's seller key, a seeded
--   transfer or a listing episode on this vehicle. That is the relation as of the lot, never the acquisition date: no
--   claim has a lot won by the speaker on its own vehicle row. 0 of 45 past-owner, family, buyer and shop claims have a
--   keyed lot, transfer or episode on their vehicle row. 78 of the 95 vehicles carry a VIN and no second vehicle row
--   shares one. 3 claims match a same-model lot that the speaker sold or won under another vehicle row at the stated
--   time. That is the physical car split across rows (stack 2's chain layer), which this migration does not repair.
--
-- SEARCH BEFORE MINT (SCHEMA_LAW §1), read live 2026-10-07:
--   vehicle_observations (11.2M rows) is the testimony table. The comment-atom contract (20261003004722) admits one
--     inferred claim per auction comment as kind 'comment' with source_comment_id (FK) under an admission trigger
--     (validate_comment_observation_source: same vehicle, keyed lot, exact quote, observed_at = posted_at, confidence
--     0..0.6, is_inferred). Its claim taxonomy (supabase/functions/_shared/commentRefinery.ts) already names claim_type
--     'ownership_claim'. 0 atoms have landed. An ownership claim here is that atom plus a relation and a window.
--   vehicle_observations.observer_id is already a foreign key to external_identities, described as the comment author
--     and empty everywhere measured. It is the speaker key. No column is added.
--   kind 'ownership' (79 rows, all titles and deal jackets) is not used. proj_disposition, v_vehicle_monthly_basis and
--     v_garage_asset_summary read every 'ownership' row as the Nuke owner's own acquisition activity, and the bat
--     source does not support the kind.
--   A new observation kind is not minted: it would be a synonym of claim_type 'ownership_claim' (SCHEMA_LAW §8).
--   observation_properties (41 rows) is the registry of what a claim is about (AX-003). The proposal registers
--     ownership_relation there on ratification, which gives claims the existing index (vehicle_id, property_id).
--   ownership_transfers (every row seeded from a sold lot), the auction_events seller and winner keys (2026-10-06) and
--     vehicle_events.seller_external_identity_id are the keyed evidence the relation fold reads.
--   relationship_with(person, vehicle, as_of, audience) is not extended. It describes how much an observer has
--     documented (counts over observer_id), not who held the vehicle when, and it has no callers.
--   observer_trust_scores (63 rows: 56 platforms, 7 models, no people; observer_ref is text, not a key) and
--     compute_observer_trust (rewrites a lifetime number in place) are not written. A lifetime number must not weight a
--     past claim (leakage), so the record here is a function of an as-of time. The table can cache it later, keyed.
--   user_trust_weight, vehicle_ownerships and ownership_verifications describe Nuke accounts, not platform identities.
--
-- WHAT THIS ADDS. No table, no column and no testimony row.
--   1. schema_proposals: one 'add_property' row (status 'open') for property ownership_relation and its contract.
--   2. validate_ownership_claim() with trg_validate_ownership_claim_insert, and guard_ownership_claim_update() with
--      trg_guard_ownership_claim_update on vehicle_observations.
--   3. identity_vehicle_relation(identity, vehicle, at, known_at): the relation fold.
--   4. ownership_claim_corroboration(observation, known_at): the v1 corroboration rule.
--   5. identity_claim_calibration(identity, as_of): the per-identity record. It is empty today and returns NULL.
--   6. claim_weight(relation, calibration): the relation prior times the calibration.
--
-- THE CONTRACT (ownership_claim_v1). These structured_data keys sit on a comment atom (kind 'comment',
-- source_comment_id set):
--   analysis_kind 'comment_atom', is_inferred true, claim_type 'ownership_claim', claim_contract 'ownership_claim_v1',
--   statement_kind 'assertion', subject_scope 'vehicle', trust_tier 'T3' (scraped/inferred), detector (pattern id).
--   ownership_relation  owner_current | owner_past | family | shop | dealer | bystander  (the speaker's relation to the
--                       vehicle during the window, as asserted; the property value)
--   relation_detail     optional: seller | buyer | original_owner | heir | spouse | parent | grandparent | sibling |
--                       child | mechanic | painter | restorer | inspector | dealer_staff
--   speaker_identity_id = observer_id; source_comment_id = the column; source_lot_id = the comment's auction_event_id
--   window_precision    day | month | year | decade | relative | duration | none
--   window_basis        source_explicit | relative_to_posted_at | duration_to_posted_at | none
--   window_quote        the exact words that state the window (required unless precision is none)
--   window_start_earliest, window_start_latest, window_end_earliest, window_end_latest
--                       'YYYY-MM-DD' bounds that cover the whole stated period, so a year is never turned into 1 January;
--                       NULL is unknown
--   window_length_days_min, window_length_days_max  optional, for durations
-- Corroboration is not stored in the row. The row is immutable testimony and corroboration grows, so it is the
-- function ownership_claim_corroboration(claim, known_at).
--
-- WRITER (follow-up, not in this migration): ingest-observation accepts observer_id only together with
-- source_comment_id and admits property_key ownership_relation. The trigger checks the speaker against the comment's
-- author key whatever the caller sends. The observer_id column comment ("UNUSED") is updated with that writer.
-- RLS: no table is created. The functions are revoked from PUBLIC, anon and authenticated, and granted to service_role.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. The proposal ------------------------------------------------------------------------------------------------------
INSERT INTO public.schema_proposals (
  proposed_by_agent_key, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
VALUES (
  'claude-opus-5-5-ownership-claims',
  'add_property',
  jsonb_build_object(
    'property_key', 'ownership_relation',
    'label', 'Ownership relation stated in testimony',
    'namespace_on_ratification', 'core',
    'category', 'provenance',
    'data_type', 'enum',
    'cardinality', 'multi',
    'applies_to_kinds', jsonb_build_array('comment'),
    'discriminator_key', 'speaker_identity_id',
    'verification_scope', 'instance',
    'values', jsonb_build_array('owner_current', 'owner_past', 'family', 'shop', 'dealer', 'bystander'),
    'description', 'A speaker''s stated relation to this vehicle during a stated window, read from their own words. '
      'Testimony (T3), provisional until corroborated by keyed lots or transfers; never a title or a transfer.',
    'contract', 'ownership_claim_v1 (keys and rules in the migration header and in validate_ownership_claim())',
    'gate', 'validate_ownership_claim() refuses every ownership claim until a core, undeprecated observation_properties '
      'row ownership_relation exists. Ratifying the property opens the gate.',
    'functions', jsonb_build_array('identity_vehicle_relation', 'ownership_claim_corroboration',
      'identity_claim_calibration', 'claim_weight'),
    'writer', 'ingest-observation (follow-up): accept observer_id with source_comment_id; admit property_key ownership_relation',
    'why', 'Case §13.3: the owner asked to find comments where people say they owned a car at a date, block the time '
      'out on the vehicle''s ownership timeline and pursue it. Weight = relation x calibration.',
    'migration', '20261007020000_ownership_claim_contract.sql'),
  jsonb_build_array(
    jsonb_build_object('measure', 'BaT text comments sampled (six 0.5% block samples)', 'value', 383868, 'at', '2026-10-07T00:53Z'),
    jsonb_build_object('measure', 'comments matched by the 12-pattern family', 'value', 3599, 'denominator', 383868, 'at', '2026-10-07T00:53Z'),
    jsonb_build_object('measure', 'estimated ownership-relation claims in auction_comments', 'value', 119500, 'interval_95', '115000..124000', 'at', '2026-10-07T00:53Z'),
    jsonb_build_object('measure', 'true claims among validation reads', 'value', 48, 'denominator', 56, 'at', '2026-10-07T00:50Z'),
    jsonb_build_object('measure', 'matched comments with a year, month or range', 'value', 566, 'denominator', 3599, 'at', '2026-10-07T00:53Z'),
    jsonb_build_object('measure', 'matched comments keyed to their lot', 'value', 3394, 'denominator', 3599, 'at', '2026-10-07T00:53Z'),
    jsonb_build_object('measure', 'non-seller true claims with a keyed lot, transfer or episode on their vehicle', 'value', 0, 'denominator', 45, 'at', '2026-10-07T00:48Z'),
    jsonb_build_object('measure', 'flagged-seller true claims keyed as seller of their own lot, transfer or episode', 'value', 30, 'denominator', 38, 'at', '2026-10-07T00:47Z')),
  jsonb_build_object('claims_estimated', 119500, 'seller_tenure', 104700, 'sighting', 7900, 'owner_past', 4600,
    'family', 2000, 'shop', 270, 'method', 'stratified: matches per pattern x read precision, scaled by the sample fraction'),
  jsonb_build_object('additive', true, 'tables_created', 0, 'columns_added', 0, 'rows_written', 0,
    'existing_writers_changed', false, 'existing_readers_changed', false,
    'note', 'Two triggers on vehicle_observations fire only for rows that carry the contract, a property_id, or a '
      'comment source together with an observer. Plain comment atoms are unchanged.'),
  'open');

-- 2. The admission gate and the immutability guard ----------------------------------------------------------------------
CREATE FUNCTION public.validate_ownership_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET "TimeZone" = 'UTC'
AS $fn$
DECLARE
  c public.auction_comments%ROWTYPE;
  sd jsonb := NEW.structured_data;
  v_prop uuid;
  v_rel text;
  v_detail text;
  v_prec text;
  v_basis text;
  v_quote text;
  k text;
  se date; sl date; ee date; el date;
  v_said date;
BEGIN
  SELECT p.id INTO v_prop FROM public.observation_properties p
  WHERE p.property_key = 'ownership_relation' AND p.namespace = 'core' AND p.deprecated_at IS NULL;

  -- Every operand is two-valued: a missing key or property must read as false, never NULL.
  IF NOT (sd ? 'ownership_relation' OR coalesce(sd->>'claim_contract' = 'ownership_claim_v1', false)
          OR (v_prop IS NOT NULL AND NEW.property_id IS NOT DISTINCT FROM v_prop)) THEN
    -- Not an ownership claim. A comment atom that names its speaker must name the comment's author.
    IF NEW.source_comment_id IS NOT NULL AND NEW.observer_id IS NOT NULL THEN
      SELECT * INTO c FROM public.auction_comments WHERE id = NEW.source_comment_id;
      IF NOT FOUND OR c.external_identity_id IS DISTINCT FROM NEW.observer_id THEN
        RAISE EXCEPTION 'a comment atom''s observer must be the comment''s author key' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF v_prop IS NULL THEN
    RAISE EXCEPTION 'ownership claims are not admitted until the ownership_relation property is ratified'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.property_id IS DISTINCT FROM v_prop OR NEW.kind::text IS DISTINCT FROM 'comment'
     OR NEW.source_comment_id IS NULL OR NEW.observer_id IS NULL OR NEW.vehicle_id IS NULL
     OR NEW.subject_type IS DISTINCT FROM 'vehicle'
     OR (NEW.subject_id IS NOT NULL AND NEW.subject_id IS DISTINCT FROM NEW.vehicle_id) THEN
    RAISE EXCEPTION 'an ownership claim (v1) is a comment atom on property ownership_relation with its source comment and speaker'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO c FROM public.auction_comments WHERE id = NEW.source_comment_id;
  IF NOT FOUND OR c.external_identity_id IS NULL OR c.external_identity_id IS DISTINCT FROM NEW.observer_id
     OR c.auction_event_id IS NULL OR c.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    RAISE EXCEPTION 'the speaker must be the source comment''s keyed author, on its keyed lot and vehicle'
      USING ERRCODE = '23514';
  END IF;

  IF sd->>'analysis_kind' IS DISTINCT FROM 'comment_atom' OR sd->'is_inferred' IS DISTINCT FROM 'true'::jsonb
     OR sd->>'claim_type' IS DISTINCT FROM 'ownership_claim' OR sd->>'claim_contract' IS DISTINCT FROM 'ownership_claim_v1'
     OR sd->>'statement_kind' IS DISTINCT FROM 'assertion' OR sd->>'subject_scope' IS DISTINCT FROM 'vehicle'
     OR sd->>'trust_tier' IS DISTINCT FROM 'T3'
     OR sd->>'speaker_identity_id' IS DISTINCT FROM NEW.observer_id::text
     OR sd->>'source_comment_id' IS DISTINCT FROM NEW.source_comment_id::text
     OR sd->>'source_lot_id' IS DISTINCT FROM c.auction_event_id::text
     OR jsonb_typeof(sd->'detector') IS DISTINCT FROM 'string' OR btrim(sd->>'detector') = '' THEN
    RAISE EXCEPTION 'ownership claim keys disagree with contract ownership_claim_v1' USING ERRCODE = '23514';
  END IF;

  v_rel := sd->>'ownership_relation';
  v_detail := sd->>'relation_detail';
  IF jsonb_typeof(sd->'ownership_relation') IS DISTINCT FROM 'string'
     OR v_rel NOT IN ('owner_current', 'owner_past', 'family', 'shop', 'dealer', 'bystander') THEN
    RAISE EXCEPTION 'ownership_relation is outside its vocabulary' USING ERRCODE = '23514';
  END IF;
  IF sd ? 'relation_detail' AND (jsonb_typeof(sd->'relation_detail') IS DISTINCT FROM 'string'
     OR v_detail NOT IN ('seller', 'buyer', 'original_owner', 'heir', 'spouse', 'parent', 'grandparent', 'sibling',
                         'child', 'mechanic', 'painter', 'restorer', 'inspector', 'dealer_staff')) THEN
    RAISE EXCEPTION 'relation_detail is outside its vocabulary' USING ERRCODE = '23514';
  END IF;
  -- The platform's seller flag decides who may speak as the seller, and the seller cannot be a past owner of the lot.
  IF v_detail = 'seller' AND (v_rel IS DISTINCT FROM 'owner_current' OR c.is_seller IS NOT TRUE) THEN
    RAISE EXCEPTION 'only the lot''s flagged seller speaks as its current owner and seller' USING ERRCODE = '23514';
  END IF;
  IF v_rel = 'owner_past' AND c.is_seller IS TRUE THEN
    RAISE EXCEPTION 'the lot''s flagged seller cannot claim past ownership of the vehicle it is selling' USING ERRCODE = '23514';
  END IF;

  v_prec := sd->>'window_precision';
  v_basis := sd->>'window_basis';
  v_quote := sd->>'window_quote';
  IF v_prec IS NULL OR v_prec NOT IN ('day', 'month', 'year', 'decade', 'relative', 'duration', 'none')
     OR v_basis IS NULL OR v_basis NOT IN ('source_explicit', 'relative_to_posted_at', 'duration_to_posted_at', 'none') THEN
    RAISE EXCEPTION 'window_precision or window_basis is outside its vocabulary' USING ERRCODE = '23514';
  END IF;
  FOREACH k IN ARRAY ARRAY['window_start_earliest', 'window_start_latest', 'window_end_earliest', 'window_end_latest'] LOOP
    IF sd ? k AND sd->k IS DISTINCT FROM 'null'::jsonb
       AND (jsonb_typeof(sd->k) IS DISTINCT FROM 'string' OR sd->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            OR NOT pg_input_is_valid(sd->>k, 'date')) THEN
      RAISE EXCEPTION 'window bound % is not an ISO date', k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  se := (sd->>'window_start_earliest')::date;
  sl := (sd->>'window_start_latest')::date;
  ee := (sd->>'window_end_earliest')::date;
  el := (sd->>'window_end_latest')::date;
  v_said := c.posted_at::date;
  IF v_prec = 'none' THEN
    IF v_basis IS DISTINCT FROM 'none' OR coalesce(se, sl, ee, el) IS NOT NULL
       OR (sd ? 'window_quote' AND sd->'window_quote' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION 'a claim without a window carries no bounds and no window words' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_basis = 'none' OR jsonb_typeof(sd->'window_quote') IS DISTINCT FROM 'string' OR btrim(v_quote) = ''
       OR strpos(c.comment_text, v_quote) = 0 THEN
      RAISE EXCEPTION 'a stated window keeps the exact source words that state it' USING ERRCODE = '23514';
    END IF;
    IF (se IS NULL) <> (sl IS NULL) OR (ee IS NULL) <> (el IS NULL) THEN
      RAISE EXCEPTION 'a window bound is a pair: earliest and latest' USING ERRCODE = '23514';
    END IF;
    IF se > sl OR ee > el OR se > el OR greatest(se, sl, ee, el) > v_said THEN
      RAISE EXCEPTION 'window bounds must be ordered and not after the statement' USING ERRCODE = '23514';
    END IF;
    IF v_prec <> 'duration' AND se IS NULL AND ee IS NULL THEN
      RAISE EXCEPTION 'a dated window states at least one bound' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF sd ? 'window_length_days_min' OR sd ? 'window_length_days_max' THEN
    IF jsonb_typeof(sd->'window_length_days_min') IS DISTINCT FROM 'number'
       OR jsonb_typeof(sd->'window_length_days_max') IS DISTINCT FROM 'number'
       OR NOT pg_input_is_valid(sd->>'window_length_days_min', 'integer')
       OR NOT pg_input_is_valid(sd->>'window_length_days_max', 'integer')
       OR (sd->>'window_length_days_min')::integer < 0
       OR (sd->>'window_length_days_min')::integer > (sd->>'window_length_days_max')::integer THEN
      RAISE EXCEPTION 'window length is a pair of whole days, min <= max' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.validate_ownership_claim() IS
'Admission gate for ownership claims (contract ownership_claim_v1, case §13.3). Fires on vehicle_observations inserts '
'that carry the contract, a property_id, or a comment source together with an observer. A claim must be a comment atom '
'(kind comment, source_comment_id) on the ratified core property ownership_relation, spoken by the comment''s keyed '
'author (observer_id = auction_comments.external_identity_id) on its keyed lot. Its relation, detail, precision and '
'basis must come from the written vocabularies, and the window must keep its exact source words with ordered ISO bounds '
'no later than the statement. Only the flagged seller speaks as the seller; the flagged seller is never a past owner. '
'Any other comment atom that names an observer must name the author. Every refusal is check_violation (23514). No '
'property row means no claim is admitted. Reads auction_comments and observation_properties; writes nothing.';
REVOKE ALL ON FUNCTION public.validate_ownership_claim() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_validate_ownership_claim_insert
BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
WHEN ((NEW.structured_data ? 'ownership_relation')
      OR (NEW.structured_data ->> 'claim_contract') = 'ownership_claim_v1'
      OR NEW.property_id IS NOT NULL
      OR (NEW.source_comment_id IS NOT NULL AND NEW.observer_id IS NOT NULL))
EXECUTE FUNCTION public.validate_ownership_claim();
COMMENT ON TRIGGER trg_validate_ownership_claim_insert ON public.vehicle_observations IS
'Runs validate_ownership_claim() before an insert that carries the ownership claim contract, a property_id, or a comment '
'source with an observer. Fires after trg_validate_comment_observation_source_insert (name order), which has already '
'checked the comment source relation.';

CREATE FUNCTION public.guard_ownership_claim_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  -- Supersession and processing state may change. A vehicle merge may relink the row in place.
  v_allowed text[] := ARRAY['is_superseded', 'superseded_by', 'superseded_at', 'is_processed', 'processing_metadata', 'rank'];
  o jsonb;
  n jsonb;
BEGIN
  IF NOT (OLD.structured_data ? 'ownership_relation'
          OR coalesce(OLD.structured_data->>'claim_contract' = 'ownership_claim_v1', false)) THEN
    RAISE EXCEPTION 'an observation cannot become an ownership claim by update; insert a new claim' USING ERRCODE = '23514';
  END IF;
  o := to_jsonb(OLD) - v_allowed;
  n := to_jsonb(NEW) - v_allowed;
  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id AND NEW.merged_from_vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id THEN
    o := o - ARRAY['vehicle_id', 'merged_from_vehicle_id'];
    n := n - ARRAY['vehicle_id', 'merged_from_vehicle_id'];
  END IF;
  IF o IS DISTINCT FROM n THEN
    RAISE EXCEPTION 'ownership claims are immutable testimony; supersede instead' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.guard_ownership_claim_update() IS
'Immutability guard for ownership claims (contract ownership_claim_v1). An update may change only supersession and '
'processing state (is_superseded, superseded_by, superseded_at, is_processed, processing_metadata, rank), or relink the '
'row to a merge primary (vehicle_id moves and merged_from_vehicle_id names the old vehicle, as merge_vehicles_into does). '
'No row becomes a claim by update. Refusals are check_violation (23514), which the merge writer counts and skips.';
REVOKE ALL ON FUNCTION public.guard_ownership_claim_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_ownership_claim_update
BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW
WHEN ((OLD.structured_data ? 'ownership_relation') OR (OLD.structured_data ->> 'claim_contract') = 'ownership_claim_v1'
      OR (NEW.structured_data ? 'ownership_relation') OR (NEW.structured_data ->> 'claim_contract') = 'ownership_claim_v1')
EXECUTE FUNCTION public.guard_ownership_claim_update();
COMMENT ON TRIGGER trg_guard_ownership_claim_update ON public.vehicle_observations IS
'Runs guard_ownership_claim_update() before an update of a row that is, or would become, an ownership claim.';

-- 3. The relation fold --------------------------------------------------------------------------------------------------
CREATE FUNCTION public.identity_vehicle_relation(
  p_identity_id uuid,
  p_vehicle_id uuid,
  p_at timestamptz DEFAULT now(),
  p_known_at timestamptz DEFAULT now())
RETURNS TABLE (
  relation text,
  provisional boolean,
  evidence_basis text,
  valid_from_earliest date,
  valid_from_latest date,
  valid_to_earliest date,
  valid_to_latest date,
  certain_at boolean,
  possible_at boolean,
  evidence_table text,
  evidence_id uuid,
  derived_from_id uuid,
  evidence_at timestamptz,
  known_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
SET "TimeZone" = 'UTC'
AS $fn$
  WITH sold AS (
    -- The vehicle's recorded sale chain as known at p_known_at.
    SELECT ae.auction_end_date AS at
    FROM public.auction_events ae
    WHERE ae.vehicle_id = p_vehicle_id AND ae.outcome = 'sold' AND ae.auction_end_date IS NOT NULL
      AND ae.created_at <= p_known_at
  ), ev AS (
    -- Seller of record on a lot: held the vehicle at the close; acquired after the previous recorded sale.
    SELECT 'seller'::text AS rel, false AS prov, 'platform_seller_of_record'::text AS basis,
      (SELECT max(s.at) FROM sold s WHERE s.at < ae.auction_end_date)::date AS vfe,
      ae.auction_end_date::date AS vfl,
      ae.auction_end_date::date AS vte,
      CASE WHEN ae.outcome = 'sold' THEN ae.auction_end_date::date
           ELSE (SELECT min(s.at) FROM sold s WHERE s.at > ae.auction_end_date)::date END AS vtl,
      'auction_events'::text AS tbl, ae.id AS eid, NULL::uuid AS dfrom, ae.auction_end_date AS eat, ae.created_at AS kat
    FROM public.auction_events ae
    WHERE ae.vehicle_id = p_vehicle_id AND ae.seller_external_identity_id = p_identity_id
      AND ae.auction_end_date IS NOT NULL AND ae.created_at <= p_known_at
    UNION ALL
    -- Winner of a sold lot: held the vehicle from the close until, at the latest, the next recorded sale.
    SELECT 'buyer', false, 'platform_winner_of_record',
      ae.auction_end_date::date, ae.auction_end_date::date, ae.auction_end_date::date,
      (SELECT min(s.at) FROM sold s WHERE s.at > ae.auction_end_date)::date,
      'auction_events', ae.id, NULL::uuid, ae.auction_end_date, ae.created_at
    FROM public.auction_events ae
    WHERE ae.vehicle_id = p_vehicle_id AND ae.winning_bidder_external_identity_id = p_identity_id
      AND ae.outcome = 'sold' AND ae.auction_end_date IS NOT NULL AND ae.created_at <= p_known_at
    UNION ALL
    -- A transfer of record. Today every row is seeded from a sold lot; derived_from_id names that lot, so the
    -- transfer is not a second witness to it.
    SELECT CASE WHEN ot.from_identity_id = p_identity_id THEN 'transferor' ELSE 'transferee' END,
      false, 'transfer_of_record',
      CASE WHEN ot.from_identity_id = p_identity_id
           THEN (SELECT max(s.at) FROM sold s WHERE s.at < ot.sale_date)::date ELSE ot.sale_date::date END,
      ot.sale_date::date,
      ot.sale_date::date,
      CASE WHEN ot.from_identity_id = p_identity_id
           THEN ot.sale_date::date ELSE (SELECT min(s.at) FROM sold s WHERE s.at > ot.sale_date)::date END,
      'ownership_transfers', ot.id, CASE WHEN ot.trigger_table = 'auction_events' THEN ot.trigger_id END,
      ot.sale_date, ot.created_at
    FROM public.ownership_transfers ot
    WHERE ot.vehicle_id = p_vehicle_id AND p_identity_id IN (ot.from_identity_id, ot.to_identity_id)
      AND ot.sale_date IS NOT NULL AND ot.created_at <= p_known_at
      AND ot.status::text IS DISTINCT FROM 'cancelled'
    UNION ALL
    -- A listing episode keyed to a seller: held the vehicle when the episode ended.
    SELECT 'listing_seller', false, 'listing_seller_of_record',
      (SELECT max(s.at) FROM sold s WHERE s.at < coalesce(ve.sold_at, ve.ended_at))::date,
      coalesce(ve.sold_at, ve.ended_at)::date,
      coalesce(ve.sold_at, ve.ended_at)::date,
      CASE WHEN ve.sold_at IS NOT NULL THEN ve.sold_at::date
           ELSE (SELECT min(s.at) FROM sold s WHERE s.at > ve.ended_at)::date END,
      'vehicle_events', ve.id, NULL::uuid, coalesce(ve.sold_at, ve.ended_at), ve.created_at
    FROM public.vehicle_events ve
    WHERE ve.vehicle_id = p_vehicle_id AND ve.seller_external_identity_id = p_identity_id
      AND coalesce(ve.sold_at, ve.ended_at) IS NOT NULL AND ve.created_at <= p_known_at
    UNION ALL
    -- The identity's own ownership claims: testimony, provisional. A current owner held the vehicle when speaking.
    -- A past owner, shop, dealer or bystander relation had ended by then; a family relation may still hold.
    SELECT 'claimed_' || (o.structured_data->>'ownership_relation'), true,
      'testimony_' || (o.structured_data->>'window_precision'),
      (o.structured_data->>'window_start_earliest')::date,
      (o.structured_data->>'window_start_latest')::date,
      coalesce((o.structured_data->>'window_end_earliest')::date,
               CASE WHEN o.structured_data->>'ownership_relation' = 'owner_current' THEN o.observed_at::date END,
               (o.structured_data->>'window_start_latest')::date),
      coalesce((o.structured_data->>'window_end_latest')::date,
               CASE WHEN o.structured_data->>'ownership_relation' IN ('owner_past', 'shop', 'dealer', 'bystander')
                    THEN o.observed_at::date END),
      'vehicle_observations', o.id, o.source_comment_id, o.observed_at, o.ingested_at
    FROM public.vehicle_observations o
    JOIN public.observation_properties p ON p.id = o.property_id AND p.property_key = 'ownership_relation'
    WHERE o.vehicle_id = p_vehicle_id AND o.observer_id = p_identity_id
      AND o.structured_data->>'claim_contract' = 'ownership_claim_v1'
      AND o.ingested_at <= p_known_at
      AND (coalesce(o.is_superseded, false) = false OR o.superseded_at > p_known_at)
  )
  SELECT rel, prov, basis, vfe, vfl, vte, vtl,
    coalesce(vfl <= vte AND p_at::date BETWEEN vfl AND vte, false),
    (vfe IS NULL OR p_at::date >= vfe) AND (vtl IS NULL OR p_at::date <= vtl),
    tbl, eid, dfrom, eat, kat
  FROM ev
  ORDER BY eat NULLS LAST, tbl, eid
$fn$;
COMMENT ON FUNCTION public.identity_vehicle_relation(uuid, uuid, timestamptz, timestamptz) IS
'The relation of one platform identity (external_identities.id) to one vehicle at an event time p_at, from evidence '
'known at p_known_at (point-in-time: row created_at, or ingested_at for claims). One row per piece of evidence: '
'seller of record (auction_events.seller_external_identity_id), buyer of record (winning_bidder_external_identity_id on '
'a sold lot), transferor or transferee (ownership_transfers; derived_from_id names the lot a seeded transfer repeats), '
'listing seller (vehicle_events.seller_external_identity_id) and the identity''s own ownership claims (provisional, '
'relation claimed_<relation>). Each row bounds the holding: valid_from_earliest/latest and valid_to_earliest/latest, '
'with NULL as unknown or open. The previous and next recorded sales of the vehicle close open bounds. certain_at: p_at '
'lies in [valid_from_latest, valid_to_earliest] (the record pins it; for a claim, if the claim is true). possible_at: '
'p_at lies in [valid_from_earliest, valid_to_latest] with unknown bounds open. Grain: identity x vehicle x evidence. '
'Limit: the lot keys were backfilled 2026-10-06 and carry no clock of their own, so a replay before that date treats a '
'key as known at its row''s insert. Case §13.3.';
REVOKE ALL ON FUNCTION public.identity_vehicle_relation(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_vehicle_relation(uuid, uuid, timestamptz, timestamptz) TO service_role;

-- 4. Corroboration ------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.ownership_claim_corroboration(
  p_observation_id uuid,
  p_known_at timestamptz DEFAULT now())
RETURNS TABLE (
  verdict text,
  aspect text,
  rule text,
  informative boolean,
  evidence_table text,
  evidence_id uuid,
  evidence_at timestamptz,
  known_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
SET "TimeZone" = 'UTC'
AS $fn$
  WITH c AS (
    SELECT o.vehicle_id, o.observer_id AS who, o.observed_at AS said_at,
      o.structured_data->>'ownership_relation' AS rel,
      o.structured_data->>'relation_detail' AS detail,
      (o.structured_data->>'source_lot_id')::uuid AS lot,
      (o.structured_data->>'window_start_earliest')::date AS se,
      (o.structured_data->>'window_start_latest')::date AS sl,
      (o.structured_data->>'window_end_earliest')::date AS ee,
      (o.structured_data->>'window_end_latest')::date AS el
    FROM public.vehicle_observations o
    JOIN public.observation_properties p ON p.id = o.property_id AND p.property_key = 'ownership_relation'
    WHERE o.id = p_observation_id AND o.structured_data->>'claim_contract' = 'ownership_claim_v1'
      AND o.ingested_at <= p_known_at
  ), lots AS (
    SELECT ae.id, ae.auction_end_date AS at, ae.outcome, ae.created_at AS kat,
      ae.seller_external_identity_id AS seller, ae.winning_bidder_external_identity_id AS winner
    FROM c JOIN public.auction_events ae ON ae.vehicle_id = c.vehicle_id
    WHERE ae.auction_end_date IS NOT NULL AND ae.created_at <= p_known_at
  )
  -- R1. A seller's tenure claim: the lot keys the speaker as its seller. The admission gate already required the
  -- platform's seller flag, so this agreement is not informative about the speaker.
  SELECT 'corroborates', 'relation', 'own_lot_seller_key', false, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.id = c.lot
  WHERE c.rel = 'owner_current' AND c.detail = 'seller' AND l.seller = c.who
  UNION ALL
  SELECT 'contradicts', 'relation', 'own_lot_seller_is_other_identity', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.id = c.lot
  WHERE c.rel = 'owner_current' AND c.detail = 'seller' AND l.seller IS NOT NULL AND l.seller <> c.who
  UNION ALL
  -- R2. A buyer's claim: the speaker won a sold lot of this vehicle before speaking.
  SELECT 'corroborates', 'relation', 'won_lot_before_statement', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.winner = c.who AND l.outcome = 'sold' AND l.at <= c.said_at
  WHERE c.rel = 'owner_current' AND c.detail = 'buyer'
  UNION ALL
  -- R3. A past owner's claim: the speaker is a keyed party to a lot of this vehicle, or to a transfer that does not
  -- repeat a lot, before speaking.
  SELECT 'corroborates', 'relation', 'keyed_party_before_statement', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON c.who IN (l.seller, l.winner) AND l.at <= c.said_at
  WHERE c.rel = 'owner_past'
  UNION ALL
  SELECT 'corroborates', 'relation', 'keyed_party_before_statement', true, 'ownership_transfers', ot.id, ot.sale_date,
    ot.created_at
  FROM c JOIN public.ownership_transfers ot
    ON ot.vehicle_id = c.vehicle_id AND c.who IN (ot.from_identity_id, ot.to_identity_id)
  WHERE c.rel = 'owner_past' AND ot.sale_date <= c.said_at AND ot.created_at <= p_known_at
    AND ot.trigger_table IS DISTINCT FROM 'auction_events'
  UNION ALL
  -- R4. The stated start: the speaker won a sold lot of this vehicle within 31 days of the start bounds.
  SELECT 'corroborates', 'window_start', 'won_lot_at_window_start', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.winner = c.who AND l.outcome = 'sold'
  WHERE c.rel IN ('owner_current', 'owner_past') AND c.se IS NOT NULL
    AND l.at::date BETWEEN c.se - 31 AND c.sl + 31
  UNION ALL
  -- R5. The stated end: the speaker sold this vehicle on a lot within 31 days of the end bounds.
  SELECT 'corroborates', 'window_end', 'sold_lot_at_window_end', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.seller = c.who AND l.outcome = 'sold'
  WHERE c.rel = 'owner_past' AND c.ee IS NOT NULL
    AND l.at::date BETWEEN c.ee - 31 AND c.el + 31
  UNION ALL
  -- R6. Someone else sold the vehicle to a third party more than 31 days inside the stated tenure.
  SELECT 'contradicts', 'window', 'third_party_sale_inside_window', true, 'auction_events', l.id, l.at, l.kat
  FROM c JOIN lots l ON l.outcome = 'sold' AND l.seller IS NOT NULL AND l.winner IS NOT NULL
    AND l.seller <> c.who AND l.winner <> c.who
  WHERE c.rel IN ('owner_current', 'owner_past') AND c.sl IS NOT NULL
    AND coalesce(c.ee, CASE WHEN c.rel = 'owner_current' THEN c.said_at::date END) IS NOT NULL
    AND l.at::date > c.sl + 31
    AND l.at::date < coalesce(c.ee, CASE WHEN c.rel = 'owner_current' THEN c.said_at::date END) - 31
$fn$;
COMMENT ON FUNCTION public.ownership_claim_corroboration(uuid, timestamptz) IS
'Rule ownership_claim_corroboration_v1. Keyed evidence known at p_known_at that agrees or disagrees with one ownership '
'claim (vehicle_observations.id, contract ownership_claim_v1). R1 own_lot_seller_key (not informative: admission already '
'required the seller flag) and its contradiction own_lot_seller_is_other_identity; R2 won_lot_before_statement (buyer); '
'R3 keyed_party_before_statement (past owner: a lot, or a transfer that does not repeat a lot); R4 won_lot_at_window_start; '
'R5 sold_lot_at_window_end (both within 31 days of the bounds); R6 third_party_sale_inside_window (contradicts: another '
'seller sold to another winner more than 31 days inside the stated tenure). Family, shop, dealer and bystander claims '
'have no keyed rule in v1 and return nothing. One row per agreement, with the evidence and its clocks. Case §13.3.';
REVOKE ALL ON FUNCTION public.ownership_claim_corroboration(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ownership_claim_corroboration(uuid, timestamptz) TO service_role;

-- 5. The per-identity record --------------------------------------------------------------------------------------------
CREATE FUNCTION public.identity_claim_calibration(
  p_identity_id uuid,
  p_as_of timestamptz DEFAULT now())
RETURNS TABLE (
  claims_total integer,
  claims_evaluable integer,
  corroborated integer,
  contradicted integer,
  unresolved integer,
  calibration numeric,
  basis jsonb)
LANGUAGE sql
STABLE
SET search_path = ''
SET "TimeZone" = 'UTC'
AS $fn$
  WITH v AS (
    -- Claims sit on vehicles the identity commented on; this path uses the comment author index.
    SELECT DISTINCT ac.vehicle_id
    FROM public.auction_comments ac
    WHERE ac.external_identity_id = p_identity_id AND ac.vehicle_id IS NOT NULL AND ac.posted_at < p_as_of
  ), claims AS (
    SELECT o.id, o.structured_data->>'ownership_relation' AS rel
    FROM v
    JOIN public.vehicle_observations o ON o.vehicle_id = v.vehicle_id
    JOIN public.observation_properties p ON p.id = o.property_id AND p.property_key = 'ownership_relation'
    WHERE o.observer_id = p_identity_id AND o.structured_data->>'claim_contract' = 'ownership_claim_v1'
      AND o.observed_at < p_as_of AND o.ingested_at <= p_as_of
      AND (coalesce(o.is_superseded, false) = false OR o.superseded_at > p_as_of)
  ), graded AS (
    SELECT cl.id,
      EXISTS (SELECT 1 FROM public.ownership_claim_corroboration(cl.id, p_as_of) r
              WHERE r.verdict = 'contradicts' AND r.informative) AS contra,
      EXISTS (SELECT 1 FROM public.ownership_claim_corroboration(cl.id, p_as_of) r
              WHERE r.verdict = 'corroborates' AND r.informative) AS corr
    FROM claims cl
    WHERE cl.rel IN ('owner_current', 'owner_past')
  ), t AS (
    SELECT (SELECT count(*) FROM claims)::integer AS n_total,
      count(*)::integer AS n_eval,
      count(*) FILTER (WHERE corr AND NOT contra)::integer AS n_corr,
      count(*) FILTER (WHERE contra)::integer AS n_contra,
      count(*) FILTER (WHERE NOT corr AND NOT contra)::integer AS n_open
    FROM graded
  )
  SELECT n_total, n_eval, n_corr, n_contra, n_open,
    CASE WHEN n_corr + n_contra = 0 THEN NULL ELSE round((n_corr + 1.0) / (n_corr + n_contra + 2.0), 4) END,
    jsonb_build_object(
      'rule', 'ownership_claim_corroboration_v1',
      'shrinkage', '(corroborated + 1) / (resolved + 2)',
      'as_of', p_as_of,
      'record', CASE WHEN n_total = 0 THEN 'no_claims' WHEN n_corr + n_contra = 0 THEN 'no_resolved_claims' ELSE 'resolved' END)
  FROM t
$fn$;
COMMENT ON FUNCTION public.identity_claim_calibration(uuid, timestamptz) IS
'The record of one platform identity''s ownership claims as of p_as_of (point-in-time: claims spoken before p_as_of and '
'recorded by it, evidence known by it). claims_evaluable counts the owner_current and owner_past claims that '
'ownership_claim_corroboration_v1 can test; a claim is corroborated with at least one informative agreement and no '
'contradiction, contradicted with any informative contradiction, and unresolved otherwise. An unresolved claim is '
'unobserved, not a success or a failure. calibration = (corroborated + 1) / (corroborated + contradicted + 2), and NULL '
'when nothing is resolved: no record is not a neutral score. On 2026-10-07 no claim exists, so every identity returns '
'NULL. Never use a calibration as of today to weight a claim spoken earlier: pass the claim''s observed_at. Case §13.3.';
REVOKE ALL ON FUNCTION public.identity_claim_calibration(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_claim_calibration(uuid, timestamptz) TO service_role;

-- 6. The weight -----------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.claim_weight(p_relation text, p_calibration numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  v_prior numeric;
BEGIN
  IF p_calibration IS NOT NULL AND (p_calibration < 0 OR p_calibration > 1) THEN
    RAISE EXCEPTION 'calibration is within 0..1, or NULL for no record' USING ERRCODE = '22023';
  END IF;
  -- relation_prior_v0: the relation is mapped to the house's own trust number for that kind of witness.
  v_prior := CASE p_relation
    WHEN 'owner_current' THEN 0.70  -- observation_sources owner-input: an owner's own statement
    WHEN 'owner_past'    THEN 0.70  -- the same witness, speaking about an earlier holding
    WHEN 'dealer'        THEN 0.65  -- mean of the dealer source category
    WHEN 'shop'          THEN 0.55  -- mean of the forum category: a professional's recollection without the shop record
    WHEN 'family'        THEN 0.50  -- observation_sources user-input: a person who is not the owner
    WHEN 'bystander'     THEN 0.39  -- mean of the social_media category: an unverified public remark
  END;
  IF v_prior IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_calibration IS NULL THEN
    RETURN v_prior;
  END IF;
  -- The record scales the prior: calibration 0.5 (as much right as wrong) leaves it, and the factor stays within
  -- 0.25 .. 1.5. The weight stays within 0.05 .. 0.95, the clamp of current_trust().
  RETURN round(greatest(0.05, least(0.95, v_prior * greatest(0.25, least(1.5, p_calibration / 0.5)))), 4);
END
$fn$;
COMMENT ON FUNCTION public.claim_weight(text, numeric) IS
'Record-layer weight of one claim (two-layer confidence: is the record true). Prior by the speaker''s stated relation '
'(relation_prior_v0, read from the house trust table on 2026-10-07 and never calibrated): owner_current and owner_past '
'0.70 (owner-input), dealer 0.65 (dealer category mean), shop 0.55 (forum category mean), family 0.50 (user-input), '
'bystander 0.39 (social_media category mean); NULL for any other relation. The calibration from '
'identity_claim_calibration() scales the prior by calibration / 0.5 within 0.25 .. 1.5, and the result is clamped to '
'0.05 .. 0.95. A NULL calibration (no record) returns the prior unchanged; the caller shows that the record is empty. '
'The priors are a design input for the owner to replace with measured corroboration rates per relation. Case §13.3.';
REVOKE ALL ON FUNCTION public.claim_weight(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_weight(text, numeric) TO service_role;

COMMIT;
