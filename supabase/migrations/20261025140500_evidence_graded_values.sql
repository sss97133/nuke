-- Graded, typed evidence values (additive, reversible).
-- Why: evidence_claims rows are presence flags (regex hit = claim present). The v2 evidence features were
-- constants per kind and added nothing over the hammer comp base. This adds the value layer:
--   evidence_grade_rubrics      cited ordinal rubrics (grades are data with a citation, not hard-coded)
--   evidence_claim_values       one typed value per (vehicle, field, extractor_version, span) with source span,
--                               confidence, extractor version and status (supersede, never delete)
--   evidence_field_validations  per field/extractor precision evidence; backfill is gated on passed=true
--   evidence_extractor_runs     run registry with batch accounting and the revert SQL for each run
--   evidence_claims             + extractor_version, status (additive columns)
--   evidence_vehicle_graded_v   active values pivoted per vehicle (shadow features only; no nuke_estimate input)
--   fill_graded_mileage(uuid[], uuid)  listing-description mileage miner, max 500 vehicles/call
-- Revert: supabase/sql/revert_20261025140000_evidence_graded_values.sql

ALTER TABLE public.evidence_claims
  ADD COLUMN IF NOT EXISTS extractor_version text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
DO $$ BEGIN
  ALTER TABLE public.evidence_claims ADD CONSTRAINT evidence_claims_status_chk
    CHECK (status IN ('active','provisional','superseded','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.evidence_grade_rubrics (
  rubric_code   text PRIMARY KEY,           -- '<rubric>:<grade>', e.g. condition_v1:3
  rubric        text NOT NULL,
  field         text NOT NULL,
  grade         smallint NOT NULL,          -- ordinal, 1 = best
  label         text NOT NULL,
  definition    text NOT NULL,              -- the rule the extractor applies
  citation      text NOT NULL,              -- external reference the scale is anchored to
  citation_url  text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rubric, grade)
);
COMMENT ON TABLE public.evidence_grade_rubrics IS
'Ordinal grading rubrics for evidence_claim_values. Grades are anchored to a cited external scale; the definition column is the operational rule the extractor version applies. Supersede by inserting a new rubric version.';

INSERT INTO public.evidence_grade_rubrics (rubric_code, rubric, field, grade, label, definition, citation, citation_url) VALUES
 ('condition_v1:1','condition_v1','condition_grade',1,'Concours',
  'Listing cites a concours/class award (concours, best/first in class, Pebble Beach, Amelia Island, NCRS Top Flight/Duntov, PCA concours) and discloses no flaws.',
  'Hagerty Valuation Tools vehicle condition rating #1 Concours','https://www.hagerty.com/valuationtools/hagerty-vehicle-rating-guide'),
 ('condition_v1:2','condition_v1','condition_grade',2,'Excellent / no disclosed flaws',
  'No disclosed cosmetic or functional flaw sentence (unrepaired) and no severe cue.',
  'Hagerty Valuation Tools vehicle condition rating #2 Excellent','https://www.hagerty.com/valuationtools/hagerty-vehicle-rating-guide'),
 ('condition_v1:3','condition_v1','condition_grade',3,'Good / disclosed flaws',
  '1-4 sentences disclosing unrepaired flaws (rust, corrosion, chips, dents, cracks, tears, fading, leaks, inoperable items, missing parts), no severe cue.',
  'Hagerty Valuation Tools vehicle condition rating #3 Good','https://www.hagerty.com/valuationtools/hagerty-vehicle-rating-guide'),
 ('condition_v1:4','condition_v1','condition_grade',4,'Fair / project',
  '>=5 flaw sentences, or any severe cue (non-running, project, rust-through, rot, salvage, flood, frame damage, seized).',
  'Hagerty Valuation Tools vehicle condition rating #4 Fair','https://www.hagerty.com/valuationtools/hagerty-vehicle-rating-guide')
