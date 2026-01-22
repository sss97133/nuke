/**
 * Process Content Extraction Queue
 * Processes detected content from comments: scrapes listings, extracts data, handles merging
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QueueItem {
  id: string;
  vehicle_id: string;
  user_id: string;
  content_type: string;
  raw_content: string;
  context: string;
  confidence_score: number;
  comment_id?: string;
  comment_table?: string;
}

const todayYmd = (): string => new Date().toISOString().slice(0, 10);

const toDateOnly = (raw: any): string => {
  if (!raw) return todayYmd();
  const s = String(raw).trim();
  if (!s) return todayYmd();
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch?.[1]) return isoMatch[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return todayYmd();
};

const clampToToday = (ymd: string): string => {
  try {
    const today = todayYmd();
    if (ymd > today) return today;
  } catch {
    return todayYmd();
  }
  return ymd;
};

const safeEventDate = (raw: any): string => clampToToday(toDateOnly(raw));

const shortUrl = (raw: string): string => {
  try {
    const u = new URL(raw);
    const base = u.hostname.replace(/^www\./, '');
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return `${base}${path}`;
  } catch {
    return raw;
  }
};

const INSTAGRAM_POST_PATH = /\/(p|reel|tv)\/([A-Za-z0-9_-]+)/i;

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const extractMeta = (html: string, key: string, attr = 'property'): string | null => {
  const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i');
  const match = html.match(re);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1].trim());
};

const extractMetaAll = (html: string, key: string, attr = 'property'): string[] => {
  const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["']`, 'gi');
  const out: string[] = [];
  for (const match of html.matchAll(re)) {
    if (match?.[1]) out.push(decodeHtmlEntities(match[1].trim()));
  }
  return Array.from(new Set(out));
};

const parseInstagramUrl = (raw: string): { kind: 'post' | 'profile' | 'unknown'; shortcode?: string; handle?: string } | null => {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (!/(^|\.)instagram\.com$/i.test(host)) return null;
    const postMatch = u.pathname.match(INSTAGRAM_POST_PATH);
    if (postMatch?.[2]) {
      return { kind: 'post', shortcode: postMatch[2] };
    }
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      return { kind: 'profile', handle: parts[0] };
    }
    return { kind: 'unknown' };
  } catch {
    return null;
  }
};

const extractInstagramHandle = (title?: string | null, description?: string | null): string | null => {
  const titleMatch = title?.match(/\(@([a-zA-Z0-9._]+)\)/);
  if (titleMatch?.[1]) return titleMatch[1];
  const descMatch = description?.match(/-\s*([a-zA-Z0-9._]+)\s+on\s/i);
  if (descMatch?.[1]) return descMatch[1];
  return null;
};

const extractInstagramCaption = (description?: string | null): string | null => {
  if (!description) return null;
  const cleaned = description.trim();
  const quoteMatch = cleaned.match(/:\s*[“"]([^”"]+)[”"]\s*$/);
  if (quoteMatch?.[1]) return quoteMatch[1].trim();
  const colonIdx = cleaned.indexOf(':');
  if (colonIdx !== -1) {
    const candidate = cleaned.slice(colonIdx + 1).trim();
    const stripped = candidate.replace(/^["“”]+|["“”]+$/g, '').trim();
    return stripped || null;
  }
  return null;
};

const extractDateFromRaw = (raw?: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 1000000000) {
    const d = new Date(asNumber * 1000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
};

const extractInstagramDate = (description?: string | null, metaDate?: string | null): string | null => {
  const metaParsed = extractDateFromRaw(metaDate);
  if (metaParsed) return metaParsed;
  if (!description) return null;
  const onMatch = description.match(/\bon\s+([A-Za-z]+ \d{1,2}, \d{4})/);
  const dateStr = onMatch?.[1] || description.match(/\b([A-Za-z]+ \d{1,2}, \d{4})\b/)?.[1];
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
};

const fetchHtml = async (url: string, timeoutMs = 15000): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

async function insertTimelineEvent(
  supabase: any,
  payload: {
    vehicle_id: string;
    user_id?: string | null;
    event_type?: string;
    event_date?: any;
    title: string;
    description?: string | null;
    source?: string;
    metadata?: Record<string, any>;
    image_urls?: string[] | null;
  }
) {
  const record = {
    vehicle_id: payload.vehicle_id,
    user_id: payload.user_id || null,
    event_type: payload.event_type || 'other',
    event_date: safeEventDate(payload.event_date),
    title: payload.title,
    description: payload.description || null,
    source: payload.source || 'comment_extraction',
    metadata: payload.metadata || {},
    image_urls: payload.image_urls || null
  };

  let primaryError: any = null;
  let secondaryError: any = null;
  let secondaryOk = false;

  try {
    const primary = await supabase.from('timeline_events').insert(record);
    primaryError = primary.error;
  } catch (err) {
    primaryError = err;
  }

  try {
    const secondary = await supabase.from('vehicle_timeline_events').insert(record);
    secondaryError = secondary.error;
    secondaryOk = !secondaryError;
  } catch (err) {
    secondaryError = err;
  }

  if (!primaryError || secondaryOk) return null;

  const msg = String(secondaryError?.message || secondaryError || '').toLowerCase();
  const ignorableSecondary =
    msg.includes('view') ||
    msg.includes('read-only') ||
    msg.includes('schema cache') ||
    msg.includes('does not exist') ||
    msg.includes('relation') ||
    msg.includes('not found');

  if (ignorableSecondary) return primaryError;

  console.warn(`vehicle_timeline_events insert failed: ${secondaryError?.message || secondaryError}`);
  return primaryError;
}

async function upsertResearchItem(
  supabase: any,
  payload: {
    vehicle_id: string;
    created_by?: string | null;
    item_type: string;
    status?: string;
    title: string;
    summary?: string | null;
    source_url?: string | null;
    source_type?: string | null;
    event_date?: string | null;
    date_precision?: string;
    confidence?: number | null;
    metadata?: Record<string, any>;
  }
) {
  try {
    const { error } = await supabase
      .from('vehicle_research_items')
      .upsert(
        {
          vehicle_id: payload.vehicle_id,
          created_by: payload.created_by || null,
          item_type: payload.item_type,
          status: payload.status || 'open',
          title: payload.title,
          summary: payload.summary || null,
          source_url: payload.source_url || null,
          source_type: payload.source_type || null,
          event_date: payload.event_date || null,
          date_precision: payload.date_precision || 'unknown',
          confidence: payload.confidence ?? null,
          metadata: payload.metadata || {}
        },
        { onConflict: 'vehicle_id,source_url' }
      );
    if (error) {
      const msg = String(error.message || '').toLowerCase();
      const missing = msg.includes('does not exist') || msg.includes('relation') || msg.includes('schema cache');
      if (!missing) {
        console.warn(`vehicle_research_items upsert failed: ${error.message}`);
      }
    }
  } catch (err) {
    console.warn('vehicle_research_items upsert exception:', err);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get pending queue items (limit to 10 per invocation)
    const { data: queueItems, error: queueError } = await supabase
      .from('content_extraction_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (queueError) {
      throw new Error(`Queue fetch error: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No items in queue' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing ${queueItems.length} queue items`);

    const results = [];
    
    for (const item of queueItems) {
      try {
        // Mark as processing
        await supabase
          .from('content_extraction_queue')
          .update({ 
            status: 'processing',
            processing_attempts: item.processing_attempts + 1,
            last_attempt_at: new Date().toISOString()
          })
          .eq('id', item.id);

        // Route to appropriate handler based on content type
        let result;
        switch (item.content_type) {
          case 'listing_url':
            result = await processListingURL(supabase, item);
            break;
          case 'youtube_video':
            result = await processYouTubeVideo(supabase, item);
            break;
          case 'vin_data':
            result = await processVIN(supabase, item);
            break;
          case 'specs_data':
            result = await processSpecs(supabase, item);
            break;
          case 'price_data':
            result = await processPriceData(supabase, item);
            break;
          case 'timeline_event':
            result = await processTimelineEvent(supabase, item);
            break;
          case 'image_url':
            result = await processImageURL(supabase, item);
            break;
          case 'document_url':
            result = await processDocumentURL(supabase, item);
            break;
          default:
            result = { success: false, error: 'Unknown content type' };
        }

        // Update queue item with result
        if (result.success) {
          await supabase
            .from('content_extraction_queue')
            .update({
              status: 'completed',
              processed_at: new Date().toISOString(),
              extracted_data: result.data,
              contribution_value: result.points || 0,
              data_quality_score: result.quality_score || 0.5
            })
            .eq('id', item.id);

          // Award contribution points
          if (result.points && result.points > 0) {
            await awardContributionPoints(supabase, item, result);
          }

          results.push({ id: item.id, success: true, type: item.content_type });
        } else {
          await supabase
            .from('content_extraction_queue')
            .update({
              status: 'failed',
              error_message: result.error
            })
            .eq('id', item.id);

          results.push({ id: item.id, success: false, error: result.error });
        }

      } catch (error: any) {
        console.error(`Error processing item ${item.id}:`, error);
        
        await supabase
          .from('content_extraction_queue')
          .update({
            status: 'failed',
            error_message: error.message
          })
          .eq('id', item.id);

        results.push({ id: item.id, success: false, error: error.message });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

/**
 * Process Instagram sources (posts/profiles)
 */
