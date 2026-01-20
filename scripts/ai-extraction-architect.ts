/**
 * AI Extraction Architect
 *
 * An intelligent agent that:
 * 1. Explores a source website with Playwright
 * 2. Identifies inventory pages and listing patterns
 * 3. Generates extraction selectors and config
 * 4. Tests the extraction
 * 5. Stores the working config in source_intelligence
 *
 * This replaces blind trial-and-error scraping with intelligent
 * one-time learning of each source's structure.
 */

import { chromium, Page, Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic();

// ============================================================
// Types
// ============================================================

interface ExtractionConfig {
  // Navigation
  inventory_url: string | null;
  inventory_navigation_path: string[];  // Steps to reach inventory

  // Selectors for vehicle cards on listing page
  listing_selectors: {
    vehicle_card: string;
    vehicle_link: string;
    title: string;
    price: string;
    year: string;
    make: string;
    model: string;
    image: string;
    mileage: string;
  };

  // Selectors for individual vehicle detail page
  detail_selectors: {
    title: string;
    price: string;
    year: string;
    make: string;
    model: string;
    images: string;
    description: string;
    specs_container: string;
    vin: string;
    mileage: string;
    location: string;
  };

  // Technical requirements
  requires_js: boolean;
  requires_scroll: boolean;
  has_infinite_scroll: boolean;
  has_pagination: boolean;
  pagination_selector: string | null;

  // Quality assessment
  estimated_vehicle_count: number;
  data_completeness_score: number;  // 0-1
  confidence_score: number;  // 0-1

  // Metadata
  generated_at: string;
  last_tested_at: string;
  test_success: boolean;
  test_vehicle_sample: any[];
}

interface SourceForAnalysis {
  id: string;
  name: string;
  url: string;
  source_type: string;
  intelligence_id: string | null;
}

// ============================================================
// Page Analysis Functions
// ============================================================

async function capturePageStructure(page: Page): Promise<string> {
  // Capture a simplified DOM structure for AI analysis
  // NOTE: Avoid nested function definitions to prevent TypeScript transpilation issues
  return await page.evaluate(() => {
    const skipTags = ['script', 'style', 'svg', 'path', 'noscript', 'iframe'];
    const result: string[] = [];
    const stack: { node: Element; depth: number }[] = [{ node: document.body, depth: 0 }];

    while (stack.length > 0 && result.length < 500) {
      const item = stack.pop();
      if (!item || item.depth > 4) continue;

      const node = item.node;
      const depth = item.depth;
      const tag = node.tagName.toLowerCase();

      if (skipTags.includes(tag)) continue;

      const classes = node.className ? `.${node.className.toString().split(' ').slice(0, 3).join('.')}` : '';
      const id = node.id ? `#${node.id}` : '';
      const href = node.getAttribute('href') ? `[href]` : '';
      const indent = '  '.repeat(depth);

      const text = node.children.length === 0 ? node.textContent?.trim().substring(0, 80).replace(/\s+/g, ' ') : '';
      if (text) {
        result.push(`${indent}<${tag}${id}${classes}>${text}</${tag}>`);
      } else {
        result.push(`${indent}<${tag}${id}${classes}${href}>`);
        // Add children to stack in reverse order (so first child is processed first)
        const children = Array.from(node.children).slice(0, 8).reverse();
        for (const child of children) {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    }

    return result.join('\n');
  });
}

async function findInventoryPage(page: Page, baseUrl: string): Promise<{ url: string; path: string[] } | null> {
  console.log('  🔍 Looking for inventory page...');

  // Common inventory URL patterns
  const inventoryPaths = [
    '/inventory', '/vehicles', '/cars', '/for-sale', '/listings',
    '/stock', '/collection', '/showroom', '/available', '/our-cars',
    '/browse', '/shop', '/catalog'
  ];

  // First check if we're already on an inventory page
  const currentUrl = page.url();
  const hasVehicles = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const vehicleLinks = links.filter(a => {
      const href = (a as HTMLAnchorElement).href.toLowerCase();
      return /\/(19|20)\d{2}[-_]/.test(href) || /vehicle[-_/]\d+/.test(href);
    });
    return vehicleLinks.length >= 3;
  });

  if (hasVehicles) {
    console.log('  ✓ Already on inventory page');
    return { url: currentUrl, path: [] };
  }

  // Try to find inventory link
  const inventoryLink = await page.evaluate((paths) => {
    const allLinks = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];

    // Priority 1: URL path matches
    for (const path of paths) {
      const link = allLinks.find(a => {
        const href = a.href?.toLowerCase() || '';
        return href.includes(path) && !href.includes('sold') && !href.includes('past');
      });
      if (link?.href) return { href: link.href, text: link.textContent?.trim() || '' };
    }

    // Priority 2: Text content matches
    const textMatches = ['View Inventory', 'Browse Inventory', 'Inventory', 'Vehicles', 'For Sale', 'Our Cars', 'Browse', 'Collection'];
    for (const text of textMatches) {
      const match = allLinks.find(a => {
        const linkText = (a.textContent || '').trim().toLowerCase();
        return linkText === text.toLowerCase() && !a.href?.includes('sold');
      });
      if (match?.href) return { href: match.href, text: match.textContent?.trim() || '' };
    }

    return null;
  }, inventoryPaths);

  if (inventoryLink) {
    console.log(`  → Found inventory link: "${inventoryLink.text}" → ${inventoryLink.href}`);
    await page.goto(inventoryLink.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(1500);

    return { url: inventoryLink.href, path: [inventoryLink.text] };
  }

  console.log('  ✗ Could not find inventory page');
  return null;
}

async function analyzePageWithAI(
  page: Page,
  pageStructure: string,
  pageUrl: string,
  sourceName: string
): Promise<Partial<ExtractionConfig> | null> {
  console.log('  🤖 Analyzing page structure with AI...');

  // Get some sample HTML from potential vehicle cards
  const sampleHtml = await page.evaluate(() => {
    // Try to find vehicle cards
    const selectors = [
      '[class*="vehicle"]', '[class*="inventory"]', '[class*="listing"]',
      '[class*="car"]', '[class*="item"]', 'article', '.card'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length >= 2) {
        // Get first 3 elements' outer HTML (truncated)
        return Array.from(elements).slice(0, 3).map(el =>
          el.outerHTML.substring(0, 2000)
        ).join('\n\n---\n\n');
      }
    }

    // Fallback: get main content
    const main = document.querySelector('main, #main, .main, [role="main"]');
    return main?.innerHTML.substring(0, 5000) || document.body.innerHTML.substring(0, 5000);
  });

  const prompt = `You are an expert web scraper analyzing a car dealership website to extract vehicle listings.

Source: ${sourceName}
URL: ${pageUrl}

Here is a sample of the page HTML:

${sampleHtml}

And here is a simplified DOM structure:

${pageStructure.substring(0, 8000)}

Analyze this page and provide CSS selectors for extracting vehicle data. Return a JSON object with this structure:

{
  "listing_selectors": {
    "vehicle_card": "CSS selector for individual vehicle cards/items",
    "vehicle_link": "CSS selector for link to vehicle detail page (relative to card)",
    "title": "CSS selector for vehicle title (relative to card)",
    "price": "CSS selector for price (relative to card)",
    "year": "CSS selector or null if embedded in title",
    "make": "CSS selector or null if embedded in title",
    "model": "CSS selector or null if embedded in title",
    "image": "CSS selector for main image (relative to card)",
    "mileage": "CSS selector or null"
  },
  "requires_js": true/false,
  "has_pagination": true/false,
  "pagination_selector": "CSS selector or null",
  "estimated_vehicle_count": number,
  "data_completeness_score": 0.0-1.0,
  "confidence_score": 0.0-1.0,
  "notes": "Any important observations about the page structure"
}

Important:
- If a field is embedded in the title (e.g., "1967 Ford Mustang"), set that selector to null
- Use specific selectors that won't change frequently
- Prefer class-based selectors over deeply nested paths
- If you can't find a reliable selector, set it to null with a note

Return ONLY valid JSON, no explanation.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') return null;

    // Extract JSON from response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('  ✗ AI did not return valid JSON');
      return null;
    }

    const config = JSON.parse(jsonMatch[0]);
    console.log(`  ✓ AI analysis complete (confidence: ${config.confidence_score})`);
    return config;

  } catch (error: any) {
    console.log(`  ✗ AI analysis failed: ${error.message}`);
    return null;
  }
}

async function testExtraction(page: Page, config: Partial<ExtractionConfig>): Promise<any[]> {
  console.log('  🧪 Testing extraction with generated selectors...');

  if (!config.listing_selectors?.vehicle_card) {
    console.log('  ✗ No vehicle card selector to test');
    return [];
  }

  const vehicles = await page.evaluate((selectors) => {
    const cards = document.querySelectorAll(selectors.vehicle_card);
    const results: any[] = [];

    for (const card of Array.from(cards).slice(0, 5)) {
      const vehicle: any = {};

      // Try each selector
      if (selectors.vehicle_link) {
        const link = card.querySelector(selectors.vehicle_link) as HTMLAnchorElement;
        vehicle.url = link?.href || null;
      }
      if (selectors.title) {
        const title = card.querySelector(selectors.title);
        vehicle.title = title?.textContent?.trim() || null;
      }
      if (selectors.price) {
        const price = card.querySelector(selectors.price);
        vehicle.price = price?.textContent?.trim() || null;
      }
      if (selectors.image) {
        const img = card.querySelector(selectors.image) as HTMLImageElement;
        vehicle.image = img?.src || img?.getAttribute('data-src') || null;
      }

      // Parse year/make/model from title if needed
      if (vehicle.title) {
        const yearMatch = vehicle.title.match(/\b(19[1-9]\d|20[0-2]\d)\b/);
        vehicle.parsed_year = yearMatch ? parseInt(yearMatch[1]) : null;
      }

      if (vehicle.url || vehicle.title) {
        results.push(vehicle);
      }
    }

    return results;
  }, config.listing_selectors);

  console.log(`  ✓ Extracted ${vehicles.length} test vehicles`);
  return vehicles;
}

// ============================================================
// Main Analysis Function
// ============================================================

async function analyzeSource(
  browser: Browser,
  source: SourceForAnalysis
): Promise<ExtractionConfig | null> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Analyzing: ${source.name}`);
  console.log(`URL: ${source.url}`);
  console.log('='.repeat(60));

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  try {
    // Navigate to source
    console.log('  📄 Loading page...');
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Find inventory page
    const inventoryResult = await findInventoryPage(page, source.url);

    if (!inventoryResult) {
      console.log('  ❌ Could not locate inventory - skipping');
      await context.close();
      return null;
    }

    // Capture page structure
    const pageStructure = await capturePageStructure(page);

    // Analyze with AI
    const aiConfig = await analyzePageWithAI(page, pageStructure, inventoryResult.url, source.name);

    if (!aiConfig || !aiConfig.listing_selectors) {
      console.log('  ❌ AI analysis failed - skipping');
      await context.close();
      return null;
    }

    // Test the extraction
    const testVehicles = await testExtraction(page, aiConfig);

    // Build final config
    const config: ExtractionConfig = {
      inventory_url: inventoryResult.url,
      inventory_navigation_path: inventoryResult.path,
      listing_selectors: {
        vehicle_card: aiConfig.listing_selectors.vehicle_card || '',
        vehicle_link: aiConfig.listing_selectors.vehicle_link || 'a',
        title: aiConfig.listing_selectors.title || '',
        price: aiConfig.listing_selectors.price || '',
        year: aiConfig.listing_selectors.year || '',
        make: aiConfig.listing_selectors.make || '',
        model: aiConfig.listing_selectors.model || '',
        image: aiConfig.listing_selectors.image || 'img',
        mileage: aiConfig.listing_selectors.mileage || '',
      },
      detail_selectors: {
        title: 'h1',
        price: '[class*="price"]',
        year: '',
        make: '',
        model: '',
        images: 'img',
        description: '',
        specs_container: '',
        vin: '',
        mileage: '',
        location: '',
      },
      requires_js: aiConfig.requires_js ?? true,
      requires_scroll: true,
      has_infinite_scroll: false,
      has_pagination: aiConfig.has_pagination ?? false,
      pagination_selector: aiConfig.pagination_selector || null,
      estimated_vehicle_count: aiConfig.estimated_vehicle_count ?? testVehicles.length,
      data_completeness_score: aiConfig.data_completeness_score ?? 0.5,
      confidence_score: aiConfig.confidence_score ?? 0.5,
      generated_at: new Date().toISOString(),
      last_tested_at: new Date().toISOString(),
      test_success: testVehicles.length > 0,
      test_vehicle_sample: testVehicles.slice(0, 3),
    };

    console.log(`  ✅ Analysis complete:`);
    console.log(`     - Vehicle card selector: ${config.listing_selectors.vehicle_card}`);
    console.log(`     - Test vehicles extracted: ${testVehicles.length}`);
    console.log(`     - Confidence: ${(config.confidence_score * 100).toFixed(0)}%`);

    await context.close();
    return config;

  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
    await context.close();
    return null;
  }
}

