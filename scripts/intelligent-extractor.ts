/**
 * Intelligent Extractor
 *
 * Uses stored extraction configs from source_intelligence to reliably
 * extract vehicle data. No trial-and-error - just runs the learned selectors.
 *
 * Flow:
 * 1. Load extraction config from source_intelligence.selector_hints
 * 2. Navigate to inventory URL
 * 3. Apply selectors to extract data
 * 4. Validate and store results
 * 5. Update extraction stats
 */

import { chromium, Page, Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// ============================================================
// Types
// ============================================================

interface ExtractedVehicle {
  url: string;
  title: string;
  price: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  image_url: string | null;
  mileage: number | null;
}

interface SourceWithConfig {
  source_id: string;
  source_name: string;
  source_url: string;
  organization_id: string | null;
  config: {
    selector_hints: Record<string, string>;
    page_structure_notes: string;
    requires_js_rendering: boolean;
    recommended_extraction_method: string;
  };
}

// ============================================================
// Extraction Functions
// ============================================================

async function extractWithConfig(
  page: Page,
  config: SourceWithConfig
): Promise<ExtractedVehicle[]> {
  const selectors = config.config.selector_hints;

  if (!selectors?.vehicle_card) {
    console.log('  ⚠ No vehicle_card selector configured');
    return [];
  }

  // Parse page structure notes for inventory URL
  let inventoryUrl = config.source_url;
  try {
    const notes = JSON.parse(config.config.page_structure_notes || '{}');
    if (notes.inventory_url) {
      inventoryUrl = notes.inventory_url;
    }
  } catch (e) {
    // Use source URL as fallback
  }

  // Navigate to inventory page
  console.log(`  📄 Loading: ${inventoryUrl}`);
  await page.goto(inventoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Scroll to trigger lazy loading
  for (let i = 0; i < 3; i++) {
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), 400 * (i + 1));
    await page.waitForTimeout(500);
  }

  // Extract vehicles using configured selectors
  const vehicles = await page.evaluate((sel) => {
    const cards = document.querySelectorAll(sel.vehicle_card);
    const results: any[] = [];

    for (const card of Array.from(cards)) {
      const vehicle: any = {};

      // Extract URL
      if (sel.vehicle_link) {
        const link = card.querySelector(sel.vehicle_link) as HTMLAnchorElement;
        vehicle.url = link?.href || null;
      }
      if (!vehicle.url) {
        const anyLink = card.querySelector('a[href]') as HTMLAnchorElement;
        vehicle.url = anyLink?.href || null;
      }

      // Extract title
      if (sel.title) {
        const title = card.querySelector(sel.title);
        vehicle.title = title?.textContent?.trim() || null;
      }
      if (!vehicle.title) {
        // Try common title selectors
        const h = card.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]');
        vehicle.title = h?.textContent?.trim() || null;
      }

      // Extract price
      if (sel.price) {
        const price = card.querySelector(sel.price);
        const priceText = price?.textContent?.match(/\$[\d,]+/)?.[0];
        vehicle.price = priceText ? parseInt(priceText.replace(/[$,]/g, '')) : null;
      }

      // Extract image
      if (sel.image) {
        const img = card.querySelector(sel.image) as HTMLImageElement;
        vehicle.image_url = img?.src || img?.getAttribute('data-src') || null;
      }
      if (!vehicle.image_url) {
        const anyImg = card.querySelector('img') as HTMLImageElement;
        vehicle.image_url = anyImg?.src || anyImg?.getAttribute('data-src') || null;
      }

      // Only include if we have URL or title
      if (vehicle.url || vehicle.title) {
        results.push(vehicle);
      }
    }

    return results;
  }, selectors);

  // Parse year/make/model from titles and URLs
  const parsedVehicles: ExtractedVehicle[] = vehicles.map(v => {
    const titleAndUrl = (v.title || '') + ' ' + (v.url || '').replace(/[-_]/g, ' ');

    // Parse year (1910-2026)
    const yearMatch = titleAndUrl.match(/\b(19[1-9]\d|20[0-2]\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Parse make
    const makes = [
      'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac',
      'Mercedes', 'BMW', 'Porsche', 'Ferrari', 'Jaguar', 'Aston Martin', 'Lamborghini',
      'Audi', 'Volkswagen', 'Toyota', 'Nissan', 'Honda', 'Mazda', 'Lexus',
      'Jeep', 'Lincoln', 'Chrysler', 'Bentley', 'Rolls Royce', 'Maserati',
      'Alfa Romeo', 'McLaren', 'Lotus', 'MG', 'Triumph', 'Datsun', 'Packard', 'Studebaker',
    ];
    let make: string | null = null;
    for (const m of makes) {
      if (new RegExp(`\\b${m.replace(/[- ]/g, '[-_ ]?')}\\b`, 'i').test(titleAndUrl)) {
        make = m === 'Chevy' ? 'Chevrolet' : m;
        break;
      }
    }

    // Parse model (text after make)
    let model: string | null = null;
    if (make) {
      const afterMake = titleAndUrl.split(new RegExp(make, 'i'))[1];
      if (afterMake) {
        model = afterMake.replace(/^[\s\-:]+/, '').trim().split(/\s+/).slice(0, 3).join(' ')
          .replace(/\$[\d,]+/g, '').replace(/\d{5,}/g, '').trim();
        if (model.length < 2) model = null;
      }
    }

    return {
      url: v.url,
      title: v.title,
      price: v.price,
      year,
      make,
      model,
      image_url: v.image_url,
      mileage: null,
    };
  });

  return parsedVehicles;
}

async function saveVehicles(
  vehicles: ExtractedVehicle[],
  organizationId: string | null
): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  for (const vehicle of vehicles) {
    if (!vehicle.url) {
      skipped++;
      continue;
    }

    // Check if we already have this listing
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('listing_url', vehicle.url)
      .limit(1);

    if (existing?.length) {
      skipped++;
      continue;
    }

    // Quality check: require at least year OR make
    if (!vehicle.year && !vehicle.make) {
      skipped++;
      continue;
    }

    // Insert vehicle
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        year: vehicle.year,
        make: vehicle.make || 'Unknown',
        model: vehicle.model || 'Unknown',
        price: vehicle.price,
        listing_url: vehicle.url,
        listing_title: vehicle.title,
        listing_source: 'intelligent_extractor',
        primary_image_url: vehicle.image_url,
      })
      .select()
      .single();

    if (error) {
      console.log(`    ⚠ DB error: ${error.message}`);
      skipped++;
      continue;
    }

    // Link to organization if provided
    if (organizationId && newVehicle) {
      const { error: linkError } = await supabase.from('organization_vehicles').insert({
        organization_id: organizationId,
        vehicle_id: newVehicle.id,
        relationship_type: 'seller',
        auto_tagged: true,
        status: 'active',
      });
      // Ignore errors (e.g., if already exists)
    }

    saved++;
  }

  return { saved, skipped };
}

