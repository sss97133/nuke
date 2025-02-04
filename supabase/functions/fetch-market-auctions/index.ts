import FirecrawlApp from '@mendable/firecrawl-js'

interface AuctionData {
  make: string;
  model: string;
  year: number;
  price: number;
  url: string;
  source: string;
  endTime?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!apiKey) {
      throw new Error('Firecrawl API key not configured')
    }

    const firecrawl = new FirecrawlApp({ apiKey })
    
    // Crawl multiple auction sites
    const sites = [
      'https://bringatrailer.com/auctions/live/',
      'https://carsandbids.com'
    ]
    
    const results = []
    
    for (const site of sites) {
      console.log(`Crawling ${site}...`)
      const response = await firecrawl.crawlUrl(site, {
        limit: 10,
        scrapeOptions: {
          formats: ['markdown', 'html'],
          selectors: {
            make: '.vehicle-make',
            model: '.vehicle-model', 
            year: '.vehicle-year',
            price: '.current-bid',
            endTime: '.auction-end-time'
          }
        }
      })
      
      if (response.success) {
        results.push(...response.data.map((item: any) => ({
          make: item.make,
          model: item.model,
          year: parseInt(item.year),
          price: parseFloat(item.price.replace(/[$,]/g, '')),
          url: item.url,
          source: new URL(site).hostname,
          endTime: item.endTime
        })))
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: results
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (error) {
    console.error('Error fetching auction data:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      }
    )
  }
})