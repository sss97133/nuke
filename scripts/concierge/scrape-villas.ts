#!/usr/bin/env npx tsx
/**
 * St Barth Villa Inventory Scraper
 * Extracts individual villa listings from rental agencies
 *
 * Usage: npx tsx scripts/concierge/scrape-villas.ts [--agency=sibarth] [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';

const AGENCIES = {
  sibarth: {
    name: 'Sibarth Villa Rentals',
    baseUrl: 'https://sibarth.com',
    listUrl: 'https://sibarth.com/all-villas/',
  },
  elan: {
    name: 'Elan Villa Rental',
    baseUrl: 'https://www.elanvillarental.com',
    listUrl: 'https://www.elanvillarental.com/villas/',
  },
  myvillainstbarth: {
    name: 'My Villa in St-Barth',
    baseUrl: 'https://www.myvillainstbarth.com',
    listUrl: 'https://www.myvillainstbarth.com/villas/',
  },
  realstbarth: {
    name: 'Real St Barth',
    baseUrl: 'https://www.realstbarth.com',
    listUrl: 'https://www.realstbarth.com/en/villa-rental-st-barth/',
  },
  lebarthvillas: {
    name: 'Le Barth Villas',
    baseUrl: 'https://lebarthvillas.com',
    listUrl: 'https://lebarthvillas.com/villas/',
  },
  stbarthvillarental: {
    name: 'St Barth Villa Rental',
    baseUrl: 'https://stbarthvillarental.com',
    listUrl: 'https://stbarthvillarental.com/villas/',
  },
};

interface Villa {
  name: string;
  slug: string;
  location: string | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  price_low: number | null;
  price_high: number | null;
  price_currency: string;
  price_period: string;
  listing_type: 'rental' | 'sale';
  source_url: string;
  agency: string;
  agency_url: string;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

function parsePrice(priceStr: string): { low: number | null; high: number | null; currency: string } {
  const cleaned = priceStr.replace(/[,\s]/g, '');

  // Extract currency
  let currency = 'USD';
  if (cleaned.includes('€')) currency = 'EUR';
  else if (cleaned.includes('$')) currency = 'USD';

  // Extract numbers
  const numbers = cleaned.match(/[\d.]+/g)?.map(n => parseFloat(n)).filter(n => !isNaN(n) && n > 100) || [];

  if (numbers.length === 0) return { low: null, high: null, currency };
  if (numbers.length === 1) return { low: numbers[0], high: numbers[0], currency };
  return { low: Math.min(...numbers), high: Math.max(...numbers), currency };
}

function parseBedrooms(bedroomStr: string): { min: number | null; max: number | null } {
  const numbers = bedroomStr.match(/\d+/g)?.map(n => parseInt(n)).filter(n => !isNaN(n) && n < 20) || [];

  if (numbers.length === 0) return { min: null, max: null };
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

async function scrapeSibarth(): Promise<Villa[]> {
  const villas: Villa[] = [];
  const html = await fetchHtml('https://sibarth.com/all-villas/');

  // Sibarth uses a specific card structure
  // Look for villa cards with pattern: villa name, location, bedrooms, price
  const villaPattern = /class=".*?villa.*?"[^>]*>[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>[\s\S]*?(?:href="([^"]+)")?[\s\S]*?(?:(\d+)(?:\s*-\s*(\d+))?\s*bedroom)?[\s\S]*?(?:\$|€)([\d,]+)/gi;

  // Alternative: Parse structured data if available
  // Try JSON-LD first
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/g);
  if (jsonLdMatch) {
    for (const script of jsonLdMatch) {
      try {
        const json = JSON.parse(script.replace(/<[^>]+>/g, ''));
        if (json['@type'] === 'Product' || json['@type'] === 'Accommodation') {
          // Extract from structured data
          console.log('Found structured data');
        }
      } catch (e) {
        // Not valid JSON
      }
    }
  }

  // Parse villa cards from HTML
  // Pattern: <a href="/all-villas/villa-name/">...</a> with price and location
  const cardMatches = html.matchAll(/<a[^>]*href="(\/all-villas\/[^"]+)"[^>]*>[\s\S]*?<\/a>/gi);

  const seenSlugs = new Set<string>();

  // Simpler approach - find all villa links and details
  const villaLinks = html.matchAll(/href="(\/all-villas\/([^\/]+)\/?)"/gi);
  for (const match of villaLinks) {
    const url = match[1];
    const slug = match[2];
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    // Get surrounding context for this villa (500 chars around)
    const linkPos = html.indexOf(match[0]);
    const context = html.substring(Math.max(0, linkPos - 200), Math.min(html.length, linkPos + 800));

    // Extract name (usually in h3 or strong near the link)
    const nameMatch = context.match(/<(?:h[23]|strong)[^>]*>([A-Za-z][^<]{2,50})<\/(?:h[23]|strong)>/i);
    const name = nameMatch ? nameMatch[1].trim() : slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Extract location
    const locationMatch = context.match(/(?:location|area|quartier)[:\s]*([A-Za-z][^<,]{2,30})/i) ||
                         context.match(/<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)/i) ||
                         context.match(/(?:St\.?\s*Jean|Gustavia|Colombier|Flamands|Lorient|Marigot|Pointe Milou|Lurin|Toiny|Saline|Gouverneur|Grand Cul de Sac|Petit Cul de Sac|Grand Fond|Corossol|Vitet|Deve|Camaruche)/i);
    const location = locationMatch ? locationMatch[1]?.trim() || locationMatch[0] : null;

    // Extract bedrooms
    const bedroomMatch = context.match(/(\d+)(?:\s*-\s*(\d+))?\s*(?:bedroom|br|chambre)/i);
    const bedrooms = bedroomMatch ? parseBedrooms(bedroomMatch[0]) : { min: null, max: null };

    // Extract price
    const priceMatch = context.match(/(?:from\s*)?[\$€]([\d,]+)(?:\s*(?:-|to)\s*[\$€]?([\d,]+))?(?:\/week)?/i);
    const price = priceMatch ? parsePrice(priceMatch[0]) : { low: null, high: null, currency: 'USD' };

    // Determine if rental or sale
    const isSale = context.toLowerCase().includes('for sale') || context.includes('€') && price.low && price.low > 500000;

    villas.push({
      name,
      slug,
      location,
      bedrooms_min: bedrooms.min,
      bedrooms_max: bedrooms.max,
      price_low: price.low,
      price_high: price.high,
      price_currency: price.currency,
      price_period: isSale ? 'sale' : 'week',
      listing_type: isSale ? 'sale' : 'rental',
      source_url: `https://sibarth.com${url}`,
      agency: 'Sibarth Villa Rentals',
      agency_url: 'https://sibarth.com',
    });
  }

  return villas;
}

async function scrapeElan(): Promise<Villa[]> {
  const villas: Villa[] = [];
  const html = await fetchHtml('https://www.elanvillarental.com/villas/');

  const seenSlugs = new Set<string>();
  const villaLinks = html.matchAll(/href="(\/villas\/([^\/]+)\/?)"/gi);

  for (const match of villaLinks) {
    const url = match[1];
    const slug = match[2];
    if (seenSlugs.has(slug) || slug === '' || slug === 'villas') continue;
    seenSlugs.add(slug);

    const linkPos = html.indexOf(match[0]);
    const context = html.substring(Math.max(0, linkPos - 200), Math.min(html.length, linkPos + 800));

    // Name extraction
    const nameMatch = context.match(/<(?:h[234]|strong)[^>]*>([A-Za-z][^<]{2,50})<\/(?:h[234]|strong)>/i);
    const name = nameMatch ? nameMatch[1].trim() : slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Location
    const locationMatch = context.match(/(?:St\.?\s*Jean|Gustavia|Colombier|Flamands|Lorient|Marigot|Pointe Milou|Lurin|Toiny|Saline|Gouverneur|Grand Cul de Sac|Petit Cul de Sac|Grand Fond|Corossol|Vitet|Anse des Cayes|Cul de Sac)/i);
    const location = locationMatch ? locationMatch[0] : null;

    // Bedrooms
    const bedroomMatch = context.match(/(\d+)\s*(?:bedroom|br|chambre)/i);
    const bedrooms = bedroomMatch ? parseBedrooms(bedroomMatch[0]) : { min: null, max: null };

    // Price
    const priceMatch = context.match(/\$([\d,]+)(?:\s*-\s*\$?([\d,]+))?/i);
    const price = priceMatch ? parsePrice(priceMatch[0]) : { low: null, high: null, currency: 'USD' };

    villas.push({
      name,
      slug,
      location,
      bedrooms_min: bedrooms.min,
      bedrooms_max: bedrooms.max,
      price_low: price.low,
      price_high: price.high,
      price_currency: 'USD',
      price_period: 'week',
      listing_type: 'rental',
      source_url: `https://www.elanvillarental.com${url}`,
      agency: 'Elan Villa Rental',
      agency_url: 'https://www.elanvillarental.com',
    });
  }

  return villas;
}

async function scrapeGenericVillaPage(agency: typeof AGENCIES[keyof typeof AGENCIES]): Promise<Villa[]> {
  const villas: Villa[] = [];

  try {
    const html = await fetchHtml(agency.listUrl);
    const seenSlugs = new Set<string>();

    // Generic villa link patterns
    const patterns = [
      /href="([^"]*\/villas?\/([^\/?"]+)\/?)"/gi,
      /href="([^"]*\/villa-([^\/?"]+)\/?)"/gi,
      /href="([^"]*\/property\/([^\/?"]+)\/?)"/gi,
      /href="([^"]*\/listing\/([^\/?"]+)\/?)"/gi,
    ];

    for (const pattern of patterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        const url = match[1];
        const slug = match[2];

        if (seenSlugs.has(slug) || !slug || slug.length < 2) continue;
        seenSlugs.add(slug);

        const fullUrl = url.startsWith('http') ? url : `${agency.baseUrl}${url}`;
        const linkPos = html.indexOf(match[0]);
        const context = html.substring(Math.max(0, linkPos - 200), Math.min(html.length, linkPos + 800));

        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        const locationMatch = context.match(/(?:St\.?\s*Jean|Gustavia|Colombier|Flamands|Lorient|Marigot|Pointe Milou|Lurin|Toiny|Saline|Gouverneur|Grand Cul de Sac|Petit Cul de Sac|Grand Fond|Corossol|Vitet|Anse des Cayes|Cul de Sac)/i);

        villas.push({
          name,
          slug,
          location: locationMatch?.[0] || null,
          bedrooms_min: null,
          bedrooms_max: null,
          price_low: null,
          price_high: null,
          price_currency: 'USD',
          price_period: 'week',
          listing_type: 'rental',
          source_url: fullUrl,
          agency: agency.name,
          agency_url: agency.baseUrl,
        });
      }
    }
  } catch (err) {
    console.error(`Error scraping ${agency.name}:`, err);
  }

  return villas;
}

interface VillaInsert {
  business_name: string;
  business_type: string;
  industry_focus: string[];
  services_offered: string[];
  website: string | null;
  city: string | null;
  country: string;
  discovered_via: string;
  source_url: string;
  metadata: Record<string, any>;
  search_keywords: string[];
}

function toVillaInsert(villa: Villa): VillaInsert {
  return {
    business_name: `Villa ${villa.name}`,
    business_type: 'villa_rental',
    industry_focus: ['tourisme', 'accommodation'],
    services_offered: ['villa-rental', villa.listing_type],
    website: villa.source_url,
    city: villa.location,
    country: 'BL',
    discovered_via: villa.agency_url,
    source_url: villa.source_url,
    metadata: {
      project: 'lofficiel-concierge',
      entity_type: 'villa',
      villa_name: villa.name,
      villa_slug: villa.slug,
      bedrooms_min: villa.bedrooms_min,
      bedrooms_max: villa.bedrooms_max,
      price_low: villa.price_low,
      price_high: villa.price_high,
      price_currency: villa.price_currency,
      price_period: villa.price_period,
      listing_type: villa.listing_type,
      agency: villa.agency,
      scraped_at: new Date().toISOString(),
    },
    search_keywords: [
      villa.name.toLowerCase(),
      'villa',
      'rental',
      villa.location?.toLowerCase(),
      'st barth',
      'saint barth',
      'luxury',
      villa.agency.toLowerCase(),
    ].filter(Boolean) as string[],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const agencyArg = args.find(a => a.startsWith('--agency='));
  const targetAgency = agencyArg ? agencyArg.split('=')[1] : null;

  console.log('St Barth Villa Inventory Scraper');
  console.log('=================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Target: ${targetAgency || 'ALL AGENCIES'}`);
  console.log('');

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let allVillas: Villa[] = [];

  // Scrape Sibarth
  if (!targetAgency || targetAgency === 'sibarth') {
    console.log('[SIBARTH]');
    try {
      const villas = await scrapeSibarth();
      console.log(`  Found ${villas.length} villas`);
      allVillas.push(...villas);
    } catch (err) {
      console.error('  Error:', err);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Scrape Elan
  if (!targetAgency || targetAgency === 'elan') {
    console.log('[ELAN]');
    try {
      const villas = await scrapeElan();
      console.log(`  Found ${villas.length} villas`);
      allVillas.push(...villas);
    } catch (err) {
      console.error('  Error:', err);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Scrape other agencies
  const otherAgencies = ['myvillainstbarth', 'realstbarth', 'lebarthvillas', 'stbarthvillarental'];
  for (const agencyKey of otherAgencies) {
    if (targetAgency && targetAgency !== agencyKey) continue;

    const agency = AGENCIES[agencyKey as keyof typeof AGENCIES];
    console.log(`[${agency.name.toUpperCase()}]`);
    try {
      const villas = await scrapeGenericVillaPage(agency);
      console.log(`  Found ${villas.length} villas`);
      allVillas.push(...villas);
    } catch (err) {
      console.error('  Error:', err);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('');
  console.log('=================================');
  console.log(`Total villas found: ${allVillas.length}`);

  if (dryRun) {
    console.log('\nSample villas:');
    for (const villa of allVillas.slice(0, 10)) {
      console.log(`  - ${villa.name} (${villa.location || 'unknown'}) - ${villa.agency}`);
      if (villa.price_low) console.log(`    Price: $${villa.price_low}/week`);
    }
    return;
  }

  // Insert villas
  let inserted = 0;
  let skipped = 0;

  for (const villa of allVillas) {
    const insert = toVillaInsert(villa);

    // Check for duplicates by name + source
    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .eq('business_name', insert.business_name)
      .eq('discovered_via', insert.discovered_via)
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from('businesses').insert(insert);

    if (error) {
      console.error(`  Error inserting ${villa.name}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  console.log(`\nInserted: ${inserted}`);
  console.log(`Skipped (duplicates): ${skipped}`);
}

main().catch(console.error);
