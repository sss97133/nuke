#!/usr/bin/env npx tsx
/**
 * St Barth Directory Scraper
 * Scrapes https://www.directory-saintbarth.com and imports to businesses table
 *
 * Usage: npx tsx scripts/concierge/scrape-directory-stbarth.ts [--category=tourisme] [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://www.directory-saintbarth.com';

// All super-categories from the directory
const SUPER_CATEGORIES = [
  'administrations',
  'alimentation-boissons',
  'boutiques',
  'communication',
  'construction',
  'ecoles',
  'maison',
  'restaurants-soiree',
  'sante',
  'tourisme',
  'urgences',
  'vehicules'
];

interface ScrapedBusiness {
  name: string;
  location: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  email: string | null;
  fax: string | null;
  website: string | null;
  category: string;
  subcategory: string;
  superCategory: string;
  sourceUrl: string;
}

interface BusinessInsert {
  business_name: string;
  business_type: string;
  industry_focus: string[];
  services_offered: string[];
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string;
  discovered_via: string;
  source_url: string;
  metadata: Record<string, any>;
  search_keywords: string[];
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ConciergeBot/1.0)',
      'Accept': 'text/html',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.text();
}

async function getSubcategories(superCategory: string): Promise<{slug: string, name: string}[]> {
  const url = `${BASE_URL}/fr/super-category/${superCategory}`;
  const html = await fetchPage(url);

  const subcategories: {slug: string, name: string}[] = [];

  // Pattern: /fr/categorie/[slug]
  const regex = /href="\/fr\/categorie\/([^"]+)"[^>]*>([^<]*)</g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const slug = match[1].trim();
    const name = match[2].trim();
    if (slug && name && !subcategories.find(s => s.slug === slug)) {
      subcategories.push({ slug, name });
    }
  }

  return subcategories;
}

function extractField(html: string, label: string): string | null {
  // Look for patterns like: <strong>Téléphone</strong>...</div>...<a href="tel:...">VALUE</a>
  // Or plain text values
  const patterns = [
    new RegExp(`<strong>\\s*${label}[^<]*</strong>[\\s\\S]*?(?:<a[^>]*>([^<]+)</a>|<div[^>]*class="col-md-9"[^>]*>\\s*([^<]+)\\s*</div>)`, 'i'),
    new RegExp(`${label}[\\s\\S]{0,200}?<a[^>]*>([^<]+)</a>`, 'i'),
    new RegExp(`${label}[\\s\\S]{0,200}?<div[^>]*>\\s*([^<]+)\\s*</div>`, 'i')
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const value = (match[1] || match[2] || '').trim();
      if (value && value.length > 1 && !value.includes('<')) {
        return value;
      }
    }
  }
  return null;
}

async function scrapeCategory(superCategory: string, subcategorySlug: string, subcategoryName: string): Promise<ScrapedBusiness[]> {
  const url = `${BASE_URL}/fr/categorie/${subcategorySlug}`;
  const html = await fetchPage(url);

  const businesses: ScrapedBusiness[] = [];

  // Split by accordion items - each starts with id="flush-collapse{N}"
  const accordionParts = html.split(/id="flush-collapse\d+"/);

  for (let i = 1; i < accordionParts.length; i++) {
    const part = accordionParts[i];
    const prevPart = accordionParts[i - 1];

    // Get business name from the header (in previous part)
    const nameMatch = prevPart.match(/<div class="col-md-5">\s*([A-Z][^<]+?)\s*<\/div>/);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    if (!name || name.length < 2) continue;

    // Get location from header
    const locationMatch = prevPart.match(/<div class="col-md-2">\s*([^<]+?)\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/h2>/s);
    const location = locationMatch ? locationMatch[1].trim() : null;

    // Extract fields from accordion body
    const phone = extractField(part, 'Téléphone');
    const mobile = extractField(part, 'Portable');
    const address = extractField(part, 'Adresse');
    const email = extractField(part, 'Email');
    const fax = extractField(part, 'Fax');

    // Website - look for href with http
    const websiteMatch = part.match(/href="(https?:\/\/[^"]+)"[^>]*target="_blank"[^>]*>\s*(?:Site web|Voir le site|[^<]*http)/i) ||
                         part.match(/Site\s*web[\s\S]{0,100}?href="(https?:\/\/[^"]+)"/i);
    const website = websiteMatch ? websiteMatch[1] : null;

    businesses.push({
      name,
      location,
      phone,
      mobile,
      address,
      email,
      fax,
      website,
      category: subcategoryName,
      subcategory: subcategorySlug,
      superCategory,
      sourceUrl: url
    });
  }

  return businesses;
}

function toBusinessInsert(scraped: ScrapedBusiness): BusinessInsert {
  // Combine phone numbers
  const phones = [scraped.phone, scraped.mobile].filter(Boolean);
  const phoneStr = phones.length > 0 ? phones.join(' / ') : null;

  return {
    business_name: scraped.name,
    business_type: 'concierge_service',
    industry_focus: [scraped.superCategory],
    services_offered: [scraped.subcategory],
    phone: phoneStr,
    email: scraped.email,
    website: scraped.website,
    address: scraped.address,
    city: scraped.location,
    country: 'BL', // Saint Barthélemy ISO code
    discovered_via: 'directory-saintbarth.com',
    source_url: scraped.sourceUrl,
    metadata: {
      project: 'lofficiel-concierge',
      source: 'directory-saintbarth.com',
      category_fr: scraped.category,
      subcategory_slug: scraped.subcategory,
      super_category: scraped.superCategory,
      fax: scraped.fax,
      scraped_at: new Date().toISOString()
    },
    search_keywords: [
      scraped.name.toLowerCase(),
      scraped.category.toLowerCase(),
      scraped.superCategory,
      scraped.location?.toLowerCase(),
      'saint barth',
      'st barth',
      'concierge'
    ].filter(Boolean) as string[]
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const categoryArg = args.find(a => a.startsWith('--category='));
  const targetCategory = categoryArg ? categoryArg.split('=')[1] : null;

  console.log('St Barth Directory Scraper');
  console.log('==========================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Target: ${targetCategory || 'ALL CATEGORIES'}`);
  console.log('');

  // Initialize Supabase client
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const categoriesToScrape = targetCategory
    ? SUPER_CATEGORIES.filter(c => c === targetCategory)
    : SUPER_CATEGORIES;

  if (categoriesToScrape.length === 0) {
    console.error(`Unknown category: ${targetCategory}`);
    console.error(`Available: ${SUPER_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  let totalScraped = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const superCategory of categoriesToScrape) {
    console.log(`\n[${superCategory.toUpperCase()}]`);

    try {
      const subcategories = await getSubcategories(superCategory);
      console.log(`  Found ${subcategories.length} subcategories`);

      for (const sub of subcategories) {
        try {
          const businesses = await scrapeCategory(superCategory, sub.slug, sub.name);
          console.log(`    ${sub.slug}: ${businesses.length} businesses`);
          totalScraped += businesses.length;

          if (!dryRun && businesses.length > 0) {
            const inserts = businesses.map(toBusinessInsert);

            // Check for existing by name + discovered_via to avoid duplicates
            for (const insert of inserts) {
              const { data: existing } = await supabase
                .from('businesses')
                .select('id')
                .eq('business_name', insert.business_name)
                .eq('discovered_via', 'directory-saintbarth.com')
                .single();

              if (existing) {
                totalSkipped++;
                continue;
              }

              const { error } = await supabase
                .from('businesses')
                .insert(insert);

              if (error) {
                console.error(`      Error inserting ${insert.business_name}: ${error.message}`);
              } else {
                totalInserted++;
              }
            }
          }

          // Rate limit
          await new Promise(r => setTimeout(r, 200));

        } catch (err) {
          console.error(`    Error scraping ${sub.slug}:`, err);
        }
      }
    } catch (err) {
      console.error(`  Error getting subcategories for ${superCategory}:`, err);
    }
  }

  console.log('\n==========================');
  console.log(`Total scraped: ${totalScraped}`);
  if (!dryRun) {
    console.log(`Total inserted: ${totalInserted}`);
    console.log(`Total skipped (duplicates): ${totalSkipped}`);
  }
}

main().catch(console.error);
