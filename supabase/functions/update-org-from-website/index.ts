/**
 * Update Organization Profile from Website
 * 
 * Extracts organization data from their website and updates the profile:
 * - Website URL
 * - Description
 * - Logo/Favicon
 * - Contact info
 * - Inventory links
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { organizationId, websiteUrl } = await req.json();

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: 'organizationId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get current organization
    const { data: org, error: orgError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', organizationId)
      .single();

    if (orgError || !org) {
      throw new Error(`Organization not found: ${orgError?.message}`);
    }

    // Determine website URL
    const url = websiteUrl || org.website || `https://${org.business_name?.toLowerCase().replace(/\s+/g, '')}.com`;
    
    console.log(`🔍 Extracting data from: ${url}`);

    // Fetch homepage
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch website: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Extract organization data
    const updates: any = {};

    // Extract website if not set
    if (!org.website) {
      const canonicalLink = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
      const ogUrl = doc.querySelector('meta[property="og:url"]')?.getAttribute('content');
      if (canonicalLink) {
        updates.website = canonicalLink;
      } else if (ogUrl) {
        updates.website = ogUrl;
      } else {
        updates.website = url;
      }
    }

    // Extract description
    const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content');
    const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
    if (metaDesc || ogDesc) {
      updates.description = metaDesc || ogDesc;
    }

    // Extract logo
    const logoSelectors = [
      'img[alt*="logo" i]',
      'img[class*="logo" i]',
      'img[id*="logo" i]',
      '.logo img',
      '#logo img',
      'meta[property="og:image"]',
    ];

    let logoUrl: string | null = null;
    for (const selector of logoSelectors) {
      const el = doc.querySelector(selector);
      if (el) {
        if (el.tagName === 'META') {
          const content = el.getAttribute('content');
          if (content) logoUrl = content;
        } else {
          const src = (el as any).getAttribute('src') || (el as any).getAttribute('data-src');
          if (src) logoUrl = src;
        }
        if (logoUrl) {
          // Make absolute URL
          if (logoUrl.startsWith('//')) {
            logoUrl = `https:${logoUrl}`;
          } else if (logoUrl.startsWith('/')) {
            const baseUrl = new URL(url);
            logoUrl = `${baseUrl.origin}${logoUrl}`;
          }
          break;
        }
      }
    }

    if (logoUrl && !org.logo_url) {
      updates.logo_url = logoUrl;
    }

    // Extract contact info
    const phonePattern = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/;
    const phoneMatch = html.match(phonePattern);
    if (phoneMatch && !org.phone) {
      updates.phone = phoneMatch[0].replace(/\s+/g, '-');
    }

    // Extract address and location (comprehensive patterns)
    const addressPatterns = [
      // Structured data (schema.org)
      doc.querySelector('[itemprop="address"]'),
      doc.querySelector('[itemprop="addressLocality"]')?.parentElement,
      // Common class names
      doc.querySelector('.address, .business-address, .contact-address, .location-address'),
      doc.querySelector('[class*="address"]:not([class*="email"])'),
      // Footer addresses (common location)
      doc.querySelector('footer .address, footer [class*="address"]'),
      // Contact sections
      doc.querySelector('.contact-info .address, .contact .address'),
      // Meta tags
      doc.querySelector('meta[property="business:contact_data:street_address"]')?.parentElement,
    ].filter(Boolean);

    let addressText: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    let zipCode: string | null = null;

    // Try structured data first
    for (const el of addressPatterns) {
      if (!el) continue;
      const text = el.textContent?.trim() || '';
      if (text.length > 10) {
        addressText = text;
        break;
      }
    }

    // If no structured address found, try parsing from body text
    if (!addressText || addressText.length < 10) {
      const bodyText = doc.body?.textContent || '';
      
      // Pattern: Full address with zip (most reliable)
      const fullAddressPattern = /(\d+\s+[A-Za-z0-9\s,]+(?:Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Way|Ct|Court)[^,]*),\s*([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/i;
      const fullMatch = bodyText.match(fullAddressPattern);
      if (fullMatch) {
        addressText = fullMatch[1].trim();
        city = fullMatch[2].trim();
        state = fullMatch[3].trim();
        zipCode = fullMatch[4].trim();
      } else {
        // Pattern: City, State ZIP
        const cityStatePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/g;
        const cityStateMatch = bodyText.match(cityStatePattern);
        if (cityStateMatch && cityStateMatch.length > 0) {
          // Take the first match that looks like a location (not a date)
          const match = cityStateMatch[0].match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/);
          if (match) {
            city = match[1].trim();
            state = match[2].trim();
            zipCode = match[3].trim();
          }
        } else {
          // Pattern: Just City, State (more flexible)
          const simplePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})(?:\s|$)/g;
          const simpleMatch = bodyText.match(simplePattern);
          if (simpleMatch && simpleMatch.length > 0) {
            const match = simpleMatch[0].match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})/);
            if (match) {
              city = match[1].trim();
              state = match[2].trim();
            }
          }
        }
      }
    } else {
      // Parse city/state from addressText if we have it
      const cityStateZipPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/;
      const match = addressText.match(cityStateZipPattern);
      if (match) {
        city = match[1].trim();
        state = match[2].trim();
        zipCode = match[3].trim();
        addressText = addressText.replace(/,?\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?$/, '').trim();
      } else {
        const cityStatePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})(?:\s|$)/;
        const match2 = addressText.match(cityStatePattern);
        if (match2) {
          city = match2[1].trim();
          state = match2[2].trim();
        }
      }
    }

    // Update location fields (only if missing and we found data)
    if (addressText && addressText.length > 10 && !org.address) {
      updates.address = addressText;
    }
    if (city && !org.city) {
      updates.city = city;
    }
    if (state && !org.state) {
      updates.state = state;
    }
    if (zipCode && !org.zip_code) {
      updates.zip_code = zipCode;
    }

    // Extract business type from content
    const bodyText = doc.body?.textContent?.toLowerCase() || '';
    if (bodyText.includes('specialty shop') || bodyText.includes('service')) {
      if (!org.business_type || org.business_type === 'unknown') {
        updates.business_type = 'specialty_shop';
      }
    }

    // Find inventory/listing pages
    const inventoryLinks: string[] = [];
    const listingSelectors = [
      'a[href*="/listing/"]',
      'a[href*="/inventory"]',
      'a[href*="/vehicles"]',
      'a[href*="/cars"]',
    ];

    for (const selector of listingSelectors) {
      const links = doc.querySelectorAll(selector);
      for (const link of Array.from(links).slice(0, 10) as any[]) {
        const href = link?.getAttribute('href');
        if (href && typeof href === 'string') {
          let fullUrl: string = href;
          if (href.startsWith('/')) {
            const baseUrl = new URL(url);
            fullUrl = `${baseUrl.origin}${href}`;
          } else if (!href.startsWith('http')) {
            continue;
          }
          if (!inventoryLinks.includes(fullUrl)) {
            inventoryLinks.push(fullUrl);
          }
        }
      }
    }

    // Geocode address to get coordinates if we have location data
    if ((city && state) || addressText) {
      try {
        const query = [addressText, city, state, zipCode].filter(Boolean).join(', ');
        if (query && (!org.latitude || !org.longitude)) {
          const geoResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
            {
              headers: {
                'User-Agent': 'Nuke-Platform/1.0'
              }
            }
          );
          
          if (geoResponse.ok) {
            const geoResults = await geoResponse.json();
            if (geoResults.length > 0) {
              updates.latitude = parseFloat(geoResults[0].lat);
              updates.longitude = parseFloat(geoResults[0].lon);
              console.log(`✅ Geocoded location: ${query} -> ${updates.latitude}, ${updates.longitude}`);
            }
          }
        }
      } catch (geoError) {
        console.warn('Geocoding failed (non-blocking):', geoError);
      }
    }

    // Update organization
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      
      const { error: updateError } = await supabase
        .from('businesses')
        .update(updates)
        .eq('id', organizationId);

      if (updateError) {
        throw new Error(`Failed to update organization: ${updateError.message}`);
      }

      console.log(`✅ Updated organization with:`, Object.keys(updates));
    }

    // Return results
    return new Response(
      JSON.stringify({
        success: true,
        organization_id: organizationId,
        updates: Object.keys(updates),
        inventory_links_found: inventoryLinks.length,
        inventory_links: inventoryLinks.slice(0, 20), // Return first 20
        website: updates.website || org.website,
        logo_url: updates.logo_url || org.logo_url,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error updating organization:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

