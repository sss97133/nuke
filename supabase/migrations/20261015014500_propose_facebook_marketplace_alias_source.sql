-- 20261015014500_propose_facebook_marketplace_alias_source.sql
--
-- One add_source proposal (status open, for the owner to approve) for the platform spelling that
-- vehicles.canonical_platform carries most often without a platform entity row: 'facebook-marketplace'. It follows
-- 20261007231000 (PR #798) and docs/proposals/2026-10-07-platform-entity.md: the alias is a row whose notes name its
-- canonical sibling (facebook_marketplace), and a later fold resolves siblings to one platform. Stored values are not
-- renamed: readers compare the literal 'facebook-marketplace' (nuke_frontend/src and supabase/functions, 2026-10-14
-- grep), and source_alias_mapping resolves raw 'facebook_marketplace' to it on every vehicles write.
--
-- EVIDENCE (read-only, prod, 2026-10-14 23:35-23:58Z):
--   vehicles.canonical_platform = 'facebook-marketplace': 78,509 rows with status in the idx_vehicles_canonical_platform_v2
--     set (active, sold, pending, discovered, pending_backfill), of an estimated 627,867 index rows (reltuples). It is
--     the largest of 44 values in that set with no observation_sources slug (87,795 rows in total).
--   source_alias_mapping maps raw 'facebook_marketplace' -> 'facebook-marketplace' (resolve_platform_slug).
--   Canonical sibling read 23:58:03Z: facebook_marketplace (marketplace, tier 3, trust 0.60,
--     supported_observations listing, sale_result, media; base_url NULL). Mirrored below.
--   No add_source proposal for a facebook* slug existed (schema_proposals read 23:55:11Z).
--
-- WHAT: one row in public.schema_proposals, proposal_type add_source, status open, with evidence[]. Guarded: an open,
-- approved or under-review proposal for the same slug is not duplicated, so a re-apply inserts nothing. Nothing is
-- applied: approval runs fn_schema_proposal_apply, which inserts the observation_sources row from the payload.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
SELECT 'night-run/platform-resolution', 'add_source', p.payload, p.evidence,
       '{"rows_affected": 1, "tables": ["observation_sources"], "note": "one new row on approval; no existing row changes"}'::jsonb,
       '{"breaking": false, "note": "adds the slug canonical_platform already carries; no stored value is renamed"}'::jsonb,
       'open'
FROM (VALUES
  ('facebook-marketplace',
   $j${"slug": "facebook-marketplace", "display_name": "Facebook Marketplace (canonical_platform spelling of facebook_marketplace)", "category": "marketplace", "base_url": null, "tier": 3, "base_trust_score": 0.60,
      "supported_observations": ["listing", "sale_result", "media"],
      "notes": "Alias row: the spelling resolve_platform_slug writes to vehicles.canonical_platform for raw facebook_marketplace (source_alias_mapping), on 78,509 vehicles with an indexed status on 2026-10-14. Sibling of slug facebook_marketplace; a later fold resolves siblings to one platform (docs/proposals/2026-10-07-platform-entity.md).",
      "why": "Platform entity memo 2026-10-07: every platform value the writers emit needs an entity row before a key is added; this is the largest unmatched canonical_platform value."}$j$::jsonb,
   $e$[{"measure": "vehicles.canonical_platform = 'facebook-marketplace' with no observation_sources slug", "value": 78509, "denominator_estimate": 627867, "method": "exact count within the idx_vehicles_canonical_platform_v2 status predicate; denominator is pg_class.reltuples of that index", "at": "2026-10-14T23:54Z"},
       {"measure": "source_alias_mapping raw facebook_marketplace", "value": "facebook-marketplace", "at": "2026-10-14T23:31Z"},
       {"measure": "canonical sibling", "value": "facebook_marketplace", "note": "marketplace, tier 3, trust 0.60", "at": "2026-10-14T23:58Z"}]$e$::jsonb)
) AS p(slug, payload, evidence)
WHERE NOT EXISTS (
  SELECT 1 FROM public.schema_proposals s
  WHERE s.proposal_type = 'add_source' AND s.payload->>'slug' = p.slug AND s.status IN ('open', 'under_review', 'approved')
)
AND NOT EXISTS (SELECT 1 FROM public.observation_sources o WHERE o.slug = p.slug);

COMMIT;
