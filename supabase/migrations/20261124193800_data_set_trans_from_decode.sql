-- data_set_trans_from_decode_v1: a transmission stamp decode read from a photo admits trans_type and trans_speeds
-- memberships with that observation as basis, beside the text spans.
--
-- WHY. trans_type and trans_speeds memberships come only from text spans (vehicle_code_readings over descriptions,
-- listing text, comments and observations' free text), which grade 'mentioned' (20261124193700) and never establish.
-- The photo decode that establishes the facet item transmission.current.type (trans_id_stamp_decode_v1, a decode of a
-- photographed transmission stamp with its photo as witness, e.g. 'Muncie 4-speed manual' with speeds 4) admitted only
-- the case and tailhousing casting kinds. Measured 2026-11-25 on the proof vehicle: trans_type automatic (2 text
-- witnesses) and manual (5), trans_speeds 3 and 4, all text; facet transmission.current.type established from 3
-- trans_id_stamp_decode_v1 photos.
--
-- WHAT. data_set_candidates_v1's photo decode branch (obs_codes) adds two kinds for trans_id_stamp_decode_v1:
--   trans_type   = vehicle_facet_norm('transmission_type', structured_data transmission_type, else transmission)
--                  (manual | automatic | cvt; the facet reader's normaliser);
--   trans_speeds = the leading digit 3-6 of structured_data transmission_speeds.
-- Keyed like the text readings (data_set_code_key_v1: '<make>:<value>'), so the decode joins the same set as the spans
-- and data_set_grade_vehicle counts it as a decode witness (alone it establishes). A value written as alternatives
-- ('M20 or M21') is not admitted: trans_model stays out of this branch. The fold loop re-folds scoped vehicles on its own
-- because data_set_candidates_v1 is part of model_fold_logic_key.
--
-- REVERT. Restore data_set_candidates_v1 from pg_get_functiondef before this migration (the two anchored lines); the
-- next fold supersedes the memberships it admitted. Contract: supabase/sql/test_data_set_trans_from_decode.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  a1 text := $a$       ('plant_year', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN o.sd->>'assembly_plant_code' END, 'body_tag_plant_code')$a$;
  r1 text := $a$       ('plant_year', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN o.sd->>'assembly_plant_code' END, 'body_tag_plant_code'),
       -- data_set_trans_from_decode_v1
       ('trans_type', CASE WHEN o.m = 'trans_id_stamp_decode_v1'
                           THEN public.vehicle_facet_norm('transmission_type', coalesce(o.sd->>'transmission_type', o.sd->>'transmission')) END, NULL),
       ('trans_speeds', CASE WHEN o.m = 'trans_id_stamp_decode_v1'
                             THEN substring(o.sd->>'transmission_speeds' FROM '^\s*([3-6])(?:[^0-9]|$)') END, NULL)$a$;
  a2 text := $a$             WHEN 'plant_year' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)$a$;
  r2 text := $a$             WHEN 'plant_year' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             WHEN 'trans_type' THEN format('%s:%s', c.mk, c.code)
             WHEN 'trans_speeds' THEN format('%s:%s', c.mk, c.code)$a$;
BEGIN
  d := pg_get_functiondef('public.data_set_candidates_v1(uuid[])'::regprocedure);
  IF position('data_set_trans_from_decode_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'data_set_candidates_v1: anchor 1 not found exactly once'; END IF;
  IF (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'data_set_candidates_v1: anchor 2 not found exactly once'; END IF;
  EXECUTE replace(replace(d, a1, r1), a2, r2);
END $patch$;
