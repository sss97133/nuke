-- 20260523080600_first_name_economy_seed.sql
--
-- Seeds the technicians table with the first-name-only "hustler economy" operators
-- that Skylar named in 2026-05-23 session but the parallel research agent confirmed
-- have zero web footprint (no website, no BBB, no Yelp).
--
-- Per /tmp/boulder_city_shops_enrichment_2026-05-23.md SECTION 3:
--   "Justin / Trent / Dave / Tommy / Ernies are the under-the-table economy.
--    Capture as `contacts` rows with `role='independent_mechanic'` + city tag
--    rather than `organizations`."
--
-- Since there's no general `contacts` table yet (only `unverified_contacts`),
-- these go into `technicians` directly. Tier and rate are UNKNOWN until evidence
-- accumulates from the photo cascade. Provenance = skylar_verbal_testimony.
--
-- Also seeds names Skylar referenced in prior session work: Charles (Bronco
-- mechanic — paid via Farrell flow), Keoni (Charles' partner), JB Hart
-- (someone paid a lot per Skylar memory), Brad (client paid).
--
-- ALL of these have data_quality = "skylar_verbal_only" and should NOT be
-- treated as canonical until corroborated.

INSERT INTO public.technicians (
  name, display_name, source, tier_inferred,
  specialties, certifications,
  geography_history,
  claimed_hourly_rate, inferred_hourly_rate, inferred_rate_confidence
)
VALUES
  (
    'Justin (last name unknown)',
    'Justin',
    'skylar_verbal_testimony_2026-05-23',
    NULL,  -- unknown until evidence
    '{}'::jsonb,
    '[]'::jsonb,
    '[{"city":"Boulder City","state":"NV","role":"hustler_sells_cars","note":"Skylar verbal: hustler who sells cars"}]'::jsonb,
    NULL, NULL, 'zero_data'
  ),
  (
    'Trent (last name unknown)',
    'Trent',
    'skylar_verbal_testimony_2026-05-23',
    NULL,
    '{}'::jsonb,
    '[]'::jsonb,
    '[{"city":"Boulder City","state":"NV","role":"semi_professional","note":"Skylar verbal: down the street, semi-pro, gets shit done"}]'::jsonb,
    NULL, NULL, 'zero_data'
  ),
  (
    'Tommy (paint, last name unknown)',
    'Tommy',
    'skylar_verbal_testimony_2026-05-23',
    NULL,
    '{"paint": {"hours": 0, "evidence_count": 0, "skill_score": null, "note": "Skylar says Tommy does paint"}}'::jsonb,
    '[]'::jsonb,
    '[{"city":"Boulder City","state":"NV","role":"individual_painter","note":"Skylar verbal: paint individual not a shop"}]'::jsonb,
    NULL, NULL, 'zero_data'
  ),
  (
    'Dave (Skylar neighbor, electrical)',
    'Dave',
    'skylar_verbal_testimony_2026-05-23',
    'specialist',
    '{"electrical": {"hours": 0, "evidence_count": 0, "skill_score": null, "note": "Skylar verbal: specialized in electrical, doesn''t serve general public"}}'::jsonb,
    '[]'::jsonb,
    '[{"city":"Boulder City","state":"NV","role":"electrical_specialist","note":"Skylar neighbor; specialized clientele only","possible_match":"TIG Mobile Automotive (per research agent)"}]'::jsonb,
    NULL, NULL, 'zero_data'
  ),
  (
    'Charles (Bronco mechanic, last name unknown)',
    'Charles',
    'skylar_verbal_testimony_2026-05-02_session_aefe49ba',
    NULL,
    '{"general_mechanic": {"hours": 0, "evidence_count": 0, "note": "Did work on Skylar Bronco per session aefe49ba"}}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    NULL, NULL, 'zero_data'
  ),
  (
    'Keoni (Charles partner)',
    'Keoni',
    'skylar_verbal_testimony_2026-05-02_session_aefe49ba',
    NULL,
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    NULL, NULL, 'zero_data'
  ),
  (
    'JB Hart',
    'JB Hart',
    'skylar_verbal_testimony_session_aefe49ba',
    NULL,
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    NULL, NULL, 'zero_data'
  ),
  (
    'Skylar Williams',
    'Skylar',
    'platform_user_self',
    'master',  -- inferred from photo evidence base: 30+ atoms, master-tier wiring/restoration operations documented
    '{
      "wiring": {"hours": 0, "evidence_count": 30, "skill_score": null, "note": "Per session 9fcdd38f atoms across April-May 2026"},
      "restoration": {"hours": 0, "evidence_count": 30, "skill_score": null},
      "fabrication": {"hours": 0, "evidence_count": 5, "skill_score": null, "note": "Harness fab at vise May 20"},
      "exhaust_install": {"hours": 0, "evidence_count": 4, "skill_score": null}
    }'::jsonb,
    '[]'::jsonb,
    '[{"city":"Boulder City","state":"NV","shop_address":"707 Yucca St","role":"shop_owner_operator"}]'::jsonb,
    85.00,  -- self-claimed (from prior session CLI default)
    NULL,   -- inferred not yet computed (compute_inferred_value RPC needs evidence backfill)
    'fallback_to_claimed_rate'
  )
ON CONFLICT DO NOTHING;

-- Update notes
COMMENT ON TABLE public.technicians IS
'Technician profiles. Tier and hourly_rate are INFERRED from photo-cascade evidence, not claimed. The delta between claimed and inferred is the worth-proof at the person level. Seeded 2026-05-23 with: Skylar (master tier inferred from session 9fcdd38f atom base) + 7 first-name-economy operators from verbal testimony (zero_data confidence). See encyclopedia chapter 05.';
