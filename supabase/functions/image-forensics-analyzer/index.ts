/**
 * image-forensics-analyzer
 *
 * Stage 5 of the photo intelligence pipeline.
 * Analyzes EXIF metadata for authenticity signals — no AI, pure computation.
 *
 * Writes to: image_forensic_metadata
 *
 * POST /functions/v1/image-forensics-analyzer
 * Body: { image_id?: string } | { batch_size?: number }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANALYZER_VERSION = '1.0.0';

// Expected EXIF keys for completeness scoring
const EXIF_KEY_CHECKS = [
  'DateTimeOriginal',
  ['camera', 'make'],
  ['camera', 'model'],
  ['technical', 'iso'],
  ['technical', 'aperture'],
  ['technical', 'focalLength'],
  ['location', 'latitude'],
] as const;

function getNestedValue(obj: Record<string, unknown>, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

interface ForensicsResult {
  timestamp_trust_score: number;
  exif_completeness_pct: number;
  stripped_exif: boolean;
  edit_history_software: string[];
  gps_consistent: boolean | null;
  ai_generation_probability: number;
  has_c2pa_manifest: boolean;
  overall_authenticity_score: number;
  analyzer_version: string;
}

function analyzeExif(
  exifData: Record<string, unknown> | null,
  source: string | null,
  sourceUrl: string | null,
): ForensicsResult {
  // ---- stripped_exif ----
  const stripped = !exifData || exifData?.exif_status === 'stripped';

  // ---- timestamp_trust_score ----
  let timestampTrust: number;
  if (stripped) {
    // Scraped images commonly have EXIF stripped — less suspicious for extractors
    timestampTrust = source === 'extractor' || source === 'bat_image_library' ? 0.5 : 0.2;
  } else {
    const hasDateTimeOriginal = Boolean(
      exifData?.DateTimeOriginal ||
      (exifData as Record<string, unknown>)?.['DateTimeOriginal']
    );
    timestampTrust = hasDateTimeOriginal ? 0.85 : 0.6;
  }

  // ---- exif_completeness_pct ----
  let presentCount = 0;
  if (exifData && !stripped) {
    for (const key of EXIF_KEY_CHECKS) {
      if (typeof key === 'string') {
        if (exifData[key] != null) presentCount++;
      } else {
        if (getNestedValue(exifData, key) != null) presentCount++;
      }
    }
  }
  const exifCompletenessPct = (presentCount / EXIF_KEY_CHECKS.length) * 100;

  // ---- edit_history_software ----
  const editSoftware: string[] = [];
  if (exifData && !stripped) {
    const softwareFields = ['Software', 'XMPToolkit', 'CreatorTool', 'ProcessingSoftware'];
    for (const field of softwareFields) {
      const val = exifData[field];
      if (val && typeof val === 'string' && val.trim()) {
        editSoftware.push(val.trim());
      }
    }
  }

  // ---- gps_consistent ----
  let gpsConsistent: boolean | null = null;
  if (exifData && !stripped) {
    const lat = getNestedValue(exifData, ['location', 'latitude']);
    const lon = getNestedValue(exifData, ['location', 'longitude']);
    if (lat != null && lon != null) {
      // GPS present — mark as true (we can't cross-validate without a reference point yet)
      gpsConsistent = true;
    }
  }

  // ---- ai_generation_probability ----
  // Heuristic: auction/scraper sources are virtually never AI-generated
  // User uploads without camera EXIF are more suspicious
  let aiProb: number;
  if (source === 'extractor' || source === 'bat_image_library') {
    aiProb = 0.01;
  } else if (source === 'user_upload' || source === 'iphoto') {
    const hasCameraMake = Boolean(getNestedValue(exifData ?? {}, ['camera', 'make']));
    aiProb = hasCameraMake ? 0.03 : 0.25;
  } else {
    aiProb = 0.08;
  }

  // ---- has_c2pa_manifest ----
  // C2PA metadata is not typically in EXIF; this would require inspecting file bytes.
  // Set false for now — will be upgraded when byte-level analysis is available.
  const hasC2pa = false;

  // ---- overall_authenticity_score ----
  // Weighted: timestamp 30%, non-AI 40%, completeness 30%
  const overallScore = Math.min(1.0,
    timestampTrust * 0.30 +
    (1 - aiProb) * 0.40 +
    (exifCompletenessPct / 100) * 0.30
  );

  return {
    timestamp_trust_score: Math.round(timestampTrust * 1000) / 1000,
    exif_completeness_pct: Math.round(exifCompletenessPct * 100) / 100,
    stripped_exif: stripped,
    edit_history_software: editSoftware,
    gps_consistent: gpsConsistent,
    ai_generation_probability: Math.round(aiProb * 1000) / 1000,
    has_c2pa_manifest: hasC2pa,
    overall_authenticity_score: Math.round(overallScore * 1000) / 1000,
    analyzer_version: ANALYZER_VERSION,
  };
}

async function processImage(
  supabase: ReturnType<typeof createClient>,
  imageId: string,
): Promise<ForensicsResult & { image_id: string }> {
  const { data: img, error } = await supabase
    .from('vehicle_images')
    .select('id, exif_data, source, source_url')
    .eq('id', imageId)
    .maybeSingle();

  if (error || !img) throw new Error(`Image not found: ${imageId}`);

  const result = analyzeExif(img.exif_data, img.source, img.source_url);

  const { error: upsertError } = await supabase
    .from('image_forensic_metadata')
    .upsert(
      {
        image_id: imageId,
        ...result,
        analyzed_at: new Date().toISOString(),
      },
      { onConflict: 'image_id' }
    );

  if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

  return { image_id: imageId, ...result };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    );

    const body = await req.json().catch(() => ({}));
    const { image_id, batch_size } = body as { image_id?: string; batch_size?: number };

    // --- Single image mode ---
    if (image_id) {
      const result = await processImage(supabase, image_id);
      return new Response(
        JSON.stringify({ processed: 1, ...result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // --- Batch mode ---
    const limit = Math.min(batch_size ?? 50, 500);

    // Find images not yet analyzed: fetch recently-processed IDs, then filter candidates
    const { data: alreadyDone } = await supabase
      .from('image_forensic_metadata')
      .select('image_id')
      .order('analyzed_at', { ascending: false })
      .limit(2000);
    const doneIds = new Set((alreadyDone || []).map((r: { image_id: string }) => r.image_id));

    const { data: candidates, error: fetchError } = await supabase
      .from('vehicle_images')
      .select('id')
      .limit(limit * 4);  // over-fetch so we have enough after filtering
    const pending = (candidates || []).filter(r => !doneIds.has(r.id)).slice(0, limit);

    if (fetchError) throw new Error(fetchError.message);
    if (!pending?.length) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'No pending images' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];
    const errors = [];
    for (const row of pending) {
      try {
        const r = await processImage(supabase, row.id);
        results.push(r);
      } catch (e) {
        errors.push({ image_id: row.id, error: (e as Error).message });
      }
    }

    return new Response(
      JSON.stringify({
        processed: results.length,
        errors: errors.length,
        error_details: errors.length > 0 ? errors : undefined,
        sample: results[0] ?? null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[image-forensics-analyzer]', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
