// Supabase Edge Function to scrape KSL listings and import them
// Can be called from admin UI or scheduled cron

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { searchUrl, maxListings = 20, importToDb = false } = body;
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

      // Extract listing details from HTML
      for (const url of Array.from(foundUrls).slice(0, maxListings)) {
        const listingIdMatch = url.match(/\/listing\/(\d+)/);
        const listingId = listingIdMatch ? listingIdMatch[1] : null;
        
        // Try to extract title and price from HTML context around the URL
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
            imageUrl: null
          });
        } else {
          listings.push({
            url,
            listingId,
            title: 'Untitled Listing',
            price: null,
            imageUrl: null
          });
        }
      }

      console.log(`✅ Found ${listings.length} KSL listings`);

      // If importToDb is true, add listings to import queue
      if (importToDb && listings.length > 0) {
        for (const listing of listings) {
          try {
            const { error: queueError } = await supabase
              .from('import_queue')
              .insert({
                listing_url: listing.url,
                source: 'ksl',
                source_name: 'KSL Cars',
                status: 'pending',
                metadata: {
                  listing_id: listing.listingId,
                  title: listing.title,
                  price: listing.price
                }
              });

            if (queueError) {
              console.error(`Failed to queue listing ${listing.url}:`, queueError.message);
            }
          } catch (e: any) {
            console.error(`Error queuing listing:`, e?.message);
          }
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          listings,
          count: listings.length,
          searchUrl: kslSearchUrl,
          imported: importToDb ? listings.length : 0
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

