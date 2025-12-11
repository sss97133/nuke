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
    const { batch_size = 10, priority_only = false, source_id } = body;

    // Get pending items from queue
    let query = supabase
      .from('import_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', 3)
      .order('priority', { ascending: false })
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
        if (firecrawlApiKey) {
          try {
            console.log('🔥 Attempting Firecrawl scrape...');
            const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${firecrawlApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: item.listing_url,
                formats: ['html', 'markdown'],
                pageOptions: {
                  waitFor: 2000, // Wait 2 seconds for JS to load
                },
              })
            });

            if (firecrawlResponse.ok) {
              const firecrawlData = await firecrawlResponse.json();
              if (firecrawlData.success && firecrawlData.data?.html) {
                html = firecrawlData.data.html;
                scrapeSuccess = true;
                console.log('✅ Firecrawl scrape successful');
              }
            } else {
              console.warn('⚠️ Firecrawl failed:', firecrawlResponse.status);
            }
          } catch (error) {
            console.warn('⚠️ Firecrawl error:', error);
            // Fall through to direct fetch
          }
        }
        
        // Fallback to direct fetch if Firecrawl didn't work
        if (!scrapeSuccess) {
          console.log('📡 Using direct fetch (fallback)');
          const response = await fetch(item.listing_url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
            },
          });

          if (!response.ok) {
            throw new Error(`Scrape failed: ${response.status}`);
          }

          html = await response.text();
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
              scrapeData.data.year = parseInt(yearMatch[0]);
            }
            const parts = scrapeData.data.title.split(' ');
            if (parts.length >= 3) {
              let startIndex = 0;
              if (parts[0] && parts[0].match(/\b(19|20)\d{2}\b/)) {
                startIndex = 1;
              }
              if (parts[startIndex]) scrapeData.data.make = parts[startIndex];
              if (parts[startIndex + 1]) scrapeData.data.model = parts[startIndex + 1];
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

        // Create vehicle (minimal insert, forensic system will enrich)
        const { data: newVehicle, error: vehicleError} = await supabase
          .from('vehicles')
          .insert({
            year: scrapeData.data.year || item.listing_year,
            make: scrapeData.data.make || item.listing_make || 'Unknown',
            model: scrapeData.data.model || item.listing_model || 'Unknown',
            status: 'active',
            is_public: true,
            discovery_url: item.listing_url,
            origin_metadata: {
              source_id: item.source_id,
              queue_id: item.id,
              imported_at: new Date().toISOString()
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

        // Build consensus for critical fields
        const criticalFields = ['vin', 'trim', 'series', 'drivetrain', 'engine_type', 'mileage'];
        for (const field of criticalFields) {
          if (scrapeData.data[field]) {
            await supabase.rpc('build_field_consensus', {
              p_vehicle_id: newVehicle.id,
              p_field_name: field,
              p_auto_assign: true
            });
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

        // Queue images for download
        if (scrapeData.data.images && scrapeData.data.images.length > 0) {
          console.log(`Queuing ${scrapeData.data.images.length} images for vehicle ${newVehicle.id}`);
          
          // Call image backfill for this vehicle
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
                run_analysis: true
              })
            }
          ).catch(err => console.error('Image backfill trigger failed:', err));
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

