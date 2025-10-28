/**
 * Simple Image Upload Service
 * Clean implementation following design guidelines
 */

import { supabase } from '../lib/supabase';
import { extractImageMetadata } from '../utils/imageMetadata';
import { imageOptimizationService } from './imageOptimizationService';
import { TimelineEventService } from './timelineEventService';

export interface ImageUploadResult {
  success: boolean;
  imageId?: string;
  imageUrl?: string;
  error?: string;
}

export class ImageUploadService {
  private static readonly STORAGE_BUCKET = 'vehicle-images';
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
      const isDocument = isPdf || file.type.includes('document');

      if (!isImage && category !== 'document') {
        return { success: false, error: 'Please select an image file' };
      }

      if (category === 'document' && !isImage && !isPdf && !isDocument) {
        return { success: false, error: 'Please select an image or PDF file for documents' };
      }

      if (file.size > this.MAX_FILE_SIZE) {
        return { success: false, error: 'File must be smaller than 10MB' };
      }

      // Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return { success: false, error: 'Please login to upload images' };
      }

      // Extract EXIF metadata for images only
      let metadata: any = {};
      let optimizationResult: any = { success: false };

      if (isImage) {
        console.log('Extracting EXIF metadata from:', file.name);
        metadata = await extractImageMetadata(file);

        // Generate optimized variants for images
        console.log('Generating image variants...');
        optimizationResult = await imageOptimizationService.generateVariantBlobs(file);

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
      const photoDate = metadata.dateTaken || new Date(file.lastModified) || new Date();
      console.log('File date:', photoDate);
      console.log('Using date for timeline:', photoDate.toISOString());

      // Upload original to storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(this.STORAGE_BUCKET)
        .upload(storagePath, file, {
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

      // Save to database with correct data, EXIF metadata, and variants
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
          file_size: file.size,
          mime_type: file.type,
          is_primary: count === 0, // First image becomes primary
          is_sensitive: false, // Required field
          taken_at: photoDate.toISOString(), // Use actual photo date for timeline
          variants: variants, // Store all variant URLs
          exif_data: {
            DateTimeOriginal: metadata.dateTaken?.toISOString(),
            camera: metadata.camera,
            technical: metadata.technical,
            location: metadata.location,
            dimensions: metadata.dimensions
          }
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

      // Create timeline event after successful upload and link image to it
      try {
        if (isImage) {
          const eventId = await TimelineEventService.createImageUploadEvent(
            vehicleId,
            {
              fileName: file.name,
              fileSize: file.size,
              imageUrl: urlData.publicUrl,
              dateTaken: photoDate,
              gps: metadata.gps
            },
            user.id
          );

          // ✅ CRITICAL FIX: Link the image to the timeline event
          if (eventId) {
            await supabase
              .from('vehicle_images')
              .update({ timeline_event_id: eventId })
              .eq('id', dbResult.id);
          }
        } else {
          // Create document upload timeline event
          await TimelineEventService.createDocumentUploadEvent(
            vehicleId,
            {
              fileName: file.name,
              fileSize: file.size,
              documentUrl: urlData.publicUrl,
              uploadDate: photoDate,
              category: category
            },
            user.id
          );
        }
      } catch (error) {
        console.error('Failed to create timeline event:', error);
        // Don't fail the entire upload if timeline event creation fails
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
   */
  private static triggerBackgroundAIAnalysis(imageUrl: string, vehicleId: string, imageId: string): void {
    // Fire and forget - don't await this
    supabase.functions.invoke('auto-analyze-upload', {
      body: {
        image_url: imageUrl,
        vehicle_id: vehicleId,
        image_id: imageId,
        trigger_source: 'upload'
      }
    }).then(({ data, error }) => {
      if (error) {
        console.warn('Background AI analysis trigger failed:', error);
      }
      // Removed noisy success log - only log errors
    }).catch(err => {
      console.warn('Background AI analysis request failed:', err);
    });
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
