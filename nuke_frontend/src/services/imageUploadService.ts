/**
 * Simple Image Upload Service
 * Clean implementation following design guidelines
 */

import { supabase } from '../lib/supabase';
import { extractImageMetadata } from '../utils/imageMetadata';
import { imageOptimizationService } from './imageOptimizationService';
import { TimelineEventService } from './timelineEventService';
import { DocumentTypeDetector } from './documentTypeDetector';
import { ImageDuplicateLinker } from './imageDuplicateLinker';

export interface ImageUploadResult {
  success: boolean;
  imageId?: string;
  imageUrl?: string;
  duplicateOf?: string;
  duplicateType?: 'exact' | 'perceptual';
  message?: string;
  error?: string;
}

export class ImageUploadService {
  private static readonly STORAGE_BUCKET = 'vehicle-images';
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
      let perceptualHash: string | null = null;
      let differenceHash: string | null = null;

      try {
        fileHash = await this.computeFileHash(file);
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

      // Exact duplicates per vehicle (or personal library)
      if (fileHash) {
        try {
          const exactQuery = supabase
            .from('vehicle_images')
            .select('id, image_url, vehicle_id')
            .eq('file_hash', fileHash)
            .limit(1);

          if (vehicleId) {
            exactQuery.eq('vehicle_id', vehicleId);
          } else {
            exactQuery.is('vehicle_id', null).eq('user_id', user.id);
          }

          const { data: exactDup, error: exactErr } = await exactQuery.maybeSingle();
          if (exactErr && exactErr.code !== 'PGRST116') {
            console.warn('Exact duplicate check failed (non-blocking):', exactErr);
          } else if (exactDup) {
            duplicateOf = exactDup.id;
            duplicateType = 'exact';
            return {
              success: true,
              imageId: exactDup.id,
              imageUrl: exactDup.image_url,
              duplicateOf: exactDup.id,
              duplicateType: 'exact',
              message: 'Exact duplicate detected; reusing existing image'
            };
          }
        } catch (err) {
          console.warn('Exact duplicate check failed (non-blocking):', err);
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
      let optimizationResult: any = { success: false };

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

        // Generate optimized variants for images (use compressed file)
        console.log('Generating image variants...');
        optimizationResult = await imageOptimizationService.generateVariantBlobs(fileToUpload);

        if (!optimizationResult.success) {
          console.warn('Variant generation failed, uploading original only:', optimizationResult.error);
        }
      } else {
        console.log('Skipping EXIF extraction for non-image file:', file.name);
      }

      // Generate simple filename: vehicleId/uniqueId.ext OR userId/unorganized/uniqueId.ext
      const fileExt = file.name.split('.').pop() || (isImage ? 'jpg' : 'pdf');
      const uniqueId = crypto.randomUUID();
      const fileName = `${uniqueId}.${fileExt}`;
      const storagePath = vehicleId 
        ? `${vehicleId}/${fileName}`
        : `${user.id}/unorganized/${fileName}`; // Personal library

      // Use photo date if available, otherwise use current time or file modified date
      const photoDate = listingCapturedAt 
        || metadata.dateTaken 
        || (file.lastModified ? new Date(file.lastModified) : new Date());
      console.log('File date:', photoDate);
      console.log('Using date for timeline:', photoDate.toISOString());

      // Upload original to storage (use compressed version if available)
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(this.STORAGE_BUCKET)
        .upload(storagePath, fileToUpload, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        return { success: false, error: `Upload failed: ${uploadError.message}` };
      }

      // Get public URL for original
      const { data: urlData } = supabase.storage
        .from(this.STORAGE_BUCKET)
        .getPublicUrl(storagePath);

      // Upload variants and collect URLs
      const variants: any = { full: urlData.publicUrl };

      if (optimizationResult.success && optimizationResult.variantBlobs) {
        console.log('Uploading image variants...');

        for (const [sizeName, blob] of Object.entries(optimizationResult.variantBlobs)) {
          const variantPath = vehicleId 
            ? `${vehicleId}/${uniqueId}_${sizeName}.jpg`
            : `${user.id}/unorganized/${uniqueId}_${sizeName}.jpg`;

          const { data: variantUpload, error: variantError } = await supabase.storage
            .from(this.STORAGE_BUCKET)
            .upload(variantPath, blob as Blob, {
              cacheControl: '3600',
              upsert: false
            });

          if (!variantError && variantUpload) {
            const { data: variantUrl } = supabase.storage
              .from(this.STORAGE_BUCKET)
              .getPublicUrl(variantPath);

            variants[sizeName] = variantUrl.publicUrl;
            console.log(`Uploaded ${sizeName} variant:`, variantUrl.publicUrl);
          } else {
            console.warn(`Failed to upload ${sizeName} variant:`, variantError?.message);
          }
        }
      }

      // Skip database insert for title scanning temp uploads
      if (vehicleId === 'title-scan-temp') {
        console.log('Skipping database insert for title scan temp upload');
        return {
          success: true,
          imageId: 'temp-' + uniqueId,
          imageUrl: urlData.publicUrl
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

      // Detect document type
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

      const { data: dbResult, error: dbError } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: vehicleId || null, // Nullable for personal library
          user_id: user.id,
          image_url: urlData.publicUrl,
          file_name: fileName,
          filename: file.name, // Store original filename for duplicate detection
          storage_path: storagePath,
          category: category,
          file_size: fileToUpload.size, // Use compressed file size
          mime_type: fileToUpload.type,
          file_hash: fileHash,
          perceptual_hash: perceptualHash,
          dhash: differenceHash,
          duplicate_of: duplicateOf,
          is_duplicate: Boolean(duplicateOf),
          is_primary: count === 0 && !isDocument, // First image becomes primary (not documents)
          is_sensitive: false, // Required field
          taken_at: photoDate.toISOString(), // Use actual photo date for timeline
          latitude: latitude || null, // Store at top level for easier querying
          longitude: longitude || null, // Store at top level for easier querying
          variants: variants, // Store all variant URLs
          exif_data: exifPayload,
          is_document: isDocument,
          document_category: documentCategory,
          document_classification: isDocument ? JSON.stringify({
            type: docDetection.type,
            confidence: docDetection.confidence,
            reasoning: docDetection.reasoning,
            detected_at: new Date().toISOString()
          }) : null,
          ai_processing_status: duplicateOf ? 'duplicate_skipped' : 'pending', // Queue for AI analysis unless duplicate
          organization_status: vehicleId ? 'organized' : 'unorganized' // Auto-organized if linked to vehicle
        })
        .select('id')
        .single();

      if (dbError) {
        // Clean up uploaded files if database insert fails
        const pathsToClean = [storagePath];

        // Add variant paths to cleanup list
        if (optimizationResult.success && optimizationResult.variantBlobs) {
          for (const sizeName of Object.keys(optimizationResult.variantBlobs)) {
            const variantPath = vehicleId 
              ? `${vehicleId}/${uniqueId}_${sizeName}.jpg`
              : `${user.id}/unorganized/${uniqueId}_${sizeName}.jpg`;
            pathsToClean.push(variantPath);
          }
        }

        await supabase.storage
          .from(this.STORAGE_BUCKET)
          .remove(pathsToClean);

        return { success: false, error: `Database error: ${dbError.message}` };
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

      // Trigger AI analysis automatically on upload
      // This MUST trigger for every image upload - no exceptions
      if (isImage && dbResult?.id && !duplicateOf) {
        console.log('🚀 Triggering AI analysis for uploaded image:', dbResult.id);
        
        // Emit event for UI to track
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('image_processing_started', {
            detail: {
              imageId: dbResult.id,
              vehicleId: vehicleId,
              fileName: file.name
            }
          }));
        }

        // Get user for API key
        const { data: { user } } = await supabase.auth.getUser();

        // PRIMARY: Tier 1 analysis (basic organization - angle, category, quality)
        // This is the main analysis that MUST run on every upload
        supabase.functions.invoke('analyze-image-tier1', {
          body: {
            image_url: urlData.publicUrl,
            vehicle_id: vehicleId,
            image_id: dbResult.id,
            user_id: user?.id || null
          }
        }).then(({ data, error }) => {
          if (error) {
            console.error('❌ Tier 1 AI analysis failed:', error);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('image_processing_failed', {
                detail: { imageId: dbResult.id, error: error.message }
              }));
            }
          } else {
            console.log('✅ Tier 1 AI analysis succeeded:', data);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('image_processing_complete', {
                detail: { imageId: dbResult.id, result: data }
              }));
            }
          }
        }).catch(err => {
          console.error('❌ Tier 1 AI analysis error:', err);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('image_processing_failed', {
              detail: { imageId: dbResult.id, error: err.message || 'Unknown error' }
            }));
          }
        });

        // SECONDARY: Sensitive document detection (titles, registrations)
        // This runs in parallel and doesn't block the main analysis
        supabase.functions.invoke('detect-sensitive-document', {
          body: {
            image_url: urlData.publicUrl,
            vehicle_id: vehicleId,
            image_id: dbResult.id
          }
        }).then(({ data, error }) => {
          if (error) {
            console.warn('⚠️ Sensitive document detection failed:', error);
          } else if (data?.is_sensitive) {
            console.log(`🔒 Sensitive ${data.document_type} detected - access restricted`);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('sensitive_document_detected', {
                detail: {
                  imageId: dbResult.id,
                  vehicleId,
                  documentType: data.document_type,
                  extractedFields: data.extracted_fields || [],
                  isPrivatized: true
                }
              }));
            }
          }
        }).catch(err => {
          console.warn('⚠️ Sensitive document detection error:', err);
        });

        // TERTIARY: Full analysis (tagging, parts detection, etc.)
        // This provides additional detailed analysis beyond tier 1
        supabase.functions.invoke('analyze-image', {
          body: {
            image_url: urlData.publicUrl,
            vehicle_id: vehicleId,
            timeline_event_id: null,
            user_id: user?.id || null
          }
        }).then(({ data, error }) => {
          if (error) {
            console.warn('⚠️ Full AI analysis failed (non-critical):', error);
          } else {
            console.log('✅ Full AI analysis completed:', data);
          }
        }).catch(err => {
          console.warn('⚠️ Full AI analysis error (non-critical):', err);
        });
      } else if (isImage && !dbResult?.id) {
        // Fallback: If database insert failed but image was uploaded, still try analysis
        console.warn('⚠️ Database insert failed but image uploaded, attempting analysis anyway');
        const { data: { user } } = await supabase.auth.getUser();
        supabase.functions.invoke('analyze-image-tier1', {
          body: {
            image_url: urlData.publicUrl,
            vehicle_id: vehicleId,
            image_id: null, // No image_id available
            user_id: user?.id || null
          }
        }).catch(err => {
          console.error('❌ Fallback analysis failed:', err);
        });
      } else if (isImage && dbResult?.id && duplicateOf) {
        console.log('⏩ Skipping AI analysis for duplicate image; linked to existing asset', { imageId: dbResult.id, duplicateOf });
      }

      return {
        success: true,
        imageId: dbResult.id,
        imageUrl: urlData.publicUrl
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
        const { error: storageError } = await supabase.storage
          .from(this.STORAGE_BUCKET)
          .remove([imageRecord.storage_path]);

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
   * Auto-match an unorganized image to vehicles using GPS, date, and filename
   * This runs in the background after upload if vehicleId was not provided
   */
  private static async autoMatchImage(imageId: string, userId: string): Promise<void> {
    try {
      // Use the database function for efficient matching
      const { data: matches, error } = await supabase
        .rpc('auto_match_image_to_vehicles', {
          p_image_id: imageId,
          p_max_gps_distance_meters: 50,
          p_max_date_difference_days: 30,
          p_min_confidence: 0.5
        });

      if (error) {
        console.warn('Auto-match RPC failed, falling back to client-side matching:', error);
        // Fallback to client-side matching
        const { ImageVehicleMatcher } = await import('./imageVehicleMatcher');
        const match = await ImageVehicleMatcher.matchImage(imageId, { userId });
        if (match && match.vehicleId) {
          // SAFETY: do not auto-apply; only store suggestion.
          await supabase
            .from('vehicle_images')
            .update({
              suggested_vehicle_id: match.vehicleId,
              updated_at: new Date().toISOString()
            })
            .eq('id', imageId);
          console.log(`✅ Suggested match for image ${imageId}: vehicle ${match.vehicleId} (confidence: ${(match.confidence * 100).toFixed(0)}%)`);
        }
        return;
      }

      if (!matches || matches.length === 0) {
        console.log(`No auto-match found for image ${imageId}`);
        return;
      }

      // Get the best match (highest confidence)
      const bestMatch = matches[0];

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

      console.log(`✅ Suggested match for image ${imageId}: vehicle ${bestMatch.vehicle_id} (confidence: ${(bestMatch.confidence * 100).toFixed(0)}%)`);
      console.log('Match reasons:', bestMatch.match_reasons);

      // Notify UI that image was matched
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('image_auto_matched', {
          detail: {
            imageId,
            vehicleId: bestMatch.vehicle_id,
            confidence: bestMatch.confidence,
            reasons: bestMatch.match_reasons
          }
        }));
      }
    } catch (error) {
      console.error('Auto-match error:', error);
    }
  }
}
