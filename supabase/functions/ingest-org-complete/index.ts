import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * FULLY AUTOMATED ORGANIZATION INGESTION
 * 
 * Complete end-to-end workflow:
 * 1. Scrape organization and vehicle data
 * 2. Insert organization into database
 * 3. Insert vehicles into database
 * 4. Link organization to vehicles
 * 5. Insert vehicle images
 * 
 * No manual steps required - fully automated.
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
  
  // Common slogan words/phrases that shouldn't be company names
  const sloganPatterns = [
    /^(built for|driven by|powered by|experience|discover|explore|welcome to|your|the future of|the leader in)/i,
    /(ahead|journey|adventure|excellence|quality|craftsmanship|heritage|legacy|innovation|performance)$/i,
  ];
  
  const isSlogan = (text: string): boolean => {
    const lowerText = text.toLowerCase();
    // Check against common slogan patterns
    if (sloganPatterns.some(pattern => pattern.test(text))) {
      return true;
    }
    // Check if it's a generic marketing phrase
    const genericPhrases = [
      'built for the road ahead',
      'driven by excellence',
      'your journey starts here',
      'experience the difference',
      'craftsmanship redefined',
      'heritage meets innovation',
    ];
    return genericPhrases.some(phrase => lowerText.includes(phrase) || phrase.includes(lowerText));
  };
  
  // Priority 1: Extract from JSON-LD structured data (most reliable)
  const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of Array.from(jsonLdMatches)) {
    try {
      const jsonLd = JSON.parse(match[1]);
      // Handle both single objects and arrays
      const items = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
      for (const item of items) {
        if (item['@type'] === 'Organization' || item['@type'] === 'LocalBusiness') {
          if (item.name && typeof item.name === 'string' && !isSlogan(item.name)) {
            org.business_name = item.name.trim();
            break;
          }
        }
      }
      if (org.business_name) break;
    } catch (e) {
      // Invalid JSON, skip
    }
  }
  
  // Priority 2: Extract from logo alt text or link text (very reliable)
  if (!org.business_name) {
    const logoAltMatch = html.match(/<img[^>]*(?:logo|brand)[^>]*alt=["']([^"']+)["']/i);
    if (logoAltMatch && logoAltMatch[1]) {
      const altText = logoAltMatch[1].trim();
      // Skip generic alt text like "logo", "brand", "home"
      if (!['logo', 'brand', 'home', 'image'].includes(altText.toLowerCase()) && !isSlogan(altText)) {
        org.business_name = altText;
      }
    }
  }
  
  // Priority 3: Extract from header/nav link text (common pattern)
  if (!org.business_name) {
    // Look for link in header/nav that appears to be a company name
    const headerMatch = html.match(/<header[^>]*>([\s\S]{0,2000})<\/header>/i) || 
                        html.match(/<nav[^>]*>([\s\S]{0,2000})<\/nav>/i);
    const headerSection = headerMatch ? headerMatch[1] : html.substring(0, 5000); // First 5000 chars as fallback
    
    const linkMatches = headerSection.matchAll(/<a[^>]*href=["']\/["'][^>]*>([^<]+(?:<[^>]+>[^<]+<\/[^>]+>)*[^<]*)<\/a>/gi);
    for (const match of Array.from(linkMatches)) {
      const linkContent = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // Check if it looks like a company name (2-4 words, starts with capital, reasonable length)
      if (linkContent.match(/^[A-Z][a-zA-Z\s]{3,50}$/) && 
          linkContent.split(/\s+/).length >= 2 && 
          linkContent.split(/\s+/).length <= 4 &&
          !linkContent.match(/^(logo|brand|home|menu|inventory|about|contact|shop|build)/i) &&
          !isSlogan(linkContent)) {
        org.business_name = linkContent;
        break;
      }
    }
  }
  
  // Priority 4: Extract from title tag (but filter out slogans and take the company name part)
  if (!org.business_name) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      let title = titleMatch[1].replace(/\s+/g, ' ').trim();
      
      // Filter out video/platform indicators
      if (!title.match(/\b(vimeo|youtube|video|watch|play|stream|embed)\b/i)) {
        // Split by | or - and try each part
        const parts = title.split(/[|\-–—]/).map(p => p.trim()).filter(p => p.length > 2);
        for (const part of parts) {
          if (!isSlogan(part) && part.length < 100) {
            // Check if it looks like a company name (not just a slogan)
            if (part.split(/\s+/).length >= 2 && part.split(/\s+/).length <= 5) {
              org.business_name = part;
              break;
            }
          }
        }
      }
    }
  }
  
  // Priority 5: Extract domain name and convert to readable name (fallback)
  if (!org.business_name) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/^www\./, ''); // Remove www.
      const domainParts = hostname.split('.')[0].split(/-|_/); // Split on hyphens/underscores
      // Capitalize each word
      const domainName = domainParts
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
      if (domainName.length > 2 && domainName.length < 100) {
        org.business_name = domainName;
      }
    } catch (e) {
      // Invalid URL, skip
    }
  }
  
  // Priority 6: Extract from h1 (last resort, but filter slogans)
  if (!org.business_name) {
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) {
      const h1Text = h1Match[1].trim();
      if (h1Text.length > 2 && h1Text.length < 100 && !isSlogan(h1Text)) {
        org.business_name = h1Text;
      }
    }
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
  
  // Extract address
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
  
  org.metadata = {
    html_length: html.length,
    extracted_at: new Date().toISOString(),
    source: 'automated_ingestion',
  };
  
  return org;
}

