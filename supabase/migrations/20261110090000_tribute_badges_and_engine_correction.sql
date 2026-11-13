-- Identity marks on the profile: a tribute earns no factory series or trim badge, and a badge that names no series
-- code or trim package is a brand-wide mark that asserts nothing about one vehicle.
--
-- Measured 2026-11-05: the catalog's uncoded Pontiac plate ('GTO · TRANS AM · JUDGE', no family, series code or trim
-- package) resolved for every 1964-2002 Pontiac with any recorded series or trim (2,372 public vehicles), among them
-- a base-body 1973 Firebird (VIN 2S87...) recorded as a Trans Am tribute (vehicles.is_replica). The masthead's
-- identity_source now carries is_replica, so the header can say "Trans Am-Style" the way the record does.
--
-- correct_vehicle_text_field also accepts engine_type and engine_code: that Firebird's engine_type read "SD-455"
-- with no source while its receipts show a 455 built on a 1970 block, and no sanctioned writer could correct it.
--
-- Patches the live function text at anchors (the pattern of 20261031074000) and refuses drift. Each patch is marked
-- and skipped when already present; a function absent from the database (a contract that builds only one of them)
-- is skipped with a notice.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION pg_temp.patch_once(p_text text, p_anchor text, p_replacement text, p_what text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE n integer := (length(p_text) - length(replace(p_text, p_anchor, ''))) / greatest(length(p_anchor), 1);
BEGIN
  IF n <> 1 THEN RAISE EXCEPTION '% anchor drifted (found % times): %', p_what, n, p_anchor; END IF;
  RETURN replace(p_text, p_anchor, p_replacement);
END $f$;

DO $migration$
DECLARE d text;
BEGIN
  -- 1. resolve_vehicle_identity_marks: an uncoded series or trim badge never resolves.
  IF to_regprocedure('public.resolve_vehicle_identity_marks(text,text,integer,text,text,text)') IS NULL THEN
    RAISE NOTICE 'resolve_vehicle_identity_marks absent; skipped';
  ELSE
    d := pg_get_functiondef(to_regprocedure('public.resolve_vehicle_identity_marks(text,text,integer,text,text,text)'));
    IF position('uncoded_badge_rule_v1' in d) = 0 THEN
      d := pg_temp.patch_once(d,
$a$  WHERE m.vetted = true
    AND a.brand IS NOT NULL$a$,
$b$  WHERE m.vetted = true
    -- uncoded_badge_rule_v1: a series or trim badge naming neither a series code nor a trim package is a brand-wide
    -- mark; it cannot be asserted as this vehicle's series or trim.
    AND NOT (m.mark_kind IN ('series_badge', 'trim_badge') AND m.series_code IS NULL AND m.trim_package IS NULL)
    AND a.brand IS NOT NULL$b$, 'resolve_vehicle_identity_marks');
      EXECUTE d;
    END IF;
  END IF;

  -- 2. vehicle_profile_read: the record's is_replica reaches the identity marks and the masthead.
  IF to_regprocedure('public.vehicle_profile_read(uuid)') IS NULL THEN
    RAISE NOTICE 'vehicle_profile_read absent; skipped';
  ELSE
    d := pg_get_functiondef(to_regprocedure('public.vehicle_profile_read(uuid)'));
    IF position('tribute_badge_rule_v1' in d) = 0 THEN
      d := pg_temp.patch_once(d,
        'drivetrain, city, state, location, listing_location, bat_location, discovery_url, listing_title',
        'drivetrain, city, state, location, listing_location, bat_location, discovery_url, listing_title, is_replica',
        'vehicle_profile_read v columns');
      d := pg_temp.patch_once(d,
        '((r.m).trim_package IS NULL',
$b$(NOT (coalesce(v.is_replica, false) AND (r.m).mark_kind IN ('trim_badge', 'series_badge')))
    -- tribute_badge_rule_v1: a tribute (vehicles.is_replica) earns no factory series or trim badge
    AND ((r.m).trim_package IS NULL$b$, 'vehicle_profile_read identity_marks filter');
      d := pg_temp.patch_once(d,
        $a$'transmission_model', v.transmission_model),$a$,
        $b$'transmission_model', v.transmission_model, 'is_replica', coalesce(v.is_replica, false)),$b$,
        'vehicle_profile_read masthead identity_source');
      EXECUTE d;
    END IF;
  END IF;

  -- 3. correct_vehicle_text_field: engine_type and engine_code are correctable text fields.
  IF to_regprocedure('public.correct_vehicle_text_field(uuid,text,text,text,jsonb,text)') IS NULL THEN
    RAISE NOTICE 'correct_vehicle_text_field absent; skipped';
  ELSE
    d := pg_get_functiondef(to_regprocedure('public.correct_vehicle_text_field(uuid,text,text,text,jsonb,text)'));
    IF position($a$'engine_type'$a$ in d) = 0 THEN
      d := pg_temp.patch_once(d,
        $a$IF p_field NOT IN ('body_style', 'series', 'trim', 'notes') THEN$a$,
        $b$IF p_field NOT IN ('body_style', 'series', 'trim', 'notes', 'engine_type', 'engine_code') THEN$b$,
        'correct_vehicle_text_field field list');
      EXECUTE d;
    END IF;
    COMMENT ON FUNCTION public.correct_vehicle_text_field(uuid, text, text, text, jsonb, text) IS
      'Sanctioned correction of vehicles.body_style/series/trim/notes/engine_type/engine_code: cited source, stale check, prior value kept in superseded_rows.';
  END IF;
END $migration$;

-- Final check: every patched function carries its mark.
DO $check$
BEGIN
  IF to_regprocedure('public.resolve_vehicle_identity_marks(text,text,integer,text,text,text)') IS NOT NULL
     AND position('uncoded_badge_rule_v1' in pg_get_functiondef(to_regprocedure('public.resolve_vehicle_identity_marks(text,text,integer,text,text,text)'))) = 0 THEN
    RAISE EXCEPTION 'resolve_vehicle_identity_marks is not patched';
  END IF;
  IF to_regprocedure('public.vehicle_profile_read(uuid)') IS NOT NULL THEN
    IF position('tribute_badge_rule_v1' in pg_get_functiondef(to_regprocedure('public.vehicle_profile_read(uuid)'))) = 0
       OR position($a$'is_replica', coalesce(v.is_replica, false)$a$ in pg_get_functiondef(to_regprocedure('public.vehicle_profile_read(uuid)'))) = 0 THEN
      RAISE EXCEPTION 'vehicle_profile_read is not patched';
    END IF;
  END IF;
  IF to_regprocedure('public.correct_vehicle_text_field(uuid,text,text,text,jsonb,text)') IS NOT NULL
     AND position($a$'engine_type', 'engine_code'$a$ in pg_get_functiondef(to_regprocedure('public.correct_vehicle_text_field(uuid,text,text,text,jsonb,text)'))) = 0 THEN
    RAISE EXCEPTION 'correct_vehicle_text_field is not patched';
  END IF;
END $check$;

DROP FUNCTION pg_temp.patch_once(text, text, text, text);
COMMIT;
