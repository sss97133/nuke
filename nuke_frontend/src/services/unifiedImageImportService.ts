/**
 * UNIFIED IMAGE IMPORT SERVICE
 * 
 * SINGLE SOURCE OF TRUTH for all image imports/uploads
 * 
 * All entry points should use this service:
 * - Direct user uploads
 * - BaT imports
 * - Dropbox imports
 * - Apple uploads
 * - External scrapers
 * 
 * This ensures:
 * - Correct attribution (photographer vs importer)
 * - Ghost user handling
 * - Device attribution
 * - Consistent database fields
 * - AI analysis triggers
 */

import { supabase } from '../lib/supabase';
import { extractImageMetadata } from '../utils/imageMetadata';
import { imageOptimizationService } from './imageOptimizationService';

export interface ImageImportOptions {
  // Required
  file: File | Blob | Buffer | Uint8Array;
  vehicleId?: string | null; // null = personal library
  
  // Attribution (automatically handled if not provided)
  userId?: string; // Photographer - if provided, use this. Otherwise extract from auth/EXIF
  importedBy?: string; // Who ran the import (for automated imports like BaT, Dropbox)
  
  // Metadata
  category?: string;
  takenAt?: Date | string;
  source?: 'user_upload' | 'dropbox_import' | 'bat_listing' | 'apple_upload' | 'scraper' | 'external';
  sourceUrl?: string; // Original URL if scraped (BaT, external listings)
  
  // Options
  createTimelineEvent?: boolean;
  makePrimary?: boolean;
  stage?: string;
  
  // EXIF override (if already extracted, saves re-extraction)
  exifData?: any;
  
  // Storage options
  storageBucket?: string;
  storagePath?: string; // Custom path, otherwise auto-generated
}

export interface ImageImportResult {
  success: boolean;
  imageId?: string;
  imageUrl?: string;
  ghostUserId?: string; // If created/used
  error?: string;
}

/**
 * Generate device fingerprint from EXIF data
 */
function generateDeviceFingerprint(exifData: any): string | null {
  if (!exifData) return null;
  
  const make = exifData.Make?.description || exifData.Make || 'Unknown';
  const model = exifData.Model?.description || exifData.Model || 'Unknown';
  const lens = exifData.LensModel?.description || exifData.LensModel || 'Unknown';
  const software = exifData.Software?.description || exifData.Software || 'Unknown';
  
  return `${make}-${model}-${lens}-${software}`;
}

/**
 * Get or create ghost user from device fingerprint
 */
async function getOrCreateGhostUser(
  deviceFingerprint: string,
  exifData: any
): Promise<string | null> {
  if (!deviceFingerprint || deviceFingerprint === 'Unknown-Unknown-Unknown-Unknown') {
    return null;
  }
  
  try {
    // Try to find existing ghost user
    const { data: existing } = await supabase
      .from('ghost_users')
      .select('id')
      .eq('device_fingerprint', deviceFingerprint)
      .maybeSingle();
    
    if (existing?.id) {
      // Update last_seen and increment contributions
      // Note: Incrementing in a separate query since Supabase client doesn't support raw SQL
      const { data: current } = await supabase
        .from('ghost_users')
        .select('total_contributions')
        .eq('id', existing.id)
        .single();
      
      await supabase
        .from('ghost_users')
        .update({
          last_seen_at: new Date().toISOString(),
          total_contributions: (current?.total_contributions || 0) + 1
        })
        .eq('id', existing.id);
      
      return existing.id;
    }
    
    // Create new ghost user
    const cameraMake = exifData.Make?.description || exifData.Make || 'Unknown';
    const cameraModel = exifData.Model?.description || exifData.Model || 'Unknown';
    const lensModel = exifData.LensModel?.description || exifData.LensModel || null;
    const software = exifData.Software?.description || exifData.Software || null;
    
    const displayName = lensModel 
      ? `${cameraMake} ${cameraModel} (${lensModel})`
      : `${cameraMake} ${cameraModel}`;
    
    const { data: newGhost, error } = await supabase
      .from('ghost_users')
      .insert({
        device_fingerprint: deviceFingerprint,
        camera_make: cameraMake,
        camera_model: cameraModel,
        lens_model: lensModel,
        software_version: software,
        display_name: displayName,
        total_contributions: 1
      })
      .select('id')
      .single();
    
    if (error || !newGhost) {
      console.error('Failed to create ghost user:', error);
      return null;
    }
    
    return newGhost.id;
  } catch (error) {
    console.error('Error in getOrCreateGhostUser:', error);
    return null;
  }
}

