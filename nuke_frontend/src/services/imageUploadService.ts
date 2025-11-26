/**
 * Simple Image Upload Service
 * Clean implementation following design guidelines
 */

import { supabase } from '../lib/supabase';
import { extractImageMetadata } from '../utils/imageMetadata';
import { imageOptimizationService } from './imageOptimizationService';
import { TimelineEventService } from './timelineEventService';
import { DocumentTypeDetector } from './documentTypeDetector';

export interface ImageUploadResult {
  success: boolean;
  imageId?: string;
  imageUrl?: string;
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
      const docDetection = DocumentTypeDetector.detectFromFile(file);
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
          ai_processing_status: 'pending', // Queue for AI analysis
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

      // 🤖 TRIGGER AI ANALYSIS AUTOMATICALLY
      // Analyze image in background - don't wait for result
      if (isImage && dbResult?.id) {
        console.log('Triggering AI analysis for image:', dbResult.id);
        
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

        // Use tier1 function (more reliable than analyze-image)
        // Pass user_id so function can use user's API key if available
        const { data: { user } } = await supabase.auth.getUser()
        supabase.functions.invoke('analyze-image-tier1', {
          body: {
            image_url: urlData.publicUrl,
            vehicle_id: vehicleId,
            image_id: dbResult.id,
            user_id: user?.id || null
          }
        }).then(({ data, error }) => {
          if (error) {
            console.warn('AI analysis failed:', error);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('image_processing_failed', {
                detail: { imageId: dbResult.id, error: error.message }
              }));
            }
          } else {
            console.log('AI analysis succeeded:', data);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('image_processing_complete', {
                detail: { imageId: dbResult.id, result: data }
              }));
            }
          }
        }).catch(err => {
          console.warn('AI analysis error:', err);
        });
      }

      // Trigger sensitive document detection (titles, etc)
      if (isImage) {
        this.triggerBackgroundAIAnalysis(urlData.publicUrl, vehicleId, dbResult.id);
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
   * Trigger background AI analysis (non-blocking)
   * This runs async so upload feels fast
   * Now includes:
   * 1. Sensitive document detection (titles, registrations)
   * 2. Rekognition + Appraiser Brain + SPID extraction
   */
  private static triggerBackgroundAIAnalysis(imageUrl: string, vehicleId: string, imageId: string): void {
    // First: Check for sensitive documents (IMMEDIATE - blocks unauthorized access)
    supabase.functions.invoke('detect-sensitive-document', {
      body: {
        image_url: imageUrl,
        vehicle_id: vehicleId,
        image_id: imageId
      }
    }).then(({ data, error }) => {
      if (error) {
        console.warn('Sensitive document detection failed:', error);
      } else if (data?.is_sensitive) {
        console.log(`🔒 Sensitive ${data.document_type} detected - access restricted`);
        
        // EMIT EVENT FOR UI
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sensitive_document_detected', {
            detail: {
              imageId,
              vehicleId,
              documentType: data.document_type,
              extractedFields: data.extracted_fields || [],
              isPrivatized: true
            }
          }));
        }
      }
    }).catch(err => {
      console.warn('Sensitive document detection request failed:', err);
    });

    // Second: General AI analysis (tagging, quality, etc.)
    const { data: { user } } = await supabase.auth.getUser()
    supabase.functions.invoke('analyze-image', {
      body: {
        image_url: imageUrl,
        vehicle_id: vehicleId,
        timeline_event_id: null,
        user_id: user?.id || null
      }
    }).then(({ data, error }) => {
      if (error) {
        console.warn('Background AI analysis trigger failed:', error);
      }
    }).catch(err => {
      console.warn('Background AI analysis request failed:', err);
    });
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
}
