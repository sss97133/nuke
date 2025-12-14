import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { extractBrandAssetsFromHtml } from '../_shared/extractBrandAssets.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DealerProfileData {
  name: string | null;
  logo_url: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  dealer_license: string | null;
  license_type: 'dealer_license' | 'auction_license' | null;
  business_type: 'dealer' | 'auction_house';
  description: string | null;
  specialties: string[];
  inventory_url: string | null;
  auctions_url: string | null;
}

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  return s;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^www\./i.test(value);
}

function normalizeWebsiteUrl(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const candidate = s.startsWith('http://') || s.startsWith('https://') ? s : (s.startsWith('www.') ? `https://${s}` : s);
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeEmail(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const cleaned = s.replace(/^mailto:/i, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return cleaned.toLowerCase();
}

function normalizeState(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const two = s.toUpperCase();
  if (/^[A-Z]{2}$/.test(two)) return two;
  return null;
}

function normalizeZip(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return null;
}

function normalizePhone(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return null;
}

function normalizeTextArray(raw: unknown, maxItems = 25): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw.slice(0, maxItems)) {
    const s = safeString(item);
    if (!s) continue;
    const cleaned = s.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (cleaned.length > 120) continue;
    if (looksLikeUrl(cleaned)) continue;
    out.push(cleaned);
  }
  return Array.from(new Set(out));
}

