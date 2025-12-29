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
        // Use Firecrawl for better HTML parsing (v1 API)
        const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
        let html = '';
        
        if (firecrawlKey) {
          try {
            console.log(`   🔥 Using Firecrawl for ${pageUrl}`);
            const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${firecrawlKey}`,
              },
              body: JSON.stringify({
                url: pageUrl,
                waitFor: 2000,
                formats: ['html'],
              }),
            });

            if (firecrawlResponse.ok) {
              const firecrawlData = await firecrawlResponse.json();
              if (firecrawlData.success && firecrawlData.data?.html) {
                html = firecrawlData.data.html;
                console.log(`   ✅ Got ${html.length} chars via Firecrawl`);
              }
            } else {
              console.log(`   ⚠️  Firecrawl HTTP ${firecrawlResponse.status}`);
            }
          } catch (firecrawlError: any) {
            console.log(`   ⚠️  Firecrawl failed: ${firecrawlError.message}, trying direct fetch...`);
          }
        } else {
          console.log(`   ⚠️  No FIRECRAWL_API_KEY found`);
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

        // Extract vehicle listings - simpler approach: find all vehicle links
        // URLs follow pattern: /vehicles/123/2014-cadillac-cts-v-wagon
        const vehicleLinks = new Set<string>();
        
        // Method 1: Extract from href attributes
        const allLinks = doc.querySelectorAll('a[href*="/vehicles/"]');
        allLinks.forEach(link => {
          const href = link.getAttribute('href');
          if (href && href.match(/\/vehicles\/\d+\/\d{4}-/)) {
            vehicleLinks.add(href);
          }
        });
        
        // Method 2: Also search the raw HTML with regex for any missed links
        const hrefMatches = html.matchAll(/href="(\/vehicles\/\d+\/\d{4}-[^"]+)"/g);
        for (const m of hrefMatches) {
          vehicleLinks.add(m[1]);
        }
        
        console.log(`   🔗 Found ${vehicleLinks.size} unique vehicle links`);
        
        // Convert to array for processing
        const vehicleElements = Array.from(vehicleLinks).map(href => {
          // Create a pseudo-element with the href
          return { getAttribute: () => href } as any;
        });
        
        let foundOnPage = 0;
        const seenUrls = new Set<string>();
        
        vehicleElements.forEach((element) => {
          const href = element.getAttribute('href');
          if (!href) return;

          const fullUrl = href.startsWith('http') ? href : `https://www.collectiveauto.com${href}`;
          
          // Skip duplicates
          if (seenUrls.has(fullUrl)) return;
          seenUrls.add(fullUrl);
          
          // Parse year/make/model from URL slug: /vehicles/123/2014-cadillac-cts-v-wagon
          const urlMatch = href.match(/\/vehicles\/\d+\/(\d{4})-(.+)$/);
          if (!urlMatch) return;
          
          const year = parseInt(urlMatch[1]);
          const slugParts = urlMatch[2].split('-');
          
          // First part is make, rest is model
          const make = slugParts[0].charAt(0).toUpperCase() + slugParts[0].slice(1);
          const model = slugParts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
          
          // Try to find VIN in surrounding HTML context
          const vinContextMatch = html.match(new RegExp(`${href}[^<>]*?([A-HJ-NPR-Z0-9]{17})`, 'i'));
          const vin = vinContextMatch ? vinContextMatch[1].toUpperCase() : undefined;
          
          // Try to find mileage in surrounding context
          const mileageContextMatch = html.match(new RegExp(`${href}[^<>]*?(\\d{1,3},?\\d{3})\\s*Miles`, 'i'));
          const mileage = mileageContextMatch ? parseInt(mileageContextMatch[1].replace(/,/g, '')) : undefined;

          listings.push({
            vin,
            year,
            make,
            model,
            mileage,
            listing_url: fullUrl,
            image_url: undefined,
            sold_price: undefined,
          });
          foundOnPage++;
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
          .eq('listing_url', listing.listing_url)
          .maybeSingle();

        if (existing) {
          duplicates++;
          continue;
        }

        // Check if vehicle already exists (by VIN or by listing URL)
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
        
        // Also check by listing URL in vehicles table
        const { data: existingByUrl } = await supabase
          .from('vehicles')
          .select('id')
          .eq('listing_url', listing.listing_url)
          .maybeSingle();
        
        if (existingByUrl) {
          duplicates++;
          continue;
        }

        // Queue for processing (use correct column names)
        const { error: insertError } = await supabase
          .from('import_queue')
          .insert({
            listing_url: listing.listing_url,
            listing_title: `${listing.year} ${listing.make} ${listing.model}`,
            listing_year: listing.year,
            listing_make: listing.make,
            listing_model: listing.model,
            source_id: orgId,
            status: 'pending',
            raw_data: {
              vin: listing.vin,
              mileage: listing.mileage,
              image_url: listing.image_url,
              listing_status: 'sold',
              source: 'Collective Auto Group',
              discovered_at: new Date().toISOString(),
            },
          });
        
        if (insertError) {
          console.error(`   ❌ Insert error: ${insertError.message}`);
        } else {
          queued++;
        }
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

