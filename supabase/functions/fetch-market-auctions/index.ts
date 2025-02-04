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

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Exponential backoff retry function
async function retryWithBackoff(
  fn: () => Promise<any>,
  retries = 3,
  baseDelay = 1000,
): Promise<any> {
  try {
    return await fn();
  } catch (error) {
    if (error?.statusCode === 429 && retries > 0) {
      const waitTime = baseDelay * Math.pow(2, 3 - retries);
      console.log(`Rate limited, waiting ${waitTime}ms before retry. Retries left: ${retries}`);
      await delay(waitTime);
      return retryWithBackoff(fn, retries - 1, baseDelay);
    }
    throw error;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
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
        url: 'https://bringatrailer.com/auctions/',
        patterns: [
          '.auction-list-item',
          '.auction-title',
          '.current-bid',
          '.auction-image',
          '.auction-end-time'
        ]
      },
      {
        url: 'https://carsandbids.com/auctions',
        patterns: [
          '.auction-card',
          '.auction-title',
          '.current-bid',
          '.auction-image',
          '.time-remaining'
        ]
      },
      {
        url: 'https://www.hagerty.com/marketplace/inventory',
        patterns: [
          '.vehicle-card',
          '.vehicle-title',
          '.price',
          '.vehicle-image',
          '.listing-date'
        ]
      }
    ]
    
    const results: AuctionData[] = []
    
    // Process sources sequentially to avoid rate limits
    for (const source of sources) {
      console.log(`Crawling ${source.url}...`)
      try {
        const response = await retryWithBackoff(async () => {
          return await firecrawl.crawlUrl(source.url, {
            limit: 5, // Reduced from 10 to avoid rate limits
            scrapeOptions: {
              patterns: source.patterns,
              waitForSelector: '.auction-list-item, .auction-card, .vehicle-card',
              timeout: 10000
            }
          })
        });
        
        if (response.success) {
          const sourceName = new URL(source.url).hostname.replace('www.', '').split('.')[0]
          
          const extractedData = response.data
            .map(item => {
              // Enhanced regex patterns for better data extraction
              const yearMatch = item.content.match(/\b(19|20)\d{2}\b/)
              const priceMatch = item.content.match(/\$[\d,]+(?:\.\d{2})?/)
              const makeModelMatch = item.content.match(/(?:19|20)\d{2}\s+([A-Za-z-]+)\s+([A-Za-z0-9-]+)/)
              const endTimeMatch = item.content.match(/Ends\s+(\w+\s+\d+(?:st|nd|rd|th)?\s+\d+:\d+\s*(?:AM|PM|am|pm))/i)
              
              if (yearMatch && priceMatch && makeModelMatch) {
                return {
                  make: makeModelMatch[1],
                  model: makeModelMatch[2],
                  year: parseInt(yearMatch[0]),
                  price: parseFloat(priceMatch[0].replace(/[$,]/g, '')),
                  url: item.url || source.url,
                  source: sourceName,
                  endTime: endTimeMatch ? new Date(endTimeMatch[1]).toISOString() : undefined,
                  imageUrl: item.images?.[0]
                }
              }
              return null
            })
            .filter(Boolean)
          
          results.push(...extractedData)
          console.log(`Successfully extracted ${extractedData.length} auctions from ${sourceName}`)
          
          // Add delay between sources to avoid rate limits
          await delay(2000)
        } else {
          console.error(`Failed to crawl ${source.url}:`, response)
        }
      } catch (error) {
        console.error(`Error crawling ${source.url}:`, error)
        if (error?.statusCode === 429) {
          console.log('Rate limit reached, skipping remaining sources')
          break
        }
      }
    }

    // If no results were found, return empty array instead of sample data
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