ON CONFLICT (rubric_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.evidence_extractor_runs (
  run_id             uuid PRIMARY KEY,
  extractor_version  text NOT NULL,
  fields             text[] NOT NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  batches            int NOT NULL DEFAULT 0,
  rows_inserted      int NOT NULL DEFAULT 0,
  revert_sql         text NOT NULL,
  notes              text
);

CREATE TABLE IF NOT EXISTS public.evidence_field_validations (
  id                 bigserial PRIMARY KEY,
  field              text NOT NULL,
  extractor_version  text NOT NULL,
  method             text NOT NULL CHECK (method IN ('blind_human','structured_crosscheck','self_audit')),
  sample_n           int NOT NULL,
  correct_n          int NOT NULL,
  precision          numeric(5,4) GENERATED ALWAYS AS (round(correct_n::numeric / nullif(sample_n,0), 4)) STORED,
  passed             boolean GENERATED ALWAYS AS (method IN ('blind_human','structured_crosscheck') AND sample_n >= 200 AND correct_n::numeric / nullif(sample_n,0) >= 0.9) STORED,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.evidence_field_validations IS
'Precision evidence per (field, extractor_version). passed requires blind_human or structured_crosscheck, n>=200, precision>=0.90. Backfill of a field is gated on a passed row.';

CREATE TABLE IF NOT EXISTS public.evidence_claim_values (
  id                 bigserial PRIMARY KEY,
  run_id             uuid NOT NULL REFERENCES public.evidence_extractor_runs(run_id),
  vehicle_id         uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  claim_id           bigint REFERENCES public.evidence_claims(id),
  source_slug        text NOT NULL,
  author_role        text NOT NULL,                 -- listing_description | seller_comment | commenter
  source_field       text NOT NULL,                 -- e.g. vehicles.description
  field              text NOT NULL CHECK (field IN ('condition_grade','mileage_claimed','numbers_matching_engine',
                        'numbers_matching_trans','original_paint_pct','repaint','documented_work',
                        'ownership_count','ownership_duration')),
  value_num          numeric,
  value_bool         boolean,
  value_text         text,                          -- category / qualifier (e.g. work category, repaint full|partial)
  value_date         date,
  unit               text,                          -- mi | km | years | owners | pct
  currency           text,                          -- ISO 4217 for cost amounts
  rubric_code        text REFERENCES public.evidence_grade_rubrics(rubric_code),
  span_start         int NOT NULL,
  span_end           int NOT NULL,
  quote              text NOT NULL,                 -- verbatim source span (<=400 chars)
  quote_hash         text GENERATED ALWAYS AS (md5(quote)) STORED,
  confidence         numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  extractor_version  text NOT NULL,
  status             text NOT NULL DEFAULT 'provisional' CHECK (status IN ('active','provisional','superseded','rejected')),
  superseded_by      bigint REFERENCES public.evidence_claim_values(id),
  observed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, field, extractor_version, span_start, quote_hash)
);
CREATE INDEX IF NOT EXISTS evidence_claim_values_vehicle_idx ON public.evidence_claim_values (vehicle_id, field) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS evidence_claim_values_run_idx ON public.evidence_claim_values (run_id);
COMMENT ON TABLE public.evidence_claim_values IS
'Typed, graded evidence values with verbatim source span, confidence and extractor version. Never hard-delete: supersede via status/superseded_by. Shadow-only features; not an input to vehicles.nuke_estimate.';

ALTER TABLE public.evidence_grade_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_extractor_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_field_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_claim_values ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW public.evidence_vehicle_graded_v WITH (security_invoker = true) AS
SELECT vehicle_id,
  max(value_num) FILTER (WHERE field='condition_grade')                         AS condition_grade,
  max(value_num * CASE WHEN unit='km' THEN 0.621371 ELSE 1 END) FILTER (WHERE field='mileage_claimed') AS mileage_mi,
  bool_or(value_bool) FILTER (WHERE field='mileage_claimed')                    AS mileage_tmu,
  bool_or(value_bool) FILTER (WHERE field='repaint')                            AS repaint,
  bool_or(value_bool) FILTER (WHERE field='numbers_matching_engine')            AS numbers_matching_engine,
  max(value_num) FILTER (WHERE field='ownership_duration')                      AS ownership_years,
  count(*) FILTER (WHERE field='documented_work')                               AS documented_work_n,
  sum(value_num) FILTER (WHERE field='documented_work' AND currency='USD')      AS documented_work_usd,
  array_agg(DISTINCT extractor_version)                                         AS extractor_versions
FROM public.evidence_claim_values
WHERE status = 'active'
GROUP BY vehicle_id;

-- Listing-description mileage miner (port of graded-v1 mileage rule). Max 500 vehicles per call.
CREATE OR REPLACE FUNCTION public.fill_graded_mileage(p_vehicle_ids uuid[], p_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout = '120s'
AS $fn$
DECLARE n int;
BEGIN
  IF array_length(p_vehicle_ids, 1) > 500 THEN
    RAISE EXCEPTION 'fill_graded_mileage: max 500 vehicles per call';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.evidence_field_validations
                 WHERE field='mileage_claimed' AND extractor_version='graded-v1' AND passed) THEN
    RAISE EXCEPTION 'fill_graded_mileage: no passed validation for mileage_claimed graded-v1';
  END IF;
  WITH m AS (
    SELECT v.id, v.description d, bl.bat_listing_url url, coalesce(bl.auction_end_date, bl.sale_date)::timestamptz obs,
      regexp_match(v.description,
        '((odometer|speedometer|instrument cluster|now|currently|it)[^.]{0,60}(shows|showing|showed|indicates|indicating|reads|reading|displays|displaying|registers|has)\s+(approximately |roughly |about |nearly |just over |just under |under |over |less than |fewer than |~)?\s*([0-9]{1,3}(,[0-9]{3})+|[0-9]+(\.[0-9]+)?)\s*(k)?\s*(miles|mi|kilometers|km)\M)', 'i') g
    FROM public.vehicles v
    JOIN LATERAL (SELECT * FROM public.bat_listings b WHERE b.vehicle_id = v.id ORDER BY b.auction_end_date DESC NULLS LAST LIMIT 1) bl ON true
    WHERE v.id = ANY(p_vehicle_ids) AND v.description IS NOT NULL
  )
  INSERT INTO public.evidence_claim_values (run_id, vehicle_id, source_slug, author_role, source_field, field,
     value_num, value_bool, unit, span_start, span_end, quote, confidence, extractor_version, status, observed_at)
  SELECT p_run_id, m.id, 'bat', 'listing_description', 'vehicles.description', 'mileage_claimed',
     replace(g[5], ',', '')::numeric * CASE WHEN g[8] IS NOT NULL THEN 1000 ELSE 1 END,
     m.d ~* '(true|total|actual) mileage is unknown|\mTMU\M',
     CASE WHEN lower(g[9]) LIKE 'k%' THEN 'km' ELSE 'mi' END,
     strpos(m.d, g[1]) - 1, strpos(m.d, g[1]) - 1 + length(g[1]), left(g[1], 400),
     CASE WHEN m.d ~* '(true|total|actual) mileage is unknown|\mTMU\M|replacement odometer' THEN 0.60 ELSE 0.95 END,
     'graded-v1', 'active', m.obs
  FROM m WHERE m.g IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.evidence_extractor_runs SET batches = batches + 1, rows_inserted = rows_inserted + n WHERE run_id = p_run_id;
  RETURN n;
END;
$fn$;
COMMENT ON FUNCTION public.fill_graded_mileage(uuid[], uuid) IS
'Fills evidence_claim_values.mileage_claimed from BaT listing descriptions (graded-v1). Gated on evidence_field_validations.passed. Additive, idempotent, max 500 vehicles/call.';
