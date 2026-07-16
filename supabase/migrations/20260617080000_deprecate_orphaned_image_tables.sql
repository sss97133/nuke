-- Phase 8.2 subtractive cleanup — mark truly-orphaned empty image tables DEPRECATED.
-- These 5 were verified (gap audit 2026-06-17, re-verified at execution time): 0 rows AND
-- zero code references in scripts/ + supabase/functions/ + nuke_frontend/src. Marked via the
-- existing COMMENT convention (matches the vehicle_market_estimates precedent), NOT dropped —
-- DROP needs owner sign-off. The OTHER 8 the prompt called "empty aspirational" were caught
-- accumulating rows mid-audit (image_camera_position alone now ~692K) — they have live
-- writers and are connection-gaps, NOT deprecation candidates, so they are deliberately left.
comment on table image_identities is 'DEPRECATED 2026-06-17: empty, zero code refs (Phase 8.2 audit). Candidate for DROP after owner signoff.';
comment on table image_contracts is 'DEPRECATED 2026-06-17: empty, zero code refs (Phase 8.2 audit). Candidate for DROP after owner signoff.';
comment on table image_garments is 'DEPRECATED 2026-06-17: empty, zero code refs (Phase 8.2 audit). Candidate for DROP after owner signoff.';
comment on table asset_observations is 'DEPRECATED 2026-06-17: empty, zero code refs (Phase 8.2 audit). Candidate for DROP after owner signoff.';
comment on table image_appearances is 'DEPRECATED 2026-06-17: empty, zero code refs (Phase 8.2 audit). Candidate for DROP after owner signoff.';
