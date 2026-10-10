import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { intakeThrottle, createIntakeBudget, readLandedBatch, readbackFor } from "../poll-listing-feeds/ledger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const startedAt = Date.now();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { batch_size = 10, priority_only = false, source_id, use_intelligence = false } = body;
    if (!Number.isInteger(batch_size) || batch_size < 0 || batch_size > 100) throw new Error('batch_size must be an integer from 0 to 100');
    const { data: control, error: controlError } = await supabase.from('platform_config')
      .select('config_value').eq('config_key', 'source_intake').maybeSingle();
    if (controlError) throw new Error('Intake throttle unavailable; no work claimed');
    const throttle = intakeThrottle(control?.config_value ?? {});
    const budget = createIntakeBudget(throttle, startedAt);
    if (!throttle.enabled || batch_size === 0 || throttle.max_ingests === 0) return new Response(
      JSON.stringify({ success: true, processed: 0, status: 'throttled', throttle: budget.snapshot() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const workerId = 'process-import-queue:' + Date.now();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');

    const { data: queueItems, error: queueError } = await supabase.rpc('claim_import_queue_batch', {
      p_batch_size: Math.min(batch_size, throttle.max_ingests),
      p_max_attempts: 8,
      p_priority_only: priority_only,
      p_source_id: source_id || null,
      p_worker_id: workerId,
    });

    if (queueError) throw queueError;
    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: 'No items' }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results = [];
    for (const item of queueItems) {
      const sourceAliases: Record<string, string> = { 'bringatrailer.com': 'bat', 'carsandbids.com': 'carsandbids',
        'barrett-jackson.com': 'barrettjackson', 'rmsothebys.com': 'rmsothebys', 'goodingco.com': 'gooding',
        'broadarrowauctions.com': 'broadarrow', 'themarket.co.uk': 'bonhams', 'bonhams.com': 'bonhams',
        'cars.bonhams.com': 'bonhams', 'cars.ksl.com': 'ksl',
        'gatewayclassiccars.com': 'gateway_classics', 'grautogallery.com': 'gr_auto_gallery',
        'streetsideclassics.com': 'streetside_classics', 'vanguardmotorsales.com': 'vanguard_motors' };
      let host = 'unknown';
      try { host = new URL(item.listing_url).hostname.replace(/^www\./, ''); } catch { /* handled below */ }
      const source = sourceAliases[host] || (host.endsWith('.craigslist.org') ? 'craigslist' : host.split('.')[0]);
      const grant = budget.reserve(source);
      if (!grant) {
        // claim_import_queue_batch increments attempts at claim time. A
        // throttle deferral is not an extraction attempt: refund it and
        // release only this worker's claim, retaining all source evidence.
        const { error } = await supabase.from('import_queue').update({ status: 'pending',
          attempts: Math.max(0, item.attempts - 1), locked_at: null, locked_by: null })
          .eq('id', item.id).eq('status', 'processing').eq('locked_by', workerId);
        if (error) throw error;
        results.push({ id: item.id, status: 'deferred', reason: budget.refusal(source) });
        continue;
      }
      const attemptStarted = Date.now();
      try {
        const url = item.listing_url;
        // Normalize URL for domain routing (strip protocol, www, trailing slash, query/hash)
        const normalizedUrl = normalizeListingUrlKey(url) || '';
        if (!url) {
          await supabase.from('import_queue').update({
            status: 'failed',
            error_message: 'listing_url is required',
            failure_category: 'bad_data',
            attempts: item.attempts || 0,
            locked_at: null,
            locked_by: null,
          }).eq('id', item.id);
          results.push({ id: item.id, status: 'failed', url: null, error: 'listing_url is required' });
          continue;
        }
        let extractorUrl = null;

        // Use normalized URL for domain routing (handles www, mixed case, trailing slashes)
        const isBat = normalizedUrl.includes('bringatrailer.com');
        if (isBat) {
          // complete-bat-import (the old single entry point, which also
          // chained extract-auction-comments) was deleted from deployment
          // in the March 2026 triage and 404s live — confirmed 2026-07-07.
          // extract-bat-core is the standalone replacement; see
          // _shared/approved-extractors.ts. It does NOT auto-chain
          // comments, so that's triggered explicitly below on success.
          extractorUrl = supabaseUrl + '/functions/v1/extract-bat-core';
        } else if (normalizedUrl.includes('carsandbids.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-cars-and-bids-core';
        } else if (normalizedUrl.includes('pcarmarket.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/import-pcarmarket-listing';
        } else if (normalizedUrl.includes('hagerty.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-hagerty-listing';
        } else if (normalizedUrl.includes('classic.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/import-classic-auction';
        } else if (normalizedUrl.includes('collectingcars.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-vehicle-data-ai';
        } else if (normalizedUrl.includes('barnfinds.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-barn-finds-listing';
        } else if (normalizedUrl.includes('craigslist.org')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-craigslist';
        } else if (normalizedUrl.includes('mecum.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-mecum';
        } else if (normalizedUrl.includes('barrett-jackson.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-barrett-jackson';
        } else if (normalizedUrl.includes('broadarrowauctions.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-broad-arrow';
        } else if (normalizedUrl.includes('gaaclassiccars.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-gaa-classics';
        } else if (normalizedUrl.includes('bhauction.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-bh-auction';
        } else if (normalizedUrl.includes('bonhams.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-bonhams';
        } else if (normalizedUrl.includes('rmsothebys.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-rmsothebys';
        } else if (normalizedUrl.includes('goodingco.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-gooding';
        } else if (normalizedUrl.includes('velocityrestorations.com') || normalizedUrl.includes('coolnvintage.com') || normalizedUrl.includes('brabus.com') || normalizedUrl.includes('icon4x4.com') || normalizedUrl.includes('ringbrothers.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-specialty-builder';
        } else if (normalizedUrl.includes('vanguardmotorsales.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-vehicle-data-ai';
        } else if (normalizedUrl.includes('exclusivecarregistry.com/details/')) {
          // ECR detail pages — vehicle-level pages, partially login-gated.
          // extract-vehicle-data-ai uses Firecrawl + AI to pull make/model/color/location
          // from URL structure and og: meta tags even without an ECR account.
          extractorUrl = supabaseUrl + '/functions/v1/extract-vehicle-data-ai';
        } else {
          extractorUrl = supabaseUrl + '/functions/v1/extract-vehicle-data-ai';
        }

        const extractResponse = await fetch(extractorUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, save_to_db: true, ...(host === 'rmsothebys.com' ? { action: 'extract' } : {}) }),
          signal: AbortSignal.timeout(grant.timeout_ms),
        });

        const extractData = await extractResponse.json().catch(() => ({
          success: false,
          error: `HTTP ${extractResponse.status}: non-JSON response`,
        }));
        budget.record(source, Date.now() - attemptStarted, { error: extractData.error });

        if (extractData.success) {
          const extractedVehicle = extractData.extracted || extractData;
          // extract-bat-core returns created_vehicle_ids/updated_vehicle_ids
          // arrays, not a flat vehicle_id — without this fallback, every
          // successful BaT extraction through this path would silently
          // write vehicle_id: null to the queue row.
          let vehicleId = extractedVehicle.vehicle_id || extractedVehicle.vehicleId || extractData.vehicle_id || extractData.vehicleId
            || extractData._db?.vehicle_id
            || extractData.created_vehicle_ids?.[0] || extractData.updated_vehicle_ids?.[0] || null;
          if (!vehicleId) throw new Error('Extractor reported success without a persisted vehicle id');
          const landed = readbackFor(vehicleId, await readLandedBatch(supabase, [vehicleId]));
          if (landed.kind === 'error') throw new Error(`Vehicle read-back failed: ${landed.message}`);
          const qualityScore = extractData.quality_score ?? extractedVehicle.quality_score ?? null;
          // If extractor returned a quality score, use it to flag low-quality extractions
          const queueStatus = (qualityScore !== null && qualityScore < 0.3) ? 'pending_review' : 'complete';

          // extract-bat-core v4.1 (2026-09-27) writes every comment and bid itself, skipping comments the vehicle
          // already holds by BaT's own comment id. Firing extract-auction-comments after it wrote the lot's comments
          // wrote them a second time: its hash carries the thread position, which shifts as a thread grows, so
          // 36.5% of the comment rows on the latest 150 settled lots were duplicates (bat-data coverage audit,
          // 2026-09-29, docs/ledger/2026-09-30_bat-data-coverage-audit.md). Fall back to it only when the core
          // wrote none, e.g. a page whose comments JSON didn't parse.
          const coreComments = Number(extractData?.comments_written ?? 0);
          if (isBat && vehicleId && !(coreComments > 0)) {
            fetch(supabaseUrl + '/functions/v1/extract-auction-comments', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ auction_url: url, vehicle_id: vehicleId }),
              signal: AbortSignal.timeout(120_000),
            }).catch((e: any) => console.warn(`[process-import-queue] Comment extraction trigger failed for ${item.id}:`, e instanceof Error ? e.message : String(e)));
          }

          await supabase.from('import_queue').update({
            status: queueStatus,
            processed_at: new Date().toISOString(),
            attempts: item.attempts,
            vehicle_id: vehicleId,
            error_message: queueStatus === 'pending_review' ? `Low quality score: ${qualityScore}` : null,
            locked_at: null,
            locked_by: null,
          }).eq('id', item.id);
          results.push({
            id: item.id,
            status: queueStatus,
            url,
            vehicle_id: vehicleId,
            quality_score: qualityScore,
            decision: 'N/A'
          });
        } else {
          const errorMsg = typeof extractData.error === 'string' ? extractData.error : JSON.stringify(extractData.error) || 'Extraction failed';
          // Detect non-vehicle pages (memorabilia, collectibles, etc.) and skip instead of fail
          const isNonVehicle = errorMsg.includes('No vehicle data found') ||
            errorMsg.includes('could not find real vehicle data') ||
            errorMsg.includes('Missing required fields');

          if (isNonVehicle) {
            await supabase.from('import_queue').update({
              status: 'skipped',
              error_message: `Non-vehicle page: ${errorMsg.slice(0, 200)}`,
              attempts: item.attempts,
              failure_category: null,
              locked_at: null,
              locked_by: null,
            }).eq('id', item.id);
            results.push({ id: item.id, status: 'skipped', url, error: errorMsg });
          } else {
            // Auto-categorize failures
            let failureCategory: string | null = null;
            if (errorMsg.includes('timeout') || errorMsg.includes('Timeout') || errorMsg.includes('504')) {
              failureCategory = 'timeout';
            } else if (errorMsg.includes('browser has been closed') || errorMsg.includes('page.goto')) {
              failureCategory = 'browser_crash';
            } else if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
              failureCategory = 'rate_limited';
            } else if (errorMsg.includes('403') || errorMsg.includes('blocked') || errorMsg.includes('Forbidden')) {
              failureCategory = 'blocked';
            } else if (errorMsg.includes('bad_data') || errorMsg.includes('Invalid')) {
              failureCategory = 'bad_data';
            } else {
              failureCategory = 'extraction_failed';
            }

            // Exponential backoff: retry transient errors more aggressively
            const isTransient = failureCategory === 'timeout' || failureCategory === 'rate_limited' || failureCategory === 'blocked';
            const attempts = item.attempts ?? 0; // already incremented by claim RPC
            const maxAttempts = isTransient ? 8 : 5;
            const shouldFail = attempts >= maxAttempts;

            await supabase.from('import_queue').update({
              status: shouldFail ? 'failed' : 'pending',
              error_message: errorMsg,
              attempts: item.attempts,
              failure_category: failureCategory,
              locked_at: null,
              locked_by: null,
              next_attempt_at: shouldFail
                ? null
                : new Date(
                    Date.now() + Math.min(2 * 60 * 60 * 1000, (isTransient ? 10 : 5) * 60 * 1000 * Math.pow(2, attempts))
                  ).toISOString(),
            }).eq('id', item.id);
            results.push({ id: item.id, status: shouldFail ? 'failed' : 'pending', url, error: errorMsg, retry_scheduled: !shouldFail });
          }
        }
      } catch (error: any) {
        budget.record(source, Date.now() - attemptStarted, { error: error?.message || String(error) });
        const errMsg = error?.message || String(error);
        // Auto-categorize catch-level failures
        let failureCategory = 'extraction_failed';
        if (errMsg.includes('timeout') || errMsg.includes('Timeout') || errMsg.includes('AbortError')) {
          failureCategory = 'timeout';
        } else if (errMsg.includes('browser has been closed')) {
          failureCategory = 'browser_crash';
        }

        // Exponential backoff: retry transient errors more aggressively
        const isTransient = failureCategory === 'timeout';
        const attempts = item.attempts ?? 0; // already incremented by claim RPC
        const maxAttempts = isTransient ? 8 : 5;
        const shouldFail = attempts >= maxAttempts;

        await supabase.from('import_queue').update({
          status: shouldFail ? 'failed' : 'pending',
          error_message: errMsg.slice(0, 500),
          attempts: item.attempts || 0,
          failure_category: failureCategory,
          locked_at: null,
          locked_by: null,
          next_attempt_at: shouldFail
            ? null
            : new Date(
                Date.now() + Math.min(2 * 60 * 60 * 1000, (isTransient ? 10 : 5) * 60 * 1000 * Math.pow(2, attempts))
              ).toISOString(),
        }).eq('id', item.id);
        results.push({ id: item.id, status: shouldFail ? 'failed' : 'pending', url: item.listing_url, error: errMsg, retry_scheduled: !shouldFail });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.filter(r => r.status !== 'deferred').length,
      deferred: results.filter(r => r.status === 'deferred').length, throttle: budget.snapshot(), results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
