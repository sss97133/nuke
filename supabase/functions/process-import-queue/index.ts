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
              
              // Parse from title: "9k-Mile 1992 Chevrolet 454 SS" or "10k-mile 2009 Porsche 911..."
              // Remove mileage/ownership descriptors first
              let cleanTitle = title
                .replace(/\d+k-?mile/gi, '')
                .replace(/\d+-years?-owned/gi, '')
                .replace(/\d+,\d+-mile/gi, '')
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
                const knownMakes = ['chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'ram', 'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar', 'cadillac', 'buick', 'pontiac', 'lincoln', 'chrysler', 'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi', 'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'fiat', 'mini', 'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'bentley', 'rolls', 'royce', 'datsun', 'mercury'];
                const afterYearLower = afterYear.toLowerCase();
                
                for (const makeName of knownMakes) {
                  if (afterYearLower.startsWith(makeName + ' ') || afterYearLower.startsWith(makeName + '-')) {
                    let make = makeName === 'chevy' ? 'Chevrolet' : makeName === 'vw' ? 'Volkswagen' : makeName === 'benz' ? 'Mercedes' : makeName.charAt(0).toUpperCase() + makeName.slice(1);
                    
                    // Handle two-word makes
                    if (makeName === 'alfa' && afterYearLower.includes('romeo')) {
                      make = 'Alfa Romeo';
                    } else if (makeName === 'aston' && afterYearLower.includes('martin')) {
                      make = 'Aston Martin';
                    } else if (makeName === 'rolls' && afterYearLower.includes('royce')) {
                      make = 'Rolls-Royce';
                    }
                    
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
            scrapeData.data.description = bodyElement.textContent?.trim() || '';
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
              if (parts[startIndex]) {
                let make = parts[startIndex];
                if (make.toLowerCase() === 'chevy') make = 'Chevrolet';
                if (make.toLowerCase() === 'vw') make = 'Volkswagen';
                
                // Only use if valid make
                if (isValidMake(make)) {
                  scrapeData.data.make = make.charAt(0).toUpperCase() + make.slice(1).toLowerCase();
                  
                  // Extract model (rest of title)
                  if (parts.length > startIndex + 1) {
                    const modelParts = parts.slice(startIndex + 1);
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

        // Get source info for organization linking
        let organizationId = null;
        if (item.source_id) {
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

        // CRITICAL: Backfill images IMMEDIATELY (before validation) - required for activation
        let imagesBackfilled = false;
        if (scrapeData.data.images && scrapeData.data.images.length > 0) {
          console.log(`🖼️  Backfilling ${scrapeData.data.images.length} images BEFORE validation...`);
          try {
            const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
              body: {
                vehicle_id: newVehicle.id,
                image_urls: scrapeData.data.images,
                source: 'import_queue',
                run_analysis: false
              }
            });

            if (!backfillError && backfillResult?.uploaded) {
              console.log(`✅ Images backfilled: ${backfillResult.uploaded} uploaded`);
              imagesBackfilled = true;
            } else {
              console.warn(`⚠️ Image backfill failed: ${backfillError?.message || 'Unknown error'}`);
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
                start_date: new Date().toISOString(), // Approximate start
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