async function processInstagramSource(supabase: any, item: QueueItem) {
  const rawUrl = item.raw_content;
  const igInfo = parseInstagramUrl(rawUrl);
  const kind = igInfo?.kind || 'unknown';

  let html: string | null = null;
  let fetchError: string | null = null;

  try {
    html = await fetchHtml(rawUrl);
  } catch (err: any) {
    fetchError = err?.message || String(err);
  }

  const ogTitle = html ? extractMeta(html, 'og:title') : null;
  const ogDescription = html
    ? (extractMeta(html, 'og:description') || extractMeta(html, 'description', 'name'))
    : null;
  const ogImages = html ? extractMetaAll(html, 'og:image') : [];
  const ogImage = ogImages[0] || null;
  const ogVideo =
    html ? (extractMeta(html, 'og:video:secure_url') || extractMeta(html, 'og:video')) : null;
  const metaDate = html
    ? (extractMeta(html, 'og:updated_time') || extractMeta(html, 'article:published_time'))
    : null;
  const caption = extractInstagramCaption(ogDescription);
  const handle = igInfo?.handle || extractInstagramHandle(ogTitle, ogDescription);
  const eventDate = extractInstagramDate(ogDescription, metaDate);

  const summaryParts: string[] = [];
  if (caption) summaryParts.push(caption);
  if (!caption && ogDescription) summaryParts.push(ogDescription);
  if (!summaryParts.length && fetchError) summaryParts.push(`Instagram fetch failed: ${fetchError}`);
  const summary = summaryParts.length > 0
    ? summaryParts.join(' ').slice(0, 900)
    : null;
  const sourceType =
    kind === 'profile' ? 'instagram_profile' : kind === 'post' ? 'instagram_post' : 'instagram_source';
  const titleKind = kind === 'profile' ? 'profile' : kind === 'post' ? 'post' : 'source';

  await upsertResearchItem(supabase, {
    vehicle_id: item.vehicle_id,
    created_by: item.user_id,
    item_type: 'source',
    status: 'open',
    title: `Instagram ${titleKind}: ${shortUrl(rawUrl)}`,
    summary,
    source_url: rawUrl,
    source_type: sourceType,
    event_date: eventDate || null,
    date_precision: eventDate ? 'day' : 'unknown',
    confidence: caption || ogImage ? 65 : 45,
    metadata: {
      kind,
      shortcode: igInfo?.shortcode || null,
      handle,
      og_title: ogTitle,
      og_description: ogDescription,
      og_image: ogImage,
      og_video: ogVideo,
      fetch_error: fetchError || null
    }
  });

  let imageCount = 0;
  if (kind === 'post' && ogImages.length > 0) {
    try {
      const backfillResp = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/backfill-images`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            vehicle_id: item.vehicle_id,
            image_urls: ogImages.slice(0, 5),
            source: 'instagram',
            run_analysis: false
          })
        }
      );

      if (backfillResp.ok) {
        const backfillResult = await backfillResp.json().catch(() => null);
        imageCount = Number(backfillResult?.uploaded || 0);
      } else {
        console.warn(`backfill-images failed for instagram: ${backfillResp.status}`);
      }
    } catch (err) {
      console.warn('Instagram image backfill error:', err);
    }
  }

  const points = 5 + imageCount * 2 + (caption ? 2 : 0);
  const qualityScore = imageCount > 0 ? 0.7 : caption ? 0.6 : 0.4;

  return {
    success: true,
    data: {
      instagram_kind: kind,
      handle,
      shortcode: igInfo?.shortcode || null,
      caption,
      images_imported: imageCount,
      og_title: ogTitle,
      og_description: ogDescription,
      og_image: ogImage,
      og_video: ogVideo,
      fetch_error: fetchError
    },
    points,
    quality_score: qualityScore
  };
}

/**
 * Process listing URL (BaT, Mecum, KSL, etc.)
 */
async function processListingURL(supabase: any, item: QueueItem) {
  console.log(`Processing listing URL: ${item.raw_content}`);
  
  try {
    if (parseInstagramUrl(item.raw_content)) {
      return await processInstagramSource(supabase, item);
    }

    // Call the existing scrape-vehicle function
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-vehicle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
      },
      body: JSON.stringify({ url: item.raw_content })
    });

    if (!response.ok) {
      throw new Error(`Scrape failed: ${response.statusText}`);
    }

    const scrapeResult = await response.json();
    
    if (!scrapeResult.success) {
      throw new Error(scrapeResult.error || 'Scrape failed');
    }

    const scrapedData = scrapeResult.data;

    // Get vehicle for comparison
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', item.vehicle_id)
      .single();

    if (vehicleError) {
      throw new Error(`Vehicle fetch failed: ${vehicleError.message}`);
    }

    // Validate VIN match if both have VIN
    let vinMatch = false;
    let shouldMerge = false;
    
    if (vehicle.vin && scrapedData.vin) {
      vinMatch = vehicle.vin.toLowerCase() === scrapedData.vin.toLowerCase();
      shouldMerge = vinMatch;
    } else if (!vehicle.vin && scrapedData.vin) {
      // Vehicle missing VIN, scraped data has VIN - moderate confidence
      shouldMerge = true;
    } else {
      // No VIN on either - compare year/make/model
      const yearMatch = vehicle.year === scrapedData.year;
      const makeMatch = vehicle.make?.toLowerCase() === scrapedData.make?.toLowerCase();
      const modelMatch = vehicle.model?.toLowerCase() === scrapedData.model?.toLowerCase();
      
      shouldMerge = yearMatch && makeMatch && modelMatch;
    }

    if (!shouldMerge) {
      return {
        success: false,
        error: 'Vehicle mismatch - VIN/Year/Make/Model does not match existing profile'
      };
    }

    // Import images robustly:
    // Hotlinking external images is unreliable in browsers (often shows blank). Store them in Supabase Storage instead.
    let imageCount = 0;
    if (scrapedData.images && scrapedData.images.length > 0) {
      try {
        const backfillResp = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/backfill-images`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              vehicle_id: item.vehicle_id,
              image_urls: scrapedData.images.slice(0, 50),
              source: 'external_import',
              run_analysis: false
            })
          }
        );

        if (backfillResp.ok) {
          const backfillResult = await backfillResp.json().catch(() => null);
          imageCount = Number(backfillResult?.uploaded || 0);
        } else {
          console.warn(`backfill-images failed: ${backfillResp.status}`);
        }
      } catch (err) {
        console.warn('Image backfill error:', err);
      }
    }

    // Process through forensic system (REPLACED direct updates)
    const { data: forensicResult } = await supabase.rpc('process_scraped_data_forensically', {
      p_vehicle_id: item.vehicle_id,
      p_scraped_data: scrapedData,
      p_source_url: item.raw_content,
      p_scraper_name: scrapeResult.source || 'comment_extraction',
      p_context: { comment: item.context, comment_id: item.comment_id }
    });

    // Build consensus for each field (auto-assigns if high confidence)
    const fieldsUpdated: string[] = [];
    const criticalFields = ['vin', 'mileage', 'exterior_color', 'interior_color', 'transmission', 'engine'];
    
    for (const field of criticalFields) {
      if (scrapedData[field]) {
        const { data: consensus } = await supabase.rpc('build_field_consensus', {
          p_vehicle_id: item.vehicle_id,
          p_field_name: field,
          p_auto_assign: true  // Auto-assign if confidence >= 80%
        });
        
        if (consensus?.auto_assigned) {
          fieldsUpdated.push(field);
        }
      }
    }

    const updates = fieldsUpdated;

    // Create timeline event for the listing discovery
    await insertTimelineEvent(supabase, {
      vehicle_id: item.vehicle_id,
      user_id: item.user_id,
      event_type: 'other',
      event_date: scrapedData.sold_date || scrapedData.listing_date || new Date().toISOString(),
      title: 'Listing discovered',
      description: `Listing discovered: ${item.raw_content}`,
      source: scrapeResult.source || 'comment_extraction',
      metadata: {
        kind: 'listing_discovered',
        source: scrapeResult.source,
        listing_url: item.raw_content,
        images_imported: imageCount,
        fields_updated: Object.keys(updates),
        comment_id: item.comment_id
      }
    });

    await upsertResearchItem(supabase, {
      vehicle_id: item.vehicle_id,
      created_by: item.user_id,
      item_type: 'source',
      status: 'open',
      title: `Source discovered: ${shortUrl(item.raw_content)}`,
      summary: 'Listing URL discovered during comment extraction.',
      source_url: item.raw_content,
      source_type: 'listing_url',
      date_precision: scrapedData.sold_date || scrapedData.listing_date ? 'day' : 'unknown',
      confidence: 70,
      metadata: {
        kind: 'listing_discovered',
        comment_id: item.comment_id
      }
    });

    // Create timeline events for event mentions in listing narratives (best-effort).
    try {
      const eventMentions = Array.isArray((scrapedData as any)?.event_mentions)
        ? (scrapedData as any).event_mentions
        : [];
      if (eventMentions.length > 0) {
        const listingHost = (() => {
          try { return new URL(item.raw_content).hostname.replace(/^www\./, ''); } catch { return null; }
        })();

        for (const mention of eventMentions.slice(0, 25)) {
          const name = String(mention?.name || '').trim();
          const year = Number(mention?.year);
          const eventDate = String(mention?.event_date || '').trim();
          if (!name || !Number.isFinite(year) || !eventDate) continue;

          const dedupeSignature = {
            source_url: item.raw_content,
            event_name: name,
            event_year: year
          };

          const { data: existing } = await supabase
            .from('timeline_events')
            .select('id')
            .eq('vehicle_id', item.vehicle_id)
            .contains('metadata', dedupeSignature)
            .maybeSingle();

          if (existing?.id) continue;

          await insertTimelineEvent(supabase, {
            vehicle_id: item.vehicle_id,
            user_id: item.user_id,
            event_type: 'other',
            event_date: eventDate,
            title: 'Event appearance',
            description: `${name} (${year})`,
            source: listingHost || scrapeResult.source || 'comment_extraction',
            metadata: {
              ...dedupeSignature,
              context: mention?.context || null,
              date_precision: 'year',
              provenance: 'listing_event_mention',
              comment_id: item.comment_id
            }
          });
        }
      }
    } catch (eventErr: any) {
      console.warn(`timeline_events event-mention insert failed (non-fatal): ${eventErr.message}`);
    }

    // Calculate points
    let points = 10; // Base points for finding a listing
    points += imageCount * 2; // 2 points per image
    points += updates.length * 5; // 5 points per field updated
    
    // Quality score from forensic system
    const qualityScore = forensicResult?.evidence_collected 
      ? Math.min(0.95, 0.5 + (forensicResult.evidence_collected * 0.05))
      : (vinMatch ? 0.95 : (shouldMerge ? 0.75 : 0.5));

    return {
      success: true,
      data: {
        images_imported: imageCount,
        fields_updated: updates,
        vin_match: vinMatch,
        forensic_evidence: forensicResult?.evidence_collected || 0,
        anomalies: forensicResult?.anomalies_detected || 0
      },
      points,
      quality_score: qualityScore
    };

  } catch (error: any) {
    console.error('Listing processing error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Process YouTube video
 */
async function processYouTubeVideo(supabase: any, item: QueueItem) {
  const videoIdMatch = item.raw_content.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  
  if (!videoIdMatch) {
    return { success: false, error: 'Invalid YouTube URL' };
  }

  const videoId = videoIdMatch[1];
  
  const error = await insertTimelineEvent(supabase, {
    vehicle_id: item.vehicle_id,
    user_id: item.user_id,
    event_type: 'other',
    event_date: new Date().toISOString(),
    title: 'Video added',
    description: `Video link added: ${item.context}`,
    source: 'youtube',
    metadata: {
      kind: 'video_added',
      video_url: item.raw_content,
      video_id: videoId,
      platform: 'youtube',
      comment_id: item.comment_id
    }
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const eventError = await insertTimelineEvent(supabase, {
    vehicle_id: item.vehicle_id,
    user_id: item.user_id,
    event_type: 'vin_added',
    event_date: new Date().toISOString(),
    title: 'VIN/chassis added',
    description: `VIN/chassis identifier added from comment extraction`,
    source: 'comment_extraction',
    metadata: {
      vin,
      comment_id: item.comment_id,
      confidence: vinResult?.consensus?.consensus_confidence || 90
    }
  });
  if (eventError) {
    console.warn('VIN timeline event insert failed:', eventError.message);
  }

  return {
    success: true,
    data: { video_id: videoId },
    points: 15, // Videos are valuable
    quality_score: 0.8
  };
}

/**
 * Process VIN data
 */
async function processVIN(supabase: any, item: QueueItem) {
  const vin = item.raw_content.trim().toUpperCase();

  // Get current vehicle
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('vin')
    .eq('id', item.vehicle_id)
    .single();

  if (vehicle?.vin && vehicle.vin !== vin) {
    // VIN conflict!
    await supabase
      .from('data_merge_conflicts')
      .insert({
        vehicle_id: item.vehicle_id,
        field_name: 'vin',
        existing_value: vehicle.vin,
        proposed_value: vin,
        proposed_by: item.user_id,
        existing_confidence: 0.9,
        proposed_confidence: item.confidence_score
      });

    return {
      success: true,
      data: { conflict_created: true },
      points: 5,
      quality_score: 0.5
    };
  }

  // Process VIN through forensic system (REPLACED direct update)
  const { data: vinResult, error } = await supabase.rpc('update_vehicle_field_forensically', {
    p_vehicle_id: item.vehicle_id,
    p_field_name: 'vin',
    p_new_value: vin,
    p_source: 'user_comment_extraction',
    p_context: item.context,
    p_auto_assign: true
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: { 
      vin, 
      confidence: vinResult?.consensus?.consensus_confidence || 90,
      modification_detected: vinResult?.modification_detected || false
    },
    points: 25,
    quality_score: (vinResult?.consensus?.consensus_confidence || 90) / 100
  };
}

/**
 * Process specs data
 */
async function processSpecs(supabase: any, item: QueueItem) {
  // Extract spec field and value from metadata
  const field = item.raw_content; // e.g., "350 hp"
  
  const error = await insertTimelineEvent(supabase, {
    vehicle_id: item.vehicle_id,
    user_id: item.user_id,
    event_type: 'other',
    event_date: new Date().toISOString(),
    title: 'Specification noted',
    description: `Specification added: ${field}`,
    source: 'comment_extraction',
    metadata: {
      kind: 'specs_added',
      spec_field: field,
      comment_id: item.comment_id
    }
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: { spec: field },
    points: 5,
    quality_score: 0.6
  };
}

/**
 * Process price data
 */
async function processPriceData(supabase: any, item: QueueItem) {
  // Extract price from raw content
  const priceMatch = item.raw_content.match(/\$?(\d{1,3}(?:,\d{3})*)/);
  
  if (!priceMatch) {
    return { success: false, error: 'Could not parse price' };
  }

  const price = parseInt(priceMatch[1].replace(/,/g, ''));

  // Determine if this is a sale price or asking price from context
  const contextLower = item.context.toLowerCase();
  const isSoldPrice = contextLower.includes('sold') || contextLower.includes('final');

  // Process price through forensic system (REPLACED direct update)
  const fieldName = isSoldPrice ? 'sale_price' : 'asking_price';
  
  const { data: result, error } = await supabase.rpc('update_vehicle_field_forensically', {
    p_vehicle_id: item.vehicle_id,
    p_field_name: fieldName,
    p_new_value: price.toString(),
    p_source: 'user_comment_extraction',
    p_context: item.context,
    p_auto_assign: isSoldPrice  // Only auto-assign sold prices (higher confidence)
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: { 
      price, 
      type: isSoldPrice ? 'sale' : 'asking',
      confidence: result?.consensus?.consensus_confidence || (isSoldPrice ? 85 : 60)
    },
    points: isSoldPrice ? 20 : 10,
    quality_score: (result?.consensus?.consensus_confidence || (isSoldPrice ? 85 : 60)) / 100
  };
}

/**
 * Process timeline event
 */
async function processTimelineEvent(supabase: any, item: QueueItem) {
  const error = await insertTimelineEvent(supabase, {
    vehicle_id: item.vehicle_id,
    user_id: item.user_id,
    event_type: 'other',
    event_date: new Date().toISOString(),
    title: 'Timeline note',
    description: item.raw_content,
    source: 'comment_extraction',
    metadata: {
      kind: 'timeline_event',
      comment_id: item.comment_id
    }
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: { event: item.raw_content },
    points: 10,
    quality_score: 0.7
  };
}

/**
 * Process image URL
 */
async function processImageURL(supabase: any, item: QueueItem) {
  const { error } = await supabase
    .from('vehicle_images')
    .insert({
      vehicle_id: item.vehicle_id,
      image_url: item.raw_content,
      user_id: item.user_id,
      category: 'user_link',
      source: 'comment',
      ai_scan_metadata: {
        source: 'comment_extraction',
        comment_id: item.comment_id
      }
    });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: { image_url: item.raw_content },
    points: 5,
    quality_score: 0.6
  };
}

/**
 * Process document URL
 */
async function processDocumentURL(supabase: any, item: QueueItem) {
  const error = await insertTimelineEvent(supabase, {
    vehicle_id: item.vehicle_id,
    user_id: item.user_id,
    event_type: 'other',
    event_date: new Date().toISOString(),
    title: 'Document added',
    description: `Document added: ${item.context}`,
    source: 'comment_extraction',
    metadata: {
      kind: 'document_added',
      document_url: item.raw_content,
      comment_id: item.comment_id
    }
  });

  if (error) {
    return { success: false, error: error.message };
  }

  await upsertResearchItem(supabase, {
    vehicle_id: item.vehicle_id,
    created_by: item.user_id,
    item_type: 'source',
    status: 'open',
    title: `Document source discovered: ${shortUrl(item.raw_content)}`,
    summary: item.context ? `Document discovered: ${item.context}` : 'Document URL discovered during comment extraction.',
    source_url: item.raw_content,
    source_type: 'document_url',
    date_precision: 'unknown',
    confidence: 60,
    metadata: {
      kind: 'document_added',
      comment_id: item.comment_id
    }
  });

  return {
    success: true,
    data: { document_url: item.raw_content },
    points: 15,
    quality_score: 0.8
  };
}

/**
 * Award contribution points to user
 */
async function awardContributionPoints(supabase: any, item: QueueItem, result: any) {
  try {
    const { error } = await supabase.rpc('award_contribution_points', {
      p_user_id: item.user_id,
      p_vehicle_id: item.vehicle_id,
      p_data_field: item.content_type,
      p_data_type: item.content_type,
      p_data_id: null,
      p_source_comment_id: item.comment_id || null,
      p_extraction_job_id: item.id,
      p_source_url: item.raw_content,
      p_contribution_value: result.points || 0,
      p_data_quality_score: result.quality_score || 0.5
    });

    if (error) {
      console.error('Error awarding points:', error);
    } else {
      console.log(`Awarded ${result.points} points to user ${item.user_id}`);
    }
  } catch (err) {
    console.error('Error awarding points:', err);
  }
}

