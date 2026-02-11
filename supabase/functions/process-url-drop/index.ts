import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Strip characters that could inject into PostgREST .or() filter strings */
function escapePostgrestValue(s: string): string {
  return s.replace(/[",().\\]/g, '');
}

/**
 * Process URL Drop - Universal URL Handler (v2)
 *
 * Handles ANY URL a user drops into the system:
 * - Known platforms (BaT, Cars & Bids, Instagram, YouTube, Facebook)
 * - Auction houses (Mecum, RM Sotheby's, Gooding, etc.)
 * - Events/Rallies (1000 Miglia, Dakar, Pebble Beach)
 * - Dealers, Builders, Collections
 * - Generic vehicle listings
 *
 * Creates discovery leads for the snowball system to process.
 */

// FB Relay: local server on residential IP, exposed via ngrok
const FB_RELAY_URL = Deno.env.get('FB_RELAY_URL'); // e.g. https://xxxx.ngrok-free.app
const FB_RELAY_TOKEN = Deno.env.get('FB_RELAY_TOKEN') || 'nuke-fb-relay-2026';

async function fbRelay(action: 'resolve' | 'scrape', targetUrl: string): Promise<any> {
  if (!FB_RELAY_URL) return null;
  try {
    const resp = await fetch(`${FB_RELAY_URL}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FB_RELAY_TOKEN}`,
      },
      body: JSON.stringify({ url: targetUrl, action }),
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch (e) {
    console.warn(`FB relay ${action} failed:`, e);
    return null;
  }
}

interface URLDropRequest {
  url: string;
  userId?: string;
  opinion?: string;
  rating?: number;
  _inbox_id?: string;  // If called from url_inbox trigger
  _source?: string;    // Source channel (telegram, web_app, etc.)
}

// Known platforms and their types
const KNOWN_PLATFORMS: Record<string, { type: string; business_type?: string; handler?: string }> = {
  // Online Auction Platforms
  'bringatrailer.com': { type: 'bat_listing', business_type: 'auction_house', handler: 'bat' },
  'carsandbids.com': { type: 'auction_listing', business_type: 'auction_house', handler: 'cars_and_bids' },
  'collectingcars.com': { type: 'auction_listing', business_type: 'auction_house' },
  'pcarmarket.com': { type: 'auction_listing', business_type: 'auction_house' },
  'hemmings.com': { type: 'auction_listing', business_type: 'auction_house' },
  'barnfinds.com': { type: 'auction_listing', business_type: 'auction_house', handler: 'barnfinds' },

  // Physical Auction Houses
  'mecum.com': { type: 'auction_house', business_type: 'auction_house' },
  'rmsothebys.com': { type: 'auction_house', business_type: 'auction_house' },
  'goodingco.com': { type: 'auction_house', business_type: 'auction_house' },
  'bonhams.com': { type: 'auction_house', business_type: 'auction_house' },
  'barrett-jackson.com': { type: 'auction_house', business_type: 'auction_house' },
  'broadarrowgroup.com': { type: 'auction_house', business_type: 'auction_house' },
  'dupontregistry.com': { type: 'auction_listing', business_type: 'auction_house' },
  'silverstoneauctions.com': { type: 'auction_house', business_type: 'auction_house' },

  // Events & Rallies
  '1000miglia.it': { type: 'event', business_type: 'rally_event' },
  'dakar.com': { type: 'event', business_type: 'rally_event' },
  'pebblebeachconcours.net': { type: 'event', business_type: 'concours' },
  'goodwood.com': { type: 'event', business_type: 'motorsport_event' },
  'montereycarweek.com': { type: 'event', business_type: 'concours' },
  'semashow.com': { type: 'event', business_type: 'automotive_expo' },
  'gumball3000.com': { type: 'event', business_type: 'rally_event' },

  // Social Media
  'instagram.com': { type: 'instagram', handler: 'instagram' },
  'youtube.com': { type: 'youtube', handler: 'youtube' },
  'youtu.be': { type: 'youtube', handler: 'youtube' },
  'tiktok.com': { type: 'social_media' },
  'facebook.com': { type: 'facebook', handler: 'facebook' },
  'm.facebook.com': { type: 'facebook', handler: 'facebook' },
  'fb.com': { type: 'facebook', handler: 'facebook' },
  'l.facebook.com': { type: 'facebook', handler: 'facebook' },

  // Classifieds
  'ebay.com': { type: 'ebay_listing' },
  'autotrader.com': { type: 'classified_listing' },
  'classic.com': { type: 'dealer_directory', business_type: 'dealer_aggregator' },
  'classiccars.com': { type: 'classified_listing' },

  // Dealer / builder inventory (Wix, etc.)
  'victorylapclassics.net': { type: 'vehicle_listing', business_type: 'dealer', handler: 'victorylap' },

  // N-Zero internal
  'n-zero.dev': { type: 'n-zero_internal', handler: 'n-zero' },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let _inbox_id: string | undefined;

  try {
    const body: URLDropRequest = await req.json();
    const { url, userId, opinion, rating, _source } = body;
    _inbox_id = body._inbox_id;

    if (!url || typeof url !== 'string' || url.length > 2048) {
      return new Response(
        JSON.stringify({ error: 'URL is required and must be under 2048 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Detect URL type with enhanced detection
    const detection = detectURLType(url);
    console.log('URL Detection:', JSON.stringify(detection));

    if (detection.type === 'invalid_url') {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Check if we already have this URL in the system
    const { data: existingBusiness } = await supabase
      .from('businesses')
      .select('id, business_name, business_type')
      .eq('website', url)
      .maybeSingle();

    const { data: existingSource } = await supabase
      .from('scrape_sources')
      .select('id, name, source_type')
      .eq('url', url)
      .maybeSingle();

    const { data: existingLead } = await supabase
      .from('discovery_leads')
      .select('id, status')
      .eq('lead_url', url)
      .maybeSingle();

    // 3. Process based on URL type
    let entityData: any = {};
    let entityType: string = detection.type;
    let entityId: string | null = null;
    let message = '';
    let action = '';

    // Handle known handlers
    switch (detection.handler) {
      case 'n-zero':
        if (detection.type === 'n-zero_org') {
          ({ entityData, entityId } = await processNZeroOrgURL(url, supabase));
          entityType = 'organization';
          action = 'linked';
        } else if (detection.type === 'n-zero_vehicle') {
          ({ entityData, entityId } = await processNZeroVehicleURL(url, supabase));
          entityType = 'vehicle';
          action = 'linked';
        }
        break;

      case 'bat':
        try {
          ({ entityData, entityId } = await processBaTListingURL(url, supabase));
          entityType = 'vehicle';
          action = 'extracted';
        } catch (batErr: any) {
          console.warn(`BaT extraction failed (${batErr.message}), creating discovery lead`);
          const leadId = await createDiscoveryLead(supabase, {
            url,
            type: 'bat_listing',
            suggestedType: 'vehicle_listing',
            confidence: 0.95,
            userId,
            metadata: { error: batErr.message, handler: 'bat', fallback: true },
          });
          entityType = 'discovery_lead';
          entityId = leadId;
          entityData = { url, error: batErr.message };
          action = 'queued';
          message = `BaT listing detected but extraction failed (${batErr.message.includes('RATE_LIMITED') ? 'rate limited' : 'error'}). Queued for retry.`;
        }
        break;

      case 'barnfinds':
        ({ entityData, entityId } = await processBarnFindsListingURL(url, supabase));
        entityType = 'vehicle';
        action = 'extracted';
        break;

      case 'instagram':
        ({ entityData, entityId } = await processInstagramURL(url, supabase));
        entityType = 'social_reference';
        action = 'queued';
        break;

      case 'youtube':
        // Queue for YouTube extraction
        await createDiscoveryLead(supabase, {
          url,
          type: 'youtube_channel',
          suggestedType: 'youtube_channel',
          confidence: detection.confidence,
          userId,
        });
        action = 'queued_youtube';
        message = 'YouTube URL queued for extraction';
        break;

      case 'facebook':
        ({ entityData, entityId, action, message, entityType } = await processFacebookURL(url, supabase, userId));
        break;

      case 'victorylap':
        if (detection.type === 'vehicle_listing') {
          ({ entityData, entityId } = await processVictoryLapListingURL(url, supabase));
          entityType = 'vehicle';
          action = entityId ? 'extracted' : 'discovered';
          message = entityId ? 'Victory Lap listing extracted and linked to vehicle.' : 'Victory Lap listing queued.';
        }
        break;

      default:
        // For all other URLs, use pattern-based analysis + discovery
        if (existingBusiness) {
          // Already known business
          entityType = existingBusiness.business_type || 'business';
          entityId = existingBusiness.id;
          entityData = existingBusiness;
          action = 'existing';
          message = `This is ${existingBusiness.business_name}, already in our system`;
        } else if (existingSource) {
          // Already a scrape source
          entityType = existingSource.source_type || 'source';
          entityId = existingSource.id;
          entityData = existingSource;
          action = 'existing_source';
          message = `This source (${existingSource.name}) is already being tracked`;
        } else if (existingLead && existingLead.status === 'pending') {
          // Already queued as discovery lead
          action = 'already_queued';
          message = 'This URL is already queued for discovery processing';
          entityId = existingLead.id;
        } else {
          // NEW URL - analyze and create discovery lead
          const analysis = await analyzeURLWithPatterns(url, detection);

          // Create discovery lead for snowball processing
          const leadId = await createDiscoveryLead(supabase, {
            url,
            type: detection.type,
            suggestedType: detection.business_type || analysis.suggestedType,
            confidence: detection.confidence,
            userId,
            metadata: analysis,
          });

          entityId = leadId;
          entityType = 'discovery_lead';
          entityData = { ...analysis, detection };
          action = 'discovered';
          message = `New ${detection.business_type || detection.type} discovered! Queued for processing.`;

          // If it's a known business type, also create a business record
          if (detection.business_type && detection.confidence >= 0.8) {
            const hostname = new URL(url).hostname.replace(/^www\./, '');
            const businessName = analysis.name || hostname;

            const { data: newBusiness, error: bizErr } = await supabase
              .from('businesses')
              .insert({
                business_name: businessName,
                business_type: detection.business_type,
                website: url.split('?')[0], // Remove query params
                status: 'pending_verification',
                discovered_by: userId || 'url_drop',
                discovered_via: 'url_drop',
              })
              .select('id')
              .maybeSingle();

            if (!bizErr && newBusiness) {
              entityId = newBusiness.id;
              entityType = 'business';
              message = `New ${detection.business_type}: ${businessName} created!`;
            }
          }
        }
    }

    // 4. Handle user contribution tracking (if userId provided)
    let contributorRank = 1;
    let isOriginalDiscoverer = true;
    let pointsAwarded = 0;

    if (userId && entityId) {
      // Calculate contributor rank
      const { count: existingContributors } = await supabase
        .from('entity_opinions')
        .select('*', { count: 'exact', head: true })
        .eq('entity_type', entityType)
        .eq('entity_id', entityId);

      contributorRank = (existingContributors || 0) + 1;
      isOriginalDiscoverer = contributorRank === 1;

      // Create opinion/contribution record
      const { error: opinionErr } = await supabase
        .from('entity_opinions')
        .insert({
          entity_type: entityType,
          entity_id: entityId,
          user_id: userId,
          opinion_text: opinion,
          rating: rating,
          contributor_rank: contributorRank,
          is_original_discoverer: isOriginalDiscoverer,
          source_url: url,
          data_contributed: entityData,
          contribution_score: isOriginalDiscoverer ? 100 : 50
        });
      if (opinionErr && !opinionErr.message?.includes('23505')) {
        console.error('Opinion error:', opinionErr);
      }

      // Award points
      pointsAwarded = isOriginalDiscoverer ? 100 : 50;
      await supabase.rpc('award_points', {
        p_user_id: userId,
        p_category: isOriginalDiscoverer ? 'discovery' : 'data_fill',
        p_points: pointsAwarded,
        p_reason: `Contributed ${entityType} via URL drop`
      }); // Non-critical, errors ignored by supabase client
    }

    const responsePayload = {
      success: true,
      action,
      entityType,
      entityId,
      detection,
      contributorRank: userId ? contributorRank : null,
      isOriginalDiscoverer: userId ? isOriginalDiscoverer : null,
      pointsAwarded: userId ? pointsAwarded : null,
      message: message || (isOriginalDiscoverer
        ? `Discovered new ${entityType}! ${pointsAwarded ? `+${pointsAwarded} points` : ''}`
        : `Contributed to ${entityType} ${pointsAwarded ? `+${pointsAwarded} points` : ''}`)
    };

    // Write result back to url_inbox if triggered from there
    if (_inbox_id) {
      await supabase
        .from('url_inbox')
        .update({
          status: 'completed',
          result: responsePayload,
          processed_at: new Date().toISOString(),
        })
        .eq('id', _inbox_id);
    }

    return new Response(
      JSON.stringify(responsePayload),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Process URL drop error:', errorMessage);

    // Write error back to url_inbox if triggered from there
    if (_inbox_id) {
      const sb = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await sb
        .from('url_inbox')
        .update({
          status: 'failed',
          error_message: errorMessage,
          processed_at: new Date().toISOString(),
        })
        .eq('id', _inbox_id);
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================
// DISCOVERY LEAD CREATION
// ============================================

// Map detected types to valid discovery_leads.lead_type values
// Allowed: organization, website, social_profile, youtube_channel, vehicle_listing, collection, event, person, article
function mapToLeadType(detectedType: string): string {
  const typeMap: Record<string, string> = {
    'event': 'event',
    'auction_house': 'organization',
    'auction_listing': 'vehicle_listing',
    'bat_listing': 'vehicle_listing',
    'vehicle_listing': 'vehicle_listing',
    'dealer': 'organization',
    'builder': 'organization',
    'instagram': 'social_profile',
    'youtube': 'youtube_channel',
    'social_media': 'social_profile',
    'facebook': 'social_profile',
    'facebook_marketplace': 'vehicle_listing',
    'facebook_marketplace_seller': 'person',
    'facebook_marketplace_search': 'website',
    'facebook_group': 'organization',
    'facebook_profile': 'social_profile',
    'facebook_unknown': 'social_profile',
    'classified_listing': 'vehicle_listing',
    'ebay_listing': 'vehicle_listing',
    'dealer_directory': 'website',
    'n-zero_org': 'organization',
    'n-zero_vehicle': 'vehicle_listing',
    'motorsport_event': 'event',
    'concours': 'event',
  };
  return typeMap[detectedType] || 'website';
}

async function createDiscoveryLead(
  supabase: any,
  params: {
    url: string;
    type: string;
    suggestedType: string | null;
    confidence: number;
    userId?: string;
    metadata?: any;
  }
): Promise<string | null> {
  const leadType = mapToLeadType(params.type);

  const { data, error } = await supabase
    .from('discovery_leads')
    .insert({
      discovered_from_type: 'manual', // User-submitted URL drop
      discovered_from_id: null,
      lead_type: leadType,
      lead_url: params.url,
      lead_name: params.metadata?.name || new URL(params.url).hostname,
      suggested_business_type: params.suggestedType,
      confidence_score: params.confidence,
      status: 'pending',
      raw_data: {
        ...params.metadata,
        original_detected_type: params.type,
        submitted_by: params.userId || 'anonymous',
        submitted_at: new Date().toISOString(),
      },
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Error creating discovery lead:', error);
    return null;
  }

  return data?.id || null;
}

// ============================================
// PATTERN-BASED URL ANALYSIS (No LLM cost)
// ============================================

async function analyzeURLWithPatterns(url: string, detection: URLDetectionResult): Promise<any> {
  try {
    // Fetch the page with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0; +https://n-zero.dev)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { error: 'fetch_failed', status: response.status };
    }

    const html = await response.text();
    const result: any = {
      fetched: true,
      content_length: html.length,
    };

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    result.title = titleMatch?.[1]?.trim() || null;

    // Extract meta description
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    result.description = descMatch?.[1]?.trim() || null;

    // Try to extract business name from title or heading
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    result.name = h1Match?.[1]?.trim() || result.title?.split(/[-|–]/)[0]?.trim() || null;

    // Extract contact info patterns
    const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    result.email = emailMatch?.[0] || null;

    const phoneMatch = html.match(/\+?[\d\s\-().]{10,}/);
    result.phone = phoneMatch?.[0]?.trim() || null;

    // Detect social links
    result.social = {
      instagram: html.includes('instagram.com/'),
      facebook: html.includes('facebook.com/'),
      youtube: html.includes('youtube.com/'),
      twitter: html.includes('twitter.com/') || html.includes('x.com/'),
    };

    // Content-based type detection
    const contentLower = html.toLowerCase();

    if (contentLower.includes('auction') || contentLower.includes('bidding') || contentLower.includes('lot ')) {
      result.suggestedType = result.suggestedType || 'auction_house';
    }
    if (contentLower.includes('rally') || contentLower.includes('race') || contentLower.includes('motorsport')) {
      result.suggestedType = result.suggestedType || 'motorsport_event';
    }
    if (contentLower.includes('dealer') || contentLower.includes('inventory') || contentLower.includes('for sale')) {
      result.suggestedType = result.suggestedType || 'dealer';
    }
    if (contentLower.includes('restoration') || contentLower.includes('custom build') || contentLower.includes('fabrication')) {
      result.suggestedType = result.suggestedType || 'builder';
    }
    if (contentLower.includes('concours') || contentLower.includes('show') || contentLower.includes('exhibition')) {
      result.suggestedType = result.suggestedType || 'concours';
    }

    // Use detection's business_type as fallback
    result.suggestedType = result.suggestedType || detection.business_type;

    return result;

  } catch (err) {
    return {
      error: 'analysis_failed',
      message: err instanceof Error ? err.message : 'Unknown error',
      suggestedType: detection.business_type,
    };
  }
}

// ============================================
// URL TYPE DETECTION (Enhanced)
// ============================================

interface URLDetectionResult {
  type: string;
  platform: string | null;
  business_type: string | null;
  handler: string | null;
  confidence: number;
}

function detectURLType(url: string): URLDetectionResult {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();

    // Check N-Zero internal URLs first
    if (hostname.includes('n-zero.dev')) {
      if (url.includes('/org/')) return { type: 'n-zero_org', platform: 'n-zero', business_type: null, handler: 'n-zero', confidence: 1.0 };
      if (url.includes('/vehicle/')) return { type: 'n-zero_vehicle', platform: 'n-zero', business_type: null, handler: 'n-zero', confidence: 1.0 };
      return { type: 'n-zero_internal', platform: 'n-zero', business_type: null, handler: 'n-zero', confidence: 0.9 };
    }

    // Check known platforms
    for (const [domain, info] of Object.entries(KNOWN_PLATFORMS)) {
      if (hostname.includes(domain)) {
        // Facebook sub-type detection for higher confidence
        let confidence = 0.95;
        let type = info.type;
        if (info.handler === 'facebook') {
          const pathLower = parsed.pathname.toLowerCase();
          if (pathLower.includes('/marketplace/item/')) {
            type = 'facebook_marketplace';
            confidence = 1.0;
          } else if (pathLower.includes('/marketplace/profile/')) {
            type = 'facebook_marketplace_seller';
            confidence = 0.9;
          } else if (pathLower.includes('/marketplace')) {
            type = 'facebook_marketplace_search';
            confidence = 0.85;
          }
        }
        if (info.handler === 'victorylap') {
          const pathLower = parsed.pathname.toLowerCase();
          if (pathLower.includes('/product-page/')) {
            type = 'vehicle_listing';
            confidence = 1.0;
          } else if (pathLower.includes('/inventory') || pathLower.includes('/portfolio')) {
            type = 'dealer';
            confidence = 0.9;
          }
        }
        return {
          type,
          platform: domain,
          business_type: info.business_type || null,
          handler: info.handler || null,
          confidence,
        };
      }
    }

    // Pattern-based detection for unknown URLs
    const pathLower = parsed.pathname.toLowerCase();

    // Vehicle listing patterns
    if (pathLower.match(/\/listing|\/vehicle|\/car|\/lot|\/inventory/i)) {
      return { type: 'vehicle_listing', platform: hostname, business_type: 'dealer', handler: null, confidence: 0.7 };
    }

    // Auction patterns
    if (pathLower.match(/\/auction|\/bid|\/lot\d/i)) {
      return { type: 'auction_listing', platform: hostname, business_type: 'auction_house', handler: null, confidence: 0.7 };
    }

    // Event patterns
    if (pathLower.match(/\/event|\/race|\/rally|\/show|\/concours/i)) {
      return { type: 'event', platform: hostname, business_type: 'motorsport_event', handler: null, confidence: 0.6 };
    }

    // Default: unknown - will create discovery lead
    return { type: 'unknown', platform: hostname, business_type: null, handler: null, confidence: 0.3 };

  } catch {
    return { type: 'invalid_url', platform: null, business_type: null, handler: null, confidence: 0 };
  }
}

// ============================================
// FACEBOOK URL PROCESSOR
// ============================================

/**
 * Classifies Facebook URL into sub-type and routes to the right handler.
 *
 * Supported URL shapes:
 *   /marketplace/item/<id>        → extract-facebook-marketplace
 *   /marketplace/profile/<id>     → seller profile lead
 *   /share/p/<id>  /share/r/<id>  → resolve redirect, then re-classify
 *   /groups/<id>                  → group lead
 *   /l.php?u=<encoded>           → unwrap tracking redirect
 *   /profile.php?id=<id>         → user profile lead
 *   /<username>                   → user/page profile lead
 */
async function processFacebookURL(
  url: string,
  supabase: any,
  userId?: string,
): Promise<{ entityData: any; entityId: string | null; action: string; message: string; entityType: string }> {
  // Resolve Facebook tracking redirects (l.facebook.com/l.php?u=...)
  let resolvedUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'l.facebook.com' && parsed.searchParams.has('u')) {
      resolvedUrl = decodeURIComponent(parsed.searchParams.get('u')!);
      console.log('Unwrapped FB tracking redirect:', resolvedUrl);
      // If the unwrapped URL isn't facebook at all, re-detect and bail
      if (!resolvedUrl.includes('facebook.com') && !resolvedUrl.includes('fb.com')) {
        // It's an external link shared on FB - process as generic URL
        return {
          entityData: { original_fb_url: url, resolved_url: resolvedUrl },
          entityId: null,
          action: 'redirected',
          message: `Facebook tracking link resolved to external URL: ${resolvedUrl}`,
          entityType: 'discovery_lead',
        };
      }
    }
  } catch { /* keep original url */ }

  // Resolve Facebook share links (/share/...) via local relay server
  const shareMatch = resolvedUrl.match(/facebook\.com\/share\/(?:[pr]\/)?([A-Za-z0-9_-]+)/);
  if (shareMatch) {
    console.log('Resolving FB share link via relay:', resolvedUrl);
    const resolved = await fbRelay('resolve', resolvedUrl);
    if (resolved?.success && resolved.resolved_url && !resolved.is_login) {
      console.log('Share link resolved to:', resolved.resolved_url);
      resolvedUrl = resolved.resolved_url;
    } else if (resolved?.og_url && !resolved.og_url.includes('/login')) {
      console.log('Share link resolved via og:url to:', resolved.og_url);
      resolvedUrl = resolved.og_url;
    } else {
      console.warn('FB relay unavailable or returned login, share link unresolved');
    }
  }

  const path = new URL(resolvedUrl).pathname.toLowerCase();

  // ── Marketplace item ──────────────────────────────────────────────
  const marketplaceItemMatch = resolvedUrl.match(/marketplace\/item\/(\d+)/);
  if (marketplaceItemMatch) {
    const itemId = marketplaceItemMatch[1];
    const canonicalUrl = `https://www.facebook.com/marketplace/item/${itemId}/`;
    console.log('Facebook Marketplace item detected:', itemId);

    // Check if already exists
    const { data: existingListing } = await supabase
      .from('marketplace_listings')
      .select('id, vehicle_id')
      .eq('facebook_id', itemId)
      .maybeSingle();

    if (existingListing) {
      await supabase.from('marketplace_listings')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', existingListing.id);

      // Record the user submission as a sighting (triggers submission_count increment)
      const { error: sightErr } = await supabase.from('fb_listing_sightings').insert({
        listing_id: existingListing.id,
        source: 'user_submission',
        submitted_by: userId || 'anonymous',
      });
      if (sightErr) console.warn('Sighting insert error:', sightErr.message);

      // Fetch updated count
      const { data: updated } = await supabase
        .from('marketplace_listings')
        .select('submission_count')
        .eq('id', existingListing.id)
        .maybeSingle();

      return {
        entityData: { ...existingListing, submission_count: updated?.submission_count },
        entityId: existingListing.id,
        action: 'existing',
        message: `FB Marketplace listing already tracked (shared ${updated?.submission_count || 1}x)`,
        entityType: 'marketplace_listing',
      };
    }

    // Scrape via local relay server (Facebook blocks datacenter IPs)
    try {
      const scrapeData = await fbRelay('scrape', canonicalUrl);
      if (!scrapeData?.success || scrapeData?.is_login) {
        throw new Error(scrapeData?.error || 'FB relay returned login page or unavailable');
      }

      const fullTitle = scrapeData.og_title || scrapeData.title_tag || '';
      const ogDesc = scrapeData.og_description || '';
      const ogImage = scrapeData.og_image || null;
      const price = scrapeData.price || null;

      // Parse year/make/model from title
      const yearMatch = fullTitle.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      let make: string | null = null;
      let model: string | null = null;
      if (year) {
        const afterYear = fullTitle.split(String(year))[1]?.trim() || '';
        const words = afterYear.split(/\s+/).filter((w: string) => w.length > 0);
        if (words.length > 0) make = words[0];
        if (words.length > 1) model = words.slice(1, 3).join(' ');
      }

      // Extract location
      const locMatch = (ogDesc + ' ' + fullTitle).match(/([A-Za-z\s]+),\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i);
      const location = [locMatch?.[1]?.trim(), locMatch?.[2]].filter(Boolean).join(', ') || null;

      // Insert listing
      const { data: inserted, error: insertErr } = await supabase
        .from('marketplace_listings')
        .insert({
          facebook_id: itemId,
          platform: 'facebook_marketplace',
          url: canonicalUrl,
          title: fullTitle || null,
          price,
          description: ogDesc || null,
          location,
          parsed_year: year,
          parsed_make: make,
          parsed_model: model,
          image_url: ogImage,
          all_images: ogImage ? [ogImage] : [],
        })
        .select('id')
        .maybeSingle();

      if (insertErr) {
        console.error('FB listing insert error:', insertErr);
        throw insertErr;
      }

      const listingId = inserted?.id || null;
      console.log('FB Marketplace listing created:', listingId, fullTitle);

      // Auto-match to existing vehicle
      let vehicleId: string | null = null;
      let matchType: string | null = null;
      if (listingId) {
        const match = await matchListingToVehicle(supabase, listingId, { year, make, model, vin: null });
        vehicleId = match.vehicleId;
        matchType = match.matchType;
      }

      // Record initial sighting
      if (listingId) {
        await supabase.from('fb_listing_sightings').insert({
          listing_id: listingId,
          source: 'user_submission',
          submitted_by: userId || 'anonymous',
          price_at_sighting: price,
        });
      }

      const matchMsg = vehicleId ? ` Matched to vehicle!` : matchType === 'suggested' ? ` Possible vehicle match saved.` : '';
      return {
        entityData: { listing_id: listingId, year, make, model, price, vehicle_id: vehicleId },
        entityId: listingId,
        action: 'extracted',
        message: `FB Marketplace listing extracted! ${year || ''} ${make || ''} ${model || ''} - $${price || '?'}${matchMsg}`,
        entityType: 'marketplace_listing',
      };
    } catch (err) {
      console.error('FB Marketplace bot scrape failed:', err);
      // Fallback: create discovery lead
      const leadId = await createDiscoveryLead(supabase, {
        url: canonicalUrl,
        type: 'facebook_marketplace',
        suggestedType: 'vehicle_listing',
        confidence: 0.9,
        userId,
        metadata: { item_id: itemId, error: err.message, share_url: url !== resolvedUrl ? url : undefined },
      });
      return {
        entityData: { item_id: itemId, error: err.message },
        entityId: leadId,
        action: 'extraction_failed',
        message: `FB Marketplace listing detected but extraction failed. Queued for retry.`,
        entityType: 'discovery_lead',
      };
    }
  }

  // ── Marketplace seller profile ────────────────────────────────────
  if (path.includes('/marketplace/profile/')) {
    const profileId = path.match(/\/marketplace\/profile\/(\d+)/)?.[1];
    const leadId = await createDiscoveryLead(supabase, {
      url: resolvedUrl,
      type: 'facebook_marketplace_seller',
      suggestedType: 'person',
      confidence: 0.85,
      userId,
      metadata: { fb_profile_id: profileId, sub_type: 'marketplace_seller' },
    });
    return {
      entityData: { fb_profile_id: profileId, type: 'marketplace_seller' },
      entityId: leadId,
      action: 'discovered',
      message: `FB Marketplace seller profile queued for processing`,
      entityType: 'social_profile',
    };
  }

  // ── Marketplace search/category (not a single listing) ───────────
  if (path.includes('/marketplace')) {
    const leadId = await createDiscoveryLead(supabase, {
      url: resolvedUrl,
      type: 'facebook_marketplace_search',
      suggestedType: 'website',
      confidence: 0.7,
      userId,
      metadata: { sub_type: 'marketplace_search' },
    });
    return {
      entityData: { type: 'marketplace_search' },
      entityId: leadId,
      action: 'discovered',
      message: `FB Marketplace search/category page queued`,
      entityType: 'discovery_lead',
    };
  }

  // ── Facebook Group ────────────────────────────────────────────────
  if (path.includes('/groups/')) {
    const groupId = path.match(/\/groups\/([^/]+)/)?.[1];
    const leadId = await createDiscoveryLead(supabase, {
      url: resolvedUrl,
      type: 'facebook_group',
      suggestedType: 'organization',
      confidence: 0.8,
      userId,
      metadata: { fb_group_id: groupId, sub_type: 'group' },
    });
    return {
      entityData: { fb_group_id: groupId, type: 'group' },
      entityId: leadId,
      action: 'discovered',
      message: `Facebook group queued for discovery`,
      entityType: 'social_profile',
    };
  }

  // ── User/Page profile (catchall for /username or /profile.php?id=) ─
  const profilePhpMatch = resolvedUrl.match(/profile\.php\?id=(\d+)/);
  const username = path.replace(/^\//, '').split('/')[0];
  const fbIdentifier = profilePhpMatch?.[1] || (username && username.length > 0 ? username : null);

  if (fbIdentifier) {
    const leadId = await createDiscoveryLead(supabase, {
      url: resolvedUrl,
      type: 'facebook_profile',
      suggestedType: 'social_profile',
      confidence: 0.75,
      userId,
      metadata: { fb_identifier: fbIdentifier, sub_type: profilePhpMatch ? 'profile_by_id' : 'profile_by_username' },
    });
    return {
      entityData: { fb_identifier: fbIdentifier, type: 'profile' },
      entityId: leadId,
      action: 'discovered',
      message: `Facebook profile (${fbIdentifier}) queued for discovery`,
      entityType: 'social_profile',
    };
  }

  // ── Fallback: generic Facebook URL ────────────────────────────────
  const leadId = await createDiscoveryLead(supabase, {
    url: resolvedUrl,
    type: 'facebook_unknown',
    suggestedType: 'social_profile',
    confidence: 0.5,
    userId,
  });
  return {
    entityData: { type: 'facebook_generic' },
    entityId: leadId,
    action: 'discovered',
    message: `Facebook URL queued for manual review`,
    entityType: 'social_profile',
  };
}

// ============================================
// VEHICLE MATCHING
// ============================================

const BLOCKED_MAKES = new Set([
  'harley-davidson', 'harley', 'indian', 'ducati', 'kawasaki', 'suzuki',
  'yamaha', 'ktm', 'triumph', 'aprilia', 'husqvarna', 'moto guzzi',
  'can-am', 'polaris', 'arctic cat', 'sea-doo', 'ski-doo',
  'fleetwood', 'winnebago', 'coachmen', 'jayco', 'thor', 'tiffin',
  'newmar', 'holiday rambler', 'airstream', 'forest river',
  'utility', 'wabash', 'great dane', 'hyundai translead', 'stoughton',
  'mack', 'kenworth', 'peterbilt', 'freightliner', 'western star',
  'john deere', 'caterpillar', 'case', 'kubota', 'bobcat',
]);

const BLOCKED_MODEL_PATTERNS = [
  /\bsoftail\b/i, /\bsportster\b/i, /\bdyna\b/i, /\btouring\b/i,
  /\bsouthwind\b/i, /\bbounder\b/i, /\bmotorhome\b/i, /\bcamper\b/i,
  /\btrailer\b/i, /\batv\b/i, /\bquad\b/i, /\bdirt\s*bike\b/i,
  /\bscooter\b/i, /\bjet\s*ski\b/i, /\bsnowmobile\b/i, /\bboat\b/i,
  /\bpwc\b/i, /\bside.by.side\b/i, /\butv\b/i, /\brv\b/i,
];

function isBlockedVehicle(make: string | null, model: string | null): boolean {
  if (make && BLOCKED_MAKES.has(make.toLowerCase().trim())) return true;
  const text = `${make || ''} ${model || ''}`.toLowerCase();
  return BLOCKED_MODEL_PATTERNS.some(p => p.test(text));
}

async function matchListingToVehicle(
  supabase: any,
  listingId: string,
  parsed: { year: number | null; make: string | null; model: string | null; vin: string | null },
): Promise<{ vehicleId: string | null; matchType: string | null }> {
  try {
    // Skip blocked vehicle types
    if (isBlockedVehicle(parsed.make, parsed.model)) {
      return { vehicleId: null, matchType: 'blocked' };
    }

    // 1. VIN match (highest confidence)
    if (parsed.vin && parsed.vin.length >= 11) {
      const { data: vinMatch } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', parsed.vin)
        .maybeSingle();

      if (vinMatch) {
        await supabase.from('marketplace_listings')
          .update({ vehicle_id: vinMatch.id })
          .eq('id', listingId);
        console.log(`VIN match: listing ${listingId} → vehicle ${vinMatch.id}`);
        return { vehicleId: vinMatch.id, matchType: 'vin' };
      }
    }

    // 2. Year + Make + Model match
    if (parsed.year && parsed.make) {
      const query = supabase
        .from('vehicles')
        .select('id')
        .eq('year', parsed.year)
        .ilike('make', parsed.make)
        .limit(2);

      if (parsed.model) {
        // Use first word of model for matching to avoid over-specificity
        const modelFirst = parsed.model.split(/\s+/)[0];
        query.ilike('model', `${modelFirst}%`);
      }

      const { data: ymmMatches } = await query;

      if (ymmMatches?.length === 1) {
        // Exactly one match → auto-link
        await supabase.from('marketplace_listings')
          .update({ vehicle_id: ymmMatches[0].id })
          .eq('id', listingId);
        console.log(`YMM match: listing ${listingId} → vehicle ${ymmMatches[0].id}`);
        return { vehicleId: ymmMatches[0].id, matchType: 'ymm' };
      } else if (ymmMatches && ymmMatches.length > 1) {
        // Multiple matches → suggest but don't auto-link
        await supabase.from('marketplace_listings')
          .update({ suggested_vehicle_id: ymmMatches[0].id })
          .eq('id', listingId);
        console.log(`YMM ambiguous: listing ${listingId}, ${ymmMatches.length} candidates`);
        return { vehicleId: null, matchType: 'suggested' };
      }
    }

    return { vehicleId: null, matchType: null };
  } catch (err) {
    console.warn('Vehicle matching error:', err);
    return { vehicleId: null, matchType: null };
  }
}

// ============================================
// N-ZERO URL PROCESSORS
// ============================================

async function processNZeroOrgURL(url: string, supabase: any) {
  // Extract org ID from URL
  const orgId = url.split('/org/')[1]?.split('?')[0];
  
  if (!orgId) {
    throw new Error('Invalid n-zero org URL');
  }

  // Fetch existing org data
  const { data: org, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .maybeSingle();

  if (error) throw error;
  if (!org) throw new Error(`Organization ${orgId} not found`);

  return {
    entityData: org,
    entityId: orgId
  };
}

async function processNZeroVehicleURL(url: string, supabase: any) {
  // Extract vehicle ID from URL
  const vehicleId = url.split('/vehicle/')[1]?.split('?')[0];
  
  if (!vehicleId) {
    throw new Error('Invalid n-zero vehicle URL');
  }

  // Fetch existing vehicle data
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .maybeSingle();

  if (error) throw error;
  if (!vehicle) throw new Error(`Vehicle ${vehicleId} not found`);

  return {
    entityData: vehicle,
    entityId: vehicleId
  };
}

// ============================================
// BARN FINDS LISTING PROCESSOR
// ============================================

async function processBarnFindsListingURL(url: string, supabase: any) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  const listingUrlKey = (u.hostname.replace(/^www\./i, '') + (u.pathname || '').replace(/\/+$/, '')).toLowerCase();
  const { data: existingEl } = await supabase
    .from('external_listings')
    .select('vehicle_id')
    .eq('platform', 'barnfinds')
    .eq('listing_url_key', listingUrlKey)
    .maybeSingle();
  if (existingEl?.vehicle_id) {
    return { entityData: { listing_url: url }, entityId: existingEl.vehicle_id };
  }

  const { data: invokeData, error: invokeErr } = await supabase.functions.invoke('extract-barn-finds-listing', {
    body: { url }
  });

  if (invokeErr) {
    throw new Error(invokeErr.message || 'Barn Finds extraction failed');
  }
  const ok = invokeData?.success === true && invokeData?.vehicle_id;
  if (!ok) {
    throw new Error(invokeData?.error || 'Barn Finds extraction did not return a vehicle');
  }

  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', invokeData.vehicle_id)
    .maybeSingle();

  return {
    entityData: vehicle ?? { listing_url: url },
    entityId: invokeData.vehicle_id
  };
}

// ============================================
// BAT LISTING PROCESSOR
// ============================================

async function processBaTListingURL(url: string, supabase: any) {
  // Check if vehicle already exists for this URL
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .or(`listing_url.eq."${escapePostgrestValue(url)}",discovery_url.eq."${escapePostgrestValue(url)}",bat_auction_url.eq."${escapePostgrestValue(url)}"`)

    .maybeSingle();

  if (existing) {
    return {
      entityData: { listing_url: url },
      entityId: existing.id
    };
  }

  // ✅ Approved BaT workflow (do NOT use deprecated import-bat-listing/comprehensive-bat-extraction)
  const { data: coreData, error: coreErr } = await supabase.functions.invoke('extract-bat-core', {
    body: { url, max_vehicles: 1 }
  });

  if (coreErr || !coreData?.success) {
    throw new Error(coreErr?.message || coreData?.error || 'Failed to extract BaT listing');
  }

  const vehicleId =
    coreData?.created_vehicle_ids?.[0] ||
    coreData?.updated_vehicle_ids?.[0] ||
    coreData?.vehicle_id ||
    null;

  if (!vehicleId) {
    throw new Error('BaT extraction succeeded but no vehicle_id returned');
  }

  // Best-effort comments/bids (non-critical)
  try {
    await supabase.functions.invoke('extract-auction-comments', {
      body: { auction_url: url, vehicle_id: vehicleId }
    });
  } catch {
    // ignore
  }

  // Return the freshly created/updated vehicle row (best-effort)
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .maybeSingle();

  return {
    entityData: vehicle || { listing_url: url },
    entityId: vehicleId
  };
}

// ============================================
// VICTORY LAP CLASSICS PROCESSOR
// ============================================

async function processVictoryLapListingURL(url: string, supabase: any) {
  const { data: coreData, error: coreErr } = await supabase.functions.invoke('extract-victorylap-listing', {
    body: { url }
  });

  if (coreErr) {
    console.error('Victory Lap extract error:', coreErr);
    throw new Error(coreErr.message || 'Failed to extract Victory Lap listing');
  }

  const vehicleId = coreData?.vehicle_id ?? coreData?.created_vehicle_ids?.[0] ?? null;

  if (!vehicleId) {
    return { entityData: { url, ...coreData }, entityId: null };
  }

  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .maybeSingle();

  return {
    entityData: vehicle || { url, vehicle_id: vehicleId },
    entityId: vehicleId
  };
}

// ============================================
// INSTAGRAM PROCESSOR
// ============================================

async function processInstagramURL(url: string, supabase: any) {
  // For now, just extract the post ID and store as reference
  // Future: Use OpenAI Vision to analyze the post
  
  const postId = url.match(/\/p\/([A-Za-z0-9_-]+)/)?.[1];

  return {
    entityData: {
      instagram_url: url,
      instagram_post_id: postId,
      type: 'social_media_reference'
    },
    entityId: null // No entity created yet
  };
}

// ============================================
// GENERIC URL PROCESSOR (Fallback - uses pattern analysis)
// ============================================

async function processGenericURL(url: string, supabase: any) {
  // Use pattern-based analysis instead of OpenAI to save costs
  const detection = detectURLType(url);
  const analysis = await analyzeURLWithPatterns(url, detection);

  // If analysis suggests it's a vehicle listing with enough confidence
  if (analysis.suggestedType === 'dealer' && analysis.title) {
    // Try to extract vehicle info from title
    const titleMatch = analysis.title.match(/(\d{4})\s+(\w+)\s+(.+)/);
    if (titleMatch) {
      const [, year, make, model] = titleMatch;
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .insert({
          year: parseInt(year, 10),
          make,
          model: model.split(/[-|]/)[0].trim(),
          vin: `VIVA-${Date.now()}`,
          listing_url: url,
          discovery_source: 'url_drop'
        })
        .select()
        .single();

      if (!error && vehicle) {
        return {
          entityData: vehicle,
          entityId: vehicle.id
        };
      }
    }
  }

  // Otherwise, create as discovery lead for later processing
  const leadId = await createDiscoveryLead(supabase, {
    url,
    type: detection.type,
    suggestedType: analysis.suggestedType,
    confidence: detection.confidence,
    metadata: analysis,
  });

  return {
    entityData: { ...analysis, type: 'discovery_lead' },
    entityId: leadId
  };
}

