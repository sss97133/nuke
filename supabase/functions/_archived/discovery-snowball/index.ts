/**
 * DISCOVERY SNOWBALL
 *
 * Recursive lead discovery system that follows chains across platforms.
 *
 * The snowball effect:
 * - Classic.com dealer directory → individual dealers → web developers → more dealers
 * - BaT partners → investigate what they specialize in
 * - YouTube channels → extract captions → find vehicle data
 * - Collections (exclusivecarregistry.com) → leads to Instagram → collector info
 * - Builders → portfolio → vehicles
 *
 * Actions:
 * - run_cycle: Process pending leads and discover new ones
 * - investigate_lead: Deep dive a single lead
 * - discover_from_url: Find leads from any URL
 * - discover_dealers: Crawl dealer directories
 * - discover_web_developers: Find platform networks
 * - get_statistics: Get discovery stats
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

interface DiscoveredLead {
  lead_type: string;
  lead_url: string;
  lead_name?: string;
  lead_description?: string;
  suggested_business_type?: string;
  suggested_specialties?: string[];
  confidence_score: number;
  discovery_method: string;
  raw_data?: any;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { action = 'run_cycle', url, lead_id, max_leads = 10, max_depth = 3 } = body;

    console.log('='.repeat(70));
    console.log('DISCOVERY SNOWBALL');
    console.log('='.repeat(70));
    console.log(`Action: ${action}`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    switch (action) {
      case 'run_cycle':
        return await runDiscoveryCycle(supabase, max_leads, max_depth);

      case 'investigate_lead':
        if (!lead_id) {
          return errorResponse('lead_id required');
        }
        return await investigateLead(supabase, lead_id);

      case 'discover_from_url':
        if (!url) {
          return errorResponse('url required');
        }
        return await discoverFromUrl(supabase, url);

      case 'discover_dealers':
        return await discoverDealers(supabase, url);

      case 'discover_web_developers':
        return await discoverWebDevelopers(supabase);

      case 'get_statistics':
        return await getStatistics(supabase);

      default:
        return errorResponse(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function errorResponse(message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Run a discovery cycle - process pending leads and discover new ones
 */
