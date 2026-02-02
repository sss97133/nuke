/**
 * eBay Parts Discovery and Structure Learning System
 *
 * This is NOT just a parts extractor - it's a learning system that discovers:
 * 1. eBay category IDs and hierarchies for vehicle parts
 * 2. Common part names, item specifics, and fitment data structures
 * 3. Seller patterns (who sells quality parts for which makes)
 * 4. Price ranges and quality indicators (OEM vs aftermarket)
 *
 * The goal: Enable vehicles to autonomously find their own parts.
 *
 * Usage:
 *   POST /functions/v1/discover-ebay-parts
 *   Body: { "action": "discover_schema", "year": 2015, "make": "Porsche", "model": "911" }
 *   Body: { "action": "discover_parts", "year": 2015, "make": "Porsche", "model": "911", "part_type": "brake_pads" }
 *   Body: { "action": "match_vehicle", "vehicle_id": "uuid" }
 *   Body: { "action": "learn_categories", "make": "Porsche" }
 *   Body: { "action": "status" }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';

// eBay Motors category structure (discovered through exploration)
const EBAY_MOTORS_CATEGORIES = {
  root: '6000', // eBay Motors
  parts_accessories: '6028', // Parts & Accessories
  car_truck_parts: '6030', // Car & Truck Parts & Accessories
  // Sub-categories (will be dynamically discovered per make/model)
};

// Common part types we want to learn about
const PART_TYPES = [
  { slug: 'brake_pads', searchTerms: ['brake pads', 'brake pad set', 'front brake pads', 'rear brake pads'] },
  { slug: 'brake_rotors', searchTerms: ['brake rotor', 'brake disc', 'front rotor', 'rear rotor'] },
  { slug: 'alternator', searchTerms: ['alternator', 'generator'] },
  { slug: 'starter', searchTerms: ['starter', 'starter motor'] },
  { slug: 'water_pump', searchTerms: ['water pump', 'coolant pump'] },
  { slug: 'fuel_pump', searchTerms: ['fuel pump', 'fuel sending unit'] },
  { slug: 'air_filter', searchTerms: ['air filter', 'engine air filter', 'air cleaner'] },
  { slug: 'oil_filter', searchTerms: ['oil filter'] },
  { slug: 'spark_plugs', searchTerms: ['spark plug', 'spark plugs', 'ignition plug'] },
  { slug: 'ignition_coil', searchTerms: ['ignition coil', 'coil pack'] },
  { slug: 'radiator', searchTerms: ['radiator', 'cooling radiator'] },
  { slug: 'thermostat', searchTerms: ['thermostat', 'coolant thermostat'] },
  { slug: 'serpentine_belt', searchTerms: ['serpentine belt', 'drive belt', 'accessory belt'] },
  { slug: 'timing_belt', searchTerms: ['timing belt', 'timing belt kit'] },
  { slug: 'shock_absorber', searchTerms: ['shock absorber', 'strut', 'suspension strut'] },
  { slug: 'control_arm', searchTerms: ['control arm', 'a-arm', 'wishbone'] },
  { slug: 'tie_rod', searchTerms: ['tie rod', 'tie rod end', 'steering tie rod'] },
  { slug: 'ball_joint', searchTerms: ['ball joint'] },
  { slug: 'wheel_bearing', searchTerms: ['wheel bearing', 'hub bearing', 'wheel hub'] },
  { slug: 'cv_axle', searchTerms: ['cv axle', 'drive axle', 'cv shaft'] },
  { slug: 'clutch_kit', searchTerms: ['clutch kit', 'clutch disc', 'clutch pressure plate'] },
  { slug: 'headlight', searchTerms: ['headlight', 'headlamp', 'head light assembly'] },
  { slug: 'tail_light', searchTerms: ['tail light', 'taillight', 'tail lamp'] },
  { slug: 'side_mirror', searchTerms: ['side mirror', 'door mirror', 'wing mirror'] },
  { slug: 'door_handle', searchTerms: ['door handle', 'exterior door handle', 'interior door handle'] },
  { slug: 'window_regulator', searchTerms: ['window regulator', 'window motor'] },
  { slug: 'exhaust_manifold', searchTerms: ['exhaust manifold', 'header', 'exhaust header'] },
  { slug: 'catalytic_converter', searchTerms: ['catalytic converter', 'cat converter'] },
  { slug: 'muffler', searchTerms: ['muffler', 'exhaust muffler', 'rear muffler'] },
  { slug: 'oxygen_sensor', searchTerms: ['oxygen sensor', 'o2 sensor', 'lambda sensor'] },
  { slug: 'mass_air_flow', searchTerms: ['mass air flow', 'maf sensor', 'air flow meter'] },
  { slug: 'throttle_body', searchTerms: ['throttle body'] },
  { slug: 'intake_manifold', searchTerms: ['intake manifold'] },
];

// Quality indicators to look for in listings
const QUALITY_INDICATORS = {
  oem: ['oem', 'genuine', 'original', 'factory', 'dealer'],
  premium_aftermarket: ['bosch', 'brembo', 'bilstein', 'koni', 'eibach', 'ngk', 'denso', 'gates', 'acdelco', 'moog', 'monroe', 'kyb'],
  budget_aftermarket: ['compatible', 'replacement', 'fits', 'aftermarket'],
};

// Mileage-based maintenance suggestions
const MAINTENANCE_BY_MILEAGE = [
  { minMiles: 0, maxMiles: 30000, parts: ['air_filter', 'oil_filter', 'spark_plugs'], reason: 'routine_maintenance' },
  { minMiles: 30000, maxMiles: 60000, parts: ['brake_pads', 'serpentine_belt', 'cabin_filter'], reason: 'wear_items' },
  { minMiles: 60000, maxMiles: 90000, parts: ['timing_belt', 'water_pump', 'brake_rotors', 'spark_plugs'], reason: 'scheduled_service' },
  { minMiles: 90000, maxMiles: 120000, parts: ['shock_absorber', 'control_arm', 'tie_rod', 'ball_joint', 'cv_axle'], reason: 'suspension_wear' },
  { minMiles: 120000, maxMiles: 150000, parts: ['alternator', 'starter', 'fuel_pump', 'clutch_kit', 'radiator'], reason: 'high_mileage' },
  { minMiles: 150000, maxMiles: 999999, parts: ['wheel_bearing', 'catalytic_converter', 'thermostat'], reason: 'preventive' },
];

// Common failure patterns by make
const COMMON_FAILURES: Record<string, string[]> = {
  'Porsche': ['water_pump', 'ims_bearing', 'coolant_pipes', 'air_oil_separator'],
  'Ferrari': ['clutch_kit', 'timing_belt', 'water_pump', 'alternator', 'brake_pads'],
  'BMW': ['water_pump', 'thermostat', 'vanos_solenoid', 'valve_cover_gasket'],
  'Mercedes-Benz': ['air_suspension', 'mass_air_flow', 'crankshaft_position_sensor'],
  'Jaguar': ['water_pump', 'thermostat', 'ignition_coil', 'alternator', 'cooling_system'],
  'Audi': ['timing_chain_tensioner', 'water_pump', 'thermostat', 'ignition_coil'],
  'Volkswagen': ['water_pump', 'timing_chain_tensioner', 'ignition_coil'],
  'Chevrolet': ['intake_manifold_gasket', 'fuel_pump', 'wheel_bearing'],
  'Ford': ['spark_plugs', 'ignition_coil', 'thermostat', 'water_pump'],
  'Toyota': ['water_pump', 'starter', 'oxygen_sensor'], // Generally reliable, these are common maintenance items
  'Land Rover': ['water_pump', 'alternator', 'wheel_bearing', 'cv_axle', 'air_suspension'],
  'Honda': ['vtec_solenoid', 'starter', 'distributor'],
  'Subaru': ['head_gasket', 'wheel_bearing', 'cv_axle'],
};

interface DiscoverRequest {
  action: 'discover_schema' | 'discover_parts' | 'match_vehicle' | 'learn_categories' | 'status' | 'search_parts' | 'seed_catalog' | 'generate_ebay_url';
  year?: number;
  make?: string;
  model?: string;
  part_type?: string;
  vehicle_id?: string;
  limit?: number;
}

interface EbayListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  condition: string;
  seller: {
    username: string;
    feedbackScore: number;
    feedbackPercentage: number;
  };
  shipping?: {
    cost: number;
    type: string;
  };
  imageUrl?: string;
  itemUrl: string;
  categoryId?: string;
  categoryPath?: string[];
  itemSpecifics?: Record<string, string>;
  fitment?: {
    years?: number[];
    makes?: string[];
    models?: string[];
  };
  quality?: {
    isOem: boolean;
    brand?: string;
    qualityTier: 'oem' | 'premium_aftermarket' | 'budget_aftermarket' | 'unknown';
  };
}

interface PartsCatalogEntry {
  part_type: string;
  part_name: string;
  ebay_category_id: string | null;
  ebay_search_terms: string[];
  compatible_years_start: number | null;
  compatible_years_end: number | null;
  compatible_makes: string[];
  compatible_models: string[];
  avg_price_low: number | null;
  avg_price_high: number | null;
  oem_available: boolean;
  aftermarket_available: boolean;
  discovered_sellers: string[];
  sample_listings: any[];
  discovery_metadata: any;
}

// Build eBay search URL for parts
function buildEbaySearchUrl(params: {
  query: string;
  year?: number;
  make?: string;
  model?: string;
  categoryId?: string;
}): string {
  const { query, year, make, model, categoryId } = params;

  // Build fitment-aware search query
  let searchQuery = query;
  if (year && make && model) {
    searchQuery = `${year} ${make} ${model} ${query}`;
  } else if (make && model) {
    searchQuery = `${make} ${model} ${query}`;
  } else if (make) {
    searchQuery = `${make} ${query}`;
  }

  const encodedQuery = encodeURIComponent(searchQuery);

  // eBay Motors Parts & Accessories category
  const catId = categoryId || EBAY_MOTORS_CATEGORIES.car_truck_parts;

  // Build URL with fitment compatibility filter when possible
  let url = `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&_sacat=${catId}&_sop=15&LH_BIN=1`;

  // Add fitment filter if we have year/make/model
  if (year && make && model) {
    // eBay uses specific aspect filters for vehicle fitment
    url += `&Vehicle=${encodeURIComponent(`${year} ${make} ${model}`)}`;
  }

  return url;
}

// Parse price from various formats
function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^0-9.]/g, '');
  const price = parseFloat(cleaned);
  return isNaN(price) ? null : price;
}

// Determine quality tier from listing title and details
function determineQuality(title: string, brand?: string): {
  isOem: boolean;
  qualityTier: 'oem' | 'premium_aftermarket' | 'budget_aftermarket' | 'unknown';
  detectedBrand?: string;
} {
  const titleLower = title.toLowerCase();
  const brandLower = (brand || '').toLowerCase();
  const combined = `${titleLower} ${brandLower}`;

  // Check for OEM
  for (const indicator of QUALITY_INDICATORS.oem) {
    if (combined.includes(indicator)) {
      return { isOem: true, qualityTier: 'oem', detectedBrand: brand };
    }
  }

  // Check for premium aftermarket brands
  for (const premiumBrand of QUALITY_INDICATORS.premium_aftermarket) {
    if (combined.includes(premiumBrand)) {
      return { isOem: false, qualityTier: 'premium_aftermarket', detectedBrand: premiumBrand };
    }
  }

  // Check for budget aftermarket indicators
  for (const indicator of QUALITY_INDICATORS.budget_aftermarket) {
    if (combined.includes(indicator)) {
      return { isOem: false, qualityTier: 'budget_aftermarket' };
    }
  }

  return { isOem: false, qualityTier: 'unknown' };
}

// Extract listings from eBay search results HTML
async function extractListingsFromHtml(html: string, markdown: string | null): Promise<EbayListing[]> {
  const listings: EbayListing[] = [];

  // Parse structured data from HTML if available
  // eBay embeds JSON-LD and structured data we can extract

  // Extract item cards from HTML
  // Look for common patterns in eBay listing cards
  const itemPatterns = [
    // Pattern for item IDs in URLs
    /\/itm\/([0-9]+)/g,
    // Pattern for prices
    /\$([0-9,]+\.[0-9]{2})/g,
  ];

  // Extract from markdown (more reliable for scraping)
  if (markdown) {
    // Find all listing links with prices
    const listingRegex = /\[([^\]]+)\]\((https:\/\/www\.ebay\.com\/itm\/[^\)]+)\)[^\$]*\$([0-9,]+(?:\.[0-9]{2})?)/g;
    let match;
    while ((match = listingRegex.exec(markdown)) !== null) {
      const [, title, url, priceStr] = match;
      const itemIdMatch = url.match(/\/itm\/(\d+)/);
      if (itemIdMatch) {
        const price = parsePrice(priceStr);
        const quality = determineQuality(title);

        listings.push({
          itemId: itemIdMatch[1],
          title: title.trim(),
          price: price || 0,
          currency: 'USD',
          condition: 'Unknown',
          seller: {
            username: 'unknown',
            feedbackScore: 0,
            feedbackPercentage: 0,
          },
          itemUrl: url,
          quality: {
            isOem: quality.isOem,
            qualityTier: quality.qualityTier,
            brand: quality.detectedBrand,
          },
        });
      }
    }
  }

  // Also try to extract from HTML patterns
  // Look for srp-results and s-item classes
  const itemBlockRegex = /<li[^>]*class="[^"]*s-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let blockMatch;
  while ((blockMatch = itemBlockRegex.exec(html)) !== null) {
    const block = blockMatch[1];

    // Extract item URL
    const urlMatch = block.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"]+)"/);
    if (!urlMatch) continue;

    const url = urlMatch[1];
    const itemIdMatch = url.match(/\/itm\/(\d+)/);
    if (!itemIdMatch) continue;

    // Skip if we already have this item
    if (listings.some((l) => l.itemId === itemIdMatch[1])) continue;

    // Extract title
    const titleMatch = block.match(/<span[^>]*role="heading"[^>]*>([^<]+)<\/span>/) ||
      block.match(/<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([^<]+)<\/h3>/);
    const title = titleMatch ? titleMatch[1].trim() : 'Unknown';

    // Extract price
    const priceMatch = block.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
    const price = priceMatch ? parsePrice(priceMatch[1]) : null;

    // Extract seller info if available
    const sellerMatch = block.match(/seller[^>]*>([^<]+)/i);
    const feedbackMatch = block.match(/\((\d+)\)/);

    const quality = determineQuality(title);

    listings.push({
      itemId: itemIdMatch[1],
      title,
      price: price || 0,
      currency: 'USD',
      condition: 'Unknown',
      seller: {
        username: sellerMatch ? sellerMatch[1].trim() : 'unknown',
        feedbackScore: feedbackMatch ? parseInt(feedbackMatch[1]) : 0,
        feedbackPercentage: 0,
      },
      itemUrl: url,
      quality: {
        isOem: quality.isOem,
        qualityTier: quality.qualityTier,
        brand: quality.detectedBrand,
      },
    });
  }

  return listings;
}

// Use AI to analyze listings and extract structured data
async function analyzeListingsWithAI(
  listings: EbayListing[],
  partType: string,
  vehicle: { year?: number; make?: string; model?: string },
  anthropicKey: string
): Promise<{
  avgPriceLow: number | null;
  avgPriceHigh: number | null;
  oemAvailable: boolean;
  aftermarketAvailable: boolean;
  topSellers: string[];
  fitmentPatterns: any;
  recommendations: string[];
}> {
  if (listings.length === 0) {
    return {
      avgPriceLow: null,
      avgPriceHigh: null,
      oemAvailable: false,
      aftermarketAvailable: false,
      topSellers: [],
      fitmentPatterns: {},
      recommendations: [],
    };
  }

  const vehicleStr = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  const prompt = `Analyze these eBay parts listings for ${partType} for a ${vehicleStr}:

${JSON.stringify(listings.slice(0, 20), null, 2)}

Extract:
1. Price range analysis (low, typical, high for this part type)
2. OEM vs aftermarket availability
3. Quality patterns (which brands appear most trustworthy?)
4. Seller patterns (any sellers specializing in this?)
5. Fitment notes (any compatibility concerns?)
6. Buying recommendations

Return JSON:
{
  "price_analysis": {
    "budget_range": [min, max],
    "typical_range": [min, max],
    "premium_range": [min, max]
  },
  "oem_available": boolean,
  "aftermarket_available": boolean,
  "top_brands": ["brand1", "brand2"],
  "trusted_sellers": ["seller1", "seller2"],
  "fitment_notes": "string",
  "buying_tips": ["tip1", "tip2"],
  "quality_recommendation": "oem|premium_aftermarket|budget_aftermarket"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const result = await response.json();
    const content = result.content?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        avgPriceLow: parsed.price_analysis?.typical_range?.[0] || null,
        avgPriceHigh: parsed.price_analysis?.typical_range?.[1] || null,
        oemAvailable: parsed.oem_available || false,
        aftermarketAvailable: parsed.aftermarket_available || false,
        topSellers: parsed.trusted_sellers || [],
        fitmentPatterns: {
          notes: parsed.fitment_notes,
          brands: parsed.top_brands,
        },
        recommendations: parsed.buying_tips || [],
      };
    }
  } catch (e: any) {
    console.error('AI analysis failed:', e.message);
  }

  // Fallback: basic analysis without AI
  const prices = listings.map((l) => l.price).filter((p) => p > 0);
  const sortedPrices = prices.sort((a, b) => a - b);

  return {
    avgPriceLow: sortedPrices.length > 0 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : null,
    avgPriceHigh: sortedPrices.length > 0 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : null,
    oemAvailable: listings.some((l) => l.quality?.isOem),
    aftermarketAvailable: listings.some((l) => !l.quality?.isOem),
    topSellers: [...new Set(listings.map((l) => l.seller.username).filter((s) => s !== 'unknown'))].slice(0, 5),
    fitmentPatterns: {},
    recommendations: [],
  };
}

// Discover parts for a specific vehicle
async function discoverPartsForVehicle(
  supabase: any,
  year: number,
  make: string,
  model: string,
  partType: string | null,
  anthropicKey: string
): Promise<PartsCatalogEntry[]> {
  const results: PartsCatalogEntry[] = [];

  // Determine which part types to search
  const partsToSearch = partType
    ? PART_TYPES.filter((p) => p.slug === partType)
    : PART_TYPES.slice(0, 10); // Limit initial discovery to 10 parts

  for (const part of partsToSearch) {
    console.log(`Discovering ${part.slug} for ${year} ${make} ${model}...`);

    const searchUrl = buildEbaySearchUrl({
      query: part.searchTerms[0],
      year,
      make,
      model,
    });

    try {
      // Use Firecrawl to get the search results
      const scrapeResult = await firecrawlScrape({
        url: searchUrl,
        formats: ['html', 'markdown'],
        waitFor: 2000,
        timeout: 30000,
      });

      if (!scrapeResult.success || !scrapeResult.data.html) {
        console.warn(`Failed to scrape eBay for ${part.slug}: ${scrapeResult.error}`);
        continue;
      }

      // Extract listings from the HTML
      const listings = await extractListingsFromHtml(
        scrapeResult.data.html,
        scrapeResult.data.markdown
      );

      console.log(`Found ${listings.length} listings for ${part.slug}`);

      // Analyze with AI
      const analysis = await analyzeListingsWithAI(
        listings,
        part.slug,
        { year, make, model },
        anthropicKey
      );

      // Build catalog entry
      const entry: PartsCatalogEntry = {
        part_type: part.slug,
        part_name: part.searchTerms[0],
        ebay_category_id: EBAY_MOTORS_CATEGORIES.car_truck_parts,
        ebay_search_terms: part.searchTerms,
        compatible_years_start: year - 3, // Estimate range
        compatible_years_end: year + 3,
        compatible_makes: [make],
        compatible_models: [model],
        avg_price_low: analysis.avgPriceLow,
        avg_price_high: analysis.avgPriceHigh,
        oem_available: analysis.oemAvailable,
        aftermarket_available: analysis.aftermarketAvailable,
        discovered_sellers: analysis.topSellers,
        sample_listings: listings.slice(0, 5).map((l) => ({
          itemId: l.itemId,
          title: l.title,
          price: l.price,
          seller: l.seller.username,
          url: l.itemUrl,
          quality: l.quality?.qualityTier,
        })),
        discovery_metadata: {
          discovered_at: new Date().toISOString(),
          search_url: searchUrl,
          total_listings_found: listings.length,
          ai_analysis: analysis,
        },
      };

      results.push(entry);

      // Store in database
      await supabase.from('ebay_parts_catalog').upsert(
        {
          id: crypto.randomUUID(),
          part_type: entry.part_type,
          part_name: entry.part_name,
          ebay_category_id: entry.ebay_category_id,
          ebay_search_terms: entry.ebay_search_terms,
          compatible_years: `[${entry.compatible_years_start},${entry.compatible_years_end}]`,
          compatible_makes: entry.compatible_makes,
          compatible_models: entry.compatible_models,
          avg_price_low: entry.avg_price_low,
          avg_price_high: entry.avg_price_high,
          oem_available: entry.oem_available,
          aftermarket_available: entry.aftermarket_available,
          discovered_sellers: entry.discovered_sellers,
          sample_listings: entry.sample_listings,
          discovery_metadata: entry.discovery_metadata,
        },
        {
          onConflict: 'part_type,compatible_makes,compatible_models',
        }
      );

      // Rate limiting - don't hammer eBay
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (e: any) {
      console.error(`Error discovering ${part.slug}:`, e.message);
    }
  }

  return results;
}

// Match a vehicle to suggested parts based on age, mileage, and known issues
async function matchVehicleToParts(
  supabase: any,
  vehicleId: string,
  anthropicKey: string
): Promise<any[]> {
  // Get vehicle details
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, mileage, vin')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    throw new Error(`Vehicle not found: ${vehicleId}`);
  }

  const suggestions: any[] = [];
  const mileage = vehicle.mileage || 0;
  const currentYear = new Date().getFullYear();
  const vehicleAge = currentYear - (vehicle.year || currentYear);

  // 1. Mileage-based suggestions
  for (const range of MAINTENANCE_BY_MILEAGE) {
    if (mileage >= range.minMiles && mileage < range.maxMiles) {
      for (const partType of range.parts) {
        suggestions.push({
          part_type: partType,
          reason: range.reason,
          priority: range.reason === 'routine_maintenance' ? 3 : range.reason === 'high_mileage' ? 1 : 2,
          source: 'mileage_based',
        });
      }
    }
  }

  // 2. Make-specific common failures
  const makeFailures = COMMON_FAILURES[vehicle.make] || [];
  for (const partType of makeFailures) {
    if (!suggestions.some((s) => s.part_type === partType)) {
      suggestions.push({
        part_type: partType,
        reason: 'common_failure',
        priority: 2,
        source: 'make_specific',
      });
    }
  }

  // 3. Age-based suggestions
  if (vehicleAge > 10) {
    const ageParts = ['radiator', 'water_pump', 'shock_absorber', 'control_arm'];
    for (const partType of ageParts) {
      if (!suggestions.some((s) => s.part_type === partType)) {
        suggestions.push({
          part_type: partType,
          reason: 'age_based',
          priority: 3,
          source: 'age_based',
        });
      }
    }
  }

  // 4. Look up parts in our catalog and add pricing
  const enrichedSuggestions = [];
  for (const suggestion of suggestions.slice(0, 10)) {
    // Find matching catalog entry
    const { data: catalogEntry } = await supabase
      .from('ebay_parts_catalog')
      .select('*')
      .eq('part_type', suggestion.part_type)
      .contains('compatible_makes', [vehicle.make])
      .limit(1)
      .single();

    const enriched = {
      ...suggestion,
      vehicle_id: vehicleId,
      catalog_entry: catalogEntry
        ? {
            avg_price_low: catalogEntry.avg_price_low,
            avg_price_high: catalogEntry.avg_price_high,
            oem_available: catalogEntry.oem_available,
            sample_listings: catalogEntry.sample_listings?.slice(0, 3),
          }
        : null,
    };

    enrichedSuggestions.push(enriched);

    // Store suggestion in database
    await supabase.from('vehicle_suggested_parts').upsert(
      {
        id: crypto.randomUUID(),
        vehicle_id: vehicleId,
        part_catalog_id: catalogEntry?.id || null,
        part_type: suggestion.part_type,
        reason: suggestion.reason,
        priority: suggestion.priority,
        best_price: catalogEntry?.avg_price_low,
        ebay_listing_ids: catalogEntry?.sample_listings?.map((l: any) => l.itemId) || [],
        last_checked_at: new Date().toISOString(),
      },
      {
        onConflict: 'vehicle_id,part_type',
      }
    );
  }

  return enrichedSuggestions;
}

// Learn eBay category structure for a make
async function learnCategories(
  supabase: any,
  make: string
): Promise<any> {
  console.log(`Learning eBay category structure for ${make}...`);

  // Search for different part categories to discover eBay's structure
  const categorySearches = [
    { query: `${make} brake parts`, expectedCategory: 'Brakes & Brake Parts' },
    { query: `${make} engine parts`, expectedCategory: 'Engine & Engine Parts' },
    { query: `${make} suspension parts`, expectedCategory: 'Suspension & Steering' },
    { query: `${make} electrical parts`, expectedCategory: 'Electrical & Ignition' },
    { query: `${make} exterior parts`, expectedCategory: 'Exterior' },
    { query: `${make} interior parts`, expectedCategory: 'Interior' },
  ];

  const discoveredCategories: any[] = [];

  for (const search of categorySearches.slice(0, 3)) {
    const searchUrl = buildEbaySearchUrl({ query: search.query });

    try {
      const scrapeResult = await firecrawlScrape({
        url: searchUrl,
        formats: ['html', 'markdown'],
        waitFor: 2000,
      });

      if (scrapeResult.success && scrapeResult.data.html) {
        // Extract category refinements from the page
        const categoryMatch = scrapeResult.data.html.match(
          /<span[^>]*class="[^"]*x-refine__select__svg[^"]*"[^>]*>([^<]+)<\/span>/g
        );

        if (categoryMatch) {
          discoveredCategories.push({
            search: search.query,
            expected: search.expectedCategory,
            found: categoryMatch.map((m: string) => m.replace(/<[^>]+>/g, '').trim()),
          });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (e: any) {
      console.error(`Category discovery error for ${search.query}:`, e.message);
    }
  }

  // Store category mappings
  await supabase.from('ebay_category_mappings').upsert(
    {
      make,
      categories: discoveredCategories,
      discovered_at: new Date().toISOString(),
    },
    {
      onConflict: 'make',
    }
  );

  return {
    make,
    categories: discoveredCategories,
  };
}

// Pre-seeded parts data for common makes (research-based pricing from 2024-2026)
// This allows the system to work without live eBay scraping
const SEEDED_PARTS_DATA: Record<string, Record<string, { avgLow: number; avgHigh: number; oem: boolean; brands: string[] }>> = {
  'Porsche': {
    'brake_pads': { avgLow: 150, avgHigh: 450, oem: true, brands: ['Genuine Porsche', 'Brembo', 'Pagid', 'Hawk'] },
    'brake_rotors': { avgLow: 200, avgHigh: 800, oem: true, brands: ['Genuine Porsche', 'Brembo', 'Zimmermann'] },
    'water_pump': { avgLow: 250, avgHigh: 650, oem: true, brands: ['Genuine Porsche', 'Graf', 'Pierburg'] },
    'alternator': { avgLow: 350, avgHigh: 900, oem: true, brands: ['Genuine Porsche', 'Bosch', 'Valeo'] },
    'spark_plugs': { avgLow: 15, avgHigh: 45, oem: true, brands: ['NGK', 'Bosch', 'Genuine Porsche'] },
    'ignition_coil': { avgLow: 80, avgHigh: 200, oem: true, brands: ['Genuine Porsche', 'Bosch', 'Beru'] },
    'air_filter': { avgLow: 35, avgHigh: 120, oem: true, brands: ['Genuine Porsche', 'K&N', 'Mann'] },
    'shock_absorber': { avgLow: 300, avgHigh: 1200, oem: true, brands: ['Bilstein', 'KW', 'Genuine Porsche', 'Koni'] },
    'control_arm': { avgLow: 200, avgHigh: 600, oem: true, brands: ['Genuine Porsche', 'Lemforder', 'Meyle'] },
    'wheel_bearing': { avgLow: 150, avgHigh: 400, oem: true, brands: ['SKF', 'FAG', 'Genuine Porsche'] },
  },
  'Ferrari': {
    'brake_pads': { avgLow: 300, avgHigh: 1200, oem: true, brands: ['Genuine Ferrari', 'Brembo', 'Pagid Racing', 'Ferodo'] },
    'brake_rotors': { avgLow: 500, avgHigh: 2500, oem: true, brands: ['Genuine Ferrari', 'Brembo', 'Carbon Ceramic'] },
    'water_pump': { avgLow: 400, avgHigh: 1200, oem: true, brands: ['Genuine Ferrari', 'Graf', 'SKF'] },
    'alternator': { avgLow: 600, avgHigh: 1800, oem: true, brands: ['Genuine Ferrari', 'Bosch', 'Magneti Marelli'] },
    'spark_plugs': { avgLow: 25, avgHigh: 80, oem: true, brands: ['NGK Racing', 'Champion', 'Genuine Ferrari'] },
    'ignition_coil': { avgLow: 150, avgHigh: 450, oem: true, brands: ['Genuine Ferrari', 'Magneti Marelli', 'Bosch'] },
    'air_filter': { avgLow: 80, avgHigh: 300, oem: true, brands: ['Genuine Ferrari', 'K&N', 'BMC'] },
    'shock_absorber': { avgLow: 800, avgHigh: 3500, oem: true, brands: ['Bilstein', 'Koni', 'Genuine Ferrari', 'Ohlins'] },
    'clutch_kit': { avgLow: 1500, avgHigh: 5000, oem: true, brands: ['Genuine Ferrari', 'Sachs', 'Valeo'] },
    'timing_belt': { avgLow: 200, avgHigh: 600, oem: true, brands: ['Gates', 'Continental', 'Genuine Ferrari'] },
  },
  'BMW': {
    'brake_pads': { avgLow: 80, avgHigh: 300, oem: true, brands: ['Genuine BMW', 'Brembo', 'EBC', 'Akebono'] },
    'brake_rotors': { avgLow: 100, avgHigh: 400, oem: true, brands: ['Genuine BMW', 'Zimmermann', 'Brembo'] },
    'water_pump': { avgLow: 150, avgHigh: 450, oem: true, brands: ['Genuine BMW', 'Graf', 'Pierburg'] },
    'thermostat': { avgLow: 50, avgHigh: 150, oem: true, brands: ['Genuine BMW', 'Wahler', 'Mahle'] },
    'alternator': { avgLow: 200, avgHigh: 600, oem: true, brands: ['Genuine BMW', 'Bosch', 'Valeo'] },
    'spark_plugs': { avgLow: 10, avgHigh: 30, oem: true, brands: ['NGK', 'Bosch', 'Genuine BMW'] },
    'ignition_coil': { avgLow: 40, avgHigh: 120, oem: true, brands: ['Genuine BMW', 'Bosch', 'Delphi'] },
    'shock_absorber': { avgLow: 150, avgHigh: 500, oem: true, brands: ['Bilstein', 'Sachs', 'Genuine BMW'] },
    'control_arm': { avgLow: 100, avgHigh: 350, oem: true, brands: ['Lemforder', 'Meyle', 'Genuine BMW'] },
    'valve_cover_gasket': { avgLow: 30, avgHigh: 100, oem: true, brands: ['Genuine BMW', 'Elring', 'Victor Reinz'] },
  },
  'Jaguar': {
    'brake_pads': { avgLow: 100, avgHigh: 400, oem: true, brands: ['Genuine Jaguar', 'Brembo', 'EBC', 'Mintex'] },
    'brake_rotors': { avgLow: 150, avgHigh: 600, oem: true, brands: ['Genuine Jaguar', 'Brembo', 'DBA'] },
    'water_pump': { avgLow: 200, avgHigh: 550, oem: true, brands: ['Genuine Jaguar', 'Gates', 'SKF'] },
    'alternator': { avgLow: 300, avgHigh: 900, oem: true, brands: ['Genuine Jaguar', 'Bosch', 'Denso'] },
    'spark_plugs': { avgLow: 15, avgHigh: 45, oem: true, brands: ['NGK', 'Denso', 'Genuine Jaguar'] },
    'ignition_coil': { avgLow: 60, avgHigh: 180, oem: true, brands: ['Genuine Jaguar', 'Bosch', 'Delphi'] },
    'air_filter': { avgLow: 40, avgHigh: 120, oem: true, brands: ['Genuine Jaguar', 'K&N', 'Mann'] },
    'shock_absorber': { avgLow: 250, avgHigh: 900, oem: true, brands: ['Bilstein', 'Monroe', 'Genuine Jaguar'] },
    'control_arm': { avgLow: 180, avgHigh: 500, oem: true, brands: ['Genuine Jaguar', 'Lemforder', 'Moog'] },
    'thermostat': { avgLow: 50, avgHigh: 180, oem: true, brands: ['Genuine Jaguar', 'Wahler', 'Gates'] },
  },
  'Chevrolet': {
    'brake_pads': { avgLow: 40, avgHigh: 150, oem: true, brands: ['AC Delco', 'Bosch', 'Wagner'] },
    'brake_rotors': { avgLow: 50, avgHigh: 200, oem: true, brands: ['AC Delco', 'Brembo', 'Raybestos'] },
    'alternator': { avgLow: 100, avgHigh: 350, oem: true, brands: ['AC Delco', 'Denso', 'Bosch'] },
    'starter': { avgLow: 80, avgHigh: 250, oem: true, brands: ['AC Delco', 'Denso', 'Bosch'] },
    'water_pump': { avgLow: 60, avgHigh: 200, oem: true, brands: ['AC Delco', 'Gates', 'Airtex'] },
    'fuel_pump': { avgLow: 100, avgHigh: 350, oem: true, brands: ['AC Delco', 'Delphi', 'Airtex'] },
    'spark_plugs': { avgLow: 5, avgHigh: 20, oem: true, brands: ['AC Delco', 'NGK', 'Autolite'] },
    'ignition_coil': { avgLow: 30, avgHigh: 100, oem: true, brands: ['AC Delco', 'Delphi', 'Denso'] },
    'wheel_bearing': { avgLow: 50, avgHigh: 180, oem: true, brands: ['AC Delco', 'Timken', 'Moog'] },
    'tie_rod': { avgLow: 30, avgHigh: 100, oem: true, brands: ['Moog', 'AC Delco', 'Dorman'] },
  },
  'Ford': {
    'brake_pads': { avgLow: 40, avgHigh: 180, oem: true, brands: ['Motorcraft', 'Brembo', 'Wagner', 'Hawk'] },
    'brake_rotors': { avgLow: 60, avgHigh: 250, oem: true, brands: ['Motorcraft', 'Brembo', 'StopTech'] },
    'alternator': { avgLow: 120, avgHigh: 400, oem: true, brands: ['Motorcraft', 'Bosch', 'Denso'] },
    'starter': { avgLow: 100, avgHigh: 300, oem: true, brands: ['Motorcraft', 'Bosch', 'Denso'] },
    'water_pump': { avgLow: 60, avgHigh: 220, oem: true, brands: ['Motorcraft', 'Gates', 'Airtex'] },
    'fuel_pump': { avgLow: 100, avgHigh: 400, oem: true, brands: ['Motorcraft', 'Delphi', 'Airtex'] },
    'spark_plugs': { avgLow: 8, avgHigh: 25, oem: true, brands: ['Motorcraft', 'NGK', 'Autolite'] },
    'ignition_coil': { avgLow: 35, avgHigh: 120, oem: true, brands: ['Motorcraft', 'Delphi', 'Denso'] },
    'shock_absorber': { avgLow: 80, avgHigh: 350, oem: true, brands: ['Bilstein', 'Monroe', 'KYB'] },
    'clutch_kit': { avgLow: 200, avgHigh: 800, oem: true, brands: ['Motorcraft', 'Exedy', 'LuK'] },
  },
  'Land Rover': {
    'brake_pads': { avgLow: 100, avgHigh: 350, oem: true, brands: ['Genuine Land Rover', 'EBC', 'Brembo', 'Mintex'] },
    'brake_rotors': { avgLow: 150, avgHigh: 500, oem: true, brands: ['Genuine Land Rover', 'Brembo', 'DBA'] },
    'water_pump': { avgLow: 180, avgHigh: 500, oem: true, brands: ['Genuine Land Rover', 'Gates', 'SKF'] },
    'alternator': { avgLow: 250, avgHigh: 700, oem: true, brands: ['Genuine Land Rover', 'Bosch', 'Denso'] },
    'spark_plugs': { avgLow: 12, avgHigh: 40, oem: true, brands: ['NGK', 'Denso', 'Genuine Land Rover'] },
    'air_filter': { avgLow: 35, avgHigh: 120, oem: true, brands: ['Genuine Land Rover', 'K&N', 'Mann'] },
    'shock_absorber': { avgLow: 200, avgHigh: 800, oem: true, brands: ['Bilstein', 'Old Man Emu', 'Genuine Land Rover', 'Terrafirma'] },
    'control_arm': { avgLow: 150, avgHigh: 450, oem: true, brands: ['Genuine Land Rover', 'Lemforder', 'Moog'] },
    'wheel_bearing': { avgLow: 100, avgHigh: 350, oem: true, brands: ['Timken', 'SKF', 'Genuine Land Rover'] },
    'cv_axle': { avgLow: 150, avgHigh: 500, oem: true, brands: ['Genuine Land Rover', 'GKN', 'TRW'] },
  },
  'Toyota': {
    'brake_pads': { avgLow: 50, avgHigh: 180, oem: true, brands: ['Genuine Toyota', 'Brembo', 'Akebono', 'Centric'] },
    'brake_rotors': { avgLow: 60, avgHigh: 250, oem: true, brands: ['Genuine Toyota', 'Brembo', 'DBA'] },
    'water_pump': { avgLow: 80, avgHigh: 280, oem: true, brands: ['Genuine Toyota', 'Aisin', 'Gates'] },
    'alternator': { avgLow: 150, avgHigh: 500, oem: true, brands: ['Genuine Toyota', 'Denso', 'Bosch'] },
    'starter': { avgLow: 120, avgHigh: 400, oem: true, brands: ['Genuine Toyota', 'Denso', 'Bosch'] },
    'spark_plugs': { avgLow: 8, avgHigh: 30, oem: true, brands: ['Denso', 'NGK', 'Genuine Toyota'] },
    'air_filter': { avgLow: 25, avgHigh: 80, oem: true, brands: ['Genuine Toyota', 'K&N', 'Mann'] },
    'shock_absorber': { avgLow: 100, avgHigh: 450, oem: true, brands: ['Bilstein', 'Old Man Emu', 'KYB', 'Genuine Toyota'] },
    'wheel_bearing': { avgLow: 60, avgHigh: 220, oem: true, brands: ['Koyo', 'Timken', 'Genuine Toyota'] },
    'fuel_pump': { avgLow: 120, avgHigh: 400, oem: true, brands: ['Genuine Toyota', 'Denso', 'Airtex'] },
  },
  'Mercedes-Benz': {
    'brake_pads': { avgLow: 100, avgHigh: 350, oem: true, brands: ['Genuine Mercedes', 'Brembo', 'Pagid'] },
    'brake_rotors': { avgLow: 150, avgHigh: 500, oem: true, brands: ['Genuine Mercedes', 'Zimmermann', 'Brembo'] },
    'alternator': { avgLow: 300, avgHigh: 800, oem: true, brands: ['Genuine Mercedes', 'Bosch', 'Valeo'] },
    'air_filter': { avgLow: 30, avgHigh: 100, oem: true, brands: ['Genuine Mercedes', 'Mann', 'Mahle'] },
    'spark_plugs': { avgLow: 15, avgHigh: 40, oem: true, brands: ['NGK', 'Bosch', 'Genuine Mercedes'] },
    'mass_air_flow': { avgLow: 100, avgHigh: 400, oem: true, brands: ['Genuine Mercedes', 'Bosch', 'Pierburg'] },
    'shock_absorber': { avgLow: 200, avgHigh: 700, oem: true, brands: ['Bilstein', 'Sachs', 'Genuine Mercedes'] },
    'control_arm': { avgLow: 150, avgHigh: 450, oem: true, brands: ['Lemforder', 'Meyle', 'Genuine Mercedes'] },
    'thermostat': { avgLow: 60, avgHigh: 180, oem: true, brands: ['Genuine Mercedes', 'Wahler', 'Mahle'] },
    'oxygen_sensor': { avgLow: 80, avgHigh: 250, oem: true, brands: ['Bosch', 'Denso', 'Genuine Mercedes'] },
  },
};

// Seed the catalog with pre-researched data
async function seedCatalog(supabase: any, make?: string): Promise<any> {
  const makesToSeed = make ? [make] : Object.keys(SEEDED_PARTS_DATA);
  const seeded: any[] = [];

  for (const seedMake of makesToSeed) {
    const partsData = SEEDED_PARTS_DATA[seedMake];
    if (!partsData) continue;

    for (const [partType, data] of Object.entries(partsData)) {
      const partConfig = PART_TYPES.find((p) => p.slug === partType);
      if (!partConfig) continue;

      const entry = {
        id: crypto.randomUUID(),
        part_type: partType,
        part_name: partConfig.searchTerms[0],
        ebay_category_id: EBAY_MOTORS_CATEGORIES.car_truck_parts,
        ebay_search_terms: partConfig.searchTerms,
        compatible_years: '[1990,2030)',
        compatible_makes: [seedMake],
        compatible_models: [], // Applies to all models
        avg_price_low: data.avgLow,
        avg_price_high: data.avgHigh,
        oem_available: data.oem,
        aftermarket_available: true,
        discovered_sellers: [],
        sample_listings: [],
        discovery_metadata: {
          source: 'seed_data',
          brands: data.brands,
          seeded_at: new Date().toISOString(),
        },
      };

      const { error } = await supabase.from('ebay_parts_catalog').upsert(entry, {
        onConflict: 'part_type,compatible_makes,compatible_models',
      });

      if (!error) {
        seeded.push({ make: seedMake, part_type: partType, price_range: `$${data.avgLow}-$${data.avgHigh}` });
      }
    }
  }

  return {
    success: true,
    seeded_count: seeded.length,
    makes: makesToSeed,
    parts: seeded,
  };
}

// Get discovery status
async function getDiscoveryStatus(supabase: any): Promise<any> {
  const { count: catalogCount } = await supabase
    .from('ebay_parts_catalog')
    .select('*', { count: 'exact', head: true });

  const { count: suggestionsCount } = await supabase
    .from('vehicle_suggested_parts')
    .select('*', { count: 'exact', head: true });

  const { data: recentDiscoveries } = await supabase
    .from('ebay_parts_catalog')
    .select('part_type, compatible_makes, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: makesCovered } = await supabase
    .from('ebay_parts_catalog')
    .select('compatible_makes');

  const uniqueMakes = new Set<string>();
  for (const row of makesCovered || []) {
    for (const make of row.compatible_makes || []) {
      uniqueMakes.add(make);
    }
  }

  return {
    catalog_entries: catalogCount || 0,
    vehicle_suggestions: suggestionsCount || 0,
    makes_covered: [...uniqueMakes],
    part_types_covered: PART_TYPES.length,
    recent_discoveries: recentDiscoveries || [],
    available_actions: [
      'discover_schema - Discover eBay structure for a vehicle',
      'discover_parts - Find specific parts for a vehicle',
      'match_vehicle - Generate part suggestions for a vehicle',
      'learn_categories - Learn eBay category structure for a make',
      'search_parts - Search for specific parts',
    ],
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const body: DiscoverRequest = await req.json().catch(() => ({ action: 'status' }));
    const { action, year, make, model, part_type, vehicle_id, limit } = body;

    console.log(`eBay Parts Discovery: action=${action}, year=${year}, make=${make}, model=${model}`);

    switch (action) {
      case 'status': {
        const status = await getDiscoveryStatus(supabase);
        return new Response(JSON.stringify({ success: true, status }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'discover_schema':
      case 'discover_parts': {
        if (!year || !make || !model) {
          return new Response(
            JSON.stringify({ error: 'year, make, and model are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const results = await discoverPartsForVehicle(
          supabase,
          year,
          make,
          model,
          part_type || null,
          anthropicKey
        );

        return new Response(
          JSON.stringify({
            success: true,
            vehicle: { year, make, model },
            parts_discovered: results.length,
            parts: results,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'match_vehicle': {
        if (!vehicle_id) {
          return new Response(
            JSON.stringify({ error: 'vehicle_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const suggestions = await matchVehicleToParts(supabase, vehicle_id, anthropicKey);

        return new Response(
          JSON.stringify({
            success: true,
            vehicle_id,
            suggestions_count: suggestions.length,
            suggestions,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'learn_categories': {
        if (!make) {
          return new Response(
            JSON.stringify({ error: 'make is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const categories = await learnCategories(supabase, make);

        return new Response(
          JSON.stringify({
            success: true,
            categories,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'search_parts': {
        if (!make || !part_type) {
          return new Response(
            JSON.stringify({ error: 'make and part_type are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const partConfig = PART_TYPES.find((p) => p.slug === part_type);
        if (!partConfig) {
          return new Response(
            JSON.stringify({ error: `Unknown part_type: ${part_type}`, available: PART_TYPES.map((p) => p.slug) }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const searchUrl = buildEbaySearchUrl({
          query: partConfig.searchTerms[0],
          year,
          make,
          model,
        });

        const scrapeResult = await firecrawlScrape({
          url: searchUrl,
          formats: ['html', 'markdown'],
          waitFor: 2000,
        });

        if (!scrapeResult.success) {
          return new Response(
            JSON.stringify({ error: 'Failed to search eBay', details: scrapeResult.error }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const listings = await extractListingsFromHtml(
          scrapeResult.data.html || '',
          scrapeResult.data.markdown
        );

        const analysis = await analyzeListingsWithAI(
          listings,
          part_type,
          { year, make, model },
          anthropicKey
        );

        return new Response(
          JSON.stringify({
            success: true,
            search: { year, make, model, part_type },
            search_url: searchUrl,
            listings_found: listings.length,
            listings: listings.slice(0, limit || 20),
            analysis,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'seed_catalog': {
        // Seed the catalog with pre-researched parts data
        // This allows the system to work without live eBay scraping
        const seedResult = await seedCatalog(supabase, make);
        return new Response(
          JSON.stringify(seedResult),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'generate_ebay_url': {
        // Generate eBay search URLs for a vehicle's suggested parts
        // Useful for manual searches or integration with other tools
        if (!vehicle_id && !make) {
          return new Response(
            JSON.stringify({ error: 'vehicle_id or make is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let vehicleData: any = { make, model, year };
        if (vehicle_id) {
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('year, make, model, mileage')
            .eq('id', vehicle_id)
            .single();
          if (vehicle) vehicleData = vehicle;
        }

        const urls: any[] = [];
        const partsToSearch = part_type
          ? PART_TYPES.filter((p) => p.slug === part_type)
          : PART_TYPES.slice(0, 10);

        for (const part of partsToSearch) {
          urls.push({
            part_type: part.slug,
            part_name: part.searchTerms[0],
            ebay_url: buildEbaySearchUrl({
              query: part.searchTerms[0],
              year: vehicleData.year,
              make: vehicleData.make,
              model: vehicleData.model,
            }),
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            vehicle: vehicleData,
            urls,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({
            error: `Unknown action: ${action}`,
            available_actions: ['status', 'discover_schema', 'discover_parts', 'match_vehicle', 'learn_categories', 'search_parts', 'seed_catalog', 'generate_ebay_url'],
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: any) {
    console.error('eBay Parts Discovery error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
