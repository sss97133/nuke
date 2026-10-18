/**
 * JAMESEDITION EXTRACTOR
 *
 * Extracts luxury vehicle listings from JamesEdition.com.
 * Supports single listing extraction and bulk discovery via category pages.
 *
 * Actions:
 *   - extract: Extract a single listing URL
 *   - discover: Crawl category pages and queue listings for extraction
 *   - process_queue: Process queued JamesEdition URLs from import_queue
 *
 * JamesEdition is behind Cloudflare — requires Firecrawl for scraping.
 * Listing pages have structured "Car Details" section with all specs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeVehicleFields } from '../_shared/normalizeVehicle.ts';
import { qualityGate } from '../_shared/extractionQualityGate.ts';
import { archiveFetch } from '../_shared/archiveFetch.ts';
import { normalizeListingUrl } from '../_shared/urlNormalization.ts';
import { writeObservation } from '../_shared/observationWriter.ts';
import { requireWriteAuth } from '../_shared/writeGuard.ts';
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { parseListingMarkdown, parseListingUrls } from "./listingParser.ts";

const VERSION = '1.1.1';
const JAMESEDITION_SOURCE_ID = '77c149de-7866-4a7c-ad24-3423ee6c1f22';

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      projectSecretKey()!,
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'extract';

    // ── EXTRACT: Single listing ─────────────────────────────────────
    if (action === 'extract') {
      // Sanitize URL — import_queue may have markdown title appended (e.g., 'url "Title"')
      const rawUrl = (body.url || '').split(/\s+/)[0].replace(/["']/g, '');
      const url = rawUrl;
      if (!url?.includes('jamesedition.com')) {
        return new Response(JSON.stringify({ success: false, error: 'URL must be from jamesedition.com' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      console.log(`[jamesedition] Extracting: ${url}`);

      // Try archiveFetch first, fall back to Firecrawl
      let markdown = '';
      try {
        const archived = await archiveFetch(url, { platform: 'jamesedition', useFirecrawl: true });
        markdown = archived.markdown || '';
      } catch (e) {
        console.warn(`[jamesedition] archiveFetch failed, trying direct Firecrawl: ${e.message}`);
        const fcResult = await firecrawlScrape({
          url,
          formats: ['markdown'],
          waitFor: 3000,
        });
        markdown = fcResult?.markdown || fcResult?.data?.markdown || '';
      }

      if (!markdown || markdown.length < 200) {
        return new Response(JSON.stringify({ success: false, error: 'Failed to fetch listing content' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const extracted = parseListingMarkdown(markdown, url);
      if (extracted.identity_issues.length > 0) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Incomplete or conflicting listing identity',
          identity_issues: extracted.identity_issues,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const normalized = normalizeVehicleFields({
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        exterior_color: extracted.exterior_color,
        interior_color: extracted.interior_color,
        transmission: extracted.transmission,
        drivetrain: extracted.drivetrain,
        body_style: extracted.body_style,
        engine_type: extracted.engine,
      });

      // Upsert vehicle
      const vehicleData: Record<string, any> = {
        year: normalized.year || extracted.year,
        make: normalized.make || extracted.make,
        model: extracted.model,
        trim: normalized.trim || null,
        vin: extracted.vin,
        mileage: extracted.mileage,
        asking_price: extracted.asking_price,
        color: normalized.exterior_color || extracted.exterior_color,
        interior_color: normalized.interior_color || extracted.interior_color,
        color_primary: normalized.exterior_color || extracted.exterior_color,
        engine_type: normalized.engine_type || extracted.engine,
        transmission: normalized.transmission || extracted.transmission,
        drivetrain: normalized.drivetrain || extracted.drivetrain,
        body_style: normalized.body_style || extracted.body_style,
        description: extracted.description?.slice(0, 5000),
        listing_url: url,
        discovery_url: url,
        source: 'jamesedition',
        listing_source: 'jamesedition',
        profile_origin: 'jamesedition_import',
        discovery_source: 'jamesedition',
        seller_name: extracted.seller_name,
        listing_location: extracted.location,
        title: extracted.title,
        status: 'active',
        primary_image_url: extracted.image_urls[0] || null,
      };

      // Check for existing vehicle by normalized URL, exact URL, or VIN
      let existing: { id: string } | null = null;

      // 1. Normalized URL match: use canonical listing ID to catch URL variants
      const normUrl = normalizeListingUrl(url);
      if (normUrl?.canonicalListingId) {
        // Extract the platform-specific numeric ID for ILIKE search
        const listingId = normUrl.canonicalListingId.split(':')[1];
        if (listingId) {
          const { data: byNormUrl } = await supabase
            .from('vehicles')
            .select('id, listing_url')
            .ilike('listing_url', `%${listingId}%`)
            .not('status', 'in', '(merged,deleted)')
            .limit(5);

          if (byNormUrl?.length === 1) {
            existing = { id: byNormUrl[0].id };
          } else if (byNormUrl && byNormUrl.length > 1) {
            // Multiple matches: verify via canonical listing ID comparison
            for (const m of byNormUrl) {
              const mNorm = normalizeListingUrl(m.listing_url);
              if (mNorm?.canonicalListingId === normUrl.canonicalListingId) {
                existing = { id: m.id };
                break;
              }
            }
          }
        }
      }

      // 2. Exact URL match fallback
      if (!existing) {
        const { data: byUrl } = await supabase
          .from('vehicles')
          .select('id')
          .or(`listing_url.eq.${url},discovery_url.eq.${url}`)
          .limit(1)
          .maybeSingle();
        existing = byUrl;
      }

      // 3. VIN match
      if (!existing && extracted.vin) {
        const { data: byVin } = await supabase
          .from('vehicles')
          .select('id')
          .eq('vin', extracted.vin)
          .limit(1)
          .maybeSingle();
        existing = byVin;
      }

      // Quality gate: validate before writing to vehicles
      const gateResult = qualityGate(vehicleData, { source: 'jamesedition', sourceType: 'dealer' });
      if (gateResult.action === 'reject') {
        console.warn(`[jamesedition] Quality gate rejected (score=${gateResult.score}): ${gateResult.issues.join(', ')}`);
        return new Response(JSON.stringify({
          success: false,
          error: 'Quality gate rejected extraction',
          quality_score: gateResult.score,
          quality_issues: gateResult.issues,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      Object.assign(vehicleData, gateResult.cleaned);

      // Store the normalized URL to prevent future duplicates
      if (normUrl?.normalized) {
        vehicleData.listing_url = normUrl.normalized;
        vehicleData.discovery_url = normUrl.normalized;
      }

      let vehicleId: string;
      if (existing) {
        // Update only null fields
        const updates: Record<string, any> = {};
        for (const [k, v] of Object.entries(vehicleData)) {
          if (v !== null && v !== undefined) updates[k] = v;
        }
        const { error } = await supabase.from('vehicles').update(updates).eq('id', existing.id);
        if (error) console.error(`[jamesedition] Update error: ${error.message}`);
        vehicleId = existing.id;
      } else {
        const { data: created, error } = await supabase.from('vehicles').insert(vehicleData).select('id').single();
        if (error) {
          console.error(`[jamesedition] Insert error: ${error.message}`);
          return new Response(JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        vehicleId = created.id;
      }

      // Fire-and-forget observation write
      {
        const obsFields: Record<string, any> = {};
        const skipKeys = new Set(['discovery_url', 'discovery_source', 'listing_url', 'listing_source', 'profile_origin', 'status', 'is_public', 'origin_metadata']);
        for (const [k, v] of Object.entries(vehicleData)) {
          if (v != null && !skipKeys.has(k)) obsFields[k] = v;
        }
        writeObservation(supabase, {
          vehicleId,
          source: { platform: 'jamesedition', url: extracted.url || url, trustScore: 0.6 },
          fields: obsFields,
          observationKind: 'listing',
          extractionMethod: 'firecrawl_markdown_parse',
        }).catch((e: any) => console.warn(`[jamesedition] observationWriter error for ${vehicleId}: ${e?.message}`));
      }

      // Save images
      if (extracted.image_urls.length > 0) {
        // Check existing images first
        const { data: existingImgs } = await supabase
          .from('vehicle_images')
          .select('image_url')
          .eq('vehicle_id', vehicleId);
        const existingUrls = new Set((existingImgs || []).map((r: any) => r.image_url));

        const newImages = extracted.image_urls
          .slice(0, 50)
          .filter(u => !existingUrls.has(u))
          .map((imgUrl, idx) => ({
            vehicle_id: vehicleId,
            image_url: imgUrl,
            source: 'jamesedition',
            is_primary: idx === 0 && existingUrls.size === 0,
            position: existingUrls.size + idx,
          }));

        if (newImages.length > 0) {
          const { error: imgError } = await supabase.from('vehicle_images').insert(newImages);
          if (imgError) console.warn(`[jamesedition] Image save error: ${imgError.message}`);
          else {
            // Fire-and-forget: async image-vehicle match validation
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-image-vehicle-match`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${projectSecretKey()}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ vehicle_id: vehicleId, batch_size: 10 }),
            }).catch(() => {});
          }
        }
      }

      return new Response(JSON.stringify({
        success: true,
        vehicle_id: vehicleId,
        existing: !!existing,
        extracted: {
          year: extracted.year, make: extracted.make, model: extracted.model,
          price: extracted.asking_price, vin: extracted.vin,
          mileage: extracted.mileage, images: extracted.image_urls.length,
          seller: extracted.seller_name, location: extracted.location,
        },
        version: VERSION,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── DISCOVER: Crawl category pages for listing URLs ─────────────
    if (action === 'discover') {
      const category = body.category || 'cars';
      const makes = body.makes || ['porsche', 'ferrari', 'lamborghini', 'mercedes', 'bmw', 'aston-martin', 'bentley', 'rolls-royce', 'mclaren', 'bugatti'];
      const limit = Math.min(body.limit || 5, 20);
      const results: Record<string, number> = {};

      for (const make of makes.slice(0, limit)) {
        const searchUrl = `https://www.jamesedition.com/${category}/${make}`;
        console.log(`[jamesedition] Discovering: ${searchUrl}`);

        try {
          const fcResult = await firecrawlScrape({
            url: searchUrl,
            formats: ['markdown'],
            waitFor: 3000,
          });
          const md = fcResult?.markdown || fcResult?.data?.markdown || '';
          const listingUrls = parseListingUrls(md);

          // Queue discovered URLs
          if (listingUrls.length > 0) {
            const queueRows = listingUrls.map(u => ({
              listing_url: u,
              source_id: JAMESEDITION_SOURCE_ID,
              status: 'pending',
              listing_title: null,
            }));
            const { error } = await supabase.from('import_queue').upsert(
              queueRows,
              { onConflict: 'listing_url', ignoreDuplicates: true },
            );
            if (error) console.warn(`[jamesedition] Queue error for ${make}: ${error.message}`);
          }

          results[make] = listingUrls.length;
          console.log(`[jamesedition] ${make}: ${listingUrls.length} listings found`);
        } catch (e) {
          console.error(`[jamesedition] Error discovering ${make}: ${e.message}`);
          results[make] = -1;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        action: 'discover',
        results,
        total_discovered: Object.values(results).filter(v => v > 0).reduce((a, b) => a + b, 0),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── PROCESS_QUEUE: Extract queued JamesEdition listings ──────────
    if (action === 'process_queue') {
      const batchSize = Math.min(body.limit || 10, 30);

      const { data: items, error: qErr } = await supabase
        .from('import_queue')
        .select('id, listing_url')
        .eq('source_id', JAMESEDITION_SOURCE_ID)
        .eq('status', 'pending')
        .is('locked_by', null)
        .order('created_at', { ascending: true })
        .limit(batchSize);

      if (qErr || !items?.length) {
        return new Response(JSON.stringify({ success: true, processed: 0, message: 'No items in queue' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const workerId = `je-worker-${crypto.randomUUID().slice(0, 8)}`;
      // Lock items
      await supabase.from('import_queue').update({
        locked_by: workerId,
        locked_at: new Date().toISOString(),
        status: 'processing',
      }).in('id', items.map(i => i.id));

      let success = 0, failed = 0;

      for (const item of items) {
        try {
          // Self-invoke extract action
          const extractUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-jamesedition`;
          const resp = await fetch(extractUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${projectSecretKey()}`,
            },
            body: JSON.stringify({ action: 'extract', url: item.listing_url }),
          });
          const result = await resp.json();

          if (result.success) {
            await supabase.from('import_queue').update({
              status: 'complete',
              locked_by: null,
              locked_at: null,
              vehicle_id: result.vehicle_id,
              last_attempt_at: new Date().toISOString(),
            }).eq('id', item.id);
            success++;
          } else {
            throw new Error(result.error || 'Extract failed');
          }
        } catch (e) {
          await supabase.from('import_queue').update({
            status: 'failed',
            locked_by: null,
            locked_at: null,
            error_message: `jamesedition: ${e.message}`,
            last_attempt_at: new Date().toISOString(),
          }).eq('id', item.id);
          failed++;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        processed: success + failed,
        success_count: success,
        failed_count: failed,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[jamesedition] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
