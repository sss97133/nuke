import { supabase } from '../lib/supabase';
import { EventPipeline } from './eventPipeline';

/**
 * Image Tracking Service
 * 
 * Ensures ALL images in the database have proper:
 * 1. Timeline events
 * 2. User contribution tracking
 * 3. Profile stats updates
 * 4. Achievement tracking
 * 
 * Handles both real-time tracking during upload and backfill for existing images.
 */

export interface ImageTrackingData {
  vehicleId: string;
  imageUrl: string;
  userId: string;
  filename: string;
  uploadedAt: string;
  source?: string;
}

export class ImageTrackingService {
  
  /**
   * Process a single image upload through the complete tracking pipeline
   */
  static async trackImageUpload(data: ImageTrackingData): Promise<void> {
    try {
      // 1. Ensure timeline event exists
      await this.ensureTimelineEvent(data);
      
      // 2. Process through EventPipeline for comprehensive tracking
      await EventPipeline.processEvent({
        vehicleId: data.vehicleId,
        userId: data.userId,
        eventType: 'image_upload',
        eventData: {
          uploadedUrls: [data.imageUrl],
          count: 1,
          source: data.source || 'image_upload',
          filename: data.filename,
          uploadedAt: data.uploadedAt
        },
        metadata: {
          source: data.source || 'image_upload',
          count: 1,
          uploadedUrls: [data.imageUrl],
          filename: data.filename,
          uploadedAt: data.uploadedAt,
          tracking_source: 'ImageTrackingService'
        }
      });

      console.log(`✅ Image tracking completed for: ${data.filename}`);
      
    } catch (error) {
      console.error('Error tracking image upload:', error);
      throw error;
    }
  }

  /**
   * Process batch image uploads through the tracking pipeline
   */
  static async trackBatchImageUpload(images: ImageTrackingData[]): Promise<void> {
    if (images.length === 0) return;

    try {
      // Group images by vehicle for batch processing
      const imagesByVehicle = images.reduce((acc, image) => {
        if (!acc[image.vehicleId]) {
          acc[image.vehicleId] = [];
        }
        acc[image.vehicleId].push(image);
        return acc;
      }, {} as Record<string, ImageTrackingData[]>);

      // Process each vehicle's images as a batch
      for (const [vehicleId, vehicleImages] of Object.entries(imagesByVehicle)) {
        const userId = vehicleImages[0].userId; // Assume same user for batch
        const uploadedUrls = vehicleImages.map(img => img.imageUrl);
        
        // 1. Ensure timeline events for all images
        for (const image of vehicleImages) {
          await this.ensureTimelineEvent(image);
        }

        // 2. Create batch timeline event
        await EventPipeline.processEvent({
          vehicleId,
          userId,
          eventType: 'image_upload',
          eventData: {
            uploadedUrls,
            count: vehicleImages.length,
            source: vehicleImages[0].source || 'batch_upload',
            filenames: vehicleImages.map(img => img.filename),
            uploadedAt: vehicleImages[0].uploadedAt
          },
          metadata: {
            source: vehicleImages[0].source || 'batch_upload',
            count: vehicleImages.length,
            uploadedUrls,
            filenames: vehicleImages.map(img => img.filename),
            uploadedAt: vehicleImages[0].uploadedAt,
            tracking_source: 'ImageTrackingService_Batch'
          }
        });

        console.log(`✅ Batch image tracking completed for vehicle ${vehicleId}: ${vehicleImages.length} images`);
      }
      
    } catch (error) {
      console.error('Error tracking batch image upload:', error);
      throw error;
    }
  }

