#!/usr/bin/env node
/**
 * EXTRACTOR FACTORY
 *
 * Autonomous system that:
 * 1. Inspects target sites with Playwright
 * 2. Uses AI to understand structure
 * 3. Generates extraction functions
 * 4. Tests and deploys
 *
 * Usage:
 *   node extractor-factory.js inspect <url>      # Inspect site structure
 *   node extractor-factory.js analyze <url>      # AI analysis of site
 *   node extractor-factory.js generate <url>     # Generate extractor
 *   node extractor-factory.js test <url>         # Test extraction
 *   node extractor-factory.js run <name>         # Run extractor
 */

import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const INSPECTION_DIR = '/Users/skylar/nuke/site-inspections';

// Ensure inspection dir exists
import { mkdirSync } from 'fs';
try { mkdirSync(INSPECTION_DIR, { recursive: true }); } catch {}

async function inspectSite(url) {
  console.log(`\n🔍 INSPECTING: ${url}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const inspection = {
    url,
    timestamp: new Date().toISOString(),
    pages: {}
  };

  try {
    // 1. Inspect homepage
    console.log('  → Homepage...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    inspection.pages.homepage = await extractPageInfo(page);

    // 2. Find ALL navigation links for AI analysis
    console.log('  → Discovering all navigation links...');
    const allNavLinks = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a')];
      return links
        .filter(a => a.href && a.href.startsWith('http'))
        .map(a => ({
          href: a.href,
          text: a.innerText?.trim().slice(0, 100) || '',
          ariaLabel: a.getAttribute('aria-label') || '',
          classes: a.className || ''
        }))
        .filter((v, i, a) => a.findIndex(x => x.href === v.href) === i)
        .slice(0, 50);
    });

    inspection.allNavLinks = allNavLinks;

    // 3. Find inventory/listing links with expanded patterns
    console.log('  → Finding inventory links...');
    const inventoryPatterns = [
      'inventory', 'vehicles', 'cars', 'listings', 'for-sale', 'forsale',
      'collection', 'showroom', 'stock', 'available', 'current', 'browse',
      'shop', 'buy', 'portfolio', 'builds', 'projects', 'gallery', 'sold'
    ];

    const inventoryLinks = allNavLinks.filter(a => {
      const href = a.href?.toLowerCase() || '';
      const text = a.text?.toLowerCase() || '';
      const aria = a.ariaLabel?.toLowerCase() || '';
      return inventoryPatterns.some(p => href.includes(p) || text.includes(p) || aria.includes(p));
    });

    inspection.inventoryLinks = inventoryLinks;
    console.log(`     Found ${inventoryLinks.length} potential inventory links`);

    // 3. Inspect first inventory page
    if (inventoryLinks.length > 0) {
      const invUrl = inventoryLinks[0].href;
      console.log(`  → Inventory page: ${invUrl.slice(0, 60)}...`);
      await page.goto(invUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      inspection.pages.inventory = await extractPageInfo(page);

      // Find individual listing links
      const listingLinks = await page.evaluate(() => {
        // Look for cards/items that link to individual vehicles
        const cards = document.querySelectorAll('a[href*="vehicle"], a[href*="listing"], a[href*="car"], a[href*="lot"], .vehicle-card a, .inventory-item a, .listing a');
        return [...cards]
          .map(a => a.href)
          .filter(h => h && !h.includes('#'))
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 10);
      });

      inspection.listingLinks = listingLinks;
      console.log(`     Found ${listingLinks.length} potential listing links`);

      // 4. Inspect a detail page
      if (listingLinks.length > 0) {
        const detailUrl = listingLinks[0];
        console.log(`  → Detail page: ${detailUrl.slice(0, 60)}...`);
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        inspection.pages.detail = await extractPageInfo(page);
        inspection.sampleDetailUrl = detailUrl;

        // Extract vehicle data patterns
        inspection.vehiclePatterns = await page.evaluate(() => {
          const text = document.body.innerText;
          return {
            hasYear: /\b(19|20)\d{2}\b/.test(text),
            hasMake: /(ford|chevrolet|chevy|porsche|ferrari|mercedes|bmw|audi|toyota|honda)/i.test(text),
            hasPrice: /\$[\d,]+/.test(text),
            hasVIN: /VIN[:\s]*([A-Z0-9]{17})/i.test(text),
            hasMileage: /(\d{1,3},?\d{3})\s*(miles?|mi\.?|km)/i.test(text),
            hasEngine: /(V6|V8|V10|V12|inline|flat|turbo|\d\.\d[L])/i.test(text),
            hasTransmission: /(manual|automatic|auto|stick|speed)/i.test(text),
            imageCount: document.querySelectorAll('img').length,
            galleryImages: document.querySelectorAll('[class*="gallery"] img, [class*="slider"] img, [class*="carousel"] img').length
          };
        });
      }
    }

    // Save inspection
    const slug = new URL(url).hostname.replace(/\./g, '-');
    const filepath = `${INSPECTION_DIR}/${slug}.json`;
    writeFileSync(filepath, JSON.stringify(inspection, null, 2));
    console.log(`\n✅ Inspection saved: ${filepath}`);

    return inspection;

  } finally {
    await browser.close();
  }
}

async function extractPageInfo(page) {
  return await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      bodyText: document.body.innerText.slice(0, 5000),

      // Structure analysis
      structure: {
        headings: [...document.querySelectorAll('h1, h2, h3')].map(h => h.innerText.trim().slice(0, 100)).slice(0, 10),
        navLinks: [...document.querySelectorAll('nav a, header a')].map(a => ({ text: a.innerText?.trim(), href: a.href })).slice(0, 20),
        mainClasses: [...new Set([...document.querySelectorAll('[class]')].map(e => e.className).filter(c => c.length < 50))].slice(0, 30),
        dataAttributes: [...new Set([...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => a.name.startsWith('data-'))).flatMap(e => [...e.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name)))].slice(0, 20),
      },

      // Images
      images: [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src)
        .filter(s => s && !s.includes('logo') && !s.includes('icon') && !s.includes('placeholder'))
        .slice(0, 20),

      // JSON-LD structured data
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
        .filter(Boolean),

      // Meta tags
      meta: {
        description: document.querySelector('meta[name="description"]')?.content,
        ogTitle: document.querySelector('meta[property="og:title"]')?.content,
        ogImage: document.querySelector('meta[property="og:image"]')?.content,
      }
    };
  });
}

async function analyzeWithAI(inspection) {
  console.log('\n🤖 AI ANALYSIS...\n');

  // If no API key, generate with defaults based on inspection data
  if (!ANTHROPIC_KEY) {
    console.log('  No ANTHROPIC_API_KEY, using pattern-based analysis\n');
    return generateDefaultAnalysis(inspection);
  }

  // Format all navigation links for AI analysis
  const navLinksFormatted = (inspection.allNavLinks || [])
    .map(l => `  - "${l.text}" → ${l.href}`)
    .join('\n');

  const inventoryLinksFormatted = (inspection.inventoryLinks || [])
    .map(l => `  - "${l.text}" → ${l.href}`)
    .join('\n');

  const prompt = `Analyze this vehicle dealer/marketplace website and provide extraction strategy.

SITE: ${inspection.url}

ALL NAVIGATION LINKS FOUND:
${navLinksFormatted || 'none'}

POTENTIAL INVENTORY LINKS:
${inventoryLinksFormatted || 'none'}

LISTING LINKS FOUND: ${inspection.listingLinks?.length || 0}
SAMPLE DETAIL URL: ${inspection.sampleDetailUrl || 'none'}

DETAIL PAGE PATTERNS DETECTED:
${JSON.stringify(inspection.vehiclePatterns, null, 2)}

DETAIL PAGE STRUCTURE:
- Headings: ${inspection.pages?.detail?.structure?.headings?.join(', ') || 'none'}
- Main classes: ${inspection.pages?.detail?.structure?.mainClasses?.slice(0, 15).join(', ') || 'none'}
- Has JSON-LD: ${inspection.pages?.detail?.jsonLd?.length > 0}
- Image count: ${inspection.pages?.detail?.images?.length || 0}

SAMPLE BODY TEXT (first 2000 chars):
${inspection.pages?.detail?.bodyText?.slice(0, 2000) || inspection.pages?.inventory?.bodyText?.slice(0, 2000) || inspection.pages?.homepage?.bodyText?.slice(0, 2000) || 'none'}

TASK: Analyze the navigation links to determine:
1. Which URL(s) lead to CURRENT/AVAILABLE inventory (vehicles for sale)
2. Which URL(s) lead to SOLD/PAST inventory (if any)
3. The site structure and how to navigate to individual vehicle listings

Based on this analysis, provide:
1. SITE_TYPE: (dealer|auction|aggregator|restorer|marketplace)
2. CURRENT_INVENTORY_URL: The URL for currently available vehicles
3. SOLD_INVENTORY_URL: The URL for sold vehicles (if exists, else null)
4. LISTING_URL_PATTERN: regex or pattern to identify individual listing URLs
5. EXTRACTION_SELECTORS: CSS selectors or text patterns for:
   - year, make, model
   - price
   - VIN
   - mileage
   - engine
   - transmission
   - exterior_color
   - interior_color
   - images
   - description
6. PAGINATION_PATTERN: how to navigate inventory pages
7. CHALLENGES: any anti-bot, lazy loading, or dynamic content issues
8. RECOMMENDED_APPROACH: playwright|firecrawl|direct_fetch

Output as JSON.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const result = await response.json();
    const analysis = result.content?.[0]?.text;

    if (!analysis) {
      console.log('  API returned no content, using pattern-based analysis');
      console.log('  API response:', JSON.stringify(result, null, 2));
      return generateDefaultAnalysis(inspection);
    }

    console.log(analysis);

    // Save analysis
    const slug = new URL(inspection.url).hostname.replace(/\./g, '-');
    writeFileSync(`${INSPECTION_DIR}/${slug}-analysis.txt`, analysis);

    return analysis;
  } catch (err) {
    console.log(`  API error: ${err.message}, using pattern-based analysis`);
    return generateDefaultAnalysis(inspection);
  }
}

