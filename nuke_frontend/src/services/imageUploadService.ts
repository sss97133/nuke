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
   * Upload a single image to vehicle
   */
  static async uploadImage(
    vehicleId: string, 
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

      // Generate simple filename: vehicleId/uniqueId.ext
      const fileExt = file.name.split('.').pop() || (isImage ? 'jpg' : 'pdf');
      const uniqueId = crypto.randomUUID();
      const fileName = `${uniqueId}.${fileExt}`;
      const storagePath = `${vehicleId}/${fileName}`;

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
          const variantPath = `${vehicleId}/${uniqueId}_${sizeName}.jpg`;

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

      // Check if this is the first image for the vehicle
      const { count } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);

      // Detect document type
      const docDetection = DocumentTypeDetector.detectFromFile(file);
      const isDocument = docDetection.type !== 'vehicle_photo';
      const documentCategory = isDocument ? this.mapDocumentTypeToCategory(docDetection.type) : null;

      // Save to database with correct data, EXIF metadata, and variants
      const exifPayload: Record<string, any> = {
        DateTimeOriginal: metadata.dateTaken?.toISOString(),
        camera: metadata.camera,
        technical: metadata.technical,
        location: metadata.location,
        dimensions: metadata.dimensions
      };

      if (listingCapturedAt || listingSource || listingOriginalUrl) {
        exifPayload.listing_context = {
          captured_at: listingCapturedAt ? listingCapturedAt.toISOString() : null,
          listing_source: listingSource ?? null,
          original_url: listingOriginalUrl ?? null
        };
      }

      const { data: dbResult, error: dbError } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: vehicleId,
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
          variants: variants, // Store all variant URLs
          exif_data: exifPayload,
          is_document: isDocument,
          document_category: documentCategory,
          document_classification: isDocument ? JSON.stringify({
            type: docDetection.type,
            confidence: docDetection.confidence,
            reasoning: docDetection.reasoning,
            detected_at: new Date().toISOString()
          }) : null
        })
        .select('id')
        .single();

      if (dbError) {
        // Clean up uploaded files if database insert fails
        const pathsToClean = [storagePath];

        // Add variant paths to cleanup list
        if (optimizationResult.success && optimizationResult.variantBlobs) {
          for (const sizeName of Object.keys(optimizationResult.variantBlobs)) {
            pathsToClean.push(`${vehicleId}/${uniqueId}_${sizeName}.jpg`);
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
        supabase.functions.invoke('analyze-image', {
          body: {
            image_url: urlData.publicUrl,
            vehicle_id: vehicleId,
            image_id: dbResult.id
          }
        }).then(({ data, error }) => {
          if (error) {
            console.warn('AI analysis failed:', error);
          } else {
            console.log('AI analysis triggered successfully');
          }
        }).catch(err => {
          console.warn('AI analysis error:', err);
        });
      }

      // Trigger AI analysis in background (non-blocking)
      // This happens async after upload completes so user doesn't wait
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
      }
    }).catch(err => {
      console.warn('Sensitive document detection request failed:', err);
    });

    // Second: General AI analysis (tagging, quality, etc.)
    supabase.functions.invoke('analyze-image', {
      body: {
        image_url: imageUrl,
        vehicle_id: vehicleId,
        timeline_event_id: null
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
