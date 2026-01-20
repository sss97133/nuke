/**
 * Extract ONE vehicle per organization from their websites
 * Links vehicles to the correct selling organization
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface ExtractedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  listing_url: string;
  title: string;
}

interface OrgForExtraction {
  id: string;
  business_name: string;
  website: string;
  business_type: string;
}

async function getOrgsNeedingVehicles(): Promise<OrgForExtraction[]> {
  // Get organizations with websites
  const { data: orgs } = await supabase
    .from('businesses')
    .select('id, business_name, website, business_type')
    .not('website', 'is', null)
    .neq('website', '')
    .in('business_type', ['dealership', 'dealer', 'classic_car_dealer', 'auction_house', 'specialty_shop'])
    .order('business_name');

  if (!orgs) return [];

  // Get orgs that already have vehicles
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select('organization_id')
    .eq('status', 'active');

  const orgsWithVehicles = new Set((orgVehicles || []).map(ov => ov.organization_id));

  // Filter to orgs without vehicles
  return orgs.filter(o => !orgsWithVehicles.has(o.id));
}

async function extractVehicleFromPage(page: Page, orgUrl: string): Promise<ExtractedVehicle | null> {
  try {
    // First try to find inventory page
    let inventoryUrl = orgUrl;
    const inventoryPaths = [
      '/inventory', '/vehicles', '/cars', '/stock', '/for-sale', '/listings',
      '/available', '/collection', '/showroom', '/gallery', '/our-cars',
    ];

    // Navigate to main page first
    await page.goto(orgUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Look for inventory link in navigation - try multiple patterns
    const inventoryLink = await page.evaluate((paths) => {
      const allLinks = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];

      // Priority 1: URL path matches
      for (const path of paths) {
        const link = allLinks.find(a => {
          const href = a.href?.toLowerCase() || '';
          return href.includes(path) && !href.includes('sold') && !href.includes('past');
        });
        if (link?.href) return link.href;
      }

      // Priority 2: Text content matches (prioritized order)
      const textMatches = [
        'View Inventory', 'Browse Inventory', 'Our Inventory', 'Current Inventory',
        'View All', 'See All', 'Browse All',
        'Inventory', 'Vehicles', 'For Sale', 'Our Cars', 'Browse', 'Collection',
        'Current Stock', 'Available', 'In Stock', 'Shop Now', 'View Cars',
      ];
      for (const text of textMatches) {
        const match = allLinks.find(a => {
          const linkText = (a.textContent || '').trim().toLowerCase();
          const ariaLabel = (a.getAttribute('aria-label') || '').toLowerCase();
          return (linkText === text.toLowerCase() || ariaLabel.includes(text.toLowerCase()))
            && !a.href?.includes('sold') && !a.href?.includes('past');
        });
        if (match?.href) return match.href;
      }

      // Priority 3: Partial text matches
      for (const text of ['inventory', 'vehicles', 'cars']) {
        const match = allLinks.find(a => {
          const linkText = (a.textContent || '').toLowerCase();
          return linkText.includes(text) && linkText.length < 30
            && !a.href?.includes('sold') && !a.href?.includes('past');
        });
        if (match?.href) return match.href;
      }

      // Priority 4: Navigation menu items
      const navLinks = document.querySelectorAll('nav a, header a, [class*="nav"] a, [class*="menu"] a');
      for (const el of navLinks) {
        const a = el as HTMLAnchorElement;
        const text = (a.textContent || '').toLowerCase();
        if ((text.includes('inventor') || text.includes('vehicle') || text.includes('for sale'))
            && !a.href?.includes('sold')) {
          return a.href;
        }
      }

      return null;
    }, inventoryPaths);

    if (inventoryLink && inventoryLink !== orgUrl) {
      inventoryUrl = inventoryLink;
      console.log(`    → Navigating to: ${inventoryUrl}`);
      await page.goto(inventoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    // Scroll multiple times to trigger lazy loading
    for (let i = 0; i < 3; i++) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), 400 * (i + 1));
      await page.waitForTimeout(800);
    }

    // Try to find vehicle listings - MORE GENERIC approach
    const vehicleData = await page.evaluate(() => {
      // Get ALL links on page
      const allLinks = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];

      // Filter to links that look like vehicle pages
      const vehicleLinks = allLinks.filter(link => {
        const href = link.href.toLowerCase();
        const text = link.textContent || '';

        // Skip navigation, social, external links
        if (href.includes('facebook') || href.includes('instagram') || href.includes('twitter')) return false;
        if (href.includes('contact') || href.includes('about') || href.includes('privacy')) return false;
        if (href.includes('login') || href.includes('signup') || href.includes('cart')) return false;
        if (href === '#' || href.endsWith('/')) return false;

        // YEAR PATTERN - the key indicator of a vehicle listing
        // Check if URL contains a year (1910-2026) in various patterns
        // Year range: 1910-2026 to cover antique cars
        const yearRegex = '(19[1-9]\\d|20[0-2]\\d)';
        const yearPatterns = [
          new RegExp(`\\/${yearRegex}[-_]`, 'i'),           // /1995-
          new RegExp(`[-_]${yearRegex}[-_]`, 'i'),          // -1995-
          new RegExp(`vehicle[-_]${yearRegex}`, 'i'),       // vehicle-1995
          new RegExp(`used[-_]vehicle[-_]${yearRegex}`, 'i'),   // used-vehicle-2023
          new RegExp(`new[-_]vehicle[-_]${yearRegex}`, 'i'),    // new-vehicle-2024
          new RegExp(`inventory.*${yearRegex}`, 'i'),       // inventory with year
          new RegExp(`listing.*${yearRegex}`, 'i'),         // listing with year
          new RegExp(`\\/${yearRegex}[_-]?[a-z]`, 'i'),    // /1995-chevrolet
        ];
        const urlHasYear = yearPatterns.some(p => p.test(href));
        const textHasYear = /\b(19[1-9]\d|20[0-2]\d)\b/.test(text);

        // Common vehicle URL patterns
        const vehicleUrlPatterns = [
          /\/(vehicle|inventory|used|car|listing|stock|detail|vdp)[-_/]/i,
          /\/cars?\//i,
          /\/auto(s|mobile)?[-_/]/i,
          /veh[-_]?id/i,
          /stock[-_]?(no|num|id)?/i,
        ];
        const isVehicleUrl = vehicleUrlPatterns.some(p => p.test(href));

        // Check if link text contains make/model keywords - require more specific context
        // Avoid matching generic navigation like "Ford" or "Mustang" brand links
        const makeModelWithYear = /(19[1-9]\d|20[0-2]\d)\s*(chevrolet|ford|porsche|ferrari|mercedes|bmw|audi|toyota|honda|corvette|mustang)/i.test(text);
        const makeModelInUrl = /(chevrolet|ford|porsche|ferrari|mercedes|bmw|audi|toyota|honda|corvette|mustang).*\d{3,}/i.test(href);

        return urlHasYear || (textHasYear && text.length < 200) || (isVehicleUrl && href.match(/\d+$/)) || makeModelWithYear || makeModelInUrl;
      });

      if (vehicleLinks.length === 0) return null;

      // Get first vehicle link
      const vehicleLink = vehicleLinks[0];
      const vehicleCard = vehicleLink.closest('[class*="vehicle"], [class*="card"], [class*="item"], article, li, div');

      // Extract title from card or link
      let title = vehicleCard?.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]')?.textContent?.trim()
        || vehicleLink.textContent?.trim()
        || '';

      // If title is empty, try to parse from URL
      if (!title || title.length < 5) {
        const urlParts = vehicleLink.href.split('/').pop()?.replace(/[-_]/g, ' ') || '';
        title = urlParts;
      }

      // Look for price
      const priceEl = vehicleCard?.querySelector('[class*="price"], [class*="cost"]');
      const priceText = priceEl?.textContent?.match(/\$[\d,]+/)?.[0]
        || document.body.innerText.match(/\$[\d,]{4,}/)?.[0]
        || '';
      const price = priceText ? parseInt(priceText.replace(/[$,]/g, '')) : null;

      return {
        url: vehicleLink.href,
        title: title.substring(0, 200),
        price,
        totalFound: vehicleLinks.length,
      };
    });

    if (!vehicleData) return null;

    // If title is too short or generic, visit the detail page for better info
    let betterTitle = vehicleData.title;
    let betterPrice = vehicleData.price;

    if (vehicleData.title.length < 10 || /^(more|view|details|click)/i.test(vehicleData.title)) {
      try {
        await page.goto(vehicleData.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1000);

        const detailData = await page.evaluate(() => {
          // Get title from H1 or page title
          const h1 = document.querySelector('h1')?.textContent?.trim();
          const pageTitle = document.title.split('|')[0].split('-')[0].trim();
          const title = h1 && h1.length > 5 ? h1 : pageTitle;

          // Get price
          const priceMatch = document.body.innerText.match(/\$[\d,]{4,}/);
          const price = priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, '')) : null;

          return { title, price };
        });

        if (detailData.title && detailData.title.length > betterTitle.length) {
          betterTitle = detailData.title;
        }
        if (detailData.price && !betterPrice) {
          betterPrice = detailData.price;
        }
      } catch (e) {
        // Ignore detail page errors
      }
    }

    // Parse year/make/model from title AND URL
    const titleAndUrl = betterTitle + ' ' + vehicleData.url.replace(/[-_]/g, ' ');

    // Match years 1910-2026 for classic/antique vehicles
    const yearMatch = titleAndUrl.match(/\b(19[1-9]\d|20[0-2]\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Extended make list - comprehensive for classic and modern cars
    const makes = [
      // American Big 3 + AMC
      'Chevrolet', 'Chevy', 'GMC', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac', 'Oldsmobile',
      'Lincoln', 'Mercury', 'Chrysler', 'Jeep', 'Ram', 'AMC', 'Hudson', 'Nash', 'Packard', 'Studebaker',
      'DeSoto', 'Imperial', 'Edsel', 'Kaiser', 'Willys', 'International', 'Tucker', 'Avanti',
      // German
      'Mercedes', 'Mercedes-Benz', 'BMW', 'Porsche', 'Audi', 'Volkswagen', 'VW', 'Opel',
      // Italian
      'Ferrari', 'Lamborghini', 'Maserati', 'Alfa Romeo', 'Fiat', 'Lancia', 'De Tomaso',
      // British
      'Jaguar', 'Aston Martin', 'Bentley', 'Rolls Royce', 'Rolls-Royce', 'Land Rover', 'Range Rover',
      'Lotus', 'MG', 'Triumph', 'Austin Healey', 'Austin-Healey', 'TVR', 'Morgan', 'Mini', 'Sunbeam',
      // Japanese
      'Toyota', 'Nissan', 'Datsun', 'Honda', 'Mazda', 'Subaru', 'Lexus', 'Acura', 'Infiniti', 'Mitsubishi',
      // Other
      'McLaren', 'Koenigsegg', 'Bugatti', 'Pagani', 'Saab', 'Volvo', 'Tesla',
      // Model names often used as makes
      'Corvette', 'Mustang', 'Camaro', 'Challenger', 'Charger', 'Firebird', 'Trans Am', 'Shelby', 'Bronco',
    ];
    let make: string | null = null;
    for (const m of makes) {
      const regex = new RegExp(`\\b${m.replace(/[- ]/g, '[-_ ]?')}\\b`, 'i');
      if (regex.test(titleAndUrl)) {
        // Normalize some names
        make = m === 'Chevy' ? 'Chevrolet'
          : m === 'VW' ? 'Volkswagen'
          : m === 'Mercedes-Benz' ? 'Mercedes'
          : m;
        break;
      }
    }

    // Extract model - parse from URL slug first (most reliable), then title
    let model: string | null = null;

    // Try parsing URL slug like: /1967-ford-mustang-fastback or /used-vehicle-2023-porsche-911
    const urlSlug = vehicleData.url.split('/').pop()?.replace(/[-_]/g, ' ') || '';

    if (year && make) {
      // Pattern 1: YEAR MAKE MODEL in URL slug (e.g., "1967 ford mustang fastback")
      const slugPattern = new RegExp(`${year}\\s+${make.replace(/[- ]/g, '\\s*')}\\s+(.+)`, 'i');
      const slugMatch = urlSlug.match(slugPattern);
      if (slugMatch) {
        model = slugMatch[1].split(/\s+/).slice(0, 4).join(' ');
      }

      // Pattern 2: MAKE MODEL in URL (e.g., "porsche 911 carrera")
      if (!model) {
        const makeModelPattern = new RegExp(`${make.replace(/[- ]/g, '\\s*')}\\s+([a-z0-9][a-z0-9\\s]+)`, 'i');
        const mmMatch = urlSlug.match(makeModelPattern) || titleAndUrl.match(makeModelPattern);
        if (mmMatch) {
          model = mmMatch[1].split(/\s+/).slice(0, 4).join(' ');
        }
      }

      // Pattern 3: YEAR MAKE MODEL in combined text
      if (!model) {
        const titlePattern = new RegExp(`${year}\\s+${make.replace(/[- ]/g, '\\s*')}\\s+([A-Za-z0-9][A-Za-z0-9\\s-]+)`, 'i');
        const titleMatch = titleAndUrl.match(titlePattern);
        if (titleMatch) {
          model = titleMatch[1].split(/\s+/).slice(0, 4).join(' ');
        }
      }
    } else if (make) {
      // Just find text after make
      const afterMake = urlSlug.split(new RegExp(make.replace(/[- ]/g, '\\s*'), 'i'))[1]
        || titleAndUrl.split(new RegExp(make.replace(/[- ]/g, '\\s*'), 'i'))[1];
      if (afterMake) {
        model = afterMake.replace(/^[\s\-:]+/, '').trim().split(/\s+/).slice(0, 3).join(' ');
      }
    }

    // Clean up model - remove junk
    if (model) {
      model = model
        .replace(/Speed Digital.*$/i, '')
        .replace(/Verified.*$/i, '')
        .replace(/\d{5,}/g, '')  // Remove long numbers (prices, IDs)
        .replace(/\$[\d,]+/g, '')  // Remove prices
        .replace(/c \d+$/i, '')  // Remove trailing "c 2820" stock numbers
        .replace(/\/?[a-z]{2,}\d+[a-z]*\s*$/i, '')  // Remove URL/hash fragments
        .replace(/\.htm[l]?$/i, '')  // Remove .htm extensions
        .replace(/\s*\/\s*/g, ' ')  // Replace slashes with spaces
        .replace(/[a-f0-9]{20,}/gi, '')  // Remove hex hashes
        .replace(/\s+/g, ' ')
        .trim();
      if (model.length < 2 || /^(c|vin|stock|id|in|http)$/i.test(model)) model = null;
    }

    return {
      year,
      make,
      model,
      price: betterPrice,
      listing_url: vehicleData.url,
      title: betterTitle,
    };

  } catch (err) {
    return null;
  }
}

