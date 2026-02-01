import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * STREAMLINED ORGANIZATION & VEHICLE SCRAPER
 * 
 * DB-first approach: Extract 100% of available data, map to DB schema
 * 
 * Workflow:
 * 1. Extract organization data from website
 * 2. Extract vehicles from website
 * 3. Return structured data for MCP insertion
 * 
 * Principles:
 * - Extract everything available, don't force 100% schema coverage
 * - Map DOM structure to DB fields accurately
 * - Return data ready for direct MCP SQL insertion
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScrapeRequest {
  url: string;
}

interface ExtractedOrg {
  business_name?: string;
  website?: string;
  description?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  logo_url?: string;
  metadata?: Record<string, any>;
}

interface ExtractedVehicle {
  year?: number;
  make?: string;
  model?: string;
  description?: string;
  image_urls?: string[];
  source_url?: string;
  price?: number;
  status?: string;
  vin?: string;
  metadata?: Record<string, any>;
}

async function fetchHtml(url: string): Promise<string> {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  if (firecrawlKey) {
    try {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${firecrawlKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ['html'],
          onlyMainContent: false,
        }),
        signal: AbortSignal.timeout(30000),
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.data?.html || '';
      }
    } catch (e) {
      console.warn('Firecrawl failed, trying direct fetch:', e);
    }
  }
  
  // Fallback to direct fetch
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(20000),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.text();
}

