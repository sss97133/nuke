/**
 * Batch Organization Enrichment
 * 
 * Enriches organizations with missing data:
 * - Extracts logos from websites
 * - Geocodes addresses to get coordinates
 * - Extracts descriptions and contact info
 * 
 * Designed to run periodically to make orgs more "investible"
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnrichmentResult {
  org_id: string;
  org_name: string;
  logo_extracted: boolean;
  geocoded: boolean;
  description_extracted: boolean;
  contact_extracted: boolean;
  errors: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { limit = 50, dryRun = false } = await req.json().catch(() => ({ limit: 50, dryRun: false }));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get organizations needing enrichment
    const { data: orgs, error: fetchError } = await supabase
      .rpc('get_orgs_needing_enrichment', { p_limit: limit });

    if (fetchError) {
      throw new Error(`Failed to fetch orgs: ${fetchError.message}`);
    }

    if (!orgs || orgs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No organizations need enrichment', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: EnrichmentResult[] = [];

    for (const org of orgs) {
      const result: EnrichmentResult = {
        org_id: org.id,
        org_name: org.business_name,
        logo_extracted: false,
        geocoded: false,
        description_extracted: false,
        contact_extracted: false,
        errors: [],
      };

      const updates: any = {};

      try {
        // 1. Extract logo from website if needed
        if (org.needs_logo && org.website) {
          try {
            const logoUrl = await extractLogoFromWebsite(org.website);
            if (logoUrl) {
              updates.logo_url = logoUrl;
              result.logo_extracted = true;
              console.log(`✅ Extracted logo for ${org.business_name}: ${logoUrl}`);
            }
          } catch (err) {
            result.errors.push(`Logo extraction failed: ${err.message}`);
            console.warn(`⚠️ Logo extraction failed for ${org.business_name}:`, err);
          }
        }

        // 2. Geocode address if needed
        if (org.needs_geocoding && (org.address || (org.city && org.state))) {
          try {
            const query = [org.address, org.city, org.state, org.zip_code].filter(Boolean).join(', ');
            if (query) {
              const coords = await geocodeAddress(query);
              if (coords) {
                updates.latitude = coords.latitude;
                updates.longitude = coords.longitude;
                result.geocoded = true;
                console.log(`✅ Geocoded ${org.business_name}: ${coords.latitude}, ${coords.longitude}`);
              }
            }
          } catch (err) {
            result.errors.push(`Geocoding failed: ${err.message}`);
            console.warn(`⚠️ Geocoding failed for ${org.business_name}:`, err);
          }
        }

        // 3. Extract description and contact info from website if needed
        if (org.needs_description && org.website) {
          try {
            const websiteData = await extractWebsiteData(org.website);
            if (websiteData.description && !org.description) {
              updates.description = websiteData.description;
              result.description_extracted = true;
            }
            if (websiteData.phone && !org.phone) {
              updates.phone = websiteData.phone;
              result.contact_extracted = true;
            }
            if (websiteData.email && !org.email) {
              updates.email = websiteData.email;
              result.contact_extracted = true;
            }
          } catch (err) {
            result.errors.push(`Website extraction failed: ${err.message}`);
            console.warn(`⚠️ Website extraction failed for ${org.business_name}:`, err);
          }
        }

        // Update organization if not dry run
        if (!dryRun && Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          
          const { error: updateError } = await supabase
            .from('businesses')
            .update(updates)
            .eq('id', org.id);

          if (updateError) {
            result.errors.push(`Update failed: ${updateError.message}`);
          } else {
            // Update enrichment status
            if (result.logo_extracted) {
              await supabase.rpc('update_org_enrichment_status', {
                p_org_id: org.id,
                p_enrichment_type: 'logo',
                p_status: 'completed',
                p_result: { logo_url: updates.logo_url }
              });
            }
            if (result.geocoded) {
              await supabase.rpc('update_org_enrichment_status', {
                p_org_id: org.id,
                p_enrichment_type: 'geocoding',
                p_status: 'completed',
                p_result: { latitude: updates.latitude, longitude: updates.longitude }
              });
            }
          }
        }

      } catch (err) {
        result.errors.push(`Processing failed: ${err.message}`);
        console.error(`❌ Failed to process ${org.business_name}:`, err);
      }

      results.push(result);
    }

    const summary = {
      total: orgs.length,
      logos_extracted: results.filter(r => r.logo_extracted).length,
      geocoded: results.filter(r => r.geocoded).length,
      descriptions_extracted: results.filter(r => r.description_extracted).length,
      contacts_extracted: results.filter(r => r.contact_extracted).length,
      errors: results.filter(r => r.errors.length > 0).length,
      dry_run: dryRun,
      results: results
    };

    return new Response(
      JSON.stringify(summary, null, 2),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Enrichment error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function extractLogoFromWebsite(website: string): Promise<string | null> {
  try {
    const response = await fetch(website, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Try multiple logo selectors
    const logoSelectors = [
      'meta[property="og:image"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="icon"][sizes="192x192"]',
      'link[rel="icon"][sizes="512x512"]',
      'img[alt*="logo" i]',
      'img[class*="logo" i]',
      'img[id*="logo" i]',
      '.logo img',
      '#logo img',
    ];

    for (const selector of logoSelectors) {
      const el = doc.querySelector(selector);
      if (el) {
        let logoUrl: string | null = null;
        
        if (el.tagName === 'META') {
          logoUrl = el.getAttribute('content');
        } else if (el.tagName === 'LINK') {
          logoUrl = el.getAttribute('href');
        } else {
          logoUrl = (el as any).getAttribute('src') || (el as any).getAttribute('data-src');
        }

        if (logoUrl) {
          // Make absolute URL
          if (logoUrl.startsWith('//')) {
            logoUrl = `https:${logoUrl}`;
          } else if (logoUrl.startsWith('/')) {
            const baseUrl = new URL(website);
            logoUrl = `${baseUrl.origin}${logoUrl}`;
          } else if (!logoUrl.startsWith('http')) {
            const baseUrl = new URL(website);
            logoUrl = `${baseUrl.origin}/${logoUrl}`;
          }

          // Validate it's not a favicon
          const lowerUrl = logoUrl.toLowerCase();
          if (lowerUrl.includes('favicon') || lowerUrl.endsWith('.ico')) {
            continue;
          }

          return logoUrl;
        }
      }
    }

    return null;
  } catch (error) {
    console.warn('Logo extraction error:', error);
    return null;
  }
}

async function geocodeAddress(query: string): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      {
        headers: {
          'User-Agent': 'Nuke-Platform/1.0',
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) return null;

    const results = await response.json();
    if (results.length === 0) return null;

    return {
      latitude: parseFloat(results[0].lat),
      longitude: parseFloat(results[0].lon),
    };
  } catch (error) {
    console.warn('Geocoding error:', error);
    return null;
  }
}

async function extractWebsiteData(website: string): Promise<{
  description?: string;
  phone?: string;
  email?: string;
}> {
  try {
    const response = await fetch(website, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return {};

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const data: { description?: string; phone?: string; email?: string } = {};

    // Extract description
    const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content');
    const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
    if (metaDesc || ogDesc) {
      data.description = (metaDesc || ogDesc)?.substring(0, 500); // Limit length
    }

    // Extract phone (common patterns)
    const phonePattern = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
    const phoneMatches = html.match(phonePattern);
    if (phoneMatches && phoneMatches.length > 0) {
      data.phone = phoneMatches[0].replace(/\D/g, '').replace(/^1/, ''); // Clean and remove leading 1
      if (data.phone.length === 10) {
        data.phone = `(${data.phone.substring(0, 3)}) ${data.phone.substring(3, 6)}-${data.phone.substring(6)}`;
      }
    }

    // Extract email
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailMatches = html.match(emailPattern);
    if (emailMatches && emailMatches.length > 0) {
      // Filter out common non-contact emails
      const filtered = emailMatches.filter(e => 
        !e.includes('example.com') && 
        !e.includes('sentry.io') &&
        !e.includes('google') &&
        !e.includes('facebook')
      );
      if (filtered.length > 0) {
        data.email = filtered[0];
      }
    }

    return data;
  } catch (error) {
    console.warn('Website data extraction error:', error);
    return {};
  }
}

