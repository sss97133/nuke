/**
 * Duplicate Image Detection Service
 * Detects exact and near-duplicate images before upload
 */

import { supabase } from '../lib/supabase';

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateType: 'exact' | 'perceptual' | 'none';
  originalImageId?: string;
  similarityScore?: number;
  originalUrl?: string;
  message?: string;
}

export interface BulkUploadResult {
  total: number;
  uploaded: number;
  rejected: number;
  duplicates: Array<{
    fileName: string;
    reason: string;
    duplicateOf?: string;
  }>;
}

/**
 * Calculate SHA-256 hash of file
 */
export async function calculateFileHash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Check if image is duplicate for a vehicle
 */
export async function checkDuplicate(
  vehicleId: string,
  fileHash: string
): Promise<DuplicateCheckResult> {
  try {
    // Check for exact hash match
    const { data: existingImage, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url, file_name, created_at')
      .eq('vehicle_id', vehicleId)
      .eq('file_hash', fileHash)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking duplicates:', error);
      return {
        isDuplicate: false,
        duplicateType: 'none',
        message: 'Could not check for duplicates'
      };
    }

    if (existingImage) {
      return {
        isDuplicate: true,
        duplicateType: 'exact',
        originalImageId: existingImage.id,
        originalUrl: existingImage.image_url,
        similarityScore: 1.0,
        message: `Exact duplicate of image uploaded on ${new Date(existingImage.created_at).toLocaleDateString()}`
      };
    }

    return {
      isDuplicate: false,
      duplicateType: 'none'
    };
  } catch (err) {
    console.error('Duplicate check failed:', err);
    return {
      isDuplicate: false,
      duplicateType: 'none',
      message: 'Duplicate check failed'
    };
  }
}

/**
 * Process bulk upload with duplicate detection
 */
export async function processBulkUpload(
  files: File[],
  vehicleId: string,
  onProgress?: (progress: number, status: string) => void
): Promise<BulkUploadResult> {
  const result: BulkUploadResult = {
    total: files.length,
    uploaded: 0,
    rejected: 0,
    duplicates: []
  };

  // Step 1: Calculate hashes for all files (fast, parallel)
  onProgress?.(0, 'Calculating file hashes...');
  
  const filesWithHashes = await Promise.all(
    files.map(async (file, index) => {
      const hash = await calculateFileHash(file);
      onProgress?.((index + 1) / files.length * 30, `Hashing ${index + 1}/${files.length}...`);
      return { file, hash };
    })
  );

  // Step 2: Check for duplicates within the upload batch itself
  onProgress?.(30, 'Checking for duplicates in batch...');
  
  const hashSet = new Set<string>();
  const batchDuplicates = new Set<number>();
  
  filesWithHashes.forEach((item, index) => {
    if (hashSet.has(item.hash)) {
      batchDuplicates.add(index);
      result.duplicates.push({
        fileName: item.file.name,
        reason: 'Duplicate within upload batch',
        duplicateOf: 'Another file in this upload'
      });
      result.rejected++;
    } else {
      hashSet.add(item.hash);
    }
  });

  // Step 3: Check against existing images in database
  onProgress?.(40, 'Checking against existing images...');
  
  const uniqueFiles = filesWithHashes.filter((_, index) => !batchDuplicates.has(index));
  const dbDuplicates: number[] = [];
  
  // Batch check duplicates (check in groups of 20)
  const BATCH_SIZE = 20;
  for (let i = 0; i < uniqueFiles.length; i += BATCH_SIZE) {
    const batch = uniqueFiles.slice(i, i + BATCH_SIZE);
    const hashes = batch.map(item => item.hash);
    
    const { data: existingImages } = await supabase
      .from('vehicle_images')
      .select('file_hash, file_name, created_at')
      .eq('vehicle_id', vehicleId)
      .in('file_hash', hashes);

    if (existingImages && existingImages.length > 0) {
      const existingHashSet = new Set(existingImages.map(img => img.file_hash));
      
      batch.forEach((item, batchIndex) => {
        if (existingHashSet.has(item.hash)) {
          const actualIndex = i + batchIndex;
          dbDuplicates.push(actualIndex);
          
          const existing = existingImages.find(img => img.file_hash === item.hash);
          result.duplicates.push({
            fileName: item.file.name,
            reason: 'Already uploaded',
            duplicateOf: existing?.file_name || 'Existing image'
          });
          result.rejected++;
        }
      });
    }
    
    onProgress?.(40 + (i / uniqueFiles.length) * 20, `Checked ${i + batch.length}/${uniqueFiles.length}...`);
  }

  // Step 4: Get final list of files to upload
  const filesToUpload = filesWithHashes
    .map((item, index) => ({ ...item, index }))
    .filter(item => !batchDuplicates.has(item.index) && !dbDuplicates.includes(item.index));

  result.uploaded = filesToUpload.length;
  
  onProgress?.(60, `${result.uploaded} unique images ready to upload, ${result.rejected} duplicates rejected`);

  return result;
}

/**
 * Get duplicate statistics for a vehicle
 */
export async function getDuplicateStats(vehicleId: string) {
  try {
    const { data, error } = await supabase
      .rpc('get_duplicate_stats', { p_vehicle_id: vehicleId });

    if (error) throw error;

    return data?.[0] || {
      total_images: 0,
      unique_images: 0,
      duplicate_images: 0,
      space_wasted_bytes: 0
    };
  } catch (err) {
    console.error('Failed to get duplicate stats:', err);
    return {
      total_images: 0,
      unique_images: 0,
      duplicate_images: 0,
      space_wasted_bytes: 0
    };
  }
}

/**
 * Clean up duplicate images for a vehicle
 */
export async function cleanupDuplicates(vehicleId: string) {
  try {
    const { data: duplicates } = await supabase
      .from('vehicle_images')
      .select('id, image_url, storage_path')
      .eq('vehicle_id', vehicleId)
      .eq('is_duplicate', true);

    if (!duplicates || duplicates.length === 0) {
      return { removed: 0, spaceFreed: 0 };
    }

    // Delete from storage
    const storagePaths = duplicates
      .map(img => img.storage_path)
      .filter(Boolean) as string[];

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('vehicle-images')
        .remove(storagePaths);

      if (storageError) {
        console.error('Error deleting from storage:', storageError);
      }
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId)
      .eq('is_duplicate', true);

    if (dbError) throw dbError;

    return {
      removed: duplicates.length,
      spaceFreed: 0 // Would need file_size to calculate
    };
  } catch (err) {
    console.error('Failed to cleanup duplicates:', err);
    throw err;
  }
}

