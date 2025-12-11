import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to clean model name - removes pricing, dealer info, financing text, etc.
function cleanModelName(model: string): string {
  if (!model) return '';
  
  let cleaned = model.trim();
  
  // Remove pricing patterns: "- $X,XXX", "$X,XXX", "(Est. payment OAC†)"
  cleaned = cleaned.replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?/g, '');
  cleaned = cleaned.replace(/\s*\(\s*Est\.\s*payment\s*OAC[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\(\s*\$[\d,]+\s*Est\.\s*payment[^)]*\)/gi, '');
  
  // Remove dealer info: "(Dealer Name)", "(Location)", "(Call XXX)"
  cleaned = cleaned.replace(/\s*\([^)]*call[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*\(?\d{3}\)?\s*[\d-]+\s*\)/g, '');
  cleaned = cleaned.replace(/\s*\([A-Z][a-z]+\s*[A-Z][a-z]+(?:\s*[A-Z][a-z]+)?\)/g, '');
  
  // Remove financing text: "(BUY HERE PAY HERE...)", "(Get Financed Now!)"
  cleaned = cleaned.replace(/\s*\([^)]*financ[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*credit[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*buy\s+here[^)]*\)/gi, '');
  
  // Remove SKU/stock numbers: "SKU:XXX", "Stock #:XXX"
  cleaned = cleaned.replace(/\s*SKU\s*:\s*\w+/gi, '');
  cleaned = cleaned.replace(/\s*Stock\s*#?\s*:\s*\w+/gi, '');
  
  // Remove BaT platform text
  cleaned = cleaned.replace(/\s*on\s*BaT\s*Auctions?\s*-?\s*ending[^|]*/gi, '');
  cleaned = cleaned.replace(/\s*\(Lot\s*#?\s*[\d,]+\)/gi, '');
  cleaned = cleaned.replace(/\s*\|\s*Bring\s*a\s*Trailer/gi, '');
  
  // Remove common descriptors that shouldn't be in model
  cleaned = cleaned.replace(/\s*\b(classic|vintage|restored|clean|mint|excellent|beautiful|collector['s]?)\b/gi, '');
  
  // Remove parenthetical content that looks like dealer info
  cleaned = cleaned.replace(/\s*\([^)]{20,}\)/g, ''); // Long parentheticals (likely dealer info)
  
  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

// Helper function to validate make against known makes list
function isValidMake(make: string): boolean {
  if (!make) return false;
  
  const makeLower = make.toLowerCase();
  
  // Known valid makes
  const validMakes = [
    'chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'ram', 'toyota', 'honda', 'nissan',
    'bmw', 'mercedes', 'benz', 'mercedes-benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar',
    'cadillac', 'buick', 'pontiac', 'oldsmobile', 'lincoln', 'chrysler', 'jeep',
    'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi', 'suzuki',
    'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'alfa romeo', 'fiat', 'mini',
    'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'aston martin', 'bentley', 'rolls', 'royce', 'rolls-royce',
    'datsun', 'mercury', 'saturn', 'oldsmobile', 'plymouth', 'eagle', 'isuzu', 'saab'
  ];
  
  // Check if make is in valid list
  if (validMakes.includes(makeLower)) return true;
  
  // Check for two-word makes
  if (makeLower.includes('alfa romeo') || makeLower.includes('alfa-romeo')) return true;
  if (makeLower.includes('aston martin') || makeLower.includes('aston-martin')) return true;
  if (makeLower.includes('rolls royce') || makeLower.includes('rolls-royce')) return true;
  if (makeLower.includes('mercedes benz') || makeLower.includes('mercedes-benz')) return true;
  
  // Invalid makes (descriptors, colors, adjectives)
  const invalidMakes = [
    'used', 'restored', 'beautiful', 'collector', 'collectors', 'classic', 'featured',
    'vintage', 'custom', 'clean', 'mint', 'excellent', 'good', 'fair',
    'silver', 'black', 'white', 'red', 'blue', 'green', 'yellow', 'gray', 'grey',
    'fuel-injected', 'powered', 'owned', 'half-scale', 'exotic',
    '10k-mile', '18k-mile', '47k-mile', '20-years-owned', '5k-mile'
  ];
  
  if (invalidMakes.includes(makeLower)) return false;
  
  // If it's a single word and not in valid list, likely invalid
  if (make.split(/\s+/).length === 1 && !validMakes.includes(makeLower)) {
    return false;
  }
  
  return true;
}

// Helper function to extract price from text, avoiding monthly payments
function extractVehiclePrice(text: string): number | null {
  if (!text) return null;
  
  // First, try to find structured price fields
  const structuredPatterns = [
    /Price[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
    /Asking[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
    /Sale\s+Price[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
    /Vehicle\s+Price[:\s]*\$?([\d,]+(?:\.\d{2})?)/i
  ];
  
  for (const pattern of structuredPatterns) {
    const match = text.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ''));
      if (price >= 1000 && price < 10000000) {
        return price;
      }
    }
  }
  
  // Avoid monthly payment patterns
  if (text.match(/Est\.\s*payment|Monthly\s*payment|OAC[†]?/i)) {
    // Look for actual vehicle price, not monthly payment
    const vehiclePriceMatch = text.match(/(?:Price|Asking|Sale)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
    if (vehiclePriceMatch) {
      const price = parseInt(vehiclePriceMatch[1].replace(/,/g, ''));
      if (price >= 1000 && price < 10000000) {
        return price;
      }
    }
    return null; // Don't extract if only monthly payment found
  }
  
  // Extract all prices and prefer the largest (vehicle prices are typically $5,000+)
  const priceMatches = text.match(/\$([\d,]+(?:\.\d{2})?)/g);
  if (priceMatches) {
    const prices = priceMatches.map(m => parseInt(m.replace(/[$,]/g, '')));
    const validPrices = prices.filter(p => p >= 1000 && p < 10000000);
    if (validPrices.length > 0) {
      // Return the largest valid price (likely the vehicle price)
      return Math.max(...validPrices);
    }
  }
  
  return null;
}

interface ProcessRequest {
  batch_size?: number;
  priority_only?: boolean;
  source_id?: string;
}

/**
 * Trigger dealer website inventory sync
 * This queues a scrape of the dealer's full website inventory
 */
async function triggerDealerInventorySync(orgId: string, website: string, supabase: any) {
  try {
    // Check if sync was already triggered recently (within 24 hours)
    const { data: recentSync } = await supabase
      .from('organizations')
      .select('last_inventory_sync')
      .eq('id', orgId)
      .single();
    
    if (recentSync?.last_inventory_sync) {
      const lastSync = new Date(recentSync.last_inventory_sync);
      const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
      if (hoursSinceSync < 24) {
        console.log(`⏭️  Inventory sync skipped (synced ${hoursSinceSync.toFixed(1)}h ago)`);
        return;
      }
    }
    
    // Trigger scrape-multi-source function to scrape dealer website
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        source_url: website,
        source_type: 'dealer_website',
        organization_id: orgId,
        max_results: 100 // Scrape up to 100 vehicles
      })
    });
    
    if (response.ok) {
      console.log(`✅ Triggered inventory sync for ${website}`);
      // Update last_inventory_sync timestamp
      await supabase
        .from('organizations')
        .update({ last_inventory_sync: new Date().toISOString() })
        .eq('id', orgId);
    } else {
      throw new Error(`Sync trigger failed: ${response.status}`);
    }
  } catch (error: any) {
    console.error(`❌ Failed to trigger inventory sync: ${error.message}`);
    throw error;
  }
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

    const body: ProcessRequest = await req.json().catch(() => ({}));
    const { batch_size = 20, priority_only = false, source_id } = body;

    // Get pending items from queue - prioritize items with more data
    let query = supabase
      .from('import_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', 3)
      .order('priority', { ascending: false })
      // Prioritize items with year/make/model already known (higher quality)
      .order('listing_year', { ascending: false, nullsLast: true })
      .order('created_at', { ascending: true })
      .limit(batch_size);

    if (priority_only) {
      query = query.gt('priority', 0);
    }

    if (source_id) {
      query = query.eq('source_id', source_id);
    }

    const { data: queueItems, error: queueError } = await query;

    if (queueError) {
      throw new Error(`Failed to fetch queue: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No items to process',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing ${queueItems.length} queue items`);

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      duplicates: 0,
      vehicles_created: [] as string[]
    };

    for (const item of queueItems) {
      try {
        // Mark as processing
        await supabase
          .from('import_queue')
          .update({ 
            status: 'processing',
            attempts: item.attempts + 1
          })
          .eq('id', item.id);

        // Check for duplicate by URL
        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('id')
          .eq('discovery_url', item.listing_url)
          .single();

        if (existingVehicle) {
          await supabase
            .from('import_queue')
            .update({
              status: 'duplicate',
              vehicle_id: existingVehicle.id,
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id);
          
          results.duplicates++;
          results.processed++;
          continue;
        }

        // Scrape vehicle data - try Firecrawl first, then direct fetch
        console.log('🔍 Scraping URL:', item.listing_url);
        
        let html = '';
        let scrapeSuccess = false;
        const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
        
        // Try Firecrawl first if API key is available (bypasses bot protection)
        // Use timeout to prevent hanging
        if (firecrawlApiKey) {
          try {
            console.log('🔥 Attempting Firecrawl scrape...');
            const firecrawlController = new AbortController();
            const firecrawlTimeout = setTimeout(() => firecrawlController.abort(), 15000); // 15s timeout
            
            const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${firecrawlApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: item.listing_url,
                formats: ['html'],
                pageOptions: {
                  waitFor: 1000, // Reduced wait time
                },
              }),
              signal: firecrawlController.signal
            });

            clearTimeout(firecrawlTimeout);

            if (firecrawlResponse.ok) {
              const firecrawlData = await firecrawlResponse.json();
              if (firecrawlData.success && firecrawlData.data?.html) {
                html = firecrawlData.data.html;
                scrapeSuccess = true;
                console.log('✅ Firecrawl scrape successful');
              } else {
                console.warn('⚠️ Firecrawl returned no HTML');
              }
            } else {
              const errorText = await firecrawlResponse.text().catch(() => '');
              console.warn(`⚠️ Firecrawl failed: ${firecrawlResponse.status} - ${errorText.substring(0, 100)}`);
            }
          } catch (error: any) {
            if (error.name === 'AbortError') {
              console.warn('⚠️ Firecrawl timeout');
            } else {
              console.warn('⚠️ Firecrawl error:', error.message);
            }
            // Fall through to direct fetch
          }
        }
        
        // Fallback to direct fetch if Firecrawl didn't work
        if (!scrapeSuccess) {
          console.log('📡 Using direct fetch (fallback)');
          const fetchController = new AbortController();
          const fetchTimeout = setTimeout(() => fetchController.abort(), 10000); // 10s timeout
          
          try {
            const response = await fetch(item.listing_url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
              },
              signal: fetchController.signal
            });

            clearTimeout(fetchTimeout);

            if (!response.ok) {
              throw new Error(`Scrape failed: ${response.status}`);
            }

            html = await response.text();
          } catch (fetchError: any) {
            clearTimeout(fetchTimeout);
            if (fetchError.name === 'AbortError') {
              throw new Error('Scrape timeout');
            }
            throw fetchError;
          }
        }
        // Remove "Pending Organization Assignments" HTML blocks before parsing
        html = html.replace(/<div[^>]*style="[^"]*padding:\s*12px[^"]*background:\s*rgb\(254,\s*243,\s*199\)[^"]*"[^>]*>[\s\S]*?REJECT<\/div>/gi, '');
        
        // Remove QR code links and junk text
        html = html.replace(/QR\s+Code\s+Link\s+to\s+This\s+Post/gi, '');
        html = html.replace(/<div[^>]*style="[^"]*font-size:\s*9pt[^"]*"[^>]*>[\s\S]*?QR\s+Code[\s\S]*?<\/div>/gi, '');
        html = html.replace(/QR\s+Code[\s\S]{0,200}/gi, '');
        
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Basic data extraction
        const scrapeData: any = {
          success: true,
          data: {
            source: 'Unknown',
            listing_url: item.listing_url,
            discovery_url: item.listing_url,
            title: doc.querySelector('title')?.textContent || '',
            description: '',
            images: extractImageURLs(html),
            timestamp: new Date().toISOString(),
            year: null,
            make: null,
            model: null,
            asking_price: null,
            location: null,
          }
        };

        // Extract VIN from HTML
        const vinPatterns = [
          /<div[^>]*class="[^"]*spec-line[^"]*vin[^"]*"[^>]*>VIN\s+([A-HJ-NPR-Z0-9]{17})/i,
          /<[^>]*class="[^"]*vin[^"]*"[^>]*>[\s\S]*?VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
          /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
          /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
        ];

        for (const pattern of vinPatterns) {
          const match = html.match(pattern);
          if (match && match[1] && match[1].length === 17 && !/[IOQ]/.test(match[1])) {
            scrapeData.data.vin = match[1].toUpperCase();
            break;
          }
        }

        // Helper function to identify if vehicle is a truck
        const isTruck = (make: string, model: string, title: string, description: string): boolean => {
          const searchText = `${make} ${model} ${title} ${description}`.toLowerCase();
          
          // Truck indicators
          const truckKeywords = [
            'truck', 'pickup', 'c10', 'c20', 'c30', 'k10', 'k20', 'k30',
            'c1500', 'c2500', 'c3500', 'k1500', 'k2500', 'k3500',
            'f150', 'f250', 'f350', 'f450', 'f550',
            'ram 1500', 'ram 2500', 'ram 3500',
            'tacoma', 'tundra', 'ranger', 'colorado', 'canyon',
            'silverado', 'sierra', 'titan', 'frontier'
          ];
          
          // Body style indicators
          const bodyStyleKeywords = ['pickup', 'truck', 'crew cab', 'extended cab', 'regular cab', 'shortbed', 'longbed'];
          
          return truckKeywords.some(kw => searchText.includes(kw)) ||
                 bodyStyleKeywords.some(kw => searchText.includes(kw)) ||
                 /^(c|k)\d{1,4}$/i.test(model) ||
                 /^(c|k)\d{4}$/i.test(model);
        };

        // Bring a Trailer parsing - URL pattern is most reliable
        if (item.listing_url.includes('bringatrailer.com')) {
          console.log('🔍 Parsing BaT URL...');
          scrapeData.data.source = 'Bring a Trailer';
          
          // CRITICAL: Parse from URL first - most reliable format: /listing/YEAR-MAKE-MODEL-ID/
          // Pattern: /listing/1992-chevrolet-454-ss-14/
          const urlMatch = item.listing_url.match(/listing\/(\d{4})-([^-]+(?:-[^-]+)*?)-(\d+)\/?$/);
          if (urlMatch) {
            const year = parseInt(urlMatch[1]);
            const makeModelStr = urlMatch[2]; // e.g., "chevrolet-454-ss"
            
            if (year >= 1885 && year <= new Date().getFullYear() + 1) {
              scrapeData.data.year = year;
            }
            
            // Split by hyphens and find make
            const urlParts = makeModelStr.split('-');
            
            // Known makes list (check first 1-2 words)
            const knownMakes = [
              'chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'toyota', 'honda', 'nissan',
              'bmw', 'mercedes', 'benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar',
              'cadillac', 'buick', 'pontiac', 'oldsmobile', 'lincoln', 'chrysler',
              'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi',
              'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'fiat', 'mini',
              'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'bentley', 'rolls', 'royce'
            ];
            
            // Find make (check first 1-2 words)
            let makeFound = false;
            let makeIndex = 0;
            
            // Try single word first
            if (urlParts.length > 0 && knownMakes.includes(urlParts[0].toLowerCase())) {
              makeIndex = 1;
              makeFound = true;
            }
            // Try two words (e.g., "alfa romeo", "aston martin")
            else if (urlParts.length >= 2) {
              const twoWord = `${urlParts[0]}-${urlParts[1]}`.toLowerCase();
              if (knownMakes.includes(twoWord) || 
                  (urlParts[0].toLowerCase() === 'alfa' && urlParts[1].toLowerCase() === 'romeo') ||
                  (urlParts[0].toLowerCase() === 'aston' && urlParts[1].toLowerCase() === 'martin') ||
                  (urlParts[0].toLowerCase() === 'rolls' && urlParts[1].toLowerCase() === 'royce')) {
                makeIndex = 2;
                makeFound = true;
              }
            }
            
            if (makeFound) {
              // Extract make
              let makeParts = urlParts.slice(0, makeIndex);
              let make = makeParts.join(' ').toLowerCase();
              if (make === 'chevy') make = 'chevrolet';
              if (make === 'vw') make = 'volkswagen';
              if (make === 'benz') make = 'mercedes';
              if (make === 'alfa romeo' || make === 'alfa-romeo') make = 'Alfa Romeo';
              if (make === 'aston martin' || make === 'aston-martin') make = 'Aston Martin';
              if (make === 'rolls royce' || make === 'rolls-royce') make = 'Rolls-Royce';
              scrapeData.data.make = make.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              
              // Extract model (rest of URL parts, but filter out common BaT suffixes)
              const modelParts = urlParts.slice(makeIndex);
              if (modelParts.length > 0) {
                let model = modelParts.join(' ').trim();
                // Filter out common BaT-specific terms that might be in the URL
                model = model.replace(/\s*on\s*bat\s*auctions?/i, '');
                model = model.replace(/\s*ending\s+\w+\s+\d+/i, '');
                model = model.replace(/\s*lot\s*#?\d+/i, '');
                model = model.replace(/\s*\|\s*bring\s*a\s*trailer/i, '');
                // Clean model name
                model = cleanModelName(model);
                scrapeData.data.model = model.trim();
              }
              
              console.log(`✅ BaT URL parsed: ${scrapeData.data.year} ${scrapeData.data.make} ${scrapeData.data.model}`);
            } else {
              // Fallback: assume first word is make (but validate it)
              if (urlParts.length >= 2) {
                let make = urlParts[0].toLowerCase();
                if (make === 'chevy') make = 'chevrolet';
                
                // Only use if valid make
                if (isValidMake(make)) {
                  scrapeData.data.make = make.charAt(0).toUpperCase() + make.slice(1);
                  let model = urlParts.slice(1).join(' ').trim();
                  model = cleanModelName(model);
                  scrapeData.data.model = model;
                  console.log(`⚠️ BaT URL parsed (fallback): ${scrapeData.data.year} ${scrapeData.data.make} ${scrapeData.data.model}`);
                } else {
                  console.log(`❌ Invalid make from BaT URL: ${make}`);
                }
              }
            }
          }
          
          // Extract comprehensive data from BaT HTML
          const bodyText = doc.body?.textContent || '';
          
          // Extract description (main content)
          const descriptionEl = doc.querySelector('.post-content, .listing-description, .auction-description, [class*="description"]');
          if (descriptionEl) {
            const descText = descriptionEl.textContent?.trim() || '';
            if (descText.length > 50) {
              scrapeData.data.description = descText.substring(0, 2000); // Limit to 2000 chars
            }
          }
          
          // Extract mileage - handle "89k Miles", "31k Miles Shown", etc.
          const mileagePatterns = [
            /(\d+(?:,\d+)?)\s*k\s*Miles?\s*(?:Shown)?/i,
            /(\d+(?:,\d+)?)\s*Miles?\s*Shown/i,
            /(\d+(?:,\d+)?)\s*Miles?/i,
            /Odometer[:\s]*(\d+(?:,\d+)?)\s*k?/i
          ];
          for (const pattern of mileagePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              let miles = parseInt(match[1].replace(/,/g, ''));
              if (match[0].toLowerCase().includes('k')) {
                miles = miles * 1000;
              }
              if (miles > 0 && miles < 10000000) {
                scrapeData.data.mileage = miles;
                break;
              }
            }
          }
          
          // Extract price - use helper function to avoid monthly payments
          const extractedPrice = extractVehiclePrice(bodyText);
          if (extractedPrice) {
            scrapeData.data.asking_price = extractedPrice;
          }
          
          // Extract color - "finished in Golf Blue", "Golf Blue over black"
          const colorPatterns = [
            /finished\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+over\s+[a-z]+/i,
            /Color[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
            /Exterior[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
          ];
          for (const pattern of colorPatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1].length < 30) {
              scrapeData.data.color = match[1].trim();
              scrapeData.data.exterior_color = match[1].trim();
              break;
            }
          }
          
          // Extract engine - "1,720cc flat-four", "350 V8", "5.7L V8"
          const enginePatterns = [
            /(\d+(?:,\d+)?)\s*cc\s+([a-z-]+)/i,
            /(\d+\.?\d*)\s*[Ll]iter\s+V?(\d+)/i,
            /(\d+)\s*V(\d+)/i,
            /Engine[:\s]*([^.\n]+)/i
          ];
          for (const pattern of enginePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              if (match[2]) {
                scrapeData.data.engine_type = `${match[1]}${match[2] ? ' ' + match[2] : ''}`.trim();
              } else if (match[1]) {
                scrapeData.data.engine_type = match[1].trim();
              }
              break;
            }
          }
          
          // Extract transmission - "five-speed manual", "automatic", "5-Speed"
          const transPatterns = [
            /(\d+)[-\s]*Speed\s+(Manual|Automatic)/i,
            /(Manual|Automatic)\s+transaxle/i,
            /(Manual|Automatic)\s+transmission/i,
            /Transmission[:\s]*([^.\n]+)/i
          ];
          for (const pattern of transPatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              if (match[2]) {
                scrapeData.data.transmission = `${match[1]}-Speed ${match[2]}`;
              } else if (match[1]) {
                scrapeData.data.transmission = match[1];
              }
              break;
            }
          }
          
          // Extract location - "Located in United States", "California"
          const locationPatterns = [
            /Located\s+in\s+([^.\n]+)/i,
            /Location[:\s]*([^.\n]+)/i
          ];
          for (const pattern of locationPatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1].length < 100) {
              scrapeData.data.location = match[1].trim();
              break;
            }
          }
          
          // Extract VIN
          const vinMatch = bodyText.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
          if (vinMatch) {
            scrapeData.data.vin = vinMatch[1];
          }
          
          // Fallback: Try simple-scraper for images and additional data
          if (scrapeData.data.make && scrapeData.data.model) {
            try {
              const { data: simpleData, error: simpleError } = await supabase.functions.invoke('simple-scraper', {
                body: { url: item.listing_url },
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                }
              });

              if (!simpleError && simpleData?.success && simpleData.data) {
                // Use images and price from simple-scraper
                if (simpleData.data.images && simpleData.data.images.length > 0) {
                  scrapeData.data.images = simpleData.data.images;
                }
                if (simpleData.data.price && !scrapeData.data.asking_price) {
                  scrapeData.data.asking_price = simpleData.data.price;
                }
                if (simpleData.data.title && !scrapeData.data.title) {
                  scrapeData.data.title = simpleData.data.title;
                }
              }
            } catch (batErr: any) {
              console.warn('⚠️ Simple-scraper failed for BaT:', batErr.message);
            }
          } else {
            // Last resort: Parse from HTML title
            const titleElement = doc.querySelector('h1.post-title, h1, .post-title, title');
            if (titleElement) {
              const title = titleElement.textContent?.trim() || '';
              scrapeData.data.title = title;
              
              // Parse from title: "9k-Mile 1992 Chevrolet 454 SS" or "10k-mile 2009 Porsche 911..." or "This 1961 Lincoln..."
              // Remove mileage/ownership descriptors and other prefixes first
              let cleanTitle = title
                .replace(/^\d+k-?mile\s*/gi, '')
                .replace(/^\d+-years?-owned\s*/gi, '')
                .replace(/^\d+,\d+-mile\s*/gi, '')
                .replace(/^single-family-owned\s*/gi, '')
                .replace(/^original-owner\s*/gi, '')
                .replace(/^this\s+/gi, '') // Remove "This" prefix
                .replace(/^el\s+/gi, '') // Remove "El" prefix (El Camino)
                .replace(/^red\s+/gi, '') // Remove color prefixes
                .replace(/^beautiful\s+/gi, '')
                .replace(/^supercharged\s+/gi, '')
                .replace(/^all\s+/gi, '')
                .replace(/^502-powered\s*/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
              
              const yearMatch = cleanTitle.match(/\b(19|20)\d{2}\b/);
              if (yearMatch) {
                const year = parseInt(yearMatch[0]);
                if (year >= 1885 && year <= new Date().getFullYear() + 1) {
                  scrapeData.data.year = year;
                }
                
                // Extract make/model after year
                const afterYear = cleanTitle.substring(cleanTitle.indexOf(yearMatch[0]) + 4).trim();
                const knownMakes = ['chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'ram', 'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'benz', 'mercedes-benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar', 'cadillac', 'buick', 'pontiac', 'lincoln', 'chrysler', 'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi', 'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'alfa romeo', 'fiat', 'mini', 'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'aston martin', 'bentley', 'rolls', 'royce', 'rolls-royce', 'datsun', 'mercury', 'jeep', 'suzuki'];
                const afterYearLower = afterYear.toLowerCase();
                
                for (const makeName of knownMakes) {
                  if (afterYearLower.startsWith(makeName + ' ') || afterYearLower.startsWith(makeName + '-')) {
                    let make = makeName === 'chevy' ? 'Chevrolet' : makeName === 'vw' ? 'Volkswagen' : makeName === 'benz' ? 'Mercedes' : makeName === 'mercedes-benz' ? 'Mercedes-Benz' : makeName === 'alfa romeo' || makeName === 'alfa-romeo' ? 'Alfa Romeo' : makeName === 'aston martin' || makeName === 'aston-martin' ? 'Aston Martin' : makeName === 'rolls-royce' || (makeName === 'rolls' && afterYearLower.includes('royce')) ? 'Rolls-Royce' : makeName.charAt(0).toUpperCase() + makeName.slice(1);
                    
                    if (isValidMake(make)) {
                      scrapeData.data.make = make;
                      
                      const afterMake = afterYear.substring(makeName.length).trim();
                      // Take first 2-3 words as model, but clean it
                      const modelParts = afterMake.split(/\s+/).slice(0, 3);
                      let model = modelParts.join(' ').trim();
                      model = cleanModelName(model);
                      scrapeData.data.model = model;
                      break;
                    }
                  }
                }
              }
            }
          }
          
          if (isTruck(scrapeData.data.make || '', scrapeData.data.model || '', scrapeData.data.title || '', scrapeData.data.description || '')) {
            scrapeData.data.body_type = 'Truck';
            scrapeData.data.body_style = 'Pickup';
          }
        }
        // Craigslist parsing
        else if (item.listing_url.includes('craigslist.org')) {
          scrapeData.data.source = 'Craigslist';
          const titleElement = doc.querySelector('h1 .postingtitletext');
          if (titleElement) {
            scrapeData.data.title = titleElement.textContent?.trim() || '';
          }
          // Extract price from Craigslist - use helper to avoid monthly payments
          const priceElement = doc.querySelector('.price');
          if (priceElement) {
            const priceText = priceElement.textContent?.trim();
            const extractedPrice = extractVehiclePrice(priceText || '');
            if (extractedPrice) {
              scrapeData.data.asking_price = extractedPrice;
            }
          }
          
          // Also try extracting from title/description if not found
          if (!scrapeData.data.asking_price) {
            const titlePrice = extractVehiclePrice(scrapeData.data.title || '');
            if (titlePrice) {
              scrapeData.data.asking_price = titlePrice;
            }
          }
          const locationElement = doc.querySelector('.postingtitle .postingtitletext small');
          if (locationElement) {
            scrapeData.data.location = locationElement.textContent?.trim().replace(/[()]/g, '');
          }
          const bodyElement = doc.querySelector('#postingbody');
          if (bodyElement) {
            let description = bodyElement.textContent?.trim() || '';
            
            // Clean description - remove QR codes, junk text, dealer info lines
            description = description.replace(/QR\s+Code\s+Link\s+to\s+This\s+Post/gi, '');
            description = description.replace(/QR\s+Code[\s\S]{0,200}/gi, '');
            // Remove lines like "70,094 mi. - Automatic - 2D Coupe - 8 Cyl - RWD: Rear Wheel Drive - VIN# 1X27F3L112036"
            description = description.replace(/^\s*\d+[,\d]*\s*mi\.\s*-\s*[^-]+-\s*[^-]+-\s*[^-]+-\s*[^-]+-\s*RWD:?\s*[^-]+-\s*VIN#?\s*[A-HJ-NPR-Z0-9]{17}\s*$/gmi, '');
            // Extract VIN from description if present
            const vinMatch = description.match(/VIN#?\s*([A-HJ-NPR-Z0-9]{17})/i);
            if (vinMatch && !scrapeData.data.vin) {
              scrapeData.data.vin = vinMatch[1].toUpperCase();
            }
            // Extract mileage from description
            const mileageMatch = description.match(/(\d+(?:,\d+)?)\s*mi\./i);
            if (mileageMatch && !scrapeData.data.mileage) {
              scrapeData.data.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
            }
            
            scrapeData.data.description = description.trim();
          }
          if (scrapeData.data.title) {
            const yearMatch = scrapeData.data.title.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              const year = parseInt(yearMatch[0]);
              // Validate year is reasonable
              if (year >= 1885 && year <= new Date().getFullYear() + 1) {
                scrapeData.data.year = year;
              }
            }
            
            // Improved make/model extraction with validation
            const parts = scrapeData.data.title.split(/\s+/).filter(p => p.length > 0);
            if (parts.length >= 3) {
              let startIndex = 0;
              // Skip year if first
              if (parts[0] && parts[0].match(/^\d{4}$/)) {
                startIndex = 1;
              }
              
              // Extract make (validate against known makes)
              // Skip invalid prefixes
              const invalidPrefixes = ['this', 'el', 'red', 'beautiful', 'supercharged', 'all', '6k-mile', '10k-mile', '18k-mile', '47k-mile', 'original-owner', 'single-family-owned', '20-years-owned'];
              
              let makeIndex = startIndex;
              while (makeIndex < parts.length && invalidPrefixes.includes(parts[makeIndex].toLowerCase())) {
                makeIndex++;
              }
              
              if (makeIndex < parts.length) {
                let make = parts[makeIndex];
                if (make.toLowerCase() === 'chevy') make = 'Chevrolet';
                if (make.toLowerCase() === 'vw') make = 'Volkswagen';
                
                // Special case: "El Camino" - make is Chevrolet, not "El"
                if (make.toLowerCase() === 'el' && parts.length > makeIndex + 1 && parts[makeIndex + 1].toLowerCase() === 'camino') {
                  make = 'Chevrolet';
                  makeIndex++; // Skip "El"
                }
                
                // Only use if valid make
                if (isValidMake(make)) {
                  scrapeData.data.make = make.charAt(0).toUpperCase() + make.slice(1).toLowerCase();
                  
                  // Extract model (rest of title)
                  if (parts.length > makeIndex + 1) {
                    const modelParts = parts.slice(makeIndex + 1);
                    // Filter out common non-model words
                    const filteredModel = modelParts.filter(p => 
                      !['for', 'sale', 'wanted', 'needs', 'runs', 'great', 'condition'].includes(p.toLowerCase())
                    );
                    if (filteredModel.length > 0) {
                      let model = filteredModel.join(' ');
                      model = cleanModelName(model);
                      scrapeData.data.model = model;
                    }
                  }
                }
              }
            }
            
            // Identify if truck and set body_type
            if (isTruck(scrapeData.data.make || '', scrapeData.data.model || '', scrapeData.data.title, scrapeData.data.description)) {
              scrapeData.data.body_type = 'Truck';
              scrapeData.data.body_style = 'Pickup';
            }
          }
        }

        // Extract dealer/organization info from listing
        let organizationId = null;
        let dealerName: string | null = null;
        let dealerPhone: string | null = null;
        let dealerLocation: string | null = null;
        
        // Extract dealer info from Craigslist listing (enhanced with website detection)
        if (item.listing_url.includes('craigslist.org')) {
          // Use dealer info from scrape-vehicle if available (includes website extraction)
          if (scrapeData.data.dealer_name) {
            dealerName = scrapeData.data.dealer_name;
          }
          if (scrapeData.data.dealer_website) {
            // Store website for organization creation
            const dealerWebsite = scrapeData.data.dealer_website;
          }
          if (scrapeData.data.dealer_phone) {
            dealerPhone = scrapeData.data.dealer_phone;
          }
          
          // Fallback to pattern matching if scraper didn't find dealer info
          if (!dealerName) {
            const titleText = scrapeData.data.title || '';
            const descText = scrapeData.data.description || '';
            const combinedText = `${titleText} ${descText}`;
            
            // Pattern: "Desert Private Collection (760) 313-6607"
            const dealerMatch = combinedText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\(?\s*(\d{3})\s*\)?\s*(\d{3})[-\s]?(\d{4})/);
            if (dealerMatch) {
              dealerName = dealerMatch[1].trim();
              dealerPhone = `(${dealerMatch[2]}) ${dealerMatch[3]}-${dealerMatch[4]}`;
            }
            
            // Pattern: "EZCustom4x4", "Hayes Classics", etc.
            if (!dealerName) {
              const namePatterns = [
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*Classics?/i,
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*Auto/i,
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*Motors?/i,
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*Collection/i
              ];
              for (const pattern of namePatterns) {
                const match = combinedText.match(pattern);
                if (match && match[1].length > 3) {
                  dealerName = match[1].trim();
                  break;
                }
              }
            }
            
            // Extract location from title/description
            const locationMatch = combinedText.match(/\(([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\)/);
            if (locationMatch) {
              dealerLocation = locationMatch[1];
            }
          }
        }
        
        // Enhanced organization detection: check for VIN + dealer combo
        // This enables intelligent cross-city dealer detection
        const dealerWebsite = scrapeData.data.dealer_website || null;
        const listingVIN = scrapeData.data.vin || null;
        
        // Get or create organization (intelligent dealer detection)
        if ((dealerName && dealerName.length > 2) || dealerWebsite) {
          const orgSlug = dealerName 
            ? dealerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
            : null;
          
          // Check if organization exists by website (strongest match), slug, or name
          let existingOrg = null;
          if (dealerWebsite) {
            const { data: orgByWebsite } = await supabase
              .from('organizations')
              .select('id, name, website')
              .eq('website', dealerWebsite)
              .limit(1)
              .maybeSingle();
            
            if (orgByWebsite) {
              existingOrg = orgByWebsite;
              console.log(`✅ Found existing organization by website: ${dealerWebsite} -> ${orgByWebsite.name}`);
            }
          }
          
          // Fallback: check by slug or name
          if (!existingOrg && orgSlug) {
            const { data: orgByName } = await supabase
              .from('organizations')
              .select('id, name, website')
              .or(`slug.eq.${orgSlug},name.ilike.%${dealerName}%`)
              .limit(1)
              .maybeSingle();
            
            if (orgByName) {
              existingOrg = orgByName;
              // Update website if we found org by name but it's missing website
              if (dealerWebsite && !orgByName.website) {
                await supabase
                  .from('organizations')
                  .update({ website: dealerWebsite })
                  .eq('id', orgByName.id);
                console.log(`✅ Updated organization website: ${orgByName.name}`);
              }
            }
          }
          
          if (existingOrg) {
            organizationId = existingOrg.id;
            console.log(`✅ Found existing organization: ${existingOrg.name} (${organizationId})`);
            
            // Trigger inventory sync if website available (async, don't wait)
            if (dealerWebsite) {
              // Queue website inventory scrape for this dealer
              triggerDealerInventorySync(existingOrg.id, dealerWebsite, supabase).catch(err => {
                console.warn(`⚠️ Failed to trigger inventory sync: ${err.message}`);
              });
            }
          } else {
            // Create new organization
            const orgData: any = {
              type: 'dealer',
              discovered_via: 'import_queue',
              source_url: item.listing_url
            };
            
            if (dealerName) {
              orgData.name = dealerName;
              orgData.slug = orgSlug;
            } else if (dealerWebsite) {
              // Extract name from domain if no name found
              const domainMatch = dealerWebsite.match(/https?:\/\/(?:www\.)?([^.]+)/);
              if (domainMatch) {
                const domainName = domainMatch[1].replace(/-/g, ' ');
                orgData.name = domainName.split(/(?=[A-Z])/).map((w: string) => 
                  w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                ).join(' ');
                orgData.slug = domainName.replace(/[^a-z0-9]+/g, '-');
              }
            }
            
            if (dealerPhone) orgData.phone = dealerPhone;
            if (dealerLocation) orgData.location = dealerLocation;
            if (dealerWebsite) orgData.website = dealerWebsite;
            
            const { data: newOrg, error: orgError } = await supabase
              .from('organizations')
              .insert(orgData)
              .select('id')
              .single();
            
            if (newOrg && !orgError) {
              organizationId = newOrg.id;
              console.log(`✅ Created new organization: ${orgData.name || dealerWebsite} (${organizationId})`);
              
              // Trigger inventory sync for new dealer
              if (dealerWebsite) {
                triggerDealerInventorySync(newOrg.id, dealerWebsite, supabase).catch(err => {
                  console.warn(`⚠️ Failed to trigger inventory sync: ${err.message}`);
                });
              }
            } else {
              console.warn(`⚠️ Failed to create organization: ${orgError?.message || 'Unknown error'}`);
            }
          }
        }
        
        // Fallback: Use source organization if no dealer found
        if (!organizationId && item.source_id) {
          const { data: source } = await supabase
            .from('scrape_sources')
            .select('id')
            .eq('id', item.source_id)
            .single();

          if (source) {
            const { data: org } = await supabase
              .from('organizations')
              .select('id')
              .eq('scrape_source_id', source.id)
              .single();

            if (org) {
              organizationId = org.id;
            }
          }
        }

        // Validate scraped data before creating vehicle
        let make = (scrapeData.data.make || item.listing_make || '').trim();
        let model = (scrapeData.data.model || item.listing_model || '').trim();
        const year = scrapeData.data.year || item.listing_year;
        
        // Clean model name (remove pricing, dealer info, etc.)
        model = cleanModelName(model);
        
        // Validate make
        if (make && !isValidMake(make)) {
          console.warn(`⚠️ Invalid make detected: ${make}, skipping vehicle creation`);
          await supabase
            .from('import_queue')
            .update({
              status: 'failed',
              error_message: `Invalid make: ${make}`,
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id);
          continue;
        }
        
        // Data quality checks - reject garbage data
        if (!make || make === '' || !isValidMake(make)) {
          throw new Error(`Invalid make: "${make}" - cannot create vehicle`);
        }
        
        if (!model || model === '') {
          throw new Error(`Invalid model: "${model}" - cannot create vehicle`);
        }
        
        if (!year || year < 1885 || year > new Date().getFullYear() + 1) {
          throw new Error(`Invalid year: ${year} - cannot create vehicle`);
        }
        
        // VIN-based duplicate detection (handles cross-city dealer listings)
        // If same VIN exists, update existing vehicle instead of creating duplicate
        let existingVehicleId: string | null = null;
        const listingVIN = scrapeData.data.vin;
        
        if (listingVIN && listingVIN.length === 17 && !listingVIN.startsWith('VIVA-')) {
          const { data: existingVehicle } = await supabase
            .from('vehicles')
            .select('id, discovery_url, origin_organization_id')
            .eq('vin', listingVIN)
            .limit(1)
            .maybeSingle();
          
          if (existingVehicle) {
            existingVehicleId = existingVehicle.id;
            console.log(`✅ Found existing vehicle with VIN ${listingVIN}, updating instead of creating duplicate`);
            
            // Update discovery URL if this listing is different (cross-city detection)
            if (existingVehicle.discovery_url !== item.listing_url) {
              await supabase
                .from('vehicles')
                .update({ 
                  discovery_url: item.listing_url, // Update to latest listing
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingVehicle.id);
              console.log(`📍 Updated discovery URL for cross-city listing: ${item.listing_url}`);
            }
            
            // Link to organization if not already linked
            if (organizationId && (!existingVehicle.origin_organization_id || existingVehicle.origin_organization_id !== organizationId)) {
              await supabase
                .from('vehicles')
                .update({ 
                  origin_organization_id: organizationId,
                  selling_organization_id: organizationId,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingVehicle.id);
              console.log(`🔗 Linked existing vehicle to organization ${organizationId}`);
              
              // Also ensure organization_vehicles link exists
              await supabase
                .from('organization_vehicles')
                .upsert({
                  organization_id: organizationId,
                  vehicle_id: existingVehicle.id,
                  relationship_type: 'inventory',
                  status: 'active',
                  auto_tagged: true
                }, {
                  onConflict: 'organization_id,vehicle_id'
                });
            }
            
            // Mark queue item as processed (merged with existing)
            await supabase
              .from('import_queue')
              .update({
                status: 'completed',
                processed_at: new Date().toISOString(),
                vehicle_id: existingVehicle.id
              })
              .eq('id', item.id);
            
            console.log(`✅ Merged listing with existing vehicle ${existingVehicle.id}`);
            processedCount++;
            continue; // Skip to next item
          }
        }
        
        // Create vehicle - START AS PENDING until validated
        // Store extracted image URLs in metadata for later backfill
        const { data: newVehicle, error: vehicleError} = await supabase
          .from('vehicles')
          .insert({
            year: year,
            make: make,
            model: model,
            status: 'pending', // Start pending - will be activated after validation
            is_public: false, // Start private - will be made public after validation
            discovery_url: item.listing_url,
            origin_metadata: {
              source_id: item.source_id,
              queue_id: item.id,
              imported_at: new Date().toISOString(),
              image_urls: scrapeData.data.images || [], // Store for backfill
              image_count: scrapeData.data.images?.length || 0
            },
            selling_organization_id: organizationId,
            import_queue_id: item.id
          })
          .select('id')
          .single();

        if (vehicleError) {
          throw new Error(`Vehicle insert failed: ${vehicleError.message}`);
        }

        // Process scraped data through forensic system (REPLACES manual field assignment)
        await supabase.rpc('process_scraped_data_forensically', {
          p_vehicle_id: newVehicle.id,
          p_scraped_data: scrapeData.data,
          p_source_url: item.listing_url,
          p_scraper_name: 'import-queue',
          p_context: { source_id: item.source_id, queue_id: item.id }
        });

        // Build consensus for critical fields immediately
        const criticalFields = ['vin', 'trim', 'series', 'drivetrain', 'engine_type', 'mileage', 'color', 'asking_price'];
        for (const field of criticalFields) {
          if (scrapeData.data[field]) {
            await supabase.rpc('build_field_consensus', {
              p_vehicle_id: newVehicle.id,
              p_field_name: field,
              p_auto_assign: true
            });
          }
        }
        
        // Update vehicle with any additional scraped fields
        const updateData: any = {};
        if (scrapeData.data.description && scrapeData.data.description.length > 10) {
          updateData.description = scrapeData.data.description;
        }
        if (scrapeData.data.location) updateData.location = scrapeData.data.location;
        if (scrapeData.data.asking_price && scrapeData.data.asking_price > 100 && scrapeData.data.asking_price < 10000000) {
          updateData.asking_price = scrapeData.data.asking_price;
        }
        if (scrapeData.data.vin && scrapeData.data.vin.length === 17) {
          updateData.vin = scrapeData.data.vin;
        }
        
        if (Object.keys(updateData).length > 0) {
          await supabase
            .from('vehicles')
            .update(updateData)
            .eq('id', newVehicle.id);
        }

        // CRITICAL: Filter images with AI to remove other vehicles, then backfill
        let filteredImages = scrapeData.data.images || [];
        if (filteredImages.length > 0 && make && model && year) {
          console.log(`🔍 Filtering ${filteredImages.length} images with AI to match ${year} ${make} ${model}...`);
          try {
            const { data: filterResult, error: filterError } = await supabase.functions.invoke('filter-vehicle-images-ai', {
              body: {
                vehicle_id: newVehicle.id,
                image_urls: filteredImages,
                year: year,
                make: make,
                model: model
              }
            });

            if (!filterError && filterResult?.filtered_images) {
              filteredImages = filterResult.filtered_images;
              console.log(`✅ AI filtered: ${filterResult.matched} matched, ${filterResult.rejected} rejected`);
            } else {
              console.warn(`⚠️ AI filtering failed: ${filterError?.message || 'Unknown error'} - using all images`);
            }
          } catch (err: any) {
            console.warn(`⚠️ AI filtering error: ${err.message} - using all images`);
          }
        }
        
        // CRITICAL: Backfill images IMMEDIATELY (before validation) - required for activation
        let imagesBackfilled = false;
        if (filteredImages.length > 0) {
          console.log(`🖼️  Backfilling ${filteredImages.length} filtered images BEFORE validation...`);
          try {
            const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
              body: {
                vehicle_id: newVehicle.id,
                image_urls: filteredImages,
                source: 'import_queue',
                run_analysis: false
              }
            });

            if (!backfillError && backfillResult?.uploaded) {
              console.log(`✅ Images backfilled: ${backfillResult.uploaded} uploaded`);
              imagesBackfilled = true;
            } else {
              console.warn(`⚠️ Image backfill failed: ${backfillError?.message || 'Unknown error'}`);
              if (backfillResult?.error_summary) {
                console.warn(`   Errors: ${backfillResult.error_summary.slice(0, 3).join('; ')}`);
              }
            }
          } catch (err: any) {
            console.error(`❌ Image backfill failed:`, err.message);
          }
        }
        
        // If no images from scraping, try simple-scraper for better extraction
        if (!imagesBackfilled) {
          console.log(`🔄 No images from scraping, trying simple-scraper...`);
          try {
            const { data: simpleData, error: simpleError } = await supabase.functions.invoke('simple-scraper', {
              body: { url: item.listing_url }
            });

            if (!simpleError && simpleData?.success && simpleData.data?.images && simpleData.data.images.length > 0) {
              console.log(`🖼️  Found ${simpleData.data.images.length} images via simple-scraper`);
              const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
                body: {
                  vehicle_id: newVehicle.id,
                  image_urls: simpleData.data.images,
                  source: 'simple_scraper',
                  run_analysis: false
                }
              });

              if (!backfillError && backfillResult?.uploaded) {
                console.log(`✅ Simple-scraper images backfilled: ${backfillResult.uploaded} uploaded`);
                imagesBackfilled = true;
              } else {
                console.warn(`⚠️ Simple-scraper image backfill failed: ${backfillError?.message || 'Unknown'}`);
              }
            } else {
              console.warn(`⚠️ Simple-scraper found no images`);
            }
          } catch (simpleErr: any) {
            console.warn(`⚠️ Simple-scraper failed:`, simpleErr.message);
          }
        }

        // AUTO-BACKFILL: Get VIN and other missing data via AI extraction
        if (!newVehicle.vin) {
          console.log(`🔄 Auto-backfilling VIN and missing data...`);
          try {
            const { data: extractedData, error: extractError } = await supabase.functions.invoke('extract-vehicle-data-ai', {
              body: { url: item.listing_url }
            });

            if (!extractError && extractedData?.success) {
              const aiData = extractedData.data;
              const backfillUpdates: any = {};

              // CRITICAL: Get VIN (required for public)
              if (aiData.vin && aiData.vin.length === 17) {
                backfillUpdates.vin = aiData.vin;
                console.log(`✅ Backfilled VIN`);
              }

              // Backfill other missing fields
              if (!newVehicle.description && aiData.description) {
                backfillUpdates.description = aiData.description;
              }
              if (!newVehicle.asking_price && aiData.asking_price) {
                backfillUpdates.asking_price = aiData.asking_price;
              }
              if (!newVehicle.mileage && aiData.mileage) {
                backfillUpdates.mileage = aiData.mileage;
              }

              if (Object.keys(backfillUpdates).length > 0) {
                await supabase
                  .from('vehicles')
                  .update(backfillUpdates)
                  .eq('id', newVehicle.id);
                console.log(`✅ Backfilled ${Object.keys(backfillUpdates).length} fields`);
              }
            }
          } catch (backfillErr: any) {
            console.warn(`⚠️ Auto-backfill failed: ${backfillErr.message}`);
          }
        }
        
        // QUALITY GATE: Validate before making public (images and VIN should be backfilled now)
        const { data: validationResult, error: validationError } = await supabase.rpc(
          'validate_vehicle_before_public',
          { p_vehicle_id: newVehicle.id }
        );
        
        if (validationError) {
          console.warn('Validation error:', validationError);
          // Continue but don't make public
        } else if (validationResult && validationResult.can_go_live) {
          // Passed validation - make public and active
          await supabase
            .from('vehicles')
            .update({
              status: 'active',
              is_public: true
            })
            .eq('id', newVehicle.id);
          console.log(`✅ Vehicle ${newVehicle.id} passed quality gate - made public`);
        } else {
          // Failed validation - keep pending/private
          console.warn(`⚠️ Vehicle ${newVehicle.id} failed quality gate:`, validationResult?.recommendation);
          // Log issues for debugging
          if (validationResult?.issues) {
            console.warn('Validation issues:', JSON.stringify(validationResult.issues, null, 2));
          }
        }

        // Re-validate after backfilling (images and VIN should be there now)
        const { data: finalValidation, error: finalValidationError } = await supabase.rpc(
          'validate_vehicle_before_public',
          { p_vehicle_id: newVehicle.id }
        );

        if (!finalValidationError && finalValidation && finalValidation.can_go_live) {
          await supabase
            .from('vehicles')
            .update({
              status: 'active',
              is_public: true
            })
            .eq('id', newVehicle.id);
          console.log(`🎉 Vehicle ${newVehicle.id} ACTIVATED after backfilling!`);
        } else {
          console.log(`⚠️ Vehicle ${newVehicle.id} still pending: ${finalValidation?.recommendation || 'Unknown'}`);
        }

        // Update queue item
        await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            vehicle_id: newVehicle.id,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        // CREATE EXTERNAL LISTING FOR LIVE AUCTIONS (BaT)
        if (item.listing_url.includes('bringatrailer.com') && scrapeData.data.is_live_auction && scrapeData.data.auction_end_date) {
          console.log(`🎯 Creating external_listing for live BaT auction...`);
          try {
            // Extract lot number from URL or metadata
            const lotMatch = item.listing_url.match(/-(\d+)\/?$/);
            const lotNumber = lotMatch ? lotMatch[1] : null;
            
            // Extract current bid from asking_price
            const currentBid = scrapeData.data.asking_price || null;
            
            // Calculate start_date: Use auction_start_date if available, otherwise calculate from end_date (end - 7 days)
            let startDate = scrapeData.data.auction_start_date;
            if (!startDate && scrapeData.data.auction_end_date) {
              const endDate = new Date(scrapeData.data.auction_end_date);
              const calculatedStart = new Date(endDate);
              calculatedStart.setDate(calculatedStart.getDate() - 7); // BAT auctions run for 7 days
              startDate = calculatedStart.toISOString();
              console.log(`📅 Calculated start_date from end_date: ${startDate} (end: ${scrapeData.data.auction_end_date})`);
            }
            
            // Use the same organization_id as the vehicle
            const orgId = organizationId || null;
            
            const { error: externalListingError } = await supabase
              .from('external_listings')
              .upsert({
                vehicle_id: newVehicle.id,
                organization_id: orgId || null, // Can be null for imported BaT auctions
                platform: 'bat',
                listing_url: item.listing_url,
                listing_id: lotNumber || item.listing_url.split('/').pop() || null,
                listing_status: 'active',
                start_date: startDate || new Date().toISOString(), // Use calculated start_date, fallback to now
                end_date: scrapeData.data.auction_end_date,
                current_bid: currentBid,
                bid_count: 0, // Will be updated on sync
                metadata: {
                  source: 'import_queue',
                  queue_id: item.id,
                  lot_number: lotNumber,
                  is_live: true
                }
              }, {
                onConflict: 'vehicle_id,platform,listing_id'
              });

            if (externalListingError) {
              console.warn(`⚠️ Failed to create external_listing: ${externalListingError.message}`);
            } else {
              console.log(`✅ External listing created for live auction`);
            }
          } catch (extErr: any) {
            console.warn(`⚠️ Error creating external_listing: ${extErr.message}`);
          }
        }

        // CRITICAL: Create timeline event for listing (ALWAYS, even if other steps fail)
        const listedDate = scrapeData.data.listed_date || new Date().toISOString().split('T')[0];
        try {
          const source = item.listing_url.includes('craigslist') ? 'craigslist' :
                         item.listing_url.includes('bringatrailer') ? 'bring_a_trailer' :
                         item.listing_url.includes('hemmings') ? 'hemmings' :
                         'automated_import';
          
          const { error: timelineError } = await supabase
            .from('timeline_events')
            .insert({
              vehicle_id: newVehicle.id,
              event_type: 'auction_listed',
              event_date: listedDate,
              title: 'Listed for Sale',
              description: `Listed on ${new URL(item.listing_url).hostname}`,
              source: source,
              metadata: {
                source_url: item.listing_url,
                price: scrapeData.data.price || scrapeData.data.asking_price,
                location: scrapeData.data.location,
                discovery: true
              }
            });

          if (timelineError) {
            console.error(`⚠️ Timeline event creation failed: ${timelineError.message}`);
          } else {
            console.log(`✅ Created timeline event for vehicle ${newVehicle.id}`);
          }
        } catch (timelineErr: any) {
          console.error(`⚠️ Timeline event creation error: ${timelineErr.message}`);
        }

        results.succeeded++;
        results.vehicles_created.push(newVehicle.id);
        console.log(`✅ Created vehicle ${newVehicle.id} from ${item.listing_url}`);

      } catch (error) {
        console.error(`Failed to process ${item.listing_url}:`, error);

        await supabase
          .from('import_queue')
          .update({
            status: item.attempts >= 2 ? 'failed' : 'pending',
            error_message: error.message,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        results.failed++;
      }

      results.processed++;
    }

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Process queue error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper function to extract image URLs
function extractImageURLs(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  
  // Pattern 1: Craigslist specific - images.craigslist.org
  const craigslistImageRegex = /https?:\/\/images\.craigslist\.org\/[^"'\s>]+/gi;
  let match;
  while ((match = craigslistImageRegex.exec(html)) !== null) {
    const url = match[0];
    if (url && !seen.has(url)) {
      images.push(url);
      seen.add(url);
    }
  }
  
  // Pattern 2: Standard img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !src.startsWith('data:') && !src.includes('icon') && !src.includes('logo') && !src.includes('placeholder')) {
      let fullUrl = src;
      if (src.startsWith('//')) {
        fullUrl = 'https:' + src;
      } else if (src.startsWith('/')) {
        continue;
      } else if (src.startsWith('http')) {
        fullUrl = src;
      } else {
        continue;
      }
      
      // Filter out junk images
      if (fullUrl.includes('icon') || fullUrl.includes('logo') || fullUrl.includes('placeholder') || fullUrl.includes('avatar')) {
        continue;
      }
      
      if (!seen.has(fullUrl)) {
        images.push(fullUrl);
        seen.add(fullUrl);
      }
    }
  }

  // Pattern 3: Data attributes
  const dataSrcPatterns = [
    /<[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-original=["']([^"']+)["'][^>]*>/gi,
  ];
  
  for (const pattern of dataSrcPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const src = match[1];
      if (src && src.startsWith('http') && !seen.has(src)) {
        images.push(src);
        seen.add(src);
      }
    }
  }

  // Filter out thumbnails and junk
  return images.filter(img => {
    const lower = img.toLowerCase();
    const isThumbnail = lower.includes('94x63') || 
                       lower.includes('thumbnail') || 
                       lower.includes('thumb/');
    
    return !isThumbnail &&
           !lower.includes('icon') && 
           !lower.includes('logo') &&
           !lower.includes('placeholder');
  });
}

