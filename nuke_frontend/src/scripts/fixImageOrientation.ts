/**
 * Batch fix image orientation for existing images
 * Run this script to reprocess all existing vehicle images with proper EXIF orientation handling
 */

import { supabase } from '../lib/supabase';
import { imageOptimizationService } from '../services/imageOptimizationService';

interface ImageRecord {
  id: string;
  vehicle_id: string;
  image_url: string;
  filename: string;
  storage_path: string;
}

async function fixImageOrientation() {
  console.log('🔄 Starting image orientation fix...');

  try {
    // Get all vehicle images that need reprocessing
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, vehicle_id, image_url, filename, storage_path')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching images:', error);
      return;
    }

    if (!images || images.length === 0) {
      console.log('✅ No images to process');
      return;
    }

    console.log(`📊 Found ${images.length} images to reprocess`);

    let processed = 0;
    let errors = 0;

    for (const image of images) {
      try {
        console.log(`🔄 Processing ${image.filename} (${processed + 1}/${images.length})`);

        // Generate properly oriented variants
        const result = await imageOptimizationService.generateVariantBlobs(
          await fetchAsFile(image.image_url, image.filename)
        );

        if (result.success && result.variantBlobs) {
          const urls: any = {};

          // Upload each variant with proper orientation
          for (const [variantName, blob] of Object.entries(result.variantBlobs)) {
            const variantPath = `vehicles/${image.vehicle_id}/images/${variantName}/${image.filename}`;

            // Upload the corrected variant
            const { error: uploadError } = await supabase.storage
              .from('vehicle-data')
              .upload(variantPath, blob, { upsert: true });

            if (!uploadError) {
              const { data: urlData } = supabase.storage
                .from('vehicle-data')
                .getPublicUrl(variantPath);

              urls[`${variantName}_url`] = urlData.publicUrl;
            }
          }

          // Update database with new variant URLs
          const { error: updateError } = await supabase
            .from('vehicle_images')
            .update({
              thumbnail_url: urls.thumbnail_url,
              medium_url: urls.medium_url,
              large_url: urls.large_url
            })
            .eq('id', image.id);

          if (updateError) {
            console.error(`❌ Error updating ${image.filename}:`, updateError);
            errors++;
          } else {
            console.log(`✅ Fixed ${image.filename}`);
            processed++;
          }
        } else {
          console.error(`❌ Failed to process ${image.filename}:`, result.error);
          errors++;
        }

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Error processing ${image.filename}:`, error);
        errors++;
      }
    }

    console.log(`\n📊 Processing complete:`);
    console.log(`✅ Successfully processed: ${processed} images`);
    console.log(`❌ Errors: ${errors} images`);
    console.log(`📈 Success rate: ${((processed / images.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('💥 Fatal error:', error);
  }
}

async function fetchAsFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
}

// Export for use in console or as npm script
export { fixImageOrientation };

// Run immediately if called directly
if (typeof window !== 'undefined' && window.location?.search?.includes('fix-orientation')) {
  fixImageOrientation();
}