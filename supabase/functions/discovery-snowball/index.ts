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
 * Fetch and analyze a page using Firecrawl + LLM
 */
async function fetchAndAnalyzePage(url: string): Promise<any> {
  try {
    // Use Firecrawl to fetch the page
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

    if (!response.ok) {
      console.log(`   Firecrawl failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const markdown = data.data?.markdown || '';
    const links = data.data?.links || [];

    // Use LLM to analyze the page
    if (OPENAI_API_KEY && markdown.length > 100) {
      const analysisPrompt = `Analyze this webpage and extract information:

URL: ${url}
Content: ${markdown.substring(0, 5000)}

Determine:
1. Is this a directory page listing multiple businesses? (is_directory)
2. Is this a car dealer or has vehicle inventory? (is_dealer, has_inventory)
3. Extract: name, description, phone, email, city, state
4. Detect business type: dealership, builder, auction_house, marketplace, etc.
5. Find any dealer listings if it's a directory

Return JSON:
{
  "name": "Business Name",
  "description": "Brief description",
  "phone": "xxx-xxx-xxxx",
  "email": "email@example.com",
  "city": "City",
  "state": "ST",
  "detected_type": "dealership",
  "is_directory": false,
  "is_dealer": true,
  "has_inventory": true,
  "listings": [{"name": "Dealer Name", "url": "https://...", "type": "dealership"}],
  "social_links": {"instagram": "...", "youtube": "..."},
  "web_developer": {"name": "SpeedDigital", "detected_via": "footer"}
}`;

      const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a web page analyzer. Extract structured data from webpages. Return only valid JSON.' },
            { role: 'user', content: analysisPrompt }
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' }
        }),
      });

      if (llmResponse.ok) {
        const llmData = await llmResponse.json();
        const analysis = JSON.parse(llmData.choices[0].message.content);
        return {
          ...analysis,
          raw_markdown: markdown,
          links
        };
      }
    }

    // Fallback: Basic parsing
    return {
      raw_markdown: markdown,
      links,
      is_directory: links.length > 20,
      has_inventory: markdown.toLowerCase().includes('inventory') ||
                     markdown.toLowerCase().includes('for sale')
    };

  } catch (error: any) {
    console.error(`   Error fetching ${url}:`, error.message);
    return null;
  }
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
