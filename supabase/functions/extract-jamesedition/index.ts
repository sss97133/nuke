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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeVehicleFields } from '../_shared/normalizeVehicle.ts';
import { qualityGate } from '../_shared/extractionQualityGate.ts';
import { archiveFetch } from '../_shared/archiveFetch.ts';

const VERSION = '1.1.0';
const JAMESEDITION_SOURCE_ID = '77c149de-7866-4a7c-ad24-3423ee6c1f22';

// ─── Markdown parsing helpers ───────────────────────────────────────────────

function extractBetween(md: string, startMarker: string, endMarker: string): string {
  const startIdx = md.indexOf(startMarker);
  if (startIdx === -1) return '';
  const afterStart = startIdx + startMarker.length;
  const endIdx = endMarker ? md.indexOf(endMarker, afterStart) : md.length;
  return md.slice(afterStart, endIdx === -1 ? md.length : endIdx).trim();
}

function extractField(md: string, label: string): string | null {
  // Pattern: "Label\n\nValue" or "Label\nValue" in markdown
  const patterns = [
    new RegExp(`(?:^|\\n)${label}\\s*\\n\\n([^\\n]+)`, 'i'),
    new RegExp(`(?:^|\\n)${label}\\s*\\n([^\\n]+)`, 'i'),
    new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i'),
  ];
  for (const p of patterns) {
    const m = md.match(p);
    if (m && m[1]?.trim()) return m[1].trim();
  }
  return null;
}

function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/[\$€£]?\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(val) || val < 100 ? null : val;
}

function parseMileage(text: string | null): { value: number; unit: string } | null {
  if (!text) return null;
  const m = text.match(/([\d,]+)\s*(mi|km|miles|kilometers)/i);
  if (!m) return null;
  const value = parseInt(m[1].replace(/,/g, ''));
  const unit = m[2].toLowerCase().startsWith('km') ? 'km' : 'mi';
  return { value: unit === 'km' ? Math.round(value * 0.621371) : value, unit };
}

function extractImages(md: string): string[] {
  const images: string[] = [];
  const imgPattern = /!\[.*?\]\((https:\/\/img\.jamesedition\.com\/[^)]+)\)/g;
  let match;
  while ((match = imgPattern.exec(md)) !== null) {
    // Get full-res version by removing size suffix
    let url = match[1];
    // Replace size suffixes like /je/507x312xc.jpg with /je/1100xxs.jpg for bigger images
    url = url.replace(/\/je\/\d+x\d+[a-z]*\./, '/je/1100xxs.');
    if (!images.includes(url)) images.push(url);
  }
  return images;
}

function extractVin(md: string): string | null {
  // Look for VIN field
  const vinField = extractField(md, 'VIN');
  if (vinField && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vinField)) return vinField.toUpperCase();
  // Fallback: find 17-char VIN pattern in text
  const m = md.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  return m ? m[1].toUpperCase() : null;
}

// ─── Extract single listing ─────────────────────────────────────────────────

interface JamesEditionListing {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  asking_price: number | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  body_style: string | null;
  condition: string | null;
  drive_side: string | null;
  location: string | null;
  description: string | null;
  seller_name: string | null;
  image_urls: string[];
  listing_id: string | null;
}

function parseListingMarkdown(md: string, url: string): JamesEditionListing {
  // Title: "# YYYY Make Model"
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || null;

  // Price: "$XXX,XXX" near the top
  const priceMatch = md.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  const asking_price = priceMatch ? parsePrice(priceMatch[0]) : null;

  // Year/Make/Model from title
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  if (title) {
    const ymmMatch = title.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (ymmMatch) {
      year = parseInt(ymmMatch[1]);
      make = ymmMatch[2];
      model = ymmMatch[3];
    }
  }

  // Car Details section — most reliable structured data
  const detailsSection = extractBetween(md, '## Car Details', '## ');
  const yearField = extractField(detailsSection || md, 'Year');
  if (yearField && !year) year = parseInt(yearField) || null;

  const mileageRaw = extractField(detailsSection || md, 'Mileage');
  const mileageData = parseMileage(mileageRaw);
  const mileage = mileageData?.value || null;

  const engine = extractField(detailsSection || md, 'Engine');
  const body_style = extractField(detailsSection || md, 'Car type');
  const drivetrain = extractField(detailsSection || md, 'Drive train');
  const drive_side = extractField(detailsSection || md, 'Drive');
  const condition = extractField(detailsSection || md, 'Condition');
  const exterior_color = extractField(detailsSection || md, 'Color');
  const interior_color = extractField(detailsSection || md, 'Interior color');
  const transmission = extractField(detailsSection || md, 'Transmission');
  const vin = extractVin(detailsSection || md);

  // Location
  const locField = extractField(detailsSection || md, 'Location');
  const location = locField || extractField(md, 'Address');

  // Description: "## About This Car" section
  const description = extractBetween(md, '## About This Car', '## ') || null;

  // Seller — take first line only, strip markdown escapes
  const sellerMatch = md.match(/## For Sale by\s*\n\n\[([^\]]+)/);
  let seller_name = sellerMatch?.[1]?.split('\n')[0]?.replace(/\\+$/g, '').trim() || null;

  // Images
  const image_urls = extractImages(md);

  // Listing ID from URL
  const idMatch = url.match(/-(\d+)$/);
  const listing_id = idMatch?.[1] || null;

  return {
    url, title, year, make, model, vin, asking_price,
    mileage, exterior_color, interior_color, engine,
    transmission, drivetrain, body_style, condition,
    drive_side, location, description, seller_name,
    image_urls, listing_id,
  };
}

// ─── Discover listings from category page ───────────────────────────────────

function parseListingUrls(md: string): string[] {
  const urls: string[] = [];
  const pattern = /\(https:\/\/www\.jamesedition\.com\/cars\/[^)]+for-sale-\d+[^)]*\)/g;
  let match;
  while ((match = pattern.exec(md)) !== null) {
    const url = match[0].slice(1, -1); // remove parens
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

// ─── Main handler ───────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
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

      // Check for existing vehicle by URL or VIN
      let existing: { id: string } | null = null;
      const { data: byUrl } = await supabase
        .from('vehicles')
        .select('id')
        .or(`listing_url.eq.${url},discovery_url.eq.${url}`)
        .limit(1)
        .maybeSingle();
      existing = byUrl;

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
              headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
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
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
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