/**
 * Find all /for-sale/ URLs from a page (both listing pages and individual vehicle pages)
 */
function findForSaleUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const baseUrlObj = new URL(baseUrl);
  
  // Find all links to /for-sale/ pages
  const linkPattern = /<a[^>]+href=["']([^"']*\/for-sale\/[^"']*)["'][^>]*>/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1];
    try {
      const url = new URL(href, baseUrl);
      // Only include URLs from the same domain
      if (url.hostname === baseUrlObj.hostname && url.pathname.includes('/for-sale/')) {
        urls.add(url.href);
      }
    } catch (e) {
      // Invalid URL, skip
    }
  }
  
  return Array.from(urls);
}

/**
 * Extract vehicle data from an individual vehicle listing page
 */
function extractVehicleFromPage(html: string, pageUrl: string): ExtractedVehicle | null {
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  const vehicle: ExtractedVehicle = {
    source_url: pageUrl,
    metadata: {},
  };
  
  // Known vehicle makes (with aliases mapped to canonical names)
  const makeAliases: Record<string, string> = {
    'chevy': 'Chevrolet',
    'vw': 'Volkswagen',
    'mercedes': 'Mercedes-Benz',
    'land rover': 'Land Rover',
    'range rover': 'Range Rover',
    'alfa romeo': 'Alfa Romeo',
    'rolls-royce': 'Rolls-Royce',
    'aston martin': 'Aston Martin',
    'mercedes-benz': 'Mercedes-Benz',
  };
  
  const knownMakes = new Set([
    'ford', 'chevrolet', 'chevy', 'dodge', 'chrysler', 'jeep', 'ram', 'gmc',
    'toyota', 'honda', 'nissan', 'mazda', 'subaru', 'mitsubishi', 'acura', 'lexus', 'infiniti',
    'bmw', 'mercedes', 'mercedes-benz', 'audi', 'volkswagen', 'vw', 'porsche', 'volvo',
    'jaguar', 'land rover', 'range rover', 'bentley', 'rolls-royce', 'aston martin',
    'ferrari', 'lamborghini', 'mclaren', 'maserati', 'alfa romeo', 'fiat',
    'cadillac', 'lincoln', 'buick', 'pontiac', 'oldsmobile', 'plymouth', 'amc',
    'studebaker', 'packard', 'willys', 'international', 'datsun', 'saab', 'triumph', 'mg'
  ]);
  
  // Generic words that shouldn't be treated as makes
  const genericWords = new Set(['classic', 'custom', 'vintage', 'restored', 'rebuilt', 'modified', 'project', 'for', 'sale']);
  
  // Extract year, make, model from title or h1
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const headingText = (h1Match?.[1] || titleMatch?.[1] || '').trim();
  
  // Try to extract year + make + model from heading
  const vehiclePattern = /\b((?:19|20)\d{2})\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+([A-Za-z0-9\s\-/]+?)(?:\s|$|,|\.|<\/|&nbsp;)/i;
  const vehicleMatch = headingText.match(vehiclePattern) || cleanHtml.match(vehiclePattern);
  
  if (vehicleMatch) {
    vehicle.year = parseInt(vehicleMatch[1]);
    const makeCandidate = vehicleMatch[2].trim().toLowerCase();
    let model = vehicleMatch[3].trim().replace(/\s+/g, ' ');
    
    // Check if make candidate is valid (skip generic words)
    if (!genericWords.has(makeCandidate) && knownMakes.has(makeCandidate)) {
      // Normalize make name using alias map if available
      vehicle.make = makeAliases[makeCandidate] || vehicleMatch[2].trim();
      vehicle.model = model;
    } else {
      // Try first word of model as make
      const modelParts = model.split(/\s+/);
      if (modelParts.length > 0) {
        const firstModelWord = modelParts[0].toLowerCase();
        if (knownMakes.has(firstModelWord)) {
          // Normalize make name using alias map
          vehicle.make = makeAliases[firstModelWord] || modelParts[0];
          vehicle.model = modelParts.slice(1).join(' ');
        } else {
          // Can't determine make/model reliably
          return null;
        }
      } else {
        return null;
      }
    }
  } else {
    // Try to extract from URL path
    const urlPath = new URL(pageUrl).pathname;
    const urlParts = urlPath.split('/').filter(p => p);
    const forSaleIndex = urlParts.indexOf('for-sale');
    if (forSaleIndex >= 0 && urlParts.length > forSaleIndex + 1) {
      const vehicleSlug = urlParts[forSaleIndex + 1];
      // Try to parse year from slug (e.g., "1969-classic-k5-blazer-2465")
      const yearMatch = vehicleSlug.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        vehicle.year = parseInt(yearMatch[0]);
        // Extract make/model from slug (very rough)
        const slugParts = vehicleSlug.replace(/\d+/g, '').split('-').filter(p => p && p !== 'classic' && p !== 'for' && p !== 'sale');
        if (slugParts.length >= 2) {
          const firstPart = slugParts[0].toLowerCase();
          if (knownMakes.has(firstPart)) {
            vehicle.make = slugParts[0];
            vehicle.model = slugParts.slice(1).join(' ');
          } else if (slugParts.length >= 3 && knownMakes.has(slugParts[0] + ' ' + slugParts[1])) {
            vehicle.make = slugParts[0] + ' ' + slugParts[1];
            vehicle.model = slugParts.slice(2).join(' ');
          }
        }
      }
    }
    
    if (!vehicle.make || !vehicle.model) {
      return null; // Can't extract vehicle info
    }
  }
  
  // Extract description - look for meta description, then main content
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (metaDescMatch) {
    vehicle.description = metaDescMatch[1].trim();
  } else {
    // Try to find main content area
    const mainContentMatch = html.match(/<main[^>]*>([\s\S]{200,2000})<\/main>/i) ||
                            html.match(/<article[^>]*>([\s\S]{200,2000})<\/article>/i) ||
                            html.match(/<div[^>]*class=["'][^"']*content["'][^>]*>([\s\S]{200,2000})<\/div>/i);
    if (mainContentMatch) {
      const content = mainContentMatch[1].replace(/<[^>]+>/g, ' ')
                                          .replace(/&nbsp;/g, ' ')
                                          .replace(/\s+/g, ' ')
                                          .trim();
      if (content.length > 100) {
        vehicle.description = content.substring(0, 1000);
      }
    }
  }
  
  // Extract price
  const pricePatterns = [
    /\$\s*([\d,]+(?:\.\d{2})?)/g,
    /Price[:\s]+\$?\s*([\d,]+(?:\.\d{2})?)/gi,
    /Asking[:\s]+\$?\s*([\d,]+(?:\.\d{2})?)/gi,
  ];
  
  for (const pattern of pricePatterns) {
    const matches = cleanHtml.matchAll(pattern);
    for (const match of matches) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 1000 && price < 10000000) { // Reasonable price range
        vehicle.price = price;
        break;
      }
    }
    if (vehicle.price) break;
  }
  
  // Determine status
  vehicle.status = /SOLD|SALE\s+COMPLETE|SOLD\s+OUT|NOT\s+AVAILABLE/i.test(cleanHtml) ? 'sold' : 'for_sale';
  
  // Extract images - prioritize main vehicle images
  const imageUrls: string[] = [];
  const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgPattern.exec(cleanHtml)) !== null) {
    const imgUrl = imgMatch[1];
    const alt = imgMatch[2] || '';
    
    // Skip navigation/header/logo images
    if (imgUrl.match(/(topbar|header|logo|button|icon|avatar|profile)/i) ||
        alt.match(/(logo|navigation|menu|button)/i)) {
      continue;
    }
    
    const fullUrl = imgUrl.startsWith('http') ? imgUrl : new URL(imgUrl, pageUrl).href;
    if (!imageUrls.includes(fullUrl)) {
      imageUrls.push(fullUrl);
    }
  }
  
  vehicle.image_urls = imageUrls.length > 0 ? imageUrls : undefined;
  vehicle.metadata = {
    extracted_at: new Date().toISOString(),
    page_title: titleMatch?.[1] || '',
  };
  
  return vehicle;
}

