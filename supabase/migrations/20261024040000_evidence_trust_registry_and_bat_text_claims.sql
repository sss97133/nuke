-- Evidence feature layer, step 1 (additive only).
-- 1) evidence_trust_registry: trust prior + half-life per (source, author role, claim kind).
--    Priors derive from existing groundwork: observation_sources.base_trust_score (source trust)
--    and observation_half_life_days(kind) (decay). Role factors are PRIORS to be recalibrated by
--    independent corroboration, never by model self-scores.
-- 2) evidence_claim_patterns: claim-detection patterns as DATA (no associations hard-coded in code).
-- 3) evidence_claims: cited claims (verbatim quote + source row) mined from BaT comments and
--    listing descriptions. Standalone table: no triggers, does not touch vehicles/vehicle_observations.
-- 4) evidence_claims_weighted view: trust x time-decay x corroboration (distinct independent authors).
-- 5) mine_bat_text_claims(vehicle_ids, run_id): idempotent miner. Revert: supabase/sql/revert_20261024040000_evidence_claims.sql

CREATE TABLE IF NOT EXISTS public.evidence_trust_registry (
  id            bigserial PRIMARY KEY,
  source_slug   text NOT NULL,          -- observation_sources.slug
  author_role   text NOT NULL,          -- listing_description | seller_comment | commenter
  claim_kind    text NOT NULL,          -- observation_kind label
  base_trust    numeric(3,2) NOT NULL CHECK (base_trust BETWEEN 0 AND 1),
  half_life_days numeric,               -- NULL = permanent
  basis         text NOT NULL,          -- where the number came from
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_slug, author_role, claim_kind)
);
COMMENT ON TABLE public.evidence_trust_registry IS
'Trust prior and decay per (source, author role, claim kind). base_trust = observation_sources.base_trust_score x role prior; half_life_days = observation_half_life_days(kind). Priors only: recalibrate from independent corroboration rates.';

CREATE TABLE IF NOT EXISTS public.evidence_claim_patterns (
  id          serial PRIMARY KEY,
  claim_kind  text NOT NULL,
  field_hint  text NOT NULL,      -- documented_work | records_present | ownership_history | condition_issue | originality
  pattern     text NOT NULL,      -- case-insensitive POSIX regex
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_kind, field_hint, pattern)
);