async function saveVehicleForOrg(vehicle: ExtractedVehicle, org: OrgForExtraction): Promise<boolean> {
  // Quality check: require at least year OR make to be present
  if (!vehicle.year && !vehicle.make) {
    console.log(`    Skipped: No year or make detected`);
    return false;
  }

  // Check if we already have this listing
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('listing_url', vehicle.listing_url)
    .limit(1);

  if (existing?.length) {
    console.log(`    Already have this listing`);
    return false;
  }

  // Insert vehicle - don't use selling_organization_id, use organization_vehicles link instead
  const { data: newVehicle, error } = await supabase
    .from('vehicles')
    .insert({
      year: vehicle.year,
      make: vehicle.make || 'Unknown',
      model: vehicle.model || 'Unknown',
      price: vehicle.price,
      listing_url: vehicle.listing_url,
      listing_title: vehicle.title,
      listing_source: 'dealer_website',
    })
    .select()
    .single();

  if (error) {
    console.log(`    DB Error: ${error.message}`);
    return false;
  }

  // Create organization_vehicles link
  await supabase.from('organization_vehicles').insert({
    organization_id: org.id,
    vehicle_id: newVehicle.id,
    relationship_type: 'seller',
    auto_tagged: true,
    status: 'active',
  });

  return true;
}

