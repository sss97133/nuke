/**
 * SCRAPE COLLECTIVE AUTO GROUP SOLD INVENTORY
 * 
 * Scrapes https://www.collectiveauto.com/vehicles/sold
 * Extracts all sold vehicles and ingests them into Nuke
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VehicleListing {
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  mileage?: number;
  price?: number;
  sold_price?: number;
  listing_url: string;
  image_url?: string;
  description?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { organization_id, max_pages = 10 } = body;

    console.log('🔍 SCRAPING COLLECTIVE AUTO GROUP SOLD INVENTORY');
    console.log('='.repeat(70));

    // Get organization
    let orgId = organization_id;
    if (!orgId) {
      const { data: org } = await supabase
        .from('businesses')
        .select('id')
        .eq('website', 'https://www.collectiveauto.com')
        .single();
      
      if (!org) {
        throw new Error('Collective Auto Group organization not found');
      }
      orgId = org.id;
    }

    console.log(`📋 Organization ID: ${orgId}\n`);

    const soldUrl = 'https://www.collectiveauto.com/vehicles/sold';
    const listings: VehicleListing[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Scrape paginated sold inventory
    while (hasMorePages && currentPage <= max_pages) {
      const pageUrl = currentPage === 1 ? soldUrl : `${soldUrl}?page=${currentPage}`;
      console.log(`📄 Scraping page ${currentPage}: ${pageUrl}`);

      try {
        // Use Firecrawl for better HTML parsing
        const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
        let html = '';
        
        if (firecrawlKey) {
          try {
            const firecrawlResponse = await fetch('https://api.firecrawl.dev/v0/scrape', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${firecrawlKey}`,
              },
              body: JSON.stringify({
                url: pageUrl,
                formats: ['html'],
              }),
            });

            if (firecrawlResponse.ok) {
              const firecrawlData = await firecrawlResponse.json();
              html = firecrawlData.data?.html || '';
            }
          } catch (firecrawlError: any) {
            console.log(`   ⚠️  Firecrawl failed: ${firecrawlError.message}, trying direct fetch...`);
          }
        }

        // Fallback to direct fetch
        if (!html) {
          const response = await fetch(pageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });

          if (!response.ok) {
            console.log(`   ⚠️  HTTP ${response.status}, stopping pagination`);
            hasMorePages = false;
            break;
          }

          html = await response.text();
        }

        const doc = new DOMParser().parseFromString(html, 'text/html');

        if (!doc) {
          console.log(`   ⚠️  Failed to parse HTML`);
          hasMorePages = false;
          break;
        }

        // Extract vehicle listings from the page
        // Pattern from HTML: "WP0AA29901S620528 30,372 Miles 2001 Porsche 911 Carrera SOLD"
        // Look for any element containing VIN patterns or vehicle links
        const allLinks = doc.querySelectorAll('a[href*="/vehicles/"]');
        const vehicleElements: Element[] = [];
        
        // Also look for text patterns that match vehicle listings
        allLinks.forEach(link => {
          const text = link.textContent || '';
          // Check if this link contains vehicle info (VIN, year, make/model, "SOLD")
          if (text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/) || // Has VIN
              (text.match(/\b(19|20)\d{2}\b/) && text.includes('SOLD'))) { // Has year and SOLD
            vehicleElements.push(link);
          }
        });
        
        // Also check for divs/spans with vehicle info
        const allElements = doc.querySelectorAll('div, span, li, article');
        allElements.forEach(el => {
          const text = el.textContent || '';
          const href = el.querySelector('a[href*="/vehicles/"]')?.getAttribute('href');
          if (href && (text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/) || 
              (text.match(/\b(19|20)\d{2}\b/) && text.includes('SOLD')))) {
            if (!vehicleElements.includes(el)) {
              vehicleElements.push(el);
            }
          }
        });
        
        let foundOnPage = 0;
        const seenUrls = new Set<string>();
        
        vehicleElements.forEach((element) => {
          // Get the link (might be the element itself or a parent)
          const link = element.tagName === 'A' ? element : element.closest('a[href*="/vehicles/"]');
          if (!link) return;

          const href = link.getAttribute('href');
          if (!href || !href.includes('/vehicles/')) return;

          const fullUrl = href.startsWith('http') ? href : `https://www.collectiveauto.com${href}`;
          
          // Skip duplicates
          if (seenUrls.has(fullUrl)) return;
          seenUrls.add(fullUrl);
          
          // Get text from the element or its parent container
          const container = element.closest('[class*="vehicle"], [class*="listing"], [class*="item"]') || element;
          const text = container.textContent?.trim() || '';
          
          // Parse VIN (usually first, alphanumeric 17 chars)
          const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
          const vin = vinMatch ? vinMatch[1].toUpperCase() : undefined;

          // Parse mileage (number followed by "Miles")
          const mileageMatch = text.match(/([\d,]+)\s*Miles/i);
          const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : undefined;

          // Parse year (4 digits, usually 19xx or 20xx)
          const yearMatch = text.match(/\b(19|20)\d{2}\b/);
          const year = yearMatch ? parseInt(yearMatch[0]) : undefined;

          // Parse make/model (after year, before "SOLD")
          let make: string | undefined;
          let model: string | undefined;
          if (year) {
            const yearIndex = text.indexOf(year.toString());
            if (yearIndex >= 0) {
              const afterYear = text.substring(yearIndex + 4).trim();
              const beforeSold = afterYear.split('SOLD')[0].trim();
              const parts = beforeSold.split(/\s+/).filter(p => p.length > 0);
              if (parts.length >= 1) {
                make = parts[0];
                if (parts.length >= 2) {
                  model = parts.slice(1).join(' ');
                }
              }
            }
          }

          // Extract image if available (check element and parent)
          let imageUrl: string | undefined;
          const img = container.querySelector('img') || element.querySelector('img');
          if (img) {
            imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
            if (imageUrl && !imageUrl.startsWith('http')) {
              imageUrl = `https://www.collectiveauto.com${imageUrl}`;
            }
          }

          // Only add if we have at least VIN or year+make
          if (vin || (year && make)) {
            listings.push({
              vin,
              year,
              make,
              model,
              mileage,
              listing_url: fullUrl,
              image_url: imageUrl,
              sold_price: undefined, // Will be extracted from detail page
            });
            foundOnPage++;
          }
        });

        console.log(`   ✅ Found ${foundOnPage} vehicles on page ${currentPage}`);

        // Check for next page - look for pagination links
        const paginationLinks = doc.querySelectorAll('.pagination a, [class*="pagination"] a, a[href*="page="]');
        let hasNextPage = false;
        
        paginationLinks.forEach((link) => {
          const href = link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';
          // Check if this is a next page link (page number > current, or "Next", or "»")
          if (href.includes(`page=${currentPage + 1}`) || 
              text === '»' || 
              text.toLowerCase().includes('next') ||
              (parseInt(text) === currentPage + 1)) {
            hasNextPage = true;
          }
        });

        // Also check if we found vehicles (if we did, there might be more pages)
        if (foundOnPage === 0 && !hasNextPage) {
          hasMorePages = false;
        } else if (foundOnPage > 0) {
          // If we found vehicles, try next page
          currentPage++;
          // But stop if we've hit max pages
          if (currentPage > max_pages) {
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error: any) {
        console.error(`   ❌ Error scraping page ${currentPage}:`, error.message);
        hasMorePages = false;
      }
    }

    console.log(`\n📊 Total vehicles found: ${listings.length}\n`);

    // Queue vehicles for processing
    console.log('📥 Queuing vehicles for processing...');
    let queued = 0;
    let duplicates = 0;

    for (const listing of listings) {
      try {
        // Check if already in import_queue
        const { data: existing } = await supabase
          .from('import_queue')
          .select('id')
          .eq('source_url', listing.listing_url)
          .maybeSingle();

        if (existing) {
          duplicates++;
          continue;
        }

        // Check if vehicle already exists (by VIN)
        if (listing.vin) {
          const { data: existingVehicle } = await supabase
            .from('vehicles')
            .select('id')
            .eq('vin', listing.vin)
            .maybeSingle();

          if (existingVehicle) {
            duplicates++;
            continue;
          }
        }

        // Queue for processing
        await supabase
          .from('import_queue')
          .insert({
            source_url: listing.listing_url,
            source_type: 'dealer_website',
            organization_id: orgId,
            status: 'pending',
            metadata: {
              vin: listing.vin,
              year: listing.year,
              make: listing.make,
              model: listing.model,
              mileage: listing.mileage,
              image_url: listing.image_url,
              listing_status: 'sold',
              discovered_at: new Date().toISOString(),
            },
          });

        queued++;
      } catch (error: any) {
        console.error(`   ❌ Error queueing ${listing.listing_url}:`, error.message);
      }
    }

    console.log(`\n✅ Queued ${queued} new vehicles`);
    console.log(`   Skipped ${duplicates} duplicates`);

    return new Response(
      JSON.stringify({
        success: true,
        organization_id: orgId,
        vehicles_found: listings.length,
        queued,
        duplicates,
        listings: listings.slice(0, 10), // Return first 10 as sample
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