async function updateExtractionStats(
  sourceId: string,
  vehiclesExtracted: number,
  success: boolean
): Promise<void> {
  // Update source_intelligence with extraction stats
  const { data: intel } = await supabase
    .from('source_intelligence')
    .select('id, vehicles_extracted, extraction_success_rate')
    .eq('source_id', sourceId)
    .single();

  if (intel) {
    const totalExtracted = (intel.vehicles_extracted || 0) + vehiclesExtracted;
    const prevRate = intel.extraction_success_rate || 0;
    const newRate = success ? Math.min(1, prevRate * 0.9 + 0.1) : prevRate * 0.9;

    await supabase
      .from('source_intelligence')
      .update({
        vehicles_extracted: totalExtracted,
        extraction_success_rate: newRate,
        last_extraction_at: new Date().toISOString(),
      })
      .eq('id', intel.id);
  }
}

// ============================================================
// Main Entry Point
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('INTELLIGENT EXTRACTOR');
  console.log('Using stored configs for reliable extraction');
  console.log('='.repeat(60));

  const sourcesToExtract: SourceWithConfig[] = [];

  // Get businesses with extraction configs in metadata
  const { data: businesses, error: bizError } = await supabase
    .from('businesses')
    .select('id, business_name, website, metadata')
    .not('metadata', 'is', null)
    .not('website', 'is', null);

  if (businesses) {
    for (const biz of businesses) {
      const config = biz.metadata?.extraction_config;
      if (config?.selector_hints?.vehicle_card) {
        sourcesToExtract.push({
          source_id: biz.id,
          source_name: biz.business_name,
          source_url: biz.website,
          organization_id: biz.id,
          config: {
            selector_hints: config.selector_hints,
            page_structure_notes: config.page_structure_notes || '{}',
            requires_js_rendering: config.requires_js_rendering ?? true,
            recommended_extraction_method: config.recommended_extraction_method || 'playwright',
          },
        });
      }
    }
  }

  // Also get sources with extraction configs from source_intelligence
  const { data: sources, error } = await supabase
    .from('source_intelligence')
    .select(`
      id,
      source_id,
      selector_hints,
      page_structure_notes,
      requires_js_rendering,
      recommended_extraction_method,
      scrape_sources (
        id,
        name,
        url,
        business_id
      )
    `)
    .not('selector_hints', 'is', null)
    .gt('extraction_priority', 0)
    .order('extraction_priority', { ascending: false });

  if (sources) {
    for (const s of sources) {
      if (s.scrape_sources && s.selector_hints?.vehicle_card) {
        sourcesToExtract.push({
          source_id: s.source_id,
          source_name: s.scrape_sources.name,
          source_url: s.scrape_sources.url,
          organization_id: s.scrape_sources.business_id,
          config: {
            selector_hints: s.selector_hints as Record<string, string>,
            page_structure_notes: s.page_structure_notes || '{}',
            requires_js_rendering: s.requires_js_rendering ?? true,
            recommended_extraction_method: s.recommended_extraction_method || 'playwright',
          },
        });
      }
    }
  }

  // Limit to requested count
  const limit = parseInt(process.argv[2]) || 20;
  const toExtract = sourcesToExtract.slice(0, limit);

  if (toExtract.length === 0) {
    console.log('No sources with extraction configs found');
    console.log('Run ai-extraction-architect.ts first to generate configs');
    return;
  }

  console.log(`\nFound ${sourcesToExtract.length} sources with configs, processing ${toExtract.length}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  let totalSaved = 0;
  let totalSkipped = 0;

  for (const source of toExtract) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Source: ${source.source_name}`);
    console.log(`URL: ${source.source_url}`);

    try {
      const page = await context.newPage();
      const vehicles = await extractWithConfig(page, source);
      await page.close();

      console.log(`  📊 Extracted ${vehicles.length} vehicles`);

      if (vehicles.length > 0) {
        const { saved, skipped } = await saveVehicles(vehicles, source.organization_id);
        totalSaved += saved;
        totalSkipped += skipped;
        console.log(`  ✅ Saved: ${saved}, Skipped: ${skipped}`);

        await updateExtractionStats(source.source_id, saved, true);
      } else {
        await updateExtractionStats(source.source_id, 0, false);
        console.log(`  ⚠ No vehicles found`);
      }

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
      await updateExtractionStats(source.source_id, 0, false);
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETE: Saved ${totalSaved}, Skipped ${totalSkipped}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