async function main() {
  console.log('='.repeat(60));
  console.log('ONE VEHICLE PER ORGANIZATION EXTRACTION');
  console.log('='.repeat(60));

  // Get orgs needing vehicles
  const orgs = await getOrgsNeedingVehicles();
  console.log(`\nFound ${orgs.length} organizations needing vehicles`);

  // Limit for testing - support offset and limit
  const maxOrgs = parseInt(process.argv[2]) || 20;
  const offset = parseInt(process.argv[3]) || 0;
  const toProcess = orgs.slice(offset, offset + maxOrgs);
  console.log(`Processing ${toProcess.length} organizations (offset: ${offset})...\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  let extracted = 0;
  let failed = 0;

  for (const org of toProcess) {
    console.log(`\n${org.business_name}`);
    console.log(`  Website: ${org.website}`);

    try {
      const page = await context.newPage();
      const vehicle = await extractVehicleFromPage(page, org.website);
      await page.close();

      if (vehicle) {
        console.log(`  Found: ${vehicle.title}`);
        console.log(`  Parsed: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
        console.log(`  Price: ${vehicle.price ? '$' + vehicle.price : 'N/A'}`);

        const saved = await saveVehicleForOrg(vehicle, org);
        if (saved) {
          extracted++;
          console.log(`  ✅ Saved & linked to org`);
        }
      } else {
        failed++;
        console.log(`  ❌ No vehicle found`);
      }
    } catch (err: any) {
      failed++;
      console.log(`  ❌ Error: ${err.message}`);
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETE: Extracted ${extracted}, Failed ${failed}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
