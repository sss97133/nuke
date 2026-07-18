-- =============================================================================
-- make_model GRAIN NODES — model-grain + generation-grain cohort subjects
-- =============================================================================
-- Goal (iOS cohort chips): 1977 / Chevrolet / Blazer must each DRILL to a DISTINCT
-- real cohort, not the same set:
--   • "1977"   -> YEAR grain     (1977 Chevrolet K5 Blazer)        — 68 members
--   • "Blazer" -> MODEL grain    (all K5 Blazer years, 1969-1991)  — full run
--   • Squarebody -> GENERATION grain (1973-1991 K5 Blazer)         — the gen subset
--   • "Chevrolet" -> stays a FLAT honest chip (NOT a drill). True make-grain
--     ("all Chevrolets") is NOT supported by cohort_members — it always applies a
--     per-model word-boundary pattern, so there is no honest make-grain cohort to
--     resolve. We do NOT fabricate one.
--
-- Develop-from-what-exists. The stack already supported model/generation grains
-- MECHANICALLY (cohort_members has a year-BETWEEN branch for non-'year' grains).
-- Two real gaps blocked registering them, fixed here ADDITIVELY:
--
--   GAP 1 — table CHECK. make_model_profiles.grain CHECK only allowed
--           ('year','generation'); 'model' was rejected at the table. Extend to
--           include 'model'.
--   GAP 2 — register idempotency. The UNIQUE(canonical_make, canonical_model,
--           year, grain) treats NULL year (non-year grains) as DISTINCT, so the
--           ON CONFLICT arbiter never fires for model/generation grains —
--           re-registering would silently insert a DUPLICATE row. PG17 fix:
--           rebuild the constraint NULLS NOT DISTINCT so two model/generation
--           rows with the same (make, model, grain) and NULL year collide and the
--           upsert is truly idempotent.
--   GAP 3 — register year bounds. For non-year grains register left year_start/
--           year_end populated only for 'generation' (from canonical_models) and
--           NULL for 'model'. cohort_members' ELSE branch needs non-NULL bounds
--           (it emits `year BETWEEN <start> AND <end>`); NULL bounds produce a
--           broken predicate. Patch register to ALWAYS set bounds for non-year
--           grains: explicit caller bounds win, else the canonical_models model
--           range, else a wide fallback (1885 .. current_year+1 = "all years").
--
-- Idempotent: re-runnable. Additive only — no drops of data, no testimony writes.
-- Authorized: extends the make_model subject system from
-- 20260616120000_make_model_subject_cohort_terminal.sql (owner-signed table).
--
-- Verified against live schema 2026-06-22 (PG 17.6):
--   make_model_profiles(subject_id, canonical_make, canonical_model, grain, year,
--                       year_start, year_end, canonical_model_id, ...)
--   canonical_models(id, make, canonical_model, aliases, year_start, year_end)
--   K5 Blazer canonical row c9f4d39f-... = make 'Chevrolet', range 1969-1991,
--     aliases {k5, k5 blazer, blazer, k-5, k 5 blazer, full size blazer}.
-- =============================================================================

-- ─── GAP 1: allow 'model' grain at the table ────────────────────────────────
ALTER TABLE public.make_model_profiles
  DROP CONSTRAINT IF EXISTS make_model_profiles_grain_check;
ALTER TABLE public.make_model_profiles
  ADD CONSTRAINT make_model_profiles_grain_check
  CHECK (grain IN ('year','generation','model'));

-- ─── GAP 2: make non-year-grain upsert idempotent (NULLS NOT DISTINCT) ───────
-- Replaces the auto-named UNIQUE with an explicitly-named NULLS NOT DISTINCT
-- equivalent so the ON CONFLICT arbiter in register_make_model_subject fires for
-- NULL-year (model/generation) rows. Guard the rebuild so the migration is
-- re-runnable.
DO $$
BEGIN
  -- Drop the original auto-named constraint if it is still the NULLS-DISTINCT one.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.make_model_profiles'::regclass
      AND conname = 'make_model_profiles_canonical_make_canonical_model_year_gra_key'
  ) THEN
    ALTER TABLE public.make_model_profiles
      DROP CONSTRAINT make_model_profiles_canonical_make_canonical_model_year_gra_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.make_model_profiles'::regclass
      AND conname = 'make_model_profiles_make_model_year_grain_key'
  ) THEN
    ALTER TABLE public.make_model_profiles
      ADD CONSTRAINT make_model_profiles_make_model_year_grain_key
      UNIQUE NULLS NOT DISTINCT (canonical_make, canonical_model, year, grain);
  END IF;
END $$;

-- ─── GAP 3 + bounds: register_make_model_subject patched ─────────────────────
-- Additive optional params p_year_start / p_year_end (DEFAULT NULL). Existing
-- callers (frontend CohortTerminal, universal-search) pass only p_make/p_model/
-- p_year by name and are unaffected. For non-year grains the function now ALWAYS
-- writes a non-NULL [year_start, year_end] so cohort_members can resolve.
--
-- Drop the prior 4-arg signature FIRST. CREATE OR REPLACE with a different arg
-- list creates a NEW overload (it does not replace), which makes 4-positional-arg
-- calls ambiguous ("could not choose a best candidate"). One canonical signature.
DROP FUNCTION IF EXISTS public.register_make_model_subject(text,text,integer,text);

