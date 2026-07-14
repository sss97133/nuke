-- Gate 5: reject garbage make values at the DB chokepoint.
--
-- Context: the Craigslist / FB-Marketplace naive title-parsers (and ~40 local
-- FB scraper scripts) wrote non-make tokens into vehicles.make on live public
-- listings — boat/spec dimensions ("12", "427", "110"), literal years ("1999",
-- "2004"), punctuation ("."), and single letters ("C"). No real make is
-- shaped that way. This trigger is the universal guard: it fires no matter
-- which of the many writers (edge functions or local scripts) touches make,
-- mirroring the trg_flag_sale_date_ingest_stamp precedent (2026-07-08).
--
-- Scope note: rejects ONLY never-valid shapes so real makes survive intact —
-- MG, AC, MV (Agusta), OM, BMW, "AM General", "Alfa Romeo", "Mercedes-Benz".
-- Two-char letter fragments (Ez/El/Go from FB parsers) are handled in the
-- CL/FB code paths + backfill, not here, to avoid nulling legit short makes.
--
-- Non-destructive: the rejected value is preserved inside data_quality_flags
-- (make_rejected_value) so nothing is lost; make is set NULL = honest unknown,
-- per "mark unknown, don't hallucinate it closed."

CREATE OR REPLACE FUNCTION public.is_garbage_make(m text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN m IS NULL THEN false
    ELSE (
      btrim(m) ~ '^[0-9]'          -- starts with a digit: "12", "427", "2004", "02", "1161"
      OR btrim(m) !~ '[A-Za-z]'    -- no letters at all: "", ".", "-", "'83", "–1967"
      OR char_length(btrim(m)) = 1 -- single char: "C", "T", "V", "K"
      OR btrim(m) ~ '^(19|20)[0-9]{2}$' -- year-shaped (explicit; subset of the digit rule)
    )
  END;
$$;

COMMENT ON FUNCTION public.is_garbage_make(text) IS
  'True when a make value is a never-valid shape (digit-led, letterless, single-char, or year). Used by trg_sanitize_make and Gate-5 backfill. Does NOT flag 2-char letter makes (MG/AC/MV/OM survive).';

CREATE OR REPLACE FUNCTION public.sanitize_vehicle_make()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.make IS NOT NULL AND public.is_garbage_make(NEW.make) THEN
    NEW.data_quality_flags := coalesce(NEW.data_quality_flags, '{}'::jsonb)
      || jsonb_build_object(
           'make_rejected', true,
           'make_rejected_value', NEW.make,
           'make_rejected_at', now(),
           'make_rejected_by', 'trg_sanitize_make'
         );
    NEW.make := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sanitize_make ON public.vehicles;
CREATE TRIGGER trg_sanitize_make
  BEFORE INSERT OR UPDATE OF make ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.sanitize_vehicle_make();
