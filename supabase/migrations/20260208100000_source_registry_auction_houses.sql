-- Add RM Sotheby's, Gooding, Bonhams to source_registry for live auction sync tracking
-- sync-live-auctions updates last_successful_at for these slugs

INSERT INTO source_registry (
  slug, display_name, category, status, extractor_function,
  cloudflare_protected, data_quality_score, is_ugly_source, quality_filters,
  discovery_method
) VALUES
  (
    'rm-sothebys',
    'RM Sotheby''s',
    'auction',
    'active',
    NULL,
    false,
    0.90,
    false,
    NULL,
    'crawl'
  ),
  (
    'gooding',
    'Gooding & Company',
    'auction',
    'active',
    NULL,
    false,
    0.90,
    false,
    NULL,
    'crawl'
  ),
  (
    'bonhams',
    'Bonhams Motoring',
    'auction',
    'active',
    NULL,
    false,
    0.90,
    false,
    NULL,
    'crawl'
  )
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  discovery_method = EXCLUDED.discovery_method,
  updated_at = now();
