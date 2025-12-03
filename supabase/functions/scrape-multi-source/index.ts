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

    // Step 1: Scrape with Firecrawl
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
      },
      body: JSON.stringify({
        url: source_url,
        formats: ['markdown', 'html'],
        onlyMainContent: false,
        waitFor: 3000
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

    const { markdown, html, metadata } = firecrawlData.data;
    console.log(`Scraped ${markdown?.length || 0} chars markdown, ${html?.length || 0} chars html`);

    let dealerInfo = null;
    let listings: any[] = [];

    // Step 2: LLM Extraction if enabled
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

    // Step 3: Fallback regex extraction for listings if LLM failed
    if (listings.length === 0 && html) {
      console.log('Falling back to regex extraction...');
      
      // Extract listing URLs
      const listingPatterns = [
        /href="([^"]*\/listing\/[^"]+)"/gi,
        /href="([^"]*\/vehicle\/[^"]+)"/gi,
        /href="([^"]*\/inventory\/[^"]+)"/gi,
        /href="([^"]*\/cars\/[^"]+)"/gi,
        /href="([^"]*\/trucks\/[^"]+)"/gi
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
          foundUrls.add(url);
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
      
      console.log(`Regex extracted ${listings.length} listing URLs`);
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

    // Step 5: Create organization if dealer info found
    let organizationId: string | null = null;
    
    if (dealerInfo && dealerInfo.name) {
      const slug = dealerInfo.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      
      const { data: existingOrg } = await supabase
        .from('organizations')
        .select('id')
        .or(`slug.eq.${slug},website.eq.${dealerInfo.website}`)
        .single();

      if (existingOrg) {
        organizationId = existingOrg.id;
        await supabase
          .from('organizations')
          .update({
            total_inventory: listings.length,
            squarebody_inventory: listings.filter((l: any) => l.is_squarebody).length,
            last_inventory_sync: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', organizationId);
      } else {
        const { data: newOrg, error: orgError } = await supabase
          .from('organizations')
          .insert({
            name: dealerInfo.name,
            slug,
            type: source_type === 'auction' ? 'auction_house' : 'dealer',
            description: dealerInfo.description,
            address: dealerInfo.address,
            city: dealerInfo.city,
            state: dealerInfo.state,
            zip: dealerInfo.zip,
            phone: dealerInfo.phone,
            email: dealerInfo.email,
            website: dealerInfo.website,
            dealer_license: dealerInfo.dealer_license,
            specialties: dealerInfo.specialties,
            inventory_url: source_url,
            scrape_source_id: sourceId,
            total_inventory: listings.length,
            squarebody_inventory: listings.filter((l: any) => l.is_squarebody).length,
            last_inventory_sync: new Date().toISOString(),
            source_url,
            discovered_via: 'scraper'
          })
          .select('id')
          .single();

        if (newOrg) {
          organizationId = newOrg.id;
          console.log(`Created organization: ${dealerInfo.name} (${organizationId})`);
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

