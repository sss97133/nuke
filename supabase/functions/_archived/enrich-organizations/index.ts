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
    const baseUrl = new URL(website);
    const origin = baseUrl.origin;

    // Helper to make absolute URL
    const toAbsoluteUrl = (url: string): string => {
      if (!url) return '';
      if (url.startsWith('http')) return url;
      if (url.startsWith('//')) return `https:${url}`;
      if (url.startsWith('/')) return `${origin}${url}`;
      return `${origin}/${url}`;
    };

    // Helper to score logo quality
    const scoreLogo = (url: string, context: { isSvg?: boolean; isMeta?: boolean; hasLogoInPath?: boolean; size?: string }): number => {
      const lower = url.toLowerCase();
      let score = 0;
      
      // Prefer SVG logos (scalable, usually better quality)
      if (context.isSvg || lower.endsWith('.svg')) score += 10;
      
      // Prefer larger sizes
      if (context.size) {
        const sizeMatch = context.size.match(/(\d+)x(\d+)/);
        if (sizeMatch) {
          const size = parseInt(sizeMatch[1]) * parseInt(sizeMatch[2]);
          if (size > 10000) score += 5;
          if (size > 50000) score += 5;
        }
      }
      
      // Prefer logos in common paths
      if (context.hasLogoInPath || lower.includes('/logo')) score += 3;
      
      // Prefer meta og:image (usually high quality)
      if (context.isMeta) score += 2;
      
      // Penalize favicons and icons
      if (lower.includes('favicon') || lower.includes('icon') || lower.endsWith('.ico')) score -= 20;
      
      // Penalize tiny images
      if (lower.includes('16x16') || lower.includes('32x32') || lower.includes('64x64')) score -= 10;
      
      return score;
    };

    const response = await fetch(website, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const candidates: Array<{ url: string; score: number }> = [];

    // 1. Try meta tags (og:image, twitter:image) - usually high quality
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
    
    if (ogImage) {
      const url = toAbsoluteUrl(ogImage);
      if (url) candidates.push({ url, score: scoreLogo(url, { isMeta: true }) });
    }
    if (twitterImage) {
      const url = toAbsoluteUrl(twitterImage);
      if (url) candidates.push({ url, score: scoreLogo(url, { isMeta: true }) });
    }

    // 2. Try JSON-LD structured data
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of Array.from(jsonLdScripts)) {
      try {
        const data = JSON.parse(script.textContent || '{}');
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item.logo) {
            const url = toAbsoluteUrl(typeof item.logo === 'string' ? item.logo : item.logo.url);
            if (url) candidates.push({ url, score: scoreLogo(url, { hasLogoInPath: true }) });
          }
          if (item.image) {
            const url = toAbsoluteUrl(typeof item.image === 'string' ? item.image : item.image.url);
            if (url) candidates.push({ url, score: scoreLogo(url, { isMeta: true }) });
          }
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // 3. Try img tags with logo indicators
    const imgTags = doc.querySelectorAll('img');
    for (const img of Array.from(imgTags)) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (!src) continue;

      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const className = (img.getAttribute('class') || '').toLowerCase();
      const id = (img.getAttribute('id') || '').toLowerCase();
      const srcLower = src.toLowerCase();

      const isLogo = 
        alt.includes('logo') || 
        className.includes('logo') || 
        id.includes('logo') ||
        srcLower.includes('logo');

      if (isLogo) {
        const url = toAbsoluteUrl(src);
        if (url) {
          const size = img.getAttribute('width') && img.getAttribute('height') 
            ? `${img.getAttribute('width')}x${img.getAttribute('height')}`
            : undefined;
          candidates.push({ 
            url, 
            score: scoreLogo(url, { 
              isSvg: url.endsWith('.svg'),
              hasLogoInPath: true,
              size
            }) 
          });
        }
      }
    }

    // 4. Try common logo paths
    const commonPaths = [
      '/logo.png',
      '/logo.svg',
      '/images/logo.png',
      '/images/logo.svg',
      '/assets/logo.png',
      '/assets/logo.svg',
      '/img/logo.png',
      '/img/logo.svg',
      '/static/logo.png',
      '/static/logo.svg',
    ];

    for (const path of commonPaths) {
      try {
        const testUrl = `${origin}${path}`;
        const testResponse = await fetch(testUrl, { 
          method: 'HEAD',
          signal: AbortSignal.timeout(3000)
        });
        if (testResponse.ok) {
          candidates.push({ 
            url: testUrl, 
            score: scoreLogo(testUrl, { 
              isSvg: path.endsWith('.svg'),
              hasLogoInPath: true 
            }) 
          });
        }
      } catch (e) {
        // Skip failed requests
      }
    }

    // 5. Try link tags with larger icon sizes (but not favicons)
    const linkTags = doc.querySelectorAll('link[rel*="icon"]');
    for (const link of Array.from(linkTags)) {
      const href = link.getAttribute('href');
      const sizes = link.getAttribute('sizes');
      if (!href) continue;

      const hrefLower = href.toLowerCase();
      // Skip actual favicons
      if (hrefLower.includes('favicon') || hrefLower.endsWith('.ico')) continue;

      // Prefer larger sizes (192x192, 512x512, etc.)
      if (sizes && (sizes.includes('192') || sizes.includes('512') || sizes.includes('apple'))) {
        const url = toAbsoluteUrl(href);
        if (url) {
          candidates.push({ 
            url, 
            score: scoreLogo(url, { 
              isSvg: url.endsWith('.svg'),
              size: sizes 
            }) 
          });
        }
      }
    }

    // Sort by score and return best candidate
    candidates.sort((a, b) => b.score - a.score);
    
    // Filter out low-scoring candidates (likely not logos)
    const bestCandidates = candidates.filter(c => c.score > 0);
    
    if (bestCandidates.length > 0) {
      // Validate the best candidate by checking if it's actually an image
      const best = bestCandidates[0];
      try {
        const imgCheck = await fetch(best.url, { 
          method: 'HEAD',
          signal: AbortSignal.timeout(5000)
        });
        const contentType = imgCheck.headers.get('content-type') || '';
        if (contentType.startsWith('image/')) {
          return best.url;
        }
      } catch (e) {
        // If HEAD fails, try the URL anyway (might be CORS issue)
        return best.url;
      }
    }

    // Fallback: Try Clearbit Logo API (free tier available)
    try {
      const domain = baseUrl.hostname.replace('www.', '');
      const clearbitUrl = `https://logo.clearbit.com/${domain}`;
      const clearbitCheck = await fetch(clearbitUrl, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(3000)
      });
      if (clearbitCheck.ok && clearbitCheck.status === 200) {
        return clearbitUrl;
      }
    } catch (e) {
      // Clearbit fallback failed
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

