// Simple Craigslist vehicle extractor - no AI, no Firecrawl needed
// Craigslist uses clean JSON-LD structured data + HTML attributes
// Uses archiveFetch to archive all fetched pages to listing_page_snapshots
// The parsing lives in ./extract.ts (pure, tested against stored pages) and _shared/craigslistAttributes.ts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { archiveFetch } from '../_shared/archiveFetch.ts';
import { requireWriteAuth } from '../_shared/writeGuard.ts';
import { buildQueueRow, type CraigslistExtracted, extractFromHtml } from './extract.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function extractCraigslistListing(url: string): Promise<CraigslistExtracted> {
  // Fetch HTML via archiveFetch — archives to listing_page_snapshots automatically
  // Craigslist is server-rendered, no JS/Firecrawl needed
  const fetchResult = await archiveFetch(url, {
    platform: 'craigslist',
    callerName: 'extract-craigslist',
    useFirecrawl: false,
    maxAgeSec: 86400, // 24h cache — CL listings change/expire frequently
  });

  if (!fetchResult.html || fetchResult.html.length < 500) {
    const errMsg = fetchResult.error || `Insufficient HTML (${fetchResult.html?.length || 0} bytes)`;
    throw new Error(`Failed to fetch: ${errMsg}`);
  }

  const html = fetchResult.html;
  console.log(`[Craigslist] Fetched ${html.length} bytes (source: ${fetchResult.source}, cached: ${fetchResult.cached})`);

  return extractFromHtml(html, url);
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db } = await req.json();

    if (!url || !url.includes('craigslist.org')) {
      return new Response(
        JSON.stringify({ error: 'Invalid Craigslist URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Extracting Craigslist listing: ${url}`);
    const extracted = await extractCraigslistListing(url);

    console.log(`=== EXTRACTION RESULTS ===`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`Price: $${extracted.price?.toLocaleString() || 'N/A'}`);
    console.log(`Mileage: ${extracted.mileage?.toLocaleString() || 'N/A'} miles`);
    console.log(`Location: ${extracted.location || 'N/A'}`);
    console.log(`Color: ${extracted.exterior_color || 'N/A'}`);
    console.log(`Transmission: ${extracted.transmission || 'N/A'}`);
    console.log(`Drivetrain: ${extracted.drivetrain || 'N/A'}`);
    console.log(`Body Style: ${extracted.body_style || 'N/A'}`);
    console.log(`Condition: ${extracted.condition || 'N/A'}`);
    console.log(`Title Status: ${extracted.title_status || 'N/A'}`);
    console.log(`Images: ${extracted.image_urls.length}`);
    console.log(`Posted: ${extracted.posted_at || 'N/A'}`);
    console.log(`Post id: ${extracted.post_id || 'N/A'}`);
    console.log(`VIN: ${extracted.vin ? 'accepted' : extracted.attributes.vin_raw ? `not used (${extracted.attributes.vin_rejected})` : 'none on the post'}`);

    // Optionally save to database
    if (save_to_db) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      // Insert into import_queue
      const { data, error } = await supabase
        .from('import_queue')
        .upsert(buildQueueRow(extracted), {
          onConflict: 'listing_url',
        })
        .select()
        .maybeSingle();

      if (error) {
        console.error('Database save error:', error);
        throw new Error(`Failed to save to import_queue: ${error?.message || error}`);
      }

      console.log(`Saved to import_queue: ${data.id}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