  /**
   * Backfill timeline events and contributions for existing images
   */
  static async backfillImageTracking(): Promise<{ processed: number; errors: number }> {
    console.log('🔄 Starting image tracking backfill...');
    
    let processed = 0;
    let errors = 0;
    let offset = 0;
    const batchSize = 50;

    try {
      while (true) {
        // Get batch of images that might need backfill
        const { data: images, error } = await supabase
          .from('vehicle_images')
          .select(`
            id,
            vehicle_id,
            user_id,
            image_url,
            filename,
            created_at,
            storage_path
          `)
          .order('created_at', { ascending: true })
          .range(offset, offset + batchSize - 1);

        if (error) {
          console.error('Error fetching images for backfill:', error);
          break;
        }

        if (!images || images.length === 0) {
          break; // No more images to process
        }

        // Process each image
        for (const image of images) {
          try {
            // Check if timeline event already exists for this image
            const hasTimelineEvent = await this.hasTimelineEventForImage(image.vehicle_id, image.image_url, image.created_at);
            
            if (!hasTimelineEvent && image.user_id) {
              // Create tracking data
              const trackingData: ImageTrackingData = {
                vehicleId: image.vehicle_id,
                imageUrl: image.image_url,
                userId: image.user_id,
                filename: image.filename || 'unknown.jpg',
                uploadedAt: image.created_at,
                source: 'backfill_tracking'
              };

              // Track the image (this will create timeline event and update contributions)
              await this.trackImageUpload(trackingData);
              processed++;
              
              // Small delay to prevent overwhelming the database
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
          } catch (error) {
            console.error(`Error processing image ${image.id}:`, error);
            errors++;
          }
        }

        offset += batchSize;
        console.log(`📊 Backfill progress: ${processed} processed, ${errors} errors, checking next batch...`);
      }

      console.log(`✅ Image tracking backfill completed: ${processed} images processed, ${errors} errors`);
      return { processed, errors };
      
    } catch (error) {
      console.error('Fatal error during backfill:', error);
      return { processed, errors: errors + 1 };
    }
  }

  /**
   * Check if a timeline event exists for a specific image
   */
  private static async hasTimelineEventForImage(vehicleId: string, imageUrl: string, uploadDate: string): Promise<boolean> {
    try {
      // Check for timeline events on the same date that mention this image URL
      const uploadDateOnly = uploadDate.split('T')[0];
      
      const { data, error } = await supabase
        .from('timeline_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('event_date', uploadDateOnly)
        .or(`metadata->uploadedUrls.cs.["${imageUrl}"],description.ilike.%${imageUrl.split('/').pop()}%`)
        .limit(1);

      if (error) {
        console.warn('Error checking for existing timeline event:', error);
        return false;
      }

      return (data && data.length > 0);
      
    } catch (error) {
      console.warn('Error in hasTimelineEventForImage:', error);
      return false;
    }
  }

  /**
   * Ensure a timeline event exists for an image
   */
  private static async ensureTimelineEvent(data: ImageTrackingData): Promise<void> {
    const hasEvent = await this.hasTimelineEventForImage(data.vehicleId, data.imageUrl, data.uploadedAt);
    
    if (!hasEvent) {
      // Create individual timeline event for this image
      const eventDate = data.uploadedAt.split('T')[0];
      
      const timelineEvent = {
        vehicle_id: data.vehicleId,
        user_id: data.userId,
        event_type: 'image_upload',
        source: data.source || 'image_upload',
        event_date: eventDate,
        title: 'Photo Added',
        description: `Uploaded image: ${data.filename}`,
        metadata: {
          source: data.source || 'image_upload',
          count: 1,
          uploadedUrls: [data.imageUrl],
          filename: data.filename,
          uploadedAt: data.uploadedAt,
          confidence_score: 100,
          tracking_source: 'ImageTrackingService'
        }
      };

      const { error } = await supabase
        .from('timeline_events')
        .insert([timelineEvent]);

      if (error) {
        console.error('Error creating timeline event:', error);
        throw error;
      }
    }
  }

  /**
   * Get statistics about image tracking coverage
   */
  static async getTrackingStats(): Promise<{
    totalImages: number;
    imagesWithTimeline: number;
    imagesWithoutTimeline: number;
    coveragePercentage: number;
  }> {
    try {
      // Get total image count
      const { count: totalImages } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true });

      // Get images with timeline events (approximate)
      const { data: timelineEvents } = await supabase
        .from('timeline_events')
        .select('metadata')
        .eq('event_type', 'image_upload')
        .not('metadata->uploadedUrls', 'is', null);

      // Count unique image URLs in timeline events
      const trackedImageUrls = new Set();
      timelineEvents?.forEach(event => {
        const urls = event.metadata?.uploadedUrls || [];
        urls.forEach((url: string) => trackedImageUrls.add(url));
      });

      const imagesWithTimeline = trackedImageUrls.size;
      const imagesWithoutTimeline = (totalImages || 0) - imagesWithTimeline;
      const coveragePercentage = totalImages ? Math.round((imagesWithTimeline / totalImages) * 100) : 0;

      return {
        totalImages: totalImages || 0,
        imagesWithTimeline,
        imagesWithoutTimeline,
        coveragePercentage
      };
      
    } catch (error) {
      console.error('Error getting tracking stats:', error);
      return {
        totalImages: 0,
        imagesWithTimeline: 0,
        imagesWithoutTimeline: 0,
        coveragePercentage: 0
      };
    }
  }

  /**
   * Validate and fix user contribution counts
   */
  static async validateUserContributions(): Promise<void> {
    try {
      console.log('🔄 Validating user contribution counts...');

      // Get all users with images
      const { data: users } = await supabase
        .from('vehicle_images')
        .select('user_id')
        .not('user_id', 'is', null);

      if (!users) return;

      const uniqueUserIds = [...new Set(users.map(u => u.user_id))];

      for (const userId of uniqueUserIds) {
        // Count actual images for this user
        const { count: actualImageCount } = await supabase
          .from('vehicle_images')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);

        // Get current profile stats
        const { data: currentStats } = await supabase
          .from('profile_stats')
          .select('total_images, total_contributions')
          .eq('user_id', userId)
          .single();

        if (currentStats && actualImageCount !== currentStats.total_images) {
          console.log(`📊 Fixing image count for user ${userId}: ${currentStats.total_images} → ${actualImageCount}`);
          
          // Update profile stats
          await supabase
            .from('profile_stats')
            .upsert({
              user_id: userId,
              total_images: actualImageCount || 0,
              last_activity: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'user_id'
            });
        }
      }

      console.log('✅ User contribution validation completed');
      
    } catch (error) {
      console.error('Error validating user contributions:', error);
    }
  }
}
