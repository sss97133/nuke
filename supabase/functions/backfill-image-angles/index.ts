// Context-Aware Multi-Stage Image Classification with Guardrails
// Uses vehicle YMM, receipts, timeline events, AND MANUAL REFERENCES to inform classification
// Two-pass system: easy images first, then careful classification for difficult ones

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillRequest {
  vehicleId?: string;
  batchSize?: number;
  dryRun?: boolean;
  minConfidence?: number; // Minimum confidence to auto-accept (default: 80)
  requireReview?: boolean; // If true, mark low-confidence for review
}

interface VehicleContext {
  year?: number;
  make?: string;
  model?: string;
  body_style?: string;
  vin?: string;
  receipts?: Array<{ vendor?: string; items?: string[]; description?: string }>;
  recentRepairs?: Array<{ event_type?: string; title?: string; description?: string }>;
  knownParts?: string[]; // Parts mentioned in receipts/repairs
  availableManuals?: Array<{ // NEW: Manual references
    id: string;
    title: string;
    manual_type: string;
    has_diagrams: boolean;
    indexed_parts?: string[];
  }>;
  manualReferences?: Array<{ // NEW: Specific manual page references
    part_name: string;
    system_area: string;
    page_number: number;
    diagram_type: string;
  }>;
}

interface AngleClassification {
  primary_label: string;
  angle_family: string;
  view_axis?: string;
  elevation?: string;
  distance?: string;
  focal_length?: string;
  role?: string;
  is_full_vehicle?: boolean;
  is_labor_step?: boolean;
  labor_step_index?: number;
  confidence: number;
  part_name?: string;
  part_category?: string;
  system_area?: string;
  spatial_x?: number;
  spatial_y?: number;
  spatial_z?: number;
  repair_stage?: string;
  is_repair_image?: boolean;
  needs_review?: boolean; // Guardrail flag
  validation_notes?: string; // Why it needs review
  manual_reference?: string; // NEW: Which manual page this matches
  extracted_tags?: string[]; // NEW: All visible parts, colors, materials, conditions, brands, features
  colors?: string[]; // NEW: Color names visible
  materials?: string[]; // NEW: Material types visible
  conditions?: string[]; // NEW: Condition descriptors
  brands?: string[]; // NEW: Brand names/logos visible
  features?: string[]; // NEW: Features visible
  text_labels?: string[]; // NEW: Text visible (part numbers, labels, etc)
}

function angleFamilyToYawDeg(angleFamily: string | null | undefined): number | null {
  const a = (angleFamily || '').trim().toLowerCase();
  if (!a) return null;

  // Exterior / full vehicle yaw mapping (0 = front, 90 = driver side, 180 = rear, 270 = passenger side)
  // NOTE: Only set yaw for angles where the side is explicit to avoid guessing.
  const map: Record<string, number> = {
    front_straight: 0,
    front_quarter_driver: 45,
    front_three_quarter_driver: 45,
    profile_driver: 90,
    side_driver: 90,
    rear_quarter_driver: 135,
    rear_three_quarter_driver: 135,
    rear_straight: 180,
    rear_quarter_passenger: 225,
    rear_three_quarter_passenger: 225,
    profile_passenger: 270,
    side_passenger: 270,
    front_quarter_passenger: 315,
    front_three_quarter_passenger: 315,
  };

  return Object.prototype.hasOwnProperty.call(map, a) ? map[a] : null;
}

async function resolveAngleTaxonomyIdFromAlias(supabase: any, aliasKey: string | null | undefined): Promise<string | null> {
  const key = (aliasKey || '').trim();
  if (!key) return null;
  try {
    const { data } = await supabase
      .from('angle_aliases')
      .select('angle_id')
      .eq('alias_key', key)
      .maybeSingle();
    return (data?.angle_id as string) || null;
  } catch {
    return null;
  }
}

