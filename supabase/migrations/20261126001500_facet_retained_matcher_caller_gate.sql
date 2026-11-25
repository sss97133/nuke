-- vehicle_facet_items: call the retained-listing matcher only when the caller can read the row its answer depends on.
--
-- DEFECT. t's first branch keeps a retained_listing_property_projection_v1 row only when
-- retained_listing_property_result_matches(source, property, row) admits it. The planner applies that filter to every
-- obs_w row before the property-map join, and each call runs six nested matchers (retained_*_matches(p, o)) that are
-- not inlined. As anon on production (2026-11-25), vehicle_facet_items(08eae37e, 'masthead') spent 17.6 of 18.0 s in
-- it: 1,766 calls (195 retained listings x 9 properties), ~10 ms each, every one false. Through REST the same car
-- answers 57014 at 15 s for vehicle_facet_items and for vehicle_profile_read, warm.
--
-- WHY EVERY CALL IS FALSE FOR ANON. Every admitting path of the matcher, under the caller, needs
--   the source row:      vehicle_observations p WHERE p.id = p_source            (both EXISTS of the matcher), and
--   its registry row:    observation_sources s WHERE/ON s.id = p.source_id        (the second EXISTS's join, and a
--                        top-level AND inside coalesce(..., false) in each of the six nested matchers).
-- observation_sources has one SELECT policy, for authenticated (20261007233000: "anon reads 0 rows"), so for anon the
-- second test is false on every row. On 08eae37e: anon 1,766 visible / 0 admitted; owner and postgres 1,766 / 1,766.
--
-- FIX. Before the matcher, the same two tests, per row, under the caller:
--   EXISTS (SELECT 1 FROM vehicle_observations gp JOIN observation_sources gs ON gs.id = gp.source_id
--           WHERE gp.id = o.source_observation_id)
-- Gate false means the matcher has no row to admit with, so it is false too: the gate only skips calls whose answer
-- is already false. It names no role and reads the policies as they are, so it stays exact if anon is ever given a
-- read policy on observation_sources (all rows or some): wherever the registry row is readable the gate is true and the
-- matcher decides as before. Signed-in callers are unchanged. Marker: retained_matcher_caller_gate_v1.
-- Which cars a logged-out visitor sees retained listing claims on is unchanged (none); that question is the lead's.
-- Contract: supabase/sql/test_facet_retained_matcher_caller_gate.sql (the live matcher family; anon reading the
-- registry none, all and some; NOT gate => NOT matcher on every row; reader output md5-identical; two mutants fail).
--
-- PREMISE GUARD. The proof above is about these bodies. The migration refuses unless the matcher and the six nested
-- matchers still hash as read on 2026-11-25 and are all SECURITY INVOKER (a definer matcher would read the registry
-- as its owner and the gate would hide rows). A change to any of them re-proves the gate before this applies.
--
-- GUARD. Refuses unless vehicle_facet_items' live body is prosrc sha256 RPIxtoEH... (2026-11-25, after facts' merges)
-- or already carries the marker; the anchor must occur exactly once. The setting nuke.facet_gate_contract = 'on'
-- skips only the vehicle_facet_items hash, for the contract's minimal reader holding the live anchor verbatim.
-- REVERT: supabase/sql/revert_20261126001500_facet_retained_matcher_caller_gate.sql.
-- Owner of vehicle_facet_items: ta-facts (accepts this proposal).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  h text;
  f record;
  anchor constant text := $a$
         OR public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id))$a$;
  gated constant text := $g$
         OR (EXISTS (SELECT 1 FROM public.vehicle_observations gp JOIN public.observation_sources gs ON gs.id = gp.source_id
                     WHERE gp.id = o.source_observation_id) -- retained_matcher_caller_gate_v1
             AND public.retained_listing_property_result_matches(o.source_observation_id, o.property_id, o.id)))$g$;
BEGIN
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'base64') INTO h
    FROM pg_proc p WHERE p.oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure;
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('retained_matcher_caller_gate_v1' IN d) > 0 THEN RETURN; END IF;
  IF h IS DISTINCT FROM 'RPIxtoEHX2bSjvgPY+5E15n1WUZfSIQSD3VDSrgsPpw='
     AND current_setting('nuke.facet_gate_contract', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'vehicle_facet_items differs from the body read 2026-11-25 (%); re-read it before gating the matcher', h;
  END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'vehicle_facet_items: the retained matcher call is not found exactly once';
  END IF;

  FOR f IN
    SELECT x.fn, x.h, p.oid IS NOT NULL AS found, p.prosecdef,
           encode(sha256(convert_to(p.prosrc, 'UTF8')), 'base64') AS live_h
    FROM (VALUES
      ('retained_listing_property_result_matches', 'q2zhc2d9ob41X7cJ0J4pMyxVVPra/NNmVdZYQUqfRh0='),
      ('retained_description_property_matches',    'zDcim4E31gu/9lkSGEN8fVptqS/QyIwL/RScS46iTTE='),
      ('retained_listing_identity_matches',        'EKQXou0L0qR6sK7iun+uJq3sBolVRgE0RFtv8aV/QO8='),
      ('retained_craigslist_odometer_matches',     '5mLpfeLngJI5SLL2GWGHvsQb4tUzJfkhhAOvurg+/iA='),
      ('retained_craigslist_year_matches',         'eX9WUsIfDtm9s0D4X6HxtLTn7AMYtP7Cz2OAYO5E0Z0='),
      ('retained_description_year_matches',        'PxnVfK/vk21gNUMHz9Jk8uvH8SsHwP+RSwEUn9vBojI='),
      ('retained_description_identity_matches',    'rWtHCE+tXm7XJKT/xhzDX8s3GQI8cfI0GTXkS9YzwOA=')) x(fn, h)
    LEFT JOIN pg_proc p ON p.proname = x.fn AND p.pronamespace = 'public'::regnamespace
  LOOP
    IF NOT f.found OR f.live_h IS DISTINCT FROM f.h OR f.prosecdef THEN
      RAISE EXCEPTION '% changed since the gate was proved (found %, hash %, definer %); re-prove the gate', f.fn, f.found, f.live_h, f.prosecdef;
    END IF;
  END LOOP;

  EXECUTE replace(d, anchor, gated);
END
$patch$;
