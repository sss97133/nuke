-- EIC recomputed by the books gate from stored inputs and the IRS tables. Eligibility gates run before any arithmetic (IRS Pub 596 rules).
--   books_eic_parameters   the IRS earned income credit parameters per tax year, filing status and number of qualifying children
--                          (credit percentage, earned income amount, maximum credit, phase-out start and rate, completed phase-out,
--                          investment income limit), each row with the Revenue Procedure it was read from. Loaded here; reference data.
--   books_eic_amount       the credit for one income figure from one parameter row, reproducing the IRS EIC Table.
--   books_eic_recompute    the recomputation: gates first, then the amount from the table. Returns status pass / differs / not_assessed,
--                          the computed and claimed amounts and the reason.
--   books_year_gate R8b    calls it for the EIC part; ACTC, result and GILTI checks and every other rule are unchanged. This body is
--                          the one #2869 (migration 20261104180000, R6 from v_books_asset_register, R10 structural split) left on main,
--                          with only the EIC lines replaced; a later change to the gate must start from this body.
-- Gates, in order (each one that fails means EIC 0; an input that is not stored means not_assessed with the missing input named):
--   1. the owner was in the US more than 182 days (Pub 596 Rule 14: the home, and the spouse's on a joint return, in the US more than half the year)
--   2. earned income of 0 allows no credit
--   3. married filing jointly: the spouse was in the US more than 182 days (a stored lower bound counts only when it exceeds 182)
--   4. each qualifying child lived with the taxpayers in the US more than 6 months (and more than 182 days when child days are stored),
--      and has an SSN issued on or before 15 April of the following year (the unextended due date)
--   5. every adult SSN issue date stored as a date is on or before that due date; an adult date stored only as a note is reported, not tested
--   6. investment income is within the year's limit; stored phase-out start and investment limit agree with the table
-- Amount (EIC Worksheet A): the credit on earned income; when AGI differs from earned income and is at or above the phase-out start, also
-- the credit on AGI, and the lower of the two is the credit. Filing status comes from the cell's filing_status when stored; otherwise it
-- is mfj when a spouse's US days are stored, and the output says so. Compared with the claimed cell within $1 (the return is in whole dollars).
-- books_eic_amount follows the IRS EIC Table line by line: each $50 line is figured at its middle; the line holding the earned income
-- amount pays the full maximum; the line holding the phase-out start pays the full maximum. Checked against the printed Tables (Form 1040
-- instructions) for every line and column (single and joint, 0 to 3 children): 2024 and 2025 match in every cell; 2023 is within $1
-- (the 2023 Table uses unrounded maximums).

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.books_eic_parameters (
  tax_year int NOT NULL,
  filing_status text NOT NULL CHECK (filing_status IN ('mfj', 'single_hoh_qss')),
  qualifying_children int NOT NULL CHECK (qualifying_children BETWEEN 0 AND 3),
  credit_pct numeric NOT NULL,
  earned_income_amount numeric NOT NULL,
  max_credit numeric NOT NULL,
  phaseout_start numeric NOT NULL,
  phaseout_rate numeric NOT NULL,
  completed_phaseout numeric NOT NULL,
  investment_income_limit numeric NOT NULL,
  source_url text NOT NULL,
  rates_source_url text NOT NULL,
  source_note text NOT NULL,
  PRIMARY KEY (tax_year, filing_status, qualifying_children)
);

COMMENT ON TABLE public.books_eic_parameters IS
  'IRS earned income credit parameters per tax year, filing status (mfj, or single/head of household/qualifying surviving spouse and married filing separately under section 32(d)) and number of qualifying children (3 = three or more). Amounts from the Revenue Procedure in source_url; the credit and phase-out percentages are statutory (26 U.S.C. 32(b)(1), rates_source_url). Reference data; read by books_eic_recompute.';
COMMENT ON COLUMN public.books_eic_parameters.source_url IS 'Revenue Procedure the amounts were read from.';
COMMENT ON COLUMN public.books_eic_parameters.completed_phaseout IS 'AGI (or earned income, if greater) at or above which no credit is allowed, as printed in the Revenue Procedure; check: phaseout_start + max_credit / phaseout_rate, within $5 (the printed maximum is rounded).';

ALTER TABLE public.books_eic_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS books_eic_parameters_read ON public.books_eic_parameters;
CREATE POLICY books_eic_parameters_read ON public.books_eic_parameters FOR SELECT TO anon, authenticated, service_role USING (true);
REVOKE ALL ON public.books_eic_parameters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.books_eic_parameters TO anon, authenticated, service_role;

INSERT INTO public.books_eic_parameters (tax_year, filing_status, qualifying_children, credit_pct, earned_income_amount, max_credit, phaseout_start, phaseout_rate, completed_phaseout, investment_income_limit, source_url, rates_source_url, source_note) VALUES
  (2023, 'single_hoh_qss', 0, 0.0765, 7840, 600, 9800, 0.0765, 17640, 11000, 'https://www.irs.gov/pub/irs-drop/rp-22-38.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2022-38 section 3.06, earned income credit table'),
  (2023, 'single_hoh_qss', 1, 0.34, 11750, 3995, 21560, 0.1598, 46560, 11000, 'https://www.irs.gov/pub/irs-drop/rp-22-38.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2022-38 section 3.06, earned income credit table'),
  (2023, 'single_hoh_qss', 2, 0.4, 16510, 6604, 21560, 0.2106, 52918, 11000, 'https://www.irs.gov/pub/irs-drop/rp-22-38.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2022-38 section 3.06, earned income credit table'),
  (2023, 'single_hoh_qss', 3, 0.45, 16510, 7430, 21560, 0.2106, 56838, 11000, 'https://www.irs.gov/pub/irs-drop/rp-22-38.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2022-38 section 3.06, earned income credit table'),
  (2023, 'mfj', 0, 0.0765, 7840, 600, 16370, 0.0765, 24210, 11000, 'https://www.irs.gov/pub/irs-drop/rp-22-38.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2022-38 section 3.06, earned income credit table'),
  (2023, 'mfj', 1, 0.34, 11750, 3995, 28120, 0.1598, 53120, 11000, 'https://www.irs.gov/pub/irs-drop/rp-22-38.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2022-38 section 3.06, earned income credit table'),
  (2023, 'mfj', 2, 0.4, 16510, 6604, 28120, 0.2106, 59478, 11000, 'https://www.irs.gov/pub/irs-drop/rp-22-38.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2022-38 section 3.06, earned income credit table'),
  (2023, 'mfj', 3, 0.45, 16510, 7430, 28120, 0.2106, 63398, 11000, 'https://www.irs.gov/pub/irs-drop/rp-22-38.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2022-38 section 3.06, earned income credit table'),
  (2024, 'single_hoh_qss', 0, 0.0765, 8260, 632, 10330, 0.0765, 18591, 11600, 'https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2023-34 section 3.06, earned income credit table'),
  (2024, 'single_hoh_qss', 1, 0.34, 12390, 4213, 22720, 0.1598, 49084, 11600, 'https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2023-34 section 3.06, earned income credit table'),
  (2024, 'single_hoh_qss', 2, 0.4, 17400, 6960, 22720, 0.2106, 55768, 11600, 'https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2023-34 section 3.06, earned income credit table'),
  (2024, 'single_hoh_qss', 3, 0.45, 17400, 7830, 22720, 0.2106, 59899, 11600, 'https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2023-34 section 3.06, earned income credit table'),
  (2024, 'mfj', 0, 0.0765, 8260, 632, 17250, 0.0765, 25511, 11600, 'https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2023-34 section 3.06, earned income credit table'),
  (2024, 'mfj', 1, 0.34, 12390, 4213, 29640, 0.1598, 56004, 11600, 'https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2023-34 section 3.06, earned income credit table'),
  (2024, 'mfj', 2, 0.4, 17400, 6960, 29640, 0.2106, 62688, 11600, 'https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2023-34 section 3.06, earned income credit table'),
  (2024, 'mfj', 3, 0.45, 17400, 7830, 29640, 0.2106, 66819, 11600, 'https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2023-34 section 3.06, earned income credit table'),
  (2025, 'single_hoh_qss', 0, 0.0765, 8490, 649, 10620, 0.0765, 19104, 11950, 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2024-40 section 3.06, earned income credit table'),
  (2025, 'single_hoh_qss', 1, 0.34, 12730, 4328, 23350, 0.1598, 50434, 11950, 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2024-40 section 3.06, earned income credit table'),
  (2025, 'single_hoh_qss', 2, 0.4, 17880, 7152, 23350, 0.2106, 57310, 11950, 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2024-40 section 3.06, earned income credit table'),
  (2025, 'single_hoh_qss', 3, 0.45, 17880, 8046, 23350, 0.2106, 61555, 11950, 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2024-40 section 3.06, earned income credit table'),
  (2025, 'mfj', 0, 0.0765, 8490, 649, 17730, 0.0765, 26214, 11950, 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2024-40 section 3.06, earned income credit table'),
  (2025, 'mfj', 1, 0.34, 12730, 4328, 30470, 0.1598, 57554, 11950, 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2024-40 section 3.06, earned income credit table'),
  (2025, 'mfj', 2, 0.4, 17880, 7152, 30470, 0.2106, 64430, 11950, 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2024-40 section 3.06, earned income credit table'),
  (2025, 'mfj', 3, 0.45, 17880, 8046, 30470, 0.2106, 68675, 11950, 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.law.cornell.edu/uscode/text/26/32', 'Rev. Proc. 2024-40 section 3.06, earned income credit table')
ON CONFLICT (tax_year, filing_status, qualifying_children) DO UPDATE SET credit_pct = EXCLUDED.credit_pct, earned_income_amount = EXCLUDED.earned_income_amount, max_credit = EXCLUDED.max_credit, phaseout_start = EXCLUDED.phaseout_start, phaseout_rate = EXCLUDED.phaseout_rate, completed_phaseout = EXCLUDED.completed_phaseout, investment_income_limit = EXCLUDED.investment_income_limit, source_url = EXCLUDED.source_url, rates_source_url = EXCLUDED.rates_source_url, source_note = EXCLUDED.source_note;

CREATE OR REPLACE FUNCTION public.books_eic_amount(p_income numeric, p_pct numeric, p_eia numeric, p_max numeric, p_ps numeric, p_rate numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The IRS EIC Table figures each $50 line [lo, lo + 50) at its middle. The line holding the earned income amount pays the full maximum,
  -- and the line holding the phase-out start pays the full maximum (the phase-out comes off only from lines that start at or above it).
  SELECT CASE WHEN p_income <= 0 THEN 0 ELSE
    round(greatest(0,
      CASE WHEN floor(p_income / 50) * 50 + 50 > p_eia THEN p_max ELSE least(p_max, p_pct * (floor(p_income / 50) * 50 + 25)) END
      - CASE WHEN floor(p_income / 50) * 50 >= p_ps THEN p_rate * (floor(p_income / 50) * 50 + 25 - p_ps) ELSE 0 END)) END
$function$;

CREATE OR REPLACE FUNCTION public.books_eic_recompute(p_cr jsonb, p_year integer, p_filing_status text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claimed numeric;
  v_out text;                -- null while computing; 'not_assessed' when an input is missing
  v_computed numeric;
  v_reason text;
  v_notes text[] := '{}';
  v_owner numeric;
  v_ei numeric;
  v_agi numeric;
  v_inv numeric;
  v_fs text := lower(coalesce(p_filing_status, p_cr->>'filing_status'));
  v_due date := make_date(p_year + 1, 4, 15);
  v_sp_key text;
  v_sp numeric;
  v_nkids int;
  v_months text[] := '{}';
  v_qc int := 0;
  v_ssn_key text;
  v_adult int := 0;
  v_min numeric;
  v_max numeric;
  v_pass_days boolean := true;
  v_params record;
  v_k text;
  v_f_ei numeric;
  v_f_agi numeric;
BEGIN
  IF p_cr IS NULL OR jsonb_typeof(p_cr) <> 'object' OR NOT p_cr ? 'eic' THEN
    RETURN jsonb_build_object('status', 'not_assessed', 'computed', NULL, 'claimed', NULL, 'reason', 'EIC claimed on the return is not stored', 'notes', '[]'::jsonb);
  END IF;
  v_claimed := (p_cr->>'eic')::numeric;

  <<calc>>
  LOOP
    -- Gate 1: residency of the taxpayer. Ineligible means 0, whatever the other inputs.
    IF NOT p_cr ? 'owner_us_days' THEN v_out := 'not_assessed'; v_reason := 'owner US days not stored'; EXIT calc; END IF;
    v_owner := (p_cr->>'owner_us_days')::numeric;
    IF v_owner <= 182 THEN
      v_computed := 0; v_reason := format('owner in the US %s days, not more than 182: the home must be in the US more than half the year (Pub 596 Rule 14)', v_owner); EXIT calc;
    END IF;

    -- Gate 2: no earned income, no credit.
    IF p_cr ? 'earned_income' AND (p_cr->>'earned_income')::numeric = 0 THEN
      v_computed := 0; v_reason := 'earned income 0'; EXIT calc;
    END IF;

    -- Filing status: stored, else married filing jointly when a spouse's US days are stored.
    SELECT k INTO v_sp_key FROM jsonb_object_keys(p_cr) k
     WHERE k ~ '_us_days(_min)?$' AND k !~ '^(owner|children)_' ORDER BY (k ~ '_min$'), k LIMIT 1;
    IF v_fs IS NULL AND v_sp_key IS NOT NULL THEN v_fs := 'mfj'; v_notes := v_notes || 'filing status mfj inferred from the stored spouse US days'::text; END IF;
    IF v_fs IS NULL THEN v_out := 'not_assessed'; v_reason := 'filing status not stored'; EXIT calc; END IF;
    IF v_fs NOT IN ('mfj', 'single_hoh_qss') THEN v_out := 'not_assessed'; v_reason := format('filing status %s has no EIC table loaded', v_fs); EXIT calc; END IF;

    -- Gate 3: married filing jointly, the spouse's US days.
    IF v_fs = 'mfj' THEN
      IF v_sp_key IS NULL THEN v_out := 'not_assessed'; v_reason := 'spouse US days not stored'; EXIT calc; END IF;
      v_sp := (p_cr->>v_sp_key)::numeric;
      IF v_sp <= 182 THEN
        IF v_sp_key ~ '_min$' THEN
          v_out := 'not_assessed'; v_reason := format('only a lower bound of the spouse US days is stored (%s)', v_sp); EXIT calc;
        END IF;
        v_computed := 0; v_reason := format('spouse in the US %s days, not more than 182: the spouse''s home must be in the US more than half the year on a joint return (Pub 596 Rule 14)', v_sp); EXIT calc;
      END IF;
    END IF;

    -- Gate 4: qualifying children, by months and days in the US with the taxpayers, and the child's SSN issue date.
    IF NOT p_cr ? 'children' THEN v_out := 'not_assessed'; v_reason := 'number of children not stored'; EXIT calc; END IF;
    v_nkids := (p_cr->>'children')::int;
    SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_months FROM jsonb_object_keys(p_cr) k WHERE k ~ '_months_us$';
    IF cardinality(v_months) <> v_nkids THEN
      v_out := 'not_assessed'; v_reason := format('%s children but months in the US stored for %s', v_nkids, cardinality(v_months)); EXIT calc;
    END IF;
    IF p_cr ? 'children_us_days_min' THEN
      v_min := (p_cr->>'children_us_days_min')::numeric;
      v_max := (p_cr->>'children_us_days_max')::numeric;
      IF v_min > 182 THEN v_pass_days := true;
      ELSIF v_max IS NOT NULL AND v_max <= 182 THEN v_pass_days := false;
      ELSE v_out := 'not_assessed'; v_reason := format('children US days stored only as a minimum of %s', v_min); EXIT calc;
      END IF;
      v_notes := v_notes || format('children US days %s to %s', v_min, coalesce(v_max::text, 'not stored'));
    END IF;
    FOREACH v_k IN ARRAY v_months LOOP
      v_ssn_key := regexp_replace(v_k, '_months_us$', '_ssn_issued');
      IF NOT p_cr ? v_ssn_key OR p_cr->>v_ssn_key !~ '^\d{4}-\d{2}-\d{2}$' THEN
        v_out := 'not_assessed'; v_reason := 'a child SSN issue date is not stored as a date'; EXIT calc;
      END IF;
      IF (p_cr->>v_k)::numeric > 6 AND v_pass_days AND (p_cr->>v_ssn_key)::date <= v_due THEN v_qc := v_qc + 1; END IF;
    END LOOP;

    -- Gate 5: adult SSN issue dates.
    FOR v_k IN SELECT k FROM jsonb_object_keys(p_cr) k WHERE k ~ '_ssn_issued$'
                 AND regexp_replace(k, '_ssn_issued$', '_months_us') <> ALL (v_months) LOOP
      v_adult := v_adult + 1;
      IF p_cr->>v_k ~ '^\d{4}-\d{2}-\d{2}$' THEN
        IF (p_cr->>v_k)::date > v_due THEN
          v_computed := 0; v_reason := format('a taxpayer SSN was issued after %s', v_due); EXIT calc;
        END IF;
      ELSE
        v_notes := v_notes || 'a taxpayer SSN issue date is stored as a note, not a date; not tested'::text;
      END IF;
    END LOOP;
    IF v_adult < (CASE WHEN v_fs = 'mfj' THEN 2 ELSE 1 END) THEN v_out := 'not_assessed'; v_reason := 'taxpayer SSN issue dates not stored'; EXIT calc; END IF;

    IF v_qc = 0 THEN
      v_out := 'not_assessed'; v_reason := 'no qualifying child; the childless credit needs ages 25 to 64, which are not stored'; EXIT calc;
    END IF;

    -- The table row and the stored limits.
    SELECT * INTO v_params FROM public.books_eic_parameters
     WHERE tax_year = p_year AND filing_status = v_fs AND qualifying_children = least(v_qc, 3);
    IF NOT FOUND THEN v_out := 'not_assessed'; v_reason := format('no IRS EIC table loaded for %s', p_year); EXIT calc; END IF;
    IF (p_cr ? 'eic_agi_phaseout_start' AND (p_cr->>'eic_agi_phaseout_start')::numeric <> v_params.phaseout_start)
       OR (p_cr ? 'eic_investment_income_limit' AND (p_cr->>'eic_investment_income_limit')::numeric <> v_params.investment_income_limit) THEN
      v_out := 'not_assessed'; v_reason := 'a stored phase-out start or investment income limit differs from the IRS table'; EXIT calc;
    END IF;

    -- Gate 6: investment income.
    IF NOT p_cr ? 'investment_income' THEN v_out := 'not_assessed'; v_reason := 'investment income not stored'; EXIT calc; END IF;
    v_inv := (p_cr->>'investment_income')::numeric;
    IF v_inv > v_params.investment_income_limit THEN
      v_computed := 0; v_reason := format('investment income %s exceeds the %s limit of %s', v_inv, p_year, v_params.investment_income_limit); EXIT calc;
    END IF;

    -- Amount (EIC Worksheet A): on earned income; also on AGI when AGI differs from earned income and is at or above the phase-out start; the lower.
    IF NOT p_cr ? 'earned_income' THEN v_out := 'not_assessed'; v_reason := 'earned income not stored'; EXIT calc; END IF;
    v_ei := (p_cr->>'earned_income')::numeric;
    v_agi := (p_cr->>'agi')::numeric;
    v_f_ei := public.books_eic_amount(v_ei, v_params.credit_pct, v_params.earned_income_amount, v_params.max_credit, v_params.phaseout_start, v_params.phaseout_rate);
    IF v_agi IS NULL THEN
      -- Without AGI the credit on earned income stands only when it is 0: AGI can lower a credit, never raise it.
      IF v_f_ei = 0 THEN v_computed := 0; v_reason := 'no credit on earned income, so none on AGI'; EXIT calc; END IF;
      v_out := 'not_assessed'; v_reason := 'AGI not stored'; EXIT calc;
    END IF;
    IF v_agi <> v_ei AND v_agi >= v_params.phaseout_start THEN
      v_f_agi := public.books_eic_amount(v_agi, v_params.credit_pct, v_params.earned_income_amount, v_params.max_credit, v_params.phaseout_start, v_params.phaseout_rate);
      v_computed := least(v_f_ei, v_f_agi);
    ELSE
      v_f_agi := NULL; v_computed := v_f_ei;
    END IF;
    v_reason := format('%s %s, %s qualifying children: earned income %s gives %s, %s; maximum %s, phase-out from %s (%s)',
                       p_year, v_fs, v_qc, v_ei, v_f_ei,
                       CASE WHEN v_f_agi IS NULL THEN format('AGI %s is not looked up (equal to earned income or below the phase-out start)', v_agi) ELSE format('AGI %s gives %s', v_agi, v_f_agi) END,
                       v_params.max_credit, v_params.phaseout_start, v_params.source_note);
    EXIT calc;
  END LOOP calc;

  IF v_out IS NULL THEN
    v_out := CASE WHEN abs(v_claimed - v_computed) <= 1 THEN 'pass' ELSE 'differs' END;
  END IF;
  RETURN jsonb_build_object('status', v_out, 'computed', v_computed, 'claimed', v_claimed, 'reason', v_reason, 'notes', to_jsonb(v_notes));
END $function$;

COMMENT ON FUNCTION public.books_eic_amount(numeric, numeric, numeric, numeric, numeric, numeric) IS
  'EIC for one income figure from one books_eic_parameters row, line by line as the IRS EIC Table: each $50 line figured at its middle, the maximum on the line holding the earned income amount and on the line holding the phase-out start, then the phase-out rate on the middle less the phase-out start; floored at 0.';
COMMENT ON FUNCTION public.books_eic_recompute(jsonb, integer, text) IS
  'Recomputes the EIC of a books credit:<year> input cell: eligibility gates first (US days, qualifying children, SSN dates, investment income), then the amount from books_eic_parameters (EIC Worksheet A: AGI also looked up when it differs from earned income and is at or above the phase-out start). Returns {status pass|differs|not_assessed, computed, claimed, reason, notes}.';
REVOKE ALL ON FUNCTION public.books_eic_amount(numeric, numeric, numeric, numeric, numeric, numeric), public.books_eic_recompute(jsonb, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_eic_amount(numeric, numeric, numeric, numeric, numeric, numeric), public.books_eic_recompute(jsonb, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.books_year_gate(p_owner_id uuid, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_year text := p_year::text;
  v_state jsonb;
  v_map jsonb;
  v_res jsonb;
  v_recs jsonb;
  v_rules jsonb := '[]';
  v_net numeric;
  v_ne numeric;
  v_se numeric;
  v_bad jsonb;
  r record;
  v_cr jsonb;
  v_eic jsonb;
  v_okc text[] := '{}';
  v_failc text[] := '{}';
  v_nac text[] := '{}';
  v_diff numeric := 0;
  v_x numeric;
  v_y numeric;
  v_r10 jsonb;
BEGIN
  IF p_owner_id IS NULL OR p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'owner and year required'; END IF;
  v_state := public.books_year_state(p_owner_id, p_year);
  SELECT e.value_normalized->'value' INTO v_map FROM public.financial_document_extractions e
    JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'return-facts-register.txt'
   WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'schedule_c_line_map' ORDER BY e.created_at DESC LIMIT 1;
  v_map := coalesce(v_map, '{}');
  SELECT f->'result' INTO v_res FROM jsonb_array_elements(v_state->'facts') f
   WHERE f->>'topic' = 'result' ORDER BY f->'result'->>'built_at' DESC LIMIT 1;

  -- Records of the year and its neighbours (a payment can sit in the year next to its decision).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.record->>'local_id', 'kind', c.record->>'record_kind', 'year', c.record->>'year',
      'date', CASE WHEN c.record->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN c.record->>'date' END,
      'account', coalesce(c.record->>'account', ''), 'cur', coalesce(nullif(upper(c.record->>'currency'), ''), 'USD'), 'section', coalesce(c.record->>'section', ''), 'category', coalesce(c.record->>'category', ''),
      'amount', CASE WHEN c.record->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' THEN (c.record->>'amount')::numeric END,
      'payee', lower(regexp_replace(coalesce(c.record->>'description', ''), '[^A-Za-z0-9]', '', 'g')),
      'srckey', coalesce(c.record->>'source_key', ''),
      'links', CASE WHEN jsonb_typeof(c.record->'bank_links') = 'array' THEN c.record->'bank_links' ELSE '[]' END,
      'doc', c.id)), '[]')
    INTO v_recs
  FROM public.accounting_current_records(p_owner_id) c
  WHERE c.record->>'year' BETWEEN (p_year - 1)::text AND (p_year + 1)::text
    AND c.record->>'record_kind' IN ('retained_bank_movement', 'retained_ledger_decision');

  -- One typed row set for every rule.
  WITH x AS (
    SELECT t.*, CASE WHEN t.category LIKE 'Schedule C line %' THEN trim(split_part(substr(t.category, 17), ':', 1))
                     ELSE v_map->>(t.section || '|' || t.category) END AS line
    FROM jsonb_to_recordset(v_recs) AS t(id text, kind text, year text, date date, account text, section text, category text, cur text,
                                         amount numeric, payee text, srckey text, links jsonb, doc uuid)
  ),
  mv AS (SELECT * FROM x WHERE kind = 'retained_bank_movement'),
  dc AS (SELECT * FROM x WHERE kind = 'retained_ledger_decision'),
  -- R1
  r1 AS (
    SELECT m.id, m.amount FROM mv m
    WHERE m.year = v_year AND NOT (
      m.section IN ('Revenue', 'Transfer', 'Financing', 'Owner', 'Clearing')
      OR (m.section = 'Expense' AND (m.line IS NOT NULL OR EXISTS (
            SELECT 1 FROM dc d WHERE d.links ? m.id OR m.links ? d.id AND d.line IS NOT NULL))))
  ),
  -- R2 / R2i. Tied decisions: a decision linked to the movement in either direction, plus decisions that share a
  -- bank link or source key with it (a superseding decision keeps the superseded one's links).
  r2lk AS (
    SELECT DISTINCT m.id AS mid, d.id AS did, d.section AS dsec, d.amount AS damt
    FROM mv m JOIN dc d ON (m.links ? d.id OR d.links ? m.id)
    UNION
    SELECT DISTINCT m.id, d2.id, d2.section, d2.amount
    FROM mv m JOIN dc d ON (m.links ? d.id OR d.links ? m.id)
         JOIN dc d2 ON d2.id <> d.id AND d.year = d2.year
          AND ((d.srckey <> '' AND d2.srckey = d.srckey)
               OR (jsonb_array_length(d.links) > 0 AND d2.links ?| ARRAY(SELECT jsonb_array_elements_text(d.links))))
  ),
  r2c AS (
    SELECT m.*, (m.payee LIKE '%dividendearned%') AS is_div,
           (m.payee LIKE '%reversalofgeneralaccounthold%' OR m.payee LIKE '%holdrelease%') AS is_hold
    FROM mv m WHERE m.year = v_year AND m.amount > 0 AND m.section <> 'Revenue'
  ),
  r2i AS (
    SELECT m.id, m.amount, m.cur FROM r2c m
    WHERE m.is_div AND NOT EXISTS (SELECT 1 FROM r2lk k WHERE k.mid = m.id)
  ),
  r2 AS (
    SELECT m.id, m.amount, m.cur FROM r2c m
    WHERE NOT m.is_div
      -- 1. same account, same currency, exact opposite row within 7 days (hold/release, funding leg, reversal);
      --    a hold reversal may trail its hold by weeks and drift by FX or rounding: 30 days, 3% plus a cent
      AND NOT EXISTS (SELECT 1 FROM mv o WHERE o.id <> m.id AND o.account = m.account AND o.cur = m.cur
                        AND o.amount = -m.amount AND o.date BETWEEN m.date - 7 AND m.date + 7)
      AND NOT (m.is_hold AND EXISTS (SELECT 1 FROM mv o WHERE o.id <> m.id AND o.account = m.account AND o.cur = m.cur
                        AND o.amount < 0 AND abs(o.amount + m.amount) <= 0.03 * m.amount + 0.01
                        AND o.date BETWEEN m.date - 30 AND m.date + 30))
      -- 2. other account, same currency, within 7 days, tolerance max($1, 3%) for fees
      AND NOT EXISTS (SELECT 1 FROM mv o WHERE o.id <> m.id AND o.account <> m.account AND o.cur = m.cur
                        AND o.amount < 0 AND abs(o.amount + m.amount) <= greatest(1, 0.03 * m.amount)
                        AND o.date BETWEEN m.date - 7 AND m.date + 7)
      -- 4. currency conversion: opposite sign, other currency, within 2 days, within 10% of the amount at an
      --    approximate EUR/USD reference rate of 1.08 (2024-2025 traded between 1.03 and 1.15)
      AND NOT EXISTS (SELECT 1 FROM mv o WHERE o.id <> m.id AND o.cur <> m.cur AND o.amount < 0
                        AND abs(o.amount) BETWEEN 0.9 * m.amount * (CASE WHEN m.cur = 'EUR' AND o.cur = 'USD' THEN 1.08
                                                                       WHEN m.cur = 'USD' AND o.cur = 'EUR' THEN 1 / 1.08 ELSE 1 END)
                                              AND 1.1 * m.amount * (CASE WHEN m.cur = 'EUR' AND o.cur = 'USD' THEN 1.08
                                                                       WHEN m.cur = 'USD' AND o.cur = 'EUR' THEN 1 / 1.08 ELSE 1 END)
                        AND o.date BETWEEN m.date - 2 AND m.date + 2)
      -- 3. booked revenue (directly or through a superseding decision), or a negative Expense decision (refund)
      AND NOT EXISTS (SELECT 1 FROM r2lk k WHERE k.mid = m.id AND (k.dsec = 'Revenue' OR (k.dsec = 'Expense' AND k.damt < 0)))
      -- 6. Financing, Owner, Clearing and Transfer movements tied to a decision (the decision carries the ruling)
      AND NOT (m.section IN ('Financing', 'Owner', 'Clearing', 'Transfer')
               AND (jsonb_array_length(m.links) > 0 OR EXISTS (SELECT 1 FROM r2lk k WHERE k.mid = m.id)))
      -- 5. credit-line draws in Transfer or Financing (credit-union line of credit; PayPal Credit draw)
      AND NOT (m.section IN ('Transfer', 'Financing')
               AND (m.payee LIKE '%fromlineofcredit%' OR m.payee LIKE '%bmlcredittransferfrombml%'))
  ),
  -- R3
  dcx AS (
    SELECT d.*,
           coalesce((SELECT array_agg(m.id) FROM mv m WHERE m.links ? d.id), '{}') AS mvs,
           coalesce((SELECT array_agg(l) FROM jsonb_array_elements_text(d.links) l), '{}') AS bls
    FROM dc d WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense') AND d.amount <> 0 AND d.payee <> ''
  ),
  r3c AS (
    SELECT a.id AS aid, b.id AS bid, a.amount,
           EXISTS (SELECT 1 FROM mv m WHERE m.links ? a.id AND m.links ? b.id AND abs(a.amount) + abs(b.amount) > abs(m.amount) + 0.005) AS over_mv,
           (a.mvs && b.mvs) AS share_mv,
           (a.bls && b.bls) AS share_bl,
           (a.srckey <> '' AND a.srckey = b.srckey) AS same_key,
           (cardinality(a.mvs) > 0 AND cardinality(b.mvs) > 0 AND NOT (a.mvs && b.mvs)) AS diff_mv,
           (cardinality(a.bls) > 0 AND cardinality(b.bls) > 0 AND NOT (a.bls && b.bls)) AS diff_bl
    FROM dcx a JOIN dcx b ON a.id < b.id AND a.amount = b.amount AND a.payee = b.payee
     AND abs(a.date - b.date) <= 2 AND a.section = b.section
  ),
  r3 AS (
    SELECT aid || ' = ' || bid AS id, amount FROM r3c
    WHERE over_mv OR share_bl OR same_key OR NOT (share_mv OR diff_mv OR diff_bl)
  ),
  -- R4
  r4 AS (
    SELECT DISTINCT d.id, d.amount FROM dc d JOIN mv m ON m.links ? d.id
    WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense') AND m.year <> d.year
  ),
  r4n AS (SELECT count(DISTINCT d.id) AS n FROM dc d JOIN mv m ON m.links ? d.id WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense')),
  -- Register inputs: current use cells of the books register inputs original (use:<year>:<key>) for R7.
  rcells AS MATERIALIZED (
    SELECT e.field_key, e.value_normalized->'value' AS v
    FROM public.financial_document_extractions e
    JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'books-register-inputs.txt'
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key ~ '^use:'
      AND jsonb_typeof(e.value_normalized->'value') = 'object' AND e.value_normalized->'value' ? 'cites'
  ),
  -- R6: each line 13 decision traces to register assets; each asset-year's MACRS computation equals what the decisions carry.
  -- One implementation: v_books_asset_register, which v_books_audit_tiers also reads.
  r6src AS MATERIALIZED (
    SELECT a.kind, a.local_id, a.amount FROM public.v_books_asset_register a WHERE a.owner_id = p_owner_id AND a.year = v_year
  ),
  r6 AS (
    SELECT s6.local_id AS id, s6.amount FROM r6src s6 WHERE s6.kind <> 'claim'
  ),
  -- R7: each line 20b or line 30 (home use) decision belongs to a stored use group whose base times percentage equals it.
  l20 AS (SELECT d.id, d.amount FROM dc d WHERE d.year = v_year AND d.section = 'Expense' AND d.line IN ('20b', '30') AND d.amount <> 0),
  ru AS (
    SELECT u.v->>'key' AS k, (u.v->>'base')::numeric AS base, (u.v->>'pct')::numeric AS pct,
           coalesce(ARRAY(SELECT jsonb_array_elements_text(u.v->'decisions')), '{}') AS dids
    FROM rcells u WHERE u.field_key LIKE 'use:' || v_year || ':%'
  ),
  ruc AS (
    SELECT ru.*, round(ru.base * ru.pct, 2) AS expected,
           (SELECT coalesce(sum(d.amount), 0) FROM dc d WHERE d.year = v_year AND d.id = ANY(ru.dids)) AS booked
    FROM ru
  ),
  r7 AS (
    SELECT l.id, l.amount FROM l20 l WHERE NOT EXISTS (SELECT 1 FROM ru WHERE l.id = ANY(ru.dids))
    UNION ALL
    SELECT c.k || ': decisions carry ' || c.booked || ', stored percentage x base is ' || c.expected, abs(c.booked - c.expected)
    FROM ruc c WHERE abs(c.booked - c.expected) > 0.005
  ),
  pop AS (
    SELECT count(*) FILTER (WHERE kind = 'retained_bank_movement') AS movements,
           count(*) FILTER (WHERE kind = 'retained_bank_movement' AND amount > 0 AND section <> 'Revenue' AND payee NOT LIKE '%dividendearned%') AS credits,
           count(*) FILTER (WHERE kind = 'retained_bank_movement' AND amount > 0 AND section <> 'Revenue' AND payee LIKE '%dividendearned%') AS dividends,
           count(*) FILTER (WHERE kind = 'retained_ledger_decision' AND section IN ('Revenue', 'Expense')) AS sc
    FROM x WHERE year = v_year
  )
  SELECT jsonb_build_array(
    (SELECT jsonb_build_object('rule', 'R1', 'title', 'every money movement has one treatment from the closed list',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT movements FROM pop),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r1 ORDER BY abs(amount) DESC NULLS LAST LIMIT 100) q)) FROM r1),
    (SELECT jsonb_build_object('rule', 'R2', 'title', 'every credit is proven not income: counterpart, booked revenue, refund, conversion, credit-line draw or ruling',
       'n', count(*), 'amount', round(coalesce(sum(amount) FILTER (WHERE cur = 'USD'), 0), 2), 'of', (SELECT credits FROM pop),
       'by_currency', (SELECT coalesce(jsonb_object_agg(q.cur, jsonb_build_object('n', q.n, 'amount', q.a)), '{}') FROM
                         (SELECT cur, count(*) AS n, round(sum(amount), 2) AS a FROM r2 GROUP BY cur) q),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r2 ORDER BY amount DESC LIMIT 100) q)) FROM r2),
    (SELECT jsonb_build_object('rule', 'R2i', 'title', 'credit-union share dividends are interest income (Schedule B): a decision is tied to each',
       'n', count(*), 'amount', round(coalesce(sum(amount) FILTER (WHERE cur = 'USD'), 0), 2), 'of', (SELECT dividends FROM pop),
       'detail', 'taxable interest, not Schedule C revenue and not a transfer; fails until a decision records each dividend',
       'by_currency', (SELECT coalesce(jsonb_object_agg(q.cur, jsonb_build_object('n', q.n, 'amount', q.a)), '{}') FROM
                         (SELECT cur, count(*) AS n, round(sum(amount), 2) AS a FROM r2i GROUP BY cur) q),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r2i ORDER BY amount DESC LIMIT 100) q)) FROM r2i),
    (SELECT jsonb_build_object('rule', 'R3', 'title', 'no amount counted twice (same amount and full description within 2 days, not separate bank movements)',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT sc FROM pop),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r3 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r3),
    (SELECT jsonb_build_object('rule', 'R4', 'title', 'cash method: paid in the year it is booked',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT n FROM r4n),
       'detail', 'assessed only where a bank movement links to the decision; ' || ((SELECT sc FROM pop) - (SELECT n FROM r4n)) || ' Schedule C decisions have no linked payment and are not assessed',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r4 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r4),
    (SELECT jsonb_build_object('rule', 'R6', 'title', 'depreciation only from an asset register (cost, in-service date, class, MACRS table)',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT count(DISTINCT local_id) FROM r6src WHERE kind IN ('claim', 'unclaimed')),
       'detail', (SELECT count(DISTINCT local_id) FROM r6src WHERE kind IN ('claim', 'unclaimed')) || ' line 13 decisions; each must trace to a register asset whose MACRS computation equals what the decisions carry (v_books_asset_register)',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r6 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r6),
    (SELECT jsonb_build_object('rule', 'R7', 'title', 'mixed use carries a stored business percentage with its source (decisions equal percentage x base)',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT count(*) FROM l20),
       'detail', (SELECT count(*) FROM l20) || ' line 20b / line 30 decisions, ' || (SELECT count(*) FROM ru) || ' stored use groups; each decision must sit in a group whose stored percentage x base equals the decisions',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r7 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r7)
  ) INTO v_bad;
  FOR r IN SELECT value AS v FROM jsonb_array_elements(v_bad) LOOP
    v_rules := v_rules || jsonb_build_array((r.v - 'ids' - 'idlist') || jsonb_build_object(
      'status', CASE WHEN (r.v->>'n')::int = 0 THEN 'pass' ELSE 'fail' END, 'ids', r.v->'idlist'));
  END LOOP;

  -- R5: evidence grade of each Expense decision of $75 or more (accounting_decision_proof, the close-out's own flags).
  -- Grades: A statement and receipt, B statement only, C receipt only, R owner ruling with structured proof links and
  -- neither statement nor receipt (visible, not failing), D nothing (fails).
  SELECT jsonb_build_object('rule', 'R5', 'title', 'every expense of $75 or more has evidence; grade D (no statement, no receipt, no ruling) fails; grade R (ruling only) is counted apart',
      'n', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND NOT p.has_ruling),
      'amount', round(coalesce(sum(p.amount) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND NOT p.has_ruling), 0), 2), 'of', count(*),
      'ruling_only', jsonb_build_object('n', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND p.has_ruling),
         'amount', round(coalesce(sum(p.amount) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND p.has_ruling), 0), 2)),
      'grades', jsonb_build_object(
         'A', count(*) FILTER (WHERE p.has_statement AND p.has_receipt), 'B', count(*) FILTER (WHERE p.has_statement AND NOT p.has_receipt),
         'C', count(*) FILTER (WHERE p.has_receipt AND NOT p.has_statement),
         'R', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND p.has_ruling),
         'D', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND NOT p.has_ruling)),
      'ids', coalesce((SELECT jsonb_agg(q.lid) FROM (SELECT p2.record->>'local_id' AS lid FROM public.accounting_decision_proof(p_owner_id) p2
          WHERE p2.year = v_year AND p2.section = 'Expense' AND p2.amount >= 75 AND NOT p2.has_statement AND NOT p2.has_receipt AND NOT p2.has_ruling
          ORDER BY p2.amount DESC LIMIT 100) q), '[]'))
    INTO v_bad
  FROM public.accounting_decision_proof(p_owner_id) p
  WHERE p.year = v_year AND p.section = 'Expense' AND p.amount >= 75;
  v_rules := v_rules || jsonb_build_array(v_bad || jsonb_build_object('status', CASE WHEN (v_bad->>'n')::int = 0 THEN 'pass' ELSE 'fail' END));

  -- R8: SE tax recomputed from line 31 (92.35%, 12.4% + 2.9%, rounded per line as the forms do); credits and GILTI
  -- are recomputed in R8b from the stored credit inputs.
  SELECT sum((v->>'31')::numeric) INTO v_net FROM jsonb_each(v_state->'schedule_c') AS e(k, v);
  v_ne := round(coalesce(v_net, 0) * 0.9235);
  v_se := CASE WHEN v_ne >= 400 THEN round(v_ne * 0.124) + round(v_ne * 0.029) ELSE 0 END;
  v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R8a', 'title', 'SE tax computed from Schedule C line 31',
    'status', CASE WHEN v_res->>'se_tax' IS NULL THEN 'not_assessed' WHEN abs((v_res->>'se_tax')::numeric - v_se) <= (CASE WHEN coalesce((v_res->>'whole_dollars')::boolean, false) THEN 1 ELSE 0 END) THEN 'pass' ELSE 'fail' END,
    'n', CASE WHEN v_res->>'se_tax' IS NOT NULL AND abs((v_res->>'se_tax')::numeric - v_se) > (CASE WHEN coalesce((v_res->>'whole_dollars')::boolean, false) THEN 1 ELSE 0 END) THEN 1 ELSE 0 END,
    'amount', CASE WHEN v_res->>'se_tax' IS NOT NULL THEN (v_res->>'se_tax')::numeric - v_se END,
    'detail', format('line 31 %s, net earnings %s, computed SE tax %s; return SE tax %s%s', v_net, v_ne, v_se, coalesce(v_res->>'se_tax', 'not stored'),
      CASE WHEN v_res ? 'se_base_used' THEN format(' (return used a base of %s)', v_res->>'se_base_used') ELSE '' END),
    'ids', '[]'::jsonb));
  -- R8b: credits and GILTI recomputed from the stored credit inputs where the inputs exist; what cannot be recomputed
  -- (an EIC input that is not stored, GILTI without CFC figures) is not_assessed, and a recomputation that differs is a finding.
  SELECT e.value_normalized->'value' INTO v_cr
  FROM public.financial_document_extractions e
  JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'books-register-inputs.txt'
  WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'credit:' || v_year
    AND jsonb_typeof(e.value_normalized->'value') = 'object' AND e.value_normalized->'value' ? 'cites'
  ORDER BY e.created_at DESC LIMIT 1;
  IF v_cr IS NULL THEN
    v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R8b', 'title', 'EIC, CTC/ACTC and GILTI recomputed from stored inputs',
      'status', 'not_assessed', 'n', 0, 'amount', NULL, 'detail', 'no credit inputs stored for this year', 'ids', '[]'::jsonb));
  ELSE
    -- EIC: eligibility gates first, then the amount from the IRS table (books_eic_recompute); the cell's own EIC is the claim.
    v_eic := public.books_eic_recompute(v_cr, p_year);
    IF v_eic->>'status' = 'pass' THEN
      v_okc := v_okc || format('EIC %s recomputed (%s)', v_eic->>'claimed', v_eic->>'reason');
    ELSIF v_eic->>'status' = 'differs' THEN
      v_failc := v_failc || format('EIC claimed %s, recomputed %s (%s)', v_eic->>'claimed', v_eic->>'computed', v_eic->>'reason');
      v_diff := v_diff + abs((v_eic->>'claimed')::numeric - (v_eic->>'computed')::numeric);
    ELSE
      v_nac := v_nac || format('EIC (%s)', v_eic->>'reason');
    END IF;
    -- ACTC: least(per-child cap x children, 15% of earned income over 2,500, child credit less the nonrefundable part).
    IF v_cr ?& ARRAY['earned_income', 'children', 'ctc_per_child', 'actc_cap_per_child', 'ctc_nonref', 'actc'] THEN
      v_x := least((v_cr->>'children')::numeric * (v_cr->>'actc_cap_per_child')::numeric,
                   round(0.15 * greatest((v_cr->>'earned_income')::numeric - 2500, 0)),
                   (v_cr->>'children')::numeric * (v_cr->>'ctc_per_child')::numeric - (v_cr->>'ctc_nonref')::numeric);
      IF abs(v_x - (v_cr->>'actc')::numeric) <= 1 THEN v_okc := v_okc || format('ACTC %s recomputed', v_cr->>'actc');
      ELSE v_failc := v_failc || format('ACTC stored %s, recomputed %s', v_cr->>'actc', v_x); v_diff := v_diff + abs(v_x - (v_cr->>'actc')::numeric); END IF;
    ELSE
      v_nac := v_nac || 'ACTC (earned income not stored)'::text;
    END IF;
    -- Result: payments + refundable credits - total tax equals the stored result (refund positive, owe negative).
    IF v_cr ?& ARRAY['payments_other', 'total_tax', 'eic', 'actc'] AND v_res ? 'amount' AND v_res ? 'result' THEN
      v_x := (v_cr->>'payments_other')::numeric + (v_cr->>'eic')::numeric + (v_cr->>'actc')::numeric - (v_cr->>'total_tax')::numeric;
      v_y := CASE WHEN v_res->>'result' = 'owe' THEN -(v_res->>'amount')::numeric ELSE (v_res->>'amount')::numeric END;
      IF abs(v_x - v_y) <= 1 THEN v_okc := v_okc || format('result %s recomputed', v_y);
      ELSE v_failc := v_failc || format('stored result %s, recomputed from stored credits %s', v_y, v_x); v_diff := v_diff + abs(v_x - v_y); END IF;
    ELSE
      v_nac := v_nac || 'result (payments or total tax not stored)'::text;
    END IF;
    -- GILTI: tested income less net deemed tangible income return, when the CFC figures are stored.
    IF v_cr ? 'gilti_claimed' THEN
      IF v_cr ?& ARRAY['gilti_tested_income', 'gilti_net_dtir'] THEN
        v_x := (v_cr->>'gilti_tested_income')::numeric - (v_cr->>'gilti_net_dtir')::numeric;
        IF abs(v_x - (v_cr->>'gilti_claimed')::numeric) <= 1 THEN v_okc := v_okc || format('GILTI %s recomputed', v_cr->>'gilti_claimed');
        ELSE v_failc := v_failc || format('GILTI stored %s, recomputed %s', v_cr->>'gilti_claimed', v_x); v_diff := v_diff + abs(v_x - (v_cr->>'gilti_claimed')::numeric); END IF;
      ELSE
        v_nac := v_nac || format('GILTI %s (no CFC figures stored)', v_cr->>'gilti_claimed');
      END IF;
    END IF;
    v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R8b', 'title', 'EIC, CTC/ACTC and GILTI recomputed from stored inputs',
      'status', CASE WHEN cardinality(v_failc) > 0 THEN 'fail' WHEN cardinality(v_nac) > 0 THEN 'not_assessed' ELSE 'pass' END,
      'n', cardinality(v_failc), 'amount', CASE WHEN cardinality(v_failc) > 0 THEN round(v_diff, 2) END,
      'of', cardinality(v_okc) + cardinality(v_failc) + cardinality(v_nac),
      'detail', 'recomputed ok: ' || coalesce(nullif(array_to_string(v_okc, '; '), ''), 'none') || ' | differs: ' || coalesce(nullif(array_to_string(v_failc, '; '), ''), 'none')
                || ' | not assessed: ' || coalesce(nullif(array_to_string(v_nac, '; '), ''), 'none'),
      'ids', to_jsonb(v_failc)));
  END IF;

  -- R9: every Schedule C line on the stored return result equals the DB total.
  IF v_res IS NULL OR NOT v_res ? 'schedule_c' THEN
    v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R9', 'title', 'return lines equal the DB totals', 'status', 'not_assessed',
      'n', 0, 'amount', NULL, 'detail', 'no return lines stored with the result', 'ids', '[]'::jsonb));
  ELSE
    WITH cmp AS (
      SELECT s.key AS sched, l.key AS line, (l.value #>> '{}')::numeric AS ret,
             coalesce((v_state->'schedule_c'->s.key->>l.key)::numeric, 0) AS db
      FROM jsonb_each(v_res->'schedule_c') s, jsonb_each(s.value) l
    ), bad AS (
      SELECT * FROM cmp WHERE CASE WHEN coalesce((v_res->>'whole_dollars')::boolean, false) THEN abs(ret - round(db)) > 1 ELSE abs(ret - db) > 0.005 END
    )
    SELECT jsonb_build_object('rule', 'R9', 'title', 'return lines equal the DB totals', 'n', (SELECT count(*) FROM bad), 'of', (SELECT count(*) FROM cmp),
      'amount', (SELECT round(coalesce(sum(abs(ret - db)), 0), 2) FROM bad),
      'status', CASE WHEN (SELECT count(*) FROM bad) = 0 THEN 'pass' ELSE 'fail' END,
      'ids', (SELECT coalesce(jsonb_agg(format('%s line %s: return %s, DB %s', sched, line, ret, db)), '[]') FROM bad))
      INTO v_bad;
    v_rules := v_rules || jsonb_build_array(v_bad);
  END IF;

  -- R10: audit-proof tiers of the year's deductions (v_books_audit_tiers, read once). Fails on (a) a section 274 item that needs a receipt
  -- (lodging, or $75 or more) and has no document and is not recorded as a caveat, or (b) a deduction with no payment proof and
  -- no owner ruling. The tier rollup is always reported; tier B is split into B with a bank line and B with no bank line (asset
  -- register, owner ruling), and the rows outside the deduction denominator are reported by rule. A year with no deduction decisions is not assessed.
  WITH ta AS MATERIALIZED (SELECT * FROM public.v_books_audit_tiers WHERE owner_id = p_owner_id AND year = v_year),
  t AS MATERIALIZED (SELECT * FROM ta WHERE is_deduction),
  bad AS (
    SELECT t.local_id, t.amount, (t.needs_receipt AND NOT t.doc_proof AND NOT t.is_caveat) AS no_receipt,
           (NOT t.pay_proof AND NOT t.has_owner_ruling AND t.structural_rule IS NULL) AS no_pay_no_ruling
    FROM t WHERE (t.needs_receipt AND NOT t.doc_proof AND NOT t.is_caveat) OR (NOT t.pay_proof AND NOT t.has_owner_ruling AND t.structural_rule IS NULL)
  ),
  agg AS (
    SELECT count(*) AS n, round(coalesce(sum(amount), 0), 2) AS usd,
           round(coalesce(sum(amount) FILTER (WHERE tier = 'A'), 0), 2) AS a_usd, round(coalesce(sum(amount) FILTER (WHERE tier = 'B'), 0), 2) AS b_usd,
           round(coalesce(sum(amount) FILTER (WHERE tier = 'C'), 0), 2) AS c_usd,
           count(*) FILTER (WHERE tier = 'B' AND NOT pay_proof) AS bn_n, round(coalesce(sum(amount) FILTER (WHERE tier = 'B' AND NOT pay_proof), 0), 2) AS bn_usd
    FROM t
  ),
  xc AS (SELECT count(*) AS n, round(coalesce(sum(amount), 0), 2) AS usd FROM ta WHERE NOT is_deduction)
  SELECT CASE WHEN (SELECT n FROM agg) = 0 THEN
      jsonb_build_object('rule', 'R10', 'title', 'deductions are audit-proof: bank line plus allocation basis plus document (A), bank line plus cited allocation basis (B), or a cited asset register or owner ruling with no bank line (B, reported apart)',
        'status', 'not_assessed', 'n', 0, 'amount', NULL, 'detail', 'no Expense decisions for this year', 'ids', '[]'::jsonb)
    ELSE jsonb_build_object('rule', 'R10', 'title', 'deductions are audit-proof: bank line plus allocation basis plus document (A), bank line plus cited allocation basis (B), or a cited asset register or owner ruling with no bank line (B, reported apart)',
      'status', CASE WHEN (SELECT count(*) FROM bad) = 0 THEN 'pass' ELSE 'fail' END,
      'n', (SELECT count(*) FROM bad), 'amount', (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM bad), 'of', (SELECT n FROM agg),
      'detail', format('of %s deduction decisions totalling %s: A %s (%s%%), B %s (%s%%; %s on %s rows have no bank line: asset register or owner ruling), C %s (%s%%); %s section 274 items need a receipt and have none and no caveat, %s deductions have no payment proof and no owner ruling; %s further rows (%s) are outside the deduction denominator',
        (SELECT n FROM agg), (SELECT usd FROM agg),
        (SELECT a_usd FROM agg), (SELECT round(100 * a_usd / nullif(usd, 0), 1) FROM agg),
        (SELECT b_usd FROM agg), (SELECT round(100 * b_usd / nullif(usd, 0), 1) FROM agg), (SELECT bn_usd FROM agg), (SELECT bn_n FROM agg),
        (SELECT c_usd FROM agg), (SELECT round(100 * c_usd / nullif(usd, 0), 1) FROM agg),
        (SELECT count(*) FROM bad WHERE no_receipt), (SELECT count(*) FROM bad WHERE no_pay_no_ruling), (SELECT n FROM xc), (SELECT usd FROM xc)),
      'tiers', (SELECT jsonb_object_agg(k.tier, jsonb_build_object('n', k.n, 'amount', k.a)) FROM
                  (SELECT tier, count(*) AS n, round(sum(amount), 2) AS a FROM t GROUP BY tier) k),
      'b_no_bank', jsonb_build_object('n', (SELECT bn_n FROM agg), 'amount', (SELECT bn_usd FROM agg),
                  'by_rule', (SELECT coalesce(jsonb_object_agg(q.r, jsonb_build_object('n', q.n, 'amount', q.a)), '{}') FROM
                                (SELECT structural_rule AS r, count(*) AS n, round(sum(amount), 2) AS a FROM t WHERE tier = 'B' AND NOT pay_proof GROUP BY structural_rule) q)),
      'excluded', jsonb_build_object('n', (SELECT n FROM xc), 'amount', (SELECT usd FROM xc),
                  'by_rule', (SELECT coalesce(jsonb_object_agg(q.r, jsonb_build_object('n', q.n, 'amount', q.a)), '{}') FROM
                                (SELECT structural_rule AS r, count(*) AS n, round(sum(amount), 2) AS a FROM ta WHERE NOT is_deduction GROUP BY structural_rule) q)),
      'ids', (SELECT coalesce(jsonb_agg(q.local_id), '[]') FROM (SELECT local_id FROM bad ORDER BY abs(amount) DESC LIMIT 100) q))
    END
  INTO v_r10;
  v_rules := v_rules || jsonb_build_array(v_r10);

  RETURN jsonb_build_object('owner_id', p_owner_id, 'year', p_year, 'read_at', now(),
    'pass', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) x WHERE x->>'status' <> 'pass'),
    'failing', (SELECT coalesce(jsonb_agg(x->>'rule'), '[]') FROM jsonb_array_elements(v_rules) x WHERE x->>'status' = 'fail'),
    'rules', v_rules);
END $function$;