CREATE OR REPLACE FUNCTION public.register_make_model_subject(
  p_make text,
  p_model text,
  p_year integer DEFAULT NULL,
  p_grain text DEFAULT 'year',
  p_year_start integer DEFAULT NULL,
  p_year_end integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_cm public.canonical_models%ROWTYPE;
  v_ys integer;
  v_ye integer;
  v_max_year integer := extract(year from now())::int + 1;
BEGIN
  -- Guards: reject empty make/model and (year grain) out-of-range years.
  IF p_make IS NULL OR length(trim(p_make)) < 1
     OR p_model IS NULL OR length(trim(p_model)) < 1 THEN
    RETURN NULL;
  END IF;
  IF p_grain NOT IN ('year','generation','model') THEN
    RETURN NULL;
  END IF;
  IF p_grain = 'year' AND (p_year IS NULL OR p_year < 1885 OR p_year > v_max_year) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_cm FROM public.canonical_models cm
   WHERE lower(cm.make) = lower(p_make)
     AND (lower(cm.canonical_model) = lower(p_model)
          OR lower(p_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
   LIMIT 1;

  -- For non-year grains, resolve the [year_start, year_end] window that
  -- cohort_members will scan. Precedence: explicit caller bounds > canonical_models
  -- model range > wide fallback (1885 .. current_year+1 = "all years"). For the
  -- 'model' grain we want the WHOLE model run; for 'generation' the caller passes
  -- the explicit generation window (canonical_models has no per-generation range).
  IF p_grain <> 'year' THEN
    v_ys := COALESCE(p_year_start, v_cm.year_start, 1885);
    v_ye := COALESCE(p_year_end, v_cm.year_end, v_max_year);
    -- Sanity: order the bounds and clamp the upper bound to a sane max.
    IF v_ys > v_ye THEN
      v_id := v_ys; v_ys := v_ye; v_ye := v_id; v_id := NULL;
    END IF;
    IF v_ye > v_max_year THEN v_ye := v_max_year; END IF;
    IF v_ys < 1885 THEN v_ys := 1885; END IF;
  END IF;

  INSERT INTO public.make_model_profiles
    (canonical_make, canonical_model, grain, year, year_start, year_end, canonical_model_id)
  VALUES (
    upper(COALESCE(v_cm.make, p_make)),
    COALESCE(v_cm.canonical_model, p_model),
    p_grain,
    CASE WHEN p_grain = 'year' THEN p_year END,
    CASE WHEN p_grain <> 'year' THEN v_ys END,
    CASE WHEN p_grain <> 'year' THEN v_ye END,
    v_cm.id
  )
  -- Arbiter is now NULLS NOT DISTINCT, so this fires for model/generation rows
  -- (year IS NULL) and the upsert is idempotent. Keep bounds fresh on conflict.
  ON CONFLICT (canonical_make, canonical_model, year, grain) DO UPDATE
    SET updated_at  = now(),
        year_start  = COALESCE(EXCLUDED.year_start, public.make_model_profiles.year_start),
        year_end    = COALESCE(EXCLUDED.year_end,   public.make_model_profiles.year_end),
        canonical_model_id = COALESCE(EXCLUDED.canonical_model_id, public.make_model_profiles.canonical_model_id)
  RETURNING subject_id INTO v_id;
  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.register_make_model_subject(text,text,integer,text,integer,integer) IS
  'Lazy upsert of a make_model cohort subject (year | model | generation grain). '
  'Canonicalizes via canonical_models. Non-year grains always get a non-NULL '
  '[year_start,year_end] window (explicit bounds > canonical model range > all-years '
  'fallback) so cohort_members can resolve. Idempotent via NULLS NOT DISTINCT arbiter. '
  'Returns subject_id to peg projection_event claims.';

GRANT EXECUTE ON FUNCTION public.register_make_model_subject(text,text,integer,text,integer,integer)
  TO anon, authenticated, service_role;

-- ─── SEED: the two new grain subjects (idempotent via the patched upsert) ─────
-- Explicit casts on NULL/text literals so the call binds unambiguously.
-- (a) K5 Blazer MODEL grain — all years. No explicit bounds -> canonical_models
--     range 1969-1991 (the full K5 run). Drill target for the iOS "Blazer" chip.
SELECT public.register_make_model_subject('Chevrolet'::text, 'K5 Blazer'::text, NULL::integer, 'model'::text);

-- (b) Squarebody GENERATION — 1973-1991 K5 Blazer (the squarebody-era subset; the
--     1969-1972 first-gen "rounded line" K5 is excluded). Explicit bounds because
--     canonical_models carries only the whole-model range, not per-generation.
SELECT public.register_make_model_subject('Chevrolet'::text, 'K5 Blazer'::text, NULL::integer, 'generation'::text, 1973::integer, 1991::integer);
