import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeImageUrls(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s.startsWith('http')) continue;
    const lower = s.toLowerCase();
    if (lower.includes('youtube.com')) continue;
    if (lower.includes('_50x50') || lower.includes('50x50c')) continue;
    if (lower.includes('94x63')) continue;
    if (lower.includes('thumbnail')) continue;
    if (lower.endsWith('.svg')) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function looksLikeDealerUrl(url: string): boolean {
  const u = url.toLowerCase();
  // If it's not a marketplace/auction domain, assume dealer or dealer website.
  if (u.includes('craigslist.org')) return false;
  if (u.includes('bringatrailer.com')) return false;
  if (u.includes('facebook.com') || u.includes('fb.com')) return false;
  if (u.includes('autotrader.') || u.includes('cars.com')) return false;
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({} as any));
    const batch_size = Number(body?.batch_size || 50);
    const max_images_per_vehicle = Number(body?.max_images_per_vehicle || 50);
    const only_missing = body?.only_missing !== false; // default true

    // Find vehicles with image URLs (origin_metadata.image_urls) and optionally missing/partial images
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, origin_metadata, discovery_url, profile_origin')
      .not('origin_metadata->image_urls', 'is', null)
      .limit(batch_size);

    if (error) throw error;

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      vehicles_fixed: [] as string[]
    };

    for (const vehicle of vehicles || []) {
      const imageUrls = normalizeImageUrls(vehicle.origin_metadata?.image_urls);
      if (!imageUrls || imageUrls.length === 0) continue;

      // Check if vehicle already has images
      const { count: imageCount } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id);

      if (only_missing && imageCount && imageCount > 0) continue; // Skip if already has at least one

      console.log(`Retrying backfill for vehicle ${vehicle.id} with ${imageUrls.length} origin image URLs (existing=${imageCount || 0})`);

      try {
        // Dealer detection: mark in origin_metadata so downstream can segment feed
        const discoveryUrl = String(vehicle.discovery_url || '').trim();
        const dealerDetected = discoveryUrl ? looksLikeDealerUrl(discoveryUrl) : false;
        if (dealerDetected) {
          await supabase
            .from('vehicles')
            .update({
              origin_metadata: {
                ...(vehicle.origin_metadata || {}),
                dealer_detected: true,
                dealer_detected_at: new Date().toISOString(),
                dealer_detection_reason: 'non_marketplace_domain'
              }
            })
            .eq('id', vehicle.id);
        }

        // Call backfill-images
        const backfillResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/backfill-images`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              vehicle_id: vehicle.id,
              image_urls: imageUrls,
              source: dealerDetected ? 'organization_import' : 'external_import',
              run_analysis: false,
              max_images: max_images_per_vehicle
            })
          }
        );

        if (backfillResponse.ok) {
          const result = await backfillResponse.json();
          console.log(`✅ Vehicle ${vehicle.id}: ${result.uploaded || 0} images uploaded`);
          results.succeeded++;
          results.vehicles_fixed.push(vehicle.id);

          // Re-validate vehicle after images are added
          const { data: validation } = await supabase.rpc('validate_vehicle_before_public', {
            p_vehicle_id: vehicle.id
          });

          if (validation?.can_go_live) {
            await supabase
              .from('vehicles')
              .update({ status: 'active', is_public: true })
              .eq('id', vehicle.id);
            console.log(`✅ Vehicle ${vehicle.id} now public`);
          }
        } else {
          console.error(`❌ Backfill failed for ${vehicle.id}: ${backfillResponse.status}`);
          results.failed++;
        }
      } catch (err) {
        console.error(`❌ Error processing ${vehicle.id}:`, err);
        results.failed++;
      }

      results.processed++;
    }

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Retry backfill error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

