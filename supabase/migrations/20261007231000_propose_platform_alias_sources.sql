-- 20261007231000_propose_platform_alias_sources.sql
--
-- Four add_source proposals (status open, for the owner to approve) that give the platform entity the spellings the
-- writers already emit. From docs/proposals/2026-10-07-platform-entity.md (PR #795): observation_sources is the platform
-- entity (its slug matches 67-100% of the platform text columns, source_registry 0-49%), and the whole remaining mismatch
-- is spelling variants. The house rule (toolbox adjudication, 2026-10-05): duplicates are fine, shop-clean them later, never
-- mint a prevention mechanism; so the alias is a row whose notes name its canonical sibling, and a later fold resolves
-- siblings to one platform. Nothing is applied here: approval runs fn_schema_proposal_apply (20261007100000), which inserts
-- the observation_sources row from the payload.
--
-- EVIDENCE (read-only, prod, 2026-10-07 11:50-11:55Z; samples TABLESAMPLE SYSTEM REPEATABLE (20261007)):
--   vehicles.platform_source (1%): 8,421 sampled rows with a value; no observation_sources slug for bringatrailer 2,039 (24%),
--     classiccars 351 (4.2%), unknown 242, user-submission 80, correct_vehicle_sale_provenance 14, facebook 8.
--   external_listings.platform (5%): 6,791 with a value; barrettjackson 1,228 (18%) unmatched.
--   vehicle_events.source_platform (1%): 4,135 with a value; barrettjackson 270 (6.5%), unknown 32, user-submission 3, and
--     about 20 house display names unmatched.
--   The canonical rows mirrored below (read 11:58Z): bat (auction, tier 2, trust 0.85; its notes already name 'bringatrailer'
--     as a legacy alias), barrett-jackson (auction, tier 2, trust 0.75), classiccars-com (marketplace, tier 3, trust 0.65),
--     agent-submission (agent, trust 0.55).
--   Not proposed: unknown and correct_vehicle_sale_provenance are not platforms (a writer fix); facebook (8 rows) is below
--     the line; the house display names need their own read.
--
-- WHAT: four rows in public.schema_proposals, proposal_type add_source, status open, each with evidence[] (trigger
-- schema_proposal_evidence_check, AX-024). Guarded: a proposal for the same slug that is open, approved or applied is not
-- duplicated, so a re-apply inserts nothing. Payload keys follow fn_schema_proposal_apply: slug, display_name, category
-- (source_category), base_url, tier, base_trust_score, notes, supported_observations (observation_kind[]), why.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
SELECT 'skylar-64/platform-entity-memo', 'add_source', p.payload, p.evidence,
       '{"rows_affected": 1, "tables": ["observation_sources"], "note": "one new row on approval; no existing row changes"}'::jsonb,
       '{"breaking": false, "note": "adds a slug the writers already emit; the NOT VALID keys proposed in the memo come later, one table at a time"}'::jsonb,
       'open'
FROM (VALUES
  ('bringatrailer',
   $j${"slug": "bringatrailer", "display_name": "Bring a Trailer (writer spelling of bat)", "category": "auction", "base_url": "https://bringatrailer.com", "tier": 2, "base_trust_score": 0.85,
      "supported_observations": ["listing", "sale_result", "comment", "bid", "condition", "specification"],
      "notes": "Alias row: the spelling extract-bat-core and the vehicle writers emit in vehicles.platform_source (2,039 of 8,421 sampled vehicles with a platform, 24%, 2026-10-07); the bat row's notes already name it as a legacy alias in auction_events. Sibling of slug bat; a later fold resolves siblings to one platform (docs/proposals/2026-10-07-platform-entity.md).",
      "why": "Platform entity memo 2026-10-07: let vehicles.platform_source key to observation_sources without rewriting stored rows."}$j$::jsonb,
   $e$[{"measure": "vehicles.platform_source = 'bringatrailer' with no observation_sources slug", "value": 2039, "denominator": 8421, "method": "TABLESAMPLE SYSTEM (1) REPEATABLE (20261007)", "at": "2026-10-07T11:50Z"},
       {"measure": "canonical sibling", "value": "bat", "note": "observation_sources.bat.notes: Legacy slug aliases in auction_events: 'bringatrailer'", "at": "2026-10-07T11:58Z"}]$e$::jsonb),
  ('barrettjackson',
   $j${"slug": "barrettjackson", "display_name": "Barrett-Jackson (writer spelling of barrett-jackson)", "category": "auction", "base_url": "https://barrett-jackson.com", "tier": 2, "base_trust_score": 0.75,
      "supported_observations": ["listing", "sale_result", "bid", "condition"],
      "notes": "Alias row: the spelling the Barrett-Jackson writers emit in external_listings.platform (1,228 of 6,791 sampled, 18%) and vehicle_events.source_platform (270 of 4,135, 6.5%), 2026-10-07. Sibling of slug barrett-jackson (docs/proposals/2026-10-07-platform-entity.md).",
      "why": "Platform entity memo 2026-10-07: let external_listings.platform and vehicle_events.source_platform key to observation_sources."}$j$::jsonb,
   $e$[{"measure": "external_listings.platform = 'barrettjackson' with no observation_sources slug", "value": 1228, "denominator": 6791, "method": "TABLESAMPLE SYSTEM (5) REPEATABLE (20261007)", "at": "2026-10-07T11:52Z"},
       {"measure": "vehicle_events.source_platform = 'barrettjackson' with no observation_sources slug", "value": 270, "denominator": 4135, "method": "TABLESAMPLE SYSTEM (1) REPEATABLE (20261007)", "at": "2026-10-07T11:52Z"},
       {"measure": "canonical sibling", "value": "barrett-jackson", "at": "2026-10-07T11:58Z"}]$e$::jsonb),
  ('classiccars',
   $j${"slug": "classiccars", "display_name": "ClassicCars.com (writer spelling of classiccars-com)", "category": "marketplace", "base_url": "https://classiccars.com", "tier": 3, "base_trust_score": 0.65,
      "supported_observations": ["listing", "sale_result"],
      "notes": "Alias row: the spelling the ClassicCars.com writer emits in vehicles.platform_source (351 of 8,421 sampled vehicles with a platform, 4.2%, 2026-10-07). Sibling of slug classiccars-com (docs/proposals/2026-10-07-platform-entity.md).",
      "why": "Platform entity memo 2026-10-07: let vehicles.platform_source key to observation_sources."}$j$::jsonb,
   $e$[{"measure": "vehicles.platform_source = 'classiccars' with no observation_sources slug", "value": 351, "denominator": 8421, "method": "TABLESAMPLE SYSTEM (1) REPEATABLE (20261007)", "at": "2026-10-07T11:50Z"},
       {"measure": "canonical sibling", "value": "classiccars-com", "at": "2026-10-07T11:58Z"}]$e$::jsonb),
  ('user-submission',
   $j${"slug": "user-submission", "display_name": "User submission (the web app's own vehicle entry)", "category": "owner", "base_url": null, "tier": null, "base_trust_score": 0.55,
      "supported_observations": ["ownership", "sighting", "work_record", "specification", "media", "comment", "provenance", "condition"],
      "notes": "The spelling the web app's vehicle entry writes in vehicles.platform_source (80 of 8,421 sampled vehicles with a platform, 0.95%, 2026-10-07) and vehicle_events.source_platform (3 of 4,135). An internal source, like agent-submission (trust 0.55): the submitter's own testimony about their vehicle. Category owner is the proposer's reading; the approver may change it (docs/proposals/2026-10-07-platform-entity.md).",
      "why": "Platform entity memo 2026-10-07: every platform value the writers emit needs a row before the keys are added."}$j$::jsonb,
   $e$[{"measure": "vehicles.platform_source = 'user-submission' with no observation_sources slug", "value": 80, "denominator": 8421, "method": "TABLESAMPLE SYSTEM (1) REPEATABLE (20261007)", "at": "2026-10-07T11:50Z"},
       {"measure": "vehicle_events.source_platform = 'user-submission' with no observation_sources slug", "value": 3, "denominator": 4135, "method": "TABLESAMPLE SYSTEM (1) REPEATABLE (20261007)", "at": "2026-10-07T11:52Z"},
       {"measure": "nearest existing row", "value": "agent-submission", "note": "category agent, trust 0.55", "at": "2026-10-07T11:58Z"}]$e$::jsonb)
) AS p(slug, payload, evidence)
WHERE NOT EXISTS (
  SELECT 1 FROM public.schema_proposals s
  WHERE s.proposal_type = 'add_source' AND s.payload->>'slug' = p.slug AND s.status IN ('open', 'approved', 'applied')
);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.schema_proposals
  WHERE proposal_type = 'add_source' AND status = 'open'
    AND payload->>'slug' IN ('bringatrailer', 'barrettjackson', 'classiccars', 'user-submission');
  RAISE NOTICE 'platform alias add_source proposals open: % of 4', n;
END $$;

COMMIT;