CREATE TABLE IF NOT EXISTS public.evidence_claims (
  id                bigserial PRIMARY KEY,
  run_id            uuid NOT NULL,
  vehicle_id        uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  source_slug       text NOT NULL,
  author_role       text NOT NULL,
  author_key        text,                 -- independence key (author username / 'listing')
  claim_kind        text NOT NULL,
  field_hint        text NOT NULL,
  quote             text NOT NULL,        -- verbatim citation
  source_comment_id uuid REFERENCES public.auction_comments(id) ON DELETE CASCADE,
  source_url        text,
  observed_at       timestamptz,
  pattern_id        int NOT NULL REFERENCES public.evidence_claim_patterns(id),
  trust_id          bigint NOT NULL REFERENCES public.evidence_trust_registry(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  quote_hash        text GENERATED ALWAYS AS (md5(quote)) STORED,
  UNIQUE (vehicle_id, pattern_id, author_role, quote_hash)
);
CREATE INDEX IF NOT EXISTS evidence_claims_vehicle_idx ON public.evidence_claims (vehicle_id);
CREATE INDEX IF NOT EXISTS evidence_claims_run_idx ON public.evidence_claims (run_id);

-- Seed trust priors from existing source trust + existing decay function.
INSERT INTO public.evidence_trust_registry (source_slug, author_role, claim_kind, base_trust, half_life_days, basis)
SELECT os.slug, r.role, k.kind,
       round(os.base_trust_score * r.factor, 2),
       public.observation_half_life_days(k.kind),
       format('observation_sources[%s].base_trust_score=%s x role prior %s; half-life observation_half_life_days(%s)',
              os.slug, os.base_trust_score, r.factor, k.kind)
FROM public.observation_sources os
CROSS JOIN (VALUES ('listing_description', 1.00), ('seller_comment', 0.80), ('commenter', 0.60)) r(role, factor)
CROSS JOIN (VALUES ('work_record'), ('provenance'), ('ownership'), ('condition'), ('specification')) k(kind)
WHERE os.slug = 'bat'
ON CONFLICT (source_slug, author_role, claim_kind) DO NOTHING;

INSERT INTO public.evidence_claim_patterns (claim_kind, field_hint, pattern) VALUES
 ('work_record',  'documented_work',   '\m(receipts?|invoices?)\M'),
 ('work_record',  'documented_work',   '\m(rebuilt|replaced|overhauled|restored|refreshed|resealed)\M'),
 ('provenance',   'records_present',   '\m(service records|maintenance records|documentation|paperwork|window sticker|build sheet|owner''?s manual|carfax|autocheck|marti report|kardex|certificate of authenticity)\M'),
 ('ownership',    'ownership_history', '\m(original owner|one[- ]owner|(first|second|third|previous|prior) owner|i (bought|purchased) (it|this|the car)|my (dad|father|grandfather)|owned (it|this) (for|since))\M'),
 ('condition',    'condition_issue',   '\m(rust|accident|damage|repaint(ed)?|crack(ed|s)?|leak(s|ing)?|dent(s|ed)?)\M'),
 ('specification','originality',       '\m(numbers[- ]matching|matching numbers|all original|original paint|factory original|unrestored|survivor)\M')
ON CONFLICT DO NOTHING;

ALTER TABLE public.evidence_trust_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_claim_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_claims ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW public.evidence_claims_weighted WITH (security_invoker = true) AS
SELECT c.*,
       t.base_trust,
       t.half_life_days,
       public.observation_relevance(c.observed_at, t.half_life_days) AS relevance,
       (SELECT count(DISTINCT c2.author_key) FROM public.evidence_claims c2 WHERE c2.vehicle_id = c.vehicle_id AND c2.field_hint = c.field_hint) AS independent_sources,
       round(t.base_trust * coalesce(public.observation_relevance(c.observed_at, t.half_life_days), 1), 4) AS effective_weight
FROM public.evidence_claims c
JOIN public.evidence_trust_registry t ON t.id = c.trust_id;

CREATE OR REPLACE FUNCTION public.mine_bat_text_claims(p_vehicle_ids uuid[], p_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout = '120s'
AS $fn$
DECLARE n int := 0; m int;
BEGIN
  IF array_length(p_vehicle_ids, 1) > 500 THEN
    RAISE EXCEPTION 'mine_bat_text_claims: max 500 vehicles per call';
  END IF;

  -- BaT comments (seller vs commenter is a role, not an association)
  INSERT INTO public.evidence_claims (run_id, vehicle_id, source_slug, author_role, author_key, claim_kind, field_hint,
         quote, source_comment_id, source_url, observed_at, pattern_id, trust_id)
  SELECT p_run_id, ac.vehicle_id, 'bat', role.r, coalesce(ac.author_username, ac.id::text), p.claim_kind, p.field_hint,
         left(btrim(s.sent), 400), ac.id, ac.source_url, ac.posted_at, p.id, t.id
  FROM public.auction_comments ac
  CROSS JOIN LATERAL (SELECT CASE WHEN ac.is_seller THEN 'seller_comment' ELSE 'commenter' END r) role
  CROSS JOIN public.evidence_claim_patterns p
  CROSS JOIN LATERAL regexp_split_to_table(ac.comment_text, '[.!?]+\s+') s(sent)
  JOIN public.evidence_trust_registry t ON t.source_slug='bat' AND t.author_role=role.r AND t.claim_kind=p.claim_kind
  WHERE ac.vehicle_id = ANY(p_vehicle_ids)
    AND coalesce(ac.platform,'bat') = 'bat'
    AND ac.bid_amount IS NULL
    AND p.active
    AND s.sent ~* p.pattern
    AND length(btrim(s.sent)) >= 20
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;

  -- BaT listing description stored on the vehicle
  INSERT INTO public.evidence_claims (run_id, vehicle_id, source_slug, author_role, author_key, claim_kind, field_hint,
         quote, source_url, observed_at, pattern_id, trust_id)
  SELECT p_run_id, v.id, 'bat', 'listing_description', 'listing', p.claim_kind, p.field_hint,
         left(btrim(s.sent), 400), bl.bat_listing_url, coalesce(bl.auction_end_date, bl.sale_date)::timestamptz, p.id, t.id
  FROM public.vehicles v
  JOIN LATERAL (SELECT * FROM public.bat_listings b WHERE b.vehicle_id = v.id ORDER BY b.auction_end_date DESC NULLS LAST LIMIT 1) bl ON true
  CROSS JOIN public.evidence_claim_patterns p
  CROSS JOIN LATERAL regexp_split_to_table(v.description, '[.!?]+\s+') s(sent)
  JOIN public.evidence_trust_registry t ON t.source_slug='bat' AND t.author_role='listing_description' AND t.claim_kind=p.claim_kind
  WHERE v.id = ANY(p_vehicle_ids)
    AND p.active
    AND s.sent ~* p.pattern
    AND length(btrim(s.sent)) >= 20
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  RETURN n;
END;
$fn$;
COMMENT ON FUNCTION public.mine_bat_text_claims(uuid[], uuid) IS
'Mines cited claims (verbatim sentence + source row) from BaT comments and listing descriptions into evidence_claims. Additive, idempotent, max 500 vehicles/call. Patterns from evidence_claim_patterns, trust/decay from evidence_trust_registry.';