async function insertOrganization(supabase: any, org: ExtractedOrg): Promise<string | null> {
  if (!org.website) {
    console.error('Organization website is required');
    return null;
  }

  // First, check if organization exists
  const { data: existing } = await supabase
    .from('businesses')
    .select('id, metadata')
    .eq('website', org.website)
    .maybeSingle();

  const orgData: any = {
    website: org.website,
  };

  if (org.business_name) orgData.business_name = org.business_name;
  if (org.description) orgData.description = org.description;
  if (org.email) orgData.email = org.email;
  if (org.phone) orgData.phone = org.phone;
  if (org.address) orgData.address = org.address;
  if (org.city) orgData.city = org.city;
  if (org.state) orgData.state = org.state;
  if (org.zip_code) orgData.zip_code = org.zip_code;
  if (org.logo_url) orgData.logo_url = org.logo_url;

  // Merge metadata
  const existingMetadata = existing?.metadata || {};
  orgData.metadata = {
    ...existingMetadata,
    ...(org.metadata || {}),
    extracted_at: new Date().toISOString(),
    source: 'automated_ingestion',
  };

  let organizationId: string | null = null;

  if (existing?.id) {
    // Update existing organization
    const { data, error } = await supabase
      .from('businesses')
      .update(orgData)
      .eq('id', existing.id)
      .select('id')
      .single();

    if (error) {
      console.error('Error updating organization:', error);
      return null;
    }
    organizationId = data?.id || null;
  } else {
    // Insert new organization
    const { data, error } = await supabase
      .from('businesses')
      .insert(orgData)
      .select('id')
      .single();

    if (error) {
      console.error('Error inserting organization:', error);
      return null;
    }
    organizationId = data?.id || null;
  }

  return organizationId;
}