async function saveExtractionConfig(
  source: SourceForAnalysis,
  config: ExtractionConfig
): Promise<boolean> {
  console.log('  💾 Saving extraction config...');

  const configData = {
    selector_hints: config.listing_selectors,
    page_structure_notes: JSON.stringify({
      inventory_url: config.inventory_url,
      navigation_path: config.inventory_navigation_path,
      requires_js: config.requires_js,
      has_pagination: config.has_pagination,
      pagination_selector: config.pagination_selector,
      test_sample: config.test_vehicle_sample,
    }),
    inspection_notes: `AI-generated extraction config. Confidence: ${(config.confidence_score * 100).toFixed(0)}%. Test extracted ${config.test_vehicle_sample.length} vehicles.`,
    last_inspected_at: new Date().toISOString(),
    inspected_by: 'ai_extraction_architect',
    requires_js_rendering: config.requires_js,
    recommended_extraction_method: config.requires_js ? 'playwright' : 'simple_fetch',
  };

  // Update existing source_intelligence record
  if (source.intelligence_id) {
    const { error } = await supabase
      .from('source_intelligence')
      .update({
        ...configData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', source.intelligence_id);

    if (error) {
      console.log(`  ✗ Failed to update source_intelligence: ${error.message}`);
      return false;
    }
    console.log('  ✓ Config saved to source_intelligence');
    return true;
  }

  // For dealer websites (from businesses table), save config to businesses.metadata
  if (source.source_type === 'dealer_website') {
    const { error } = await supabase
      .from('businesses')
      .update({
        metadata: {
          extraction_config: configData,
          extraction_confidence: config.confidence_score,
          extraction_tested_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', source.id);

    if (error) {
      console.log(`  ✗ Failed to update business metadata: ${error.message}`);
      return false;
    }
    console.log('  ✓ Config saved to business metadata');
    return true;
  }

  // For scrape_sources without intelligence, create source_intelligence record
  const { error } = await supabase
    .from('source_intelligence')
    .insert({
      source_id: source.id,
      ...configData,
      source_purpose: 'vehicle_listings',
      data_quality_tier: config.confidence_score > 0.7 ? 'standard' : 'basic',
      extraction_priority: Math.round(config.confidence_score * 100),
    });

  if (error) {
    console.log(`  ✗ Failed to create source_intelligence: ${error.message}`);
    return false;
  }

  console.log('  ✓ Config saved to source_intelligence');
  return true;
}

// ============================================================
// Main Entry Point
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('AI EXTRACTION ARCHITECT');
  console.log('Building extraction functions for each source');
  console.log('='.repeat(60));

  const limit = parseInt(process.argv[2]) || 10;

  // Get source_intelligence records that don't have selector_hints yet
  const { data: intelWithoutSelectors } = await supabase
    .from('source_intelligence')
    .select(`
      id,
      source_id,
      scrape_sources (
        id,
        name,
        url,
        source_type
      )
    `)
    .is('selector_hints', null)
    .eq('source_purpose', 'vehicle_listings')
    .limit(limit);

  // Get businesses with websites that need configs
  const { data: businesses } = await supabase
    .from('businesses')
    .select('id, business_name, website, business_type')
    .not('website', 'is', null)
    .neq('website', '')
    .in('business_type', ['dealership', 'dealer', 'classic_car_dealer', 'auction_house', 'specialty_shop'])
    .limit(limit);

  // Convert to unified format
  const sourcesFromIntel: SourceForAnalysis[] = (intelWithoutSelectors || [])
    .filter(i => i.scrape_sources)
    .map(i => ({
      id: i.scrape_sources.id,
      name: i.scrape_sources.name,
      url: i.scrape_sources.url,
      source_type: i.scrape_sources.source_type || 'unknown',
      intelligence_id: i.id,
    }));

  const businessSources: SourceForAnalysis[] = (businesses || []).map(b => ({
    id: b.id,
    name: b.business_name,
    url: b.website,
    source_type: 'dealer_website',
    intelligence_id: null,
  }));

  // Combine and dedupe by URL
  const allSources: SourceForAnalysis[] = [...sourcesFromIntel, ...businessSources];

  const uniqueSources = allSources.filter((s, i, arr) =>
    arr.findIndex(x => x.url === s.url) === i
  ).slice(0, limit);

  console.log(`\nFound ${uniqueSources.length} sources to analyze\n`);

  const browser = await chromium.launch({ headless: true });

  let analyzed = 0;
  let successful = 0;

  for (const source of uniqueSources) {
    const config = await analyzeSource(browser, source);
    analyzed++;

    if (config && config.test_success) {
      const saved = await saveExtractionConfig(source, config);
      if (saved) successful++;
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETE: Analyzed ${analyzed}, Successful ${successful}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
