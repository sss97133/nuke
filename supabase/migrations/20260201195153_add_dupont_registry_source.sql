-- Add DuPont Registry as a new extraction source
-- Scout Report: https://www.dupontregistry.com
--
-- Key Findings:
-- - Next.js application on CloudFront CDN
-- - AWS WAF with CAPTCHA (blocks basic bots, works with browser UA)
-- - Rich structured data in __NEXT_DATA__ (carState contains full vehicle info)
-- - Sitemap available with listing URLs
-- - High-quality luxury/exotic vehicle focus
--
-- Data Quality:
-- - VIN available on listings
-- - Full vehicle specs (year, make, model, mileage, price, colors)
-- - Engine/transmission/drivetrain details
-- - Dealer information with contact details
-- - Multiple image sizes available
-- - Detailed descriptions with option lists
--
-- Brands (with counts as of 2026-02-01):
-- - Porsche (1,654), Ferrari (1,345), Mercedes-Benz (1,213)
-- - Ford (3,150), Bentley (786), Audi (676)
-- - Aston Martin (561), BMW (542), Lamborghini (515)
-- - Rolls-Royce (459), McLaren (353), Cadillac (306)
-- - Land Rover (295), Maserati (255), Dodge (191)
-- - Bugatti (23)

INSERT INTO source_registry (
  slug,
  display_name,
  category,
  status,
  extractor_function,
  fallback_method,
  requires_auth,
  cloudflare_protected,
  data_quality_score,
  is_ugly_source,
  quality_filters,
  discovery_url,
  discovery_method,
  discovery_frequency
) VALUES (
  'dupont-registry',
  'duPont Registry',
  'marketplace',
  'pending',  -- Ready for extractor development
  NULL,       -- No extractor yet
  'firecrawl',  -- Fallback to Firecrawl with browser UA
  false,
  true,       -- AWS WAF with CAPTCHA (but works with proper UA)
  0.90,       -- High quality: VIN, full specs, dealer info, good images
  false,
  '{
    "notes": "Luxury/exotic focus - Ferrari, Lamborghini, Bugatti, Rolls-Royce, etc.",
    "url_pattern": "/autos/listing/{year}/{make}/{model}/{id}",
    "data_location": "__NEXT_DATA__ -> props.pageProps.initialState.carState.response",
    "sitemap_urls": [
      "https://www.dupontregistry.com/listings-active1.xml",
      "https://www.dupontregistry.com/listings-active2.xml"
    ],
    "required_headers": {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    },
    "fields_available": [
      "id", "year", "vin", "mileage", "price",
      "carBrand.name", "carBrand.alias",
      "carModel.name", "carModel.alias",
      "description",
      "exteriorColor", "interiorColor",
      "carModification.transmission",
      "carModification.driveTrain",
      "carModification.bodyStyle",
      "carModification.engineDisplacement",
      "carModification.engineCylinder",
      "carModification.fuelType",
      "dealer.name", "dealer.id", "dealer.phone",
      "photos[].image.original"
    ]
  }'::jsonb,
  'https://www.dupontregistry.com/sitemap.xml',
  'sitemap',
  '1 hour'
)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  cloudflare_protected = EXCLUDED.cloudflare_protected,
  data_quality_score = EXCLUDED.data_quality_score,
  quality_filters = EXCLUDED.quality_filters,
  discovery_url = EXCLUDED.discovery_url,
  discovery_method = EXCLUDED.discovery_method,
  discovery_frequency = EXCLUDED.discovery_frequency,
  fallback_method = EXCLUDED.fallback_method,
  updated_at = now();

-- Log the addition
DO $$
BEGIN
  RAISE NOTICE 'Added duPont Registry to source_registry (status: pending)';
  RAISE NOTICE 'Estimated inventory: ~12,000 luxury/exotic vehicles';
  RAISE NOTICE 'Key brands: Ferrari, Lamborghini, Porsche, Bugatti, Rolls-Royce';
END $$;