async function resolveFallbackAngleTaxonomyId(supabase: any): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('angle_taxonomy')
      .select('angle_id')
      .eq('canonical_key', 'detail.general')
      .maybeSingle();
    return (data?.angle_id as string) || null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );

    const { 
      vehicleId, 
      batchSize = 50, 
      dryRun = false, 
      minConfidence = 80,
      requireReview = true
    }: BackfillRequest = await req.json().catch(() => ({}));

    console.log(`🔍 Starting context-aware classification (minConfidence: ${minConfidence}%)`);

    // IMPORTANT: Don't load all images. We only pull a small window that still needs angle tagging.
    let query = supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id, created_at, category, image_category, storage_path, is_external, ai_detected_angle')
      .not('storage_path', 'is', null)
      .is('ai_detected_angle', null)
      .order('created_at', { ascending: false });

    if (vehicleId) {
      query = query.eq('vehicle_id', vehicleId);
    }

    // Limit the scan window (batchSize is what we'll actually process).
    const scanWindow = Math.max(50, Math.min(1000, batchSize * 8));
    const { data: allImages, error: imagesError } = await query.limit(scanWindow);

    if (imagesError) {
      throw new Error(`Failed to load images: ${imagesError.message}`);
    }

    if (!allImages || allImages.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No images found',
          processed: 0,
          skipped: 0,
          failed: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Images pulled already satisfy: storage_path present AND ai_detected_angle is null.
    // We still avoid reprocessing anything audited recently (best-effort guardrail).
    const { data: recentAudits } = await supabase
      .from('ai_angle_classifications_audit')
      .select('image_id')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // Last 24 hours
    const recentlyProcessed = new Set((recentAudits || []).map(r => r.image_id));

    const untaggedImages = (allImages || []).filter((img: any) => {
      if (!img?.id) return false;
      if (recentlyProcessed.has(img.id)) return false;
      if (!img.storage_path) return false;
      return true;
    });

    // Pass 1: Easy images (exterior/interior/engine - likely high confidence)
    const easyImages = untaggedImages.filter(img => {
      const cat = (img.category || img.image_category || '').toLowerCase();
      return cat === 'exterior' || cat === 'interior' || cat === 'engine' || cat === '';
    });

    // Pass 2: Difficult images (close-ups, details, repairs, documents)
    const difficultImages = untaggedImages.filter(img => {
      const cat = (img.category || img.image_category || '').toLowerCase();
      return !easyImages.includes(img);
    });

    console.log(`Found ${untaggedImages.length} untagged: ${easyImages.length} easy, ${difficultImages.length} difficult`);

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          totalImages: allImages.length,
          alreadyTagged: alreadyTagged.size,
          easyImages: easyImages.length,
          difficultImages: difficultImages.length,
          batchSize,
          minConfidence
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let needsReview = 0;
    const errors: string[] = [];
    const skippedClassifications: Record<string, number> = {};

    // ADAPTIVE PARALLEL PROCESSING - Adjusts concurrency based on rate limits
    let CONCURRENT_LIMIT = 20; // Start conservative to avoid rate limits
    const MIN_CONCURRENT = 5; // Minimum concurrency
    const MAX_CONCURRENT = 30; // Maximum concurrency
    let rateLimitHits = 0; // Track rate limit hits to reduce concurrency
    
    const imagesToProcess = [...easyImages.slice(0, batchSize), ...difficultImages.slice(0, batchSize - easyImages.length)].slice(0, batchSize);
    
    console.log(`🚀 Processing ${imagesToProcess.length} images in parallel (starting with ${CONCURRENT_LIMIT} concurrent)...`);
    
    // Resolve fallback taxonomy id once (best-effort).
    const fallbackAngleTaxonomyId = await resolveFallbackAngleTaxonomyId(supabase);
    
    // Pre-load ALL vehicle contexts in parallel (one query per unique vehicle)
    const uniqueVehicleIds = [...new Set(imagesToProcess.map(img => img.vehicle_id))];
    console.log(`📚 Pre-loading contexts for ${uniqueVehicleIds.length} unique vehicles...`);
    const vehicleContextCache = new Map<string, VehicleContext>();
    
    await Promise.allSettled(
      uniqueVehicleIds.map(async (vehicleId) => {
        const context = await loadVehicleContext(vehicleId, supabase, true); // Always use enhanced context
        vehicleContextCache.set(vehicleId, context);
      })
    );
    
    // Process ALL images in adaptive parallel batches
    for (let i = 0; i < imagesToProcess.length; i += CONCURRENT_LIMIT) {
      const batch = imagesToProcess.slice(i, i + CONCURRENT_LIMIT);
      
      // Process entire batch in parallel - ALWAYS use enhanced context for detailed extraction
      const results = await Promise.allSettled(
        batch.map(async (img) => {
          const useEnhanced = true; // Always use enhanced for detailed extraction (extracted_tags, colors, materials, etc.)
          const context = vehicleContextCache.get(img.vehicle_id)!;
          return processImage(img, supabase, minConfidence, requireReview, useEnhanced, context, fallbackAngleTaxonomyId);
        })
      );
      
      // Count results and track rate limits
      let batchRateLimitHits = 0;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const res = result.value;
          if (res === 'processed') processed++;
          else if (res === 'skipped') skipped++;
          else if (res === 'review') { processed++; needsReview++; }
          else if (res === 'failed') {
            failed++;
            // Failed status means rate limit was hit in processImage
            // We track this separately
          }
        } else {
          failed++;
          const errorMsg = result.reason?.message || 'Unknown error';
          errors.push(errorMsg);
          if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
            batchRateLimitHits++;
          }
        }
      }
      
      // Adjust concurrency based on rate limit hits
      if (batchRateLimitHits > 0) {
        rateLimitHits += batchRateLimitHits;
        // Reduce concurrency if we hit rate limits
        CONCURRENT_LIMIT = Math.max(MIN_CONCURRENT, Math.floor(CONCURRENT_LIMIT * 0.7));
        console.log(`  ⚠️  Rate limit hit! Reducing concurrency to ${CONCURRENT_LIMIT}. Waiting 5s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s between batches when rate limited
      } else if (rateLimitHits === 0 && CONCURRENT_LIMIT < MAX_CONCURRENT) {
        // Gradually increase concurrency if no rate limits
        CONCURRENT_LIMIT = Math.min(MAX_CONCURRENT, Math.floor(CONCURRENT_LIMIT * 1.1));
      } else {
        // Normal wait between batches
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between batches normally
      }
      
      console.log(`  ✓ Batch ${Math.floor(i / CONCURRENT_LIMIT) + 1} complete: ${processed} processed, ${skipped} skipped, ${failed} failed (concurrency: ${CONCURRENT_LIMIT})`);
    }

    console.log(`✅ Complete. Processed: ${processed} (${needsReview} need review), Skipped: ${skipped}, Failed: ${failed}`);

    // Calculate remaining images
    const remaining = untaggedImages.length - processed - skipped - failed;

    return new Response(
      JSON.stringify({
        success: true,
        totalImages: allImages.length,
        alreadyTagged: alreadyTagged.size,
        untaggedImages: untaggedImages.length,
        processed,
        needsReview,
        skipped,
        failed,
        remaining, // How many images still need processing
        skippedByType: skippedClassifications,
        errors: errors.slice(0, 10),
        rateLimitHits, // Track rate limit hits
        message: `Processed ${processed} images (${needsReview} flagged for review), skipped ${skipped}, ${failed} failed. ${remaining} remaining.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Backfill error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Internal server error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Process a single image with context and guardrails
async function processImage(
  img: any,
  supabase: any,
  minConfidence: number,
  requireReview: boolean,
  useEnhancedContext: boolean,
  vehicleContext?: VehicleContext, // Pre-loaded context to avoid repeated queries
  fallbackAngleTaxonomyId?: string | null
): Promise<'processed' | 'skipped' | 'review' | 'failed'> {
  try {
    // Check if already classified (check BOTH vehicle_image_angles AND recent audit)
    const { data: existing } = await supabase
      .from('vehicle_image_angles')
      .select('id')
      .eq('image_id', img.id)
      .single();

    if (existing) {
      return 'skipped';
    }

    // Also check for recent audit entry to avoid duplicates
    const { data: recentAudit } = await supabase
      .from('ai_angle_classifications_audit')
      .select('id')
      .eq('image_id', img.id)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .single();

    if (recentAudit) {
      return 'skipped'; // Skip if recently processed (within 24 hours)
    }

    // Use pre-loaded context or load if not provided
    const context = vehicleContext || await loadVehicleContext(img.vehicle_id, supabase, useEnhancedContext);
    
    // Classify image (no logging in parallel mode to reduce noise)
    const classification = await classifyImageAngle(
      img.image_url, 
      img.vehicle_id, 
      supabase, 
      context,
      useEnhancedContext
    );

    if (!classification) {
      throw new Error('Failed to classify image angle');
    }
    
    // Apply guardrails
    const validation = validateClassification(classification, context, minConfidence);
    
    if (validation.needsReview) {
      classification.needs_review = true;
      classification.validation_notes = validation.reason;
    }

    // Always record in audit
    const rawClassification = {
      ...classification,
      vehicle_context: {
        year: context.year,
        make: context.make,
        model: context.model,
        known_parts: context.knownParts,
        manuals_available: context.availableManuals?.length || 0
      },
      classified_at: new Date().toISOString()
    };

    const { error: auditError } = await supabase
      .from('ai_angle_classifications_audit')
      .insert({
        image_id: img.id,
        vehicle_id: img.vehicle_id,
        angle_family: classification.angle_family,
        primary_label: classification.primary_label,
        view_axis: classification.view_axis || null,
        elevation: classification.elevation || null,
        distance: classification.distance || null,
        focal_length: classification.focal_length || null,
        role: classification.role || null,
        confidence: classification.confidence,
        mapped_to_angle_id: null,
        needs_review: classification.needs_review || false,
        validation_notes: classification.validation_notes || null,
        raw_classification: rawClassification
      });

      if (auditError) {
        // Silent fail in parallel mode
      }

    // Map to angle_id
    const angleId = await mapClassificationToAngleId(classification, supabase);
    
    if (angleId) {
      // Update audit with angle_id
      await supabase
        .from('ai_angle_classifications_audit')
        .update({ mapped_to_angle_id: angleId })
        .eq('image_id', img.id)
        .eq('vehicle_id', img.vehicle_id);

      // Store spatial metadata if available
      if (classification.spatial_x !== undefined || classification.part_name) {
        await supabase
          .from('image_spatial_metadata')
          .upsert({
            image_id: img.id,
            vehicle_id: img.vehicle_id,
            spatial_x: classification.spatial_x || null,
            spatial_y: classification.spatial_y || null,
            spatial_z: classification.spatial_z || null,
            part_name: classification.part_name || null,
            part_category: classification.part_category || null,
            system_area: classification.system_area || null,
            is_repair_image: classification.is_repair_image || false,
            repair_stage: classification.repair_stage || null,
            ai_metadata: rawClassification
          }, {
            onConflict: 'image_id'
          });
      }

      // NOTE: We DON'T store AI tags in image_tags table
      // - image_tags is for manual user tags only (click-to-tag)
      // - All AI data is stored in ai_angle_classifications_audit.raw_classification
      // - Search queries should use ai_angle_classifications_audit, not image_tags
      // - This prevents duplication and keeps systems separate

      // Insert into vehicle_image_angles (use upsert to handle duplicates)
      const { error: insertError } = await supabase
        .from('vehicle_image_angles')
        .upsert({
          image_id: img.id,
          vehicle_id: img.vehicle_id,
          angle_id: angleId,
          confidence_score: Math.round(classification.confidence),
          tagged_by: 'ai',
          perspective_type: classification.distance || 'standard',
          focal_length_mm: mapFocalLengthToMM(classification.focal_length),
          created_at: new Date().toISOString()
        }, {
          onConflict: 'image_id,angle_id',
          ignoreDuplicates: false
        });

      if (insertError) {
        console.error(`Failed to insert vehicle_image_angles for ${img.id}:`, insertError);
        // Continue anyway - audit entry is already created
      }

      // ALSO write canonical pose signals onto vehicle_images for fast queries + profile rendering.
      // This is what powers angle coverage metrics and "3D position" (yaw) without needing joins.
      try {
        const yaw = angleFamilyToYawDeg(classification.angle_family || null);
        const conf01 = Math.max(0, Math.min(1, Number(classification.confidence || 0) / 100));

        await supabase
          .from('vehicle_images')
          .update({
            ai_detected_angle: classification.angle_family || null,
            ai_detected_angle_confidence: Number.isFinite(conf01) ? conf01 : null,
            angle_source: 'backfill_image_angles_v1',
            yaw_deg: yaw,
            yaw_confidence: yaw !== null ? (Number.isFinite(conf01) ? conf01 : null) : null,
          } as any)
          .eq('id', img.id);
      } catch {
        // Non-blocking
      }

      // Decades-proof: append observations over time (do not overwrite).
      try {
        const conf01 = Math.max(0, Math.min(1, Number(classification.confidence || 0) / 100));
        const taxonomyAngleId =
          (await resolveAngleTaxonomyIdFromAlias(supabase, classification.angle_family)) ||
          fallbackAngleTaxonomyId ||
          null;

        if (taxonomyAngleId) {
          await supabase.from('image_angle_observations').insert({
            image_id: img.id,
            vehicle_id: img.vehicle_id,
            angle_id: taxonomyAngleId,
            confidence: Number.isFinite(conf01) ? conf01 : null,
            source: 'ai',
            source_version: 'backfill-image-angles_v1',
            evidence: {
              needs_review: !!classification.needs_review,
              validation_notes: classification.validation_notes || null,
              angle_family: classification.angle_family || null,
              primary_label: classification.primary_label || null,
              role: classification.role || null,
            },
          } as any);
        }

        const yaw = angleFamilyToYawDeg(classification.angle_family || null);
        const focalMm = mapFocalLengthToMM(classification.focal_length);
        const fam = (classification.angle_family || '').toString();
        const targetAnchor =
          fam.startsWith('engine') ? 'anchor.engine.bay.center'
          : fam.startsWith('interior') ? 'anchor.interior.cabin.center'
          : fam.startsWith('undercarriage') ? 'anchor.undercarriage.center'
          : 'anchor.vehicle.center';

        await supabase.from('image_pose_observations').insert({
          image_id: img.id,
          vehicle_id: img.vehicle_id,
          reference_frame: 'vehicle_frame_v1',
          yaw_deg: yaw,
          pose_confidence: (yaw !== null && Number.isFinite(conf01)) ? conf01 : null,
          focal_length_mm: focalMm || null,
          target_anchor: targetAnchor,
          source: 'ai',
          source_version: 'backfill-image-angles_v1',
          raw: {
            angle_family: classification.angle_family || null,
            view_axis: classification.view_axis || null,
            elevation: classification.elevation || null,
            distance: classification.distance || null,
            focal_length: classification.focal_length || null,
          },
          observed_at: new Date().toISOString(),
        } as any);
      } catch {
        // Non-blocking
      }

      return validation.needsReview ? 'review' : 'processed';
    } else {
      return 'skipped';
    }

  } catch (error: any) {
    // Log rate limit errors specifically so we can track them
    const errorMsg = error.message || String(error);
    if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
      console.warn(`Rate limit error for image ${img.id}: ${errorMsg}`);
      // Re-throw rate limit errors so they're caught in the main loop
      throw error;
    }
    // Return error - will be tracked in main loop
    return 'failed';
  }
}

// Load rich vehicle context including receipts, timeline events, AND MANUALS
async function loadVehicleContext(
  vehicleId: string,
  supabase: any,
  includeReceipts: boolean
): Promise<VehicleContext> {
  const context: VehicleContext = {};

  // Get vehicle YMM
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model, body_style, vin')
    .eq('id', vehicleId)
    .single();

  if (vehicle) {
    context.year = vehicle.year;
    context.make = vehicle.make;
    context.model = vehicle.model;
    context.body_style = vehicle.body_style;
    context.vin = vehicle.vin;
  }

  // NEW: Load available manuals for this vehicle
  const { data: manualLinks } = await supabase
    .from('vehicle_manual_links')
    .select(`
      manual_id,
      match_confidence,
      vehicle_manuals (
        id,
        title,
        manual_type,
        diagram_pages,
        indexed_sections
      )
    `)
    .eq('vehicle_id', vehicleId)
    .order('match_confidence', { ascending: false })
    .limit(10);

  if (manualLinks && manualLinks.length > 0) {
    context.availableManuals = manualLinks.map((link: any) => ({
      id: link.vehicle_manuals.id,
      title: link.vehicle_manuals.title,
      manual_type: link.vehicle_manuals.manual_type,
      has_diagrams: (link.vehicle_manuals.diagram_pages?.length || 0) > 0,
      indexed_parts: link.vehicle_manuals.indexed_sections ? 
        Object.keys(link.vehicle_manuals.indexed_sections) : []
    }));

    // Load manual image references (part diagrams, locations, etc.)
    const manualIds = manualLinks.map((link: any) => link.manual_id);
    const { data: references } = await supabase
      .from('manual_image_references')
      .select('part_name, system_area, page_number, diagram_type')
      .in('manual_id', manualIds)
      .limit(50);

    if (references && references.length > 0) {
      context.manualReferences = references;
    }
  }

  if (includeReceipts) {
    // Get recent receipts to understand what work was done
    const { data: receipts } = await supabase
      .from('receipts')
      .select('vendor, description, metadata')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (receipts && receipts.length > 0) {
      context.receipts = receipts.map(r => ({
        vendor: r.vendor,
        description: r.description,
        items: r.metadata?.items || []
      }));

      // Extract known parts from receipts
      const knownParts = new Set<string>();
      receipts.forEach(r => {
        if (r.description) {
          const partKeywords = ['brake', 'caliper', 'rotor', 'suspension', 'shock', 'spring', 
            'engine', 'transmission', 'door', 'panel', 'wheel', 'tire', 'exhaust', 'catalytic',
            'fuel', 'pump', 'filter', 'oil', 'coolant', 'radiator', 'alternator', 'starter'];
          partKeywords.forEach(keyword => {
            if (r.description.toLowerCase().includes(keyword)) {
              knownParts.add(keyword);
            }
          });
        }
        if (r.metadata?.items) {
          r.metadata.items.forEach((item: string) => {
            knownParts.add(item.toLowerCase());
          });
        }
      });
      context.knownParts = Array.from(knownParts);
    }

    // Get recent timeline events (repairs, maintenance)
    const { data: events } = await supabase
      .from('timeline_events')
      .select('event_type, title, description')
      .eq('vehicle_id', vehicleId)
      .in('event_type', ['repair', 'maintenance', 'modification'])
      .order('event_date', { ascending: false })
      .limit(10);

    if (events && events.length > 0) {
      context.recentRepairs = events;
    }
  }

  return context;
}

// Validate classification against context and confidence thresholds
function validateClassification(
  classification: AngleClassification,
  context: VehicleContext,
  minConfidence: number
): { needsReview: boolean; reason: string } {
  // Guardrail 1: Low confidence
  if (classification.confidence < minConfidence) {
    return {
      needsReview: true,
      reason: `Confidence ${classification.confidence}% below threshold ${minConfidence}%`
    };
  }

  // Guardrail 2: Part identification doesn't match known work
  if (classification.part_name && context.knownParts && context.knownParts.length > 0) {
    const partLower = classification.part_name.toLowerCase();
    const matchesKnown = context.knownParts.some(known => 
      partLower.includes(known) || known.includes(partLower)
    );
    
    if (!matchesKnown && classification.confidence < 90) {
      return {
        needsReview: true,
        reason: `Part "${classification.part_name}" not found in vehicle's receipt/repair history`
      };
    }
  }

  // Guardrail 3: NEW - Check if part matches manual references
  if (classification.part_name && context.manualReferences && context.manualReferences.length > 0) {
    const partLower = classification.part_name.toLowerCase();
    const matchesManual = context.manualReferences.some(ref => 
      ref.part_name && ref.part_name.toLowerCase().includes(partLower)
    );
    
    if (matchesManual) {
      // If it matches a manual, we can be MORE confident
      // Don't flag for review if confidence is reasonable
      console.log(`  ✓ Part "${classification.part_name}" matches manual reference - confidence boost`);
    } else if (classification.confidence < 85 && context.availableManuals && context.availableManuals.length > 0) {
      // If we have manuals but part doesn't match, be cautious
      return {
        needsReview: true,
        reason: `Part "${classification.part_name}" not found in available manual references`
      };
    }
  }

  // Guardrail 4: Unusual classification for vehicle type
  if (context.body_style) {
    const bodyStyle = context.body_style.toLowerCase();
    if (bodyStyle.includes('truck') || bodyStyle.includes('suv')) {
      if (classification.angle_family === 'dash' && classification.primary_label?.includes('rear_seat')) {
        return {
          needsReview: true,
          reason: `Unusual classification for ${bodyStyle} vehicle type`
        };
      }
    }
  }

  // Guardrail 5: Spatial coordinates seem invalid
  if (classification.spatial_x !== undefined) {
    const y = classification.spatial_y ?? 0;
    const z = classification.spatial_z ?? 0;
    if (classification.spatial_x < 0 || classification.spatial_x > 1 ||
        y < 0 || y > 1 ||
        z < 0 || z > 1) {
      return {
        needsReview: true,
        reason: 'Invalid spatial coordinates (outside 0-1 range)'
      };
    }
  }

  return { needsReview: false, reason: '' };
}

// Context-aware classification with manual references
async function classifyImageAngle(
  imageUrl: string,
  vehicleId: string,
  supabase: any,
  context: VehicleContext,
  useEnhanced: boolean
): Promise<AngleClassification | null> {
  try {
    const vehicleContext = context.year && context.make && context.model
      ? `${context.year} ${context.make} ${context.model}${context.body_style ? ` (${context.body_style})` : ''}`
      : 'vehicle';

    const contextInfo: string[] = [];
    if (context.year) contextInfo.push(`Year: ${context.year}`);
    if (context.make) contextInfo.push(`Make: ${context.make}`);
    if (context.model) contextInfo.push(`Model: ${context.model}`);
    if (context.body_style) contextInfo.push(`Body Style: ${context.body_style}`);
    
    if (useEnhanced && context.knownParts && context.knownParts.length > 0) {
      contextInfo.push(`Recent work/parts mentioned: ${context.knownParts.slice(0, 5).join(', ')}`);
    }

    // NEW: Add manual context
    if (useEnhanced && context.availableManuals && context.availableManuals.length > 0) {
      contextInfo.push(`\nAvailable manuals: ${context.availableManuals.map(m => m.title).join(', ')}`);
      if (context.manualReferences && context.manualReferences.length > 0) {
        contextInfo.push(`Manual references for parts: ${context.manualReferences.slice(0, 5).map(r => r.part_name).filter(Boolean).join(', ')}`);
      }
    }

    const openaiKey = Deno.env.get('OPEN_AI_API_KEY') || Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    
    const systemPrompt = useEnhanced
      ? `You are an expert automotive image classifier. You have access to vehicle context that helps narrow down possibilities.

VEHICLE CONTEXT:
${contextInfo.join('\n')}
${context.knownParts && context.knownParts.length > 0 ? `\nKnown parts/work from receipts: ${context.knownParts.join(', ')}\n` : ''}
${context.availableManuals && context.availableManuals.length > 0 ? `\nAvailable repair manuals: ${context.availableManuals.map(m => `${m.title} (${m.manual_type})`).join(', ')}\n` : ''}
${context.manualReferences && context.manualReferences.length > 0 ? `\nManual part references: ${context.manualReferences.slice(0, 10).map(r => `${r.part_name} (page ${r.page_number})`).filter(Boolean).join(', ')}\n` : ''}

Use this context to be MORE PRECISE. If the image shows a part mentioned in recent work OR found in a manual, that's a strong signal.
If classifying a close-up or detail shot, cross-reference against known parts and manual references to increase confidence.
If a part matches a manual diagram, you can be highly confident in identification.

ANGLE FAMILY CATEGORIZATION GUIDE:
- Use SPECIFIC angle families when possible (e.g., "brake_caliper" not "detail", "headlight_driver" not "detail")
- For full vehicle exterior views: front_quarter_driver, front_quarter_passenger, front_straight, rear_quarter_driver, rear_quarter_passenger, rear_straight, profile_driver, profile_passenger, top_down
- For engine bay: engine_bay_full for overview, engine_component for specific parts, or specific parts like battery, alternator, radiator
- For interior: interior_dash_full, interior_driver_seat, interior_passenger_seat, interior_rear_seats, interior_headliner, interior_carpet, interior_door_driver, etc.
- For undercarriage: frame_rail_driver_front, front_suspension, rear_suspension, exhaust_system, etc.
- For close-up details: brake_caliper, brake_rotor, wheel_closeup, door_jamb_driver, headlight_driver, taillight_driver, taillight_passenger, etc.
- For body parts: ALWAYS specify driver/passenger when applicable (headlight_driver, headlight_passenger, taillight_driver, taillight_passenger, door_handle_driver, door_handle_passenger, etc.)
- For trim/badges: badges_front, badges_rear, badges_side, trim_driver_front, trim_driver_rear, molding_driver, chrome_driver, etc.
- For documents: vin_door_jamb, vin_dashboard, receipt, title_document, etc.
- For damage: rust_damage, paint_damage, dent_damage, scratch_damage
- For repair stages: repair_before, repair_after, repair_in_progress, labor_step

Be THOROUGH and SPECIFIC. Don't use generic "detail" when you can identify the specific part or area.

Return ONLY valid JSON:
{
  "primary_label": "string",
  "angle_family": "one of: front_quarter_driver, front_quarter_passenger, front_straight, front_three_quarter_driver, front_three_quarter_passenger, rear_quarter_driver, rear_quarter_passenger, rear_straight, rear_three_quarter_driver, rear_three_quarter_passenger, profile_driver, profile_passenger, side_driver, side_passenger, top_down, roof_view, front_corner, rear_corner, engine_bay_full, engine_bay_driver, engine_bay_passenger, engine_bay_top, engine_component, engine_detail, firewall, battery, alternator, radiator, air_intake, exhaust_manifold, transmission, interior_dash_full, interior_dash_driver, interior_dash_passenger, interior_center_console, interior_steering_wheel, interior_driver_seat, interior_passenger_seat, interior_rear_seats, interior_headliner, interior_carpet, interior_door_driver, interior_door_passenger, interior_door_rear, interior_trunk, interior_cargo, interior_bed, undercarriage_full, undercarriage_front, undercarriage_rear, undercarriage_driver, undercarriage_passenger, frame_rail_driver_front, frame_rail_driver_rear, frame_rail_passenger_front, frame_rail_passenger_rear, front_suspension, rear_suspension, front_axle, rear_axle, differential, exhaust_system, fuel_tank, transmission_underside, driveshaft, brake_system, wheel_well_driver_front, wheel_well_driver_rear, wheel_well_passenger_front, wheel_well_passenger_rear, wheel_closeup, tire_closeup, brake_caliper, brake_rotor, brake_pad, door_panel_driver, door_panel_passenger, door_jamb_driver, door_jamb_passenger, door_handle, mirror_driver, mirror_passenger, window_driver, window_passenger, headlight_driver, headlight_passenger, taillight_driver, taillight_passenger, turn_signal, fog_light, grille, bumper_front, bumper_rear, hood, trunk_lid, tailgate, fender_driver_front, fender_driver_rear, fender_passenger_front, fender_passenger_rear, quarter_panel_driver, quarter_panel_passenger, rocker_panel_driver, rocker_panel_passenger, badges, emblems, vin_door_jamb, vin_dashboard, vin_frame, vin_engine, title_document, registration, receipt, invoice, manual_page, rust_damage, paint_damage, dent_damage, scratch_damage, repair_before, repair_after, repair_in_progress, labor_step",
  "view_axis": "string or null",
  "elevation": "string or null",
  "distance": "string or null",
  "focal_length": "string or null",
  "role": "string or null",
  "is_full_vehicle": boolean,
  "is_labor_step": boolean,
  "labor_step_index": number or null,
  "confidence": number 0-100,
  "part_name": "string or null",
  "part_category": "string or null",
  "system_area": "string or null",
  "spatial_x": number 0.0-1.0 or null,
  "spatial_y": number 0.0-1.0 or null,
  "spatial_z": number 0.0-1.0 or null,
  "repair_stage": "string or null",
  "is_repair_image": boolean,
  "manual_reference": "string or null (which manual/page this matches)",
  "extracted_tags": ["array of strings - ALL visible parts, colors, materials, conditions, brands, features"],
  "colors": ["array of color names visible in image"],
  "materials": ["array of material types visible: leather, chrome, plastic, metal, fabric, etc"],
  "conditions": ["array of condition descriptors: rust, damage, wear, new, restored, original, etc"],
  "brands": ["array of brand names/logos visible"],
  "features": ["array of features visible: air conditioning, power windows, custom, etc"],
  "text_labels": ["array of any text visible: part numbers, labels, stickers, etc"]
}

CRITICAL: Extract EVERYTHING visible. Be comprehensive:
- List ALL parts visible (even small ones): brake caliper, rotor, wheel, tire, door handle, mirror, etc.
- List ALL colors: red, black, chrome, silver, etc.
- List ALL materials: leather, vinyl, plastic, metal, rubber, etc.
- List ALL conditions: rust, corrosion, damage, wear, scratches, dents, new, restored, original, etc.
- List ALL brands/logos visible: Ford, Chevy, Holley, Edelbrock, etc.
- List ALL features: power steering, air conditioning, custom paint, etc.
- Extract ANY text visible: part numbers, labels, stickers, VIN digits, etc.

Be PRECISE. If uncertain, use LOWER confidence. If part matches known work OR manual reference, you can be more confident.`
      : `You are an expert automotive photographer classifier. Analyze vehicle images and classify them by angle, elevation, distance, and focal characteristics.

Return ONLY valid JSON in this exact schema:
{
  "primary_label": "string",
  "angle_family": "one of: front_quarter_driver, front_quarter_passenger, front_straight, front_three_quarter_driver, front_three_quarter_passenger, rear_quarter_driver, rear_quarter_passenger, rear_straight, rear_three_quarter_driver, rear_three_quarter_passenger, profile_driver, profile_passenger, side_driver, side_passenger, top_down, roof_view, front_corner, rear_corner, engine_bay_full, engine_bay_driver, engine_bay_passenger, engine_bay_top, engine_component, engine_detail, firewall, battery, alternator, radiator, air_intake, exhaust_manifold, transmission, interior_dash_full, interior_dash_driver, interior_dash_passenger, interior_center_console, interior_steering_wheel, interior_driver_seat, interior_passenger_seat, interior_rear_seats, interior_headliner, interior_carpet, interior_door_driver, interior_door_passenger, interior_door_rear, interior_trunk, interior_cargo, interior_bed, undercarriage_full, undercarriage_front, undercarriage_rear, undercarriage_driver, undercarriage_passenger, frame_rail_driver_front, frame_rail_driver_rear, frame_rail_passenger_front, frame_rail_passenger_rear, front_suspension, rear_suspension, front_axle, rear_axle, differential, exhaust_system, fuel_tank, transmission_underside, driveshaft, brake_system, wheel_well_driver_front, wheel_well_driver_rear, wheel_well_passenger_front, wheel_well_passenger_rear, wheel_closeup, tire_closeup, brake_caliper, brake_rotor, brake_pad, door_panel_driver, door_panel_passenger, door_jamb_driver, door_jamb_passenger, door_handle_driver, door_handle_passenger, mirror_driver, mirror_passenger, window_driver, window_passenger, headlight_driver, headlight_passenger, taillight_driver, taillight_passenger, turn_signal_driver_front, turn_signal_driver_rear, turn_signal_passenger_front, turn_signal_passenger_rear, fog_light_driver, fog_light_passenger, grille, bumper_front, bumper_rear, hood, trunk_lid, tailgate, fender_driver_front, fender_driver_rear, fender_passenger_front, fender_passenger_rear, quarter_panel_driver, quarter_panel_passenger, rocker_panel_driver, rocker_panel_passenger, badges_front, badges_rear, badges_side, emblems_front, emblems_rear, emblems_side, trim_driver_front, trim_driver_rear, trim_passenger_front, trim_passenger_rear, molding_driver, molding_passenger, chrome_driver, chrome_passenger, vin_door_jamb, vin_dashboard, vin_frame, vin_engine, title_document, registration, receipt, invoice, manual_page, rust_damage, paint_damage, dent_damage, scratch_damage, repair_before, repair_after, repair_in_progress, labor_step",
  "view_axis": "string or null",
  "elevation": "string or null",
  "distance": "string or null",
  "focal_length": "string or null",
  "role": "string or null",
  "is_full_vehicle": boolean,
  "is_labor_step": boolean,
  "labor_step_index": number or null,
  "confidence": number 0-100
}

Be precise and consistent. If uncertain, use lower confidence scores.`;
    
    // Retry logic with exponential backoff for rate limits
    let openaiResponse;
    let retries = 0;
    const maxRetries = 5;
    const baseDelay = 1000; // 1 second
    
    while (retries <= maxRetries) {
      openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          // Cheaper default; this runs at scale.
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Classify this ${vehicleContext} image. ${useEnhanced ? 'Use the vehicle context and manual references to be precise.' : ''} Return ONLY the JSON object, no other text.`
                },
                {
                  type: 'image_url',
                  image_url: { url: imageUrl }
                }
              ]
            }
          ],
          max_tokens: useEnhanced ? 900 : 350,
          temperature: 0.1
        })
      });

      // Handle rate limits (429) with exponential backoff
      if (openaiResponse.status === 429) {
        const retryAfter = openaiResponse.headers.get('retry-after');
        const delay = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : baseDelay * Math.pow(2, retries); // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        
        if (retries < maxRetries) {
          console.warn(`Rate limit hit, retrying in ${delay}ms (attempt ${retries + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retries++;
          continue;
        } else {
          throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
        }
      }

      // Handle other errors
      if (!openaiResponse.ok) {
        const errorText = await openaiResponse.text();
        console.error('OpenAI API error:', openaiResponse.status, errorText);
        
        // For 5xx errors, retry with backoff
        if (openaiResponse.status >= 500 && retries < maxRetries) {
          const delay = baseDelay * Math.pow(2, retries);
          console.warn(`Server error ${openaiResponse.status}, retrying in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retries++;
          continue;
        }
        
        throw new Error(`OpenAI API failed: ${openaiResponse.status} - ${errorText}`);
      }

      // Success - break out of retry loop
      break;
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/```$/, '').trim();
    }

    const classification = JSON.parse(jsonStr) as AngleClassification;

    if (!classification.primary_label || !classification.angle_family) {
      throw new Error('Invalid classification: missing required fields');
    }

    if (typeof classification.confidence !== 'number') {
      classification.confidence = 75;
    }

    return classification;

  } catch (error: any) {
    console.error('Error classifying image angle:', error);
    return {
      primary_label: 'general',
      angle_family: 'detail',
      confidence: 50,
      is_full_vehicle: false,
      is_labor_step: false,
      needs_review: true,
      validation_notes: `Classification failed: ${error.message}`
    };
  }
}

// Enhanced mapping that includes all detail angles
async function mapClassificationToAngleId(
  classification: AngleClassification,
  supabase: any
): Promise<string | null> {
  const angleFamily = classification.angle_family;
  const viewAxis = classification.view_axis || '';
  const primaryLabel = classification.primary_label.toLowerCase();
  const partName = classification.part_name?.toLowerCase();
  
  // Direct mapping: angle_family values map directly to angle_name in database
  // This allows for much more granular categorization
  let angleName: string | null = null;
  
  // EXTERIOR VIEWS - Full vehicle angles
  if (angleFamily === 'front_quarter_driver' || (angleFamily === 'front_corner' && (viewAxis.includes('left') || viewAxis.includes('driver')))) {
    angleName = 'front_quarter_driver';
  } else if (angleFamily === 'front_quarter_passenger' || (angleFamily === 'front_corner' && (viewAxis.includes('right') || viewAxis.includes('passenger')))) {
    angleName = 'front_quarter_passenger';
  } else if (angleFamily === 'front_straight' || (angleFamily === 'front' && !viewAxis.includes('left') && !viewAxis.includes('right'))) {
    angleName = 'front_straight';
  } else if (angleFamily === 'front_three_quarter_driver') {
    angleName = 'front_quarter_driver'; // Map to existing
  } else if (angleFamily === 'front_three_quarter_passenger') {
    angleName = 'front_quarter_passenger'; // Map to existing
  } else if (angleFamily === 'rear_quarter_driver' || (angleFamily === 'rear_corner' && (viewAxis.includes('left') || viewAxis.includes('driver')))) {
    angleName = 'rear_quarter_driver';
  } else if (angleFamily === 'rear_quarter_passenger' || (angleFamily === 'rear_corner' && (viewAxis.includes('right') || viewAxis.includes('passenger')))) {
    angleName = 'rear_quarter_passenger';
  } else if (angleFamily === 'rear_straight' || (angleFamily === 'rear' && !viewAxis.includes('left') && !viewAxis.includes('right'))) {
    angleName = 'rear_straight';
  } else if (angleFamily === 'rear_three_quarter_driver') {
    angleName = 'rear_quarter_driver'; // Map to existing
  } else if (angleFamily === 'rear_three_quarter_passenger') {
    angleName = 'rear_quarter_passenger'; // Map to existing
  } else if (angleFamily === 'profile_driver' || angleFamily === 'side_driver' || (angleFamily === 'side' && (viewAxis.includes('left') || viewAxis.includes('driver')))) {
    angleName = 'profile_driver';
  } else if (angleFamily === 'profile_passenger' || angleFamily === 'side_passenger' || (angleFamily === 'side' && (viewAxis.includes('right') || viewAxis.includes('passenger')))) {
    angleName = 'profile_passenger';
  } else if (angleFamily === 'top_down' || angleFamily === 'roof_view' || angleFamily === 'top') {
    angleName = 'roof_view';
  
  // ENGINE BAY
  } else if (angleFamily === 'engine_bay_full' || angleFamily === 'engine_bay') {
    angleName = 'engine_full';
  } else if (angleFamily === 'engine_bay_driver' || angleFamily === 'engine_bay_passenger') {
    angleName = 'engine_full'; // Map to existing
  } else if (angleFamily === 'engine_bay_top') {
    angleName = 'engine_full'; // Map to existing
  } else if (angleFamily === 'engine_component' || angleFamily === 'engine_detail') {
    angleName = 'engine_component';
  } else if (angleFamily === 'firewall') {
    angleName = 'firewall';
  } else if (angleFamily === 'battery' || angleFamily === 'alternator' || angleFamily === 'radiator' || angleFamily === 'air_intake' || angleFamily === 'exhaust_manifold' || angleFamily === 'transmission') {
    angleName = 'engine_component'; // Map specific engine parts to component
  
  // INTERIOR
  } else if (angleFamily === 'interior_dash_full' || angleFamily === 'dash' || (angleFamily === 'interior' && primaryLabel.includes('dash'))) {
    angleName = 'dash_full';
  } else if (angleFamily === 'interior_dash_driver' || angleFamily === 'interior_dash_passenger' || angleFamily === 'interior_center_console' || angleFamily === 'interior_steering_wheel') {
    angleName = 'dash_full'; // Map to existing
  } else if (angleFamily === 'interior_driver_seat') {
    angleName = 'driver_seat';
  } else if (angleFamily === 'interior_passenger_seat') {
    angleName = 'passenger_seat';
  } else if (angleFamily === 'interior_rear_seats') {
    angleName = 'rear_seats';
  } else if (angleFamily === 'interior_headliner') {
    angleName = 'headliner';
  } else if (angleFamily === 'interior_carpet') {
    angleName = 'carpet_floor';
  } else if (angleFamily === 'interior_door_driver' || angleFamily === 'interior_door_passenger' || angleFamily === 'interior_door_rear') {
    angleName = 'door_panel';
  } else if (angleFamily === 'interior_trunk' || angleFamily === 'interior_cargo' || angleFamily === 'interior_bed') {
    angleName = 'bed_interior';
  
  // UNDERCARRIAGE
  } else if (angleFamily === 'undercarriage_full' || angleFamily === 'undercarriage_front' || angleFamily === 'undercarriage_rear' || angleFamily === 'undercarriage_driver' || angleFamily === 'undercarriage_passenger' || angleFamily === 'underside') {
    angleName = 'frame_driver_front'; // Map to existing undercarriage angle
  } else if (angleFamily === 'frame_rail_driver_front') {
    angleName = 'frame_driver_front';
  } else if (angleFamily === 'frame_rail_driver_rear') {
    angleName = 'frame_driver_rear';
  } else if (angleFamily === 'frame_rail_passenger_front') {
    angleName = 'frame_passenger_front';
  } else if (angleFamily === 'frame_rail_passenger_rear') {
    angleName = 'frame_passenger_rear';
  } else if (angleFamily === 'front_suspension') {
    angleName = 'front_suspension';
  } else if (angleFamily === 'rear_suspension') {
    angleName = 'rear_suspension';
  } else if (angleFamily === 'front_axle' || angleFamily === 'rear_axle' || angleFamily === 'differential' || angleFamily === 'exhaust_system' || angleFamily === 'fuel_tank' || angleFamily === 'transmission_underside' || angleFamily === 'driveshaft' || angleFamily === 'brake_system') {
    angleName = 'front_suspension'; // Map to existing undercarriage angles
  
  // DETAILS - Exterior parts
  } else if (angleFamily === 'wheel_well_driver_front' || angleFamily === 'wheel_well_driver_rear' || angleFamily === 'wheel_well_passenger_front' || angleFamily === 'wheel_well_passenger_rear') {
    angleName = 'wheel_well';
  } else if (angleFamily === 'wheel_closeup') {
    angleName = 'wheels_closeup';
  } else if (angleFamily === 'tire_closeup') {
    angleName = 'wheels_closeup'; // Map to existing
  } else if (angleFamily === 'brake_caliper') {
    angleName = 'brake_caliper';
  } else if (angleFamily === 'brake_rotor') {
    angleName = 'brake_rotor';
  } else if (angleFamily === 'brake_pad') {
    angleName = 'brake_caliper'; // Map to existing
  } else if (angleFamily === 'door_panel_driver' || angleFamily === 'door_panel_passenger') {
    angleName = 'door_panel';
  } else if (angleFamily === 'door_jamb_driver' || angleFamily === 'door_jamb_passenger') {
    angleName = 'door_jamb_detail';
  } else if (angleFamily === 'door_handle' || angleFamily === 'mirror_driver' || angleFamily === 'mirror_passenger' || angleFamily === 'window_driver' || angleFamily === 'window_passenger') {
    angleName = 'door_panel'; // Map to existing
  } else if (angleFamily === 'headlight_driver' || angleFamily === 'headlight_passenger') {
    // Try granular angle first, fallback to generic
    angleName = angleFamily; // Will check if exists in DB, if not fallback below
  } else if (angleFamily === 'taillight_driver' || angleFamily === 'taillight_passenger') {
    // Try granular angle first, fallback to generic
    angleName = angleFamily; // Will check if exists in DB, if not fallback below
  } else if (angleFamily === 'turn_signal_driver_front' || angleFamily === 'turn_signal_passenger_front' || angleFamily === 'turn_signal' || angleFamily === 'fog_light_driver' || angleFamily === 'fog_light_passenger' || angleFamily === 'fog_light') {
    angleName = 'lights_front'; // Map to existing
  } else if (angleFamily === 'turn_signal_driver_rear' || angleFamily === 'turn_signal_passenger_rear') {
    angleName = 'lights_rear'; // Map to existing
  } else if (angleFamily === 'badges_front' || angleFamily === 'badges_rear' || angleFamily === 'badges_side' || angleFamily === 'badges') {
    angleName = 'badges';
  } else if (angleFamily === 'emblems_front' || angleFamily === 'emblems_rear' || angleFamily === 'emblems_side' || angleFamily === 'emblems') {
    angleName = 'badges'; // Map to existing
  } else if (angleFamily === 'trim_driver_front' || angleFamily === 'trim_driver_rear' || angleFamily === 'trim_passenger_front' || angleFamily === 'trim_passenger_rear' || angleFamily === 'molding_driver' || angleFamily === 'molding_passenger' || angleFamily === 'chrome_driver' || angleFamily === 'chrome_passenger') {
    angleName = 'badges'; // Map trim/molding/chrome to badges category
  } else if (angleFamily === 'grille' || angleFamily === 'bumper_front' || angleFamily === 'bumper_rear' || angleFamily === 'hood' || angleFamily === 'trunk_lid' || angleFamily === 'tailgate') {
    angleName = 'front_straight'; // Map to existing exterior angles
  } else if (angleFamily === 'fender_driver_front' || angleFamily === 'fender_driver_rear' || angleFamily === 'fender_passenger_front' || angleFamily === 'fender_passenger_rear' || angleFamily === 'quarter_panel_driver' || angleFamily === 'quarter_panel_passenger' || angleFamily === 'rocker_panel_driver' || angleFamily === 'rocker_panel_passenger') {
    angleName = 'profile_driver'; // Map to existing side angles
  } else if (angleFamily === 'badges' || angleFamily === 'emblems') {
    angleName = 'badges';
  
  // DOCUMENTS
  } else if (angleFamily === 'vin_door_jamb' || angleFamily === 'vin_plate' || (angleFamily === 'document' && primaryLabel.includes('vin'))) {
    angleName = 'door_jamb_vin';
  } else if (angleFamily === 'vin_dashboard') {
    angleName = 'dash_vin';
  } else if (angleFamily === 'vin_frame' || angleFamily === 'vin_engine') {
    angleName = 'frame_vin';
  } else if (angleFamily === 'title_document' || angleFamily === 'registration' || angleFamily === 'receipt' || angleFamily === 'invoice' || angleFamily === 'manual_page' || angleFamily === 'document') {
    angleName = 'receipt'; // Map documents to receipt category
  
  // DAMAGE & REPAIR
  } else if (angleFamily === 'rust_damage') {
    angleName = 'rust_damage';
  } else if (angleFamily === 'paint_damage' || angleFamily === 'dent_damage' || angleFamily === 'scratch_damage') {
    angleName = 'paint_damage';
  } else if (angleFamily === 'repair_before' || (angleFamily === 'labor' && classification.repair_stage === 'before')) {
    angleName = 'repair_before';
  } else if (angleFamily === 'repair_after' || (angleFamily === 'labor' && classification.repair_stage === 'after')) {
    angleName = 'repair_after';
  } else if (angleFamily === 'repair_in_progress' || angleFamily === 'labor_step' || (angleFamily === 'labor' && !classification.repair_stage)) {
    angleName = 'repair_in_progress';
  
  // FALLBACK: Try to match by part name or primary label
  } else if (partName || primaryLabel) {
    // Brake system
    if (partName?.includes('brake') || primaryLabel.includes('brake')) {
      if (partName?.includes('caliper') || primaryLabel.includes('caliper')) {
        angleName = 'brake_caliper';
      } else if (partName?.includes('rotor') || primaryLabel.includes('rotor')) {
        angleName = 'brake_rotor';
      } else {
        angleName = 'brake_caliper';
      }
    // Suspension
    } else if (partName?.includes('suspension') || primaryLabel.includes('suspension')) {
      angleName = 'suspension_component';
    // Door
    } else if (partName?.includes('door') || primaryLabel.includes('door')) {
      if (primaryLabel.includes('jamb')) {
        angleName = 'door_jamb_detail';
      } else {
        angleName = 'door_panel';
      }
    // Wheel well
    } else if (primaryLabel.includes('wheel_well') || primaryLabel.includes('wheelwell')) {
      angleName = 'wheel_well';
    // Rust
    } else if (primaryLabel.includes('rust') || partName?.includes('rust')) {
      angleName = 'rust_damage';
    // Paint
    } else if (primaryLabel.includes('paint') || partName?.includes('paint')) {
      angleName = 'paint_damage';
    // Interior detail
    } else if (primaryLabel.includes('interior')) {
      angleName = 'interior_detail';
    }
  }
  
  if (!angleName) {
    return null;
  }

  // Try to find the angle in the database
  let { data: angle } = await supabase
    .from('image_coverage_angles')
    .select('id')
    .eq('angle_name', angleName)
    .single();
  
  // If granular angle doesn't exist, try fallback mappings for specific cases
  if (!angle) {
    // Fallback mappings for granular angles that might not exist in DB yet
    if (angleName === 'headlight_driver' || angleName === 'headlight_passenger') {
      angleName = 'lights_front';
    } else if (angleName === 'taillight_driver' || angleName === 'taillight_passenger') {
      angleName = 'lights_rear';
    } else if (angleName === 'door_handle_driver' || angleName === 'door_handle_passenger') {
      angleName = 'door_panel';
    }
    
    // Try again with fallback
    if (angleName !== classification.angle_family) {
      const { data: fallbackAngle } = await supabase
        .from('image_coverage_angles')
        .select('id')
        .eq('angle_name', angleName)
        .single();
      angle = fallbackAngle;
    }
  }
  
  return angle?.id || null;
}

function mapFocalLengthToMM(focalLength?: string): number | null {
  if (!focalLength) return 35;
  
  const mapping: Record<string, number> = {
    'wide': 24,
    'normal': 35,
    'telephoto': 85,
    'macro': 50
  };
  
  return mapping[focalLength.toLowerCase()] || 35;
}
