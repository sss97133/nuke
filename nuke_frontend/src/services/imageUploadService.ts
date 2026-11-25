/**
 * Simple Image Upload Service
 * Clean implementation following design guidelines
 */

import { supabase } from '../lib/supabase';
import { extractImageMetadata } from '../utils/imageMetadata';
import { TimelineEventService } from './timelineEventService';
import { DocumentTypeDetector } from './documentTypeDetector';
import { ImageDuplicateLinker } from './imageDuplicateLinker';
import { webImageRow } from '../lib/webImageRow';
import { signPrivateStorageUrl } from '../lib/privateStorage';
import { PHOTO_BUCKET, PAPER_BUCKET, objectName, photoObjectPath, paperObjectPath, uploadOwnObject, bucketForStoragePath } from '../lib/ownStorage';

export interface ImageUploadResult {
  success: boolean;
  imageId?: string;
  imageUrl?: string;
  duplicateOf?: string;
  duplicateType?: 'exact' | 'perceptual';
  /** The end state: the row landed, the same bytes already have a row (nothing written or re-filed), or refused. */
  outcome?: 'landed' | 'duplicate' | 'refused';
  message?: string;
  error?: string;
}

export class ImageUploadService {
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private static readonly COMPRESS_THRESHOLD = 5 * 1024 * 1024; // Compress files larger than 5MB

