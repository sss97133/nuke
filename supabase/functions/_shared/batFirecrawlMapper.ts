/**
 * BaT Firecrawl Mapper
 * Uses Firecrawl's structured extraction API to extract BaT listing data
 * Much cleaner and more reliable than DOM parsing
 */

export interface BatListingData {
  // Basic vehicle info
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
  
  // Auction data
  auction_start_date?: string;
  auction_end_date?: string;
  sale_date?: string;
  sale_price?: number;
  reserve_price?: number;
  bid_count?: number;
  view_count?: number;
  watcher_count?: number;
  comment_count?: number;
  reserve_not_met?: boolean;
  high_bid?: number;
  final_bid?: number;
  
  // Technical specs
  engine?: string;
  transmission?: string;
  drivetrain?: string;
  color?: string;
  interior_color?: string;
  body_style?: string;
  displacement?: string;
  
  // Location and parties
  location?: string;
  seller?: string;
  seller_username?: string;
  buyer?: string;
  buyer_username?: string;
  lot_number?: string;
  
  // Description and content
  description?: string;
  title?: string;
  features?: string[];
  
  // Images
  image_urls?: string[];
  
  // Bid history
  bid_history?: Array<{
    amount: number;
    timestamp?: string;
    bidder?: string;
  }>;
}

/**
 * Firecrawl extraction schema for BaT listings
 * This tells Firecrawl exactly what data to extract and where to find it
 */
const batExtractionSchema = {
  type: "object",
  properties: {
    // Vehicle identification
    vin: {
      type: "string",
      description: "Vehicle Identification Number (VIN) or Chassis number from the BaT Essentials section"
    },
    year: {
      type: "number",
      description: "Model year of the vehicle (from title or essentials)"
    },
    make: {
      type: "string",
      description: "Vehicle manufacturer (e.g., Jaguar, Porsche, Ferrari)"
    },
    model: {
      type: "string",
      description: "Vehicle model name"
    },
    trim: {
      type: "string",
      description: "Trim level or variant (e.g., Series 1, GT, Turbo)"
    },
    mileage: {
      type: "number",
      description: "Odometer reading in miles (e.g., 31000 for 31k Miles)"
    },
    
    // Auction information
    auction_start_date: {
      type: "string",
      description: "Date when auction started (YYYY-MM-DD format)"
    },
    auction_end_date: {
      type: "string",
      description: "Date when auction ended (YYYY-MM-DD format) or data-auction-ends attribute"
    },
    sale_date: {
      type: "string",
      description: "Date when vehicle sold (from 'Sold for USD $X on MM/DD/YY' text)"
    },
    sale_price: {
      type: "number",
      description: "Final sale price in USD (from 'Sold for USD $X' text, only if actually sold)"
    },
    reserve_price: {
      type: "number",
      description: "Reserve price if disclosed"
    },
    bid_count: {
      type: "number",
      description: "Total number of bids placed"
    },
    view_count: {
      type: "number",
      description: "Total number of page views"
    },
    watcher_count: {
      type: "number",
      description: "Number of watchers"
    },
    comment_count: {
      type: "number",
      description: "Number of comments"
    },
    reserve_not_met: {
      type: "boolean",
      description: "True if reserve was not met (RNM)"
    },
    high_bid: {
      type: "number",
      description: "Highest bid amount (for RNM auctions)"
    },
    final_bid: {
      type: "number",
      description: "Final winning bid amount"
    },
    
    // Technical specifications
    engine: {
      type: "string",
      description: "Engine description (e.g., '3.5-Liter V6', 'Inline-Four')"
    },
    transmission: {
      type: "string",
      description: "Transmission type (e.g., 'Five-Speed Manual', 'Ten-Speed Automatic')"
    },
    drivetrain: {
      type: "string",
      description: "Drivetrain (RWD, AWD, 4WD, FWD)"
    },
    color: {
      type: "string",
      description: "Exterior color"
    },
    interior_color: {
      type: "string",
      description: "Interior color/upholstery"
    },
    body_style: {
      type: "string",
      description: "Body style (Roadster, Coupe, Sedan, etc.)"
    },
    displacement: {
      type: "string",
      description: "Engine displacement (e.g., '3.5L', '2.2L')"
    },
    
    // Location and parties
    location: {
      type: "string",
      description: "Vehicle location (city, state or country)"
    },
    seller: {
      type: "string",
      description: "Seller name or username"
    },
    seller_username: {
      type: "string",
      description: "BaT seller username"
    },
    buyer: {
      type: "string",
      description: "Buyer name or username (if sold)"
    },
    buyer_username: {
      type: "string",
      description: "BaT buyer username (if sold)"
    },
    lot_number: {
      type: "string",
      description: "Lot number (e.g., 'Lot #12345')"
    },
    
    // Content
    title: {
      type: "string",
      description: "Full listing title (e.g., '1964 Jaguar XKE Series 1 Roadster')"
    },
    description: {
      type: "string",
      description: "Full listing description text (from post-excerpt or card-body)"
    },
    features: {
      type: "array",
      items: {
        type: "string"
      },
      description: "List of features and equipment"
    },
    
    // Images
    image_urls: {
      type: "array",
      items: {
        type: "string"
      },
      description: "Array of image URLs from the gallery"
    },
    
    // Bid history
    bid_history: {
      type: "array",
      items: {
        type: "object",
        properties: {
          amount: {
            type: "number",
            description: "Bid amount in USD"
          },
          timestamp: {
            type: "string",
            description: "Date/time of bid (YYYY-MM-DD format)"
          },
          bidder: {
            type: "string",
            description: "Bidder username"
          }
        }
      },
      description: "Array of bid events with amounts, timestamps, and bidders"
    }
  }
};

