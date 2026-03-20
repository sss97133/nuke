/**
 * ONBOARD-SOURCE — Universal Source Onboarding
 *
 * "URL in, vehicles out."
 *
 * Takes any vehicle marketplace/auction/dealer URL and:
 * 1. Investigates the site (DOM, tech stack, listing patterns)
 * 2. Creates an organization profile (name, logo, identity)
 * 3. Takes a census (universe size, active/historical, turnover)
 * 4. Estimates extraction time
 * 5. Sets up monitoring for new listings
 * 6. Queues all discovered listing URLs for extraction
 *
 * No custom extractor needed. Unknown sources fall back to extract-vehicle-data-ai.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { firecrawlScrape, firecrawlMap } from '../_shared/firecrawl.ts';

const VERSION = '1.0.0';

// ─── Helpers ────────────────────────────────────────────────────────────────

function canonicalizeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    throw new Error(`Invalid URL: ${url.slice(0, 200)}`);
  }
}

function slugFromDomain(domain: string): string {
  return domain
    .replace(/\.(com|net|org|co|io|uk|de|fr|it|es|ca|au)$/i, '')
    .replace(/\./g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);
}

function normalizeUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

function inferCategory(analysis: any): string {
  const t = (analysis?.site_type || '').toLowerCase();
  if (t.includes('auction')) return 'auction';
  if (t.includes('marketplace') || t.includes('classified')) return 'marketplace';
  if (t.includes('dealer')) return 'dealer';
  if (t.includes('forum')) return 'forum';
  if (t.includes('registry')) return 'registry';
  return 'marketplace';
}

// ─── AI Site Analysis ───────────────────────────────────────────────────────

async function analyzeSiteWithAI(markdown: string, domain: string): Promise<any> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    console.warn('[onboard] No OPENAI_API_KEY, using heuristic analysis');
    return heuristicAnalysis(markdown, domain);
  }

  const prompt = `Analyze this vehicle marketplace/auction website homepage. Return JSON only.

Website: ${domain}
Page content (markdown):
${markdown.slice(0, 8000)}

Return this exact JSON structure:
{
  "site_type": "auction|marketplace|dealer|forum|classified|registry",
  "site_name": "Human readable name",
  "description": "One sentence description",
  "listing_url_pattern": "regex pattern for individual listing URLs on this domain",
  "browse_url": "URL where listings can be browsed/searched, or null",
  "has_sitemap": true/false,
  "requires_js_rendering": true/false,
  "cloudflare_protected": true/false,
  "has_api": true/false,
  "pagination_method": "page_param|cursor|infinite_scroll|none|unknown",
  "specializations": ["array", "of", "vehicle", "types", "they", "focus", "on"],
  "active_listing_estimate": null or number (rough estimate from what you see),
  "social_links": { "twitter": null, "instagram": null, "youtube": null, "facebook": null },
  "logo_description": "description of where logo is on the page, or null"
}`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.error(`[onboard] OpenAI error: ${resp.status}`);
      return heuristicAnalysis(markdown, domain);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : heuristicAnalysis(markdown, domain);
  } catch (e) {
    console.error(`[onboard] AI analysis failed: ${e.message}`);
    return heuristicAnalysis(markdown, domain);
  }
}

function heuristicAnalysis(markdown: string, domain: string): any {
  const md = markdown.toLowerCase();
  const isAuction = md.includes('auction') || md.includes('bid') || md.includes('lot');
  const isDealer = md.includes('inventory') || md.includes('dealership');
  const isForum = md.includes('forum') || md.includes('thread') || md.includes('member');

  return {
    site_type: isAuction ? 'auction' : isDealer ? 'dealer' : isForum ? 'forum' : 'marketplace',
    site_name: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
    description: null,
    listing_url_pattern: null,
    browse_url: null,
    has_sitemap: false,
    requires_js_rendering: false,
    cloudflare_protected: false,
    has_api: false,
    pagination_method: 'unknown',
    specializations: [],
    active_listing_estimate: null,
    social_links: {},
    logo_description: null,
  };
}

// ─── Census Logic ───────────────────────────────────────────────────────────

function estimateUniverseFromMap(links: string[], listingPattern: string | null): {
  total: number;
  listingUrls: string[];
} {
  if (!listingPattern) {
    return { total: links.length, listingUrls: [] };
  }

  try {
    const regex = new RegExp(listingPattern, 'i');
    const listingUrls = links.filter(l => regex.test(l));
    return { total: listingUrls.length, listingUrls };
  } catch {
    return { total: links.length, listingUrls: [] };
  }
}

function estimateFromBrowsePage(markdown: string): number | null {
  // Look for patterns like "1,234 results", "Showing 1-24 of 5,678"
  const patterns = [
    /(\d[\d,]+)\s*(?:results|listings|vehicles|cars|lots|items)/i,
    /of\s+(\d[\d,]+)/i,
    /(\d[\d,]+)\s*(?:total|found)/i,
  ];

  for (const p of patterns) {
    const m = markdown.match(p);
    if (m) {
      const val = parseInt(m[1].replace(/,/g, ''));
      if (val > 10 && val < 10_000_000) return val;
    }
  }
  return null;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'onboard';

    // ── POLL MONITORED SOURCES ─────────────────────────────────────
    if (action === 'poll_monitored_sources') {
      return await handlePollMonitored(supabase);
    }

    // ── ONBOARD: Full source onboarding ────────────────────────────
    const rawUrl = normalizeUrl(body.url);
    if (!rawUrl) {
      return jsonResponse({ error: 'url is required' }, 400);
    }

    const phase = body.phase || 'all';
    const sourceId = body.source_id || null;
    const forceRefresh = body.force_refresh || false;

    const domain = canonicalizeDomain(rawUrl);
    const slug = slugFromDomain(domain);
    const baseUrl = `https://${domain}`;

    console.log(`[onboard] Starting: ${domain} (phase: ${phase})`);

    const result: any = {
      success: true,
      domain,
      slug,
      version: VERSION,
      phases: {},
    };

    // Check if source already exists
    const { data: existingSource } = await supabase
      .from('observation_sources')
      .select('id, slug, display_name, category, business_id')
      .or(`slug.eq.${slug},base_url.eq.${baseUrl}`)
      .limit(1)
      .maybeSingle();

    if (existingSource && !forceRefresh) {
      // Source already onboarded — just queue the URL if it's a listing
      result.already_onboarded = true;
      result.source_id = existingSource.id;
      result.source_slug = existingSource.slug;
      result.display_name = existingSource.display_name;

      // If a specific listing URL was given (not just homepage), queue it
      if (rawUrl !== baseUrl && rawUrl !== `${baseUrl}/`) {
        const { error: qErr } = await supabase.from('import_queue').upsert(
          { listing_url: rawUrl, status: 'pending' },
          { onConflict: 'listing_url', ignoreDuplicates: true },
        );
        if (!qErr) result.queued_url = rawUrl;
      }

      return jsonResponse(result);
    }

    let observationSourceId = existingSource?.id || sourceId;

    // ── PHASE 1: INVESTIGATE ───────────────────────────────────────
    if (phase === 'all' || phase === 'investigate') {
      console.log(`[onboard] Phase 1: Investigate ${domain}`);

      // Fetch homepage via Firecrawl (handles JS, Cloudflare)
      const scrapeResult = await firecrawlScrape({
        url: baseUrl,
        formats: ['markdown', 'html'],
        waitFor: 3000,
      });

      const markdown = scrapeResult.data?.markdown || '';
      const html = scrapeResult.data?.html || '';

      if (!markdown && !html) {
        console.warn(`[onboard] Could not fetch ${domain} — trying direct`);
      }

      // AI analysis of the site
      const analysis = await analyzeSiteWithAI(markdown || html.slice(0, 8000), domain);

      // Firecrawl map to get URL inventory
      const mapResult = await firecrawlMap(baseUrl, { limit: 5000, timeout: 30000 });
      const allLinks = mapResult.links || [];

      // Identify listing URLs
      const { total: estimatedListings, listingUrls } = estimateUniverseFromMap(
        allLinks, analysis.listing_url_pattern
      );

      // Upsert observation_sources
      const category = inferCategory(analysis);
      const osRow = {
        slug,
        display_name: analysis.site_name || domain,
        category,
        base_url: baseUrl,
        url_patterns: analysis.listing_url_pattern ? [analysis.listing_url_pattern] : [],
        base_trust_score: 0.50,
        notes: analysis.description || null,
      };

      if (observationSourceId) {
        await supabase.from('observation_sources').update(osRow).eq('id', observationSourceId);
      } else {
        const { data: created, error: osErr } = await supabase
          .from('observation_sources')
          .upsert({ ...osRow }, { onConflict: 'slug' })
          .select('id')
          .single();
        if (osErr) console.error(`[onboard] observation_sources error: ${osErr.message}`);
        observationSourceId = created?.id;
      }

      // Upsert source_registry
      await supabase.from('source_registry').upsert({
        slug,
        display_name: analysis.site_name || domain,
        category,
        status: 'investigating',
        cloudflare_protected: analysis.cloudflare_protected || scrapeResult.blocked,
        fallback_method: (analysis.requires_js_rendering || scrapeResult.blocked) ? 'firecrawl' : null,
        discovery_url: analysis.browse_url || baseUrl,
        discovery_method: analysis.has_sitemap ? 'sitemap' : 'crawl',
        listing_url_pattern: analysis.listing_url_pattern || null,
        observation_source_id: observationSourceId,
        onboard_phases_complete: ['investigate'],
      }, { onConflict: 'slug' });

      // Upsert source_intelligence (FK to scrape_sources, need to create one)
      const { data: scrapeSource } = await supabase.from('scrape_sources').upsert({
        name: analysis.site_name || domain,
        url: baseUrl,
        source_type: category,
      }, { onConflict: 'url' }).select('id').single();

      if (scrapeSource?.id) {
        await supabase.from('source_intelligence').upsert({
          source_id: scrapeSource.id,
          source_purpose: 'vehicle_listings',
          requires_js_rendering: analysis.requires_js_rendering || false,
          has_api: analysis.has_api || false,
          recommended_extraction_method: analysis.requires_js_rendering ? 'firecrawl' : 'simple_fetch',
          page_structure_notes: JSON.stringify({
            pagination_method: analysis.pagination_method,
            listing_pattern: analysis.listing_url_pattern,
          }),
          vehicle_specialties: analysis.specializations || [],
          last_inspected_at: new Date().toISOString(),
          inspected_by: 'onboard-source',
        }, { onConflict: 'source_id' });

        // Link business to scrape_sources if we have observation_sources.business_id
        if (observationSourceId) {
          await supabase.from('observation_sources')
            .update({ business_id: null }) // will be set in Phase 2
            .eq('id', observationSourceId);
        }
      }

      result.phases.investigate = {
        site_type: analysis.site_type,
        site_name: analysis.site_name,
        cloudflare: analysis.cloudflare_protected || scrapeResult.blocked,
        requires_js: analysis.requires_js_rendering,
        has_api: analysis.has_api,
        pagination: analysis.pagination_method,
        listing_pattern: analysis.listing_url_pattern,
        urls_mapped: allLinks.length,
        listing_urls_found: listingUrls.length,
        specializations: analysis.specializations,
      };

      // Store listing URLs for later phases
      result._listingUrls = listingUrls;
      result._analysis = analysis;
      result._allLinks = allLinks;
    }

    // ── PHASE 2: PROFILE (Organization Identity) ───────────────────
    if (phase === 'all' || phase === 'profile') {
      console.log(`[onboard] Phase 2: Profile ${domain}`);

      const analysis = result._analysis || {};
      const investigate = result.phases?.investigate || {};

      // Check for existing business by website
      let businessId: string | null = null;
      const websiteVariants = [
        baseUrl, `${baseUrl}/`, `http://${domain}`, `http://${domain}/`,
        `https://www.${domain}`, `https://www.${domain}/`,
      ];

      const { data: existingBiz } = await supabase
        .from('businesses')
        .select('id')
        .in('website', websiteVariants)
        .limit(1)
        .maybeSingle();

      if (existingBiz) {
        businessId = existingBiz.id;
      } else {
        // Create new business directly
        const { data: newBiz, error: bizErr } = await supabase
          .from('businesses')
          .insert({
            business_name: analysis.site_name || investigate.site_name || domain,
            business_type: inferCategory(analysis) === 'auction' ? 'auction_house' : 'marketplace',
            website: baseUrl,
            description: analysis.description || null,
            specializations: analysis.specializations || [],
            social_links: analysis.social_links || {},
            is_public: true,
            is_active: true,
            source_url: baseUrl,
            discovered_via: 'onboard-source',
          })
          .select('id')
          .single();

        if (bizErr) {
          console.warn(`[onboard] Business create failed: ${bizErr.message}`);
        } else {
          businessId = newBiz?.id || null;
        }
      }

      // Enhance existing business with AI-discovered data
      if (businessId) {
        const updates: any = {};
        if (analysis.social_links && Object.values(analysis.social_links).some(v => v)) {
          updates.social_links = analysis.social_links;
        }
        if (analysis.specializations?.length) updates.specializations = analysis.specializations;
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          await supabase.from('businesses').update(updates).eq('id', businessId);
        }
      }

      // Link business to observation_sources
      if (businessId && observationSourceId) {
        await supabase.from('observation_sources')
          .update({ business_id: businessId })
          .eq('id', observationSourceId);
      }

      // Get the business record for the response
      let profile: any = null;
      if (businessId) {
        const { data: biz } = await supabase.from('businesses')
          .select('business_name, logo_url, banner_url, description, website, specializations')
          .eq('id', businessId)
          .single();
        profile = biz;
      }

      // Update onboard phases
      await supabase.from('source_registry')
        .update({
          onboard_phases_complete: ['investigate', 'profile'],
        })
        .eq('slug', slug);

      result.business_id = businessId;
      result.phases.profile = {
        business_id: businessId,
        name: profile?.business_name || analysis.site_name,
        logo_url: profile?.logo_url || null,
        description: profile?.description || analysis.description,
        specializations: profile?.specializations || analysis.specializations || [],
      };
    }

    // ── PHASE 3: CENSUS (Universe Size) ────────────────────────────
    if (phase === 'all' || phase === 'census') {
      console.log(`[onboard] Phase 3: Census ${domain}`);

      const listingUrls = result._listingUrls || [];
      const allLinks = result._allLinks || [];
      const analysis = result._analysis || {};

      let universeTotal = listingUrls.length || allLinks.length;
      let universeActive = listingUrls.length || null;
      let censusMethod = 'url_map';
      let censusConfidence = 0.5;

      // Try to get better count from browse page
      if (analysis.browse_url) {
        try {
          const browseResult = await firecrawlScrape({
            url: analysis.browse_url,
            formats: ['markdown'],
            waitFor: 3000,
          });
          const browseMd = browseResult.data?.markdown || '';
          const estimated = estimateFromBrowsePage(browseMd);
          if (estimated && estimated > universeTotal) {
            universeTotal = estimated;
            universeActive = estimated;
            censusMethod = 'browse_page_count';
            censusConfidence = 0.7;
          }
        } catch {
          // keep URL map estimate
        }
      }

      // Estimate turnover (rough: 1-2% of active per day for marketplaces, less for auctions)
      const category = analysis.site_type || 'marketplace';
      const turnoverRate = category === 'auction' ? 0.005 : 0.015;
      const turnoverPerDay = Math.round((universeActive || universeTotal) * turnoverRate);

      // Write census
      if (observationSourceId) {
        await supabase.from('source_census').insert({
          source_id: observationSourceId,
          universe_total: universeTotal,
          universe_active: universeActive,
          universe_historical: null,
          census_method: censusMethod,
          census_confidence: censusConfidence,
          census_url: analysis.browse_url || baseUrl,
          census_at: new Date().toISOString(),
          estimated_turnover_per_day: turnoverPerDay,
        });
      }

      await supabase.from('source_registry')
        .update({
          onboard_phases_complete: ['investigate', 'profile', 'census'],
        })
        .eq('slug', slug);

      result.phases.census = {
        universe_total: universeTotal,
        universe_active: universeActive,
        estimated_turnover_per_day: turnoverPerDay,
        census_method: censusMethod,
        confidence: censusConfidence,
      };
    }

    // ── PHASE 4: ESTIMATE ──────────────────────────────────────────
    if (phase === 'all' || phase === 'estimate') {
      console.log(`[onboard] Phase 4: Estimate ${domain}`);

      const analysis = result._analysis || {};
      const census = result.phases?.census || {};
      const itemsToExtract = census.universe_active || census.universe_total || 0;

      // Time per item: base + JS overhead + AI extraction overhead
      let secondsPerItem = 2; // base fetch + parse
      if (analysis.requires_js_rendering) secondsPerItem += 3;
      secondsPerItem += 3; // AI extraction (no custom parser for new sources)

      // Add inter-request delay
      const delayPerItem = analysis.requires_js_rendering ? 4 : 2;
      const totalSeconds = itemsToExtract * (secondsPerItem + delayPerItem);
      const estimatedHours = Math.round((totalSeconds / 3600) * 10) / 10;
      const itemsPerHour = totalSeconds > 0 ? Math.round(itemsToExtract / (totalSeconds / 3600)) : 0;

      await supabase.from('source_registry')
        .update({
          estimated_extraction_hours: estimatedHours,
          onboard_phases_complete: ['investigate', 'profile', 'census', 'estimate'],
        })
        .eq('slug', slug);

      result.phases.estimate = {
        total_items: itemsToExtract,
        estimated_hours: estimatedHours,
        items_per_hour: itemsPerHour,
        bottleneck: analysis.requires_js_rendering ? 'JS rendering required' : 'AI extraction',
      };
    }

    // ── PHASE 5: MONITOR SETUP ─────────────────────────────────────
    if (phase === 'all' || phase === 'monitor') {
      console.log(`[onboard] Phase 5: Monitor setup ${domain}`);

      const analysis = result._analysis || {};
      const census = result.phases?.census || {};

      // Pick monitoring strategy
      let strategy = 'homepage_poll';
      let frequencyHours = 12;

      if (analysis.has_sitemap) {
        strategy = 'sitemap_delta';
        frequencyHours = 6;
      } else if (analysis.browse_url) {
        strategy = 'browse_page_poll';
        frequencyHours = 6;
      }

      // Higher-volume sources get more frequent checks
      if ((census.estimated_turnover_per_day || 0) > 100) frequencyHours = 2;
      else if ((census.estimated_turnover_per_day || 0) > 20) frequencyHours = 6;

      // Set coverage target
      if (observationSourceId) {
        await supabase.from('coverage_targets').upsert({
          source_id: observationSourceId,
          segment_type: 'all',
          target_coverage_pct: 95,
          target_freshness_hours: frequencyHours * 2,
          priority: 50,
          is_active: true,
        }, { onConflict: 'source_id,segment_type,segment_value' });
      }

      await supabase.from('source_registry')
        .update({
          status: 'active',
          monitoring_strategy: strategy,
          monitoring_frequency_hours: frequencyHours,
          onboard_phases_complete: ['investigate', 'profile', 'census', 'estimate', 'monitor'],
          extractor_function: 'extract-vehicle-data-ai', // default to AI extraction
        })
        .eq('slug', slug);

      result.phases.monitor = {
        strategy,
        frequency_hours: frequencyHours,
        coverage_target_pct: 95,
      };
    }

    // ── QUEUE DISCOVERED LISTINGS ──────────────────────────────────
    if (phase === 'all') {
      const listingUrls = result._listingUrls || [];
      let queued = 0;

      if (listingUrls.length > 0) {
        console.log(`[onboard] Queueing ${listingUrls.length} discovered listing URLs`);

        // Get the scrape_source_id for import_queue
        const { data: scrapeSource } = await supabase.from('scrape_sources')
          .select('id')
          .eq('url', baseUrl)
          .limit(1)
          .maybeSingle();

        // Batch insert to import_queue
        const batchSize = 500;
        for (let i = 0; i < listingUrls.length; i += batchSize) {
          const batch = listingUrls.slice(i, i + batchSize).map(u => ({
            listing_url: u,
            source_id: scrapeSource?.id || null,
            status: 'pending',
            priority: 5,
          }));

          const { error: qErr } = await supabase.from('import_queue').upsert(
            batch,
            { onConflict: 'listing_url', ignoreDuplicates: true },
          );
          if (qErr) {
            console.warn(`[onboard] Queue batch error: ${qErr.message}`);
          } else {
            queued += batch.length;
          }
        }
      }

      result.queued = queued;
    }

    // Clean internal fields before response
    delete result._listingUrls;
    delete result._analysis;
    delete result._allLinks;

    result.source_id = observationSourceId;

    console.log(`[onboard] Complete: ${domain} — ${JSON.stringify(result.phases)}`);
    return jsonResponse(result);

  } catch (err) {
    console.error('[onboard] Error:', err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
});

// ─── Poll Monitored Sources ─────────────────────────────────────────────────

async function handlePollMonitored(supabase: any): Promise<Response> {
  console.log('[onboard] Polling monitored sources');

  // Get all active sources due for a check
  const { data: sources, error } = await supabase
    .from('source_registry')
    .select('slug, discovery_url, listing_url_pattern, monitoring_frequency_hours, last_successful_at, observation_source_id')
    .in('status', ['active', 'monitoring'])
    .not('discovery_url', 'is', null);

  if (error || !sources?.length) {
    return jsonResponse({ success: true, checked: 0, message: 'No sources to poll' });
  }

  const now = Date.now();
  let checked = 0;
  let newListings = 0;

  for (const source of sources) {
    // Check if due for poll
    const freqMs = (source.monitoring_frequency_hours || 24) * 3600 * 1000;
    const lastAt = source.last_successful_at ? new Date(source.last_successful_at).getTime() : 0;
    if (now - lastAt < freqMs) continue;

    try {
      console.log(`[onboard] Polling: ${source.slug}`);

      // Get URL map
      const mapResult = await firecrawlMap(source.discovery_url, { limit: 2000, timeout: 20000 });

      if (mapResult.links.length > 0 && source.listing_url_pattern) {
        const regex = new RegExp(source.listing_url_pattern, 'i');
        const listingUrls = mapResult.links.filter(l => regex.test(l));

        if (listingUrls.length > 0) {
          // Get scrape_source_id
          const { data: scrapeSource } = await supabase.from('scrape_sources')
            .select('id')
            .eq('name', source.slug)
            .limit(1)
            .maybeSingle();

          // Insert only new URLs
          const batch = listingUrls.slice(0, 500).map(u => ({
            listing_url: u,
            source_id: scrapeSource?.id || null,
            status: 'pending',
            priority: 5,
          }));

          const { data: inserted } = await supabase.from('import_queue').upsert(
            batch,
            { onConflict: 'listing_url', ignoreDuplicates: true },
          ).select('id');

          newListings += inserted?.length || 0;
        }
      }

      // Update last checked
      await supabase.from('source_registry')
        .update({ last_successful_at: new Date().toISOString() })
        .eq('slug', source.slug);

      checked++;
    } catch (e) {
      console.error(`[onboard] Poll error for ${source.slug}: ${e.message}`);
    }
  }

  return jsonResponse({
    success: true,
    checked,
    new_listings: newListings,
    sources_total: sources.length,
  });
}

// ─── Response helper ────────────────────────────────────────────────────────

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
