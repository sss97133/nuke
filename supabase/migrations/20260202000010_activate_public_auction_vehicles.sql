-- Show existing public auction-import vehicles on the feed by setting status = 'active'.
-- The feed filters out status = 'pending', so imports (Gooding, Bonhams, etc.) were hidden.

UPDATE vehicles
SET status = 'active', updated_at = NOW()
WHERE is_public = true
  AND (status IS NULL OR status = 'pending')
  AND (
    discovery_source IN ('gooding', 'bonhams', 'bh_auction', 'historics', 'rmsothebys', 'bonhams_catalog_import')
    OR profile_origin IN ('gooding_import', 'bonhams_import', 'bonhams_catalog_import', 'bh_auction_import', 'historics_import', 'rmsothebys_import')
  );