/**
 * Extract BaT listing data using Firecrawl's structured extraction
 */
export async function extractBatListingWithFirecrawl(
  batUrl: string,
  firecrawlApiKey: string
): Promise<{ data: BatListingData | null; html: string | null; markdown: string | null; error?: string }> {
  try {
    console.log(`🔥 Extracting BaT listing with Firecrawl: ${batUrl}`);
    
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlApiKey}`,
      },
      body: JSON.stringify({
        url: batUrl,
        formats: ['html', 'markdown', 'extract'],
        extract: {
          schema: batExtractionSchema,
          systemPrompt: `You are an expert at extracting vehicle auction data from Bring a Trailer listings. 
Extract ALL available data accurately. For dates, use YYYY-MM-DD format. For prices, extract as numbers (no commas or $).
For mileage, convert "31k Miles" to 31000. For VINs, extract exactly as shown (8-17 characters).
For bid history, extract all bid events with amounts, timestamps, and bidder usernames.
For images, extract all gallery image URLs.`
        },
        onlyMainContent: false,
        waitFor: 6500, // Give JS time to render BaT's dynamic content
      }),
      signal: AbortSignal.timeout(45000), // 45 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Firecrawl API error ${response.status}: ${errorText.slice(0, 200)}`);
      return {
        data: null,
        html: null,
        markdown: null,
        error: `Firecrawl API error: ${response.status}`
      };
    }

    const result = await response.json();
    
    if (!result.success) {
      console.error(`❌ Firecrawl returned success=false: ${JSON.stringify(result.error || result).slice(0, 300)}`);
      return {
        data: null,
        html: result.data?.html || null,
        markdown: result.data?.markdown || null,
        error: result.error || 'Firecrawl extraction failed'
      };
    }

    // Extract structured data from Firecrawl's extract field
    const extractedData = result.data?.extract || null;
    const html = result.data?.html || null;
    const markdown = result.data?.markdown || null;

    if (extractedData) {
      console.log(`✅ Firecrawl extracted data successfully`);
      console.log(`   - Has VIN: ${!!extractedData.vin}`);
      console.log(`   - Has sale price: ${!!extractedData.sale_price}`);
      console.log(`   - Has bid count: ${extractedData.bid_count !== undefined}`);
      console.log(`   - Images: ${extractedData.image_urls?.length || 0}`);
      
      return {
        data: extractedData as BatListingData,
        html,
        markdown,
      };
    } else {
      console.warn(`⚠️ Firecrawl returned no extracted data (but HTML/markdown available)`);
      return {
        data: null,
        html,
        markdown,
        error: 'No extracted data returned'
      };
    }
  } catch (error: any) {
    console.error(`❌ Firecrawl extraction error:`, error);
    return {
      data: null,
      html: null,
      markdown: null,
      error: error.message || String(error)
    };
  }
}

/**
 * Fallback: Extract basic data from HTML if Firecrawl extraction fails
 * This is a lightweight parser for critical fields only
 */
export function extractBasicBatDataFromHtml(html: string, batUrl: string): Partial<BatListingData> {
  const data: Partial<BatListingData> = {};
  
  // Extract title
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) {
    data.title = titleMatch[1].trim();
    const vehicleMatch = data.title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
    if (vehicleMatch) {
      data.year = parseInt(vehicleMatch[1]);
      data.make = vehicleMatch[2];
      const modelParts = vehicleMatch[3].split(' ');
      data.model = modelParts.slice(0, 2).join(' ');
      if (modelParts.length > 2) {
        data.trim = modelParts.slice(2).join(' ');
      }
    }
  }
  
  // Extract VIN from essentials
  const vinMatch = html.match(/<li[^>]*>Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{8,17})<\/a><\/li>/i) ||
                   html.match(/<li[^>]*>Chassis:\s*([A-HJ-NPR-Z0-9]{8,17})<\/li>/i) ||
                   html.match(/(?:VIN|Chassis)[:\s]+([A-HJ-NPR-Z0-9]{8,17})/i);
  if (vinMatch) {
    data.vin = vinMatch[1].toUpperCase();
  }
  
  // Extract sale price
  const salePriceMatch = html.match(/Sold for[:\\s]*USD\\s*\\$([0-9,]+)/i) ||
                         html.match(/Sold for[:\\s]*\\$([0-9,]+)/i);
  if (salePriceMatch) {
    data.sale_price = parseInt(salePriceMatch[1].replace(/,/g, ''));
  }
  
  // Extract lot number
  const lotMatch = html.match(/Lot[:\\s]*#?(\\d+)/i);
  if (lotMatch) {
    data.lot_number = lotMatch[1];
  }
  
  return data;
}

