import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { FireCrawl } from "@mendable/firecrawl-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuctionSource {
  url: string;
  patterns: string[];
  sourceName: string;
}

interface ExtractedAuction {
  make: string;
  model: string;
  year: number;
  price: number;
  url: string;
  source: string;
  endTime?: string;
  imageUrl?: string;
}

const SOURCES: AuctionSource[] = [
  {
    url: 'https://bringatrailer.com/auctions/',
    patterns: [
      '.auction-list-item',
      '.auction-title',
      '.current-bid',
      '.auction-image',
      '.auction-end-time'
    ],
    sourceName: 'bringatrailer'
  },
  {
    url: 'https://carsandbids.com/auctions',
    patterns: [
      '.auction-card',
      '.auction-title',
      '.current-bid',
      '.auction-image',
      '.time-remaining'
    ],
    sourceName: 'carsandbids'
  },
  {
    url: 'https://www.hagerty.com/marketplace/inventory',
    patterns: [
      '.vehicle-card',
      '.vehicle-title',
      '.price',
      '.vehicle-image',
      '.listing-date'
    ],
    sourceName: 'hagerty'
  }
];

const extractAuctionData = (content: string, url: string, sourceName: string, images?: string[]): ExtractedAuction | null => {
  const yearMatch = content.match(/\b(19|20)\d{2}\b/);
  const priceMatch = content.match(/\$[\d,]+(?:\.\d{2})?/);
  const makeModelMatch = content.match(/(?:19|20)\d{2}\s+([A-Za-z-]+)\s+([A-Za-z0-9-]+)/);
  const endTimeMatch = content.match(/Ends\s+(\w+\s+\d+(?:st|nd|rd|th)?\s+\d+:\d+\s*(?:AM|PM|am|pm))/i);

  if (yearMatch && priceMatch && makeModelMatch) {
    return {
      year: parseInt(yearMatch[0]),
      make: makeModelMatch[1],
      model: makeModelMatch[2],
      price: parseFloat(priceMatch[0].replace(/[$,]/g, '')),
      url: url,
      source: sourceName,
      endTime: endTimeMatch ? new Date(endTimeMatch[1]).toISOString() : undefined,
      imageUrl: images?.[0]
    };
  }
  return null;
};

const crawlSource = async (source: AuctionSource, firecrawl: FireCrawl): Promise<ExtractedAuction[]> => {
  try {
    console.log(`Crawling ${source.sourceName}...`);
    const response = await firecrawl.crawlUrl(source.url, {
      limit: 5,
      scrapeOptions: {
        patterns: source.patterns,
        waitForSelector: '.auction-list-item, .auction-card, .vehicle-card',
        timeout: 10000
      }
    });

    return response.data
      .map(item => extractAuctionData(item.content, item.url || source.url, source.sourceName, item.images))
      .filter((item): item is ExtractedAuction => item !== null);
  } catch (error) {
    console.error(`Error crawling ${source.url}:`, error);
    return [];
  }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting to fetch auction data from multiple sources...');
    const firecrawl = new FireCrawl(Deno.env.get('FIRECRAWL_API_KEY')!);
    const results: ExtractedAuction[] = [];

    for (const source of SOURCES) {
      try {
        const sourceResults = await crawlSource(source, firecrawl);
        results.push(...sourceResults);
        
        // Add delay between sources to avoid rate limits
        await delay(1000);
      } catch (error) {
        console.error(`Error processing source ${source.sourceName}:`, error);
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
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching auction data:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});