function generateDefaultAnalysis(inspection) {
  // Generate a sensible default based on what we found
  const hasInventory = inspection.inventoryLinks?.length > 0;
  const hasListings = inspection.listingLinks?.length > 0;
  const patterns = inspection.vehiclePatterns || {};
  const invLinks = inspection.inventoryLinks || [];

  // Smart inventory URL discovery
  const currentPatterns = ['available', 'current', 'for-sale', 'forsale', 'inventory', 'shop', 'buy'];
  const soldPatterns = ['sold', 'past', 'previous', 'completed', 'history'];

  let currentInventoryUrl = null;
  let soldInventoryUrl = null;

  for (const link of invLinks) {
    const href = link.href?.toLowerCase() || '';
    const text = link.text?.toLowerCase() || '';

    if (!currentInventoryUrl && currentPatterns.some(p => href.includes(p) || text.includes(p))) {
      currentInventoryUrl = link.href;
    }
    if (!soldInventoryUrl && soldPatterns.some(p => href.includes(p) || text.includes(p))) {
      soldInventoryUrl = link.href;
    }
  }

  // Fallback to first inventory link if no specific match
  if (!currentInventoryUrl && invLinks.length > 0) {
    currentInventoryUrl = invLinks[0].href;
  }

  const analysis = {
    SITE_TYPE: hasListings ? 'dealer' : 'marketplace',
    CURRENT_INVENTORY_URL: currentInventoryUrl || inspection.url + '/inventory',
    SOLD_INVENTORY_URL: soldInventoryUrl || null,
    LISTING_URL_PATTERN: hasListings ? inspection.listingLinks?.[0] : 'a[href*="vehicle"], a[href*="listing"], a[href*="car"], a[href*="build"]',
    EXTRACTION_SELECTORS: {
      year: patterns.hasYear ? '\\b(19|20)\\d{2}\\b' : 'h1, .title',
      make: patterns.hasMake ? 'h1, .title' : 'h1',
      model: 'h1, .title, .vehicle-title',
      price: patterns.hasPrice ? '\\$[\\d,]+' : '.price, [class*="price"]',
      vin: patterns.hasVIN ? 'VIN[:\\s]*([A-Z0-9]{17})' : '.vin, [class*="vin"]',
      mileage: patterns.hasMileage ? '(\\d{1,3},?\\d{3})\\s*(miles?|mi)' : '.mileage, [class*="mileage"]',
      images: 'img[src*="vehicle"], .gallery img, .slider img, [class*="gallery"] img'
    },
    PAGINATION_PATTERN: 'a[href*="page"], .pagination a, [class*="next"], [class*="load-more"]',
    CHALLENGES: ['lazy_loading', 'dynamic_content'],
    RECOMMENDED_APPROACH: 'playwright'
  };

  const analysisText = JSON.stringify(analysis, null, 2);
  console.log(analysisText);

  // Save analysis
  const slug = new URL(inspection.url).hostname.replace(/\./g, '-');
  writeFileSync(`${INSPECTION_DIR}/${slug}-analysis.txt`, analysisText);

  return analysisText;
}

