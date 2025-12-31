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

function extractVehicles(html: string, baseUrl: string): ExtractedVehicle[] {
  const vehicles: ExtractedVehicle[] = [];
  const seenVehicles = new Set<string>();
  
  // Remove scripts and styles for cleaner parsing
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Pattern 1: Look for year + make + model patterns
  const vehiclePattern = /\b((?:19|20)\d{2})\s+([A-Za-z]+)\s+([A-Za-z0-9\s\-/]+?)(?:\s|$|,|\.|<\/|&nbsp;)/gi;
  
  let match;
  while ((match = vehiclePattern.exec(cleanHtml)) !== null) {
    const year = parseInt(match[1]);
    const make = match[2].trim();
    let model = match[3].trim().replace(/\s+/g, ' ');
    
    // Filter out false positives
    if (model.length < 1 || model.length > 50) continue;
    if (['ad', 'classic', 'projects', 'inventory'].includes(model.toLowerCase())) continue;
    
    // Get context around match
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
      
      if (!imageUrl.match(/(topbar|header|logo|button|icon)/i)) {
        imageUrls.push(imageUrl);
      }
    }
    
    const vehicleKey = `${year}-${make}-${model}-${price || '0'}`;
    if (seenVehicles.has(vehicleKey)) continue;
    seenVehicles.add(vehicleKey);
    
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
  
  return vehicles;
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
    .single();

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
      .single();
    existingVehicle = data;
  } else if (vehicle.source_url && vehicle.model) {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', vehicle.source_url)
      .eq('model', vehicle.model)
      .single();
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
  const { data: existingLink } = await supabase
    .from('organization_vehicles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('vehicle_id', vehicleId)
    .eq('relationship_type', vehicle.status === 'sold' ? 'seller' : 'owner')
    .single();

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
        .single();

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

    // Step 1: Scrape organization and vehicles
    console.log('📡 Step 1: Scraping data...');
    const html = await fetchHtml(url);
    const org = extractOrgData(html, url);
    const vehicles = extractVehicles(html, url);
    
    console.log(`✅ Scraped: ${org.business_name || 'Unknown'} (${vehicles.length} vehicles)`);

    // Step 2: Insert organization
    console.log('💾 Step 2: Inserting organization...');
    const organizationId = await insertOrganization(supabase, org);
    
    if (!organizationId) {
      throw new Error('Failed to insert organization');
    }
    
    console.log(`✅ Organization inserted: ${organizationId}`);

    // Step 3: Insert vehicles and link to organization
    console.log(`💾 Step 3: Inserting ${vehicles.length} vehicles...`);
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