  /**
   * Compress a large image file
   */
  private static async compressImage(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      img.onload = () => {
        // Calculate new dimensions (max 2000px on longest side)
        let width = img.width;
        let height = img.height;
        const maxDimension = 2000;
        
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg',
          0.85
        );
      };
      
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Compute a SHA-256 content hash for exact duplicate detection
   */
  private static async computeFileHash(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Load an image element from a File (for perceptual hashing)
   */
  private static loadImageElement(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      };
      img.src = objectUrl;
    });
  }

  /**
   * Convert an image to grayscale pixel matrix at a target size
   */
  private static getGrayscaleMatrix(
    img: HTMLImageElement,
    width: number,
    height: number
  ): number[] {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const grayscale: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      // luminance
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      grayscale.push(gray);
    }
    return grayscale;
  }

  /**
   * Convert bitstring to hex
   */
  private static bitsToHex(bits: string): string {
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      const chunk = bits.slice(i, i + 4);
      hex += parseInt(chunk, 2).toString(16);
    }
    return hex;
  }

  /**
   * Perceptual hash (aHash) 8x8 for near-duplicate detection
   */
  private static computeAverageHash(img: HTMLImageElement): string {
    const size = 8;
    const pixels = this.getGrayscaleMatrix(img, size, size);
    if (pixels.length === 0) return '';
    const avg = pixels.reduce((sum, val) => sum + val, 0) / pixels.length;
    const bits = pixels.map((p) => (p >= avg ? '1' : '0')).join('');
    return this.bitsToHex(bits);
  }

  /**
   * Difference hash (dHash) 8x8 for fast perceptual matching
   */
  private static computeDifferenceHash(img: HTMLImageElement): string {
    const width = 9;
    const height = 8;
    const pixels = this.getGrayscaleMatrix(img, width, height);
    if (pixels.length === 0) return '';
    const bits: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        const left = pixels[y * width + x];
        const right = pixels[y * width + x + 1];
        bits.push(left > right ? '1' : '0');
      }
    }
    return this.bitsToHex(bits.join(''));
  }

  /**
   * Compute perceptual hashes (aHash + dHash)
   */
  private static async computePerceptualHashes(file: File) {
    const img = await this.loadImageElement(file);
    const phash = this.computeAverageHash(img);
    const dhash = this.computeDifferenceHash(img);
    return { phash, dhash };
  }

  /**
   * Upload a single image to vehicle OR personal library
   * @param vehicleId - Vehicle ID (optional - if not provided, goes to personal library)
   * @param file - Image file to upload
   * @param category - Image category
   */
  static async uploadImage(
    vehicleId: string | undefined, 
    file: File, 
    category: string = 'general'
  ): Promise<ImageUploadResult> {
    try {
      // Validate file - allow images and documents for document category
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';
      const isFileDocument = isPdf || file.type.includes('document');

      if (!isImage && category !== 'document') {
        return { success: false, error: 'Please select an image file' };
      }

      if (category === 'document' && !isImage && !isPdf && !isFileDocument) {
        return { success: false, error: 'Please select an image or PDF file for documents' };
      }

      // Compress large images
      let fileToUpload = file;
      if (isImage && file.size > this.COMPRESS_THRESHOLD) {
        console.log(`Compressing large image (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
        try {
          fileToUpload = await this.compressImage(file);
          console.log(`Compressed to ${(fileToUpload.size / 1024 / 1024).toFixed(2)}MB`);
        } catch (error) {
          console.warn('Compression failed, uploading original:', error);
        }
      }

      if (fileToUpload.size > this.MAX_FILE_SIZE) {
        return { success: false, error: 'File must be smaller than 10MB' };
      }

      // Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return { success: false, error: 'Please login to upload images' };
      }

      // Compute hashes up front for dedupe (use original file for stability)
      let fileHash: string | null = null;
      let originalHash: string | null = null;
      let perceptualHash: string | null = null;
      let differenceHash: string | null = null;

      try {
        // The stored bytes' hash, as iOS computes it: it names the object and is the row's file_hash.
        fileHash = await this.computeFileHash(fileToUpload);
        // Web uploads before #3951 hashed the original file; a compressed upload is checked under both hashes.
        if (fileToUpload !== file) originalHash = await this.computeFileHash(file);
      } catch (err) {
        console.warn('Failed to compute file hash (non-blocking):', err);
      }

      if (isImage) {
        try {
          const hashes = await this.computePerceptualHashes(file);
          perceptualHash = hashes.phash || null;
          differenceHash = hashes.dhash || null;
        } catch (err) {
          console.warn('Failed to compute perceptual hash (non-blocking):', err);
        }
      }

      // Lightweight duplicate check before storage (avoid double uploads)
      let duplicateOf: string | null = null;
      let duplicateType: 'exact' | 'perceptual' | null = null;

      // The same bytes already have a row: the uploader's own (on any car, or unfiled) or one on the picked car. That row
      // keeps its filing; the web writes nothing and does not re-file it, and says so.
      if (fileHash) {
        const holders = [`user_id.eq.${user.id}`];
        if (vehicleId && vehicleId !== 'title-scan-temp') holders.push(`vehicle_id.eq.${vehicleId}`);
        const { data: exactDup, error: exactErr } = await supabase
          .from('vehicle_images')
          .select('id, image_url, vehicle_id')
          .in('file_hash', originalHash && originalHash !== fileHash ? [fileHash, originalHash] : [fileHash])
          .or(holders.join(','))
          .limit(1)
          .maybeSingle();
        if (exactErr && exactErr.code !== 'PGRST116') {
          console.warn('Exact duplicate check failed (the insert still refuses a same-car twin):', exactErr);
        } else if (exactDup) {
          return {
            success: true,
            outcome: 'duplicate',
            imageId: exactDup.id,
            imageUrl: exactDup.image_url || undefined,
            duplicateOf: exactDup.id,
            duplicateType: 'exact',
            message: exactDup.vehicle_id ? 'Already uploaded: these bytes are on a vehicle; left where they are' : 'Already uploaded: these bytes are in your unfiled photos; left there',
          };
        }
      }

      // Perceptual duplicates (same vehicle only)
      if (!duplicateOf && isImage && perceptualHash && vehicleId) {
        try {
          const { data: perceptualDup, error: phErr } = await supabase
            .from('vehicle_images')
            .select('id')
            .eq('vehicle_id', vehicleId)
            .eq('perceptual_hash', perceptualHash)
            .limit(1)
            .maybeSingle();

          if (phErr && phErr.code !== 'PGRST116') {
            console.warn('Perceptual duplicate check failed (non-blocking):', phErr);
          } else if (perceptualDup) {
            duplicateOf = perceptualDup.id;
            duplicateType = 'perceptual';
          }
        } catch (err) {
          console.warn('Perceptual duplicate check failed (non-blocking):', err);
        }
      }

      // Extract EXIF metadata for images only (use original file for EXIF, not compressed)
      let metadata: any = {};

      const rawListingContext: any = (file as any)?.listingContext;
      let listingCapturedAt: Date | undefined;
      let listingSource: string | undefined;
      let listingOriginalUrl: string | undefined;

      if (rawListingContext?.listingCapturedAt) {
        const parsed = new Date(rawListingContext.listingCapturedAt);
        if (!Number.isNaN(parsed.getTime())) {
          listingCapturedAt = parsed;
        }
      }

      if (rawListingContext?.listingSource && typeof rawListingContext.listingSource === 'string') {
        listingSource = rawListingContext.listingSource;
      }

      if (rawListingContext?.originalUrl && typeof rawListingContext.originalUrl === 'string') {
        listingOriginalUrl = rawListingContext.originalUrl;
      }

      if (isImage) {
        console.log('Extracting EXIF metadata from:', file.name);
        metadata = await extractImageMetadata(file);

        if (listingCapturedAt) {
          metadata.listingCapturedAt = listingCapturedAt;
        }

        if (listingSource) {
          metadata.listingSource = listingSource;
        }
      } else {
        console.log('Skipping EXIF extraction for non-image file:', file.name);
      }

      const uniqueId = crypto.randomUUID();
      const fileName = objectName(file.name);

      // Detect document type early since storage routing depends on it.
      // IMPORTANT: If the caller explicitly uploads as a document, force document classification.
      // Relying on filename keywords alone is unreliable (camera rolls are "IMG_1234.jpg").
      const docDetection = category === 'document'
        ? {
            type: 'other_document' as const,
            confidence: 1.0,
            suggestedRoute: 'documents' as const,
            reasoning: 'User selected document upload'
          }
        : DocumentTypeDetector.detectFromFile(file);
      const isDocument = docDetection.type !== 'vehicle_photo';
      const documentCategory = isDocument ? this.mapDocumentTypeToCategory(docDetection.type) : null;

      // Capture date is real testimony — only assert it from a real capture signal.
      // EXIF DateTimeOriginal / a source listing's capture time / the file's own
      // mtime are all genuine. Upload-now is NOT a capture date: stamping it makes
      // an old photo bucket onto the day it was uploaded/analyzed (the "wrong day"
      // bug). When no capture signal exists, leave taken_at NULL — absence held
      // open beats a fabricated timestamp.
      const photoDate: Date | null = listingCapturedAt
        || metadata.dateTaken
        || (file.lastModified ? new Date(file.lastModified) : null);
      console.log('Using date for timeline:', photoDate ? photoDate.toISOString() : '(none — taken_at left null)');

      // One landing rule with iOS (lib/ownStorage): a photo to vehicle-photos users/<uid>/capture-relay/<sha256>/<name>,
      // a paper to the private user-documents bucket. Only the original goes up; the image renderer makes the sizes.
      if (!fileHash) {
        return { success: false, outcome: 'refused', error: 'Upload refused: the file could not be hashed, so it has no storage name' };
      }
      const isPaper = isDocument || vehicleId === 'title-scan-temp';
      const bucket = isPaper ? PAPER_BUCKET : PHOTO_BUCKET;
      const storagePath = isPaper ? paperObjectPath(user.id, fileHash, file.name) : photoObjectPath(user.id, fileHash, file.name);
      const refused = await uploadOwnObject(bucket, storagePath, fileToUpload, fileToUpload.type || undefined);
      if (refused) {
        return { success: false, outcome: 'refused', error: `Upload refused by storage: ${refused}` };
      }

      // A paper is private: its row carries the object's storage URL in the private bucket, which opens for nobody until
      // a reader signs it (lib/privateStorage signPrivateStorageUrl, the rule every private-document reader uses).
      const urlData = { publicUrl: supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl };
      const readBack = async () => (isPaper ? await signPrivateStorageUrl(urlData.publicUrl, 600) : urlData.publicUrl) || undefined;

      // Skip database insert for title scanning temp uploads
      if (vehicleId === 'title-scan-temp') {
        console.log('Skipping database insert for title scan temp upload');
        return {
          success: true,
          outcome: 'landed',
          imageId: 'temp-' + uniqueId,
          imageUrl: await readBack()
        };
      }

      // Check if this is the first image for the vehicle (only if vehicle_id provided)
      let count = 0;
      if (vehicleId) {
        const result = await supabase
          .from('vehicle_images')
          .select('id', { count: 'exact', head: true })
          .eq('vehicle_id', vehicleId);
        count = result.count || 0;
      }

      // Reverse geocode location if GPS coordinates exist (await to ensure it's in payload)
      let locationWithAddress = metadata.location;
      if (metadata.location?.latitude && metadata.location?.longitude && !metadata.location.city) {
        try {
          const { reverseGeocode } = await import('../utils/imageMetadata');
          const address = await reverseGeocode(metadata.location.latitude, metadata.location.longitude);
          if (address) {
            const parts = address.split(', ');
            locationWithAddress = {
              ...metadata.location,
              address: address,
              city: parts[0] || null,
              state: parts[1] || null
            };
            console.log('Reverse geocoded location:', locationWithAddress);
          }
        } catch (err) {
          console.warn('Reverse geocoding failed (non-blocking):', err);
          locationWithAddress = metadata.location; // Use original if geocoding fails
        }
      }

      // Save to database with correct data, EXIF metadata, and variants
      // Store EXIF data in format expected by ImageInfoPanel component
      const exifPayload: Record<string, any> = {
        DateTimeOriginal: metadata.dateTaken?.toISOString(),
        camera: metadata.camera,
        // Store technical data in both formats for compatibility
        technical: metadata.technical,
        // Also store raw values at top level for easy access
        fNumber: metadata.technical?.fNumber,
        exposureTime: metadata.technical?.exposureTime,
        iso: metadata.technical?.iso,
        focalLength: metadata.technical?.focalLength,
        location: locationWithAddress,
        gps: locationWithAddress ? {
          latitude: locationWithAddress.latitude,
          longitude: locationWithAddress.longitude
        } : null,
        dimensions: metadata.dimensions
      };

      // Mark EXIF as stripped if it comes from external source (no real EXIF data)
      if (listingSource || listingOriginalUrl) {
        const hasRealExif = metadata.camera || metadata.location || metadata.technical;
        
        exifPayload.exif_status = hasRealExif ? 'partial' : 'stripped';
        exifPayload.source = {
          type: 'external',
          name: listingSource || 'unknown',
          original_url: listingOriginalUrl ?? null,
          captured_at: listingCapturedAt ? listingCapturedAt.toISOString() : null
        };
        
        // Also keep listing_context for backwards compatibility
        exifPayload.listing_context = {
          captured_at: listingCapturedAt ? listingCapturedAt.toISOString() : null,
          listing_source: listingSource ?? null,
          original_url: listingOriginalUrl ?? null
        };
      } else {
        // User-uploaded image with real EXIF
        exifPayload.exif_status = (metadata.camera || metadata.location || metadata.technical) ? 'complete' : 'minimal';
      }

      // Also store latitude/longitude at top level for easier querying
      const latitude = locationWithAddress?.latitude || metadata.location?.latitude;
      const longitude = locationWithAddress?.longitude || metadata.location?.longitude;

      // The iOS row (lib/webImageRow, checked against the Swift struct) plus the web form's columns. A picked car is
      // kept: the pick at submit is the uploader's Sign, recorded in exif_data.filing with the uploader's id.
      const row = webImageRow({
        userId: user.id,
        vehicleId: vehicleId || null,
        publicUrl: urlData.publicUrl,
        storagePath,
        fileName,
        originalFilename: file.name,
        fileSize: fileToUpload.size,
        mimeType: fileToUpload.type,
        fileHash,
        latitude: latitude || null,
        longitude: longitude || null,
        takenAt: photoDate ? photoDate.toISOString() : null, // Real capture signal only; null when unknown
        exif: exifPayload,
        cameraMake: metadata.camera?.make ?? null,
        cameraModel: metadata.camera?.model ?? null,
        isPaper,
        // A paper has no public URL for the photo pipeline to fetch: it is held ('skipped'), as iOS holds a
        // metadata-only row, until a reader signs its URL.
        aiProcessingStatus: duplicateOf ? 'duplicate_skipped' : isPaper ? 'skipped' : 'pending',
        web: {
          category,
          perceptualHash,
          dhash: differenceHash,
          duplicateOf,
          isPrimary: count === 0 && !isDocument, // First image becomes primary (not documents)
          isDocument,
          documentCategory,
          documentClassification: isDocument ? JSON.stringify({
            type: docDetection.type,
            confidence: docDetection.confidence,
            reasoning: docDetection.reasoning,
            detected_at: new Date().toISOString()
          }) : null,
        },
        nowIso: new Date().toISOString(),
      });

      const { data: dbResult, error: dbError } = await supabase
        .from('vehicle_images')
        .insert(row)
        .select('id')
        .single();

      if (dbError?.code === '23505') {
        // The picked car already holds these bytes (one row per car and hash): nothing new, nothing moved.
        return { success: true, outcome: 'duplicate', message: 'Already on this vehicle: the same bytes have a row there' };
      }
      if (dbError) {
        // The object stays: its path is its bytes, so a retry lands the row on the same object (iOS does the same).
        return { success: false, outcome: 'refused', error: `Database error: ${dbError.message}` };
      }

      // ✅ PHOTOS ARE NOT EVENTS
      // Images are evidence/documentation that attach to real work events
      // They are displayed in image gallery, not as timeline events

      // 🔑 IMAGES ARE KEYS - Check for duplicates first to unlock vehicle connections
      // If image was uploaded without vehicleId, check if it's a duplicate of an existing image
      // If duplicate found → we know which vehicle this relates to → create service relationship
      if (isImage && dbResult?.id && !vehicleId) {
        // Try duplicate-based linking first (high confidence)
        ImageDuplicateLinker.checkAndLinkDuplicate(
          dbResult.id,
          file.name,
          metadata?.exif || {},
          user.id,
          undefined // Will be set if user has an org
        ).then(result => {
          if (result.isDuplicate && result.match) {
            console.log(`🔑 Duplicate found! Linked to ${result.match.vehicleInfo.year} ${result.match.vehicleInfo.make} ${result.match.vehicleInfo.model}`);
            // Emit event for UI update
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('image_duplicate_linked', {
                detail: {
                  imageId: dbResult.id,
                  vehicleId: result.match.vehicleId,
                  vehicleInfo: result.match.vehicleInfo,
                  confidence: result.match.matchConfidence
                }
              }));
            }
          } else {
            // Fall back to GPS/time-based auto-matching
            this.autoMatchImage(dbResult.id, user.id).catch(err => {
              console.warn('Auto-match failed (non-blocking):', err);
            });
          }
        }).catch(err => {
          console.warn('Duplicate check failed, trying auto-match:', err);
          this.autoMatchImage(dbResult.id, user.id).catch(autoErr => {
            console.warn('Auto-match also failed:', autoErr);
          });
        });
      }

      // Trigger photo-pipeline-orchestrator directly (non-blocking, retried).
      // Backstops: pg_net INSERT trigger + photo-pipeline-drain cron requeue
      // anything that slips through, so a lost invoke is recoverable.
      if (isImage && !isPaper && dbResult?.id && !duplicateOf) {
        console.log('📸 Triggering photo pipeline for:', dbResult.id);
        const pipelineBody = {
          image_id: dbResult.id,
          image_url: urlData.publicUrl,
          vehicle_id: vehicleId || null,
          user_id: (await supabase.auth.getUser()).data.user?.id || null,
        };
        (async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const { error } = await supabase.functions.invoke('photo-pipeline-orchestrator', { body: pipelineBody });
              if (!error) return;
              throw error;
            } catch (err: any) {
              if (attempt === 2) {
                console.warn('📸 Photo pipeline invoke failed after retries (cron drain will pick it up):', err?.message);
                return;
              }
              await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
            }
          }
        })();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('image_processing_started', {
            detail: {
              imageId: dbResult.id,
              vehicleId: vehicleId,
              fileName: file.name
            }
          }));
        }
      } else if (isImage && dbResult?.id && duplicateOf) {
        console.log('⏩ Skipping AI analysis for duplicate image; linked to existing asset', { imageId: dbResult.id, duplicateOf });
      }

      return {
        success: true,
        outcome: 'landed',
        imageId: dbResult.id,
        imageUrl: await readBack()
      };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }


  /**
   * Map DocumentType to database category
   */
  private static mapDocumentTypeToCategory(type: string): string | null {
    const mapping: Record<string, string> = {
      'receipt': 'receipt',
      'invoice': 'invoice',
      'title': 'title',
      'registration': 'registration',
      'insurance': 'insurance',
      'manual': 'manual',
      'other_document': 'other_document'
    };
    return mapping[type] || null;
  }

  /**
   * Delete an image
   */
  static async deleteImage(imageId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get image record
      const { data: imageRecord, error: fetchError } = await supabase
        .from('vehicle_images')
        .select('storage_path')
        .eq('id', imageId)
        .single();

      if (fetchError) {
        return { success: false, error: 'Image not found' };
      }

      // Delete from storage
      if (imageRecord.storage_path) {
        const bucket = bucketForStoragePath(imageRecord.storage_path);
        const { error: storageError } = bucket
          ? await supabase.storage.from(bucket).remove([imageRecord.storage_path])
          : { error: { message: 'unknown storage path shape' } };

        if (storageError) {
          console.warn('Storage deletion failed:', storageError.message);
        }
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from('vehicle_images')
        .delete()
        .eq('id', imageId);

      if (dbError) {
        return { success: false, error: dbError.message };
      }

      return { success: true };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Auto-match an unorganized image to vehicles using GPS proximity.
   * Runs in the background after upload if vehicleId was not provided.
   *
   * Calls the 5-arg GPS overload of auto_match_image_to_vehicles (the
   * ambiguity-guard version, migration 20260610011000). The legacy 4-arg
   * overload (filename-LIKE scorer) was dropped in migration
   * 20260611040000_close_destructive_paths.sql.
   */
  private static async autoMatchImage(imageId: string, userId: string): Promise<void> {
    try {
      // The GPS overload needs the image's coordinates — fetch them first.
      const { data: img } = await supabase
        .from('vehicle_images')
        .select('latitude, longitude, taken_at')
        .eq('id', imageId)
        .maybeSingle();

      let bestMatch: { vehicle_id: string; confidence: number } | null = null;
      let matchReason = 'gps_proximity';

      if (img?.latitude != null && img?.longitude != null) {
        const { data: matches, error } = await supabase.rpc('auto_match_image_to_vehicles', {
          p_image_id: imageId,
          p_latitude: img.latitude,
          p_longitude: img.longitude,
          p_taken_at: img.taken_at,
          p_user_id: userId
        });
        if (error) {
          console.warn('Auto-match RPC failed, falling back to client-side matching:', error);
        } else if (matches && matches.length > 0) {
          bestMatch = matches[0];
        }
      }

      // Fallback: client-side matcher for no-GPS images or RPC failure.
      if (!bestMatch) {
        const { ImageVehicleMatcher } = await import('./imageVehicleMatcher');
        const match = await ImageVehicleMatcher.matchImage(imageId, { userId });
        if (match && match.vehicleId) {
          bestMatch = { vehicle_id: match.vehicleId, confidence: match.confidence };
          matchReason = 'client_side_matcher';
        }
      }

      if (!bestMatch) {
        console.log(`No auto-match found for image ${imageId}`);
        return;
      }

      // SAFETY: never auto-assign vehicle_id based on heuristic matching.
      // This prevents cross-vehicle contamination; we only store a suggestion for review.
      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update({
          suggested_vehicle_id: bestMatch.vehicle_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', imageId);

      if (updateError) {
        console.error('Failed to apply auto-match:', updateError);
        return;
      }

      console.log(`✅ Suggested match for image ${imageId}: vehicle ${bestMatch.vehicle_id} (confidence: ${(bestMatch.confidence * 100).toFixed(0)}%, via ${matchReason})`);

      // Notify UI that image was matched
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('image_auto_matched', {
          detail: {
            imageId,
            vehicleId: bestMatch.vehicle_id,
            confidence: bestMatch.confidence,
            reasons: [matchReason]
          }
        }));
      }
    } catch (error) {
      console.error('Auto-match error:', error);
    }
  }
}