async function generateExtractor(url, analysis) {
  console.log('\n⚙️ GENERATING EXTRACTOR...\n');

  // Parse analysis to extract patterns
  let config;
  try {
    const jsonMatch = analysis.match(/```json\n?([\s\S]*?)\n?```/) || analysis.match(/\{[\s\S]*\}/);
    config = JSON.parse(jsonMatch?.[1] || jsonMatch?.[0] || '{}');
  } catch {
    console.log('Could not parse AI analysis as JSON, using defaults');
    config = {};
  }

  const slug = new URL(url).hostname.replace(/[^a-z0-9]/g, '-');
  const functionName = `extract-${slug}`;

  const extractorCode = `#!/usr/bin/env node
/**
 * Auto-generated extractor for ${url}
 * Generated: ${new Date().toISOString()}
 *
 * Usage: node ${functionName}.js [batch_size] [workers]
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const WORKERS = parseInt(process.argv[3]) || 2;

const CONFIG = ${JSON.stringify(config, null, 2)};

async function discoverListings(page, inventoryUrl) {
  await page.goto(inventoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Scroll to load lazy content
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  const listings = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="vehicle"], a[href*="listing"], a[href*="inventory/"], a[href*="/car/"], a[href*="/lot/"]')];
    return links
      .map(a => a.href)
      .filter(h => h && !h.includes('#'))
      .filter((v, i, a) => a.indexOf(v) === i);
  });

  return listings;
}

async function extractListing(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    return await page.evaluate(() => {
      const text = document.body.innerText;

      // Year extraction
      const yearMatch = text.match(/\\b(19[0-9]{2}|20[0-2][0-9])\\b/);

      // Price extraction
      const priceMatch = text.match(/\\$([\\d,]+)/);

      // VIN extraction
      const vinMatch = text.match(/VIN[:\\s]*([A-Z0-9]{17})/i);

      // Mileage extraction
      const mileageMatch = text.match(/(\\d{1,3},?\\d{3})\\s*(miles?|mi\\.?)/i);

      // Images
      const images = [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src)
        .filter(s => s && s.includes('http') && !s.includes('logo') && !s.includes('icon'))
        .filter((v, i, a) => a.indexOf(v) === i);

      // Title parsing for make/model
      const title = document.querySelector('h1')?.innerText || document.title;

      return {
        url: window.location.href,
        title,
        year: yearMatch ? parseInt(yearMatch[1]) : null,
        price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
        vin: vinMatch?.[1] || null,
        mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
        images,
        raw_text: text.slice(0, 5000)
      };
    });
  } catch (e) {
    return { url, error: e.message };
  }
}

async function saveVehicle(data) {
  // Use AI to extract make/model from title if needed
  const vehicleData = {
    discovery_url: data.url,
    discovery_source: '${slug}',
    year: data.year,
    sale_price: data.price,
    vin: data.vin,
    mileage: data.mileage,
    primary_image_url: data.images?.[0],
    status: 'pending'
  };

  // Insert or update
  const res = await fetch(\`\${SUPABASE_URL}/rest/v1/vehicles\`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': \`Bearer \${SUPABASE_KEY}\`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(vehicleData)
  });

  return res.ok;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ${slug.toUpperCase()} EXTRACTOR');
  console.log('║  Auto-generated extractor');
  console.log('╚════════════════════════════════════════════════════════════╝\\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Discover listings
    console.log('Discovering listings...');
    const listings = await discoverListings(page, '${url}');
    console.log(\`Found \${listings.length} listings\\n\`);

    // Extract each
    let success = 0, errors = 0;
    for (const url of listings.slice(0, BATCH_SIZE)) {
      const data = await extractListing(page, url);
      if (data.error) {
        errors++;
        console.log(\`✗ \${url.slice(0, 50)}... - \${data.error}\`);
      } else {
        await saveVehicle(data);
        success++;
        console.log(\`✓ \${data.year || '?'} - \${data.title?.slice(0, 40) || 'Unknown'}\`);
      }
    }

    console.log(\`\\n✅ Done: \${success} extracted, \${errors} errors\`);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
`;

  const filepath = `/Users/skylar/nuke/scripts/${functionName}.js`;
  writeFileSync(filepath, extractorCode);
  console.log(`✅ Extractor generated: ${filepath}`);

  return filepath;
}

