import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScrapeRequest {
  source_url: string;
  source_type: 'dealer' | 'auction' | 'marketplace' | 'classifieds';
  search_query?: string;
  extract_listings?: boolean;
  extract_dealer_info?: boolean;
  use_llm_extraction?: boolean;
  max_listings?: number;
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

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    if (!FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    const body: ScrapeRequest = await req.json();
    const { 
      source_url, 
      source_type = 'dealer',
      search_query,
      extract_listings = true,
      extract_dealer_info = true,
      use_llm_extraction = true,
      max_listings = 100
    } = body;

    console.log(`Scraping ${source_url} (${source_type})`);

    // Step 1: Scrape with Firecrawl STRUCTURED EXTRACTION (AGGRESSIVE)
    console.log('🔥 Using Firecrawl structured extraction for inventory...');
    
    const isAuctionHouse = source_type === 'auction' || source_type === 'auction_house';
    const extractionSchema = {
      type: 'object',
      properties: {
        dealer_info: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            zip: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            website: { type: 'string' },
            dealer_license: { type: 'string' },
            specialties: {
              type: 'array',
              items: { type: 'string' }
            },
            description: { type: 'string' }
          }
        },
        listings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              price: { type: 'number' },
              year: { type: 'number' },
              make: { type: 'string' },
              model: { type: 'string' },
              trim: { type: 'string' },
              mileage: { type: 'number' },
              location: { type: 'string' },
              thumbnail_url: { type: 'string' },
              description_snippet: { type: 'string' },
              vin: { type: 'string' },
              is_squarebody: { type: 'boolean' }
            }
          }
        },
        next_page_url: { type: 'string' },
        total_listings_on_page: { type: 'number' }
      }
    };

    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
      },
      body: JSON.stringify({
        url: source_url,
        formats: ['markdown', 'html', 'extract'],
        extract: {
          schema: extractionSchema
        },
        onlyMainContent: false,
        waitFor: 4000 // More time for JS-heavy dealer sites
      })
    });

    if (!firecrawlResponse.ok) {
      const errorText = await firecrawlResponse.text();
      throw new Error(`Firecrawl error: ${firecrawlResponse.status} - ${errorText}`);
    }

    const firecrawlData = await firecrawlResponse.json();
    
    if (!firecrawlData.success) {
      throw new Error(`Firecrawl failed: ${JSON.stringify(firecrawlData)}`);
    }

    const { markdown, html, metadata, extract } = firecrawlData.data;
    console.log(`Scraped ${markdown?.length || 0} chars markdown, ${html?.length || 0} chars html`);

    let dealerInfo = null;
    let listings: any[] = [];

    // Step 2: Use Firecrawl structured extraction results
    if (extract) {
      console.log('✅ Firecrawl structured extraction successful');
      dealerInfo = extract.dealer_info || null;
      listings = extract.listings || [];
      console.log(`Firecrawl extracted: dealer=${!!dealerInfo}, listings=${listings.length}`);
      
      // Handle pagination if next_page_url exists
      if (extract.next_page_url && listings.length > 0) {
        console.log(`📄 Pagination detected: ${extract.next_page_url}`);
        // Note: Could recursively scrape next pages here if needed
      }
    }

    // Step 3: LLM Extraction fallback if Firecrawl extract failed
    if (listings.length === 0 && use_llm_extraction && OPENAI_API_KEY) {
    if (use_llm_extraction && OPENAI_API_KEY) {
      console.log('Running LLM extraction...');

      const extractionPrompt = `You are a data extraction expert for automotive listings. Analyze this webpage and extract structured data.

SOURCE URL: ${source_url}
SOURCE TYPE: ${source_type}
${search_query ? `SEARCH QUERY: ${search_query}` : ''}

WEBPAGE CONTENT:
${markdown?.substring(0, 30000) || ''}

EXTRACT THE FOLLOWING:

1. DEALER/ORGANIZATION INFO (if this is a dealer page):
{
  "name": "dealer name",
  "address": "full address",
  "city": "city",
  "state": "state abbreviation",
  "zip": "zip code",
  "phone": "phone number",
  "email": "email if found",
  "website": "main website URL",
  "dealer_license": "license number if shown",
  "specialties": ["list of specialties like 'classic trucks', 'muscle cars'"],
  "description": "brief description of the dealer"
}

2. VEHICLE LISTINGS (extract ALL vehicles found, especially Chevrolet/GMC trucks 1967-1991):
[
  {
    "title": "listing title",
    "url": "full URL to listing",
    "price": 12500,
    "year": 1985,
    "make": "Chevrolet",
    "model": "K10",
    "trim": "Scottsdale",
    "mileage": 85000,
    "location": "City, ST",
    "thumbnail_url": "image URL",
    "description_snippet": "first 200 chars of description",
    "is_squarebody": true
  }
]

Focus on finding:
- Chevrolet C10, C20, C30, K10, K20, K30 (1967-1991)
- GMC C1500, C2500, K1500, K2500 (1967-1991)
- Chevrolet Blazer, Suburban (1967-1991)
- GMC Jimmy, Suburban (1967-1991)

Return ONLY valid JSON in this format:
{
  "dealer_info": { ... } or null,
  "listings": [ ... ],
  "total_listings_on_page": number,
  "squarebody_count": number,
  "next_page_url": "URL if pagination found" or null
}`;

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You extract structured data from webpages. Return only valid JSON, no markdown formatting.' },
            { role: 'user', content: extractionPrompt }
          ],
          temperature: 0.1,
          max_tokens: 4000
        })
      });

      if (openaiResponse.ok) {
        const openaiData = await openaiResponse.json();
        const content = openaiData.choices?.[0]?.message?.content || '';
        
        try {
          // Clean up potential markdown formatting
          let jsonStr = content.trim();
          if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.slice(7);
          }
          if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.slice(3);
          }
          if (jsonStr.endsWith('```')) {
            jsonStr = jsonStr.slice(0, -3);
          }
          
          const extracted = JSON.parse(jsonStr.trim());
          dealerInfo = extracted.dealer_info;
          listings = extracted.listings || [];
          
          console.log(`LLM extracted: dealer=${!!dealerInfo}, listings=${listings.length}`);
        } catch (parseError) {
          console.error('Failed to parse LLM response:', parseError);
          console.log('Raw response:', content.substring(0, 500));
        }
      } else {
        console.error('OpenAI API error:', await openaiResponse.text());
      }
    }

    // Step 4: Last resort - try Firecrawl again with different approach (sitemap or deeper crawl)
    if (listings.length === 0 && html) {
      console.log('⚠️ No listings found, attempting Firecrawl with deeper extraction...');
      
      // Try scraping with actions to interact with page (if needed)
      // For now, fallback to basic URL extraction
      const listingPatterns = [
        /href="([^"]*\/listing\/[^"]+)"/gi,
        /href="([^"]*\/vehicle\/[^"]+)"/gi,
        /href="([^"]*\/inventory\/[^"]+)"/gi,
        /href="([^"]*\/cars\/[^"]+)"/gi,
        /href="([^"]*\/trucks\/[^"]+)"/gi,
        /href="([^"]*\/inventory\/[^/]+\/[^"]+)"/gi,
        /data-url="([^"]+)"/gi,
        /data-href="([^"]+)"/gi
      ];
      
      const foundUrls = new Set<string>();
      for (const pattern of listingPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          let url = match[1];
          if (!url.startsWith('http')) {
            const baseUrl = new URL(source_url);
            url = `${baseUrl.origin}${url.startsWith('/') ? '' : '/'}${url}`;
          }
          // Filter out non-vehicle URLs
          if (url.match(/\/(vehicle|listing|inventory|cars|trucks|detail|detail\.aspx)/i)) {
            foundUrls.add(url);
          }
        }
      }
      
      listings = Array.from(foundUrls).slice(0, max_listings).map(url => ({
        url,
        title: null,
        price: null,
        year: null,
        make: null,
        model: null
      }));
      
      console.log(`Fallback extracted ${listings.length} listing URLs`);
    }

    // Step 4: Create/update source in database
    let sourceId: string | null = null;
    
    const { data: existingSource } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('url', source_url)
      .single();

    if (existingSource) {
      sourceId = existingSource.id;
      await supabase
        .from('scrape_sources')
        .update({
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          total_listings_found: listings.length,
          squarebody_count: listings.filter((l: any) => l.is_squarebody).length,
          updated_at: new Date().toISOString()
        })
        .eq('id', sourceId);
    } else {
      const { data: newSource, error: sourceError } = await supabase
        .from('scrape_sources')
        .insert({
          name: dealerInfo?.name || metadata?.title || new URL(source_url).hostname,
          url: source_url,
          source_type,
          inventory_url: source_url,
          contact_info: dealerInfo ? {
            phone: dealerInfo.phone,
            email: dealerInfo.email
          } : {},
          location: dealerInfo ? {
            address: dealerInfo.address,
            city: dealerInfo.city,
            state: dealerInfo.state,
            zip: dealerInfo.zip
          } : {},
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          total_listings_found: listings.length,
          squarebody_count: listings.filter((l: any) => l.is_squarebody).length
        })
        .select('id')
        .single();

      if (newSource) {
        sourceId = newSource.id;
      }
    }

    // Step 5: Create/update business if dealer info found
    let organizationId: string | null = null;
    
    if (dealerInfo && dealerInfo.name) {
      const businessType = (source_type === 'auction' || source_type === 'auction_house') ? 'auction_house' : 'dealer';
      
      // Try to find existing business by website (strongest signal)
      let existingOrg = null;
      if (dealerInfo.website) {
        const { data } = await supabase
          .from('businesses')
          .select('id, business_name')
          .eq('website', dealerInfo.website)
          .maybeSingle();
        existingOrg = data;
      }
      
      // Fallback: match by name + city + state if no website match
      if (!existingOrg && dealerInfo.name && dealerInfo.city && dealerInfo.state) {
        const { data } = await supabase
          .from('businesses')
          .select('id, business_name')
          .ilike('business_name', `%${dealerInfo.name}%`)
          .ilike('city', `%${dealerInfo.city}%`)
          .eq('state', dealerInfo.state.toUpperCase())
          .maybeSingle();
        existingOrg = data;
      }

      if (existingOrg) {
        organizationId = existingOrg.id;
        console.log(`✅ Found existing business: ${existingOrg.business_name} (${organizationId})`);
        
        // Update inventory counts if we have them
        const updates: any = {
          updated_at: new Date().toISOString()
        };
        
        // Only update if we have actual data
        if (listings.length > 0) {
          updates.total_vehicles = listings.length;
        }
        
        // Update missing fields
        if (dealerInfo.website && !existingOrg.website) {
          updates.website = dealerInfo.website;
        }
        if (dealerInfo.dealer_license) {
          updates.dealer_license = dealerInfo.dealer_license;
        }
        
        await supabase
          .from('businesses')
          .update(updates)
          .eq('id', organizationId);
      } else {
        // Create new business
        const { data: newOrg, error: orgError } = await supabase
          .from('businesses')
          .insert({
            business_name: dealerInfo.name,
            type: businessType,
            business_type: businessType === 'auction_house' ? 'other' : 'dealership',
            description: dealerInfo.description,
            address: dealerInfo.address,
            city: dealerInfo.city,
            state: dealerInfo.state,
            zip_code: dealerInfo.zip,
            phone: dealerInfo.phone,
            email: dealerInfo.email,
            website: dealerInfo.website,
            dealer_license: dealerInfo.dealer_license,
            specializations: dealerInfo.specialties || [],
            total_vehicles: listings.length || 0,
            source_url: source_url,
            discovered_via: 'scraper',
            metadata: {
              scrape_source_id: sourceId,
              inventory_url: source_url,
              squarebody_count: listings.filter((l: any) => l.is_squarebody).length
            }
          })
          .select('id, business_name')
          .single();

        if (newOrg) {
          organizationId = newOrg.id;
          console.log(`✅ Created new business: ${newOrg.business_name} (${organizationId})`);
        } else if (orgError) {
          console.error('Error creating business:', orgError);
        }
      }
    }

    // Step 6: Queue listings for import
    let queuedCount = 0;
    let duplicateCount = 0;

    for (const listing of listings.slice(0, max_listings)) {
      if (!listing.url) continue;

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
          thumbnail_url: listing.thumbnail_url,
          raw_data: listing,
          priority: listing.is_squarebody ? 10 : 0
        });

      if (queueError) {
        if (queueError.code === '23505') { // Unique violation
          duplicateCount++;
        } else {
          console.error('Queue error:', queueError);
        }
      } else {
        queuedCount++;
      }
    }

    console.log(`Queued ${queuedCount} new listings, ${duplicateCount} duplicates skipped`);

    return new Response(JSON.stringify({
      success: true,
      source_id: sourceId,
      organization_id: organizationId,
      dealer_info: dealerInfo,
      listings_found: listings.length,
      listings_queued: queuedCount,
      duplicates_skipped: duplicateCount,
      squarebody_count: listings.filter((l: any) => l.is_squarebody).length,
      sample_listings: listings.slice(0, 5)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Scrape error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