/**
 * Create device attribution record
 */
async function createDeviceAttribution(
  imageId: string,
  ghostUserId: string,
  uploadedByUserId: string | null,
  deviceFingerprint: string,
  attributionSource: string = 'exif_device',
  confidenceScore: number = 100
): Promise<void> {
  try {
    await supabase
      .from('device_attributions')
      .insert({
        image_id: imageId,
        device_fingerprint: deviceFingerprint,
        ghost_user_id: ghostUserId,
        uploaded_by_user_id: uploadedByUserId,
        attribution_source: attributionSource,
        confidence_score: confidenceScore
      });
  } catch (error) {
    console.error('Failed to create device attribution:', error);
    // Non-critical, continue
  }
}

/**
 * Trigger AI analysis for image
 */
async function triggerAIAnalysis(
  imageId: string,
  imageUrl: string,
  vehicleId?: string | null,
  userId?: string | null
): Promise<void> {
  // Vision analysis (replaces deprecated analyze-image-tier1)
  supabase.functions.invoke('analyze-image', {
    body: {
      image_url: imageUrl,
      image_id: imageId,
      vehicle_id: vehicleId,
      timeline_event_id: null,
      user_id: userId
    }
  }).catch(err => console.warn('Vision analysis failed:', err));
  
  // Sensitive document detection
  supabase.functions.invoke('detect-sensitive-document', {
    body: {
      image_url: imageUrl,
      vehicle_id: vehicleId,
      image_id: imageId
    }
  }).catch(err => console.warn('Sensitive document detection failed:', err));
  
  // NOTE: analyze-image already covers tags + VIN/SPID OCR + metadata; no separate secondary call.
}

/**
 * Convert various file types to Blob for browser/Node compatibility
 */