function sanitizeDealerProfileData(raw: DealerProfileData): DealerProfileData | null {
  const nameRaw = safeString(raw.name);
  const name = nameRaw && !looksLikeUrl(nameRaw) ? nameRaw.replace(/\s+/g, ' ').trim() : null;
  const logoUrl = safeString(raw.logo_url);
  const website = normalizeWebsiteUrl(raw.website);
  const email = normalizeEmail(raw.email);
  const phone = normalizePhone(raw.phone);
  const state = normalizeState(raw.state);
  const zip = normalizeZip(raw.zip);
  const city = safeString(raw.city);
  const address = safeString(raw.address);
  const dealerLicense = safeString(raw.dealer_license);
  const description = safeString(raw.description);
  const specialties = normalizeTextArray(raw.specialties);

  // Greenlight: require name, and at least one strong signal.
  // Do NOT require logo_url: many Classic.com sellers do not have a usable logo on their profile.
  const hasStrongSignal = !!(website || phone || email || (city && state) || dealerLicense);
  if (!name || !hasStrongSignal) return null;

  return {
    ...raw,
    name,
    logo_url: logoUrl,
    website,
    email,
    phone,
    state,
    zip,
    city: city ? city.replace(/\s+/g, ' ').trim() : null,
    address: address ? address.replace(/\s+/g, ' ').trim() : null,
    dealer_license: dealerLicense,
    description: description ? description.replace(/\s+/g, ' ').trim() : null,
    specialties,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { profile_url } = await req.json();

    if (!profile_url) {
      return new Response(
        JSON.stringify({ error: 'profile_url is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');

    console.log(`Indexing Classic.com seller profile: ${profile_url}`);

    // Step 1: Scrape Classic.com profile with Firecrawl structured extraction (preferred),
    // with a direct HTML fetch fallback when Firecrawl is not configured.
    let dealerData: DealerProfileData | null = null;

    if (firecrawlApiKey) {
      console.log('Using Firecrawl structured extraction...');
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: profile_url,
          formats: ['html', 'markdown', 'extract'],
          extract: {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                logo_url: { type: 'string' },
                website: { type: 'string' },
                address: { type: 'string' },
                city: { type: 'string' },
                state: { type: 'string' },
                zip: { type: 'string' },
                phone: { type: 'string' },
                email: { type: 'string' },
                dealer_license: { type: 'string' },
                description: { type: 'string' },
                specialties: {
                  type: 'array',
                  items: { type: 'string' }
                },
                inventory_url: { type: 'string' },
                auctions_url: { type: 'string' },
                business_type: { type: 'string', enum: ['dealer', 'auction_house'] }
              }
            }
          },
          waitFor: 3000
        })
      });

      if (firecrawlResponse.ok) {
        const firecrawlData = await firecrawlResponse.json();
        
        if (firecrawlData.success && firecrawlData.data?.extract) {
          const extracted = firecrawlData.data.extract;
          dealerData = {
            name: extracted.name || null,
            logo_url: extracted.logo_url || null,
            website: extracted.website || null,
            address: extracted.address || null,
            city: extracted.city || null,
            state: extracted.state || null,
            zip: extracted.zip || null,
            phone: extracted.phone || null,
            email: extracted.email || null,
            dealer_license: extracted.dealer_license || null,
            license_type: extracted.dealer_license ? 'dealer_license' : null,
            business_type: (extracted.business_type === 'auction_house' ? 'auction_house' : 'dealer'),
            description: extracted.description || null,
            specialties: extracted.specialties || [],
            inventory_url: extracted.inventory_url || null,
            auctions_url: extracted.auctions_url || null
          };
          console.log('Firecrawl structured extraction successful');
        } else {
          console.warn('Firecrawl extract empty, falling back to HTML parsing');
          // Fallback to HTML parsing
          const html = firecrawlData.data?.html || '';
          const doc = new DOMParser().parseFromString(html, 'text/html');
          dealerData = extractDealerProfileData(doc, html);
        }
      } else {
        throw new Error(`Firecrawl failed: ${firecrawlResponse.status}`);
      }
    } else {
      // Fallback: direct fetch Classic.com profile HTML and parse it.
      const html = await fetch(profile_url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(20000),
      }).then((r) => (r.ok ? r.text() : ''));

      if (!html) throw new Error('Failed to fetch Classic.com profile HTML');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      dealerData = extractDealerProfileData(doc, html);
    }

    if (!dealerData) {
      throw new Error('Failed to extract dealer data');
    }

    // Step 3: Sanitize + check greenlight signals
    const sanitizedDealerData = sanitizeDealerProfileData(dealerData);
    if (!sanitizedDealerData) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Dealer profile extracted but failed validation (insufficient/invalid signals)' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Step 4: Download and store logo as favicon + extract website favicon
    let logoUrl: string | null = null;
    let faviconUrl: string | null = null;
    let primaryImageUrl: string | null = null;
    
    if (sanitizedDealerData.logo_url) {
      logoUrl = await downloadAndStoreLogo(sanitizedDealerData.logo_url, sanitizedDealerData.website || '', supabase);
    }
    
    // Also try to extract favicon from website (for small UI areas)
    if (sanitizedDealerData.website) {
      try {
        faviconUrl = await extractWebsiteFavicon(sanitizedDealerData.website, supabase);
      } catch (err) {
        console.warn('Failed to extract website favicon:', err);
      }
    }
    
    // Extract primary image (property front - keeping expectations low for now)
    if (sanitizedDealerData.website) {
      try {
        primaryImageUrl = await extractPrimaryImage(sanitizedDealerData.website, supabase);
      } catch (err) {
        console.warn('Failed to extract primary image:', err);
      }
    }

    // Final fallback: ensure we always have some banner candidate for the org profile.
    // Order: website banner/hero -> stored logo -> favicon
    const bannerUrlResolved = resolveBannerFallback({
      banner_url: primaryImageUrl,
      logo_url: logoUrl,
      favicon_url: faviconUrl,
    });

    // Step 5: Find or create organization using geographic logic
    const organization = await findOrCreateOrganizationWithGeographicLogic(
      sanitizedDealerData,
      logoUrl,
      faviconUrl,
      bannerUrlResolved,
      profile_url,
      supabase
    );

    // Step 6: Queue inventory extraction if website available
    if (organization && sanitizedDealerData.website) {
      await queueInventoryExtraction({
        organization_id: organization.id,
        business_type: sanitizedDealerData.business_type,
        website: sanitizedDealerData.website,
        inventory_url: sanitizedDealerData.inventory_url,
        auctions_url: sanitizedDealerData.auctions_url
      }, supabase);
    }

    // Step 7: Extract and store team/employee data from dealer website (private, for future email outreach)
    let teamDataStored = 0;
    if (organization?.id && sanitizedDealerData.website) {
      try {
        const { storeTeamData } = await import('../_shared/storeTeamData.ts');
        
        // Use extract-using-catalog to get team data from website
        const { data: extractResult } = await supabase.functions.invoke('extract-using-catalog', {
          body: {
            url: sanitizedDealerData.website,
            use_catalog: true,
            fallback_to_ai: true
          }
        });

        if (extractResult?.success && extractResult.data?.team_members) {
          const teamMembers = extractResult.data.team_members;
          if (Array.isArray(teamMembers) && teamMembers.length > 0) {
            const result = await storeTeamData(
              supabase,
              organization.id,
              teamMembers,
              sanitizedDealerData.website,
              0.8 // Confidence score
            );
            teamDataStored = result.stored;
            console.log(`Stored ${teamDataStored} team members for ${organization.name}`);
          }
        }
      } catch (err: any) {
        console.warn('Failed to extract/store team data:', err.message);
        // Don't fail the whole operation if team extraction fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        organization_id: organization?.id,
        organization_name: organization?.name,
        logo_url: logoUrl,
        favicon_url: faviconUrl, // Cached in source_favicons table
        banner_url: bannerUrlResolved, // Primary image for org profile (using banner_url column)
        dealer_data: sanitizedDealerData,
        team_members_stored: teamDataStored,
        action: organization?.id ? 'created' : 'found_existing'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error indexing Classic.com dealer:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

/**
 * Extract dealer profile data from Classic.com HTML
 */
function extractDealerProfileData(doc: any, html: string): DealerProfileData {
  const data: DealerProfileData = {
    name: null,
    logo_url: null,
    website: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    phone: null,
    email: null,
    dealer_license: null,
    license_type: null,
    business_type: 'dealer',
    description: null,
    specialties: [],
    inventory_url: null,
    auctions_url: null
  };

  // Extract dealer name (usually in h1 or title)
  const nameEl = doc.querySelector('h1, .dealer-name, .dealer-title, title');
  if (nameEl) {
    data.name = nameEl.textContent?.trim() || null;
    // Clean up Classic.com suffix if present
    if (data.name) {
      data.name = data.name.replace(/\s*-\s*Classic.com.*$/i, '').trim();
    }
  }

  // Extract logo (Classic.com stores in images.classic.com/uploads/dealer/)
  // Pattern matches: <img src="https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png" class="object-fit" alt="111 Motorcars">
  const logoPatterns = [
    // Exact Classic.com pattern with class="object-fit"
    /<img[^>]+src="(https?:\/\/images\.classic\.com\/uploads\/dealer\/[^"]+\.(?:png|jpg|jpeg|svg))"[^>]*class="[^"]*object-fit[^"]*"[^>]*alt="[^"]*"/i,
    // Generic Classic.com dealer logo pattern
    /<img[^>]+src="(https?:\/\/images\.classic\.com\/uploads\/dealer\/[^"]+\.(?:png|jpg|jpeg|svg))"/i,
    // Fallback: any dealer logo mention
    /dealer.*logo.*src="([^"]+\.(?:png|jpg|jpeg|svg))"/i
  ];

  for (const pattern of logoPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      data.logo_url = match[1].startsWith('http') ? match[1] : `https://www.classic.com${match[1]}`;
      break;
    }
  }

  // Extract website URL
  const websiteEl = doc.querySelector('a[href*="http"], .website, .dealer-website');
  if (websiteEl) {
    const href = websiteEl.getAttribute('href');
    if (href && href.startsWith('http')) {
      data.website = href;
    }
  }

  // Extract address, city, state, zip
  const addressPatterns = [
    /(\d+\s+[A-Za-z0-9\s,]+(?:Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane)[^,]*),\s*([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/i,
    /([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5})/i
  ];

  const bodyText = doc.body?.textContent || '';
  for (const pattern of addressPatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      if (match.length === 5) {
        data.address = match[1].trim();
        data.city = match[2].trim();
        data.state = match[3].trim();
        data.zip = match[4].trim();
      } else if (match.length === 4) {
        data.city = match[1].trim();
        data.state = match[2].trim();
        data.zip = match[3].trim();
      }
      break;
    }
  }

  // Extract phone
  const phonePattern = /\(?\s*(\d{3})\s*\)?\s*[-.\s]?\s*(\d{3})\s*[-.\s]?\s*(\d{4})/;
  const phoneMatch = bodyText.match(phonePattern);
  if (phoneMatch) {
    data.phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`;
  }

  // Extract email
  const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
  const emailMatch = bodyText.match(emailPattern);
  if (emailMatch) {
    data.email = emailMatch[1];
  }

  // Extract dealer license (look for license numbers)
  const licensePatterns = [
    /dealer[^\w]*license[^\w]*#?:?\s*([A-Z0-9-]+)/i,
    /license[^\w]*number[^\w]*:?\s*([A-Z0-9-]+)/i,
    /DL[^\w]*#?:?\s*([A-Z0-9-]+)/i
  ];

  for (const pattern of licensePatterns) {
    const match = bodyText.match(pattern);
    if (match && match[1]) {
      data.dealer_license = match[1].trim();
      data.license_type = 'dealer_license'; // Default, could be auction_license
      break;
    }
  }

  // Detect business type (dealer vs auction house)
  const auctionKeywords = /auction|bid|lot|catalog|event/i;
  if (auctionKeywords.test(data.name || '') || auctionKeywords.test(bodyText)) {
    data.business_type = 'auction_house';
    if (data.dealer_license) {
      data.license_type = 'auction_license';
    }
  }

  // Extract description
  const descEl = doc.querySelector('.description, .dealer-description, .about, p');
  if (descEl) {
    data.description = descEl.textContent?.trim() || null;
  }

  // Extract specialties (if listed)
  const specialtiesEls = doc.querySelectorAll('.specialty, .specialties li, [class*="specialty"]');
  if (specialtiesEls.length > 0) {
    data.specialties = Array.from(specialtiesEls)
      .map(el => el.textContent?.trim())
      .filter(Boolean) as string[];
  }

  // Determine inventory/auctions URLs from website
  if (data.website) {
    try {
      const url = new URL(data.website);
      if (data.business_type === 'auction_house') {
        data.auctions_url = `${url.origin}/auctions`;
      } else {
        data.inventory_url = `${url.origin}/inventory`;
      }
    } catch {
      // Invalid URL
    }
  }

  return data;
}

// Note: greenlight / validation is handled by sanitizeDealerProfileData()

/**
 * Download logo and store as organization favicon/logo
 */
async function downloadAndStoreLogo(
  logoUrl: string,
  website: string,
  supabase: any
): Promise<string | null> {
  try {
    // Download logo image
    const response = await fetch(logoUrl);
    if (!response.ok) {
      console.warn(`Failed to download logo: ${response.status}`);
      return null;
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Extract domain for storage path
    let domain = 'unknown';
    if (website) {
      try {
        domain = new URL(website).hostname.replace(/^www\./, '');
      } catch {
        // Invalid URL
      }
    }

    // Upload to Supabase Storage
    // Use domain from website or extract from logo URL
    const logoFileName = logoUrl.split('/').pop()?.split('?')[0] || 'logo.png';
    const fileExtension = logoFileName.split('.').pop() || 'png';
    
    // Generate clean filename: domain-logo.ext or dealer-name-logo.ext
    let fileName = logoFileName;
    if (domain && domain !== 'unknown') {
      fileName = `${domain.replace(/[^a-z0-9]/gi, '-')}-logo.${fileExtension}`;
    } else {
      // Extract from logo URL if domain unknown
      const logoPathMatch = logoUrl.match(/\/([^\/]+\.(?:png|jpg|jpeg|svg))/i);
      if (logoPathMatch) {
        fileName = logoPathMatch[1].replace(/[^a-z0-9.]/gi, '-');
      }
    }
    
    const filePath = `organization-logos/${fileName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('public')
      .upload(filePath, uint8Array, {
        contentType: blob.type || `image/${fileExtension}`,
        upsert: true,
        cacheControl: '3600' // Cache for 1 hour
      });

    if (uploadError) {
      console.error('Logo upload error:', uploadError);
      // Try alternative bucket or return original URL
      return logoUrl; // Return original URL as fallback
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('public')
      .getPublicUrl(filePath);

    // Also cache in source_favicons table
    if (website) {
      try {
        const domain = new URL(website).hostname;
        await supabase.rpc('upsert_source_favicon', {
          p_domain: domain,
          p_favicon_url: publicUrl,
          p_source_type: 'dealer',
          p_source_name: domain.split('.')[0]
        });
      } catch (err) {
        console.warn('Failed to cache favicon:', err);
      }
    }

    return publicUrl;

  } catch (error: any) {
    console.error('Error downloading logo:', error);
    return null;
  }
}

/**
 * Extract website favicon (for small UI areas - SVG, PNG, ICO)
 * Uses shared extractFavicon utility which caches in source_favicons table
 */
async function extractWebsiteFavicon(website: string, supabase: any): Promise<string | null> {
  try {
    // Import shared favicon extractor
    const extractFaviconPath = '../_shared/extractFavicon.ts';
    const { extractAndCacheFavicon } = await import(extractFaviconPath);
    
    // Extract and cache favicon (returns Google favicon service URL or cached URL)
    const faviconUrl = await extractAndCacheFavicon(supabase, website, 'dealer', null);
    
    // Also try to get actual favicon from website (better quality for SVG/PNG)
    try {
      const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (firecrawlApiKey) {
        const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: website,
            formats: ['html'],
            pageOptions: { waitFor: 1000 }
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.html) {
            const html = data.data.html;
            
            // Try to find favicon in HTML
            const faviconPatterns = [
              /<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]+href=["']([^"']+)["']/i,
              /<link[^>]+href=["']([^"']+favicon[^"']+)["'][^>]+rel=["'](?:icon|shortcut icon)["']/i,
            ];

            for (const pattern of faviconPatterns) {
              const match = html.match(pattern);
              if (match && match[1]) {
                let faviconUrl = match[1];
                if (!faviconUrl.startsWith('http')) {
                  try {
                    const baseUrl = new URL(website);
                    faviconUrl = new URL(faviconUrl, baseUrl.origin).href;
                  } catch {
                    continue;
                  }
                }
                // Prefer actual favicon over Google service
                return faviconUrl;
              }
            }
          }
        }
      }
    } catch (err) {
      // Fall back to cached favicon
    }
    
    return faviconUrl;
  } catch (err) {
    console.warn('Favicon extraction failed:', err);
    return null;
  }
}

