import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Process URL Drop - Universal URL Handler (v2)
 *
 * Handles ANY URL a user drops into the system:
 * - Known platforms (BaT, Cars & Bids, Instagram, YouTube)
 * - Auction houses (Mecum, RM Sotheby's, Gooding, etc.)
 * - Events/Rallies (1000 Miglia, Dakar, Pebble Beach)
 * - Dealers, Builders, Collections
 * - Generic vehicle listings
 *
 * Creates discovery leads for the snowball system to process.
 */

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

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
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
        ({ entityData, entityId } = await processBaTListingURL(url, supabase));
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
      await supabase
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
        })
        .then(() => {})
        .catch((err: Error) => {
          if (!err.message?.includes('23505')) console.error('Opinion error:', err);
        });

      // Award points
      pointsAwarded = isOriginalDiscoverer ? 100 : 50;
      await supabase.rpc('award_points', {
        p_user_id: userId,
        p_category: isOriginalDiscoverer ? 'discovery' : 'data_fill',
        p_points: pointsAwarded,
        p_reason: `Contributed ${entityType} via URL drop`
      }).catch(() => {}); // Non-critical
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

  } catch (error) {
    console.error('Process URL drop error:', error);

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
          error_message: error.message,
          processed_at: new Date().toISOString(),
        })
        .eq('id', _inbox_id)
        .catch(() => {});
    }

    return new Response(
      JSON.stringify({ error: error.message }),
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

  // Resolve Facebook share links (/share/p/..., /share/r/...)
  const shareMatch = resolvedUrl.match(/facebook\.com\/share\/[pr]\/([A-Za-z0-9_-]+)/);
  if (shareMatch) {
    console.log('Resolving FB share link:', resolvedUrl);
    try {
      const resp = await fetch(resolvedUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0; +https://n-zero.dev)' },
        signal: AbortSignal.timeout(8000),
      });
      const finalUrl = resp.url;
      if (finalUrl && finalUrl !== resolvedUrl) {
        console.log('Share link resolved to:', finalUrl);
        resolvedUrl = finalUrl;
      }
    } catch (e) {
      console.warn('Failed to resolve share link, continuing with original:', e);
    }
  }

  const path = new URL(resolvedUrl).pathname.toLowerCase();

  // ── Marketplace item ──────────────────────────────────────────────
  const marketplaceItemMatch = resolvedUrl.match(/marketplace\/item\/(\d+)/);
  if (marketplaceItemMatch) {
    console.log('Facebook Marketplace item detected, calling extract-facebook-marketplace');
    try {
      const { data: extractResult, error: extractErr } = await supabase.functions.invoke(
        'extract-facebook-marketplace',
        { body: { url: resolvedUrl, user_id: userId } },
      );

      if (extractErr || !extractResult?.success) {
        // Extraction failed - still create a discovery lead so we don't lose it
        console.error('FB Marketplace extraction failed:', extractErr?.message || extractResult?.error);
        const leadId = await createDiscoveryLead(supabase, {
          url: resolvedUrl,
          type: 'facebook_marketplace',
          suggestedType: 'vehicle_listing',
          confidence: 0.9,
          userId,
          metadata: { extraction_error: extractErr?.message || extractResult?.error, item_id: marketplaceItemMatch[1] },
        });
        return {
          entityData: { item_id: marketplaceItemMatch[1], error: extractErr?.message },
          entityId: leadId,
          action: 'extraction_failed',
          message: `FB Marketplace listing detected but extraction failed. Queued for retry.`,
          entityType: 'discovery_lead',
        };
      }

      return {
        entityData: extractResult,
        entityId: extractResult.listing_id || extractResult.vehicle_id || null,
        action: extractResult.is_new ? 'extracted' : 'existing',
        message: extractResult.is_new
          ? `FB Marketplace listing extracted! ${extractResult.extracted?.year || ''} ${extractResult.extracted?.make || ''} ${extractResult.extracted?.model || ''} - $${extractResult.extracted?.price || '?'}`
          : 'FB Marketplace listing already tracked',
        entityType: 'marketplace_listing',
      };
    } catch (err) {
      console.error('FB Marketplace invoke error:', err);
      return {
        entityData: { item_id: marketplaceItemMatch[1], error: err.message },
        entityId: null,
        action: 'error',
        message: `FB Marketplace extraction error: ${err.message}`,
        entityType: 'marketplace_listing',
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
    .single();

  if (error) throw error;

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
    .single();

  if (error) throw error;

  return {
    entityData: vehicle,
    entityId: vehicleId
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
    .or(`listing_url.eq.${url},discovery_url.eq.${url},bat_auction_url.eq.${url}`)
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
          year: parseInt(year),
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