// CLI
const [,, command, arg] = process.argv;

switch (command) {
  case 'inspect':
    if (!arg) { console.log('Usage: node extractor-factory.js inspect <url>'); process.exit(1); }
    inspectSite(arg).then(i => console.log('\nPatterns:', JSON.stringify(i.vehiclePatterns, null, 2)));
    break;

  case 'analyze':
    if (!arg) { console.log('Usage: node extractor-factory.js analyze <url>'); process.exit(1); }
    inspectSite(arg).then(i => analyzeWithAI(i));
    break;

  case 'generate':
    if (!arg) { console.log('Usage: node extractor-factory.js generate <url>'); process.exit(1); }
    inspectSite(arg).then(i => analyzeWithAI(i).then(a => generateExtractor(arg, a)));
    break;

  case 'list':
    const targets = JSON.parse(readFileSync('/Users/skylar/nuke/scripts/target-sites.json'));
    console.log('\nTARGET SITES:');
    targets.new_targets.forEach(t => console.log(`  ${t.name.padEnd(25)} ${t.url}`));
    break;

  default:
    console.log(`
EXTRACTOR FACTORY - Autonomous extraction system

Commands:
  inspect <url>   - Playwright inspection of site structure
  analyze <url>   - AI analysis + extraction strategy
  generate <url>  - Generate complete extractor script
  list            - Show target sites

Examples:
  node extractor-factory.js inspect https://vanguardmotorsales.com
  node extractor-factory.js analyze https://kindredmotorworks.com
  node extractor-factory.js generate https://streetsideclassics.com
`);
}