/**
 * Extract primary image (property front - keeping expectations low for now)
 * Tries to find a property/building image from the website
 */
async function extractPrimaryImage(website: string, supabase: any): Promise<string | null> {
  try {
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    let html: string | null = null;

    if (firecrawlApiKey) {
      // Try to scrape homepage for property images
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: website,
          formats: ['html'],
          pageOptions: { waitFor: 2000 }
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data?.html) html = data.data.html;
      }
    }

    // Fallback: direct fetch HTML (works even without Firecrawl)
    if (!html) {
      const resp = await fetch(website, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15000),
      }).catch(() => null);
      if (resp && resp.ok) {
        html = await resp.text().catch(() => null);
      }
    }

    if (!html) return null;
    
    // Look for property/building images (hero images, about page images, etc.)
    // Patterns: hero, about, property, building, facility, location
    const imagePatterns = [
      /<img[^>]+src="([^"]*hero[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i,
      /<img[^>]+src="([^"]*about[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i,
      /<img[^>]+src="([^"]*property[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i,
      /<img[^>]+src="([^"]*building[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i,
      /<img[^>]+src="([^"]*facility[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i,
      /<img[^>]+src="([^"]*location[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i,
    ];

    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let imageUrl = match[1];
        if (!imageUrl.startsWith('http')) {
          try {
            const baseUrl = new URL(website);
            imageUrl = new URL(imageUrl, baseUrl.origin).href;
          } catch {
            continue;
          }
        }
        return imageUrl;
      }
    }

    // Brand DNA fallback: pick banner/og image if present.
    try {
      const assets = extractBrandAssetsFromHtml(html, website);
      const fallback =
        assets.banner_url ||
        (Array.isArray(assets.primary_image_urls) ? assets.primary_image_urls[0] : null) ||
        null;
      return fallback || null;
    } catch {
      // ignore
    }

    return null;
  } catch (err) {
    console.warn('Primary image extraction failed:', err);
    return null;
  }
}