function extractOrgData(html: string, url: string): ExtractedOrg {
  const org: ExtractedOrg = {
    website: url,
    metadata: {},
  };
  
  // Extract business name from title, h1, or meta tags
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    org.business_name = titleMatch[1]
      .replace(/\s+/g, ' ')
      .trim()
      .split('|')[0]
      .split('-')[0]
      .trim();
  }
  
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match && !org.business_name) {
    org.business_name = h1Match[1].trim();
  }
  
  // Extract description from meta description or first paragraph
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (metaDescMatch) {
    org.description = metaDescMatch[1].trim();
  }
  
  // Extract contact info
  const emailMatch = html.match(/mailto:([^\s"']+@[^\s"']+)/i) || html.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    org.email = emailMatch[1];
  }
  
  const phoneMatch = html.match(/(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/);
  if (phoneMatch) {
    org.phone = phoneMatch[0].replace(/[^\d+]/g, '');
  }
  
  // Extract address (look for common address patterns)
  const addressPatterns = [
    /(\d+\s+[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Circle|Cir)[^<]*?)(?:,|<\/)/i,
    /<address[^>]*>([^<]+)<\/address>/i,
  ];
  
  for (const pattern of addressPatterns) {
    const match = html.match(pattern);
    if (match) {
      const addr = match[1].trim();
      const parts = addr.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        org.address = parts[0];
        const cityState = parts[1].match(/([^0-9]+?)\s+([A-Z]{2})\s+(\d{5})?/);
        if (cityState) {
          org.city = cityState[1].trim();
          org.state = cityState[2];
          org.zip_code = cityState[3];
        }
      }
      break;
    }
  }
  
  // Extract logo
  const logoMatch = html.match(/<img[^>]*(?:logo|brand)[^>]*src=["']([^"']+)["']/i);
  if (logoMatch) {
    const logoUrl = logoMatch[1];
    org.logo_url = logoUrl.startsWith('http') ? logoUrl : new URL(logoUrl, url).href;
  }
  
  // Store raw HTML length for reference
  org.metadata = {
    html_length: html.length,
    extracted_at: new Date().toISOString(),
  };
  
  return org;
}

function extractVehicles(html: string, baseUrl: string): ExtractedVehicle[] {
  const vehicles: ExtractedVehicle[] = [];
  const seenVehicles = new Set<string>();
  
  // Remove scripts and styles for cleaner parsing
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Pattern 1: Look for year + make + model patterns
  // Matches: "1975 BMW 2002", "2024 Porsche 911", etc.
  const vehiclePattern = /\b((?:19|20)\d{2})\s+([A-Za-z]+)\s+([A-Za-z0-9\s\-/]+?)(?:\s|$|,|\.|<\/|&nbsp;)/gi;
  
  let match;
  while ((match = vehiclePattern.exec(cleanHtml)) !== null) {
    const year = parseInt(match[1]);
    const make = match[2].trim();
    let model = match[3].trim().replace(/\s+/g, ' ');
    
    // Filter out false positives
    if (model.length < 1 || model.length > 50) continue;
    if (['ad', 'classic', 'projects', 'inventory'].includes(model.toLowerCase())) continue;
    
    // Get context around match for additional data
    const contextStart = match.index;
    const context = cleanHtml.substring(contextStart, Math.min(contextStart + 800, cleanHtml.length));
    
    // Extract price
    const priceMatch = context.match(/\$([\d,]+(?:\.\d{2})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : undefined;
    
    // Determine status
    const isSold = /SOLD|SALE\s+COMPLETE|SOLD\s+OUT/i.test(context);
    const status = isSold ? 'sold' : 'for_sale';
    
    // Extract images
    const imageUrls: string[] = [];
    const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let imgMatch;
    while ((imgMatch = imgPattern.exec(context)) !== null) {
      const rawUrl = imgMatch[1];
      const imageUrl = rawUrl.startsWith('http') 
        ? rawUrl 
        : new URL(rawUrl, baseUrl).href;
      
      // Filter out navigation/header images
      if (!imageUrl.match(/(topbar|header|logo|button|icon)/i)) {
        imageUrls.push(imageUrl);
      }
    }
    
    // Create unique key
    const vehicleKey = `${year}-${make}-${model}-${price || '0'}`;
    if (seenVehicles.has(vehicleKey)) continue;
    seenVehicles.add(vehicleKey);
    
    // Extract description
    const descText = context.replace(/<[^>]+>/g, ' ')
                           .replace(/&nbsp;/g, ' ')
                           .replace(/\s+/g, ' ')
                           .trim();
    const description = descText.length > 30 && descText.length < 500 ? descText.substring(0, 500) : undefined;
    
    vehicles.push({
      year,
      make,
      model,
      description,
      price,
      status,
      image_urls: imageUrls.length > 0 ? imageUrls : undefined,
      source_url: baseUrl,
      metadata: {
        extracted_at: new Date().toISOString(),
        context_length: context.length,
      },
    });
  }
  
  // Pattern 2: Look for vehicle cards/listing structures
  // Common patterns: div.vehicle-card, div.listing-item, etc.
  const cardPattern = /<div[^>]*(?:class|id)=["'][^"']*(?:vehicle|listing|car|inventory)[^"']*["'][^>]*>([\s\S]{0,2000})<\/div>/gi;
  let cardMatch;
  
  while ((cardMatch = cardPattern.exec(cleanHtml)) !== null) {
    const cardHtml = cardMatch[1];
    
    // Try to extract vehicle info from card
    const cardYearMatch = cardHtml.match(/\b((?:19|20)\d{2})\b/);
    const cardMakeMatch = cardHtml.match(/\b(BMW|Porsche|Mercedes|Ferrari|Jaguar|Ford|Chevrolet|Dodge|Toyota|Honda|Audi|Volvo|Lexus|Acura|Infiniti|Cadillac|Lincoln|Chrysler|Jeep|Land Rover|Range Rover|Maserati|Lamborghini|McLaren|Aston Martin|Bentley|Rolls-Royce|Alfa Romeo|Lotus|Mini|Alpine|Citroen|Peugeot|Renault|Fiat|Lancia|Triumph|MG|Jensen|Austin|AMC|Studebaker|Packard|DeSoto|Hudson|Nash|Kaiser|Willys|International|GMC|Datsun|Saab)\b/i);
    const cardModelMatch = cardHtml.match(/\b([A-Za-z0-9\s\-/]{2,30})\b/);
    
    if (cardYearMatch && cardMakeMatch) {
      const year = parseInt(cardYearMatch[1]);
      const make = cardMakeMatch[1];
      const model = cardModelMatch ? cardModelMatch[1].trim() : undefined;
      
      const vehicleKey = `${year}-${make}-${model || 'unknown'}`;
      if (seenVehicles.has(vehicleKey)) continue;
      seenVehicles.add(vehicleKey);
      
      // Extract price from card
      const cardPriceMatch = cardHtml.match(/\$([\d,]+(?:\.\d{2})?)/);
      const price = cardPriceMatch ? parseFloat(cardPriceMatch[1].replace(/,/g, '')) : undefined;
      
      // Extract images from card
      const cardImageUrls: string[] = [];
      const cardImgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      let cardImgMatch;
      while ((cardImgMatch = cardImgPattern.exec(cardHtml)) !== null) {
        const rawUrl = cardImgMatch[1];
        const imageUrl = rawUrl.startsWith('http') 
          ? rawUrl 
          : new URL(rawUrl, baseUrl).href;
        if (!imageUrl.match(/(topbar|header|logo|button|icon)/i)) {
          cardImageUrls.push(imageUrl);
        }
      }
      
      vehicles.push({
        year,
        make,
        model,
        price,
        image_urls: cardImageUrls.length > 0 ? cardImageUrls : undefined,
        source_url: baseUrl,
        metadata: {
          extracted_at: new Date().toISOString(),
          source: 'card_pattern',
        },
      });
    }
  }
  
  return vehicles;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url }: ScrapeRequest = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🔍 Scraping organization: ${url}`);

    // Step 1: Fetch and extract organization data
    const html = await fetchHtml(url);
    const org = extractOrgData(html, url);
    
    console.log(`✅ Extracted org: ${org.business_name || 'Unknown'}`);

    // Step 2: Extract vehicles
    const vehicles = extractVehicles(html, url);
    
    console.log(`✅ Extracted ${vehicles.length} vehicles`);

    // Step 3: Return structured data for MCP insertion
    return new Response(
      JSON.stringify({
        success: true,
        org,
        vehicles,
        stats: {
          org_fields_extracted: Object.keys(org).filter(k => org[k as keyof ExtractedOrg] !== undefined).length,
          vehicles_found: vehicles.length,
          vehicles_with_images: vehicles.filter(v => v.image_urls && v.image_urls.length > 0).length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error scraping:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