async function insertVehicle(supabase: any, vehicle: ExtractedVehicle, organizationId: string): Promise<string | null> {
  if (!vehicle.make || !vehicle.model) {
    console.warn('Vehicle missing make or model, skipping');
    return null;
  }

  const vehicleData: any = {
    make: vehicle.make,
    model: vehicle.model,
    discovery_url: vehicle.source_url || null,
    platform_url: vehicle.source_url || null,
    notes: vehicle.description || null,
    asking_price: vehicle.price || null,
    origin_metadata: vehicle.metadata || {},
  };

  if (vehicle.year) vehicleData.year = vehicle.year;
  if (vehicle.vin) vehicleData.vin = vehicle.vin;

  // Insert or update vehicle
  let vehicleId: string | null = null;

  // Check if vehicle exists by VIN or discovery_url + model
  let existingVehicle = null;
  
  if (vehicle.vin) {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', vehicle.vin)
      .maybeSingle();
    existingVehicle = data;
  } else if (vehicle.source_url && vehicle.model) {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', vehicle.source_url)
      .eq('model', vehicle.model)
      .maybeSingle();
    existingVehicle = data;
  }

  if (existingVehicle?.id) {
    // Update existing vehicle
    const { data, error } = await supabase
      .from('vehicles')
      .update(vehicleData)
      .eq('id', existingVehicle.id)
      .select('id')
      .single();

    if (error) {
      console.error('Error updating vehicle:', error);
      return null;
    }
    vehicleId = data?.id || null;
  } else {
    // Insert new vehicle
    const { data, error } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .single();

    if (error) {
      console.error('Error inserting vehicle:', error);
      return null;
    }
    vehicleId = data?.id || null;
  }

  if (!vehicleId) return null;

  // Link vehicle to organization
  // Check if link already exists
  const { data: existingLink, error: linkCheckError } = await supabase
    .from('organization_vehicles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('vehicle_id', vehicleId)
    .eq('relationship_type', vehicle.status === 'sold' ? 'seller' : 'owner')
    .maybeSingle(); // Use maybeSingle() instead of single() to handle no record gracefully

  const linkData = {
    organization_id: organizationId,
    vehicle_id: vehicleId,
    relationship_type: vehicle.status === 'sold' ? 'seller' : 'owner',
    status: vehicle.status === 'sold' ? 'past' : 'active',
    auto_tagged: false,
    metadata: {
      source_url: vehicle.source_url,
      extracted_at: new Date().toISOString(),
      price: vehicle.price,
    },
  };

  let linkError;
  if (existingLink?.id) {
    // Update existing link
    const { error } = await supabase
      .from('organization_vehicles')
      .update(linkData)
      .eq('id', existingLink.id);
    linkError = error;
  } else {
    // Insert new link
    const { error } = await supabase
      .from('organization_vehicles')
      .insert(linkData);
    linkError = error;
  }

  if (linkError) {
    console.warn('Error linking vehicle to organization:', linkError);
  }

  // Insert vehicle images
  if (vehicle.image_urls && vehicle.image_urls.length > 0) {
    for (const imageUrl of vehicle.image_urls) {
      // Check if image already exists
      const { data: existingImage } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('image_url', imageUrl)
        .maybeSingle();

      if (!existingImage) {
        // Insert new image
        const { error: imgError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            image_url: imageUrl,
            category: 'exterior',
            uploaded_at: new Date().toISOString(),
          });

        if (imgError) {
          console.warn('Error inserting vehicle image:', imgError);
        }
      }
    }
  }

  return vehicleId;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url }: ScrapeRequest = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🚀 Starting automated ingestion for: ${url}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // Step 1: Scrape organization from homepage
    console.log('📡 Step 1: Scraping organization data...');
    const homepageHtml = await fetchHtml(url);
    const org = extractOrgData(homepageHtml, url);
    
    console.log(`✅ Organization: ${org.business_name || 'Unknown'}`);
    
    // Step 2: Discover all /for-sale/ URLs (listing pages and individual vehicle pages)
    console.log('🔍 Step 2: Discovering vehicle listing pages...');
    let allVehicleUrls = new Set<string>();
    const initialForSaleUrls = findForSaleUrls(homepageHtml, url);
    console.log(`✅ Found ${initialForSaleUrls.length} /for-sale/ URLs from homepage`);
    
    // Step 2a: Also check the main inventory page (/for-sale/)
    const inventoryUrl = new URL('/for-sale/', url).href;
    try {
      console.log(`🔍 Checking inventory page: ${inventoryUrl}`);
      const inventoryHtml = await fetchHtml(inventoryUrl);
      const inventoryUrls = findForSaleUrls(inventoryHtml, url);
      console.log(`✅ Found ${inventoryUrls.length} /for-sale/ URLs from inventory page`);
      inventoryUrls.forEach(u => allVehicleUrls.add(u));
    } catch (error: any) {
      console.warn(`⚠️  Failed to scrape inventory page: ${error.message}`);
    }
    
    // Add initial URLs
    initialForSaleUrls.forEach(u => allVehicleUrls.add(u));
    
    // Step 2b: For each listing page (not individual vehicle), discover more URLs
    const listingPages = Array.from(allVehicleUrls).filter(u => {
      // Listing pages typically don't have a numeric ID at the end
      // Individual pages: /for-sale/1969-classic-k5-blazer-2465/
      // Listing pages: /for-sale/chevrolet-k5-blazer/
      const path = new URL(u).pathname;
      return path.match(/\/for-sale\/[^/]+\/$/) && !path.match(/\/for-sale\/[^/]+-\d+\/$/);
    });
    
    console.log(`🔍 Discovering vehicles from ${listingPages.length} listing pages...`);
    for (const listingUrl of listingPages.slice(0, 20)) { // Limit to 20 listing pages
      try {
        const listingHtml = await fetchHtml(listingUrl);
        const discoveredUrls = findForSaleUrls(listingHtml, url);
        discoveredUrls.forEach(u => allVehicleUrls.add(u));
        console.log(`  ✅ Found ${discoveredUrls.length} URLs from ${listingUrl}`);
      } catch (error: any) {
        console.warn(`  ⚠️  Failed to scrape listing page ${listingUrl}: ${error.message}`);
      }
    }
    
    // Filter to only individual vehicle pages (those with numeric IDs or specific patterns)
    const individualVehicleUrls = Array.from(allVehicleUrls).filter(u => {
      const path = new URL(u).pathname;
      // Individual vehicle pages have patterns like:
      // /for-sale/1969-classic-k5-blazer-2465/
      // /for-sale/1977-classic-chevy-k10-3837/
      return path.match(/\/for-sale\/[^/]+-\d+\/$/) || 
             path.match(/\/for-sale\/\d{4}-[^/]+\/$/); // year prefix
    });
    
    console.log(`✅ Total individual vehicle pages found: ${individualVehicleUrls.length}`);
    
    // Step 3: Scrape each individual vehicle page to extract vehicle data
    console.log(`📡 Step 3: Scraping ${individualVehicleUrls.length} vehicle pages...`);
    const vehicles: ExtractedVehicle[] = [];
    
    // Limit to first 100 URLs to avoid timeouts
    const urlsToProcess = individualVehicleUrls.slice(0, 100);
    
    for (let i = 0; i < urlsToProcess.length; i++) {
      const vehicleUrl = urlsToProcess[i];
      
      try {
        console.log(`  [${i + 1}/${urlsToProcess.length}] Scraping: ${vehicleUrl}`);
        const vehicleHtml = await fetchHtml(vehicleUrl);
        const vehicle = extractVehicleFromPage(vehicleHtml, vehicleUrl);
        
        if (vehicle && vehicle.make && vehicle.model) {
          vehicles.push(vehicle);
        }
      } catch (error: any) {
        console.warn(`  ⚠️  Failed to scrape ${vehicleUrl}: ${error.message}`);
      }
    }
    
    console.log(`✅ Extracted ${vehicles.length} vehicles`);

    // Step 4: Insert organization
    console.log('💾 Step 4: Inserting organization...');
    const organizationId = await insertOrganization(supabase, org);
    
    if (!organizationId) {
      throw new Error('Failed to insert organization');
    }
    
    console.log(`✅ Organization inserted: ${organizationId}`);

    // Step 5: Insert vehicles and link to organization
    console.log(`💾 Step 5: Inserting ${vehicles.length} vehicles...`);
    const vehicleResults = {
      inserted: 0,
      skipped: 0,
      errors: 0,
    };

    for (const vehicle of vehicles) {
      const vehicleId = await insertVehicle(supabase, vehicle, organizationId);
      if (vehicleId) {
        vehicleResults.inserted++;
      } else {
        vehicleResults.errors++;
      }
    }

    console.log(`✅ Vehicles processed: ${vehicleResults.inserted} inserted, ${vehicleResults.errors} errors`);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        organization_id: organizationId,
        organization_name: org.business_name,
        vehicles: {
          found: vehicles.length,
          inserted: vehicleResults.inserted,
          errors: vehicleResults.errors,
        },
        stats: {
          org_fields_extracted: Object.keys(org).filter(k => org[k as keyof ExtractedOrg] !== undefined).length,
          vehicles_found: vehicles.length,
          vehicles_with_images: vehicles.filter(v => v.image_urls && v.image_urls.length > 0).length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Error in automated ingestion:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

