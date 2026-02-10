-- Add trigram indexes for search performance on external_identities (491K rows)
-- These support ILIKE and % (similarity) queries in universal-search

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_external_identities_handle_trgm
ON external_identities USING GIN (lower(handle) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_external_identities_display_name_trgm
ON external_identities USING GIN (lower(display_name) gin_trgm_ops);
