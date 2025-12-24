// Supabase Edge Function to scrape KSL listings and import them
// Can be called from admin UI or scheduled cron

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface KSLListing {
  url: string;
  listingId: string | null;
  title: string;
  price: number | null;
  imageUrl: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  location: string | null;
  description: string | null;
  images: string[];
  vin: string | null;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { searchUrl, maxListings = 20 } = body;
    const kslSearchUrl = searchUrl || 'https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991';

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing Supabase configuration (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get or create scrape source
    const { data: source, error: sourceError } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('domain', 'ksl.com')
      .maybeSingle();

    let sourceId = source?.id;

    if (!sourceId) {
      const { data: newSource, error: createError } = await supabase
        .from('scrape_sources')
        .insert({
          domain: 'ksl.com',
          source_name: 'KSL Cars',
          source_type: 'marketplace',
          base_url: 'https://cars.ksl.com',
          is_active: true,
        })
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating source:', createError);
      } else {
        sourceId = newSource?.id;
      }
    }

    console.log(`🚀 Starting KSL scrape for: ${kslSearchUrl}`);
    console.log(`   Max listings: ${maxListings}, Import to DB: ${importToDb}`);

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'FIRECRAWL_API_KEY not configured. KSL requires Firecrawl to bypass bot protection.' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    // Use Firecrawl to scrape KSL search page
    try {
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: kslSearchUrl,
          formats: ['html', 'markdown'],
          waitFor: 3000,
          onlyMainContent: false
        })
      });

      if (!firecrawlResponse.ok) {
        const errorText = await firecrawlResponse.text().catch(() => '');
        console.error(`Firecrawl error: ${firecrawlResponse.status}`, errorText.substring(0, 200));
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Firecrawl failed: ${firecrawlResponse.status}`,
            details: errorText.substring(0, 500)
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
          }
        );
      }

      const firecrawlData = await firecrawlResponse.json();
      if (!firecrawlData?.success) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Firecrawl returned unsuccessful response',
            details: firecrawlData
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
          }
        );
      }

      const html = firecrawlData.data?.html || '';
      const listings: KSLListing[] = [];

      // Extract listing URLs from HTML
      // KSL uses various patterns - try multiple selectors
      const listingPatterns = [
        /href="(\/listing\/\d+)"/g,
        /href="(https:\/\/cars\.ksl\.com\/listing\/\d+)"/g,
        /data-listing-id="(\d+)"/g
      ];

      const foundUrls = new Set<string>();
      
      for (const pattern of listingPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null && foundUrls.size < maxListings) {
          let url = match[1];
          if (!url.startsWith('http')) {
            url = `https://cars.ksl.com${url}`;
          }
          if (url.includes('/listing/')) {
            foundUrls.add(url);
          }
        }
      }

      // Scrape individual listing pages to get full vehicle data
      for (const url of Array.from(foundUrls).slice(0, maxListings)) {
        const listingIdMatch = url.match(/\/listing\/(\d+)/);
        const listingId = listingIdMatch ? listingIdMatch[1] : null;
        
        try {
          // Scrape individual listing page with Firecrawl
          const listingResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              url: url,
              formats: ['html', 'extract'],
              extract: {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    year: { type: 'number' },
                    make: { type: 'string' },
                    model: { type: 'string' },
                    price: { type: 'number' },
                    mileage: { type: 'number' },
                    location: { type: 'string' },
                    description: { type: 'string' },
                    vin: { type: 'string' },
                    images: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  }
                }
              },
              waitFor: 3000,
              onlyMainContent: false
            })
          });

          if (listingResponse.ok) {
            const listingData = await listingResponse.json();
            const extract = listingData.data?.extract || {};
            const listingHtml = listingData.data?.html || '';
            
            // Parse HTML for additional data if extract is incomplete
            const doc = new DOMParser().parseFromString(listingHtml, 'text/html');
            
            // Extract title
            const title = extract.title || 
                         doc?.querySelector('h1')?.textContent?.trim() || 
                         doc?.querySelector('title')?.textContent?.trim() || 
                         'Untitled Listing';
            
            // Extract price
            const priceText = doc?.querySelector('[class*="price"]')?.textContent || '';
            const priceMatch = priceText.match(/\$?([\d,]+)/);
            const price = extract.price || (priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null);
            
            // Extract year, make, model from title
            const yearMatch = title.match(/\b(19|20)\d{2}\b/);
            const year = extract.year || (yearMatch ? parseInt(yearMatch[0]) : null);
            
            const titleParts = title.split(/\s+/);
            let make: string | null = null;
            let model: string | null = null;
            
            if (year && titleParts.length > 2) {
              const yearIndex = titleParts.findIndex(p => p === String(year));
              if (yearIndex >= 0 && yearIndex < titleParts.length - 1) {
                make = extract.make || titleParts[yearIndex + 1] || null;
                model = extract.model || titleParts.slice(yearIndex + 2).join(' ') || null;
              }
            }
            
            // Extract mileage
            const mileageText = doc?.querySelector('[class*="mileage"], [class*="odometer"]')?.textContent || '';
            const mileageMatch = mileageText.match(/([\d,]+)\s*(?:mi|miles|mile)/i);
            const mileage = extract.mileage || (mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null);
            
            // Extract location
            const location = extract.location || 
                           doc?.querySelector('[class*="location"]')?.textContent?.trim() || 
                           null;
            
            // Extract description
            const description = extract.description || 
                              doc?.querySelector('[class*="description"]')?.textContent?.trim() || 
                              null;
            
            // Extract VIN
            const vinMatch = listingHtml.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
            const vin = extract.vin || (vinMatch ? vinMatch[1].toUpperCase() : null);
            
            // Extract images
            const images: string[] = extract.images || [];
            if (images.length === 0) {
              const imgTags = doc?.querySelectorAll('img[src*="ksl"], img[data-src*="ksl"]') || [];
              for (const img of imgTags) {
                const src = (img as any).getAttribute('src') || (img as any).getAttribute('data-src');
                if (src && src.includes('ksl') && !src.includes('logo') && !src.includes('icon')) {
                  images.push(src.startsWith('http') ? src : `https://cars.ksl.com${src}`);
                }
              }
            }
            
            listings.push({
              url,
              listingId,
              title,
              price,
              imageUrl: images[0] || null,
              year,
              make,
              model,
              mileage,
              location,
              description,
              images,
              vin
            });
          } else {
            // Fallback: extract basic info from search results HTML
            const urlIndex = html.indexOf(url);
            if (urlIndex > -1) {
              const context = html.substring(Math.max(0, urlIndex - 500), urlIndex + 500);
              const titleMatch = context.match(/<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)</i) || 
                                 context.match(/<h[23][^>]*>([^<]+)</i);
              const priceMatch = context.match(/\$([\d,]+)/);
              
              listings.push({
                url,
                listingId,
                title: titleMatch ? titleMatch[1].trim() : 'Untitled Listing',
                price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
                imageUrl: null,
                year: null,
                make: null,
                model: null,
                mileage: null,
                location: null,
                description: null,
                images: [],
                vin: null
              });
            }
          }
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error: any) {
          console.error(`Error scraping listing ${url}:`, error.message);
          // Add basic listing even if scrape fails
          listings.push({
            url,
            listingId,
            title: 'Untitled Listing',
            price: null,
            imageUrl: null,
            year: null,
            make: null,
            model: null,
            mileage: null,
            location: null,
            description: null,
            images: [],
            vin: null
          });
        }
      }

      console.log(`✅ Found ${listings.length} KSL listings`);

      // Always add listings to import queue (standardize behavior)
      let queuedCount = 0;
      let skippedCount = 0;
      
      if (listings.length > 0) {
        for (const listing of listings) {
          try {
            // Check if already in queue
            const { data: existing } = await supabase
              .from('import_queue')
              .select('id')
              .eq('listing_url', listing.url)
              .maybeSingle();

            if (existing) {
              skippedCount++;
              continue;
            }

            // Check if vehicle already exists
            const { data: existingVehicle } = await supabase
              .from('vehicles')
              .select('id')
              .eq('discovery_url', listing.url)
              .maybeSingle();

            if (existingVehicle) {
              skippedCount++;
              continue;
            }

            // Add to queue with full vehicle data
            const { error: queueError } = await supabase
              .from('import_queue')
              .insert({
                source_id: sourceId,
                listing_url: listing.url,
                listing_title: listing.title,
                listing_price: listing.price,
                listing_year: listing.year,
                listing_make: listing.make,
                listing_model: listing.model,
                thumbnail_url: listing.imageUrl,
                raw_data: {
                  source: 'KSL',
                  listing_id: listing.listingId,
                  title: listing.title,
                  price: listing.price,
                  year: listing.year,
                  make: listing.make,
                  model: listing.model,
                  mileage: listing.mileage,
                  location: listing.location,
                  description: listing.description,
                  images: listing.images,
                  vin: listing.vin
                },
                status: 'pending',
                priority: listing.year && listing.year >= 1970 && listing.year <= 1991 ? 10 : 0
              });

            if (queueError) {
              console.error(`Failed to queue listing ${listing.url}:`, queueError.message);
            } else {
              queuedCount++;
            }
          } catch (e: any) {
            console.error(`Error queuing listing:`, e?.message);
          }
        }
      }

      // Update source health tracking
      if (sourceId) {
        await supabase
          .from('scrape_sources')
          .update({
            last_scraped_at: new Date().toISOString(),
            last_successful_scrape: new Date().toISOString(),
            total_listings_found: listings.length,
            updated_at: new Date().toISOString()
          })
          .eq('id', sourceId);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          listings,
          count: listings.length,
          searchUrl: kslSearchUrl,
          queued: queuedCount,
          skipped: skippedCount,
          source_id: sourceId
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );

    } catch (error: any) {
      console.error('KSL scrape error:', error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error?.message || String(error)
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }
  } catch (error: any) {
    console.error('KSL scraper error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error?.message || String(error) || 'Unknown error occurred'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

