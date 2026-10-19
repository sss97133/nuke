-- Empty disposable PG17 dm_refinement_* database only.
-- The wave-3 record migration inserts the 30 production-only identity marks once, keeps their vetted flags, and is a
-- no-op when the rows already exist (as in production).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_identity_marks') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;

-- The table as 20261018153000_era_emblems_and_family_facets.sql creates it.
CREATE TABLE public.vehicle_identity_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL, family text, series_code text, trim_package text, body_style text,
  year_start integer NOT NULL DEFAULT 1900, year_end integer NOT NULL DEFAULT 2035,
  mark_kind text NOT NULL CHECK (mark_kind IN ('marque_emblem', 'series_badge', 'trim_badge', 'model_wordmark', 'body_silhouette')),
  display_label text NOT NULL, sub_label text, rpo_code text, fender_placement text,
  typography_style text NOT NULL DEFAULT 'block_sans', border_treatment text NOT NULL DEFAULT 'chrome_bezel',
  primary_color text NOT NULL DEFAULT '#111111', secondary_color text NOT NULL DEFAULT '#d4af37', accent_color text,
  svg_markup text NOT NULL, provenance_note text NOT NULL, vetted boolean NOT NULL DEFAULT true,
  unique_identity_mark_idx text GENERATED ALWAYS AS (
    lower(brand) || '|' || lower(COALESCE(family, '')) || '|' || lower(COALESCE(series_code, '')) || '|' ||
    lower(COALESCE(trim_package, '')) || '|' || lower(COALESCE(body_style, '')) || '|' ||
    year_start::text || '|' || year_end::text || '|' || mark_kind) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unique_identity_mark_idx)
);

\ir ../migrations/20261019064000_identity_marks_record_live_wave3.sql

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN ASSERT ok IS TRUE, label; END $$;
SELECT pg_temp.check((SELECT count(*) FROM public.vehicle_identity_marks) = 30, 'thirty production-only rows recorded');
SELECT pg_temp.check((SELECT vetted FROM public.vehicle_identity_marks WHERE unique_identity_mark_idx = 'chevrolet|blazer|k5 blazer|||1969|1991|series_badge') = false,
  'the trim-less K5 row keeps vetted = false');
SELECT pg_temp.check((SELECT count(*) FROM public.vehicle_identity_marks WHERE vetted) = 29, 'the other 29 stay vetted');
SELECT pg_temp.check((SELECT bool_and(created_at < '2026-10-18T01:00:00Z') FROM public.vehicle_identity_marks), 'production clocks kept');

-- A row that already exists (as every one does in production) is left exactly as it is.
UPDATE public.vehicle_identity_marks SET display_label = 'EDITED IN PLACE' WHERE unique_identity_mark_idx = 'buick|grand national|gnx|grand national||1982|1987|series_badge';
\ir ../migrations/20261019064000_identity_marks_record_live_wave3.sql
SELECT pg_temp.check((SELECT count(*) FROM public.vehicle_identity_marks) = 30, 'replay inserts nothing');
SELECT pg_temp.check((SELECT display_label FROM public.vehicle_identity_marks WHERE unique_identity_mark_idx = 'buick|grand national|gnx|grand national||1982|1987|series_badge') = 'EDITED IN PLACE',
  'replay does not overwrite an existing row');

SELECT 'identity marks wave-3 record contract passed' AS result;