function fileToBlob(file: File | Blob | Buffer | Uint8Array): Blob {
  if (file instanceof Blob || file instanceof File) {
    return file;
  }
  
  if (file instanceof Buffer || file instanceof Uint8Array) {
    // Copy into a new Uint8Array backed by an ArrayBuffer (avoid SharedArrayBuffer typing issues).
    const bytes = Uint8Array.from(file as any);
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  
  throw new Error('Unsupported file type');
}

/**
 * UNIFIED IMAGE IMPORT SERVICE
 * 
 * This is the SINGLE SOURCE OF TRUTH for all image imports.
 * Use this for:
 * - Direct user uploads
 * - BaT imports
 * - Dropbox imports
 * - Apple uploads
 * - External scrapers
 */
export class UnifiedImageImportService {
  private static readonly STORAGE_BUCKET = 'vehicle-images';
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * Import an image with proper attribution and metadata
   */
  static async importImage(options: ImageImportOptions): Promise<ImageImportResult> {
    try {
      const {
        file,
        vehicleId,
        userId: providedUserId,
        importedBy,
        category = 'general',
        takenAt,
        source = 'user_upload',
        sourceUrl,
        createTimelineEvent = false,
        makePrimary,
        stage,
        exifData: providedExifData,
        storageBucket = this.STORAGE_BUCKET,
        storagePath: customStoragePath
      } = options;

      // Convert file to Blob for consistency
      const fileBlob = fileToBlob(file);
      
      // Validate file size (rough check)
      if (fileBlob.size > this.MAX_FILE_SIZE) {
        return { success: false, error: `File size exceeds ${this.MAX_FILE_SIZE / 1024 / 1024}MB limit` };
      }

      // Step 1: Extract EXIF metadata
      let exifData = providedExifData;
      if (!exifData && file instanceof File) {
        try {
          exifData = await extractImageMetadata(file);
        } catch (error) {
          console.warn('EXIF extraction failed:', error);
          exifData = {};
        }
      }

      // Step 2: Determine photographer (user_id)
      // Priority: provided userId > ghost user from EXIF > authenticated user > fallback
      let photographerId = providedUserId;
      let ghostUserId: string | null = null;

      if (!photographerId) {
        // Try to get authenticated user
        const { data: { user } } = await supabase.auth.getUser();
        photographerId = user?.id || undefined;
      }

      // Step 3: Check if EXIF suggests different photographer (ghost user)
      // Only if no explicit userId provided (don't override intentional attribution)
      if (!providedUserId && exifData) {
        const deviceFingerprint = generateDeviceFingerprint(exifData);
        
        if (deviceFingerprint) {
          // Special handling for BaT imports (unknown photographer)
          if (source === 'bat_listing') {
            // Create ghost user for BaT photographer
            const batFingerprint = `BaT-Photographer-${sourceUrl || 'Unknown'}`;
            ghostUserId = await getOrCreateGhostUser(batFingerprint, {
              Make: { description: 'Unknown' },
              Model: { description: 'BaT Listing' }
            });
            
            if (ghostUserId) {
              photographerId = ghostUserId;
            }
          } else {
            // Normal EXIF-based ghost user attribution
            ghostUserId = await getOrCreateGhostUser(deviceFingerprint, exifData);
            
            if (ghostUserId) {
              photographerId = ghostUserId; // Use ghost user as photographer
            }
          }
        }
      }

      // Fallback: if still no photographer ID, use importedBy
      if (!photographerId && importedBy) {
        photographerId = importedBy;
      }

      if (!photographerId) {
        return { success: false, error: 'Could not determine photographer (user_id required)' };
      }

      // Step 4: Generate storage path
      const fileExt = (file instanceof File ? file.name.split('.').pop() : 'jpg') || 'jpg';
      const uniqueId = crypto.randomUUID();
      
      let storagePath = customStoragePath;
      if (!storagePath) {
        if (vehicleId) {
          storagePath = `${vehicleId}/${uniqueId}.${fileExt}`;
        } else if (photographerId) {
          storagePath = `${photographerId}/unorganized/${uniqueId}.${fileExt}`;
        } else {
          storagePath = `temp/${uniqueId}.${fileExt}`;
        }
      }

      // Step 5: Upload to storage
      const { error: uploadError } = await supabase.storage
        .from(storageBucket)
        .upload(storagePath, fileBlob, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        return { success: false, error: `Upload failed: ${uploadError.message}` };
      }

      // Step 6: Get public URL
      const { data: urlData } = supabase.storage
        .from(storageBucket)
        .getPublicUrl(storagePath);

      // Step 7: Generate optimized variants (browser only, skip for Node.js/server)
      let variants: any = { full: urlData.publicUrl };
      if (typeof window !== 'undefined' && file instanceof File) {
        try {
          const optimizationResult = await imageOptimizationService.generateVariantBlobs(file);
          if (optimizationResult.success && optimizationResult.variantBlobs) {
            for (const [sizeName, blob] of Object.entries(optimizationResult.variantBlobs)) {
              const variantPath = vehicleId 
                ? `${vehicleId}/${uniqueId}_${sizeName}.jpg`
                : `${photographerId}/unorganized/${uniqueId}_${sizeName}.jpg`;

              const { error: variantError } = await supabase.storage
                .from(storageBucket)
                .upload(variantPath, blob as Blob, { cacheControl: '3600', upsert: false });

              if (!variantError) {
                const { data: variantUrl } = supabase.storage
                  .from(storageBucket)
                  .getPublicUrl(variantPath);
                variants[sizeName] = variantUrl.publicUrl;
              }
            }
          }
        } catch (error) {
          console.warn('Variant generation failed:', error);
        }
      }

      // Step 8: Determine taken_at date
      const photoDate = takenAt 
        ? (typeof takenAt === 'string' ? new Date(takenAt) : takenAt)
        : (exifData?.dateTaken 
          ? new Date(exifData.dateTaken) 
          : (file instanceof File && file.lastModified 
            ? new Date(file.lastModified) 
            : new Date()));

      // Step 9: Determine if primary image (only if vehicleId provided)
      let isPrimary = makePrimary;
      if (isPrimary === undefined && vehicleId) {
        const { count } = await supabase
          .from('vehicle_images')
          .select('id', { count: 'exact', head: true })
          .eq('vehicle_id', vehicleId);
        isPrimary = (count || 0) === 0;
      }

      // If caller explicitly wants to make this primary, clear any existing primary first.
      // (DB has a unique index guardrail, so this prevents hard failures.)
      if (vehicleId && makePrimary === true) {
        try {
          await supabase
            .from('vehicle_images')
            .update({ is_primary: false } as any)
            .eq('vehicle_id', vehicleId)
            .eq('is_primary', true);
        } catch {
          // best-effort
        }
      }

      // Step 10: Build EXIF payload
      const exifPayload: Record<string, any> = {
        DateTimeOriginal: photoDate.toISOString(),
        camera: exifData?.camera,
        technical: exifData?.technical,
        location: exifData?.location,
        dimensions: exifData?.dimensions
      };

      if (sourceUrl) {
        exifPayload.source_url = sourceUrl;
      }

      // Step 11: Insert into database
      const insertBase: any = {
        vehicle_id: vehicleId || null,
        user_id: photographerId, // Photographer (ghost user or real user)
        image_url: urlData.publicUrl,
        storage_path: storagePath,
        category: category,
        is_primary: isPrimary || false,
        // Explicitly mark as non-document to keep legacy NULL rows from disappearing in galleries.
        is_document: false,
        is_duplicate: false,
        taken_at: photoDate.toISOString(),
        source: source,
        source_url: sourceUrl || null,
        exif_data: exifPayload,
        variants: variants,
      };

      // Optional columns may drift across environments; try once with extras, then retry without them if needed.
      const insertWithOptional: any = {
        ...insertBase,
        file_size: fileBlob.size,
        mime_type: fileBlob.type || 'image/jpeg',
        process_stage: stage || null,
        ai_processing_status: 'pending',
      };

      const doInsert = async (payload: any) => {
        return supabase
          .from('vehicle_images')
          .insert(payload)
          .select('id')
          .single();
      };

      let dbResult: any = null;
      let dbError: any = null;
      ({ data: dbResult, error: dbError } = await doInsert(insertWithOptional));
      if (dbError) {
        const msg = String(dbError?.message || '');
        const looksLikeMissingColumn = msg.toLowerCase().includes('schema cache') || msg.toLowerCase().includes('column') && msg.toLowerCase().includes('does not exist');
        if (looksLikeMissingColumn) {
          ({ data: dbResult, error: dbError } = await doInsert(insertBase));
        }
      }

      if (dbError) {
        // Cleanup storage on database failure
        await supabase.storage.from(storageBucket).remove([storagePath]);
        return { success: false, error: `Database error: ${dbError.message}` };
      }

      const imageId = dbResult.id;

      // Keep `vehicles.primary_image_url` + denormalized variants in sync for fast feeds/cards.
      // Best-effort: failures here shouldn't block the upload/import.
      if (vehicleId && (isPrimary === true)) {
        try {
          const v = (variants && typeof variants === 'object') ? variants : {};
          const bestLarge = String((v as any)?.large || (v as any)?.full || urlData.publicUrl);
          const bestMedium = String((v as any)?.medium || (v as any)?.large || urlData.publicUrl);
          const bestThumb = String((v as any)?.thumbnail || (v as any)?.medium || urlData.publicUrl);
          const vehicleUpdates: any = {
            primary_image_url: bestLarge,
            image_url: bestLarge,
            image_variants: {
              thumbnail: bestThumb,
              medium: bestMedium,
              large: bestLarge,
            },
            updated_at: new Date().toISOString(),
          };
          await supabase.from('vehicles').update(vehicleUpdates).eq('id', vehicleId);
        } catch {
          // ignore (non-blocking)
        }
      }

      // Step 12: Create device attribution if ghost user was used
      if (ghostUserId && exifData) {
        const deviceFingerprint = generateDeviceFingerprint(exifData);
        if (deviceFingerprint) {
          await createDeviceAttribution(
            imageId,
            ghostUserId,
            importedBy || null,
            deviceFingerprint,
            source === 'bat_listing' ? 'bat_listing_unknown_photographer' : 'exif_device',
            source === 'bat_listing' ? 50 : 100 // Lower confidence for BaT (unknown photographer)
          );
        }
      }

      // Step 13: Trigger AI analysis (non-blocking)
      triggerAIAnalysis(imageId, urlData.publicUrl, vehicleId || null, photographerId);

      // Step 14: Create timeline event if requested
      if (createTimelineEvent && vehicleId) {
        try {
          await supabase
            .from('timeline_events')
            .insert({
              vehicle_id: vehicleId,
              user_id: photographerId,
              event_type: 'image_upload',
              source: source,
              title: 'Photo added',
              event_date: photoDate.toISOString(),
              image_urls: [urlData.publicUrl],
              metadata: {
                image_id: imageId
              }
            });
        } catch (error) {
          console.warn('Failed to create timeline event:', error);
        }
      }

      return {
        success: true,
        imageId,
        imageUrl: urlData.publicUrl,
        ghostUserId: ghostUserId || undefined
      };

    } catch (error: any) {
      console.error('UnifiedImageImportService error:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }
}