function resolveBannerFallback(params: {
  banner_url: string | null;
  logo_url: string | null;
  favicon_url: string | null;
}): string | null {
  return params.banner_url || params.logo_url || params.favicon_url || null;
}

/**
 * Find or create organization using geographic logic
 */
async function findOrCreateOrganizationWithGeographicLogic(
  dealerData: DealerProfileData,
  logoUrl: string | null,
  faviconUrl: string | null,
  primaryImageUrl: string | null,
  sourceUrl: string,
  supabase: any
): Promise<any> {
  // Priority 1: Match by dealer license (strongest - unique identifier)
  if (dealerData.dealer_license) {
    const { data: existingByLicense } = await supabase
      .from('businesses')
      .select('id, business_name, city, state, dealer_license, logo_url, banner_url, metadata')
      .eq('dealer_license', dealerData.dealer_license)
      .maybeSingle();

    if (existingByLicense) {
      // Update missing fields + always attach Classic.com profile metadata for future inventory sync.
      const updates: any = {};
      if (logoUrl && !existingByLicense.logo_url) updates.logo_url = logoUrl;
      if (primaryImageUrl && !existingByLicense.banner_url) updates.banner_url = primaryImageUrl;

      const existingMeta =
        existingByLicense.metadata && typeof existingByLicense.metadata === 'object'
          ? existingByLicense.metadata
          : {};
      const mergedMeta: any = { ...existingMeta };
      if (!mergedMeta.classic_com_profile) mergedMeta.classic_com_profile = sourceUrl;
      if (dealerData.inventory_url && !mergedMeta.inventory_url) mergedMeta.inventory_url = dealerData.inventory_url;
      if (dealerData.auctions_url && !mergedMeta.auctions_url) mergedMeta.auctions_url = dealerData.auctions_url;
      updates.metadata = mergedMeta;

      if (Object.keys(updates).length > 0) {
        await supabase.from('businesses').update(updates).eq('id', existingByLicense.id);
      }
      return { id: existingByLicense.id, name: existingByLicense.business_name };
    }
  }

  // Priority 2: Match by website
  if (dealerData.website) {
    const { data: existingByWebsite } = await supabase
      .from('businesses')
      .select('id, business_name, city, state, dealer_license, logo_url, banner_url, metadata')
      .eq('website', dealerData.website)
      .maybeSingle();

    if (existingByWebsite) {
      const updates: any = {};
      if (dealerData.dealer_license && !existingByWebsite.dealer_license) {
        updates.dealer_license = dealerData.dealer_license;
      }
      if (logoUrl && !existingByWebsite.logo_url) updates.logo_url = logoUrl;
      if (primaryImageUrl && !existingByWebsite.banner_url) updates.banner_url = primaryImageUrl;

      const existingMeta =
        existingByWebsite.metadata && typeof existingByWebsite.metadata === 'object'
          ? existingByWebsite.metadata
          : {};
      const mergedMeta: any = { ...existingMeta };
      if (!mergedMeta.classic_com_profile) mergedMeta.classic_com_profile = sourceUrl;
      if (dealerData.inventory_url && !mergedMeta.inventory_url) mergedMeta.inventory_url = dealerData.inventory_url;
      if (dealerData.auctions_url && !mergedMeta.auctions_url) mergedMeta.auctions_url = dealerData.auctions_url;
      updates.metadata = mergedMeta;

      if (Object.keys(updates).length > 0) {
        await supabase.from('businesses').update(updates).eq('id', existingByWebsite.id);
      }
      return { id: existingByWebsite.id, name: existingByWebsite.business_name };
    }
  }

  // Priority 3: Match by name + city + state (geographic matching)
  if (dealerData.name && dealerData.city && dealerData.state) {
    const { data: existingByLocation } = await supabase
      .from('businesses')
      .select('id, business_name, city, state, dealer_license, logo_url, banner_url, website, metadata')
      .ilike('business_name', `%${dealerData.name}%`)
      .ilike('city', `%${dealerData.city}%`)
      .eq('state', dealerData.state.toUpperCase())
      .maybeSingle();

    if (existingByLocation) {
      // Update missing fields
      const updates: any = {};
      if (logoUrl) updates.logo_url = logoUrl;
      if (primaryImageUrl) updates.banner_url = primaryImageUrl;
      if (dealerData.dealer_license) updates.dealer_license = dealerData.dealer_license;
      if (dealerData.website) updates.website = dealerData.website;

      const existingMeta =
        existingByLocation.metadata && typeof existingByLocation.metadata === 'object'
          ? existingByLocation.metadata
          : {};
      const mergedMeta: any = { ...existingMeta };
      if (!mergedMeta.classic_com_profile) mergedMeta.classic_com_profile = sourceUrl;
      if (dealerData.inventory_url && !mergedMeta.inventory_url) mergedMeta.inventory_url = dealerData.inventory_url;
      if (dealerData.auctions_url && !mergedMeta.auctions_url) mergedMeta.auctions_url = dealerData.auctions_url;
      updates.metadata = mergedMeta;

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('businesses')
          .update(updates)
          .eq('id', existingByLocation.id);
      }
      return { id: existingByLocation.id, name: existingByLocation.business_name };
    }
  }

  // No match found - create new organization
  const slug = dealerData.name
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';

  const geographicKey = dealerData.city && dealerData.state
    ? `${dealerData.name?.toLowerCase()}-${dealerData.city.toLowerCase()}-${dealerData.state.toLowerCase()}`
    : null;

  const { data: newOrg, error } = await supabase
    .from('businesses')
    .insert({
      business_name: dealerData.name,
      business_type: dealerData.business_type === 'auction_house' ? 'other' : 'dealership',
      type: dealerData.business_type, // Store in type field if it exists
      website: dealerData.website,
      phone: dealerData.phone,
      email: dealerData.email,
      address: dealerData.address,
      city: dealerData.city,
      state: dealerData.state,
      zip_code: dealerData.zip,
      dealer_license: dealerData.dealer_license,
      logo_url: logoUrl,
      banner_url: primaryImageUrl, // Use banner_url for property front image
      description: dealerData.description,
      specializations: dealerData.specialties && dealerData.specialties.length > 0 ? dealerData.specialties : null,
      geographic_key: geographicKey,
      discovered_via: 'classic_com_indexing',
      source_url: sourceUrl,
      metadata: {
        classic_com_profile: sourceUrl,
        inventory_url: dealerData.inventory_url,
        auctions_url: dealerData.auctions_url,
        slug: slug,
        logo_source: logoUrl ? 'classic_com' : null,
        favicon_source: faviconUrl ? 'website' : null,
        primary_image_source: primaryImageUrl ? 'website' : null
      }
    })
    .select('id, business_name')
    .single();

  if (error) {
    throw new Error(`Failed to create organization: ${error.message}`);
  }

  return { id: newOrg.id, name: newOrg.business_name };
}

/**
 * Queue inventory extraction job
 */
async function queueInventoryExtraction(
  params: {
    organization_id: string;
    business_type: 'dealer' | 'auction_house';
    website: string;
    inventory_url?: string | null;
    auctions_url?: string | null;
  },
  supabase: any
): Promise<void> {
  // Create job in inventory extraction queue (or call scrape-multi-source)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  const targetUrl = params.business_type === 'auction_house' 
    ? (params.auctions_url || `${params.website}/auctions`)
    : (params.inventory_url || `${params.website}/inventory`);

  // Trigger scrape-multi-source to extract inventory
  await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseServiceKey}`
    },
    body: JSON.stringify({
      source_url: targetUrl,
      source_type: params.business_type === 'auction_house' ? 'auction_house' : 'dealer_website',
      organization_id: params.organization_id,
      max_results: 200,
      use_llm_extraction: true
    })
  }).catch(err => {
    console.warn('Failed to queue inventory extraction:', err);
    // Don't fail the whole operation if inventory queue fails
  });
}