async function runDiscoveryCycle(supabase: any, maxLeads: number, maxDepth: number) {
  console.log(`📍 Running discovery cycle (max ${maxLeads} leads, depth ${maxDepth})...\n`);

  const results = {
    leads_processed: 0,
    leads_converted: 0,
    leads_invalid: 0,
    new_leads_discovered: 0,
    new_businesses_created: 0,
    new_sources_created: 0,
    errors: [] as string[],
  };

  // Get pending leads
  const { data: pendingLeads, error } = await supabase
    .rpc('get_pending_discovery_leads', {
      p_limit: maxLeads,
      p_max_depth: maxDepth
    });

  if (error) {
    console.error('Failed to get pending leads:', error);
    results.errors.push(`Failed to get pending leads: ${error.message}`);
  }

  const leads = pendingLeads || [];
  console.log(`Found ${leads.length} pending leads to process\n`);

  // Process each lead
  for (const lead of leads) {
    console.log(`\n--- Processing: ${lead.lead_name || lead.lead_url} ---`);
    console.log(`   Type: ${lead.lead_type}, Confidence: ${lead.confidence_score}`);

    try {
      // Mark as investigating
      await supabase
        .from('discovery_leads')
        .update({ status: 'investigating', updated_at: new Date().toISOString() })
        .eq('id', lead.id);

      // Process based on lead type
      let processResult;
      switch (lead.lead_type) {
        case 'organization':
          processResult = await processOrganizationLead(supabase, lead);
          break;
        case 'youtube_channel':
          processResult = await processYouTubeChannelLead(supabase, lead);
          break;
        case 'website':
        case 'social_profile':
          processResult = await processWebsiteLead(supabase, lead);
          break;
        default:
          processResult = await processGenericLead(supabase, lead);
      }

      results.leads_processed++;

      if (processResult.converted) {
        results.leads_converted++;
        if (processResult.business_id) results.new_businesses_created++;
        if (processResult.source_id) results.new_sources_created++;
      } else if (processResult.invalid) {
        results.leads_invalid++;
      }

      results.new_leads_discovered += processResult.new_leads || 0;

      // Update lead status
      await supabase.rpc('process_discovery_lead', {
        p_lead_id: lead.id,
        p_converted_type: processResult.converted_type || null,
        p_converted_id: processResult.converted_id || null,
        p_status: processResult.status || 'converted'
      });

      console.log(`   Result: ${processResult.status}, New leads: ${processResult.new_leads || 0}`);

    } catch (e: any) {
      console.error(`   Error processing lead: ${e.message}`);
      results.errors.push(`Lead ${lead.id}: ${e.message}`);

      await supabase
        .from('discovery_leads')
        .update({
          status: 'invalid',
          processing_notes: e.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', lead.id);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('DISCOVERY CYCLE COMPLETE');
  console.log('='.repeat(70));
  console.log(`Leads processed: ${results.leads_processed}`);
  console.log(`Leads converted: ${results.leads_converted}`);
  console.log(`Leads invalid: ${results.leads_invalid}`);
  console.log(`New leads discovered: ${results.new_leads_discovered}`);
  console.log(`New businesses: ${results.new_businesses_created}`);
  console.log(`New sources: ${results.new_sources_created}`);

  return new Response(
    JSON.stringify({
      success: true,
      action: 'run_cycle',
      results,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Process an organization lead (dealer directories, marketplaces, etc.)
 */
async function processOrganizationLead(supabase: any, lead: any) {
  console.log(`   Processing organization lead: ${lead.lead_url}`);

  // Fetch and analyze the page
  const pageData = await fetchAndAnalyzePage(lead.lead_url);

  if (!pageData) {
    return { status: 'invalid', invalid: true, error: 'Could not fetch page' };
  }

  // Check if this is a directory page (lists multiple dealers)
  if (pageData.is_directory) {
    console.log(`   Detected directory page with ${pageData.listings?.length || 0} listings`);

    // Create leads for each listing
    const newLeads = [];
    for (const listing of (pageData.listings || []).slice(0, 50)) {
      const { error } = await supabase
        .from('discovery_leads')
        .insert({
          discovered_from_type: 'discovery_lead',
          discovered_from_id: lead.id,
          discovered_from_url: lead.lead_url,
          lead_type: 'organization',
          lead_url: listing.url,
          lead_name: listing.name,
          suggested_business_type: listing.type || 'dealership',
          confidence_score: 0.7,
          discovery_method: 'directory_crawl',
          depth: (lead.depth || 0) + 1,
          root_source_id: lead.root_source_id || lead.discovered_from_id
        })
        .select()
        .single();

      if (!error) newLeads.push(listing);
    }

    return {
      status: 'converted',
      converted: true,
      new_leads: newLeads.length
    };
  }

  // Single organization - create business entry
  const businessData = {
    business_name: pageData.name || extractNameFromUrl(lead.lead_url),
    business_type: lead.suggested_business_type || pageData.detected_type || 'dealership',
    website: lead.lead_url,
    description: pageData.description,
    city: pageData.city,
    state: pageData.state,
    phone: pageData.phone,
    email: pageData.email,
    metadata: {
      discovery_source: 'discovery_snowball',
      discovery_lead_id: lead.id,
      discovered_at: new Date().toISOString()
    }
  };

  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .insert(businessData)
    .select()
    .single();

  if (bizError) {
    if (bizError.code === '23505') {
      return { status: 'duplicate', invalid: false };
    }
    throw bizError;
  }

  // Also create a scrape_source for extraction
  const { data: source } = await supabase
    .from('scrape_sources')
    .insert({
      name: businessData.business_name,
      url: lead.lead_url,
      source_type: 'dealer_website',
      is_active: true,
      metadata: { business_id: business.id }
    })
    .select()
    .single();

  // Look for additional leads on this page
  const additionalLeads = await findLeadsOnPage(pageData, lead);
  for (const newLead of additionalLeads) {
    await supabase.from('discovery_leads').insert(newLead);
  }

  return {
    status: 'converted',
    converted: true,
    converted_type: 'business',
    converted_id: business.id,
    business_id: business.id,
    source_id: source?.id,
    new_leads: additionalLeads.length
  };
}

/**
 * Process a YouTube channel lead
 */
async function processYouTubeChannelLead(supabase: any, lead: any) {
  console.log(`   Processing YouTube channel: ${lead.lead_url}`);

  // Extract channel ID from URL
  const channelIdMatch = lead.lead_url.match(/(?:channel\/|@|c\/)([a-zA-Z0-9_-]+)/);
  if (!channelIdMatch) {
    return { status: 'invalid', invalid: true, error: 'Could not extract channel ID' };
  }

  const channelId = channelIdMatch[1];

  // Check if already exists
  const { data: existing } = await supabase
    .from('youtube_channels')
    .select('id')
    .eq('channel_id', channelId)
    .single();

  if (existing) {
    return { status: 'duplicate', invalid: false };
  }

  // Create channel entry
  const { data: channel, error } = await supabase
    .from('youtube_channels')
    .insert({
      channel_id: channelId,
      channel_handle: lead.lead_name,
      channel_name: lead.lead_name || channelId,
      channel_type: 'mixed',
      is_active: true
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return {
    status: 'converted',
    converted: true,
    converted_type: 'youtube_channel',
    converted_id: channel.id
  };
}

/**
 * Process a website/social profile lead
 */
async function processWebsiteLead(supabase: any, lead: any) {
  console.log(`   Processing website: ${lead.lead_url}`);

  const pageData = await fetchAndAnalyzePage(lead.lead_url);

  if (!pageData) {
    return { status: 'invalid', invalid: true };
  }

  // Determine what to create based on analysis
  if (pageData.is_dealer || pageData.has_inventory) {
    // Create as business + scrape source
    return await processOrganizationLead(supabase, {
      ...lead,
      lead_type: 'organization'
    });
  }

  // Look for leads only
  const additionalLeads = await findLeadsOnPage(pageData, lead);
  for (const newLead of additionalLeads) {
    await supabase.from('discovery_leads').insert(newLead);
  }

  return {
    status: 'converted',
    converted: additionalLeads.length > 0,
    new_leads: additionalLeads.length
  };
}

/**
 * Process generic lead
 */
async function processGenericLead(supabase: any, lead: any) {
  const pageData = await fetchAndAnalyzePage(lead.lead_url);

  if (!pageData) {
    return { status: 'invalid', invalid: true };
  }

  const additionalLeads = await findLeadsOnPage(pageData, lead);
  for (const newLead of additionalLeads) {
    await supabase.from('discovery_leads').insert(newLead);
  }

  return {
    status: additionalLeads.length > 0 ? 'converted' : 'skipped',
    converted: additionalLeads.length > 0,
    new_leads: additionalLeads.length
  };
}

/**
 * Fetch and analyze a page - CONSERVATIVE MODE
 *
 * Strategy:
 * 1. Try simple fetch first (FREE)
 * 2. Only use Firecrawl for JS-heavy sites (COSTS TOKENS)
 * 3. Use pattern matching for basic analysis (FREE)
 * 4. Only use LLM for complex/ambiguous cases (COSTS $$$)
 */
async function fetchAndAnalyzePage(url: string, useFirecrawl = false): Promise<any> {
  try {
    let html = '';
    let markdown = '';
    let links: string[] = [];

    // Step 1: Try simple fetch first (FREE)
    if (!useFirecrawl) {
      console.log(`   Fetching with simple fetch: ${url}`);
      const simpleResponse = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });

      if (simpleResponse.ok) {
        html = await simpleResponse.text();
        // Extract links from HTML
        const linkMatches = html.matchAll(/href=["']([^"']+)["']/gi);
        for (const match of linkMatches) {
          if (match[1] && !match[1].startsWith('#') && !match[1].startsWith('javascript:')) {
            try {
              const fullUrl = new URL(match[1], url).href;
              links.push(fullUrl);
            } catch {}
          }
        }
        console.log(`   Simple fetch OK: ${html.length} chars, ${links.length} links`);
      } else {
        console.log(`   Simple fetch failed: ${simpleResponse.status}`);
      }
    }

    // Step 2: Fall back to Firecrawl only if simple fetch failed or explicitly requested
    if (!html && FIRECRAWL_API_KEY && useFirecrawl) {
      console.log(`   Using Firecrawl (costs tokens): ${url}`);
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({
          url,
          formats: ['markdown', 'links'],
          onlyMainContent: false,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        markdown = data.data?.markdown || '';
        links = data.data?.links || [];
        html = markdown; // Use markdown as content
      }
    }

    if (!html && !markdown) {
      console.log(`   Could not fetch page`);
      return null;
    }

    const content = markdown || html;

    // Step 3: Use PATTERN MATCHING for basic analysis (FREE - no LLM)
    const analysis = analyzePageWithPatterns(content, links, url);

    // Step 4: Only use LLM if pattern matching has low confidence AND content is substantial
    // DISABLED FOR NOW - too expensive. Enable selectively.
    /*
    if (OPENAI_API_KEY && analysis.confidence < 0.5 && content.length > 2000) {
      console.log(`   Using LLM for complex analysis (costs $$$)`);
      const llmAnalysis = await analyzeWithLLM(content, url);
      if (llmAnalysis) {
        return { ...analysis, ...llmAnalysis, links };
      }
    }
    */

    return { ...analysis, links, raw_content_length: content.length };

  } catch (error: any) {
    console.error(`   Error fetching ${url}:`, error.message);
    return null;
  }
}

/**
 * Analyze page using pattern matching (FREE - no API calls)
 */
function analyzePageWithPatterns(content: string, links: string[], url: string): any {
  const lowerContent = content.toLowerCase();
  const analysis: any = {
    confidence: 0.3,
    is_directory: false,
    is_dealer: false,
    has_inventory: false,
    detected_type: null,
    listings: [],
  };

  // Detect directory pages (lists of dealers/businesses)
  const directoryPatterns = [
    /dealer\s*(directory|list|finder)/i,
    /find\s*a\s*dealer/i,
    /our\s*partners/i,
    /member\s*dealers/i,
    /browse\s*dealers/i,
  ];
  for (const pattern of directoryPatterns) {
    if (pattern.test(content)) {
      analysis.is_directory = true;
      analysis.confidence = 0.7;
      break;
    }
  }

  // Detect dealer/inventory pages
  const dealerPatterns = [
    /inventory/i,
    /for\s*sale/i,
    /in\s*stock/i,
    /browse\s*vehicles/i,
    /our\s*cars/i,
    /view\s*inventory/i,
  ];
  for (const pattern of dealerPatterns) {
    if (pattern.test(content)) {
      analysis.is_dealer = true;
      analysis.has_inventory = true;
      analysis.detected_type = 'dealership';
      analysis.confidence = 0.6;
      break;
    }
  }

  // Detect auction houses
  if (/auction|bid|lot\s*#|hammer\s*price|reserve/i.test(content)) {
    analysis.detected_type = 'auction_house';
    analysis.confidence = 0.7;
  }

  // Detect builders/restorers
  if (/restoration|custom\s*build|restomod|coachbuild/i.test(content)) {
    analysis.detected_type = 'builder';
    analysis.confidence = 0.6;
  }

  // Extract name from title tag
  const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    analysis.name = titleMatch[1].trim().split('|')[0].split('-')[0].trim();
  }

  // Extract phone
  const phoneMatch = content.match(/(?:\+1[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}/);
  if (phoneMatch) {
    analysis.phone = phoneMatch[0];
  }

  // Extract email
  const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch && !emailMatch[0].includes('example')) {
    analysis.email = emailMatch[0];
  }

  // Extract social links
  analysis.social_links = {};
  const socialPatterns = [
    { name: 'instagram', pattern: /instagram\.com\/([a-zA-Z0-9._]+)/i },
    { name: 'youtube', pattern: /youtube\.com\/(?:channel|c|@)\/([a-zA-Z0-9_-]+)/i },
    { name: 'facebook', pattern: /facebook\.com\/([a-zA-Z0-9.]+)/i },
  ];
  for (const { name, pattern } of socialPatterns) {
    const match = content.match(pattern);
    if (match) {
      analysis.social_links[name] = `https://${name}.com/${match[1]}`;
    }
  }

  // Detect web developer/platform from common signatures
  const platformPatterns = [
    { name: 'SpeedDigital', pattern: /speeddigital|speed\s*digital/i },
    { name: 'DealerFire', pattern: /dealerfire/i },
    { name: 'FusionZone', pattern: /fusionzone/i },
    { name: 'DealerSocket', pattern: /dealersocket/i },
    { name: 'Dealer.com', pattern: /dealer\.com/i },
  ];
  for (const { name, pattern } of platformPatterns) {
    if (pattern.test(content)) {
      analysis.web_developer = { name, detected_via: 'content_pattern' };
      break;
    }
  }

  // If it's a directory, try to extract listings from links
  if (analysis.is_directory) {
    const seenDomains = new Set<string>();
    for (const link of links.slice(0, 200)) {
      try {
        const linkUrl = new URL(link);
        // Skip same domain, common non-dealer paths
        if (linkUrl.hostname === new URL(url).hostname) continue;
        if (/facebook|twitter|instagram|youtube|linkedin/i.test(linkUrl.hostname)) continue;
        if (seenDomains.has(linkUrl.hostname)) continue;
        seenDomains.add(linkUrl.hostname);

        analysis.listings.push({
          url: link,
          name: linkUrl.hostname.replace(/^www\./, ''),
          type: 'dealership',
        });
      } catch {}
    }
    if (analysis.listings.length > 5) {
      analysis.confidence = 0.8;
    }
  }

  return analysis;
}

/**
 * LLM analysis - EXPENSIVE, use sparingly
 * Currently disabled to save costs. Enable when needed for complex pages.
 */
async function analyzeWithLLM(content: string, url: string): Promise<any> {
  // DISABLED - too expensive for bulk discovery
  // Enable selectively for high-value pages that pattern matching can't handle
  return null;
}

/**
 * Find additional leads on a page
 */
async function findLeadsOnPage(pageData: any, parentLead: any): Promise<any[]> {
  const leads: any[] = [];
  const baseDepth = (parentLead.depth || 0) + 1;
  const rootSourceId = parentLead.root_source_id || parentLead.discovered_from_id;

  // Extract leads from social links
  if (pageData.social_links) {
    if (pageData.social_links.youtube && !pageData.social_links.youtube.includes('watch')) {
      leads.push({
        discovered_from_type: 'discovery_lead',
        discovered_from_id: parentLead.id,
        discovered_from_url: parentLead.lead_url,
        lead_type: 'youtube_channel',
        lead_url: pageData.social_links.youtube,
        confidence_score: 0.8,
        discovery_method: 'social_link',
        depth: baseDepth,
        root_source_id: rootSourceId
      });
    }

    if (pageData.social_links.instagram) {
      leads.push({
        discovered_from_type: 'discovery_lead',
        discovered_from_id: parentLead.id,
        discovered_from_url: parentLead.lead_url,
        lead_type: 'social_profile',
        lead_url: pageData.social_links.instagram,
        confidence_score: 0.6,
        discovery_method: 'social_link',
        depth: baseDepth,
        root_source_id: rootSourceId
      });
    }
  }

  // Extract leads from web developer detection
  if (pageData.web_developer?.name) {
    leads.push({
      discovered_from_type: 'discovery_lead',
      discovered_from_id: parentLead.id,
      discovered_from_url: parentLead.lead_url,
      lead_type: 'organization',
      lead_url: `https://www.google.com/search?q="${pageData.web_developer.name}"+dealer+website`,
      lead_name: pageData.web_developer.name,
      suggested_business_type: 'web_developer',
      confidence_score: 0.9,
      discovery_method: 'web_developer_detection',
      depth: baseDepth,
      root_source_id: rootSourceId,
      raw_data: { detected_via: pageData.web_developer.detected_via }
    });
  }

  // Extract leads from links
  const vehicleRelatedPatterns = [
    /\/inventory/i, /\/cars/i, /\/vehicles/i, /\/collection/i,
    /bringatrailer\.com/, /carsandbids\.com/, /classic\.com/,
    /youtube\.com\/channel/, /youtube\.com\/@/
  ];

  for (const link of (pageData.links || []).slice(0, 100)) {
    const url = typeof link === 'string' ? link : link.url;
    if (!url || url === parentLead.lead_url) continue;

    for (const pattern of vehicleRelatedPatterns) {
      if (pattern.test(url)) {
        leads.push({
          discovered_from_type: 'discovery_lead',
          discovered_from_id: parentLead.id,
          discovered_from_url: parentLead.lead_url,
          lead_type: url.includes('youtube.com') ? 'youtube_channel' : 'website',
          lead_url: url,
          confidence_score: 0.5,
          discovery_method: 'link_pattern',
          depth: baseDepth,
          root_source_id: rootSourceId
        });
        break;
      }
    }
  }

  return leads.slice(0, 20); // Limit to 20 leads per page
}

/**
 * Investigate a single lead in depth
 */
async function investigateLead(supabase: any, leadId: string) {
  const { data: lead, error } = await supabase
    .from('discovery_leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (error || !lead) {
    return errorResponse('Lead not found');
  }

  // Deep investigation
  const pageData = await fetchAndAnalyzePage(lead.lead_url);

  return new Response(
    JSON.stringify({
      success: true,
      lead,
      analysis: pageData,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Discover leads from any URL
 */
async function discoverFromUrl(supabase: any, url: string) {
  console.log(`\n📍 Discovering leads from: ${url}\n`);

  // Create a root lead
  const { data: rootLead, error } = await supabase
    .from('discovery_leads')
    .insert({
      discovered_from_type: 'manual',
      lead_type: 'website',
      lead_url: url,
      confidence_score: 1.0,
      discovery_method: 'manual_discovery'
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Analyze the page
  const pageData = await fetchAndAnalyzePage(url);

  if (!pageData) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Could not fetch page',
        lead_id: rootLead.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Find leads
  const leads = await findLeadsOnPage(pageData, rootLead);

  // Insert leads
  for (const lead of leads) {
    await supabase.from('discovery_leads').insert(lead);
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'discover_from_url',
      url,
      analysis: {
        name: pageData.name,
        type: pageData.detected_type,
        is_directory: pageData.is_directory,
        is_dealer: pageData.is_dealer,
        has_inventory: pageData.has_inventory
      },
      leads_discovered: leads.length,
      root_lead_id: rootLead.id,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Discover dealers from directories
 */
async function discoverDealers(supabase: any, directoryUrl?: string) {
  const directories = directoryUrl
    ? [directoryUrl]
    : [
        'https://www.classic.com/dealers',
        'https://bringatrailer.com/partners',
        'https://www.hemmings.com/dealers'
      ];

  let totalDiscovered = 0;

  for (const url of directories) {
    console.log(`\n📍 Crawling dealer directory: ${url}`);

    const pageData = await fetchAndAnalyzePage(url);
    if (!pageData) continue;

    const listings = pageData.listings || [];
    console.log(`   Found ${listings.length} listings`);

    for (const listing of listings.slice(0, 100)) {
      const { error } = await supabase
        .from('discovery_leads')
        .insert({
          discovered_from_type: 'manual',
          discovered_from_url: url,
          lead_type: 'organization',
          lead_url: listing.url,
          lead_name: listing.name,
          suggested_business_type: listing.type || 'dealership',
          confidence_score: 0.8,
          discovery_method: 'directory_crawl'
        });

      if (!error) totalDiscovered++;
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'discover_dealers',
      directories_crawled: directories.length,
      leads_discovered: totalDiscovered,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Discover web developers from existing businesses
 */
async function discoverWebDevelopers(supabase: any) {
  console.log(`\n📍 Discovering web developers from existing businesses...\n`);

  // Get businesses with websites
  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, business_name, website')
    .not('website', 'is', null)
    .limit(50);

  if (error || !businesses) {
    throw new Error('Failed to get businesses');
  }

  let developersFound = 0;

  for (const business of businesses) {
    if (!business.website) continue;

    const pageData = await fetchAndAnalyzePage(business.website);
    if (!pageData?.web_developer) continue;

    const { error: insertError } = await supabase
      .from('web_developer_clients')
      .insert({
        developer_name: pageData.web_developer.name,
        platform_name: pageData.web_developer.name,
        client_domain: new URL(business.website).hostname,
        client_name: business.business_name,
        client_business_id: business.id,
        detection_method: pageData.web_developer.detected_via,
        confidence_score: 0.8
      });

    if (!insertError) developersFound++;
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'discover_web_developers',
      businesses_analyzed: businesses.length,
      developers_found: developersFound,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Get discovery statistics
 */
async function getStatistics(supabase: any) {
  const { data: stats } = await supabase
    .from('discovery_statistics')
    .select('*')
    .single();

  const { count: totalBusinesses } = await supabase
    .from('businesses')
    .select('*', { count: 'exact', head: true });

  const { count: totalSources } = await supabase
    .from('scrape_sources')
    .select('*', { count: 'exact', head: true });

  const { count: youtubeChannels } = await supabase
    .from('youtube_channels')
    .select('*', { count: 'exact', head: true });

  return new Response(
    JSON.stringify({
      success: true,
      action: 'get_statistics',
      discovery: stats || {},
      entities: {
        businesses: totalBusinesses || 0,
        scrape_sources: totalSources || 0,
        youtube_channels: youtubeChannels || 0
      },
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Helper to extract a name from URL
 */
function extractNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname
      .replace(/^www\./, '')
      .replace(/\.(com|net|org|co)$/, '')
      .split('.')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  } catch {
    return 'Unknown';
  }
}
