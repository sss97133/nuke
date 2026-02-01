import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * COMPLETE LMC TRUCK CATALOG PARSER
 * 
 * Scrapes the ENTIRE LMC Truck catalog (all categories, all parts)
 * Target: 5,000-10,000 parts for 1973-1987 Chevy/GMC trucks
 */

const COMPLETE_CATALOG_STRUCTURE = {
  // BODY & EXTERIOR (est. 2000 parts)
  exterior: [
    'bumpers-and-brackets/front-bumpers',
    'bumpers-and-brackets/rear-bumpers',
    'bumpers-and-brackets/bumper-brackets',
    'grilles-and-related/grilles',
    'grilles-and-related/grille-moldings',
    'headlights-and-bezels/headlights',
    'headlights-and-bezels/headlight-bezels',
    'headlights-and-bezels/parking-lights',
    'taillights/taillight-assemblies',
    'taillights/taillight-lenses',
    'taillights/backup-lights',
    'fenders/front-fenders',
    'fenders/fender-flares',
    'hoods-and-hinges/hoods',
    'hoods-and-hinges/hood-hinges',
    'hoods-and-hinges/hood-latches',
    'doors/door-shells',
    'doors/door-handles-exterior',
    'doors/door-locks',
    'doors/door-hinges',
    'doors/door-weatherstrip',
    'bed-and-tailgate/bed-sides',
    'bed-and-tailgate/tailgates',
    'bed-and-tailgate/bed-floors',
    'bed-and-tailgate/bed-strips',
    'running-boards-and-steps',
    'mirrors/side-mirrors',
    'mirrors/mirror-brackets',
    'trim/body-trim',
    'trim/window-trim',
    'trim/drip-rails',
    'emblems-and-nameplates',
    'weatherstrip/door-weatherstrip',
    'weatherstrip/window-weatherstrip',
    'glass/windshields',
    'glass/door-glass',
    'glass/vent-glass'
  ],
  
  // INTERIOR (est. 1500 parts)
  interior: [
    'dash-components/dash-pads',
    'dash-components/dash-bezels',
    'dash-components/instrument-clusters',
    'dash-components/instrument-lenses',
    'dash-components/gauges',
    'dash-components/glove-boxes',
    'dash-components/ash-trays',
    'dash-components/air-vents',
    'dash-components/heater-controls',
    'dash-components/radio-bezels',
    'steering-wheels-and-columns/steering-wheels',
    'steering-wheels-and-columns/steering-columns',
    'steering-wheels-and-columns/turn-signal-levers',
    'seats/seat-covers',
    'seats/seat-frames',
    'seats/seat-tracks',
    'seats/seat-belts',
    'door-panels/door-panels',
    'door-panels/arm-rests',
    'door-panels/window-cranks',
    'door-panels/door-handles-interior',
    'carpet-and-insulation/carpet-sets',
    'carpet-and-insulation/floor-mats',
    'headliners',
    'sun-visors',
    'consoles',
    'pedals/gas-pedals',
    'pedals/brake-pedals',
    'pedals/clutch-pedals'
  ],
  
  // ENGINE (est. 1500 parts)
  engine: [
    'engine-blocks',
    'cylinder-heads',
    'pistons-and-rings',
    'crankshafts',
    'camshafts',
    'timing-components',
    'carburetors',
    'fuel-injection',
    'fuel-pumps',
    'fuel-lines',
    'air-cleaners',
    'intake-manifolds',
    'exhaust-manifolds',
    'headers',
    'exhaust-systems',
    'mufflers',
    'water-pumps',
    'thermostats',
    'radiators',
    'radiator-hoses',
    'heater-hoses',
    'alternators',
    'starters',
    'distributors',
    'ignition-coils',
    'spark-plugs',
    'spark-plug-wires',
    'belts',
    'pulleys',
    'motor-mounts',
    'oil-pans',
    'oil-pumps',
    'valve-covers',
    'gasket-sets'
  ],
  
  // DRIVETRAIN (est. 800 parts)
  drivetrain: [
    'transmissions/transmission-assemblies',
    'transmissions/transmission-pans',
    'transmissions/shifters',
    'transfer-cases',
    'driveshafts/front-driveshafts',
    'driveshafts/rear-driveshafts',
    'u-joints',
    'axles/front-axles',
    'axles/rear-axles',
    'differentials',
    'ring-and-pinion',
    'axle-shafts',
    'clutch-kits',
    'flywheels'
  ],
  
  // SUSPENSION (est. 600 parts)
  suspension: [
    'springs/front-springs',
    'springs/rear-springs',
    'shocks/front-shocks',
    'shocks/rear-shocks',
    'control-arms/upper-control-arms',
    'control-arms/lower-control-arms',
    'ball-joints/upper-ball-joints',
    'ball-joints/lower-ball-joints',
    'tie-rods',
    'steering-linkage',
    'bushings',
    'sway-bars',
    'leaf-spring-bushings',
    'shackles'
  ],
  
  // BRAKES (est. 500 parts)
  brakes: [
    'brake-pads/front-pads',
    'brake-pads/rear-pads',
    'brake-shoes',
    'rotors/front-rotors',
    'rotors/rear-rotors',
    'drums',
    'calipers/front-calipers',
    'calipers/rear-calipers',
    'wheel-cylinders',
    'master-cylinders',
    'brake-boosters',
    'brake-lines',
    'brake-hoses',
    'proportioning-valves',
    'parking-brake-cables'
  ],
  
  // ELECTRICAL (est. 800 parts)
  electrical: [
    'wiring-harnesses/engine-harnesses',
    'wiring-harnesses/dash-harnesses',
    'wiring-harnesses/chassis-harnesses',
    'switches/ignition-switches',
    'switches/light-switches',
    'switches/wiper-switches',
    'gauges/speedometers',
    'gauges/tachometers',
    'gauges/fuel-gauges',
    'gauges/temp-gauges',
    'lighting/dome-lights',
    'lighting/courtesy-lights',
    'lighting/underhood-lights',
    'batteries',
    'battery-cables',
    'voltage-regulators',
    'horns',
    'flashers',
    'fuse-blocks',
    'relays'
  ],
  
  // CHASSIS & FRAME (est. 400 parts)
  chassis: [
    'frame-components',
    'crossmembers',
    'body-mounts',
    'cab-mounts',
    'bed-mounts',
    'radiator-supports',
    'core-supports'
  ],
  
  // WHEELS & TIRES (est. 300 parts)
  wheels: [
    'wheels/steel-wheels',
    'wheels/aluminum-wheels',
    'wheel-covers',
    'center-caps',
    'lug-nuts',
    'wheel-bearings',
    'hub-caps'
  ],
  
  // COOLING & HEATING (est. 400 parts)
  climate: [
    'radiators',
    'radiator-caps',
    'fan-shrouds',
    'cooling-fans',
    'fan-clutches',
    'heater-cores',
    'heater-boxes',
    'heater-hoses',
    'ac-compressors',
    'ac-condensers',
    'ac-hoses'
  ],
  
  // FUEL SYSTEM (est. 300 parts)
  fuel: [
    'fuel-tanks',
    'fuel-sending-units',
    'fuel-caps',
    'fuel-lines',
    'fuel-filters',
    'carburetors',
    'throttle-linkage'
  ]
};

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log('Starting COMPLETE LMC catalog scrape...');
    
    const { category, maxPartsPerCategory = 200 } = await req.json().catch(() => ({}));
    
    // Build category list
    let allCategories: string[] = [];
    if (category) {
      allCategories = [category];
    } else {
      // Scrape EVERYTHING
      for (const [section, categories] of Object.entries(COMPLETE_CATALOG_STRUCTURE)) {
        allCategories.push(...categories);
      }
    }
    
    console.log(`Total categories to scrape: ${allCategories.length}`);
    
    let totalParts = 0;
    let successfulCategories = 0;
    let failedCategories = 0;
    const sampleParts = [];
    
    // Get LMC supplier ID
    const { data: lmcSupplier } = await supabase
      .from('part_suppliers')
      .select('id')
      .eq('supplier_name', 'LMC Truck')
      .single();
    
    if (!lmcSupplier) {
      throw new Error('LMC Truck supplier not found in database');
    }
    
    // Scrape each category
    for (let i = 0; i < allCategories.length; i++) {
      const catPath = allCategories[i];
      console.log(`[${i+1}/${allCategories.length}] Scraping: ${catPath}`);
      
      try {
        const url = `https://www.lmctruck.com/chevy-gmc-truck-1973-1987/${catPath}`;
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml'
          }
        });
        
        if (!response.ok) {
          console.warn(`HTTP ${response.status} for ${catPath}`);
          failedCategories++;
          continue;
        }
        
        const html = await response.text();
        const parts = parsePartsFromHTML(html, catPath, lmcSupplier.id);
        
        console.log(`  → Found ${parts.length} parts`);
        
        // Batch insert
        if (parts.length > 0) {
          const { error } = await supabase
            .from('part_catalog')
            .upsert(parts.slice(0, maxPartsPerCategory), {
              onConflict: 'oem_part_number',
              ignoreDuplicates: false
            });
          
          if (error) {
            console.error(`  → Insert error: ${error.message}`);
          } else {
            totalParts += parts.length;
            successfulCategories++;
            
            if (sampleParts.length < 10) {
              sampleParts.push(...parts.slice(0, 2));
            }
          }
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`  → Error: ${error.message}`);
        failedCategories++;
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    return new Response(JSON.stringify({
      success: true,
      total_parts_scraped: totalParts,
      categories_attempted: allCategories.length,
      categories_successful: successfulCategories,
      categories_failed: failedCategories,
      duration_seconds: parseFloat(duration),
      sample_parts: sampleParts.slice(0, 5),
      message: `Scraped ${totalParts} parts from ${successfulCategories} categories in ${duration}s`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error: any) {
    console.error('Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

function parsePartsFromHTML(html: string, categoryPath: string, supplierId: string) {
  const parts = [];
  const categoryName = categoryPath.split('/').pop()?.replace(/-/g, ' ') || 'unknown';
  
  // LMC uses multiple page structures - try all patterns
  
  // Pattern 1: Product cards with data-sku
  const productCardRegex = /<div[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]{0,2000}?)<\/div>/gi;
  const cards = Array.from(html.matchAll(productCardRegex));
  
  for (const card of cards) {
    const cardHTML = card[1];
    
    // Part number
    let partNumber = null;
    const partPatterns = [
      /data-sku=["']([^"']+)["']/i,
      /sku["']?\s*:\s*["']([^"']+)["']/i,
      /part[_-]?number["']?\s*:\s*["']([^"']+)["']/i,
      /<span[^>]*class="[^"]*sku[^"]*"[^>]*>([^<]+)<\/span>/i
    ];
    for (const pattern of partPatterns) {
      const match = cardHTML.match(pattern);
      if (match) {
        partNumber = match[1].trim();
        break;
      }
    }
    
    // Name
    let name = null;
    const namePatterns = [
      /<h[2-4][^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h[2-4]>/i,
      /<div[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/div>/i,
      /<span[^>]*class="[^"]*product-name[^"]*"[^>]*>([^<]+)<\/span>/i
    ];
    for (const pattern of namePatterns) {
      const match = cardHTML.match(pattern);
      if (match) {
        name = match[1].replace(/<[^>]+>/g, '').trim();
        break;
      }
    }
    
    // Price
    let price = null;
    const priceMatch = cardHTML.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
    if (priceMatch) {
      price = parseFloat(priceMatch[1]);
    }
    
    // Fitment
    const fitsMatch = cardHTML.match(/(?:fits|for)[\s:]*([0-9]{4})\s*-\s*([0-9]{4})/i);
    const yearStart = fitsMatch ? parseInt(fitsMatch[1]) : 1973;
    const yearEnd = fitsMatch ? parseInt(fitsMatch[2]) : 1987;
    
    // Image
    const imgMatch = cardHTML.match(/<img[^>]+src=["']([^"']+)["']/i);
    const imageUrl = imgMatch ? imgMatch[1] : null;
    
    if (partNumber && name) {
      parts.push({
        part_name: name.substring(0, 255),
        oem_part_number: partNumber.substring(0, 50),
        category: categoryPath.split('/')[0],
        subcategory: categoryName,
        fits_makes: ['Chevrolet', 'GMC'],
        fits_models: ['C10', 'C1500', 'C20', 'C2500', 'K10', 'K1500', 'K20', 'K2500', 'Blazer', 'Suburban', 'Jimmy'],
        fits_years: `[${yearStart},${yearEnd}]`,
        description: `${name} for ${yearStart}-${yearEnd} Chevy/GMC trucks`,
        part_image_urls: imageUrl ? [imageUrl] : [],
        supplier_listings: JSON.stringify([{
          supplier_id: supplierId,
          supplier_name: 'LMC Truck',
          price_cents: Math.round((price || 0) * 100),
          url: `https://www.lmctruck.com/chevy-gmc-truck-1973-1987/${categoryPath}#${partNumber}`,
          in_stock: true,
          last_checked: new Date().toISOString()
        }])
      });
    }
  }
  
  // Pattern 2: Table rows (older LMC pages)
  if (parts.length === 0) {
    const tableRows = html.matchAll(/<tr[^>]*>([\s\S]{0,1000}?)<\/tr>/gi);
    
    for (const row of tableRows) {
      const rowHTML = row[1];
      
      const cells = Array.from(rowHTML.matchAll(/<td[^>]*>(.*?)<\/td>/gi));
      if (cells.length >= 2) {
        const partNumber = cells[0]?.[1]?.replace(/<[^>]+>/g, '').trim();
        const name = cells[1]?.[1]?.replace(/<[^>]+>/g, '').trim();
        const priceMatch = cells[2]?.[1]?.match(/\$([0-9.]+)/);
        const price = priceMatch ? parseFloat(priceMatch[1]) : null;
        
        if (partNumber && name) {
          parts.push({
            part_name: name.substring(0, 255),
            oem_part_number: partNumber.substring(0, 50),
            category: categoryPath.split('/')[0],
            subcategory: categoryName,
            fits_makes: ['Chevrolet', 'GMC'],
            fits_models: ['C10', 'C1500', 'K10', 'K1500', 'Blazer', 'Suburban'],
            fits_years: '[1973,1987]',
            description: `${name} for 1973-1987 Chevy/GMC trucks`,
            part_image_urls: [],
            supplier_listings: JSON.stringify([{
              supplier_id: supplierId,
              supplier_name: 'LMC Truck',
              price_cents: Math.round((price || 0) * 100),
              url: `https://www.lmctruck.com/chevy-gmc-truck-1973-1987/${categoryPath}#${partNumber}`,
              in_stock: true,
              last_checked: new Date().toISOString()
            }])
          });
        }
      }
    }
  }
  
  return parts;
}

