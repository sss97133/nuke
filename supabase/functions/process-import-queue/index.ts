import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

        // Craigslist parsing
        if (item.listing_url.includes('craigslist.org')) {
          scrapeData.data.source = 'Craigslist';
          const titleElement = doc.querySelector('h1 .postingtitletext');
          if (titleElement) {
            scrapeData.data.title = titleElement.textContent?.trim() || '';
          }
          const priceElement = doc.querySelector('.price');
          if (priceElement) {
            const priceText = priceElement.textContent?.trim();
            const priceMatch = priceText?.match(/\$?([\d,]+)/);
            if (priceMatch) {
              scrapeData.data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''));
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
              
              // Extract make (skip common descriptors)
              const invalidMakes = ['Classic', 'Featured', 'Fuel-Injected', 'Powered', 'Owned', 'Half-Scale', 'Gray', 'Exotic', 'Vintage', 'Custom'];
              if (parts[startIndex] && !invalidMakes.includes(parts[startIndex])) {
                scrapeData.data.make = parts[startIndex].charAt(0).toUpperCase() + parts[startIndex].slice(1).toLowerCase();
              }
              
              // Extract model (rest of title)
              if (parts.length > startIndex + 1) {
                const modelParts = parts.slice(startIndex + 1);
                // Filter out common non-model words
                const filteredModel = modelParts.filter(p => 
                  !['for', 'sale', 'wanted', 'needs', 'runs', 'great', 'condition'].includes(p.toLowerCase())
                );
                if (filteredModel.length > 0) {
                  scrapeData.data.model = filteredModel.join(' ');
                }
              }
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
        const make = (scrapeData.data.make || item.listing_make || '').trim();
        const model = (scrapeData.data.model || item.listing_model || '').trim();
        const year = scrapeData.data.year || item.listing_year;
        
        // Data quality checks - reject garbage data
        const invalidMakes = ['Unknown', 'Classic', 'Featured', 'Fuel-Injected', 'Powered', 'Owned'];
        if (!make || make === '' || invalidMakes.includes(make)) {
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
        
        // QUALITY GATE: Validate before making public
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

        // Update queue item
        await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            vehicle_id: newVehicle.id,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        // Create timeline event for listing
        const listedDate = scrapeData.data.listed_date || new Date().toISOString().split('T')[0];
        await supabase
          .from('timeline_events')
          .insert({
            vehicle_id: newVehicle.id,
            event_type: 'auction_listed',
            event_date: listedDate,
            title: 'Listed for Sale',
            description: `Listed on ${new URL(item.listing_url).hostname}`,
            source: 'automated_import',
            metadata: {
              source_url: item.listing_url,
              price: scrapeData.data.price,
              location: scrapeData.data.location
            }
          });

        // Queue images for download - AWAIT to ensure they're processed
        if (scrapeData.data.images && scrapeData.data.images.length > 0) {
          console.log(`📸 Downloading ${scrapeData.data.images.length} images for vehicle ${newVehicle.id}`);
          
          try {
            // Call backfill-images and WAIT for it (with timeout)
            const backfillResponse = await Promise.race([
              fetch(
                `${Deno.env.get('SUPABASE_URL')}/functions/v1/backfill-images`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                  },
                  body: JSON.stringify({
                    vehicle_id: newVehicle.id,
                    image_urls: scrapeData.data.images,
                    source: 'import_queue',
                    run_analysis: false, // Skip analysis for speed
                    listed_date: scrapeData.data.listed_date
                  })
                }
              ),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Backfill timeout')), 60000) // 60s timeout
              )
            ]) as Response;

            if (backfillResponse.ok) {
              const backfillResult = await backfillResponse.json();
              console.log(`✅ Images backfilled: ${backfillResult.uploaded || 0} uploaded, ${backfillResult.failed || 0} failed`);
            } else {
              console.warn(`⚠️ Image backfill returned ${backfillResponse.status}`);
            }
          } catch (err) {
            console.error(`❌ Image backfill failed for vehicle ${newVehicle.id}:`, err);
            // Don't fail the whole process - images can be backfilled later
          }
        } else {
          console.warn(`⚠️ No images extracted from ${item.listing_url}`);
        }

        results.succeeded++;
        results.vehicles_created.push(newVehicle.id);
        console.log(`Created vehicle ${newVehicle.id} from ${item.listing_url}`);

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
  
  // Pattern 1: Standard img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !src.startsWith('data:') && !src.includes('icon') && !src.includes('logo')) {
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
      
      if (!seen.has(fullUrl)) {
        images.push(fullUrl);
        seen.add(fullUrl);
      }
    }
  }

  // Pattern 2: Data attributes
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

