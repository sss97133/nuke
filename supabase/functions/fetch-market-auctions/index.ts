import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import FirecrawlApp from 'https://esm.sh/@mendable/firecrawl-js'

interface AuctionData {
  make: string;
  model: string;
  year: number;
  price: number;
  url: string;
  source: string;
  endTime?: string;
  imageUrl?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!apiKey) {
      console.error('Firecrawl API key not configured')
      throw new Error('Firecrawl API key not configured')
    }

    const firecrawl = new FirecrawlApp({ apiKey })
    
    console.log('Starting to fetch auction data from multiple sources...')
    const sources = [
      {
        url: 'https://bringatrailer.com/auctions/live/',
        selectors: {
          make: '.auction-title h3',
          model: '.auction-subtitle',
          year: '.auction-year',
          price: '.current-bid',
          endTime: '.auction-end-time',
          imageUrl: '.auction-image img'
        }
      },
      {
        url: 'https://carsandbids.com',
        selectors: {
          make: '.vehicle-make',
          model: '.vehicle-model',
          year: '.vehicle-year',
          price: '.current-bid',
          endTime: '.end-time',
          imageUrl: '.main-image img'
        }
      },
      {
        url: 'https://www.hagerty.com/marketplace',
        selectors: {
          make: '.vehicle-make',
          model: '.vehicle-model',
          year: '.vehicle-year',
          price: '.asking-price',
          imageUrl: '.vehicle-image img'
        }
      }
    ]
    
    const results: AuctionData[] = []
    
    for (const source of sources) {
      console.log(`Crawling ${source.url}...`)
      try {
        const response = await firecrawl.crawlUrl(source.url, {
          limit: 10,
          scrapeOptions: {
            formats: ['markdown', 'html'],
            selectors: source.selectors
          }
        })
        
        if (response.success) {
          const sourceName = new URL(source.url).hostname.replace('www.', '').split('.')[0]
          
          const processedData = response.data
            .filter(item => item.make && item.model && item.year && item.price)
            .map(item => ({
              make: String(item.make).trim(),
              model: String(item.model).trim(),
              year: parseInt(String(item.year).replace(/\D/g, '')),
              price: parseFloat(String(item.price).replace(/[$,]/g, '')),
              url: item.url,
              source: sourceName,
              endTime: item.endTime ? new Date(item.endTime).toISOString() : undefined,
              imageUrl: item.imageUrl
            }))
          
          results.push(...processedData)
          console.log(`Successfully fetched ${processedData.length} auctions from ${sourceName}`)
        }
      } catch (error) {
        console.error(`Error crawling ${source.url}:`, error)
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