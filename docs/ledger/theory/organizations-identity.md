# ORGANIZATIONS & IDENTITY — theory card

**The model:** Orgs and identities are not authored — they precipitate as a *byproduct of the extraction crons* (BaT/auction scrapes) into three live tables. An "organization" is an observed entity keyed by canonical website domain (`https://` + no-www + origin-only); an "identity" is an observed `(platform, handle)` row in `external_identities` that a real user may later claim (`claimed_by_user_id`). Labels like `entity_type` are projections of measurement: store the evidence, project the category at render — never bake a taxonomy into schema (the deleted `classify-organization-type` fn and 7 DROPPED org tables are the graveyard of doing otherwise).

**The invariants:**
- `external_identities` (573k rows, written daily) IS the identity graph. NEVER re-mint a graph layer — `identity_nodes`/`identity_edges` were built, abandoned, and DROPPED.
- Org creation is idempotent by canonical domain: `create-org-from-url` looks up existing rows via website variants and *non-destructively enriches* missing fields; `force_new` is the only bypass. Never blind-INSERT an org.
- DB table is `organizations` (renamed from `businesses` 2026-02-15; a `businesses` compat view exists and older fn code still queries it). Don't "fix" the view away.
- Identity claiming only surfaces unclaimed rows (`claimed_by_user_id IS NULL`); claiming links, never merges or deletes evidence.

**Canonical entrypoints** (from CAPABILITY_MAP.md §ORGS & IDENTITY):
- Create/enrich org from URL → `create-org-from-url` edge fn (v62; called by CreateOrganization.tsx + aiDataIngestion)
- Org read model → `organizations` table directly (5.7k rows, FK hub for 25+ tables)
- Org↔vehicle links → `organization_vehicles` table (285k rows)
- Identity graph → `external_identities` table
- Identity search & claim → `search-identities` edge fn + `/claim-identity` page (ClaimExternalIdentity.tsx)
- Seller statistics → `compute-org-seller-stats` (reactivate its cron if needed)
- Org inventory extraction → `import_queue` extraction lane
- UI → `Organizations.tsx` (/org), `OrganizationProfile.tsx` (/org/:orgId), `CreateOrganization.tsx` (/org/create)

**Do NOT:** resurrect deleted fns (classify-organization-type, ingest-org-complete, build-identity-graph, discover-entity-graph, scrape-organization-site, extract-all-orgs-inventory); call prod-orphans with no source (api-v1-seller-stats, enrich-seller, index-classic-com-dealer, sync-instagram-organization); read dead views (org_profiles, organizations_compat — 0 refs) or DROPPED tables (organization_profiles, identity_nodes/edges, org_extraction_coverage); feed `organization_inventory_sync_queue` (fills, never drains); trust the /org pages blindly — they call three UNdeployed fns (org-extraction-coverage, auto-merge-duplicate-orgs → silent 404s). Never hardcode a registry of shops/dealers/channels — every one is an org row with observed provenance.

**Before you build here:** read `docs/ledger/CAPABILITY_MAP.md` (lines 77-84) and `docs/ledger/CANONICAL_LEDGER.md` §6 first — 14 of 25 functions the old CODEBASE_MAP lists are deleted and 7 of 8 tables dropped, so any plan derived from stale maps is wrong. Check the ledger before minting ANY new fn/table; the capability almost certainly exists or was deliberately killed.
